const DEFAULT_GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

const parseBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const hardDisabledByEnv = parseBoolean(process.env.AI_KILL_SWITCH, false);
const defaultRuntimeEnabled = parseBoolean(process.env.AI_SERVICE_ENABLED, true);

let runtimeEnabled = defaultRuntimeEnabled;
let lastChangedAt = null;
let lastChangedBy = null;
let lastReason = null;

const getAiServiceStatus = () => {
  const groqConfigured = typeof process.env.GROQ_API_KEY === 'string' && process.env.GROQ_API_KEY.trim().length > 0;
  const effectiveEnabled = !hardDisabledByEnv && runtimeEnabled && groqConfigured;

  return {
    provider: 'groq',
    model: DEFAULT_GROQ_MODEL,
    hardDisabledByEnv,
    runtimeEnabled,
    groqConfigured,
    effectiveEnabled,
    lastChangedAt,
    lastChangedBy,
    lastReason,
  };
};

const isAiServiceEnabled = () => getAiServiceStatus().effectiveEnabled;

const setAiServiceEnabled = ({ enabled, changedBy = null, reason = null }) => {
  runtimeEnabled = Boolean(enabled);
  lastChangedAt = new Date();
  lastChangedBy = changedBy ? String(changedBy) : null;
  lastReason = typeof reason === 'string' && reason.trim().length > 0
    ? reason.trim().slice(0, 200)
    : null;

  return getAiServiceStatus();
};

module.exports = {
  parseBoolean,
  getAiServiceStatus,
  isAiServiceEnabled,
  setAiServiceEnabled,
};
