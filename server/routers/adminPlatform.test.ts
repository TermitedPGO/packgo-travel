/**
 * Smoke test for Phase 4B · adminPlatform sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the
 * 4 procedures originally inside the top-level `admin:` block in
 * server/routers.ts at L4148-4361. Behavioral tests for the underlying
 * queries (Redis cache, parallel SELECTs, risk metric aggregations)
 * belong to a future test pass — this is the structural regression anchor.
 */
import { describe, it, expect } from "vitest";
import { adminPlatformRouter } from "./adminPlatform";

describe("adminPlatformRouter (Phase 4B extraction)", () => {
  it("exposes all 4 procedures from the pre-split source", () => {
    const procs = Object.keys((adminPlatformRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      ["getAnalytics", "getRiskMetrics", "getStats", "lookupUserByEmail"].sort(),
    );
  });
});
