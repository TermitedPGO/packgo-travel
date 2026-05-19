/**
 * Smoke test for Phase 4A · favorites sub-router extraction.
 * Structural regression anchor — verifies the extracted module exposes
 * the 5 procedures from the pre-split source.
 */
import { describe, it, expect } from "vitest";
import { favoritesRouter } from "./favorites";

describe("favoritesRouter (Phase 4A extraction)", () => {
  it("exposes all 5 procedures from the pre-split source", () => {
    const procs = Object.keys((favoritesRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(["add", "getIds", "list", "remove", "toggle"].sort());
  });
});
