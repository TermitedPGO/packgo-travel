/**
 * Smoke test for Phase 4C · bookings sub-router extraction (post-4D).
 *
 * Phase 4C extracted 10 procedures from routers.ts L2714-3662. Phase 4D
 * (2026-05-19) moved the 2 money-path procedures (createCheckoutSession,
 * adminRefund) into ./bookingsPayment.ts. The two slimmed routers are
 * spread-composed back under the `bookings:` key in routers.ts so client
 * paths are unchanged.
 */
import { describe, it, expect } from "vitest";
import { bookingsRouter } from "./bookings";

describe("bookingsRouter (Phase 4C extraction, post-4D split)", () => {
  it("exposes the 8 non-payment procedures (2 moved to bookingsPayment)", () => {
    const procs = Object.keys((bookingsRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "create",
        "list",
        "listParticipants",
        "saveParticipants",
        "getById",
        "cancel",
        "adminList",
        "adminUpdateStatus",
      ].sort(),
    );
  });
});
