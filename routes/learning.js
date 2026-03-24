const router = require('express').Router();
const LearningSession = require('../models/LearningSession');
const LearningGoal = require('../models/LearningGoal');
const User = require('../models/User');
const redisClient = require('../redisClient');
const { authenticate } = require('../middleware/auth');

// Redis client (falls back to mock when env vars are missing)
const redis = redisClient;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const getJstNow = () => new Date(Date.now() + JST_OFFSET_MS);

const getWeekStartJst = (jstDate = getJstNow()) => {
    const weekStart = new Date(jstDate);
    const day = weekStart.getUTCDay(); // JST時刻をUTCメソッドで扱う
    const diffToMonday = day === 0 ? -6 : 1 - day;
    weekStart.setUTCDate(weekStart.getUTCDate() + diffToMonday);
    weekStart.setUTCHours(0, 0, 0, 0);
    return weekStart;
};

const toUtcFromJstDate = (jstDate) => new Date(jstDate.getTime() - JST_OFFSET_MS);

const getWeeklyRankingKey = () => {
    const weekStartJst = getWeekStartJst();
    const y = weekStartJst.getUTCFullYear();
    const m = String(weekStartJst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(weekStartJst.getUTCDate()).padStart(2, '0');
    return `learning:ranking:weekly:${y}-${m}-${d}`;
};

// =====================================
// 学習セッション関連のエンドポイント
// =====================================

// 学習セッション開始
router.post('/sessions/start', authenticate, async (req, res) => {
    try {
        const userId = req.user._id;
        const { subject } = req.body;

        // 既にアクティブなセッションがあるかチェック
        const existingSession = await LearningSession.findOne({
            userId,
            isActive: true,
        });

        if (existingSession) {
            return res.status(400).json({
                message: '既にアクティブな学習セッションがあります',
                session: existingSession,
            });
        }

        const newSession = new LearningSession({
            userId,
            subject: subject || '',
            startTime: new Date(),
            isActive: true,
        });

        const savedSession = await newSession.save();
        res.status(201).json(savedSession);
    } catch (err) {
        console.error('Error starting learning session:', err);
        res.status(500).json({ message: 'セッション開始に失敗しました' });
    }
});

// 学習セッション終了
router.post('/sessions/stop', authenticate, async (req, res) => {
    try {
        const userId = req.user._id;
        const elapsedSeconds = Number(req.body?.elapsedSeconds || 0);

        const session = await LearningSession.findOne({
            userId,
            isActive: true,
        });

        if (!session) {
            return res.status(404).json({ message: 'アクティブなセッションがありません' });
        }

        const endTime = new Date();
        const serverDuration = Math.round((endTime - session.startTime) / 1000 / 60);
        const clientDuration = elapsedSeconds > 0 ? Math.round(elapsedSeconds / 60) : 0;
        const duration = Math.max(serverDuration, clientDuration, 0);

        session.endTime = endTime;
        session.duration = duration;
        session.isActive = false;

        const updatedSession = await session.save();

        // Redisの週間ランキングを更新
        try {
            const rankingKey = getWeeklyRankingKey();
            await redis.zIncrBy(rankingKey, duration, userId.toString());
        } catch (redisErr) {
            console.error('Redis ranking update failed:', redisErr);
        }

        res.status(200).json(updatedSession);
    } catch (err) {
        console.error('Error stopping learning session:', err);
        res.status(500).json({ message: 'セッション終了に失敗しました' });
    }
});

// 学習進捗を同期（モバイル側の定期送信用）
router.put('/sessions/progress', authenticate, async (req, res) => {
    try {
        const userId = req.user._id;
        const elapsedSeconds = Number(req.body?.elapsedSeconds || 0);

        if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
            return res.status(400).json({ message: 'elapsedSeconds は0以上の数値が必要です' });
        }

        const session = await LearningSession.findOne({
            userId,
            isActive: true,
        });

        if (!session) {
            return res.status(404).json({ message: 'アクティブなセッションがありません' });
        }

        session.duration = Math.max(session.duration || 0, Math.round(elapsedSeconds / 60));
        await session.save();

        return res.status(200).json({ message: '進捗を同期しました' });
    } catch (err) {
        console.error('Error syncing learning progress:', err);
        return res.status(500).json({ message: '進捗同期に失敗しました' });
    }
});

// アクティブなセッションを取得
router.get('/sessions/active', authenticate, async (req, res) => {
    try {
        const session = await LearningSession.findOne({
            userId: req.user._id,
            isActive: true,
        });

        res.status(200).json(session);
    } catch (err) {
        console.error('Error fetching active session:', err);
        res.status(500).json({ message: 'セッション取得に失敗しました' });
    }
});

// セッション一覧取得（日付範囲指定可能）
router.get('/sessions', authenticate, async (req, res) => {
    try {
        const { startDate, endDate, limit } = req.query;
        const query = { userId: req.user._id, isActive: false };

        if (startDate || endDate) {
            query.startTime = {};
            if (startDate) query.startTime.$gte = new Date(startDate);
            if (endDate) query.startTime.$lte = new Date(endDate);
        }

        const sessions = await LearningSession.find(query)
            .sort({ startTime: -1 })
            .limit(Math.min(parseInt(limit) || 50, 100));

        res.status(200).json(sessions);
    } catch (err) {
        console.error('Error fetching sessions:', err);
        res.status(500).json({ message: 'セッション一覧取得に失敗しました' });
    }
});

// =====================================
// 統計関連のエンドポイント
// =====================================

// 統計データを取得
router.get('/stats', authenticate, async (req, res) => {
    try {
        const userId = req.user._id;
        const now = new Date();

        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);

        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);

        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const [todayStats, weekStats, monthStats, totalStats] = await Promise.all([
            LearningSession.aggregate([
                {
                    $match: {
                        userId: userId,
                        startTime: { $gte: todayStart },
                        isActive: false,
                    },
                },
                { $group: { _id: null, totalMinutes: { $sum: '$duration' } } },
            ]),
            LearningSession.aggregate([
                {
                    $match: {
                        userId: userId,
                        startTime: { $gte: weekStart },
                        isActive: false,
                    },
                },
                { $group: { _id: null, totalMinutes: { $sum: '$duration' } } },
            ]),
            LearningSession.aggregate([
                {
                    $match: {
                        userId: userId,
                        startTime: { $gte: monthStart },
                        isActive: false,
                    },
                },
                { $group: { _id: null, totalMinutes: { $sum: '$duration' } } },
            ]),
            LearningSession.aggregate([
                {
                    $match: {
                        userId: userId,
                        isActive: false,
                    },
                },
                { $group: { _id: null, totalMinutes: { $sum: '$duration' } } },
            ]),
        ]);

        // 日別の統計（過去7日間）
        const dailyStats = await LearningSession.aggregate([
            {
                $match: {
                    userId: userId,
                    startTime: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
                    isActive: false,
                },
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime' } },
                    totalMinutes: { $sum: '$duration' },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        const activeSession = await LearningSession.findOne({
            userId,
            isActive: true,
        }).select('startTime duration');

        let activeMinutes = 0;
        if (activeSession) {
            const fromStart = Math.round((Date.now() - new Date(activeSession.startTime).getTime()) / 1000 / 60);
            activeMinutes = Math.max(fromStart, activeSession.duration || 0);
        }

        const result = {
            today: todayStats[0]?.totalMinutes || 0,
            week: weekStats[0]?.totalMinutes || 0,
            month: monthStats[0]?.totalMinutes || 0,
            total: totalStats[0]?.totalMinutes || 0,
            dailyStats,
        };

        if (activeSession && activeMinutes > 0) {
            const activeStart = new Date(activeSession.startTime);
            if (activeStart >= todayStart) result.today += activeMinutes;
            if (activeStart >= weekStart) result.week += activeMinutes;
            if (activeStart >= monthStart) result.month += activeMinutes;
            result.total += activeMinutes;
        }

        res.status(200).json(result);
    } catch (err) {
        console.error('Error fetching stats:', err);
        res.status(500).json({ message: '統計データ取得に失敗しました' });
    }
});

// =====================================
// ストリーク関連のエンドポイント
// =====================================

// ストリーク情報を取得
router.get('/streak', authenticate, async (req, res) => {
    try {
        const userId = req.user._id;

        // 過去100日間の学習日を取得
        const learningDays = await LearningSession.aggregate([
            {
                $match: {
                    userId: userId,
                    isActive: false,
                },
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime' } },
                },
            },
            { $sort: { _id: -1 } },
            { $limit: 100 },
        ]);

        const dates = learningDays.map((d) => d._id).sort().reverse();

        // 現在のストリークを計算
        let currentStreak = 0;
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0];

        if (dates.length > 0 && (dates[0] === today || dates[0] === yesterday)) {
            currentStreak = 1;
            for (let i = 1; i < dates.length; i++) {
                const prevDate = new Date(dates[i - 1]);
                const currDate = new Date(dates[i]);
                const diffDays = Math.round(
                    (prevDate - currDate) / (1000 * 60 * 60 * 24)
                );

                if (diffDays === 1) {
                    currentStreak++;
                } else {
                    break;
                }
            }
        }

        // 最長ストリークを計算
        let longestStreak = 0;
        let tempStreak = 1;
        const sortedDates = [...dates].sort();

        for (let i = 1; i < sortedDates.length; i++) {
            const prevDate = new Date(sortedDates[i - 1]);
            const currDate = new Date(sortedDates[i]);
            const diffDays = Math.round(
                (currDate - prevDate) / (1000 * 60 * 60 * 24)
            );

            if (diffDays === 1) {
                tempStreak++;
            } else {
                longestStreak = Math.max(longestStreak, tempStreak);
                tempStreak = 1;
            }
        }
        longestStreak = Math.max(longestStreak, tempStreak);

        if (dates.length === 0) {
            longestStreak = 0;
        }

        res.status(200).json({
            currentStreak,
            longestStreak,
            learningDates: dates.slice(0, 30),
        });
    } catch (err) {
        console.error('Error fetching streak:', err);
        res.status(500).json({ message: 'ストリーク情報取得に失敗しました' });
    }
});

// =====================================
// 目標関連のエンドポイント
// =====================================

// 目標を取得
router.get('/goals', authenticate, async (req, res) => {
    try {
        const goals = await LearningGoal.find({
            userId: req.user._id,
            isActive: true,
        });

        res.status(200).json(goals);
    } catch (err) {
        console.error('Error fetching goals:', err);
        res.status(500).json({ message: '目標取得に失敗しました' });
    }
});

// 目標を設定/更新
router.post('/goals', authenticate, async (req, res) => {
    try {
        const userId = req.user._id;
        const { type, targetMinutes } = req.body;

        if (!type || !targetMinutes || targetMinutes <= 0) {
            return res.status(400).json({ message: '目標タイプと目標時間は必須です' });
        }

        const goal = await LearningGoal.findOneAndUpdate(
            { userId, type },
            { userId, type, targetMinutes, isActive: true },
            { upsert: true, new: true }
        );

        res.status(200).json(goal);
    } catch (err) {
        console.error('Error setting goal:', err);
        res.status(500).json({ message: '目標設定に失敗しました' });
    }
});

// 目標を削除
router.delete('/goals/:id', authenticate, async (req, res) => {
    try {
        const goal = await LearningGoal.findById(req.params.id);
        if (!goal) {
            return res.status(404).json({ message: '目標が見つかりません' });
        }
        // 自分の目標のみ削除可能
        if (goal.userId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: '自分の目標のみ削除できます' });
        }
        await LearningGoal.findByIdAndUpdate(req.params.id, { isActive: false });
        res.status(200).json({ message: '目標を削除しました' });
    } catch (err) {
        console.error('Error deleting goal:', err);
        res.status(500).json({ message: '目標削除に失敗しました' });
    }
});

// =====================================
// ランキング関連のエンドポイント
// =====================================

// 週間学習時間ランキングを取得
router.get('/ranking/weekly', async (req, res) => {
    try {
        const rankingKey = getWeeklyRankingKey();

        // 1. Redisから上位10名を取得（スコア付き）
        let rankingData;
        try {
            rankingData = await redis.zRevRangeWithScores(rankingKey, 0, 9);
        } catch (redisErr) {
            console.error('Redis fetch failed, falling back to MongoDB:', redisErr);
        }

        // Redisにデータがない、またはエラーの場合はMongoDBから集計してRedisにセット
        if (!rankingData || rankingData.length === 0) {
            const weekStartJst = getWeekStartJst();
            const weekStartUtc = toUtcFromJstDate(weekStartJst);
            const weekEndUtc = new Date(weekStartUtc.getTime() + 7 * 24 * 60 * 60 * 1000);

            const mongoRanking = await LearningSession.aggregate([
                {
                    $match: {
                        startTime: { $gte: weekStartUtc, $lt: weekEndUtc },
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
                { $sort: { totalMinutes: -1 } },
                { $limit: 10 },
            ]);

            // Redisにキャッシュ（互換メソッドのみ使用）
            if (mongoRanking.length > 0) {
                try {
                    await redis.del(rankingKey);
                    await Promise.all(
                        mongoRanking.map((item) =>
                            redis.zIncrBy(rankingKey, item.totalMinutes, item._id.toString())
                        )
                    );
                    await redis.expire(rankingKey, 60 * 60 * 24 * 14);
                } catch (cacheErr) {
                    console.error('Redis weekly ranking cache seed failed:', cacheErr);
                }
            }

            rankingData = mongoRanking.map((item) => ({
                value: item._id.toString(),
                score: Number(item.totalMinutes || 0),
            }));
        }

        const userIds = rankingData
            .map((item) => item?.value)
            .filter(Boolean);

        const users = await User.find({ _id: { $in: userIds } })
            .select('username profilePicture')
            .lean();
        const userMap = new Map(users.map((u) => [u._id.toString(), u]));

        const rankedUsers = rankingData
            .map((item, index) => {
                const user = userMap.get(String(item.value));
                if (!user) return null;
                return {
                    userId: user._id,
                    username: user.username,
                    profilePicture: user.profilePicture,
                    totalMinutes: Math.max(0, Math.round(Number(item.score || 0))),
                    rank: index + 1,
                };
            })
            .filter(Boolean);

        res.status(200).json(rankedUsers);
    } catch (err) {
        console.error('Error fetching weekly ranking:', err);
        res.status(500).json({ message: 'ランキング取得に失敗しました' });
    }
});

module.exports = router;
