/**
 * Unit tests for visionAnalysisService.ts
 * Pure logic tests — invokeLLM is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock invokeLLM ────────────────────────────────────────────────────────────
vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

// Stub Redis cache so each test starts with a miss; otherwise the first test's
// result poisons subsequent ones (all use the same image URL → same cache key).
vi.mock("../redis", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue("OK"),
  },
}));

import { invokeLLM } from "../_core/llm";
import { analyzeImage } from "./visionAnalysisService";

const mockInvokeLLM = vi.mocked(invokeLLM);

// Helper to build a mock LLM response with the given content string
function makeLLMResponse(content: string) {
  return {
    choices: [
      {
        message: { content },
      },
    ],
  };
}

beforeEach(() => {
  mockInvokeLLM.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("analyzeImage", () => {
  it("correctly parses a clean JSON response from LLM", async () => {
    const jsonContent = JSON.stringify({
      description: "A scenic mountain landscape with snow-capped peaks",
      tags: ["mountain", "landscape", "snow", "nature", "travel"],
      contentType: "landscape",
      qualityScore: 85,
      matchKeywords: ["合歡山", "太魯閣"],
    });

    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(jsonContent) as any);

    const result = await analyzeImage("https://example.com/photo.jpg");

    expect(result.description).toBe("A scenic mountain landscape with snow-capped peaks");
    expect(result.tags).toEqual(["mountain", "landscape", "snow", "nature", "travel"]);
    expect(result.contentType).toBe("landscape");
    expect(result.qualityScore).toBe(85);
    expect(result.matchKeywords).toEqual(["合歡山", "太魯閣"]);
  });

  it("extracts JSON from markdown code fence response", async () => {
    const markdownContent = `Here is my analysis:
\`\`\`json
{
  "description": "A luxury hotel lobby with marble floors",
  "tags": ["hotel", "luxury", "interior", "lobby"],
  "contentType": "hotel",
  "qualityScore": 90,
  "matchKeywords": ["晶英酒店"]
}
\`\`\``;

    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(markdownContent) as any);

    const result = await analyzeImage("https://example.com/hotel.jpg");

    expect(result.contentType).toBe("hotel");
    expect(result.qualityScore).toBe(90);
    expect(result.matchKeywords).toEqual(["晶英酒店"]);
  });

  it("extracts JSON from markdown code fence without language tag", async () => {
    const markdownContent = `\`\`\`
{
  "description": "Street food stall",
  "tags": ["food", "street", "taiwan"],
  "contentType": "food",
  "qualityScore": 70,
  "matchKeywords": ["夜市"]
}
\`\`\``;

    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(markdownContent) as any);

    const result = await analyzeImage("https://example.com/food.jpg");

    expect(result.contentType).toBe("food");
    expect(result.description).toBe("Street food stall");
  });

  it("returns default result when LLM returns non-JSON text", async () => {
    mockInvokeLLM.mockResolvedValueOnce(
      makeLLMResponse("I cannot analyze this image.") as any
    );

    const result = await analyzeImage("https://example.com/photo.jpg");

    expect(result.description).toBe("Travel photo");
    expect(result.contentType).toBe("other");
    expect(result.qualityScore).toBe(50);
    expect(result.tags).toEqual(["travel"]);
  });

  it("returns default result when LLM throws an error", async () => {
    mockInvokeLLM.mockRejectedValueOnce(new Error("API timeout"));

    const result = await analyzeImage("https://example.com/photo.jpg");

    expect(result.description).toBe("Travel photo");
    expect(result.contentType).toBe("other");
    expect(result.qualityScore).toBe(50);
  });

  it("clamps qualityScore to 0-100 range", async () => {
    const jsonContent = JSON.stringify({
      description: "Test",
      tags: ["test"],
      contentType: "landscape",
      qualityScore: 150, // out of range
      matchKeywords: [],
    });

    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(jsonContent) as any);

    const result = await analyzeImage("https://example.com/photo.jpg");
    expect(result.qualityScore).toBe(100);
  });

  it("clamps qualityScore below 0 to 0", async () => {
    const jsonContent = JSON.stringify({
      description: "Test",
      tags: ["test"],
      contentType: "landscape",
      qualityScore: -10,
      matchKeywords: [],
    });

    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(jsonContent) as any);

    const result = await analyzeImage("https://example.com/photo.jpg");
    expect(result.qualityScore).toBe(0);
  });

  it("defaults contentType to 'other' for unknown values", async () => {
    const jsonContent = JSON.stringify({
      description: "Test",
      tags: ["test"],
      contentType: "unknown_type",
      qualityScore: 60,
      matchKeywords: [],
    });

    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(jsonContent) as any);

    const result = await analyzeImage("https://example.com/photo.jpg");
    expect(result.contentType).toBe("other");
  });

  it("handles missing optional fields gracefully", async () => {
    const jsonContent = JSON.stringify({
      description: "Partial response",
      // tags, contentType, qualityScore, matchKeywords all missing
    });

    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(jsonContent) as any);

    const result = await analyzeImage("https://example.com/photo.jpg");

    expect(result.description).toBe("Partial response");
    expect(result.tags).toEqual(["travel"]); // default
    expect(result.contentType).toBe("other"); // default
    expect(result.qualityScore).toBe(50); // default
    expect(result.matchKeywords).toEqual([]); // default
  });
});
