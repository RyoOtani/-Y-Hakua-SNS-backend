const mongoose = require('mongoose');

const CommunityTopicSchema = new mongoose.Schema(
  {
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    body: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    postMode: {
      type: String,
      enum: ['community', 'anonymous'],
      default: 'community',
    },
    anonymousLabel: {
      type: String,
      default: '',
      maxlength: 20,
    },
    replyCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastReplyAt: {
      type: Date,
      default: null,
    },
    moderationStatus: {
      type: String,
      enum: ['active', 'hidden_by_reports'],
      default: 'active',
    },
  },
  { timestamps: true }
);

CommunityTopicSchema.index({ communityId: 1, createdAt: -1 });
CommunityTopicSchema.index({ communityId: 1, lastReplyAt: -1 });

module.exports = mongoose.model('CommunityTopic', CommunityTopicSchema);
