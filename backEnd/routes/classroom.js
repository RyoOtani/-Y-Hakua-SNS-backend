// routes/classroom.js
const router = require("express").Router();
const { google } = require("googleapis");

// ミドルウェア：ログインしているか確認
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) { // passportが提供する関数
    return next();
  }
  res.status(401).json({ message: "ログインしてください" });
}

// ログインユーザーのコース一覧を取得するAPI
router.get("/courses", ensureAuth, async (req, res) => {
  try {
    // 1. OAuth2クライアントを作成
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    // 2. セッションから取得したトークンをセット
    oauth2Client.setCredentials({
      access_token: req.user.accessToken,
      // refresh_token: req.user.refreshToken // トークンリフレッシュ時に必要
    });

    // 3. Classroom APIクライアントを作成
    const classroom = google.classroom({ version: "v1", auth: oauth2Client });

    // 4. APIを叩く (例: コース一覧を取得)
    const apiRes = await classroom.courses.list({
      pageSize: 10,
    });

    res.status(200).json(apiRes.data.courses || []);

  } catch (err) {
    console.error("Classroom APIエラー:", err.message);
    
    // --- トークン期限切れ（401）の対応（重要） ---
    if (err.code === 401) {
      // 本来はここでリフレッシュトークンを使って新しいアクセストークンを取得し、
      // ユーザーDBのaccessTokenを更新してから、APIリクエストを再試行する処理が必要です。
      // (oauth2Client.refreshAccessToken() を使う)
      return res.status(401).json({ message: "認証トークンが無効です。再ログインが必要かもしれません。" });
    }
    
    res.status(500).json({ message: "APIリクエストに失敗しました", error: err.message });
  }
});

module.exports = router;