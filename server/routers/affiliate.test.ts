/**
 * Smoke test for Phase 4E · affiliate sub-router extraction.
 * Verifies 8 procedures originally at server/routers.ts L4113-4248.
 */
import { describe, it, expect } from "vitest";
import { affiliateRouter } from "./affiliate";

describe("affiliateRouter (Phase 4E extraction)", () => {
  it("exposes all 8 procedures from the pre-split source", () => {
    const procs = Object.keys((affiliateRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "generateAffiliateLink",
        "trackClick",
        "getStats",
        "getClicks",
        "upsertPriceComparison",
        "getPriceComparisons",
        "deletePriceComparison",
        "getPriceComparison",
      ].sort(),
    );
  });
});
