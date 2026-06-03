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
  buildDepartureFromMirrorRow,
  headlineFromBuiltDepartures,
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

  it("uses priceType=1 (成人 adult) for non-room 1-day products with no pt4", () => {
    // 1-day tour scheme: pt1=adult, pt2=child, no room tiers. Adult = pt1.
    const dep = { groupPrice: [{ priceType: 1, groupPrice: 88 }, { priceType: 2, groupPrice: 78 }] };
    expect(pickDepartureAdultPrice(dep)).toBe(88);
  });

  it("returns 0 for a single-occupancy-only (pt3) departure — never over-quotes", () => {
    // pt3 (單人入住) alone is not a valid adult basis; refuse rather than quote it.
    const dep = { groupPrice: [{ priceType: 3, groupPrice: 700 }] };
    expect(pickDepartureAdultPrice(dep)).toBe(0);
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

// ─────────────────────────────────────────────────────────────────────────
// Mirror rebuild — rebuild tourDepartures from synced supplierDepartures
// rawDepartureJson (NOT the polluted retailPrice column). The blob is the
// SAME shape as a live getProductGroup departure, so price selection must be
// identical (pt4, never pt3). These cases use the REAL P00003716 Cancún rows.
// ─────────────────────────────────────────────────────────────────────────
const TODAY_MS = new Date(2026, 5, 1, 0, 0, 0).getTime(); // 2026-06-01 local

// retailPrice column for this date was stored as 4350 (pt3 single) — the
// landmine. The blob still carries pt4=2440, which is the correct adult basis.
const realCancunRaw = JSON.stringify({
  groupDate: "2026-08-16 00:00:00",
  isGroupRoom: 1,
  groupStock: 55,
  groupSaleStock: 0,
  stockStatus: 200,
  groupPrice: [
    { priceType: 3, groupPrice: 3760 }, // 單人 — must NOT be picked
    { priceType: 4, groupPrice: 2150 }, // 兩人一房 — the answer
    { priceType: 5, groupPrice: 1870 },
    { priceType: 6, groupPrice: 1720 },
  ],
});

describe("buildDepartureFromMirrorRow", () => {
  it("rebuilds a departure from the mirror blob using pt4, ignoring the polluted single-occupancy tier", () => {
    const dep = buildDepartureFromMirrorRow(realCancunRaw, 6, TODAY_MS)!;
    expect(dep).not.toBeNull();
    expect(dep.adultPrice).toBe(2150); // pt4, NOT pt3 (3760)
    expect(dep.totalSlots).toBe(55);
    expect(dep.bookedSlots).toBe(0);
    expect(dep.status).toBe("open");
    // departureDate = 2026-08-16 08:00 local; returnDate = +(days-1)=+5 → 08-21
    expect(dep.departureDate.getFullYear()).toBe(2026);
    expect(dep.departureDate.getMonth()).toBe(7); // August (0-indexed)
    expect(dep.departureDate.getDate()).toBe(16);
    expect(dep.returnDate.getDate()).toBe(21);
  });

  it("skips departures already in the past", () => {
    const past = JSON.stringify({
      groupDate: "2026-05-28 00:00:00",
      groupStock: 55,
      groupSaleStock: 0,
      groupPrice: [{ priceType: 4, groupPrice: 2440 }],
    });
    expect(buildDepartureFromMirrorRow(past, 6, TODAY_MS)).toBeNull();
  });

  it("skips a single-occupancy-only date rather than over-quoting it", () => {
    // pt3 alone is not a valid adult basis — skip the date, never quote pt3.
    const pt3Only = JSON.stringify({
      groupDate: "2026-09-01 00:00:00",
      groupStock: 20,
      groupSaleStock: 0,
      groupPrice: [{ priceType: 3, groupPrice: 4350 }],
    });
    expect(buildDepartureFromMirrorRow(pt3Only, 6, TODAY_MS)).toBeNull();
  });

  it("marks a fully-booked departure as full", () => {
    const soldOut = JSON.stringify({
      groupDate: "2026-09-10 00:00:00",
      groupStock: 20,
      groupSaleStock: 20,
      groupPrice: [{ priceType: 4, groupPrice: 2150 }],
    });
    expect(buildDepartureFromMirrorRow(soldOut, 6, TODAY_MS)!.status).toBe("full");
  });

  it("uses pt1 (adult) for a 1-day non-room product with no pt4", () => {
    const oneDay = JSON.stringify({
      groupDate: "2026-09-15 00:00:00",
      groupStock: 14,
      groupSaleStock: 2,
      groupPrice: [{ priceType: 1, groupPrice: 88 }, { priceType: 2, groupPrice: 78 }],
    });
    const dep = buildDepartureFromMirrorRow(oneDay, 1, TODAY_MS)!;
    expect(dep.adultPrice).toBe(88); // pt1
    expect(dep.bookedSlots).toBe(2);
    // 1-day trip: returnDate same calendar day as departure
    expect(dep.returnDate.getDate()).toBe(15);
  });

  it("returns null for unparseable or date-less blobs", () => {
    expect(buildDepartureFromMirrorRow(null, 6, TODAY_MS)).toBeNull();
    expect(buildDepartureFromMirrorRow("not json", 6, TODAY_MS)).toBeNull();
    expect(buildDepartureFromMirrorRow(JSON.stringify({ groupPrice: [] }), 6, TODAY_MS)).toBeNull();
  });
});

describe("headlineFromBuiltDepartures", () => {
  it("returns the lowest adult price across built departures (起價)", () => {
    const deps = [
      buildDepartureFromMirrorRow(realCancunRaw, 6, TODAY_MS)!, // 2150
      buildDepartureFromMirrorRow(
        JSON.stringify({ groupDate: "2026-10-01 00:00:00", groupStock: 30, groupSaleStock: 0, groupPrice: [{ priceType: 4, groupPrice: 1980 }] }),
        6,
        TODAY_MS,
      )!, // 1980 — lowest
      buildDepartureFromMirrorRow(
        JSON.stringify({ groupDate: "2026-10-15 00:00:00", groupStock: 30, groupSaleStock: 0, groupPrice: [{ priceType: 4, groupPrice: 2440 }] }),
        6,
        TODAY_MS,
      )!, // 2440
    ];
    expect(headlineFromBuiltDepartures(deps)).toBe(1980);
  });

  it("returns 0 for no departures", () => {
    expect(headlineFromBuiltDepartures([])).toBe(0);
  });
});
