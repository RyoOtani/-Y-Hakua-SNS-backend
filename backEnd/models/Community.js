const mongoose = require('mongoose');

const CommunitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      max: 50,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      max: 50,
    },
    description: {
      type: String,
      max: 500,
      default: '',
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    members: {
      type: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      }],
      default: [],
    },
    tags: {
      type: [String],
      default: [],
    },
    tagFilter: {
      type: String,
      default: null,
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
    allowAnonymousPosts: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

CommunitySchema.index({ tagFilter: 1 });
CommunitySchema.index({ members: 1 });

module.exports = mongoose.model('Community', CommunitySchema);
