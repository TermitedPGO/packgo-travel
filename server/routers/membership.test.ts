/**
 * Membership router 的結構鎖。
 *
 * 2026-07-25 Jeff 裁定:不應有付費會員機制。本測試鎖兩件事:
 *   一,router 只暴露 getStatus,不得再出現訂閱結帳或訂閱管理端點。
 *   二,原始碼裡不得再 import stripe 或引用訂閱 price ID。
 * 依據與研究出處見 membership.ts 檔頭。
 * 若日後要恢復付費層,必須先完成 §17550.27 與 AB 2863 法遵,
 * 再更新本測試;不得直接刪測試了事。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { membershipRouter } from "./membership";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "membership.ts"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("membershipRouter(免費制,2026-07-25 Jeff 裁定)", () => {
  it("只暴露 getStatus", () => {
    const procs = Object.keys((membershipRouter as any)._def.procedures);
    expect(procs).toEqual(["getStatus"]);
  });

  it("原始碼不得再有訂閱結帳或 Stripe 引用", () => {
    expect(SRC).not.toMatch(/createCheckoutSession/);
    expect(SRC).not.toMatch(/createPortalSession/);
    expect(SRC).not.toMatch(/stripe/i);
    expect(SRC).not.toMatch(/trial/i);
  });

  it("getStatus 對未登入者回免費層", async () => {
    const caller = (membershipRouter as any).createCaller({ user: null });
    const res = await caller.getStatus();
    expect(res).toEqual({ tier: "free", expiresAt: null, hasSubscription: false });
  });
});
