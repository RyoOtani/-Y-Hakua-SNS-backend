const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isEmailBlocked,
  getEmailBlockState,
} = require('../utils/emailBlock');

const originalBlocklist = process.env.APP_EMAIL_BLOCKLIST;

test.after(() => {
  if (typeof originalBlocklist === 'undefined') {
    delete process.env.APP_EMAIL_BLOCKLIST;
  } else {
    process.env.APP_EMAIL_BLOCKLIST = originalBlocklist;
  }
});

test('isEmailBlocked returns true for env blocklist email', () => {
  process.env.APP_EMAIL_BLOCKLIST = 'blocked@example.com';

  assert.equal(isEmailBlocked({ email: 'blocked@example.com' }), true);
  assert.equal(isEmailBlocked({ email: 'other@example.com' }), false);
});

test('isEmailBlocked returns true for admin user-level block', () => {
  delete process.env.APP_EMAIL_BLOCKLIST;

  assert.equal(isEmailBlocked({ user: { email: 'user@example.com', emailBlockActive: true } }), true);
  assert.equal(isEmailBlocked({ user: { email: 'user@example.com', emailBlockActive: false } }), false);
});

test('getEmailBlockState merges env and admin sources', () => {
  process.env.APP_EMAIL_BLOCKLIST = 'blocked@example.com';

  const mergedState = getEmailBlockState({
    email: 'blocked@example.com',
    emailBlockActive: true,
    emailBlockReason: 'policy',
    emailBlockedBy: '507f191e810c19729de860ea',
    emailBlockedAt: '2026-01-01T00:00:00.000Z',
  });

  assert.equal(mergedState.active, true);
  assert.equal(mergedState.envBlocked, true);
  assert.equal(mergedState.adminBlocked, true);
  assert.equal(mergedState.source, 'env_and_admin');
  assert.equal(mergedState.reason, 'policy');
  assert.equal(mergedState.blockedBy, '507f191e810c19729de860ea');
  assert.equal(mergedState.blockedAt, '2026-01-01T00:00:00.000Z');
});
