/**
 * Shared infra-noise signatures — known-handled infrastructure signals that
 * should NOT create a Sentry event or an errorFunnel card. These are
 * conditions that already have their own retry/backoff/circuit-breaker
 * handling elsewhere in the code; surfacing them again here is noise, not a
 * new incident.
 *
 * Single source of truth so sentry.ts (Sentry ignoreErrors / beforeSend) and
 * the tRPC onError noise gate in _core/index.ts can't silently diverge. That
 * divergence actually happened once (2026-07 Wave1 Block B review): the tRPC
 * onError gate was hand-written to copy sentry.ts's EPIPE/ECONNRESET filter
 * but missed the LLM_RATE_LIMITED/LLM_CIRCUIT_OPEN/LLM_TIMEOUT/lock-renew
 * filter sentry.ts already had (added 2026-05-26 for the "inbox storm" fix).
 * Anthropic 429/circuit-open/timeout errors from invokeLLM (llm.ts) carry no
 * `.code`, only `.rateLimited` / `.circuitOpen` / `.nonRetryable` booleans
 * plus a message prefix — those slipped through the code-only check and
 * would have re-flooded reportFunnelError cards during any Anthropic outage.
 *
 * Zero dependencies (no logger, no db) — deliberately a leaf module so
 * sentry.ts can import it without the circular-dependency risk documented at
 * the top of that file (logger.ts → sentry bridge → would loop back here if
 * this module pulled in logger.ts).
 */

export const INFRA_NOISE_MESSAGE_SUBSTRINGS = [
  "write EPIPE",
  "read ECONNRESET",
  "Client network socket disconnected",
  "LLM_RATE_LIMITED", // 429 retries exhausted → caller defers (invokeLLM)
  "LLM_CIRCUIT_OPEN", // breaker open during Anthropic outage (invokeLLM)
  "LLM_TIMEOUT", // 120s ceiling — retried elsewhere (invokeLLM)
  "could not renew lock", // BullMQ lock renew when machine under load
  "rate_limit_error", // raw Anthropic 429 phrasing (defensive)
] as const;

interface InfraNoiseLike {
  code?: string;
  message?: string;
  rateLimited?: boolean;
  circuitOpen?: boolean;
}

/**
 * True if any of the given error-like values is a known-handled infra noise
 * signal. Pass every candidate you have (e.g. both the outer error and its
 * `.cause`) — tRPC's `getTRPCErrorFromUnknown` wraps unhandled throws into a
 * `TRPCError` with the original error moved to `.cause`, so the noise
 * markers usually live one level down from the error you catch.
 */
export function isKnownInfraNoise(...candidates: unknown[]): boolean {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const e = candidate as InfraNoiseLike;
    if (e.code === "EPIPE" || e.code === "ECONNRESET") return true;
    if (e.rateLimited === true || e.circuitOpen === true) return true;
    const msg = e.message ?? "";
    if (INFRA_NOISE_MESSAGE_SUBSTRINGS.some((s) => msg.includes(s))) return true;
  }
  return false;
}
