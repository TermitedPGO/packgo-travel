/**
 * followupDrafter — prompt-contract tests. The safety-critical bits are the
 * system prompt's hard rules (read real conversation, no fabrication, gentle
 * not a sales push, no em dash) and the TOOL shape. The live LLM call isn't
 * exercised (local has no ANTHROPIC_API_KEY) — these assert the pure builders.
 */
import { describe, it, expect, vi } from "vitest";

// Stub the LLM + safety wrapper so importing the module doesn't pull the llm
// graph or run the real notifyOwner wrapper at load.
vi.mock("../../_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("../_helpers/safety", () => ({
  withAutonomousSafety: (_cfg: unknown, fn: unknown) => fn,
}));

import { buildSystem, buildUserPrompt, TOOL } from "./followupDrafter";

describe("buildSystem — hard rules are present", () => {
  const sys = buildSystem();
  it("forbids the em dash", () => {
    expect(sys).toContain("不用破折號");
  });
  it("forbids fabrication (only use the real conversation)", () => {
    expect(sys).toContain("捏造");
    expect(sys).toContain("真實的往來摘錄");
  });
  it("forbids internal cost / supplier leakage", () => {
    expect(sys).toContain("成本");
    expect(sys).toContain("同業價");
  });
  it("is a low-pressure check-in, not a sales push", () => {
    expect(sys).toContain("不是催單");
  });
  it("names the submit tool", () => {
    expect(sys).toContain("submit_followup_draft");
  });
});

describe("buildUserPrompt", () => {
  it("renders the real conversation with 我們/客人 prefixes, oldest-first", () => {
    const p = buildUserPrompt({
      daysSince: 9,
      language: "zh-TW",
      conversationExcerpt: [
        { direction: "inbound", text: "想去東京 5 天" },
        { direction: "outbound", text: "報價附上,5 天 4 晚" },
      ],
    });
    expect(p).toContain("已靜默】9 天");
    expect(p).toContain("語言】zh-TW");
    expect(p).toContain("客人:想去東京 5 天");
    expect(p).toContain("我們:報價附上,5 天 4 晚");
  });
  it("falls back to a generic, low-pressure instruction when no excerpt", () => {
    const p = buildUserPrompt({ daysSince: 5, language: "en", conversationExcerpt: [] });
    expect(p).toContain("沒有可用的對話摘錄");
  });
});

describe("TOOL", () => {
  it("is the submit_followup_draft function with the required fields", () => {
    expect(TOOL.function.name).toBe("submit_followup_draft");
    expect(TOOL.function.parameters.required).toEqual(
      expect.arrayContaining(["subject", "body", "confidence", "reasoning"]),
    );
  });
});
