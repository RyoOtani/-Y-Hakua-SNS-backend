const admin = require('firebase-admin');

const parsePrivateKey = (key) => {
  if (!key) return null;
  return key.replace(/\\n/g, '\n');
};

let initialized = false;

const hasFirebaseEnv = () => {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
  );
};

const initializeFirebaseAdmin = () => {
  if (initialized || admin.apps.length > 0) {
    initialized = true;
    return admin;
  }

  if (!hasFirebaseEnv()) {
    console.warn('[FCM] Firebase Admin env is not fully configured. Push delivery is disabled.');
    return null;
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    }),
  });

  initialized = true;
  return admin;
};

const getFirebaseAdmin = () => {
  if (!initialized) {
    return initializeFirebaseAdmin();
  }
  return admin.apps.length > 0 ? admin : null;
};

module.exports = {
  initializeFirebaseAdmin,
  getFirebaseAdmin,
};
