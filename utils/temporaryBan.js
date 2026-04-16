const TEMPORARY_BAN_CODE = 'TEMPORARY_BAN';
const TEMPORARY_BAN_MESSAGE = 'このアカウントは一時停止中です';
const TEMPORARY_BAN_LOGIN_ERROR = 'temporarily_banned';

const normalizeTemporaryBanReason = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toValidDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date;
};

const getActiveTemporaryBan = (user, now = new Date()) => {
  const until = toValidDate(user?.temporaryBanUntil);
  if (!until) return null;
  if (until.getTime() <= now.getTime()) return null;

  return {
    until,
    untilIso: until.toISOString(),
    reason: normalizeTemporaryBanReason(user?.temporaryBanReason),
  };
};

const buildTemporaryBanResponse = (temporaryBan) => ({
  error: TEMPORARY_BAN_MESSAGE,
  code: TEMPORARY_BAN_CODE,
  temporaryBanUntil: temporaryBan?.untilIso || null,
  temporaryBanReason: temporaryBan?.reason || null,
});

module.exports = {
  TEMPORARY_BAN_CODE,
  TEMPORARY_BAN_MESSAGE,
  TEMPORARY_BAN_LOGIN_ERROR,
  normalizeTemporaryBanReason,
  getActiveTemporaryBan,
  buildTemporaryBanResponse,
};
