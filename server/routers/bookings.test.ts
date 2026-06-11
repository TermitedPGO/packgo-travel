/**
 * Smoke test for Phase 4C · bookings sub-router extraction (post-4D).
 *
 * Phase 4C extracted 10 procedures from routers.ts L2714-3662. Phase 4D
 * (2026-05-19) moved the 2 money-path procedures (createCheckoutSession,
 * adminRefund) into ./bookingsPayment.ts. The two slimmed routers are
 * spread-composed back under the `bookings:` key in routers.ts so client
 * paths are unchanged.
 *
 * Phases 1.1 / 1.5 / 2.5 (supplier fulfillment) later added 3 admin
 * procedures — setSupplierStatus, getOrderPacket, setSupplierCost — bringing
 * the non-payment set to 11.
 */
import { describe, it, expect } from "vitest";
import { bookingsRouter } from "./bookings";

describe("bookingsRouter (Phase 4C extraction, post-4D split)", () => {
  it("exposes the 12 non-payment procedures (2 moved to bookingsPayment)", () => {
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
        "adminGetDetail",
        "adminUpdateStatus",
        // Phase 1.1 / 1.5 / 2.5 supplier-fulfillment admin procedures
        "setSupplierStatus",
        "getOrderPacket",
        "setSupplierCost",
      ].sort(),
    );
  });
});
