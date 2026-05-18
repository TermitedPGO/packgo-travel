import { Request, Response } from "express";
import Stripe from "stripe";
import { ENV } from "./env";
import * as db from "../db";
import { sendPaymentSuccessEmail, sendSupplierNotificationEmail } from "../email";
import { sendVisaApplicationConfirmation } from "../services/visaEmailService";
import { createAccountingEntry } from "../db";
import { notifyOwner } from "./notification";
import { redactEmail } from "./redact";


// P0-2: Lazy-load Stripe to prevent server crash when STRIPE_SECRET_KEY is not set
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    if (!ENV.stripeSecretKey) {
      throw new Error('[Stripe] STRIPE_SECRET_KEY is not configured. Please set it in environment variables.');
    }
    _stripe = new Stripe(ENV.stripeSecretKey);
  }
  return _stripe;
}

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];

  if (!sig) {
    console.error("[Stripe Webhook] No signature found");
    return res.status(400).send("No signature found");
  }

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      sig,
      ENV.stripeWebhookSecret
    );
  } catch (err: any) {
    console.error(`[Stripe Webhook] Signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle test events
  if (event.id.startsWith("evt_test_")) {
    console.log("[Stripe Webhook] Test event detected, returning verification response");
    return res.json({
      verified: true,
    });
  }

  console.log(`[Stripe Webhook] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSessionCompleted(session);
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentSucceeded(paymentIntent);
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentFailed(paymentIntent);
        break;
      }

      // v74: handle refunds. Previously this event was silently ignored —
      // Stripe issued a refund (manual via dashboard or dispute), but the
      // booking row still showed paymentStatus='paid' indefinitely. Now we
      // sync paymentStatus to 'refunded' and create an audit trail.
      case "charge.refunded":
      case "charge.refund.updated": {
        const charge = event.data.object as Stripe.Charge;
        await handleChargeRefunded(charge);
        break;
      }

      // Round 80.20: Membership Phase 2 — subscription lifecycle.
      // Customer subscribes → set users.tier; cancels → reset to free.
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpserted(sub);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(sub);
        break;
      }

      // Round 81 / migration 0075 — AB 390 compliance for 10-day membership trial.
      // Fires ~3 days before the trial ends (Stripe sends this automatically when
      // the subscription was created with `trial_period_days`). California
      // Auto-Renewal Law (Bus. & Prof. Code §17602) requires advance notice of
      // the upcoming auto-charge between 3 and 21 days before — 3 days hits
      // that window. We send the reminder via Gmail SMTP (PACK&GO brand voice).
      case "customer.subscription.trial_will_end": {
        const sub = event.data.object as Stripe.Subscription;
        await handleTrialWillEnd(sub);
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error(`[Stripe Webhook] Error processing event: ${error.message}`);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  console.log("[Stripe Webhook] Processing checkout.session.completed");
  console.log("[Stripe Webhook] Session ID:", session.id);
  console.log("[Stripe Webhook] Payment Intent:", session.payment_intent);
  console.log("[Stripe Webhook] Mode:", session.mode);
  console.log("[Stripe Webhook] Metadata:", session.metadata);

  // Round 80.22: subscription checkout — promote user tier here as a safety
  // net. customer.subscription.created should also fire (and reach
  // handleSubscriptionUpserted), but this fallback means tier flips even if
  // the user only enabled `checkout.session.completed` in their webhook.
  if (session.mode === "subscription" && session.subscription) {
    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription.id;
    try {
      const sub = await getStripe().subscriptions.retrieve(subscriptionId);
      await handleSubscriptionUpserted(sub);
    } catch (err: any) {
      console.error(
        `[Stripe Webhook] Failed to promote tier from checkout.session.completed: ${err.message}`
      );
    }
    return;
  }

  const bookingId = session.metadata?.booking_id;
  const paymentType = session.metadata?.payment_type as "deposit" | "full" | "balance";
  const visaApplicationId = session.metadata?.visa_application_id;

  // Handle visa payment
  if (visaApplicationId) {
    await handleVisaPaymentCompleted(session, parseInt(visaApplicationId));
    return;
  }

  if (!bookingId) {
    console.error("[Stripe Webhook] No booking_id in session metadata");
    return;
  }

  // Get booking
  const booking = await db.getBookingById(parseInt(bookingId));
  if (!booking) {
    console.error(`[Stripe Webhook] Booking ${bookingId} not found`);
    return;
  }

  // Create payment record
  const paymentIntentId = session.payment_intent as string;
  const amount = session.amount_total ? session.amount_total / 100 : 0; // Convert from cents

  // v70: idempotency guard — Stripe retries webhook deliveries on transient
  // failures (timeouts, 5xx). Without this check we'd insert duplicate payment
  // rows for the same payment_intent and double-flip the booking status, which
  // can also trigger duplicate accounting entries below.
  if (paymentIntentId) {
    const existing = await db.getPaymentByIntentId(paymentIntentId);
    if (existing) {
      console.log(
        `[Stripe Webhook] Idempotent skip: payment ${paymentIntentId} already recorded (id=${existing.id})`
      );
      return;
    }
  }

  await db.createPayment({
    bookingId: parseInt(bookingId),
    stripePaymentIntentId: paymentIntentId,
    stripeCheckoutSessionId: session.id,
    amount,
    currency: session.currency || "TWD",
    paymentMethod: "stripe",
    paymentType: paymentType || "full",
    paymentStatus: "completed",
    paidAt: new Date(),
  });

  // Update booking payment status
  let newPaymentStatus: "unpaid" | "deposit" | "paid" | "refunded" = "paid";

  if (paymentType === "deposit") {
    newPaymentStatus = "deposit";
  } else if (paymentType === "balance") {
    newPaymentStatus = "paid";
  }

  // v74: only flip bookingStatus to "confirmed" when payment is FULLY received.
  // Previously a 20% deposit immediately marked the booking "confirmed" which
  // misled the customer (and ops dashboards) into thinking the seat was secured.
  // The booking now stays "pending" until the balance is paid.
  const newBookingStatus: "pending" | "confirmed" =
    newPaymentStatus === "paid" ? "confirmed" : "pending";

  await db.updateBooking(parseInt(bookingId), {
    paymentStatus: newPaymentStatus,
    bookingStatus: newBookingStatus,
  });

  console.log(`[Stripe Webhook] Booking ${bookingId} payment status updated to ${newPaymentStatus}`);

  // Round 80.22: award Packpoint when booking is FULLY paid. We award on
  // the FULL subtotal (not the per-payment amount) so deposit + balance
  // doesn't double-count. Idempotency is enforced by awardBookingPackpoint
  // checking pointsTransactions for an existing booking_earn row.
  // Skip awarding if no userId on booking (guest checkout) — points need a
  // user to attach to.
  if (newPaymentStatus === "paid" && (booking as any).userId) {
    try {
      const { awardBookingPackpoint } = await import("./packpoint");
      // Currency: most PACK&GO bookings are USD; for TWD or other currencies
      // we'd need exchange-rate conversion. Skip non-USD for now to avoid
      // mis-awarding (TODO: integrate exchangeRateAgent if multi-currency).
      const currency = (session.currency ?? "usd").toLowerCase();
      if (currency === "usd") {
        const points = await awardBookingPackpoint({
          userId: (booking as any).userId,
          bookingId: parseInt(bookingId),
          tourId: booking.tourId,
          subtotalUsd: booking.totalPrice, // booking.totalPrice is in original currency
        });
        console.log(`[Stripe Webhook] Packpoint awarded for booking ${bookingId}: ${points} pts`);
      } else {
        console.log(
          `[Stripe Webhook] Skipped Packpoint for booking ${bookingId} (non-USD currency: ${currency})`
        );
      }
    } catch (err) {
      console.error(
        `[Stripe Webhook] Failed to award Packpoint for booking ${bookingId}:`,
        (err as Error).message
      );
      // Don't fail the webhook on point-award errors
    }

    // Round 80.22 Phase D: referral bonus on FIRST paid booking.
    // Idempotency lives inside awardReferralOnFirstBooking via the
    // users.referralBonusAwarded flag — repeat calls are no-ops.
    try {
      const { awardReferralOnFirstBooking } = await import("./referral");
      await awardReferralOnFirstBooking({
        refereeUserId: (booking as any).userId,
        bookingId: parseInt(bookingId),
      });
    } catch (err) {
      console.error(
        `[Stripe Webhook] Referral payout failed for booking ${bookingId}:`,
        (err as Error).message
      );
    }
  }

  // v78n Sprint 6A: customer paid → cancel any pending abandonment recovery email
  try {
    const { cancelAbandonmentRecovery } = await import(
      "../queues/abandonmentRecoveryQueue"
    );
    await cancelAbandonmentRecovery(parseInt(bookingId));
  } catch (err) {
    console.warn(
      "[Stripe Webhook] Failed to cancel abandonment recovery:",
      (err as Error).message
    );
  }

  // Auto-create accounting income entry
  try {
    await createAccountingEntry({
      entryType: "income",
      category: "tour_booking",
      amount: String(amount),
      currency: (session.currency ?? "usd").toUpperCase(),
      description: `行程訂單付款 #${bookingId}${paymentType === "deposit" ? "（訂金）" : paymentType === "balance" ? "（尾款）" : "（全額）"}`,
      bookingId: parseInt(bookingId),
      entryDate: new Date(),
      isTaxDeductible: 0,
      createdBy: 1,
    });
    console.log(`[Stripe Webhook] Accounting entry created for booking ${bookingId}`);
  } catch (err) {
    console.error("[Stripe Webhook] Failed to create accounting entry:", err);
  }

  // Send payment success email
  try {
    const tour = await db.getTourById(booking.tourId);
    if (tour) {
      await sendPaymentSuccessEmail({
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        bookingId: booking.id,
        tourTitle: tour.title,
        paymentAmount: amount,
        paymentType: paymentType || "full",
        // v78y: respect the customer's chosen language stored at booking time
        language: ((booking as any).customerLanguage as 'zh-TW' | 'en' | undefined) || undefined,
      });
      console.log(`[Stripe Webhook] Payment success email sent to ${redactEmail(booking.customerEmail)}`);

      // v78l Sprint 4A: Auto-notify supplier if email is on file. Only on
      // FIRST paid event (deposit OR full) — skip on balance to avoid duplicates.
      if (paymentType !== "balance" && (tour as any).supplierEmail) {
        try {
          // bookings stores only departureId; dates live on tourDepartures
          const drizzleDb = await db.getDb();
          let depDate: Date | null = null;
          let retDate: Date | null = null;
          if (drizzleDb) {
            const { tourDepartures } = await import("../../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            const [dep] = await drizzleDb
              .select()
              .from(tourDepartures)
              .where(eq(tourDepartures.id, booking.departureId))
              .limit(1);
            if (dep) {
              depDate = dep.departureDate;
              retDate = dep.returnDate;
            }
          }
          const departure = depDate
            ? new Date(depDate).toLocaleDateString("zh-TW")
            : "TBD";
          const returnDate = retDate
            ? new Date(retDate).toLocaleDateString("zh-TW")
            : undefined;
          await sendSupplierNotificationEmail({
            supplierEmail: (tour as any).supplierEmail,
            supplierName: (tour as any).supplierName,
            supplierNotes: (tour as any).supplierNotes,
            language: "zh-TW", // Suppliers default to zh-TW; can be made per-tour later
            bookingId: booking.id,
            customerName: booking.customerName,
            customerPhone: booking.customerPhone || undefined,
            customerEmail: booking.customerEmail,
            tourTitle: tour.title,
            departureDate: departure,
            returnDate,
            numberOfAdults: booking.numberOfAdults || 0,
            numberOfChildren: (booking.numberOfChildrenWithBed || 0) + (booking.numberOfChildrenNoBed || 0),
            numberOfInfants: booking.numberOfInfants || 0,
            specialRequests: (booking as any).specialRequests || (booking as any).notes || undefined,
          });
          console.log(`[Stripe Webhook] Supplier notification sent for booking #${booking.id}`);
        } catch (supplierErr) {
          console.error("[Stripe Webhook] Supplier notification failed:", supplierErr);
        }
      }
    }
  } catch (error) {
    console.error('[Stripe Webhook] Failed to send payment success email:', error);
    // Don't fail the webhook if email fails
  }

  // QA Audit 2026-05-11 Phase 5 fix: notify Jeff every time a payment lands.
  // Phase 5 found Jeff was completely blind to payment events — Stripe sent
  // emails to the customer + supplier but never to the owner. With Jeff
  // potentially leading a tour overseas with limited bandwidth, an inbox
  // line is the simplest reliable signal that money moved.
  try {
    const tour = await db.getTourById(booking.tourId);
    const tourTitle = tour?.title ?? `Tour #${booking.tourId}`;
    const usd = (amount / 100).toFixed(2);
    const kindZh =
      paymentType === "deposit"
        ? "訂金"
        : paymentType === "balance"
          ? "尾款"
          : "全額";
    await notifyOwner({
      title: `收到付款 $${usd} — ${tourTitle}`,
      content:
        `Booking #${booking.id} · ${kindZh}\n` +
        `客戶: ${booking.customerName}\n` +
        `行程: ${tourTitle}\n` +
        `金額: $${usd} ${(session.currency ?? "usd").toUpperCase()}\n` +
        `Stripe session: ${session.id}`,
    });

    // Round 81 (2026-05-17): also surface in #books channel.
    const { notifyAgentMessage } = await import("./agentNotify");
    await notifyAgentMessage({
      agentName: "books",
      messageType: "observation",
      title: `收到付款 $${usd} (${kindZh}) — ${tourTitle.slice(0, 60)}`,
      body:
        `Booking #${booking.id}\n` +
        `客戶: ${booking.customerName}\n` +
        `行程: ${tourTitle}\n` +
        `金額: $${usd} ${(session.currency ?? "usd").toUpperCase()}\n` +
        `付款類型: ${kindZh}\n` +
        `已自動建 accounting income entry · category=tour_booking`,
      priority: "normal",
      context: { bookingId: booking.id, sessionId: session.id, paymentType, amount },
    });
  } catch (err) {
    console.error("[Stripe Webhook] notifyOwner (payment) failed:", err);
  }
}

async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  console.log("[Stripe Webhook] Processing payment_intent.succeeded");
  console.log("[Stripe Webhook] Payment Intent ID:", paymentIntent.id);

  // Update payment record status
  await db.updatePaymentStatus(paymentIntent.id, "completed", new Date());
}

async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
  console.log("[Stripe Webhook] Processing payment_intent.payment_failed");
  console.log("[Stripe Webhook] Payment Intent ID:", paymentIntent.id);

  // Update payment record status
  await db.updatePaymentStatus(paymentIntent.id, "failed");
}

/**
 * v74: handle Stripe `charge.refunded` event.
 *
 * Triggered when a charge is fully or partially refunded — either via the
 * Stripe dashboard, the API, or as part of a dispute resolution. Without this
 * handler, refunds happen on Stripe's side but our booking row continues to
 * show paymentStatus="paid" indefinitely, breaking accounting reconciliation.
 *
 * Logic:
 *   - If `amount_refunded === amount` → full refund: paymentStatus="refunded"
 *   - Else partial refund: paymentStatus stays "paid" (we don't currently
 *     model partial refunds; ops handles them manually). Just log.
 *   - bookingStatus is NOT auto-flipped — admin should explicitly cancel
 *     the booking via adminUpdateStatus, which has its own confirmation +
 *     audit trail.
 */
async function handleChargeRefunded(charge: Stripe.Charge) {
  console.log("[Stripe Webhook] Processing charge.refunded");
  console.log("[Stripe Webhook] Charge:", charge.id, "amount:", charge.amount, "refunded:", charge.amount_refunded);

  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id;

  if (!paymentIntentId) {
    console.warn("[Stripe Webhook] charge.refunded: no payment_intent on charge");
    return;
  }

  const isFullRefund = charge.amount_refunded >= charge.amount;
  if (!isFullRefund) {
    console.log(
      `[Stripe Webhook] Partial refund detected (${charge.amount_refunded}/${charge.amount}) — leaving paymentStatus alone, manual reconciliation needed`
    );
    return;
  }

  // Look up our payment row by Stripe payment intent ID
  const payment = await db.getPaymentByIntentId(paymentIntentId);
  if (!payment) {
    console.warn(`[Stripe Webhook] charge.refunded: no local payment for intent ${paymentIntentId}`);
    return;
  }

  // Idempotency: if already marked refunded, skip (Stripe sometimes fires this
  // event multiple times for the same refund).
  if (payment.paymentStatus === "refunded") {
    console.log(`[Stripe Webhook] charge.refunded: payment ${payment.id} already marked refunded`);
    return;
  }

  // Update both the payment row and the booking row
  await db.updatePaymentStatus(paymentIntentId, "refunded", new Date()).catch((e) =>
    console.error("[Stripe Webhook] charge.refunded: updatePaymentStatus failed:", e?.message)
  );

  if (payment.bookingId) {
    // QA audit 2026-05-11 Phase 8 fix + code-review v2: previously we
    // snapshotted the booking then updated then released slots, which
    // raced against bookings.cancel() and Stripe webhook replays
    // (double-release the seat). Now: atomic UPDATE … WHERE
    // bookingStatus != 'cancelled' returns affectedRows=1 only when
    // THIS handler owned the state transition, and we release slots
    // only in that case. Concurrent callers see affectedRows=0 and
    // skip the release.
    const drizzle = await (await import("../db")).getDb();
    if (!drizzle) {
      console.error(
        "[Stripe Webhook] charge.refunded: DB unavailable, cannot transition booking"
      );
      return;
    }
    const { bookings: bookingsTable } = await import("../../drizzle/schema");
    const { and, eq, ne } = await import("drizzle-orm");

    // Read seat counts BEFORE the conditional update so we have the
    // numbers if we win the race. This snapshot is allowed to be
    // stale; only the conditional update controls whether we release.
    const bookingSnap = await db.getBookingById(payment.bookingId);

    let transitionedToCancelled = false;
    try {
      const result: any = await drizzle
        .update(bookingsTable)
        .set({
          paymentStatus: "refunded",
          bookingStatus: "cancelled",
        })
        .where(
          and(
            eq(bookingsTable.id, payment.bookingId),
            ne(bookingsTable.bookingStatus, "cancelled")
          )
        );
      // mysql2 result shape: rows.affectedRows. Drizzle wraps it.
      const affected =
        (result?.[0]?.affectedRows ?? result?.affectedRows ?? 0) | 0;
      transitionedToCancelled = affected > 0;
      console.log(
        `[Stripe Webhook] Booking ${payment.bookingId} refund update affected=${affected} (transitioned=${transitionedToCancelled})`
      );

      // If the booking was already cancelled before we got here, we
      // still need to ensure paymentStatus is recorded as refunded
      // (the conditional update above skipped because of the != cancelled
      // guard). Run an unconditional paymentStatus-only update — this
      // is idempotent and never triggers a slot release.
      if (!transitionedToCancelled) {
        await drizzle
          .update(bookingsTable)
          .set({ paymentStatus: "refunded" })
          .where(eq(bookingsTable.id, payment.bookingId));
      }
    } catch (e) {
      console.error(
        "[Stripe Webhook] charge.refunded: updateBooking failed:",
        (e as Error)?.message
      );
    }

    // Release seats ONLY if THIS handler owned the active → cancelled
    // transition. Replay or concurrent bookings.cancel paths skip.
    if (transitionedToCancelled && bookingSnap?.departureId) {
      const seatCount =
        (bookingSnap.numberOfAdults || 0) +
        (bookingSnap.numberOfChildrenWithBed || 0) +
        (bookingSnap.numberOfChildrenNoBed || 0);
      if (seatCount > 0) {
        await db
          .releaseDepartureSlots(bookingSnap.departureId, seatCount)
          .catch((e) =>
            console.error(
              `[Stripe Webhook] charge.refunded: releaseDepartureSlots failed for booking ${payment.bookingId}:`,
              e?.message
            )
          );
      }
    }

    // Round 80.22: claw back any Packpoint awarded for this booking.
    // Per docs/packpoint-policy.md §5: "取消訂單若已發點,扣回該次發放的
    // packpoint(若餘額不足,記為負餘額,需用未來訂單補回)". Our deduct
    // helper caps at current balance (no negative), so users who already
    // spent the points won't get a punitive negative — but the audit trail
    // captures the clawback attempt amount.
    try {
      const booking = await db.getBookingById(payment.bookingId);
      if (booking && (booking as any).userId) {
        const { getDb } = await import("../db");
        const drizzle = await getDb();
        if (drizzle) {
          const { pointsTransactions } = await import("../../drizzle/schema");
          const { sql } = await import("drizzle-orm");
          const [earnRow] = await drizzle
            .select({ delta: pointsTransactions.delta })
            .from(pointsTransactions)
            .where(
              sql`${pointsTransactions.referenceType} = 'booking' AND ${pointsTransactions.referenceId} = ${payment.bookingId} AND ${pointsTransactions.reason} = 'booking_earn'`
            )
            .limit(1);

          if (earnRow && earnRow.delta > 0) {
            const { deductPackpoint } = await import("./packpoint");
            await deductPackpoint({
              userId: (booking as any).userId,
              amount: earnRow.delta,
              reason: "clawback",
              referenceType: "booking",
              referenceId: payment.bookingId,
              description: `Refund clawback for booking #${payment.bookingId}`,
            });
            console.log(
              `[Stripe Webhook] Clawed back ${earnRow.delta} Packpoint from booking ${payment.bookingId} refund`
            );
          }
        }
      }
    } catch (err) {
      console.error(
        `[Stripe Webhook] Packpoint clawback failed for booking ${payment.bookingId}:`,
        (err as Error).message
      );
    }
  }

  // QA Audit 2026-05-11 Phase 5 fix: notify Jeff on every refund — full or
  // initiated. Refunds are the highest-touch financial event (accounting,
  // tax, customer-relationship), so silence here was the worst gap.
  // Round 81 (2026-05-17): ALSO post to #refund channel so ChatsTab shows
  // the activity. Keeps notifyOwner (email) as belt-and-suspenders.
  try {
    const usd = (charge.amount_refunded / 100).toFixed(2);
    await notifyOwner({
      title: `退款 $${usd} — Booking #${payment.bookingId ?? "?"}`,
      content:
        `Charge: ${charge.id}\n` +
        `Payment intent: ${paymentIntentId}\n` +
        `Refunded: $${usd} ${(charge.currency ?? "usd").toUpperCase()}\n` +
        `Original: $${(charge.amount / 100).toFixed(2)}\n` +
        `Booking: ${payment.bookingId ?? "(無對應 booking)"}`,
    });

    const { notifyAgentMessage } = await import("./agentNotify");
    await notifyAgentMessage({
      agentName: "refund",
      messageType: "observation",
      title: `Stripe 退款已完成 $${usd}`,
      body:
        `Booking #${payment.bookingId ?? "?"}\n` +
        `退款金額: $${usd} ${(charge.currency ?? "usd").toUpperCase()}\n` +
        `原始金額: $${(charge.amount / 100).toFixed(2)}\n` +
        `Charge: ${charge.id}\n` +
        `Payment intent: ${paymentIntentId}`,
      priority: "normal",
      context: { chargeId: charge.id, paymentIntentId, bookingId: payment.bookingId },
    });
  } catch (err) {
    console.error("[Stripe Webhook] notifyOwner (refund) failed:", err);
  }
}

async function handleVisaPaymentCompleted(
  session: Stripe.Checkout.Session,
  applicationId: number
) {
  console.log(`[Stripe Webhook] Processing visa payment for application ${applicationId}`);

  const application = await db.getVisaApplicationById(applicationId);
  if (!application) {
    console.error(`[Stripe Webhook] Visa application ${applicationId} not found`);
    return;
  }

  // Update payment info
  await db.updateVisaPaymentInfo(applicationId, {
    paymentStatus: "paid",
    stripePaymentIntentId: session.payment_intent as string,
    stripeCheckoutSessionId: session.id,
    paidAt: new Date(),
  });

  // Update application status to paid
  await db.updateVisaApplicationStatus(applicationId, "paid", undefined, "Stripe 付款完成");

  // Auto-create accounting income entry for visa
  try {
    const visaAmount = session.amount_total ? session.amount_total / 100 : 0;
    await createAccountingEntry({
      entryType: "income",
      category: "visa_service",
      amount: String(visaAmount),
      currency: (session.currency ?? "usd").toUpperCase(),
      description: `中國簽證代辦 #${applicationId}（${application.firstName} ${application.lastName}）`,
      visaApplicationId: applicationId,
      entryDate: new Date(),
      isTaxDeductible: 0,
      createdBy: 1,
    });
    console.log(`[Stripe Webhook] Accounting entry created for visa application ${applicationId}`);
  } catch (err) {
    console.error("[Stripe Webhook] Failed to create visa accounting entry:", err);
  }

  console.log(`[Stripe Webhook] Visa application ${applicationId} payment confirmed`);

  // Send confirmation email
  try {
    await sendVisaApplicationConfirmation({
      toEmail: application.email,
      applicantName: `${application.firstName} ${application.lastName}`,
      applicationId,
      totalAmount: Number(application.totalAmount),
      passportNumber: application.passportNumber,
      travelDate: application.travelDate ?? undefined,
    });
    console.log(`[Stripe Webhook] Visa confirmation email sent to ${redactEmail(application.email)}`);
  } catch (error) {
    console.error('[Stripe Webhook] Failed to send visa confirmation email:', error);
  }

  // QA Audit Phase 5 fix: visa payment notification to Jeff.
  try {
    const usd = session.amount_total ? (session.amount_total / 100).toFixed(2) : "?";
    await notifyOwner({
      title: `中國簽證付款 $${usd} — Application #${applicationId}`,
      content:
        `申請人: ${application.firstName} ${application.lastName}\n` +
        `護照: ${application.passportNumber}\n` +
        `Email: ${application.email}\n` +
        `金額: $${usd}\n` +
        `Travel date: ${application.travelDate ?? "未填"}`,
    });
  } catch (err) {
    console.error("[Stripe Webhook] notifyOwner (visa) failed:", err);
  }
}

// ─── Round 80.20: Membership subscription handlers ────────────────────────
//
// Lifecycle:
//   1. User clicks Plus on /membership → tRPC creates Checkout session
//      with `metadata.tier = 'plus' | 'concierge'` and `metadata.userId`
//   2. After payment, Stripe sends `customer.subscription.created` →
//      we set users.tier + tierExpiresAt + stripeSubscriptionId
//   3. Renewals fire `customer.subscription.updated` → refresh tierExpiresAt
//   4. Cancel fires `customer.subscription.deleted` → reset to 'free'
//
// Idempotent: rerunning on the same subscription is safe (idempotency check
// via stripeSubscriptionId match).

import { tierFromPriceId } from "./membershipPricing";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

async function handleSubscriptionUpserted(sub: Stripe.Subscription) {
  console.log("[Stripe Webhook] Processing subscription upsert", sub.id, sub.status);

  // Identify the user — first by metadata.userId, fallback to customer
  const userIdFromMeta = sub.metadata?.userId;
  let userId: number | null = userIdFromMeta ? parseInt(userIdFromMeta, 10) : null;
  let stripeCustomerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null;

  if (!userId && stripeCustomerId) {
    // Fallback: lookup by stored stripeCustomerId
    const db = await getDb();
    if (db) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.stripeCustomerId, stripeCustomerId))
        .limit(1);
      userId = rows[0]?.id || null;
    }
  }

  if (!userId) {
    console.error("[Stripe Webhook] Could not identify user for subscription", sub.id);
    return;
  }

  // Map price to tier
  const priceId = sub.items.data[0]?.price.id;
  const tier = priceId ? tierFromPriceId(priceId) : null;
  if (!tier) {
    console.warn(
      `[Stripe Webhook] Subscription ${sub.id} priceId=${priceId} doesn't match any tier; skipping`
    );
    return;
  }

  // Compute expiry — current_period_end is unix seconds
  const periodEnd = (sub as any).current_period_end || sub.items.data[0]?.current_period_end;
  const expiresAt = periodEnd ? new Date(periodEnd * 1000) : null;

  // Set tier IFF subscription is active or trialing. Past_due / canceled
  // / incomplete drop the user back to 'free' silently (still log).
  const isActive = sub.status === "active" || sub.status === "trialing";

  const db = await getDb();
  if (!db) return;

  if (isActive) {
    await db
      .update(users)
      .set({
        tier,
        tierExpiresAt: expiresAt,
        stripeSubscriptionId: sub.id,
        stripeCustomerId,
      })
      .where(eq(users.id, userId));
    console.log(
      `[Stripe Webhook] ✓ User ${userId} → tier=${tier} expires=${expiresAt?.toISOString()}`
    );

    // Round 81 / migration 0075 — Membership trial tracking.
    // Three transitions matter:
    //   (a) trial start (status=trialing, no existing membershipTrials row)
    //       → create row + flip users.{plus|concierge}TrialUsedAt
    //   (b) trial → active (status=active, existing row.converted=false)
    //       → mark row.converted=true, convertedAt=now
    //   (c) active → ... no trial-table action needed
    //
    // Phase 1 Cluster C (2026-05-18): removed redundant `if (tier !== "free")`
    // guard — `tier` is `PaidTier` here (narrowed at L785 via tierFromPriceId),
    // never "free". The previous comparison was dead code per TS2367.
    try {
      const { membershipTrials } = await import("../../drizzle/schema");
      const trialEnd = (sub as any).trial_end as number | null | undefined;
      const isTrialing = sub.status === "trialing";

      // (a) Trial start — only if user has never trialed THIS tier before
      if (isTrialing && trialEnd) {
        const tierFlag = tier === "plus" ? "plusTrialUsedAt" : "conciergeTrialUsedAt";
        const usedAtCol = (users as any)[tierFlag];
        const userRow = await db.select({ used: usedAtCol })
          .from(users).where(eq(users.id, userId)).limit(1);
        const alreadyTrialed = userRow[0]?.used != null;

        if (!alreadyTrialed) {
          await db.insert(membershipTrials).values({
            userId,
            tier,
            endsAt: new Date(trialEnd * 1000),
            stripeSubscriptionId: sub.id,
            stripePriceId: priceId || null,
          } as any);
          await db.update(users)
            .set({ [tierFlag]: new Date() } as any)
            .where(eq(users.id, userId));
          console.log(
            `[Stripe Webhook] ✓ Trial started: user ${userId} tier=${tier}, ends ${new Date(trialEnd * 1000).toISOString()}`
          );
        }
      }

      // (b) Trial → active conversion — find pending row, mark converted
      if (sub.status === "active") {
        const { and: dAnd, eq: dEq } = await import("drizzle-orm");
        const pendingTrial = await db
          .select()
          .from(membershipTrials)
          .where(
            dAnd(
              dEq(membershipTrials.stripeSubscriptionId, sub.id),
              dEq(membershipTrials.converted, false),
            )
          )
          .limit(1);
        if (pendingTrial[0]) {
          await db
            .update(membershipTrials)
            .set({ converted: true, convertedAt: new Date() })
            .where(dEq(membershipTrials.id, pendingTrial[0].id));
          console.log(
            `[Stripe Webhook] ✓ Trial converted to paid: user ${userId} tier=${tier}`
          );
        }
      }
    } catch (err) {
      console.error("[Stripe Webhook] membershipTrials write failed:", (err as Error).message);
      // Don't fail the webhook on trial-table errors
    }
  } else {
    await db
      .update(users)
      .set({
        tier: "free",
        tierExpiresAt: null,
        stripeSubscriptionId: sub.id, // keep ref for re-activate
        stripeCustomerId,
      })
      .where(eq(users.id, userId));
    console.log(
      `[Stripe Webhook] User ${userId} subscription ${sub.status} → reverted to free`
    );
  }
}

/**
 * Round 81 / migration 0075 — AB 390 mandatory pre-charge notification.
 *
 * Fires automatically by Stripe ~3 days before the trial period ends. We:
 *   1. Find the membershipTrials row by stripeSubscriptionId
 *   2. Send a reminder email via Gmail SMTP (PACK&GO brand voice)
 *   3. Mark reminderSentAt so we don't double-send if Stripe retries
 *
 * The email MUST include: trial end date, exact charge amount, how to cancel.
 * California Bus. & Prof. Code §17602 mandates these disclosures.
 */
async function handleTrialWillEnd(sub: Stripe.Subscription) {
  console.log("[Stripe Webhook] Processing trial_will_end", sub.id);

  const db = await getDb();
  if (!db) return;

  const { membershipTrials } = await import("../../drizzle/schema");
  const trialRows = await db
    .select()
    .from(membershipTrials)
    .where(eq(membershipTrials.stripeSubscriptionId, sub.id))
    .limit(1);

  const trial = trialRows[0];
  if (!trial) {
    console.warn(`[Stripe Webhook] trial_will_end: no membershipTrials row for ${sub.id}`);
    return;
  }

  // Idempotency: Stripe retries on transient failures
  if (trial.reminderSentAt) {
    console.log(`[Stripe Webhook] trial_will_end: reminder already sent for trial ${trial.id}`);
    return;
  }

  // Fetch user email
  const userRows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, trial.userId))
    .limit(1);
  const user = userRows[0];
  if (!user) {
    console.warn(`[Stripe Webhook] trial_will_end: user ${trial.userId} not found`);
    return;
  }

  // Compute charge amount from the price
  const priceId = sub.items.data[0]?.price.id;
  const amount = sub.items.data[0]?.price.unit_amount || 0;
  const currency = (sub.items.data[0]?.price.currency || "usd").toUpperCase();
  const formattedAmount = `${currency} $${(amount / 100).toFixed(2)}`;
  const interval = sub.items.data[0]?.price.recurring?.interval || "month";
  const tierLabel = trial.tier === "plus" ? "Plus" : "Concierge";

  // Send via existing Gmail SMTP pipeline. Defer the email module to keep
  // webhook handler import-cost low.
  try {
    const { sendTrialEndingReminder } = await import("../email");
    await sendTrialEndingReminder({
      to: user.email,
      customerName: user.name || "Traveler",
      tierLabel,
      trialEndsAt: trial.endsAt,
      chargeAmount: formattedAmount,
      chargeInterval: interval as "month" | "year",
      cancelUrl: `${ENV.baseUrl || "https://packgoplay.com"}/membership?manage=1`,
    });

    await db
      .update(membershipTrials)
      .set({ reminderSentAt: new Date() })
      .where(eq(membershipTrials.id, trial.id));

    console.log(
      `[Stripe Webhook] ✓ Trial-end reminder sent: user ${user.id} tier=${trial.tier}, charge=${formattedAmount} on ${trial.endsAt.toISOString()}`
    );

    await notifyOwner({
      title: `Trial 即將結束: ${user.name || user.email}`,
      content:
        `會員: ${user.email}\nTier: ${tierLabel}\n試用結束: ${trial.endsAt.toISOString()}\n即將收費: ${formattedAmount}\nAB 390 reminder email 已發送。`,
    }).catch(() => {});

    // Round 81 (2026-05-17): #books channel — membership trial about to convert.
    const { notifyAgentMessage } = await import("./agentNotify");
    await notifyAgentMessage({
      agentName: "books",
      messageType: "observation",
      title: `Trial 即將結束 → 即將收 ${formattedAmount}`,
      body:
        `客戶: ${user.name || user.email}\n` +
        `Tier: ${tierLabel}\n` +
        `試用結束: ${trial.endsAt.toISOString().slice(0, 10)}\n` +
        `自動扣款: ${formattedAmount}\n` +
        `AB 390 §17602(c) 3 天前提醒 email 已發送 ✓`,
      priority: "low",
      context: { userId: user.id, trialId: trial.id, stripeSubscriptionId: sub.id },
    });
  } catch (err) {
    console.error("[Stripe Webhook] trial_will_end: reminder email failed:", (err as Error).message);
    // Re-throw so Stripe retries the webhook (we MUST send the AB 390 notification)
    throw err;
  }
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  console.log("[Stripe Webhook] Processing subscription deletion", sub.id);
  const db = await getDb();
  if (!db) return;
  await db
    .update(users)
    .set({
      tier: "free",
      tierExpiresAt: null,
      stripeSubscriptionId: null,
    })
    .where(eq(users.stripeSubscriptionId, sub.id));
  console.log(`[Stripe Webhook] ✓ Subscription ${sub.id} canceled → users reverted to free`);
}
