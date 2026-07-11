/**
 * staging.test — 待上架 tour 候選的純函式測。
 *
 * 驗:完整明細 → 過門檻 + fields 齊;缺明細 → 擋下並回報缺項;
 *     價格 0 / 無未來班期 → 擋下;fields 永不含成本欄。
 */

import { describe, it, expect } from "vitest";
import { buildStagedTour, type MirrorProduct, type MirrorDetail } from "./staging";
import { findCostLeaks } from "./guard";
import type { NormalizedItinerary } from "../supplierSync/types";

const ITINERARY: NormalizedItinerary = {
  totalDays: 2,
  days: [
    {
      dayNumber: 1,
      title: "洛杉磯 → 拉斯維加斯",
      attractions: [
        { name: "古根漢博物館", description: "現代藝術" },
        { name: "巴里斯特拉斯飯店" },
      ],
      hotels: [{ name: "Bellagio", city: "Las Vegas", rating: 5, type: "5星" }],
      meals: { breakfast: false, lunch: "中式合菜", dinner: true },
      transportation: "豪華巴士",
    },
    {
      dayNumber: 2,
      title: "大峽谷國家公園",
      attractions: [{ name: "大峽谷南緣" }],
      hotels: [{ name: "Grand Hotel", type: "4星" }],
      meals: { breakfast: true, lunch: false, dinner: false },
    },
  ],
};

const COMPLETE_PRODUCT: MirrorProduct = {
  externalProductCode: "P00002255",
  title: "美西大峽谷 7 日",
  days: 2,
  destinationCountry: "美國",
  destinationCity: "Las Vegas",
  departureCity: "Los Angeles",
  imageUrl: "https://example.com/img.jpg",
  currency: "USD",
};

const COMPLETE_DETAIL: MirrorDetail = {
  itineraryParsed: JSON.stringify(ITINERARY),
  priceTermsParsed: JSON.stringify({
    included: ["住宿", "門票"],
    excluded: ["小費"],
    paymentTerms: "訂金 $215",
    cancellationPolicy: [],
  }),
  noticesParsed: JSON.stringify({
    visa: "免簽",
    insurance: "",
    baggage: "",
    general: "請帶護照",
  }),
  optionalParsed: JSON.stringify({
    items: [{ name: "直升機", description: "南峽谷", price: 299, currency: "USD" }],
  }),
  tourInfoParsed: null,
};

describe("buildStagedTour", () => {
  it("complete product passes the gate with all customer fields", () => {
    const staged = buildStagedTour(COMPLETE_PRODUCT, COMPLETE_DETAIL, {
      priceRetail: 998,
      currency: "USD",
      futureDepartureCount: 6,
    });

    expect(staged.assessment.ok).toBe(true);
    expect(staged.assessment.missing).toEqual([]);
    expect(staged.productCode).toBe("P00002255");

    // facts + content present
    expect(staged.fields.title).toBe("美西大峽谷 7 日");
    expect(staged.fields.price).toBe(998);
    expect(staged.fields.priceCurrency).toBe("USD");
    expect(staged.fields.duration).toBe(2);
    expect(staged.fields.destinationCountry).toBe("美國");
    expect(typeof staged.fields.itineraryDetailed).toBe("string");
    expect(typeof staged.fields.attractions).toBe("string");
    // hydration dual-writes both itinerary columns
    expect(typeof staged.fields.dailyItinerary).toBe("string");
  });

  it("RED LINE: staged fields pass the cost-leak guard (costExplanation is allowed — it's customer-facing 費用說明)", () => {
    const staged = buildStagedTour(COMPLETE_PRODUCT, COMPLETE_DETAIL, {
      priceRetail: 998,
      currency: "USD",
      futureDepartureCount: 6,
    });
    // The real guard: forbids agentPrice / industryLowestPrice / costPrice /
    // spareSeats — but NOT costExplanation (價格包含/不含, which customers see).
    expect(findCostLeaks(staged.fields)).toEqual([]);
    expect(staged.fields).toHaveProperty("costExplanation");
  });

  it("RED LINE: supplier marketing image URL NEVER reaches customer fields (指揮裁決)", () => {
    const staged = buildStagedTour(COMPLETE_PRODUCT, COMPLETE_DETAIL, {
      priceRetail: 998,
      currency: "USD",
      futureDepartureCount: 6,
    });
    // COMPLETE_PRODUCT.imageUrl = "https://example.com/img.jpg" (a supplier URL).
    // It must NOT appear anywhere in the customer-facing fields object.
    expect(staged.fields).not.toHaveProperty("heroImage");
    expect(staged.fields).not.toHaveProperty("imageUrl");
    expect(JSON.stringify(staged.fields)).not.toContain("example.com");
    // …but it IS retained on the staging-internal field for later reference.
    expect(staged.supplierImageUrl).toBe("https://example.com/img.jpg");
  });

  it("missing itinerary + attractions → blocked, reports both", () => {
    const staged = buildStagedTour(
      COMPLETE_PRODUCT,
      { itineraryParsed: null, priceTermsParsed: null, noticesParsed: null, optionalParsed: null, tourInfoParsed: null },
      { priceRetail: 998, currency: "USD", futureDepartureCount: 6 },
    );
    expect(staged.assessment.ok).toBe(false);
    expect(staged.assessment.missing).toContain("dailyItinerary");
    expect(staged.assessment.missing).toContain("attractions");
  });

  it("price 0 + no future departures → blocked on both", () => {
    const staged = buildStagedTour(COMPLETE_PRODUCT, COMPLETE_DETAIL, {
      priceRetail: 0,
      currency: "USD",
      futureDepartureCount: 0,
    });
    expect(staged.assessment.ok).toBe(false);
    expect(staged.assessment.missing).toContain("retailPrice");
    expect(staged.assessment.missing).toContain("futureDeparture");
  });

  it("garbage parsed JSON degrades gracefully (no throw, blocked on content)", () => {
    const staged = buildStagedTour(
      COMPLETE_PRODUCT,
      { itineraryParsed: "{not json", priceTermsParsed: "", noticesParsed: null, optionalParsed: "[bad", tourInfoParsed: null },
      { priceRetail: 998, currency: "USD", futureDepartureCount: 6 },
    );
    expect(staged.assessment.ok).toBe(false);
    expect(staged.assessment.missing).toContain("dailyItinerary");
  });

  it("missing destinationCountry → blocked", () => {
    const staged = buildStagedTour(
      { ...COMPLETE_PRODUCT, destinationCountry: null },
      COMPLETE_DETAIL,
      { priceRetail: 998, currency: "USD", futureDepartureCount: 6 },
    );
    expect(staged.assessment.ok).toBe(false);
    expect(staged.assessment.missing).toContain("destinationCountry");
  });
});
