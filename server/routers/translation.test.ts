/**
 * Smoke test for Phase 4E · translation sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the 10
 * procedures originally at server/routers.ts L3326-3472. Structural
 * regression anchor only — behavior covered in server/translation.ts tests.
 */
import { describe, it, expect } from "vitest";
import { translationRouter } from "./translation";

describe("translationRouter (Phase 4E extraction)", () => {
  it("exposes all 10 procedures from the pre-split source", () => {
    const procs = Object.keys((translationRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "translate",
        "translateBatch",
        "translateTour",
        "translateAllTours",
        "getAllTranslationsSummary",
        "getTourTranslations",
        "getBatchTourTranslations",
        "getAllTourTranslations",
        "getJobs",
        "getSupportedLanguages",
      ].sort(),
    );
  });
});
