const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseBoolean,
  getAiServiceStatus,
  setAiServiceEnabled,
} = require('../utils/aiServiceControl');

test('parseBoolean handles common truthy and falsy values', () => {
  assert.equal(parseBoolean('true'), true);
  assert.equal(parseBoolean('1'), true);
  assert.equal(parseBoolean('off'), false);
  assert.equal(parseBoolean('0'), false);
  assert.equal(parseBoolean('unknown', true), true);
});

test('setAiServiceEnabled updates runtime status and metadata', () => {
  const previous = getAiServiceStatus().runtimeEnabled;

  const disabled = setAiServiceEnabled({
    enabled: false,
    changedBy: 'tester-user-id',
    reason: 'incident response',
  });

  assert.equal(disabled.runtimeEnabled, false);
  assert.equal(disabled.lastChangedBy, 'tester-user-id');
  assert.equal(disabled.lastReason, 'incident response');
  assert.ok(disabled.lastChangedAt instanceof Date);

  const restored = setAiServiceEnabled({ enabled: previous, changedBy: 'tester-user-id' });
  assert.equal(restored.runtimeEnabled, previous);
});
