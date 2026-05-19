/**
 * Smoke test for Phase 4E · marketingContent sub-router extraction.
 * Verifies 1 procedure originally at server/routers.ts L4362-4392.
 */
import { describe, it, expect } from "vitest";
import { marketingContentRouter } from "./marketingContent";

describe("marketingContentRouter (Phase 4E extraction)", () => {
  it("exposes the 1 procedure from the pre-split source", () => {
    const procs = Object.keys((marketingContentRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(["generateWeekly"].sort());
  });
});
