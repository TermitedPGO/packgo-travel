/**
 * Smoke test for Phase 4E · photos sub-router extraction.
 * Verifies 3 procedures from the pre-split source.
 */
import { describe, it, expect } from "vitest";
import { photosRouter } from "./photos";

describe("photosRouter (Phase 4E extraction)", () => {
  it("exposes 3 procedures from the pre-split source", () => {
    const procs = Object.keys((photosRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "upload",
        "myPhotos",
        "delete",
      ].sort(),
    );
  });
});
