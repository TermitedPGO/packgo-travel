/**
 * Tests for UV bulk-import price selection (Stage 0 proof, 2026-06-01).
 *
 * The load-bearing rule: tour/departure price comes from getProductGroup
 * priceType=4 (兩人一房, double-occupancy = standard per-person basis), NEVER
 * priceType=3 (單人入住/single, which over-quotes ~30-37%) and NEVER flyer
 * prices. These pure pickers are what the import writes into adultPrice +
 * headline, so they are the thing to lock down.
 */
import { describe, it, expect } from "vitest";
import {
  pickDepartureAdultPrice,
  pickHeadlinePrice,
} from "./uvBulkImportService";

// A realistic getProductGroup departure: all four occupancy tiers, priceType
// 3 (single) deliberately HIGHER than 4 (double) — mirrors P00002885 where
// single=$928 > double.
const fourTierDep = {
  groupPrice: [
    { priceType: 3, groupPrice: 928 }, // 單人入住 — must NOT be picked
    { priceType: 4, groupPrice: 598 }, // 兩人一房 — the answer
    { priceType: 5, groupPrice: 558 }, // 三人
    { priceType: 6, groupPrice: 528 }, // 四人
  ],
};

describe("pickDepartureAdultPrice", () => {
  it("picks priceType=4 (兩人一房), not the cheaper-or-pricier other tiers", () => {
    expect(pickDepartureAdultPrice(fourTierDep)).toBe(598);
  });

  it("never picks priceType=3 even when it is the first tier", () => {
    const dep = { groupPrice: [{ priceType: 3, groupPrice: 928 }, { priceType: 4, groupPrice: 598 }] };
    expect(pickDepartureAdultPrice(dep)).toBe(598);
  });

  it("falls back to the first tier when no priceType=4 exists", () => {
    const dep = { groupPrice: [{ priceType: 3, groupPrice: 700 }] };
    expect(pickDepartureAdultPrice(dep)).toBe(700);
  });

  it("returns 0 when there is no price at all", () => {
    expect(pickDepartureAdultPrice({})).toBe(0);
    expect(pickDepartureAdultPrice({ groupPrice: [] })).toBe(0);
  });

  it("rounds to a whole dollar", () => {
    const dep = { groupPrice: [{ priceType: 4, groupPrice: 598.6 }] };
    expect(pickDepartureAdultPrice(dep)).toBe(599);
  });
});

describe("pickHeadlinePrice", () => {
  it("returns the LOWEST priceType=4 across departures (起價)", () => {
    const deps = [
      { groupPrice: [{ priceType: 4, groupPrice: 798 }] },
      { groupPrice: [{ priceType: 4, groupPrice: 598 }] }, // lowest
      { groupPrice: [{ priceType: 4, groupPrice: 698 }] },
    ];
    expect(pickHeadlinePrice(deps)).toBe(598);
  });

  it("ignores zero-price departures when computing the minimum", () => {
    const deps = [
      { groupPrice: [] }, // 0 — skipped
      { groupPrice: [{ priceType: 4, groupPrice: 650 }] },
    ];
    expect(pickHeadlinePrice(deps)).toBe(650);
  });

  it("returns 0 when no departure carries a usable price", () => {
    expect(pickHeadlinePrice([])).toBe(0);
    expect(pickHeadlinePrice([{ groupPrice: [] }, {}])).toBe(0);
  });

  it("uses priceType=4 for the headline, not a cheaper higher-occupancy tier", () => {
    // Single departure with all tiers — headline must be the double tier (598),
    // not the quad tier (528).
    expect(pickHeadlinePrice([fourTierDep])).toBe(598);
  });
});
