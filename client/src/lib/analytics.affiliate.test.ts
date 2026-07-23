// @vitest-environment jsdom
/**
 * Privacy guard for the affiliate GA event. Phase 1 (homepage-only): GA receives
 * ONLY the closed source enum plus the fixed homepage_redirect marker — there is
 * no field a free-text route, city or name could travel through.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { trackAffiliateClick, type TripRedirectSource } from "./analytics";

let gtagSpy: ReturnType<typeof vi.fn>;

function lastEvent() {
  // gtag("event", "affiliate_click", payload)
  const call = gtagSpy.mock.calls.at(-1);
  return call ? (call[2] as Record<string, unknown>) : undefined;
}

beforeEach(() => {
  window.localStorage.setItem("pag_cookie_consent", "all"); // analytics gated on consent
  gtagSpy = vi.fn();
  (window as unknown as { gtag: unknown }).gtag = gtagSpy;
});
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("trackAffiliateClick GA payload (closed enum only)", () => {
  it.each(["flight_search", "hotel_search", "tour_flight", "tour_hotel"] as const)(
    "emits source=%s and the fixed homepage_redirect destination",
    (source) => {
      trackAffiliateClick(source);
      expect(lastEvent()).toEqual({
        event_category: "affiliate",
        source,
        destination: "homepage_redirect",
      });
    },
  );

  it("payload has no field for routes, cities or free text", () => {
    trackAffiliateClick("flight_search");
    const keys = Object.keys(lastEvent()!).sort();
    expect(keys).toEqual(["destination", "event_category", "source"]);
  });

  it.each([
    ["an email", "jeffhsieh09@gmail.com"],
    ["a name", "Amy Lee"],
    ["a hyphenated name", "Jeff-Hsieh"],
    ["a lookalike IATA pair", "AMY-LEE"],
    ["a prototype key", "constructor"],
  ])("collapses a type-cast free-text source (%s) to 'unknown' — never reaches GA", (_label, raw) => {
    // A JS caller can bypass TS; the runtime enum check must stop the value.
    trackAffiliateClick(raw as unknown as TripRedirectSource);
    expect(lastEvent()).toEqual({
      event_category: "affiliate",
      source: "unknown",
      destination: "homepage_redirect",
    });
  });
});
