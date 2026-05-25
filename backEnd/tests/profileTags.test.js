const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALL_PROFILE_TAGS,
  MAX_PROFILE_TAGS,
  isValidProfileTag,
} = require('../constants/profileTags');

test('profile tag catalog includes core communities', () => {
  assert.ok(ALL_PROFILE_TAGS.includes('猫好き'));
  assert.ok(ALL_PROFILE_TAGS.includes('犬好き'));
  assert.equal(MAX_PROFILE_TAGS, 12);
});

test('isValidProfileTag rejects unknown tags', () => {
  assert.equal(isValidProfileTag('猫好き'), true);
  assert.equal(isValidProfileTag('存在しないタグ'), false);
});
