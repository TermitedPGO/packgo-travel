/**
 * AI Quotes router — public quote generation + admin funnel views (v78).
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 *
 * Procedures (3):
 *   - generate              – public: free-form intent → matched tours → PDF
 *   - adminList             – admin: funnel view of generated quotes
 *   - adminMarkConverted    – admin: link a quote to a booking
 */

import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { reportFunnelError } from "../_core/errorFunnel";

// v74 bounded string helpers — preserved from routers.ts
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const noControlChars = (s: string) => !CONTROL_CHARS.test(s);
const shortStr = z.string().max(255).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });
const mediumStr = z.string().max(5_000).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });

export const aiQuotesRouter = router({
    // Public — anyone can request a quote without signing up
    generate: publicProcedure
      .input(
        z.object({
          rawRequest: mediumStr.min(10), // at least 10 chars; max 5000
          customerName: shortStr.optional(),
          customerEmail: z.string().email().max(320).optional(),
          customerPhone: shortStr.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { extractQuoteParams, matchToursForQuote, buildQuotePdf, generateQuoteNumber } =
          await import("../services/aiQuoteService");

        // 1. Extract params via LLM
        const params = await extractQuoteParams(input.rawRequest);

        // 2. Match against tour catalog
        const matched = await matchToursForQuote(params);

        // 3. Generate PDF + persist
        const quoteNumber = await generateQuoteNumber();
        const validUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
        const { html, r2Url } = await buildQuotePdf({
          quoteNumber,
          rawRequest: input.rawRequest,
          params,
          tours: matched,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          validUntil,
        });

        const totalPax = (params.adults || 1) + (params.children || 0);
        const estimatedTotal = matched[0]
          ? Math.ceil(matched[0].price * totalPax)
          : null;

        // Persist for funnel tracking — store HTML inline so the quote is
        // viewable even when R2 storage is unavailable. URL is set after
        // insert (fallback) or to R2 URL (preferred when available).
        const inserted = await db.createAiQuote({
          rawRequest: input.rawRequest,
          extractedParams: JSON.stringify(params),
          quoteNumber,
          recommendedTours: JSON.stringify(matched.map((t: any) => t.id)),
          estimatedTotal,
          currency: params.currency || (matched[0]?.priceCurrency) || "USD",
          pdfUrl: r2Url, // may be overwritten below to view-route fallback
          pdfHtml: html,
          customerName: input.customerName || null,
          customerEmail: input.customerEmail || null,
          customerPhone: input.customerPhone || null,
          userId: ctx.user?.id || null,
          status: "generated",
          validUntil,
        } as any);

        // Fallback URL when R2 was unavailable: serve from /api/aiQuotes/:id/view
        let finalPdfUrl: string | null = r2Url;
        if (!finalPdfUrl && inserted?.id) {
          const { ENV } = await import("../_core/env");
          const base = ENV.baseUrl || "https://packgo-travel.fly.dev";
          finalPdfUrl = `${base.replace(/\/+$/, "")}/api/aiQuotes/${inserted.id}/view`;
          // Update the row so adminList / external links see the resolvable URL
          await db.updateAiQuote(inserted.id, { pdfUrl: finalPdfUrl } as any);
        }

        // v78l Sprint 4B: schedule 24h/3d/7d follow-up emails (no-op if no email)
        if (inserted?.id && input.customerEmail) {
          try {
            const { scheduleQuoteFollowUps } = await import("../queues/quoteFollowUpQueue");
            await scheduleQuoteFollowUps(inserted.id, input.customerEmail);
          } catch (err) {
            console.warn("[aiQuotes.generate] Failed to schedule follow-ups:", (err as Error).message);
            reportFunnelError({ source: "fail-open:aiQuotes:scheduleQuoteFollowUps", err, context: { quoteId: inserted?.id } }).catch(() => {});
          }
        }

        return {
          quoteId: inserted?.id,
          quoteNumber,
          pdfUrl: finalPdfUrl,
          matchedTourIds: matched.map((t: any) => t.id),
          extractedParams: params,
          estimatedTotal,
          currency: params.currency || matched[0]?.priceCurrency || "USD",
          validUntil,
        };
      }),

    // Admin — list all generated quotes (funnel view)
    adminList: adminProcedure
      .input(z.object({
        status: z.enum(["generated", "sent", "viewed", "converted", "expired"]).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }))
      .query(async ({ input }) => {
        return await db.listAiQuotes(input);
      }),

    // Mark quote as converted (when admin finds matching booking)
    adminMarkConverted: adminProcedure
      .input(z.object({
        quoteId: z.number().int().positive().max(2_147_483_647),
        bookingId: z.number().int().positive().max(2_147_483_647),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.updateAiQuote(input.quoteId, {
          status: "converted",
          bookingId: input.bookingId,
        });
        // v78l Sprint 4B: cancel any scheduled follow-up emails — customer is converted
        try {
          const { cancelQuoteFollowUps } = await import("../queues/quoteFollowUpQueue");
          await cancelQuoteFollowUps(input.quoteId);
        } catch {}
        const { audit } = await import("../_core/auditLog");
        audit({
          ctx,
          action: "aiQuote.markConverted",
          targetType: "aiQuote",
          targetId: input.quoteId,
          changes: { bookingId: input.bookingId },
        });
        return { success: true };
      }),
  });
