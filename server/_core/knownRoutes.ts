/**
 * Server-side route whitelist — mirrors client/src/App.tsx routes.
 *
 * Used by the SPA fallback (server/_core/vite.ts) to decide whether to return
 * HTTP 200 (valid route, React will render the page) or HTTP 404 (unknown URL —
 * the SPA shell is still served so NotFound.tsx renders, but with a real 404
 * status so Google does not treat every garbage URL as a soft-200).
 *
 * Extracted from vite.ts so it can be unit-tested without importing the Vite
 * dev-server machinery. Keep this in sync with App.tsx <Route path="..."> entries.
 * A pattern ending with "(\/.*)?" matches nested paths; an exact pattern matches
 * only that path.
 */
export const KNOWN_ROUTE_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/search$/,
  /^\/destinations\/[^/]+$/,              // /destinations/:region
  /^\/destinations\/[^/]+\/[^/]+$/,       // /destinations/:region/:country
  /^\/cruises$/,
  /^\/tours$/,
  /^\/tours\/[^/]+$/,                     // /tours/:id
  /^\/tours\/[^/]+\/print$/,              // /tours/:id/print
  /^\/tour\/[^/]+$/,                      // legacy /tour/:id (seen in sitemap)
  /^\/login$/,
  /^\/forgot-password$/,
  /^\/reset-password$/,
  /^\/admin(\/.*)?$/,                     // /admin (complete AdminV2) and nested admin routes
  /^\/workspace(\/.*)?$/,                 // 整合工作台 redesign preview (chat-first 後台) + 巢狀
  /^\/ops(\/.*)?$/,                       // 後台 redesign (AdminShell): /ops, /ops/customers, /ops/tours, /ops/finance, /ops/marketing, /ops/settings — direct-hit/refresh must return 200, not soft-404
  /^\/profile$/,
  /^\/book\/[^/]+$/,                      // /book/:id
  /^\/bookings\/[^/]+$/,                  // /bookings/:id
  /^\/payment\/(success|failure)$/,
  /^\/inquiry$/,
  /^\/custom-tour-request$/,
  /^\/custom-tours$/,
  /^\/china-visa$/,
  /^\/china-visa\/success$/,
  /^\/china-visa\/status\/[^/]+$/,
  /^\/visa-services$/,
  /^\/group-packages$/,
  /^\/flight-booking$/,
  /^\/airport-transfer$/,
  /^\/hotel-booking$/,
  /^\/about-us$/,
  /^\/terms-of-service$/,
  /^\/privacy-policy$/,
  /^\/faq$/,
  /^\/contact-us$/,
  /^\/emergency$/,                        // 2026-05-22 P23: 24h emergency intake (QA audit Phase 5)
  /^\/membership$/,                       // Round 80.19: AI Advisor Phase 1 paywall target
  /^\/membership-terms$/,                 // 2026-05-22 P23: AB 390 §17602 disclosure link
  /^\/rewards$/,                          // Round 80.22 Phase F: Packpoint redemption catalog
  /^\/preview\/[^/]+$/,                   // Round 80.9: internal preview/mockup routes
  /^\/preview\/bc\/tours$/,               // P1c R2 (Codex P1-9): BC shelf — direct hit/refresh must be 200
  /^\/preview\/bc\/tours\/[^/]+$/,        // P1c R2 (Codex P1-9): BC detail /preview/bc/tours/:id; other nested preview paths stay 404
  /^\/404$/,
];

/** Strip query string + trailing slash (except for root) for pattern matching. */
export function normalizeUrlForMatch(originalUrl: string): string {
  const pathOnly = originalUrl.split("?")[0] || "/";
  if (pathOnly === "/") return "/";
  return pathOnly.replace(/\/+$/, "");
}

export function isKnownRoute(originalUrl: string): boolean {
  const pathOnly = normalizeUrlForMatch(originalUrl);
  return KNOWN_ROUTE_PATTERNS.some((re) => re.test(pathOnly));
}
