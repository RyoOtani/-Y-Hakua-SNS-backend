const User = require('../models/User');
const Notification = require('../models/Notification');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { getFirebaseAdmin } = require('./firebaseAdmin');

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

let batchedSchedulerStarted = false;
let batchedSchedulerTimer = null;
let batchedSchedulerInterval = null;

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

const toJstProxyDate = (date) => new Date(date.getTime() + JST_OFFSET_MS);

const getJstHourKey = (date) => {
  const jstDate = toJstProxyDate(date);
  const year = jstDate.getUTCFullYear();
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jstDate.getUTCDate()).padStart(2, '0');
  const hour = String(jstDate.getUTCHours()).padStart(2, '0');
  return `${year}-${month}-${day}-${hour}`;
};

const getDelayUntilNextJstHour = (from = new Date()) => {
  const nextHourJstProxy = toJstProxyDate(from);
  nextHourJstProxy.setUTCMinutes(0, 0, 0);
  nextHourJstProxy.setUTCHours(nextHourJstProxy.getUTCHours() + 1);

  const nextHourUtcMs = nextHourJstProxy.getTime() - JST_OFFSET_MS;
  return Math.max(1000, nextHourUtcMs - from.getTime());
};

const getRecentUnreadMessageCount = async ({ receiverId, since, until }) => {
  const conversations = await Conversation.find({ members: receiverId })
    .select('_id')
    .lean();

  if (!conversations.length) {
    return 0;
  }

  const conversationIds = conversations.map((conv) => conv._id);
  return Message.countDocuments({
    conversationId: { $in: conversationIds },
    sender: { $ne: receiverId },
    read: false,
    deletedAt: null,
    createdAt: { $gt: since, $lte: until },
  });
};

const sendPushToUser = async ({
  receiverId,
  title,
  body,
  data = {},
  forceImmediate = false,
}) => {
  if (!receiverId) {
    console.warn('[FCM] Skip send: receiverId is empty');
    return false;
  }

  const firebaseAdmin = getFirebaseAdmin();
  if (!firebaseAdmin) {
    console.warn('[FCM] Skip send: firebase admin is not initialized');
    return false;
  }

  try {
    const startedAt = Date.now();
    const receiver = await User.findById(receiverId).select('fcmToken notificationDeliveryMode');

    if (!forceImmediate && receiver?.notificationDeliveryMode === 'batched') {
      console.log(`[FCM] Skip immediate send: receiver=${receiverId} mode=batched`);
      return false;
    }

    const token = receiver?.fcmToken;
    if (!token) {
      console.warn(`[FCM] Skip send: no token for receiver ${receiverId}`);
      return false;
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
    return true;
  } catch (err) {
    const code = err?.errorInfo?.code || err?.code;

    if (code === 'messaging/registration-token-not-registered') {
      try {
        await User.findByIdAndUpdate(receiverId, { $set: { fcmToken: null } });
      } catch (cleanupErr) {
        console.error('[FCM] Failed to clear invalid token:', cleanupErr);
      }
      return false;
    }

    console.error('[FCM] send error:', err);
    return false;
  }
};

const runBatchedNotificationCycle = async (runAt = new Date()) => {
  const firebaseAdmin = getFirebaseAdmin();
  if (!firebaseAdmin) {
    console.warn('[FCM][BATCH] Skip cycle: firebase admin is not initialized');
    return;
  }

  try {
    const batchedUsers = await User.find({
      notificationDeliveryMode: 'batched',
      fcmToken: { $exists: true, $ne: null },
    }).select('_id lastBatchedNotificationSentAt');

    if (!batchedUsers.length) {
      return;
    }

    await Promise.allSettled(
      batchedUsers.map(async (user) => {
        const lastSentAt = user.lastBatchedNotificationSentAt;
        if (lastSentAt && getJstHourKey(lastSentAt) === getJstHourKey(runAt)) {
          return;
        }

        const since = lastSentAt
          ? new Date(lastSentAt)
          : new Date(runAt.getTime() - ONE_HOUR_MS);

        const [newNotifications, newUnreadMessages] = await Promise.all([
          Notification.countDocuments({
            receiver: user._id,
            isRead: false,
            createdAt: { $gt: since, $lte: runAt },
          }),
          getRecentUnreadMessageCount({ receiverId: user._id, since, until: runAt }),
        ]);

        const totalCount = newNotifications + newUnreadMessages;
        if (totalCount <= 0) {
          return;
        }

        const sent = await sendPushToUser({
          receiverId: user._id,
          title: 'まとめ通知',
          body:
            totalCount === 1
              ? 'この1時間で新しい通知が1件あります'
              : `この1時間で新しい通知が${totalCount}件あります`,
          data: {
            type: 'batched_notification',
            count: totalCount,
          },
          forceImmediate: true,
        });

        if (sent) {
          await User.findByIdAndUpdate(user._id, {
            $set: { lastBatchedNotificationSentAt: runAt },
          });
        }
      })
    );
  } catch (err) {
    console.error('[FCM][BATCH] Cycle error:', err);
  }
};

const startBatchedNotificationScheduler = () => {
  if (batchedSchedulerStarted) {
    return;
  }

  batchedSchedulerStarted = true;
  const initialDelay = getDelayUntilNextJstHour();

  batchedSchedulerTimer = setTimeout(() => {
    runBatchedNotificationCycle(new Date()).catch((err) => {
      console.error('[FCM][BATCH] Initial cycle error:', err);
    });

    batchedSchedulerInterval = setInterval(() => {
      runBatchedNotificationCycle(new Date()).catch((err) => {
        console.error('[FCM][BATCH] Interval cycle error:', err);
      });
    }, ONE_HOUR_MS);
  }, initialDelay);

  console.log(`[FCM][BATCH] Scheduler started. First run in ${Math.round(initialDelay / 1000)} seconds`);
};

module.exports = {
  sendPushToUser,
  startBatchedNotificationScheduler,
};
