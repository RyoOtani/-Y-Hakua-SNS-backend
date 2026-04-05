const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseTypes,
  normalizeNotificationSettings,
  normalizeNotificationDeliveryMode,
  buildSettingsResponse,
} = require("../utils/notificationSettings");

test("parseTypes keeps only supported notification types", () => {
  assert.deepEqual(parseTypes("like,comment,unknown,new_post"), ["like", "comment", "new_post"]);
  assert.deepEqual(parseTypes(undefined), []);
});

test("normalizeNotificationSettings merges defaults and booleans", () => {
  const normalized = normalizeNotificationSettings({ like: false, message: false, bad: true });
  assert.equal(normalized.like, false);
  assert.equal(normalized.message, false);
  assert.equal(normalized.comment, true);
  assert.equal(normalized.newPost, true);
});

test("normalizeNotificationDeliveryMode falls back to immediate", () => {
  assert.equal(normalizeNotificationDeliveryMode("batched"), "batched");
  assert.equal(normalizeNotificationDeliveryMode("invalid"), "immediate");
});

test("buildSettingsResponse returns merged settings contract", () => {
  const response = buildSettingsResponse({
    notificationPreferences: { follow: false, repost: false },
    notificationDeliveryMode: "batched",
  });

  assert.equal(response.follow, false);
  assert.equal(response.repost, false);
  assert.equal(response.like, true);
  assert.equal(response.notificationDeliveryMode, "batched");
});