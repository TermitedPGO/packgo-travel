/**
 * Deep health check — pings DB + Redis + Stripe + LLM and rolls the per-
 * dependency results into a single { overall, checks } payload.
 *
 * Wave 1 Module 1.3 (2026-05-19/20) — sister of `/healthz` (Fly's shallow
 * probe). The shallow probe just answers "the Express process is up";
 * this deep probe answers "every external service the app NEEDS to do
 * real work is reachable".
 *
 * Public surface:
 *   - `runHealthChecks()` — returns the rolled-up payload. Never throws.
 *     Each sub-check fails locally (`status: "fail"`, `error: "<msg>"`) and
 *     the overall verdict degrades — but the function ALWAYS returns.
 *   - `_resetCachesForTests()` — test-only escape hatch so Vitest can
 *     verify cache-hit behavior across two adjacent calls.
 *
 * Caching:
 *   - Stripe: 5 min. UptimeRobot polls every 5 min, so each poll hits
 *     Stripe's cache at most once → ~288 real calls/day vs 12,960. Well
 *     within Stripe's per-account rate budget either way, but the cache
 *     also defends against an admin dashboard tile polling every 30s.
 *   - LLM: 1 h. `models.list` is cheap (~$0) but rate-limited; 24 calls/day
 *     vs 12,960 is the right trade-off.
 *   - DB + Redis: NOT cached — they're already 1-2ms locally and we WANT
 *     fresh state every poll.
 *
 * Single Fly machine, so in-process Map cache is sufficient. If we ever
 * scale to >1 machine, each machine maintains its own cache (still cheap).
 *
 * UptimeRobot config:
 * - URL: https://packgoplay.com/health
 * - Type: HTTP(s) keyword check
 * - Keyword: "ok" (matches `"overall":"ok"` substring in response JSON)
 * - Interval: 5 min (free tier)
 * - Alert email: Jeff (set inside UptimeRobot's monitor settings)
 * - Alert threshold: 1st failure (UptimeRobot default; revisit in week 1
 *   if noisy)
 */

import { captureException } from "./sentry";
import { createChildLogger } from "./logger";
import { ENV } from "./env";

const log = createChildLogger({ module: "healthCheck" });

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export type SubCheckStatus = "ok" | "fail";

export interface SubCheckResult {
  status: SubCheckStatus;
  latencyMs: number;
  error?: string;
}

export type OverallStatus = "ok" | "degraded" | "down";

export interface HealthCheckPayload {
  overall: OverallStatus;
  checks: {
    db: SubCheckResult;
    redis: SubCheckResult;
    stripe: SubCheckResult;
    llm: SubCheckResult;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Per-dependency timeout budgets
// ────────────────────────────────────────────────────────────────────────────

const TIMEOUT_DB_MS = 2_000;
const TIMEOUT_REDIS_MS = 1_000;
const TIMEOUT_STRIPE_MS = 5_000;
const TIMEOUT_LLM_MS = 5_000;

// ────────────────────────────────────────────────────────────────────────────
// In-process micro-caches (Stripe 5min, LLM 1h)
// ────────────────────────────────────────────────────────────────────────────

const STRIPE_CACHE_TTL_MS = 5 * 60 * 1_000;
const LLM_CACHE_TTL_MS = 60 * 60 * 1_000;

interface CacheEntry {
  value: SubCheckResult;
  expiresAt: number;
}

const stripeCache: CacheEntry = { value: { status: "ok", latencyMs: 0 }, expiresAt: 0 };
const llmCache: CacheEntry = { value: { status: "ok", latencyMs: 0 }, expiresAt: 0 };

/**
 * Test-only: reset both micro-caches so adjacent test cases don't bleed
 * cached responses into each other. NEVER call from production code.
 */
export function _resetCachesForTests(): void {
  stripeCache.value = { status: "ok", latencyMs: 0 };
  stripeCache.expiresAt = 0;
  llmCache.value = { status: "ok", latencyMs: 0 };
  llmCache.expiresAt = 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Generic timeout wrapper
// ────────────────────────────────────────────────────────────────────────────

/**
 * Race a promise against a timeout. Returns the promise's result if it
 * resolves first; throws a "timeout after Nms" error otherwise.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timeout after ${ms}ms`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return "unknown error";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-checks
// ────────────────────────────────────────────────────────────────────────────

/**
 * DB sub-check — runs `SELECT 1` via Drizzle's execute surface. Times out
 * at 2s. If `getDb()` returns null (DATABASE_URL unset in dev), reports a
 * clear "db not configured" failure rather than crashing.
 */
async function checkDb(): Promise<SubCheckResult> {
  const t0 = Date.now();
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) {
      return {
        status: "fail",
        latencyMs: Date.now() - t0,
        error: "db not configured (DATABASE_URL missing)",
      };
    }
    await withTimeout(db.execute(sql`SELECT 1`), TIMEOUT_DB_MS, "db");
    return { status: "ok", latencyMs: Date.now() - t0 };
  } catch (err) {
    const message = errMsg(err);
    log.warn(
      { event: "healthcheck.dependency_failed", dep: "db", err: message },
      "health check sub-fail",
    );
    return { status: "fail", latencyMs: Date.now() - t0, error: message };
  }
}

/**
 * Redis sub-check — `PING` via the general-purpose ioredis client. Times
 * out at 1s (Redis should be sub-ms on Upstash; if it's >1s, treat as
 * degraded).
 */
async function checkRedis(): Promise<SubCheckResult> {
  const t0 = Date.now();
  try {
    const { redis } = await import("../redis");
    const result = await withTimeout(redis.ping(), TIMEOUT_REDIS_MS, "redis");
    // ioredis returns "PONG" string on success. Anything else is suspect.
    if (result !== "PONG") {
      return {
        status: "fail",
        latencyMs: Date.now() - t0,
        error: `unexpected ping reply: ${String(result)}`,
      };
    }
    return { status: "ok", latencyMs: Date.now() - t0 };
  } catch (err) {
    const message = errMsg(err);
    log.warn(
      { event: "healthcheck.dependency_failed", dep: "redis", err: message },
      "health check sub-fail",
    );
    return { status: "fail", latencyMs: Date.now() - t0, error: message };
  }
}

/**
 * Stripe sub-check — `balance.retrieve()` is cheap, doesn't mutate, and
 * proves both auth + reachability. Cached 5 min so UptimeRobot's 5-min
 * cadence costs ~1 real Stripe call per poll cycle.
 *
 * If STRIPE_SECRET_KEY is unset (preview env), reports a clear-text
 * failure rather than throwing.
 */
async function checkStripe(): Promise<SubCheckResult> {
  const now = Date.now();
  if (now < stripeCache.expiresAt) {
    // Return cached value verbatim. Latency reported is the original call's
    // latency, not the cache-hit latency, so the dashboard isn't misleading.
    return stripeCache.value;
  }
  const t0 = now;
  try {
    if (!ENV.stripeSecretKey) {
      const result: SubCheckResult = {
        status: "fail",
        latencyMs: Date.now() - t0,
        error: "STRIPE_SECRET_KEY not configured",
      };
      stripeCache.value = result;
      stripeCache.expiresAt = Date.now() + STRIPE_CACHE_TTL_MS;
      return result;
    }
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(ENV.stripeSecretKey);
    await withTimeout(stripe.balance.retrieve(), TIMEOUT_STRIPE_MS, "stripe");
    const result: SubCheckResult = { status: "ok", latencyMs: Date.now() - t0 };
    stripeCache.value = result;
    stripeCache.expiresAt = Date.now() + STRIPE_CACHE_TTL_MS;
    return result;
  } catch (err) {
    const message = errMsg(err);
    log.warn(
      { event: "healthcheck.dependency_failed", dep: "stripe", err: message },
      "health check sub-fail",
    );
    const result: SubCheckResult = {
      status: "fail",
      latencyMs: Date.now() - t0,
      error: message,
    };
    // Cache failures too — otherwise a Stripe outage = 12,960 retries/day.
    stripeCache.value = result;
    stripeCache.expiresAt = Date.now() + STRIPE_CACHE_TTL_MS;
    return result;
  }
}

/**
 * LLM sub-check — `models.list()` on the Anthropic SDK. Returns the
 * available-models page; we only care that the call succeeds (don't read
 * the page contents). Cached 1 h since this rarely changes and burns rate
 * budget if polled often.
 *
 * If ANTHROPIC_API_KEY is unset, reports a clear-text failure.
 */
async function checkLlm(): Promise<SubCheckResult> {
  const now = Date.now();
  if (now < llmCache.expiresAt) {
    return llmCache.value;
  }
  const t0 = now;
  try {
    if (!ENV.anthropicApiKey) {
      const result: SubCheckResult = {
        status: "fail",
        latencyMs: Date.now() - t0,
        error: "ANTHROPIC_API_KEY not configured",
      };
      llmCache.value = result;
      llmCache.expiresAt = Date.now() + LLM_CACHE_TTL_MS;
      return result;
    }
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: ENV.anthropicApiKey });
    // models.list returns a PagePromise; awaiting fetches the first page.
    await withTimeout(client.models.list(), TIMEOUT_LLM_MS, "llm");
    const result: SubCheckResult = { status: "ok", latencyMs: Date.now() - t0 };
    llmCache.value = result;
    llmCache.expiresAt = Date.now() + LLM_CACHE_TTL_MS;
    return result;
  } catch (err) {
    const message = errMsg(err);
    log.warn(
      { event: "healthcheck.dependency_failed", dep: "llm", err: message },
      "health check sub-fail",
    );
    const result: SubCheckResult = {
      status: "fail",
      latencyMs: Date.now() - t0,
      error: message,
    };
    llmCache.value = result;
    llmCache.expiresAt = Date.now() + LLM_CACHE_TTL_MS;
    return result;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ────────────────────────────────────────────────────────────────────────────

/**
 * Run all four sub-checks in parallel and roll them up into a single
 * payload. Uses `Promise.allSettled` so a single sub-check throwing
 * unexpectedly never breaks the others.
 *
 * Overall verdict:
 *   - "ok"        — all 4 sub-checks ok
 *   - "down"      — all 4 sub-checks failed
 *   - "degraded"  — anything in between
 *
 * Never throws. If something completely unexpected blows up, captures to
 * Sentry + logs the error, and reports the failure as a sub-check fail.
 */
export async function runHealthChecks(): Promise<HealthCheckPayload> {
  const settled = await Promise.allSettled([
    checkDb(),
    checkRedis(),
    checkStripe(),
    checkLlm(),
  ]);
  const [dbS, redisS, stripeS, llmS] = settled;

  function unwrap(s: PromiseSettledResult<SubCheckResult>, dep: string): SubCheckResult {
    if (s.status === "fulfilled") return s.value;
    // Sub-check threw something the wrapper didn't catch — defensive only.
    // Log + capture so we know to harden the sub-check itself.
    const message = errMsg(s.reason);
    log.error(
      { err: s.reason, dep, event: "healthcheck.unexpected_throw" },
      "health sub-check threw unexpectedly",
    );
    captureException(s.reason, { tags: { area: "healthCheck", dep } });
    return { status: "fail", latencyMs: 0, error: message };
  }

  const checks = {
    db: unwrap(dbS, "db"),
    redis: unwrap(redisS, "redis"),
    stripe: unwrap(stripeS, "stripe"),
    llm: unwrap(llmS, "llm"),
  };

  const failCount = Object.values(checks).filter((c) => c.status === "fail").length;
  const overall: OverallStatus =
    failCount === 0 ? "ok" : failCount === 4 ? "down" : "degraded";

  return { overall, checks };
}
