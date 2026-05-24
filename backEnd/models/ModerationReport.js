const mongoose = require('mongoose');

const moderationReportSchema = new mongoose.Schema(
  {
    targetType: {
      type: String,
      enum: ['post', 'comment', 'message'],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    targetOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      enum: ['spam', 'harassment', 'hate', 'violence', 'sexual', 'fraud', 'other'],
      default: 'other',
    },
    details: {
      type: String,
      default: '',
      maxlength: 500,
    },
    actions: {
      autoMuted: {
        type: Boolean,
        default: true,
      },
      autoBlocked: {
        type: Boolean,
        default: false,
      },
    },
    status: {
      type: String,
      enum: ['submitted', 'reviewed', 'dismissed'],
      default: 'submitted',
    },
  },
  { timestamps: true }
);

moderationReportSchema.index(
  { targetType: 1, targetId: 1, reporterId: 1 },
  { unique: true }
);
moderationReportSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

module.exports = mongoose.model('ModerationReport', moderationReportSchema);
