/**
 * Trip.com clickout (Phase 1: homepage-only).
 *
 * The customer's click navigates THIS tab to the first-party endpoint
 * /go/trip/:source, which the server 302s to the approved Trip.com entry. Same-tab
 * `location.assign` on a same-origin path is plain navigation — there is no popup
 * for a blocker to eat, no placeholder tab, no await gap. (The previous `_blank`
 * window.open silently did nothing when a browser returned null: the customer
 * clicked and stayed put. Verified by Codex black-box; hence this shape.)
 *
 * GA receives only the closed source enum. The honest "conditions won't carry
 * over" notice is persistent page copy next to the button, not a toast.
 */
import { trackAffiliateClick, type TripRedirectSource } from "./analytics";

/** First-party path for each closed source. Same-origin; served by Express, not the SPA. */
export const TRIP_REDIRECT_PATH: Record<TripRedirectSource, string> = {
  flight_search: "/go/trip/flight_search",
  hotel_search: "/go/trip/hotel_search",
  tour_flight: "/go/trip/tour_flight",
  tour_hotel: "/go/trip/tour_hotel",
};

/**
 * Injectable navigation seam. Tests replace this to prove a click deterministically
 * reaches the exact first-party path; production leaves it as location.assign.
 */
export const navigation = {
  assign(path: string): void {
    window.location.assign(path);
  },
};

/**
 * Fire the GA event best-effort, then navigate this tab to the first-party
 * redirect. GA is a third party: if window.gtag throws synchronously, the customer
 * must still leave — the throw is swallowed (not re-raised after navigation: a
 * click handler must not surface analytics failures into the UI) and
 * navigation.assign runs exactly once regardless. The path comes from an own-key
 * lookup on the closed table — a type-cast caller with an arbitrary string
 * (or "constructor") is a no-op, never a navigation.
 */
export function openTripClickout(source: TripRedirectSource): void {
  if (!Object.hasOwn(TRIP_REDIRECT_PATH, source)) return;
  try {
    trackAffiliateClick(source);
  } catch {
    // Analytics must never block the redirect.
  }
  navigation.assign(TRIP_REDIRECT_PATH[source]);
}
