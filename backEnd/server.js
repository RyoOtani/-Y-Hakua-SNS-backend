// const express = require('express');
// const app = express();

// const userRoute = require("./routes/users");
// const postRoute = require("./routes/post");
// const authRoute = require("./routes/auth");
// const classroomRoute = require("./routes/classroom");
// require("./config/passport");
// // const searchRoute = required("./routes/search")
// //const uploadRoute = require("./routes/upload");
// const Port = process.env.PORT || 8800;
// const mongoose = require("mongoose");
// const cors = require("cors");
// const session = require("express-session");
// const passport = require("passport");
// require("dotenv").config();

// app.use(
//   session({
//     secret: process.env.COOKIE_KEY,
//     resave: false,
//     saveUninitialized: false,
//     // cookie: { secure: true } // HTTPS環境ならtrueに
//   })
// );
// app.use(passport.initialize());
// app.use(passport.session());


// // MongoDBの接続設定
// mongoose
//     .connect(process.env.MONGO_URL)
//     .then(() => console.log("DBに接続中..."))
//     .catch((err) => console.log(err));


// app.use(
//   cors({
//     origin: "http://localhost:3000", // フロントエンドのURL
//     credentials: true, // Cookieの送受信を許可
//   })
// );

// // ミドルウェアの設定
// app.use(express.json());
// app.use("/api/users", userRoute);
// app.use("/api/posts", postRoute);
// app.use("/api/auth", authRoute);
// app.use("/api/classroom", classroomRoute);
// // app.use("api/search" , searchRoute)
// //app.use("/api/upload", uploadRoute);

// // app.get("/", (req,res) => {
// //     res.send("hello world");
// // });

// app.listen(Port, () => console.log("サーバーが起動しました"));


const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const helmet = require('helmet');
const morgan = require('morgan');
const passport = require('passport');
const session = require('express-session');

dotenv.config();

const app = express();

// ミドルウェア
app. use(helmet());
app.use(morgan('common'));
app.use(cors({
  origin: process.env. FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// セッション設定
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env. NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Passport初期化
app.use(passport.initialize());
app.use(passport.session());

// データベース接続
mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
. then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Passport設定
require('./config/passport');

// ルート
app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));

const PORT = process.env.PORT || 8800;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});