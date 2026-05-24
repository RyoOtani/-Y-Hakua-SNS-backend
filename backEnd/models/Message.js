const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
    },
    // 返信情報（元メッセージの簡易スナップショット）
    replyTo: {
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
      },
      text: {
        type: String,
      },
      senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      senderName: {
        type: String,
      },
    },
    // 既読状態
    read: {
      type: Boolean,
      default: false,
    },
    // 既読日時
    readAt: {
      type: Date,
    },
    // 添付ファイル（画像・ファイルURL）
    attachments: [
      {
        type: {
          type: String,
          enum: ["image", "file"],
        },
        url: {
          type: String,
        },
        filename: {
          type: String,
        },
      },
    ],
    // メッセージリアクション（ユーザーごとに1つの絵文字）
    reactions: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        emoji: {
          type: String,
          required: true,
        },
        reactedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    moderationStatus: {
      type: String,
      enum: ["active", "hidden_by_reports"],
      default: "active",
    },
    moderationSummary: {
      reportedCount: {
        type: Number,
        default: 0,
      },
      lastReportedAt: {
        type: Date,
        default: null,
      },
    },
    // 論理削除用
    deletedAt: {
      type: Date,
      default: null,
    },
    // 編集済みフラグ
    edited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// 論理削除されていないメッセージのみ取得するインデックス
MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ sender: 1 });

module.exports = mongoose.model("Message", MessageSchema);