/**
 * Batch P1c — honest-state render tests for the BC detail sections.
 *
 * Renders the pure section components (no tRPC — DTOs passed as props)
 * with renderToStaticMarkup and asserts the three first-class honest
 * states plus the populated paths:
 *   - null itinerary contract  → 行程內容整理中 (no fabricated days)
 *   - awaiting fee disclosure  → 待供應商報價 (NO amounts, no zero totals)
 *   - empty departures         → 班期尚未開放 (no fabricated availability)
 *   - populated departures     → bucket label keys only, never seat counts
 *   - published fees           → stable QA data attributes + integer money
 *
 * Convention: .test.ts + createElement (vitest esbuild does no JSX
 * transform for .ts), LocaleContext/wouter mocked like adminHomeRender.
 */
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

vi.mock("@/contexts/LocaleContext", () => ({
  // t returns the key so assertions target i18n keys, not display strings.
  useLocale: () => ({
    t: (k: string) => k,
    language: "zh-TW",
  }),
}));

vi.mock("wouter", () => ({
  Link: ({ href, className, children }: { href: string; className?: string; children: unknown }) =>
    createElement("a", { href, className }, children as never),
  useRoute: () => [true, { id: "42" }],
}));

/**
 * Controllable tRPC mock for the FULL BcTourDetail wiring tests (round-2
 * P1-2/P1-3): each storefront query reads its state from `wiring.states`
 * and records every useQuery call's input + enabled flag so tests can
 * prove the fee query is HELD DISABLED until departures succeed.
 */
const wiring = vi.hoisted(() => {
  type QState = {
    data?: unknown;
    isLoading?: boolean;
    isError?: boolean;
    isSuccess?: boolean;
  };
  const states: Record<string, QState> = {};
  const calls: Record<string, Array<{ input: unknown; enabled: boolean | undefined }>> = {};
  const reset = () => {
    for (const key of Object.keys(states)) delete states[key];
    for (const key of Object.keys(calls)) delete calls[key];
  };
  const useQueryFor =
    (name: string) =>
    (input: unknown, opts?: { enabled?: boolean }) => {
      (calls[name] ??= []).push({ input, enabled: opts?.enabled });
      const state = states[name] ?? {};
      return {
        data: state.data,
        isLoading: state.isLoading ?? false,
        isError: state.isError ?? false,
        isSuccess: state.isSuccess ?? false,
        refetch: () => {},
      };
    };
  return { states, calls, reset, useQueryFor };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    storefront: {
      getTourSummary: { useQuery: wiring.useQueryFor("summary") },
      getItineraryContract: { useQuery: wiring.useQueryFor("itinerary") },
      listDepartures: { useQuery: wiring.useQueryFor("departures") },
      getFeeDisclosure: { useQuery: wiring.useQueryFor("fees") },
    },
  },
}));

vi.mock("./BcChrome", () => ({
  default: ({ children }: { children?: unknown }) =>
    createElement("div", { "data-mock": "bc-chrome" }, children as never),
}));

const {
  DeparturesSection,
  FeeDisclosureSection,
  ItinerarySection,
  QueryErrorCard,
  fmtDate,
  splitCategoryFees,
} = await import("./BcDetailSections");
const { default: BcTourDetail } = await import("./BcTourDetail");

const plentyDeparture = {
  id: 7,
  departureDate: new Date("2026-10-04T00:00:00Z"),
  returnDate: new Date("2026-10-08T00:00:00Z"),
  pricePerPersonMinorUnits: 155000,
  currency: "USD",
  bucket: "plenty",
  displayStatusKey: "storefront.availability.plenty",
} as never;

const awaitingDisclosure = {
  status: "awaiting_supplier_quote",
  contractId: null,
  sourceStatus: null,
  displayRegion: null,
  originMarket: null,
  feesByCategory: { mandatory: [], tips: [], self: [], optional: [] },
  fees: [],
  totals: null,
} as never;

function fee(
  feeId: string,
  category: string,
  amountMinorUnits: number,
  unit = "per_person",
) {
  return {
    feeId,
    category,
    labelZh: `${feeId} 中文`,
    labelEn: `${feeId} english`,
    amountMinorUnits,
    currency: "USD",
    unit,
    includedInPackgoCharge: false,
    requiredForTrip: category !== "optional",
    payeeType: "airline",
    paymentTiming: "before_departure",
    sourceStatus: "demo_estimate",
    sortOrder: 0,
  };
}

const publishedDisclosure = {
  status: "published",
  contractId: "fees-MAD-5D-USCA-ES-v1",
  sourceStatus: "demo_estimate",
  displayRegion: "西班牙",
  originMarket: "US-CA",
  feesByCategory: {
    mandatory: [fee("airfare-estimate", "mandatory", 98000)],
    tips: [fee("guide-gratuity", "tips", 12000)],
    self: [fee("unlisted-meals", "self", 16000)],
    optional: [fee("single-supplement", "optional", 34000, "per_booking")],
  },
  fees: [],
  totals: {
    mandatoryPerPerson: { amountMinorUnits: 98000, currency: "USD" },
    tipsPerPerson: { amountMinorUnits: 12000, currency: "USD" },
    selfEstimatePerPerson: { amountMinorUnits: 16000, currency: "USD" },
  },
} as never;

const itineraryContract = {
  schemaVersion: "packgo.itinerary.v1",
  itineraryId: "itn-MAD-5D",
  versionNumber: 3,
  sourceStatus: "demo_estimate",
  originMarket: "US-CA",
  destinationJurisdictions: ["ES"],
  days: [
    {
      dayId: "MAD-5D-D01",
      dayNumber: 1,
      city: "馬德里",
      cityEn: "Madrid",
      summary: "抵達與舊城散步",
      sourceStatus: "demo_estimate",
      movement: { durationMinutes: 95, status: "estimated" },
      meals: { breakfast: "pending", lunch: "self", dinner: "included" },
      stay: {
        propertyStatus: "proposed_or_equivalent",
        bookingStatus: "unconfirmed",
        rating: { value: 4, system: "hotel_classification", sourceStatus: "source_document_claim", verifiedAt: null },
      },
      media: { sourceStatus: "demo_placeholder", rightsStatus: "prototype_only" },
      stops: [
        {
          stopId: "poi-madrid-royal-palace",
          name: "馬德里王宮",
          nameEn: "Royal Palace",
          kind: "heritage",
          summary: "首站",
          lat: 40.418,
          lon: -3.714,
          sourceStatus: "demo_estimate",
          visitStatus: "planned",
          imageAssetId: null,
          mediaStatus: "demo_placeholder",
          sortOrder: 1,
        },
      ],
    },
    {
      dayId: "MAD-5D-D02",
      dayNumber: 2,
      city: "阿維拉",
      cityEn: "Avila",
      summary: null,
      sourceStatus: "demo_estimate",
      movement: { durationMinutes: null, status: "pending" },
      meals: { breakfast: "included", lunch: "pending", dinner: "pending" },
      stay: {
        propertyStatus: "not_applicable",
        bookingStatus: "not_applicable",
        rating: null,
      },
      media: { sourceStatus: "demo_placeholder", rightsStatus: "prototype_only" },
      stops: [],
    },
  ],
} as never;

describe("ItinerarySection — honest null-contract state", () => {
  const html = renderToStaticMarkup(
    createElement(ItinerarySection, { contract: null }),
  );

  it("renders 行程內容整理中 keys and marks the honest state", () => {
    expect(html).toContain("bcPreview.itinerary.pendingTitle");
    expect(html).toContain("bcPreview.itinerary.pendingCopy");
    expect(html).toContain('data-honest-state="itinerary-unpublished"');
  });

  it("fabricates no day cards", () => {
    expect(html).not.toContain("data-day-id");
    expect(html).not.toContain("DAY 0");
  });
});

describe("ItinerarySection — published contract", () => {
  const html = renderToStaticMarkup(
    createElement(ItinerarySection, { contract: itineraryContract }),
  );

  it("exposes contract + day + stop ids for QA", () => {
    expect(html).toContain('data-itinerary-id="itn-MAD-5D"');
    expect(html).toContain('data-day-id="MAD-5D-D01"');
    expect(html).toContain('data-stop-id="poi-madrid-royal-palace"');
  });

  it("renders per-claim honest statuses (meal keys, estimated movement)", () => {
    expect(html).toContain("bcPreview.itinerary.meal.pending");
    expect(html).toContain("bcPreview.itinerary.meal.self");
    expect(html).toContain("bcPreview.itinerary.meal.included");
    expect(html).toContain("bcPreview.itinerary.movement.estimated");
    expect(html).toContain("bcPreview.itinerary.stay.ratingEquivalent");
    expect(html).toContain("bcPreview.source.demoEstimate");
  });
});

describe("DeparturesSection — honest empty state", () => {
  const html = renderToStaticMarkup(
    createElement(DeparturesSection, { departures: [] }),
  );

  it("renders 班期尚未開放 keys, no fabricated rows", () => {
    expect(html).toContain("bcPreview.departures.emptyTitle");
    expect(html).toContain("bcPreview.departures.emptyCopy");
    expect(html).toContain('data-honest-state="departures-empty"');
    expect(html).not.toContain("data-departure-id");
  });
});

describe("DeparturesSection — populated: buckets only, never seat numbers", () => {
  const html = renderToStaticMarkup(
    createElement(DeparturesSection, { departures: [plentyDeparture] }),
  );

  it("renders the three-bucket label key and the bucket data attribute", () => {
    expect(html).toContain("storefront.availability.plenty");
    expect(html).toContain('data-bucket="plenty"');
    expect(html).toContain('data-departure-id="7"');
  });

  it("shows dates and integer-minor-unit price, no seat-count leakage", () => {
    // LITERAL expected string (Codex 2026-07-22 P1-6): never derived from
    // the same fmtDate under test, and correct in EVERY timezone.
    expect(html).toContain("2026.10.04");
    expect(html).toContain("2026.10.08");
    expect(html).not.toContain("2026.10.03");
    expect(html).toContain("1,550");
    for (const forbidden of [
      "totalSlots",
      "bookedSlots",
      "spareSeats",
      "availableSeats",
      "seats",
      "名額",
      "座位",
      "餘位",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("links the row CTA to the real /inquiry page", () => {
    expect(html).toContain('href="/inquiry"');
  });
});

describe("FeeDisclosureSection — honest awaiting_supplier_quote state", () => {
  const html = renderToStaticMarkup(
    createElement(FeeDisclosureSection, {
      disclosure: awaitingDisclosure,
      departure: plentyDeparture,
    }),
  );

  it("renders 待供應商報價 keys and marks the honest state", () => {
    expect(html).toContain("bcPreview.fees.awaitingTitle");
    expect(html).toContain("bcPreview.fees.awaitingCopy");
    expect(html).toContain('data-honest-state="fees-awaiting"');
  });

  it("shows NO amounts at all — an absent quote has no totals, not zeros", () => {
    expect(html).not.toMatch(/US\$|NT\$|\$0|0\.00/);
    expect(html).not.toContain("data-fee-id");
    expect(html).not.toContain("bc-fee-pay-now");
  });
});

describe("FeeDisclosureSection — published disclosure", () => {
  const html = renderToStaticMarkup(
    createElement(FeeDisclosureSection, {
      disclosure: publishedDisclosure,
      departure: plentyDeparture,
    }),
  );

  it("keeps the prototype's stable QA data attributes", () => {
    expect(html).toContain('data-fee-contract-id="fees-MAD-5D-USCA-ES-v1"');
    expect(html).toContain('data-fee-id="airfare-estimate"');
    expect(html).toContain('data-payee-type="airline"');
    expect(html).toContain('data-payment-timing="before_departure"');
  });

  it("renders all four categories with per-person amounts + optional 未計入", () => {
    expect(html).toContain("bcPreview.fees.category.mandatory.title");
    expect(html).toContain("bcPreview.fees.category.tips.title");
    expect(html).toContain("bcPreview.fees.category.self.title");
    expect(html).toContain("bcPreview.fees.category.optional.title");
    expect(html).toContain("bcPreview.fees.notIncluded");
    expect(html).toContain("980"); // mandatory subtotal 98000 minor units
    expect(html).toContain("120"); // tips subtotal
    expect(html).toContain("160"); // self subtotal
  });

  it("integer known total = 團費 155000 + 必付 98000 + 小費 12000 + 自付 16000 = 2,810", () => {
    expect(html).toContain("2,810");
    expect(html).toContain("bcPreview.fees.knownTotalLabel");
  });

  it("demo_estimate provenance renders the honest 預估 示意 tag key", () => {
    expect(html).toContain("bcPreview.source.demoEstimate");
  });
});

/* ── Round 2 regressions (Codex 2026-07-22 verdict) ─────────────────── */

describe("fmtDate — timezone-independent date-only formatting (P1-6)", () => {
  it('renders the LITERAL calendar date: "2026-10-04T00:00:00Z" is always 2026.10.04', () => {
    expect(fmtDate(new Date("2026-10-04T00:00:00Z"))).toBe("2026.10.04");
    expect(fmtDate("2026-10-04T00:00:00Z")).toBe("2026.10.04");
    expect(fmtDate("2026-10-04")).toBe("2026.10.04");
  });

  it("never shows the previous local day (the PT counterexample)", () => {
    expect(fmtDate(new Date("2026-01-01T00:00:00Z"))).toBe("2026.01.01");
    expect(fmtDate("2026-12-31T00:00:00.000Z")).toBe("2026.12.31");
  });
});

describe("query-error states are DISTINCT from honest absent states (P1-8)", () => {
  it("QueryErrorCard renders the bilingual error keys with role=alert", () => {
    const html = renderToStaticMarkup(createElement(QueryErrorCard, {}));
    expect(html).toContain("bcPreview.common.loadErrorTitle");
    expect(html).toContain("bcPreview.common.loadErrorCopy");
    expect(html).toContain('data-error-state="query-error"');
    expect(html).toContain('role="alert"');
  });

  it("ItinerarySection queryError shows the error state, NEVER 尚未發佈", () => {
    const html = renderToStaticMarkup(
      createElement(ItinerarySection, { contract: null, queryError: true }),
    );
    expect(html).toContain('data-error-state="itinerary-load-failed"');
    expect(html).toContain("bcPreview.common.loadErrorTitle");
    expect(html).not.toContain("bcPreview.itinerary.pendingTitle");
    expect(html).not.toContain('data-honest-state="itinerary-unpublished"');
  });

  it("DeparturesSection queryError shows the error state, NEVER 空班期", () => {
    const html = renderToStaticMarkup(
      createElement(DeparturesSection, { departures: [], queryError: true }),
    );
    expect(html).toContain('data-error-state="departures-load-failed"');
    expect(html).toContain("bcPreview.common.loadErrorTitle");
    expect(html).not.toContain("bcPreview.departures.emptyTitle");
    expect(html).not.toContain('data-honest-state="departures-empty"');
  });

  it("FeeDisclosureSection queryError shows the error state, NEVER 待供應商報價", () => {
    const html = renderToStaticMarkup(
      createElement(FeeDisclosureSection, {
        disclosure: null,
        departure: null,
        queryError: true,
      }),
    );
    expect(html).toContain('data-error-state="fees-load-failed"');
    expect(html).toContain("bcPreview.common.loadErrorTitle");
    expect(html).not.toContain("bcPreview.fees.awaitingTitle");
    expect(html).not.toContain('data-honest-state="fees-awaiting"');
  });

  it("FeeDisclosureSection with no data and no error renders NOTHING (no guessed state)", () => {
    const html = renderToStaticMarkup(
      createElement(FeeDisclosureSection, {
        disclosure: null,
        departure: null,
      }),
    );
    expect(html).toBe("");
  });

  it("the honest states remain untouched when queryError is false", () => {
    const html = renderToStaticMarkup(
      createElement(DeparturesSection, { departures: [] }),
    );
    expect(html).toContain('data-honest-state="departures-empty"');
    expect(html).not.toContain("bcPreview.common.loadErrorTitle");
  });
});

describe("fee line flags — includedInPackgoCharge / requiredForTrip / unit / sourceStatus (P1-7)", () => {
  // 團費 155000 USD. Mandatory: 12050 separate + 98000 ALREADY INCLUDED in
  // the PACK&GO charge. Tips: required per_booking 5000 (NO per-person tips).
  // Self: 16000 separate.
  const flaggedDisclosure = {
    status: "published",
    contractId: "fees-flags-v1",
    sourceStatus: "supplier_quote",
    displayRegion: null,
    originMarket: "US-CA",
    feesByCategory: {
      mandatory: [
        { ...fee("visa-fee", "mandatory", 12050), sourceStatus: "supplier_quote" },
        {
          ...fee("intl-airfare", "mandatory", 98000),
          includedInPackgoCharge: true,
          sourceStatus: "demo_estimate",
        },
      ],
      tips: [
        {
          ...fee("port-charge", "tips", 5000, "per_booking"),
          requiredForTrip: true,
        },
      ],
      self: [fee("unlisted-meals", "self", 16000)],
      optional: [],
    },
    fees: [],
    totals: {
      // server totals still include the included-in-charge 98000 — the UI
      // must NOT reuse them for 另外支付 claims.
      mandatoryPerPerson: { amountMinorUnits: 110050, currency: "USD" },
      tipsPerPerson: { amountMinorUnits: 0, currency: "USD" },
      selfEstimatePerPerson: { amountMinorUnits: 16000, currency: "USD" },
    },
  } as never;

  const html = renderToStaticMarkup(
    createElement(FeeDisclosureSection, {
      disclosure: flaggedDisclosure,
      departure: plentyDeparture,
    }),
  );

  it("an includedInPackgoCharge line is labeled 已含在團費 and marked in the DOM", () => {
    expect(html).toContain("bcPreview.fees.includedInCharge");
    expect(html).toContain('data-included-in-charge="true"');
    expect(html).toContain('data-included-in-charge="false"');
  });

  it("included-in-charge amounts are NEVER double-counted: known total = 1550 + 120.50 + 160 = 1,830.50", () => {
    // 155000 (departure) + 12050 (separate mandatory) + 0 (per-person tips)
    // + 16000 (self) = 183050 minor units. The included 98000 is already
    // inside 團費; the required per_booking 5000 is not a per-person amount.
    expect(html).toContain("1,830.50");
    expect(html).not.toContain("2,810.50"); // + the included 98000 again
    expect(html).not.toContain("2,860.50"); // + included + per_booking
  });

  it("mandatory subtotal claims ONLY the separately-paid per-person sum (120.50, not 1,100.50)", () => {
    expect(html).toContain("120.50");
    expect(html).not.toContain("1,100.50");
  });

  it("a required per_booking fee is listed with its own unit label, never masked behind a $0 subtotal", () => {
    expect(html).toContain('data-fee-unit="per_booking"');
    expect(html).toContain("bcPreview.fees.unit.perBooking");
    expect(html).toContain("bcPreview.fees.perBookingHeading");
    // tips header shows the per-booking pointer, not a $0 claim
    expect(html).toContain("bcPreview.fees.perBookingOnly");
    expect(html).toContain('data-required-for-trip="true"');
  });

  it("the known total discloses that required per-booking fees are excluded", () => {
    expect(html).toContain("bcPreview.fees.knownTotalExcludesPerBooking");
  });

  it("item-level sourceStatus renders per line — a demo_estimate item shows 預估 示意 even under a supplier_quote contract", () => {
    expect(html).toContain('data-fee-source-status="demo_estimate"');
    expect(html).toContain('data-fee-source-status="supplier_quote"');
    expect(html).toContain("bcPreview.source.demoEstimate");
  });

  it("requiredForTrip renders 必要/可選 keys per line", () => {
    expect(html).toContain("bcPreview.fees.required");
  });
});

describe("cross-currency safety in the known total (P1-5)", () => {
  it("departure in a DIFFERENT currency than the fees ⇒ no known-total line at all", () => {
    const jpyDeparture = {
      ...(plentyDeparture as unknown as Record<string, unknown>),
      pricePerPersonMinorUnits: 5000000,
      currency: "JPY",
    } as never;
    const html = renderToStaticMarkup(
      createElement(FeeDisclosureSection, {
        disclosure: publishedDisclosure,
        departure: jpyDeparture,
      }),
    );
    expect(html).not.toContain("bcPreview.fees.knownTotalLabel");
  });
});

/* ── Round 3: the fee truth table closes (round-2 P1-2) ──────────────── */

function publishedShell(feesByCategory: Record<string, unknown[]>) {
  return {
    status: "published",
    contractId: "fees-truth-table-v1",
    sourceStatus: "supplier_quote",
    displayRegion: null,
    originMarket: "US-CA",
    feesByCategory: {
      mandatory: [],
      tips: [],
      self: [],
      optional: [],
      ...feesByCategory,
    },
    fees: [],
    totals: {
      mandatoryPerPerson: { amountMinorUnits: 0, currency: "USD" },
      tipsPerPerson: { amountMinorUnits: 0, currency: "USD" },
      selfEstimatePerPerson: { amountMinorUnits: 0, currency: "USD" },
    },
  } as never;
}

describe("fee truth table — included/required/unit decide JOINTLY (round-2 P1-2)", () => {
  it("splitCategoryFees: the exact Codex counterexample — mandatory + requiredForTrip=false + 9900 sums to ZERO", () => {
    const split = splitCategoryFees([
      { ...fee("optional-insurance", "mandatory", 9900), requiredForTrip: false },
    ] as never);
    expect(split.separateRequiredPerPersonMinorUnits).toBe(0);
    expect(split.requiredPerBooking).toEqual([]);
  });

  it("splitCategoryFees: an included line never reaches any accounting bucket, whatever its flags", () => {
    const split = splitCategoryFees([
      {
        ...fee("intl-airfare", "mandatory", 98000),
        includedInPackgoCharge: true,
        requiredForTrip: true,
      },
      {
        ...fee("port-charge", "mandatory", 5000, "per_booking"),
        includedInPackgoCharge: true,
        requiredForTrip: true,
      },
    ] as never);
    expect(split.separateRequiredPerPersonMinorUnits).toBe(0);
    expect(split.requiredPerBooking).toEqual([]);
    // still LISTED under the per-booking heading — just never counted/reminded
    expect(split.perBooking).toHaveLength(1);
    expect(split.allIncludedInCharge).toBe(true);
  });

  it("splitCategoryFees: a required per-person line in ANOTHER currency is never added — it lands in crossCurrencyRequired (round-3 P1-1)", () => {
    const split = splitCategoryFees(
      [
        fee("visa-fee", "mandatory", 12000),
        { ...fee("local-city-tax", "mandatory", 300000), currency: "JPY" },
      ] as never,
      "USD",
    );
    // the USD sum holds ONLY the USD line; the JPY line is listed apart
    expect(split.separateRequiredPerPersonMinorUnits).toBe(12000);
    expect(split.crossCurrencyRequired).toHaveLength(1);
    expect((split.crossCurrencyRequired[0] as { feeId: string }).feeId).toBe(
      "local-city-tax",
    );
  });

  it("splitCategoryFees: whole-category claims need EVERY line — one included line in a mixed category sets NEITHER allIncludedInCharge NOR allOptional (round-3 P1-1)", () => {
    const split = splitCategoryFees(
      [
        {
          ...fee("intl-airfare", "mandatory", 98000),
          includedInPackgoCharge: true,
        },
        { ...fee("optional-insurance", "mandatory", 9900), requiredForTrip: false },
      ] as never,
      "USD",
    );
    expect(split.allIncludedInCharge).toBe(false);
    expect(split.allOptional).toBe(false);
    expect(split.hasExcludedOptional).toBe(true);
    expect(split.separateRequiredPerPersonMinorUnits).toBe(0);
  });

  it("(d) MIXED included/non-included category → the header claims NEITHER 已含在團費 NOR 未計入 for the whole category — neutral 詳見逐筆標示 (round-3 P1-1)", () => {
    const html = renderToStaticMarkup(
      createElement(FeeDisclosureSection, {
        disclosure: publishedShell({
          tips: [
            {
              ...fee("driver-gratuity", "tips", 8000),
              includedInPackgoCharge: true,
              requiredForTrip: true,
            },
            { ...fee("hotel-porter-tip", "tips", 3000), requiredForTrip: false },
          ],
        }),
        departure: plentyDeparture,
      }),
    );
    // the category HEADER is the <strong> right after the note — it must be
    // the neutral pointer, never a whole-category 已含/未計入 claim
    expect(html).toContain("<strong>bcPreview.fees.seeLines</strong>");
    expect(html).not.toContain("<strong>bcPreview.fees.includedInCharge</strong>");
    expect(html).not.toContain("<strong>bcPreview.fees.notIncluded</strong>");
    // the per-row badges still carry the truth
    expect(html).toContain('data-included-in-charge="true"');
    expect(html).toContain('data-required-for-trip="false"');
    // known total = 團費 only (included line already inside; optional line out)
    expect(html).toContain("1,550");
    // and the dynamic exclusion note appears because an optional row exists
    expect(html).toContain("bcPreview.fees.knownTotalExcludesOptional");
  });

  it("ALL-included category → header may claim 已含在團費 (every line supports it)", () => {
    const html = renderToStaticMarkup(
      createElement(FeeDisclosureSection, {
        disclosure: publishedShell({
          tips: [
            {
              ...fee("driver-gratuity", "tips", 8000),
              includedInPackgoCharge: true,
              requiredForTrip: true,
            },
          ],
        }),
        departure: plentyDeparture,
      }),
    );
    expect(html).toContain("<strong>bcPreview.fees.includedInCharge</strong>");
  });

  it("known-total exclusion notes are DYNAMIC — absent when no such rows exist (round-3 P1-1)", () => {
    const html = renderToStaticMarkup(
      createElement(FeeDisclosureSection, {
        disclosure: publishedShell({
          mandatory: [fee("visa-fee", "mandatory", 12000)],
        }),
        departure: plentyDeparture,
      }),
    );
    // only a required USD per-person line: nothing was excluded, so NO
    // exclusion note may claim otherwise
    expect(html).toContain("bcPreview.fees.knownTotalLabel");
    expect(html).not.toContain("bcPreview.fees.knownTotalExcludesPerBooking");
    expect(html).not.toContain("bcPreview.fees.knownTotalExcludesOptional");
    expect(html).not.toContain("bcPreview.fees.knownTotalExcludesCrossCurrency");
    expect(html).toContain("1,670"); // 155000 + 12000
  });

  it("a required CROSS-CURRENCY line → neutral header, excluded from the sum, and the cross-currency note appears (round-3 P1-1)", () => {
    const html = renderToStaticMarkup(
      createElement(FeeDisclosureSection, {
        disclosure: publishedShell({
          mandatory: [
            fee("visa-fee", "mandatory", 12000),
            { ...fee("local-city-tax", "mandatory", 300000), currency: "JPY" },
          ],
        }),
        departure: plentyDeparture,
      }),
    );
    // header goes neutral — a partial USD figure must not speak for a
    // category that also requires a JPY amount
    expect(html).toContain("<strong>bcPreview.fees.seeLines</strong>");
    // the JPY amount is never inside the USD known total
    expect(html).toContain("1,670"); // 155000 + 12000 USD only
    expect(html).toContain("bcPreview.fees.knownTotalExcludesCrossCurrency");
    // the JPY line still renders with its own currency
    expect(html).toContain('data-fee-id="local-city-tax"');
  });

  it("splitCategoryFees: optional CATEGORY + requiredForTrip=true + not included IS required accounting", () => {
    const split = splitCategoryFees([
      { ...fee("visa-on-arrival", "optional", 9900), requiredForTrip: true },
    ] as never);
    expect(split.separateRequiredPerPersonMinorUnits).toBe(9900);
  });

  it("(a) included + required per_booking → 已含 label, NO per-booking reminder, NOT in any subtotal", () => {
    const html = renderToStaticMarkup(
      createElement(FeeDisclosureSection, {
        disclosure: publishedShell({
          mandatory: [fee("visa-fee", "mandatory", 12000)],
          tips: [
            {
              ...fee("port-charge", "tips", 5000, "per_booking"),
              includedInPackgoCharge: true,
              requiredForTrip: true,
            },
          ],
        }),
        departure: plentyDeparture,
      }),
    );
    // The included required per-booking line is listed and labeled 已含在團費
    expect(html).toContain('data-fee-id="port-charge"');
    expect(html).toContain('data-included-in-charge="true"');
    expect(html).toContain("bcPreview.fees.includedInCharge");
    // ...but it must NEVER trigger 另有必要 per-booking 未計入 (the round-2
    // contradiction: 已含在團費 and 未計入總額 on the same fee).
    expect(html).not.toContain("bcPreview.fees.knownTotalExcludesPerBooking");
    // and the known total is 團費 155000 + separate mandatory 12000 only.
    expect(html).toContain("1,670");
    expect(html).not.toContain("1,720"); // + the included per_booking 5000
  });

  it("(b) mandatory category + requiredForTrip=false → listed + labeled 可選, EXCLUDED from subtotal and known total", () => {
    const html = renderToStaticMarkup(
      createElement(FeeDisclosureSection, {
        disclosure: publishedShell({
          mandatory: [
            { ...fee("optional-insurance", "mandatory", 9900), requiredForTrip: false },
          ],
        }),
        departure: plentyDeparture,
      }),
    );
    // listed with its own flags, labeled 可選
    expect(html).toContain('data-fee-id="optional-insurance"');
    expect(html).toContain('data-required-for-trip="false"');
    expect(html).toContain("bcPreview.fees.optionalChoice");
    // known total = 團費 alone; the optional-style 9900 is never added
    expect(html).toContain("1,550");
    expect(html).not.toContain("1,649");
    // the mandatory header claims no separate-payment amount
    expect(html).toContain("bcPreview.fees.notIncluded");
  });

  it("(c) optional category + requiredForTrip=true + not included → IN the required accounting", () => {
    const html = renderToStaticMarkup(
      createElement(FeeDisclosureSection, {
        disclosure: publishedShell({
          optional: [
            { ...fee("visa-on-arrival", "optional", 9900), requiredForTrip: true },
          ],
        }),
        departure: plentyDeparture,
      }),
    );
    expect(html).toContain('data-fee-id="visa-on-arrival"');
    expect(html).toContain('data-required-for-trip="true"');
    // the optional-category header claims the REQUIRED amount, not 未計入
    expect(html).not.toContain("bcPreview.fees.notIncluded");
    // known total = 155000 + 9900 = 164900 → 1,649
    expect(html).toContain("1,649");
  });
});

/* ── Round 3: loading is a FIRST-CLASS state (round-2 P1-3) ──────────── */

describe("loading / error / absent are mutually exclusive per section (round-2 P1-3)", () => {
  it("ItinerarySection queryLoading → loading state ONLY, never 尚未發佈 or error", () => {
    const html = renderToStaticMarkup(
      createElement(ItinerarySection, { contract: null, queryLoading: true }),
    );
    expect(html).toContain('data-loading-state="itinerary-loading"');
    expect(html).toContain("common.loading");
    expect(html).not.toContain("data-honest-state");
    expect(html).not.toContain("data-error-state");
    expect(html).not.toContain("bcPreview.itinerary.pendingTitle");
  });

  it("DeparturesSection queryLoading → loading state ONLY, never 空班期 or error", () => {
    const html = renderToStaticMarkup(
      createElement(DeparturesSection, { departures: [], queryLoading: true }),
    );
    expect(html).toContain('data-loading-state="departures-loading"');
    expect(html).toContain("common.loading");
    expect(html).not.toContain("data-honest-state");
    expect(html).not.toContain("data-error-state");
    expect(html).not.toContain("bcPreview.departures.emptyTitle");
  });

  it("FeeDisclosureSection queryLoading → loading state ONLY, never 待報價 or error", () => {
    const html = renderToStaticMarkup(
      createElement(FeeDisclosureSection, {
        disclosure: null,
        departure: null,
        queryLoading: true,
      }),
    );
    expect(html).toContain('data-loading-state="fees-loading"');
    expect(html).toContain("common.loading");
    expect(html).not.toContain("data-honest-state");
    expect(html).not.toContain("data-error-state");
    expect(html).not.toContain("bcPreview.fees.awaitingTitle");
  });

  it("error takes precedence over loading in every section (a settled failure is never 載入中)", () => {
    const itinerary = renderToStaticMarkup(
      createElement(ItinerarySection, {
        contract: null,
        queryLoading: true,
        queryError: true,
      }),
    );
    const departures = renderToStaticMarkup(
      createElement(DeparturesSection, {
        departures: [],
        queryLoading: true,
        queryError: true,
      }),
    );
    const fees = renderToStaticMarkup(
      createElement(FeeDisclosureSection, {
        disclosure: null,
        departure: null,
        queryLoading: true,
        queryError: true,
      }),
    );
    for (const html of [itinerary, departures, fees]) {
      expect(html).toContain("data-error-state");
      expect(html).not.toContain("data-loading-state");
      expect(html).not.toContain("data-honest-state");
    }
  });

  it("the absent claims still render when NOT loading and NOT errored", () => {
    const html = renderToStaticMarkup(
      createElement(DeparturesSection, { departures: [], queryLoading: false }),
    );
    expect(html).toContain('data-honest-state="departures-empty"');
    expect(html).not.toContain("data-loading-state");
  });
});

/* ── Round 3: FULL BcTourDetail wiring (round-2 P1-2 d / P1-3) ───────── */

describe("BcTourDetail wiring — query status reaches the sections", () => {
  const tourSummary = {
    id: 42,
    title: "馬德里五日",
    heroImage: null,
    duration: 5,
    nights: 4,
    productCode: "26MAD5D-T",
    destinationCountry: "西班牙",
    destinationCity: "馬德里",
  };

  function renderDetail(
    states: Record<
      string,
      { data?: unknown; isLoading?: boolean; isError?: boolean; isSuccess?: boolean }
    >,
  ) {
    wiring.reset();
    Object.assign(wiring.states, states);
    return renderToStaticMarkup(createElement(BcTourDetail));
  }

  it("summary success while itinerary/departures/fees still load → loading states everywhere, NO absent claims (the round-2 counterexample)", () => {
    const html = renderDetail({
      summary: { data: tourSummary, isSuccess: true },
      itinerary: { isLoading: true },
      departures: { isLoading: true },
      fees: {},
    });
    expect(html).toContain('data-loading-state="itinerary-loading"');
    expect(html).toContain('data-loading-state="departures-loading"');
    expect(html).toContain('data-loading-state="fees-loading"');
    for (const forbidden of [
      'data-honest-state="itinerary-unpublished"',
      'data-honest-state="departures-empty"',
      'data-honest-state="fees-awaiting"',
      "bcPreview.itinerary.pendingTitle",
      "bcPreview.departures.emptyTitle",
      "bcPreview.fees.awaitingTitle",
      "bcPreview.card.noDeparture",
    ]) {
      expect(html, `loading page must not claim: ${forbidden}`).not.toContain(forbidden);
    }
    // the dependent fee query is held disabled while departures are unsettled
    expect(wiring.calls.fees.length).toBeGreaterThan(0);
    for (const call of wiring.calls.fees) {
      expect(call.enabled).toBe(false);
    }
  });

  it("(d) departures ERROR → fee query stays DISABLED (never fired with departureDate=undefined) and fees show the error state, not today-contract data", () => {
    const html = renderDetail({
      summary: { data: tourSummary, isSuccess: true },
      itinerary: { data: null, isSuccess: true },
      departures: { isError: true },
      fees: {},
    });
    expect(wiring.calls.fees.length).toBeGreaterThan(0);
    for (const call of wiring.calls.fees) {
      // With no departure date known, firing this query would resolve
      // TODAY'S fee contract — it must be held disabled instead.
      expect(call.enabled).toBe(false);
      expect(
        (call.input as { departureDate?: unknown }).departureDate,
      ).toBeUndefined();
    }
    expect(html).toContain('data-error-state="departures-load-failed"');
    expect(html).toContain('data-error-state="fees-load-failed"');
    expect(html).not.toContain('data-honest-state="departures-empty"');
    expect(html).not.toContain('data-honest-state="fees-awaiting"');
    expect(html).not.toContain('data-loading-state="fees-loading"');
    expect(html).not.toContain("data-fee-contract-id");
  });

  it("(round-3 P1-2 counterexample) departures PENDING + fee query serves a CACHED success → fee section shows LOADING, never the cached awaiting/contract", () => {
    // The fee query is disabled while departures are unsettled, but TanStack
    // can still surface a cached success for the same query key (status
    // "success", isSuccess true, data present). departures success is a
    // NECESSARY condition — the cached data must not render.
    const cachedAwaiting = renderDetail({
      summary: { data: tourSummary, isSuccess: true },
      itinerary: { isLoading: true },
      departures: { isLoading: true },
      fees: { data: awaitingDisclosure, isSuccess: true }, // disabled-but-cached
    });
    expect(cachedAwaiting).toContain('data-loading-state="fees-loading"');
    expect(cachedAwaiting).not.toContain('data-honest-state="fees-awaiting"');
    expect(cachedAwaiting).not.toContain("bcPreview.fees.awaitingTitle");
    // and a cached PUBLISHED contract must not render either — no fee
    // amounts, no known total, no contract id while departures are pending
    const cachedContract = renderDetail({
      summary: { data: tourSummary, isSuccess: true },
      itinerary: { isLoading: true },
      departures: { isLoading: true },
      fees: { data: publishedDisclosure, isSuccess: true }, // stale cached contract
    });
    expect(cachedContract).toContain('data-loading-state="fees-loading"');
    expect(cachedContract).not.toContain("data-fee-contract-id");
    expect(cachedContract).not.toContain("data-fee-id");
    expect(cachedContract).not.toContain("bcPreview.fees.knownTotalLabel");
    expect(cachedContract).not.toContain('data-honest-state="fees-awaiting"');
    // the query itself stays disabled the whole time
    expect(wiring.calls.fees.length).toBeGreaterThan(0);
    for (const call of wiring.calls.fees) {
      expect(call.enabled).toBe(false);
    }
  });

  it("(round-3 P1-2 positive) NON-EMPTY departures success → all four queries carry the exact input/enabled; the fee query fires with the SOONEST departure date", () => {
    const laterDeparture = {
      ...(plentyDeparture as unknown as Record<string, unknown>),
      id: 8,
      departureDate: new Date("2026-11-01T00:00:00Z"),
      returnDate: new Date("2026-11-05T00:00:00Z"),
    } as never;
    const html = renderDetail({
      summary: { data: tourSummary, isSuccess: true },
      itinerary: { data: null, isSuccess: true },
      departures: { data: [plentyDeparture, laterDeparture], isSuccess: true },
      fees: { data: publishedDisclosure, isSuccess: true },
    });
    // the three independent queries all ask for THIS tour and are enabled
    for (const name of ["summary", "itinerary", "departures"] as const) {
      const last = wiring.calls[name].at(-1)!;
      expect(last.input, `${name} input`).toEqual({ tourId: 42 });
      expect(last.enabled, `${name} enabled`).toBe(true);
    }
    // the fee query is ENABLED and asks for the SOONEST departure's exact
    // date (2026-10-04, the first of the date-ascending list — never the
    // later one, never undefined)
    const feeCall = wiring.calls.fees.at(-1)!;
    expect(feeCall.enabled).toBe(true);
    const input = feeCall.input as { tourId: number; departureDate?: Date };
    expect(input.tourId).toBe(42);
    expect(input.departureDate).toBeInstanceOf(Date);
    expect(input.departureDate!.toISOString()).toBe("2026-10-04T00:00:00.000Z");
    // with the dependency settled, the fee contract MAY render
    expect(html).toContain('data-fee-contract-id="fees-MAD-5D-USCA-ES-v1"');
    expect(html).not.toContain('data-loading-state="fees-loading"');
  });

  it("after FULL success with null/[]/awaiting data, the honest absent claims MAY render — and no loading state remains", () => {
    const html = renderDetail({
      summary: { data: tourSummary, isSuccess: true },
      itinerary: { data: null, isSuccess: true },
      departures: { data: [], isSuccess: true },
      fees: { data: awaitingDisclosure, isSuccess: true },
    });
    expect(html).toContain('data-honest-state="itinerary-unpublished"');
    expect(html).toContain('data-honest-state="departures-empty"');
    expect(html).toContain('data-honest-state="fees-awaiting"');
    expect(html).not.toContain("data-loading-state");
    expect(html).not.toContain("data-error-state");
    // now that departures have SUCCEEDED, the fee query is enabled
    expect(wiring.calls.fees.some((call) => call.enabled === true)).toBe(true);
  });
});
