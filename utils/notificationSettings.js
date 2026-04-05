const NOTIFICATION_TYPES = ["like", "comment", "repost", "follow", "message", "new_post"];
const NOTIFICATION_DELIVERY_MODES = ["immediate", "batched"];

const DEFAULT_NOTIFICATION_SETTINGS = {
  like: true,
  comment: true,
  repost: true,
  follow: true,
  message: true,
  newPost: true,
};

const DEFAULT_NOTIFICATION_DELIVERY_MODE = "immediate";

const parseTypes = (value) => {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => NOTIFICATION_TYPES.includes(v));
};

const normalizeNotificationSettings = (prefs = {}) => {
  const normalized = { ...DEFAULT_NOTIFICATION_SETTINGS };
  Object.keys(DEFAULT_NOTIFICATION_SETTINGS).forEach((key) => {
    if (typeof prefs?.[key] === "boolean") {
      normalized[key] = prefs[key];
    }
  });
  return normalized;
};

const normalizeNotificationDeliveryMode = (mode) => {
  if (typeof mode === "string" && NOTIFICATION_DELIVERY_MODES.includes(mode)) {
    return mode;
  }
  return DEFAULT_NOTIFICATION_DELIVERY_MODE;
};

const buildSettingsResponse = (userDoc) => ({
  ...normalizeNotificationSettings(userDoc?.notificationPreferences || {}),
  notificationDeliveryMode: normalizeNotificationDeliveryMode(userDoc?.notificationDeliveryMode),
});

module.exports = {
  NOTIFICATION_TYPES,
  NOTIFICATION_DELIVERY_MODES,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_NOTIFICATION_DELIVERY_MODE,
  parseTypes,
  normalizeNotificationSettings,
  normalizeNotificationDeliveryMode,
  buildSettingsResponse,
};