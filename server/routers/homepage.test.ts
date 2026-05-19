/**
 * Smoke test for Phase 4C · homepage sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the
 * 9 procedures originally at server/routers.ts L4225-4377.
 */
import { describe, it, expect } from "vitest";
import { homepageRouter } from "./homepage";

describe("homepageRouter (Phase 4C extraction)", () => {
  it("exposes all 9 procedures from the pre-split source", () => {
    const procs = Object.keys((homepageRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "getContent",
        "getAllContent",
        "updateContent",
        "getDestinations",
        "getAllDestinations",
        "createDestination",
        "updateDestination",
        "deleteDestination",
        "reorderDestinations",
      ].sort(),
    );
  });
});
