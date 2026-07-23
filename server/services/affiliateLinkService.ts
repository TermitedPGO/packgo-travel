/**
 * Trip.com affiliate — Phase 1: homepage-only clickout.
 *
 * Phase 1 sends the customer to Jeff's approved Trip.com affiliate entry, verbatim.
 * PACK&GO does NOT build dynamic deep links (city/date/passenger params are never
 * forwarded): a hand-built deep link is not an officially sanctioned affiliate link,
 * a set Union cookie does not prove commission, and Trip.com's FAQ says not to modify
 * platform-generated links. Dynamic deep links are a separate, later phase gated on a
 * Trip.com Link Builder link or written confirmation — deliberately NOT behind an env
 * flag here, so nothing can revive them on the deploy path.
 *
 * This module owns three things only: the approved entry constant, the outbound-URL
 * allowlist, and the anonymous redirect telemetry writer. All redirect flow lives in
 * ./tripRedirect and the /go/trip/:source endpoint.
 */

import { createAffiliateClick } from "../db";

const TRIP_COM_CONFIG = {
  allianceId: "7896974",
  sid: "296102808",
  /** Material inside Jeff's approved main affiliate entry. */
  homepageMaterial: "D13390050",
} as const;

/**
 * Jeff's approved main affiliate entry, byte-for-byte. Emitted verbatim and never
 * rebuilt through URL/searchParams (which would re-encode and reorder it), because
 * Trip.com's FAQ says not to modify platform-generated affiliate links. This is the
 * ONLY Trip.com URL Phase 1 ever sends a customer to.
 */
export const APPROVED_HOMEPAGE_ENTRY =
  `https://hk.trip.com/?Allianceid=${TRIP_COM_CONFIG.allianceId}` +
  `&SID=${TRIP_COM_CONFIG.sid}&trip_sub1=&trip_sub3=${TRIP_COM_CONFIG.homepageMaterial}`;

/** Official Trip.com HTTPS hosts we are willing to send a customer to. */
const ALLOWED_TRIP_HOSTS: ReadonlySet<string> = new Set([
  "trip.com",
  "www.trip.com",
  "hk.trip.com",
  "us.trip.com",
]);

/**
 * True only for a plain HTTPS URL on an official Trip.com host, with no embedded
 * credentials and no non-default port. The last gate before any URL is handed to a
 * browser or written to the log, so a bug upstream can never turn this into an open
 * redirect or a credential-leaking / port-scanning target.
 */
export function isAllowedTripUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false; // no user:pass@host
  if (parsed.port !== "" && parsed.port !== "443") return false; // only the default HTTPS port
  return ALLOWED_TRIP_HOSTS.has(parsed.hostname.toLowerCase());
}

/**
 * The closed set of redirect sources. The browser may pick which one, but nothing
 * else about a redirect is caller-controlled.
 */
export type TripRedirectSource = "flight_search" | "hotel_search" | "tour_flight" | "tour_hotel";

/** Every source lands on the approved homepage entry (Phase 1 is homepage-only). */
const SOURCE_PLATFORM: Record<TripRedirectSource, "trip_homepage"> = {
  flight_search: "trip_homepage",
  hotel_search: "trip_homepage",
  tour_flight: "trip_homepage",
  tour_hotel: "trip_homepage",
};

/**
 * Record ONE anonymous redirect-telemetry row: that a redirect from `source` was
 * requested. This is NOT a confirmed human click and NOT commission truth — earnings
 * truth is the Trip.com Affiliate report. Anonymity is structural: no userId, IP or
 * User-Agent is accepted, so none can be stored (those columns are written null). The
 * closed `source` is stored in referrerPage (a server-set enum value, never a
 * browser-supplied string); platform is always trip_homepage — where the customer
 * actually lands.
 *
 * Best-effort: any failure is swallowed so it can never block the redirect.
 */
export async function recordRedirectTelemetry(source: TripRedirectSource): Promise<void> {
  try {
    await createAffiliateClick({
      userId: null,
      platform: SOURCE_PLATFORM[source],
      targetUrl: APPROVED_HOMEPAGE_ENTRY,
      referrerPage: source,
      tourId: null,
      ipAddress: null,
      userAgent: null,
    });
  } catch (err) {
    console.error("[TripRedirect] telemetry write failed (ignored):", err);
  }
}

export { TRIP_COM_CONFIG };
