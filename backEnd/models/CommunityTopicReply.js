const mongoose = require('mongoose');

const CommunityTopicReplySchema = new mongoose.Schema(
  {
    topicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CommunityTopic',
      required: true,
      index: true,
    },
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
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
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
    moderationStatus: {
      type: String,
      enum: ['active', 'hidden_by_reports'],
      default: 'active',
    },
  },
  { timestamps: true }
);

CommunityTopicReplySchema.index({ topicId: 1, createdAt: 1 });

module.exports = mongoose.model('CommunityTopicReply', CommunityTopicReplySchema);
