const router = require("express").Router();
const Post = require("../models/Post");
const User = require("../models/User");
const Comment = require("../models/Comment");
const Notification = require("../models/Notification");
const { saveHashtags, getTodayDate, getTodayRangeUtc } = require("./hashtag");
const redisClient = require("../redisClient");
const { authenticate, optionalAuthenticate } = require("../middleware/auth");
const { sendPushToUser } = require("../utils/pushNotification");
const { censorText } = require("../utils/contentFilter");
const {
  POST_VISIBILITY,
  normalizePostVisibility,
  buildViewerVisibilityContext,
  buildVisibilityQueryForViewer,
  canViewerSeePost,
} = require("../utils/postVisibility");

const isNotificationEnabled = (userDoc, key) => {
  const prefs = userDoc?.notificationPreferences;
  if (!prefs || typeof prefs !== "object") return true;
  return prefs[key] !== false;
};

const normalizeImagePaths = (body) => {
  const imgs = Array.isArray(body?.imgs)
    ? body.imgs.filter((path) => typeof path === 'string' && path.trim())
    : [];
  const legacyImg = typeof body?.img === 'string' && body.img.trim() ? body.img.trim() : null;

  if (legacyImg && !imgs.includes(legacyImg)) {
    imgs.unshift(legacyImg);
  }

  return imgs.slice(0, 2);
};

const hasCloseFriends = async (userId) => {
  const me = await User.findById(userId).select('closeFriends');
  return Boolean(me && Array.isArray(me.closeFriends) && me.closeFriends.length > 0);
};

//create a post
router.post("/", authenticate, async (req, res) => {
  try {
    const filteredDesc = censorText(req.body.desc);
    const imgs = normalizeImagePaths(req.body);
    const postVisibility = normalizePostVisibility(req.body.visibility);
    if (!String(filteredDesc || '').trim() && imgs.length === 0 && !req.body.video) {
      return res.status(400).json({ error: '本文または画像/動画のいずれかが必要です' });
    }

    if (postVisibility === POST_VISIBILITY.CLOSE_FRIENDS) {
      const canPostToCloseFriends = await hasCloseFriends(req.user._id);
      if (!canPostToCloseFriends) {
        return res.status(400).json({ error: '親友リストが空です。先に親友を追加してください' });
      }
    }

    // ホワイトリスト方式で投稿作成
    const newPost = new Post({
      userId: req.user._id,
      desc: filteredDesc,
      img: imgs[0] || req.body.img,
      imgs,
      video: req.body.video,
      visibility: postVisibility,
    });
    const savedPost = await newPost.save();

    // userId を populate して返す（フロントで投稿者名を即表示するため）
    const populatedPost = await Post.findById(savedPost._id)
      .populate('userId', 'username profilePicture');

    // Extract and save hashtags from the post description
    if (filteredDesc) {
      await saveHashtags(filteredDesc);
    }

    // 投稿者のフォロワーを取得して通知を送る
    const user = await User.findById(req.user._id);
    const notificationTargets = postVisibility === POST_VISIBILITY.CLOSE_FRIENDS
      ? user?.closeFriends || []
      : user?.followers || [];

    if (user && notificationTargets.length > 0) {
      const io = req.app.get('io');
      const followerDocs = await User.find({ _id: { $in: notificationTargets } })
        .select('_id notificationPreferences');

      const followerIds = followerDocs
        .filter((follower) => follower._id.toString() !== req.user._id.toString())
        .filter((follower) => isNotificationEnabled(follower, 'newPost'))
        .map((follower) => follower._id.toString());

      followerIds.forEach((followerId) => {
        // フォロワーのルームにイベントを送信
        io.to(followerId).emit("newPost", {
          username: user.username,
          profilePicture: user.profilePicture,
          postId: savedPost._id
        });
      });

      await Promise.allSettled(
        followerIds.map((followerId) =>
          sendPushToUser({
            receiverId: followerId,
            title: postVisibility === POST_VISIBILITY.CLOSE_FRIENDS ? '親友向けの新しい投稿' : '新しい投稿',
            body: postVisibility === POST_VISIBILITY.CLOSE_FRIENDS
              ? `${user.username} さんが親友向け投稿をしました`
              : `${user.username} さんが新しい投稿をしました`,
            data: {
              type: 'new_post',
              postId: savedPost._id,
              senderId: req.user._id,
            },
          })
        )
      );
    }

    return res.status(200).json(populatedPost);
  } catch (err) {
    console.error('Post create error:', err);
    return res.status(500).json({ error: '投稿の作成に失敗しました' });
  }
});

//update a post
router.put("/:id", authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '投稿が見つかりません' });
    if (post.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "自分の投稿のみ更新できます" });
    }
    // ホワイトリスト方式で更新
    const allowedFields = ['desc', 'img', 'imgs', 'video'];
    const updates = {};

    if (req.body.visibility !== undefined) {
      const postVisibility = normalizePostVisibility(req.body.visibility);
      if (postVisibility === POST_VISIBILITY.CLOSE_FRIENDS) {
        const canPostToCloseFriends = await hasCloseFriends(req.user._id);
        if (!canPostToCloseFriends) {
          return res.status(400).json({ error: '親友リストが空です。先に親友を追加してください' });
        }
      }
      updates.visibility = postVisibility;
    }

    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        updates[key] = key === 'desc' ? censorText(req.body[key]) : req.body[key];
      }
    }
    if (req.body.img !== undefined || req.body.imgs !== undefined) {
      const imgs = normalizeImagePaths(req.body);
      updates.imgs = imgs;
      updates.img = imgs[0] || null;
    }
    await post.updateOne({ $set: updates });
    res.status(200).json({ message: "投稿が更新されました" });
  } catch (err) {
    console.error('Post update error:', err);
    res.status(500).json({ error: '投稿の更新に失敗しました' });
  }
});

//delete a post
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: "投稿が見つかりません" });
    }
    if (post.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "自分の投稿のみ削除できます" });
    }
    await Comment.deleteMany({ postId: post._id });
    await Notification.deleteMany({ post: post._id });
    await post.deleteOne();
    res.status(200).json({ message: "投稿が削除されました" });
  } catch (err) {
    console.error("Delete post error:", err);
    res.status(500).json({ error: '投稿の削除に失敗しました' });
  }
});

//like/dislike a post
router.put("/:id/like", authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '投稿が見つかりません' });

    const viewerContext = await buildViewerVisibilityContext(req.user._id);
    if (!canViewerSeePost(post, viewerContext)) {
      return res.status(403).json({ error: 'この投稿を見る権限がありません' });
    }

    const userId = req.user._id.toString();
    //まだ投稿にいいねが押されていなかったら
    if (!post.likes.includes(userId)) {
      await post.updateOne({ $push: { likes: userId } });

      // いいねランキング用（日本時間0:00区切りの日付キー）をRedisで更新
      try {
        const today = getTodayDate();
        await redisClient.zIncrBy(`likeRanking:${today}`, 1, post._id.toString());
        await redisClient.expire(`likeRanking:${today}`, 60 * 60 * 24 * 14);
      } catch (redisErr) {
        console.error("Redis like ranking incr error:", redisErr);
      }

      // 通知作成 & 送信 (自分の投稿以外)
      if (post.userId.toString() !== userId) {
        const receiverUser = await User.findById(post.userId).select('notificationPreferences');
        if (!isNotificationEnabled(receiverUser, 'like')) {
          return res.status(200).json({ message: "いいねしました" });
        }

        const notification = new Notification({
          sender: userId,
          receiver: post.userId,
          type: "like",
          post: post._id,
        });
        const savedNotification = await notification.save();

        // Redis sync
        try {
          // Fetch sender details to store in Redis as well (to avoid multiple lookups during retrieval)
          const sender = await User.findById(userId);
          const notificationData = {
            _id: savedNotification._id,
            sender: {
              _id: sender._id,
              username: sender.username,
              profilePicture: sender.profilePicture
            },
            receiver: post.userId,
            type: "like",
            post: post._id,
            createdAt: savedNotification.createdAt,
            isRead: false
          };
          await redisClient.lPush(`notifications:${post.userId}`, JSON.stringify(notificationData));
          await redisClient.lTrim(`notifications:${post.userId}`, 0, 49); // Keep only last 50
        } catch (redisErr) {
          console.error("Redis notification sync error (like):", redisErr);
        }

        const io = req.app.get('io');
        const sender = await User.findById(userId);

        io.to(post.userId.toString()).emit("getNotification", {
          senderId: userId,
          senderName: sender.username,
          type: "like",
          postId: post._id,
        });

        sendPushToUser({
          receiverId: post.userId,
          title: '新しいいいね',
          body: `${sender.username} さんがあなたの投稿にいいねしました`,
          data: {
            type: 'like',
            postId: post._id,
            senderId: userId,
          },
        }).catch((pushErr) => {
          console.error('FCM notify error (like):', pushErr);
        });
      }

      res.status(200).json({ message: "いいねしました" });
      //すでにいいねが押されていたら
    } else {
      //いいねしているユーザーを取り除く
      await post.updateOne({ $pull: { likes: userId } });
      // ランキングも可能であればデクリメント（ベストエフォート）
      try {
        const today = getTodayDate();
        await redisClient.zIncrBy(`likeRanking:${today}`, -1, post._id.toString());
      } catch (redisErr) {
        console.error("Redis like ranking decr error:", redisErr);
      }
      res.status(200).json({ message: "いいねを取り消しました" });
    }
  } catch (err) {
    console.error('Like error:', err);
    res.status(500).json({ error: 'いいね処理に失敗しました' });
  }
});

// repost/unrepost a post
router.put("/:id/repost", authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '投稿が見つかりません' });

    const viewerContext = await buildViewerVisibilityContext(req.user._id);
    if (!canViewerSeePost(post, viewerContext)) {
      return res.status(403).json({ error: 'この投稿を見る権限がありません' });
    }

    const userId = req.user._id.toString();
    const reposts = Array.isArray(post.reposts) ? post.reposts.map((id) => id.toString()) : [];
    const hasReposted = reposts.includes(userId);

    if (!hasReposted) {
      await post.updateOne({ $addToSet: { reposts: userId } });

      if (post.userId.toString() !== userId) {
        const receiverUser = await User.findById(post.userId).select('notificationPreferences');
        if (isNotificationEnabled(receiverUser, 'repost')) {
          const notification = new Notification({
            sender: userId,
            receiver: post.userId,
            type: 'repost',
            post: post._id,
          });
          const savedNotification = await notification.save();

          try {
            const sender = await User.findById(userId).select('username profilePicture');
            const notificationData = {
              _id: savedNotification._id,
              sender: {
                _id: sender._id,
                username: sender.username,
                profilePicture: sender.profilePicture,
              },
              receiver: post.userId,
              type: 'repost',
              post: post._id,
              createdAt: savedNotification.createdAt,
              isRead: false,
            };
            await redisClient.lPush(`notifications:${post.userId}`, JSON.stringify(notificationData));
            await redisClient.lTrim(`notifications:${post.userId}`, 0, 49);
          } catch (redisErr) {
            console.error('Redis notification sync error (repost):', redisErr);
          }

          const io = req.app.get('io');
          const sender = await User.findById(userId).select('username');
          io.to(post.userId.toString()).emit('getNotification', {
            senderId: userId,
            senderName: sender?.username || 'ユーザー',
            type: 'repost',
            postId: post._id,
          });

          sendPushToUser({
            receiverId: post.userId,
            title: '新しい推し',
            body: `${sender?.username || 'ユーザー'} さんがあなたの投稿を推しました`,
            data: {
              type: 'repost',
              postId: post._id,
              senderId: userId,
            },
          }).catch((pushErr) => {
            console.error('FCM notify error (repost):', pushErr);
          });
        }
      }

      return res.status(200).json({
        message: '推しました',
        reposted: true,
      });
    }

    await post.updateOne({ $pull: { reposts: userId } });
    return res.status(200).json({
      message: '推しを解除しました',
      reposted: false,
    });
  } catch (err) {
    console.error('Repost error:', err);
    res.status(500).json({ error: '推す処理に失敗しました' });
  }
});

// track unique post views
router.put('/:id/view', authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: '投稿が見つかりません' });

    const viewerContext = await buildViewerVisibilityContext(req.user._id);
    if (!canViewerSeePost(post, viewerContext)) {
      return res.status(403).json({ error: 'この投稿を見る権限がありません' });
    }

    const viewerId = req.user._id.toString();
    const viewedBy = Array.isArray(post.viewedBy) ? post.viewedBy.map((id) => id.toString()) : [];
    if (!viewedBy.includes(viewerId)) {
      await post.updateOne({
        $addToSet: { viewedBy: viewerId },
        $inc: { viewCount: 1 },
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('View tracking error:', err);
    return res.status(500).json({ error: '閲覧数の更新に失敗しました' });
  }
});



// //get all post of the user
// router.get("/profile/:username", async (req, res) => {
//   try {
//     const user = await User.findOne({ username: req.params.username });
//     const posts = await Post.find({ userId: user._id });
//     return res.status(200).json(posts);
//   } catch (err) {
//     return res.json(500).json(err);
//   }
// });

// 全ユーザーの投稿（グローバルタイムライン）
router.get("/timeline/all", optionalAuthenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const skip = (page - 1) * limit;
    const viewerContext = await buildViewerVisibilityContext(req.user?._id);
    const visibilityFilter = buildVisibilityQueryForViewer(viewerContext);

    const allPosts = await Post.aggregate([
      { $match: visibilityFilter },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userInfo"
        }
      },
      { $unwind: "$userInfo" },
      {
        $project: {
          desc: 1,
          img: 1,
          imgs: 1,
          video: 1,
          likes: 1,
          reposts: 1,
          viewCount: 1,
          comment: 1,
          visibility: 1,
          isClassroom: 1,
          createdAt: 1,
          updatedAt: 1,
          userId: {
            _id: "$userInfo._id",
            username: "$userInfo.username",
            profilePicture: "$userInfo.profilePicture"
          }
        }
      }
    ]);
    return res.status(200).json(allPosts);
  } catch (err) {
    console.error("Error in /timeline/all:", err);
    return res.status(500).json({ error: 'タイムラインの取得に失敗しました' });
  }
});

//get only profile timeline posts
router.get("/profile/:username", optionalAuthenticate, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) {
      return res.status(404).json("User not found");
    }
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const skip = (page - 1) * limit;
    const viewerContext = await buildViewerVisibilityContext(req.user?._id);
    const visibilityFilter = buildVisibilityQueryForViewer(viewerContext);

    const posts = await Post.find({ userId: user._id, ...visibilityFilter })
      .populate("userId", "username profilePicture")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json(posts);
  } catch (err) {
    console.error("Error in /profile/:username:", err);
    return res.status(500).json({ error: 'プロフィール投稿の取得に失敗しました' });
  }
});

// //get timeline posts
// router.get("/timeline/user/:userId", async (req, res) => {
//   try {
//     const currentUser = await User.findById(req.params.userId);
//     const userPosts = await Post.find({ userId: currentUser._id });
//     //自分がフォローしている人の投稿を全て取得
//     const friendPosts = await Promise.all(
//       currentUser.followings.map((friendId) => {
//         return Post.find({ userId: friendId });
//       })
//     );
//     return res.status(200).json(userPosts.concat(...friendPosts));
//   } catch (err) {
//     return res.status(500).json(err);
//   }
// });

// router.get("/", (req, res) => {
//   console.log("post page");
// });

router.get('/search', optionalAuthenticate, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.status(400).json({ message: "検索ワードが必要です" });

    // Sanitize query for regex
    const sanitizedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const viewerContext = await buildViewerVisibilityContext(req.user?._id);
    const visibilityFilter = buildVisibilityQueryForViewer(viewerContext);

    const posts = await Post.find({
      ...visibilityFilter,
      desc: { $regex: sanitizedQuery, $options: 'i' }
    })
      .populate('userId', 'username profilePicture')
      .sort({ createdAt: -1 })
      .limit(20);

    res.json(posts);
  } catch (err) {
    console.error("Post search error:", err);
    res.status(500).json({ error: '検索に失敗しました' });
  }
});

// いいねランキング（本日）を取得
// 日本時間 0:00〜24:00 を1日として当日分を表示
router.get("/like-ranking", optionalAuthenticate, async (req, res) => {
  try {
    const viewerContext = await buildViewerVisibilityContext(req.user?._id);
    const { dateKey, startUtc, endUtc } = getTodayRangeUtc();
    const key = `likeRanking:${dateKey}`;
    const nowUtc = new Date();
    const rangeEndUtc = nowUtc < endUtc ? nowUtc : endUtc;

    // 1. Redis の ZSET から取得
    try {
      const redisRanking = await redisClient.zRevRangeWithScores(key, 0, 49);
      const normalizedRedisRanking = (redisRanking || [])
        .map((item) => ({
          postId: item?.value,
          count: Math.max(0, Math.floor(Number(item?.score || 0))),
        }))
        .filter((item) => item.postId && item.count > 0)
        .slice(0, 10);

      if (normalizedRedisRanking.length > 0) {
        const posts = await Promise.all(
          normalizedRedisRanking.map(async (item) => {
            const post = await Post.findById(item.postId).populate(
              "userId",
              "username profilePicture"
            );
            if (!canViewerSeePost(post, viewerContext)) {
              return null;
            }
            return post
              ? {
                  postId: post._id,
                  rank: 0,
                  count: item.count,
                  currentLikeCount: Array.isArray(post.likes) ? post.likes.length : 0,
                  desc: post.desc,
                  img: post.img,
                      imgs: post.imgs,
                  user: post.userId,
                }
              : null;
          })
        );

        const filtered = posts.filter(Boolean).map((p, index) => ({
          ...p,
          rank: index + 1,
        }));

        if (filtered.length > 0) {
          return res.status(200).json(filtered);
        }
      }
    } catch (redisErr) {
      console.error("Redis fetch error (like ranking):", redisErr);
    }

    // 2. Redisに無ければMongoDB(Notification)から同じ期間で集計してRedisへシード
    const agg = await Notification.aggregate([
      {
        $match: {
          type: "like",
          createdAt: { $gte: startUtc, $lt: rangeEndUtc },
          post: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$post",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    if (agg.length === 0) {
      return res.status(200).json([]);
    }

    // 対応する投稿情報を取得
    const postsMap = {};
    const posts = await Post.find({ _id: { $in: agg.map((a) => a._id) } }).populate(
      "userId",
      "username profilePicture"
    );
    posts.forEach((p) => {
      postsMap[p._id.toString()] = p;
    });

    const ranking = agg
      .map((item, index) => {
        const post = postsMap[item._id.toString()];
        if (!post) return null;
        if (!canViewerSeePost(post, viewerContext)) return null;
        return {
          postId: post._id,
          rank: index + 1,
          count: item.count,
          currentLikeCount: Array.isArray(post.likes) ? post.likes.length : 0,
          desc: post.desc,
          img: post.img,
          imgs: post.imgs,
          user: post.userId,
        };
      })
      .filter(Boolean);

    // Redis にシード
    try {
      const pipeline = redisClient.multi();
      pipeline.del(key);
      ranking.forEach((r) => {
        pipeline.zAdd(key, { score: r.count, value: r.postId.toString() });
      });
      pipeline.expire(key, 60 * 60 * 24 * 14);
      await pipeline.exec();
    } catch (seedErr) {
      console.error("Redis seed error (like ranking):", seedErr);
    }

    return res.status(200).json(ranking);
  } catch (err) {
    console.error("Error in /like-ranking:", err);
    return res.status(500).json({ error: 'ランキングの取得に失敗しました' });
  }
});

// creator analytics for own posts
router.get('/analytics/me', authenticate, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const posts = await Post.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('desc img imgs createdAt likes comment reposts viewCount');

    const metrics = posts.map((post) => {
      const likeCount = Array.isArray(post.likes) ? post.likes.length : 0;
      const repostCount = Array.isArray(post.reposts) ? post.reposts.length : 0;
      return {
        postId: post._id,
        desc: post.desc,
        img: post.img,
        imgs: post.imgs || [],
        createdAt: post.createdAt,
        likeCount,
        commentCount: Number(post.comment || 0),
        repostCount,
        viewCount: Number(post.viewCount || 0),
      };
    });

    const summary = metrics.reduce(
      (acc, item) => {
        acc.totalLikes += item.likeCount;
        acc.totalComments += item.commentCount;
        acc.totalReposts += item.repostCount;
        acc.totalViews += item.viewCount;
        return acc;
      },
      { totalLikes: 0, totalComments: 0, totalReposts: 0, totalViews: 0 }
    );

    return res.status(200).json({
      summary,
      posts: metrics,
    });
  } catch (err) {
    console.error('Creator analytics error:', err);
    return res.status(500).json({ error: 'クリエイター分析の取得に失敗しました' });
  }
});

//get a post
router.get("/:id", optionalAuthenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('userId', 'username profilePicture');
    if (!post) return res.status(404).json({ error: '投稿が見つかりません' });

    const viewerContext = await buildViewerVisibilityContext(req.user?._id);
    if (!canViewerSeePost(post, viewerContext)) {
      return res.status(404).json({ error: '投稿が見つかりません' });
    }

    res.status(200).json(post);
  } catch (err) {
    console.error('Get post error:', err);
    res.status(500).json({ error: '投稿の取得に失敗しました' });
  }
});

//コメントを作成する
router.post("/:id/comment", authenticate, async (req, res) => {
  try {
    const filteredCommentDesc = censorText(req.body.desc);

    if (!req.body.desc || req.body.desc.trim().length === 0) {
      return res.status(400).json({ error: 'コメント内容は必須です' });
    }
    if (req.body.desc.length > 500) {
      return res.status(400).json({ error: 'コメントは500文字以内です' });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: '投稿が見つかりません' });
    }

    const viewerContext = await buildViewerVisibilityContext(req.user._id);
    if (!canViewerSeePost(post, viewerContext)) {
      return res.status(403).json({ error: 'この投稿を見る権限がありません' });
    }

    const userId = req.user._id;
    // コメントを作成
    const newComment = new Comment({
      postId: req.params.id,
      userId: userId,
      desc: filteredCommentDesc,
      img: req.body.img,
    });
    const savedComment = await newComment.save();

    // 該当する投稿のコメント数をインクリメント
    await Post.findByIdAndUpdate(req.params.id, {
      $inc: { comment: 1 },
    });

    // 通知作成 & 送信 (自分の投稿以外)
    if (post.userId.toString() !== userId.toString()) {
      const receiverUser = await User.findById(post.userId).select('notificationPreferences');
      if (!isNotificationEnabled(receiverUser, 'comment')) {
        return res.status(200).json(savedComment);
      }

      const notification = new Notification({
        sender: userId,
        receiver: post.userId,
        type: "comment",
        post: post._id,
      });
      const savedNotification = await notification.save();

      // Redis sync
      try {
        const sender = await User.findById(userId);
        const notificationData = {
          _id: savedNotification._id,
          sender: {
            _id: sender._id,
            username: sender.username,
            profilePicture: sender.profilePicture
          },
          receiver: post.userId,
          type: "comment",
          post: post._id,
          createdAt: savedNotification.createdAt,
          isRead: false
        };
        await redisClient.lPush(`notifications:${post.userId}`, JSON.stringify(notificationData));
        await redisClient.lTrim(`notifications:${post.userId}`, 0, 49);
      } catch (redisErr) {
        console.error("Redis notification sync error (comment):", redisErr);
      }

      const io = req.app.get('io');
      const sender = await User.findById(userId);

      io.to(post.userId.toString()).emit("getNotification", {
        senderId: userId,
        senderName: sender.username,
        type: "comment",
        postId: post._id,
      });

      sendPushToUser({
        receiverId: post.userId,
        title: '新しいコメント',
        body: `${sender.username} さんがあなたの投稿にコメントしました`,
        data: {
          type: 'comment',
          postId: post._id,
          senderId: userId,
        },
      }).catch((pushErr) => {
        console.error('FCM notify error (comment):', pushErr);
      });
    }

    return res.status(200).json(savedComment);
  } catch (err) {
    console.error('Comment create error:', err);
    return res.status(500).json({ error: 'コメントの作成に失敗しました' });
  }
});

//コメントを取得する
router.get("/:id/comments", optionalAuthenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: '投稿が見つかりません' });
    }

    const viewerContext = await buildViewerVisibilityContext(req.user?._id);
    if (!canViewerSeePost(post, viewerContext)) {
      return res.status(403).json({ error: 'この投稿を見る権限がありません' });
    }

    const comments = await Comment.find({ postId: req.params.id })
      .populate("userId", "username profilePicture")
      .sort({ createdAt: -1 });
    res.status(200).json(comments);
  } catch (err) {
    console.error('Get comments error:', err);
    res.status(500).json({ error: 'コメントの取得に失敗しました' });
  }
});

// コメントを削除する
router.delete("/:id/comment/:commentId", authenticate, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment || comment.postId.toString() !== req.params.id) {
      return res.status(404).json({ error: "コメントが見つかりません" });
    }

    // 削除権限の確認: コメント投稿者のみ
    if (comment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "自分のコメントのみ削除できます" });
    }
    await Comment.findByIdAndDelete(req.params.commentId);

    // 該当する投稿のコメント数をデクリメント
    await Post.findByIdAndUpdate(req.params.id, {
      $inc: { comment: -1 },
    });

    res.status(200).json({ message: "コメントが削除されました" });
  } catch (err) {
    console.error("Delete comment error:", err);
    res.status(500).json({ error: 'コメントの削除に失敗しました' });
  }
});


module.exports = router;

