/**
 * Tests for autoSendGate (email-auto-reply m1) — 八步閘門逐條 +
 * 硬編碼排除在任何政策組合下鎖死(DoD 要求)。
 */
import { describe, it, expect } from "vitest";
import {
  evaluateAutoSend,
  AUTO_SEND_HARD_EXCLUDED,
  type AutoSendGateInput,
} from "./autoSendGate";

const input = (over: Partial<AutoSendGateInput> = {}): AutoSendGateInput => ({
  classification: "general_info",
  confidence: 95,
  shouldEscalate: false,
  hasAttachments: false,
  todaysAutoSent: 0,
  ...over,
});

/** Stage B 全開政策(general_info 白名單)。 */
const OPEN_POLICY = {
  autoSendEnabled: true,
  autoSendShadowMode: false,
  autoSendClasses: ["general_info"],
  autoSendMinConfidence: 90,
  autoSendDailyCap: 10,
  autoSendBlockAttachments: true,
};

describe("evaluateAutoSend — 硬規則", () => {
  it("五類硬排除在「全開」政策 + 白名單硬塞下仍然 draft(改碼才能動)", () => {
    for (const cls of AUTO_SEND_HARD_EXCLUDED) {
      const v = evaluateAutoSend(input({ classification: cls }), {
        ...OPEN_POLICY,
        autoSendClasses: [cls], // 惡意/誤操作把排除類塞進白名單
      });
      expect(v.verdict, cls).toBe("draft");
      expect(v.reason).toBe("hard-excluded-class");
    }
  });

  it("agent 已判升級 → 永遠 draft(自動回不覆蓋升級判斷)", () => {
    const v = evaluateAutoSend(input({ shouldEscalate: true }), OPEN_POLICY);
    expect(v.verdict).toBe("draft");
  });

  it("帶附件 → draft(預設擋)", () => {
    const v = evaluateAutoSend(input({ hasAttachments: true }), OPEN_POLICY);
    expect(v).toEqual({ verdict: "draft", reason: "has-attachments" });
  });

  // Codex 12:01 §五.1 — attachments 是 HARD exclusion:曾經的政策繞道
  // `autoSendBlockAttachments=false`(12:01 §三.3 證明可在全開政策下真寄信)
  // 已作廢,任何政策組合都打不開。
  it("帶附件 + autoSendBlockAttachments=false(已死的繞道)→ 仍 draft", () => {
    const v = evaluateAutoSend(
      input({ hasAttachments: true }),
      { ...OPEN_POLICY, autoSendBlockAttachments: false },
    );
    expect(v).toEqual({ verdict: "draft", reason: "has-attachments" });
  });

  it("信心不足 → draft", () => {
    const v = evaluateAutoSend(input({ confidence: 89 }), OPEN_POLICY);
    expect(v).toEqual({ verdict: "draft", reason: "below-confidence" });
  });
});

describe("evaluateAutoSend — Stage A 影子", () => {
  it("預設政策(全空)= 影子記錄,絕不 send", () => {
    const v = evaluateAutoSend(input(), {});
    expect(v.verdict).toBe("shadow");
  });

  it("policy=null / 壞鍵 全部安全降級成影子", () => {
    expect(evaluateAutoSend(input(), null).verdict).toBe("shadow");
    expect(
      evaluateAutoSend(input(), {
        autoSendEnabled: "yes", // 非 boolean true → off
        autoSendMinConfidence: "high", // 非數字 → 90
        autoSendClasses: "general_info", // 非陣列 → []
      }).verdict,
    ).toBe("shadow");
  });

  it("總開關開了但 shadowMode 仍 on → 影子(雙開關都要動才真寄)", () => {
    const v = evaluateAutoSend(input(), {
      ...OPEN_POLICY,
      autoSendShadowMode: true,
    });
    expect(v.verdict).toBe("shadow");
  });

  it("影子不受日上限影響(證據照收)", () => {
    const v = evaluateAutoSend(input({ todaysAutoSent: 999 }), {
      ...OPEN_POLICY,
      autoSendShadowMode: true,
    });
    expect(v.verdict).toBe("shadow");
  });
});

describe("evaluateAutoSend — Stage B 真寄", () => {
  it("全閘通過 → send", () => {
    const v = evaluateAutoSend(input(), OPEN_POLICY);
    expect(v).toEqual({ verdict: "send", reason: "all-gates-passed" });
  });

  it("不在白名單的類別 → 影子(收證據),不寄", () => {
    const v = evaluateAutoSend(
      input({ classification: "new_inquiry" }),
      OPEN_POLICY,
    );
    expect(v.verdict).toBe("shadow");
    expect(v.reason).toBe("shadow-class-candidate");
  });

  it("日上限到頂 → draft(降級,不是排隊)", () => {
    const v = evaluateAutoSend(input({ todaysAutoSent: 10 }), OPEN_POLICY);
    expect(v).toEqual({ verdict: "draft", reason: "daily-cap" });
  });

  it("cap 邊界:第 10 封(index 9)可寄,第 11 封降級", () => {
    expect(
      evaluateAutoSend(input({ todaysAutoSent: 9 }), OPEN_POLICY).verdict,
    ).toBe("send");
    expect(
      evaluateAutoSend(input({ todaysAutoSent: 10 }), OPEN_POLICY).verdict,
    ).toBe("draft");
  });

  it("回歸保證:總開關 off + 白名單空 = 對外行為與今天完全一致(只多影子記錄)", () => {
    // 任何輸入都不可能得到 send
    for (const conf of [50, 90, 100]) {
      for (const cls of ["general_info", "new_inquiry", "booking_question"]) {
        const v = evaluateAutoSend(
          input({ classification: cls, confidence: conf }),
          { autoSendEnabled: false },
        );
        expect(v.verdict).not.toBe("send");
      }
    }
  });
});
