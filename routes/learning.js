const router = require('express').Router();
const LearningSession = require('../models/LearningSession');
const LearningGoal = require('../models/LearningGoal');
const User = require('../models/User');
const { Redis } = require('@upstash/redis');
const { authenticate } = require('../middleware/auth');

// Redisクライアントの初期化
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Redisキーの生成ヘルパー
const getWeeklyRankingKey = () => {
    const now = new Date();
    const year = now.getFullYear();
    const start = new Date(year, 0, 1);
    const days = Math.floor((now - start) / (24 * 60 * 60 * 1000));
    const week = Math.ceil((days + 1) / 7);
    return `learning:ranking:weekly:${year}:${week}`;
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

        const session = await LearningSession.findOne({
            userId,
            isActive: true,
        });

        if (!session) {
            return res.status(404).json({ message: 'アクティブなセッションがありません' });
        }

        const endTime = new Date();
        const duration = Math.round((endTime - session.startTime) / 1000 / 60);

        session.endTime = endTime;
        session.duration = duration;
        session.isActive = false;

        const updatedSession = await session.save();

        // Redisの週間ランキングを更新
        try {
            const rankingKey = getWeeklyRankingKey();
            await redis.zincrby(rankingKey, duration, userId.toString());
        } catch (redisErr) {
            console.error('Redis ranking update failed:', redisErr);
        }

        res.status(200).json(updatedSession);
    } catch (err) {
        console.error('Error stopping learning session:', err);
        res.status(500).json({ message: 'セッション終了に失敗しました' });
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

        res.status(200).json({
            today: todayStats[0]?.totalMinutes || 0,
            week: weekStats[0]?.totalMinutes || 0,
            month: monthStats[0]?.totalMinutes || 0,
            total: totalStats[0]?.totalMinutes || 0,
            dailyStats,
        });
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
            rankingData = await redis.zrange(rankingKey, 0, 9, {
                rev: true,
                withScores: true,
            });
        } catch (redisErr) {
            console.error('Redis fetch failed, falling back to MongoDB:', redisErr);
        }

        // Redisにデータがない、またはエラーの場合はMongoDBから集計してRedisにセット
        if (!rankingData || rankingData.length === 0) {
            const today = new Date();
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            weekStart.setHours(0, 0, 0, 0);

            const mongoRanking = await LearningSession.aggregate([
                {
                    $match: {
                        startTime: { $gte: weekStart },
                        isActive: false,
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

            // Redisにキャッシュ（パイプラインで一括登録）
            if (mongoRanking.length > 0) {
                const pipeline = redis.pipeline();
                mongoRanking.forEach((item) => {
                    pipeline.zadd(rankingKey, { score: item.totalMinutes, member: item._id.toString() });
                });
                await pipeline.exec();
            }

            // データ形式をRedisの結果に合わせる
            // mongoRanking: [{ _id, totalMinutes }]
            // rankingData (Redis形式): [userId, score, userId, score, ...]
            rankingData = [];
            mongoRanking.forEach(item => {
                rankingData.push(item._id.toString());
                rankingData.push(item.totalMinutes);
            });
        }

        // 2. ユーザー情報を取得して結合
        // rankingDataは [userId1, score1, userId2, score2, ...] のフラット配列
        const rankedUsers = [];
        for (let i = 0; i < rankingData.length; i += 2) {
            const userId = rankingData[i];
            const score = parseInt(rankingData[i + 1]);

            // ユーザー情報を取得（本来はここもキャッシュすべきだが、今回はUserデータ変更への対応簡略化のため都度取得）
            // 必要に応じてUser情報のキャッシュ戦略も検討可能
            const user = await User.findById(userId).select('username profilePicture');

            if (user) {
                rankedUsers.push({
                    userId: user._id,
                    username: user.username,
                    profilePicture: user.profilePicture,
                    totalMinutes: score,
                    rank: (i / 2) + 1,
                });
            }
        }

        res.status(200).json(rankedUsers);
    } catch (err) {
        console.error('Error fetching weekly ranking:', err);
        res.status(500).json({ message: 'ランキング取得に失敗しました' });
    }
});

module.exports = router;
