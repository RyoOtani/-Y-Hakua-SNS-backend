const router = require("express").Router();
const User = require("../models/User");
const passport = require("passport");
const redisClient = require("../redisClient");
const { authenticate } = require("../middleware/auth");

// 機密フィールドを除外するヘルパー
const sanitizeUser = (user) => {
  if (!user) return null;
  const obj = user._doc || user;
  const { password, accessToken, refreshToken, updatedAt, __v, ...safe } = obj;
  return safe;
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
router.put("/:id/settings", passport.authenticate('jwt', { session: false }), async (req, res) => {
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

//クエリパラメータによるユーザー情報の取得
router.get("/", async (req, res) => {
  const userId = req.query.userId;
  const username = req.query.username;
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
    //フォロワーにいなかったらフォローできる
    if (!user.followers.includes(currentUserId)) {
      await user.updateOne({
        $push: {
          followers: currentUserId,
        }
      });
      await currentUser.updateOne({
        $push: {
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
    //フォロワーにいたらフォロー外せる
    if (user.followers.includes(currentUserId)) {
      await user.updateOne({ $pull: { followers: currentUserId } });
      await currentUser.updateOne({ $pull: { following: req.params.id } });

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

// Google認証によるユーザー情報の取得
router.get("/me", passport.authenticate('jwt', { session: false }), (req, res) => {
  // パスワードを除いてユーザー情報を返す
  const { password, updatedAt, ...other } = req.user._doc;
  res.status(200).json(other);
});

//get friends (following list)
router.get("/friends/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    let followingIds = [];

    // Try Redis first
    try {
      followingIds = await redisClient.sMembers(`following:${userId}`);
    } catch (redisErr) {
      console.error("Redis fetch error (friends):", redisErr);
    }

    // If Redis is empty, fallback to MongoDB and seed Redis
    if (followingIds.length === 0) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "ユーザーが見つかりません" });
      }
      followingIds = user.following || [];

      // Seed Redis
      if (followingIds.length > 0) {
        try {
          await redisClient.sAdd(`following:${userId}`, followingIds);
        } catch (seedErr) {
          console.error("Redis seed error (friends):", seedErr);
        }
      }
    }

    if (followingIds.length === 0) {
      return res.status(200).json([]);
    }

    const friends = await Promise.all(
      followingIds.map((friendId) => {
        return User.findById(friendId);
      })
    );

    let friendList = [];
    friends.forEach((friend) => {
      if (friend) {
        const { _id, username, profilePicture } = friend;
        friendList.push({ _id, username, profilePicture });
      }
    });
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
      followerIds = await redisClient.sMembers(`followers:${userId}`);
    } catch (redisErr) {
      console.error("Redis fetch error (followers):", redisErr);
    }

    // If Redis is empty, fallback to MongoDB and seed Redis
    if (followerIds.length === 0) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "ユーザーが見つかりません" });
      }
      followerIds = user.followers || [];

      // Seed Redis
      if (followerIds.length > 0) {
        try {
          await redisClient.sAdd(`followers:${userId}`, followerIds);
        } catch (seedErr) {
          console.error("Redis seed error (followers):", seedErr);
        }
      }
    }

    if (followerIds.length === 0) {
      return res.status(200).json([]);
    }

    const followers = await Promise.all(
      followerIds.map((followerId) => {
        return User.findById(followerId);
      })
    );

    let followerList = [];
    followers.forEach((follower) => {
      if (follower) {
        const { _id, username, profilePicture } = follower;
        followerList.push({ _id, username, profilePicture });
      }
    });
    res.status(200).json(followerList);
  } catch (err) {
    console.error("Followers fetch error:", err);
    res.status(500).json({ error: "フォロワー取得に失敗しました" });
  }
});

// プライバシーポリシー
router.put("/:id/agree-privacy", passport.authenticate('jwt', { session: false }), async (req, res) => {
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

module.exports = router;