const LearningSession = require('../models/LearningSession');
const User = require('../models/User');
const redisClient = require('../redisClient');

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const BADGE_LOCK_TTL_SECONDS = 14 * 24 * 60 * 60;

let weeklyBadgeSchedulerStarted = false;
let weeklyBadgeSchedulerTimer = null;
let weeklyBadgeSchedulerInterval = null;

const getJstNow = (baseDate = new Date()) => new Date(baseDate.getTime() + JST_OFFSET_MS);

const formatJstDateKey = (jstDate = getJstNow()) => {
  const y = jstDate.getUTCFullYear();
  const m = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jstDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getWeekStartJst = (jstDate = getJstNow()) => {
  const weekStart = new Date(jstDate);
  const dayOfWeek = weekStart.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  weekStart.setUTCDate(weekStart.getUTCDate() - diffToMonday);
  weekStart.setUTCHours(0, 0, 0, 0);
  return weekStart;
};

const toUtcFromJstDate = (jstDate) => new Date(jstDate.getTime() - JST_OFFSET_MS);

const toMinuteFloor = (value) => Math.max(0, Math.floor(Number(value) || 0));

const getBadgeLockKey = (weekKey) => `learning:badge:awarded:week:${weekKey}`;

const getActiveLearningRankingBadge = (badge, now = new Date()) => {
  if (!badge || typeof badge !== 'object') {
    return null;
  }

  const expiresAt = badge.expiresAt ? new Date(badge.expiresAt) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    return null;
  }

  const rank = Number(badge.rank);
  if (![1, 2, 3].includes(rank)) {
    return null;
  }

  return {
    rank,
    weekStartKey: badge.weekStartKey || null,
    sourceWeekKey: badge.sourceWeekKey || null,
    totalMinutes: toMinuteFloor(badge.totalMinutes),
    awardedAt: badge.awardedAt || null,
    expiresAt,
  };
};

const clearExpiredLearningBadges = async (nowUtc = new Date()) => {
  await User.updateMany(
    {
      'learningRankingBadge.expiresAt': { $lte: nowUtc },
    },
    {
      $unset: { learningRankingBadge: '' },
    }
  );
};

const calculatePreviousWeekWinners = async (currentWeekStartJst) => {
  const previousWeekStartJst = new Date(currentWeekStartJst);
  previousWeekStartJst.setUTCDate(previousWeekStartJst.getUTCDate() - 7);

  const previousWeekStartUtc = toUtcFromJstDate(previousWeekStartJst);
  const currentWeekStartUtc = toUtcFromJstDate(currentWeekStartJst);

  const winners = await LearningSession.aggregate([
    {
      $match: {
        startTime: { $gte: previousWeekStartUtc, $lt: currentWeekStartUtc },
        isActive: false,
        duration: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: '$userId',
        totalMinutes: { $sum: '$duration' },
      },
    },
    { $sort: { totalMinutes: -1, _id: 1 } },
    { $limit: 3 },
  ]);

  return {
    winners,
    sourceWeekKey: formatJstDateKey(previousWeekStartJst),
  };
};

const applyWeeklyLearningBadges = async ({
  currentWeekKey,
  sourceWeekKey,
  winners,
  awardedAtUtc,
  expiresAtUtc,
}) => {
  const winnerIds = winners.map((winner) => String(winner._id));

  await User.updateMany(
    {
      'learningRankingBadge.weekStartKey': currentWeekKey,
      _id: { $nin: winnerIds },
    },
    {
      $unset: { learningRankingBadge: '' },
    }
  );

  await Promise.all(
    winners.map((winner, index) => {
      const rank = index + 1;
      return User.findByIdAndUpdate(winner._id, {
        $set: {
          learningRankingBadge: {
            rank,
            weekStartKey: currentWeekKey,
            sourceWeekKey,
            totalMinutes: toMinuteFloor(winner.totalMinutes),
            awardedAt: awardedAtUtc,
            expiresAt: expiresAtUtc,
          },
        },
      });
    })
  );
};

const ensureWeeklyLearningRankingBadges = async ({ now = new Date(), force = false } = {}) => {
  const nowUtc = new Date(now);
  const nowJst = getJstNow(nowUtc);
  const currentWeekStartJst = getWeekStartJst(nowJst);
  const currentWeekKey = formatJstDateKey(currentWeekStartJst);
  const lockKey = getBadgeLockKey(currentWeekKey);

  await clearExpiredLearningBadges(nowUtc);

  if (!force) {
    try {
      const alreadyAwarded = await redisClient.get(lockKey);
      if (alreadyAwarded) {
        return { awarded: false, weekKey: currentWeekKey, reason: 'already_awarded' };
      }
    } catch (err) {
      console.error('[LEARNING][BADGE] lock key read failed:', err);
    }
  }

  const { winners, sourceWeekKey } = await calculatePreviousWeekWinners(currentWeekStartJst);
  const currentWeekStartUtc = toUtcFromJstDate(currentWeekStartJst);
  const expiresAtUtc = new Date(currentWeekStartUtc.getTime() + WEEK_MS);

  await applyWeeklyLearningBadges({
    currentWeekKey,
    sourceWeekKey,
    winners,
    awardedAtUtc: nowUtc,
    expiresAtUtc,
  });

  try {
    await redisClient.set(lockKey, '1');
    await redisClient.expire(lockKey, BADGE_LOCK_TTL_SECONDS);
  } catch (err) {
    console.error('[LEARNING][BADGE] lock key write failed:', err);
  }

  return {
    awarded: true,
    weekKey: currentWeekKey,
    sourceWeekKey,
    winnerCount: winners.length,
  };
};

const getDelayUntilNextJstWeekStart = () => {
  const nowJst = getJstNow();
  const nextWeekStartJst = getWeekStartJst(nowJst);
  nextWeekStartJst.setUTCDate(nextWeekStartJst.getUTCDate() + 7);
  return Math.max(1000, nextWeekStartJst.getTime() - nowJst.getTime());
};

const startWeeklyLearningBadgeScheduler = () => {
  if (weeklyBadgeSchedulerStarted) {
    return;
  }

  weeklyBadgeSchedulerStarted = true;

  ensureWeeklyLearningRankingBadges().catch((err) => {
    console.error('[LEARNING][BADGE] startup ensure failed:', err);
  });

  const initialDelay = getDelayUntilNextJstWeekStart();
  weeklyBadgeSchedulerTimer = setTimeout(() => {
    ensureWeeklyLearningRankingBadges().catch((err) => {
      console.error('[LEARNING][BADGE] initial cycle failed:', err);
    });

    weeklyBadgeSchedulerInterval = setInterval(() => {
      ensureWeeklyLearningRankingBadges().catch((err) => {
        console.error('[LEARNING][BADGE] interval cycle failed:', err);
      });
    }, WEEK_MS);
  }, initialDelay);

  console.log(
    `[LEARNING][BADGE] Scheduler started. First weekly cycle in ${Math.round(initialDelay / 1000)} seconds`
  );
};

module.exports = {
  ensureWeeklyLearningRankingBadges,
  startWeeklyLearningBadgeScheduler,
  getActiveLearningRankingBadge,
};
