/**
 * Smoke test for Phase 4E · invoices sub-router extraction.
 * Verifies 6 procedures from the pre-split source.
 */
import { describe, it, expect } from "vitest";
import { invoicesRouter } from "./invoices";

describe("invoicesRouter (Phase 4E extraction)", () => {
  it("exposes 6 procedures from the pre-split source", () => {
    const procs = Object.keys((invoicesRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "forBooking",
        "list",
        "get",
        "create",
        "updateStatus",
        "delete",
      ].sort(),
    );
  });
});
