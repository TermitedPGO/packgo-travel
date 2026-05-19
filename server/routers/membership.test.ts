/**
 * Smoke test for Phase 4E · membership sub-router extraction.
 * Verifies 3 procedures from the pre-split source.
 */
import { describe, it, expect } from "vitest";
import { membershipRouter } from "./membership";

describe("membershipRouter (Phase 4E extraction)", () => {
  it("exposes 3 procedures from the pre-split source", () => {
    const procs = Object.keys((membershipRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "getStatus",
        "createCheckoutSession",
        "createPortalSession",
      ].sort(),
    );
  });
});
