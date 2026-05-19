/**
 * Smoke test for Phase 4E · marketing sub-router extraction.
 * Verifies 12 procedures originally at server/routers.ts L3713-3886.
 */
import { describe, it, expect } from "vitest";
import { marketingRouter } from "./marketing";

describe("marketingRouter (Phase 4E extraction)", () => {
  it("exposes all 12 procedures from the pre-split source", () => {
    const procs = Object.keys((marketingRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "listCampaigns",
        "getCampaign",
        "createCampaign",
        "updateCampaign",
        "deleteCampaign",
        "generateCopy",
        "generatePoster",
        "sendNewsletter",
        "listMaterials",
        "deleteMaterial",
        "subscriberStats",
        "emailLogs",
      ].sort(),
    );
  });
});
