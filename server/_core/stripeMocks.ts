/**
 * Stripe object factories for Vitest.
 *
 * Shared by Phase 2 modules 1–5. Each factory returns a fully-typed
 * `Stripe.*` object populated with only the fields the corresponding
 * stripeWebhook.ts handler actually reads. Overrides are deep-merged on
 * top so individual test cases stay terse.
 *
 * These factories are NEVER used at runtime — `stripeMocks` is a test
 * fixture module imported only from `*.test.ts`.
 */

import type Stripe from "stripe";

/** Monotonic counter so each call gets a unique id when none is supplied. */
let _idCounter = 0;
function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}_test_${Date.now()}_${_idCounter}`;
}

// ─────────────────────────────────────────────────────────────────────
// makeStripeEvent — top-level dispatch object
// ─────────────────────────────────────────────────────────────────────

export interface MakeStripeEventInput<T = Record<string, unknown>> {
  type: Stripe.Event.Type;
  id?: string;
  data: T;
}

export function makeStripeEvent<T>(input: MakeStripeEventInput<T>): Stripe.Event {
  return {
    id: input.id ?? nextId("evt"),
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    data: { object: input.data as unknown as Stripe.Event.Data.Object },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: input.type,
  } as Stripe.Event;
}

// ─────────────────────────────────────────────────────────────────────
// makeCheckoutSession
// ─────────────────────────────────────────────────────────────────────

export interface MakeCheckoutSessionInput {
  bookingId?: string;
  paymentType?: "deposit" | "balance" | "full";
  paymentIntent?: string;
  amount?: number;
  currency?: string;
  mode?: Stripe.Checkout.Session.Mode;
  subscription?: string | null;
  metadata?: Record<string, string>;
  id?: string;
}

export function makeCheckoutSession(
  input: MakeCheckoutSessionInput = {}
): Stripe.Checkout.Session {
  const metadata: Record<string, string> = {
    ...(input.bookingId ? { booking_id: input.bookingId } : {}),
    ...(input.paymentType ? { payment_type: input.paymentType } : {}),
    ...(input.metadata ?? {}),
  };
  return {
    id: input.id ?? nextId("cs"),
    object: "checkout.session",
    amount_total: input.amount ?? 10000,
    currency: input.currency ?? "usd",
    mode: input.mode ?? "payment",
    payment_intent: input.paymentIntent ?? nextId("pi"),
    subscription: input.subscription ?? null,
    metadata,
    status: "complete",
    payment_status: "paid",
  } as unknown as Stripe.Checkout.Session;
}

// ─────────────────────────────────────────────────────────────────────
// makePaymentIntent
// ─────────────────────────────────────────────────────────────────────

export interface MakePaymentIntentInput {
  id?: string;
  status?: Stripe.PaymentIntent.Status;
  metadata?: Record<string, string>;
  amount?: number;
  currency?: string;
}

export function makePaymentIntent(
  input: MakePaymentIntentInput = {}
): Stripe.PaymentIntent {
  return {
    id: input.id ?? nextId("pi"),
    object: "payment_intent",
    status: input.status ?? "succeeded",
    metadata: input.metadata ?? {},
    amount: input.amount ?? 10000,
    currency: input.currency ?? "usd",
  } as unknown as Stripe.PaymentIntent;
}

// ─────────────────────────────────────────────────────────────────────
// makeCharge
// ─────────────────────────────────────────────────────────────────────

export interface MakeChargeInput {
  id?: string;
  paymentIntent?: string;
  amount?: number;
  amount_refunded?: number;
  currency?: string;
}

export function makeCharge(input: MakeChargeInput = {}): Stripe.Charge {
  const amount = input.amount ?? 10000;
  return {
    id: input.id ?? nextId("ch"),
    object: "charge",
    payment_intent: input.paymentIntent ?? nextId("pi"),
    amount,
    amount_refunded: input.amount_refunded ?? amount,
    currency: input.currency ?? "usd",
  } as unknown as Stripe.Charge;
}

// ─────────────────────────────────────────────────────────────────────
// makeSubscription
// ─────────────────────────────────────────────────────────────────────

export interface MakeSubscriptionInput {
  id?: string;
  customerId?: string;
  status?: Stripe.Subscription.Status;
  priceId?: string;
  unitAmount?: number;
  currency?: string;
  interval?: "month" | "year";
  currentPeriodEnd?: number;
  trialEnd?: number | null;
  metadata?: Record<string, string>;
}

export function makeSubscription(
  input: MakeSubscriptionInput = {}
): Stripe.Subscription {
  const nowSec = Math.floor(Date.now() / 1000);
  const periodEnd = input.currentPeriodEnd ?? nowSec + 30 * 86400;
  const priceId = input.priceId ?? nextId("price");
  return {
    id: input.id ?? nextId("sub"),
    object: "subscription",
    customer: input.customerId ?? nextId("cus"),
    status: input.status ?? "active",
    metadata: input.metadata ?? {},
    trial_end: input.trialEnd ?? null,
    current_period_end: periodEnd,
    items: {
      object: "list",
      data: [
        {
          id: nextId("si"),
          current_period_end: periodEnd,
          price: {
            id: priceId,
            object: "price",
            unit_amount: input.unitAmount ?? 999,
            currency: input.currency ?? "usd",
            recurring: {
              interval: input.interval ?? "month",
              interval_count: 1,
            },
          },
        },
      ],
      has_more: false,
      url: "",
    },
  } as unknown as Stripe.Subscription;
}
