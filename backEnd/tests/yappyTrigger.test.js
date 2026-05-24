const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldTriggerYappyReply } = require('../utils/yappyTrigger');

test('shouldTriggerYappyReply detects #Yappy tags', () => {
  assert.equal(shouldTriggerYappyReply('これは #Yappy へのメンションです'), true);
  assert.equal(shouldTriggerYappyReply('これは ＃Yappy でも反応します'), true);
  assert.equal(shouldTriggerYappyReply('これは #yappy でも反応します'), true);
});

test('shouldTriggerYappyReply keeps #@Yappy compatibility', () => {
  assert.equal(shouldTriggerYappyReply('これは #@Yappy へのメンションです'), true);
  assert.equal(shouldTriggerYappyReply('これは ＃＠Yappy でも反応します'), true);
  assert.equal(shouldTriggerYappyReply('これは #@yappy でも反応します'), true);
});

test('shouldTriggerYappyReply ignores normal text', () => {
  assert.equal(shouldTriggerYappyReply('ただの投稿です'), false);
  assert.equal(shouldTriggerYappyReply('@Yappy だけでは反応しない'), false);
});
