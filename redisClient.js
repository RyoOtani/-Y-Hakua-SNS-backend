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

const resolveMethod = (client, names) => {
  for (const name of names) {
    if (client && typeof client[name] === "function") {
      return client[name].bind(client);
    }
  }
  return null;
};

const normalizeZRangeWithScores = (result) => {
  if (!Array.isArray(result)) return [];
  if (result.length === 0) return [];

  // node-redis: [{ value, score }], upstash: [{ member, score }]
  if (typeof result[0] === "object" && result[0] !== null) {
    return result
      .map((entry) => {
        const value = entry.value ?? entry.member;
        const score = Number(entry.score ?? 0);
        if (value == null) return null;
        return { value: String(value), score };
      })
      .filter(Boolean);
  }

  // upstash fallback can return [member, score, member, score, ...]
  const normalized = [];
  for (let i = 0; i < result.length; i += 2) {
    const value = result[i];
    const score = Number(result[i + 1] ?? 0);
    if (value == null) continue;
    normalized.push({ value: String(value), score });
  }
  return normalized;
};

const createCompatibleClient = (getActiveClient) => {
  const call = async (methodNames, ...args) => {
    const active = getActiveClient();
    const fn = resolveMethod(active, methodNames);
    if (!fn) {
      throw new TypeError(
        `Redis method not available: ${methodNames.join("/")}`
      );
    }
    return fn(...args);
  };

  return {
    get: (...args) => call(["get"], ...args),
    set: (...args) => call(["set"], ...args),
    del: (...args) => call(["del"], ...args),
    expire: (...args) => call(["expire"], ...args),
    lPush: (...args) => call(["lPush", "lpush"], ...args),
    lTrim: (...args) => call(["lTrim", "ltrim"], ...args),
    lRange: (...args) => call(["lRange", "lrange"], ...args),
    zIncrBy: (...args) => call(["zIncrBy", "zincrby"], ...args),
    sAdd: (...args) => call(["sAdd", "sadd"], ...args),
    sRem: (...args) => call(["sRem", "srem"], ...args),
    sMembers: (...args) => call(["sMembers", "smembers"], ...args),
    async zRevRangeWithScores(key, start, stop) {
      const active = getActiveClient();
      const direct = resolveMethod(active, [
        "zRevRangeWithScores",
        "zrevrangeWithScores",
      ]);
      if (direct) {
        const result = await direct(key, start, stop);
        return normalizeZRangeWithScores(result);
      }

      const zrange = resolveMethod(active, ["zRange", "zrange"]);
      if (!zrange) {
        throw new TypeError("Redis method not available: zRevRangeWithScores");
      }

      const result = await zrange(key, start, stop, {
        REV: true,
        WITHSCORES: true,
      });
      return normalizeZRangeWithScores(result);
    },
    multi() {
      const active = getActiveClient();
      const nativeMulti = resolveMethod(active, ["multi"]);
      if (nativeMulti) return nativeMulti();

      // Upstash REST client does not expose node-redis style `multi`.
      const ops = [];
      const pipeline = {
        del: (...args) => {
          ops.push({ method: "del", args });
          return pipeline;
        },
        lPush: (...args) => {
          ops.push({ method: "lPush", args });
          return pipeline;
        },
        lTrim: (...args) => {
          ops.push({ method: "lTrim", args });
          return pipeline;
        },
        async exec() {
          const results = [];
          for (const op of ops) {
            // Execute sequentially for compatibility across clients.
            // Existing routes already treat this cache sync as best-effort.
            // eslint-disable-next-line no-await-in-loop
            results.push(await redisClient[op.method](...op.args));
          }
          return results;
        },
      };
      return pipeline;
    },
  };
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

redisClient = createCompatibleClient(() => clientRef || createMockClient());

module.exports = redisClient;
