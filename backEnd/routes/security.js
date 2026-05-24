const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const User = require('../models/User');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const { recordClientEvent, getObservabilitySummary } = require('../utils/observability');

const normalizeRateLimitKey = (req) => {
    const ip = req.ip || req.socket?.remoteAddress || '';
    return ipKeyGenerator(ip);
};

const riscLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: normalizeRateLimitKey,
    message: 'Too many requests',
});

const telemetryLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: normalizeRateLimitKey,
    message: 'Too many telemetry events',
});

const normalizeTelemetryMetadata = (input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

    const output = {};
    Object.entries(input).forEach(([key, value]) => {
        if (typeof key !== 'string' || key.length === 0) return;

        if (value == null) {
            output[key] = null;
            return;
        }

        if (typeof value === 'string') {
            output[key] = value.slice(0, 500);
            return;
        }

        if (typeof value === 'number' || typeof value === 'boolean') {
            output[key] = value;
            return;
        }

        if (Array.isArray(value)) {
            output[key] = value.slice(0, 20).map((item) => {
                if (typeof item === 'string') return item.slice(0, 200);
                if (typeof item === 'number' || typeof item === 'boolean') return item;
                return null;
            });
            return;
        }

        output[key] = JSON.stringify(value).slice(0, 500);
    });

    return output;
};

router.post('/telemetry/events', telemetryLimiter, optionalAuthenticate, (req, res) => {
    try {
        const payload = req.body && typeof req.body === 'object' ? req.body : {};

        const event = recordClientEvent({
            source: payload.source,
            category: payload.category,
            level: payload.level,
            message: payload.message,
            route: payload.route,
            metadata: normalizeTelemetryMetadata(payload.metadata),
            userId: req.user?._id,
            ip: req.ip,
        });

        return res.status(202).json({
            status: 'accepted',
            acceptedAt: event.at,
        });
    } catch (err) {
        console.error('[telemetry] failed to accept event:', err);
        return res.status(500).json({ error: 'Failed to accept telemetry event' });
    }
});

router.get('/telemetry/summary', authenticate, (req, res) => {
    try {
        const summary = getObservabilitySummary();
        return res.status(200).json(summary);
    } catch (err) {
        console.error('[telemetry] failed to build summary:', err);
        return res.status(500).json({ error: 'Failed to build telemetry summary' });
    }
});

// Googleの公開鍵取得クライアント設定
const client = jwksClient({
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000, // 10分
});

// 公開鍵の取得する関数
function getKey(header, callback) {
  client.getSigningKey(header.kid, function(err, key) {
    if (err) {
      return callback(err, null);
    }
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

/**
 * RISC (Risk Incident Sharing and Coordination) Security Event Receiver
 * Googleからのセキュリティイベントを受信するエンドポイント。
 * Cross-Account Protection に対応するため、以下のイベントを処理する:
 *   - account-disabled: アカウント無効化
 *   - account-enabled: アカウント再有効化
 *   - sessions-revoked: セッション取り消し
 *   - tokens-revoked: トークン取り消し
 *   - account-credential-change-required: 資格情報変更要求
 */
router.post('/risc', riscLimiter, (req, res) => {
    // GoogleのRISCはContent-Type: application/secevent+jwtで
    // Raw BodyがJWT文字列としてそのまま送られてくる
    const token = typeof req.body === 'string' ? req.body.trim() : (req.body?.token || null);

    if (!token || typeof token !== 'string') {
        console.error('[RISC] Invalid request format - no JWT token found');
        return res.status(400).send('Invalid request');
    }

    const verifyOptions = {
        audience: process.env.GOOGLE_CLIENT_ID,
        issuer: 'https://accounts.google.com',
        algorithms: ['RS256'],
    };

    // 1. JWTの署名検証とクレーム検証 (iss, aud, iat)
    jwt.verify(token, getKey, verifyOptions, async (err, decoded) => {
        if (err) {
            console.error('[RISC] Token verification failed:', err.message);
            return res.status(400).send('Verification failed');
        }

        console.log('[RISC] Verified Security Event received for subject:', decoded.sub);

        // 2. イベント内容に応じた処理
        const events = decoded.events || {};
        const googleUserId = decoded.sub;

        try {
            if (events['https://schemas.openid.net/secevent/risc/event-type/account-disabled']) {
                await handleAccountDisabled(googleUserId);
            }

            if (events['https://schemas.openid.net/secevent/risc/event-type/account-enabled']) {
                await handleAccountEnabled(googleUserId);
            }

            if (events['https://schemas.openid.net/secevent/risc/event-type/sessions-revoked']) {
                await handleSessionsRevoked(googleUserId);
            }

            if (events['https://schemas.openid.net/secevent/risc/event-type/tokens-revoked']) {
                await handleTokensRevoked(googleUserId);
            }

            if (events['https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required']) {
                await handleCredentialChangeRequired(googleUserId);
            }

            // 正常に受信・処理できたことをGoogleに通知（202 Accepted が必須）
            res.status(202).json({ status: 'Accepted' });
        } catch (processingErr) {
            console.error('[RISC] Error processing event:', processingErr);
            // 処理エラーでも受信自体は成功しているので202を返す
            // （Googleが再送を繰り返さないようにするため）
            res.status(202).json({ status: 'Accepted' });
        }
    });
});

/**
 * アカウント無効化イベント
 * ユーザーのアカウントをロックし、トークンを無効化する
 */
async function handleAccountDisabled(googleUserId) {
    console.log(`[RISC] Disabling account for Google User ID: ${googleUserId}`);
    const result = await User.findOneAndUpdate(
        { googleId: googleUserId },
        {
            accountLocked: true,
            refreshToken: null,
            lockedAt: new Date(),
            lockReason: 'google_account_disabled',
        },
        { new: true }
    );
    if (result) {
        console.log(`[RISC] Account disabled for user: ${result._id}`);
    } else {
        console.warn(`[RISC] No user found with googleId: ${googleUserId}`);
    }
}

/**
 * アカウント再有効化イベント
 * ユーザーのアカウントロックを解除する
 */
async function handleAccountEnabled(googleUserId) {
    console.log(`[RISC] Re-enabling account for Google User ID: ${googleUserId}`);
    const result = await User.findOneAndUpdate(
        { googleId: googleUserId },
        {
            accountLocked: false,
            $unset: { lockedAt: '', lockReason: '' },
        },
        { new: true }
    );
    if (result) {
        console.log(`[RISC] Account re-enabled for user: ${result._id}`);
    } else {
        console.warn(`[RISC] No user found with googleId: ${googleUserId}`);
    }
}

/**
 * セッション取り消しイベント
 * ユーザーのリフレッシュトークンを無効化する
 */
async function handleSessionsRevoked(googleUserId) {
    console.log(`[RISC] Revoking sessions for Google User ID: ${googleUserId}`);
    const result = await User.findOneAndUpdate(
        { googleId: googleUserId },
        { refreshToken: null },
        { new: true }
    );
    if (result) {
        console.log(`[RISC] Sessions revoked for user: ${result._id}`);
    } else {
        console.warn(`[RISC] No user found with googleId: ${googleUserId}`);
    }
}

/**
 * トークン取り消しイベント
 * ユーザーのアクセストークン・リフレッシュトークンを無効化する
 */
async function handleTokensRevoked(googleUserId) {
    console.log(`[RISC] Revoking tokens for Google User ID: ${googleUserId}`);
    const result = await User.findOneAndUpdate(
        { googleId: googleUserId },
        {
            accessToken: null,
            refreshToken: null,
        },
        { new: true }
    );
    if (result) {
        console.log(`[RISC] Tokens revoked for user: ${result._id}`);
    } else {
        console.warn(`[RISC] No user found with googleId: ${googleUserId}`);
    }
}

/**
 * 資格情報変更要求イベント
 * ユーザーにトークン再取得を促すフラグを立てる
 */
async function handleCredentialChangeRequired(googleUserId) {
    console.log(`[RISC] Credential change required for Google User ID: ${googleUserId}`);
    const result = await User.findOneAndUpdate(
        { googleId: googleUserId },
        {
            refreshToken: null,
            requiresReauth: true,
        },
        { new: true }
    );
    if (result) {
        console.log(`[RISC] Credential change flagged for user: ${result._id}`);
    } else {
        console.warn(`[RISC] No user found with googleId: ${googleUserId}`);
    }
}

module.exports = router;