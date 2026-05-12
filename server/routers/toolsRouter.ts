/**
 * Tools router — server-side wrappers around PACK&GO Claude Code skills.
 *
 * Round 81 / Phase A: starts with packgo-quote. Phases B+C add flight
 * ticket, deposit receipt, marketing engine.
 *
 * Each endpoint:
 *   1. Takes structured input from the admin form
 *   2. Renders skill HTML server-side
 *   3. Generates PDF via Puppeteer
 *   4. Uploads to S3 (using existing storagePut)
 *   5. Returns signed URL the admin UI shows as a download link
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { renderHtmlToPdf } from "../services/skills/skillPdfService";
import { renderQuoteHtml } from "../services/skills/quoteTemplate";
import { renderDepositHtml } from "../services/skills/depositTemplate";
import { storagePut } from "../storage";

export const toolsRouter = router({
  generateQuote: adminProcedure
    .input(
      z.object({
        tripName: z.string().min(1).max(200),
        subtitle: z.string().max(200).optional(),
        departureDate: z.string().min(1).max(200),
        passengers: z.string().min(1).max(100),
        carService: z.string().max(200).optional(),
        serviceConfig: z.array(z.string().max(200)).max(20).optional(),
        hotels: z
          .array(
            z.object({
              date: z.string().max(60),
              name: z.string().min(1).max(200),
              location: z.string().max(100).optional(),
            })
          )
          .max(30),
        hotelNote: z.string().max(500).optional(),
        days: z
          .array(
            z.object({
              day: z.number().int().min(1).max(60),
              date: z.string().max(60).optional(),
              title: z.string().min(1).max(200),
              description: z.string().min(1).max(2000),
            })
          )
          .min(1)
          .max(60),
        totalUSD: z.number().min(0),
        perPersonUSD: z.number().min(0),
        twdRate: z.number().min(20).max(45).optional(),
        includes: z.array(z.string().max(300)).max(30),
        excludes: z.array(z.string().max(300)).max(30),
        payment: z.array(z.string().max(300)).max(10).optional(),
        cancellation: z.array(z.string().max(300)).max(10).optional(),
        validDays: z.number().int().min(1).max(60).optional(),
        clientName: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // 1. Render HTML
        const html = renderQuoteHtml(input);

        // 2. HTML → PDF buffer
        const pdf = await renderHtmlToPdf(html);

        // 3. Upload to S3
        const ts = Date.now();
        const safeTrip = input.tripName.replace(/[^\w一-鿿\-]/g, "_").slice(0, 40);
        const stored = await storagePut(
          `tools/quotes/${ts}_${safeTrip}.pdf`,
          pdf,
          "application/pdf"
        );

        return {
          ok: true as const,
          url: stored.url,
          key: stored.key,
          sizeKb: Math.round(pdf.byteLength / 1024),
        };
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }),

  /**
   * Generate a single-page deposit invoice PDF.
   *
   * QA audit 2026-05-11 Phase 2 + Phase 9 found:
   *   - Phase 2: tools.deposit didn't exist (only tools.quote)
   *   - Phase 9: customers booked but had no clear payment instructions,
   *     so bookings sat unpaid indefinitely
   * This closes both: admin can issue a deposit invoice with a Stripe
   * Checkout link in one click.
   */
  generateDeposit: adminProcedure
    .input(
      z.object({
        bookingId: z.union([z.number().int().positive(), z.string().min(1).max(64)]),
        invoiceNumber: z.string().max(64).optional(),
        issueDate: z.string().max(60).optional(),
        customerName: z.string().min(1).max(100),
        customerEmail: z.string().email().max(320).optional(),
        tripName: z.string().min(1).max(200),
        departureDate: z.string().min(1).max(200),
        passengers: z.string().max(100).optional(),
        totalUSD: z.number().min(0),
        depositUSD: z.number().min(0),
        twdRate: z.number().min(20).max(45).optional(),
        paymentLink: z.string().url().max(2048).optional(),
        dueDate: z.string().max(100).optional(),
        notes: z.array(z.string().max(300)).max(10).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const html = renderDepositHtml(input);
        const pdf = await renderHtmlToPdf(html);

        const ts = Date.now();
        const safeId = String(input.bookingId).replace(/[^\w-]/g, "_").slice(0, 24);
        const stored = await storagePut(
          `tools/deposits/${ts}_${safeId}.pdf`,
          pdf,
          "application/pdf"
        );

        return {
          ok: true as const,
          url: stored.url,
          key: stored.key,
          sizeKb: Math.round(pdf.byteLength / 1024),
        };
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }),
});
