import { Request, Response } from "express";
import Stripe from "stripe";
import { ENV } from "./env";
import * as db from "../db";
import { sendPaymentSuccessEmail, sendSupplierNotificationEmail } from "../email";
import { sendVisaApplicationConfirmation } from "../services/visaEmailService";
import { createAccountingEntry } from "../db";
import { notifyOwner } from "./notification";
import { redactEmail } from "./redact";
import { claimStripeEvent, markStripeEventSucceeded, markStripeEventFailed } from "./stripeWebhookIdempotency";
// v2 Wave 1 Module 1.2 — pino structured logger. We use a child logger so
// every line carries module="stripeWebhook" without manual tagging.
// Searchability: Fly's log grep matches inside JSON strings, so
// `fly logs | grep evt_test_xyz` still works against this output.
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "stripeWebhook" });


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
    log.error("[Stripe Webhook] No signature found");
    return res.status(400).send("No signature found");
  }

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      sig,
      ENV.stripeWebhookSecret
    );
  } catch (err) {
    log.error({ err }, "[Stripe Webhook] Signature verification failed");
    return res.status(400).send(`Webhook Error: ${(err as Error).message}`);
  }

  // Handle test events
  if (event.id.startsWith("evt_test_")) {
    log.info({ eventId: event.id }, "[Stripe Webhook] Test event detected, returning verification response");
    return res.json({
      verified: true,
    });
  }

  log.info({ eventId: event.id, type: event.type }, "[Stripe Webhook] Received event");

  // Phase 2: central idempotency. UNIQUE(eventId) collision = Stripe replay.
  const claim = await claimStripeEvent(event);
  if (claim.alreadyProcessed) {
    log.info(
      { eventId: event.id, existingStatus: claim.existingStatus },
      "[Stripe Webhook] Idempotent skip",
    );
    return res.json({ received: true, idempotent: true });
  }

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

      // Phase 2.3: chargeback / dispute was previously UNhandled. A card
      // dispute on a tour deposit (common in travel) was a silent loss with no
      // chance to contest before Stripe's deadline. Alert the owner with the
      // evidence-due date. Notify-only (no booking/accounting mutation, since
      // the paymentStatus enum has no 'disputed' state; ops drives the outcome).
      // NOTE: requires `charge.dispute.created` + `charge.dispute.closed` to be
      // enabled in the Stripe webhook config.
      case "charge.dispute.created":
      case "charge.dispute.closed": {
        const dispute = event.data.object as Stripe.Dispute;
        await handleChargeDispute(event.type, dispute);
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
        log.info({ type: event.type }, "[Stripe Webhook] Unhandled event type");
    }

    await markStripeEventSucceeded(claim.rowId);
    res.json({ received: true });
  } catch (error) {
    log.error({ err: error, eventId: event.id }, "[Stripe Webhook] Error processing event");
    await markStripeEventFailed(claim.rowId, error as Error).catch((e) =>
      log.error({ err: e }, "[Stripe Webhook] mark-failed write failed"),
    );
    res.status(500).json({ error: "Webhook processing failed" });
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  log.info(
    {
      sessionId: session.id,
      paymentIntent: session.payment_intent,
      mode: session.mode,
      metadata: session.metadata,
    },
    "[Stripe Webhook] Processing checkout.session.completed",
  );

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
    } catch (err) {
      log.error(
        { err },
        "[Stripe Webhook] Failed to promote tier from checkout.session.completed",
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
    log.error("[Stripe Webhook] No booking_id in session metadata");
    return;
  }

  // Get booking
  const booking = await db.getBookingById(parseInt(bookingId));
  if (!booking) {
    log.error({ bookingId }, "[Stripe Webhook] Booking not found");
    return;
  }

  // Create payment record
  const paymentIntentId = session.payment_intent as string;
  const amount = session.amount_total ? session.amount_total / 100 : 0; // Convert from cents

  // Phase 2: idempotency now enforced centrally via stripeWebhookEvents.
  // Lookup retained as a race-condition warning only (central guard covers replays).
  if (paymentIntentId) {
    const existing = await db.getPaymentByIntentId(paymentIntentId);
    if (existing) {
      log.warn(
        { paymentIntentId, existingId: existing.id },
        "[Stripe Webhook] payment already exists",
      );
    }
  }

  // Phase 2 (2026-05-18): atomic write block.
  // INSIDE the tx (rolled back on throw): createPayment + updateBooking +
  // createAccountingEntry. POST-COMMIT (each guards own errors): packpoint,
  // referral, abandonment-queue cancel, emails, notifyOwner, notifyAgentMessage.
  // packpoint is post-commit because it opens its own internal db.transaction
  // (nested MySQL tx is avoided per Module 2.1 guidance).
  // Visa + subscription branches short-circuit before this block — they have
  // their own atomicity stories (modules 2.5 / 2.4).
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

  const drizzleDbForTx = await db.getDb();
  if (!drizzleDbForTx) {
    throw new Error(
      "[Stripe Webhook] Database not available for checkout.session.completed booking transaction"
    );
  }

  await drizzleDbForTx.transaction(async (tx) => {
    await db.createPayment(
      {
        bookingId: parseInt(bookingId),
        stripePaymentIntentId: paymentIntentId,
        stripeCheckoutSessionId: session.id,
        amount,
        currency: session.currency || "TWD",
        paymentMethod: "stripe",
        paymentType: paymentType || "full",
        paymentStatus: "completed",
        paidAt: new Date(),
      },
      tx,
    );

    await db.updateBooking(
      parseInt(bookingId),
      {
        paymentStatus: newPaymentStatus,
        bookingStatus: newBookingStatus,
      },
      tx,
    );

    await createAccountingEntry(
      {
        entryType: "income",
        category: "tour_booking",
        amount: String(amount),
        currency: (session.currency ?? "usd").toUpperCase(),
        description: `行程訂單付款 #${bookingId}${paymentType === "deposit" ? "（訂金）" : paymentType === "balance" ? "（尾款）" : "（全額）"}`,
        bookingId: parseInt(bookingId),
        entryDate: new Date(),
        isTaxDeductible: 0,
        createdBy: 1,
      },
      tx,
    );
  });

  log.info(
    { bookingId, newPaymentStatus },
    "[Stripe Webhook] Booking payment status updated",
  );
  log.info({ bookingId }, "[Stripe Webhook] Accounting entry created");

  // ─── POST-COMMIT side effects ────────────────────────────────────────
  // Anything below runs ONLY if the transaction above committed. Each side
  // effect MUST swallow its own errors — a failed email must NOT roll back
  // the payment. The webhook still returns 200 to Stripe.

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
        log.info({ bookingId, points }, "[Stripe Webhook] Packpoint awarded for booking");
      } else {
        log.info(
          { bookingId, currency },
          "[Stripe Webhook] Skipped Packpoint (non-USD currency)",
        );
      }
    } catch (err) {
      log.error(
        { err, bookingId },
        "[Stripe Webhook] Failed to award Packpoint for booking",
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
      log.error(
        { err, bookingId },
        "[Stripe Webhook] Referral payout failed for booking",
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
    log.warn(
      { err },
      "[Stripe Webhook] Failed to cancel abandonment recovery",
    );
  }

  // Accounting income entry: moved INTO the db.transaction above so it
  // commits atomically with createPayment + updateBooking.

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
      log.info(
        { customerEmail: redactEmail(booking.customerEmail) },
        "[Stripe Webhook] Payment success email sent",
      );

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
          log.info(
            { bookingId: booking.id },
            "[Stripe Webhook] Supplier notification sent for booking",
          );
        } catch (supplierErr) {
          log.error({ err: supplierErr }, "[Stripe Webhook] Supplier notification failed");
        }
      }
    }
  } catch (error) {
    log.error({ err: error }, "[Stripe Webhook] Failed to send payment success email");
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
    log.error({ err }, "[Stripe Webhook] notifyOwner (payment) failed");
  }
}

async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  log.info(
    { paymentIntentId: paymentIntent.id },
    "[Stripe Webhook] Processing payment_intent.succeeded",
  );
  // Phase 2 (2026-05-18): wrap single write in db.transaction for symmetry
  // and future multi-write expansion (e.g. accounting reversal on partial capture).
  const drizzleDb = await db.getDb();
  if (!drizzleDb) throw new Error("[Stripe Webhook] DB unavailable for payment_intent.succeeded");
  await drizzleDb.transaction(async (tx) => {
    await db.updatePaymentStatus(paymentIntent.id, "completed", new Date(), tx);
  });
}

async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
  log.info(
    { paymentIntentId: paymentIntent.id },
    "[Stripe Webhook] Processing payment_intent.payment_failed",
  );
  // Phase 2 (2026-05-18): wrap single write in db.transaction for symmetry.
  const drizzleDb = await db.getDb();
  if (!drizzleDb) throw new Error("[Stripe Webhook] DB unavailable for payment_intent.payment_failed");
  await drizzleDb.transaction(async (tx) => {
    await db.updatePaymentStatus(paymentIntent.id, "failed", undefined, tx);
  });
  // Phase 2.4: a failed payment used to go dark (log-only). Neither the
  // customer nor Jeff heard about it, so an intended payment (esp. a balance)
  // silently aged into the unpaid hole. Alert the owner so it can be chased.
  const amt = paymentIntent.amount ? paymentIntent.amount / 100 : 0;
  await notifyOwner({
    title: `⚠️ 付款失敗 Payment failed — ${amt} ${(paymentIntent.currency ?? "").toUpperCase()}`,
    content:
      `Stripe payment_intent ${paymentIntent.id} failed.\n` +
      `Reason: ${paymentIntent.last_payment_error?.message ?? "(none)"}\n` +
      `客人的卡可能被拒,需要寄重試連結或聯絡客人。`,
  }).catch((e) => log.error({ err: e }, "[Stripe Webhook] notifyOwner (payment failed) failed"));
}

/**
 * Phase 2.3: chargeback / dispute alert. Notify-only. Surfaces the dispute and
 * its evidence deadline so Jeff can contest it in the Stripe Dashboard before
 * the window closes. No money/booking mutation here.
 */
async function handleChargeDispute(eventType: string, dispute: Stripe.Dispute) {
  const amount = dispute.amount ? dispute.amount / 100 : 0;
  const cur = (dispute.currency ?? "").toUpperCase();
  const dueTs = dispute.evidence_details?.due_by;
  const due = dueTs
    ? new Date(dueTs * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "(unknown)";
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id ?? "?";
  log.warn(
    { disputeId: dispute.id, eventType, status: dispute.status, reason: dispute.reason },
    "[Stripe Webhook] charge dispute",
  );
  await notifyOwner({
    title:
      eventType === "charge.dispute.created"
        ? `⚠️ 收到爭議款 chargeback — ${amount} ${cur}`
        : `爭議款結案 dispute closed (${dispute.status}) — ${amount} ${cur}`,
    content:
      `Dispute ${dispute.id}\nCharge: ${chargeId}\nAmount: ${amount} ${cur}\n` +
      `Reason: ${dispute.reason}\nStatus: ${dispute.status}\n` +
      (eventType === "charge.dispute.created"
        ? `證據提交截止 Evidence due: ${due}\n請到 Stripe Dashboard 上傳證據(訂單確認、取消政策同意紀錄)反駁,逾期就直接輸。`
        : `outcome: ${dispute.status}`),
  }).catch((e) => log.error({ err: e }, "[Stripe Webhook] notifyOwner (dispute) failed"));
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
  log.info(
    { chargeId: charge.id, amount: charge.amount, refunded: charge.amount_refunded },
    "[Stripe Webhook] Processing charge.refunded",
  );

  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id;

  if (!paymentIntentId) {
    log.warn("[Stripe Webhook] charge.refunded: no payment_intent on charge");
    return;
  }

  const isFullRefund = charge.amount_refunded >= charge.amount;
  if (!isFullRefund) {
    log.info(
      { refunded: charge.amount_refunded, total: charge.amount },
      "[Stripe Webhook] Partial refund detected — leaving paymentStatus alone, manual reconciliation needed",
    );
    return;
  }

  // Look up our payment row by Stripe payment intent ID
  const payment = await db.getPaymentByIntentId(paymentIntentId);
  if (!payment) {
    log.warn(
      { paymentIntentId },
      "[Stripe Webhook] charge.refunded: no local payment for intent",
    );
    return;
  }

  // Phase 2: per-handler refund-status short-circuit removed; replay
  // dedupe handled by stripeWebhookEvents.

  // ─────────────────────────────────────────────────────────────────────
  // INSIDE TX (atomic writes) — payment status + conditional booking
  // transition (race-guard preserved as a single atomic UPDATE … WHERE
  // … ne(cancelled)) + fallback paymentStatus-only update + seat
  // release. All-or-nothing; if any step throws, MySQL rolls back.
  //
  // POST-COMMIT (after tx returns) — packpoint clawback (deductPackpoint
  // has its OWN db.transaction; nesting is not supported here) +
  // notifyOwner + notifyAgentMessage. The clawback's pointsTransactions
  // idempotency guard protects against double-deduct on Stripe replay.
  // ─────────────────────────────────────────────────────────────────────
  const drizzle = await (await import("../db")).getDb();
  if (!drizzle) {
    log.error("[Stripe Webhook] charge.refunded: DB unavailable, cannot process refund");
    return;
  }
  const { bookings: bookingsTable } = await import("../../drizzle/schema");
  const { and, eq, ne } = await import("drizzle-orm");

  // State captured INSIDE the tx, consumed AFTER commit (packpoint clawback +
  // notifications need to know whether the booking has a user / seats).
  let transitionedToCancelled = false;
  let bookingSnap: Awaited<ReturnType<typeof db.getBookingById>> | undefined;

  await drizzle.transaction(async (tx: any) => {
    // WRITE 1: payment row → refunded
    await db.updatePaymentStatus(paymentIntentId, "refunded", new Date(), tx);

    if (payment.bookingId) {
      // Snapshot booking inside the tx for seat counts. The conditional
      // UPDATE below is the only race guard; this snapshot just feeds
      // the seat-release path AFTER we've won the race.
      bookingSnap = await db.getBookingById(payment.bookingId, tx);

      // WRITE 2: atomic UPDATE … WHERE bookingStatus != 'cancelled'.
      // affectedRows=1 means THIS handler owned the active→cancelled
      // transition. Concurrent bookings.cancel paths see 0 and skip.
      const result: any = await tx
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
      const affected =
        (result?.[0]?.affectedRows ?? result?.affectedRows ?? 0) | 0;
      transitionedToCancelled = affected > 0;
      log.info(
        { bookingId: payment.bookingId, affected, transitioned: transitionedToCancelled },
        "[Stripe Webhook] Booking refund update",
      );

      // WRITE 2b: if the booking was already cancelled before we got
      // here, still record paymentStatus=refunded for ops/reconciliation.
      // Idempotent; never triggers a slot release.
      if (!transitionedToCancelled) {
        await tx
          .update(bookingsTable)
          .set({ paymentStatus: "refunded" })
          .where(eq(bookingsTable.id, payment.bookingId));
      }

      // WRITE 3: seat release — ONLY if THIS handler owned the
      // active → cancelled transition. Replay or concurrent
      // bookings.cancel paths see affectedRows=0 and skip.
      if (transitionedToCancelled && bookingSnap?.departureId) {
        const seatCount =
          (bookingSnap.numberOfAdults || 0) +
          (bookingSnap.numberOfChildrenWithBed || 0) +
          (bookingSnap.numberOfChildrenNoBed || 0);
        if (seatCount > 0) {
          await db.releaseDepartureSlots(bookingSnap.departureId, seatCount, tx);
        }
      }
    }
  });
  // ↑ db.transaction throws on rollback. We deliberately do NOT catch
  // here so the outer handleStripeWebhook try/catch marks the central
  // idempotency row as `failed` and returns 500 so Stripe retries.

  // ─────────────────────────────────────────────────────────────────────
  // POST-COMMIT: packpoint clawback (its own internal tx + idempotency)
  // ─────────────────────────────────────────────────────────────────────
  if (payment.bookingId) {
    // Round 80.22: claw back any Packpoint awarded for this booking.
    // Per docs/packpoint-policy.md §5: "取消訂單若已發點,扣回該次發放的
    // packpoint(若餘額不足,記為負餘額,需用未來訂單補回)". Our deduct
    // helper caps at current balance (no negative), so users who already
    // spent the points won't get a punitive negative — but the audit trail
    // captures the clawback attempt amount.
    try {
      const booking = bookingSnap ?? (await db.getBookingById(payment.bookingId));
      if (booking && (booking as any).userId) {
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
          log.info(
            { bookingId: payment.bookingId, delta: earnRow.delta },
            "[Stripe Webhook] Clawed back Packpoint from booking refund",
          );
        }
      }
    } catch (err) {
      log.error(
        { err, bookingId: payment.bookingId },
        "[Stripe Webhook] Packpoint clawback failed for booking",
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
    log.error({ err }, "[Stripe Webhook] notifyOwner (refund) failed");
  }

  // v2 Wave 3 Module 3.5 — autonomous RefundAgent triage on every refund.
  //
  // RefundAgent (server/agents/autonomous/refundAgent.ts) used to run only
  // when an admin clicked a button in agentRouter — meaning every Stripe-
  // initiated refund left Jeff without a pre-drafted customer-comm
  // talking-point. Per audit §A Domain A gap: "most-conspicuous
  // autonomy gap."
  //
  // We invoke it AFTER the DB transaction has committed + after notifyOwner
  // / notifyAgentMessage observation fired. If RefundAgent throws (LLM
  // outage, etc.) the Stripe state is already persisted and the customer's
  // refund is real — the missing triage is acceptable degradation.
  //
  // RefundAgent's constitution (alwaysEscalate: true, never auto-send) is
  // already correct. This module only adds the autonomous trigger; the
  // triage goes to the office inbox as a `proposal` message and Jeff
  // composes the customer notification himself.
  try {
    const { runRefundAgent, synthesizeStripeRawMessage } = await import(
      "../agents/autonomous/refundAgent"
    );

    // Fetch active refund policy (same row inquiry uses but agentName=refund).
    let refundPolicyRules: string | null = null;
    try {
      const dbInst = await getDb();
      if (dbInst) {
        const { agentPolicies } = await import("../../drizzle/schema");
        const { and, eq } = await import("drizzle-orm");
        const policyRows = await dbInst
          .select()
          .from(agentPolicies)
          .where(
            and(
              eq(agentPolicies.agentName, "refund"),
              eq(agentPolicies.active, 1),
            ),
          )
          .limit(1);
        if (policyRows[0]) refundPolicyRules = policyRows[0].rules;
      }
    } catch (err) {
      log.warn(
        { err },
        "[Stripe Webhook] RefundAgent policy fetch failed — using defaults",
      );
    }

    const synthesizedRawMessage = synthesizeStripeRawMessage({
      charge: {
        id: charge.id,
        amount: charge.amount,
        amount_refunded: charge.amount_refunded,
        currency: charge.currency ?? "usd",
      },
      paymentIntentId,
      bookingId: payment.bookingId,
      bookingSnapshot: bookingSnap
        ? {
            customerEmail:
              (bookingSnap as { customerEmail?: string }).customerEmail,
            customerName:
              (bookingSnap as { customerName?: string }).customerName,
            departureDate:
              (bookingSnap as { departureDate?: Date | string })
                .departureDate,
          }
        : undefined,
    });

    const triage = await runRefundAgent({
      rawMessage: synthesizedRawMessage,
      customerProfile: undefined,
      policyRules: refundPolicyRules,
      source: "stripe_webhook",
      stripeContext: {
        chargeId: charge.id,
        paymentIntentId,
        refundedAmountUsd: charge.amount_refunded / 100,
        bookingId: payment.bookingId,
        currency: charge.currency ?? "usd",
      },
    });

    const { notifyAgentMessage: notifyTriage } = await import("./agentNotify");
    await notifyTriage({
      agentName: "refund",
      messageType: "proposal",
      title: `💰 退款 triage · Booking #${payment.bookingId ?? "?"} · severity=${triage.severity}`.slice(0, 200),
      body:
        `**Severity:** ${triage.severity}\n` +
        `**Reason category:** ${triage.reasonCategory}\n` +
        `**Customer emotional state:** ${triage.customerEmotionalState}\n\n` +
        `**Jeff briefing:**\n${triage.jeffInternalBriefing}\n\n` +
        `**Suggested actions:**\n` +
        triage.suggestedJeffActions.map((a) => `- ${a}`).join("\n") +
        `\n\n_Confidence: ${triage.confidence} · Auto-triggered by Stripe charge.refunded_`,
      priority:
        triage.severity === "critical"
          ? "critical"
          : triage.severity === "high"
            ? "high"
            : "normal",
      context: {
        chargeId: charge.id,
        paymentIntentId,
        bookingId: payment.bookingId,
        source: "stripe_webhook",
        triage,
      },
    });
    log.info(
      {
        bookingId: payment.bookingId,
        severity: triage.severity,
        confidence: triage.confidence,
      },
      "[Stripe Webhook] RefundAgent triage posted to inbox",
    );
  } catch (err) {
    // Non-fatal: refund itself succeeded; missing triage just means Jeff
    // composes the customer-comms message without the LLM head start.
    log.error(
      { err, chargeId: charge.id, paymentIntentId },
      "[Stripe Webhook] RefundAgent triage failed (non-fatal)",
    );
    try {
      await notifyOwner({
        title: "RefundAgent 自動 triage 失敗 (退款本身已完成)",
        content:
          `Charge ${charge.id} / payment intent ${paymentIntentId} — RefundAgent threw, no draft triage in inbox. ` +
          `Refund itself is already processed in DB. Compose customer notification manually.`,
      });
    } catch {}
  }
}

/**
 * Phase 2 module 5 (2026-05-18): visa-payment handler wraps the
 * payment-info UPDATE + application-status flip + accounting income entry
 * in a single `db.transaction`. Behavior change documented:
 *
 *   BEFORE — the accounting INSERT was inside a `try/catch` that
 *   swallowed errors silently. Net effect: a transient accounting
 *   failure left the visa application marked "paid" with NO accounting
 *   row, breaking reconciliation. Jeff had to spot the gap manually.
 *
 *   AFTER  — accounting failures roll back the visa status flip AND
 *   the payment-info update. The webhook propagates the error so
 *   `markStripeEventFailed` records it on `stripeWebhookEvents`, Stripe
 *   retries, and either (a) the transient error clears (everything
 *   succeeds on the next attempt) or (b) the row stays `status='failed'`
 *   for Jeff to investigate. Strictly better for reconciliation —
 *   the behavior change is intentional.
 *
 * Post-commit side effects (`sendVisaApplicationConfirmation`,
 * `notifyOwner`) keep their existing `try/catch` so an email or
 * notification failure can't block the webhook ack — the customer is
 * already "paid" in both Stripe and our DB by that point.
 */
async function handleVisaPaymentCompleted(
  session: Stripe.Checkout.Session,
  applicationId: number
) {
  log.info({ applicationId }, "[Stripe Webhook] Processing visa payment");

  const application = await db.getVisaApplicationById(applicationId);
  if (!application) {
    log.error({ applicationId }, "[Stripe Webhook] Visa application not found");
    return;
  }

  const visaAmount = session.amount_total ? session.amount_total / 100 : 0;
  const currency = (session.currency ?? "usd").toUpperCase();

  const drizzleDbForTx = await db.getDb();
  if (!drizzleDbForTx) {
    throw new Error(
      "[Stripe Webhook] Database not available for visa payment transaction"
    );
  }

  // Atomic write block: payment-info + application-status + accounting.
  // Any throw inside the callback rolls back ALL three writes (plus the
  // visaStatusHistory row written by updateVisaApplicationStatus).
  await drizzleDbForTx.transaction(async (tx) => {
    // WRITE 1: payment info
    await db.updateVisaPaymentInfo(
      applicationId,
      {
        paymentStatus: "paid",
        stripePaymentIntentId: session.payment_intent as string,
        stripeCheckoutSessionId: session.id,
        paidAt: new Date(),
      },
      tx,
    );

    // WRITE 2: application status → paid (also writes visaStatusHistory row)
    await db.updateVisaApplicationStatus(
      applicationId,
      "paid",
      undefined,
      "Stripe 付款完成",
      tx,
    );

    // WRITE 3: accounting income entry. NO longer wrapped in try/catch —
    // a failure here MUST roll back writes 1 and 2 so reconciliation
    // stays consistent.
    await createAccountingEntry(
      {
        entryType: "income",
        category: "visa_service",
        amount: String(visaAmount),
        currency,
        description: `中國簽證代辦 #${applicationId}（${application.firstName} ${application.lastName}）`,
        visaApplicationId: applicationId,
        entryDate: new Date(),
        isTaxDeductible: 0,
        createdBy: 1,
      },
      tx,
    );
  });

  log.info({ applicationId }, "[Stripe Webhook] Visa application payment confirmed");

  // Post-commit side effects: email + owner notification. Failures here
  // are logged but never propagate.
  try {
    await sendVisaApplicationConfirmation({
      toEmail: application.email,
      applicantName: `${application.firstName} ${application.lastName}`,
      applicationId,
      totalAmount: Number(application.totalAmount),
      passportNumber: application.passportNumber,
      travelDate: application.travelDate ?? undefined,
    });
    log.info(
      { applicationEmail: redactEmail(application.email) },
      "[Stripe Webhook] Visa confirmation email sent",
    );
  } catch (error) {
    log.error({ err: error }, "[Stripe Webhook] Failed to send visa confirmation email");
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
    log.error({ err }, "[Stripe Webhook] notifyOwner (visa) failed");
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

/**
 * Phase 2 Module 4 (2026-05-18) — subscription upsert handler.
 *
 * All user-tier writes + membershipTrials writes happen INSIDE one
 * `db.transaction` so a crash mid-sequence rolls back atomically.
 *
 * Critical atomicity fix: previously the trial-start INSERT and the
 * `users.{plus|concierge}TrialUsedAt` UPDATE were two separate writes
 * with a try/catch swallowing failures. A crash between them left an
 * orphan trial row with no flag on the user — letting the customer
 * re-trial the same tier. The transaction fixes this.
 *
 * Side effects (logging) stay outside the tx. There are no email sends
 * here — those live in `handleTrialWillEnd`.
 */
async function handleSubscriptionUpserted(sub: Stripe.Subscription) {
  log.info(
    { subscriptionId: sub.id, status: sub.status },
    "[Stripe Webhook] Processing subscription upsert",
  );

  // Identify the user — first by metadata.userId, fallback to customer
  const userIdFromMeta = sub.metadata?.userId;
  let userId: number | null = userIdFromMeta ? parseInt(userIdFromMeta, 10) : null;
  const stripeCustomerId =
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
    log.error(
      { subscriptionId: sub.id },
      "[Stripe Webhook] Could not identify user for subscription",
    );
    return;
  }

  // Map price to tier (pure compute, safe outside tx)
  const priceId = sub.items.data[0]?.price.id;
  const tier = priceId ? tierFromPriceId(priceId) : null;
  if (!tier) {
    log.warn(
      { subscriptionId: sub.id, priceId },
      "[Stripe Webhook] Subscription priceId doesn't match any tier; skipping",
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

  const { membershipTrials } = await import("../../drizzle/schema");
  const { and: dAnd, eq: dEq } = await import("drizzle-orm");

  await db.transaction(async (tx) => {
    if (isActive) {
      await tx
        .update(users)
        .set({
          tier,
          tierExpiresAt: expiresAt,
          stripeSubscriptionId: sub.id,
          stripeCustomerId,
        })
        .where(eq(users.id, userId!));

      // Round 81 / migration 0075 — Membership trial tracking.
      // Three transitions matter:
      //   (a) trial start (status=trialing, no existing membershipTrials row)
      //       → create row + flip users.{plus|concierge}TrialUsedAt
      //   (b) trial → active (status=active, existing row.converted=false)
      //       → mark row.converted=true, convertedAt=now
      //   (c) active → ... no trial-table action needed
      //
      // Module 4 (2026-05-18): both writes wrapped in the parent tx — no
      // more try/catch swallowing partial-trial-write failures.
      const trialEnd = (sub as any).trial_end as number | null | undefined;
      const isTrialing = sub.status === "trialing";

      // (a) Trial start — only if user has never trialed THIS tier before
      if (isTrialing && trialEnd) {
        const tierFlag = tier === "plus" ? "plusTrialUsedAt" : "conciergeTrialUsedAt";
        const usedAtCol = (users as any)[tierFlag];
        const userRow = await tx
          .select({ used: usedAtCol })
          .from(users)
          .where(eq(users.id, userId!))
          .limit(1);
        const alreadyTrialed = userRow[0]?.used != null;

        if (!alreadyTrialed) {
          await tx.insert(membershipTrials).values({
            userId: userId!,
            tier,
            endsAt: new Date(trialEnd * 1000),
            stripeSubscriptionId: sub.id,
            stripePriceId: priceId || null,
          } as any);
          await tx
            .update(users)
            .set({ [tierFlag]: new Date() } as any)
            .where(eq(users.id, userId!));
        }
      }

      // (b) Trial → active conversion — find pending row, mark converted
      if (sub.status === "active") {
        const pendingTrial = await tx
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
          await tx
            .update(membershipTrials)
            .set({ converted: true, convertedAt: new Date() })
            .where(dEq(membershipTrials.id, pendingTrial[0].id));
        }
      }
    } else {
      await tx
        .update(users)
        .set({
          tier: "free",
          tierExpiresAt: null,
          stripeSubscriptionId: sub.id, // keep ref for re-activate
          stripeCustomerId,
        })
        .where(eq(users.id, userId!));
    }
  });

  if (isActive) {
    log.info(
      { userId, tier, expiresAt: expiresAt?.toISOString() },
      "[Stripe Webhook] User tier updated",
    );
  } else {
    log.info(
      { userId, status: sub.status },
      "[Stripe Webhook] User subscription reverted to free",
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
  log.info({ subscriptionId: sub.id }, "[Stripe Webhook] Processing trial_will_end");

  const drizzleDb = await getDb();
  if (!drizzleDb) return;

  const { membershipTrials } = await import("../../drizzle/schema");

  // ─── PHASE 1: INSIDE TX — flag the trial as "reminder sent" BEFORE we
  // actually attempt to send the email. Lifted-state pattern. ───
  type TrialSnapshot = {
    id: number;
    userId: number;
    tier: "plus" | "concierge";
    endsAt: Date;
    reminderAlreadySent: boolean;
  };
  type UserSnapshot = { id: number; email: string; name: string | null };

  let trialSnapshot: TrialSnapshot | null = null;
  let userSnapshot: UserSnapshot | null = null;

  await drizzleDb.transaction(async (tx) => {
    const trialRows = await tx
      .select()
      .from(membershipTrials)
      .where(eq(membershipTrials.stripeSubscriptionId, sub.id))
      .limit(1);

    const trial = trialRows[0];
    if (!trial) {
      log.warn(
        { subscriptionId: sub.id },
        "[Stripe Webhook] trial_will_end: no membershipTrials row",
      );
      return;
    }

    const userRows = await tx
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, trial.userId))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      log.warn(
        { trialUserId: trial.userId },
        "[Stripe Webhook] trial_will_end: user not found",
      );
      return;
    }

    trialSnapshot = {
      id: trial.id,
      userId: trial.userId,
      tier: trial.tier,
      endsAt: trial.endsAt,
      reminderAlreadySent: trial.reminderSentAt != null,
    };
    userSnapshot = { id: user.id, email: user.email, name: user.name };

    // FLAG FIRST: write reminderSentAt before the email send.
    // If a previous run already set the flag (belt-and-suspenders against a
    // lost central idempotency row), skip the write but still continue to
    // post-commit so the test fixture can assert idempotency cleanly.
    if (!trialSnapshot.reminderAlreadySent) {
      await tx
        .update(membershipTrials)
        .set({ reminderSentAt: new Date() })
        .where(eq(membershipTrials.id, trial.id));
    }
  });

  // If the tx returned early (no trial or no user) we have nothing to send.
  if (!trialSnapshot || !userSnapshot) return;

  // Local non-null aliases — the closure assignments above are invisible to
  // TS's control-flow analysis, so we copy into fresh locals to refine away
  // the implicit-nullability.
  const trialData: TrialSnapshot = trialSnapshot;
  const userData: UserSnapshot = userSnapshot;

  // If a prior call already flagged + sent (defensive: should normally be
  // caught by the central idempotency row), do NOT re-send the email.
  if (trialData.reminderAlreadySent) {
    log.info(
      { trialId: trialData.id },
      "[Stripe Webhook] trial_will_end: reminder already sent, skipping email",
    );
    return;
  }

  // ─── PHASE 2: POST-COMMIT — send the email + notify Jeff. ───
  const amount = sub.items.data[0]?.price.unit_amount || 0;
  const currency = (sub.items.data[0]?.price.currency || "usd").toUpperCase();
  const formattedAmount = `${currency} $${(amount / 100).toFixed(2)}`;
  const interval = sub.items.data[0]?.price.recurring?.interval || "month";
  const tierLabel = trialData.tier === "plus" ? "Plus" : "Concierge";

  try {
    const { sendTrialEndingReminder } = await import("../email");
    await sendTrialEndingReminder({
      to: userData.email,
      customerName: userData.name || "Traveler",
      tierLabel,
      trialEndsAt: trialData.endsAt,
      chargeAmount: formattedAmount,
      chargeInterval: interval as "month" | "year",
      cancelUrl: `${ENV.baseUrl || "https://packgoplay.com"}/membership?manage=1`,
    });

    log.info(
      {
        userId: userData.id,
        tier: trialData.tier,
        chargeAmount: formattedAmount,
        endsAt: trialData.endsAt.toISOString(),
      },
      "[Stripe Webhook] Trial-end reminder sent",
    );

    await notifyOwner({
      title: `Trial 即將結束: ${userData.name || userData.email}`,
      content:
        `會員: ${userData.email}\nTier: ${tierLabel}\n試用結束: ${trialData.endsAt.toISOString()}\n即將收費: ${formattedAmount}\nAB 390 reminder email 已發送。`,
    }).catch(() => {});

    // Round 81 (2026-05-17): #books channel — membership trial about to convert.
    const { notifyAgentMessage } = await import("./agentNotify");
    await notifyAgentMessage({
      agentName: "books",
      messageType: "observation",
      title: `Trial 即將結束 → 即將收 ${formattedAmount}`,
      body:
        `客戶: ${userData.name || userData.email}\n` +
        `Tier: ${tierLabel}\n` +
        `試用結束: ${trialData.endsAt.toISOString().slice(0, 10)}\n` +
        `自動扣款: ${formattedAmount}\n` +
        `AB 390 §17602(c) 3 天前提醒 email 已發送 ✓`,
      priority: "low",
      context: { userId: userData.id, trialId: trialData.id, stripeSubscriptionId: sub.id },
    });
  } catch (err) {
    // D1 (Module 4): post-commit email failure path. The flag was already
    // set in the tx above, so a Stripe webhook retry will short-circuit at
    // claimStripeEvent → we will NOT re-attempt this email. To preserve
    // AB-390 compliance we alert Jeff urgently so manual follow-up can
    // happen. We do NOT re-throw — letting the handler return success
    // marks the idempotency row "succeeded" so Stripe stops retrying
    // (which would only burn DB writes, not send any email).
    log.error(
      { err },
      "[Stripe Webhook] trial_will_end: reminder email failed AFTER flag commit",
    );
    await notifyOwner({
      title: `[URGENT] AB-390 trial reminder email FAILED — manual follow-up needed`,
      content:
        `User: ${userData.email} (id=${userData.id})\n` +
        `Tier: ${tierLabel}\n` +
        `試用結束: ${trialData.endsAt.toISOString()}\n` +
        `即將收費: ${formattedAmount}\n\n` +
        `The reminderSentAt flag has been committed in the database, so Stripe will NOT retry. ` +
        `Please manually send the AB-390 disclosure email to this customer BEFORE the charge date, ` +
        `or AB-390 §17602 compliance is at risk.\n\n` +
        `Original error: ${(err as Error).message}`,
    }).catch((notifyErr) => {
      log.error(
        { err: notifyErr },
        "[Stripe Webhook] trial_will_end: failure-alert notifyOwner ALSO failed",
      );
    });
  }
}

/**
 * Phase 2 Module 4 (2026-05-18) — subscription cancellation handler.
 * Wrapped in db.transaction for symmetry with the other subscription
 * handlers; the single write also benefits from being in a clear
 * transactional boundary.
 */
async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  log.info({ subscriptionId: sub.id }, "[Stripe Webhook] Processing subscription deletion");
  const drizzleDb = await getDb();
  if (!drizzleDb) return;
  await drizzleDb.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        tier: "free",
        tierExpiresAt: null,
        stripeSubscriptionId: null,
      })
      .where(eq(users.stripeSubscriptionId, sub.id));
  });
  log.info({ subscriptionId: sub.id }, "[Stripe Webhook] Subscription canceled → users reverted to free");
}

// ─────────────────────────────────────────────────────────────────────
// Test-only exports — Vitest reaches into the module-private handlers
// to exercise the transaction wrapping without going through the
// full handleStripeWebhook signature-verification + dispatch path.
// Do NOT use these at runtime.
// ─────────────────────────────────────────────────────────────────────
export const __test__ = {
  handleChargeRefunded,
  handleSubscriptionUpserted,
  handleSubscriptionDeleted,
  handleTrialWillEnd,
};
