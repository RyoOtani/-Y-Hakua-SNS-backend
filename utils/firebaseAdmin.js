const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const parsePrivateKey = (key) => {
  if (!key) return null;

  let normalized = String(key).trim();

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }

  normalized = normalized.replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\r/g, '');

  if (normalized.includes('-----BEGIN PRIVATE KEY-----')) {
    return normalized;
  }

  // Fallback for base64-encoded PEM in env vars.
  try {
    const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim();
    if (decoded.includes('-----BEGIN PRIVATE KEY-----')) {
      return decoded.replace(/\r/g, '');
    }
  } catch (_) {
    // Ignore decode errors and return original value.
  }

  return normalized;
};

let initialized = false;

const getServiceAccountFromEnv = () => {
  if (!hasFirebaseEnv()) return null;

  return {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
  };
};

const getServiceAccountCandidatePaths = () => {
  const candidates = [];
  const explicitPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (explicitPath) {
    candidates.push(path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(process.cwd(), explicitPath));
  }

  // Prefer canonical Firebase Admin key if present.
  candidates.push(path.resolve(process.cwd(), '../hakuasns-mern-firebase-adminsdk-fbsvc-61e2432266.json'));
  candidates.push(path.resolve(process.cwd(), 'hakuaSNScrossaccountKey.json'));

  return candidates;
};

const getServiceAccountFromFile = () => {
  const candidatePaths = getServiceAccountCandidatePaths();

  for (const serviceAccountPath of candidatePaths) {
    if (!fs.existsSync(serviceAccountPath)) continue;

    try {
      const raw = fs.readFileSync(serviceAccountPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        continue;
      }

      return {
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
      };
    } catch (err) {
      console.error('[FCM] Failed to parse service account JSON:', err?.message || err);
    }
  }

  return null;
};

const allowFileCredentials = () => {
  if (process.env.FIREBASE_ALLOW_FILE_CREDENTIALS === 'true') return true;
  return process.env.NODE_ENV !== 'production';
};

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

  const serviceAccountFromEnv = getServiceAccountFromEnv();
  const serviceAccountFromFile = allowFileCredentials()
    ? getServiceAccountFromFile()
    : null;
  const serviceAccount = serviceAccountFromEnv || serviceAccountFromFile;

  if (!serviceAccountFromEnv && !allowFileCredentials()) {
    console.warn('[FCM] File-based Firebase credentials are disabled in production. Set FIREBASE_* env vars.');
  }

  if (!serviceAccount) {
    console.warn('[FCM] Firebase Admin credentials are not configured. Push delivery is disabled.');
    return null;
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
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
