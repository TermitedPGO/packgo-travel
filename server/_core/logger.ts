/**
 * Pino structured logger — single source of truth for server-side logging.
 *
 * Wave 1 Module 1.2 (2026-05-19) — replaces raw stdout calls in the
 * critical-path subset (`server/_core/*`, `server/agents/autonomous/*`).
 * The remaining ~1,200 sites in routers/services/agents/root are migrated
 * in Wave 4 — see `docs/refactor/wave-4-deferrals.md`.
 *
 * Public surface:
 *   - `logger` — singleton pino instance. `logger.info({ event, ...fields },
 *     "msg")` is the canonical call form. `logger.error({ err }, "msg")` for
 *     errors (pino's std `err` serializer renders the stack).
 *   - `createChildLogger(bindings)` — factory for per-feature scoped loggers
 *     (e.g. `const log = createChildLogger({ module: "stripeWebhook" })`).
 *
 * Behavior:
 *   - Dev (NODE_ENV !== "production"): pino-pretty transport, colorized,
 *     level=debug. Output is human-readable on the dev terminal.
 *   - Prod: JSON to stdout, level=process.env.LOG_LEVEL || "info". Fly's log
 *     drain ingests JSON lines as-is — every field is greppable.
 *   - PII redaction: pino's `redact.paths` masks values from `req.body.*` (so
 *     password / passportNumber / token fields posted by clients never end
 *     up in logs), plus a defensive list of known field names that show up
 *     anywhere in the log payload (token / secret / apiKey / etc.).
 *
 * Sentry integration:
 *   - On `logger.error({ err }, "msg")`, the `err` is also forwarded to
 *     Sentry as a captured exception (with the message as a tag).
 *   - This is in ADDITION to Sentry's `expressIntegration()` which already
 *     auto-captures unhandled errors from Express. The integration here
 *     covers EXPLICIT `logger.error(...)` calls (caught errors that the
 *     code logged + handled gracefully but still wants surfaced in Sentry).
 *   - To avoid double-capture from the express integration path: this hook
 *     ONLY fires for explicit logger.error calls. Unhandled errors caught by
 *     Sentry's expressIntegration arrive there directly without going
 *     through pino.
 *
 * What this does NOT do:
 *   - Does not log to a file. stdout only — Fly Machines + Cloudflare
 *     captures everything, so no rotation / disk management needed.
 *   - Does not implement structured request access logs. That's `pino-http`
 *     registered separately in `index.ts`.
 */

import pino, { type LoggerOptions, type Logger } from "pino";
import * as Sentry from "@sentry/node";
import { getCorrelationId } from "./correlationId";

const isProduction = process.env.NODE_ENV === "production";

// Standard PII paths in inbound HTTP bodies / headers. Pino redact uses
// dot-notation; `*` matches one path segment.
const REDACT_PATHS = [
  // Auth credentials in request bodies
  "req.body.password",
  "req.body.passwordHash",
  "req.body.currentPassword",
  "req.body.newPassword",
  "req.body.confirmPassword",
  "req.body.token",
  "req.body.refreshToken",
  "req.body.accessToken",
  "req.body.apiKey",
  // Identity documents (passport / DOB / phone) in request bodies
  "req.body.passportNumber",
  "req.body.passportExpiry",
  "req.body.dateOfBirth",
  "req.body.phone",
  "req.body.email", // DECISION 1A — redact in HTTP body only (admin DB-side `customerEmail` not affected)
  "req.body.creditCardNumber",
  "req.body.cardNumber",
  "req.body.cvv",
  // Auth headers
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  // Nested under common wrappers (e.g. nodemailer auth, plaid req body)
  "*.password",
  "*.passwordHash",
  "*.accessToken",
  "*.refreshToken",
  "*.apiKey",
  "*.passportNumber",
  "*.dateOfBirth",
  "*.cvv",
  "*.cardNumber",
  "*.creditCardNumber",
  // Top-level fields commonly logged inline
  "password",
  "passwordHash",
  "passportNumber",
  "passportExpiry",
  "dateOfBirth",
  "phone",
  "creditCardNumber",
  "cardNumber",
  "cvv",
  "accessToken",
  "refreshToken",
  "apiKey",
  "secret",
];

const baseOptions: LoggerOptions = {
  level: isProduction
    ? process.env.LOG_LEVEL ?? "info"
    : process.env.LOG_LEVEL ?? "debug",
  redact: {
    paths: REDACT_PATHS,
    censor: "[Redacted]",
  },
  // Inject correlationId into every line. Falls back to undefined outside an
  // HTTP context (cron / startup) — pino drops undefined fields, so the line
  // just won't carry the tag.
  mixin() {
    const correlationId = getCorrelationId();
    return correlationId ? { correlationId } : {};
  },
  // Use pino's standard `err` serializer so { err } gets a `message`,
  // `stack`, `type` rendering instead of "[object Object]".
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  // Standard formatters — emit `level` as the lowercase string ("info") in
  // dev for pino-pretty; pino's default numeric level (30/40/50) is fine
  // for prod JSON because Fly's structured log viewer translates it.
  formatters: {
    level(label, _number) {
      return { level: label };
    },
  },
  // ISO timestamps in prod (matches Fly's log timestamp format); pino-pretty
  // handles its own time formatting in dev.
  timestamp: pino.stdTimeFunctions.isoTime,
};

// Dev: pino-pretty transport (colorized human output).
// Prod: plain stdout JSON.
const devTransport: LoggerOptions["transport"] = {
  target: "pino-pretty",
  options: {
    colorize: true,
    translateTime: "SYS:HH:MM:ss.l",
    ignore: "pid,hostname",
  },
};

export const logger: Logger = isProduction
  ? pino(baseOptions)
  : pino({ ...baseOptions, transport: devTransport });

/**
 * Sentry bridge hook — when `logger.error({ err }, msg)` is invoked, forward
 * the error to Sentry as well. This is in addition to Sentry's automatic
 * express-route capture; this hook covers errors that code CAUGHT + logged
 * but did not re-throw.
 *
 * Implementation: we attach a `level: "error"` hook by wrapping the logger's
 * `error` method. We deliberately avoid pino's `hooks.logMethod` (which fires
 * for every level and would cost CPU on every info call) — instead we patch
 * only `error`. The wrapped function MUST preserve pino's API surface
 * (it accepts string OR object as first arg).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _originalError = logger.error.bind(logger) as (...args: any[]) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(logger as any).error = function patchedError(...args: any[]): void {
  // Delegate to pino first so the log line is always emitted regardless of
  // Sentry state.
  _originalError(...args);

  // Sentry bridge: detect `{ err }` payloads. Pino convention:
  //   logger.error({ err }, "msg")       → args[0].err is the error
  //   logger.error({ error }, "msg")     → args[0].error
  //   logger.error("just a string msg")  → no error, skip
  try {
    const first = args[0];
    if (first && typeof first === "object") {
      const errObj = first.err ?? first.error;
      if (errObj instanceof Error) {
        const msg = typeof args[1] === "string" ? args[1] : undefined;
        const correlationId = getCorrelationId();
        Sentry.withScope((scope) => {
          scope.setTag("logger", "true");
          if (correlationId) scope.setTag("correlationId", correlationId);
          if (msg) scope.setExtra("logMessage", msg);
          // Strip the `err` field from the rest so we don't double-send the
          // stack — pino renders it, Sentry's own serializer renders it again.
          const { err: _err, error: _e, ...rest } = first;
          void _err;
          void _e;
          if (Object.keys(rest).length > 0) {
            scope.setExtra("logFields", rest);
          }
          Sentry.captureException(errObj);
        });
      }
    }
  } catch (bridgeErr) {
    // NEVER throw from the observability layer. Surface internal failures
    // to stderr only — don't recurse back through logger.error.
    // eslint-disable-next-line no-console
    process.stderr.write(
      `[logger.sentry-bridge] internal error: ${String(bridgeErr)}\n`,
    );
  }
};

/**
 * Create a child logger with persistent bindings — useful for per-module
 * scoping so every line from a module carries the same tag without manually
 * passing it through every call site.
 *
 *   const log = createChildLogger({ module: "stripeWebhook" });
 *   log.info({ eventId }, "received");
 */
export function createChildLogger(
  bindings: Record<string, unknown>,
): Logger {
  return logger.child(bindings);
}
