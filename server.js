const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const helmet = require('helmet');
const morgan = require('morgan');
const passport = require('passport');
const session = require('express-session');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");
const redisClient = require('./redisClient');
const User = require('./models/User');
const { initializeFirebaseAdmin } = require('./utils/firebaseAdmin');
dotenv.config();

const app = express();
app.set('trust proxy', 1); // Enable trusting proxy for Secure cookies
const server = http.createServer(app);
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://localhost:5173",
  "https://www.yapp.me",
  "https://yapp.me"
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  },
});

// App全体でioを使えるようにする
app.set('io', io);

// Socket.io ユーザー管理
let users = [];

const addUser = (userId, socketId) => {
  const existingUserIndex = users.findIndex((user) => user.userId === userId);
  if (existingUserIndex !== -1) {
    users[existingUserIndex].socketId = socketId;
    return { alreadyOnline: true };
  }

  if (!users.some((user) => user.userId === userId)) {
    users.push({ userId, socketId });
  }

  return { alreadyOnline: false };
};

const removeUser = (socketId) => {
  users = users.filter((user) => user.socketId !== socketId);
};

const getUser = (userId) => {
  return users.find((user) => user.userId === userId);
};

// Socket.io 接続処理
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // ユーザー登録
  socket.on("addUser", async (userId, options = {}) => {
    const addResult = addUser(userId, socket.id);
    socket.join(userId); // ユーザーIDのルームに参加（これで io.to(userId) が使える）
    io.emit("getUsers", users);

    const source = options && typeof options === 'object' ? options.source : undefined;
    try {
      const resolvedUser = await User.findById(userId).select('username');
      const username = resolvedUser?.username || userId;

      if (source === 'app_resume') {
        console.log(`[presence] ${username} is online again (app resume)`);
      } else if (addResult?.alreadyOnline) {
        console.log(`[presence] ${username} is online (socket reconnected)`);
      } else {
        console.log(`[presence] ${username} is online`);
      }
    } catch (err) {
      console.error('Failed to resolve username for presence log:', err);
    }
  });

  // メッセージ送信
  socket.on("sendMessage", async ({ senderId, senderName, senderProfilePicture, receiverId, text, conversationId, attachments, replyTo }) => {
    try {
      const receiverDoc = await User.findById(receiverId).select('blockedUsers');
      const blocked = receiverDoc?.blockedUsers || [];
      const isBlocked = blocked.map((id) => id.toString()).includes(String(senderId));

      if (isBlocked) {
        return;
      }

      const user = getUser(receiverId);
      if (user) {
        io.to(user.socketId).emit("getMessage", {
          senderId,
          senderName,
          senderProfilePicture,
          text,
          conversationId,
          attachments: attachments || [],
          replyTo: replyTo || null,
          createdAt: new Date(),
        });
      }
    } catch (err) {
      console.error('sendMessage socket error:', err);
    }
  });

  // メッセージ既読通知
  socket.on("markAsRead", ({ conversationId, readerId, senderId }) => {
    const sender = getUser(senderId);
    if (sender) {
      io.to(sender.socketId).emit("messageRead", {
        conversationId,
        readerId,
        readAt: new Date(),
      });
    }
  });

  // タイピング中の通知
  socket.on("typing", ({ conversationId, userId, receiverId }) => {
    const user = getUser(receiverId);
    if (user) {
      io.to(user.socketId).emit("userTyping", {
        conversationId,
        userId,
      });
    }
  });

  // タイピング停止の通知
  socket.on("stopTyping", ({ conversationId, userId, receiverId }) => {
    const user = getUser(receiverId);
    if (user) {
      io.to(user.socketId).emit("userStopTyping", {
        conversationId,
        userId,
      });
    }
  });

  // 切断処理
  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
    removeUser(socket.id);
    io.emit("getUsers", users);
  });
});

// ミドルウェア
app.use(helmet());
app.use(morgan('common'));
app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));
//Google RISC用のミドルウェア設定
app.use(express.text({ type: 'application/secevent+jwt' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});
// Serve static assets from the frontend's public directory
// app.use(express.static('../frontEnd/public'));

// セッション設定（必須環境変数が無ければ起動しない）
if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required for secure sessions');
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true, // Required for Secure cookies behind a proxy
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
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
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));


// Upstash Redis (REST) client (falls back to mock when env vars are missing)
// If you need Redis here, use redisClient.

// Passport設定
require('./config/passport');

// Firebase Admin 初期化（未設定時は自動的に無効化）
initializeFirebaseAdmin();

// プライバシーポリシーページ（認証不要の公開ページ）
app.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy-policy.html'));
});

// ルート
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/posts', require('./routes/post'));
app.use('/api/classroom', require('./routes/classroom'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/conversations', require('./routes/conversation'));
app.use('/api/messages', require('./routes/message'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/hashtags', require('./routes/hashtag'));
app.use('/api/security', require('./routes/security'));
app.use('/api/learning', require('./routes/learning'));
app.use('/api/notes', require('./routes/notes'));

// サーバー起動
const PORT = process.env.PORT || 8800;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.io enabled for real-time messaging`);
});