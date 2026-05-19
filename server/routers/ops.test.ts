/**
 * Smoke test for Phase 4E · ops sub-router extraction.
 * Verifies 2 procedures originally at server/routers.ts L4395-4501.
 */
import { describe, it, expect } from "vitest";
import { opsRouter } from "./ops";

describe("opsRouter (Phase 4E extraction)", () => {
  it("exposes 2 procedures from the pre-split source", () => {
    const procs = Object.keys((opsRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "rerunAllTourTranslations",
        "sendDailyDigestNow",
      ].sort(),
    );
  });
});
