const router = require("express").Router();
const Hashtag = require("../models/Hashtag");
const Post = require("../models/Post");

// Helper function to get today's date in YYYY-MM-DD format
const getTodayDate = () => {
    const today = new Date();
    return today.toISOString().split("T")[0];
};

// Helper function to extract hashtags from text (max 10 chars each)
const extractHashtags = (text) => {
    if (!text) return [];
    // Match # followed by 1-10 word characters (including Japanese)
    const regex = /#([\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]{1,10})/g;
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        matches.push(match[1].toLowerCase());
    }
    // Remove duplicates
    return [...new Set(matches)];
};

// Save hashtags from a post
const saveHashtags = async (text) => {
    const hashtags = extractHashtags(text);
    const today = getTodayDate();

    for (const tag of hashtags) {
        try {
            await Hashtag.findOneAndUpdate(
                { tag: tag, date: today },
                { $inc: { count: 1 } },
                { upsert: true, new: true }
            );
        } catch (err) {
            console.error("Error saving hashtag:", tag, err);
        }
    }

    return hashtags;
};

// GET /api/hashtags/trending - Get trending hashtags
router.get("/trending", async (req, res) => {
    try {
        const today = getTodayDate();

        // Get top 10 hashtags for today
        const trending = await Hashtag.find({ date: today })
            .sort({ count: -1 })
            .limit(10);

        // If no hashtags today, get from last 7 days
        if (trending.length === 0) {
            const lastWeek = new Date();
            lastWeek.setDate(lastWeek.getDate() - 7);
            const lastWeekStr = lastWeek.toISOString().split("T")[0];

            const weeklyTrending = await Hashtag.aggregate([
                { $match: { date: { $gte: lastWeekStr } } },
                { $group: { _id: "$tag", totalCount: { $sum: "$count" } } },
                { $sort: { totalCount: -1 } },
                { $limit: 10 },
            ]);

            return res.status(200).json(
                weeklyTrending.map((item, index) => ({
                    rank: index + 1,
                    tag: item._id,
                    count: item.totalCount,
                }))
            );
        }

        res.status(200).json(
            trending.map((item, index) => ({
                rank: index + 1,
                tag: item.tag,
                count: item.count,
            }))
        );
    } catch (err) {
        console.error("Error getting trending hashtags:", err);
        res.status(500).json(err);
    }
});

// GET /api/hashtags/search/:tag - Search posts by hashtag
router.get("/search/:tag", async (req, res) => {
    try {
        const tag = req.params.tag.toLowerCase();

        // Search posts containing this hashtag
        const posts = await Post.find({
            desc: { $regex: `#${tag}`, $options: "i" },
        })
            .populate("userId", "username profilePicture")
            .sort({ createdAt: -1 })
            .limit(50);

        res.status(200).json(posts);
    } catch (err) {
        console.error("Error searching hashtag:", err);
        res.status(500).json(err);
    }
});

// Export helper for use in post route
module.exports = router;
module.exports.saveHashtags = saveHashtags;
module.exports.extractHashtags = extractHashtags;
