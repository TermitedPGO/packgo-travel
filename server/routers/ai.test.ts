/**
 * Smoke test for Phase 4E · ai sub-router extraction.
 * Verifies 4 procedures from the pre-split source.
 */
import { describe, it, expect } from "vitest";
import { aiRouter } from "./ai";

describe("aiRouter (Phase 4E extraction)", () => {
  it("exposes 4 procedures from the pre-split source", () => {
    const procs = Object.keys((aiRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "getQuota",
        "chat",
        "recordFeedback",
        "recordConversion",
      ].sort(),
    );
  });
});
