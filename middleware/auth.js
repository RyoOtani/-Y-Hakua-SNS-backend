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

module.exports = { authenticate, optionalAuthenticate };
