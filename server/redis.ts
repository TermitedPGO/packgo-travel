import Redis, { RedisOptions } from "ioredis";

/**
 * Redis client configuration for Pack&Go Travel
 *
 * BUG-001 Fix: Two separate connections are maintained:
 * 1. `redis`       — General-purpose (cache, rate-limit, exchange rates)
 *                    commandTimeout: 30000ms
 * 2. `redisBullMQ` — Dedicated BullMQ client
 *                    commandTimeout: OMITTED (undefined)
 *                    BullMQ uses BLPOP which is a blocking command that legitimately
 *                    waits 30s+ for new jobs. Setting commandTimeout to 0 causes
 *                    immediate timeouts (setTimeout(0) fires instantly in ioredis v5).
 *                    The only correct fix is to NOT set commandTimeout at all.
 *
 * For Upstash: Set UPSTASH_REDIS_URL environment variable
 * Format: rediss://default:PASSWORD@ENDPOINT:PORT
 */

const upstashUrl = process.env.UPSTASH_REDIS_URL;

// Exponential backoff retry: 500ms, 1s, 1.5s ... up to 5s, stop after 10 attempts
const RETRY_STRATEGY = (times: number) => {
  if (times > 10) return null;
  return Math.min(times * 500, 5000);
};

// Reconnect on transient network errors
const RECONNECT_ON_ERROR = (err: Error) => {
  const transientErrors = ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"];
  return transientErrors.some((e) => err.message.includes(e));
};

function createRedisClient(opts: {
  label: string;
  commandTimeout?: number; // undefined = no timeout (for BullMQ blocking commands)
}): Redis {
  const baseOptions: RedisOptions = {
    maxRetriesPerRequest: null,   // Required for BullMQ
    enableReadyCheck: false,      // Required for BullMQ
    retryStrategy: RETRY_STRATEGY,
    reconnectOnError: RECONNECT_ON_ERROR,
    connectTimeout: 15000,        // 15s connection timeout
    // Defer the socket until the first command instead of opening it at import.
    // Prod connects on first use at startup (negligible delay). Critically, a
    // test process that merely IMPORTS a module touching redis now opens ZERO
    // sockets — so an interrupted/killed test run can't orphan connections that
    // then poison the next run (root cause of the 2026-06-15 ~80-min suite run;
    // steady-state is ~90s). See docs/features note + redis.test.ts.
    lazyConnect: true,
  };

  // Only set commandTimeout if explicitly provided (undefined = no timeout)
  // ioredis checks: typeof this.options.commandTimeout === "number"
  // so undefined safely skips the timer entirely
  if (opts.commandTimeout !== undefined) {
    baseOptions.commandTimeout = opts.commandTimeout;
  }

  let client: Redis;

  if (upstashUrl) {
    baseOptions.tls = { rejectUnauthorized: false }; // Required for Upstash TLS
    client = new Redis(upstashUrl, baseOptions);
  } else {
    baseOptions.host = process.env.REDIS_HOST || "127.0.0.1";
    baseOptions.port = parseInt(process.env.REDIS_PORT || "6379");
    client = new Redis(baseOptions);
  }

  client.on("connect", () => console.log(`✅ [${opts.label}] Redis connected`));
  client.on("ready",   () => console.log(`✅ [${opts.label}] Redis ready`));
  client.on("reconnecting", () => console.log(`🔄 [${opts.label}] Redis reconnecting...`));
  client.on("error", (err) => {
    const isTransient = ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"].some((e) =>
      err.message.includes(e)
    );
    if (!isTransient) {
      console.error(`❌ [${opts.label}] Redis error:`, err.message);
    } else {
      console.warn(`⚠️ [${opts.label}] Redis transient error (will retry):`, err.message);
    }
  });

  return client;
}

console.log("🔗 Redis clients created (" + (upstashUrl ? "Upstash" : "local") + ", lazyConnect — socket opens on first command)");

/**
 * General-purpose Redis client
 * Used for: cache, rate-limit, exchange rates, LLM cache
 * commandTimeout: 30s (regular commands should complete quickly)
 */
const redis = createRedisClient({ label: "General", commandTimeout: 30000 });

/**
 * BullMQ-dedicated Redis client
 * commandTimeout: undefined (NOT SET) — BLPOP is a blocking command that waits for jobs.
 * Setting commandTimeout to any value (including 0) causes false errors on Upstash free tier.
 * ioredis v5: typeof commandTimeout === "number" check means undefined safely skips the timer.
 */
const redisBullMQ = createRedisClient({ label: "BullMQ" }); // commandTimeout intentionally omitted

export { redis, redisBullMQ };
export default redis;
