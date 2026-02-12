const passport = require('passport');

/**
 * JWT認証ミドルウェア
 * Authorization: Bearer <token> ヘッダーからJWTを検証し、
 * req.user にユーザー情報をセットする
 */
const authenticate = passport.authenticate('jwt', { session: false });

module.exports = { authenticate };
