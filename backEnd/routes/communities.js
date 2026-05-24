const router = require('express').Router();
const Community = require('../models/Community');
const Post = require('../models/Post');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const passport = require('passport');

const buildSlug = (name) => {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const fallback = base || 'community';
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${fallback}-${suffix}`;
};

router.get('/', async (req, res) => {
  try {
    const communities = await Community.find()
      .populate('ownerId', 'username profilePicture')
      .sort({ createdAt: -1 })
      .limit(50);
    res.status(200).json(communities);
  } catch (err) {
    console.error('Community list error:', err);
    res.status(500).json({ error: 'コミュニティ一覧の取得に失敗しました' });
  }
});

router.post('/', async (req, res) => {
  try {
    const ownerId = req.body.ownerId;
    if (!ownerId) {
      return res.status(400).json({ error: 'ownerId is required' });
    }

    const community = new Community({
      name: req.body.name,
      slug: req.body.slug || buildSlug(req.body.name),
      description: req.body.description || '',
      ownerId,
      members: Array.from(new Set([ownerId, ...(Array.isArray(req.body.members) ? req.body.members : [])])),
      tags: Array.isArray(req.body.tags) ? req.body.tags.slice(0, 8) : [],
      isPrivate: !!req.body.isPrivate,
      allowAnonymousPosts: req.body.allowAnonymousPosts !== false,
    });

    const savedCommunity = await community.save();
    res.status(201).json(savedCommunity);
  } catch (err) {
    console.error('Community create error:', err);
    res.status(500).json({ error: 'コミュニティの作成に失敗しました' });
  }
});

router.get('/mine/:userId', async (req, res) => {
  try {
    const communities = await Community.find({ members: req.params.userId })
      .populate('ownerId', 'username profilePicture')
      .sort({ createdAt: -1 });

    res.status(200).json(communities);
  } catch (err) {
    console.error('Community mine error:', err);
    res.status(500).json({ error: '参加中コミュニティの取得に失敗しました' });
  }
});

router.get('/:communityId', async (req, res) => {
  try {
    const community = await Community.findById(req.params.communityId)
      .populate('ownerId', 'username profilePicture')
      .populate('members', 'username profilePicture');

    if (!community) {
      return res.status(404).json({ error: 'コミュニティが見つかりません' });
    }

    res.status(200).json(community);
  } catch (err) {
    console.error('Community fetch error:', err);
    res.status(500).json({ error: 'コミュニティの取得に失敗しました' });
  }
});

router.post('/:communityId/join', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const community = await Community.findById(req.params.communityId);
    if (!community) {
      return res.status(404).json({ error: 'コミュニティが見つかりません' });
    }

    if (!community.members.some((memberId) => memberId.toString() === userId)) {
      community.members.push(userId);
      await community.save();
    }

    res.status(200).json(community);
  } catch (err) {
    console.error('Community join error:', err);
    res.status(500).json({ error: 'コミュニティ参加に失敗しました' });
  }
});

router.delete('/:communityId/leave', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const community = await Community.findById(req.params.communityId);
    if (!community) {
      return res.status(404).json({ error: 'コミュニティが見つかりません' });
    }

    community.members = community.members.filter((memberId) => memberId.toString() !== userId);
    await community.save();

    res.status(200).json(community);
  } catch (err) {
    console.error('Community leave error:', err);
    res.status(500).json({ error: 'コミュニティ退出に失敗しました' });
  }
});

router.get('/:communityId/posts', async (req, res) => {
  try {
    const posts = await Post.find({ communityId: req.params.communityId })
      .populate('userId', 'username profilePicture')
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json(posts);
  } catch (err) {
    console.error('Community posts error:', err);
    res.status(500).json({ error: 'コミュニティ投稿の取得に失敗しました' });
  }
});

// コミュニティ許可タグの更新（オーナーのみ）
router.put('/:communityId/tags', async (req, res) => {
  try {
    const { tags } = req.body;
    const community = await Community.findById(req.params.communityId);
    if (!community) return res.status(404).json({ error: 'コミュニティが見つかりません' });

    // オーナー確認
    const requesterId = req.body.requesterId;
    if (!requesterId || community.ownerId.toString() !== String(requesterId)) {
      return res.status(403).json({ error: 'オーナーのみタグを更新できます' });
    }

    // normalize tags: simple dedupe & lowercase
    const normalized = Array.isArray(tags) ? Array.from(new Set(tags.map((t) => String(t || '').trim()).filter(Boolean))).slice(0, 24) : [];
    community.tags = normalized;
    await community.save();

    res.status(200).json({ tags: community.tags });
  } catch (err) {
    console.error('Update community tags error:', err);
    res.status(500).json({ error: 'タグの更新に失敗しました' });
  }
});

// コミュニティ情報の更新（オーナーのみ）
router.put('/:communityId', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const community = await Community.findById(req.params.communityId);
    if (!community) return res.status(404).json({ error: 'コミュニティが見つかりません' });

    const requesterId = req.user._id.toString();
    if (community.ownerId.toString() !== requesterId) {
      return res.status(403).json({ error: 'オーナーのみ更新できます' });
    }

    const allowed = ['name', 'description', 'tags', 'isPrivate', 'allowAnonymousPosts', 'tagFilter'];
    allowed.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        community[k] = req.body[k];
      }
    });

    // normalize tags
    if (Array.isArray(community.tags)) {
      community.tags = Array.from(new Set(community.tags.map((t) => String(t || '').trim()).filter(Boolean))).slice(0, 24);
    }

    await community.save();
    return res.status(200).json(community);
  } catch (err) {
    console.error('Community update error:', err);
    return res.status(500).json({ error: 'コミュニティの更新に失敗しました' });
  }
});

// コミュニティ専用チャットを作成（参加希望制：初期メンバーはオーナーのみ）
router.post('/:communityId/createConversation', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const community = await Community.findById(req.params.communityId);
    if (!community) return res.status(404).json({ error: 'コミュニティが見つかりません' });

    // 既にコミュニティ用の会話があるか確認
    const existing = await Conversation.findOne({ communityId: community._id });
    if (existing) return res.status(200).json(existing);

    // 初期メンバーはオーナーのみ（参加はユーザー側が明示的に join する）
    const ownerId = String(community.ownerId);
    const unreadMap = new Map();
    unreadMap.set(ownerId, 0);

    const conv = new Conversation({
      members: [ownerId],
      unreadCount: unreadMap,
      communityId: community._id,
    });

    const saved = await conv.save();
    const populated = await Conversation.findById(saved._id).populate('members', 'username profilePicture');
    return res.status(201).json(populated);
  } catch (err) {
    console.error('Community createConversation error:', err);
    return res.status(500).json({ error: 'コミュニティ会話の作成に失敗しました' });
  }
});

// ユーザーがコミュニティ会話に参加（参加希望制）
router.post('/:communityId/conversation/join', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const community = await Community.findById(req.params.communityId);
    if (!community) return res.status(404).json({ error: 'コミュニティが見つかりません' });

    // 対象会話を取得（なければ作成しても良い）
    let conv = await Conversation.findOne({ communityId: community._id });
    if (!conv) {
      // create conversation with owner only
      const ownerId = String(community.ownerId);
      conv = new Conversation({ members: [ownerId], unreadCount: new Map([[ownerId, 0]]), communityId: community._id });
      await conv.save();
    }

    // 権限チェック: tagFilter がある場合はプロファイルタグを確認
    if (community.tagFilter) {
      const tag = String(community.tagFilter).trim();
      const user = await User.findById(userId).select('profileTags');
      if (!user || !(Array.isArray(user.profileTags) && user.profileTags.includes(tag))) {
        return res.status(403).json({ error: 'このコミュニティの参加条件を満たしていません' });
      }
    } else {
      // tagFilter がない場合、参加は community.members に含まれていることを期待
      if (Array.isArray(community.members) && community.members.length > 0) {
        const memberSet = new Set(community.members.map((m) => String(m)));
        if (!memberSet.has(userId)) {
          return res.status(403).json({ error: 'コミュニティに参加していないため会話に参加できません' });
        }
      }
    }

    // 参加処理
    if (!conv.members.some((m) => String(m) === userId)) {
      conv.members.push(userId);
      conv.unreadCount.set(userId, 0);
      await conv.save();
    }

    const populated = await Conversation.findById(conv._id).populate('members', 'username profilePicture');
    return res.status(200).json(populated);
  } catch (err) {
    console.error('Join community conversation error:', err);
    return res.status(500).json({ error: '会話参加に失敗しました' });
  }
});

// 会話から退会
router.post('/:communityId/conversation/leave', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const conv = await Conversation.findOne({ communityId: req.params.communityId });
    if (!conv) return res.status(404).json({ error: 'コミュニティ会話が見つかりません' });

    conv.members = conv.members.filter((m) => String(m) !== userId);
    conv.unreadCount.delete(userId);
    await conv.save();

    return res.status(200).json({ message: '会話を退会しました' });
  } catch (err) {
    console.error('Leave community conversation error:', err);
    return res.status(500).json({ error: '会話退会に失敗しました' });
  }
});

// コミュニティに紐づく会話を取得
router.get('/:communityId/conversation', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const conv = await Conversation.findOne({ communityId: req.params.communityId })
      .populate('members', 'username profilePicture')
      .populate('lastMessage');

    if (!conv) return res.status(404).json({ error: 'コミュニティ会話が見つかりません' });
    return res.status(200).json(conv);
  } catch (err) {
    console.error('Community conversation fetch error:', err);
    return res.status(500).json({ error: 'コミュニティ会話の取得に失敗しました' });
  }
});

module.exports = router;