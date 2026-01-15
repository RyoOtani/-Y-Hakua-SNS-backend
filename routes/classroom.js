const router = require('express').Router();
const { google } = require('googleapis');
const User = require('../models/User');
const passport = require('passport');

// Use JWT authentication strategy
router.get('/courses', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    // 1. セッションからユーザー情報を取得
    const user = await User.findById(req.user.id);
    if (!user || !user.refreshToken) {
      console.log('Refresh token is missing for user:', req.user.id);
      // リフレッシュトークンがない場合は、再ログインを促す
      return res.status(401).json({ message: 'Googleアカウントで再ログインして、アクセスを許可してください。' });
    }

    // 2. GoogleのOAuth2クライアントをセットアップ
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      '/api/auth/google/callback' // passport.jsのcallbackURLと合わせる
    );

    // 3. ユーザーのDBから取得したトークンをクライアントにセット
    oauth2Client.setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
    });

    // 4. (重要) トークンが更新された場合に備えてイベントリスナーをセット
    // googleapisライブラリが自動でトークンをリフレッシュし、このイベントが発火します
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        console.log('Access token was refreshed!');
        // 新しいアクセストークンをDBに保存
        await User.findByIdAndUpdate(user.id, { accessToken: tokens.access_token });
      }
    });

    // 5. Classroom APIクライアントを作成
    const classroom = google.classroom({ version: 'v1', auth: oauth2Client });

    // 6. コース一覧を取得
    const apiResponse = await classroom.courses.list({});

    res.json(apiResponse.data.courses || []);

  } catch (error) {
    console.error('Failed to fetch classroom courses:', error.message);
    if (error.response && (error.response.status === 400 || error.response.status === 401)) {
      console.error('Google API Auth Error:', error.response.data);
      return res.status(401).json({ message: 'Googleの認証に失敗しました。アカウント連携を確認し、再ログインしてください。' });
    }
    res.status(500).json({ message: 'コースの取得中にサーバーエラーが発生しました。' });
  }
});

// アナウンスメントを取得する新しいルート
router.get('/announcements', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.refreshToken) {
      return res.status(401).json({ message: 'Google認証が必要です。' });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      '/api/auth/google/callback'
    );

    oauth2Client.setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
    });

    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        await User.findByIdAndUpdate(user.id, { accessToken: tokens.access_token });
      }
    });

    const classroom = google.classroom({ version: 'v1', auth: oauth2Client });

    // 1. コース一覧を取得
    const coursesRes = await classroom.courses.list({ courseStates: ['ACTIVE'] });
    const courses = coursesRes.data.courses || [];

    // 2. 各コースのアナウンスメントを取得（並列処理）
    const announcementsPromises = courses.map(async (course) => {
      try {
        const announceRes = await classroom.courses.announcements.list({
          courseId: course.id,
          pageSize: 5, // 最新5件程度で十分
        });

        return (announceRes.data.announcements || []).map(item => ({
          ...item,
          courseName: course.name,
          courseLink: course.alternateLink,
          type: 'classroom_announcement' // 識別のためのタイプ
        }));
      } catch (err) {
        console.error(`Failed to fetch announcements for course ${course.id}:`, err.message);
        return [];
      }
    });

    const results = await Promise.all(announcementsPromises);
    const allAnnouncements = results.flat();

    // 3. 日付順にソート（新しい順）
    allAnnouncements.sort((a, b) => {
      return new Date(b.updateTime) - new Date(a.updateTime);
    });

    res.json(allAnnouncements);

  } catch (error) {
    console.error('Failed to fetch announcements:', error);
    res.status(500).json({ message: 'アナウンスメントの取得に失敗しました。' });
  }
});

module.exports = router;