const mongoose = require("mongoose");

const CommentSchema = new Schema({
    userId: {
        type: String,
      required: true,
    },
    postId
})