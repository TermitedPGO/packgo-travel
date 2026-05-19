/**
 * Smoke test for Phase 4B · adminLlm sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the
 * 2 procedures originally inside the top-level `admin:` block in
 * server/routers.ts at L4363-4679. Behavioral tests for cost-matrix
 * pricing and Redis HGETALL aggregation belong to a future test pass —
 * this is the structural regression anchor.
 */
import { describe, it, expect } from "vitest";
import { adminLlmRouter } from "./adminLlm";

describe("adminLlmRouter (Phase 4B extraction)", () => {
  it("exposes all 2 procedures from the pre-split source", () => {
    const procs = Object.keys((adminLlmRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      ["getLlmStats", "llmCostReport"].sort(),
    );
  });
});
