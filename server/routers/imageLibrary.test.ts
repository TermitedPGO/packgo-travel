/**
 * Smoke test for Phase 4C · imageLibrary sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the
 * 3 procedures originally at server/routers.ts L4157-4223.
 */
import { describe, it, expect } from "vitest";
import { imageLibraryRouter } from "./imageLibrary";

describe("imageLibraryRouter (Phase 4C extraction)", () => {
  it("exposes all 3 procedures from the pre-split source", () => {
    const procs = Object.keys((imageLibraryRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(["list", "add", "delete"].sort());
  });
});
