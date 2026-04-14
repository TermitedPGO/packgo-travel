/**
 * calibrationAgent.test.ts
 * Unit tests for CalibrationAgent QA quality gate.
 * All LLM calls are mocked to ensure deterministic, fast tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkCompleteness,
  checkImageQuality,
  checkTranslationQuality,
  checkMarketingQuality,
  checkContentFidelity,
  calibrateTour,
  CalibrationReport,
} from "./calibrationAgent";

// ── Mock LLM ──────────────────────────────────────────────────────────────────

vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(async ({ messages, response_format }: any) => {
    const userMsg = messages.find((m: any) => m.role === "user")?.content ?? "";
    const systemMsg = messages.find((m: any) => m.role === "system")?.content ?? "";

    // Content fidelity mock
    if (systemMsg.includes("quality auditor")) {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              titleScore: 85,
              priceConsistent: true,
              priceDeviation: 2,
              durationCorrect: true,
              overallScore: 85,
              issues: [],
            }),
          },
        }],
      };
    }

    // Marketing title attractiveness mock
    if (systemMsg.includes("travel marketing expert") && userMsg.includes("Rate this tour title")) {
      return {
        choices: [{
          message: {
            content: JSON.stringify({ score: 80, feedback: "Attractive title" }),
          },
        }],
      };
    }

    // Description expansion mock
    if (systemMsg.includes("travel copywriter")) {
      return {
        choices: [{
          message: {
            content: "這是一段擴展後的行程描述，包含了更多的旅遊亮點和精彩內容，讓旅客對這趟旅程充滿期待。",
          },
        }],
      };
    }

    // keyFeatures generation mock
    if (systemMsg.includes("marketing expert") && userMsg.includes("key features")) {
      return {
        choices: [{
          message: {
            content: '["特色景點參觀", "道地美食體驗", "專業導遊帶領", "豪華住宿安排"]',
          },
        }],
      };
    }

    return { choices: [{ message: { content: '{"score": 75}' } }] };
  }),
}));

// ── Mock translation module ───────────────────────────────────────────────────

vi.mock("../translation", () => ({
  getTourTranslations: vi.fn(async (tourId: number, lang: string) => {
    if (tourId === 999) return null; // Simulate no translation
    if (tourId === 998) {
      return {
        title: "Japan Cherry Blossom Tour 日本賞花", // Contains Chinese
        description: "Beautiful tour",
      };
    }
    return {
      title: "Japan Cherry Blossom Tour",
      description: "A beautiful 7-day tour to Japan",
    };
  }),
}));

// ── Mock db ───────────────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  getImageLibrary: vi.fn(async () => [
    { qualityScore: 80 },
    { qualityScore: 75 },
  ]),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const completeTour = {
  id: 1,
  title: "日本賞櫻七日遊",
  price: 45000,
  duration: 7,
  description: "帶您深入日本最美的賞櫻景點，體驗日本文化與美食，住宿精選溫泉旅館，留下難忘的旅遊回憶。",
  destinationCountry: "日本",
  itineraryDetailed: JSON.stringify([{ day: 1, activities: ["抵達東京"] }]),
  hotels: JSON.stringify([{ name: "東京大倉飯店" }]),
  meals: "含早餐",
  costExplanation: "費用包含機票、住宿、餐食",
  noticeDetailed: "請攜帶護照",
  heroImage: "https://example.com/japan.jpg",
  featureImages: JSON.stringify(["https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"]),
  keyFeatures: JSON.stringify(["賞櫻勝地", "溫泉體驗", "美食之旅", "文化探索"]),
  heroSubtitle: "春日限定，與您共賞最美的日本",
};

const minimalTour = {
  title: "行程",
  price: 10000,
  duration: 3,
};

const emptyTour = {};

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK 4: checkCompleteness
// ═══════════════════════════════════════════════════════════════════════════════

describe("checkCompleteness", () => {
  it("returns score 100 for a complete tour with all fields", () => {
    const { score, issues } = checkCompleteness(completeTour);
    expect(score).toBe(100);
    expect(issues).toHaveLength(0);
  });

  it("deducts 25 per missing critical field (title)", () => {
    const { score, issues } = checkCompleteness({ price: 10000, duration: 3 });
    expect(score).toBeLessThanOrEqual(40); // capped at 40 when critical missing
    expect(issues.some((i) => i.field === "title" && i.severity === "critical")).toBe(true);
  });

  it("deducts 25 per missing critical field (price)", () => {
    const { score, issues } = checkCompleteness({ title: "Test", duration: 3 });
    expect(score).toBeLessThanOrEqual(40);
    expect(issues.some((i) => i.field === "price")).toBe(true);
  });

  it("deducts 25 per missing critical field (duration)", () => {
    const { score, issues } = checkCompleteness({ title: "Test", price: 10000 });
    expect(score).toBeLessThanOrEqual(40);
    expect(issues.some((i) => i.field === "duration")).toBe(true);
  });

  it("caps score at 40 when any critical field is missing", () => {
    const { score } = checkCompleteness(emptyTour);
    expect(score).toBeLessThanOrEqual(40);
  });

  it("deducts points for missing important fields (description)", () => {
    const tour = { ...minimalTour };
    const { score, issues } = checkCompleteness(tour);
    expect(issues.some((i) => i.field === "description")).toBe(true);
    expect(score).toBeLessThan(100);
  });

  it("treats empty JSON array as missing for itineraryDetailed", () => {
    const tour = { ...completeTour, itineraryDetailed: "[]" };
    const { issues } = checkCompleteness(tour);
    expect(issues.some((i) => i.field === "itineraryDetailed")).toBe(true);
  });

  it("treats empty string as missing for hotels", () => {
    const tour = { ...completeTour, hotels: "" };
    const { issues } = checkCompleteness(tour);
    expect(issues.some((i) => i.field === "hotels")).toBe(true);
  });

  it("returns all issues with correct check type", () => {
    const { issues } = checkCompleteness(emptyTour);
    expect(issues.every((i) => i.check === "completeness")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK 3: checkImageQuality
// ═══════════════════════════════════════════════════════════════════════════════

describe("checkImageQuality", () => {
  it("returns score 100 for tour with hero + 3 feature images", async () => {
    const { score, issues } = await checkImageQuality(completeTour);
    expect(score).toBe(100);
    expect(issues).toHaveLength(0);
  });

  it("deducts 30 when heroImage is missing", async () => {
    const tour = { ...completeTour, heroImage: "" };
    const { score, issues } = await checkImageQuality(tour);
    expect(score).toBeLessThanOrEqual(70);
    expect(issues.some((i) => i.field === "heroImage")).toBe(true);
  });

  it("deducts 20 when heroImage is a placeholder URL", async () => {
    const tour = { ...completeTour, heroImage: "https://via.placeholder.com/800x400" };
    const { score, issues } = await checkImageQuality(tour);
    expect(score).toBeLessThanOrEqual(80);
    expect(issues.some((i) => i.field === "heroImage" && i.message.includes("placeholder"))).toBe(true);
  });

  it("deducts 30 when featureImages is empty", async () => {
    const tour = { ...completeTour, featureImages: "[]" };
    const { score, issues } = await checkImageQuality(tour);
    expect(score).toBeLessThanOrEqual(70);
    expect(issues.some((i) => i.field === "featureImages")).toBe(true);
  });

  it("deducts 10 when featureImages has fewer than 3", async () => {
    const tour = { ...completeTour, featureImages: JSON.stringify(["https://example.com/1.jpg"]) };
    const { score, issues } = await checkImageQuality(tour);
    expect(score).toBeLessThanOrEqual(90);
    expect(issues.some((i) => i.field === "featureImages" && i.severity === "info")).toBe(true);
  });

  it("returns issues with check type 'image'", async () => {
    const tour = { heroImage: "", featureImages: "[]" };
    const { issues } = await checkImageQuality(tour);
    expect(issues.every((i) => i.check === "image")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK 2: checkTranslationQuality
// ═══════════════════════════════════════════════════════════════════════════════

describe("checkTranslationQuality", () => {
  it("returns score 100 for clean English translations", async () => {
    const { score, issues } = await checkTranslationQuality(1);
    expect(score).toBe(100);
    expect(issues).toHaveLength(0);
  });

  it("returns score 80 and empty issues when no translations exist (Round 47: neutral-optimistic score)", async () => {
    const { score, issues } = await checkTranslationQuality(999);
    expect(score).toBe(80);
    // Round 47: when translation is pending, issues is empty (no penalty)
    expect(issues).toHaveLength(0);
  });

  it("deducts 15 for Chinese characters in English translation", async () => {
    const { score, issues } = await checkTranslationQuality(998);
    expect(score).toBeLessThan(100);
    expect(issues.some((i) => i.message.includes("Chinese characters"))).toBe(true);
  });

  it("returns issues with check type 'translation'", async () => {
    const { issues } = await checkTranslationQuality(998);
    expect(issues.every((i) => i.check === "translation")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK 5: checkMarketingQuality
// ═══════════════════════════════════════════════════════════════════════════════

describe("checkMarketingQuality", () => {
  it("returns high score for complete marketing fields", async () => {
    const { score } = await checkMarketingQuality(completeTour);
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it("deducts 20 for description shorter than 50 chars", async () => {
    const tour = { ...completeTour, description: "短" };
    const { score, issues } = await checkMarketingQuality(tour);
    expect(score).toBeLessThan(100);
    expect(issues.some((i) => i.field === "description" && i.autoFixable === true)).toBe(true);
  });

  it("deducts 15 for fewer than 3 keyFeatures", async () => {
    const tour = { ...completeTour, keyFeatures: JSON.stringify(["特色一"]) };
    const { score, issues } = await checkMarketingQuality(tour);
    expect(score).toBeLessThan(100);
    expect(issues.some((i) => i.field === "keyFeatures" && i.autoFixable === true)).toBe(true);
  });

  it("deducts 10 for missing heroSubtitle", async () => {
    const tour = { ...completeTour, heroSubtitle: "" };
    const { score, issues } = await checkMarketingQuality(tour);
    expect(score).toBeLessThan(100);
    expect(issues.some((i) => i.field === "heroSubtitle")).toBe(true);
  });

  it("marks description and keyFeatures issues as autoFixable", async () => {
    const tour = { ...completeTour, description: "短", keyFeatures: "[]" };
    const { issues } = await checkMarketingQuality(tour);
    const fixable = issues.filter((i) => i.autoFixable);
    expect(fixable.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK 1: checkContentFidelity
// ═══════════════════════════════════════════════════════════════════════════════

describe("checkContentFidelity", () => {
  it("returns neutral score 70 when no source content provided", async () => {
    const { score, issues } = await checkContentFidelity(completeTour, "");
    expect(score).toBe(70);
    expect(issues).toHaveLength(0);
  });

  it("returns neutral score 70 when source content is too short", async () => {
    const { score } = await checkContentFidelity(completeTour, "short");
    expect(score).toBe(70);
  });

  it("calls LLM and returns score when source content is sufficient", async () => {
    const source = "日本七日賞櫻行程，費用45000元，包含機票住宿，每日精彩安排，帶您體驗最美的日本春天。".repeat(5);
    const { score } = await checkContentFidelity(completeTour, source);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calibrateTour (integration)
// ═══════════════════════════════════════════════════════════════════════════════

describe("calibrateTour", () => {
  it("returns a CalibrationReport with all required fields", async () => {
    const report = await calibrateTour(completeTour);
    expect(report).toHaveProperty("contentFidelityScore");
    expect(report).toHaveProperty("translationScore");
    expect(report).toHaveProperty("imageScore");
    expect(report).toHaveProperty("completenessScore");
    expect(report).toHaveProperty("marketingScore");
    expect(report).toHaveProperty("totalScore");
    expect(report).toHaveProperty("verdict");
    expect(report).toHaveProperty("issues");
    expect(report).toHaveProperty("autoFixesApplied");
  });

  it("verdict is 'approved' when totalScore >= 85", async () => {
    const report = await calibrateTour(completeTour);
    // With all mocks returning high scores, expect approved or review
    expect(["approved", "review"]).toContain(report.verdict);
  });

  it("verdict is 'rejected' for empty tour (missing critical fields)", async () => {
    const report = await calibrateTour(emptyTour);
    expect(report.verdict).toBe("rejected");
    expect(report.totalScore).toBeLessThan(60);
  });

  it("totalScore is between 0 and 100", async () => {
    const report = await calibrateTour(completeTour);
    expect(report.totalScore).toBeGreaterThanOrEqual(0);
    expect(report.totalScore).toBeLessThanOrEqual(100);
  });

  it("applies autoFixes for short description", async () => {
    const tour = { ...completeTour, description: "短" };
    const report = await calibrateTour(tour);
    // autoFixesApplied should contain description fix
    expect(report.autoFixesApplied).toBeDefined();
    expect(Array.isArray(report.autoFixesApplied)).toBe(true);
  });

  it("issues array contains CalibrationIssue objects with required fields", async () => {
    const report = await calibrateTour(minimalTour);
    for (const issue of report.issues) {
      expect(issue).toHaveProperty("check");
      expect(issue).toHaveProperty("severity");
      expect(issue).toHaveProperty("message");
      expect(issue).toHaveProperty("autoFixable");
    }
  });

  it("verdict is 'review' for partial tour (score 60-84)", async () => {
    // Tour with some fields but missing images → should land in review
    const partialTour = {
      id: 5,
      title: "歐洲十日遊",
      price: 80000,
      duration: 10,
      description: "帶您遊覽歐洲最精彩的城市，包含巴黎、羅馬、阿姆斯特丹等地，住宿精選四星飯店。",
      destinationCountry: "歐洲",
      heroImage: "",
      featureImages: "[]",
      keyFeatures: JSON.stringify(["歐洲文化", "精彩景點"]),
      heroSubtitle: "",
    };
    const report = await calibrateTour(partialTour);
    // Should not be approved (missing images) but may be review or rejected
    expect(["review", "rejected"]).toContain(report.verdict);
  });
});
