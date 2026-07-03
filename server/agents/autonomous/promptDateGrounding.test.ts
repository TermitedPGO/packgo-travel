/**
 * 摘要日期 grounding(2026-07-02)— prompt 必須先告訴模型「今天是幾號」。
 *
 * 真實案例:2026-07-02 收到的客人來信講「12/19-12/26」(沒寫年份),inbound
 * interaction 的 contentSummary(= InquiryAgent 的 intent)寫成
 * 「2024/12/19-12/26」— 模型編了一個過去年份。修法:buildSystemPrompt 開頭
 * 注入美西今天日期 + 「沒寫年份就推最近的未來年份」指示(intent /
 * extractedRequirements.dates / draftReply 全部適用)。
 *
 * 同一輪也在 customerAiSummary(buildSummaryUserPrompt,測試在它自己的
 * test 檔)與 analyzeOrderAiUnderstanding 的 user prompt(inline 組字串,
 * string-level)加了同款 grounding。
 */
import { describe, it, expect } from "vitest";
import { buildSystemPrompt, DEFAULT_INQUIRY_POLICY } from "./inquiryAgent";

const render = (today?: string) =>
  today === undefined
    ? buildSystemPrompt(JSON.stringify(DEFAULT_INQUIRY_POLICY), "Jeff Hsieh")
    : buildSystemPrompt(JSON.stringify(DEFAULT_INQUIRY_POLICY), "Jeff Hsieh", today);

describe("inquiryAgent buildSystemPrompt — 今天日期 grounding", () => {
  it("注入的今天日期出現在 prompt 裡", () => {
    const p = render("2026-07-02");
    expect(p).toContain("【今天日期】2026-07-02");
  });

  it("帶「推最近的未來年份、不要編過去年份」指示,並涵蓋 intent/dates/draft", () => {
    const p = render("2026-07-02");
    expect(p).toContain("最近的未來");
    expect(p).toContain("不要編成過去的年份");
    expect(p).toContain("extractedRequirements.dates");
    expect(p).toContain("intent");
    expect(p).toContain("draftReply");
  });

  it("today 不傳時用美西當日(YYYY-MM-DD 形狀),prompt 其餘不變", () => {
    const p = render();
    expect(p).toMatch(/【今天日期】\d{4}-\d{2}-\d{2}/);
    expect(p).toContain("美西時間");
    // 既有內容仍在(param 只是 additive)
    expect(p).toContain("submit_inquiry_analysis");
    expect(p).toContain("Jeff Hsieh");
  });
});
