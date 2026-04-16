const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const passport = require('passport');
const session = require('express-session');
const http = require('http');
const path = require('path');
const jwt = require('jsonwebtoken');
const { Server } = require("socket.io");
const redisClient = require('./redisClient');
const User = require('./models/User');
const Conversation = require('./models/Conversation');
const { isAppEmailAllowed } = require('./utils/appEmailAllowlist');
const { isEmailBlocked } = require('./utils/emailBlock');
const { getActiveTemporaryBan } = require('./utils/temporaryBan');
const { initializeFirebaseAdmin } = require('./utils/firebaseAdmin');
const { startBatchedNotificationScheduler } = require('./utils/pushNotification');
const { startWeeklyLearningBadgeScheduler } = require('./utils/learningBadge');
const { toIdString, getConversationMemberIds } = require('./utils/socketAuthorization');
const {
  requestMetricsMiddleware,
  recordSocketConnection,
  recordSocketDisconnection,
  installProcessLevelHandlers,
} = require('./utils/observability');
dotenv.config();

const app = express();
app.set('trust proxy', 1); // Enable trusting proxy for Secure cookies
installProcessLevelHandlers();
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
  maxHttpBufferSize: 1 * 1024 * 1024,
});

const SOCKET_JWT_SECRET = process.env.JWT_SECRET;
if (!SOCKET_JWT_SECRET) {
  throw new Error('JWT_SECRET must be set for socket authentication');
}
const SOCKET_JWT_ISSUER = process.env.JWT_ISSUER || 'hakua-sns';
const SOCKET_JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'hakua-clients';

const extractCookieValue = (cookieHeader, cookieName) => {
  if (!cookieHeader || !cookieName) return null;
  const escapedName = cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|;\\s*)${escapedName}=([^;]+)`);
  const match = cookieHeader.match(regex);
  if (!match || !match[1]) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch (_) {
    return match[1];
  }
};

const extractSocketToken = (socket) => {
  const authToken = socket.handshake?.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) {
    return authToken.trim();
  }

  const authHeader = socket.handshake?.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }

  const cookieHeader = socket.handshake?.headers?.cookie || '';
  const cookieToken = extractCookieValue(cookieHeader, 'auth_token');
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim();
  }

  return null;
};

io.use(async (socket, next) => {
  const token = extractSocketToken(socket);
  if (!token) {
    return next(new Error('Unauthorized: token missing'));
  }

  try {
    const decoded = jwt.verify(token, SOCKET_JWT_SECRET, {
      issuer: SOCKET_JWT_ISSUER,
      audience: SOCKET_JWT_AUDIENCE,
    });

    const userId = decoded?.id ? String(decoded.id) : null;
    if (!userId) {
      return next(new Error('Unauthorized: invalid token payload'));
    }

    const user = await User.findById(userId).select('email emailBlockActive temporaryBanUntil temporaryBanReason');
    if (!user) {
      return next(new Error('Unauthorized: user not found'));
    }

    if (isEmailBlocked({ user })) {
      console.warn('[socket] blocked email denied', {
        userId,
        email: user.email || null,
        at: new Date().toISOString(),
      });
      return next(new Error('Unauthorized: account blocked'));
    }

    if (!isAppEmailAllowed(user.email)) {
      console.warn('[socket] allowlist denied', {
        userId,
        email: user.email || null,
        at: new Date().toISOString(),
      });
      return next(new Error('Unauthorized: email not allowlisted'));
    }

    const temporaryBan = getActiveTemporaryBan(user);
    if (temporaryBan) {
      console.warn('[socket] temporary ban denied', {
        userId,
        email: user.email || null,
        temporaryBanUntil: temporaryBan.untilIso,
        at: new Date().toISOString(),
      });
      return next(new Error('Unauthorized: account temporarily banned'));
    }

    socket.data.userId = userId;
    return next();
  } catch (err) {
    console.error('[socket] auth failed:', err.message);
    return next(new Error('Unauthorized: token invalid'));
  }
});

// App全体でioを使えるようにする
app.set('io', io);

// Socket.io ユーザー管理
let users = [];

const CLIENT_APP_CLASSROOM_ONLY = "classroom_only";
const CLASSROOM_ONLY_SUFFIX = "（Classroom Only）";

const normalizeClientApp = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === CLIENT_APP_CLASSROOM_ONLY) return CLIENT_APP_CLASSROOM_ONLY;
  return null;
};

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

const formatUsernameForPresenceLog = (username, clientApp = null, statusSuffix = '') => {
  const normalizedUsername = String(username || 'unknown');
  const usernameWithClientApp =
    normalizeClientApp(clientApp) === CLIENT_APP_CLASSROOM_ONLY
      ? `${normalizedUsername}${CLASSROOM_ONLY_SUFFIX}`
      : normalizedUsername;
  return `username： ${usernameWithClientApp}${statusSuffix}`;
};

const removeUser = (socketId) => {
  users = users.filter((user) => user.socketId !== socketId);
};

const CONVERSATION_MEMBERS_CACHE_TTL_MS = 5000;
const conversationMembersCache = new Map();

const getConversationMemberIdsCached = async (conversationId) => {
  const normalizedConversationId = toIdString(conversationId);
  if (!normalizedConversationId) return null;

  const now = Date.now();
  const cached = conversationMembersCache.get(normalizedConversationId);

  if (cached && cached.expiresAt > now) {
    return cached.memberIds;
  }
  if (cached) {
    conversationMembersCache.delete(normalizedConversationId);
  }

  const conversation = await Conversation.findById(normalizedConversationId).select('members');
  if (!conversation) return null;

  const memberIds = getConversationMemberIds(conversation);
  conversationMembersCache.set(normalizedConversationId, {
    memberIds,
    expiresAt: now + CONVERSATION_MEMBERS_CACHE_TTL_MS,
  });

  if (conversationMembersCache.size > 1000) {
    for (const [key, entry] of conversationMembersCache.entries()) {
      if (entry.expiresAt <= now) {
        conversationMembersCache.delete(key);
      }
    }
  }

  return memberIds;
};

const memberIdsInclude = (memberIds, userId) => {
  const normalizedUserId = toIdString(userId);
  if (!normalizedUserId || !Array.isArray(memberIds)) return false;
  return memberIds.includes(normalizedUserId);
};

const resolveReadTargets = (memberIds, readerId, senderId) => {
  if (!Array.isArray(memberIds) || memberIds.length === 0) return [];

  const normalizedReaderId = toIdString(readerId);
  if (!normalizedReaderId) return [];

  const normalizedSenderId = toIdString(senderId);
  if (
    normalizedSenderId &&
    normalizedSenderId !== normalizedReaderId &&
    memberIds.includes(normalizedSenderId)
  ) {
    return [normalizedSenderId];
  }

  return memberIds.filter((memberId) => memberId !== normalizedReaderId);
};

const emitToUserRoom = (userId, eventName, payload) => {
  const normalizedUserId = toIdString(userId);
  if (!normalizedUserId) return;
  io.to(normalizedUserId).emit(eventName, payload);
};

// Socket.io 接続処理
io.on("connection", (socket) => {
  const connectedUserId = socket.data.userId;
  if (connectedUserId) {
    addUser(connectedUserId, socket.id);
    socket.join(connectedUserId);
    io.emit("getUsers", users);
    recordSocketConnection({
      userId: connectedUserId,
      socketId: socket.id,
    });
  }

  console.log("A user connected:", socket.id, `user=${connectedUserId}`);

  // ユーザー登録
  socket.on("addUser", async (clientUserId, options = {}) => {
    const userId = socket.data.userId;
    if (!userId) return;

    if (clientUserId && String(clientUserId) !== String(userId)) {
      console.warn(`[socket] addUser userId mismatch: token=${userId}, payload=${clientUserId}`);
    }

    const addResult = addUser(userId, socket.id);
    socket.join(userId); // ユーザーIDのルームに参加（これで io.to(userId) が使える）
    io.emit("getUsers", users);

    const source = options && typeof options === 'object' ? options.source : undefined;
    const clientApp =
      typeof options === "object" && options
        ? normalizeClientApp(options.clientApp)
        : null;
    try {
      const resolvedUser = await User.findById(userId).select('username');
      const usernameLabel = formatUsernameForPresenceLog(resolvedUser?.username, clientApp);

      if (source === 'app_resume') {
        const resumedUsernameLabel = formatUsernameForPresenceLog(
          resolvedUser?.username,
          clientApp,
          '（online again）'
        );
        console.log(`[presence] ${resumedUsernameLabel}`);
      } else if (addResult?.alreadyOnline) {
        console.log(`[presence] online (socket reconnected) ${usernameLabel}`);
      } else {
        console.log(`[presence] online ${usernameLabel}`);
      }
    } catch (err) {
      console.error('Failed to resolve username for presence log:', err);
    }
  });

  // メッセージ送信
  socket.on("sendMessage", async ({ senderId, senderName, senderProfilePicture, receiverId, text, conversationId, attachments, replyTo, messageId, createdAt }) => {
    try {
      const authenticatedSenderId = socket.data.userId;
      if (!authenticatedSenderId || !receiverId || !conversationId) {
        return;
      }

      if (senderId && String(senderId) !== String(authenticatedSenderId)) {
        console.warn(`[socket] sendMessage senderId mismatch: token=${authenticatedSenderId}, payload=${senderId}`);
      }

      const memberIds = await getConversationMemberIdsCached(conversationId);
      if (!memberIds || !memberIdsInclude(memberIds, authenticatedSenderId)) {
        console.warn(`[socket] sendMessage denied: sender ${authenticatedSenderId} is not in conversation ${conversationId}`);
        return;
      }

      if (!memberIdsInclude(memberIds, receiverId)) {
        console.warn(`[socket] sendMessage denied: receiver ${receiverId} is not in conversation ${conversationId}`);
        return;
      }

      const [receiverDoc, senderDoc] = await Promise.all([
        User.findById(receiverId).select('blockedUsers mutedUsers'),
        User.findById(authenticatedSenderId).select('username profilePicture'),
      ]);
      const blocked = receiverDoc?.blockedUsers || [];
      const muted = receiverDoc?.mutedUsers || [];
      const isBlocked = blocked.map((id) => id.toString()).includes(String(authenticatedSenderId));
      const isMuted = muted.map((id) => id.toString()).includes(String(authenticatedSenderId));

      if (isBlocked || isMuted) {
        return;
      }

      emitToUserRoom(receiverId, "getMessage", {
        messageId: messageId || null,
        senderId: authenticatedSenderId,
        senderName: senderDoc?.username || senderName,
        senderProfilePicture: senderDoc?.profilePicture || senderProfilePicture,
        text,
        conversationId,
        attachments: attachments || [],
        replyTo: replyTo || null,
        createdAt: createdAt || new Date().toISOString(),
      });
    } catch (err) {
      console.error('sendMessage socket error:', err);
    }
  });

  // メッセージ既読通知
  socket.on("markAsRead", async ({ conversationId, senderId }) => {
    const readerId = socket.data.userId;
    if (!readerId || !conversationId) {
      return;
    }

    try {
      const memberIds = await getConversationMemberIdsCached(conversationId);
      if (!memberIds || !memberIdsInclude(memberIds, readerId)) {
        return;
      }

      const targetUserIds = resolveReadTargets(memberIds, readerId, senderId);
      targetUserIds.forEach((targetUserId) => {
        emitToUserRoom(targetUserId, "messageRead", {
          conversationId,
          readerId,
          readAt: new Date().toISOString(),
        });
      });
    } catch (err) {
      console.error('markAsRead socket error:', err);
    }
  });

  // タイピング中の通知
  socket.on("typing", async ({ conversationId, receiverId }) => {
    const userId = socket.data.userId;
    if (!userId || !receiverId || !conversationId) {
      return;
    }

    try {
      const memberIds = await getConversationMemberIdsCached(conversationId);
      if (!memberIds) return;
      if (!memberIdsInclude(memberIds, userId) || !memberIdsInclude(memberIds, receiverId)) {
        return;
      }

      emitToUserRoom(receiverId, "userTyping", {
        conversationId,
        userId,
      });
    } catch (err) {
      console.error('typing socket error:', err);
    }
  });

  // タイピング停止の通知
  socket.on("stopTyping", async ({ conversationId, receiverId }) => {
    const userId = socket.data.userId;
    if (!userId || !receiverId || !conversationId) {
      return;
    }

    try {
      const memberIds = await getConversationMemberIdsCached(conversationId);
      if (!memberIds) return;
      if (!memberIdsInclude(memberIds, userId) || !memberIdsInclude(memberIds, receiverId)) {
        return;
      }

      emitToUserRoom(receiverId, "userStopTyping", {
        conversationId,
        userId,
      });
    } catch (err) {
      console.error('stopTyping socket error:', err);
    }
  });

  // 切断処理
  socket.on("disconnect", (reason) => {
    console.log("A user disconnected:", socket.id);
    removeUser(socket.id);
    io.emit("getUsers", users);
    recordSocketDisconnection({
      userId: connectedUserId,
      socketId: socket.id,
      reason,
    });
  });
});

// ミドルウェア
app.use(helmet());
app.use(compression());
app.use(morgan('common'));
app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));
app.use(requestMetricsMiddleware);
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
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));


// Upstash Redis (REST) client (falls back to mock when env vars are missing)
// If you need Redis here, use redisClient.

// Passport設定
require('./config/passport');

// Firebase Admin 初期化（未設定時は自動的に無効化）
initializeFirebaseAdmin();
startBatchedNotificationScheduler();
startWeeklyLearningBadgeScheduler();

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
app.use('/api/ai', require('./routes/ai'));

// サーバー起動
const PORT = process.env.PORT || 8800;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.io enabled for real-time messaging`);
});