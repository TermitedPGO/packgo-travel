/**
 * Smoke test for Phase 4E · aiQuotes sub-router extraction.
 * Verifies 3 procedures from the pre-split source.
 */
import { describe, it, expect } from "vitest";
import { aiQuotesRouter } from "./aiQuotes";

describe("aiQuotesRouter (Phase 4E extraction)", () => {
  it("exposes 3 procedures from the pre-split source", () => {
    const procs = Object.keys((aiQuotesRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "generate",
        "adminList",
        "adminMarkConverted",
      ].sort(),
    );
  });
});
