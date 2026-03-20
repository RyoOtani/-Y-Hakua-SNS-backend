const User = require('../models/User');
const Notification = require('../models/Notification');
const Conversation = require('../models/Conversation');
const { getFirebaseAdmin } = require('./firebaseAdmin');

const getUnreadBadgeCount = async (receiverId) => {
  const [unreadNotifications, conversations] = await Promise.all([
    Notification.countDocuments({ receiver: receiverId, isRead: false }),
    Conversation.find({ members: receiverId }).select('unreadCount').lean(),
  ]);

  const userId = String(receiverId);
  const unreadMessages = conversations.reduce((total, conv) => {
    const map = conv?.unreadCount;
    if (!map) return total;

    // Mongoose Map can appear as plain object in lean() results.
    const count = typeof map.get === 'function' ? map.get(userId) : map[userId];
    return total + (Number(count) || 0);
  }, 0);

  return unreadNotifications + unreadMessages;
};

const sendPushToUser = async ({
  receiverId,
  title,
  body,
  data = {},
}) => {
  if (!receiverId) {
    console.warn('[FCM] Skip send: receiverId is empty');
    return;
  }

  const firebaseAdmin = getFirebaseAdmin();
  if (!firebaseAdmin) {
    console.warn('[FCM] Skip send: firebase admin is not initialized');
    return;
  }

  try {
    const startedAt = Date.now();
    const receiver = await User.findById(receiverId).select('fcmToken');
    const token = receiver?.fcmToken;
    if (!token) {
      console.warn(`[FCM] Skip send: no token for receiver ${receiverId}`);
      return;
    }

    const dataPayload = Object.entries(data).reduce((acc, [key, value]) => {
      acc[key] = value == null ? '' : String(value);
      return acc;
    }, {});

    const badgeCount = await getUnreadBadgeCount(receiverId);

    const messageId = await firebaseAdmin.messaging().send({
      token,
      notification: {
        title,
        body,
      },
      data: dataPayload,
      android: {
        priority: 'high',
        ttl: 60 * 1000,
        notification: {
          sound: 'default',
        },
      },
      apns: {
        headers: {
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-expiration': '0',
        },
        payload: {
          aps: {
            sound: 'default',
            badge: badgeCount,
          },
        },
      },
    });

    console.log(
      `[FCM] Sent push messageId=${messageId} receiver=${receiverId} badge=${badgeCount} elapsedMs=${Date.now() - startedAt}`
    );
  } catch (err) {
    const code = err?.errorInfo?.code || err?.code;

    if (code === 'messaging/registration-token-not-registered') {
      try {
        await User.findByIdAndUpdate(receiverId, { $set: { fcmToken: null } });
      } catch (cleanupErr) {
        console.error('[FCM] Failed to clear invalid token:', cleanupErr);
      }
      return;
    }

    console.error('[FCM] send error:', err);
  }
};

module.exports = {
  sendPushToUser,
};
