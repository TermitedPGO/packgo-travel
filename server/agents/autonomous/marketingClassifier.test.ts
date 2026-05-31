/**
 * Tests for the 指揮中心 行銷頁 risk classifier (P3).
 *
 * Contract:
 *   - hasPrice=true → hard_gate (money-adjacent)
 *   - hasPrice=false → review
 *   - NEVER returns "auto" (v1 marketing policy)
 */

import { describe, it, expect } from "vitest";
import { classifyMarketingRisk } from "./marketingClassifier";

describe("classifyMarketingRisk", () => {
  it("hasPrice=true → hard_gate", () => {
    const result = classifyMarketingRisk({
      contentType: "edm",
      hasPrice: true,
    });
    expect(result.riskLevel).toBe("hard_gate");
    expect(result.reason).toContain("pricing");
  });

  it("hasPrice=false → review", () => {
    const result = classifyMarketingRisk({
      contentType: "xhs_post",
      hasPrice: false,
    });
    expect(result.riskLevel).toBe("review");
  });

  it("never returns auto regardless of content type", () => {
    const types = [
      "xhs_post",
      "wechat_article",
      "edm",
      "poster_copy",
      "social_post",
      "other",
    ];
    for (const contentType of types) {
      const r1 = classifyMarketingRisk({ contentType, hasPrice: false });
      const r2 = classifyMarketingRisk({ contentType, hasPrice: true });
      expect(r1.riskLevel).not.toBe("auto");
      expect(r2.riskLevel).not.toBe("auto");
    }
  });

  it("all content types without price default to review", () => {
    const types = [
      "xhs_post",
      "wechat_article",
      "edm",
      "poster_copy",
      "social_post",
      "other",
    ];
    for (const contentType of types) {
      const r = classifyMarketingRisk({ contentType, hasPrice: false });
      expect(r.riskLevel).toBe("review");
    }
  });
});
