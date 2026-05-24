const ModerationReport = require('../models/ModerationReport');
const User = require('../models/User');

const REPORT_TARGET_TYPES = Object.freeze({
  POST: 'post',
  COMMENT: 'comment',
  MESSAGE: 'message',
});

const ALLOWED_REPORT_REASONS = new Set([
  'spam',
  'harassment',
  'hate',
  'violence',
  'sexual',
  'fraud',
  'other',
]);

const parseThreshold = Number.parseInt(process.env.MODERATION_AUTO_HIDE_THRESHOLD || '3', 10);
const AUTO_HIDE_REPORT_THRESHOLD = Number.isFinite(parseThreshold) && parseThreshold >= 2
  ? parseThreshold
  : 3;

const normalizeReportReason = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ALLOWED_REPORT_REASONS.has(normalized) ? normalized : 'other';
};

const normalizeReportDetails = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 500);
};

const normalizeSafetyActions = (input = {}) => {
  const autoMute = input?.autoMute !== false;
  const autoBlock = input?.autoBlock === true;

  return {
    autoMute,
    autoBlock,
  };
};

const createModerationReport = async ({
  targetType,
  targetId,
  targetOwnerId,
  reporterId,
  reason,
  details,
  safetyActions,
}) => {
  try {
    const report = await ModerationReport.create({
      targetType,
      targetId,
      targetOwnerId,
      reporterId,
      reason,
      details,
      actions: {
        autoMuted: safetyActions.autoMute,
        autoBlocked: safetyActions.autoBlock,
      },
    });
    return { report, duplicate: false };
  } catch (err) {
    if (err?.code === 11000) {
      return { report: null, duplicate: true };
    }
    throw err;
  }
};

const applyReporterSafetyActions = async ({ reporterId, targetOwnerId, safetyActions }) => {
  const reporter = reporterId?.toString?.() || String(reporterId || '');
  const targetOwner = targetOwnerId?.toString?.() || String(targetOwnerId || '');

  if (!reporter || !targetOwner || reporter === targetOwner) {
    return { muted: false, blocked: false };
  }

  const addToSet = {};
  if (safetyActions.autoMute) {
    addToSet.mutedUsers = targetOwnerId;
  }
  if (safetyActions.autoBlock) {
    addToSet.blockedUsers = targetOwnerId;
  }

  if (Object.keys(addToSet).length === 0) {
    return { muted: false, blocked: false };
  }

  await User.findByIdAndUpdate(reporterId, { $addToSet: addToSet });

  return {
    muted: Boolean(safetyActions.autoMute),
    blocked: Boolean(safetyActions.autoBlock),
  };
};

const countReportsForTarget = async (targetType, targetId) => {
  return ModerationReport.countDocuments({ targetType, targetId });
};

const syncTargetModerationState = async ({ targetDoc, reportCount }) => {
  if (!targetDoc) {
    return {
      hidden: false,
      hiddenNow: false,
      reportCount,
      threshold: AUTO_HIDE_REPORT_THRESHOLD,
    };
  }

  const shouldHide = reportCount >= AUTO_HIDE_REPORT_THRESHOLD;
  const wasHidden = targetDoc.moderationStatus === 'hidden_by_reports';

  targetDoc.moderationSummary = {
    ...(targetDoc.moderationSummary || {}),
    reportedCount: reportCount,
    lastReportedAt: new Date(),
  };

  if (shouldHide) {
    targetDoc.moderationStatus = 'hidden_by_reports';
  }

  if (!targetDoc.moderationStatus) {
    targetDoc.moderationStatus = 'active';
  }

  await targetDoc.save();

  return {
    hidden: targetDoc.moderationStatus === 'hidden_by_reports',
    hiddenNow: !wasHidden && targetDoc.moderationStatus === 'hidden_by_reports',
    reportCount,
    threshold: AUTO_HIDE_REPORT_THRESHOLD,
  };
};

module.exports = {
  REPORT_TARGET_TYPES,
  AUTO_HIDE_REPORT_THRESHOLD,
  normalizeReportReason,
  normalizeReportDetails,
  normalizeSafetyActions,
  createModerationReport,
  applyReporterSafetyActions,
  countReportsForTarget,
  syncTargetModerationState,
};
