/**
 * Smoke test for Phase 4A · toursRead sub-router extraction.
 * Customer-facing read-only paths only — admin mutations stay in
 * server/routers.ts for Phase 4E to extract.
 */
// 2026-07-26 全行程下架總閘上線後,本檔測的是「旗標開啟時」的讀取邏輯。
// TG-R1(P2-1):改用 vi.stubEnv 並於結束還原,避免單 worker 跨檔污染。
import { vi as __vi, beforeAll as __beforeAll, afterAll as __afterAll } from "vitest";
__beforeAll(() => { __vi.stubEnv("TOURS_PUBLIC_ENABLED", "true"); });
__afterAll(() => { __vi.unstubAllEnvs(); });

import { describe, it, expect } from "vitest";
import { toursReadRouter } from "./toursRead";

describe("toursReadRouter (Phase 4A extraction)", () => {
  it("exposes all 11 read-only procedures", () => {
    const procs = Object.keys((toursReadRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "generatePdf",
        "getById",
        "getDepartureCities",
        "getFilterOptions",
        "getRecommended",
        "getSimilar",
        "getSupplierDetail",
        "list",
        "search",
        "searchCards",
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
