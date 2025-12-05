// const router = require("express").Router();
// const User = require("../models/User");
// const passport = require('passport');

// // //ユーザー登録
// // router.post("/register", async (req, res) => {
// //     try {
// //         const newUser = new User({
// //             username: req.body.username,
// //             email: req.body.email,
// //             password: req.body.password,
// //         });
// //         const user = await newUser.save();
// //         return res.status(200).json(user);
// //     } catch (err) {
// //         return res.status(500).json(err);
// //     }
// // });

// // //ログイン
// // router.post("/login", async (req, res) => {
// //     try {
// //         const user = await User.findOne({email: req.body.email});
// //         if(!user) return res.status(404).send("ユーザーが見つかりません");

// //         const vaildPassword = req.body.password === user.password;
// //         if(!vaildPassword) return res.status(400).json("パスワードが違います");

// //         return res.status(200).json(user);
// //     } catch (err){
// //         return res.status(500).json(err);
// //     }
// // });

// router.get('/google',(req, res, next) => {
//     // console.log(">>> 1. /auth/google ルートに到達しました！");
//     next(); // 次（passport）へ進む
//   },
//   passport.authenticate('google', {
//     scope: [
//       'profile', 
//       'email',
//       'https://www.googleapis.com/auth/classroom.courses.readonly',
//       'https://www.googleapis.com/auth/classroom.rosters.readonly',
//       'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
//     ],
//     accessType: 'offline',
//     prompt: 'consent'
//   })
// );

// // 2. Google認証後のコールバックルート
// router.get("/google/callback", passport.authenticate("google", {
//     failureRedirect: "http://localhost:3000/login", // 失敗時のリダイレクト先（フロントエンド）
//   }),
//   (req, res) => {
//     // 認証成功！
//     // req.userにユーザー情報が入っている
//     // ここでフロントエンドのダッシュボードなどにリダイレクトする
//     res.redirect("http://localhost:3000/"); // 成功時のリダイレクト先（フロントエンド）
//   }
// );

// // 3. ログアウト（セッションを破棄）
// router.get("/logout", (req, res, next) => {
//   req.logout(function(err) {
//     if (err) { return next(err); }
//     // セッションを完全に破棄する
//     req.session.destroy((err) => {
//       if (err) { return next(err); }
//       // クライアントのセッションクッキーをクリアする
//       res.clearCookie('connect.sid'); // 'connect.sid'はデフォルトのセッション名です。変更している場合は合わせる必要があります。
//       res.status(200).json({ message: "ログアウトしました" });
//     });
//   });  
// });

// // 4. 現在ログインしているユーザー情報をフロントに返すAPI（任意）
// router.get("/current_user", (req, res) => {
//   if (req.user) {
//     res.status(200).json(req.user);
//   } else {
//     res.status(401).json({ message: "Not authenticated" });
//   }
// });


// module.exports = router;

const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Google OAuth ログイン
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google OAuth コールバック
router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    // JWTトークンを生成
    const token = jwt.sign(
      { id: req. user._id, email: req.user. email },
      process.env. JWT_SECRET || 'your-jwt-secret',
      { expiresIn: '7d' }
    );

    // フロントエンドにリダイレクト（トークンをクエリパラメータで渡す）
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