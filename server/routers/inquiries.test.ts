/**
 * Smoke test for Phase 4C · inquiries sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the
 * 9 procedures originally at server/routers.ts L3850-4141.
 *
 * Note: createEmergency preserves the `inquiryType: "emergency" as "other"`
 * cast — migration 0070 pending Jeff approval per docs/refactor/tasks/
 * phase-1/module-3-routers-tsc.md §B6.
 */
import { describe, it, expect } from "vitest";
import { inquiriesRouter } from "./inquiries";

describe("inquiriesRouter (Phase 4C extraction)", () => {
  it("exposes all 9 procedures from the pre-split source", () => {
    const procs = Object.keys((inquiriesRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "list",
        "getById",
        "translate",
        "create",
        "createEmergency",
        "updateStatus",
        "update",
        "getMessages",
        "addMessage",
      ].sort(),
    );
  });
});
