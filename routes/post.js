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
const { callGroqChatCompletion } = require("../utils/groqClient");
const { isAiServiceEnabled } = require("../utils/aiServiceControl");
const { shouldTriggerYappyReply } = require("../utils/yappyTrigger");
const {
  REPORT_TARGET_TYPES,
  normalizeReportReason,
  normalizeReportDetails,
  normalizeSafetyActions,
  createModerationReport,
  applyReporterSafetyActions,
  countReportsForTarget,
  syncTargetModerationState,
} = require("../utils/moderation");
const {
  POST_VISIBILITY,
  normalizePostVisibility,
  buildViewerVisibilityContext,
  buildVisibilityQueryForViewer,
  canViewerSeePost,
} = require("../utils/postVisibility");

const ACTIVE_CONTENT_STATUS = { $ne: "hidden_by_reports" };
const DEFAULT_YAPPY_DISABLED_REPLY = "いまAIサービスが停止中なので、少し時間を置いてからもう一度 #Yappy で呼んでね。";
const DEFAULT_YAPPY_ERROR_REPLY = "返信の作成に失敗したよ。少し時間を置いてからもう一度 #Yappy で呼んでね。";
const YAPPY_COMMENT_CONTEXT_MAX_ITEMS = 40;
const YAPPY_CONTEXT_TEXT_MAX_LENGTH = 220;

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

const isHiddenByModeration = (doc) => doc?.moderationStatus === 'hidden_by_reports';

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeContextText = (value) => (
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, YAPPY_CONTEXT_TEXT_MAX_LENGTH)
);

const buildCommentTimelineContext = async ({ postId, sourceCommentId }) => {
  const comments = await Comment.find({
    postId,
    moderationStatus: ACTIVE_CONTENT_STATUS,
  })
    .select('userId desc createdAt')
    .populate('userId', 'username')
    .sort({ createdAt: 1, _id: 1 });

  if (!Array.isArray(comments) || comments.length === 0) {
    return {
      timelineText: '（このコメントが最初のコメントです）',
      totalItems: 0,
      omittedItems: 0,
    };
  }

  const sourceCommentIdString = String(sourceCommentId || '');
  const sourceIndex = comments.findIndex((comment) => String(comment._id) === sourceCommentIdString);
  const visibleComments = sourceIndex >= 0 ? comments.slice(0, sourceIndex + 1) : comments;

  const omittedItems = Math.max(0, visibleComments.length - YAPPY_COMMENT_CONTEXT_MAX_ITEMS);
  const recentComments = omittedItems > 0
    ? visibleComments.slice(-YAPPY_COMMENT_CONTEXT_MAX_ITEMS)
    : visibleComments;

  const timelineText = recentComments
    .map((comment, index) => {
      const relativeIndex = omittedItems + index + 1;
      const username = comment?.userId?.username || 'ユーザー';
      const text = normalizeContextText(comment?.desc) || '(本文なし)';
      return `${relativeIndex}. ${username}: ${text}`;
    })
    .join('\n');

  return {
    timelineText: timelineText || '（コメント本文なし）',
    totalItems: visibleComments.length,
    omittedItems,
  };
};

const resolveYappyBotUser = async () => {
  const configuredBotId = String(process.env.YAPPY_BOT_USER_ID || '').trim();
  if (configuredBotId) {
    const byId = await User.findById(configuredBotId).select('_id username profilePicture');
    if (byId) return byId;
    console.warn('[yappy] YAPPY_BOT_USER_ID is set but no user was found');
  }

  const configuredBotUsername = String(process.env.YAPPY_BOT_USERNAME || 'Yappy').trim();
  if (!configuredBotUsername) return null;

  const usernamePattern = new RegExp(`^${escapeRegExp(configuredBotUsername)}$`, 'i');
  return User.findOne({ username: usernamePattern }).select('_id username profilePicture');
};

const buildYappyReplyText = async ({ postAuthorUsername, postText }) => {
  if (!isAiServiceEnabled()) {
    return DEFAULT_YAPPY_DISABLED_REPLY;
  }

  try {
    const completion = await callGroqChatCompletion({
      messages: [
        {
          role: 'system',
          content: 'あなたはYappyというSNSアシスタントです。友好的で短く、投稿内容に沿った返信を日本語で1-3文で返してください。危険・違法行為は助長せず安全に回答してください。',
        },
        {
          role: 'user',
          content: [
            '#Yappyで呼ばれました。次の投稿へ自然に返信してください。',
            `投稿者: ${String(postAuthorUsername || 'ユーザー')}`,
            `投稿本文: ${String(postText || '').trim() || '(本文なし)'}`,
          ].join('\n'),
        },
      ],
      temperature: 0.4,
      maxTokens: 220,
    });

    const reply = String(completion?.content || '').trim();
    if (!reply) {
      return DEFAULT_YAPPY_ERROR_REPLY;
    }
    return reply.slice(0, 500);
  } catch (err) {
    console.error('[yappy] Groq reply generation failed:', err);
    return DEFAULT_YAPPY_ERROR_REPLY;
  }
};

const buildYappyReplyToCommentText = async ({
  postAuthorUsername,
  postText,
  commentAuthorUsername,
  commentText,
  commentTimelineText,
  totalComments,
  omittedComments,
}) => {
  if (!isAiServiceEnabled()) {
    return DEFAULT_YAPPY_DISABLED_REPLY;
  }

  try {
    const completion = await callGroqChatCompletion({
      messages: [
        {
          role: 'system',
          content: 'あなたはYappyというSNSアシスタントです。コメントへの返信として、やさしく簡潔に日本語で1-3文で回答してください。危険・違法行為は助長せず安全に回答してください。',
        },
        {
          role: 'user',
          content: [
            '#Yappyでコメントから呼ばれました。投稿から現在コメントまでの流れを理解して返信してください。',
            `投稿者: ${String(postAuthorUsername || 'ユーザー')}`,
            `投稿本文: ${String(postText || '').trim() || '(本文なし)'}`,
            `ここまでのコメント数: ${Number(totalComments || 0)}`,
            omittedComments > 0 ? `文脈圧縮: 先頭${omittedComments}件は省略し、直近${YAPPY_COMMENT_CONTEXT_MAX_ITEMS}件を提示` : '文脈圧縮: 省略なし',
            'コメント時系列:',
            String(commentTimelineText || '（コメントなし）'),
            `コメント投稿者: ${String(commentAuthorUsername || 'ユーザー')}`,
            `コメント本文: ${String(commentText || '').trim() || '(本文なし)'}`,
            '上記の流れに沿って、コメント投稿者に向けて自然に1-3文で返信してください。',
          ].join('\n'),
        },
      ],
      temperature: 0.4,
      maxTokens: 220,
    });

    const reply = String(completion?.content || '').trim();
    if (!reply) {
      return DEFAULT_YAPPY_ERROR_REPLY;
    }
    return reply.slice(0, 500);
  } catch (err) {
    console.error('[yappy] Groq comment reply generation failed:', err);
    return DEFAULT_YAPPY_ERROR_REPLY;
  }
};

const postYappyAutoReply = async ({ post, postText, postAuthorUsername, app }) => {
  if (!shouldTriggerYappyReply(postText)) {
    return;
  }

  const yappyUser = await resolveYappyBotUser();
  if (!yappyUser) {
    console.warn('[yappy] bot user is not configured. Set YAPPY_BOT_USER_ID or YAPPY_BOT_USERNAME.');
    return;
  }

  const rawReply = await buildYappyReplyText({
    postAuthorUsername,
    postText,
  });
  const filteredReply = censorText(String(rawReply || '')).trim().slice(0, 500);
  const finalReply = filteredReply || DEFAULT_YAPPY_ERROR_REPLY;

  const newComment = new Comment({
    postId: post._id,
    userId: yappyUser._id,
    desc: finalReply,
  });
  await newComment.save();

  await Post.findByIdAndUpdate(post._id, {
    $inc: { comment: 1 },
  });

  if (post.userId.toString() === yappyUser._id.toString()) {
    return;
  }

  const receiverUser = await User.findById(post.userId).select('notificationPreferences');
  if (!isNotificationEnabled(receiverUser, 'comment')) {
    return;
  }

  const notification = new Notification({
    sender: yappyUser._id,
    receiver: post.userId,
    type: 'comment',
    post: post._id,
  });
  const savedNotification = await notification.save();

  try {
    const notificationData = {
      _id: savedNotification._id,
      sender: {
        _id: yappyUser._id,
        username: yappyUser.username,
        profilePicture: yappyUser.profilePicture,
      },
      receiver: post.userId,
      type: 'comment',
      post: post._id,
      createdAt: savedNotification.createdAt,
      isRead: false,
    };
    await redisClient.lPush(`notifications:${post.userId}`, JSON.stringify(notificationData));
    await redisClient.lTrim(`notifications:${post.userId}`, 0, 49);
  } catch (redisErr) {
    console.error('[yappy] Redis notification sync error:', redisErr);
  }

  const io = app.get('io');
  io.to(post.userId.toString()).emit('getNotification', {
    senderId: yappyUser._id,
    senderName: yappyUser.username || 'Yappy',
    type: 'comment',
    postId: post._id,
  });

  sendPushToUser({
    receiverId: post.userId,
    title: 'Yappyから返信',
    body: `${yappyUser.username || 'Yappy'} さんがあなたの投稿に返信しました`,
    data: {
      type: 'comment',
      postId: post._id,
      senderId: yappyUser._id,
    },
  }).catch((pushErr) => {
    console.error('[yappy] FCM notify error:', pushErr);
  });
};

const postYappyAutoReplyToComment = async ({
  post,
  sourceComment,
  sourceCommentText,
  sourceCommentAuthorUsername,
  app,
}) => {
  if (!shouldTriggerYappyReply(sourceCommentText)) {
    return;
  }

  const yappyUser = await resolveYappyBotUser();
  if (!yappyUser) {
    console.warn('[yappy] bot user is not configured. Set YAPPY_BOT_USER_ID or YAPPY_BOT_USERNAME.');
    return;
  }

  const sourceCommentAuthorId = sourceComment?.userId?.toString?.() || String(sourceComment?.userId || '');
  if (!sourceCommentAuthorId) return;
  if (sourceCommentAuthorId === yappyUser._id.toString()) {
    return;
  }

  const postAuthor = await User.findById(post.userId).select('username');
  const timelineContext = await buildCommentTimelineContext({
    postId: post._id,
    sourceCommentId: sourceComment?._id,
  });

  const rawReply = await buildYappyReplyToCommentText({
    postAuthorUsername: postAuthor?.username,
    postText: post?.desc,
    commentAuthorUsername: sourceCommentAuthorUsername,
    commentText: sourceCommentText,
    commentTimelineText: timelineContext.timelineText,
    totalComments: timelineContext.totalItems,
    omittedComments: timelineContext.omittedItems,
  });

  const mention = sourceCommentAuthorUsername ? `@${sourceCommentAuthorUsername} ` : '';
  const filteredReply = censorText(String(rawReply || '')).trim();
  const baseReply = filteredReply || DEFAULT_YAPPY_ERROR_REPLY;
  const finalReply = `${mention}${baseReply}`.trim().slice(0, 500);

  const newComment = new Comment({
    postId: post._id,
    userId: yappyUser._id,
    desc: finalReply,
  });
  await newComment.save();

  await Post.findByIdAndUpdate(post._id, {
    $inc: { comment: 1 },
  });

  const receiverUser = await User.findById(sourceCommentAuthorId).select('notificationPreferences');
  if (!isNotificationEnabled(receiverUser, 'comment')) {
    return;
  }

  const notification = new Notification({
    sender: yappyUser._id,
    receiver: sourceCommentAuthorId,
    type: 'comment',
    post: post._id,
  });
  const savedNotification = await notification.save();

  try {
    const notificationData = {
      _id: savedNotification._id,
      sender: {
        _id: yappyUser._id,
        username: yappyUser.username,
        profilePicture: yappyUser.profilePicture,
      },
      receiver: sourceCommentAuthorId,
      type: 'comment',
      post: post._id,
      createdAt: savedNotification.createdAt,
      isRead: false,
    };
    await redisClient.lPush(`notifications:${sourceCommentAuthorId}`, JSON.stringify(notificationData));
    await redisClient.lTrim(`notifications:${sourceCommentAuthorId}`, 0, 49);
  } catch (redisErr) {
    console.error('[yappy] Redis notification sync error (comment reply):', redisErr);
  }

  const io = app.get('io');
  io.to(sourceCommentAuthorId).emit('getNotification', {
    senderId: yappyUser._id,
    senderName: yappyUser.username || 'Yappy',
    type: 'comment',
    postId: post._id,
  });

  sendPushToUser({
    receiverId: sourceCommentAuthorId,
    title: 'Yappyから返信',
    body: `${yappyUser.username || 'Yappy'} さんがあなたのコメントに返信しました`,
    data: {
      type: 'comment',
      postId: post._id,
      senderId: yappyUser._id,
    },
  }).catch((pushErr) => {
    console.error('[yappy] FCM notify error (comment reply):', pushErr);
  });
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

    void postYappyAutoReply({
      post: savedPost,
      postText: filteredDesc,
      postAuthorUsername: user?.username,
      app: req.app,
    }).catch((yappyErr) => {
      console.error('[yappy] auto reply error:', yappyErr);
    });

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
    if (isHiddenByModeration(post)) {
      return res.status(404).json({ error: '投稿が見つかりません' });
    }

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
    if (isHiddenByModeration(post)) {
      return res.status(404).json({ error: '投稿が見つかりません' });
    }

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
    if (isHiddenByModeration(post)) {
      return res.status(404).json({ error: '投稿が見つかりません' });
    }

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
    const isForYouFeedRequest = String(req.query.feedType || '').toLowerCase() === 'foryou';
    const announcementWindowStart = new Date(Date.now() - (24 * 60 * 60 * 1000));
    const viewerContext = await buildViewerVisibilityContext(req.user?._id);
    const visibilityFilter = buildVisibilityQueryForViewer(viewerContext);
    const postMatchFilter = {
      ...visibilityFilter,
      moderationStatus: ACTIVE_CONTENT_STATUS,
    };

    const userLookupStage = {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "userInfo"
      }
    };
    const userUnwindStage = { $unwind: "$userInfo" };
    const projectStage = {
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
        announcementBoostActive: { $ifNull: ["$announcementBoostActive", false] },
        userId: {
          _id: "$userInfo._id",
          username: "$userInfo.username",
          profilePicture: "$userInfo.profilePicture",
          hasElevatedAccess: { $ifNull: ["$userInfo.hasElevatedAccess", false] }
        }
      }
    };

    const timelinePipeline = [{ $match: postMatchFilter }];

    if (isForYouFeedRequest) {
      timelinePipeline.push(
        userLookupStage,
        userUnwindStage,
        {
          $addFields: {
            announcementBoostActive: {
              $and: [
                { $eq: ["$userInfo.hasElevatedAccess", true] },
                { $gte: ["$createdAt", announcementWindowStart] },
              ],
            },
          },
        },
        { $sort: { announcementBoostActive: -1, createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        projectStage,
      );
    } else {
      timelinePipeline.push(
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        userLookupStage,
        userUnwindStage,
        { $addFields: { announcementBoostActive: false } },
        projectStage,
      );
    }

    const allPosts = await Post.aggregate(timelinePipeline);
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

    const posts = await Post.find({
      userId: user._id,
      moderationStatus: ACTIVE_CONTENT_STATUS,
      ...visibilityFilter,
    })
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
      moderationStatus: ACTIVE_CONTENT_STATUS,
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
            if (isHiddenByModeration(post)) {
              return null;
            }
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
    const posts = await Post.find({
      _id: { $in: agg.map((a) => a._id) },
      moderationStatus: ACTIVE_CONTENT_STATUS,
    }).populate(
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
    if (isHiddenByModeration(post)) {
      return res.status(404).json({ error: '投稿が見つかりません' });
    }

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
    if (isHiddenByModeration(post)) {
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
      if (isNotificationEnabled(receiverUser, 'comment')) {
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
    }

    void postYappyAutoReplyToComment({
      post,
      sourceComment: savedComment,
      sourceCommentText: filteredCommentDesc,
      sourceCommentAuthorUsername: req.user?.username,
      app: req.app,
    }).catch((yappyErr) => {
      console.error('[yappy] auto reply to comment error:', yappyErr);
    });

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
    if (isHiddenByModeration(post)) {
      return res.status(404).json({ error: '投稿が見つかりません' });
    }

    const viewerContext = await buildViewerVisibilityContext(req.user?._id);
    if (!canViewerSeePost(post, viewerContext)) {
      return res.status(403).json({ error: 'この投稿を見る権限がありません' });
    }

    const mutedOwnerIds = Array.from(viewerContext?.mutedOwnerSet || []);
    const commentQuery = {
      postId: req.params.id,
      moderationStatus: ACTIVE_CONTENT_STATUS,
    };
    if (mutedOwnerIds.length > 0) {
      commentQuery.userId = { $nin: mutedOwnerIds };
    }

    const comments = await Comment.find(commentQuery)
      .populate("userId", "username profilePicture")
      .sort({ createdAt: 1 });
    res.status(200).json(comments);
  } catch (err) {
    console.error('Get comments error:', err);
    res.status(500).json({ error: 'コメントの取得に失敗しました' });
  }
});

router.post('/:id/report', authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .select('userId moderationStatus moderationSummary visibility');
    if (!post || isHiddenByModeration(post)) {
      return res.status(404).json({ error: '投稿が見つかりません' });
    }

    const viewerContext = await buildViewerVisibilityContext(req.user._id);
    if (!canViewerSeePost(post, viewerContext)) {
      return res.status(403).json({ error: 'この投稿を通報する権限がありません' });
    }

    const reporterId = req.user._id;
    const targetOwnerId = post.userId;
    if (targetOwnerId.toString() === reporterId.toString()) {
      return res.status(400).json({ error: '自分の投稿は通報できません' });
    }

    const reason = normalizeReportReason(req.body?.reason);
    const details = normalizeReportDetails(req.body?.details);
    const safetyActions = normalizeSafetyActions(req.body?.safetyActions);

    const { duplicate } = await createModerationReport({
      targetType: REPORT_TARGET_TYPES.POST,
      targetId: post._id,
      targetOwnerId,
      reporterId,
      reason,
      details,
      safetyActions,
    });

    if (duplicate) {
      return res.status(409).json({ error: 'この投稿はすでに通報済みです' });
    }

    const appliedSafety = await applyReporterSafetyActions({
      reporterId,
      targetOwnerId,
      safetyActions,
    });

    const reportCount = await countReportsForTarget(REPORT_TARGET_TYPES.POST, post._id);
    const moderationState = await syncTargetModerationState({
      targetDoc: post,
      reportCount,
    });

    return res.status(201).json({
      message: '投稿を通報しました',
      reportCount: moderationState.reportCount,
      hidden: moderationState.hidden,
      threshold: moderationState.threshold,
      appliedSafety,
    });
  } catch (err) {
    console.error('Post report error:', err);
    return res.status(500).json({ error: '投稿の通報に失敗しました' });
  }
});

router.post('/:id/comment/:commentId/report', authenticate, async (req, res) => {
  try {
    const [post, comment] = await Promise.all([
      Post.findById(req.params.id).select('userId moderationStatus moderationSummary visibility comment'),
      Comment.findById(req.params.commentId).select('postId userId moderationStatus moderationSummary'),
    ]);

    if (!post || isHiddenByModeration(post)) {
      return res.status(404).json({ error: '投稿が見つかりません' });
    }
    if (!comment || comment.postId.toString() !== req.params.id || isHiddenByModeration(comment)) {
      return res.status(404).json({ error: 'コメントが見つかりません' });
    }

    const viewerContext = await buildViewerVisibilityContext(req.user._id);
    if (!canViewerSeePost(post, viewerContext)) {
      return res.status(403).json({ error: 'このコメントを通報する権限がありません' });
    }

    const reporterId = req.user._id;
    const targetOwnerId = comment.userId;
    if (targetOwnerId.toString() === reporterId.toString()) {
      return res.status(400).json({ error: '自分のコメントは通報できません' });
    }

    const reason = normalizeReportReason(req.body?.reason);
    const details = normalizeReportDetails(req.body?.details);
    const safetyActions = normalizeSafetyActions(req.body?.safetyActions);

    const { duplicate } = await createModerationReport({
      targetType: REPORT_TARGET_TYPES.COMMENT,
      targetId: comment._id,
      targetOwnerId,
      reporterId,
      reason,
      details,
      safetyActions,
    });

    if (duplicate) {
      return res.status(409).json({ error: 'このコメントはすでに通報済みです' });
    }

    const appliedSafety = await applyReporterSafetyActions({
      reporterId,
      targetOwnerId,
      safetyActions,
    });

    const reportCount = await countReportsForTarget(REPORT_TARGET_TYPES.COMMENT, comment._id);
    const moderationState = await syncTargetModerationState({
      targetDoc: comment,
      reportCount,
    });

    if (moderationState.hiddenNow) {
      await Post.findByIdAndUpdate(post._id, {
        $inc: { comment: -1 },
      });
    }

    return res.status(201).json({
      message: 'コメントを通報しました',
      reportCount: moderationState.reportCount,
      hidden: moderationState.hidden,
      threshold: moderationState.threshold,
      appliedSafety,
    });
  } catch (err) {
    console.error('Comment report error:', err);
    return res.status(500).json({ error: 'コメントの通報に失敗しました' });
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

