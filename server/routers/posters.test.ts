/**
 * Smoke test for Phase 4E · posters sub-router extraction.
 * Verifies 7 procedures from the pre-split source.
 */
import { describe, it, expect } from "vitest";
import { postersRouter } from "./posters";

describe("postersRouter (Phase 4E extraction)", () => {
  it("exposes 7 procedures from the pre-split source", () => {
    const procs = Object.keys((postersRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "create",
        "list",
        "get",
        "updateCopy",
        "regenerateImage",
        "archive",
        "approve",
      ].sort(),
    );
  });
});
