#!/usr/bin/env python3
"""Add visa tRPC routes to server/routers.ts"""

content = open('server/routers.ts').read()

# Add imports
old_import = 'import { getExchangeRates, convertCurrency, getExchangeRate, formatCurrency, getCurrencySymbol, convertPrices, type SupportedCurrency } from "./agents/exchangeRateAgent";'
new_import = old_import + '\nimport { calculateVisaPricing, getVisaTypeName, getEntryTypeName, getProcessingSpeedInfo, getSupportedCountries, type VisaType, type EntryType, type ProcessingSpeed } from "./services/visaPricingService";\nimport { sendVisaStatusUpdate, sendVisaApprovedEmail, sendVisaRejectedEmail } from "./services/visaEmailService";'

if old_import in content:
    content = content.replace(old_import, new_import, 1)
    print("Imports added")
else:
    print("WARNING: import line not found, skipping import addition")

# Add visa routes before closing
old_close = '});\nexport type AppRouter = typeof appRouter;'

visa_routes = r"""
  // ══════════════════════════════════════════════════════════════
  // PHASE 6: 中國簽證代辦 tRPC 路由
  // ══════════════════════════════════════════════════════════════
  visa: router({
    // ── 公開：計算定價 ──────────────────────────────────────────
    calculatePricing: publicProcedure
      .input(z.object({
        visaType: z.string(),
        entryType: z.string(),
        processingSpeed: z.string(),
        passportCountry: z.string(),
        groupSize: z.number().default(1),
        isReturningCustomer: z.boolean().default(false),
      }))
      .query(({ input }) => {
        return calculateVisaPricing({
          visaType: input.visaType as VisaType,
          entryType: input.entryType as EntryType,
          processingSpeed: input.processingSpeed as ProcessingSpeed,
          passportCountry: input.passportCountry,
          groupSize: input.groupSize,
          isReturningCustomer: input.isReturningCustomer,
        });
      }),

    // ── 公開：取得支援國家清單 ──────────────────────────────────
    getSupportedCountries: publicProcedure
      .query(() => getSupportedCountries()),

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
        visaType: z.string(),
        entryType: z.string(),
        processingSpeed: z.string(),
        travelDate: z.string().optional(),
        travelPurpose: z.string().optional(),
        previousVisits: z.number().default(0),
        groupSize: z.number().default(1),
        groupApplicants: z.string().optional(),
        isReturningCustomer: z.boolean().default(false),
      }))
      .mutation(async ({ input, ctx }) => {
        const pricing = calculateVisaPricing({
          visaType: input.visaType as VisaType,
          entryType: input.entryType as EntryType,
          processingSpeed: input.processingSpeed as ProcessingSpeed,
          passportCountry: input.passportCountry,
          groupSize: input.groupSize,
          isReturningCustomer: input.isReturningCustomer,
        });

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
          visaType: input.visaType as VisaType,
          entryType: input.entryType as EntryType,
          processingSpeed: input.processingSpeed as ProcessingSpeed,
          travelDate: input.travelDate ?? null,
          travelPurpose: input.travelPurpose ?? null,
          previousVisits: input.previousVisits,
          serviceFee: pricing.serviceFee.toString(),
          consulateFee: pricing.consulateFee.toString(),
          totalAmount: pricing.totalAmount.toString(),
          discountType: pricing.discountType,
          groupSize: input.groupSize,
          groupApplicants: input.groupApplicants ?? null,
          applicationStatus: "submitted",
        });

        // Create Stripe Checkout Session
        const stripe = getStripeClient();
        const visaTypeName = getVisaTypeName(input.visaType as VisaType, "en");
        const speedInfo = getProcessingSpeedInfo(input.processingSpeed as ProcessingSpeed, "en");
        const siteUrl = process.env.SITE_URL || "https://packgo09.manus.space";

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: `China Visa Service — ${visaTypeName}`,
                  description: `${speedInfo.label} processing (${speedInfo.duration})`,
                },
                unit_amount: Math.round(pricing.totalAmount * 100),
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          success_url: `${siteUrl}/china-visa/success?session_id={CHECKOUT_SESSION_ID}&application_id=${applicationId}`,
          cancel_url: `${siteUrl}/china-visa`,
          customer_email: input.email,
          metadata: {
            visa_application_id: String(applicationId),
            payment_type: "visa",
          },
        });

        // Save session ID
        await db.updateVisaPaymentInfo(applicationId, {
          paymentStatus: "unpaid",
          stripeCheckoutSessionId: session.id,
        });

        return { applicationId, checkoutUrl: session.url };
      }),

    // ── 公開：查詢申請狀態 ──────────────────────────────────────
    getApplicationStatus: publicProcedure
      .input(z.object({ applicationId: z.number() }))
      .query(async ({ input }) => {
        const application = await db.getVisaApplicationById(input.applicationId);
        if (!application) throw new TRPCError({ code: "NOT_FOUND", message: "申請案件不存在" });
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
  }),
"""

new_close = visa_routes + '});\nexport type AppRouter = typeof appRouter;'

if old_close in content:
    content = content.replace(old_close, new_close, 1)
    print("Visa routes added")
else:
    print("ERROR: closing pattern not found")

open('server/routers.ts', 'w').write(content)
print("Done writing routers.ts")
