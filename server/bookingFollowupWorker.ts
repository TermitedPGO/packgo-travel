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
import { redisBullMQ } from "./redis";
import {
  BookingFollowupJobData,
  BookingFollowupJobResult,
} from "./queue";
import { notifyOwner } from "./_core/notification";

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
    } catch (depositErr) {
      console.warn(
        `[BookingFollowupWorker] Deposit PDF generation failed for booking ${d.bookingId}:`,
        (depositErr as Error)?.message
      );
      // Don't throw — we still want the email to ship (without the PDF link)
      // rather than retry the whole job. PDF failures are usually
      // Puppeteer-flake and rerunning rarely helps.
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
