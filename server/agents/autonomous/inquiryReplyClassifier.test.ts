/**
 * Tests for the 指揮中心 客服頁 risk classifier (P1-c).
 *
 * design.md §3 P1-c contract (品質公平不可犧牲):
 *   - 醫療 / 緊急 / 政治 / 客訴 / 退款 keyword → hard_gate
 *   - classification ∈ {complaint, refund_request} → hard_gate
 *   - urgency === "critical" → hard_gate
 *   - plain new_inquiry / general_info → review
 *   - NEVER "auto" in the cs lane (v1).
 */

import { describe, it, expect } from "vitest";
import {
  classifyInquiryRisk,
  matchSensitiveCategory,
} from "./inquiryReplyClassifier";

// A neutral baseline that on its own classifies as "review".
const NEUTRAL = {
  classification: "new_inquiry" as const,
  urgency: "normal" as const,
};

describe("classifyInquiryRisk — sensitive keywords → hard_gate", () => {
  // One representative zh + one en term per category Jeff named.
  const cases: Array<[string, string]> = [
    ["醫療 (medical zh)", "我在旅途中受傷需要看醫療"],
    ["medical (en)", "I need to find a hospital, this is a medical issue"],
    ["緊急 (emergency zh)", "情況很緊急，請馬上回覆"],
    ["urgent (en)", "This is urgent, please respond ASAP"],
    ["政治 (political zh)", "當地有政治抗議活動會影響行程嗎"],
    ["protest (en)", "Is there a protest near the hotel?"],
    ["客訴 (complaint zh)", "我要投訴導遊的服務態度"],
    ["complaint (en)", "I want to file a complaint about the tour"],
    ["退款 (refund zh)", "請問可以退款嗎？我要退費"],
    ["refund (en)", "I would like a refund for my booking"],
  ];

  it.each(cases)("%s → hard_gate", (_label, text) => {
    const res = classifyInquiryRisk({ ...NEUTRAL, inquiryText: text });
    expect(res.riskLevel).toBe("hard_gate");
    expect(res.matchedCategory).not.toBeNull();
  });

  it("matchSensitiveCategory pinpoints the right group", () => {
    expect(matchSensitiveCategory("我要退費")).toBe("refund");
    expect(matchSensitiveCategory("file a complaint")).toBe("complaint");
    expect(matchSensitiveCategory("受傷住院")).toBe("medical");
    expect(matchSensitiveCategory("just asking about dates")).toBeNull();
  });
});

describe("classifyInquiryRisk — classification → hard_gate", () => {
  it("complaint → hard_gate even with neutral text", () => {
    const res = classifyInquiryRisk({
      inquiryText: "hello, a quick question about my trip",
      classification: "complaint",
      urgency: "normal",
    });
    expect(res.riskLevel).toBe("hard_gate");
    // No keyword matched — driven by classification.
    expect(res.matchedCategory).toBeNull();
    expect(res.reason).toContain("complaint");
  });

  it("refund_request → hard_gate even with neutral text", () => {
    const res = classifyInquiryRisk({
      inquiryText: "hi there",
      classification: "refund_request",
      urgency: "low",
    });
    expect(res.riskLevel).toBe("hard_gate");
    expect(res.reason).toContain("refund_request");
  });
});

describe("classifyInquiryRisk — critical urgency → hard_gate", () => {
  it("critical urgency → hard_gate even for a plain new_inquiry", () => {
    const res = classifyInquiryRisk({
      inquiryText: "please help me with my itinerary",
      classification: "new_inquiry",
      urgency: "critical",
    });
    expect(res.riskLevel).toBe("hard_gate");
    expect(res.reason).toContain("critical");
  });
});

describe("classifyInquiryRisk — benign → review (never auto)", () => {
  it("plain new_inquiry → review", () => {
    const res = classifyInquiryRisk({
      inquiryText: "I'd like to know about your Hawaii tours in August",
      classification: "new_inquiry",
      urgency: "normal",
    });
    expect(res.riskLevel).toBe("review");
    expect(res.matchedCategory).toBeNull();
  });

  it("general_info → review", () => {
    const res = classifyInquiryRisk({
      inquiryText: "What time does the office open?",
      classification: "general_info",
      urgency: "low",
    });
    expect(res.riskLevel).toBe("review");
  });

  it("NEVER returns 'auto' across the matrix", () => {
    const classifications = [
      "new_inquiry",
      "booking_question",
      "general_info",
      "quote_request",
      "complaint",
      "refund_request",
    ] as const;
    const urgencies = ["low", "normal", "high", "critical"] as const;
    for (const classification of classifications) {
      for (const urgency of urgencies) {
        const res = classifyInquiryRisk({
          inquiryText: "neutral text",
          classification,
          urgency,
        });
        // The cs lane is review/hard_gate only — auto is impossible in v1.
        expect(res.riskLevel === "auto").toBe(false);
        expect(["review", "hard_gate"]).toContain(res.riskLevel);
      }
    }
  });
});
