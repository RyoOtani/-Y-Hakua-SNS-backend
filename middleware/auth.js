const passport = require('passport');

/**
 * JWT認証ミドルウェア
 * Authorization: Bearer <token> ヘッダーからJWTを検証し、
 * req.user にユーザー情報をセットする
 */
const authenticate = passport.authenticate('jwt', { session: false });

const optionalAuthenticate = (req, res, next) => {
	passport.authenticate('jwt', { session: false }, (err, user) => {
		if (err) return next(err);
		req.user = user || null;
		return next();
	})(req, res, next);
};

const requireElevatedAccess = (req, res, next) => {
	if (!req.user) {
		return res.status(401).json({ error: '認証が必要です' });
	}

	if (!req.user.hasElevatedAccess) {
		return res.status(403).json({ error: 'この操作を実行する権限がありません' });
	}

	return next();
};

module.exports = { authenticate, optionalAuthenticate, requireElevatedAccess };
