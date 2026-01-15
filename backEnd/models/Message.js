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