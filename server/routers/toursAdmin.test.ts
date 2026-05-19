/**
 * Smoke test for Phase 4E-bis-1 · toursAdmin sub-router extraction.
 * Verifies the 27 admin mutations originally at server/routers.ts L208-1406.
 * Composition: toursReadRouter (Phase 4A) + toursRouteMapRouter (Phase 4A) +
 * toursAdminRouter (this file) spread-merged under `tours:` key.
 */
import { describe, it, expect } from "vitest";
import { toursAdminRouter } from "./toursAdmin";

describe("toursAdminRouter (Phase 4E-bis-1 extraction)", () => {
  it("exposes all 27 admin procedures from the pre-split source", () => {
    const procs = Object.keys((toursAdminRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "create",
        "update",
        "patchField",
        "delete",
        "batchDelete",
        "duplicate",
        "getMyGenerationJobs",
        "getGenerationStatus",
        "cancelGeneration",
        "listActiveGenerations",
        "submitAsyncGeneration",
        "bulkImportFromLion",
        "listLionCategories",
        "saveFromPreview",
        "toggleStatus",
        "toggleFeatured",
        "getPendingReview",
        "approveTour",
        "rejectTour",
        "getCalibrationResult",
        "diagnose",
        "diagnoseEnv",
        "llmStressTest",
        "getExtractedDepartures",
        "confirmExtractedDepartures",
        "saveExtractedDepartures",
        "backfillLionDepartures",
      ].sort(),
    );
  });

  it("has no read-only procedures (those belong to toursReadRouter)", () => {
    const procs = Object.keys((toursAdminRouter as any)._def.procedures);
    const readish = procs.filter((p) =>
      /^(list|getById|search|suggest|getFilterOptions|getDepartureCities|generatePdf|getSimilar|getRecommended)$/.test(
        p,
      ),
    );
    expect(readish).toEqual([]);
  });

  it("has no route-map procedures (those belong to toursRouteMapRouter)", () => {
    const procs = Object.keys((toursAdminRouter as any)._def.procedures);
    const routeMapish = procs.filter((p) =>
      /^(getRouteMap|regenerateAiMap)$/.test(p),
    );
    expect(routeMapish).toEqual([]);
  });
});
