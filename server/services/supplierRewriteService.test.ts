/**
 * Unit tests for supplierRewriteService — the production fix for supplier
 * draft tours being destroyed by a re-scrape + regenerate rewrite.
 *
 * Load-bearing invariants under test:
 *   - FACTS (price / priceCurrency / departures / destinationCountry /
 *     destinationCity / duration) are NEVER in any updateTour payload — they
 *     are preserved exactly as imported, never regenerated.
 *   - PROSE (title / description / hotels / meals / itinerary / …) IS updated.
 *   - A draft with 0 departures or price<=0 returns success:false WITHOUT
 *     calling any agent (those are facts; their absence means it's not a
 *     healthy supplier draft to polish).
 *   - reject verdict → status='inactive' (NEVER deleted — losing real
 *     departures is the bug being fixed); approved → 'active'.
 *
 * All external deps (DB, the 3 prose agents, calibration) are mocked — no LLM
 * calls, no DB connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all external dependencies ───────────────────────────────────────────
vi.mock("../db", () => ({
  getTourById: vi.fn(),
  getTourDepartures: vi.fn(),
  updateTour: vi.fn(),
}));

const mockContentExecute = vi.fn();
const mockDetailsExecute = vi.fn();
const mockItineraryExecute = vi.fn();

vi.mock("../agents/contentAnalyzerAgent", () => ({
  ContentAnalyzerAgent: class {
    execute = mockContentExecute;
  },
}));

vi.mock("../agents/_subskills/details/detailsSkill", () => ({
  getDetailsSkill: () => ({ executeAllCombined: mockDetailsExecute }),
}));

vi.mock("../agents/itineraryUnifiedAgent", () => ({
  ItineraryUnifiedAgent: class {
    execute = mockItineraryExecute;
  },
}));

vi.mock("../agents/calibrationAgent", () => ({
  calibrateTour: vi.fn(),
}));

const mockAddTranslationJob = vi.fn();
vi.mock("../queue", () => ({
  addTourTranslationJob: (...args: any[]) => mockAddTranslationJob(...args),
}));

import { getTourById, getTourDepartures, updateTour } from "../db";
import { calibrateTour } from "../agents/calibrationAgent";
import {
  rewriteSupplierTourInPlace,
  buildRawDataFromDraft,
} from "./supplierRewriteService";

const mockGetTourById = vi.mocked(getTourById);
const mockGetTourDepartures = vi.mocked(getTourDepartures);
const mockUpdateTour = vi.mocked(updateTour);
const mockCalibrateTour = vi.mocked(calibrateTour);

// A healthy UV-imported draft: real price + real itinerary blob
// (NormalizedItinerary shape) + facts populated.
const HEALTHY_DRAFT = {
  id: 42,
  title: "美西大環線 8 日",
  description: "", // empty until rewrite
  productCode: "P00002255",
  destinationCountry: "美國",
  destinationCity: "舊金山",
  departureCity: "Los Angeles",
  duration: 8,
  nights: 7,
  price: 598,
  priceCurrency: "USD",
  status: "draft",
  sourceUrl: "https://uvbookings.toursbms.com/en/product/detail/P00002255",
  highlights: null,
  // NormalizedItinerary blob (what UV import stores in dailyItinerary)
  dailyItinerary: JSON.stringify({
    totalDays: 2,
    days: [
      {
        dayNumber: 1,
        title: "舊金山 - 薩克拉門托 - Elko",
        attractions: [{ name: "舊金山" }, { name: "薩克拉門托" }, { name: "Elko" }],
        hotels: [{ name: "Elko Holiday Inn", type: "未指定" }],
        meals: { breakfast: "", lunch: "", dinner: "" },
      },
      {
        dayNumber: 2,
        title: "Elko - 鹽湖城",
        attractions: [{ name: "Elko" }, { name: "鹽湖城" }],
        hotels: [{ name: "Salt Lake City Marriott", type: "未指定" }],
        meals: { breakfast: "", lunch: "", dinner: "" },
      },
    ],
  }),
};

// Good prose agent outputs (success path).
const GOOD_CONTENT = {
  success: true,
  data: {
    poeticTitle: "金色西岸的曠野詩篇",
    poeticSubtitle: "穿越荒原與鹽湖的壯遊",
    title: "美西經典大環線：舊金山到鹽湖城的曠野巡禮",
    description: "從舊金山出發，深入內華達曠野，沿途品味薩克拉門托的歷史與鹽湖城的壯麗。",
    heroSubtitle: "穿越美西曠野的八日壯遊",
    highlights: ["舊金山金門大橋", "薩克拉門托舊城", "鹽湖城摩門聖殿廣場"],
    keyFeatures: [{ keyword: "曠野", phrases: ["越嶺尋蹤"], description: "穿越內華達曠野" }],
    poeticContent: { intro: "曠野召喚", accommodation: "精選旅宿", dining: "在地風味", experience: "壯遊體驗", closing: "難忘西岸" },
  },
};

const GOOD_DETAILS = {
  success: true,
  data: {
    meals: [{ name: "舊金山早餐", type: "breakfast", description: "豐盛美式早餐", cuisine: "美式" }],
    hotels: [{ name: "Elko Holiday Inn", stars: "三星級", description: "舒適便利", facilities: ["WiFi"], location: "Elko 市區" }],
    costs: { included: ["住宿", "交通"], excluded: ["小費"], additionalCosts: ["單人房差"], notes: "依供應商報價" },
    notices: { preparation: ["護照效期"], culturalNotes: ["尊重習俗"], healthSafety: ["旅遊保險"], emergency: ["報警 911"] },
  },
};

const GOOD_ITINERARY = {
  success: true,
  data: {
    polishedItineraries: [
      { day: 1, title: "舊金山 → Elko", activities: [{ time: "", title: "金門大橋", description: "舊金山地標……", transportation: "包車", location: "舊金山" }], meals: { breakfast: "", lunch: "", dinner: "" }, accommodation: "Elko Holiday Inn" },
      { day: 2, title: "Elko → 鹽湖城", activities: [{ time: "", title: "摩門聖殿廣場", description: "鹽湖城核心……", transportation: "包車", location: "鹽湖城" }], meals: { breakfast: "", lunch: "", dinner: "" }, accommodation: "Salt Lake City Marriott" },
    ],
    fidelityCheck: { overallScore: 95, transportationMatch: true, hotelMatch: true, activitiesFromSource: 5, activitiesAdded: 0, issues: [] },
    tourType: "GENERAL",
  },
};

// Fields that are FACTS and must never appear in an updateTour payload.
const FACT_FIELDS = [
  "price",
  "priceCurrency",
  "destinationCountry",
  "destinationCity",
  "duration",
  "nights",
  "departures",
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTourById.mockResolvedValue(HEALTHY_DRAFT as any);
  mockGetTourDepartures.mockResolvedValue(
    Array.from({ length: 134 }, (_, i) => ({ id: i + 1, tourId: 42 })) as any
  );
  mockUpdateTour.mockResolvedValue(HEALTHY_DRAFT as any);
  mockContentExecute.mockResolvedValue(GOOD_CONTENT);
  mockDetailsExecute.mockResolvedValue(GOOD_DETAILS);
  mockItineraryExecute.mockResolvedValue(GOOD_ITINERARY);
  mockCalibrateTour.mockResolvedValue({ verdict: "approved", totalScore: 90 } as any);
  mockAddTranslationJob.mockResolvedValue({ id: "translate-job" });
});

// ── buildRawDataFromDraft: shape the prose agents read ───────────────────────

describe("buildRawDataFromDraft", () => {
  it("maps NormalizedItinerary blob → agent rawData shape", () => {
    const raw = buildRawDataFromDraft(HEALTHY_DRAFT);

    // location / duration / pricing / basicInfo paths the agents read
    expect(raw.location.destinationCountry).toBe("美國");
    expect(raw.location.destinationCity).toBe("舊金山");
    expect(raw.location.departureCity).toBe("Los Angeles");
    expect(raw.duration).toEqual({ days: 8, nights: 7 });
    expect(raw.pricing.price).toBe(598);
    expect(raw.pricing.currency).toBe("USD");
    expect(raw.basicInfo.title).toBe("美西大環線 8 日");

    // dailyItinerary mapped: dayNumber→day, attractions→activities(names),
    // hotels[0].name→accommodation
    expect(raw.dailyItinerary).toHaveLength(2);
    expect(raw.dailyItinerary[0]).toMatchObject({
      day: 1,
      title: "舊金山 - 薩克拉門托 - Elko",
      activities: ["舊金山", "薩克拉門托", "Elko"],
      accommodation: "Elko Holiday Inn",
    });
    // itinerary alias also populated (ItineraryUnified reads `itinerary || dailyItinerary`)
    expect(raw.itinerary).toEqual(raw.dailyItinerary);

    // attractions + hotels derived from the days
    expect(raw.attractions.map((a: any) => a.name)).toContain("鹽湖城");
    expect(raw.hotels.map((h: any) => h.name)).toEqual([
      "Elko Holiday Inn",
      "Salt Lake City Marriott",
    ]);

    // highlights seeded from attraction names when none stored on the tour
    expect(raw.highlights).toContain("舊金山");
  });

  it("handles an already-agent-shaped itinerary array (Lion / re-run path)", () => {
    const lionDraft = {
      ...HEALTHY_DRAFT,
      dailyItinerary: JSON.stringify([
        { day: 1, title: "Day 1", activities: ["東京鐵塔", { name: "淺草寺" }], accommodation: "東京希爾頓", meals: { breakfast: "飯店" } },
      ]),
    };
    const raw = buildRawDataFromDraft(lionDraft);
    expect(raw.dailyItinerary).toHaveLength(1);
    expect(raw.dailyItinerary[0].activities).toEqual(["東京鐵塔", "淺草寺"]);
    expect(raw.dailyItinerary[0].accommodation).toBe("東京希爾頓");
  });

  it("tolerates a null / unparseable itinerary blob (empty days)", () => {
    const raw = buildRawDataFromDraft({ ...HEALTHY_DRAFT, dailyItinerary: "not json" });
    expect(raw.dailyItinerary).toEqual([]);
    expect(raw.hotels).toEqual([]);
    expect(raw.attractions).toEqual([]);
  });
});

// ── Guard rails: facts must already exist; never regenerate them ─────────────

describe("rewriteSupplierTourInPlace — guards (facts preserved, not regenerated)", () => {
  it("returns success:false WITHOUT calling agents when 0 departures", async () => {
    mockGetTourDepartures.mockResolvedValueOnce([]);
    const res = await rewriteSupplierTourInPlace(42);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/0 departures/);
    expect(mockContentExecute).not.toHaveBeenCalled();
    expect(mockDetailsExecute).not.toHaveBeenCalled();
    expect(mockItineraryExecute).not.toHaveBeenCalled();
    expect(mockUpdateTour).not.toHaveBeenCalled();
  });

  it("returns success:false WITHOUT calling agents when price<=0", async () => {
    mockGetTourById.mockResolvedValueOnce({ ...HEALTHY_DRAFT, price: 0 } as any);
    const res = await rewriteSupplierTourInPlace(42);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/non-positive price/);
    expect(mockContentExecute).not.toHaveBeenCalled();
    expect(mockUpdateTour).not.toHaveBeenCalled();
  });

  it("returns success:false when the tour does not exist", async () => {
    mockGetTourById.mockResolvedValueOnce(undefined as any);
    const res = await rewriteSupplierTourInPlace(999);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/);
    expect(mockContentExecute).not.toHaveBeenCalled();
  });
});

// ── Happy path: prose updated, facts never touched ───────────────────────────

describe("rewriteSupplierTourInPlace — prose updated, facts preserved", () => {
  it("NEVER includes fact fields in any updateTour payload", async () => {
    await rewriteSupplierTourInPlace(42);

    expect(mockUpdateTour).toHaveBeenCalled();
    for (const call of mockUpdateTour.mock.calls) {
      const payload = call[1] as Record<string, unknown>;
      for (const fact of FACT_FIELDS) {
        expect(payload).not.toHaveProperty(fact);
      }
    }
  });

  it("DOES update the prose fields with agent output", async () => {
    await rewriteSupplierTourInPlace(42);

    // First updateTour call carries the prose payload (second is status-only).
    const prosePayload = mockUpdateTour.mock.calls[0][1] as Record<string, any>;
    expect(prosePayload.title).toBe(GOOD_CONTENT.data.title);
    expect(prosePayload.description).toBe(GOOD_CONTENT.data.description);
    expect(prosePayload.heroSubtitle).toBe(GOOD_CONTENT.data.heroSubtitle);
    expect(prosePayload.poeticTitle).toBe(GOOD_CONTENT.data.poeticTitle);
    // JSON-string columns
    expect(JSON.parse(prosePayload.highlights)).toEqual(GOOD_CONTENT.data.highlights);
    expect(JSON.parse(prosePayload.hotels)).toEqual(GOOD_DETAILS.data.hotels);
    expect(JSON.parse(prosePayload.meals)).toEqual(GOOD_DETAILS.data.meals);
    expect(JSON.parse(prosePayload.costExplanation)).toEqual(GOOD_DETAILS.data.costs);
    expect(JSON.parse(prosePayload.noticeDetailed)).toEqual(GOOD_DETAILS.data.notices);
    expect(JSON.parse(prosePayload.itineraryDetailed)).toEqual(
      GOOD_ITINERARY.data.polishedItineraries
    );
  });

  it("passes the synthetic rawData to all three prose agents", async () => {
    await rewriteSupplierTourInPlace(42);
    expect(mockContentExecute).toHaveBeenCalledTimes(1);
    expect(mockDetailsExecute).toHaveBeenCalledTimes(1);
    expect(mockItineraryExecute).toHaveBeenCalledTimes(1);
    // each agent received a rawData carrying the preserved facts
    const rawArg = mockContentExecute.mock.calls[0][0];
    expect(rawArg.location.destinationCity).toBe("舊金山");
    expect(rawArg.pricing.price).toBe(598);
  });

  it("does NOT overwrite itineraryDetailed when agent produced 0 days", async () => {
    mockItineraryExecute.mockResolvedValueOnce({
      success: true,
      data: { polishedItineraries: [], fidelityCheck: { overallScore: 100, issues: [] }, tourType: "GENERAL" },
    });
    await rewriteSupplierTourInPlace(42);
    const prosePayload = mockUpdateTour.mock.calls[0][1] as Record<string, any>;
    expect(prosePayload).not.toHaveProperty("itineraryDetailed");
  });
});

// ── Calibration verdict → status (never delete on reject) ────────────────────

describe("rewriteSupplierTourInPlace — calibration verdict drives status", () => {
  it("approved verdict → status 'active'", async () => {
    mockCalibrateTour.mockResolvedValueOnce({ verdict: "approved", totalScore: 92 } as any);
    const res = await rewriteSupplierTourInPlace(42);
    expect(res.success).toBe(true);
    expect(res.status).toBe("active");
    const statusPayload = mockUpdateTour.mock.calls.at(-1)![1] as Record<string, any>;
    expect(statusPayload).toEqual({ status: "active" });
  });

  it("review verdict → status 'pending_review'", async () => {
    mockCalibrateTour.mockResolvedValueOnce({ verdict: "review", totalScore: 72 } as any);
    const res = await rewriteSupplierTourInPlace(42);
    expect(res.status).toBe("pending_review");
  });

  it("reject verdict → status 'inactive' (tour NOT deleted, departures preserved)", async () => {
    mockCalibrateTour.mockResolvedValueOnce({ verdict: "rejected", totalScore: 40 } as any);
    const res = await rewriteSupplierTourInPlace(42);

    expect(res.success).toBe(true);
    expect(res.status).toBe("inactive");
    const statusPayload = mockUpdateTour.mock.calls.at(-1)![1] as Record<string, any>;
    expect(statusPayload).toEqual({ status: "inactive" });
    // Crucially: status flip only — nothing in any payload deletes facts.
    for (const call of mockUpdateTour.mock.calls) {
      const payload = call[1] as Record<string, unknown>;
      for (const fact of FACT_FIELDS) {
        expect(payload).not.toHaveProperty(fact);
      }
    }
    // No EN translation queued for a hidden (inactive) tour.
    expect(mockAddTranslationJob).not.toHaveBeenCalled();
  });

  it("queues EN translation for a visible (approved) tour", async () => {
    mockCalibrateTour.mockResolvedValueOnce({ verdict: "approved", totalScore: 90 } as any);
    await rewriteSupplierTourInPlace(42);
    expect(mockAddTranslationJob).toHaveBeenCalledTimes(1);
    expect(mockAddTranslationJob).toHaveBeenCalledWith(
      expect.objectContaining({ tourId: 42, targetLanguages: ["en"], sourceLanguage: "zh-TW" })
    );
  });

  it("calibration throwing falls back to 'pending_review' (rewrite not lost)", async () => {
    mockCalibrateTour.mockRejectedValueOnce(new Error("LLM down"));
    const res = await rewriteSupplierTourInPlace(42);
    expect(res.success).toBe(true);
    expect(res.status).toBe("pending_review");
    // prose was still saved before calibration failed
    const prosePayload = mockUpdateTour.mock.calls[0][1] as Record<string, any>;
    expect(prosePayload.title).toBe(GOOD_CONTENT.data.title);
  });
});
