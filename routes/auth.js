const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require("../models/User");

//ユーザー登録
router.post("/register", async (req, res) => {
  try {
    const newUser = new User({
      username: req.body.username,
      email: req.body.email,
      password: req.body.password,
    });
    const user = await newUser.save();
    return res.status(200).json(user);
  } catch (err) {
    return res.status(500).json(err);
  }
});

//ログイン
router.post("/login", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.status(404).send("ユーザーが見つかりません");

    const vaildPassword = req.body.password === user.password;
    if (!vaildPassword) return res.status(400).json("パスワードが違います");

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || 'your-jwt-secret',
      { expiresIn: '7d' }
    );

    const { password, ...userWithoutPassword } = user._doc;
    return res.status(200).json({ ...userWithoutPassword, token });
  } catch (err) {
    return res.status(500).json(err);
  }
});


// Google OAuth ログイン
router.get(
  '/google',
  (req, res, next) => {
    if (req.query.platform === 'mobile') {
      // セッションとCookieの両方に保存（冗長性確保）
      req.session.oauthPlatform = 'mobile';
      res.cookie('oauth_platform', 'mobile', {
        maxAge: 5 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
      });
    }
    next();
  },
  passport.authenticate('google', {
    scope: [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
      'https://www.googleapis.com/auth/classroom.announcements.readonly',
      'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly'
    ],
    accessType: 'offline',
    prompt: 'consent',
    includeGrantedScopes: true
  })
);

// Google OAuth コールバック
router.get(
  '/google/callback',
  // ★ Passportがセッションを再生成する前にplatformを読み取る
  (req, res, next) => {
    // セッションから読み取り（Passport処理前なのでまだ存在する）
    req._oauthPlatform = req.session?.oauthPlatform || null;
    // セッションが失われていた場合はCookieから読み取り
    if (!req._oauthPlatform) {
      const cookies = req.headers.cookie || '';
      const match = cookies.match(/oauth_platform=([^;]+)/);
      if (match) req._oauthPlatform = match[1];
    }
    console.log('[OAuth Callback] Platform detected:', req._oauthPlatform);
    next();
  },
  passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL || ''}/login` }),
  (req, res) => {
    // JWTトークンを生成
    const token = jwt.sign(
      { id: req.user._id, email: req.user.email },
      process.env.JWT_SECRET || 'your-jwt-secret',
      { expiresIn: '7d' }
    );

    if (req._oauthPlatform === 'mobile') {
      res.clearCookie('oauth_platform');
      const deepLink = `hakuasns://auth/success?token=${token}`;
      // HTML中間ページ：複数の方法でディープリンクを開く
      return res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ログイン完了</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;font-family:-apple-system,sans-serif;margin:0;background:#f0f2f5;">
  <p style="font-size:18px;color:#333;margin-bottom:20px;">ログインが完了しました</p>
  <a id="openApp" href="${deepLink}" style="display:inline-block;padding:16px 40px;background:#1775ee;color:white;border-radius:30px;text-decoration:none;font-size:16px;font-weight:600;">アプリを開く</a>
  <p style="font-size:14px;color:#666;margin-top:20px;">ボタンが動作しない場合は、手動でアプリに戻ってください</p>
  <script>
    // 方法1: iframeでスキームを開く（Safariで最も確実）
    var iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = '${deepLink}';
    document.body.appendChild(iframe);

    // 方法2: window.locationでも試行
    setTimeout(function() {
      window.location.replace('${deepLink}');
    }, 500);
  </script>
</body></html>`);
    }

    res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${token}`);
  }
);

// ログアウト
router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ message: 'Logout failed' });
    }
    res.status(200).json({ message: 'Logged out successfully' });
  });
});

module.exports = router;
