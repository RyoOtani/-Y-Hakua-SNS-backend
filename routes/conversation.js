const router = require("express").Router();
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

// 新規会話作成
router.post("/", async (req, res) => {
  try {
    const { senderId, receiverId } = req.body;

    // 既存の会話があるか確認
    const existingConversation = await Conversation.findOne({
      members: { $all: [senderId, receiverId] },
    });

    if (existingConversation) {
      return res.status(200).json(existingConversation);
    }

    // 新規会話作成
    const newConversation = new Conversation({
      members: [senderId, receiverId],
      unreadCount: new Map([
        [senderId, 0],
        [receiverId, 0],
      ]),
    });

    const savedConversation = await newConversation.save();
    res.status(201).json(savedConversation);
  } catch (err) {
    console.error("Conversation create error:", err);
    res.status(500).json({ error: "会話の作成に失敗しました" });
  }
});

// ユーザーの全会話を取得（メンバー情報付き）
router.get("/:userId", async (req, res) => {
  try {
    const conversations = await Conversation.find({
      members: { $in: [req.params.userId] },
    })
      .populate("members", "username profilePicture")
      .populate("lastMessage")
      .sort({ lastMessageAt: -1 }); // 最新メッセージ順

    // 各会話に未読カウントを追加
    const conversationsWithUnread = conversations.map((conv) => ({
      ...conv.toObject(),
      myUnreadCount: conv.unreadCount?.get(req.params.userId) || 0,
    }));

    res.status(200).json(conversationsWithUnread);
  } catch (err) {
    console.error("Conversation fetch error:", err);
    res.status(500).json({ error: "会話の取得に失敗しました" });
  }
});

// 特定の2ユーザー間の会話を取得
router.get("/find/:firstUserId/:secondUserId", async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      members: { $all: [req.params.firstUserId, req.params.secondUserId] },
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
router.delete("/:conversationId", async (req, res) => {
  try {
    const { userId } = req.body;
    const conversation = await Conversation.findById(req.params.conversationId);

    if (!conversation) {
      return res.status(404).json({ error: "会話が見つかりません" });
    }

    // メンバーのみ削除可能
    if (!conversation.members.some((m) => m.toString() === userId)) {
      return res.status(403).json({ error: "この会話を削除する権限がありません" });
    }

    // 会話内の全メッセージを論理削除
    await Message.updateMany(
      { conversationId: req.params.conversationId },
      { $set: { deletedAt: new Date() } }
    );

    // 会話を削除
    await Conversation.findByIdAndDelete(req.params.conversationId);

    res.status(200).json({ message: "会話を削除しました" });
  } catch (err) {
    console.error("Conversation delete error:", err);
    res.status(500).json({ error: "会話の削除に失敗しました" });
  }
});

// 全体の未読メッセージ数を取得
router.get("/unread-total/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const conversations = await Conversation.find({
      members: userId,
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

// メッセージ追加（後方互換性のため維持）
router.post("/message", async (req, res) => {
  try {
    const newMessage = new Message(req.body);
    const savedMessage = await newMessage.save();

    // 会話の最新メッセージを更新
    const conversation = await Conversation.findById(req.body.conversationId);
    if (conversation) {
      conversation.lastMessage = savedMessage._id;
      conversation.lastMessageText = req.body.text;
      conversation.lastMessageAt = savedMessage.createdAt;

      // 送信者以外の未読カウントを増やす
      conversation.members.forEach((memberId) => {
        if (memberId.toString() !== req.body.sender) {
          const currentCount = conversation.unreadCount.get(memberId.toString()) || 0;
          conversation.unreadCount.set(memberId.toString(), currentCount + 1);
        }
      });

      await conversation.save();
    }

    res.status(201).json(savedMessage);
  } catch (err) {
    console.error("Message create error:", err);
    res.status(500).json({ error: "メッセージの送信に失敗しました" });
  }
});

// メッセージ取得（後方互換性のため維持）
router.get("/message/:conversationId", async (req, res) => {
  try {
    const messages = await Message.find({
      conversationId: req.params.conversationId,
      deletedAt: null,
    })
      .populate("sender", "username profilePicture")
      .sort({ createdAt: 1 });

    res.status(200).json(messages);
  } catch (err) {
    console.error("Message fetch error:", err);
    res.status(500).json({ error: "メッセージの取得に失敗しました" });
  }
});

module.exports = router;