/**
 * Smoke test for Phase 4E · wechatAssist sub-router extraction.
 * Verifies 4 procedures originally at server/routers.ts L4260-4355.
 */
import { describe, it, expect } from "vitest";
import { wechatAssistRouter } from "./wechatAssist";

describe("wechatAssistRouter (Phase 4E extraction)", () => {
  it("exposes all 4 procedures from the pre-split source", () => {
    const procs = Object.keys((wechatAssistRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "draftReply",
        "listPending",
        "approve",
        "skip",
      ].sort(),
    );
  });
});
