/**
 * Sentry wrapper for the Node/Express server.
 *
 * Module 1.1 of v2 Wave 1 (2026-05-19) — foundational observability gate.
 * Every Wave 2/3/4 module assumes "Sentry already catches regressions in
 * <2min" once this lands.
 *
 * Public surface (intentionally small — Sentry SDK is huge; we expose just
 * the calls the rest of the codebase needs):
 *   - `initSentry()` — idempotent. Call once from server entry before any
 *     route handlers register. Safe to call multiple times (test runs,
 *     server reload) — subsequent calls are no-ops.
 *   - `captureException(err, context?)` — proxies `Sentry.captureException`
 *     with an optional context bag (tags, extras). Use from BullMQ workers,
 *     scheduled tasks, anywhere a `notifyOwner` call already exists.
 *   - `captureMessage(msg, level?)` — proxies `Sentry.captureMessage`. Use
 *     for non-error events worth surfacing (e.g. policy-proposal generated).
 *   - `setupExpressErrorHandler(app)` — re-export so callers can register
 *     it AFTER all routes (v10 API; v7 used `Sentry.Handlers.errorHandler`).
 *
 * v8/v10 API note: Sentry v8 moved away from the `Sentry.Handlers.*` namespace
 * to integration-based instrumentation. We pass `expressIntegration()` in
 * the integrations array (auto-instruments Express routes) and call
 * `setupExpressErrorHandler(app)` to register the final error handler.
 *
 * Cost discipline (free-tier 5K events/mo, ~800 monthly users):
 *   - `tracesSampleRate: 0.1` → 10% of transactions tracked
 *   - errors: 100% (sample == 1.0)
 *   - profiling: not enabled (paid feature)
 */

import * as Sentry from "@sentry/node";

let initialized = false;

/**
 * Initialize Sentry. Idempotent — safe to call multiple times. After the
 * first successful call, all subsequent calls are no-ops (logged at info).
 *
 * Writes to process.stderr if `SENTRY_DSN` is unset — keeps dev /
 * preview deploys working without forcing the env var. Deliberately avoids
 * the pino logger here because logger.ts imports @sentry/node for the
 * error-bridge integration: importing logger from sentry.ts would create a
 * circular dependency on module init (logger constructor runs sentry bridge
 * setup → reaches into sentry.ts → which imports logger → boom).
 */
export function initSentry(): void {
  if (initialized) {
    return;
  }

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    process.stderr.write(
      "[sentry] SENTRY_DSN not set; skipping init. Errors will NOT be reported.\n",
    );
    initialized = true; // mark so we don't spam the warning
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release:
      process.env.FLY_MACHINE_VERSION ??
      process.env.GIT_COMMIT ??
      "unknown",
    integrations: [
      // Auto-instrument Express routes for tracing. v10 API.
      Sentry.expressIntegration(),
    ],
    // 100% of errors, 10% of transactions. Stays well within free-tier
    // 5K events/mo at ~800 monthly users.
    sampleRate: 1.0,
    tracesSampleRate: 0.1,
    // Don't send default PII (req body, cookies). We can opt-in per scope
    // when needed.
    sendDefaultPii: false,
    // 2026-05-22 — drop socket-level noise that has no actionable signal.
    // EPIPE / ECONNRESET happen any time a peer closes mid-write (deploy
    // rolling restart, client tab close on long-poll, mobile suspend on
    // SSE). Filtering at the SDK keeps the project under free-tier 5K
    // events/mo and stops "fatal" emails on every fly deploy. See also
    // the SIGTERM graceful-shutdown handler in _core/index.ts — that
    // reduces *occurrence*, this is belt-and-suspenders for whatever
    // slips past graceful drain (genuine network blips, etc.).
    ignoreErrors: [
      "write EPIPE",
      "read ECONNRESET",
      "Client network socket disconnected",
      // 2026-05-26: prevent inbox storms from known-handled infra signals.
      // Each of these is already retry-loop-aware in invokeLLM / circuit
      // breaker / BullMQ stalled-job recovery. They are noise, not bugs.
      "LLM_RATE_LIMITED",      // 429 retries exhausted → caller defers
      "LLM_CIRCUIT_OPEN",      // breaker open during Anthropic outage
      "LLM_TIMEOUT",           // 120s ceiling — retried elsewhere
      "could not renew lock",  // BullMQ lock renew when machine under load
      "rate_limit_error",      // raw Anthropic 429 phrasing (defensive)
    ],
    beforeSend(event, hint) {
      const err = hint.originalException as
        | { code?: string; rateLimited?: boolean; circuitOpen?: boolean; message?: string }
        | undefined;
      if (err?.code === "EPIPE" || err?.code === "ECONNRESET") return null;
      // Anthropic rate-limit + circuit-open are infrastructure pressure
      // signals, already retried via invokeLLM's exponential backoff.
      // Sentry-grade alerts here are noise — emails flood Jeff.
      if (err?.rateLimited === true || err?.circuitOpen === true) return null;
      const msg = err?.message ?? "";
      if (
        msg.includes("LLM_RATE_LIMITED") ||
        msg.includes("LLM_CIRCUIT_OPEN") ||
        msg.includes("rate_limit_error") ||
        msg.includes("could not renew lock")
      ) {
        return null;
      }
      return event;
    },
  });

  initialized = true;
}

/**
 * Reset the initialized flag. Test-only — exported so Vitest can assert
 * idempotency cleanly. Do NOT call from production code.
 */
export function _resetSentryForTests(): void {
  initialized = false;
}

/**
 * Whether `initSentry()` has been called (with or without DSN). Exposed for
 * tests; runtime callers should just call init unconditionally.
 */
export function isSentryInitialized(): boolean {
  return initialized;
}

/**
 * Capture an exception. Thin wrapper so callers don't need to import
 * `@sentry/node` directly + we can attach context metadata in one place.
 *
 * Safe to call before `initSentry()` — Sentry's SDK no-ops gracefully.
 */
export function captureException(
  err: unknown,
  context?: { tags?: Record<string, string>; extras?: Record<string, unknown> },
): void {
  try {
    Sentry.withScope((scope) => {
      if (context?.tags) {
        for (const [k, v] of Object.entries(context.tags)) {
          scope.setTag(k, v);
        }
      }
      if (context?.extras) {
        for (const [k, v] of Object.entries(context.extras)) {
          scope.setExtra(k, v);
        }
      }
      Sentry.captureException(err);
    });
  } catch (sentryErr) {
    // NEVER throw from observability. A broken Sentry transport must not
    // crash the operation it was trying to instrument. Use process.stderr
    // directly to avoid recursing through the pino-Sentry bridge.
    process.stderr.write(
      `[sentry.captureException] internal error: ${String(sentryErr)}\n`,
    );
  }
}

/**
 * Capture a non-error message. Thin wrapper around `Sentry.captureMessage`.
 */
export function captureMessage(
  msg: string,
  level: "fatal" | "error" | "warning" | "info" | "debug" = "info",
): void {
  try {
    Sentry.captureMessage(msg, level);
  } catch (sentryErr) {
    // Same reasoning as captureException — use stderr to avoid recursion.
    process.stderr.write(
      `[sentry.captureMessage] internal error: ${String(sentryErr)}\n`,
    );
  }
}

/**
 * Re-export of Sentry's v10 Express error handler. Register AFTER all
 * routes / middleware so it catches anything that bubbles up:
 *
 *   setupExpressErrorHandler(app);   // last app.use() in the chain
 */
export const setupExpressErrorHandler = Sentry.setupExpressErrorHandler;
