/**
 * First-party Trip.com redirect endpoint: GET /go/trip/:source
 *
 * The customer clicks a PACK&GO button, which navigates this same-origin URL. The
 * server validates the closed source, 302s to the approved Trip.com entry, and only
 * then fires anonymous redirect telemetry as a detached side effect. There is no
 * second public endpoint, no browser-supplied target URL, route, city, tourId or
 * affiliate id.
 *
 * Nothing may sit between the customer and the 302: the response is sent BEFORE
 * telemetry starts, so a slow or hung Redis/DB (not just an immediate reject) can
 * never delay or block the redirect. A bad source is the only 400.
 */
import type { Express, Request, Response } from "express";
import { getClientIp } from "../_core/context";
import { checkAtomicRateLimit } from "../rateLimit";
import {
  APPROVED_HOMEPAGE_ENTRY,
  isAllowedTripUrl,
  recordRedirectTelemetry,
  type TripRedirectSource,
} from "./affiliateLinkService";

const VALID_SOURCES: ReadonlySet<string> = new Set<TripRedirectSource>([
  "flight_search",
  "hotel_search",
  "tour_flight",
  "tour_hotel",
]);

/** Narrow an untrusted `:source` param to the closed enum, or null. */
export function parseRedirectSource(raw: unknown): TripRedirectSource | null {
  return typeof raw === "string" && VALID_SOURCES.has(raw) ? (raw as TripRedirectSource) : null;
}

/**
 * The single outbound target. Guarded by the allowlist so even a future change to the
 * constant can't turn this into an open redirect — an unexpected target throws rather
 * than sending a customer somewhere unvetted.
 */
export function redirectTarget(): string {
  if (!isAllowedTripUrl(APPROVED_HOMEPAGE_ENTRY)) {
    throw new Error("[TripRedirect] approved entry failed the allowlist");
  }
  return APPROVED_HOMEPAGE_ENTRY;
}

/**
 * Best-effort, rate-limited telemetry. The limiter protects the log only (60/hour/IP);
 * being throttled just skips the write. Every failure path is swallowed — this must
 * never throw, so the caller can always redirect.
 */
async function recordBestEffort(source: TripRedirectSource, ip: string): Promise<void> {
  try {
    const rl = await checkAtomicRateLimit({
      key: `trip:redirect:ip:${ip || "unknown"}`,
      limit: 60,
      window: 3600,
    });
    if (rl.allowed) await recordRedirectTelemetry(source);
  } catch (err) {
    console.error("[TripRedirect] telemetry/limiter error (ignored):", err);
  }
}

/** Express handler for GET /go/trip/:source. */
export function handleTripRedirect(req: Request, res: Response): void {
  const source = parseRedirectSource(req.params?.source);
  if (!source) {
    res.status(400).send("Unknown redirect source");
    return;
  }
  // 302 FIRST (temporary: the approved entry may change; never cacheable as
  // permanent). The redirect must not wait on anything that can hang — a slow
  // Redis eval or DB insert would otherwise hold the customer on a blank page.
  res.redirect(302, redirectTarget());
  // Telemetry is a detached best-effort side effect. recordBestEffort swallows
  // every failure internally; void marks the promise as deliberately unawaited.
  void recordBestEffort(source, getClientIp(req));
}

/**
 * Mount the redirect route. _core/index.ts calls this BEFORE the access logger and
 * body parsers, so a /go/trip request never reaches pino-http (no raw URL/query —
 * and therefore no query-string PII — in access logs) and never gets parsed as a
 * body (a malformed JSON GET body cannot 400 before the handler). Tests mount the
 * same function to exercise the identical route + handler wiring.
 */
export function mountTripRedirect(app: Express): void {
  app.get("/go/trip/:source", handleTripRedirect);
}
