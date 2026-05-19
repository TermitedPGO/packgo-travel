/**
 * Invoices router — customer-facing invoice fetch + admin CRUD.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 *
 * Procedures (6):
 *   - forBooking    – customer: get or generate invoice for booking they own
 *   - list          – admin: paginated invoice list
 *   - get           – admin: single invoice by id
 *   - create        – admin: manually create invoice
 *   - updateStatus  – admin: status transition
 *   - delete        – admin: delete invoice
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { generateInvoiceNumber, generateInvoicePdf } from "../services/invoiceService";

export const invoicesRouter = router({
    // v77: customer-facing — get OR generate invoice for a booking the user owns.
    // Returns the invoice URL (S3-hosted HTML) the customer can download/print.
    // If an invoice has already been generated for this booking, returns it
    // straight away; otherwise builds one from the booking data and persists.
    forBooking: protectedProcedure
      .input(z.object({ bookingId: z.number().int().positive().max(2_147_483_647) }))
      .mutation(async ({ ctx, input }) => {
        const booking = await db.getBookingById(input.bookingId);
        if (!booking) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }
        if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not authorised" });
        }

        // Try to find an existing invoice for this booking
        const existing = await db.getInvoiceByBookingId(input.bookingId).catch(() => null);
        if (existing?.pdfUrl) {
          return { url: existing.pdfUrl, invoiceNumber: existing.invoiceNumber, cached: true };
        }

        // Build line items from the booking's seat counts.
        const tour = await db.getTourById(booking.tourId);
        const tourTitle = tour?.title || `行程 #${booking.tourId}`;
        const lineItems: any[] = [];
        if (booking.numberOfAdults && booking.numberOfAdults > 0) {
          const total = Number(booking.totalPrice) || 0;
          // Best-effort split — full breakdown comes from departure pricing
          // when the booking was created. For invoice display, show as one
          // aggregate line if we can't reliably split.
          lineItems.push({
            description: `${tourTitle} — ${booking.numberOfAdults} 大 / ${booking.numberOfChildrenWithBed || 0} 童帶床 / ${booking.numberOfChildrenNoBed || 0} 童不帶床 / ${booking.numberOfInfants || 0} 嬰`,
            quantity: 1,
            unitPrice: total,
            amount: total,
          });
        }

        const invoiceNumber = await generateInvoiceNumber();
        const subtotal = Number(booking.totalPrice) || 0;
        const taxRate = 0; // tax already collected via Stripe line items at checkout
        const taxAmount = 0;
        const totalAmount = subtotal;
        const { html, r2Url } = await generateInvoicePdf({
          invoiceNumber,
          issueDate: new Date(),
          customerName: booking.customerName,
          customerEmail: booking.customerEmail,
          customerPhone: booking.customerPhone || undefined,
          lineItems,
          subtotal,
          taxRate,
          taxAmount,
          totalAmount,
          currency: booking.currency || "TWD",
          status: booking.paymentStatus === "paid" ? "paid" : "pending",
        });

        // v78g: persist HTML inline so the invoice is viewable even if R2 fails
        const inserted = await db.createInvoice({
          invoiceNumber,
          bookingId: input.bookingId,
          customerName: booking.customerName,
          customerEmail: booking.customerEmail,
          customerPhone: booking.customerPhone || null,
          subtotal: String(subtotal),
          taxRate: String(taxRate),
          taxAmount: String(taxAmount),
          totalAmount: String(totalAmount),
          currency: booking.currency || "TWD",
          status: booking.paymentStatus === "paid" ? "paid" : "draft",
          pdfUrl: r2Url,
          pdfHtml: html,
          createdBy: booking.userId || ctx.user.id,
        } as any).catch((e) => {
          console.warn("[invoices.forBooking] persist failed:", e?.message);
          return null;
        });

        // Resolve the final URL: R2 if available, else /api/invoices/:id/view
        let finalUrl: string | null = r2Url;
        if (!finalUrl && inserted?.id) {
          const { ENV } = await import("../_core/env");
          const base = (ENV.baseUrl || "https://packgo-travel.fly.dev").replace(/\/+$/, "");
          finalUrl = `${base}/api/invoices/${inserted.id}/view`;
          await db.updateInvoice(inserted.id, { pdfUrl: finalUrl } as any).catch(() => {});
        }
        if (!finalUrl) {
          // Could not even persist. Return the HTML directly via a data: URL so
          // the customer at least gets something. (Rare path — DB write failed.)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "發票生成失敗，請稍後再試",
          });
        }
        return { url: finalUrl, invoiceNumber, cached: false };
      }),

    // List invoices
    list: adminProcedure
      .input(z.object({
        status: z.string().optional(),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      }))
      .query(async ({ input }) => {
        return db.getInvoices(input);
      }),

    // Get single invoice
    get: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getInvoiceById(input.id);
      }),

    // Create invoice
    create: adminProcedure
      .input(z.object({
        customerName: z.string(),
        customerEmail: z.string().optional(),
        customerPhone: z.string().optional(),
        customerAddress: z.string().optional(),
        lineItems: z.array(z.object({
          description: z.string(),
          quantity: z.number().positive(),
          unitPrice: z.number().positive(),
          amount: z.number().positive(),
        })),
        subtotal: z.number(),
        taxRate: z.number().min(0).max(100).default(0),
        taxAmount: z.number().default(0),
        totalAmount: z.number(),
        currency: z.string().default("TWD"),
        notes: z.string().optional(),
        dueDate: z.date().optional(),
        bookingId: z.number().optional(),
        visaApplicationId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const invoiceNumber = await generateInvoiceNumber();
        const invoiceData = {
          invoiceNumber,
          issueDate: new Date(),
          status: "draft" as const,
          ...input,
        };
        // v78g: generate HTML + best-effort R2 upload (R2 failure is OK)
        const { html, r2Url } = await generateInvoicePdf(invoiceData);
        const invoice = await db.createInvoice({
          ...invoiceData,
          lineItems: JSON.stringify(input.lineItems),
          subtotal: String(input.subtotal),
          taxRate: String(input.taxRate),
          taxAmount: String(input.taxAmount),
          totalAmount: String(input.totalAmount),
          pdfUrl: r2Url ?? undefined,
          pdfHtml: html,
          createdBy: ctx.user.id,
        } as any);

        // If R2 wasn't available, set pdfUrl to the view route now that we have an id
        if (!r2Url && invoice?.id) {
          const { ENV } = await import("../_core/env");
          const base = (ENV.baseUrl || "https://packgo-travel.fly.dev").replace(/\/+$/, "");
          const viewUrl = `${base}/api/invoices/${invoice.id}/view`;
          await db.updateInvoice(invoice.id, { pdfUrl: viewUrl } as any).catch(() => {});
          (invoice as any).pdfUrl = viewUrl;
        }
        return invoice;
      }),

    // Update invoice status
    updateStatus: adminProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["draft", "sent", "paid", "overdue", "cancelled"]),
      }))
      .mutation(async ({ input }) => {
        return db.updateInvoiceStatus(input.id, input.status);
      }),

    // Delete invoice
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteInvoice(input.id);
        return { success: true };
      }),
  });
