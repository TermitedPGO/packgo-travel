/**
 * Smoke test for Phase 4E · competitor sub-router extraction.
 * Verifies 11 procedures originally at server/routers.ts L3568-3710.
 */
import { describe, it, expect } from "vitest";
import { competitorRouter } from "./competitor";

describe("competitorRouter (Phase 4E extraction)", () => {
  it("exposes all 11 procedures from the pre-split source", () => {
    const procs = Object.keys((competitorRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "list",
        "getById",
        "create",
        "update",
        "delete",
        "triggerScrape",
        "priceHistory",
        "alerts",
        "unreadAlertCount",
        "markAlertRead",
        "markAllAlertsRead",
      ].sort(),
    );
  });
});
