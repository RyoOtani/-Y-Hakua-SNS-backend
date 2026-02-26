const dotenv = require("dotenv");
const { Redis } = require("@upstash/redis");

dotenv.config();

// Upstash Redis (REST)
// Render/Vercel等では環境変数で設定:
// - UPSTASH_REDIS_REST_URL
// - UPSTASH_REDIS_REST_TOKEN
//
// 互換性のため、既存コードは `redisClient.xxx(...)` をこのインスタンスに対して呼び出す前提。
let redisClient;

try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } else {
    // throw new Error("UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is missing.");
    console.warn("Display warning: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is missing. Redis functionality will be disabled.");
    // Mock interface to prevent crashes
    redisClient = {
      get: async () => null,
      set: async () => "OK",
      del: async () => 1,
      // Add other methods as needed or use a Proxy to catch all
    };
  }
} catch (error) {
  console.error("Redis client initialization failed:", error);
  redisClient = {
      get: async () => null,
      set: async () => "OK",
      del: async () => 1,
  };
}

module.exports = redisClient;
