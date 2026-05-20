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
 * No-ops with a console.warn if `SENTRY_DSN` is unset — keeps dev /
 * preview deploys working without forcing the env var.
 */
export function initSentry(): void {
  if (initialized) {
    return;
  }

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn(
      "[sentry] SENTRY_DSN not set; skipping init. Errors will NOT be reported.",
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
    // crash the operation it was trying to instrument.
    console.error("[sentry.captureException] internal error:", sentryErr);
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
    console.error("[sentry.captureMessage] internal error:", sentryErr);
  }
}

/**
 * Re-export of Sentry's v10 Express error handler. Register AFTER all
 * routes / middleware so it catches anything that bubbles up:
 *
 *   setupExpressErrorHandler(app);   // last app.use() in the chain
 */
export const setupExpressErrorHandler = Sentry.setupExpressErrorHandler;
