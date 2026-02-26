const User = require('../models/User');
const { getFirebaseAdmin } = require('./firebaseAdmin');

const sendPushToUser = async ({
  receiverId,
  title,
  body,
  data = {},
}) => {
  if (!receiverId) return;

  const firebaseAdmin = getFirebaseAdmin();
  if (!firebaseAdmin) return;

  try {
    const receiver = await User.findById(receiverId).select('fcmToken');
    const token = receiver?.fcmToken;
    if (!token) return;

    const dataPayload = Object.entries(data).reduce((acc, [key, value]) => {
      acc[key] = value == null ? '' : String(value);
      return acc;
    }, {});

    await firebaseAdmin.messaging().send({
      token,
      notification: {
        title,
        body,
      },
      data: dataPayload,
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    });
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
