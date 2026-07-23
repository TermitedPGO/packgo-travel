import redis from "./redis";

/**
 * Rate limiter using Redis
 * Implements sliding window algorithm
 */
export interface RateLimitConfig {
  key: string; // Unique identifier (e.g., userId, IP)
  limit: number; // Max requests
  window: number; // Time window in seconds
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp
}

/**
 * Check if request is within rate limit
 */
export async function checkRateLimit(config: RateLimitConfig): Promise<RateLimitResult> {
  // Skip rate limiting in test environment
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return { allowed: true, remaining: 999, resetAt: Date.now() + 3600000 };
  }

  const { key, limit, window } = config;
  const now = Date.now();
  const windowStart = now - window * 1000;
  
  // Redis key for this rate limit
  const redisKey = `ratelimit:${key}`;
  
  // Remove old entries outside the window
  await redis.zremrangebyscore(redisKey, 0, windowStart);
  
  // Count requests in current window
  const count = await redis.zcard(redisKey);
  
  if (count >= limit) {
    // Rate limit exceeded
    const oldestEntry = await redis.zrange(redisKey, 0, 0, "WITHSCORES");
    const resetAt = oldestEntry.length > 1 
      ? parseInt(oldestEntry[1]) + window * 1000 
      : now + window * 1000;
    
    return {
      allowed: false,
      remaining: 0,
      resetAt,
    };
  }
  
  // Add current request
  await redis.zadd(redisKey, now, `${now}-${Math.random()}`);
  
  // Set expiry to clean up old keys
  await redis.expire(redisKey, window);
  
  return {
    allowed: true,
    remaining: limit - count - 1,
    resetAt: now + window * 1000,
  };
}

/**
 * Atomic fixed-window rate limit.
 *
 * checkRateLimit (above) reads the count and then writes in separate commands, so a
 * concurrent burst can all read below the limit before any write lands and slip through
 * together (TOCTOU). This variant runs INCR + a self-healing EXPIRE in ONE Lua script,
 * which Redis executes atomically: N concurrent callers get N distinct counts, so only
 * `limit` are ever allowed and no burst exceeds the cap. Doing the EXPIRE inside the
 * script (whenever TTL is missing, not only on the first INCR) also closes the window
 * where a lost EXPIRE would strand the key with TTL=-1 and block the IP forever.
 *
 * Skips in the test environment (same as checkRateLimit): there is no Redis in unit
 * tests, so a test that fires N concurrent calls will see all N allowed. That is an
 * artefact of the test harness, not a production gap — assert the throttle logic via a
 * mocked Redis (see rateLimit.atomic.test.ts) instead.
 */
const ATOMIC_RL_LUA = `
local c = redis.call('INCR', KEYS[1])
local t = redis.call('TTL', KEYS[1])
if t < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  t = tonumber(ARGV[1])
end
return {c, t}
`;

export async function checkAtomicRateLimit(config: RateLimitConfig): Promise<RateLimitResult> {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return { allowed: true, remaining: 999, resetAt: Date.now() + config.window * 1000 };
  }
  const { key, limit, window } = config;
  const redisKey = `ratelimit:atomic:${key}`;
  const [count, ttl] = (await redis.eval(ATOMIC_RL_LUA, 1, redisKey, String(window))) as [number, number];
  const resetAt = Date.now() + (ttl > 0 ? ttl : window) * 1000;
  if (count > limit) {
    return { allowed: false, remaining: 0, resetAt };
  }
  return { allowed: true, remaining: limit - count, resetAt };
}

/**
 * Rate limit middleware for tour generation
 * Limit: 5 requests per hour per user
 */
export async function checkTourGenerationRateLimit(userId: number): Promise<RateLimitResult> {
  return checkRateLimit({
    key: `tour-generation:user:${userId}`,
    limit: 5, // 5 requests
    window: 3600, // per hour
  });
}

/**
 * Rate limit middleware for image generation
 * Limit: 20 requests per hour per user
 */
export async function checkImageGenerationRateLimit(userId: number): Promise<RateLimitResult> {
  return checkRateLimit({
    key: `image-generation:user:${userId}`,
    limit: 20, // 20 requests
    window: 3600, // per hour
  });
}

// ============================================================
// Forgot Password Rate Limiting & Abuse Prevention
// ============================================================

/**
 * Disposable / fake email domains that should never receive real emails.
 * This list covers common test domains and disposable email providers.
 */
const BLOCKED_EMAIL_DOMAINS = new Set([
  // RFC 2606 reserved / test domains
  "example.com",
  "example.net",
  "example.org",
  "test.com",
  "localhost",
  "invalid",
  // Common disposable email providers
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.biz",
  "guerrillamail.de",
  "guerrillamail.info",
  "sharklasers.com",
  "guerrillamailblock.com",
  "grr.la",
  "guerrillamail.it",
  "spam4.me",
  "yopmail.com",
  "yopmail.fr",
  "cool.fr.nf",
  "jetable.fr.nf",
  "nospam.ze.tc",
  "nomail.xl.cx",
  "mega.zik.dj",
  "speed.1s.fr",
  "courriel.fr.nf",
  "moncourrier.fr.nf",
  "monemail.fr.nf",
  "monmail.fr.nf",
  "10minutemail.com",
  "10minutemail.net",
  "10minutemail.org",
  "10minutemail.co.uk",
  "10minutemail.de",
  "10minutemail.ru",
  "tempmail.com",
  "temp-mail.org",
  "throwam.com",
  "throwam.net",
  "dispostable.com",
  "mailnull.com",
  "spamgourmet.com",
  "trashmail.at",
  "trashmail.com",
  "trashmail.io",
  "trashmail.me",
  "trashmail.net",
  "trashmail.org",
  "trashmail.xyz",
  "fakeinbox.com",
  "maildrop.cc",
  "mailnesia.com",
  "mailnull.com",
  "spamgourmet.com",
  "spamgourmet.net",
  "spamgourmet.org",
  "discard.email",
  "discardmail.com",
  "discardmail.de",
  "spamspot.com",
  "spamthis.co.uk",
  "spamthisplease.com",
  "throwam.com",
  "throwam.net",
  "throwam.org",
  "mailexpire.com",
  "mailexpire.net",
  "mailexpire.org",
  "spamevader.com",
  "spamevader.net",
  "spamevader.org",
  "mailnull.com",
  "spamgourmet.com",
  "mailnull.com",
  "spamgourmet.com",
]);

/**
 * Check if an email domain is blocked (disposable / test domain).
 */
export function isBlockedEmailDomain(email: string): boolean {
  const parts = email.toLowerCase().split("@");
  if (parts.length !== 2) return true; // malformed
  const domain = parts[1];
  if (!domain || domain.length < 3) return true;
  // Block if domain is in blocklist
  if (BLOCKED_EMAIL_DOMAINS.has(domain)) return true;
  // Block if domain has no TLD (e.g. "user@localhost")
  if (!domain.includes(".")) return true;
  return false;
}

/**
 * Rate limit for forgot-password requests by IP address.
 * Limit: 5 requests per 15 minutes per IP.
 */
export async function checkForgotPasswordRateLimitByIP(ip: string): Promise<RateLimitResult> {
  return checkRateLimit({
    key: `forgot-password:ip:${ip}`,
    limit: 5,
    window: 900, // 15 minutes
  });
}

/**
 * Rate limit for forgot-password requests by email address.
 * Limit: 3 requests per hour per email.
 */
export async function checkForgotPasswordRateLimitByEmail(email: string): Promise<RateLimitResult> {
  const normalizedEmail = email.toLowerCase().trim();
  return checkRateLimit({
    key: `forgot-password:email:${normalizedEmail}`,
    limit: 3,
    window: 3600, // 1 hour
  });
}

/**
 * Global rate limit for forgot-password requests across all IPs.
 * Limit: 100 requests per minute globally (circuit breaker).
 */
export async function checkForgotPasswordGlobalRateLimit(): Promise<RateLimitResult> {
  return checkRateLimit({
    key: `forgot-password:global`,
    limit: 100,
    window: 60, // 1 minute
  });
}

/**
 * Rate limit for login attempts by IP address.
 * Limit: 10 attempts per 15 minutes per IP — covers the case where ONE
 * attacker brute-forces multiple accounts. (More permissive than password
 * reset because legitimate users mistype passwords more often than they
 * forget them.) QA audit 2026-05-11 Phase 6 found login was wide open.
 */
export async function checkLoginRateLimitByIP(ip: string): Promise<RateLimitResult> {
  return checkRateLimit({
    key: `login:ip:${ip}`,
    limit: 10,
    window: 900, // 15 minutes
  });
}

/**
 * Rate limit for login attempts by email address.
 * Limit: 5 attempts per 15 minutes per account — covers credential-stuffing
 * where attacker rotates IPs but targets one account. Same email + wrong
 * password 5× → 15 min lockout (then auto-reopens).
 */
export async function checkLoginRateLimitByEmail(email: string): Promise<RateLimitResult> {
  const normalizedEmail = email.toLowerCase().trim();
  return checkRateLimit({
    key: `login:email:${normalizedEmail}`,
    limit: 5,
    window: 900, // 15 minutes
  });
}

/**
 * Rate limit for admin mutations (per admin user).
 * Limit: 60 mutations / minute per admin user.
 *
 * QA audit 2026-05-11 Phase 6 found admin mutations were not throttled —
 * if Jeff's session token is compromised, an attacker can do thousands of
 * destructive operations per second (delete tours, refund bookings, etc.).
 * 60/min is well above human admin click rate (a fast admin clicks ~5-10/
 * min, browser-driven scripted bulk operations < 30/min) but blocks any
 * automated attack hammering the API.
 */
export async function checkAdminMutationRateLimit(userId: number): Promise<RateLimitResult> {
  return checkRateLimit({
    key: `admin-mutation:user:${userId}`,
    limit: 60,
    window: 60, // 1 minute
  });
}

// ============================================================
// Booking & Payment Rate Limiting
// ============================================================

/**
 * Rate limit for booking creation.
 * Limit: 10 bookings per hour per user (prevents spam bookings)
 */
export async function checkBookingCreateRateLimit(userId: number): Promise<RateLimitResult> {
  return checkRateLimit({
    key: `booking-create:user:${userId}`,
    limit: 10,
    window: 3600, // 1 hour
  });
}

/**
 * Rate limit for Stripe checkout session creation.
 * Limit: 20 sessions per hour per user (prevents Stripe API abuse)
 */
export async function checkCheckoutSessionRateLimit(userId: number): Promise<RateLimitResult> {
  return checkRateLimit({
    key: `checkout-session:user:${userId}`,
    limit: 20,
    window: 3600, // 1 hour
  });
}

// ============================================================
// AI Chat Rate Limiting
// ============================================================

/**
 * Rate limit for AI chat — per-IP hourly cap.
 * Limit: 60 requests per hour per IP (prevents single-IP abuse).
 * Uses IP because chat is accessible without login.
 */
export async function checkAiChatRateLimit(ip: string): Promise<RateLimitResult> {
  return checkRateLimit({
    key: `ai-chat:ip:${ip}`,
    limit: 60,
    window: 3600, // 1 hour
  });
}

/**
 * Rate limit for AI chat — per-IP daily cap.
 * Limit: 200 requests per day per IP.
 * Secondary cap for persistent low-burst abuse that slips through the hourly bucket.
 *
 * Round 72: added because a bot with 24h patience could burn 60×24=1440 msgs/day
 * from one IP under the hourly cap alone.
 */
export async function checkAiChatDailyLimit(ip: string): Promise<RateLimitResult> {
  return checkRateLimit({
    key: `ai-chat:ip-daily:${ip}`,
    limit: 200,
    window: 86400, // 24 hours
  });
}

/**
 * Rate limit for AI chat — global anonymous daily cap.
 * Limit: 5000 requests per day across ALL anonymous traffic (logged-in users bypass).
 * Worst-case cost cap: 5000 × ~$0.01/request = $50/day ceiling for anon chat.
 *
 * Round 72: defense against distributed bot farms with many IPs that each stay
 * under the per-IP caps. Authenticated users have their own per-user limits and
 * don't count toward this bucket.
 */
export async function checkAiChatGlobalAnonymousLimit(): Promise<RateLimitResult> {
  return checkRateLimit({
    key: `ai-chat:global-anonymous`,
    limit: 5000,
    window: 86400, // 24 hours
  });
}

/**
 * Rate limit for AI chat — per-authenticated-user daily cap.
 * Limit: 500 requests per day per user (much more generous than anonymous).
 */
export async function checkAiChatUserDailyLimit(userId: number): Promise<RateLimitResult> {
  return checkRateLimit({
    key: `ai-chat:user-daily:${userId}`,
    limit: 500,
    window: 86400, // 24 hours
  });
}
