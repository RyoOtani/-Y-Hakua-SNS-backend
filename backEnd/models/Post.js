const mongoose = require("mongoose");

const PostSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // username: {
    //   type:String,

    // },
    desc: {
      type: String,
      max: 500,
      required: true,
    },
    img: {
      type: String,
    },
    video: {
      type: String,
    },
    file: {
      type: String,
    },
    likes: {
      type: Array,
      default: [],
    },
    comment: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Post", PostSchema);