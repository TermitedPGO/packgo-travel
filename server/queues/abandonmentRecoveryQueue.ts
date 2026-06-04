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
import { notifyOwner } from "../_core/notification";

const QUEUE_NAME = "abandonment-recovery";
const RECOVERY_DELAY_MS = 30 * 60 * 1000; // 30 minutes
// Seat-hold expiry: a booking that never receives ANY payment releases its held
// seats after this window so abandoned checkouts don't ghost-hold inventory and
// falsely mark a departure "full". Generous (24h) so a real customer has ample
// time to pay.
const EXPIRY_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface AbandonmentRecoveryJob {
  bookingId: number;
  /** "recovery" = 30-min recovery email (default). "expiry" = 24h seat release. */
  kind?: "recovery" | "expiry";
}

/**
 * The ONLY condition under which the 24h job auto-cancels a booking and releases
 * its seats: the booking never received ANY payment and isn't already cancelled.
 * A deposit / paid / refunded booking is a real reservation — NEVER auto-cancel
 * it. Pure + exported for unit testing — this is load-bearing: a wrong condition
 * here would cancel paying customers' bookings.
 */
export function shouldExpireUnpaidBooking(booking: {
  paymentStatus: string | null;
  bookingStatus: string | null;
}): boolean {
  if (booking.bookingStatus === "cancelled") return false;
  return booking.paymentStatus === "unpaid";
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
 * Schedule the 24h seat-hold expiry when a booking is created. If the booking
 * is still unpaid 24h later, its held seats are released (see worker). Idempotent.
 */
export async function scheduleSeatExpiry(bookingId: number) {
  await abandonmentRecoveryQueue.add(
    `expiry-${bookingId}`,
    { bookingId, kind: "expiry" },
    {
      delay: EXPIRY_DELAY_MS,
      jobId: `expiry-${bookingId}`,
    }
  );
  console.log(
    `[SeatExpiry] Scheduled 24h seat-release for booking #${bookingId}`
  );
}

/**
 * Cancel BOTH pending jobs (recovery email + seat expiry) — used when payment
 * completes, so a paid booking never gets the recovery email OR its seats freed.
 */
export async function cancelAbandonmentRecovery(bookingId: number) {
  for (const id of [`recovery-${bookingId}`, `expiry-${bookingId}`]) {
    const job = await abandonmentRecoveryQueue.getJob(id);
    if (job) {
      await job.remove();
      console.log(`[AbandonmentRecovery] Cancelled job ${id} for booking #${bookingId} (payment completed)`);
    }
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

      // ── 24h seat-hold expiry: release seats held by a never-paid booking ──
      if (job.data.kind === "expiry") {
        if (!shouldExpireUnpaidBooking(booking)) {
          // deposit/paid/refunded or already cancelled → keep it, never auto-cancel
          return { skipped: `kept:${booking.bookingStatus}/${booking.paymentStatus}` };
        }
        const seatCount =
          (booking.numberOfAdults || 0) +
          (booking.numberOfChildrenWithBed || 0) +
          (booking.numberOfChildrenNoBed || 0);
        await db.updateBooking(bookingId, { bookingStatus: "cancelled" });
        if (seatCount > 0 && booking.departureId) {
          await db
            .releaseDepartureSlots(booking.departureId, seatCount)
            .catch((e) =>
              console.warn(`[SeatExpiry] release failed for booking ${bookingId}:`, (e as Error)?.message)
            );
        }
        console.log(`[SeatExpiry] Released ${seatCount} seat(s) for unpaid booking #${bookingId} after 24h`);
        return { expired: true, seatCount };
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
    notifyOwner({
      title: `[AbandonmentRecovery] Job ${job?.id ?? "?"} failed`,
      content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
    }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
  });
  console.log("✅ Abandonment recovery worker initialized");
  return _worker;
}
