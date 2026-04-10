const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const Post = require('../models/Post');
const { authenticate, requireElevatedAccess } = require('../middleware/auth');
const { callGroqChatCompletion } = require('../utils/groqClient');
const {
  getAiServiceStatus,
  isAiServiceEnabled,
  setAiServiceEnabled,
} = require('../utils/aiServiceControl');
const {
  buildViewerVisibilityContext,
  canViewerSeePost,
} = require('../utils/postVisibility');

const AI_ACTIVE_STATUS = { $ne: 'hidden_by_reports' };

const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI request limit exceeded. Please retry later.' },
});

const summarizeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Summarization request limit exceeded.' },
});

const ensureAiEnabledOrThrow = () => {
  if (!isAiServiceEnabled()) {
    const err = new Error('AI service is disabled');
    err.code = 'AI_SERVICE_DISABLED';
    throw err;
  }
};

const resolvePostForViewer = async ({ postId, viewerId }) => {
  const post = await Post.findOne({
    _id: postId,
    moderationStatus: AI_ACTIVE_STATUS,
  }).populate('userId', 'username profilePicture hasElevatedAccess');

  if (!post) {
    const err = new Error('Post not found');
    err.status = 404;
    throw err;
  }

  const viewerContext = await buildViewerVisibilityContext(viewerId);
  if (!canViewerSeePost(post, viewerContext)) {
    const err = new Error('You do not have permission to view this post');
    err.status = 403;
    throw err;
  }

  return post;
};

const buildPostContext = (post) => {
  const author = post?.userId?.username || 'unknown';
  const createdAt = post?.createdAt ? new Date(post.createdAt).toISOString() : null;
  const text = String(post?.desc || '').trim();
  const likes = Array.isArray(post?.likes) ? post.likes.length : 0;
  const comments = Number(post?.comment || 0);
  const reposts = Array.isArray(post?.reposts) ? post.reposts.length : 0;

  return {
    postId: String(post?._id || ''),
    author,
    createdAt,
    hasMedia: Boolean(post?.img || post?.video || (Array.isArray(post?.imgs) && post.imgs.length > 0)),
    metrics: {
      likes,
      comments,
      reposts,
    },
    text: text || '(本文なし)',
  };
};

const normalizeQuestion = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 500);
};

const formatAiError = (err) => {
  if (err?.code === 'AI_SERVICE_DISABLED') {
    return {
      status: 503,
      body: {
        error: 'AI service is currently disabled',
        status: getAiServiceStatus(),
      },
    };
  }

  if (err?.status === 403 || err?.status === 404) {
    return {
      status: err.status,
      body: { error: err.message },
    };
  }

  if (err?.code && String(err.code).startsWith('GROQ_')) {
    return {
      status: err?.status && Number.isInteger(err.status) ? err.status : 502,
      body: {
        error: 'AI provider request failed',
        code: err.code,
        detail: err.message,
      },
    };
  }

  return {
    status: 500,
    body: { error: 'Unexpected AI service error' },
  };
};

router.get('/status', authenticate, (req, res) => {
  return res.status(200).json(getAiServiceStatus());
});

router.patch('/kill-switch', authenticate, requireElevatedAccess, (req, res) => {
  const { enabled, reason } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  const status = setAiServiceEnabled({
    enabled,
    changedBy: req.user?._id,
    reason,
  });

  console.warn('[ai] kill-switch updated', {
    enabled,
    effectiveEnabled: status.effectiveEnabled,
    changedBy: req.user?._id ? String(req.user._id) : null,
    reason: status.lastReason,
  });

  return res.status(200).json(status);
});

router.post('/posts/:postId/summarize', authenticate, aiLimiter, summarizeLimiter, async (req, res) => {
  try {
    ensureAiEnabledOrThrow();

    const post = await resolvePostForViewer({
      postId: req.params.postId,
      viewerId: req.user?._id,
    });
    const context = buildPostContext(post);

    const completion = await callGroqChatCompletion({
      messages: [
        {
          role: 'system',
          content: 'あなたはSNS投稿の要約アシスタントです。事実ベースで簡潔に、誇張や断定を避けて日本語で回答してください。',
        },
        {
          role: 'user',
          content: [
            '以下の投稿を2-3行で要約してください。',
            `投稿者: ${context.author}`,
            `投稿時刻(UTC): ${context.createdAt}`,
            `いいね数: ${context.metrics.likes}`,
            `コメント数: ${context.metrics.comments}`,
            `推し数: ${context.metrics.reposts}`,
            `本文: ${context.text}`,
          ].join('\n'),
        },
      ],
      temperature: 0.2,
      maxTokens: 320,
    });

    return res.status(200).json({
      postId: context.postId,
      summary: completion.content,
      provider: 'groq',
      model: completion.model,
      usage: completion.usage,
    });
  } catch (err) {
    console.error('[ai] summarize failed:', err);
    const formatted = formatAiError(err);
    return res.status(formatted.status).json(formatted.body);
  }
});

router.post('/posts/:postId/ask', authenticate, aiLimiter, async (req, res) => {
  try {
    ensureAiEnabledOrThrow();

    const question = normalizeQuestion(req.body?.question);
    if (!question) {
      return res.status(400).json({ error: 'question is required' });
    }

    const post = await resolvePostForViewer({
      postId: req.params.postId,
      viewerId: req.user?._id,
    });
    const context = buildPostContext(post);

    const completion = await callGroqChatCompletion({
      messages: [
        {
          role: 'system',
          content: 'あなたはSNS投稿に対する質問応答アシスタントです。与えられた投稿情報だけを根拠に日本語で回答し、根拠がない場合は不明と答えてください。',
        },
        {
          role: 'user',
          content: [
            '次の投稿に関する質問に答えてください。',
            `投稿者: ${context.author}`,
            `投稿時刻(UTC): ${context.createdAt}`,
            `本文: ${context.text}`,
            `質問: ${question}`,
          ].join('\n'),
        },
      ],
      temperature: 0.1,
      maxTokens: 420,
    });

    return res.status(200).json({
      postId: context.postId,
      question,
      answer: completion.content,
      provider: 'groq',
      model: completion.model,
      usage: completion.usage,
    });
  } catch (err) {
    console.error('[ai] ask failed:', err);
    const formatted = formatAiError(err);
    return res.status(formatted.status).json(formatted.body);
  }
});

module.exports = router;
