// 批十二-4 (P2) — 純單元測試,不碰真實 LLM / DB / 網路。mock ./agentNotify 用 spy 驗卡的
// 形狀;mock ../db 讓 getDb 回 null(略過 DB 去重,直接走到貼卡)。注入假錯誤物件。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./agentNotify", () => ({ notifyAgentMessage: vi.fn(async () => {}) }));
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));

import {
  creditAuthDetector,
  isCreditOrAuthError,
  __resetForTest,
  __getStateForTest,
} from "./llmCreditAlert";
import { notifyAgentMessage } from "./agentNotify";

// E2E F4 觀察到的實際故障字串。
const CREDIT_MSG =
  "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";
const creditErr = { status: 400, message: CREDIT_MSG };
const fire = async (n: number, e: unknown = creditErr) => {
  for (let i = 0; i < n; i++) await creditAuthDetector.recordFailure(e);
};

beforeEach(() => {
  __resetForTest();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("isCreditOrAuthError", () => {
  it("400 + credit-balance message (實際故障字串) → true", () => {
    expect(isCreditOrAuthError(creditErr)).toBe(true);
  });
  it("SDK-shaped body err.error.error.message credit → true", () => {
    expect(
      isCreditOrAuthError({
        status: 400,
        error: { type: "error", error: { type: "invalid_request_error", message: "credit balance is too low" } },
      }),
    ).toBe(true);
  });
  it("401 / 402 → true (措辭無關)", () => {
    expect(isCreditOrAuthError({ status: 401 })).toBe(true);
    expect(isCreditOrAuthError({ status: 402 })).toBe(true);
  });
  it("一般 caller-bug 400 → false", () => {
    expect(isCreditOrAuthError({ status: 400, message: "messages: at least one message is required" })).toBe(false);
  });
  it("429 / 500 / 408 timeout / 無 status → false(留給 circuit breaker)", () => {
    expect(isCreditOrAuthError({ status: 429 })).toBe(false);
    expect(isCreditOrAuthError({ status: 500 })).toBe(false);
    expect(isCreditOrAuthError({ status: 408, message: "timeout" })).toBe(false);
    expect(isCreditOrAuthError({})).toBe(false);
    expect(isCreditOrAuthError(null)).toBe(false);
  });
});

describe("creditAuthDetector — 滾動視窗 + 去重 + 恢復", () => {
  it("未達門檻(2 次)不貼卡", async () => {
    await fire(2);
    expect(notifyAgentMessage).not.toHaveBeenCalled();
    expect(__getStateForTest()).toEqual({ hits: 2, alarmActive: false });
  });

  it("達門檻(3 次)貼且只貼一張,形狀正確", async () => {
    await fire(3);
    expect(notifyAgentMessage).toHaveBeenCalledTimes(1);
    const arg = (notifyAgentMessage as any).mock.calls[0][0];
    expect(arg.agentName).toBe("llm-ops");
    expect(arg.messageType).toBe("alert");
    expect(arg.priority).toBe("high"); // 絕不 critical
    expect(arg.title).toBe("LLM 額度異常,全站 AI 功能降級中");
  });

  it("去重:達門檻後再多次失敗仍只貼一張", async () => {
    await fire(3 + 5);
    expect(notifyAgentMessage).toHaveBeenCalledTimes(1);
  });

  it("恢復後重新武裝:成功 → reset → 再一輪異常會再貼一次", async () => {
    await fire(3);
    expect(notifyAgentMessage).toHaveBeenCalledTimes(1);
    creditAuthDetector.recordSuccess();
    expect(__getStateForTest()).toEqual({ hits: 0, alarmActive: false });
    await fire(3);
    expect(notifyAgentMessage).toHaveBeenCalledTimes(2);
  });

  it("視窗淘汰:兩次失敗間隔 > 5 分,舊 hit 被淘汰 → 湊不到 3 → 不貼", async () => {
    let t = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => t);
    await creditAuthDetector.recordFailure(creditErr); // hit @ t
    await creditAuthDetector.recordFailure(creditErr); // hit @ t
    t += 6 * 60 * 1000; // 前進 6 分鐘
    await creditAuthDetector.recordFailure(creditErr); // 前兩個被淘汰,只剩 1
    expect(notifyAgentMessage).not.toHaveBeenCalled();
    expect(__getStateForTest().hits).toBe(1);
    spy.mockRestore();
  });

  it("永不 throw + 零寄信:notifyAgentMessage reject 也不炸,且 priority 是 high", async () => {
    (notifyAgentMessage as any).mockRejectedValueOnce(new Error("db down"));
    await expect(fire(3)).resolves.toBeUndefined();
    const arg = (notifyAgentMessage as any).mock.calls[0][0];
    expect(arg.priority).not.toBe("critical");
  });

  it("非 credit 失敗(429)不計入視窗:交錯 429 不會湊到門檻", async () => {
    await creditAuthDetector.recordFailure({ status: 429 });
    await creditAuthDetector.recordFailure(creditErr);
    await creditAuthDetector.recordFailure({ status: 500 });
    await creditAuthDetector.recordFailure(creditErr);
    expect(notifyAgentMessage).not.toHaveBeenCalled(); // 只有 2 次 credit,未達 3
    expect(__getStateForTest().hits).toBe(2);
  });
});
