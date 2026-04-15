const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const jwksClient = require('jwks-rsa');
const router = express.Router();
const User = require("../models/User");
const { isAppEmailAllowed } = require('../utils/appEmailAllowlist');

// Apple JWKS client for verifying Sign in with Apple tokens
const appleJwksClient = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
  cache: true,
  cacheMaxAge: 86400000, // 24 hours
});

const normalizeRateLimitKey = (req) => {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ipKeyGenerator(ip);
};

// ログイン・登録用レート制限
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 20, // 15分間に最大20回
  message: { error: 'リクエストが多すぎます。しばらくしてからお試しください。' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: normalizeRateLimitKey,
});

// JWT秘密鍵チェック（起動時に環境変数が設定されていなければ警告）
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be set');
}
const JWT_ISSUER = process.env.JWT_ISSUER || 'hakua-sns';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'hakua-clients';
const AUTH_COOKIE_NAME = 'auth_token';
const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};
const OAUTH_CLIENT_APP_COOKIE_NAME = 'oauth_client_app';
const CLIENT_APP_CLASSROOM_ONLY = 'classroom_only';
const CLASSROOM_ONLY_SUFFIX = '（Classroom Only）';

const normalizeClientApp = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === CLIENT_APP_CLASSROOM_ONLY) return CLIENT_APP_CLASSROOM_ONLY;
  return null;
};

const resolveClientAppFromRequest = (req) => {
  const headerClientApp = req.get('x-client-app') || req.get('x-clientapp');
  const queryClientApp = req.query?.clientApp;
  const bodyClientApp = req.body?.clientApp;
  return normalizeClientApp(headerClientApp || queryClientApp || bodyClientApp);
};

const formatUsernameForClientAppLog = (username, clientApp) => {
  const normalizedUsername = String(username || 'unknown');
  if (normalizeClientApp(clientApp) === CLIENT_APP_CLASSROOM_ONLY) {
    return `${normalizedUsername}${CLASSROOM_ONLY_SUFFIX}`;
  }
  return normalizedUsername;
};

const getUsernameForLog = (user) => {
  if (user?.username) return String(user.username);
  if (user?._id) return String(user._id);
  return 'unknown';
};

const logLoginSuccess = ({ method, user, extra = {}, clientApp = null }) => {
  const username = getUsernameForLog(user);
  const usernameLabel = formatUsernameForClientAppLog(username, clientApp);
  console.log(`[Auth] login success method=${method} username： ${usernameLabel}`, {
    userId: user?._id ? String(user._id) : null,
    email: user?.email || null,
    clientApp: normalizeClientApp(clientApp),
    ...extra,
    at: new Date().toISOString(),
  });
};

const APP_EMAIL_DENIED_MESSAGE = 'このメールアドレスは利用を許可されていません';

const logAllowlistDenied = ({ method, email, clientApp = null }) => {
  console.warn(`[Auth] allowlist denied method=${method}`, {
    email: normalizeEmail(email),
    clientApp: normalizeClientApp(clientApp),
    at: new Date().toISOString(),
  });
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const PRIVILEGED_EMAIL_ALLOWLIST = new Set(
  String(process.env.PRIVILEGED_EMAIL_ALLOWLIST || '')
    .split(',')
    .map((email) => normalizeEmail(email))
    .filter(Boolean)
);

const isPrivilegedEmail = (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return PRIVILEGED_EMAIL_ALLOWLIST.has(normalized);
};

const syncElevatedAccessByEmailAllowlist = async (user) => {
  if (!user) return user;

  const shouldHaveElevatedAccess = isPrivilegedEmail(user.email);
  const previousState = Boolean(user.hasElevatedAccess);

  if (previousState === shouldHaveElevatedAccess) {
    return user;
  }

  user.hasElevatedAccess = shouldHaveElevatedAccess;
  user.elevatedAccessSource = shouldHaveElevatedAccess ? 'email_exact_match' : null;
  await user.save();

  const username = getUsernameForLog(user);
  console.log(
    `[Auth] elevated access ${shouldHaveElevatedAccess ? 'granted' : 'revoked'} username： ${username}`,
    {
      email: user.email,
      source: 'email_exact_match',
      at: new Date().toISOString(),
    }
  );

  return user;
};

//ユーザー登録
router.post("/register", authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // 入力バリデーション
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'ユーザー名、メールアドレス、パスワードは必須です' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '有効なメールアドレスを入力してください' });
    }
    if (username.length < 2 || username.length > 30) {
      return res.status(400).json({ error: 'ユーザー名は2〜30文字にしてください' });
    }
    if (!isAppEmailAllowed(email)) {
      logAllowlistDenied({ method: 'register', email });
      return res.status(403).json({ error: APP_EMAIL_DENIED_MESSAGE });
    }

    // パスワードをハッシュ化
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const allowlisted = isPrivilegedEmail(email);

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      hasElevatedAccess: allowlisted,
      elevatedAccessSource: allowlisted ? 'email_exact_match' : null,
    });
    const user = await newUser.save();
    const { password: _, ...userWithoutPassword } = user._doc;
    return res.status(200).json(userWithoutPassword);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'そのユーザー名またはメールアドレスは既に使用されています' });
    }
    console.error('Register error:', err);
    return res.status(500).json({ error: '登録に失敗しました' });
  }
});

//ログイン
router.post("/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientApp = resolveClientAppFromRequest(req);
    if (!email || !password) {
      return res.status(400).json({ error: 'メールアドレスとパスワードは必須です' });
    }

    const authFailed = () =>
      res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });

    const user = await User.findOne({ email });
    if (!user) return authFailed();
    if (!isAppEmailAllowed(user.email || email)) {
      logAllowlistDenied({ method: 'password', email: user.email || email, clientApp });
      return res.status(403).json({ error: APP_EMAIL_DENIED_MESSAGE });
    }

    // パスワードがない（Google認証ユーザー）
    if (!user.password) {
      return authFailed();
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return authFailed();

    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      {
        expiresIn: '7d',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }
    );

    // ブラウザ向けの安全なCookieにも保存（Bearer互換は維持）
    res.cookie(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);

    await syncElevatedAccessByEmailAllowlist(user);

    logLoginSuccess({ method: 'password', user, clientApp });

    const { password: _, accessToken: _a, refreshToken: _r, ...userWithoutSensitive } = user._doc;
    return res.status(200).json({ ...userWithoutSensitive, token });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'ログインに失敗しました' });
  }
});


// Google OAuth ログイン
router.get(
  '/google',
  (req, res, next) => {
    const clientApp = normalizeClientApp(req.query?.clientApp || req.get('x-client-app'));
    if (clientApp) {
      req.session.oauthClientApp = clientApp;
      res.cookie(OAUTH_CLIENT_APP_COOKIE_NAME, clientApp, {
        maxAge: 5 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
      });
    }

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
    req._oauthClientApp = req.session?.oauthClientApp || null;
    if (!req._oauthClientApp) {
      const cookies = req.headers.cookie || '';
      const match = cookies.match(new RegExp(`${OAUTH_CLIENT_APP_COOKIE_NAME}=([^;]+)`));
      if (match) req._oauthClientApp = match[1];
    }
    req._oauthClientApp = normalizeClientApp(req._oauthClientApp);
    console.log('[OAuth Callback] Platform detected:', req._oauthPlatform);
    next();
  },
  (req, res, next) => {
    passport.authenticate('google', (err, user, info) => {
      const frontendUrl = process.env.FRONTEND_URL || '';

      if (!err && !user && info?.message === 'allowlist_denied') {
        logAllowlistDenied({ method: 'google', email: info?.email, clientApp: req._oauthClientApp });
        return res.redirect(`${frontendUrl}/login?error=allowlist_denied`);
      }

      if (err || !user) {
        console.error('[OAuth Callback] Authentication failed:', err || info);
        return res.redirect(`${frontendUrl}/login?error=auth_failed`);
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          console.error('[OAuth Callback] Session login failed:', loginErr);
          return res.redirect(`${frontendUrl}/login?error=auth_failed`);
        }
        next();
      });
    })(req, res, next);
  },
  async (req, res) => {
    try {
      if (!isAppEmailAllowed(req.user?.email)) {
        logAllowlistDenied({ method: 'google', email: req.user?.email, clientApp: req._oauthClientApp });
        return res.redirect(`${process.env.FRONTEND_URL || ''}/login?error=allowlist_denied`);
      }

      await syncElevatedAccessByEmailAllowlist(req.user);

      logLoginSuccess({
        method: 'google',
        user: req.user,
        extra: { platform: req._oauthPlatform || 'web' },
        clientApp: req._oauthClientApp,
      });

      // JWTトークンを生成
      const token = jwt.sign(
        { id: req.user._id, email: req.user.email },
        JWT_SECRET,
        {
          expiresIn: '7d',
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        }
      );

      // Web: HttpOnly Cookieで返す
      res.cookie(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);

      if (req._oauthPlatform === 'mobile') {
        res.clearCookie('oauth_platform');
        res.clearCookie(OAUTH_CLIENT_APP_COOKIE_NAME);
        const deepLinkScheme = req._oauthClientApp === CLIENT_APP_CLASSROOM_ONLY
          ? 'onlyclassroom'
          : 'hakuasns';
        const deepLink = `${deepLinkScheme}://auth/success#token=${token}`;
        return res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ログイン完了</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;font-family:-apple-system,sans-serif;margin:0;background:#f0f2f5;">
  <p style="font-size:18px;color:#333;margin-bottom:20px;">ログインが完了しました</p>
  <a id="openApp" href="${deepLink}" style="display:inline-block;padding:16px 40px;background:#1775ee;color:white;border-radius:30px;text-decoration:none;font-size:16px;font-weight:600;">アプリを開く</a>
  <p style="font-size:14px;color:#666;margin-top:20px;">ボタンが動作しない場合は、手動でアプリに戻ってください</p>
  <script>
    var iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = '${deepLink}';
    document.body.appendChild(iframe);
    setTimeout(function() {
      window.location.replace('${deepLink}');
    }, 500);
  </script>
</body></html>`);
      }

      const frontendUrl = process.env.FRONTEND_URL || '';
      res.redirect(`${frontendUrl}/auth/success`);
    } catch (err) {
      console.error('[OAuth Callback] Privilege sync failed:', err);
      return res.redirect(`${process.env.FRONTEND_URL || ''}/login?error=auth_failed`);
    }
  }
);

// Apple OAuth Web ログイン（ブラウザ用）
router.get('/apple', (req, res, next) => {
  const clientApp = normalizeClientApp(req.query?.clientApp || req.get('x-client-app'));
  if (clientApp) {
    req.session.oauthClientApp = clientApp;
    res.cookie(OAUTH_CLIENT_APP_COOKIE_NAME, clientApp, {
      maxAge: 5 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
    });
  }

  if (req.query.platform === 'mobile') {
    req.session.oauthPlatform = 'mobile';
    res.cookie('oauth_platform', 'mobile', {
      maxAge: 5 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
    });
  }
  next();
}, (req, res) => {
  try {
    const redirectUri = `${process.env.API_URL || 'http://localhost:8800'}/api/auth/apple/callback`;
    const clientId = process.env.APPLE_SERVICE_ID;
    const responseType = 'code id_token';
    const scope = 'openid email name';
    const responseMode = 'form_post';

    if (!clientId) {
      return res.status(500).json({ error: 'Apple Service ID が設定されていません' });
    }

    const url = `https://appleid.apple.com/auth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=${encodeURIComponent(responseType)}&scope=${encodeURIComponent(scope)}&response_mode=${responseMode}&state=${req.session.id}`;

    res.redirect(url);
  } catch (error) {
    console.error('Apple auth init error:', error);
    res.status(500).json({ error: 'Apple ログイン初期化に失敗しました' });
  }
});

// Apple Sign In ネイティブアプリ用（POST /apple で identityToken を受け取る）
router.post('/apple', authLimiter, async (req, res) => {
  try {
    const { identityToken, fullName, email: clientEmail } = req.body;
    const clientApp = resolveClientAppFromRequest(req);

    if (!identityToken) {
      return res.status(400).json({ error: 'identityToken は必須です' });
    }

    // 1. identityToken のヘッダーから kid を取得
    const decodedHeader = jwt.decode(identityToken, { complete: true });
    if (!decodedHeader) {
      return res.status(400).json({ error: '無効な identityToken です' });
    }

    // 2. Apple の公開鍵を取得して検証
    const key = await appleJwksClient.getSigningKey(decodedHeader.header.kid);
    const signingKey = key.getPublicKey();

    const payload = jwt.verify(identityToken, signingKey, {
      algorithms: ['RS256'],
      issuer: 'https://appleid.apple.com',
    });

    // audience のチェック
    // ネイティブ: Bundle ID / Web: Service ID のどちらにも対応
    const expectedAudiences = [process.env.APPLE_BUNDLE_ID, process.env.APPLE_SERVICE_ID].filter(Boolean);
    if (expectedAudiences.length > 0 && !expectedAudiences.includes(payload.aud)) {
      return res.status(401).json({
        error: 'トークンの audience が一致しません',
        details: { received: payload.aud, expected: expectedAudiences },
      });
    }

    const appleId = payload.sub;
    // Appleは初回以外 email を返さないことがあるためフォールバックを用意
    const email = payload.email || clientEmail || `${appleId}@appleid.apple.com`;

    // 3. appleId でユーザー検索
    let user = await User.findOne({ appleId });

    if (user) {
      if (!isAppEmailAllowed(user.email)) {
        logAllowlistDenied({ method: 'apple-native', email: user.email, clientApp });
        return res.status(403).json({ error: APP_EMAIL_DENIED_MESSAGE });
      }
      // 既存の Apple ユーザー
      console.log('[Auth] Apple login success (existing)', { userId: user._id, email: user.email });
    } else {
      // 4. email でユーザー検索（既存ユーザーに Apple アカウントをリンク）
      user = await User.findOne({ email });

      if (user) {
        if (!isAppEmailAllowed(user.email || email)) {
          logAllowlistDenied({ method: 'apple-native', email: user.email || email, clientApp });
          return res.status(403).json({ error: APP_EMAIL_DENIED_MESSAGE });
        }
        user.appleId = appleId;
        await user.save();
        console.log('[Auth] Apple account linked to existing user', { userId: user._id, email });
      } else {
        if (!isAppEmailAllowed(email)) {
          logAllowlistDenied({ method: 'apple-native', email, clientApp });
          return res.status(403).json({ error: APP_EMAIL_DENIED_MESSAGE });
        }

        // 5. 完全に新規ユーザー
        let username = 'User';
        if (fullName) {
          const nameParts = [fullName.givenName, fullName.familyName].filter(Boolean);
          if (nameParts.length > 0) {
            username = nameParts.join(' ');
          }
        }

        // ユーザー名の重複回避
        const existingWithName = await User.findOne({ username });
        if (existingWithName) {
          username = `${username}_${appleId.slice(-5)}`;
        }

        user = new User({
          username,
          email: email,
          appleId,
        });
        await user.save();
        console.log('[Auth] Apple new user created', { userId: user._id, email });
      }
    }

    // JWT 発行
    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      {
        expiresIn: '7d',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }
    );

    await syncElevatedAccessByEmailAllowlist(user);

    logLoginSuccess({ method: 'apple-native', user, clientApp });

    const { password: _, accessToken: _a, refreshToken: _r, ...userWithoutSensitive } = user._doc;
    return res.status(200).json({ ...userWithoutSensitive, token });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Apple トークンの検証に失敗しました' });
    }
    console.error('Apple auth error:', err);
    return res.status(500).json({ error: 'Apple ログインに失敗しました' });
  }
});

// Apple OAuth コールバック（ブラウザ用）
router.post('/apple/callback', async (req, res) => {
  try {
    const { id_token, code, user: userDataStr, state } = req.body;
    const sessionPlatform = req.session?.oauthPlatform;
    const cookies = req.headers.cookie || '';
    const cookiePlatformMatch = cookies.match(/oauth_platform=([^;]+)/);
    const oauthPlatform = sessionPlatform || (cookiePlatformMatch ? cookiePlatformMatch[1] : null);
    const cookieClientAppMatch = cookies.match(new RegExp(`${OAUTH_CLIENT_APP_COOKIE_NAME}=([^;]+)`));
    const oauthClientApp = normalizeClientApp(
      req.session?.oauthClientApp || (cookieClientAppMatch ? cookieClientAppMatch[1] : null)
    );

    // state の検証（CSRF保護）
    if (state !== req.session.id) {
      return res.redirect(`${process.env.FRONTEND_URL || ''}/login?error=invalid_state`);
    }

    let identityToken = id_token;
    let userData = null;

    // 最初のリクエストで id_token を受け取る場合
    if (identityToken) {
      try {
        const decodedHeader = jwt.decode(identityToken, { complete: true });
        if (!decodedHeader) {
          return res.redirect(`${process.env.FRONTEND_URL || ''}/login?error=invalid_token`);
        }

        const key = await appleJwksClient.getSigningKey(decodedHeader.header.kid);
        const signingKey = key.getPublicKey();

        const payload = jwt.verify(identityToken, signingKey, {
          algorithms: ['RS256'],
          issuer: 'https://appleid.apple.com',
        });

        if (process.env.APPLE_SERVICE_ID && payload.aud !== process.env.APPLE_SERVICE_ID) {
          return res.redirect(`${process.env.FRONTEND_URL || ''}/login?error=invalid_audience`);
        }

        // user フィールドはJSONの場合がある
        if (userDataStr) {
          try {
            userData = typeof userDataStr === 'string' ? JSON.parse(userDataStr) : userDataStr;
          } catch (e) {
            console.log('Failed to parse user data:', e);
          }
        }

        const appleId = payload.sub;
        const email = payload.email;
        const fullName = userData?.name;

        // 3. appleId でユーザー検索
        let user = await User.findOne({ appleId });

        if (user) {
          if (!isAppEmailAllowed(user.email)) {
            logAllowlistDenied({ method: 'apple-browser', email: user.email, clientApp: oauthClientApp });
            return res.redirect(`${process.env.FRONTEND_URL || ''}/login?error=allowlist_denied`);
          }

          // 既存の Apple ユーザー
          console.log('[Auth] Apple login success (existing)', { userId: user._id, email: user.email });
        } else if (email) {
          // 4. email でユーザー検索
          user = await User.findOne({ email });

          if (user) {
            if (!isAppEmailAllowed(user.email || email)) {
              logAllowlistDenied({ method: 'apple-browser', email: user.email || email, clientApp: oauthClientApp });
              return res.redirect(`${process.env.FRONTEND_URL || ''}/login?error=allowlist_denied`);
            }

            user.appleId = appleId;
            await user.save();
            console.log('[Auth] Apple account linked to existing user', { userId: user._id, email });
          } else {
            if (!isAppEmailAllowed(email)) {
              logAllowlistDenied({ method: 'apple-browser', email, clientApp: oauthClientApp });
              return res.redirect(`${process.env.FRONTEND_URL || ''}/login?error=allowlist_denied`);
            }

            // 5. 完全に新規ユーザー
            let username = 'User';
            if (fullName) {
              const nameParts = [fullName.firstName, fullName.lastName].filter(Boolean);
              if (nameParts.length > 0) {
                username = nameParts.join(' ');
              }
            }

            const existingWithName = await User.findOne({ username });
            if (existingWithName) {
              username = `${username}_${appleId.slice(-5)}`;
            }

            user = new User({
              username,
              email: email || `${appleId}@appleid.apple.com`,
              appleId,
            });
            await user.save();
            console.log('[Auth] Apple new user created', { userId: user._id, email });
          }
        } else {
          return res.redirect(`${process.env.FRONTEND_URL || ''}/login?error=no_email`);
        }

        // JWT 発行
        const token = jwt.sign(
          { id: user._id, email: user.email },
          JWT_SECRET,
          {
            expiresIn: '7d',
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
          }
        );

        // ブラウザ用: HttpOnly Cookie で返す
        res.cookie(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);

        await syncElevatedAccessByEmailAllowlist(user);

        logLoginSuccess({
          method: 'apple-browser',
          user,
          extra: { platform: oauthPlatform || 'web' },
          clientApp: oauthClientApp,
        });

        if (oauthPlatform === 'mobile') {
          res.clearCookie('oauth_platform');
          res.clearCookie(OAUTH_CLIENT_APP_COOKIE_NAME);
          const deepLinkScheme = oauthClientApp === CLIENT_APP_CLASSROOM_ONLY
            ? 'onlyclassroom'
            : 'hakuasns';
          const deepLink = `${deepLinkScheme}://auth/success#token=${token}`;
          return res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ログイン完了</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;font-family:-apple-system,sans-serif;margin:0;background:#f0f2f5;">
  <p style="font-size:18px;color:#333;margin-bottom:20px;">ログインが完了しました</p>
  <a id="openApp" href="${deepLink}" style="display:inline-block;padding:16px 40px;background:#1775ee;color:white;border-radius:30px;text-decoration:none;font-size:16px;font-weight:600;">アプリを開く</a>
  <p style="font-size:14px;color:#666;margin-top:20px;">ボタンが動作しない場合は、手動でアプリに戻ってください</p>
  <script>
    var iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = '${deepLink}';
    document.body.appendChild(iframe);
    setTimeout(function() {
      window.location.replace('${deepLink}');
    }, 500);
  </script>
</body></html>`);
        }

        // 成功ページにリダイレクト
        const frontendUrl = process.env.FRONTEND_URL || '';
        res.redirect(`${frontendUrl}/auth/success`);
      } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
          console.error('Apple token verification error:', err);
          return res.redirect(`${process.env.FRONTEND_URL || ''}/login?error=token_verification_failed`);
        }
        throw err;
      }
    } else {
      return res.redirect(`${process.env.FRONTEND_URL || ''}/login?error=no_id_token`);
    }
  } catch (err) {
    console.error('Apple callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL || ''}/login?error=auth_failed`);
  }
});

// ログアウト
router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ message: 'Logout failed' });
    }
    res.clearCookie(AUTH_COOKIE_NAME, {
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });
    res.status(200).json({ message: 'Logged out successfully' });
  });
});

module.exports = router;
