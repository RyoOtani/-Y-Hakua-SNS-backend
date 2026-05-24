const { isAppEmailBlocked } = require('./appEmailAllowlist');

const EMAIL_BLOCKED_CODE = 'EMAIL_BLOCKED';
const EMAIL_BLOCKED_MESSAGE = 'このアカウントは利用停止中です';

const normalizeEmailBlockReason = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isAdminEmailBlocked = (user) => Boolean(user?.emailBlockActive);

const isEmailBlocked = ({ email, user } = {}) => {
  const envBlocked = isAppEmailBlocked(email || user?.email);
  if (envBlocked) return true;
  return isAdminEmailBlocked(user);
};

const toIsoOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
};

const getEmailBlockState = (user) => {
  const envBlocked = isAppEmailBlocked(user?.email);
  const adminBlocked = isAdminEmailBlocked(user);
  const active = envBlocked || adminBlocked;

  return {
    active,
    source: envBlocked && adminBlocked ? 'env_and_admin' : envBlocked ? 'env' : adminBlocked ? 'admin' : null,
    envBlocked,
    adminBlocked,
    reason: adminBlocked ? normalizeEmailBlockReason(user?.emailBlockReason) : null,
    blockedBy: adminBlocked && user?.emailBlockedBy ? String(user.emailBlockedBy) : null,
    blockedAt: adminBlocked ? toIsoOrNull(user?.emailBlockedAt) : null,
  };
};

module.exports = {
  EMAIL_BLOCKED_CODE,
  EMAIL_BLOCKED_MESSAGE,
  normalizeEmailBlockReason,
  isAdminEmailBlocked,
  isEmailBlocked,
  getEmailBlockState,
};
