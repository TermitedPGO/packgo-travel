/**
 * Batch P1c — label mapper tests.
 *
 * Availability rule under test: EXACTLY three public buckets
 * (充足/少量/候補), the client mapper mirrors the server's
 * BUCKET_LABEL_KEYS, no numeric leakage in any resolved label, and an
 * unknown bucket fails closed (throws) instead of inventing a fourth state.
 * Also proves every key the mappers can emit exists in BOTH i18n files.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { zhTW, en } from "@/i18n";
import { BUCKET_LABEL_KEYS } from "../../../../../server/storefront/availabilityBucket";
import {
  BC_BUCKETS,
  FEE_CATEGORY_ORDER,
  bucketLabelKey,
  feeCategoryNoteKey,
  feeCategoryTitleKey,
  feeUnitLabelKey,
  mealStatusLabelKey,
  movementStatusLabelKey,
  payeeLabelKey,
  sourceStatusLabelKey,
  stayLabel,
  timingLabelKey,
  toBcCardDepartureFacts,
  toBcShelfTour,
} from "./bcLabels";

function resolve(dict: object, key: string): unknown {
  return key.split(".").reduce<any>((acc, part) => acc?.[part], dict);
}

function expectKeyInBothLanguages(key: string) {
  const zh = resolve(zhTW, key);
  const enVal = resolve(en, key);
  expect(typeof zh, `${key} missing in zh-TW`).toBe("string");
  expect(typeof enVal, `${key} missing in en`).toBe("string");
  return { zh: zh as string, en: enVal as string };
}

describe("availability buckets — three buckets only, never a number", () => {
  it("exactly three buckets exist", () => {
    expect(BC_BUCKETS).toEqual(["plenty", "few", "waitlist"]);
    expect(BC_BUCKETS).toHaveLength(3);
  });

  it("client mapper mirrors the server BUCKET_LABEL_KEYS exactly", () => {
    for (const bucket of BC_BUCKETS) {
      expect(bucketLabelKey(bucket)).toBe(BUCKET_LABEL_KEYS[bucket]);
    }
  });

  it("resolved labels exist in both languages and contain NO digits", () => {
    for (const bucket of BC_BUCKETS) {
      const { zh, en: enLabel } = expectKeyInBothLanguages(bucketLabelKey(bucket));
      expect(zh).not.toMatch(/[0-9０-９]/);
      expect(enLabel).not.toMatch(/[0-9]/);
    }
    expect(resolve(zhTW, "storefront.availability.plenty")).toBe("充足");
    expect(resolve(zhTW, "storefront.availability.few")).toBe("少量");
    expect(resolve(zhTW, "storefront.availability.waitlist")).toBe("候補");
  });

  it("unknown bucket throws — no fourth public state can render", () => {
    expect(() => bucketLabelKey("soldout")).toThrow();
    expect(() => bucketLabelKey("")).toThrow();
    expect(() => bucketLabelKey("4 seats")).toThrow();
  });
});

describe("fee label mappers resolve in both i18n files", () => {
  it("payee types (all 9 known + unknown fallback)", () => {
    const payees = [
      "airline",
      "government",
      "guide_and_driver",
      "leader_and_driver",
      "restaurant_or_traveler_choice",
      "packgo_or_hotel",
      "local_supplier",
      "ticket_supplier",
      "other",
    ];
    for (const payee of payees) {
      expectKeyInBothLanguages(payeeLabelKey(payee));
    }
    expect(payeeLabelKey("mystery_payee")).toBe("bcPreview.fees.payee.other");
  });

  it("payment timings + unknown ⇒ honest pending", () => {
    for (const timing of ["before_departure", "during_trip", "if_selected"]) {
      expectKeyInBothLanguages(timingLabelKey(timing));
    }
    expect(timingLabelKey("whenever")).toBe("bcPreview.fees.timing.pending");
    expectKeyInBothLanguages("bcPreview.fees.timing.pending");
  });

  it("units and categories", () => {
    expectKeyInBothLanguages(feeUnitLabelKey("per_person"));
    expectKeyInBothLanguages(feeUnitLabelKey("per_booking"));
    for (const category of FEE_CATEGORY_ORDER) {
      expectKeyInBothLanguages(feeCategoryTitleKey(category));
      expectKeyInBothLanguages(feeCategoryNoteKey(category));
    }
  });
});

describe("itinerary honest-state mappers", () => {
  it("meal statuses incl. unknown ⇒ pending", () => {
    for (const status of [
      "self",
      "included",
      "included_unconfirmed",
      "in_flight",
      "pending",
    ]) {
      expectKeyInBothLanguages(mealStatusLabelKey(status));
    }
    expect(mealStatusLabelKey("mystery")).toBe("bcPreview.itinerary.meal.pending");
  });

  it("movement statuses — estimated reads as 預估 示意, never a settled claim", () => {
    const { zh } = expectKeyInBothLanguages(movementStatusLabelKey("estimated"));
    expect(zh).toContain("預估");
    expectKeyInBothLanguages(movementStatusLabelKey("confirmed"));
    expect(movementStatusLabelKey("mystery")).toBe(
      "bcPreview.itinerary.movement.pending",
    );
  });

  it("source statuses — demo_estimate renders the honest 預估 示意 wording", () => {
    const { zh } = expectKeyInBothLanguages(sourceStatusLabelKey("demo_estimate"));
    expect(zh).toContain("預估");
    expectKeyInBothLanguages(sourceStatusLabelKey("supplier_confirmed"));
    expectKeyInBothLanguages(sourceStatusLabelKey(null));
    expect(sourceStatusLabelKey(undefined)).toBe("bcPreview.source.pending");
  });

  it("stay labels — no rating claim never fabricates stars", () => {
    expect(
      stayLabel({ propertyStatus: "proposed_or_equivalent", rating: null }).key,
    ).toBe("bcPreview.itinerary.stay.ratingPending");
    expect(stayLabel({ propertyStatus: "not_applicable", rating: null }).key).toBe(
      "bcPreview.itinerary.stay.noStay",
    );
    const unverified = stayLabel({
      propertyStatus: "proposed_or_equivalent",
      rating: { value: 4, sourceStatus: "source_document_claim" },
    });
    expect(unverified.key).toBe("bcPreview.itinerary.stay.ratingEquivalent");
    expect(unverified.params).toEqual({ value: 4 });
    const verified = stayLabel({
      propertyStatus: "confirmed_property",
      rating: { value: 5, sourceStatus: "verified" },
    });
    expect(verified.key).toBe("bcPreview.itinerary.stay.ratingVerified");
    for (const key of [
      "bcPreview.itinerary.stay.ratingPending",
      "bcPreview.itinerary.stay.noStay",
      "bcPreview.itinerary.stay.ratingEquivalent",
      "bcPreview.itinerary.stay.ratingVerified",
    ]) {
      expectKeyInBothLanguages(key);
    }
  });
});

/* ── Round 2 regressions (Codex 2026-07-22 verdict) ─────────────────── */

const BC_DIR = join(__dirname);
const BC_SOURCE_FILES = readdirSync(BC_DIR)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"))
  .sort();

function readBcSource(file: string): string {
  return readFileSync(join(BC_DIR, file), "utf8");
}

describe("BC sources never touch unsafe endpoints or fake money paths (P0-1/P0-2/P0-3/P1-1)", () => {
  it("scans the expected non-test source set", () => {
    expect(BC_SOURCE_FILES).toEqual([
      "BcChrome.tsx",
      "BcDetailSections.tsx",
      "BcHome.tsx",
      "BcTourCard.tsx",
      "BcTourDetail.tsx",
      "BcTours.tsx",
      "bcLabels.ts",
      "bcMoney.ts",
    ]);
  });

  it("no BC source calls departures.getNextBatch or tours.getById (raw-endpoint ban)", () => {
    for (const file of BC_SOURCE_FILES) {
      const src = readBcSource(file);
      expect(src, `${file} must not use getNextBatch`).not.toContain("getNextBatch");
      expect(src, `${file} must not use tours.getById`).not.toContain("getById");
    }
  });

  it("no BC source uses the shared card mapper or its fixed-FX / flight-claim outputs", () => {
    for (const file of BC_SOURCE_FILES) {
      const src = readBcSource(file);
      expect(src, `${file} must not use toTourCardData`).not.toContain("toTourCardData");
      expect(src, `${file} must not carry startingUsd`).not.toContain("startingUsd");
      expect(src, `${file} must not carry TWD_PER_USD`).not.toContain("TWD_PER_USD");
      expect(src, `${file} must not derive a flight claim`).not.toContain("flightInclusion");
      expect(src, `${file} must not use the whole-unit formatter`).not.toContain(
        "formatWholeUnits",
      );
      expect(src, `${file} must not cast payloads narrow`).not.toContain(
        "as Record<number, LeanDeparture",
      );
    }
  });

  it("no cross-currency 'cheapest' comparison and no displayStatusKey shortcut survive (P1-5/P1-2)", () => {
    for (const file of BC_SOURCE_FILES) {
      const src = readBcSource(file);
      expect(src, `${file} must not pick a cheapest departure`).not.toContain("cheapest");
      expect(
        src,
        `${file} must not compare pricePerPersonMinorUnits across departures`,
      ).not.toMatch(/pricePerPersonMinorUnits\s*[<>]/);
      expect(
        src,
        `${file} must resolve availability via bucketLabelKey, not displayStatusKey`,
      ).not.toContain("displayStatusKey");
    }
  });

  it("no local (timezone-dependent) date getters in BC sources (P1-6)", () => {
    for (const file of BC_SOURCE_FILES) {
      const src = readBcSource(file);
      expect(src, `${file} must not use local date getters`).not.toMatch(
        /\.getFullYear\(|[^C]\.getMonth\(|[^C]\.getDate\(/,
      );
    }
  });
});

/* ── Round 3: the legacy price facet is BANNED from the BC shelf ─────── */

describe("BC shelf offers NO price facet and NO price sort (round-2 P1-1)", () => {
  // Why: the only server-side price the catalog can filter/sort on is the
  // legacy whole-unit tours.price with NO currency gate, while
  // priceCurrency may be TWD or USD. The counterexample that forced the
  // removal: a USD tour whose legacy row stores 1800 (USD whole units)
  // numerically passes the "NT$50,000 以內" facet bound even though
  // USD 1,800 is far above NT$50,000 — and price_asc/price_desc would rank
  // those raw numbers across currencies the same blind way.
  it("documents the TWD/USD mixed-currency counterexample that forced the removal", () => {
    const usdTourLegacyPriceWholeUnits = 1800; // a USD tour's tours.price
    const ntdFacetBound = 50000; // the removed "NT$50,000 以內" bound
    // This is the exact comparison the server would have run
    // (tours.price <= maxPrice) — currency-blind, so the USD tour slips
    // under the NT$ threshold. No safe facet can be built on this column.
    expect(usdTourLegacyPriceWholeUnits <= ntdFacetBound).toBe(true);
  });

  it("static source ban: no BC production source mentions the price facet or price sorts", () => {
    for (const file of BC_SOURCE_FILES) {
      const src = readBcSource(file);
      for (const banned of [
        "minPrice",
        "maxPrice",
        "price_asc",
        "price_desc",
        "PRICE_PRESETS",
      ]) {
        expect(src, `${file} must not contain ${banned}`).not.toContain(banned);
      }
    }
  });

  it("the UI no longer offers the facet: its i18n copy is gone from BOTH dictionaries", () => {
    for (const key of [
      "bcPreview.tours.filterPrice",
      "bcPreview.tours.priceAny",
      "bcPreview.tours.priceUnder50K",
      "bcPreview.tours.price50K_100K",
      "bcPreview.tours.price100K_150K",
      "bcPreview.tours.price150KPlus",
      "bcPreview.tours.sortPriceAsc",
      "bcPreview.tours.sortPriceDesc",
    ]) {
      expect(resolve(zhTW, key), `${key} must be removed from zh-TW`).toBeUndefined();
      expect(resolve(en, key), `${key} must be removed from en`).toBeUndefined();
    }
    // The remaining sort copy is currency-safe only.
    for (const key of [
      "bcPreview.tours.sortPopular",
      "bcPreview.tours.sortDaysAsc",
      "bcPreview.tours.sortDaysDesc",
    ]) {
      expectKeyInBothLanguages(key);
    }
  });
});

describe("every i18n key the BC components emit exists in BOTH dictionaries (P1-3)", () => {
  it("all statically-referenced literal keys resolve in zh-TW and en — ANY namespace, incl. common.*", () => {
    const emitted = new Set<string>();
    // 1a. EVERY literal key passed to t() in any BC source file, whatever
    //     its namespace (round-2 P2-1: the old bcPreview/storefront-only
    //     regex missed common.loading, used 10× by BC production sources —
    //     deleting it from both dictionaries kept this test green).
    const tCallRe = /\bt\(\s*["']([A-Za-z0-9_][A-Za-z0-9_.]*)["']/g;
    // 1b. Namespaced string literals outside direct t() calls (key arrays,
    //     preset labelKey fields, titleKey/copyKey props — incl. the meal
    //     labels bcPreview.itinerary.breakfast/lunch/dinner that P1-3
    //     caught).
    const literalRe = /["'](bcPreview\.[A-Za-z0-9_.]+|storefront\.availability\.[a-z]+)["']/g;
    for (const file of BC_SOURCE_FILES) {
      const src = readBcSource(file);
      for (const match of src.matchAll(tCallRe)) emitted.add(match[1]);
      for (const match of src.matchAll(literalRe)) emitted.add(match[1]);
    }
    // The scan must really be catching cross-namespace keys: common.loading
    // is emitted by BC production sources today.
    expect(emitted.has("common.loading")).toBe(true);
    // 2. Every key the pure mappers can emit (dynamic template construction).
    for (const bucket of BC_BUCKETS) emitted.add(bucketLabelKey(bucket));
    for (const payee of [
      "airline", "government", "guide_and_driver", "leader_and_driver",
      "restaurant_or_traveler_choice", "packgo_or_hotel", "local_supplier",
      "ticket_supplier", "other", "mystery",
    ]) emitted.add(payeeLabelKey(payee));
    for (const timing of ["before_departure", "during_trip", "if_selected", "mystery"])
      emitted.add(timingLabelKey(timing));
    for (const unit of ["per_person", "per_booking"]) emitted.add(feeUnitLabelKey(unit));
    for (const meal of ["self", "included", "included_unconfirmed", "in_flight", "pending", "mystery"])
      emitted.add(mealStatusLabelKey(meal));
    for (const movement of ["estimated", "confirmed", "pending", "mystery"])
      emitted.add(movementStatusLabelKey(movement));
    for (const source of [
      "supplier_confirmed", "confirmed", "supplier_quote", "source_document",
      "demo_estimate", null, undefined,
    ] as const)
      emitted.add(sourceStatusLabelKey(source));
    for (const category of FEE_CATEGORY_ORDER) {
      emitted.add(feeCategoryTitleKey(category));
      emitted.add(feeCategoryNoteKey(category));
    }
    emitted.add(stayLabel({ propertyStatus: "not_applicable", rating: null }).key);
    emitted.add(stayLabel({ propertyStatus: "proposed_or_equivalent", rating: null }).key);
    emitted.add(
      stayLabel({
        propertyStatus: "x",
        rating: { value: 4, sourceStatus: "verified" },
      }).key,
    );
    emitted.add(
      stayLabel({
        propertyStatus: "x",
        rating: { value: 4, sourceStatus: "claim" },
      }).key,
    );

    expect(emitted.size).toBeGreaterThan(80);
    expect(emitted.has("bcPreview.itinerary.breakfast")).toBe(true);
    expect(emitted.has("bcPreview.itinerary.lunch")).toBe(true);
    expect(emitted.has("bcPreview.itinerary.dinner")).toBe(true);
    for (const key of emitted) {
      expectKeyInBothLanguages(key);
    }
  });
});

describe("BC shelf card assembly — safe surface only (P0-1/P0-3)", () => {
  it("toBcShelfTour keeps ONLY the lean allow-listed fields", () => {
    const wireRow = {
      id: 7,
      title: "馬德里五日",
      destinationCountry: "西班牙",
      destinationCity: "馬德里",
      duration: 5,
      nights: 4,
      heroImage: "https://img.example/hero.jpg",
      // extra wire fields a card must NOT keep:
      price: 64000,
      priceCurrency: "TWD",
      costExplanation: { included: ["機票不含在團費"], excluded: [] },
      featured: true,
      status: "active",
      departureCity: "台北",
    } as never;
    const shelf = toBcShelfTour(wireRow);
    expect(shelf).toEqual({
      id: 7,
      title: "馬德里五日",
      destinationCountry: "西班牙",
      destinationCity: "馬德里",
      duration: 5,
      nights: 4,
      heroImage: "https://img.example/hero.jpg",
    });
    expect(Object.keys(shelf)).not.toContain("price");
    expect(Object.keys(shelf)).not.toContain("priceCurrency");
    expect(Object.keys(shelf)).not.toContain("costExplanation");
  });

  it("toBcCardDepartureFacts: error / loading / none / scheduled are four distinct states", () => {
    expect(
      toBcCardDepartureFacts({ isLoading: false, isError: true, data: undefined }),
    ).toEqual({ state: "error" });
    expect(
      toBcCardDepartureFacts({ isLoading: true, isError: false, data: undefined }),
    ).toEqual({ state: "loading" });
    expect(
      toBcCardDepartureFacts({ isLoading: false, isError: false, data: [] }),
    ).toEqual({ state: "none" });
    const facts = toBcCardDepartureFacts({
      isLoading: false,
      isError: false,
      data: [
        {
          departureDate: "2026-10-04T00:00:00.000Z",
          pricePerPersonMinorUnits: 155000,
          currency: "USD",
        },
        {
          departureDate: "2026-11-01T00:00:00.000Z",
          pricePerPersonMinorUnits: 120000,
          currency: "JPY",
        },
      ],
    });
    // The SOONEST departure wins — never the numerically-cheapest across
    // currencies (JPY 120000 minor units is not comparable to USD 155000).
    expect(facts).toEqual({
      state: "scheduled",
      departureDate: "2026-10-04T00:00:00.000Z",
      priceMinorUnits: 155000,
      currency: "USD",
    });
  });
});

/* ── Round 4: REAL-bilingual fee truth-table gate (round-3 P1-1) ───────
 *
 * Every other render test in this batch mocks t() to echo the KEY, so a
 * contradiction between actual zh-TW/en strings is invisible to them. This
 * gate renders FeeDisclosureSection with the REAL dictionaries — a strict
 * resolver over the actual zh-TW.ts / en.ts objects that THROWS on any
 * missing key (no fallback, no key-echo) — and asserts on the rendered
 * Chinese and English text for the four Codex counterexample cases:
 *   (a) mandatory category + requiredForTrip=false
 *   (b) optional category + requiredForTrip=true (summed into known total)
 *   (c) included required per-booking fee inside the tips category
 *   (d) MIXED included/non-included lines in one category
 * The truth table it closes: no row-level badge may ever sit under
 * category/header/known-total copy that claims the opposite.
 */

const gateLang = vi.hoisted(() => ({ current: "zh-TW" as "zh-TW" | "en" }));

vi.mock("@/contexts/LocaleContext", async () => {
  const { zhTW } = await import("@/i18n/zh-TW");
  const { en } = await import("@/i18n/en");
  const resolveKey = (dict: unknown, key: string): unknown =>
    key.split(".").reduce<any>((acc, part) => acc?.[part], dict);
  return {
    useLocale: () => ({
      language: gateLang.current,
      t: (key: string, params?: Record<string, string | number>) => {
        const dict = gateLang.current === "en" ? en : zhTW;
        let text = resolveKey(dict, key);
        if (typeof text !== "string") {
          // STRICT: the gate never echoes keys and never falls back — a
          // missing translation is a hard failure, not a silent pass.
          throw new Error(`[gate] missing ${gateLang.current} translation: ${key}`);
        }
        if (params) {
          for (const [paramKey, value] of Object.entries(params)) {
            text = (text as string).replace(
              new RegExp(`\\{${paramKey}\\}`, "g"),
              String(value),
            );
          }
        }
        return text;
      },
    }),
  };
});

vi.mock("wouter", () => ({
  Link: ({ href, className, children }: { href: string; className?: string; children?: unknown }) =>
    GateReact.createElement("a", { href, className }, children as never),
}));

import * as GateReact from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof GateReact }).React = GateReact;

const { FeeDisclosureSection } = await import("./BcDetailSections");

const gateDeparture = {
  id: 7,
  departureDate: new Date("2026-10-04T00:00:00Z"),
  returnDate: new Date("2026-10-08T00:00:00Z"),
  pricePerPersonMinorUnits: 155000,
  currency: "USD",
  bucket: "plenty",
} as never;

function gateFee(
  feeId: string,
  amountMinorUnits: number,
  flags: Partial<{
    unit: string;
    currency: string;
    includedInPackgoCharge: boolean;
    requiredForTrip: boolean;
    paymentTiming: string;
  }> = {},
) {
  return {
    feeId,
    labelZh: `${feeId} 中文`,
    labelEn: `${feeId} english`,
    amountMinorUnits,
    currency: "USD",
    unit: "per_person",
    includedInPackgoCharge: false,
    requiredForTrip: true,
    payeeType: "airline",
    paymentTiming: "before_departure",
    sourceStatus: "supplier_quote",
    sortOrder: 0,
    ...flags,
  };
}

function gateDisclosure(feesByCategory: Record<string, unknown[]>) {
  return {
    status: "published",
    contractId: "fees-bilingual-gate-v1",
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

function renderFees(lang: "zh-TW" | "en", feesByCategory: Record<string, unknown[]>): string {
  gateLang.current = lang;
  const html = renderToStaticMarkup(
    GateReact.createElement(FeeDisclosureSection, {
      disclosure: gateDisclosure(feesByCategory),
      departure: gateDeparture,
    }),
  );
  // real strings only — a leaked raw key means the dictionary lookup failed
  expect(html).not.toContain("bcPreview.");
  return html;
}

/** The rendered <li> for one fee row (row badges live inside it). */
function liFor(html: string, feeId: string): string {
  const match = html.match(
    new RegExp(`<li data-fee-id="${feeId}"[^>]*>([\\s\\S]*?)</li>`),
  );
  expect(match, `row ${feeId} must render`).not.toBeNull();
  return match![0];
}

describe("REAL-bilingual fee truth table (a): mandatory category + requiredForTrip=false", () => {
  const feesByCategory = {
    mandatory: [gateFee("optional-insurance", 9900, { requiredForTrip: false })],
  };

  it("zh-TW: the row says 可選 and NO surrounding copy claims 必付/完成旅程所需", () => {
    const html = renderFees("zh-TW", feesByCategory);
    const li = liFor(html, "optional-insurance");
    expect(li).toContain("可選");
    expect(li).not.toContain("必要");
    // the old necessity-claiming category copy is gone from the whole page
    expect(html).not.toContain("必付");
    expect(html).not.toContain("完成旅程所需");
    // neutral descriptive grouping title instead
    expect(html).toContain("機票與稅費");
    // known total = 團費 alone (the 9,900 optional line was NOT summed)…
    expect(html).toContain("US$1,550");
    expect(html).not.toContain("US$1,649");
    // …and the note says exactly that, because an optional row exists
    expect(html).toContain("另付之可選項目未計入此總額");
    expect(html).toContain("團費　加同幣別之每人必要另付項目");
  });

  it("en: the row says Optional and NO surrounding copy claims Mandatory/required-for-trip", () => {
    const html = renderFees("en", feesByCategory);
    const li = liFor(html, "optional-insurance");
    expect(li).toContain("Optional");
    expect(li).not.toContain("Required");
    expect(html).not.toContain("Mandatory costs");
    expect(html).not.toContain("Required for the trip");
    expect(html).toContain("Flights and taxes");
    expect(html).toContain("US$1,550");
    expect(html).not.toContain("US$1,649");
    expect(html).toContain("Separately-paid optional items are not counted in this total");
    expect(html).toContain(
      "Tour fee plus same-currency per-person required separately-paid items",
    );
  });
});

describe("REAL-bilingual fee truth table (b): optional category + requiredForTrip=true", () => {
  const feesByCategory = {
    optional: [gateFee("visa-on-arrival", 9900, { requiredForTrip: true })],
  };

  it("zh-TW: the row says 必要, it IS summed, and no copy claims 可選/不計入總額 over it", () => {
    const html = renderFees("zh-TW", feesByCategory);
    const li = liFor(html, "visa-on-arrival");
    expect(li).toContain("必要");
    expect(li).not.toContain("可選");
    // the old optional-category title claims are gone
    expect(html).not.toContain("可選自費");
    expect(html).not.toContain("不計入總額");
    expect(html).toContain("其他項目");
    // known total really contains the required 9,900: 155000+9900=164900
    expect(html).toContain("US$1,649");
    // NO 可選-excluded note — nothing optional was excluded from this sum
    expect(html).not.toContain("可選項目未計入此總額");
  });

  it("en: the row says Required, it IS summed, and no copy claims Optional/excluded over it", () => {
    const html = renderFees("en", feesByCategory);
    const li = liFor(html, "visa-on-arrival");
    expect(li).toContain("Required");
    expect(li).not.toContain("Optional");
    expect(html).not.toContain("Optional extras");
    expect(html).not.toContain("excluded from total");
    expect(html).toContain("Other items");
    expect(html).toContain("US$1,649");
    expect(html).not.toContain("Separately-paid optional items are not counted in this total");
  });
});

describe("REAL-bilingual fee truth table (c): included required per-booking fee in the tips category", () => {
  const feesByCategory = {
    tips: [
      gateFee("port-charge", 5000, {
        unit: "per_booking",
        includedInPackgoCharge: true,
        requiredForTrip: true,
      }),
    ],
  };

  it("zh-TW: the row says 已含在團費 and NO category note claims 不包含在團費; no per-booking 未計入 reminder", () => {
    const html = renderFees("zh-TW", feesByCategory);
    const li = liFor(html, "port-charge");
    expect(li).toContain("已含在團費　不另收");
    // the old unconditional tips-note inclusion claim is gone
    expect(html).not.toContain("不包含在團費");
    // ALL lines are included ⇒ the category header may say so
    expect(html).toContain("<strong>已含在團費　不另收</strong>");
    // an included fee never triggers the per-booking 未計入 reminder
    expect(html).not.toContain("另有每次訂購之必要費用");
    // known total = 團費 alone (the included 5,000 is not re-added)
    expect(html).toContain("US$1,550");
    expect(html).not.toContain("US$1,600");
  });

  it("en: the row says Included in the tour fee and NO category note claims Not in the tour fee", () => {
    const html = renderFees("en", feesByCategory);
    const li = liFor(html, "port-charge");
    expect(li).toContain("Included in the tour fee　not charged again");
    expect(html).not.toContain("Not in the tour fee");
    expect(html).toContain("<strong>Included in the tour fee　not charged again</strong>");
    expect(html).not.toContain("Required per-booking fees also apply");
    expect(html).toContain("US$1,550");
    expect(html).not.toContain("US$1,600");
  });
});

describe("REAL-bilingual fee truth table (d): MIXED included and non-included lines in one category", () => {
  const feesByCategory = {
    tips: [
      gateFee("driver-gratuity", 8000, {
        includedInPackgoCharge: true,
        requiredForTrip: true,
      }),
      gateFee("hotel-porter-tip", 3000, { requiredForTrip: false }),
    ],
  };

  it("zh-TW: the header claims NEITHER 已含在團費 NOR 未計入 for the whole category — rows carry the truth", () => {
    const html = renderFees("zh-TW", feesByCategory);
    // one included line must NOT make the whole category read 已含在團費
    expect(html).not.toContain("<strong>已含在團費　不另收</strong>");
    expect(html).not.toContain("<strong>未計入</strong>");
    expect(html).toContain("<strong>詳見逐筆標示</strong>");
    // per-row truth stays intact
    expect(liFor(html, "driver-gratuity")).toContain("已含在團費　不另收");
    const optionalLi = liFor(html, "hotel-porter-tip");
    expect(optionalLi).toContain("可選");
    expect(optionalLi).not.toContain("已含在團費");
    // known total = 團費 alone (included already inside; optional excluded)
    expect(html).toContain("US$1,550");
    expect(html).toContain("另付之可選項目未計入此總額");
  });

  it("en: the header claims NEITHER Included NOR Not included for the whole category", () => {
    const html = renderFees("en", feesByCategory);
    expect(html).not.toContain("<strong>Included in the tour fee　not charged again</strong>");
    expect(html).not.toContain("<strong>Not included</strong>");
    expect(html).toContain("<strong>See individual lines</strong>");
    expect(liFor(html, "driver-gratuity")).toContain("Included in the tour fee　not charged again");
    const optionalLi = liFor(html, "hotel-porter-tip");
    expect(optionalLi).toContain("Optional");
    expect(optionalLi).not.toContain("Included in the tour fee");
    expect(html).toContain("US$1,550");
    expect(html).toContain("Separately-paid optional items are not counted in this total");
  });
});

/* ── Round 5: REAL-bilingual mixed/edge gates (round-4 P1-1) ──────────
 *
 * Same strict real-dictionary resolver as the round-4 gates above. Four
 * groups from the Codex round-4 verdict:
 *   (5a) mixed per-booking-required + per-person-optional category → the
 *        header must be the neutral seeLines pointer, never perBookingOnly;
 *   (5b) the page-level basis line is dynamic — mixed wording the moment
 *        any per-booking row exists, plain per-person wording otherwise;
 *   (5c) included-optional + excluded-optional on one page → the optional
 *        exclusion note is scoped to SEPARATELY-PAID optionals and the
 *        known-total label states its precise scope;
 *   (5d) requiredForTrip=true + paymentTiming=if_selected (contradictory
 *        upstream flags) → neutral badge, no 必要/Required, no
 *        選擇後才支付/paid-only-if-selected, amount NOT in the known total.
 */

describe("REAL-bilingual round-5 gate (5a): required per-booking + optional per-person in ONE category", () => {
  const feesByCategory = {
    tips: [
      gateFee("cruise-port-fee", 5000, { unit: "per_booking" }),
      gateFee("porter-tip", 3000, { requiredForTrip: false }),
    ],
  };

  it("zh-TW: header is 詳見逐筆標示 — NOT 另付項目僅每次訂購計費 (a per-person 另付 row exists)", () => {
    const html = renderFees("zh-TW", feesByCategory);
    expect(html).toContain("<strong>詳見逐筆標示</strong>");
    expect(html).not.toContain("另付項目僅每次訂購計費");
    // rows keep their own truth: the per-booking row is 必要, the
    // per-person row is 可選 and renders 每人 US$30
    expect(liFor(html, "cruise-port-fee")).toContain("必要");
    const optionalLi = liFor(html, "porter-tip");
    expect(optionalLi).toContain("可選");
    expect(optionalLi).toContain("每人");
    expect(optionalLi).toContain("US$30");
    // the per-booking listing heading still renders under the neutral header
    expect(html).toContain("每次訂購費用　不計入每人小計");
  });

  it("en: header is See individual lines — NOT Separate charges are per booking only", () => {
    const html = renderFees("en", feesByCategory);
    expect(html).toContain("<strong>See individual lines</strong>");
    expect(html).not.toContain("Separate charges are per booking only");
    expect(liFor(html, "cruise-port-fee")).toContain("Required");
    const optionalLi = liFor(html, "porter-tip");
    expect(optionalLi).toContain("Optional");
    expect(optionalLi).toContain("Per person");
    expect(optionalLi).toContain("US$30");
    expect(html).toContain("Per-booking fees　not in the per-person subtotal");
  });

  it("positive control: with NO not-included per-person row, perBookingOnly may still render (zh + en)", () => {
    const onlyPerBooking = {
      tips: [gateFee("cruise-port-fee", 5000, { unit: "per_booking" })],
    };
    const zh = renderFees("zh-TW", onlyPerBooking);
    expect(zh).toContain("<strong>另付項目僅每次訂購計費　見明細</strong>");
    const en = renderFees("en", onlyPerBooking);
    expect(en).toContain("<strong>Separate charges are per booking only　see lines below</strong>");
  });
});

describe("REAL-bilingual round-5 gate (5b): page basis is dynamic — mixed wording iff any per-booking row exists", () => {
  const withPerBooking = {
    tips: [
      gateFee("cruise-port-fee", 5000, { unit: "per_booking" }),
      gateFee("porter-tip", 3000, { requiredForTrip: false }),
    ],
  };
  const perPersonOnly = {
    mandatory: [gateFee("visa-fee", 12000)],
  };

  it("zh-TW: a per-booking row anywhere → the page never claims ALL amounts are per person", () => {
    const html = renderFees("zh-TW", withPerBooking);
    expect(html).toContain("金額以每人計　另有標示每次訂購之項目");
  });

  it("zh-TW: no per-booking row → the plain per-person basis line", () => {
    const html = renderFees("zh-TW", perPersonOnly);
    expect(html).toContain("金額以每人計");
    expect(html).not.toContain("另有標示每次訂購之項目");
  });

  it("en: a per-booking row anywhere → 'unless marked per booking' wording", () => {
    const html = renderFees("en", withPerBooking);
    expect(html).toContain("Amounts are per person unless marked per booking");
  });

  it("en: no per-booking row → the plain per-person basis line", () => {
    const html = renderFees("en", perPersonOnly);
    expect(html).toContain("Amounts are per person");
    expect(html).not.toContain("unless marked per booking");
  });
});

describe("REAL-bilingual round-5 gate (5c): included-optional + excluded-optional on one page", () => {
  const feesByCategory = {
    optional: [
      gateFee("city-pass", 8000, {
        includedInPackgoCharge: true,
        requiredForTrip: false,
      }),
      gateFee("day-trip", 3000, { requiredForTrip: false }),
    ],
  };

  it("zh-TW: the note is scoped to 另付 optionals; the included-optional row keeps its 已含在團費 badge; label states the precise sum scope", () => {
    const html = renderFees("zh-TW", feesByCategory);
    // scoped note — 另付之可選 only, so the included optional is not covered
    expect(html).toContain("另付之可選項目未計入此總額");
    // the included-optional row still says 已含在團費 per line
    const includedLi = liFor(html, "city-pass");
    expect(includedLi).toContain("已含在團費　不另收");
    expect(includedLi).toContain("可選");
    // known-total label states exactly what it sums
    expect(html).toContain("團費　加同幣別之每人必要另付項目");
    // and the total is 團費 alone — neither optional was added
    expect(html).toContain("US$1,550");
    expect(html).not.toContain("US$1,580");
    expect(html).not.toContain("US$1,630");
    expect(html).not.toContain("US$1,660");
  });

  it("en: note reads Separately-paid optional items…; included-optional row stays Included; label states the precise sum scope", () => {
    const html = renderFees("en", feesByCategory);
    expect(html).toContain("Separately-paid optional items are not counted in this total");
    const includedLi = liFor(html, "city-pass");
    expect(includedLi).toContain("Included in the tour fee　not charged again");
    expect(includedLi).toContain("Optional");
    expect(html).toContain(
      "Tour fee plus same-currency per-person required separately-paid items",
    );
    expect(html).toContain("US$1,550");
    expect(html).not.toContain("US$1,580");
    expect(html).not.toContain("US$1,630");
    expect(html).not.toContain("US$1,660");
  });
});

describe("REAL-bilingual round-5 gate (5d): requiredForTrip=true + paymentTiming=if_selected fails NEUTRAL", () => {
  const feesByCategory = {
    mandatory: [gateFee("heli-excursion", 9900, { paymentTiming: "if_selected" })],
  };

  it("zh-TW: the row shows the neutral 收費條件待確認 badge — never 必要 and never 選擇後才確認與支付 — and is NOT summed", () => {
    const html = renderFees("zh-TW", feesByCategory);
    const li = liFor(html, "heli-excursion");
    expect(li).toContain('data-flag-conflict="true"');
    expect(li).toContain("收費條件待確認");
    expect(li).not.toContain("必要");
    expect(li).not.toContain("選擇後才確認與支付");
    // the amount is listed on the row but NOT trusted into the known total
    expect(li).toContain("US$99");
    expect(html).toContain("US$1,550");
    expect(html).not.toContain("US$1,649");
    // no header claims necessity for it either — neutral pointer
    expect(html).toContain("<strong>詳見逐筆標示</strong>");
  });

  it("en: the row shows Charge terms to be confirmed — never Required and never paid only if selected — and is NOT summed", () => {
    const html = renderFees("en", feesByCategory);
    const li = liFor(html, "heli-excursion");
    expect(li).toContain('data-flag-conflict="true"');
    expect(li).toContain("Charge terms to be confirmed");
    expect(li).not.toContain("Required");
    expect(li).not.toContain("paid only if selected");
    expect(li).toContain("US$99");
    expect(html).toContain("US$1,550");
    expect(html).not.toContain("US$1,649");
    expect(html).toContain("<strong>See individual lines</strong>");
  });
});
