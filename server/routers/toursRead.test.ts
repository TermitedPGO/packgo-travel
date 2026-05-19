/**
 * Smoke test for Phase 4A · toursRead sub-router extraction.
 * Customer-facing read-only paths only — admin mutations stay in
 * server/routers.ts for Phase 4E to extract.
 */
import { describe, it, expect } from "vitest";
import { toursReadRouter } from "./toursRead";

describe("toursReadRouter (Phase 4A extraction)", () => {
  it("exposes all 9 read-only procedures from the pre-split source", () => {
    const procs = Object.keys((toursReadRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "generatePdf",
        "getById",
        "getDepartureCities",
        "getFilterOptions",
        "getRecommended",
        "getSimilar",
        "list",
        "search",
        "suggest",
      ].sort(),
    );
  });

  it("has no admin mutation procedures (those belong to Phase 4E)", () => {
    const procs = Object.keys((toursReadRouter as any)._def.procedures);
    const adminish = procs.filter((p) =>
      /^(create|update|delete|generateFromUrl|submitAsync)/.test(p),
    );
    expect(adminish).toEqual([]);
  });
});
