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
    expect(sys).toContain("真實的完整往來");
  });
  it("forbids inferring unstated relationships (e.g. 10 people is not a family)", () => {
    expect(sys).toContain("不准推斷");
    expect(sys).toContain("10 人");
  });
  it("forbids internal cost / supplier leakage", () => {
    expect(sys).toContain("成本");
    expect(sys).toContain("同業價");
  });
  it("requires the respectful 您, not 你", () => {
    expect(sys).toContain("全程用「您」");
  });
  it("mirrors Jeff's existing address (姊姊/哥), not a default", () => {
    expect(sys).toContain("延用");
    expect(sys).toContain("姊姊");
    expect(sys).toContain("不要對每個人都套");
  });
  it("greets warmly before raising the matter", () => {
    expect(sys).toContain("噓寒問暖");
  });
  it("is a low-pressure check-in, not a sales push", () => {
    expect(sys).toContain("催單");
  });
  it("writes as the professional hospitality consultant", () => {
    expect(sys).toContain("接待顧問");
  });
  it("names the submit tool", () => {
    expect(sys).toContain("submit_followup_draft");
  });
  it("puts Jeff's rules at the top as a layered override", () => {
    expect(sys).toContain("最高優先");
    expect(sys).toContain("一律以這些為準");
  });
  it("teaches by ❌ bad vs ✅ good pairs, not abstract rules alone", () => {
    expect(sys).toContain("壞例子 ❌ vs 好例子 ✅");
    // both a forbidden form and its corrected form are shown
    expect(sys).toContain("名額有限");
    expect(sys).toContain("您慢慢看");
  });
  it("ships a pre-send self-check for drift symptoms", () => {
    expect(sys).toContain("寄出前自檢");
    expect(sys).toContain("跑偏");
  });
});

describe("buildSystem — live A/B arms", () => {
  // The trap-fixture gate: BOTH arms must keep every customer-facing hard rule.
  // A new arm that drops a guardrail must fail HERE, not in a real send.
  it.each([["A"], ["B"]] as const)("arm %s keeps the hard-rule contract", (variant) => {
    const sys = buildSystem(variant);
    expect(sys).toContain("不用破折號"); // no em dash
    expect(sys).toContain("捏造"); // no fabrication
    expect(sys).toContain("真實的完整往來");
    expect(sys).toContain("不准推斷"); // no inferring unstated identity
    expect(sys).toContain("10 人");
    expect(sys).toContain("成本"); // no internal cost leak
    expect(sys).toContain("同業價");
    expect(sys).toContain("全程用「您」");
    expect(sys).toContain("延用"); // mirror Jeff's existing address
    expect(sys).toContain("姊姊");
    expect(sys).toContain("噓寒問暖"); // greet before raising the matter
    expect(sys).toContain("催單"); // low-pressure, not a sales push
    expect(sys).toContain("submit_followup_draft");
  });

  it("default arm is B (the distilled prompt)", () => {
    expect(buildSystem()).toBe(buildSystem("B"));
  });

  it("the two arms are genuinely different — only B has the distillation layer", () => {
    expect(buildSystem("A")).not.toBe(buildSystem("B"));
    expect(buildSystem("A")).not.toContain("壞例子 ❌ vs 好例子 ✅");
    expect(buildSystem("B")).toContain("壞例子 ❌ vs 好例子 ✅");
    // A is the frozen baseline: it must NOT carry the new layers
    expect(buildSystem("A")).not.toContain("最高優先");
    expect(buildSystem("A")).not.toContain("寄出前自檢");
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
