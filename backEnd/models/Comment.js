const mongoose = require("mongoose");

const CommentSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    desc: {
      type: String,
      max: 500,
    },
    img: {
      type: String,
    },
    moderationStatus: {
      type: String,
      enum: ['active', 'hidden_by_reports'],
      default: 'active',
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
  },
  { timestamps: true }
);

module.exports = mongoose.model("Comment", CommentSchema);
