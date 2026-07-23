/**
 * Batch P1a — fee disclosure integer-math + grouping + honesty tests.
 * MONEY RULES under test: all sums are overflow-guarded integer addition
 * on minor units; totals are CurrencyAmount objects; cross-currency bare
 * addition is forbidden; per_booking lines never leak into per-person
 * totals; incomplete data is never dressed up as published-zero.
 */
import { describe, expect, it } from "vitest";
import type { FeeContract, FeeItem } from "../../drizzle/schema";
import {
  awaitingSupplierQuoteDisclosure,
  buildFeeDisclosure,
  computeFeeTotals,
  groupFeesByCategory,
  isContractValidOn,
  toPublicFeeDto,
} from "./feeDisclosure";

let nextId = 1;
function feeItem(overrides: Partial<FeeItem>): FeeItem {
  return {
    id: nextId++,
    feeContractId: 1,
    feeId: `fee-${nextId}`,
    category: "mandatory",
    labelZh: "測試費用",
    labelEn: "Test fee",
    amountMinorUnits: 0,
    currency: "USD",
    unit: "per_person",
    includedInPackgoCharge: false,
    requiredForTrip: true,
    payeeType: "other",
    paymentTiming: "before_departure",
    sourceStatus: "demo_estimate",
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as FeeItem;
}

function contract(overrides: Partial<FeeContract> = {}): FeeContract {
  return {
    id: 1,
    contractId: "MAD-5D-FEES-2026",
    productVersionId: 10,
    originMarket: "US-CA",
    destinationJurisdictions: ["ES"],
    displayRegion: "us-west",
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validTo: new Date("2026-12-31T23:59:59Z"),
    sourceStatus: "supplier_quote",
    status: "published",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as FeeContract;
}

describe("computeFeeTotals — CurrencyAmount integer minor-unit math", () => {
  it("sums per-person lines per category into currency-tagged amounts", () => {
    const fees = [
      feeItem({ category: "mandatory", amountMinorUnits: 12050 }), // $120.50
      feeItem({ category: "mandatory", amountMinorUnits: 3999 }), // $39.99
      feeItem({ category: "tips", amountMinorUnits: 1500 }),
      feeItem({ category: "tips", amountMinorUnits: 2500 }),
      feeItem({ category: "self", amountMinorUnits: 8000 }),
      feeItem({ category: "optional", amountMinorUnits: 99999 }), // not totalled
    ].map(toPublicFeeDto);

    const totals = computeFeeTotals(fees, "USD");
    expect(totals).toEqual({
      mandatoryPerPerson: { amountMinorUnits: 16049, currency: "USD" }, // exact — no float drift
      tipsPerPerson: { amountMinorUnits: 4000, currency: "USD" },
      selfEstimatePerPerson: { amountMinorUnits: 8000, currency: "USD" },
    });
    expect(Number.isInteger(totals.mandatoryPerPerson.amountMinorUnits)).toBe(true);
  });

  it("exact where float math would drift: 0.1+0.2 style amounts", () => {
    // 10 + 20 minor units: float major-unit math would give 0.30000000000000004
    const fees = [
      feeItem({ category: "mandatory", amountMinorUnits: 10 }),
      feeItem({ category: "mandatory", amountMinorUnits: 20 }),
    ].map(toPublicFeeDto);
    expect(computeFeeTotals(fees, "USD").mandatoryPerPerson.amountMinorUnits).toBe(30);
  });

  it("excludes per_booking lines from per-person totals", () => {
    const fees = [
      feeItem({ category: "mandatory", unit: "per_person", amountMinorUnits: 5000 }),
      feeItem({ category: "mandatory", unit: "per_booking", amountMinorUnits: 100000 }),
      feeItem({ category: "tips", unit: "per_booking", amountMinorUnits: 7000 }),
    ].map(toPublicFeeDto);
    const totals = computeFeeTotals(fees, "USD");
    expect(totals.mandatoryPerPerson.amountMinorUnits).toBe(5000); // per_booking not mixed in
    expect(totals.tipsPerPerson.amountMinorUnits).toBe(0);
  });

  it("FORBIDS cross-currency bare addition — mismatched fee throws", () => {
    const fees = [
      feeItem({ category: "mandatory", amountMinorUnits: 5000, currency: "USD" }),
      feeItem({ category: "mandatory", amountMinorUnits: 700000, currency: "JPY" }),
    ].map(toPublicFeeDto);
    expect(() => computeFeeTotals(fees, "USD")).toThrow(/Cross-currency/);
  });

  it("currency comparison is canonical (case-insensitive)", () => {
    const fees = [feeItem({ amountMinorUnits: 5000, currency: "usd" as any })].map(
      toPublicFeeDto,
    );
    const totals = computeFeeTotals(fees, "USD");
    expect(totals.mandatoryPerPerson).toEqual({ amountMinorUnits: 5000, currency: "USD" });
  });

  it("overflow guard: sums beyond MAX_SAFE_INTEGER throw", () => {
    const fees = [
      feeItem({ category: "mandatory", amountMinorUnits: Number.MAX_SAFE_INTEGER }),
      feeItem({ category: "mandatory", amountMinorUnits: 2 }),
    ].map(toPublicFeeDto);
    expect(() => computeFeeTotals(fees, "USD")).toThrow(/overflow/);
  });

  it("toPublicFeeDto rejects non-integer amounts loudly", () => {
    expect(() => toPublicFeeDto(feeItem({ amountMinorUnits: 19.99 as any }))).toThrow(
      /integer/,
    );
  });

  it("toPublicFeeDto rejects unknown currency codes (fail-closed, never exponent-2)", () => {
    expect(() => toPublicFeeDto(feeItem({ currency: "ZZZ" as any }))).toThrow(
      /Unknown currency/,
    );
  });

  it("toPublicFeeDto canonicalizes lowercase currency codes", () => {
    expect(toPublicFeeDto(feeItem({ currency: "jpy" as any })).currency).toBe("JPY");
  });
});

describe("groupFeesByCategory", () => {
  it("groups all four categories and sorts each by sortOrder", () => {
    const fees = [
      feeItem({ category: "tips", feeId: "t2", sortOrder: 2 }),
      feeItem({ category: "tips", feeId: "t1", sortOrder: 1 }),
      feeItem({ category: "mandatory", feeId: "m1", sortOrder: 0 }),
    ].map(toPublicFeeDto);
    const grouped = groupFeesByCategory(fees);
    expect(grouped.tips.map((f) => f.feeId)).toEqual(["t1", "t2"]);
    expect(grouped.mandatory.map((f) => f.feeId)).toEqual(["m1"]);
    expect(grouped.self).toEqual([]);
    expect(grouped.optional).toEqual([]);
  });
});

describe("isContractValidOn", () => {
  const c = contract();
  it("inside window → valid", () => {
    expect(isContractValidOn(c, new Date("2026-06-15T00:00:00Z"))).toBe(true);
  });
  it("before validFrom → invalid; after validTo → invalid", () => {
    expect(isContractValidOn(c, new Date("2025-12-31T23:59:59Z"))).toBe(false);
    expect(isContractValidOn(c, new Date("2027-01-01T00:00:00Z"))).toBe(false);
  });
  it("NULL bounds are open-ended", () => {
    expect(
      isContractValidOn(contract({ validFrom: null, validTo: null }), new Date("1999-01-01")),
    ).toBe(true);
  });
});

describe("buildFeeDisclosure — published happy path", () => {
  it("published disclosure carries contract identity + grouped fees + CurrencyAmount totals", () => {
    const items = [
      feeItem({ category: "mandatory", feeId: "intl-air-tax", amountMinorUnits: 12000 }),
      feeItem({ category: "tips", feeId: "guide-tips", amountMinorUnits: 6000 }),
    ];
    const d = buildFeeDisclosure(contract(), items);
    expect(d.status).toBe("published");
    expect(d.contractId).toBe("MAD-5D-FEES-2026");
    expect(d.sourceStatus).toBe("supplier_quote");
    expect(d.fees).toHaveLength(2);
    expect(d.feesByCategory.mandatory[0].feeId).toBe("intl-air-tax");
    expect(d.totals).toEqual({
      mandatoryPerPerson: { amountMinorUnits: 12000, currency: "USD" },
      tipsPerPerson: { amountMinorUnits: 6000, currency: "USD" },
      selfEstimatePerPerson: { amountMinorUnits: 0, currency: "USD" },
    });
  });
});

describe("buildFeeDisclosure — fail-closed honesty gates", () => {
  const expectAwaiting = (d: ReturnType<typeof buildFeeDisclosure>) => {
    expect(d.status).toBe("awaiting_supplier_quote");
    expect(d.contractId).toBeNull();
    expect(d.fees).toEqual([]);
    expect(d.totals).toBeNull(); // no totals fabricated — not even zeros
  };

  it("contract sourceStatus 'awaiting_supplier_quote' ⇒ awaiting, even if status='published'", () => {
    const d = buildFeeDisclosure(
      contract({ sourceStatus: "awaiting_supplier_quote" }),
      [feeItem({ amountMinorUnits: 5000 })],
    );
    expectAwaiting(d);
  });

  it("zero fee items ⇒ awaiting (missing data is never a published-zero claim)", () => {
    expectAwaiting(buildFeeDisclosure(contract(), []));
  });

  it("mixed-currency contract ⇒ awaiting (never a bare cross-currency sum)", () => {
    const d = buildFeeDisclosure(contract(), [
      feeItem({ amountMinorUnits: 5000, currency: "USD" }),
      feeItem({ amountMinorUnits: 700000, currency: "JPY" }),
    ]);
    expectAwaiting(d);
  });

  it("unknown currency on any line ⇒ awaiting", () => {
    const d = buildFeeDisclosure(contract(), [
      feeItem({ amountMinorUnits: 5000, currency: "ZZZ" as any }),
    ]);
    expectAwaiting(d);
  });

  it("all-zero lines WITHOUT confirmed evidence ⇒ awaiting", () => {
    const d = buildFeeDisclosure(contract({ sourceStatus: "supplier_quote" }), [
      feeItem({ amountMinorUnits: 0 }),
      feeItem({ amountMinorUnits: 0, category: "tips" }),
    ]);
    expectAwaiting(d);
  });

  it("explicitly-evidenced confirmed-zero-fee contract MAY publish zero totals", () => {
    const d = buildFeeDisclosure(contract({ sourceStatus: "confirmed" }), [
      feeItem({ amountMinorUnits: 0, sourceStatus: "confirmed" }),
    ]);
    expect(d.status).toBe("published");
    expect(d.totals).toEqual({
      mandatoryPerPerson: { amountMinorUnits: 0, currency: "USD" },
      tipsPerPerson: { amountMinorUnits: 0, currency: "USD" },
      selfEstimatePerPerson: { amountMinorUnits: 0, currency: "USD" },
    });
  });

  it("awaitingSupplierQuoteDisclosure is the honest empty shape", () => {
    const d = awaitingSupplierQuoteDisclosure();
    expect(d.status).toBe("awaiting_supplier_quote");
    expect(d.contractId).toBeNull();
    expect(d.fees).toEqual([]);
    expect(d.totals).toBeNull();
  });
});
