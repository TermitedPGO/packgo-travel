import { Request, Response } from "express";
import Stripe from "stripe";
import { ENV } from "./env";
import * as db from "../db";
import { sendPaymentSuccessEmail, sendSupplierNotificationEmail } from "../email";
import { sendVisaApplicationConfirmation } from "../services/visaEmailService";
import { createAccountingEntry } from "../db";


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
  console.log("[Stripe Webhook] Metadata:", session.metadata);

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
      console.log(`[Stripe Webhook] Payment success email sent to ${booking.customerEmail}`);

      // v78l Sprint 4A: Auto-notify supplier if email is on file. Only on
      // FIRST paid event (deposit OR full) — skip on balance to avoid duplicates.
      if (paymentType !== "balance" && (tour as any).supplierEmail) {
        try {
          const departure = booking.departureDate
            ? new Date(booking.departureDate).toLocaleDateString("zh-TW")
            : "TBD";
          const returnDate = booking.endDate
            ? new Date(booking.endDate).toLocaleDateString("zh-TW")
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
    await db.updateBooking(payment.bookingId, { paymentStatus: "refunded" }).catch((e) =>
      console.error("[Stripe Webhook] charge.refunded: updateBooking failed:", e?.message)
    );
    console.log(`[Stripe Webhook] Booking ${payment.bookingId} marked refunded`);
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
    console.log(`[Stripe Webhook] Visa confirmation email sent to ${application.email}`);
  } catch (error) {
    console.error('[Stripe Webhook] Failed to send visa confirmation email:', error);
  }
}
