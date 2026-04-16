const passport = require('passport');
const {
	TEMPORARY_BAN_CODE,
	buildTemporaryBanResponse,
} = require('../utils/temporaryBan');

const AUTH_REQUIRED_MESSAGE = '認証が必要です';
const ALLOWLIST_DENIED_MESSAGE = 'このメールアドレスは利用を許可されていません';
const EMAIL_BLOCKED_MESSAGE = 'このアカウントは利用停止中です';

const resolveAuthFailure = (info) => {
	if (info?.code === TEMPORARY_BAN_CODE) {
		return {
			status: 403,
			body: buildTemporaryBanResponse({
				untilIso: info.temporaryBanUntil || null,
				reason: info.temporaryBanReason || null,
			}),
		};
	}

	if (info?.code === 'ALLOWLIST_DENIED') {
		return {
			status: 403,
			body: {
				error: ALLOWLIST_DENIED_MESSAGE,
				code: 'ALLOWLIST_DENIED',
			},
		};
	}

	if (info?.code === 'EMAIL_BLOCKED') {
		return {
			status: 403,
			body: {
				error: EMAIL_BLOCKED_MESSAGE,
				code: 'EMAIL_BLOCKED',
			},
		};
	}

	return {
		status: 401,
		body: { error: AUTH_REQUIRED_MESSAGE },
	};
};

/**
 * JWT認証ミドルウェア
 * Authorization: Bearer <token> ヘッダーからJWTを検証し、
 * req.user にユーザー情報をセットする
 */
const authenticate = (req, res, next) => {
	passport.authenticate('jwt', { session: false }, (err, user, info) => {
		if (err) return next(err);
		if (!user) {
			const failure = resolveAuthFailure(info);
			return res.status(failure.status).json(failure.body);
		}

		req.user = user;
		return next();
	})(req, res, next);
};

const optionalAuthenticate = (req, res, next) => {
	passport.authenticate('jwt', { session: false }, (err, user) => {
		if (err) return next(err);
		req.user = user || null;
		return next();
	})(req, res, next);
};

const requireElevatedAccess = (req, res, next) => {
	if (!req.user) {
		return res.status(401).json({ error: AUTH_REQUIRED_MESSAGE });
	}

	if (!req.user.hasElevatedAccess) {
		return res.status(403).json({ error: 'この操作を実行する権限がありません' });
	}

	return next();
};

module.exports = { authenticate, optionalAuthenticate, requireElevatedAccess };
