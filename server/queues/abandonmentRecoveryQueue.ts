/**
 * abandonmentRecoveryQueue.ts — v78n Sprint 6A: cart abandonment recovery.
 *
 * Workflow:
 *   1. bookings.create (status='pending', payment not completed) →
 *      schedule recovery job 30 minutes later
 *   2. Stripe webhook on payment success → cancel pending recovery job
 *   3. If recovery job fires (still pending after 30 min) → send email with
 *      5% recovery code + BACK link
 *
 * Industry data: 15-25% of abandoned carts recover with this flow.
 */

import { Queue, Worker, Job } from "bullmq";
import { redisBullMQ } from "../redis";
import { sendAbandonmentRecoveryEmail } from "../email";
import * as db from "../db";

const QUEUE_NAME = "abandonment-recovery";
const RECOVERY_DELAY_MS = 30 * 60 * 1000; // 30 minutes

export interface AbandonmentRecoveryJob {
  bookingId: number;
}

export const abandonmentRecoveryQueue = new Queue<AbandonmentRecoveryJob>(
  QUEUE_NAME,
  {
    connection: redisBullMQ,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  }
);

/**
 * Schedule the 30-min recovery email when a booking is created.
 * Idempotent — duplicate calls don't re-queue.
 */
export async function scheduleAbandonmentRecovery(bookingId: number) {
  await abandonmentRecoveryQueue.add(
    `recovery-${bookingId}`,
    { bookingId },
    {
      delay: RECOVERY_DELAY_MS,
      jobId: `recovery-${bookingId}`,
    }
  );
  console.log(
    `[AbandonmentRecovery] Scheduled 30-min recovery email for booking #${bookingId}`
  );
}

/**
 * Cancel the pending recovery (used when payment completes).
 */
export async function cancelAbandonmentRecovery(bookingId: number) {
  const job = await abandonmentRecoveryQueue.getJob(`recovery-${bookingId}`);
  if (job) {
    await job.remove();
    console.log(`[AbandonmentRecovery] Cancelled for booking #${bookingId} (payment completed)`);
  }
}

let _worker: Worker<AbandonmentRecoveryJob> | null = null;

export function initAbandonmentRecoveryWorker() {
  if (_worker) return _worker;
  _worker = new Worker<AbandonmentRecoveryJob>(
    QUEUE_NAME,
    async (job: Job<AbandonmentRecoveryJob>) => {
      const { bookingId } = job.data;
      const booking = await db.getBookingById(bookingId);
      if (!booking) {
        return { skipped: "missing" };
      }
      // Skip if already paid or cancelled
      if (booking.paymentStatus === "paid") {
        return { skipped: "already_paid" };
      }
      if (booking.bookingStatus === "cancelled") {
        return { skipped: "cancelled" };
      }
      if (!booking.customerEmail) {
        return { skipped: "no_email" };
      }

      const tour = await db.getTourById(booking.tourId);
      if (!tour) {
        return { skipped: "no_tour" };
      }

      const departure = booking.departureId
        ? await db.getDepartureById(booking.departureId).catch(() => null)
        : null;

      const ok = await sendAbandonmentRecoveryEmail({
        customerEmail: booking.customerEmail,
        customerName: booking.customerName,
        bookingId: booking.id,
        tourTitle: tour.title,
        departureDate: departure?.departureDate
          ? new Date(departure.departureDate).toLocaleDateString("zh-TW")
          : "TBD",
        totalPrice: Number(booking.totalPrice) || 0,
        currency: booking.currency || "TWD",
      });
      return { sent: ok };
    },
    {
      connection: redisBullMQ,
      concurrency: 4,
    }
  );
  _worker.on("failed", (job, err) => {
    console.error(`[AbandonmentRecovery] Job ${job?.id} failed:`, err.message);
  });
  console.log("✅ Abandonment recovery worker initialized");
  return _worker;
}
