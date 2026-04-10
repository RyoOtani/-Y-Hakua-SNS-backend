const YAPPY_TRIGGER_PATTERN = /[#＃]\s*[@＠]\s*yappy\b/i;

const shouldTriggerYappyReply = (text) => {
  const normalized = String(text || '');
  return YAPPY_TRIGGER_PATTERN.test(normalized);
};

module.exports = {
  YAPPY_TRIGGER_PATTERN,
  shouldTriggerYappyReply,
};
