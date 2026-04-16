const router = require("express").Router();
const User = require("../models/User");
const Notification = require("../models/Notification");
const mongoose = require("mongoose");
const redisClient = require("../redisClient");
const { authenticate, requireElevatedAccess } = require("../middleware/auth");
const { sendPushToUser } = require("../utils/pushNotification");
const { getActiveLearningRankingBadge } = require('../utils/learningBadge');
const {
  getActiveTemporaryBan,
  normalizeTemporaryBanReason,
} = require('../utils/temporaryBan');
const {
  getEmailBlockState,
  normalizeEmailBlockReason,
} = require('../utils/emailBlock');

const MAX_TEMP_BAN_DURATION_MINUTES = 60 * 24 * 30;
const MAX_TEMP_BAN_REASON_LENGTH = 200;

const normalizeObjectIdList = (input) => {
  const values = Array.isArray(input) ? input : [input];
  const uniq = new Set();

  values.forEach((value) => {
    if (value == null) return;

    if (Array.isArray(value)) {
      value.forEach((nested) => {
        const normalized = typeof nested === 'string' ? nested : nested?.toString?.();
        if (!normalized) return;
        normalized
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean)
          .forEach((token) => {
            if (mongoose.Types.ObjectId.isValid(token)) {
              uniq.add(token);
            }
          });
      });
      return;
    }

    const normalized = typeof value === 'string' ? value : value?.toString?.();
    if (!normalized) return;
    normalized
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
      .forEach((token) => {
        if (mongoose.Types.ObjectId.isValid(token)) {
          uniq.add(token);
        }
      });
  });

  return Array.from(uniq);
};

const parseTemporaryBanUntil = (body = {}) => {
  const clearRequested = body.clear === true || body.banUntil === null;
  if (clearRequested) {
    return { clear: true, until: null };
  }

  if (body.durationMinutes !== undefined && body.durationMinutes !== null && body.durationMinutes !== '') {
    const minutes = Number.parseInt(body.durationMinutes, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return { error: 'durationMinutes は1以上の整数で指定してください。' };
    }
    if (minutes > MAX_TEMP_BAN_DURATION_MINUTES) {
      return {
        error: `durationMinutes は最大 ${MAX_TEMP_BAN_DURATION_MINUTES} 分まで指定できます。`,
      };
    }

    return {
      clear: false,
      until: new Date(Date.now() + minutes * 60 * 1000),
    };
  }

  if (body.banUntil === undefined || body.banUntil === '') {
    return {
      error: 'banUntil または durationMinutes を指定してください。解除する場合は clear=true を指定してください。',
    };
  }

  const parsedUntil = new Date(body.banUntil);
  if (!Number.isFinite(parsedUntil.getTime())) {
    return { error: 'banUntil は有効な日時(ISO8601)で指定してください。' };
  }
  if (parsedUntil.getTime() <= Date.now()) {
    return { error: 'banUntil は現在時刻より未来を指定してください。' };
  }

  return { clear: false, until: parsedUntil };
};

const buildModerationState = (user) => {
  const activeBan = getActiveTemporaryBan(user);
  const emailBlockState = getEmailBlockState(user);

  return {
    userId: user?._id ? String(user._id) : null,
    username: user?.username || null,
    email: user?.email || null,
    temporaryBan: activeBan
      ? {
          active: true,
          until: activeBan.untilIso,
          reason: activeBan.reason,
          bannedBy: user?.temporaryBannedBy ? String(user.temporaryBannedBy) : null,
        }
      : {
          active: false,
          until: null,
          reason: null,
          bannedBy: null,
        },
    emailBlock: emailBlockState,
  };
};

// 機密フィールドを除外するヘルパー
const sanitizeUser = (user) => {
  if (!user) return null;
  const obj = user._doc || user;
  const {
    password,
    accessToken,
    refreshToken,
    fcmToken,
    blockedUsers,
    followers,
    following,
    followings,
    closeFriends,
    mutedUsers,
    email,
    notificationPreferences,
    notificationDeliveryMode,
    lastBatchedNotificationSentAt,
    learningRankingBadge,
    accountLocked,
    lockReason,
    lockedAt,
    requiresReauth,
    temporaryBanUntil,
    temporaryBanReason,
    temporaryBannedBy,
    emailBlockActive,
    emailBlockReason,
    emailBlockedBy,
    emailBlockedAt,
    updatedAt,
    __v,
    ...safe
  } = obj;

  const normalizedFollowers = normalizeObjectIdList(followers || []);
  const normalizedFollowing = normalizeObjectIdList(
    (Array.isArray(following) && following.length > 0)
      ? following
      : (followings || [])
  );
  const normalizedCloseFriends = normalizeObjectIdList(closeFriends || []);

  return {
    ...safe,
    followersCount: normalizedFollowers.length,
    followingCount: normalizedFollowing.length,
    closeFriendsCount: normalizedCloseFriends.length,
    learningRankingBadge: getActiveLearningRankingBadge(learningRankingBadge),
  };
};

//CRUD
//ユーザー情報の更新（認証必須 + ホワイトリスト）
router.put("/:id", authenticate, async (req, res) => {
  // トークンから取得したユーザーIDで認可判定
  if (req.user._id.toString() !== req.params.id) {
    return res.status(403).json({ error: "自分のアカウントのみ情報を更新できます。" });
  }
  try {
    // 更新可能なフィールドをホワイトリスト方式で制限
    const allowedFields = ['username', 'email', 'desc', 'profilePicture', 'coverPicture', 'backgroundColor', 'font'];
    const updates = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }
    await User.findByIdAndUpdate(req.params.id, { $set: updates });
    res.status(200).json({ message: "ユーザー情報が更新されました。" });
  } catch (err) {
    console.error('User update error:', err);
    return res.status(500).json({ error: 'ユーザー更新に失敗しました' });
  }
});

// 管理者向け: モデレーション状態取得
router.get('/:id/moderation', authenticate, requireElevatedAccess, async (req, res) => {
  const targetUserId = String(req.params.id || '');
  if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
    return res.status(400).json({ error: '無効なユーザーIDです。' });
  }

  try {
    const user = await User.findById(targetUserId)
      .select('_id username email temporaryBanUntil temporaryBanReason temporaryBannedBy emailBlockActive emailBlockReason emailBlockedBy emailBlockedAt');

    if (!user) {
      return res.status(404).json({ error: 'ユーザーが見つかりません。' });
    }

    return res.status(200).json(buildModerationState(user));
  } catch (err) {
    console.error('Moderation state fetch error:', err);
    return res.status(500).json({ error: 'モデレーション状態の取得に失敗しました。' });
  }
});

//ユーザー情報の削除（認証必須）
router.delete("/:id", authenticate, async (req, res) => {
  if (req.user._id.toString() !== req.params.id) {
    return res.status(403).json({ error: "自分のアカウントのみ情報を削除できます。" });
  }
  try {
    await User.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "ユーザー情報が削除されました。" });
  } catch (err) {
    console.error('User delete error:', err);
    return res.status(500).json({ error: 'ユーザー削除に失敗しました' });
  }
});

//ユーザー情報の取得
// router.get("/:id", async(req,res) => {
//      try{
//         const user = await User.findById(req.params.id);
//         const {password, updatedAt,...other} = user._doc;
//         return res.status(200).json(other);
//     }catch(err){
//         return res.status(500).json(err);
//     }

// });

// ユーザー設定の更新
router.get("/:id/settings", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json("ユーザーが見つかりません。");
    }
    const { backgroundColor, font, coverPicture, desc } = user;
    res.status(200).json({ backgroundColor, font, coverPicture, desc });
  } catch (err) {
    res.status(500).json(err);
  }
});

// ユーザー設定の更新
router.put("/:id/settings", authenticate, async (req, res) => {
  // 認証されたユーザーのIDとリクエストパラメータのIDが一致するか確認
  if (req.user._id.toString() !== req.params.id) {
    return res.status(403).json("自分のアカウントの設定のみ更新できます。");
  }

  try {
    await User.findByIdAndUpdate(req.params.id, {
      $set: {
        backgroundColor: req.body.backgroundColor,
        font: req.body.font,
        coverPicture: req.body.coverPicture,
        desc: req.body.desc,
      },
    });
    res.status(200).json("設定が更新されました。");
  } catch (err) {
    console.error("Settings Update Error:", err);
    res.status(500).json(err);
  }
});

// 管理者による一時BANの設定/解除
router.patch('/:id/temporary-ban', authenticate, requireElevatedAccess, async (req, res) => {
  const targetUserId = String(req.params.id || '');
  if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
    return res.status(400).json({ error: '無効なユーザーIDです。' });
  }

  const parsedBan = parseTemporaryBanUntil(req.body);
  if (parsedBan.error) {
    return res.status(400).json({ error: parsedBan.error });
  }

  if (!parsedBan.clear && req.user._id.toString() === targetUserId) {
    return res.status(400).json({ error: '自分自身に一時BANは設定できません。' });
  }

  const reasonInput = normalizeTemporaryBanReason(req.body?.reason);
  const reason = reasonInput ? reasonInput.slice(0, MAX_TEMP_BAN_REASON_LENGTH) : null;

  const updateSet = {};
  const updateUnset = {};

  if (parsedBan.clear) {
    updateUnset.temporaryBanUntil = '';
    updateUnset.temporaryBanReason = '';
    updateUnset.temporaryBannedBy = '';
  } else {
    updateSet.temporaryBanUntil = parsedBan.until;
    updateSet.temporaryBannedBy = req.user._id;
    if (reason) {
      updateSet.temporaryBanReason = reason;
    } else {
      updateUnset.temporaryBanReason = '';
    }
  }

  const update = {};
  if (Object.keys(updateSet).length > 0) {
    update.$set = updateSet;
  }
  if (Object.keys(updateUnset).length > 0) {
    update.$unset = updateUnset;
  }

  try {
    const updatedUser = await User.findByIdAndUpdate(targetUserId, update, { new: true })
      .select('_id username email temporaryBanUntil temporaryBanReason temporaryBannedBy emailBlockActive emailBlockReason emailBlockedBy emailBlockedAt');

    if (!updatedUser) {
      return res.status(404).json({ error: 'ユーザーが見つかりません。' });
    }

    return res.status(200).json(buildModerationState(updatedUser));
  } catch (err) {
    console.error('Temporary ban update error:', err);
    return res.status(500).json({ error: '一時BANの更新に失敗しました。' });
  }
});

// 管理者によるメールブロック設定/解除（永続）
router.patch('/:id/email-block', authenticate, requireElevatedAccess, async (req, res) => {
  const targetUserId = String(req.params.id || '');
  if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
    return res.status(400).json({ error: '無効なユーザーIDです。' });
  }

  const blocked = req.body?.blocked;
  if (typeof blocked !== 'boolean') {
    return res.status(400).json({ error: 'blocked は true または false を指定してください。' });
  }

  if (blocked && req.user._id.toString() === targetUserId) {
    return res.status(400).json({ error: '自分自身をメールブロックすることはできません。' });
  }

  const reasonInput = normalizeEmailBlockReason(req.body?.reason);
  const reason = reasonInput ? reasonInput.slice(0, MAX_TEMP_BAN_REASON_LENGTH) : null;

  const updateSet = {};
  const updateUnset = {};

  if (blocked) {
    updateSet.emailBlockActive = true;
    updateSet.emailBlockedBy = req.user._id;
    updateSet.emailBlockedAt = new Date();
    if (reason) {
      updateSet.emailBlockReason = reason;
    } else {
      updateUnset.emailBlockReason = '';
    }
  } else {
    updateSet.emailBlockActive = false;
    updateUnset.emailBlockReason = '';
    updateUnset.emailBlockedBy = '';
    updateUnset.emailBlockedAt = '';
  }

  const update = {};
  if (Object.keys(updateSet).length > 0) {
    update.$set = updateSet;
  }
  if (Object.keys(updateUnset).length > 0) {
    update.$unset = updateUnset;
  }

  try {
    const updatedUser = await User.findByIdAndUpdate(targetUserId, update, { new: true })
      .select('_id username email temporaryBanUntil temporaryBanReason temporaryBannedBy emailBlockActive emailBlockReason emailBlockedBy emailBlockedAt');

    if (!updatedUser) {
      return res.status(404).json({ error: 'ユーザーが見つかりません。' });
    }

    return res.status(200).json(buildModerationState(updatedUser));
  } catch (err) {
    console.error('Email block update error:', err);
    return res.status(500).json({ error: 'メールブロック更新に失敗しました。' });
  }
});

//クエリパラメータによるユーザー情報の取得
router.get("/", async (req, res) => {
  const userId = req.query.userId;
  const username = req.query.username;

  if (userId && !mongoose.Types.ObjectId.isValid(String(userId))) {
    return res.status(400).json({ error: "無効な userId です" });
  }

  try {
    const user = userId
      ? await User.findById(userId)
      : await User.findOne({ username: username });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json(sanitizeUser(user));
  } catch (err) {
    console.error('User fetch error:', err);
    return res.status(500).json({ error: 'ユーザー取得に失敗しました' });
  }

});

// //follow a user
// router.put("/:id/follow", async (req, res) => {
//   if (req.body.userId !== req.params.id) {
//     try {
//       const user = await User.findById(req.params.id);
//       const currentUser = await User.findById(req.body.userId);
//       //フォロワーにいなかったらフォローできる
//       if (!user.followers.includes(req.body.userId)) {
//         await user.updateOne({ $push: { followers: req.body.userId } });
//         await currentUser.updateOne({ $push: { following: req.params.id } });
//         res.status(200).json("ユーザーをフォローしました");
//       } else {
//         return res.status(403).json("すでにこのユーザーをフォローしています");
//       }
//     } catch (err) {
//       return res.status(500).json(err);
//     }
//   } else {
//     return res.status(500).json("自分をフォローすることはできません");
//   }
// });

//follow a user
router.put("/:id/follow", authenticate, async (req, res) => {
  const currentUserId = req.user._id.toString();
  if (currentUserId === req.params.id) {
    return res.status(400).json({ error: "自分をフォローすることはできません" });
  }
  try {
    const user = await User.findById(req.params.id);
    const currentUser = await User.findById(currentUserId);
    if (!user || !currentUser) {
      return res.status(404).json({ error: "ユーザーが見つかりません" });
    }
    const followerIds = Array.isArray(user.followers)
      ? user.followers.map((id) => id.toString())
      : [];
    //フォロワーにいなかったらフォローできる
    if (!followerIds.includes(currentUserId)) {
      await user.updateOne({
        $addToSet: {
          followers: currentUserId,
        }
      });
      await currentUser.updateOne({
        $addToSet: {
          following: req.params.id
        }
      });

      // Redis sync
      try {
        await redisClient.sAdd(`followers:${req.params.id}`, currentUserId);
        await redisClient.sAdd(`following:${currentUserId}`, req.params.id);
      } catch (redisErr) {
        console.error("Redis sync error (follow):", redisErr);
      }

      if (user.notificationPreferences?.follow !== false) {
        const notification = new Notification({
          sender: currentUserId,
          receiver: user._id,
          type: "follow",
        });
        const savedNotification = await notification.save();

        try {
          const notificationData = {
            _id: savedNotification._id,
            sender: {
              _id: currentUser._id,
              username: currentUser.username,
              profilePicture: currentUser.profilePicture,
            },
            receiver: user._id,
            type: "follow",
            createdAt: savedNotification.createdAt,
            isRead: false,
          };
          await redisClient.lPush(`notifications:${user._id}`, JSON.stringify(notificationData));
          await redisClient.lTrim(`notifications:${user._id}`, 0, 49);
        } catch (redisErr) {
          console.error("Redis sync error (follow notification):", redisErr);
        }

        const io = req.app.get('io');
        if (io) {
          io.to(user._id.toString()).emit("getNotification", {
            senderId: currentUserId,
            senderName: currentUser.username,
            type: "follow",
          });
        }

        sendPushToUser({
          receiverId: user._id,
          title: '新しいフォロー',
          body: `${currentUser.username} さんがあなたをフォローしました`,
          data: {
            type: 'follow',
            senderId: currentUserId,
          },
        }).catch((pushErr) => {
          console.error('FCM notify error (follow):', pushErr);
        });
      }

      res.status(200).json({ message: "ユーザーをフォローしました" });
    } else {
      return res.status(403).json({ error: "すでにこのユーザーをフォローしています" });
    }
  } catch (err) {
    console.error('Follow error:', err);
    return res.status(500).json({ error: 'フォローに失敗しました' });
  }
});

// //unfollow a user
// router.put("/:id/unfollow", async (req, res) => {
//   if (req.body.userId !== req.params.id) {
//     try {
//       const user = await User.findById(req.params.id);
//       const currentUser = await User.findById(req.body.userId);
//       //フォロワーにいたらフォロー外せる
//       if (user.followers.includes(req.body.userId)) {
//         await user.updateOne({ $pull: { followers: req.body.userId } });
//         await currentUser.updateOne({ $pull: { following: req.params.id } });
//         res.status(200).json("フォローを解除しました");
//       } else {
//         return res.status(403).json("このユーザーをフォローしていません");
//       }
//     } catch (err) {
//       return res.status(500).json(err);
//     }
//   } else {
//     return res.status(500).json("自分をフォローすることはできません");
//   }
// });

//unfollow a user
router.put("/:id/unfollow", authenticate, async (req, res) => {
  const currentUserId = req.user._id.toString();
  if (currentUserId === req.params.id) {
    return res.status(400).json({ error: "自分をフォロー解除することはできません" });
  }
  try {
    const user = await User.findById(req.params.id);
    const currentUser = await User.findById(currentUserId);
    if (!user || !currentUser) {
      return res.status(404).json({ error: "ユーザーが見つかりません" });
    }
    const followerIds = Array.isArray(user.followers)
      ? user.followers.map((id) => id.toString())
      : [];
    //フォロワーにいたらフォロー外せる
    if (followerIds.includes(currentUserId)) {
      await user.updateOne({ $pull: { followers: currentUserId } });
        await currentUser.updateOne({
          $pull: {
            following: req.params.id,
            closeFriends: req.params.id,
          },
        });

      // Redis sync
      try {
        await redisClient.sRem(`followers:${req.params.id}`, currentUserId);
        await redisClient.sRem(`following:${currentUserId}`, req.params.id);
      } catch (redisErr) {
        console.error("Redis sync error (unfollow):", redisErr);
      }

      res.status(200).json({ message: "フォローを解除しました" });
    } else {
      return res.status(403).json({ error: "このユーザーをフォローしていません" });
    }
  } catch (err) {
    console.error('Unfollow error:', err);
    return res.status(500).json({ error: 'フォロー解除に失敗しました' });
  }
});

// block a user
router.put("/:id/block", authenticate, async (req, res) => {
  const currentUserId = req.user._id.toString();
  if (currentUserId === req.params.id) {
    return res.status(400).json({ error: "自分自身をブロックすることはできません" });
  }

  try {
    const [targetUser, currentUser] = await Promise.all([
      User.findById(req.params.id),
      User.findById(currentUserId),
    ]);

    if (!targetUser || !currentUser) {
      return res.status(404).json({ error: "ユーザーが見つかりません" });
    }

    if (currentUser.blockedUsers?.map((id) => id.toString()).includes(req.params.id)) {
      return res.status(409).json({ error: "すでにこのユーザーをブロックしています" });
    }

    await currentUser.updateOne({ $addToSet: { blockedUsers: req.params.id } });

    return res.status(200).json({ message: "ユーザーをブロックしました" });
  } catch (err) {
    console.error('Block user error:', err);
    return res.status(500).json({ error: 'ブロック処理に失敗しました' });
  }
});

// unblock a user
router.put("/:id/unblock", authenticate, async (req, res) => {
  const currentUserId = req.user._id.toString();
  if (currentUserId === req.params.id) {
    return res.status(400).json({ error: "自分自身のブロック解除はできません" });
  }

  try {
    const currentUser = await User.findById(currentUserId);
    if (!currentUser) {
      return res.status(404).json({ error: "ユーザーが見つかりません" });
    }

    await currentUser.updateOne({ $pull: { blockedUsers: req.params.id } });

    return res.status(200).json({ message: "ユーザーのブロックを解除しました" });
  } catch (err) {
    console.error('Unblock user error:', err);
    return res.status(500).json({ error: 'ブロック解除に失敗しました' });
  }
});

// mute a user
router.put("/:id/mute", authenticate, async (req, res) => {
  const currentUserId = req.user._id.toString();
  const targetUserId = String(req.params.id || '');

  if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
    return res.status(400).json({ error: "無効なユーザーIDです" });
  }
  if (currentUserId === targetUserId) {
    return res.status(400).json({ error: "自分自身をミュートすることはできません" });
  }

  try {
    const [targetUser, currentUser] = await Promise.all([
      User.findById(targetUserId).select('_id'),
      User.findById(currentUserId).select('mutedUsers'),
    ]);

    if (!targetUser || !currentUser) {
      return res.status(404).json({ error: "ユーザーが見つかりません" });
    }

    const mutedIds = normalizeObjectIdList(currentUser.mutedUsers || []);
    if (mutedIds.includes(targetUserId)) {
      return res.status(409).json({ error: "すでにこのユーザーをミュートしています" });
    }

    await User.findByIdAndUpdate(currentUserId, {
      $addToSet: { mutedUsers: targetUserId },
    });

    return res.status(200).json({ message: "ユーザーをミュートしました" });
  } catch (err) {
    console.error('Mute user error:', err);
    return res.status(500).json({ error: 'ミュート処理に失敗しました' });
  }
});

// unmute a user
router.put("/:id/unmute", authenticate, async (req, res) => {
  const currentUserId = req.user._id.toString();
  const targetUserId = String(req.params.id || '');

  if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
    return res.status(400).json({ error: "無効なユーザーIDです" });
  }
  if (currentUserId === targetUserId) {
    return res.status(400).json({ error: "自分自身のミュート解除はできません" });
  }

  try {
    const currentUser = await User.findById(currentUserId).select('_id mutedUsers');
    if (!currentUser) {
      return res.status(404).json({ error: "ユーザーが見つかりません" });
    }

    await User.findByIdAndUpdate(currentUserId, {
      $pull: { mutedUsers: targetUserId },
    });

    return res.status(200).json({ message: "ユーザーのミュートを解除しました" });
  } catch (err) {
    console.error('Unmute user error:', err);
    return res.status(500).json({ error: 'ミュート解除に失敗しました' });
  }
});

// get muted user list
router.get('/me/muted', authenticate, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id)
      .populate('mutedUsers', 'username profilePicture')
      .select('mutedUsers');

    if (!currentUser) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }

    return res.status(200).json(currentUser.mutedUsers || []);
  } catch (err) {
    console.error('Fetch muted users error:', err);
    return res.status(500).json({ error: 'ミュート一覧の取得に失敗しました' });
  }
});

// ユーザー検索API
router.get("/search", async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.json([]);

  try {
    // 正規表現で部分一致（大文字小文字を無視）
    const users = await User.find({
      $or: [
        { username: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: "i" } },
        { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: "i" } },
      ],
    })
    .select('username profilePicture desc')
    .limit(20);

    res.json(users);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: "ユーザー検索に失敗しました" });
  }
});

// おすすめユーザー取得（人気ユーザー + 共通フォロー）
router.get('/recommendations', authenticate, async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('following');
    if (!me) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }

    const followingIds = (me.following || []).map((id) => id.toString());
    const excludedIdStrings = new Set([req.user._id.toString(), ...followingIds]);
    const excludedIds = Array.from(excludedIdStrings).map((id) => new mongoose.Types.ObjectId(id));

    const popularUsers = await User.aggregate([
      {
        $match: {
          _id: { $nin: excludedIds },
        },
      },
      {
        $addFields: {
          followerCount: { $size: { $ifNull: ['$followers', []] } },
        },
      },
      { $sort: { followerCount: -1, createdAt: -1 } },
      { $limit: 12 },
      {
        $project: {
          username: 1,
          profilePicture: 1,
          desc: 1,
          followerCount: 1,
        },
      },
    ]);

    const followingDocs = followingIds.length > 0
      ? await User.find({ _id: { $in: followingIds } }).select('following')
      : [];

    const commonCounter = new Map();
    for (const doc of followingDocs) {
      const docFollowing = doc.following || [];
      docFollowing.forEach((candidateId) => {
        const id = candidateId.toString();
        if (excludedIdStrings.has(id)) return;
        commonCounter.set(id, (commonCounter.get(id) || 0) + 1);
      });
    }

    const mutualIds = Array.from(commonCounter.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id]) => id);

    const mutualUsersRaw = mutualIds.length > 0
      ? await User.find({ _id: { $in: mutualIds } })
          .select('username profilePicture desc followers')
          .lean()
      : [];

    const mutualFollowedUsers = mutualUsersRaw
      .map((u) => ({
        _id: u._id,
        username: u.username,
        profilePicture: u.profilePicture,
        desc: u.desc || '',
        followerCount: Array.isArray(u.followers) ? u.followers.length : 0,
        commonFollowingCount: commonCounter.get(u._id.toString()) || 0,
      }))
      .sort((a, b) => {
        if (b.commonFollowingCount !== a.commonFollowingCount) {
          return b.commonFollowingCount - a.commonFollowingCount;
        }
        return b.followerCount - a.followerCount;
      })
      .slice(0, 12);

    return res.status(200).json({
      popularUsers,
      mutualFollowedUsers,
    });
  } catch (err) {
    console.error('User recommendations error:', err);
    return res.status(500).json({ error: 'おすすめユーザーの取得に失敗しました' });
  }
});

// Google認証によるユーザー情報の取得
router.get("/me", authenticate, (req, res) => {
  // パスワードを除いてユーザー情報を返す
  const {
    password,
    accessToken,
    refreshToken,
    fcmToken,
    updatedAt,
    learningRankingBadge,
    ...other
  } = req.user._doc;

  res.status(200).json({
    ...other,
    learningRankingBadge: getActiveLearningRankingBadge(learningRankingBadge),
  });
});

// Firebase Cloud Messaging トークン登録
router.put('/me/push-token', authenticate, async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';

  if (!token) {
    return res.status(400).json({ error: 'token は必須です。' });
  }

  try {
    await User.updateMany(
      {
        _id: { $ne: req.user._id },
        fcmToken: token,
      },
      {
        $set: { fcmToken: null },
      }
    );

    await User.findByIdAndUpdate(req.user._id, {
      $set: { fcmToken: token },
    });

    return res.status(200).json({ message: 'FCMトークンを登録しました。' });
  } catch (err) {
    console.error('Push token register error:', err);
    return res.status(500).json({ error: 'FCMトークン登録に失敗しました。' });
  }
});

// Firebase Cloud Messaging トークン状態確認（デバッグ用）
router.get('/me/push-token', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('fcmToken');
    const token = user?.fcmToken || '';
    const masked = token.length > 12
      ? `${token.slice(0, 6)}...${token.slice(-6)}`
      : token;

    return res.status(200).json({
      hasToken: Boolean(token),
      tokenLength: token.length,
      tokenMasked: masked,
    });
  } catch (err) {
    console.error('Push token status error:', err);
    return res.status(500).json({ error: 'FCMトークン状態の取得に失敗しました。' });
  }
});

// Firebase Cloud Messaging トークン削除
router.delete('/me/push-token', authenticate, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $set: { fcmToken: null },
    });

    return res.status(200).json({ message: 'FCMトークンを削除しました。' });
  } catch (err) {
    console.error('Push token delete error:', err);
    return res.status(500).json({ error: 'FCMトークン削除に失敗しました。' });
  }
});

//get friends (following list)
router.get("/friends/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    let followingIds = [];

    // Try Redis first
    try {
      const cachedIds = await redisClient.sMembers(`following:${userId}`);
      followingIds = normalizeObjectIdList(cachedIds);
    } catch (redisErr) {
      console.error("Redis fetch error (friends):", redisErr);
    }

    // If Redis is empty, fallback to MongoDB and seed Redis
    if (followingIds.length === 0) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "ユーザーが見つかりません" });
      }
      followingIds = normalizeObjectIdList(
        (Array.isArray(user.following) && user.following.length > 0)
          ? user.following
          : (user.followings || [])
      );

      // Seed Redis
      if (followingIds.length > 0) {
        try {
          await redisClient.sAdd(`following:${userId}`, ...followingIds);
        } catch (seedErr) {
          console.error("Redis seed error (friends):", seedErr);
        }
      }
    }

    if (followingIds.length === 0) {
      return res.status(200).json([]);
    }

    const friends = await User.find({ _id: { $in: followingIds } })
      .select('_id username profilePicture')
      .lean();

    const friendList = friends.map((friend) => ({
      _id: friend._id,
      username: friend.username,
      profilePicture: friend.profilePicture,
    }));

    res.status(200).json(friendList);
  } catch (err) {
    console.error("Friends fetch error:", err);
    res.status(500).json({ error: "フレンド取得に失敗しました" });
  }
});

// get followers list
router.get("/followers/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    let followerIds = [];

    // Try Redis first
    try {
      const cachedIds = await redisClient.sMembers(`followers:${userId}`);
      followerIds = normalizeObjectIdList(cachedIds);
    } catch (redisErr) {
      console.error("Redis fetch error (followers):", redisErr);
    }

    // If Redis is empty, fallback to MongoDB and seed Redis
    if (followerIds.length === 0) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "ユーザーが見つかりません" });
      }
      followerIds = normalizeObjectIdList(user.followers || []);

      // Seed Redis
      if (followerIds.length > 0) {
        try {
          await redisClient.sAdd(`followers:${userId}`, ...followerIds);
        } catch (seedErr) {
          console.error("Redis seed error (followers):", seedErr);
        }
      }
    }

    if (followerIds.length === 0) {
      return res.status(200).json([]);
    }

    const followers = await User.find({ _id: { $in: followerIds } })
      .select('_id username profilePicture')
      .lean();

    const followerList = followers.map((follower) => ({
      _id: follower._id,
      username: follower.username,
      profilePicture: follower.profilePicture,
    }));

    res.status(200).json(followerList);
  } catch (err) {
    console.error("Followers fetch error:", err);
    res.status(500).json({ error: "フォロワー取得に失敗しました" });
  }
});

// プライバシーポリシー
router.put("/:id/agree-privacy", authenticate, async (req, res) => {
  if (req.user._id.toString() !== req.params.id) {
    return res.status(403).json("自分のアカウントのみ更新できます。");
  }

  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { hasAgreedToPrivacyPolicy: true } },
      { new: true }
    );
    const { password, updatedAt, ...other } = updatedUser._doc;
    res.status(200).json(other);
  } catch (err) {
    console.error("Privacy Policy Agreement Error:", err);
    res.status(500).json(err);
  }
});

// --- Close Friends ---

// Get close friends
router.get("/me/close-friends", authenticate, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).populate('closeFriends', 'username profilePicture');
    if (!currentUser) return res.status(404).json({ error: "ユーザーが見つかりません" });
    res.status(200).json(currentUser.closeFriends || []);
  } catch (err) {
    console.error("Fetch close friends error:", err);
    res.status(500).json({ error: "親友リストの取得に失敗しました" });
  }
});

// Add close friend
router.put("/me/close-friends/:targetUserId", authenticate, async (req, res) => {
  try {
    const currentUserId = req.user._id.toString();
    const targetUserId = req.params.targetUserId;

    if (!mongoose.Types.ObjectId.isValid(String(targetUserId))) {
      return res.status(400).json({ error: "無効なユーザーIDです" });
    }
    if (currentUserId === targetUserId) {
      return res.status(400).json({ error: "自分自身を親友に追加できません" });
    }
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) return res.status(404).json({ error: "対象ユーザーが見つかりません" });

    // 親友に追加
    await User.findByIdAndUpdate(currentUserId, {
      $addToSet: { closeFriends: targetUserId }
    });

    res.status(200).json({ message: "親友に追加しました" });
  } catch (err) {
    console.error("Add close friend error:", err);
    res.status(500).json({ error: "親友の追加に失敗しました" });
  }
});

// Remove close friend
router.delete("/me/close-friends/:targetUserId", authenticate, async (req, res) => {
  try {
    const currentUserId = req.user._id.toString();
    const targetUserId = req.params.targetUserId;

    if (!mongoose.Types.ObjectId.isValid(String(targetUserId))) {
      return res.status(400).json({ error: "無効なユーザーIDです" });
    }

    await User.findByIdAndUpdate(currentUserId, {
      $pull: { closeFriends: targetUserId }
    });
    res.status(200).json({ message: "親友から削除しました" });
  } catch (err) {
    console.error("Remove close friend error:", err);
    res.status(500).json({ error: "親友の削除に失敗しました" });
  }
});

module.exports = router;