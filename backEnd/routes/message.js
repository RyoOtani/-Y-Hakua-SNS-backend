const router = require("express").Router();
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");

// メッセージ追加
router.post("/", async (req, res) => {
  try {
    const { conversationId, sender, text, attachments } = req.body;

    const newMessage = new Message({
      conversationId,
      sender,
      text,
      attachments: attachments || [],
    });

    const savedMessage = await newMessage.save();

    // 送信者の情報を取得（UI表示用）
    const populatedMessage = await Message.findById(savedMessage._id).populate("sender", "username profilePicture");

    // 会話の最新メッセージを更新
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      conversation.lastMessage = savedMessage._id;
      conversation.lastMessageText = text;
      conversation.lastMessageAt = savedMessage.createdAt;

      // 送信者以外のメンバーの未読カウントを増やす
      conversation.members.forEach((memberId) => {
        if (memberId.toString() !== sender) {
          const currentCount = conversation.unreadCount.get(memberId.toString()) || 0;
          conversation.unreadCount.set(memberId.toString(), currentCount + 1);
        }
      });

      await conversation.save();
    }

    res.status(201).json(populatedMessage);
  } catch (err) {
    console.error("Message create error:", err);
    res.status(500).json({ error: "メッセージの送信に失敗しました" });
  }
});

// 会話内のメッセージ取得
router.get("/:conversationId", async (req, res) => {
  try {
    const messages = await Message.find({
      conversationId: req.params.conversationId,
      deletedAt: null, // 論理削除されていないメッセージのみ
    })
      .populate("sender", "username profilePicture")
      .sort({ createdAt: 1 });

    res.status(200).json(messages);
  } catch (err) {
    console.error("Message fetch error:", err);
    res.status(500).json({ error: "メッセージの取得に失敗しました" });
  }
});

// メッセージ編集
router.put("/:messageId", async (req, res) => {
  try {
    const { text, userId } = req.body;
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ error: "メッセージが見つかりません" });
    }

    // 送信者のみ編集可能
    if (message.sender.toString() !== userId) {
      return res.status(403).json({ error: "このメッセージを編集する権限がありません" });
    }

    message.text = text;
    message.edited = true;
    message.editedAt = new Date();

    const updatedMessage = await message.save();

    // 会話の最新メッセージも更新（最新メッセージの場合）
    const conversation = await Conversation.findById(message.conversationId);
    if (conversation && conversation.lastMessage?.toString() === message._id.toString()) {
      conversation.lastMessageText = text;
      await conversation.save();
    }

    res.status(200).json(updatedMessage);
  } catch (err) {
    console.error("Message edit error:", err);
    res.status(500).json({ error: "メッセージの編集に失敗しました" });
  }
});

// メッセージ削除（論理削除）
router.delete("/:messageId", async (req, res) => {
  try {
    const { userId } = req.body;
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ error: "メッセージが見つかりません" });
    }

    // 送信者のみ削除可能
    if (message.sender.toString() !== userId) {
      return res.status(403).json({ error: "このメッセージを削除する権限がありません" });
    }

    message.deletedAt = new Date();
    await message.save();

    // 会話の最新メッセージを更新（削除されたメッセージが最新だった場合）
    const conversation = await Conversation.findById(message.conversationId);
    if (conversation && conversation.lastMessage?.toString() === message._id.toString()) {
      // 次に新しいメッセージを探す
      const lastActiveMessage = await Message.findOne({
        conversationId: message.conversationId,
        deletedAt: null,
      }).sort({ createdAt: -1 });

      if (lastActiveMessage) {
        conversation.lastMessage = lastActiveMessage._id;
        conversation.lastMessageText = lastActiveMessage.text;
        conversation.lastMessageAt = lastActiveMessage.createdAt;
      } else {
        conversation.lastMessage = null;
        conversation.lastMessageText = null;
        conversation.lastMessageAt = null;
      }
      await conversation.save();
    }

    res.status(200).json({ message: "メッセージを削除しました" });
  } catch (err) {
    console.error("Message delete error:", err);
    res.status(500).json({ error: "メッセージの削除に失敗しました" });
  }
});

// 単一メッセージを既読にする
router.put("/:messageId/read", async (req, res) => {
  try {
    const { userId } = req.body;
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ error: "メッセージが見つかりません" });
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
router.put("/read-all/:conversationId", async (req, res) => {
  try {
    const { userId } = req.body;
    const { conversationId } = req.params;

    // 送信者以外が既読にする
    await Message.updateMany(
      {
        conversationId,
        sender: { $ne: userId },
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

    // 会話の未読カウントをリセット
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      conversation.unreadCount.set(userId, 0);
      await conversation.save();
    }

    res.status(200).json({ message: "すべてのメッセージを既読にしました" });
  } catch (err) {
    console.error("Read all error:", err);
    res.status(500).json({ error: "既読の更新に失敗しました" });
  }
});

// 未読メッセージ数を取得
router.get("/unread/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // ユーザーが参加している全会話を取得
    const conversations = await Conversation.find({
      members: userId,
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
