const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeEmail,
  normalizeDomain,
  parseEmailAllowlist,
  parseEmailDomainAllowlist,
  isAppEmailRestrictionEnabled,
  isAppEmailAllowed,
} = require('../utils/appEmailAllowlist');

const originalAllowlist = process.env.APP_EMAIL_ALLOWLIST;
const originalDomainAllowlist = process.env.APP_EMAIL_DOMAIN_ALLOWLIST;

test.after(() => {
  if (typeof originalAllowlist === 'undefined') {
    delete process.env.APP_EMAIL_ALLOWLIST;
  } else {
    process.env.APP_EMAIL_ALLOWLIST = originalAllowlist;
  }

  if (typeof originalDomainAllowlist === 'undefined') {
    delete process.env.APP_EMAIL_DOMAIN_ALLOWLIST;
  } else {
    process.env.APP_EMAIL_DOMAIN_ALLOWLIST = originalDomainAllowlist;
  }
});

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  USER@Example.COM '), 'user@example.com');
});

test('normalizeDomain trims and removes leading symbols', () => {
  assert.equal(normalizeDomain('  @.Hitachi1-H.ibk.ed.jp  '), 'hitachi1-h.ibk.ed.jp');
});

test('parseEmailAllowlist extracts valid entries', () => {
  assert.deepEqual(
    parseEmailAllowlist(' alice@example.com, hitachi1-h.ibk.ed.jp,BOB@example.com '),
    ['alice@example.com', 'bob@example.com']
  );
});

test('parseEmailDomainAllowlist extracts valid domain entries', () => {
  assert.deepEqual(
    parseEmailDomainAllowlist(' @hitachi1-h.ibk.ed.jp, .school.jp '),
    ['hitachi1-h.ibk.ed.jp', 'school.jp']
  );
});

test('isAppEmailAllowed allows all when restriction is not enabled', () => {
  delete process.env.APP_EMAIL_ALLOWLIST;
  delete process.env.APP_EMAIL_DOMAIN_ALLOWLIST;
  assert.equal(isAppEmailRestrictionEnabled(), false);
  assert.equal(isAppEmailAllowed('someone@example.com'), true);
  assert.equal(isAppEmailAllowed(''), true);
});

test('isAppEmailAllowed requires exact allowlist match when enabled', () => {
  process.env.APP_EMAIL_ALLOWLIST = 'alice@example.com,bob@example.com';
  delete process.env.APP_EMAIL_DOMAIN_ALLOWLIST;
  assert.equal(isAppEmailRestrictionEnabled(), true);
  assert.equal(isAppEmailAllowed('Alice@Example.com'), true);
  assert.equal(isAppEmailAllowed('carol@example.com'), false);
  assert.equal(isAppEmailAllowed(''), false);
});

test('isAppEmailAllowed supports domain allowlist matching', () => {
  delete process.env.APP_EMAIL_ALLOWLIST;
  process.env.APP_EMAIL_DOMAIN_ALLOWLIST = 'hitachi1-h.ibk.ed.jp';

  assert.equal(isAppEmailRestrictionEnabled(), true);
  assert.equal(isAppEmailAllowed('student@hitachi1-h.ibk.ed.jp'), true);
  assert.equal(isAppEmailAllowed('STUDENT@HITACHI1-H.IBK.ED.JP'), true);
  assert.equal(isAppEmailAllowed('teacher@other.ed.jp'), false);
});

test('isAppEmailAllowed supports both exact and domain entries together', () => {
  process.env.APP_EMAIL_ALLOWLIST = 'admin@example.com,hitachi1-h.ibk.ed.jp';
  delete process.env.APP_EMAIL_DOMAIN_ALLOWLIST;

  assert.equal(isAppEmailAllowed('admin@example.com'), true);
  assert.equal(isAppEmailAllowed('student@hitachi1-h.ibk.ed.jp'), true);
  assert.equal(isAppEmailAllowed('guest@example.com'), false);
});
