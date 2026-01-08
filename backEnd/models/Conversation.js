const mongoose = require("mongoose");

const ConversationSchema = new mongoose.Schema(
  {
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    // 最新メッセージの参照
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    // 最新メッセージのテキスト（リスト表示用のキャッシュ）
    lastMessageText: {
      type: String,
    },
    // 最新メッセージの日時
    lastMessageAt: {
      type: Date,
    },
    // 各メンバーごとの未読カウント
    unreadCount: {
      type: Map,
      of: Number,
      default: {},
    },
  },
  { timestamps: true }
);

// インデックス
ConversationSchema.index({ members: 1 });
ConversationSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model("Conversation", ConversationSchema);