const dotenv = require("dotenv");
const { Redis } = require("@upstash/redis");
const { createClient } = require("redis");

dotenv.config();

// Upstash Redis (REST)
// Render/Vercel等では環境変数で設定:
// - UPSTASH_REDIS_REST_URL
// - UPSTASH_REDIS_REST_TOKEN
//
// 互換性のため、既存コードは `redisClient.xxx(...)` をこのインスタンスに対して呼び出す前提。
let redisClient;
let clientRef;

const createMockClient = () => ({
  get: async () => null,
  set: async () => "OK",
  del: async () => 1,
  lRange: async () => [],
  lPush: async () => 0,
  lTrim: async () => "OK",
  zIncrBy: async () => 0,
  expire: async () => 1,
  multi: () => ({
    del: () => {},
    lPush: () => {},
    lTrim: () => {},
    exec: async () => [],
  }),
});

const sanitizeRedisUrl = (raw) => {
  if (!raw) return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/redis:\/\/[^\s]+/);
  return match ? match[0] : trimmed;
};

try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    clientRef = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } else if (process.env.REDIS_URL) {
    const redisUrl = sanitizeRedisUrl(process.env.REDIS_URL);
    const client = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: () => false,
      },
    });
    client.on("error", () => {
      clientRef = createMockClient();
    });
    client.connect().catch(() => {
      clientRef = createMockClient();
    });
    clientRef = client;
  } else {
    clientRef = createMockClient();
  }
} catch (error) {
  clientRef = createMockClient();
}

redisClient = new Proxy({}, {
  get: (_target, prop) => {
    const active = clientRef || createMockClient();
    const value = active[prop];
    if (typeof value === "function") {
      return value.bind(active);
    }
    return value;
  },
});

module.exports = redisClient;
