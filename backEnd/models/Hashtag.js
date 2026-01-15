const mongoose = require("mongoose");

const HashtagSchema = new mongoose.Schema(
    {
        tag: {
            type: String,
            required: true,
            maxlength: 10,
            index: true,
        },
        count: {
            type: Number,
            default: 1,
        },
        date: {
            type: String, // YYYY-MM-DD format for daily aggregation
            required: true,
            index: true,
        },
    },
    { timestamps: true }
);

// Compound index for efficient querying
HashtagSchema.index({ tag: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Hashtag", HashtagSchema);
