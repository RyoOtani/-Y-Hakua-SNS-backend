const router = require('express').Router({ mergeParams: true });
const mongoose = require('mongoose');
const Community = require('../models/Community');
const CommunityTopic = require('../models/CommunityTopic');
const CommunityTopicReply = require('../models/CommunityTopicReply');
const { authenticate } = require('../middleware/auth');
const { censorText } = require('../utils/contentFilter');

const ACTIVE_STATUS = { $ne: 'hidden_by_reports' };

const isMember = (community, userId) => (
  Array.isArray(community?.members)
    && community.members.some((memberId) => memberId.toString() === userId)
);

const maskAuthor = (doc, viewerId, modeField = 'postMode') => {
  const json = doc?.toJSON ? doc.toJSON() : { ...doc };
  const mode = json[modeField];
  if (mode !== 'anonymous') return json;

  const authorId = json.userId?._id?.toString?.() || json.userId?.toString?.() || '';
  const isMine = authorId && viewerId && authorId === viewerId;
  json.userId = {
    _id: isMine ? authorId : null,
    username: json.anonymousLabel || '匿名ユーザー',
    profilePicture: '',
  };
  return json;
};

const ensureMemberAccess = async (communityId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(String(communityId))) {
    return { error: { status: 400, message: '無効なコミュニティIDです' } };
  }

  const community = await Community.findById(communityId).select('members ownerId allowAnonymousPosts');
  if (!community) {
    return { error: { status: 404, message: 'コミュニティが見つかりません' } };
  }

  const isOwner = community.ownerId.toString() === userId;
  if (!isOwner && !isMember(community, userId)) {
    return { error: { status: 403, message: 'コミュニティに参加してください' } };
  }

  return { community };
};

router.get('/', authenticate, async (req, res) => {
  try {
    const communityId = req.params.communityId;
    const userId = req.user._id.toString();
    const access = await ensureMemberAccess(communityId, userId);
    if (access.error) {
      return res.status(access.error.status).json({ error: access.error.message });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 50);
    const topics = await CommunityTopic.find({
      communityId,
      moderationStatus: ACTIVE_STATUS,
    })
      .populate('userId', 'username profilePicture')
      .sort({ lastReplyAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const payload = topics.map((t) => maskAuthor(t, userId));
    return res.status(200).json(payload);
  } catch (err) {
    console.error('Community topics list error:', err);
    return res.status(500).json({ error: '掲示板一覧の取得に失敗しました' });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const communityId = req.params.communityId;
    const userId = req.user._id.toString();
    const access = await ensureMemberAccess(communityId, userId);
    if (access.error) {
      return res.status(access.error.status).json({ error: access.error.message });
    }

    const title = String(req.body?.title || '').trim();
    const body = censorText(String(req.body?.body || '').trim());
    if (!title) {
      return res.status(400).json({ error: 'タイトルは必須です' });
    }

    const rawMode = String(req.body?.postMode || 'community').toLowerCase();
    const postMode = rawMode === 'anonymous' ? 'anonymous' : 'community';
    if (postMode === 'anonymous' && !access.community.allowAnonymousPosts) {
      return res.status(403).json({ error: 'このコミュニティでは匿名投稿が許可されていません' });
    }

    const anonymousLabel = postMode === 'anonymous'
      ? String(req.body?.anonymousLabel || '匿名').trim().slice(0, 20)
      : '';

    const topic = await CommunityTopic.create({
      communityId,
      userId: req.user._id,
      title: title.slice(0, 80),
      body: body.slice(0, 2000),
      postMode,
      anonymousLabel,
      lastReplyAt: new Date(),
    });

    const populated = await CommunityTopic.findById(topic._id)
      .populate('userId', 'username profilePicture');

    return res.status(201).json(maskAuthor(populated, userId));
  } catch (err) {
    console.error('Community topic create error:', err);
    return res.status(500).json({ error: 'トピックの作成に失敗しました' });
  }
});

router.get('/:topicId', authenticate, async (req, res) => {
  try {
    const { communityId, topicId } = req.params;
    const userId = req.user._id.toString();
    const access = await ensureMemberAccess(communityId, userId);
    if (access.error) {
      return res.status(access.error.status).json({ error: access.error.message });
    }

    const topic = await CommunityTopic.findOne({
      _id: topicId,
      communityId,
      moderationStatus: ACTIVE_STATUS,
    }).populate('userId', 'username profilePicture');

    if (!topic) {
      return res.status(404).json({ error: 'トピックが見つかりません' });
    }

    const replyLimit = Math.min(parseInt(req.query.replyLimit, 10) || 50, 100);
    const replies = await CommunityTopicReply.find({
      topicId,
      communityId,
      moderationStatus: ACTIVE_STATUS,
    })
      .populate('userId', 'username profilePicture')
      .sort({ createdAt: 1 })
      .limit(replyLimit)
      .lean();

    return res.status(200).json({
      topic: maskAuthor(topic, userId),
      replies: replies.map((r) => maskAuthor(r, userId)),
    });
  } catch (err) {
    console.error('Community topic detail error:', err);
    return res.status(500).json({ error: 'トピックの取得に失敗しました' });
  }
});

router.post('/:topicId/replies', authenticate, async (req, res) => {
  try {
    const { communityId, topicId } = req.params;
    const userId = req.user._id.toString();
    const access = await ensureMemberAccess(communityId, userId);
    if (access.error) {
      return res.status(access.error.status).json({ error: access.error.message });
    }

    const topic = await CommunityTopic.findOne({
      _id: topicId,
      communityId,
      moderationStatus: ACTIVE_STATUS,
    });
    if (!topic) {
      return res.status(404).json({ error: 'トピックが見つかりません' });
    }

    const body = censorText(String(req.body?.body || '').trim());
    if (!body) {
      return res.status(400).json({ error: '返信本文は必須です' });
    }

    const rawMode = String(req.body?.postMode || 'community').toLowerCase();
    const postMode = rawMode === 'anonymous' ? 'anonymous' : 'community';
    if (postMode === 'anonymous' && !access.community.allowAnonymousPosts) {
      return res.status(403).json({ error: 'このコミュニティでは匿名投稿が許可されていません' });
    }

    const anonymousLabel = postMode === 'anonymous'
      ? String(req.body?.anonymousLabel || '匿名').trim().slice(0, 20)
      : '';

    const reply = await CommunityTopicReply.create({
      topicId,
      communityId,
      userId: req.user._id,
      body: body.slice(0, 1000),
      postMode,
      anonymousLabel,
    });

    topic.replyCount = (topic.replyCount || 0) + 1;
    topic.lastReplyAt = new Date();
    await topic.save();

    const populated = await CommunityTopicReply.findById(reply._id)
      .populate('userId', 'username profilePicture');

    return res.status(201).json(maskAuthor(populated, userId));
  } catch (err) {
    console.error('Community topic reply error:', err);
    return res.status(500).json({ error: '返信の投稿に失敗しました' });
  }
});

module.exports = router;
