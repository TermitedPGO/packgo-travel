/**
 * Smoke test for Phase 4C · bookings sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the
 * 10 procedures originally at server/routers.ts L2714-3662. Behavioral
 * tests for these procedures (price recompute, atomic slot reserve,
 * Stripe idempotency, packpoint redemption, admin refund flow, etc.)
 * belong to a future test pass — this is the structural regression
 * anchor for the Phase 4C split.
 */
import { describe, it, expect } from "vitest";
import { bookingsRouter } from "./bookings";

describe("bookingsRouter (Phase 4C extraction)", () => {
  it("exposes all 10 procedures from the pre-split source", () => {
    const procs = Object.keys((bookingsRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "create",
        "list",
        "listParticipants",
        "saveParticipants",
        "getById",
        "createCheckoutSession",
        "cancel",
        "adminList",
        "adminUpdateStatus",
        "adminRefund",
      ].sort(),
    );
  });
});
