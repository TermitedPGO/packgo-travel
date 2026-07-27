/**
 * Smoke test for Phase 4E · wechatAssist sub-router extraction.
 * Verifies the 4 original procedures (routers.ts L4260-4355) plus the
 * 批2 m5 歸戶 additions (listForCustomer / assignCustomer, 2026-06-10).
 */
import { describe, it, expect } from "vitest";
import { wechatAssistRouter } from "./wechatAssist";

describe("wechatAssistRouter (Phase 4E extraction + 批2 m5)", () => {
  it("exposes the original 4 + the 2 歸戶 procedures", () => {
    const procs = Object.keys((wechatAssistRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "draftReply",
        "listPending",
        "approve",
        "skip",
        // 批2 m5 — per-customer thread + manual assignment
        "listForCustomer",
        "assignCustomer",
      ].sort(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TG-R2(P1-2):WeChat 草稿是 admin-only 流程,行程下架期間必須帶明文
// 旁路呼叫 enrichChatContext。原始碼掃描鎖(剝註解),防止旁路被悄悄拿掉
// 或被複製到非 admin 路徑;行為面由 aiChatContextService.takedown.test.ts 鎖。
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync as __rf } from "node:fs";
import { join as __j, dirname as __d } from "node:path";
import { fileURLToPath as __f } from "node:url";

describe("wechatAssistService:行程下架旁路(TG-R2)", () => {
  it("enrichChatContext 呼叫必須帶 trustedAdminBypassTourTakedown: true", () => {
    const src = __rf(
      __j(__d(__f(import.meta.url)), "..", "services", "wechatAssistService.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/enrichChatContext\([\s\S]{0,200}?trustedAdminBypassTourTakedown:\s*true/);
  });
});
