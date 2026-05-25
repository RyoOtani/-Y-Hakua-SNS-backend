const router = require('express').Router();
const communityTopicsRouter = require('./communityTopics');
const Community = require('../models/Community');
const Post = require('../models/Post');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { authenticate, requireElevatedAccess } = require('../middleware/auth');
const {
  PROFILE_TAG_CATEGORIES,
  ALL_PROFILE_TAGS,
  isValidProfileTag,
} = require('../constants/profileTags');

const DEFAULT_COMMUNITY_BY_TAG = {
  猫好き: { name: '猫好きの部屋', description: '猫が好きな人がゆるく集まるコミュニティです。' },
  犬好き: { name: '犬好きの部屋', description: '犬が好きな人がゆるく集まるコミュニティです。' },
  プログラミング: { name: 'プログラミング仲間', description: 'コード・開発の話題を共有する場所です。' },
  ゲーム: { name: 'ゲーマー広場', description: 'ゲーム好きが集まるコミュニティです。' },
  'アニメ・漫画': { name: 'アニメ・漫画トーク', description: '作品の感想やおすすめを共有しましょう。' },
  音楽: { name: '音楽好きの集い', description: '好きなアーティストや曲の話題を歓迎します。' },
  勉強: { name: '勉強モチベ部屋', description: '学習の記録や励まし合いをするコミュニティです。' },
};

const normalizeCommunityTagFilter = (tagFilter) => {
  const trimmed = String(tagFilter || '').trim();
  if (!trimmed) return { tagFilter: null };
  if (!isValidProfileTag(trimmed)) {
    return { error: `公式タグから選択してください: ${trimmed}` };
  }
  return { tagFilter: trimmed };
};

const normalizeCommunityTags = (tags, tagFilter) => {
  const filtered = normalizeTagsInput(tags, 24).filter((tag) => isValidProfileTag(tag));
  if (tagFilter && !filtered.includes(tagFilter)) {
    return [tagFilter, ...filtered].slice(0, 24);
  }
  return filtered;
};

const canManageCommunity = (community, user) => (
  Boolean(user?.hasElevatedAccess)
  || community.ownerId.toString() === user._id.toString()
);

const buildPresetSlug = (tagFilter) => (
  `preset-${String(tagFilter)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, '-')}`
);

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

const normalizeTagsInput = (tags, limit = 24) => (
  Array.isArray(tags)
    ? Array.from(new Set(tags.map((t) => String(t || '').trim()).filter(Boolean))).slice(0, limit)
    : []
);

const isMember = (community, userId) => (
  Array.isArray(community?.members)
    && community.members.some((memberId) => memberId.toString() === userId)
);

const hasTagAccess = (userTags = [], tagFilter) => {
  if (!tagFilter) return false;
  return userTags.includes(String(tagFilter));
};

router.get('/', authenticate, async (req, res) => {
  try {
    let query = {};
    if (!req.user.hasElevatedAccess) {
      const user = await User.findById(req.user._id).select('profileTags');
      const userTags = Array.isArray(user?.profileTags) ? user.profileTags.map((t) => String(t)) : [];
      if (userTags.length === 0) {
        return res.status(200).json([]);
      }
      query = {
        $or: [
          { tagFilter: { $in: userTags } },
          { members: req.user._id },
          { ownerId: req.user._id },
        ],
      };
    }

    const userId = req.user._id.toString();
    const communities = await Community.find(query)
      .select('name slug description tagFilter tags members ownerId allowAnonymousPosts createdAt')
      .populate('ownerId', 'username profilePicture')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const payload = communities.map((c) => {
      const memberCount = Array.isArray(c.members) ? c.members.length : 0;
      const member = isMember(c, userId) || String(c.ownerId?._id || c.ownerId) === userId;
      const { members, ...summary } = c;
      return {
        ...summary,
        isMember: member,
        memberCount,
      };
    });

    return res.status(200).json(payload);
  } catch (err) {
    console.error('Community list error:', err);
    return res.status(500).json({ error: 'コミュニティ一覧の取得に失敗しました' });
  }
});

router.post('/', authenticate, requireElevatedAccess, async (req, res) => {
  try {
    const ownerId = req.user._id;
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const parsedTagFilter = normalizeCommunityTagFilter(req.body?.tagFilter);
    if (parsedTagFilter.error) {
      return res.status(400).json({ error: parsedTagFilter.error });
    }
    const tagFilter = parsedTagFilter.tagFilter;
    const normalizedTags = normalizeCommunityTags(req.body?.tags, tagFilter);
    if (tagFilter && normalizedTags.length === 0) {
      return res.status(400).json({ error: '参加条件タグを tags に含めてください' });
    }

    const initialMembers = Array.isArray(req.body?.members)
      ? req.body.members
      : [];
    const members = Array.from(new Set([ownerId.toString(), ...initialMembers.map((m) => m.toString())]));

    const community = new Community({
      name,
      slug: req.body.slug || (tagFilter ? buildPresetSlug(tagFilter) : buildSlug(name)),
      description: req.body.description || '',
      ownerId,
      members,
      tags: normalizedTags.length > 0 ? normalizedTags : (tagFilter ? [tagFilter] : []),
      tagFilter,
      isPrivate: req.body.isPrivate !== false,
      allowAnonymousPosts: req.body.allowAnonymousPosts !== false,
    });

    const savedCommunity = await community.save();
    res.status(201).json(savedCommunity);
  } catch (err) {
    console.error('Community create error:', err);
    res.status(500).json({ error: 'コミュニティの作成に失敗しました' });
  }
});

router.get('/admin/overview', authenticate, requireElevatedAccess, async (req, res) => {
  try {
    const communitiesRaw = await Community.find()
      .select('name slug description tagFilter tags members allowAnonymousPosts isPrivate createdAt ownerId')
      .populate('ownerId', 'username profilePicture')
      .sort({ createdAt: -1 })
      .lean();

    const communities = communitiesRaw.map((c) => {
      const { members, ...rest } = c;
      return {
        ...rest,
        memberCount: Array.isArray(members) ? members.length : 0,
      };
    });

    const byTagFilter = new Map();
    communities.forEach((community) => {
      if (community.tagFilter) {
        byTagFilter.set(String(community.tagFilter), community);
      }
    });

    const tagSlots = ALL_PROFILE_TAGS.map((tag) => ({
      tag,
      community: byTagFilter.get(tag) || null,
    }));

    return res.status(200).json({
      categories: PROFILE_TAG_CATEGORIES,
      allTags: ALL_PROFILE_TAGS,
      communities,
      tagSlots,
    });
  } catch (err) {
    console.error('Community admin overview error:', err);
    return res.status(500).json({ error: '管理者用コミュニティ情報の取得に失敗しました' });
  }
});

router.post('/admin/bulk', authenticate, requireElevatedAccess, async (req, res) => {
  try {
    const requestedTags = normalizeTagsInput(req.body?.tags, ALL_PROFILE_TAGS.length)
      .filter((tag) => isValidProfileTag(tag));

    if (requestedTags.length === 0) {
      return res.status(400).json({ error: '作成する公式タグを1つ以上選択してください' });
    }

    const ownerId = req.user._id;
    const results = [];

    for (const tag of requestedTags) {
      const preset = DEFAULT_COMMUNITY_BY_TAG[tag] || {
        name: `${tag}の部屋`,
        description: `${tag}が好きな人が集まるコミュニティです。`,
      };

      const existing = await Community.findOne({ tagFilter: tag });
      if (existing) {
        results.push({ tag, status: 'skipped', reason: 'already_exists', communityId: existing._id });
        continue;
      }

      const created = await Community.create({
        name: preset.name,
        slug: buildPresetSlug(tag),
        description: preset.description,
        ownerId,
        members: [ownerId],
        tags: [tag],
        tagFilter: tag,
        isPrivate: true,
        allowAnonymousPosts: req.body?.allowAnonymousPosts !== false,
      });

      results.push({ tag, status: 'created', communityId: created._id, name: created.name });
    }

    return res.status(201).json({ results });
  } catch (err) {
    console.error('Community admin bulk error:', err);
    return res.status(500).json({ error: 'コミュニティの一括作成に失敗しました' });
  }
});

router.use('/:communityId/topics', communityTopicsRouter);

router.get('/mine/:userId', authenticate, async (req, res) => {
  try {
    const targetUserId = String(req.params.userId || '');
    if (!targetUserId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (req.user._id.toString() !== targetUserId && !req.user.hasElevatedAccess) {
      return res.status(403).json({ error: 'この情報を閲覧する権限がありません' });
    }

    const communities = await Community.find({ members: targetUserId })
      .populate('ownerId', 'username profilePicture')
      .sort({ createdAt: -1 });

    res.status(200).json(communities);
  } catch (err) {
    console.error('Community mine error:', err);
    res.status(500).json({ error: '参加中コミュニティの取得に失敗しました' });
  }
});

router.get('/:communityId', authenticate, async (req, res) => {
  try {
    const community = await Community.findById(req.params.communityId)
      .populate('ownerId', 'username profilePicture')
      .populate('members', 'username profilePicture');

    if (!community) {
      return res.status(404).json({ error: 'コミュニティが見つかりません' });
    }

    const userId = req.user._id.toString();
    if (!isMember(community, userId) && community.ownerId.toString() !== userId) {
      return res.status(403).json({ error: 'コミュニティに参加してください' });
    }

    res.status(200).json(community);
  } catch (err) {
    console.error('Community fetch error:', err);
    res.status(500).json({ error: 'コミュニティの取得に失敗しました' });
  }
});

router.post('/:communityId/join', authenticate, async (req, res) => {
  try {
    const userId = req.user._id.toString();

    const community = await Community.findById(req.params.communityId);
    if (!community) {
      return res.status(404).json({ error: 'コミュニティが見つかりません' });
    }

    if (community.tagFilter) {
      const user = await User.findById(userId).select('profileTags');
      const userTags = Array.isArray(user?.profileTags) ? user.profileTags.map((t) => String(t)) : [];
      if (!hasTagAccess(userTags, community.tagFilter)) {
        return res.status(403).json({ error: 'このコミュニティの参加条件を満たしていません' });
      }
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

router.delete('/:communityId/leave', authenticate, async (req, res) => {
  try {
    const userId = req.user._id.toString();

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

router.get('/:communityId/posts', authenticate, async (req, res) => {
  try {
    const community = await Community.findById(req.params.communityId);
    if (!community) {
      return res.status(404).json({ error: 'コミュニティが見つかりません' });
    }

    const userId = req.user._id.toString();
    if (!isMember(community, userId) && community.ownerId.toString() !== userId) {
      return res.status(403).json({ error: 'コミュニティに参加してください' });
    }

    let posts = await Post.find({ communityId: req.params.communityId, moderationStatus: { $ne: 'hidden_by_reports' } })
      .select('userId desc img imgs video postMode communityId anonymousLabel likes comment reposts createdAt')
      .populate('userId', 'username profilePicture')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    posts = posts.map((post) => {
      const p = { ...post };
      if (p.postMode === 'anonymous') {
        const authorId = p.userId?._id?.toString?.() || '';
        const isMine = authorId === userId;
        p.userId = {
          _id: isMine ? authorId : null,
          username: p.anonymousLabel || '匿名ユーザー',
          profilePicture: '',
        };
      }
      return p;
    });

    res.status(200).json(posts);
  } catch (err) {
    console.error('Community posts error:', err);
    res.status(500).json({ error: 'コミュニティ投稿の取得に失敗しました' });
  }
});

// コミュニティ許可タグの更新（オーナーのみ）
router.put('/:communityId/tags', authenticate, async (req, res) => {
  try {
    const { tags } = req.body;
    const community = await Community.findById(req.params.communityId);
    if (!community) return res.status(404).json({ error: 'コミュニティが見つかりません' });

    if (!canManageCommunity(community, req.user)) {
      return res.status(403).json({ error: '更新権限がありません' });
    }

    const normalized = normalizeCommunityTags(tags, community.tagFilter);
    community.tags = normalized;
    await community.save();

    res.status(200).json({ tags: community.tags });
  } catch (err) {
    console.error('Update community tags error:', err);
    res.status(500).json({ error: 'タグの更新に失敗しました' });
  }
});

// コミュニティ情報の更新（オーナーのみ）
router.put('/:communityId', authenticate, async (req, res) => {
  try {
    const community = await Community.findById(req.params.communityId);
    if (!community) return res.status(404).json({ error: 'コミュニティが見つかりません' });

    if (!canManageCommunity(community, req.user)) {
      return res.status(403).json({ error: '更新権限がありません' });
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'tagFilter')) {
      const parsedTagFilter = normalizeCommunityTagFilter(req.body.tagFilter);
      if (parsedTagFilter.error) {
        return res.status(400).json({ error: parsedTagFilter.error });
      }
      community.tagFilter = parsedTagFilter.tagFilter;
    }

    const allowed = ['name', 'description', 'isPrivate', 'allowAnonymousPosts'];
    allowed.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        community[k] = req.body[k];
      }
    });

    if (Object.prototype.hasOwnProperty.call(req.body, 'tags')) {
      community.tags = normalizeCommunityTags(req.body.tags, community.tagFilter);
    } else if (community.tagFilter) {
      community.tags = normalizeCommunityTags(community.tags, community.tagFilter);
    }

    await community.save();
    return res.status(200).json(community);
  } catch (err) {
    console.error('Community update error:', err);
    return res.status(500).json({ error: 'コミュニティの更新に失敗しました' });
  }
});

router.delete('/:communityId', authenticate, requireElevatedAccess, async (req, res) => {
  try {
    const community = await Community.findById(req.params.communityId);
    if (!community) {
      return res.status(404).json({ error: 'コミュニティが見つかりません' });
    }

    await Community.deleteOne({ _id: community._id });
    await Post.deleteMany({ communityId: community._id });
    await Conversation.deleteMany({ communityId: community._id });

    return res.status(200).json({ message: 'コミュニティを削除しました' });
  } catch (err) {
    console.error('Community delete error:', err);
    return res.status(500).json({ error: 'コミュニティの削除に失敗しました' });
  }
});

// コミュニティ専用チャットを作成（参加希望制：初期メンバーはオーナーのみ）
router.post('/:communityId/createConversation', authenticate, async (req, res) => {
  try {
    const community = await Community.findById(req.params.communityId);
    if (!community) return res.status(404).json({ error: 'コミュニティが見つかりません' });

    const requesterId = req.user._id.toString();
    if (!isMember(community, requesterId) && community.ownerId.toString() !== requesterId) {
      return res.status(403).json({ error: 'コミュニティに参加してください' });
    }

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
router.post('/:communityId/conversation/join', authenticate, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const community = await Community.findById(req.params.communityId);
    if (!community) return res.status(404).json({ error: 'コミュニティが見つかりません' });

    if (!isMember(community, userId) && community.ownerId.toString() !== userId) {
      return res.status(403).json({ error: 'コミュニティに参加していないため会話に参加できません' });
    }

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
router.post('/:communityId/conversation/leave', authenticate, async (req, res) => {
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
router.get('/:communityId/conversation', authenticate, async (req, res) => {
  try {
    const community = await Community.findById(req.params.communityId).select('ownerId members');
    if (!community) return res.status(404).json({ error: 'コミュニティが見つかりません' });

    const userId = req.user._id.toString();
    if (!isMember(community, userId) && community.ownerId.toString() !== userId) {
      return res.status(403).json({ error: 'コミュニティに参加してください' });
    }

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