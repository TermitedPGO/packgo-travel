/**
 * China Visa router — admin + public visa application workflow.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1). Source range
 * (verbatim from origin): L3891-4112.
 *
 * Procedures (7):
 *   - calculatePricing       – public: dynamic price by group size
 *   - submitApplication      – public: applicant submission + Stripe Checkout
 *   - getApplicationStatus   – public (ownership-guarded): status fetch
 *   - adminListApplications  – admin: paged applicant list
 *   - adminStats             – admin: aggregate stats
 *   - adminUpdateStatus      – admin: state machine transition + email
 *   - adminUpdateNotes       – admin: notes + tracking number
 *
 * Security note (preserved from origin v70): getApplicationStatus enforces
 * ownership (userId match) OR matching email (guest path) OR admin role.
 * Anonymous enumeration of `applicationId` was a PII / GDPR leak before v70.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { calculateVisaPricing } from "../services/visaPricingService";
import {
  sendVisaStatusUpdate,
  sendVisaApprovedEmail,
  sendVisaRejectedEmail,
} from "../services/visaEmailService";
import { ENV } from "../_core/env";
import { reportFunnelError } from "../_core/errorFunnel";

// P0-1: Lazy-load Stripe to prevent server crash when STRIPE_SECRET_KEY is not set
let _stripeClient: Stripe | null = null;
function getStripeClient(): Stripe {
  if (!_stripeClient) {
    if (!ENV.stripeSecretKey) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Stripe 付款服務尚未設定，請聯絡管理員",
      });
    }
    _stripeClient = new Stripe(ENV.stripeSecretKey);
  }
  return _stripeClient;
}

export const visaRouter = router({
    // ── 公開：計算定價 ──────────────────────────────────────────
    calculatePricing: publicProcedure
      .input(z.object({
        groupSize: z.number().min(1).default(1),
      }))
      .query(({ input }) => {
        return calculateVisaPricing({ groupSize: input.groupSize });
      }),

    // ── 公開：提交申請 + 建立 Stripe Checkout Session ──────────
    submitApplication: publicProcedure
      .input(z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().min(1),
        passportNumber: z.string().min(1),
        passportExpiry: z.string().min(1),
        passportCountry: z.string().min(1),
        dateOfBirth: z.string().min(1),
        placeOfBirth: z.string().optional(),
        visaType: z.string().optional(),
        entryType: z.string().optional(),
        processingSpeed: z.string().optional(),
        travelDate: z.string().optional(),
        travelPurpose: z.string().optional(),
        previousVisits: z.number().default(0),
        groupSize: z.number().default(1),
        groupApplicants: z.string().optional(),
        isReturningCustomer: z.boolean().default(false),
      }))
      .mutation(async ({ input, ctx }) => {
        // 簡化定價：全包價 $290/人（個人）或 $275/人（團體2人以上）
        const pricing = calculateVisaPricing({ groupSize: input.groupSize });

        const applicationId = await db.createVisaApplication({
          userId: ctx.user?.id ?? null,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          passportNumber: input.passportNumber,
          passportExpiry: input.passportExpiry,
          passportCountry: input.passportCountry,
          dateOfBirth: input.dateOfBirth,
          placeOfBirth: input.placeOfBirth ?? null,
          visaType: (input.visaType ?? "L_tourist") as any,
          entryType: (input.entryType ?? "single") as any,
          processingSpeed: "regular" as any,
          travelDate: input.travelDate ?? null,
          travelPurpose: input.travelPurpose ?? null,
          previousVisits: input.previousVisits,
          serviceFee: pricing.pricePerPerson.toString(),
          consulateFee: "0",
          totalAmount: pricing.grandTotal.toString(),
          discountType: pricing.isGroupDiscount ? "group" : "none",
          groupSize: input.groupSize,
          groupApplicants: input.groupApplicants ?? null,
          applicationStatus: "submitted",
        });

        // Create Stripe Checkout Session
        const stripe = getStripeClient();
        const siteUrl = process.env.SITE_URL || "https://packgo-travel.fly.dev";

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: "中國簽證代辦服務（全包）",
                  description: "含領事館費、證件照拍攝、代填表格、人工送送",
                },
                unit_amount: pricing.pricePerPerson * 100,
              },
              quantity: input.groupSize,
            },
          ],
          mode: "payment",
          allow_promotion_codes: true,
          success_url: `${siteUrl}/china-visa/success?session_id={CHECKOUT_SESSION_ID}&application_id=${applicationId}`,
          cancel_url: `${siteUrl}/china-visa`,
          customer_email: input.email,
          client_reference_id: ctx.user?.id?.toString() ?? undefined,
          metadata: {
            visa_application_id: String(applicationId),
            payment_type: "visa",
            user_id: ctx.user?.id?.toString() ?? "",
            customer_email: input.email,
            customer_name: `${input.firstName} ${input.lastName}`,
          },
        });

        // Save session ID
        await db.updateVisaPaymentInfo(applicationId, {
          paymentStatus: "unpaid",
          stripeCheckoutSessionId: session.id,
        });

        return { applicationId, checkoutUrl: session.url };
      }),

    // ── 查詢申請狀態 ──────────────────────────────────────
    // v70 SECURITY FIX: was `publicProcedure` with NO ownership check — any
    // anonymous caller could enumerate `applicationId` and read every applicant's
    // passport number, DOB, email, phone, payment status. PII / GDPR / CCPA leak.
    // Now requires authentication AND (a) user owns the application, OR
    // (b) user is admin. Guest applicants who applied without logging in must
    // present matching `email` to retrieve status (defense-in-depth lookup).
    getApplicationStatus: publicProcedure
      .input(z.object({
        applicationId: z.number().int().positive().max(2_147_483_647),
        email: z.string().email().optional(), // for guest applicants (no userId)
      }))
      .query(async ({ ctx, input }) => {
        const application = await db.getVisaApplicationById(input.applicationId);
        if (!application) throw new TRPCError({ code: "NOT_FOUND", message: "申請案件不存在" });

        // Admin can read any application
        const isAdmin = ctx.user?.role === "admin";
        // Authenticated user must own it
        const isOwnerByUserId =
          !!ctx.user?.id && !!application.userId && ctx.user.id === application.userId;
        // Guest path: matching email + correct applicationId (rate-limited at edge)
        const isOwnerByEmail =
          !!input.email && application.email.toLowerCase() === input.email.toLowerCase();

        if (!isAdmin && !isOwnerByUserId && !isOwnerByEmail) {
          // 403, not 404 — but message stays vague so we don't confirm existence
          throw new TRPCError({ code: "FORBIDDEN", message: "無權查看此申請" });
        }

        const history = await db.getVisaStatusHistory(input.applicationId);
        return { application, history };
      }),

    // ── Admin：查詢所有申請 ─────────────────────────────────────
    adminListApplications: adminProcedure
      .input(z.object({
        status: z.string().optional(),
        page: z.number().default(1),
        pageSize: z.number().default(20),
      }))
      .query(async ({ input }) => {
        return db.getAllVisaApplications(input);
      }),

    // ── Admin：查詢統計 ─────────────────────────────────────────
    adminStats: adminProcedure
      .query(async () => {
        return db.getVisaStats();
      }),

    // ── Admin：更新申請狀態 ─────────────────────────────────────
    adminUpdateStatus: adminProcedure
      .input(z.object({
        applicationId: z.number(),
        newStatus: z.enum(["draft","submitted","paid","documents_received","processing","approved","rejected","completed","cancelled"]),
        note: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        await db.updateVisaApplicationStatus(
          input.applicationId,
          input.newStatus,
          ctx.user.id,
          input.note
        );

        // Send status update email
        const application = await db.getVisaApplicationById(input.applicationId);
        if (application) {
          try {
            if (input.newStatus === "approved") {
              await sendVisaApprovedEmail({
                toEmail: application.email,
                applicantName: `${application.firstName} ${application.lastName}`,
                applicationId: input.applicationId,
                trackingNumber: application.trackingNumber ?? undefined,
              });
            } else if (input.newStatus === "rejected") {
              await sendVisaRejectedEmail({
                toEmail: application.email,
                applicantName: `${application.firstName} ${application.lastName}`,
                applicationId: input.applicationId,
                reason: input.note,
              });
            } else {
              await sendVisaStatusUpdate({
                toEmail: application.email,
                applicantName: `${application.firstName} ${application.lastName}`,
                applicationId: input.applicationId,
                newStatus: input.newStatus,
                note: input.note,
              });
            }
          } catch (emailErr) {
            console.error("[Visa] Failed to send status update email:", emailErr);
            reportFunnelError({ source: "fail-open:visa:statusUpdateEmailFailed", err: emailErr, context: { applicationId: input.applicationId, newStatus: input.newStatus } }).catch(() => {});
          }
        }

        return { success: true };
      }),

    // ── Admin：更新備註 ─────────────────────────────────────────
    adminUpdateNotes: adminProcedure
      .input(z.object({
        applicationId: z.number(),
        adminNotes: z.string(),
        trackingNumber: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.updateVisaAdminNotes(
          input.applicationId,
          input.adminNotes,
          input.trackingNumber
        );
        return { success: true };
      }),
  });
