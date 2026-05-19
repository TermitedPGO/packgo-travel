/**
 * Smoke test for Phase 4D · bookingsPayment sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the 2
 * money-path procedures originally inside bookingsRouter (createCheckoutSession
 * and adminRefund). This is the structural regression anchor for the
 * Phase 4D money-path split.
 *
 * Behavioral coverage for these procedures (Stripe checkout idempotency,
 * full + partial refund flows, seat release on refund, audit-trail capture)
 * lives in server/_core/stripeWebhook.bookings.test.ts and
 * server/_core/stripeWebhook.refunds.test.ts — 31 cases from Phase 2 that
 * MUST continue to pass after this structural extraction.
 */
import { describe, it, expect } from "vitest";
import { bookingsPaymentRouter } from "./bookingsPayment";

describe("bookingsPaymentRouter (Phase 4D extraction)", () => {
  it("exposes the 2 money-path procedures extracted from bookings.ts", () => {
    const procs = Object.keys((bookingsPaymentRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(["adminRefund", "createCheckoutSession"].sort());
  });
});
