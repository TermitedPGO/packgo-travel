/**
 * hydration.ts tests — pure-function transformations from parsed supplier
 * detail → tour column values.
 */

import { describe, it, expect } from "vitest";
import { hydrateTourFromParsed, safeParseJson } from "./hydration";
import type {
  NormalizedItinerary,
  NormalizedPriceTerms,
  NormalizedNotices,
  NormalizedOptional,
  NormalizedTourInfo,
} from "./types";

// Real-world Lion shape based on actual prod data (Kenya 8-day safari)
const kenyaItinerary: NormalizedItinerary = {
  totalDays: 8,
  days: [
    {
      dayNumber: 1,
      title: "台北 Taipei 香港 Hong Kong 杜哈Doha",
      attractions: [],
      hotels: [{ name: "夜宿機上", type: "未指定" }],
      meals: { breakfast: false, lunch: false, dinner: "機上簡餐" },
      transportation: "去程: 國泰航空 13:20",
    },
    {
      dayNumber: 2,
      title: "杜哈 奈洛比 索利歐私人保護區 阿布黛爾國家公園",
      attractions: [
        { name: "索利歐私人保護區 Solio Ranch", description: "入內參觀" },
        { name: "阿布黛爾國家公園 Aberdare National Park", description: "入內參觀" },
      ],
      hotels: [{ name: "Treetops Lodge 或 The Ark Lodge 或同級", type: "未指定" }],
      meals: { breakfast: "機上簡餐", lunch: "飯店午餐", dinner: "飯店晚餐" },
    },
    {
      dayNumber: 8,
      title: "杜哈 香港 台北",
      attractions: [],
      hotels: [],
      meals: { breakfast: "機上簡餐", lunch: "機上簡餐", dinner: "機上簡餐" },
      transportation: "回程: 國泰航空 18:15",
    },
  ],
};

const kenyaPriceTerms: NormalizedPriceTerms = {
  included: ["簽證費", "機場稅"],
  excluded: [],
  paymentTerms: "報名時付訂金、出發前 14 天付尾款（依雄獅標準條款）",
  cancellationPolicy: [],
};

const kenyaNotices: NormalizedNotices = {
  visa: "",
  insurance: "肯亞境內均有愛滋病傳染,應避免直接觸碰他人體液與血液",
  baggage: "",
  general: "",
};

const kenyaTourInfo: NormalizedTourInfo = {
  highlights: ["可出發期間: 2026-06-22 ~ 2026-09-05"],
  metadata: { tourIdCount: "1", minDate: "2026-06-22", maxDate: "2026-09-05" },
};

const kenyaOptional: NormalizedOptional = { items: [] };

describe("hydrateTourFromParsed — Lion Kenya safari (real-world)", () => {
  const out = hydrateTourFromParsed({
    itinerary: kenyaItinerary,
    priceTerms: kenyaPriceTerms,
    notices: kenyaNotices,
    optional: kenyaOptional,
    tourInfo: kenyaTourInfo,
    supplierTitle: "肯亞精華8日",
    days: 8,
    destinationCountry: "肯亞",
  });

  it("preserves itinerary as JSON string with all days", () => {
    expect(out.dailyItinerary).toBeDefined();
    const parsed = JSON.parse(out.dailyItinerary!);
    expect(parsed.totalDays).toBe(8);
    expect(parsed.days).toHaveLength(3);
    expect(parsed.days[1].attractions[0].name).toContain("索利歐");
  });

  it("renders human-readable itineraryDetailed text", () => {
    expect(out.itineraryDetailed).toBeDefined();
    expect(out.itineraryDetailed).toContain("Day 1 — 台北");
    expect(out.itineraryDetailed).toContain("Day 2 —");
    expect(out.itineraryDetailed).toContain("Day 8 —");
    expect(out.itineraryDetailed).toContain("景點: 索利歐");
    expect(out.itineraryDetailed).toContain("住宿: Treetops Lodge");
    expect(out.itineraryDetailed).toContain("交通: 去程: 國泰航空 13:20");
    expect(out.itineraryDetailed).toContain("早 機上簡餐");
  });

  it("dedupes hotels across days", () => {
    const hotels = JSON.parse(out.hotels!);
    expect(hotels).toHaveLength(2); // 夜宿機上, Treetops Lodge
    expect(hotels.find((h: any) => h.name.includes("Treetops"))).toBeTruthy();
  });

  it("builds per-day meals array", () => {
    const meals = JSON.parse(out.meals!);
    expect(meals).toHaveLength(3);
    expect(meals[0]).toMatchObject({
      dayNumber: 1,
      breakfast: "自理",
      lunch: "自理",
      dinner: "機上簡餐",
    });
    expect(meals[1].lunch).toBe("飯店午餐");
  });

  it("dedupes attractions and keeps dayNumber link", () => {
    const att = JSON.parse(out.attractions!);
    expect(att).toHaveLength(2);
    expect(att[0]).toMatchObject({
      name: expect.stringContaining("索利歐"),
      dayNumber: 2,
    });
  });

  it("extracts flights from day 1 + last day transportation", () => {
    const flights = JSON.parse(out.flights!);
    expect(flights.type).toBe("FLIGHT");
    expect(flights.outbound.description).toBe("去程: 國泰航空 13:20");
    expect(flights.inbound.description).toBe("回程: 國泰航空 18:15");
  });

  it("builds highlights from tourInfo.highlights", () => {
    const hl = JSON.parse(out.highlights!);
    expect(hl).toHaveLength(1);
    expect(hl[0].title).toContain("2026-06-22");
  });

  it("builds keyFeatures (first 5)", () => {
    const kf = JSON.parse(out.keyFeatures!);
    expect(kf).toHaveLength(1);
    expect(kf[0].keyword).toContain("2026-06-22");
  });

  it("preserves priceTerms as JSON", () => {
    const cost = JSON.parse(out.costExplanation!);
    expect(cost.included).toContain("簽證費");
    expect(cost.paymentTerms).toContain("14 天");
  });

  it("preserves notices when non-empty", () => {
    const nt = JSON.parse(out.noticeDetailed!);
    expect(nt.insurance).toContain("肯亞");
  });

  it("extracts departure window from metadata", () => {
    const dep = JSON.parse(out.extractedDepartures!);
    expect(dep[0]).toEqual({ startDate: "2026-06-22", endDate: "2026-09-05" });
  });

  it("does NOT emit optionalTours when items=[]", () => {
    expect(out.optionalTours).toBeUndefined();
  });

  it("builds description ≥ 50 chars from day titles + highlights", () => {
    expect(out.description).toBeDefined();
    expect(out.description!.length).toBeGreaterThanOrEqual(50);
  });
});

describe("hydrateTourFromParsed — UV-shaped (empty itinerary)", () => {
  const out = hydrateTourFromParsed({
    itinerary: { totalDays: 7, days: [] },
    priceTerms: null,
    notices: null,
    optional: null,
    tourInfo: null,
    supplierTitle: "Mexico Hyatt Ziva Cancun 7d",
    days: 7,
    destinationCountry: "墨西哥",
  });

  it("does NOT emit dailyItinerary when days[] is empty", () => {
    expect(out.dailyItinerary).toBeUndefined();
    expect(out.hotels).toBeUndefined();
    expect(out.meals).toBeUndefined();
    expect(out.attractions).toBeUndefined();
    expect(out.flights).toBeUndefined();
  });

  it("falls back to supplier-title-based description", () => {
    expect(out.description).toBeDefined();
    expect(out.description).toContain("Mexico Hyatt Ziva Cancun");
    expect(out.description).toContain("墨西哥");
  });
});

describe("hydrateTourFromParsed — empty notices block (Lion 'SERVICE: TEL: ...' garbage)", () => {
  const garbageNotices: NormalizedNotices = {
    visa: "",
    insurance: "",
    baggage: "",
    general: "SERVICE: \n\nTEL: \n\nVOLT: \n\nCLOTHE: \n\nHOTEL: \n\nWALK: \n\nQA: \n\nSDGS: ",
  };

  const out = hydrateTourFromParsed({
    itinerary: null,
    notices: garbageNotices,
    supplierTitle: "test",
  });

  it("treats empty-template notices as content (general has whitespace+labels)", () => {
    // The current heuristic checks length>0 — so this DOES emit. We
    // accept that for now; future iteration can strip the placeholders.
    expect(out.noticeDetailed).toBeDefined();
  });
});

describe("hydrateTourFromParsed — partial: only optional add-ons", () => {
  const optional: NormalizedOptional = {
    items: [
      {
        name: "東京迪士尼一日券",
        description: "成人 / 兒童同價",
        price: 9800,
        currency: "JPY",
        minParticipants: 2,
      },
    ],
  };
  const out = hydrateTourFromParsed({ itinerary: null, optional });

  it("emits optionalTours with item details", () => {
    const arr = JSON.parse(out.optionalTours!);
    expect(arr).toHaveLength(1);
    expect(arr[0].name).toBe("東京迪士尼一日券");
    expect(arr[0].price).toBe(9800);
  });

  it("does not emit other fields when only optional is present", () => {
    expect(out.dailyItinerary).toBeUndefined();
    expect(out.hotels).toBeUndefined();
    expect(out.highlights).toBeUndefined();
  });
});

describe("hydrateTourFromParsed — description fallback chain", () => {
  it("uses highlights when long enough", () => {
    const out = hydrateTourFromParsed({
      tourInfo: {
        highlights: [
          "深度走訪日本三大名園:兼六園、後樂園、偕樂園",
          "黑部立山雪壁峽谷,搭乘 6 種交通工具",
          "金澤近江町市場 + 武家屋敷散策",
        ],
        metadata: {},
      },
    });
    expect(out.description).toBeDefined();
    expect(out.description!.length).toBeGreaterThanOrEqual(50);
    expect(out.description).toContain("兼六園");
  });

  it("uses day titles when highlights are too short", () => {
    const out = hydrateTourFromParsed({
      itinerary: {
        totalDays: 3,
        days: [
          { dayNumber: 1, title: "桃園 → 大阪", attractions: [], hotels: [], meals: { breakfast: false, lunch: false, dinner: false } },
          { dayNumber: 2, title: "大阪城 → 道頓堀 → 環球影城", attractions: [], hotels: [], meals: { breakfast: false, lunch: false, dinner: false } },
          { dayNumber: 3, title: "大阪 → 桃園", attractions: [], hotels: [], meals: { breakfast: false, lunch: false, dinner: false } },
        ],
      },
    });
    expect(out.description).toContain("行程涵蓋");
    expect(out.description).toContain("大阪城");
  });
});

describe("safeParseJson", () => {
  it("returns parsed object for valid JSON", () => {
    expect(safeParseJson<{ a: number }>("{\"a\":1}")).toEqual({ a: 1 });
  });
  it("returns null for invalid JSON", () => {
    expect(safeParseJson("{not json")).toBeNull();
  });
  it("returns null for null/empty", () => {
    expect(safeParseJson(null)).toBeNull();
    expect(safeParseJson("")).toBeNull();
    expect(safeParseJson(undefined)).toBeNull();
  });
});
