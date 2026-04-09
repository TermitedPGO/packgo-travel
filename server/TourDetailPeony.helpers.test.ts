import { describe, expect, it } from "vitest";

/**
 * Unit tests for TourDetailPeony helper constants and logic.
 * Tests TRANSPORT_TYPE_EN mapping and getTranslated helper behavior.
 */

// Mirror the TRANSPORT_TYPE_EN const from TourDetailPeony.tsx
const TRANSPORT_TYPE_EN: Record<string, string> = {
  '飛機': 'Flight',
  '火車': 'Train',
  '觀光列車': 'Sightseeing Train',
  '高鐵': 'High Speed Rail',
  '郵輪': 'Cruise',
  '自駕': 'Self-drive',
  '遊覽車': 'Coach',
  '捷運': 'MRT',
  '渡輪': 'Ferry',
  '直升機': 'Helicopter',
};

// Mirror the getTranslated helper logic
function getTranslated(
  field: string,
  fallback: unknown,
  translations: Record<string, unknown> | null,
  language: string
): unknown {
  if (language === 'zh-TW' || !translations) return fallback;
  return translations[field] ?? fallback;
}

describe("TRANSPORT_TYPE_EN", () => {
  it("maps 飛機 to Flight", () => {
    expect(TRANSPORT_TYPE_EN["飛機"]).toBe("Flight");
  });

  it("maps 觀光列車 to Sightseeing Train", () => {
    expect(TRANSPORT_TYPE_EN["觀光列車"]).toBe("Sightseeing Train");
  });

  it("maps 郵輪 to Cruise", () => {
    expect(TRANSPORT_TYPE_EN["郵輪"]).toBe("Cruise");
  });

  it("maps 高鐵 to High Speed Rail", () => {
    expect(TRANSPORT_TYPE_EN["高鐵"]).toBe("High Speed Rail");
  });

  it("maps 遊覽車 to Coach", () => {
    expect(TRANSPORT_TYPE_EN["遊覽車"]).toBe("Coach");
  });

  it("maps 自駕 to Self-drive", () => {
    expect(TRANSPORT_TYPE_EN["自駕"]).toBe("Self-drive");
  });

  it("returns undefined for unknown transport type", () => {
    expect(TRANSPORT_TYPE_EN["未知交通"]).toBeUndefined();
  });

  it("has exactly the expected number of entries", () => {
    expect(Object.keys(TRANSPORT_TYPE_EN).length).toBe(10);
  });
});

describe("getTranslated helper logic", () => {
  const mockTranslations = {
    title: "Hualien Sightseeing Train Tour",
    description: "A beautiful journey through Hualien",
    flights: JSON.stringify({ type: "train", typeName: "Sightseeing Train" }),
  };

  it("returns fallback in zh-TW mode regardless of translations", () => {
    const result = getTranslated("title", "花蓮觀光列車之旅", mockTranslations, "zh-TW");
    expect(result).toBe("花蓮觀光列車之旅");
  });

  it("returns translated value in en mode when available", () => {
    const result = getTranslated("title", "花蓮觀光列車之旅", mockTranslations, "en");
    expect(result).toBe("Hualien Sightseeing Train Tour");
  });

  it("returns fallback in en mode when translation is missing", () => {
    const result = getTranslated("missingField", "原始內容", mockTranslations, "en");
    expect(result).toBe("原始內容");
  });

  it("returns fallback when translations is null", () => {
    const result = getTranslated("title", "花蓮觀光列車之旅", null, "en");
    expect(result).toBe("花蓮觀光列車之旅");
  });

  it("returns translated description in en mode", () => {
    const result = getTranslated("description", "美麗的花蓮之旅", mockTranslations, "en");
    expect(result).toBe("A beautiful journey through Hualien");
  });

  it("handles undefined fallback gracefully", () => {
    const result = getTranslated("title", undefined, mockTranslations, "en");
    expect(result).toBe("Hualien Sightseeing Train Tour");
  });
});
