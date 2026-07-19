/**
 * affiliateRouter now carries admin/price-comparison procedures only. The public
 * generateAffiliateLink + trackClick were removed in the Phase-1 homepage-only
 * rewrite; redirect + telemetry live in GET /go/trip/:source (see tripRedirect.test).
 */
import { describe, it, expect } from "vitest";
import { affiliateRouter } from "./affiliate";

describe("affiliateRouter", () => {
  it("exposes only the 6 admin/price-comparison procedures (no public link/track)", () => {
    const procs = Object.keys((affiliateRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "getStats",
        "getClicks",
        "upsertPriceComparison",
        "getPriceComparisons",
        "deletePriceComparison",
        "getPriceComparison",
      ].sort(),
    );
  });

  it("no longer exposes the removed public procedures", () => {
    const procs = Object.keys((affiliateRouter as any)._def.procedures);
    expect(procs).not.toContain("generateAffiliateLink");
    expect(procs).not.toContain("trackClick");
  });
});
