/**
 * Tests for the 指揮中心 行銷頁 供應商內容 transformer (P3-v2).
 *
 * Tests:
 *   - System prompt contains required directives (去掉品牌 / 保留價格 / 繁體)
 *   - JSON parse success → title/body/hashtags complete
 *   - JSON parse failure fallback → no throw, body = raw text
 *   - notes included → user content contains notes
 *   - supplierImageUrl → doesn't crash (v1 text-only)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SYSTEM_PROMPT,
  parseTransformResponse,
} from "./marketingTransformer";

// Mock the LLM module
vi.mock("../../_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

describe("SYSTEM_PROMPT content", () => {
  it("instructs to remove supplier brand names", () => {
    expect(SYSTEM_PROMPT).toContain("去掉供應商品牌名");
    expect(SYSTEM_PROMPT).toContain("纵横海鸥");
    expect(SYSTEM_PROMPT).toContain("途風");
  });

  it("instructs to keep original prices", () => {
    expect(SYSTEM_PROMPT).toContain("保留原始價格");
    expect(SYSTEM_PROMPT).toContain("起");
  });

  it("instructs traditional Chinese output", () => {
    expect(SYSTEM_PROMPT).toContain("繁體中文");
  });

  it("requests JSON response format", () => {
    expect(SYSTEM_PROMPT).toContain('"title"');
    expect(SYSTEM_PROMPT).toContain('"body"');
    expect(SYSTEM_PROMPT).toContain('"hashtags"');
  });
});

describe("parseTransformResponse", () => {
  it("parses valid JSON → complete TransformResult", () => {
    const json = JSON.stringify({
      title: "歐洲精品小團三條路線",
      body: "全程四星酒店...",
      extractedTourCode: "EU-ROMROM5S",
      extractedPrice: "$1,890 起",
      hashtags: ["歐洲旅遊", "小團", "PACKGO"],
    });
    const result = parseTransformResponse(json);
    expect(result.title).toBe("歐洲精品小團三條路線");
    expect(result.body).toBe("全程四星酒店...");
    expect(result.extractedTourCode).toBe("EU-ROMROM5S");
    expect(result.extractedPrice).toBe("$1,890 起");
    expect(result.hashtags).toEqual(["歐洲旅遊", "小團", "PACKGO"]);
  });

  it("parses JSON inside markdown code fence", () => {
    const raw = '```json\n{"title":"Test","body":"Content","hashtags":["a"]}\n```';
    const result = parseTransformResponse(raw);
    expect(result.title).toBe("Test");
    expect(result.body).toBe("Content");
    expect(result.hashtags).toEqual(["a"]);
  });

  it("fallback when JSON is invalid → body = raw text, no throw", () => {
    const raw = "This is not JSON at all, just some text the LLM returned.";
    const result = parseTransformResponse(raw);
    expect(result.title).toBe("供應商內容轉換");
    expect(result.body).toBe(raw);
    expect(result.hashtags).toEqual([]);
  });

  it("handles null extractedTourCode/extractedPrice gracefully", () => {
    const json = JSON.stringify({
      title: "Title",
      body: "Body text",
      extractedTourCode: null,
      extractedPrice: null,
      hashtags: [],
    });
    const result = parseTransformResponse(json);
    expect(result.extractedTourCode).toBeUndefined();
    expect(result.extractedPrice).toBeUndefined();
  });
});

describe("transformSupplierContent", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls invokeLLM with Haiku model and includes notes in user content", async () => {
    const mockInvokeLLM = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "美西5天自駕",
              body: "行程內容...",
              extractedTourCode: "US-LAX5D",
              extractedPrice: "$999 起",
              hashtags: ["美西"],
            }),
          },
        },
      ],
    });

    vi.doMock("../../_core/llm", () => ({ invokeLLM: mockInvokeLLM }));
    const { transformSupplierContent } = await import("./marketingTransformer");

    const result = await transformSupplierContent({
      supplierText: "纵横海鸥 美西5天 $999起",
      notes: "強調小團",
      platform: "xiaohongshu",
    });

    expect(mockInvokeLLM).toHaveBeenCalledTimes(1);
    const call = mockInvokeLLM.mock.calls[0][0];
    expect(call.model).toContain("haiku");
    // User content should contain the supplier text + notes
    expect(call.messages[1].content).toContain("纵横海鸥 美西5天 $999起");
    expect(call.messages[1].content).toContain("強調小團");
    expect(result.title).toBe("美西5天自駕");
    expect(result.hashtags).toEqual(["美西"]);
  });

  it("does not crash when supplierImageUrl is provided (v1 text-only)", async () => {
    const mockInvokeLLM = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "Title",
              body: "Body",
              hashtags: [],
            }),
          },
        },
      ],
    });

    vi.doMock("../../_core/llm", () => ({ invokeLLM: mockInvokeLLM }));
    const { transformSupplierContent } = await import("./marketingTransformer");

    const result = await transformSupplierContent({
      supplierText: "Some supplier text",
      supplierImageUrl: "https://r2.example.com/poster.jpg",
    });

    expect(result.title).toBe("Title");
    expect(result.body).toBe("Body");
  });
});
