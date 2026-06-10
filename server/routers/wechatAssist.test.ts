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
