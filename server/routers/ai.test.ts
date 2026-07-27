/**
 * Smoke test for Phase 4E · ai sub-router extraction.
 * Verifies 4 procedures from the pre-split source.
 */
import { describe, it, expect } from "vitest";
import { aiRouter } from "./ai";

describe("aiRouter (Phase 4E extraction)", () => {
  it("exposes 4 procedures from the pre-split source", () => {
    const procs = Object.keys((aiRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "getQuota",
        "chat",
        "recordFeedback",
        "recordConversion",
      ].sort(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI 顧問:免費無門檻(Jeff 2026-07-25 裁定)
//
// 裁定理由(Jeff 原話):「我們的價格也不能比 chatgpt 或者 claude 貴」「也是免費好了」。
// 客人花 $20 就有無限的 ChatGPT,為了每則不到半分錢美金的成本去設會員門檻,
// 擋掉的生意遠比省下的多。
//
// 這條鎖的是「不得再用會員等級決定 AI 顧問額度」。
// 要留著的是防濫用限流(IP 每小時、IP 每日、全站匿名每日/使用者每日),那層是成本天花板,
// 與會員無關,不得一併移除 —— 移除它等於把 API 帳單暴露給濫用。
//
// 掃原始碼而非行為測試的理由見 docs/adr/0005:行為測試需要大量 mock,
// mock 漂移會變成假綠;掃原始碼直接鎖「檔案裡不存在分級閘」。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync as _readFileSync } from "node:fs";
import { join as _join, dirname as _dirname } from "node:path";
import { fileURLToPath as _fileURLToPath } from "node:url";

const AI_SRC = _readFileSync(
  _join(_dirname(_fileURLToPath(import.meta.url)), "ai.ts"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("AI 顧問:免費無會員門檻(Jeff 2026-07-25 裁定)", () => {
  it("不得再用會員等級決定額度", () => {
    expect(AI_SRC).not.toMatch(/isPaidTier/);
    expect(AI_SRC).not.toMatch(/userTier/);
    expect(AI_SRC).not.toMatch(/FREE_TIER_LIMIT/);
  });

  it("防濫用限流必須保留(那是成本天花板,不是會員門檻)", () => {
    expect(AI_SRC).toMatch(/checkAiChatRateLimit|rateLimit/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R2(P1-5):行為級限流守門。終驗指出上面的字串掃描有假陽性空間:
// 刪掉四個實際 limiter 呼叫、留著 import token,字串測試仍綠。
// 本測試直接呼叫 chat,用 mock 間諜驗證「限流函式真的被呼叫」,
// limiter 呼叫被刪時必紅,與 token 無關。
// ─────────────────────────────────────────────────────────────────────────────

import { vi } from "vitest";

vi.mock("../rateLimit", () => ({
  checkAiChatRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99 })),
  checkAiChatDailyLimit: vi.fn(async () => ({ allowed: true, remaining: 99 })),
  checkAiChatGlobalAnonymousLimit: vi.fn(async () => ({ allowed: true, remaining: 99 })),
  checkAiChatUserDailyLimit: vi.fn(async () => ({ allowed: true, remaining: 99 })),
}));
vi.mock("../services/aiChatSkillService", () => ({
  processMessageWithSkills: vi.fn(async () => ({
    response: "ok",
    triggeredSkills: [],
    usageLogIds: [],
  })),
}));
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));

describe("AI 顧問:限流是行為不是字串(R2 P1-5,R3 補齊四道雙路)", () => {
  // R3:終驗證實 R2 版只鎖 hourly 與 global-anonymous,單獨刪 daily 或
  // userDaily 仍綠。本版兩條路徑四道限流逐一斷言,任一呼叫被刪必紅。
  it("匿名 chat:必經 IP 小時限流、IP 每日限流、全站匿名限流", async () => {
    const { aiRouter } = await import("./ai");
    const rl = await import("../rateLimit");
    (rl.checkAiChatRateLimit as any).mockClear();
    (rl.checkAiChatDailyLimit as any).mockClear();
    (rl.checkAiChatGlobalAnonymousLimit as any).mockClear();
    (rl.checkAiChatUserDailyLimit as any).mockClear();
    const caller = (aiRouter as any).createCaller({ ip: "203.0.113.9", user: null });
    await caller.chat({ message: "想去日本看楓葉", conversationHistory: [] });
    expect(rl.checkAiChatRateLimit).toHaveBeenCalledWith("203.0.113.9");
    expect(rl.checkAiChatDailyLimit).toHaveBeenCalledWith("203.0.113.9");
    expect(rl.checkAiChatGlobalAnonymousLimit).toHaveBeenCalledTimes(1);
    expect(rl.checkAiChatUserDailyLimit).not.toHaveBeenCalled();
  });

  it("登入 chat:必經 IP 小時限流、IP 每日限流、使用者每日限流", async () => {
    const { aiRouter } = await import("./ai");
    const rl = await import("../rateLimit");
    (rl.checkAiChatRateLimit as any).mockClear();
    (rl.checkAiChatDailyLimit as any).mockClear();
    (rl.checkAiChatGlobalAnonymousLimit as any).mockClear();
    (rl.checkAiChatUserDailyLimit as any).mockClear();
    const caller = (aiRouter as any).createCaller({ ip: "203.0.113.9", user: { id: 77 } });
    await caller.chat({ message: "幫我排東京五天", conversationHistory: [] });
    expect(rl.checkAiChatRateLimit).toHaveBeenCalledWith("203.0.113.9");
    expect(rl.checkAiChatDailyLimit).toHaveBeenCalledWith("203.0.113.9");
    expect(rl.checkAiChatUserDailyLimit).toHaveBeenCalledWith(77);
    expect(rl.checkAiChatGlobalAnonymousLimit).not.toHaveBeenCalled();
  });
});
