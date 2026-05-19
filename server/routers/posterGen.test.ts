/**
 * Smoke test for Phase 4E · posterGen sub-router extraction.
 * Verifies 6 procedures from the pre-split source.
 */
import { describe, it, expect } from "vitest";
import { posterGenRouter } from "./posterGen";

describe("posterGenRouter (Phase 4E extraction)", () => {
  it("exposes 6 procedures from the pre-split source", () => {
    const procs = Object.keys((posterGenRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "uploadReference",
        "listReferences",
        "deleteReference",
        "generate",
        "listIterations",
        "getCostStatus",
      ].sort(),
    );
  });
});
