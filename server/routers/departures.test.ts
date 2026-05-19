/**
 * Smoke test for Phase 4C · departures sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the
 * 9 procedures originally at server/routers.ts L3665-3847.
 */
import { describe, it, expect } from "vitest";
import { departuresRouter } from "./departures";

describe("departuresRouter (Phase 4C extraction)", () => {
  it("exposes all 9 procedures from the pre-split source", () => {
    const procs = Object.keys((departuresRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "getNext",
        "getUpcoming",
        "getNextBatch",
        "list",
        "listByTour",
        "getById",
        "create",
        "update",
        "delete",
      ].sort(),
    );
  });
});
