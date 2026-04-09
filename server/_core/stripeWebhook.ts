import { Request, Response } from "express";
import Stripe from "stripe";
import { ENV } from "./env";
import * as db from "../db";
import { sendPaymentSuccessEmail } from "../email";
import { sendVisaApplicationConfirmation } from "../services/visaEmailService";
import { getVisaTypeName, getEntryTypeName, getProcessingSpeedInfo } from "../services/visaPricingService";

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

  await db.updateBooking(parseInt(bookingId), {
    paymentStatus: newPaymentStatus,
    bookingStatus: "confirmed",
  });

  console.log(`[Stripe Webhook] Booking ${bookingId} payment status updated to ${newPaymentStatus}`);

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
      });
      console.log(`[Stripe Webhook] Payment success email sent to ${booking.customerEmail}`);
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

  console.log(`[Stripe Webhook] Visa application ${applicationId} payment confirmed`);

  // Send confirmation email
  try {
    const visaTypeName = getVisaTypeName(application.visaType as Parameters<typeof getVisaTypeName>[0]);
    const entryTypeName = getEntryTypeName(application.entryType as Parameters<typeof getEntryTypeName>[0]);
    const speedInfo = getProcessingSpeedInfo(application.processingSpeed as Parameters<typeof getProcessingSpeedInfo>[0]);

    await sendVisaApplicationConfirmation({
      toEmail: application.email,
      applicantName: `${application.firstName} ${application.lastName}`,
      applicationId,
      visaTypeName,
      entryTypeName,
      processingSpeedLabel: speedInfo.label,
      processingDuration: speedInfo.duration,
      totalAmount: Number(application.totalAmount),
      passportNumber: application.passportNumber,
      travelDate: application.travelDate ?? undefined,
    });
    console.log(`[Stripe Webhook] Visa confirmation email sent to ${application.email}`);
  } catch (error) {
    console.error('[Stripe Webhook] Failed to send visa confirmation email:', error);
  }
}
