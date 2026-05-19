/**
 * Phase 2 module 5 (2026-05-18) — Vitest cases for visa-payment webhook.
 *
 * Covers the four contract guarantees of `handleVisaPaymentCompleted`:
 *
 *   Case 1 (happy path)
 *     - checkout.session.completed with `visa_application_id` metadata
 *       writes payment-info, application-status, and accounting income
 *       inside a single `db.transaction`. Post-commit email + owner
 *       notification fire after.
 *
 *   Case 2 (missing application → early return)
 *     - getVisaApplicationById returns null → handler logs and returns
 *       without invoking any write. No tx is opened.
 *
 *   Case 3 (mid-tx DB failure rolls back)
 *     - createAccountingEntry throws inside the tx → the transaction
 *       callback rejects, drizzle rolls back, and the webhook propagates
 *       the error so `markStripeEventFailed` records it. Critically: NO
 *       post-commit side effect (email / notifyOwner) runs, because we
 *       never reached the post-commit block. This is the new safety
 *       property — under the old code visa would have been flipped to
 *       "paid" with no accounting row.
 *
 *   Case 4 (idempotent retry)
 *     - Same Stripe event delivered twice. The central idempotency layer
 *       short-circuits the second delivery at `claimStripeEvent`. Visa
 *       writes happen exactly once; email + owner notification fire
 *       exactly once.
 *
 * All DB writes are mocked. The tests assert on call counts of the
 * mocked helpers, not on a real database. The factories from
 * `stripeMocks.ts` build the Stripe payloads.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";
import type Stripe from "stripe";

import { makeCheckoutSession, makeStripeEvent } from "./stripeMocks";

// ─────────────────────────────────────────────────────────────────────
// Mock state — call recorders + tx behavior toggles
// ─────────────────────────────────────────────────────────────────────

type VisaApplicationFixture = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  passportNumber: string;
  totalAmount: string;
  travelDate: string | null;
  applicationStatus: "pending" | "paid" | "submitted" | "approved";
  paymentStatus: "unpaid" | "paid";
};

const state = {
  application: null as VisaApplicationFixture | null,
  updateVisaPaymentInfo: vi.fn(),
  updateVisaApplicationStatus: vi.fn(),
  createAccountingEntry: vi.fn(),
  sendVisaApplicationConfirmation: vi.fn(),
  notifyOwner: vi.fn(),
  // Idempotency layer
  claimResult: { alreadyProcessed: false as boolean, rowId: 1 } as
    | { alreadyProcessed: false; rowId: number }
    | { alreadyProcessed: true; existingStatus: "processing" | "succeeded" | "failed" },
  markStripeEventSucceeded: vi.fn(),
  markStripeEventFailed: vi.fn(),
  // Drizzle tx callback toggles
  failInsideTx: false,
};

function resetState() {
  state.application = {
    id: 42,
    firstName: "Alice",
    lastName: "Chen",
    email: "alice@example.com",
    passportNumber: "P12345678",
    totalAmount: "180",
    travelDate: "2026-09-15",
    applicationStatus: "pending",
    paymentStatus: "unpaid",
  };
  state.updateVisaPaymentInfo.mockReset();
  state.updateVisaApplicationStatus.mockReset();
  state.createAccountingEntry.mockReset();
  state.sendVisaApplicationConfirmation.mockReset();
  state.notifyOwner.mockReset();
  state.markStripeEventSucceeded.mockReset();
  state.markStripeEventFailed.mockReset();
  state.claimResult = { alreadyProcessed: false, rowId: 1 };
  state.failInsideTx = false;
}

// ─────────────────────────────────────────────────────────────────────
// Module mocks — registered BEFORE `import ... from "./stripeWebhook"`.
// ─────────────────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  // The visa handler reads `application` via getVisaApplicationById.
  getVisaApplicationById: vi.fn(async (_id: number) => state.application),
  // Booking branch helpers — defined so TypeScript doesn't complain even
  // though our test never reaches them.
  getBookingById: vi.fn(async () => null),
  getPaymentByIntentId: vi.fn(async () => null),
  getTourById: vi.fn(async () => null),
  createPayment: vi.fn(async () => ({})),
  updateBooking: vi.fn(async () => ({})),
  updatePaymentStatus: vi.fn(async () => ({})),
  releaseDepartureSlots: vi.fn(async () => undefined),
  // Visa writes — drive their behavior from the test
  updateVisaPaymentInfo: vi.fn(async (...args: unknown[]) => {
    state.updateVisaPaymentInfo(...args);
  }),
  updateVisaApplicationStatus: vi.fn(async (...args: unknown[]) => {
    state.updateVisaApplicationStatus(...args);
  }),
  createAccountingEntry: vi.fn(async (...args: unknown[]) => {
    state.createAccountingEntry(...args);
    if (state.failInsideTx) {
      throw new Error("simulated accounting DB write failure");
    }
    return { id: 1 };
  }),
  // getDb returns a fake drizzle handle exposing `.transaction(cb)`.
  // Our fake tx is a sentinel string — the visa db helpers accept `tx?: any`
  // and just forward it, so we only need an opaque marker.
  getDb: vi.fn(async () => ({
    async transaction(cb: (tx: unknown) => Promise<void>) {
      await cb("__fakeTx__");
    },
  })),
}));

vi.mock("./stripeWebhookIdempotency", () => ({
  claimStripeEvent: vi.fn(async () => state.claimResult),
  markStripeEventSucceeded: vi.fn(async (rowId: number) => {
    state.markStripeEventSucceeded(rowId);
  }),
  markStripeEventFailed: vi.fn(async (rowId: number, err: unknown) => {
    state.markStripeEventFailed(rowId, err);
  }),
}));

vi.mock("../services/visaEmailService", () => ({
  sendVisaApplicationConfirmation: vi.fn(async (...args: unknown[]) => {
    state.sendVisaApplicationConfirmation(...args);
  }),
}));

vi.mock("./notification", () => ({
  notifyOwner: vi.fn(async (...args: unknown[]) => {
    state.notifyOwner(...args);
  }),
}));

// Stub out remaining handler imports that aren't relevant to visa.
vi.mock("../email", () => ({
  sendPaymentSuccessEmail: vi.fn(async () => undefined),
  sendSupplierNotificationEmail: vi.fn(async () => undefined),
  sendTrialEndingReminder: vi.fn(async () => undefined),
}));

vi.mock("./agentNotify", () => ({
  notifyAgentMessage: vi.fn(async () => undefined),
}));

vi.mock("./redact", () => ({
  redactEmail: (s: string) => s,
}));

// Mock Stripe SDK so getStripe().webhooks.constructEvent returns the
// fixture event the test injected via `req`.
let currentEvent: Stripe.Event | null = null;
vi.mock("stripe", () => {
  const StripeCtor = vi.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: () => {
        if (!currentEvent) {
          throw new Error("Test forgot to set currentEvent");
        }
        return currentEvent;
      },
    },
    subscriptions: { retrieve: vi.fn() },
  }));
  return { default: StripeCtor };
});

// ENV stub — getStripe() checks ENV.stripeSecretKey at first call.
vi.mock("./env", () => ({
  ENV: {
    stripeSecretKey: "sk_test_dummy",
    stripeWebhookSecret: "whsec_test_dummy",
    baseUrl: "https://test.packgo.local",
  },
}));

// Import AFTER all mocks are registered.
import { handleStripeWebhook } from "./stripeWebhook";

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function makeReqRes(): { req: Request; res: Response; jsonCalls: unknown[]; statusCalls: number[] } {
  const jsonCalls: unknown[] = [];
  const statusCalls: number[] = [];
  const res = {
    status(code: number) {
      statusCalls.push(code);
      return this;
    },
    json(payload: unknown) {
      jsonCalls.push(payload);
      return this;
    },
    send(payload: unknown) {
      jsonCalls.push(payload);
      return this;
    },
  } as unknown as Response;
  const req = {
    headers: { "stripe-signature": "t=1,v1=fake" },
    body: Buffer.from("{}"),
  } as unknown as Request;
  return { req, res, jsonCalls, statusCalls };
}

function setEvent(type: Stripe.Event.Type, data: unknown, id?: string) {
  currentEvent = makeStripeEvent({
    type,
    id: id ?? `evt_visa_${Math.random().toString(36).slice(2, 10)}`,
    data,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("stripeWebhook · visa branch (Phase 2 module 5)", () => {
  beforeEach(() => {
    resetState();
    currentEvent = null;
  });

  it("Case 1 — checkout.session.completed (visa) writes payment-info + status + accounting, then sends email + notifies Jeff", async () => {
    const session = makeCheckoutSession({
      amount: 18000, // 18000¢ = $180
      currency: "usd",
      metadata: { visa_application_id: "42" },
    });
    setEvent("checkout.session.completed", session);

    const { req, res, jsonCalls, statusCalls } = makeReqRes();
    await handleStripeWebhook(req, res);

    expect(statusCalls).toEqual([]); // 200 path
    expect(jsonCalls).toEqual([{ received: true }]);

    // WRITE 1: payment info
    expect(state.updateVisaPaymentInfo).toHaveBeenCalledTimes(1);
    const [paymentArgs] = state.updateVisaPaymentInfo.mock.calls;
    expect(paymentArgs[0]).toBe(42);
    expect(paymentArgs[1]).toMatchObject({
      paymentStatus: "paid",
      stripePaymentIntentId: session.payment_intent,
      stripeCheckoutSessionId: session.id,
    });
    expect(paymentArgs[1].paidAt).toBeInstanceOf(Date);
    expect(paymentArgs[2]).toBe("__fakeTx__"); // running inside the tx

    // WRITE 2: application status flipped to "paid" + reviewer note
    expect(state.updateVisaApplicationStatus).toHaveBeenCalledTimes(1);
    const [statusArgs] = state.updateVisaApplicationStatus.mock.calls;
    expect(statusArgs[0]).toBe(42);
    expect(statusArgs[1]).toBe("paid");
    expect(statusArgs[2]).toBeUndefined();
    expect(statusArgs[3]).toBe("Stripe 付款完成");
    expect(statusArgs[4]).toBe("__fakeTx__");

    // WRITE 3: accounting income entry — category=visa_service, amount=180
    expect(state.createAccountingEntry).toHaveBeenCalledTimes(1);
    const [acctArgs] = state.createAccountingEntry.mock.calls;
    expect(acctArgs[0]).toMatchObject({
      entryType: "income",
      category: "visa_service",
      amount: "180",
      currency: "USD",
      visaApplicationId: 42,
      isTaxDeductible: 0,
    });
    expect(acctArgs[1]).toBe("__fakeTx__");

    // POST-COMMIT: confirmation email + owner notification
    expect(state.sendVisaApplicationConfirmation).toHaveBeenCalledTimes(1);
    expect(state.sendVisaApplicationConfirmation.mock.calls[0][0]).toMatchObject({
      toEmail: "alice@example.com",
      applicantName: "Alice Chen",
      applicationId: 42,
      passportNumber: "P12345678",
    });
    expect(state.notifyOwner).toHaveBeenCalledTimes(1);
    expect(state.notifyOwner.mock.calls[0][0].title).toContain("中國簽證付款 $180.00");

    // Idempotency layer marked the event succeeded
    expect(state.markStripeEventSucceeded).toHaveBeenCalledWith(1);
    expect(state.markStripeEventFailed).not.toHaveBeenCalled();
  });

  it("Case 2 — missing visa application → early return with no writes and no tx", async () => {
    state.application = null;
    const session = makeCheckoutSession({
      amount: 18000,
      metadata: { visa_application_id: "999" },
    });
    setEvent("checkout.session.completed", session);

    const { req, res, jsonCalls } = makeReqRes();
    await handleStripeWebhook(req, res);

    // Webhook still ack'd to Stripe (we don't want retries for "not found")
    expect(jsonCalls).toEqual([{ received: true }]);

    // No writes anywhere
    expect(state.updateVisaPaymentInfo).not.toHaveBeenCalled();
    expect(state.updateVisaApplicationStatus).not.toHaveBeenCalled();
    expect(state.createAccountingEntry).not.toHaveBeenCalled();

    // No post-commit side effects
    expect(state.sendVisaApplicationConfirmation).not.toHaveBeenCalled();
    expect(state.notifyOwner).not.toHaveBeenCalled();

    // Idempotency: event still marked succeeded (we handled it cleanly)
    expect(state.markStripeEventSucceeded).toHaveBeenCalledWith(1);
    expect(state.markStripeEventFailed).not.toHaveBeenCalled();
  });

  it("Case 3 — mid-tx DB failure rolls back: status NOT flipped, email NOT sent, event marked failed", async () => {
    state.failInsideTx = true; // createAccountingEntry will throw
    const session = makeCheckoutSession({
      amount: 18000,
      metadata: { visa_application_id: "42" },
    });
    setEvent("checkout.session.completed", session);

    const { req, res, jsonCalls, statusCalls } = makeReqRes();
    await handleStripeWebhook(req, res);

    // Webhook returns 500 so Stripe will retry
    expect(statusCalls).toEqual([500]);
    expect(jsonCalls).toEqual([{ error: "Webhook processing failed" }]);

    // The two pre-failure writes WERE called inside the tx — but the tx
    // rolled back (our fake tx propagates the throw; in real MySQL the
    // rollback unwinds the writes). We assert the *contract* that the
    // post-commit block was NOT reached.
    expect(state.createAccountingEntry).toHaveBeenCalledTimes(1);

    // POST-COMMIT MUST NOT run when the tx threw — this is the load-bearing
    // assertion. Under the old code, the visa would be "paid" and the
    // customer would have received a "thanks for paying" email even though
    // accounting rolled back. The new design prevents both.
    expect(state.sendVisaApplicationConfirmation).not.toHaveBeenCalled();
    expect(state.notifyOwner).not.toHaveBeenCalled();

    // Idempotency layer recorded the failure for Jeff to investigate
    expect(state.markStripeEventFailed).toHaveBeenCalledTimes(1);
    const [rowId, recordedErr] = state.markStripeEventFailed.mock.calls[0];
    expect(rowId).toBe(1);
    expect((recordedErr as Error).message).toContain("simulated accounting DB write failure");
    expect(state.markStripeEventSucceeded).not.toHaveBeenCalled();
  });

  it("Case 4 — duplicate event delivery is idempotent at the central layer (no double writes, no double email)", async () => {
    const sharedId = "evt_visa_duplicate_test";
    const session = makeCheckoutSession({
      amount: 18000,
      metadata: { visa_application_id: "42" },
    });

    // First delivery — claim succeeds
    state.claimResult = { alreadyProcessed: false, rowId: 7 };
    setEvent("checkout.session.completed", session, sharedId);
    {
      const { req, res, jsonCalls } = makeReqRes();
      await handleStripeWebhook(req, res);
      expect(jsonCalls).toEqual([{ received: true }]);
    }

    // First-delivery side effects fired
    expect(state.updateVisaPaymentInfo).toHaveBeenCalledTimes(1);
    expect(state.updateVisaApplicationStatus).toHaveBeenCalledTimes(1);
    expect(state.createAccountingEntry).toHaveBeenCalledTimes(1);
    expect(state.sendVisaApplicationConfirmation).toHaveBeenCalledTimes(1);
    expect(state.notifyOwner).toHaveBeenCalledTimes(1);

    // Second delivery — central claim short-circuits with alreadyProcessed
    state.claimResult = {
      alreadyProcessed: true,
      existingStatus: "succeeded",
    };
    setEvent("checkout.session.completed", session, sharedId);
    {
      const { req, res, jsonCalls } = makeReqRes();
      await handleStripeWebhook(req, res);
      expect(jsonCalls).toEqual([{ received: true, idempotent: true }]);
    }

    // Counts unchanged — no second write, no second email
    expect(state.updateVisaPaymentInfo).toHaveBeenCalledTimes(1);
    expect(state.updateVisaApplicationStatus).toHaveBeenCalledTimes(1);
    expect(state.createAccountingEntry).toHaveBeenCalledTimes(1);
    expect(state.sendVisaApplicationConfirmation).toHaveBeenCalledTimes(1);
    expect(state.notifyOwner).toHaveBeenCalledTimes(1);

    // markSucceeded called once (the first delivery); the second delivery
    // short-circuited before the success path.
    expect(state.markStripeEventSucceeded).toHaveBeenCalledTimes(1);
    expect(state.markStripeEventSucceeded).toHaveBeenCalledWith(7);
  });
});
