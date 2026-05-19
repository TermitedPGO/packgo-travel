/**
 * Vitest — Phase 2 Module 2.2 (booking handler atomicity)
 *
 * Asserts the three booking-path webhook handlers:
 *   • checkout.session.completed (booking branch)
 *   • payment_intent.succeeded
 *   • payment_intent.payment_failed
 *
 * are wrapped in `db.transaction(...)` so that:
 *   1. Happy path: all writes commit + post-commit side effects fire.
 *   2. DB failure mid-handler: every write rolls back AND post-commit side
 *      effects (packpoint, email, notify) are NOT called.
 *   3. Idempotent retry: replayed event short-circuits at claimStripeEvent;
 *      no double writes; second call returns { received, idempotent }.
 *
 * Implementation: in-memory store + lightweight Drizzle mock with a
 * `transaction(fn)` that exposes the same store handle (so test-only writes
 * via tx.* still target the same arrays); when `fn` throws, we revert by
 * snapshotting before the call and restoring on catch.
 *
 * All Stripe types come from server/_core/stripeMocks.ts (Module 2.1).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";
import {
  makeStripeEvent,
  makeCheckoutSession,
  makePaymentIntent,
} from "./stripeMocks";

// ─────────────────────────────────────────────────────────────────────
// In-memory stores
// ─────────────────────────────────────────────────────────────────────

interface PaymentRow {
  id: number;
  bookingId: number;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  amount: number;
  currency: string;
  paymentMethod: string;
  paymentType: string;
  paymentStatus: string;
  paidAt: Date | null;
}

interface BookingRow {
  id: number;
  userId: number | null;
  tourId: number;
  departureId: number;
  totalPrice: number;
  numberOfAdults: number;
  numberOfChildrenWithBed: number;
  numberOfChildrenNoBed: number;
  numberOfInfants: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  customerLanguage: string | null;
  paymentStatus: string;
  bookingStatus: string;
}

interface AccountingRow {
  id: number;
  entryType: string;
  category: string;
  amount: string;
  currency: string;
  description: string;
  bookingId: number | null;
  entryDate: Date;
  isTaxDeductible: number;
  createdBy: number;
}

const store = {
  payments: [] as PaymentRow[],
  bookings: [] as BookingRow[],
  accounting: [] as AccountingRow[],
  nextPaymentId: 1,
  nextAccountingId: 1,
  // Module 2.1 idempotency rows we simulate at the helper layer
  stripeEvents: new Map<string, { rowId: number; status: "processing" | "succeeded" | "failed" }>(),
  nextEventRowId: 1,
  // Side-effect spies
  sideEffects: {
    packpointCalls: 0,
    referralCalls: 0,
    abandonmentCancelCalls: 0,
    paymentSuccessEmailCalls: 0,
    supplierEmailCalls: 0,
    notifyOwnerCalls: 0,
    notifyAgentMessageCalls: 0,
  },
  // Hook to force createAccountingEntry to throw (used in DB-fail-rollback cases)
  shouldThrowOnAccounting: false,
  // Hook to force updatePaymentStatus to throw
  shouldThrowOnUpdatePaymentStatus: false,
  // markStripeEventFailed spy
  markFailedCalls: 0,
};

function resetStore() {
  store.payments = [];
  store.bookings = [];
  store.accounting = [];
  store.nextPaymentId = 1;
  store.nextAccountingId = 1;
  store.stripeEvents.clear();
  store.nextEventRowId = 1;
  store.sideEffects = {
    packpointCalls: 0,
    referralCalls: 0,
    abandonmentCancelCalls: 0,
    paymentSuccessEmailCalls: 0,
    supplierEmailCalls: 0,
    notifyOwnerCalls: 0,
    notifyAgentMessageCalls: 0,
  };
  store.shouldThrowOnAccounting = false;
  store.shouldThrowOnUpdatePaymentStatus = false;
  store.markFailedCalls = 0;
}

function seedBooking(overrides: Partial<BookingRow> = {}): BookingRow {
  const b: BookingRow = {
    id: 100,
    userId: 7,
    tourId: 42,
    departureId: 9,
    totalPrice: 1000,
    numberOfAdults: 2,
    numberOfChildrenWithBed: 0,
    numberOfChildrenNoBed: 0,
    numberOfInfants: 0,
    customerName: "Jeff Test",
    customerEmail: "test@example.com",
    customerPhone: null,
    customerLanguage: null,
    paymentStatus: "unpaid",
    bookingStatus: "pending",
    ...overrides,
  };
  store.bookings.push(b);
  return b;
}

function seedPayment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  const p: PaymentRow = {
    id: store.nextPaymentId++,
    bookingId: 100,
    stripePaymentIntentId: overrides.stripePaymentIntentId ?? "pi_seeded",
    stripeCheckoutSessionId: null,
    amount: 100,
    currency: "USD",
    paymentMethod: "stripe",
    paymentType: "full",
    paymentStatus: "pending",
    paidAt: null,
    ...overrides,
  };
  store.payments.push(p);
  return p;
}

// ─────────────────────────────────────────────────────────────────────
// Drizzle-ish mock with transaction support + rollback
// ─────────────────────────────────────────────────────────────────────

function snapshot() {
  return {
    payments: store.payments.map((r) => ({ ...r })),
    bookings: store.bookings.map((r) => ({ ...r })),
    accounting: store.accounting.map((r) => ({ ...r })),
    nextPaymentId: store.nextPaymentId,
    nextAccountingId: store.nextAccountingId,
  };
}

function restore(snap: ReturnType<typeof snapshot>) {
  store.payments = snap.payments;
  store.bookings = snap.bookings;
  store.accounting = snap.accounting;
  store.nextPaymentId = snap.nextPaymentId;
  store.nextAccountingId = snap.nextAccountingId;
}

function buildMockDb() {
  const handle = {
    async transaction(fn: (tx: any) => Promise<unknown>) {
      const before = snapshot();
      try {
        return await fn(handle);
      } catch (err) {
        restore(before);
        throw err;
      }
    },
  };
  return handle;
}

// ─────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────

vi.mock("../db", () => {
  return {
    getDb: vi.fn(async () => buildMockDb()),
    getBookingById: vi.fn(async (id: number) => store.bookings.find((b) => b.id === id) ?? null),
    getPaymentByIntentId: vi.fn(async (intentId: string) =>
      store.payments.find((p) => p.stripePaymentIntentId === intentId) ?? null
    ),
    getTourById: vi.fn(async (_id: number) => ({
      id: 42,
      title: "Test Tour",
      supplierEmail: null,
      supplierName: null,
      supplierNotes: null,
    })),
    createPayment: vi.fn(async (payment: any, _tx?: any) => {
      const row: PaymentRow = {
        id: store.nextPaymentId++,
        bookingId: payment.bookingId,
        stripePaymentIntentId: payment.stripePaymentIntentId ?? null,
        stripeCheckoutSessionId: payment.stripeCheckoutSessionId ?? null,
        amount: payment.amount,
        currency: payment.currency,
        paymentMethod: payment.paymentMethod,
        paymentType: payment.paymentType,
        paymentStatus: payment.paymentStatus,
        paidAt: payment.paidAt ?? null,
      };
      store.payments.push(row);
      return row;
    }),
    updateBooking: vi.fn(async (id: number, updates: any, _tx?: any) => {
      const b = store.bookings.find((row) => row.id === id);
      if (!b) throw new Error("booking not found");
      Object.assign(b, updates);
      return b;
    }),
    updatePaymentStatus: vi.fn(
      async (intentId: string, status: string, paidAt?: Date, _tx?: any) => {
        if (store.shouldThrowOnUpdatePaymentStatus) {
          throw new Error("simulated DB connection drop");
        }
        const p = store.payments.find((row) => row.stripePaymentIntentId === intentId);
        if (!p) throw new Error(`payment ${intentId} not found`);
        p.paymentStatus = status;
        if (paidAt) p.paidAt = paidAt;
        return p;
      }
    ),
    createAccountingEntry: vi.fn(async (data: any, _tx?: any) => {
      if (store.shouldThrowOnAccounting) {
        throw new Error("simulated accounting insert failure");
      }
      const row: AccountingRow = {
        id: store.nextAccountingId++,
        entryType: data.entryType,
        category: data.category,
        amount: data.amount,
        currency: data.currency,
        description: data.description,
        bookingId: data.bookingId ?? null,
        entryDate: data.entryDate,
        isTaxDeductible: data.isTaxDeductible,
        createdBy: data.createdBy,
      };
      store.accounting.push(row);
      return row;
    }),
  };
});

// stripeWebhook.ts also does `import { createAccountingEntry } from "../db";`
// — this comes from the `../db` mock above, BUT it captures the reference at
// module-load time. Because Vitest hoists vi.mock, the spy is captured cleanly.

vi.mock("./stripeWebhookIdempotency", () => ({
  claimStripeEvent: vi.fn(async (event: { id: string; type: string }) => {
    const existing = store.stripeEvents.get(event.id);
    if (existing) {
      return { alreadyProcessed: true, existingStatus: existing.status };
    }
    const rowId = store.nextEventRowId++;
    store.stripeEvents.set(event.id, { rowId, status: "processing" });
    return { alreadyProcessed: false, rowId };
  }),
  markStripeEventSucceeded: vi.fn(async (rowId: number) => {
    for (const [, v] of store.stripeEvents) {
      if (v.rowId === rowId) v.status = "succeeded";
    }
  }),
  markStripeEventFailed: vi.fn(async (rowId: number, _err: unknown) => {
    store.markFailedCalls += 1;
    for (const [, v] of store.stripeEvents) {
      if (v.rowId === rowId) v.status = "failed";
    }
  }),
}));

// Side-effect modules (dynamic imports inside the handler) — mock each to
// just bump a counter so we can assert call-or-no-call after rollback.
vi.mock("./packpoint", () => ({
  awardBookingPackpoint: vi.fn(async () => {
    store.sideEffects.packpointCalls += 1;
    return 10; // pretend we awarded 10 points
  }),
}));
vi.mock("./referral", () => ({
  awardReferralOnFirstBooking: vi.fn(async () => {
    store.sideEffects.referralCalls += 1;
  }),
}));
vi.mock("../queues/abandonmentRecoveryQueue", () => ({
  cancelAbandonmentRecovery: vi.fn(async () => {
    store.sideEffects.abandonmentCancelCalls += 1;
  }),
}));
vi.mock("../email", () => ({
  sendPaymentSuccessEmail: vi.fn(async () => {
    store.sideEffects.paymentSuccessEmailCalls += 1;
  }),
  sendSupplierNotificationEmail: vi.fn(async () => {
    store.sideEffects.supplierEmailCalls += 1;
  }),
  sendTrialEndingReminder: vi.fn(async () => {}),
}));
vi.mock("../services/visaEmailService", () => ({
  sendVisaApplicationConfirmation: vi.fn(async () => {}),
}));
vi.mock("./notification", () => ({
  notifyOwner: vi.fn(async () => {
    store.sideEffects.notifyOwnerCalls += 1;
  }),
}));
vi.mock("./agentNotify", () => ({
  notifyAgentMessage: vi.fn(async () => {
    store.sideEffects.notifyAgentMessageCalls += 1;
  }),
}));
vi.mock("./redact", () => ({
  redactEmail: (e: string) => e,
}));
vi.mock("./membershipPricing", () => ({
  tierFromPriceId: () => null,
}));

// Stripe constructor + webhooks.constructEvent — return the event passed via
// req.body verbatim (which we'll set to a pre-built makeStripeEvent payload).
vi.mock("stripe", () => {
  return {
    default: class FakeStripe {
      webhooks = {
        constructEvent: (body: any) => {
          // body is the already-shaped Stripe.Event for these tests
          return typeof body === "string" ? JSON.parse(body) : body;
        },
      };
      subscriptions = { retrieve: vi.fn(async () => ({})) };
    },
  };
});

// ENV mock — handler reads ENV.stripeSecretKey + .stripeWebhookSecret
vi.mock("./env", () => ({
  ENV: {
    stripeSecretKey: "sk_test_fake",
    stripeWebhookSecret: "whsec_test_fake",
    baseUrl: "https://packgoplay.com",
  },
}));

// drizzle/schema — minimal stub for the schema imports that the handler
// pulls in lazily for the refund path; our tests don't hit those branches
// but the test loader resolves these regardless.
vi.mock("../../drizzle/schema", () => ({
  stripeWebhookEvents: { eventId: "eventId" },
  bookings: { id: "id", bookingStatus: "bookingStatus" },
  users: {
    id: "id",
    email: "email",
    name: "name",
    stripeCustomerId: "stripeCustomerId",
    stripeSubscriptionId: "stripeSubscriptionId",
    tier: "tier",
    tierExpiresAt: "tierExpiresAt",
  },
  tourDepartures: { id: "id" },
  membershipTrials: { id: "id", stripeSubscriptionId: "stripeSubscriptionId" },
  pointsTransactions: {
    referenceType: "referenceType",
    referenceId: "referenceId",
    reason: "reason",
    delta: "delta",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  ne: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

// ─────────────────────────────────────────────────────────────────────
// Import AFTER all mocks are registered
// ─────────────────────────────────────────────────────────────────────

import { handleStripeWebhook } from "./stripeWebhook";

// ─────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────

function buildReqRes(event: any): { req: Request; res: Response; statusFn: ReturnType<typeof vi.fn>; jsonFn: ReturnType<typeof vi.fn>; sendFn: ReturnType<typeof vi.fn> } {
  const statusFn = vi.fn().mockImplementation(() => res);
  const jsonFn = vi.fn().mockImplementation(() => res);
  const sendFn = vi.fn().mockImplementation(() => res);
  const res = { status: statusFn, json: jsonFn, send: sendFn } as unknown as Response;
  const req = {
    headers: { "stripe-signature": "t=1,v1=fake" },
    body: event,
  } as unknown as Request;
  return { req, res, statusFn, jsonFn, sendFn };
}

// ─────────────────────────────────────────────────────────────────────
// Cases
// ─────────────────────────────────────────────────────────────────────

describe("stripeWebhook booking handlers — transaction atomicity", () => {
  beforeEach(() => {
    resetStore();
  });

  // ───────────────────── checkout.session.completed ─────────────────────

  it("case 1 — checkout.session.completed: happy path commits all writes + fires side effects", async () => {
    seedBooking({ id: 100, userId: 7, totalPrice: 1000 });
    const session = makeCheckoutSession({
      bookingId: "100",
      paymentType: "full",
      paymentIntent: "pi_happy_1",
      amount: 100000, // $1000 in cents
      currency: "usd",
    });
    const event = makeStripeEvent({
      type: "checkout.session.completed",
      data: session,
      id: `evt_real_${Math.random().toString(36).slice(2)}`,
    });

    const { req, res, jsonFn } = buildReqRes(event);
    await handleStripeWebhook(req, res);

    // Atomic writes committed
    expect(store.payments).toHaveLength(1);
    expect(store.payments[0].stripePaymentIntentId).toBe("pi_happy_1");
    expect(store.payments[0].paymentStatus).toBe("completed");
    const b = store.bookings[0];
    expect(b.paymentStatus).toBe("paid");
    expect(b.bookingStatus).toBe("confirmed");
    expect(store.accounting).toHaveLength(1);
    expect(store.accounting[0].entryType).toBe("income");
    // Post-commit side effects fired
    expect(store.sideEffects.packpointCalls).toBe(1);
    expect(store.sideEffects.referralCalls).toBe(1);
    expect(store.sideEffects.abandonmentCancelCalls).toBe(1);
    expect(store.sideEffects.paymentSuccessEmailCalls).toBe(1);
    expect(store.sideEffects.notifyOwnerCalls).toBe(1);
    // Webhook response
    expect(jsonFn).toHaveBeenCalledWith({ received: true });
  });

  it("case 2 — checkout.session.completed: createAccountingEntry throws → tx rolls back + side effects NOT called", async () => {
    seedBooking({ id: 100, userId: 7, totalPrice: 1000 });
    store.shouldThrowOnAccounting = true;
    const session = makeCheckoutSession({
      bookingId: "100",
      paymentType: "full",
      paymentIntent: "pi_fail_2",
      amount: 100000,
      currency: "usd",
    });
    const event = makeStripeEvent({
      type: "checkout.session.completed",
      data: session,
      id: `evt_real_${Math.random().toString(36).slice(2)}`,
    });

    const { req, res, statusFn } = buildReqRes(event);
    await handleStripeWebhook(req, res);

    // Transaction rolled back: NO payment row, booking unchanged
    expect(store.payments).toHaveLength(0);
    const b = store.bookings[0];
    expect(b.paymentStatus).toBe("unpaid");
    expect(b.bookingStatus).toBe("pending");
    expect(store.accounting).toHaveLength(0);
    // Post-commit side effects skipped
    expect(store.sideEffects.packpointCalls).toBe(0);
    expect(store.sideEffects.referralCalls).toBe(0);
    expect(store.sideEffects.paymentSuccessEmailCalls).toBe(0);
    expect(store.sideEffects.notifyOwnerCalls).toBe(0);
    // markStripeEventFailed called + 500 surfaced for Stripe retry
    expect(store.markFailedCalls).toBe(1);
    expect(statusFn).toHaveBeenCalledWith(500);
  });

  it("case 3 — checkout.session.completed: replayed event short-circuits at claimStripeEvent (idempotent)", async () => {
    seedBooking({ id: 100, userId: 7, totalPrice: 1000 });
    const session = makeCheckoutSession({
      bookingId: "100",
      paymentType: "full",
      paymentIntent: "pi_idemp_3",
      amount: 100000,
      currency: "usd",
    });
    const event = makeStripeEvent({
      type: "checkout.session.completed",
      data: session,
      id: `evt_real_${Math.random().toString(36).slice(2)}`,
    });

    // First delivery — runs full pipeline
    const first = buildReqRes(event);
    await handleStripeWebhook(first.req, first.res);
    expect(store.payments).toHaveLength(1);
    expect(store.accounting).toHaveLength(1);
    expect(store.sideEffects.packpointCalls).toBe(1);

    // Second delivery of the SAME event.id — should short-circuit
    const second = buildReqRes(event);
    await handleStripeWebhook(second.req, second.res);

    // No double writes
    expect(store.payments).toHaveLength(1);
    expect(store.accounting).toHaveLength(1);
    expect(store.sideEffects.packpointCalls).toBe(1);
    expect(second.jsonFn).toHaveBeenCalledWith({ received: true, idempotent: true });
  });

  // ───────────────────── payment_intent.succeeded ─────────────────────

  it("case 4 — payment_intent.succeeded: happy path flips payment to completed", async () => {
    seedPayment({ stripePaymentIntentId: "pi_succ_4", paymentStatus: "pending" });
    const pi = makePaymentIntent({ id: "pi_succ_4", status: "succeeded" });
    const event = makeStripeEvent({
      type: "payment_intent.succeeded",
      data: pi,
      id: `evt_real_${Math.random().toString(36).slice(2)}`,
    });

    const { req, res, jsonFn } = buildReqRes(event);
    await handleStripeWebhook(req, res);

    const p = store.payments.find((row) => row.stripePaymentIntentId === "pi_succ_4");
    expect(p?.paymentStatus).toBe("completed");
    expect(p?.paidAt).toBeInstanceOf(Date);
    expect(jsonFn).toHaveBeenCalledWith({ received: true });
  });

  it("case 5 — payment_intent.succeeded: updatePaymentStatus throws → tx rolls back, 500 surfaced", async () => {
    seedPayment({ stripePaymentIntentId: "pi_fail_5", paymentStatus: "pending" });
    store.shouldThrowOnUpdatePaymentStatus = true;
    const pi = makePaymentIntent({ id: "pi_fail_5" });
    const event = makeStripeEvent({
      type: "payment_intent.succeeded",
      data: pi,
      id: `evt_real_${Math.random().toString(36).slice(2)}`,
    });

    const { req, res, statusFn } = buildReqRes(event);
    await handleStripeWebhook(req, res);

    const p = store.payments.find((row) => row.stripePaymentIntentId === "pi_fail_5");
    // Status unchanged because the mock threw before mutating
    expect(p?.paymentStatus).toBe("pending");
    expect(store.markFailedCalls).toBe(1);
    expect(statusFn).toHaveBeenCalledWith(500);
  });

  it("case 6 — payment_intent.succeeded: replayed event short-circuits (idempotent)", async () => {
    seedPayment({ stripePaymentIntentId: "pi_idemp_6", paymentStatus: "pending" });
    const pi = makePaymentIntent({ id: "pi_idemp_6" });
    const event = makeStripeEvent({
      type: "payment_intent.succeeded",
      data: pi,
      id: `evt_real_${Math.random().toString(36).slice(2)}`,
    });

    const first = buildReqRes(event);
    await handleStripeWebhook(first.req, first.res);
    const p1 = store.payments.find((row) => row.stripePaymentIntentId === "pi_idemp_6");
    expect(p1?.paymentStatus).toBe("completed");
    const firstPaidAt = p1?.paidAt;

    const second = buildReqRes(event);
    await handleStripeWebhook(second.req, second.res);

    const p2 = store.payments.find((row) => row.stripePaymentIntentId === "pi_idemp_6");
    // paidAt unchanged — no second write happened
    expect(p2?.paidAt).toBe(firstPaidAt);
    expect(second.jsonFn).toHaveBeenCalledWith({ received: true, idempotent: true });
  });

  // ───────────────────── payment_intent.payment_failed ─────────────────────

  it("case 7 — payment_intent.payment_failed: happy path flips payment to failed", async () => {
    seedPayment({ stripePaymentIntentId: "pi_failed_7", paymentStatus: "pending" });
    const pi = makePaymentIntent({ id: "pi_failed_7", status: "requires_payment_method" });
    const event = makeStripeEvent({
      type: "payment_intent.payment_failed",
      data: pi,
      id: `evt_real_${Math.random().toString(36).slice(2)}`,
    });

    const { req, res, jsonFn } = buildReqRes(event);
    await handleStripeWebhook(req, res);

    const p = store.payments.find((row) => row.stripePaymentIntentId === "pi_failed_7");
    expect(p?.paymentStatus).toBe("failed");
    expect(jsonFn).toHaveBeenCalledWith({ received: true });
  });

  it("case 8 — payment_intent.payment_failed: updatePaymentStatus throws → tx rolls back, 500 surfaced", async () => {
    seedPayment({ stripePaymentIntentId: "pi_failed_8", paymentStatus: "pending" });
    store.shouldThrowOnUpdatePaymentStatus = true;
    const pi = makePaymentIntent({ id: "pi_failed_8" });
    const event = makeStripeEvent({
      type: "payment_intent.payment_failed",
      data: pi,
      id: `evt_real_${Math.random().toString(36).slice(2)}`,
    });

    const { req, res, statusFn } = buildReqRes(event);
    await handleStripeWebhook(req, res);

    const p = store.payments.find((row) => row.stripePaymentIntentId === "pi_failed_8");
    expect(p?.paymentStatus).toBe("pending");
    expect(store.markFailedCalls).toBe(1);
    expect(statusFn).toHaveBeenCalledWith(500);
  });

  it("case 9 — payment_intent.payment_failed: replayed event short-circuits (idempotent)", async () => {
    seedPayment({ stripePaymentIntentId: "pi_idemp_9", paymentStatus: "pending" });
    const pi = makePaymentIntent({ id: "pi_idemp_9" });
    const event = makeStripeEvent({
      type: "payment_intent.payment_failed",
      data: pi,
      id: `evt_real_${Math.random().toString(36).slice(2)}`,
    });

    const first = buildReqRes(event);
    await handleStripeWebhook(first.req, first.res);
    const p1 = store.payments.find((row) => row.stripePaymentIntentId === "pi_idemp_9");
    expect(p1?.paymentStatus).toBe("failed");

    const second = buildReqRes(event);
    await handleStripeWebhook(second.req, second.res);

    // Status still "failed" — no second write
    const p2 = store.payments.find((row) => row.stripePaymentIntentId === "pi_idemp_9");
    expect(p2?.paymentStatus).toBe("failed");
    expect(second.jsonFn).toHaveBeenCalledWith({ received: true, idempotent: true });
  });
});
