const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidProfileTag,
  ALL_PROFILE_TAGS,
} = require('../constants/profileTags');

test('community admin bulk only accepts official profile tags', () => {
  assert.equal(isValidProfileTag('猫好き'), true);
  assert.equal(isValidProfileTag('独自タグ'), false);
  assert.ok(ALL_PROFILE_TAGS.length >= 10);
});
