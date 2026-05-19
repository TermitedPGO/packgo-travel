/**
 * Smoke test for Phase 4E · reviews sub-router extraction.
 * Verifies 8 procedures from the pre-split source.
 */
import { describe, it, expect } from "vitest";
import { reviewsRouter } from "./reviews";

describe("reviewsRouter (Phase 4E extraction)", () => {
  it("exposes 8 procedures from the pre-split source", () => {
    const procs = Object.keys((reviewsRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "listVerified",
        "myReviews",
        "create",
        "createPublic",
        "adminList",
        "adminApprove",
        "adminReject",
        "adminHide",
      ].sort(),
    );
  });
});
