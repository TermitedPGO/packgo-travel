/**
 * Bookings payment router — Stripe Checkout + admin refund procedures.
 *
 * Extracted from server/routers/bookings.ts (Phase 4D · sub-PR 4 of 5)
 * on 2026-05-19 as the SOLO REVIEW money-path PR (audit P0-1, P0-2).
 * Source range (verbatim from bookings.ts): createCheckoutSession L599-753,
 * adminRefund L884-1036.
 *
 * Procedures (2):
 *   createCheckoutSession – Stripe Checkout Session creation
 *   adminRefund           – Stripe Refund issuance + DB optimistic update
 *
 * Composed back into `bookings:` via spread in server/routers.ts so existing
 * client paths trpc.bookings.createCheckoutSession / trpc.bookings.adminRefund
 * resolve unchanged.
 *
 * Behavioral coverage: see server/_core/stripeWebhook.bookings.test.ts and
 * server/_core/stripeWebhook.refunds.test.ts (31 cases from Phase 2). This
 * Phase 4D extraction is STRUCTURAL only — no procedure body changes.
 *
 * Security notes (preserved from origin):
 *   - v74: Stripe idempotency key on checkout (kills double-tab double-charge)
 *   - v76: California sales tax server-computed at checkout; adminRefund with
 *     Stripe idempotency + DB optimistic update + seat release + audit
 *
 * IMPORTANT: The Stripe lazy initializer originally lived in routers/bookings.ts
 * (mirroring the one in routers.ts). Since these are the only two procedures
 * in bookings.ts that called it, the initializer was moved here entirely; the
 * `bookings.ts` copy was removed. routers.ts still keeps its own copy for visa
 * + subscription procedures that haven't been extracted yet.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { checkCheckoutSessionRateLimit } from "../rateLimit";
import { ENV } from "../_core/env";

// v74 bounded string helpers — kept in sync with the originals in routers.ts.
// Without max bounds, attackers can send 10MB payloads per field and DoS the
// DB / LLM pipeline. Also strip ASCII control chars (NULL/BEL/ESC/DEL) which
// were persisting verbatim into MySQL columns — known WAF-evasion vector.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const noControlChars = (s: string) => !CONTROL_CHARS.test(s);
const shortStr = z.string().max(255).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });

// P0-1: Lazy-load Stripe to prevent server crash when STRIPE_SECRET_KEY is not set.
// Mirrors the helper in routers.ts; both instances share no state but neither needs to.
let _stripeClient: Stripe | null = null;
function getStripeClient(): Stripe {
  if (!_stripeClient) {
    if (!ENV.stripeSecretKey) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Stripe 付款服務尚未設定，請聯絡管理員",
      });
    }
    _stripeClient = new Stripe(ENV.stripeSecretKey);
  }
  return _stripeClient;
}

export const bookingsPaymentRouter = router({
    // Create Stripe checkout session
    createCheckoutSession: protectedProcedure
      .input(
        z.object({
          bookingId: z.number().int().positive().max(2_147_483_647),
          paymentType: z.enum(["deposit", "remaining"]),
          // v76: optional billing-address hints used to compute CA sales tax
          // server-side. If omitted we fall back to the customer's profile or
          // their previous booking; if still unknown we skip tax (non-CA).
          billingState: shortStr.optional(),
          billingCity: shortStr.optional(),
          billingPostalCode: shortStr.optional(),
          billingCountry: shortStr.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Rate limiting: 20 checkout sessions per hour per user
        const checkoutRateLimit = await checkCheckoutSessionRateLimit(ctx.user.id);
        if (!checkoutRateLimit.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "付款請求過於頻繁，請稍後再試",
          });
        }

        const booking = await db.getBookingById(input.bookingId);
        if (!booking) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Booking not found",
          });
        }

        // Check if user owns this booking
        if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You don't have permission to pay for this booking",
          });
        }

        const amount = input.paymentType === "deposit" ? booking.depositAmount : booking.remainingAmount;
        const description = input.paymentType === "deposit" ? "訂金" : "尾款";

        if (amount <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "付款金額無效",
          });
        }

        // Get tour info for product name
        const tour = await db.getTourById(booking.tourId);
        const tourTitle = tour?.title ?? `行程 #${booking.tourId}`;

        // P0-1: Real Stripe Checkout Session
        const stripe = getStripeClient();
        const baseUrl = ENV.baseUrl;

        // Stripe amounts are in smallest currency unit
        // TWD is a zero-decimal currency (no cents), so amount is already in TWD
        // For other currencies like USD, multiply by 100
        const currency = (booking.currency ?? "TWD").toLowerCase();
        const zeroDecimalCurrencies = ["bif", "clp", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "twd", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"];
        const stripeAmount = zeroDecimalCurrencies.includes(currency) ? amount : Math.round(amount * 100);

        // v74: Stripe idempotency key. Prevents the double-charge race where a
        // user opens the booking page in two browser tabs and clicks "Pay" in
        // both simultaneously — without an idempotency key Stripe creates two
        // distinct checkout sessions (different payment_intents), and the
        // webhook idempotency guard (which dedupes by payment_intent) doesn't
        // catch them. With this key, the second request returns the same
        // session as the first within Stripe's 24-hour idempotency window.
        const idempotencyKey = `co:${booking.id}:${input.paymentType}:${new Date().toISOString().slice(0, 10)}`;

        // v76: California sales tax — compute server-side from billing-address
        // hints, add as a separate Stripe line item so customer sees breakdown.
        const { calculateSalesTax } = await import("../services/salesTaxService");
        const taxResult = calculateSalesTax(amount, {
          country: input.billingCountry || "US",
          state: input.billingState || "",
          city: input.billingCity || "",
          postalCode: input.billingPostalCode || "",
        });
        const taxStripeAmount =
          taxResult.amount > 0
            ? (zeroDecimalCurrencies.includes(currency)
                ? Math.round(taxResult.amount)
                : Math.round(taxResult.amount * 100))
            : 0;

        const lineItems: any[] = [
          {
            price_data: {
              currency,
              unit_amount: stripeAmount,
              product_data: {
                name: `${tourTitle} - ${description}`,
                description: `訂單編號 #${booking.id}, ${booking.customerName}`,
              },
            },
            quantity: 1,
          },
        ];
        if (taxStripeAmount > 0) {
          lineItems.push({
            price_data: {
              currency,
              unit_amount: taxStripeAmount,
              product_data: {
                name: `Sales Tax (${(taxResult.rate * 100).toFixed(3)}%) — ${taxResult.jurisdiction}`,
                description: `California sales tax on order #${booking.id}`,
              },
            },
            quantity: 1,
          });
        }

        const session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            payment_method_types: ["card"],
            line_items: lineItems,
            metadata: {
              booking_id: String(booking.id),
              payment_type: input.paymentType,
              tour_id: String(booking.tourId),
              user_id: String(ctx.user.id),
              // v76: tax info persisted to webhook metadata for accounting reconciliation
              tax_rate: String(taxResult.rate),
              tax_amount: String(taxResult.amount),
              tax_jurisdiction: taxResult.jurisdiction,
            },
            customer_email: booking.customerEmail,
            success_url: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}`,
            cancel_url: `${baseUrl}/booking/${booking.id}?payment_cancelled=1`,
            expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // 60 minutes (extended for older clientele)
          },
          { idempotencyKey }
        );

        if (!session.url) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "無法建立 Stripe 付款連結，請稍後再試",
          });
        }

        console.log(`[Stripe] Created checkout session ${session.id} for booking ${booking.id}, amount ${stripeAmount} ${currency}`);

        return {
          url: session.url,
          sessionId: session.id,
        };
      }),

    // v76: Admin-initiated refund flow.
    //
    // Replaces the prior "ops manually refund via Stripe dashboard" pattern,
    // which left our DB out of sync (booking status said "paid" while Stripe
    // had already returned the money). Now:
    //   1. Admin calls this endpoint with bookingId + amount + reason.
    //   2. We look up the latest successful payment row for the booking.
    //   3. Call Stripe API with idempotency key to reverse the charge.
    //   4. Optimistically mark our DB to refunded (the existing
    //      `charge.refunded` webhook handler dedupes when Stripe confirms).
    //   5. Release the departure slots so the seats are bookable again.
    //   6. Audit trail with reason captured.
    //
    // Also handles partial refunds (amount < original charge): payment row
    // stays "paid" but a separate refunds entry tracks the partial.
    adminRefund: adminProcedure
      .input(
        z.object({
          bookingId: z.number().int().positive().max(2_147_483_647),
          // Optional: partial refund. If omitted, full amount is refunded.
          amount: z.number().min(0.01).max(100_000_000).optional(),
          reason: z.string().min(1).max(500),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { audit } = await import("../_core/auditLog");

        const booking = await db.getBookingById(input.bookingId);
        if (!booking) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }

        // Find the most recent successful payment for this booking
        const payments = await db.getBookingPayments(input.bookingId);
        const successful = (payments || []).filter(
          (p: any) => p.paymentStatus === "completed" && p.stripePaymentIntentId
        );
        if (successful.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "此訂單沒有可退款的付款紀錄",
          });
        }
        // Refund the latest payment first (deposit, then balance, etc.)
        const target = successful[successful.length - 1];
        const targetIntentId = target.stripePaymentIntentId;
        if (!targetIntentId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "此付款紀錄無 Stripe payment intent，無法退款",
          });
        }
        const originalAmount = Number(target.amount) || 0;

        const refundAmount = input.amount ?? originalAmount;
        if (refundAmount > originalAmount) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `退款金額不可超過原付款金額 (${originalAmount})`,
          });
        }

        const stripe = getStripeClient();
        // Stripe amount: zero-decimal currencies (TWD/JPY/etc.) don't multiply.
        const currency = (target.currency || booking.currency || "TWD").toLowerCase();
        const zeroDecimalCurrencies = ["bif", "clp", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "twd", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"];
        const stripeRefundAmount = zeroDecimalCurrencies.includes(currency)
          ? Math.round(refundAmount)
          : Math.round(refundAmount * 100);

        // Idempotency key: same booking+payment+date won't double-refund even
        // if the admin double-clicks.
        const idempotencyKey = `refund:${input.bookingId}:${target.id}:${new Date().toISOString().slice(0, 10)}`;

        let stripeRefund;
        try {
          stripeRefund = await stripe.refunds.create(
            {
              payment_intent: targetIntentId,
              amount: stripeRefundAmount,
              reason: "requested_by_customer",
              metadata: {
                booking_id: String(input.bookingId),
                admin_user_id: String(ctx.user.id),
                admin_reason: input.reason.slice(0, 500),
              },
            },
            { idempotencyKey }
          );
        } catch (err: any) {
          // Stripe errored — DON'T touch our DB; surface error to admin
          console.error(`[bookings.adminRefund] Stripe refund failed:`, err?.message);
          audit({
            ctx,
            action: "booking.refund",
            targetType: "booking",
            targetId: input.bookingId,
            changes: { intentId: targetIntentId, amount: refundAmount },
            reason: input.reason,
            success: false,
            errorMessage: err?.message?.slice(0, 200) || "Stripe error",
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Stripe 退款失敗：${err?.message || "未知錯誤"}`,
          });
        }

        const isFullRefund = refundAmount >= originalAmount;

        // Optimistically update DB. Webhook will dedupe via paymentStatus check.
        if (isFullRefund) {
          await db.updateBooking(input.bookingId, {
            paymentStatus: "refunded",
            bookingStatus: "cancelled",
          });
          // Release seats (idempotent at SQL level)
          const seatCount =
            (booking.numberOfAdults || 0) +
            (booking.numberOfChildrenWithBed || 0) +
            (booking.numberOfChildrenNoBed || 0);
          if (seatCount > 0 && booking.departureId && booking.bookingStatus !== "cancelled") {
            await db.releaseDepartureSlots(booking.departureId, seatCount).catch((e) =>
              console.warn(`[bookings.adminRefund] release slots failed:`, e?.message)
            );
          }
        }
        // Partial refund: leave paymentStatus="paid"; the partial is recorded
        // in Stripe and surfaced to ops via the webhook's partial-refund log.

        audit({
          ctx,
          action: "booking.refund",
          targetType: "booking",
          targetId: input.bookingId,
          changes: {
            stripeRefundId: stripeRefund.id,
            paymentIntentId: targetIntentId,
            amount: refundAmount,
            originalAmount,
            isFullRefund,
          },
          reason: input.reason,
          success: true,
        });

        return {
          success: true,
          refundId: stripeRefund.id,
          amount: refundAmount,
          isFullRefund,
        };
      }),
  });
