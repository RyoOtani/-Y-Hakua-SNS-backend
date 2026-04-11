const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const User = require("../models/User");
const { authenticate } = require("../middleware/auth");
const { sendPushToUser } = require("../utils/pushNotification");
const { normalizeReplyToPayload } = require("../utils/replyTo");
const { callGroqChatCompletion } = require("../utils/groqClient");
const { isAiServiceEnabled } = require("../utils/aiServiceControl");
const { censorText } = require("../utils/contentFilter");
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

const normalizeRateLimitKey = (req) => {
  const ip = req.ip || req.socket?.remoteAddress || "";
  return ipKeyGenerator(ip);
};

const messageWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: normalizeRateLimitKey,
  message: { error: "リクエストが多すぎます。しばらくしてからお試しください。" },
});

const buildConversationLastMessageText = ({ text, attachments }) => {
  if (typeof text === "string" && text.trim().length > 0) {
    return text;
  }

  if (Array.isArray(attachments) && attachments.length > 0) {
    return "Sent an attachment";
  }

  return "";
};

const ACTIVE_MESSAGE_FILTER = { $ne: "hidden_by_reports" };
const YAPPY_DM_CONTEXT_MAX_ITEMS = 30;
const YAPPY_DM_TEXT_MAX_LENGTH = 220;
const DEFAULT_YAPPY_DM_DISABLED_REPLY = "いまAIサービスが停止中なので、少し時間を置いてからもう一度メッセージしてね。";
const DEFAULT_YAPPY_DM_ERROR_REPLY = "返信の作成に失敗したよ。少し時間を置いてもう一度送ってね。";

const isMessageHidden = (message) => message?.moderationStatus === "hidden_by_reports";

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeContextText = (value) => (
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, YAPPY_DM_TEXT_MAX_LENGTH)
);

const resolveYappyBotUser = async () => {
  const configuredBotId = String(process.env.YAPPY_BOT_USER_ID || "").trim();
  if (configuredBotId) {
    const byId = await User.findById(configuredBotId).select("_id username profilePicture");
    if (byId) return byId;
    console.warn("[yappy-dm] YAPPY_BOT_USER_ID is set but no user was found");
  }

  const configuredBotUsername = String(process.env.YAPPY_BOT_USERNAME || "Yappy").trim();
  if (!configuredBotUsername) return null;

  const usernamePattern = new RegExp(`^${escapeRegExp(configuredBotUsername)}$`, "i");
  return User.findOne({ username: usernamePattern }).select("_id username profilePicture");
};

const buildDmTimelineContext = async ({ conversationId, sourceMessageId }) => {
  const messages = await Message.find(
    buildActiveMessageQuery({ conversationId })
  )
    .select("sender text attachments createdAt")
    .populate("sender", "username")
    .sort({ createdAt: 1, _id: 1 });

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      timelineText: "（このメッセージが最初です）",
      totalItems: 0,
      omittedItems: 0,
    };
  }

  const sourceId = String(sourceMessageId || "");
  const sourceIndex = messages.findIndex((message) => String(message._id) === sourceId);
  const visibleMessages = sourceIndex >= 0 ? messages.slice(0, sourceIndex + 1) : messages;

  const omittedItems = Math.max(0, visibleMessages.length - YAPPY_DM_CONTEXT_MAX_ITEMS);
  const recentMessages = omittedItems > 0
    ? visibleMessages.slice(-YAPPY_DM_CONTEXT_MAX_ITEMS)
    : visibleMessages;

  const timelineText = recentMessages
    .map((message, index) => {
      const relativeIndex = omittedItems + index + 1;
      const username = message?.sender?.username || "ユーザー";
      const text = normalizeContextText(message?.text);
      const hasAttachments = Array.isArray(message?.attachments) && message.attachments.length > 0;
      const normalizedText = text || (hasAttachments ? "(添付ファイルのみ)" : "(本文なし)");
      return `${relativeIndex}. ${username}: ${normalizedText}`;
    })
    .join("\n");

  return {
    timelineText: timelineText || "（メッセージ本文なし）",
    totalItems: visibleMessages.length,
    omittedItems,
  };
};

const buildYappyDmReplyText = async ({
  senderUsername,
  senderText,
  timelineText,
  totalItems,
  omittedItems,
}) => {
  if (!isAiServiceEnabled()) {
    return DEFAULT_YAPPY_DM_DISABLED_REPLY;
  }

  try {
    const completion = await callGroqChatCompletion({
      messages: [
        {
          role: "system",
          content: "あなたはYappyというSNSアシスタントです。DMの文脈を理解し、やさしく簡潔に日本語で1-3文で回答してください。危険・違法行為は助長せず安全に回答してください。",
        },
        {
          role: "user",
          content: [
            "ユーザーからYappy宛にDMが届きました。会話の流れを理解して返信してください。",
            `ここまでのメッセージ数: ${Number(totalItems || 0)}`,
            omittedItems > 0 ? `文脈圧縮: 先頭${omittedItems}件は省略し、直近${YAPPY_DM_CONTEXT_MAX_ITEMS}件を提示` : "文脈圧縮: 省略なし",
            "会話時系列:",
            String(timelineText || "（会話なし）"),
            `直近メッセージ送信者: ${String(senderUsername || "ユーザー")}`,
            `直近メッセージ本文: ${String(senderText || "").trim() || "(本文なし)"}`,
            "自然で簡潔な返信を作成してください。",
          ].join("\n"),
        },
      ],
      temperature: 0.4,
      maxTokens: 260,
    });

    const reply = String(completion?.content || "").trim();
    if (!reply) {
      return DEFAULT_YAPPY_DM_ERROR_REPLY;
    }

    return reply.slice(0, 1000);
  } catch (err) {
    console.error("[yappy-dm] Groq reply generation failed:", err);
    return DEFAULT_YAPPY_DM_ERROR_REPLY;
  }
};

const postYappyAutoReplyInDm = async ({
  conversation,
  sourceMessage,
  senderId,
  senderUsername,
  app,
}) => {
  if (!conversation || !sourceMessage || !senderId) return;

  const yappyUser = await resolveYappyBotUser();
  if (!yappyUser) {
    console.warn("[yappy-dm] bot user is not configured. Set YAPPY_BOT_USER_ID or YAPPY_BOT_USERNAME.");
    return;
  }

  if (String(senderId) === String(yappyUser._id)) {
    return;
  }

  const memberIds = (conversation.members || []).map((memberId) => memberId.toString());
  const includesYappy = memberIds.includes(String(yappyUser._id));
  if (!includesYappy || memberIds.length !== 2 || conversation.isGroup) {
    return;
  }

  const timelineContext = await buildDmTimelineContext({
    conversationId: conversation._id,
    sourceMessageId: sourceMessage._id,
  });

  const rawReply = await buildYappyDmReplyText({
    senderUsername,
    senderText: sourceMessage.text,
    timelineText: timelineContext.timelineText,
    totalItems: timelineContext.totalItems,
    omittedItems: timelineContext.omittedItems,
  });

  const filteredReply = censorText(String(rawReply || "")).trim().slice(0, 1000);
  const finalReply = filteredReply || DEFAULT_YAPPY_DM_ERROR_REPLY;

  const yappyMessage = new Message({
    conversationId: conversation._id,
    sender: yappyUser._id,
    text: finalReply,
    attachments: [],
  });
  const savedYappyMessage = await yappyMessage.save();

  conversation.lastMessage = savedYappyMessage._id;
  conversation.lastMessageText = buildConversationLastMessageText({ text: finalReply, attachments: [] });
  conversation.lastMessageAt = savedYappyMessage.createdAt;

  memberIds
    .filter((memberId) => memberId !== String(yappyUser._id))
    .forEach((memberId) => {
      const currentCount = conversation.unreadCount.get(memberId) || 0;
      conversation.unreadCount.set(memberId, currentCount + 1);
    });

  await conversation.save();

  const receiverIds = memberIds.filter((memberId) => memberId !== String(yappyUser._id));
  const receiverDocs = await User.find({ _id: { $in: receiverIds } })
    .select("_id blockedUsers mutedUsers notificationPreferences");

  const allowedReceivers = receiverDocs.filter((receiver) => {
    const blocked = receiver.blockedUsers || [];
    const muted = receiver.mutedUsers || [];
    const yappyId = String(yappyUser._id);
    const isBlocked = blocked.map((id) => id.toString()).includes(yappyId);
    const isMuted = muted.map((id) => id.toString()).includes(yappyId);
    return !isBlocked && !isMuted;
  });

  const io = app.get("io");
  allowedReceivers.forEach((receiver) => {
    io.to(receiver._id.toString()).emit("getMessage", {
      messageId: savedYappyMessage._id,
      senderId: yappyUser._id,
      senderName: yappyUser.username || "Yappy",
      senderProfilePicture: yappyUser.profilePicture,
      text: finalReply,
      conversationId: conversation._id,
      attachments: [],
      replyTo: null,
      createdAt: savedYappyMessage.createdAt,
    });
  });

  const pushTargetIds = allowedReceivers
    .filter((receiver) => receiver.notificationPreferences?.message !== false)
    .map((receiver) => receiver._id.toString());

  await Promise.allSettled(
    pushTargetIds.map((receiverId) =>
      sendPushToUser({
        receiverId,
        title: "Yappyからの返信",
        body: finalReply.slice(0, 80),
        data: {
          type: "message",
          conversationId: conversation._id,
          senderId: yappyUser._id,
        },
      })
    )
  );
};

const buildActiveMessageQuery = (baseQuery = {}) => ({
  ...baseQuery,
  deletedAt: null,
  moderationStatus: ACTIVE_MESSAGE_FILTER,
});

const refreshConversationLastMessage = async (conversationId) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return;

  const lastActiveMessage = await Message.findOne(
    buildActiveMessageQuery({ conversationId })
  ).sort({ createdAt: -1 });

  if (lastActiveMessage) {
    conversation.lastMessage = lastActiveMessage._id;
    conversation.lastMessageText = buildConversationLastMessageText({
      text: lastActiveMessage.text,
      attachments: lastActiveMessage.attachments,
    });
    conversation.lastMessageAt = lastActiveMessage.createdAt;
  } else {
    conversation.lastMessage = null;
    conversation.lastMessageText = null;
    conversation.lastMessageAt = null;
  }

  await conversation.save();
};

const ALLOWED_MESSAGE_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🎉", "👏", "🤔", "🔥"];

const normalizeMessageReactions = (reactions = []) => {
  if (!Array.isArray(reactions)) return [];

  return reactions
    .filter((reaction) => reaction?.userId && reaction?.emoji)
    .map((reaction) => ({
      userId: reaction.userId.toString(),
      emoji: reaction.emoji,
      reactedAt: reaction.reactedAt || null,
    }));
};

// メッセージ追加
router.post("/", authenticate, messageWriteLimiter, async (req, res) => {
  try {
    let { conversationId, receiverId, text, attachments, replyTo } = req.body;
    const sender = req.user._id;
    let conversation;

    if (conversationId) {
      // 既存の会話IDが指定されている場合
      conversation = await Conversation.findById(conversationId);
      if (!conversation || !conversation.members.map(m => m.toString()).includes(sender.toString())) {
        return res.status(403).json({ error: "この会話にメッセージを送る権限がありません" });
      }
    } else if (receiverId) {
      // receiverIdのみ指定 → 会話を自動作成 or 既存を検索
      conversation = await Conversation.findOne({
        members: { $all: [sender, receiverId] },
      });
      if (!conversation) {
        conversation = new Conversation({
          members: [sender, receiverId],
          unreadCount: new Map([
            [sender.toString(), 0],
            [receiverId.toString(), 0],
          ]),
        });
        await conversation.save();
      }
      conversationId = conversation._id;
    } else {
      return res.status(400).json({ error: "conversationId または receiverId が必要です" });
    }

    const receiverIds = conversation.members
      .map((memberId) => memberId.toString())
      .filter((memberId) => memberId !== sender.toString());

    const receivers = await User.find({ _id: { $in: receiverIds } }).select('_id blockedUsers mutedUsers');
    const blockedOrMutedByAnyReceiver = receivers.some((receiver) => {
      const blocked = receiver.blockedUsers || [];
      const muted = receiver.mutedUsers || [];
      const senderId = sender.toString();
      const isBlocked = blocked.map((id) => id.toString()).includes(senderId);
      const isMuted = muted.map((id) => id.toString()).includes(senderId);
      return isBlocked || isMuted;
    });

    if (blockedOrMutedByAnyReceiver) {
      return res.status(403).json({ error: "このユーザーにはメッセージを送信できません" });
    }

    const normalizedReplyTo = await normalizeReplyToPayload({
      replyTo,
      conversationId,
    });

    const newMessage = new Message({
      conversationId,
      sender,
      text,
      replyTo: normalizedReplyTo,
      attachments: attachments || [],
    });

    const savedMessage = await newMessage.save();

    // 送信者の情報を取得（UI表示用）
    const populatedMessage = await Message.findById(savedMessage._id).populate("sender", "username profilePicture");

    // 会話の最新メッセージを更新
    conversation.lastMessage = savedMessage._id;
    conversation.lastMessageText = buildConversationLastMessageText({ text, attachments });
    conversation.lastMessageAt = savedMessage.createdAt;

    // 送信者以外のメンバーの未読カウントを増やす
    conversation.members.forEach((memberId) => {
      if (memberId.toString() !== sender.toString()) {
        const currentCount = conversation.unreadCount.get(memberId.toString()) || 0;
        conversation.unreadCount.set(memberId.toString(), currentCount + 1);
      }
    });

    await conversation.save();

    // 送信者以外の会話メンバーへプッシュ通知
    try {
      const senderUser = await User.findById(sender).select("username");
      const senderName = senderUser?.username || "ユーザー";
      const messagePreview = (text || "").trim();
      const body = messagePreview
        ? `${senderName}: ${messagePreview.slice(0, 80)}`
        : `${senderName}さんからメッセージが届きました`;

      const receivers = await User.find({ _id: { $in: receiverIds } }).select('_id blockedUsers mutedUsers notificationPreferences');
      const pushTargetIds = receivers
        .filter((receiver) => {
          const blocked = receiver.blockedUsers || [];
          const muted = receiver.mutedUsers || [];
          const isBlocked = blocked.map((id) => id.toString()).includes(sender.toString());
          const isMuted = muted.map((id) => id.toString()).includes(sender.toString());
          const messageNotifEnabled = receiver.notificationPreferences?.message !== false;
          return !isBlocked && !isMuted && messageNotifEnabled;
        })
        .map((receiver) => receiver._id.toString());

      await Promise.allSettled(
        pushTargetIds.map((memberId) =>
          sendPushToUser({
            receiverId: memberId,
            title: "新着メッセージ",
            body,
            data: {
              type: "message",
              conversationId: conversation._id,
              senderId: sender,
            },
          })
        )
      );
    } catch (pushErr) {
      console.error("FCM notify error (message):", pushErr);
    }

    void postYappyAutoReplyInDm({
      conversation,
      sourceMessage: savedMessage,
      senderId: sender,
      senderUsername: populatedMessage?.sender?.username,
      app: req.app,
    }).catch((yappyErr) => {
      console.error("[yappy-dm] auto reply error:", yappyErr);
    });

    res.status(201).json(populatedMessage);
  } catch (err) {
    console.error("Message create error:", err);
    res.status(500).json({ error: "メッセージの送信に失敗しました" });
  }
});

// 会話内のメッセージ取得
router.get("/:conversationId", authenticate, async (req, res) => {
  try {
    // 会話メンバーシップの確認
    const conversation = await Conversation.findById(req.params.conversationId);
    if (!conversation || !conversation.members.map(m => m.toString()).includes(req.user._id.toString())) {
      return res.status(403).json({ error: "この会話を閲覧する権限がありません" });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const skip = (page - 1) * limit;

    const messages = await Message.find(
      buildActiveMessageQuery({
        conversationId: req.params.conversationId,
      })
    )
      .populate("sender", "username profilePicture")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json(messages);
  } catch (err) {
    console.error("Message fetch error:", err);
    res.status(500).json({ error: "メッセージの取得に失敗しました" });
  }
});

// メッセージリアクション追加/更新/解除
// - グループチャット: 1ユーザー1リアクション（別絵文字を押すと上書き）
// - 1対1チャット: 1ユーザー複数リアクション可（同じ絵文字はトグル）
router.put("/:messageId/reaction", authenticate, messageWriteLimiter, async (req, res) => {
  try {
    const { emoji } = req.body;
    const userId = req.user._id.toString();

    if (!ALLOWED_MESSAGE_REACTIONS.includes(emoji)) {
      return res.status(400).json({ error: "使用できないリアクションです" });
    }

    const message = await Message.findById(req.params.messageId);
    if (!message || message.deletedAt || isMessageHidden(message)) {
      return res.status(404).json({ error: "メッセージが見つかりません" });
    }

    const conversation = await Conversation.findById(message.conversationId).select("members isGroup");
    const hasAccess = conversation
      ? conversation.members.map((memberId) => memberId.toString()).includes(userId)
      : false;
    if (!hasAccess) {
      return res.status(403).json({ error: "この会話にアクセスする権限がありません" });
    }

    if (!Array.isArray(message.reactions)) {
      message.reactions = [];
    }

    const isGroupConversation = Boolean(conversation?.isGroup);

    if (isGroupConversation) {
      const existingIndex = message.reactions.findIndex(
        (reaction) => reaction?.userId?.toString() === userId
      );

      if (existingIndex >= 0) {
        const existingReaction = message.reactions[existingIndex];
        if (existingReaction.emoji === emoji) {
          message.reactions.splice(existingIndex, 1);
        } else {
          message.reactions[existingIndex].emoji = emoji;
          message.reactions[existingIndex].reactedAt = new Date();
        }
      } else {
        message.reactions.push({
          userId: req.user._id,
          emoji,
          reactedAt: new Date(),
        });
      }
    } else {
      const sameEmojiIndex = message.reactions.findIndex(
        (reaction) =>
          reaction?.userId?.toString() === userId &&
          reaction?.emoji === emoji
      );

      if (sameEmojiIndex >= 0) {
        message.reactions.splice(sameEmojiIndex, 1);
      } else {
        message.reactions.push({
          userId: req.user._id,
          emoji,
          reactedAt: new Date(),
        });
      }
    }

    const updatedMessage = await message.save();
    const reactions = normalizeMessageReactions(updatedMessage.reactions);

    const io = req.app.get("io");
    if (io && conversation) {
      conversation.members
        .map((memberId) => memberId.toString())
        .filter((memberId) => memberId !== userId)
        .forEach((memberId) => {
          io.to(memberId).emit("messageReactionUpdated", {
            conversationId: updatedMessage.conversationId.toString(),
            messageId: updatedMessage._id.toString(),
            reactions,
          });
        });
    }

    res.status(200).json({
      messageId: updatedMessage._id,
      reactions,
    });
  } catch (err) {
    console.error("Message reaction update error:", err);
    res.status(500).json({ error: "リアクションの更新に失敗しました" });
  }
});

router.post("/:messageId/report", authenticate, messageWriteLimiter, async (req, res) => {
  try {
    const reporterId = req.user._id;
    const message = await Message.findById(req.params.messageId)
      .select("conversationId sender moderationStatus moderationSummary deletedAt");

    if (!message || message.deletedAt || isMessageHidden(message)) {
      return res.status(404).json({ error: "メッセージが見つかりません" });
    }

    const conversation = await Conversation.findById(message.conversationId).select("members");
    const hasAccess = conversation
      ? conversation.members.map((memberId) => memberId.toString()).includes(reporterId.toString())
      : false;

    if (!hasAccess) {
      return res.status(403).json({ error: "このメッセージを通報する権限がありません" });
    }

    const targetOwnerId = message.sender;
    if (targetOwnerId.toString() === reporterId.toString()) {
      return res.status(400).json({ error: "自分のメッセージは通報できません" });
    }

    const reason = normalizeReportReason(req.body?.reason);
    const details = normalizeReportDetails(req.body?.details);
    const safetyActions = normalizeSafetyActions(req.body?.safetyActions);

    const { duplicate } = await createModerationReport({
      targetType: REPORT_TARGET_TYPES.MESSAGE,
      targetId: message._id,
      targetOwnerId,
      reporterId,
      reason,
      details,
      safetyActions,
    });

    if (duplicate) {
      return res.status(409).json({ error: "このメッセージはすでに通報済みです" });
    }

    const appliedSafety = await applyReporterSafetyActions({
      reporterId,
      targetOwnerId,
      safetyActions,
    });

    const reportCount = await countReportsForTarget(REPORT_TARGET_TYPES.MESSAGE, message._id);
    const moderationState = await syncTargetModerationState({
      targetDoc: message,
      reportCount,
    });

    if (moderationState.hiddenNow) {
      await refreshConversationLastMessage(message.conversationId);

      const io = req.app.get("io");
      if (io && conversation) {
        conversation.members
          .map((memberId) => memberId.toString())
          .forEach((memberId) => {
            io.to(memberId).emit("messageModerationUpdated", {
              conversationId: message.conversationId.toString(),
              messageId: message._id.toString(),
              hidden: true,
            });
          });
      }
    }

    return res.status(201).json({
      message: "メッセージを通報しました",
      reportCount: moderationState.reportCount,
      hidden: moderationState.hidden,
      threshold: moderationState.threshold,
      appliedSafety,
    });
  } catch (err) {
    console.error("Message report error:", err);
    return res.status(500).json({ error: "メッセージの通報に失敗しました" });
  }
});

// メッセージ編集
router.put("/:messageId", authenticate, messageWriteLimiter, async (req, res) => {
  try {
    const { text } = req.body;
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ error: "メッセージが見つかりません" });
    }
    if (isMessageHidden(message)) {
      return res.status(404).json({ error: "メッセージが見つかりません" });
    }

    // 送信者のみ編集可能
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "このメッセージを編集する権限がありません" });
    }

    message.text = text;
    message.edited = true;
    message.editedAt = new Date();

    const updatedMessage = await message.save();

    // 会話の最新メッセージも更新（最新メッセージの場合）
    const conversation = await Conversation.findById(message.conversationId);
    if (conversation && conversation.lastMessage?.toString() === message._id.toString()) {
      conversation.lastMessageText = buildConversationLastMessageText({
        text,
        attachments: message.attachments,
      });
      await conversation.save();
    }

    res.status(200).json(updatedMessage);
  } catch (err) {
    console.error("Message edit error:", err);
    res.status(500).json({ error: "メッセージの編集に失敗しました" });
  }
});

// メッセージ削除（物理削除）
router.delete("/:messageId", authenticate, messageWriteLimiter, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ error: "メッセージが見つかりません" });
    }

    // 送信者のみ削除可能
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "このメッセージを削除する権限がありません" });
    }

    await Message.findByIdAndDelete(req.params.messageId);

    await refreshConversationLastMessage(message.conversationId);

    res.status(200).json({ message: "メッセージを削除しました" });
  } catch (err) {
    console.error("Message delete error:", err);
    res.status(500).json({ error: "メッセージの削除に失敗しました" });
  }
});

// 単一メッセージを既読にする
router.put("/:messageId/read", authenticate, messageWriteLimiter, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ error: "メッセージが見つかりません" });
    }
    if (isMessageHidden(message)) {
      return res.status(404).json({ error: "メッセージが見つかりません" });
    }

    const conversation = await Conversation.findById(message.conversationId).select("members");
    const userId = req.user._id.toString();
    const hasAccess = conversation
      ? conversation.members.map((memberId) => memberId.toString()).includes(userId)
      : false;
    if (!hasAccess) {
      return res.status(403).json({ error: "この会話にアクセスする権限がありません" });
    }

    // 送信者以外が既読にする
    if (message.sender.toString() !== userId && !message.read) {
      message.read = true;
      message.readAt = new Date();
      await message.save();
    }

    res.status(200).json(message);
  } catch (err) {
    console.error("Message read error:", err);
    res.status(500).json({ error: "既読の更新に失敗しました" });
  }
});

// 会話内の全メッセージを既読にする
router.put("/read-all/:conversationId", authenticate, messageWriteLimiter, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { conversationId } = req.params;

    // 会話メンバーシップの確認
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.members.map(m => m.toString()).includes(userId)) {
      return res.status(403).json({ error: "この会話にアクセスする権限がありません" });
    }

    // 送信者以外が既読にする
    const readAt = new Date();
    const readResult = await Message.updateMany(
      buildActiveMessageQuery({
        conversationId,
        sender: { $ne: req.user._id },
        read: false,
      }),
      {
        $set: {
          read: true,
          readAt,
        },
      }
    );

    // 会話の未読カウントをリセット
    conversation.unreadCount.set(userId, 0);
    await conversation.save();

    // 既読更新の有無に関わらず、相手側へ既読同期イベントを通知する
    const io = req.app.get("io");
    if (io) {
      conversation.members
        .map((memberId) => memberId.toString())
        .filter((memberId) => memberId !== userId)
        .forEach((memberId) => {
          io.to(memberId).emit("messageRead", {
            conversationId,
            readerId: userId,
            readAt,
            modifiedCount: readResult.modifiedCount || 0,
          });
        });
    }

    res.status(200).json({ message: "すべてのメッセージを既読にしました" });
  } catch (err) {
    console.error("Read all error:", err);
    res.status(500).json({ error: "既読の更新に失敗しました" });
  }
});

// 未読メッセージ数を取得
router.get("/unread/count", authenticate, async (req, res) => {
  try {
    const userId = req.user._id.toString();

    // ユーザーが参加している全会話を取得
    const conversations = await Conversation.find({
      members: req.user._id,
    });

    let totalUnread = 0;
    const unreadByConversation = {};

    for (const conv of conversations) {
      const count = conv.unreadCount.get(userId) || 0;
      totalUnread += count;
      unreadByConversation[conv._id] = count;
    }

    res.status(200).json({
      total: totalUnread,
      byConversation: unreadByConversation,
    });
  } catch (err) {
    console.error("Unread count error:", err);
    res.status(500).json({ error: "未読数の取得に失敗しました" });
  }
});

module.exports = router;
