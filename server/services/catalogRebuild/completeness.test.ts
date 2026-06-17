import { describe, it, expect } from "vitest";
import { assessTourCompleteness, type TourCompletenessInput } from "./completeness";

/** A fully-complete tour candidate; tests override one field at a time. */
function complete(overrides: Partial<TourCompletenessInput> = {}): TourCompletenessInput {
  return {
    title: "江南五日遊",
    destinationCountry: "中國",
    days: 5,
    priceRetail: 28900,
    itineraryDetailedJson: JSON.stringify([
      { day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }, { day: 5 },
    ]),
    attractionsJson: JSON.stringify([{ name: "烏鎮" }, { name: "西湖" }, { name: "靈隱寺" }]),
    futureDepartureCount: 4,
    heroImage: "https://img/hero.jpg",
    ...overrides,
  };
}

describe("assessTourCompleteness — hard gate", () => {
  it("passes a fully complete tour", () => {
    const r = assessTourCompleteness(complete());
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.softFlags).toEqual([]);
  });

  it.each([
    ["title", { title: "" }, "title"],
    ["destinationCountry", { destinationCountry: null }, "destinationCountry"],
    ["days=0", { days: 0 }, "days"],
    ["price=0", { priceRetail: 0 }, "retailPrice"],
    ["price null", { priceRetail: null }, "retailPrice"],
    ["no future departure", { futureDepartureCount: 0 }, "futureDeparture"],
    ["empty itinerary", { itineraryDetailedJson: "[]" }, "dailyItinerary"],
    ["malformed itinerary", { itineraryDetailedJson: "not json" }, "dailyItinerary"],
    ["no attractions", { attractionsJson: null }, "attractions"],
  ])("blocks when %s is missing", (_label, override, expectedMissing) => {
    const r = assessTourCompleteness(complete(override));
    expect(r.ok).toBe(false);
    expect(r.missing).toContain(expectedMissing);
  });

  it("reports multiple missing fields at once", () => {
    const r = assessTourCompleteness({});
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(
      expect.arrayContaining([
        "title", "destinationCountry", "days", "retailPrice",
        "futureDeparture", "dailyItinerary", "attractions",
      ]),
    );
  });
});

describe("assessTourCompleteness — soft flags (do NOT block)", () => {
  it("missing image is a soft flag, still ok (Jeff: 缺圖不擋)", () => {
    const r = assessTourCompleteness(
      complete({ heroImage: null, imageUrl: null, galleryImagesJson: null }),
    );
    expect(r.ok).toBe(true);
    expect(r.softFlags).toContain("noImage");
  });

  it("gallery image alone satisfies hasImage", () => {
    const r = assessTourCompleteness(
      complete({ heroImage: null, imageUrl: null, galleryImagesJson: JSON.stringify(["a.jpg"]) }),
    );
    expect(r.softFlags).not.toContain("noImage");
  });

  it("partial itinerary (fewer days than duration) flags but does not block", () => {
    const r = assessTourCompleteness(
      complete({ days: 5, itineraryDetailedJson: JSON.stringify([{ day: 1 }, { day: 2 }]) }),
    );
    expect(r.ok).toBe(true);
    expect(r.softFlags).toContain("partialItinerary");
  });

  it("few attractions flags but does not block", () => {
    const r = assessTourCompleteness(
      complete({ attractionsJson: JSON.stringify([{ name: "烏鎮" }]) }),
    );
    expect(r.ok).toBe(true);
    expect(r.softFlags).toContain("fewAttractions");
  });
});
