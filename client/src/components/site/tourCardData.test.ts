/**
 * Unit tests for toTourCardData — the lean-row → TourCard mapping.
 * Pure function; the red-line assertions matter most (no cost ever leaks, and
 * availability is a bucket, never a count).
 *
 * Departure dates use a far-future year so they always read as "upcoming"
 * regardless of when the suite runs (the mapping uses the real `new Date()`).
 */
import { describe, it, expect } from "vitest";
import { toTourCardData, type LeanTourCardRow } from "./tourCardData";
import type { LeanDeparture } from "./types";

const baseRow: LeanTourCardRow = {
  id: 7,
  title: "京都・奈良・大阪 經典五日",
  destinationCountry: "日本",
  destinationCity: "關西",
  departureCity: "舊金山",
  duration: 5,
  nights: 4,
  heroImage: "/images/kyoto.webp",
  featured: true,
  status: "active",
  price: 64000, // TWD
  priceCurrency: "TWD",
  costExplanation: JSON.stringify({ excluded: ["國際機票"], included: ["飯店", "司導"] }),
};

function dep(over: Partial<LeanDeparture>): LeanDeparture {
  return {
    id: 1,
    departureDate: "2099-09-01T00:00:00Z",
    adultPrice: 60000,
    currency: "TWD",
    status: "open",
    totalSlots: 20,
    bookedSlots: 0,
    ...over,
  };
}

describe("toTourCardData", () => {
  it("no departure → unknown bucket, no date, price from the tour base price", () => {
    const card = toTourCardData(baseRow, null);
    expect(card.availabilityBucket).toBe("unknown");
    expect(card.soonestDepartureDate).toBeNull();
    expect(card.startingUsd).toBe(2000); // 64000 TWD / 32
    expect(card.startingApprox).toBe(true);
  });

  it("open departure with seats → available + soonest date set", () => {
    const card = toTourCardData(baseRow, dep({ totalSlots: 20, bookedSlots: 2 }));
    expect(card.availabilityBucket).toBe("available");
    expect(card.soonestDepartureDate).toBe("2099-09-01T00:00:00.000Z");
  });

  it("few seats left → limited (still no number leaks)", () => {
    const card = toTourCardData(baseRow, dep({ totalSlots: 20, bookedSlots: 18 }));
    expect(card.availabilityBucket).toBe("limited");
  });

  it("full departure → soldout", () => {
    const card = toTourCardData(baseRow, dep({ status: "full" }));
    expect(card.availabilityBucket).toBe("soldout");
  });

  it("tour.status soldout overrides an otherwise-available departure", () => {
    const card = toTourCardData(
      { ...baseRow, status: "soldout" },
      dep({ totalSlots: 20, bookedSlots: 0 }),
    );
    expect(card.availabilityBucket).toBe("soldout");
  });

  it("flight inclusion derives excluded from costExplanation", () => {
    const card = toTourCardData(baseRow, null);
    expect(card.flightInclusion).toBe("excluded");
  });

  it("picks the lower of base price and departure price, in USD", () => {
    // base 64000 TWD (~2000) vs departure 48000 TWD (~1500) → 1500
    const card = toTourCardData(baseRow, dep({ adultPrice: 48000, currency: "TWD" }));
    expect(card.startingUsd).toBe(1500);
  });

  it("RED LINE: output never carries cost / agentPrice / raw price fields", () => {
    const card = toTourCardData(baseRow, dep({}));
    const keys = Object.keys(card);
    for (const banned of ["agentPrice", "cost", "price", "priceCurrency", "costExplanation"]) {
      expect(keys).not.toContain(banned);
    }
    // The only money field is the retail USD "from" figure.
    expect(typeof card.startingUsd).toBe("number");
  });
});
