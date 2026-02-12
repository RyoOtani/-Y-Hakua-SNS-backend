const router = require("express").Router();
const Notification = require("../models/Notification");
const redisClient = require("../redisClient");
const { authenticate } = require("../middleware/auth");

// Get notifications for authenticated user (Redis優先読み込み)
router.get("/", authenticate, async (req, res) => {
    const userId = req.user._id.toString();

    try {
        let notifications = [];

        // 1. Redis から取得（存在すればそのまま返す）
        try {
            const cached = await redisClient.lRange(
                `notifications:${userId}`,
                0,
                49
            );
            if (cached && cached.length > 0) {
                notifications = cached.map((item) => JSON.parse(item));
                return res.status(200).json(notifications);
            }
        } catch (redisErr) {
            console.error("Redis fetch error (notifications):", redisErr);
        }

        // 2. Redisに無ければMongoDBから取得し、Redisへシード
        notifications = await Notification.find({ receiver: req.user._id })
            .populate("sender", "username profilePicture")
            .populate("post", "desc img")
            .sort({ createdAt: -1 })
            .limit(50);

        // Mongoの結果をRedisへ保存（将来の読み取りを高速化）
        if (notifications.length > 0) {
            try {
                const pipeline = redisClient.multi();
                pipeline.del(`notifications:${userId}`);
                notifications.forEach((n) => {
                    pipeline.lPush(
                        `notifications:${userId}`,
                        JSON.stringify(n)
                    );
                });
                pipeline.lTrim(`notifications:${userId}`, 0, 49);
                await pipeline.exec();
            } catch (seedErr) {
                console.error("Redis seed error (notifications):", seedErr);
            }
        }

        res.status(200).json(notifications);
    } catch (err) {
        console.error("Notification fetch error:", err);
        res.status(500).json({ error: "通知の取得に失敗しました" });
    }
});

// Mark notification as read
router.put("/:id/read", authenticate, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id);
        if (!notification) {
            return res.status(404).json({ error: "通知が見つかりません" });
        }

        // 自分の通知のみ既読にできる
        if (notification.receiver.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: "この通知にアクセスする権限がありません" });
        }

        notification.isRead = true;
        await notification.save();

        // Redis 側もできるだけ整合させる（ベストエフォート）
        const userId = req.user._id.toString();
        try {
            const cached = await redisClient.lRange(
                `notifications:${userId}`,
                0,
                -1
            );
            if (cached && cached.length > 0) {
                const updatedList = cached.map((item) => {
                    const parsed = JSON.parse(item);
                    if (
                        parsed._id &&
                        parsed._id.toString() === notification._id.toString()
                    ) {
                        parsed.isRead = true;
                    }
                    return JSON.stringify(parsed);
                });

                const pipeline = redisClient.multi();
                pipeline.del(`notifications:${userId}`);
                updatedList.forEach((v) =>
                    pipeline.lPush(`notifications:${userId}`, v)
                );
                pipeline.lTrim(`notifications:${userId}`, 0, 49);
                await pipeline.exec();
            }
        } catch (redisErr) {
            console.error("Redis sync error (notification read):", redisErr);
        }

        res.status(200).json(notification);
    } catch (err) {
        console.error("Notification read error:", err);
        res.status(500).json({ error: "既読の更新に失敗しました" });
    }
});

// Mark ALL notifications as read for authenticated user
router.put("/read-all", authenticate, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        await Notification.updateMany(
            { receiver: req.user._id, isRead: false },
            { $set: { isRead: true } }
        );

        // Redis 側は一旦破棄し、次回取得時にMongoから再シードさせる
        try {
            await redisClient.del(`notifications:${userId}`);
        } catch (redisErr) {
            console.error("Redis sync error (notification read-all):", redisErr);
        }

        res.status(200).json({ message: "全ての通知を既読にしました" });
    } catch (err) {
        console.error("Notification read-all error:", err);
        res.status(500).json({ error: "既読の更新に失敗しました" });
    }
});

module.exports = router;
