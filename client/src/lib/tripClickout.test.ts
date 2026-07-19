// @vitest-environment jsdom
/**
 * The clickout the three UI callers invoke. Phase 1 uses SAME-TAB navigation to the
 * first-party /go/trip path (Codex P1-3: a `_blank` popup returned null under a
 * blocker and the customer never navigated — so no popup, no window.open at all).
 * The navigation seam is injectable, so these tests prove a click deterministically
 * reaches the exact first-party path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openTripClickout, navigation, TRIP_REDIRECT_PATH } from "./tripClickout";
import type { TripRedirectSource } from "./analytics";

let assignSpy: ReturnType<typeof vi.spyOn>;
let gtagSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.setItem("pag_cookie_consent", "all");
  gtagSpy = vi.fn();
  (window as unknown as { gtag: unknown }).gtag = gtagSpy;
  assignSpy = vi.spyOn(navigation, "assign").mockImplementation(() => {});
});
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("TRIP_REDIRECT_PATH", () => {
  it("maps each closed source to a first-party /go/trip path — no trip.com URL in the client", () => {
    expect(TRIP_REDIRECT_PATH).toEqual({
      flight_search: "/go/trip/flight_search",
      hotel_search: "/go/trip/hotel_search",
      tour_flight: "/go/trip/tour_flight",
      tour_hotel: "/go/trip/tour_hotel",
    });
    for (const p of Object.values(TRIP_REDIRECT_PATH)) {
      expect(p.startsWith("/go/trip/")).toBe(true);
      expect(p).not.toContain("trip.com");
      expect(p).not.toContain("Allianceid");
    }
  });
});

describe("openTripClickout", () => {
  it.each(["flight_search", "hotel_search", "tour_flight", "tour_hotel"] as const)(
    "one click deterministically navigates THIS tab to the exact first-party path for %s",
    (source) => {
      openTripClickout(source);
      expect(assignSpy).toHaveBeenCalledTimes(1);
      expect(assignSpy).toHaveBeenCalledWith(`/go/trip/${source}`);
    },
  );

  it("uses same-tab navigation — window.open is never called (nothing to block)", () => {
    const openSpy = vi.spyOn(window, "open");
    openTripClickout("flight_search");
    expect(openSpy).not.toHaveBeenCalled();
    expect(assignSpy).toHaveBeenCalledWith("/go/trip/flight_search");
  });

  it("fires the GA event before navigating", () => {
    const order: string[] = [];
    gtagSpy.mockImplementation(() => order.push("ga"));
    assignSpy.mockImplementation(() => order.push("nav"));
    openTripClickout("hotel_search");
    expect(order).toEqual(["ga", "nav"]);
  });

  it("still navigates exactly once when window.gtag throws synchronously (Codex batch-5 P1)", () => {
    // consent granted, gtag PRESENT but broken — a third-party failure must never
    // leave the customer clicked-but-stranded, and must not surface into the UI.
    gtagSpy.mockImplementation(() => { throw new Error("ga down"); });
    expect(() => openTripClickout("flight_search")).not.toThrow();
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(assignSpy).toHaveBeenCalledWith("/go/trip/flight_search");
  });

  it.each([
    ["free text", "https://evil.com"],
    ["a prototype key", "constructor"],
    ["another prototype key", "__proto__"],
    ["empty", ""],
  ])("no-ops on a type-cast invalid source (%s) — never navigates", (_label, raw) => {
    openTripClickout(raw as unknown as TripRedirectSource);
    expect(assignSpy).not.toHaveBeenCalled();
    expect(gtagSpy).not.toHaveBeenCalled();
  });

  it("production seam is window.location.assign on the same origin", () => {
    // Restore the real seam and point window.location at a recorder (jsdom refuses
    // real navigation): the seam must call location.assign with the given path.
    assignSpy.mockRestore();
    const locAssign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, assign: locAssign },
    });
    try {
      navigation.assign("/go/trip/flight_search");
      expect(locAssign).toHaveBeenCalledWith("/go/trip/flight_search");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});
