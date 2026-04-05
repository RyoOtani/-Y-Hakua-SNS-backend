const router = require("express").Router();
const Notification = require("../models/Notification");
const User = require("../models/User");
const redisClient = require("../redisClient");
const { authenticate } = require("../middleware/auth");
const {
    NOTIFICATION_DELIVERY_MODES,
    DEFAULT_NOTIFICATION_SETTINGS,
    parseTypes,
    buildSettingsResponse,
} = require("../utils/notificationSettings");

// Get notifications for authenticated user (Redis優先読み込み)
router.get("/", authenticate, async (req, res) => {
    const userId = req.user._id.toString();
    const requestedTypes = parseTypes(req.query.types);
    const hasTypeFilter = requestedTypes.length > 0;

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
                if (hasTypeFilter) {
                    notifications = notifications.filter((item) =>
                        requestedTypes.includes(item?.type)
                    );
                }
                return res.status(200).json(notifications);
            }
        } catch (redisErr) {
            console.error("Redis fetch error (notifications):", redisErr);
        }

        // 2. Redisに無ければMongoDBから取得し、Redisへシード
        const query = { receiver: req.user._id };
        if (hasTypeFilter) {
            query.type = { $in: requestedTypes };
        }

        notifications = await Notification.find(query)
            .populate("sender", "username profilePicture")
            .populate("post", "desc img")
            .sort({ createdAt: -1 })
            .limit(50);

        // Mongoの結果をRedisへ保存（将来の読み取りを高速化）
        if (!hasTypeFilter && notifications.length > 0) {
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

// Get unread notification count for authenticated user
router.get('/unread-count', authenticate, async (req, res) => {
    const userId = req.user._id.toString();

    try {
        try {
            const cached = await redisClient.lRange(`notifications:${userId}`, 0, 49);
            if (cached && cached.length > 0) {
                const unreadCount = cached.reduce((count, item) => {
                    try {
                        const parsed = JSON.parse(item);
                        return parsed?.isRead === false ? count + 1 : count;
                    } catch (err) {
                        return count;
                    }
                }, 0);

                return res.status(200).json({ unreadCount });
            }
        } catch (redisErr) {
            console.error('Redis fetch error (notification unread count):', redisErr);
        }

        const unreadCount = await Notification.countDocuments({
            receiver: req.user._id,
            isRead: false,
        });

        return res.status(200).json({ unreadCount });
    } catch (err) {
        console.error('Notification unread-count error:', err);
        return res.status(500).json({ error: '未読通知数の取得に失敗しました' });
    }
});

// Get notification settings for authenticated user
router.get("/settings", authenticate, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select("notificationPreferences notificationDeliveryMode");
        const settings = buildSettingsResponse(user);
        return res.status(200).json(settings);
    } catch (err) {
        console.error("Notification settings fetch error:", err);
        return res.status(500).json({ error: "通知設定の取得に失敗しました" });
    }
});

// Update notification settings for authenticated user
router.put("/settings", authenticate, async (req, res) => {
    try {
        const allowedKeys = Object.keys(DEFAULT_NOTIFICATION_SETTINGS);
        const updates = {};

        allowedKeys.forEach((key) => {
            if (typeof req.body?.[key] === "boolean") {
                updates[`notificationPreferences.${key}`] = req.body[key];
            }
        });

        if (req.body?.notificationDeliveryMode !== undefined) {
            if (
                typeof req.body.notificationDeliveryMode !== "string" ||
                !NOTIFICATION_DELIVERY_MODES.includes(req.body.notificationDeliveryMode)
            ) {
                return res
                    .status(400)
                    .json({ error: "notificationDeliveryModeはimmediateまたはbatchedで指定してください" });
            }

            updates.notificationDeliveryMode = req.body.notificationDeliveryMode;
            if (req.body.notificationDeliveryMode === "immediate") {
                updates.lastBatchedNotificationSentAt = null;
            } else {
                updates.lastBatchedNotificationSentAt = new Date();
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: "更新可能な通知設定がありません" });
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { $set: updates },
            { new: true }
        );

        const settings = buildSettingsResponse(user);
        return res.status(200).json(settings);
    } catch (err) {
        console.error("Notification settings update error:", err);
        return res.status(500).json({ error: "通知設定の更新に失敗しました" });
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
