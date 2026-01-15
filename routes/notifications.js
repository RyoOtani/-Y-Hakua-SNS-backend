const router = require("express").Router();
const Notification = require("../models/Notification");

// Get notifications for a user
router.get("/:userId", async (req, res) => {
    try {
        const notifications = await Notification.find({ receiver: req.params.userId })
            .populate("sender", "username profilePicture")
            .populate("post", "desc img") // Optional: populate post details if needed
            .sort({ createdAt: -1 });
        res.status(200).json(notifications);
    } catch (err) {
        res.status(500).json(err);
    }
});

// Mark notification as read
router.put("/:id/read", async (req, res) => {
    try {
        const notification = await Notification.findByIdAndUpdate(
            req.params.id,
            { isRead: true },
            { new: true }
        );
        res.status(200).json(notification);
    } catch (err) {
        res.status(500).json(err);
    }
});

// Mark ALL notifications as read for a user
router.put("/read-all/:userId", async (req, res) => {
    try {
        await Notification.updateMany(
            { receiver: req.params.userId, isRead: false },
            { $set: { isRead: true } }
        );
        res.status(200).json("All notifications marked as read");
    } catch (err) {
        res.status(500).json(err);
    }
});

module.exports = router;
