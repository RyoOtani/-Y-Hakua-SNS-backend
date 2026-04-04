const router = require("express").Router();
const Hashtag = require("../models/Hashtag");
const Post = require("../models/Post");
const redisClient = require("../redisClient");

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const toJstDate = (date = new Date()) => new Date(date.getTime() + JST_OFFSET_MS);
const toUtcFromJstDate = (jstDate) => new Date(jstDate.getTime() - JST_OFFSET_MS);

const formatJstDateKey = (jstDate) => {
    const year = jstDate.getUTCFullYear();
    const month = String(jstDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(jstDate.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

// Helper function to get today's ranking date in YYYY-MM-DD (Japan time, reset at 0:00 AM)
const getTodayDate = () => formatJstDateKey(toJstDate());

const getTodayRangeUtc = (baseDate = new Date()) => {
    const nowJst = toJstDate(baseDate);
    const dayStartJst = new Date(nowJst);
    dayStartJst.setUTCHours(0, 0, 0, 0);
    const dayEndJst = new Date(dayStartJst.getTime() + DAY_MS);

    return {
        dateKey: formatJstDateKey(dayStartJst),
        startUtc: toUtcFromJstDate(dayStartJst),
        endUtc: toUtcFromJstDate(dayEndJst),
    };
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

            // Redisでも日次トレンド用ZSETを更新
            try {
                await redisClient.zIncrBy(`trending:${today}`, 1, tag);
                // 必要であればexpireを設定（例: 14日）
                await redisClient.expire(`trending:${today}`, 60 * 60 * 24 * 14);
            } catch (redisErr) {
                console.error("Redis hashtag incr error:", redisErr);
            }
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

        // 1. 今日のトレンドをRedisのZSETから取得
        try {
            const redisTrending = await redisClient.zRevRangeWithScores(
                `trending:${today}`,
                0,
                9
            );
            const normalizedTrending = (redisTrending || [])
                .map((item) => ({
                    tag: item?.value,
                    count: Math.max(0, Math.floor(Number(item?.score || 0))),
                }))
                .filter((item) => item.tag && item.count > 0);

            if (normalizedTrending.length > 0) {
                return res.status(200).json(
                    normalizedTrending.map((item, index) => ({
                        rank: index + 1,
                        tag: item.tag,
                        count: item.count,
                    }))
                );
            }
        } catch (redisErr) {
            console.error("Redis fetch error (trending hashtags):", redisErr);
        }

        // 2. Redisに無ければMongoDBから取得（従来通り）
        const trending = await Hashtag.find({ date: today })
            .sort({ count: -1 })
            .limit(10);

        // 「本日」ランキングは当日データのみ返す
        if (trending.length === 0) {
            return res.status(200).json([]);
        }

        // 3. Mongo結果をクライアントに返しつつRedisにもシード
        try {
            if (trending.length > 0) {
                const pipeline = redisClient.multi();
                pipeline.del(`trending:${today}`);
                trending.forEach((item) => {
                    pipeline.zAdd(`trending:${today}`, {
                        score: item.count,
                        value: item.tag,
                    });
                });
                pipeline.expire(`trending:${today}`, 60 * 60 * 24 * 14);
                await pipeline.exec();
            }
        } catch (seedErr) {
            console.error("Redis seed error (trending hashtags):", seedErr);
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
module.exports.getTodayDate = getTodayDate;
module.exports.getTodayRangeUtc = getTodayRangeUtc;