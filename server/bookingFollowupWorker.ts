/**
 * BullMQ Worker for the booking-followup queue.
 *
 * Runs the post-commit work that used to be a fire-and-forget IIFE
 * inside bookings.create:
 *   1. Render deposit invoice PDF (Puppeteer, ~5-15s)
 *   2. Upload PDF to R2
 *   3. Send confirmation email with the PDF URL embedded
 *
 * Why a queue instead of fire-and-forget:
 *   - Survives server restarts (Redis-backed)
 *   - 2 automatic retries on transient failure (exponential backoff)
 *   - notifyOwner alerts Jeff via Gmail on final failure (commit 35897de)
 *   - Failed jobs visible in adminAuditLog / BullMQ dashboard for ops
 *
 * Concurrency 2 — Puppeteer renders are CPU-bound, more parallelism
 * just thrashes. Two concurrent bookings can render in parallel
 * (mid-day spike absorber) without overloading the box.
 */

import { Worker, Job } from "bullmq";
import { redis, redisBullMQ } from "./redis";
import {
  BookingFollowupJobData,
  BookingFollowupJobResult,
} from "./queue";
import { notifyOwner } from "./_core/notification";

// Code-review v2 follow-up: if Puppeteer breaks for a reason that isn't
// transient (template HTML bug, library upgrade regression, R2 outage),
// every subsequent booking would silently ship without the PDF and Jeff
// would have no signal. Track consecutive PDF failures across all bookings
// in a shared Redis counter. After PDF_FAILURE_ALERT_THRESHOLD in a row,
// fire one notifyOwner alert; reset on first success. Notification is
// throttled by a separate "alert sent" key so we don't spam after every
// additional failure once the threshold is crossed.
const PDF_FAILURE_COUNTER_KEY = "booking-followup:pdf-failures";
const PDF_FAILURE_ALERT_KEY = "booking-followup:pdf-alert-sent";
const PDF_FAILURE_ALERT_THRESHOLD = 5;
const PDF_FAILURE_ALERT_REARM_SECONDS = 6 * 60 * 60; // 6 hours

async function trackPdfFailure(bookingId: number, err: unknown): Promise<void> {
  try {
    const count = await redis.incr(PDF_FAILURE_COUNTER_KEY);
    if (count >= PDF_FAILURE_ALERT_THRESHOLD) {
      // Throttle: alert at most once per 6h. SET NX returns null if already set.
      const setResult = await redis.set(
        PDF_FAILURE_ALERT_KEY,
        String(Date.now()),
        "EX",
        PDF_FAILURE_ALERT_REARM_SECONDS,
        "NX"
      );
      if (setResult === "OK") {
        await notifyOwner({
          title: `🚨 PDF service degraded — ${count} consecutive failures`,
          content:
            `Booking followup worker has failed to generate the deposit invoice PDF ` +
            `${count} times in a row (most recent: booking #${bookingId}).\n\n` +
            `Customers are receiving confirmation emails WITHOUT the deposit invoice ` +
            `link until this is fixed.\n\n` +
            `Most recent error:\n${(err as Error)?.message ?? "(unknown)"}\n\n` +
            `Check Fly logs for Puppeteer / R2 / template errors. Counter resets to 0 on next ` +
            `successful render; this alert re-arms after 6 hours.`,
        });
      }
    }
  } catch (counterErr) {
    console.warn(
      "[BookingFollowupWorker] Failed to track PDF failure counter:",
      (counterErr as Error)?.message
    );
  }
}

async function clearPdfFailureCounter(): Promise<void> {
  try {
    await redis.del(PDF_FAILURE_COUNTER_KEY);
  } catch {
    /* counter cleanup is best-effort */
  }
}

export const bookingFollowupWorker = new Worker<
  BookingFollowupJobData,
  BookingFollowupJobResult
>(
  "booking-followup",
  async (job: Job<BookingFollowupJobData, BookingFollowupJobResult>) => {
    const d = job.data;
    console.log(
      `[BookingFollowupWorker] Job ${job.id} for booking ${d.bookingId}`
    );

    // 1. Render the deposit invoice PDF + upload
    let depositInvoiceUrl: string | null = null;
    try {
      const { renderDepositHtml } = await import(
        "./services/skills/depositTemplate"
      );
      const { renderHtmlToPdf } = await import(
        "./services/skills/skillPdfService"
      );
      const { storagePut } = await import("./storage");

      const html = renderDepositHtml({
        bookingId: d.bookingId,
        customerName: d.contactName,
        customerEmail: d.contactEmail,
        tripName: d.tourTitle,
        departureDate: d.departureDateStr,
        passengers: `${d.adults + d.childWithBed + d.childNoBed} 位`,
        totalUSD: d.isUsd ? d.totalPrice : Math.round(d.totalPrice / 32),
        depositUSD: d.isUsd ? d.depositAmount : Math.round(d.depositAmount / 32),
      });
      const pdf = await renderHtmlToPdf(html);
      const stored = await storagePut(
        `tools/deposits/${Date.now()}_booking-${d.bookingId}.pdf`,
        pdf,
        "application/pdf"
      );
      depositInvoiceUrl = stored.url;
      console.log(
        `[BookingFollowupWorker] PDF ready for booking ${d.bookingId}: ${depositInvoiceUrl}`
      );
      // PDF service is healthy → reset the consecutive-failure counter
      // so any flake recovery promptly re-arms the threshold alert.
      void clearPdfFailureCounter();
    } catch (depositErr) {
      console.warn(
        `[BookingFollowupWorker] Deposit PDF generation failed for booking ${d.bookingId}:`,
        (depositErr as Error)?.message
      );
      // Don't throw — we still want the email to ship (without the PDF link)
      // rather than retry the whole job. PDF failures are usually
      // Puppeteer-flake and rerunning rarely helps. BUT: track the
      // consecutive-failure counter so Jeff gets alerted if the issue
      // turns out to be persistent (template bug, R2 outage, library
      // regression) rather than a single render flake.
      void trackPdfFailure(d.bookingId, depositErr);
    }

    // 2. Send the confirmation email (with PDF URL if it succeeded)
    let emailSent = false;
    try {
      const { sendBookingConfirmationEmail } = await import("./email");
      await sendBookingConfirmationEmail({
        to: d.contactEmail,
        customerName: d.contactName,
        customerEmail: d.contactEmail,
        bookingId: d.bookingId,
        tourTitle: d.tourTitle,
        departureDate: d.departureDateStr,
        returnDate: d.returnDateStr,
        numberOfAdults: d.adults,
        numberOfChildren: d.childWithBed + d.childNoBed,
        numberOfInfants: d.infants,
        totalPrice: d.totalPrice,
        depositAmount: d.depositAmount,
        remainingAmount: d.remainingAmount,
        currency: d.isUsd ? "USD" : "TWD",
        language: d.language,
        depositInvoiceUrl: depositInvoiceUrl ?? undefined,
      });
      emailSent = true;
    } catch (emailErr) {
      console.error(
        `[BookingFollowupWorker] Email send failed for booking ${d.bookingId}:`,
        (emailErr as Error)?.message
      );
      // Email failure DOES throw — BullMQ retries with exponential backoff.
      throw emailErr;
    }

    return {
      bookingId: d.bookingId,
      depositInvoiceUrl,
      emailSent,
    };
  },
  {
    connection: redisBullMQ,
    concurrency: 2,
    lockDuration: 300_000, // 5 min — Puppeteer can take 30s under load
    drainDelay: 30,
  }
);

bookingFollowupWorker.on("completed", (job, result) => {
  console.log(
    `[BookingFollowupWorker] ✅ Job ${job.id} done — booking ${result.bookingId}, email=${result.emailSent}, pdf=${result.depositInvoiceUrl ? "ok" : "missing"}`
  );
});

bookingFollowupWorker.on("failed", (job, err) => {
  console.error(
    `[BookingFollowupWorker] ❌ Job ${job?.id} failed (booking ${
      (job?.data as any)?.bookingId
    }):`,
    err.message
  );
  notifyOwner({
    title: `[BookingFollowup] Job ${job?.id ?? "?"} failed (booking ${
      (job?.data as any)?.bookingId
    })`,
    content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
});

console.log("✅ Booking followup worker initialized");
