/**
 * Unit tests for buildFAQSchema (client/src/components/SEO.tsx). Pure function,
 * no React render — guards the on-page-parity contract: only real, non-empty
 * Q&A is emitted, and an all-empty input produces null (never an empty,
 * audit-failing FAQPage).
 */
import { describe, it, expect } from "vitest";
import { buildFAQSchema } from "@/components/SEO";

describe("buildFAQSchema", () => {
  it("returns null when there are no items", () => {
    expect(buildFAQSchema([])).toBeNull();
  });

  it("returns null when every answer is empty/whitespace (tour with no notices)", () => {
    expect(
      buildFAQSchema([
        { question: "行前準備", answer: "" },
        { question: "緊急聯絡", answer: "   " },
      ]),
    ).toBeNull();
  });

  it("emits a FAQPage with only the populated items", () => {
    const schema = buildFAQSchema([
      { question: "行前準備", answer: "請攜帶護照\n建議帶轉接頭" },
      { question: "健康提醒", answer: "" }, // dropped — empty answer
      { question: "緊急聯絡", answer: "當地導遊 24h 專線" },
    ]) as any;

    expect(schema["@type"]).toBe("FAQPage");
    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema.mainEntity).toHaveLength(2); // health dropped
    expect(schema.mainEntity[0]).toEqual({
      "@type": "Question",
      name: "行前準備",
      acceptedAnswer: { "@type": "Answer", text: "請攜帶護照\n建議帶轉接頭" },
    });
    expect(schema.mainEntity[1].name).toBe("緊急聯絡");
  });

  it("trims surrounding whitespace on question and answer", () => {
    const schema = buildFAQSchema([
      { question: "  Documents  ", answer: "  Bring your passport.  " },
    ]) as any;
    expect(schema.mainEntity[0].name).toBe("Documents");
    expect(schema.mainEntity[0].acceptedAnswer.text).toBe("Bring your passport.");
  });

  it("drops items missing a question even if they have an answer", () => {
    expect(
      buildFAQSchema([{ question: "", answer: "orphan answer with no question" }]),
    ).toBeNull();
  });
});
