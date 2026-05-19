/**
 * Smoke test for Phase 4E · visa sub-router extraction.
 * Verifies 7 procedures originally at server/routers.ts L3891-4112.
 */
import { describe, it, expect } from "vitest";
import { visaRouter } from "./visa";

describe("visaRouter (Phase 4E extraction)", () => {
  it("exposes all 7 procedures from the pre-split source", () => {
    const procs = Object.keys((visaRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "calculatePricing",
        "submitApplication",
        "getApplicationStatus",
        "adminListApplications",
        "adminStats",
        "adminUpdateStatus",
        "adminUpdateNotes",
      ].sort(),
    );
  });
});
