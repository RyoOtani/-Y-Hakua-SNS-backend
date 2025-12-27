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

module.exports = router;