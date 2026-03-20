const User = require('../models/User');
const { getFirebaseAdmin } = require('./firebaseAdmin');

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

    const messageId = await firebaseAdmin.messaging().send({
      token,
      notification: {
        title,
        body,
      },
      data: dataPayload,
      apns: {
        headers: {
          'apns-push-type': 'alert',
          'apns-priority': '10',
        },
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    });

    console.log(`[FCM] Sent push messageId=${messageId} receiver=${receiverId}`);
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
