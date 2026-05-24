const mongoose = require('mongoose');

const CommunitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 60,
    },
    description: {
      type: String,
      default: '',
      maxlength: 200,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    tags: {
      type: [String],
      default: [],
    },
    // Optional: restrict community membership/conversations to users having this profile tag
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

CommunitySchema.index({ slug: 1 });
CommunitySchema.index({ ownerId: 1, createdAt: -1 });

module.exports = mongoose.model('Community', CommunitySchema);