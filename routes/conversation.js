const router = require("express").Router();
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { authenticate } = require("../middleware/auth");

// 新規会話作成
router.post("/", authenticate, async (req, res) => {
  try {
    const senderId = req.user._id;
    const { receiverId, memberIds, groupName } = req.body;

    const normalizedMemberIds = Array.isArray(memberIds)
      ? memberIds.map((id) => id?.toString()).filter(Boolean)
      : [];

    const membersSet = new Set([
      senderId.toString(),
      ...(receiverId ? [receiverId.toString()] : []),
      ...normalizedMemberIds,
    ]);
    const members = Array.from(membersSet);

    if (members.length < 2) {
      return res.status(400).json({ error: "会話メンバーが不足しています" });
    }

    const isGroup = members.length > 2;

    // 1対1会話は既存会話を再利用
    if (!isGroup) {
      const existingConversation = await Conversation.findOne({
        members: { $all: members },
        $expr: { $eq: [{ $size: "$members" }, 2] },
      });

      if (existingConversation) {
        return res.status(200).json(existingConversation);
      }
    }

    // 新規会話作成
    const unreadCount = new Map(members.map((id) => [id, 0]));
    const newConversation = new Conversation({
      members,
      isGroup,
      groupName: isGroup ? (groupName || "").trim().slice(0, 60) : undefined,
      unreadCount,
    });

    const savedConversation = await newConversation.save();
    res.status(201).json(savedConversation);
  } catch (err) {
    console.error("Conversation create error:", err);
    res.status(500).json({ error: "会話の作成に失敗しました" });
  }
});

// ログインユーザーの全会話を取得（メンバー情報付き）
router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    const conversations = await Conversation.find({
      members: { $in: [userId] },
    })
      .populate("members", "username profilePicture")
      .populate("lastMessage")
      .sort({ lastMessageAt: -1 });

    const conversationsWithUnread = conversations.map((conv) => ({
      ...conv.toObject(),
      myUnreadCount: conv.unreadCount?.get(userId.toString()) || 0,
    }));

    res.status(200).json(conversationsWithUnread);
  } catch (err) {
    console.error("Conversation fetch error:", err);
    res.status(500).json({ error: "会話の取得に失敗しました" });
  }
});

// 特定の2ユーザー間の会話を取得
router.get("/find/:secondUserId", authenticate, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      members: { $all: [req.user._id, req.params.secondUserId] },
    })
      .populate("members", "username profilePicture")
      .populate("lastMessage");

    res.status(200).json(conversation);
  } catch (err) {
    console.error("Conversation find error:", err);
    res.status(500).json({ error: "会話の取得に失敗しました" });
  }
});

// 会話削除
router.delete("/:conversationId", authenticate, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const conversation = await Conversation.findById(req.params.conversationId);

    if (!conversation) {
      return res.status(404).json({ error: "会話が見つかりません" });
    }

    // メンバーのみ削除可能
    if (!conversation.members.some((m) => m.toString() === userId)) {
      return res.status(403).json({ error: "この会話を削除する権限がありません" });
    }

    // 会話内の全メッセージを物理削除
    await Message.deleteMany({ conversationId: req.params.conversationId });

    // 会話を削除
    await Conversation.findByIdAndDelete(req.params.conversationId);

    res.status(200).json({ message: "会話を削除しました" });
  } catch (err) {
    console.error("Conversation delete error:", err);
    res.status(500).json({ error: "会話の削除に失敗しました" });
  }
});

// 全体の未読メッセージ数を取得
router.get("/unread-total", authenticate, async (req, res) => {
  try {
    const userId = req.user._id.toString();

    const conversations = await Conversation.find({
      members: req.user._id,
    });

    let totalUnread = 0;
    for (const conv of conversations) {
      totalUnread += conv.unreadCount?.get(userId) || 0;
    }

    res.status(200).json({ total: totalUnread });
  } catch (err) {
    console.error("Unread total error:", err);
    res.status(500).json({ error: "未読数の取得に失敗しました" });
  }
});

// 全会話の未読メッセージを既読にする（通知閲覧時の整合用）
router.put('/unread-clear-all', authenticate, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const conversations = await Conversation.find({ members: req.user._id });
    const conversationIds = conversations.map((c) => c._id);

    if (conversationIds.length > 0) {
      await Message.updateMany(
        {
          conversationId: { $in: conversationIds },
          sender: { $ne: req.user._id },
          read: false,
          deletedAt: null,
        },
        {
          $set: {
            read: true,
            readAt: new Date(),
          },
        }
      );
    }

    await Promise.all(
      conversations.map(async (conv) => {
        conv.unreadCount.set(userId, 0);
        await conv.save();
      })
    );

    res.status(200).json({ message: '全会話の未読をクリアしました' });
  } catch (err) {
    console.error('Unread clear-all error:', err);
    res.status(500).json({ error: '未読クリアに失敗しました' });
  }
});

// メッセージ追加（後方互換性のため維持）
router.post("/message", authenticate, async (req, res) => {
  try {
    const sender = req.user._id;
    const { conversationId, text, attachments } = req.body;

    // 会話メンバーシップの確認
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.members.map(m => m.toString()).includes(sender.toString())) {
      return res.status(403).json({ error: "この会話にメッセージを送る権限がありません" });
    }

    const newMessage = new Message({
      conversationId,
      sender,
      text,
      attachments: attachments || [],
    });
    const savedMessage = await newMessage.save();

    // 会話の最新メッセージを更新
    conversation.lastMessage = savedMessage._id;
    conversation.lastMessageText = text;
    conversation.lastMessageAt = savedMessage.createdAt;

    // 送信者以外の未読カウントを増やす
    conversation.members.forEach((memberId) => {
      if (memberId.toString() !== sender.toString()) {
        const currentCount = conversation.unreadCount.get(memberId.toString()) || 0;
        conversation.unreadCount.set(memberId.toString(), currentCount + 1);
      }
    });

    await conversation.save();

    res.status(201).json(savedMessage);
  } catch (err) {
    console.error("Message create error:", err);
    res.status(500).json({ error: "メッセージの送信に失敗しました" });
  }
});

// メッセージ取得（後方互換性のため維持）
router.get("/message/:conversationId", authenticate, async (req, res) => {
  try {
    // 会話メンバーシップの確認
    const conversation = await Conversation.findById(req.params.conversationId);
    if (!conversation || !conversation.members.map(m => m.toString()).includes(req.user._id.toString())) {
      return res.status(403).json({ error: "この会話を閲覧する権限がありません" });
    }

    const messages = await Message.find({
      conversationId: req.params.conversationId,
      deletedAt: null,
    })
      .populate("sender", "username profilePicture")
      .sort({ createdAt: 1 })
      .limit(100);

    res.status(200).json(messages);
  } catch (err) {
    console.error("Message fetch error:", err);
    res.status(500).json({ error: "メッセージの取得に失敗しました" });
  }
});

module.exports = router;