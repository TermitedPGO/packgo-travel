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

import {
  buildSystem,
  buildUserPrompt,
  TOOL,
  draftFollowupEnforcingLanguage,
  type FollowupDrafterInput,
  type FollowupDrafterOutput,
} from "./followupDrafter";

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
    expect(p).toContain("整封信務必用繁體中文撰寫");
    expect(p).toContain("客人:想去東京 5 天");
    expect(p).toContain("我們:報價附上,5 天 4 晚");
  });
  it("emits a forceful English directive when the customer's language is en", () => {
    const p = buildUserPrompt({ daysSince: 5, language: "en", conversationExcerpt: [] });
    expect(p).toContain("Write the ENTIRE reply in English");
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

describe("buildUserPrompt — Jeff 口述指示(2026-07-02 給我草稿沒照做)", () => {
  it("有 jeffInstruction 時,指示原文與『必須照這個寫』進 prompt", () => {
    const p = buildUserPrompt({
      daysSince: 0,
      language: "en",
      conversationExcerpt: [],
      jeffInstruction: "寫信說星期四會去中國領事館拿回來 週五可以過來領",
    })
    expect(p).toContain("Jeff 的指示")
    expect(p).toContain("星期四會去中國領事館")
    expect(p).toContain("必須照這個寫")
  })

  it("沒有指示時不出現該段", () => {
    const p = buildUserPrompt({ daysSince: 1, language: "zh-TW", conversationExcerpt: [] })
    expect(p).not.toContain("Jeff 的指示")
  })

  it("hardLanguageRetry + en 時出現加重英文指令", () => {
    const p = buildUserPrompt({
      daysSince: 1,
      language: "en",
      conversationExcerpt: [],
      hardLanguageRetry: true,
    })
    expect(p).toContain("SECOND ATTEMPT")
  })
})

describe("draftFollowupEnforcingLanguage — en 客人中文稿重打一次", () => {
  const out = (body: string): FollowupDrafterOutput => ({
    subject: "s",
    body,
    confidence: 80,
    reasoning: "",
  })

  it("en 第一稿含中文 → 帶 hardLanguageRetry 重打一次,回第二稿", async () => {
    const calls: FollowupDrafterInput[] = []
    const fake = async (i: FollowupDrafterInput) => {
      calls.push(i)
      return calls.length === 1 ? out("Hi Leslie, 希望您一切都好") : out("Hi Leslie, hope all is well")
    }
    const r = await draftFollowupEnforcingLanguage(
      { daysSince: 0, language: "en", conversationExcerpt: [] },
      fake,
    )
    expect(calls).toHaveLength(2)
    expect(calls[1].hardLanguageRetry).toBe(true)
    expect(r.body).toBe("Hi Leslie, hope all is well")
  })

  it("en 第一稿乾淨 → 不重打", async () => {
    let n = 0
    const fake = async () => (n++, out("Hi Leslie, checking in."))
    const r = await draftFollowupEnforcingLanguage(
      { daysSince: 0, language: "en", conversationExcerpt: [] },
      fake,
    )
    expect(n).toBe(1)
    expect(r.body).toContain("checking in")
  })

  it("zh 客人不觸發語言重打", async () => {
    let n = 0
    const fake = async () => (n++, out("您好,跟您問候一聲"))
    await draftFollowupEnforcingLanguage(
      { daysSince: 0, language: "zh-TW", conversationExcerpt: [] },
      fake,
    )
    expect(n).toBe(1)
  })

  it("兩稿都髒 → 回第二稿(交給 sanitize 的 cjk_in_en_draft 硬擋,不落卡)", async () => {
    const fake = async () => out("Hi Leslie, 您好")
    const r = await draftFollowupEnforcingLanguage(
      { daysSince: 0, language: "en", conversationExcerpt: [] },
      fake,
    )
    expect(r.body).toContain("您好")
  })
})
