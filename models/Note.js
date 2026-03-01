const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: true,
      maxlength: 60,
    },
    // 24時間後に自動削除（MongoDB TTL index）
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

// 1ユーザーにつき1つのアクティブノートのみ
noteSchema.index({ userId: 1 });

module.exports = mongoose.model('Note', noteSchema);
