/**
 * Smoke test for Phase 4D · packpoint sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the 7
 * procedures originally at server/routers.ts L695-931. This is the
 * structural regression anchor for the Phase 4D money-path split.
 *
 * Behavioral coverage for award / deduct / expiry / redemption-cap math
 * lives in server/_core/packpoint.test.ts and the stripeWebhook handler
 * suites (Phase 2: stripeWebhook.bookings.test.ts covers booking-earn
 * idempotent retry).
 */
import { describe, it, expect } from "vitest";
import { packpointRouter } from "./packpoint";

describe("packpointRouter (Phase 4D extraction)", () => {
  it("exposes all 7 procedures from the pre-split source", () => {
    const procs = Object.keys((packpointRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "getStatus",
        "getHistory",
        "estimateRedemption",
        "adminAdjust",
        "adminTriggerMaintenance",
        "getReferralStatus",
        "claimReferral",
      ].sort(),
    );
  });
});
