import { COOKIE_NAME } from "@shared/const";
import { getAliases } from "./_helpers/placeNameAliases";
import { normalizePlaceName } from "./_helpers/llmPlaceNormalizer";
import { tourMonitorRouter } from "./routers/tourMonitorRouter";
import { agentRouter } from "./routers/agentRouter";
import { toolsRouter } from "./routers/toolsRouter";
import { plaidRouter } from "./routers/plaidRouter";
import { suppliersRouter } from "./routers/suppliersRouter";
// Phase 4A — sub-PR 1 of 5 (refactor 2026-05-18, audit P0-1)
// Read-mostly safe domains extracted into their own files.
import { newsletterRouter } from "./routers/newsletter";
import { favoritesRouter } from "./routers/favorites";
import { browsingHistoryRouter } from "./routers/browsingHistory";
import { toursReadRouter } from "./routers/toursRead";
import { toursRouteMapRouter } from "./routers/toursRouteMap";
// Phase 4B — sub-PR 2 of 5 (refactor 2026-05-19, audit P0-1)
// Read-only admin domains extracted; composed back into `admin:` via spread
// so client trpc.admin.* paths resolve unchanged.
import { adminPlatformRouter } from "./routers/adminPlatform";
import { adminLlmRouter } from "./routers/adminLlm";
import { adminAgentsRouter } from "./routers/adminAgents";
// Phase 4C — sub-PR 3 of 5 (refactor 2026-05-19, audit P0-1)
// Customer transactional domains extracted into their own files.
import { bookingsRouter } from "./routers/bookings";
import { departuresRouter } from "./routers/departures";
import { inquiriesRouter } from "./routers/inquiries";
import { imageLibraryRouter } from "./routers/imageLibrary";
import { homepageRouter } from "./routers/homepage";
// Phase 4D — sub-PR 4 of 5 (refactor 2026-05-19, audit P0-1, P0-2 — SOLO REVIEW)
// Money-path domains extracted. bookingsPaymentRouter is spread-composed
// under the `bookings:` key so client paths trpc.bookings.createCheckoutSession
// and trpc.bookings.adminRefund continue to resolve identically.
import { bookingsPaymentRouter } from "./routers/bookingsPayment";
import { vouchersRouter } from "./routers/vouchers";
import { packpointRouter } from "./routers/packpoint";
import { accountingRouter } from "./routers/accounting";
// Phase 4E — sub-PR 5 of 5 (refactor 2026-05-19, audit P0-1)
// Final admin-mutation domains extracted into their own files.
import { translationRouter } from "./routers/translation";
import { exchangeRateRouter } from "./routers/exchangeRate";
import { competitorRouter } from "./routers/competitor";
import { marketingRouter } from "./routers/marketing";
import { visaRouter } from "./routers/visa";
import { affiliateRouter } from "./routers/affiliate";
import { wechatAssistRouter } from "./routers/wechatAssist";
import { marketingContentRouter } from "./routers/marketingContent";
import { opsRouter } from "./routers/ops";
import { storageRouter } from "./routers/storage";
import { reconciliationRouter } from "./routers/reconciliation";
import { posterGenRouter } from "./routers/posterGen";
import { aiQuotesRouter } from "./routers/aiQuotes";
import { invoicesRouter } from "./routers/invoices";
import { recurringExpensesRouter } from "./routers/recurringExpenses";
import { postersRouter } from "./routers/posters";
import { reviewsRouter } from "./routers/reviews";
import { authRouter } from "./routers/auth";
import { membershipRouter } from "./routers/membership";
import { photosRouter } from "./routers/photos";
import { aiRouter } from "./routers/ai";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

// v71: bounded string helpers — all free-form text inputs MUST use one of these
// instead of bare `z.string()`. Without max bounds, attackers can send 10MB
// payloads per field and DoS the database / LLM pipeline. Sizes are picked to
// be generous for legitimate content.
//   shortStr  – names, codes, country/city, single-line metadata
//   mediumStr – paragraphs, descriptions, comments
//   longStr   – JSON blobs (itinerary, highlights, hotel images), poetic content
//
// v74 (security hardening): also strip ASCII control characters (NULL, BEL, ESC,
// DEL, etc.) — live attack test confirmed `\x00`/`\x07` were persisting verbatim
// into MySQL `tours.title`, which can corrupt log rendering, break PDF/email
// generators that use C-style string functions, and is a known WAF-evasion
// vector. We allow tab (0x09), LF (0x0A), CR (0x0D) since those are legitimate
// in textarea content. Anything else in the C0 range or DEL gets stripped.
//
// Implementation note: zod's `.transform()` produces a ZodPipe which loses the
// `.min()` / `.max()` chain methods. So instead of transforming, we use `.refine`
// to REJECT inputs with control chars. For inputs that legitimately may include
// stray copy-paste control chars, callers should pre-clean before submitting.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const noControlChars = (s: string) => !CONTROL_CHARS.test(s);
const shortStr = z.string().max(255).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });
const mediumStr = z.string().max(5_000).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });
const longStr = z.string().max(50_000).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });
import * as db from "./db";
import * as skillDb from "./skillDb";
import { redis } from "./redis";
import { learnFromPdfContent, initializeBuiltInSkills } from "./agents/learningAgent";
import { SkillLearnerAgent } from "./agents/skillLearnerAgent";
import { invokeLLM } from "./_core/llm";
import { sendBookingConfirmationEmail } from "./email";
import * as auth from "./auth";
import { createToken } from "./jwt";
import { translateText, translateBatch, translateTour, translateMultipleTours, getTourTranslations, getBatchTourTranslations, getAllTourTranslations, getTranslationJobs, getSupportedLanguages, getAllTranslationsSummary, Language } from "./translation";
import { getExchangeRates, convertCurrency, getExchangeRate, formatCurrency, getCurrencySymbol, convertPrices, type SupportedCurrency } from "./agents/exchangeRateAgent";
import { calculateVisaPricing, CHINA_VISA_PRICING } from "./services/visaPricingService";
import { sendVisaStatusUpdate, sendVisaApprovedEmail, sendVisaRejectedEmail } from "./services/visaEmailService";
import { generateFlightLink, generateHotelLink, generateHomepageLink, trackAffiliateClick } from "./services/affiliateLinkService";
import { generateInvoiceNumber, generateInvoicePdf } from "./services/invoiceService";
// Phase 4D: financialReportService imports moved to ./routers/accounting.ts.
import Stripe from "stripe";
import { ENV } from "./_core/env";

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
import { checkForgotPasswordRateLimitByIP, checkForgotPasswordRateLimitByEmail, checkForgotPasswordGlobalRateLimit, checkLoginRateLimitByIP, checkLoginRateLimitByEmail, isBlockedEmailDomain, checkBookingCreateRateLimit, checkCheckoutSessionRateLimit, checkAiChatRateLimit, checkAiChatDailyLimit, checkAiChatGlobalAnonymousLimit, checkAiChatUserDailyLimit, checkRateLimit } from "./rateLimit";

/**
 * SECURITY_AUDIT_2026_05_14 P2-5 helper: verify every passed-in skillUsageLog
 * id belongs to the caller (either same userId, or same sessionId). Throws
 * FORBIDDEN if any id doesn't match — preventing anonymous tampering with
 * skill-performance feedback / conversion analytics.
 */
async function assertOwnsUsageLogs(
  usageLogIds: number[],
  caller: { userId?: number; sessionId?: string }
): Promise<void> {
  if (usageLogIds.length === 0) return;
  if (!caller.userId && !caller.sessionId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Provide a sessionId or sign in to record feedback.",
    });
  }
  const { skillUsageLog } = await import("../drizzle/schema");
  const { and, inArray, or, eq } = await import("drizzle-orm");
  const { getDb } = await import("./db");
  const dbInst = await getDb();
  if (!dbInst) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  }
  const ownClauses = [
    caller.userId ? eq(skillUsageLog.userId, caller.userId) : null,
    caller.sessionId ? eq(skillUsageLog.sessionId, caller.sessionId) : null,
  ].filter(Boolean) as any[];
  const ownership = ownClauses.length === 1 ? ownClauses[0] : or(...ownClauses);
  const rows = await dbInst
    .select({ id: skillUsageLog.id })
    .from(skillUsageLog)
    .where(and(inArray(skillUsageLog.id, usageLogIds), ownership));
  if (rows.length !== usageLogIds.length) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "One or more usage-log ids do not belong to this session.",
    });
  }
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  
  // Authentication router — Phase 4E extracted to ./routers/auth.ts
  auth: authRouter,
  
  // Round 80.20: Membership Phase 2 — Stripe subscription lifecycle.
  // Public endpoints for /membership page; webhook handles tier flips.
  // Membership router — Phase 4E extracted to ./routers/membership.ts
  membership: membershipRouter,

  // Packpoint loyalty router — Phase 4D extracted to ./routers/packpoint.ts
  packpoint: packpointRouter,

  // Vouchers router — Phase 4D extracted to ./routers/vouchers.ts
  vouchers: vouchersRouter,

  // Photos router — Phase 4E extracted to ./routers/photos.ts
  photos: photosRouter,

  // AI Travel Advisor router — Phase 4E extracted to ./routers/ai.ts
  ai: aiRouter,

  // User Favorites router — Phase 4A extracted to ./routers/favorites.ts
  favorites: favoritesRouter,

  // User Browsing History router — Phase 4A extracted to ./routers/browsingHistory.ts
  browsingHistory: browsingHistoryRouter,

  // Tour management router (admin only)
  tours: router({
    // Phase 4A — extracted read paths (read-only tours procedures live in
    // server/routers/toursRead.ts; getRouteMap + regenerateAiMap live in
    // server/routers/toursRouteMap.ts). Public router keys preserved via
    // _def.procedures spread so `trpc.tours.<name>` still resolves identically.
    ...toursReadRouter._def.procedures,
    ...toursRouteMapRouter._def.procedures,

    // Create new tour (admin only)
    create: adminProcedure
      .input(
        z.object({
          title: z.string().min(1).max(255),
          destination: z.string().min(1),
          destinationCountry: z.string().min(1),
          destinationCity: z.string().min(1),
          description: z.string().min(1),
          duration: z.number().min(1).max(365),
          price: z.number().gt(0),
          imageUrl: z.string().url().optional(),
          category: z.enum(["group", "custom", "package", "cruise", "theme"]),
          status: z.enum(["active", "inactive", "soldout"]).default("active"),
          featured: z.number().min(0).max(1).default(0),
          // Round 80.22: accept null too — frontend sends null when user clears the date input.
          startDate: z.date().nullable().optional(),
          endDate: z.date().nullable().optional(),
          maxParticipants: z.number().optional(),
          // v71: all bounded; long JSON blobs at 50KB, descriptions 5KB, single-line 255
          highlights: longStr.optional(),
          includes: longStr.optional(),
          excludes: longStr.optional(),
          productCode: shortStr.optional(),
          promotionText: shortStr.optional(),
          tags: longStr.optional(),
          departureCountry: shortStr.optional(),
          departureCity: shortStr.optional(),
          departureAirportCode: shortStr.optional(),
          departureAirportName: shortStr.optional(),
          destinationRegion: shortStr.optional(),
          destinationAirportCode: shortStr.optional(),
          destinationAirportName: shortStr.optional(),
          destinationDescription: mediumStr.optional(),
          nights: z.number().int().min(0).max(365).optional(),
          priceUnit: shortStr.optional(),
          availableSeats: z.number().int().min(0).max(10_000).optional(),
          outboundAirline: shortStr.optional(),
          outboundFlightNo: shortStr.optional(),
          outboundDepartureTime: shortStr.optional(),
          outboundArrivalTime: shortStr.optional(),
          outboundFlightDuration: shortStr.optional(),
          inboundAirline: shortStr.optional(),
          inboundFlightNo: shortStr.optional(),
          inboundDepartureTime: shortStr.optional(),
          inboundArrivalTime: shortStr.optional(),
          inboundFlightDuration: shortStr.optional(),
          hotelName: shortStr.optional(),
          hotelGrade: shortStr.optional(),
          hotelNights: z.number().int().min(0).max(365).optional(),
          hotelLocation: shortStr.optional(),
          hotelDescription: mediumStr.optional(),
          hotelFacilities: longStr.optional(),
          hotelRoomType: shortStr.optional(),
          hotelRoomSize: shortStr.optional(),
          hotelCheckIn: shortStr.optional(),
          hotelCheckOut: shortStr.optional(),
          hotelSpecialOffers: longStr.optional(),
          hotelImages: longStr.optional(),
          hotelWebsite: shortStr.optional(),
          attractions: longStr.optional(),
          dailyItinerary: longStr.optional(),
          optionalTours: longStr.optional(),
          specialReminders: mediumStr.optional(),
          notes: mediumStr.optional(),
          safetyGuidelines: mediumStr.optional(),
          flightRules: mediumStr.optional(),
          galleryImages: longStr.optional(),
          sourceUrl: z.string().url().max(2048).optional(),
          isAutoGenerated: z.number().int().min(0).max(1).optional(),
          airline: shortStr.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const tour = await db.createTour({
          ...input,
          createdBy: ctx.user.id,
        });

        // v74: audit log coverage gap from live attack test — tour.create was
        // not being logged. Now every admin tour creation produces a row.
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "tour.create",
          targetType: "tour",
          targetId: tour.id,
          changes: { title: tour.title, price: input.price, duration: input.duration, sourceUrl: input.sourceUrl || null },
        });

        // BUG-006: Queue translation job (reliable retry vs fire-and-forget)
        import("./queue").then(({ addTourTranslationJob }) =>
          addTourTranslationJob({ tourId: tour.id, targetLanguages: ['en'], sourceLanguage: 'zh-TW', userId: ctx.user.id })
        ).catch((e) => console.warn(`[AutoTranslate] Failed to queue translation for tour ${tour.id}:`, e));
        return tour;
      }),

    // Update tour (admin only) - Supports inline editing
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive().max(2_147_483_647),
          // v71: bounded sizes — see constants at top of file.
          title: shortStr.min(1).optional(),
          destination: shortStr.min(1).optional(),
          description: longStr.min(1).optional(),
          duration: z.number().int().min(1).max(365).optional(),
          price: z.number().min(0).max(100_000_000).optional(),
          priceCurrency: z.enum(["TWD", "USD"]).optional(),
          imageUrl: z.string().max(2048).optional(),
          heroImage: z.string().max(2048).optional(),
          heroSubtitle: mediumStr.optional(),
          destinationCountry: shortStr.optional(),
          destinationCity: shortStr.optional(),
          category: z.enum(["group", "custom", "package", "cruise", "theme"]).optional(),
          status: z.enum(["active", "inactive", "soldout"]).optional(),
          featured: z.number().int().min(0).max(1).optional(),
          // Round 80.22: accept null too — frontend sends null when user clears the date input.
          startDate: z.date().nullable().optional(),
          endDate: z.date().nullable().optional(),
          maxParticipants: z.number().int().min(0).max(10_000).optional(),
          currentParticipants: z.number().int().min(0).max(10_000).optional(),
          productCode: shortStr.optional(),
          promotionText: shortStr.optional(),
          departureCity: shortStr.optional(),
          departureAirportName: shortStr.optional(),
          notes: mediumStr.nullable().optional(),
          sourceUrl: z.string().max(2048).optional(),
          // Content JSON blobs — bigger cap because some tours legitimately have long itineraries
          highlights: longStr.nullable().optional(),
          includes: longStr.nullable().optional(),
          excludes: longStr.nullable().optional(),
          keyFeatures: longStr.nullable().optional(),
          attractions: longStr.nullable().optional(),
          hotels: longStr.nullable().optional(),
          meals: longStr.nullable().optional(),
          flights: longStr.nullable().optional(),
          itineraryDetailed: longStr.nullable().optional(),
          costExplanation: longStr.nullable().optional(),
          noticeDetailed: longStr.nullable().optional(),
          poeticContent: longStr.nullable().optional(),
          poeticTitle: shortStr.nullable().optional(),
          colorTheme: longStr.nullable().optional(),
          galleryImages: longStr.nullable().optional(),
          // Round 80.22: Packpoint per-tour multiplier + commission estimate.
          // pointsEarnRate stored × 100 (25 = 0.25x default).
          // estimatedCommissionPct stored × 100 (1500 = 15%).
          pointsEarnRate: z.number().int().min(0).max(500).optional(),
          estimatedCommissionPct: z.number().int().min(0).max(10000).nullable().optional(),
          excludeFromPackpoint: z.boolean().optional(),
          // v75: optional optimistic-lock token. Client passes the `updatedAt`
          // from when it loaded the tour; if the tour was modified by another
          // admin between then and now, the update is rejected with CONFLICT
          // (CLIENT_CLOSED_REQUEST equivalent) so the UI can prompt re-load.
          expectedUpdatedAt: z.string().datetime().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Check if user is admin
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only admins can update tours",
          });
        }
        const { id, expectedUpdatedAt, ...updates } = input;

        // v74: snapshot the BEFORE row so audit log captures the diff
        const before = await db.getTourById(id).catch(() => null);

        let tour;
        try {
          tour = await db.updateTour(id, updates, expectedUpdatedAt);
        } catch (e: any) {
          if (e?.name === "TourUpdateConflictError") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "另一位管理員已修改此行程，請重新載入後再儲存",
            });
          }
          throw e;
        }

        // v74: audit log coverage. Only log fields that actually changed.
        const { audit, diffFields } = await import("./_core/auditLog");
        const diff = diffFields(before as any, updates as any);
        audit({
          ctx,
          action: "tour.update",
          targetType: "tour",
          targetId: id,
          changes: { fields: diff.fields, before: diff.before, after: diff.after },
        });

        // BUG-006: Queue translation job (reliable retry vs fire-and-forget)
        import("./queue").then(({ addTourTranslationJob }) =>
          addTourTranslationJob({ tourId: id, targetLanguages: ['en'], sourceLanguage: 'zh-TW', userId: ctx.user.id })
        ).catch((e) => console.warn(`[AutoTranslate] Failed to queue translation for tour ${id}:`, e));
        return tour;
      }),
    // Partial update for inline editing (admin only)
    // Allows updating a single field at a time
    patchField: adminProcedure
      .input(
        z.object({
          id: z.number().positive(),
          field: z.enum([
            'title', 'description', 'heroSubtitle', 'heroImage',
            'destinationCountry', 'destinationCity', 'price', 'priceCurrency', 'duration',
            'keyFeatures', 'attractions', 'hotels', 'meals', 'flights',
            'itineraryDetailed', 'costExplanation', 'noticeDetailed',
            'poeticContent', 'poeticTitle', 'colorTheme', 'galleryImages', 'imageUrl',
            'highlights', 'includes', 'excludes', 'startDate', 'endDate',
            'subtitle', 'category', 'status', 'featured', 'airline', 'notes',
            'safetyGuidelines', 'flightRules', 'specialReminders', 'optionalTours',
            'dailyItinerary', 'hotelWebsite', 'hotelImages', 'maxParticipants'
          ]),
          value: z.union([
            z.string().max(500000), // 最大 500KB 文字（JSON 欄位可能很大）
            z.number(),
            z.null(),
          ]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, field, value } = input;

        // 欄位特定驗證（fieldValidators 模式）
        // v75: extended to cover ENUM fields (status, featured, category) — prior
        // patchField allowed setting status="foo", featured=99, category="banana"
        // because the union validator only enforced (string|number|null), not the
        // semantic per-field constraints. Now any inline-edit on an enum field
        // is checked against its DB enum values.
        const STATUS_VALUES = new Set(['active', 'inactive', 'soldout', 'draft', 'pending_review']);
        const CATEGORY_VALUES = new Set(['group', 'custom', 'package', 'cruise', 'theme']);
        const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

        const fieldValidators: Record<string, (v: any) => string | null> = {
          price: (v) => typeof v === 'number' && (v < 0 || v > 100_000_000) ? '價格必須在 0–1 億之間' : null,
          discountPrice: (v) => typeof v === 'number' && v < 0 ? '折扣價不能為負數' : null,
          duration: (v) => typeof v === 'number' && (v < 1 || v > 365) ? '天數必須在 1-365 之間' : null,
          maxParticipants: (v) => typeof v === 'number' && (v < 0 || v > 10_000) ? '人數必須在 0–10000 之間' : null,
          title: (v) => typeof v === 'string' && v.length > 200 ? '標題最多 200 字' : null,
          subtitle: (v) => typeof v === 'string' && v.length > 500 ? '副標題最多 500 字' : null,
          heroSubtitle: (v) => typeof v === 'string' && v.length > 500 ? '副標題最多 500 字' : null,
          imageUrl: (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('http') && !v.startsWith('/') ? '圖片 URL 格式不正確' : null,
          heroImage: (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('http') && !v.startsWith('/') ? '圖片 URL 格式不正確' : null,
          // v75: enum validations
          status: (v) => typeof v === 'string' && !STATUS_VALUES.has(v) ? `status 必須是: ${Array.from(STATUS_VALUES).join(', ')}` : null,
          featured: (v) => typeof v === 'number' && v !== 0 && v !== 1 ? 'featured 必須是 0 或 1' : null,
          category: (v) => typeof v === 'string' && !CATEGORY_VALUES.has(v) ? `category 必須是: ${Array.from(CATEGORY_VALUES).join(', ')}` : null,
        };
        const validator = fieldValidators[field];
        if (validator) {
          const error = validator(value);
          if (error) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: error });
          }
        }
        // v75: also reject control chars on any string field — same defense as
        // the global shortStr/mediumStr/longStr helpers, but patchField uses a
        // single union validator so we re-enforce here.
        if (typeof value === 'string' && CONTROL_CHARS.test(value)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '禁止控制字元' });
        }
        
        // field is already validated by z.enum whitelist above
        const updates: Record<string, any> = { [field]: value };

        // v73: snapshot the previous value so audit log captures the change
        const beforeRow = await db.getTourById(id).catch(() => null);
        const previousValue = (beforeRow as any)?.[field];

        const tour = await db.updateTour(id, updates);

        // v73: log the inline-edit mutation
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "tour.updateField",
          targetType: "tour",
          targetId: id,
          changes: {
            field,
            before: previousValue !== undefined ? previousValue : null,
            after: value,
          },
        });

        // 非同步觸發翻譯（只有內容欄位變更時才重新翻譯）
        const contentFields = [
          'title', 'description', 'heroSubtitle', 'keyFeatures',
          'highlights', 'includes', 'excludes', 'notes',
          'itineraryDetailed', 'costExplanation', 'noticeDetailed',
          'poeticTitle', 'poeticSubtitle', 'poeticContent',
          'hotels', 'meals', 'dailyItinerary',
        ];
        if (contentFields.includes(field)) {
          const userId = (tour as any).createdBy ?? 1;
          // BUG-006: Queue translation job (reliable retry vs fire-and-forget)
          import("./queue").then(({ addTourTranslationJob }) =>
            addTourTranslationJob({ tourId: id, targetLanguages: ['en'], sourceLanguage: 'zh-TW', userId })
          ).catch((e) => console.warn(`[AutoTranslate] Failed to queue translation for tour ${id}:`, e));
        }
        
        return tour;
      }),

    // Delete tour (admin only)
    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive().max(2_147_483_647) }))
      .mutation(async ({ ctx, input }) => {
        // Check if user is admin
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only admins can delete tours",
          });
        }

        // v73: snapshot the tour BEFORE delete so the audit log records what
        // was destroyed (title, price, etc.) — useful for "I deleted the wrong
        // one" recovery.
        let beforeSnapshot: any = null;
        try {
          beforeSnapshot = await db.getTourById(input.id);
        } catch { /* if read fails, we still proceed with delete */ }

        try {
          await db.deleteTour(input.id);
        } catch (err: any) {
          // db.deleteTour throws when bookings are still attached. Translate
          // to a TRPC CONFLICT so the admin UI can show the message verbatim
          // instead of a generic 500.
          if (err?.message?.startsWith("Cannot delete tour")) {
            throw new TRPCError({
              code: "CONFLICT",
              message: err.message,
            });
          }
          throw err;
        }

        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "tour.delete",
          targetType: "tour",
          targetId: input.id,
          changes: { before: beforeSnapshot ? { id: beforeSnapshot.id, title: beforeSnapshot.title, price: beforeSnapshot.price, status: beforeSnapshot.status } : null },
        });

        return { success: true };
      }),

    // Batch delete tours (admin only)
    batchDelete: adminProcedure
      .input(z.object({ ids: z.array(z.number().int().positive()).max(500) }))
      .mutation(async ({ ctx, input }) => {
        const result = await db.batchDeleteTours(input.ids);
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "tour.batchDelete",
          targetType: "tour",
          targetId: `batch[${input.ids.length}]`,
          changes: { ids: input.ids, deleted: result.deleted, skipped: result.skipped.length },
        });
        // Partial success is allowed — return both counts so the UI can show
        // "Deleted 8, skipped 2 (still have bookings)".
        return { success: true, deleted: result.deleted, skipped: result.skipped };
      }),

    // Duplicate tour (admin only) - 複製行程作為模板
    duplicate: adminProcedure
      .input(z.object({ 
        id: z.number(),
        newTitle: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {

        // Get original tour
        const originalTour = await db.getTourById(input.id);
        if (!originalTour) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Tour not found",
          });
        }

        // Create a copy with modified title
        const { id, createdAt, updatedAt, ...tourData } = originalTour;
        const newTour = await db.createTour({
          ...tourData,
          title: input.newTitle || `${originalTour.title} (副本)`,
          status: "inactive", // New copy starts as inactive
          featured: 0, // Not featured by default
          createdBy: ctx.user.id,
          productCode: originalTour.productCode ? `${originalTour.productCode}-COPY` : undefined,
        });

        return newTour;
      }),

    // Get tour generation jobs for current user
    getMyGenerationJobs: protectedProcedure
      .query(async ({ ctx }) => {
        const { getUserTourGenerationJobs } = await import("./queue");
        return await getUserTourGenerationJobs(ctx.user.id);
      }),


    // Get generation job status (admin only)
    getGenerationStatus: adminProcedure
      .input(z.object({ 
        jobId: z.string(),
      }))
      .query(async ({ input }) => {
        const { getTourGenerationJobStatus } = await import("./queue");
        const status = await getTourGenerationJobStatus(input.jobId);

        if (status.status === "not_found") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Generation job not found",
          });
        }

        return status;
      }),


    // Cancel a stuck generation job (admin only)
    cancelGeneration: adminProcedure
      .input(z.object({
        jobId: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { tourGenerationQueue } = await import("./queue");
        const job = await tourGenerationQueue.getJob(input.jobId);

        if (!job) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Job ${input.jobId} not found`,
          });
        }

        const state = await job.getState();
        console.log(`[Admin] Cancelling generation job ${input.jobId} (state: ${state})`);

        // Move to failed state with reason
        await job.moveToFailed(
          new Error('Admin manually cancelled: generation stuck'),
          job.token || '0',
          false // don't fetch next job
        );

        // Also update progress to show cancelled state
        await job.updateProgress({
          step: 'cancelled',
          progress: 0,
          message: '\u7ba1\u7406\u54e1\u5df2\u53d6\u6d88\u6b64\u751f\u6210\u4efb\u52d9',
          timestamp: Date.now(),
        });

        return {
          success: true,
          message: `Job ${input.jobId} cancelled (was: ${state})`,
        };
      }),

    // List all active generation jobs (admin only) — for finding stuck jobs
    listActiveGenerations: adminProcedure
      .query(async () => {
        const { tourGenerationQueue } = await import("./queue");
        const activeJobs = await tourGenerationQueue.getJobs(['active', 'waiting']);

        return activeJobs.map(job => ({
          id: job.id,
          url: job.data.url,
          userId: job.data.userId,
          requestId: job.data.requestId,
          progress: job.progress,
          createdAt: job.timestamp,
          state: 'active',
        }));
      }),

    // Submit async tour generation job (admin only)
    // Supports three modes:
    //   1. PDF only (isPdf=true, no supplementUrl)
    //   2. URL only (isPdf=false, no supplementUrl)
    //   3. PDF + URL (isPdf=true, supplementUrl provided)
    submitAsyncGeneration: adminProcedure
      .input(z.object({
        url: z.string().url(), // PDF URL (S3) or tour page URL
        forceRegenerate: z.boolean().optional().default(false),
        isPdf: z.boolean().default(true), // true = PDF input, false = URL input
        supplementUrl: z.string().url().optional(), // 供應商官網 URL（配合 PDF 使用）
      }))
      .mutation(async ({ ctx, input }) => {
        // 2026-05-17 red-team round 7 — SSRF defense. Even though this is
        // adminProcedure, defense-in-depth: validate URLs are on allowlist
        // before queuing the tour-generation job. Blocks 169.254.169.254
        // (metadata), 127.0.0.1 (loopback), private IPs, file://, etc.
        // If admin session is compromised, attacker can't pivot to internal
        // services via the tour scraper.
        const { validateUrl } = await import("./_core/urlSafetyGuard");
        const urlCheck = validateUrl(input.url);
        if (!urlCheck.safe) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `URL rejected: ${urlCheck.reason}`,
          });
        }
        if (input.supplementUrl) {
          const supCheck = validateUrl(input.supplementUrl);
          if (!supCheck.safe) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Supplement URL rejected: ${supCheck.reason}`,
            });
          }
        }

        const { addTourGenerationJob } = await import("./queue");
        const requestId = `gen_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        const mode = !input.isPdf ? 'URL' : (input.supplementUrl ? 'PDF+URL' : 'PDF');
        console.log(`[SubmitGeneration] Mode: ${mode}, URL: ${input.url.slice(0, 80)}`);
        if (input.supplementUrl) {
          console.log(`[SubmitGeneration] Supplement URL: ${input.supplementUrl.slice(0, 80)}`);
        }
        
        const job = await addTourGenerationJob({
          url: input.url,
          userId: ctx.user.id,
          requestId,
          forceRegenerate: input.forceRegenerate,
          isPdf: input.isPdf,
          supplementUrl: input.supplementUrl,
        });

        console.log(`[SubmitGeneration] Job submitted: ${job.id} (mode: ${mode})`);

        return {
          jobId: job.id!,
          requestId,
          message: `行程生成任務已提交（${mode} 模式），請稍候...`,
        };
      }),

    // v80.24: Bulk import from Lion Travel — fast path, no LLM
    bulkImportFromLion: adminProcedure
      .input(z.object({
        ids: z.array(z.string()).optional(),
        categoryPath: z.string().optional(),
        limit: z.number().min(1).max(100).default(30),
        queueRewrite: z.boolean().default(false),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!input.ids?.length && !input.categoryPath) {
          throw new Error("Provide either ids or categoryPath");
        }
        const { bulkImportFromLion, queueRewriteForImportedTours } = await import("./services/lionBulkImportService");
        const result = await bulkImportFromLion({
          ids: input.ids,
          categoryPath: input.categoryPath,
          limit: input.limit,
          userId: ctx.user.id,
        });
        let queued = 0;
        if (input.queueRewrite && result.imported > 0) {
          const tourIds = result.results.filter(r => r.success && r.tourId).map(r => r.tourId!);
          ({ queued } = await queueRewriteForImportedTours(tourIds, { userId: ctx.user.id }));
        }
        console.log(`[bulkImportFromLion] admin=${ctx.user.id} imported=${result.imported}/${result.total} queued=${queued}`);
        return { ...result, queued };
      }),

    // List Lion category options (for admin UI dropdown)
    listLionCategories: adminProcedure.query(async () => {
      // Static list — no need for tRPC fetch each time
      return [
        { path: "japan/kanto", label: "日本｜關東" },
        { path: "japan/kansai", label: "日本｜關西" },
        { path: "japan/hokkaido", label: "日本｜北海道" },
        { path: "japan/kyushu", label: "日本｜九州" },
        { path: "japan/okinawa", label: "日本｜沖繩" },
        { path: "japan/tohoku", label: "日本｜東北" },
        { path: "korea/seoul", label: "韓國｜首爾" },
        { path: "korea/pusan", label: "韓國｜釜山" },
        { path: "korea/jeju", label: "韓國｜濟州" },
        { path: "taiwan/index", label: "台灣" },
        { path: "middleeurope-westerneurope/index", label: "歐洲｜中西歐" },
        { path: "southerneurope-northerneurope/index", label: "歐洲｜南歐 / 北歐" },
        { path: "easterneurope-russia/index", label: "歐洲｜東歐 / 俄羅斯" },
        { path: "southasia/index", label: "南亞 / 中亞" },
        { path: "middleeast/index", label: "中東" },
        { path: "africa/index", label: "非洲" },
        { path: "china/easternchina", label: "中國｜華東" },
        { path: "china/northernchina", label: "中國｜華北" },
        { path: "china/southernchina", label: "中國｜華南" },
        { path: "china/southwesternchina", label: "中國｜西南" },
        { path: "china/centralchina", label: "中國｜華中" },
        { path: "china/xinjiang-tibet", label: "中國｜新疆 / 西藏" },
      ];
    }),

    // Save tour from preview (admin only)
    // Used after previewing generated tour data (admin only)
    saveFromPreview: adminProcedure
      .input(z.object({
        tourData: z.object({
          title: z.string().min(1).max(255),
          destination: z.string().max(255).optional(),
          destinationCountry: z.string().max(255).optional(),
          destinationCity: z.string().max(255).optional(),
          description: z.string().max(50000).optional(),
          price: z.number().gt(0).optional(),
          duration: z.number().min(1).max(365).optional(),
          imageUrl: z.string().url().optional().or(z.literal('')),
          category: z.enum(["group", "custom", "package", "cruise", "theme"]).optional(),
          status: z.enum(["active", "inactive", "soldout", "draft", "pending_review"]).optional(),
          // 生成系統可能送的額外欄位
          poeticTitle: z.string().max(255).optional(),
          poeticSubtitle: z.string().max(500).optional(),
          poeticContent: z.string().max(5000).optional(),
          heroSubtitle: z.string().max(500).optional(),
          keyFeatures: z.string().max(10000).optional(),
          hotels: z.string().max(10000).optional(),
          meals: z.string().max(10000).optional(),
          flights: z.string().max(5000).optional(),
          costExplanation: z.string().max(10000).optional(),
          noticeDetailed: z.string().max(10000).optional(),
          itineraryDetailed: z.string().max(50000).optional(),
          colorTheme: z.string().max(1000).optional(),
          transportationType: z.string().max(100).optional(),
          transportationName: z.string().max(100).optional(),
          highlights: z.string().max(10000).optional(),
          includes: z.string().max(10000).optional(),
          excludes: z.string().max(10000).optional(),
          notes: z.string().max(10000).optional(),
          heroImage: z.string().max(500).optional(),
          // Preview-only fields (will be stripped before saving)
          featureImages: z.unknown().optional(),
          executionReport: z.unknown().optional(),
        }).strip(),
      }))
      .mutation(async ({ ctx, input }) => {

        console.log("[SaveFromPreview] Saving tour from preview...");

        try {
          const tourData = input.tourData;
          
          // Remove preview-only fields (featureImages and executionReport are not stored in DB)
          const { featureImages, executionReport, ...savableData } = tourData;
          
          // Save to database
          // Default status for manually previewed tours is 'pending_review'
          // (AI-generated tours go through calibration pipeline and set status automatically)
          const savedTour = await db.createTour({
            ...(savableData as any),
            status: (savableData as any).status ?? 'pending_review',
            createdBy: ctx.user.id,
          });

          console.log("[SaveFromPreview] Tour saved with ID:", savedTour.id);
          // BUG-006: Queue translation job (reliable retry vs fire-and-forget)
          import("./queue").then(({ addTourTranslationJob }) =>
            addTourTranslationJob({ tourId: savedTour.id, targetLanguages: ['en'], sourceLanguage: 'zh-TW', userId: ctx.user.id })
          ).catch((e) => console.warn(`[AutoTranslate] Failed to queue translation for tour ${savedTour.id}:`, e));

          return {
            success: true,
            tourId: savedTour.id,
            message: "行程已成功儲存！",
          };
        } catch (error: any) {
          console.error("[SaveFromPreview] Error:", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message || "儲存行程失敗",
          });
        }
      }),

    // Toggle tour status (admin only)
    toggleStatus: adminProcedure
      .input(z.object({ id: z.number().int().positive().max(2_147_483_647) }))
      .mutation(async ({ ctx, input }) => {

        // Get current tour
        const tour = await db.getTourById(input.id);
        if (!tour) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Tour not found",
          });
        }

        // 2026-05-16 bug fix: toggleStatus is the eye-icon button on the
        // admin tours list. Original code:
        //   newStatus = tour.status === "active" ? "inactive" : "active"
        // This silently PROMOTED any non-active row to active — clicking
        // the eye on a `draft`, `pending_review`, or `soldout` tour would
        // publish raw / unreviewed content straight to the public site.
        // Production incident today: 11 raw supplier drafts (1080017-24,
        // 1110001-03) reached customer-facing /tours because of this.
        //
        // Now toggle is STRICT: active ↔ inactive only. Other states
        // require the dedicated flow (tours.approveTour for pending_review,
        // bulk-import or LLM-rewrite for drafts).
        if (tour.status !== "active" && tour.status !== "inactive") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `無法切換 status='${tour.status}' 的行程。draft / pending_review 需要用「approve」流程上架,不是這個眼睛圖示。`,
          });
        }
        const newStatus = tour.status === "active" ? "inactive" : "active";

        // Update tour status
        await db.updateTour(input.id, { status: newStatus });

        // v75: audit (publish/unpublish is high-impact — affects public site)
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "tour.toggleStatus",
          targetType: "tour",
          targetId: input.id,
          changes: { before: tour.status, after: newStatus },
        });

        return {
          success: true,
          newStatus,
          message: `行程已${newStatus === "active" ? "上架" : "下架"}`,
        };
      }),

    // Toggle featured status (admin only)
    toggleFeatured: adminProcedure
      .input(z.object({ id: z.number().int().positive().max(2_147_483_647) }))
      .mutation(async ({ ctx, input }) => {
        const tour = await db.getTourById(input.id);
        if (!tour) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Tour not found",
          });
        }

        const newFeatured = tour.featured === 1 ? 0 : 1;
        await db.updateTour(input.id, { featured: newFeatured });

        // v75: audit
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "tour.toggleFeatured",
          targetType: "tour",
          targetId: input.id,
          changes: { before: tour.featured, after: newFeatured },
        });

        return {
          success: true,
          featured: newFeatured === 1,
          message: `行程已${newFeatured === 1 ? "設為精選" : "取消精選"}`,
        };
      }),

    // Get all tours pending review (admin only)
    getPendingReview: adminProcedure
      .query(async () => {
        const tours = await db.getPendingReviewTours();
        return tours;
      }),

    // Approve a tour (set status to active) (admin only)
    approveTour: adminProcedure
      .input(z.object({ id: z.number().int().positive().max(2_147_483_647) }))
      .mutation(async ({ ctx, input }) => {
        const tour = await db.approveTour(input.id);
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "tour.approve",
          targetType: "tour",
          targetId: input.id,
          changes: { newStatus: "active" },
        });
        return { success: true, tour, message: '行程已審核通過並上架' };
      }),

    // Reject a tour (set status to inactive) (admin only)
    rejectTour: adminProcedure
      .input(z.object({ id: z.number().int().positive().max(2_147_483_647) }))
      .mutation(async ({ ctx, input }) => {
        const tour = await db.rejectTour(input.id);
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "tour.reject",
          targetType: "tour",
          targetId: input.id,
          changes: { newStatus: "inactive" },
        });
        return { success: true, tour, message: '行程已拒絕並下架' };
      }),

    // Get calibration result for a tour (admin only)
    getCalibrationResult: adminProcedure
      .input(z.object({ tourId: z.number() }))
      .query(async ({ input }) => {
        const result = await db.getCalibrationResultByTourId(input.tourId);
        return result ?? null;
      }),

    // Phase 4A: tours.generatePdf moved to ./routers/toursRead.ts

    // 診斷工具 API (admin only)
    diagnose: adminProcedure
      .input(z.object({ 
        url: z.string().url(),
      }))
      .mutation(async ({ input }) => {
        console.log("[Diagnostics] Starting diagnosis for URL:", input.url);
        
        const { agentDiagnostics } = await import('./agents/diagnostics');
        const report = await agentDiagnostics.runFullDiagnostics(input.url);
        
        return report;
      }),
    // Round 58: Quick environment + LLM diagnostic (to be removed after diagnosis)
    diagnoseEnv: adminProcedure
      .mutation(async () => {
        const { ENV } = await import('./_core/env');
        const results: Record<string, any> = {};
        
        // 1. Check env vars
        results.env = {
          forgeApiUrl: ENV.forgeApiUrl || '(empty - will use fallback)',
          forgeApiKeySet: !!ENV.forgeApiKey,
          nodeEnv: process.env.NODE_ENV,
        };
        
        // 2. Test LLM with 30s timeout
        const llmStart = Date.now();
        try {
          const { invokeLLM } = await import('./_core/llm');
          const llmResult = await invokeLLM({
            messages: [{ role: 'user', content: 'Say OK in 2 words' }],
          });
          results.llm = {
            ok: true,
            elapsed: Date.now() - llmStart,
            model: llmResult.model,
            content: llmResult.choices[0]?.message?.content,
          };
        } catch (err: any) {
          results.llm = { ok: false, elapsed: Date.now() - llmStart, error: err?.message };
        }
        
        // 3. Test LionTravel API
        const lionStart = Date.now();
        try {
          const { fetchLionTravelData } = await import('./services/lionTravelApiService');
          const testUrl = 'https://travel.liontravel.com/detail?NormGroupID=96f88eb6-8d38-46ff-a55d-6f0862248428&GroupID=26NZ502MN15-GX&Platform=APP';
          const lionResult = await fetchLionTravelData(testUrl);
          results.lionApi = {
            ok: !!lionResult,
            elapsed: Date.now() - lionStart,
            title: lionResult?.tourName?.substring(0, 50) ?? null,
            price: lionResult?.price ?? null,
          };
        } catch (err: any) {
          results.lionApi = { ok: false, elapsed: Date.now() - lionStart, error: err?.message };
        }
        
        // 4. Test static HTTP scraping (no Puppeteer)
        const httpStart = Date.now();
        try {
          const testUrl = 'https://travel.liontravel.com/detail?NormGroupID=96f88eb6-8d38-46ff-a55d-6f0862248428&GroupID=26NZ502MN15-GX&Platform=APP';
          const resp = await fetch(testUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(15000),
          });
          const html = await resp.text();
          const titleMatch = html.match(/<title>([^<]+)<\/title>/);
          results.httpScrape = {
            ok: resp.ok,
            status: resp.status,
            elapsed: Date.now() - httpStart,
            htmlLength: html.length,
            title: titleMatch?.[1]?.substring(0, 80) ?? null,
          };
        } catch (err: any) {
          results.httpScrape = { ok: false, elapsed: Date.now() - httpStart, error: err?.message };
        }
        
        console.log('[diagnoseEnv] Results:', JSON.stringify(results, null, 2));
        return results;
      }),
    // LLM Stress Test: simulate ContentAnalyzer-sized prompt
    llmStressTest: adminProcedure
      .input(z.object({
        promptSize: z.enum(['small', 'medium', 'large']).optional().default('medium'),
      }))
      .mutation(async ({ input }) => {
        const { invokeLLM } = await import('./_core/llm');
        const startMs = Date.now();
        
        // Generate prompts of different sizes to simulate real agent workloads
        const smallPrompt = 'Say hello in Traditional Chinese. Reply in 10 words or less.';
        const mediumPrompt = `你是 PACK&GO 旅行社的資深文案總監。
品牌定位：美國精品華語旅行社，服務追求品質的華語旅客，行程涵蓋全球。
品牌調性：雅奢但不浮誇、有溫度但不煥情、專業但不生硬。
請根據以下資訊生成旅遊文案（所有內容必須為繁體中文）：
目的地：京都, 日本
天數：5天4夜
原標題：快閃關西三日遊
原描述：祈福勝尾寺，漫步清水寺，品味京都古都風情
行程亮點：清水寺、伏見稻荷大社、金閣寺、嵐山竹林、奈良公園
飯店等級：五星級
特色體驗：和服體驗、茶道體驗、懷石料理

請生成（全部用繁體中文）：
1. poeticTitle: 詩意化標題（15-25字）
2. title: 行銷標題（20-30字）
3. description: 行程介紹（100-120字）
4. heroSubtitle: Hero副標題（30-40字）
5. highlights: 6-10個行程亮點（每個10-30字）`;
        const largePrompt = mediumPrompt + '\n\n' + mediumPrompt.repeat(3) + '\n\n額外資訊：' + 'A'.repeat(2000);
        
        const prompt = input.promptSize === 'small' ? smallPrompt 
          : input.promptSize === 'large' ? largePrompt 
          : mediumPrompt;
        
        try {
          console.log(`[llmStressTest] Starting ${input.promptSize} prompt test (${prompt.length} chars)...`);
          const result = await invokeLLM({
            messages: [
              { role: 'system', content: '你是一個專業的旅遊文案專家。請用繁體中文回答。' },
              { role: 'user', content: prompt },
            ],
            maxTokens: 2000,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'stress_test_output',
                strict: false,
                schema: {
                  type: 'object',
                  properties: {
                    poeticTitle: { type: 'string' },
                    title: { type: 'string' },
                    description: { type: 'string' },
                  },
                  required: ['poeticTitle', 'title', 'description'],
                },
              },
            },
          });
          const elapsed = Date.now() - startMs;
          const content = result.choices?.[0]?.message?.content;
          console.log(`[llmStressTest] ✅ ${input.promptSize} prompt completed in ${elapsed}ms`);
          return {
            success: true,
            promptSize: input.promptSize,
            promptChars: prompt.length,
            elapsedMs: elapsed,
            model: result.model,
            content: typeof content === 'string' ? content.substring(0, 200) : JSON.stringify(content).substring(0, 200),
            usage: result.usage,
          };
        } catch (err: any) {
          const elapsed = Date.now() - startMs;
          console.error(`[llmStressTest] ❌ ${input.promptSize} prompt failed in ${elapsed}ms:`, err.message);
          return {
            success: false,
            promptSize: input.promptSize,
            promptChars: prompt.length,
            elapsedMs: elapsed,
            error: err.message,
            nonRetryable: (err as any).nonRetryable || false,
          };
        }
      }),
    // Phase 4A: tours.getSimilar + tours.getRecommended moved to ./routers/toursRead.ts

    // Admin: Get extracted departures for a tour (DateExtractor result pending confirmation)
    getExtractedDepartures: adminProcedure
      .input(z.object({ tourId: z.number() }))
      .query(async ({ input }) => {
        const { tours: toursTable } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '資料庫不可用' });
        const [tour] = await drizzleDb.select({
          id: toursTable.id,
          title: toursTable.title,
          extractedDepartures: toursTable.extractedDepartures,
        }).from(toursTable).where(eq(toursTable.id, input.tourId));
        if (!tour) throw new TRPCError({ code: 'NOT_FOUND', message: '行程不存在' });
        return {
          tourId: tour.id,
          title: tour.title,
          extractedDepartures: tour.extractedDepartures ? JSON.parse(tour.extractedDepartures) : null,
        };
      }),

    // Admin: Confirm extracted departures and create actual departure records
    confirmExtractedDepartures: adminProcedure
      .input(z.object({
        tourId: z.number(),
        selectedDates: z.array(z.object({
          date: z.string(), // ISO date string
          status: z.string().optional().default('available'),
          adultPrice: z.number().optional(),
          childWithBedPrice: z.number().optional(),
          childNoBedPrice: z.number().optional(),
          infantPrice: z.number().optional(),
          maxParticipants: z.number().optional(),
          minParticipants: z.number().optional(),
          notes: z.string().optional(),
        })),
        clearExtracted: z.boolean().optional().default(true), // Clear extractedDepartures after confirmation
      }))
      .mutation(async ({ input }) => {
        const { tours: toursTable, tourDepartures: departuresTable } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '資料庫不可用' });
        
        // Verify tour exists
        const [tour] = await drizzleDb.select({ id: toursTable.id, title: toursTable.title })
          .from(toursTable).where(eq(toursTable.id, input.tourId));
        if (!tour) throw new TRPCError({ code: 'NOT_FOUND', message: '行程不存在' });
        
        // Create departure records for each selected date
        const created = [];
        const errors = [];
        
        for (const dep of input.selectedDates) {
          try {
            const departureDate = new Date(dep.date);
            if (isNaN(departureDate.getTime())) {
              errors.push({ date: dep.date, error: '日期格式無效' });
              continue;
            }
            // returnDate defaults to departureDate + 1 day if not specified
            const returnDate = new Date(departureDate);
            returnDate.setDate(returnDate.getDate() + 1);
            
            const result = await drizzleDb.insert(departuresTable).values([{
              tourId: input.tourId,
              departureDate,
              returnDate,
              status: ((dep.status === 'available' || dep.status === 'open') ? 'open' : dep.status === 'cancelled' ? 'cancelled' : 'open') as any,
              adultPrice: dep.adultPrice || 0,
              childPriceWithBed: dep.childWithBedPrice || null,
              childPriceNoBed: dep.childNoBedPrice || null,
              infantPrice: dep.infantPrice || null,
              totalSlots: dep.maxParticipants || 30,
              notes: dep.notes || null,
            }]);
            created.push({ date: dep.date, id: (result as any).insertId });
          } catch (err: any) {
            errors.push({ date: dep.date, error: err.message });
          }
        }
        
        // Clear extractedDepartures if requested
        if (input.clearExtracted) {
          await drizzleDb.update(toursTable)
            .set({ extractedDepartures: null })
            .where(eq(toursTable.id, input.tourId));
        }
        
        return {
          success: true,
          created: created.length,
          errors,
          message: `已建立 ${created.length} 筆出發日期記錄${errors.length > 0 ? `，${errors.length} 筆失敗` : ''}`,
        };
      }),

    // Admin: Save extracted departures from DateExtractor (called by tourGenerator)
    saveExtractedDepartures: adminProcedure
      .input(z.object({
        tourId: z.number(),
        extractedData: z.object({
          departureDates: z.array(z.object({
            date: z.string(),
            status: z.string().optional(),
            price: z.number().optional(),
          })).optional(),
          capacity: z.object({
            maxParticipants: z.number().optional(),
            minParticipants: z.number().optional(),
          }).optional(),
          pricing: z.object({
            adultPrice: z.number().optional(),
            childWithBedPrice: z.number().optional(),
            childNoBedPrice: z.number().optional(),
            infantPrice: z.number().optional(),
            currency: z.string().optional(),
            priceNote: z.string().optional(),
          }).optional(),
          productCode: z.string().optional(),
        }),
      }))
      .mutation(async ({ input }) => {
        const { tours: toursTable } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '資料庫不可用' });
        await drizzleDb.update(toursTable)
          .set({ extractedDepartures: JSON.stringify(input.extractedData) })
          .where(eq(toursTable.id, input.tourId));
        return { success: true };
      }),

    // Round 54: Backfill all liontravel tour departures (clear + re-insert)
    backfillLionDepartures: adminProcedure
      .mutation(async () => {
        const { tours: toursTable, tourDepartures: departuresTable } = await import('../drizzle/schema');
        const { like, eq } = await import('drizzle-orm');
        const { fetchLionTravelData } = await import('./services/lionTravelApiService');
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '資料庫不可用' });

        // Find all liontravel tours
        const lionTours = await drizzleDb.select({
          id: toursTable.id,
          title: toursTable.title,
          sourceUrl: toursTable.sourceUrl,
          duration: toursTable.duration,
        })
        .from(toursTable)
        .where(like(toursTable.sourceUrl, '%liontravel.com%'));

        const results: { tourId: number; title: string; inserted: number; total: number; error?: string }[] = [];

        for (const tour of lionTours) {
          if (!tour.sourceUrl) continue;
          try {
            const lionData = await fetchLionTravelData(tour.sourceUrl);
            if (!lionData) throw new Error('fetchLionTravelData returned null');
            const departures = lionData.allDepartures || [];

            // Clear existing departures
            await drizzleDb.delete(departuresTable).where(eq(departuresTable.tourId, tour.id));

            // Insert fresh departures
            let inserted = 0;
            for (const dep of departures) {
              try {
                const [year, month, day] = dep.date.split('/').map(Number);
                if (!year || !month || !day) continue;
                const departureDate = new Date(year, month - 1, day, 8, 0, 0);
                const returnDate = new Date(year, month - 1, day + (tour.duration ? tour.duration - 1 : 0), 20, 0, 0);
                const statusMap: Record<string, 'open' | 'full' | 'cancelled' | 'confirmed'> = {
                  '報名': 'open', '客滿': 'full', '取消': 'cancelled', '確定': 'confirmed',
                };
                // NOTE: LionTravel's public API returns AvailableVacancy as a
                // placeholder (= TotalVacnacy - 1 uniformly across all dates), not
                // real bookings. Imported tours have 0 actual bookings on our side.
                await db.createDeparture({
                  tourId: tour.id,
                  departureDate,
                  returnDate,
                  adultPrice: Math.round(dep.price),
                  totalSlots: dep.totalSeats || 20,
                  bookedSlots: 0,
                  status: statusMap[dep.status] || 'open',
                  currency: dep.currencyCode || 'TWD',
                  notes: `lionGroupId: ${dep.groupId}`,
                });
                inserted++;
              } catch { /* skip individual errors */ }
            }
            results.push({ tourId: tour.id, title: tour.title || '', inserted, total: departures.length });
          } catch (err: unknown) {
            results.push({ tourId: tour.id, title: tour.title || '', inserted: 0, total: 0, error: err instanceof Error ? err.message : String(err) });
          }
          // Throttle to avoid hammering the API
          await new Promise(r => setTimeout(r, 500));
        }

        const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
        const successCount = results.filter(r => !r.error).length;
        const failCount = results.filter(r => !!r.error).length;
         return { totalTours: lionTours.length, successCount, failCount, totalInserted, results };
      }),
  }),
  // Bookings router — Phase 4C extracted to ./routers/bookings.ts.
  // Phase 4D moved the 2 money-path procedures (createCheckoutSession,
  // adminRefund) to ./routers/bookingsPayment.ts; both are spread-composed
  // back under this key so client trpc.bookings.* paths are unchanged.
  bookings: router({
    ...bookingsRouter._def.procedures,
    ...bookingsPaymentRouter._def.procedures,
  }),

  // Departures management router — Phase 4C extracted to ./routers/departures.ts
  departures: departuresRouter,

  // Inquiries management router — Phase 4C extracted to ./routers/inquiries.ts
  inquiries: inquiriesRouter,

  // Newsletter subscription router — Phase 4A extracted to ./routers/newsletter.ts
  newsletter: newsletterRouter,

  // Admin dashboard router — composed from three Phase 4B sub-routers.
  // Read-only admin procedures (platform stats, LLM cost, agent ops) live
  // in server/routers/admin{Platform,Llm,Agents}.ts. Client trpc.admin.*
  // paths are unchanged — procedures merged via spread.
  admin: router({
    ...adminPlatformRouter._def.procedures,
    ...adminLlmRouter._def.procedures,
    ...adminAgentsRouter._def.procedures,
  }),

  // Image Library router — Phase 4C extracted to ./routers/imageLibrary.ts
  imageLibrary: imageLibraryRouter,
  // Homepage content router — Phase 4C extracted to ./routers/homepage.ts
  homepage: homepageRouter,

  // Agent Skills management router
  skills: router({
    // Get all skills
    list: adminProcedure.query(async () => {
      return await skillDb.getAllSkills(true);
    }),

    // Get skills by type
    listByType: adminProcedure
      .input(z.object({ skillType: z.string() }))
      .query(async ({ input }) => {
        return await skillDb.getSkillsByType(input.skillType);
      }),

    // Get single skill
    getById: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const skill = await skillDb.getSkillById(input.id);
        if (!skill) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Skill not found",
          });
        }
        return skill;
      }),

    // Create new skill (with Superpowers-style fields)
    create: adminProcedure
      .input(z.object({
        skillType: z.enum(["feature_classification", "tag_rule", "itinerary_structure", "highlight_detection", "transportation_type", "meal_classification", "accommodation_type"]),
        skillCategory: z.enum(["technique", "pattern", "reference"]).optional().default("technique"),
        skillName: z.string(),
        skillNameEn: z.string().optional(),
        keywords: z.array(z.string()),
        rules: z.unknown(),
        outputLabels: z.array(z.string()).optional(),
        outputFormat: z.string().optional(),
        description: z.string().optional(),
        source: z.string().optional(),
        sourceUrl: z.string().optional(),
        // Superpowers-style documentation fields
        whenToUse: z.string().optional(),
        corePattern: z.string().optional(),
        quickReference: z.string().optional(),
        commonMistakes: z.string().optional(),
        realWorldImpact: z.string().optional(),
        // Dependencies and testing
        dependsOn: z.array(z.number()).optional(),
        testCases: z.array(z.object({
          id: z.string(),
          input: z.string(),
          expectedOutput: z.string(),
          description: z.string().optional(),
        })).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const skillId = await skillDb.createSkill({
          skillType: input.skillType,
          skillCategory: input.skillCategory,
          skillName: input.skillName,
          skillNameEn: input.skillNameEn,
          keywords: JSON.stringify(input.keywords),
          rules: JSON.stringify(input.rules),
          outputLabels: input.outputLabels ? JSON.stringify(input.outputLabels) : undefined,
          outputFormat: input.outputFormat,
          description: input.description,
          source: input.source,
          sourceUrl: input.sourceUrl,
          whenToUse: input.whenToUse,
          corePattern: input.corePattern,
          quickReference: input.quickReference,
          commonMistakes: input.commonMistakes,
          realWorldImpact: input.realWorldImpact,
          dependsOn: input.dependsOn ? JSON.stringify(input.dependsOn) : undefined,
          testCases: input.testCases ? JSON.stringify(input.testCases) : undefined,
          createdBy: ctx.user.id,
          isActive: true,
          isBuiltIn: false,
        });
        return { id: skillId };
      }),

    // Update skill (with Superpowers-style fields)
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        skillCategory: z.enum(["technique", "pattern", "reference"]).optional(),
        skillName: z.string().optional(),
        skillNameEn: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        rules: z.unknown().optional(),
        outputLabels: z.array(z.string()).optional(),
        outputFormat: z.string().optional(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
        // Superpowers-style documentation fields
        whenToUse: z.string().optional(),
        corePattern: z.string().optional(),
        quickReference: z.string().optional(),
        commonMistakes: z.string().optional(),
        realWorldImpact: z.string().optional(),
        // Dependencies and testing
        dependsOn: z.array(z.number()).optional(),
        testCases: z.array(z.object({
          id: z.string(),
          input: z.string(),
          expectedOutput: z.string(),
          description: z.string().optional(),
        })).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, keywords, rules, outputLabels, dependsOn, testCases, ...rest } = input;
        const updates: any = { ...rest };
        if (keywords) updates.keywords = JSON.stringify(keywords);
        if (rules) updates.rules = JSON.stringify(rules);
        if (outputLabels) updates.outputLabels = JSON.stringify(outputLabels);
        if (dependsOn) updates.dependsOn = JSON.stringify(dependsOn);
        if (testCases) updates.testCases = JSON.stringify(testCases);
        
        await skillDb.updateSkill(id, updates);
        return { success: true };
      }),

    // Delete skill
    delete: adminProcedure
      .input(z.object({ id: z.number(), hardDelete: z.boolean().optional() }))
      .mutation(async ({ input }) => {
        await skillDb.deleteSkill(input.id, input.hardDelete);
        return { success: true };
      }),

    // Match skills to content
    matchToContent: adminProcedure
      .input(z.object({
        content: z.string(),
        skillType: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const matches = await skillDb.matchSkillsToContent(input.content, input.skillType);
        return matches.map(m => ({
          skill: m.skill,
          score: m.score,
          matchedKeywords: m.matchedKeywords,
        }));
      }),

    // Apply skill rules to content
    applyRules: adminProcedure
      .input(z.object({
        skillId: z.number(),
        content: z.string(),
        metadata: z.unknown().optional(),
      }))
      .mutation(async ({ input }) => {
        const skill = await skillDb.getSkillById(input.skillId);
        if (!skill) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Skill not found",
          });
        }
        const labels = skillDb.applySkillRules(skill, input.content, input.metadata);
        return { labels };
      }),

    // Seed built-in skills
    seedBuiltIn: adminProcedure.mutation(async () => {
      await skillDb.seedBuiltInSkills();
      return { success: true };
    }),

    // Get learning sessions
    getLearningSessions: adminProcedure
      .input(z.object({ limit: z.number().optional() }))
      .query(async ({ input }) => {
        return await skillDb.getRecentLearningSessions(input.limit);
      }),

    // Get skill application history
    getApplicationHistory: adminProcedure
      .input(z.object({
        skillId: z.number().optional(),
        tourId: z.number().optional(),
        limit: z.number().optional(),
      }))
      .query(async ({ input }) => {
        return await skillDb.getSkillApplicationHistory(input.skillId, input.tourId, input.limit);
      }),

    // Learn from PDF content
    learnFromPdf: adminProcedure
      .input(z.object({
        pdfContent: z.string(),
        sourceName: z.string(),
        sourceUrl: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await learnFromPdfContent(
          input.pdfContent,
          input.sourceName,
          input.sourceUrl,
          ctx.user.id
        );
        return result;
      }),

    // Initialize built-in skills
    initializeBuiltIn: adminProcedure.mutation(async () => {
      await initializeBuiltInSkills();
      return { success: true };
    }),

    // Run skill test cases (TDD-style)
    runTests: adminProcedure
      .input(z.object({ skillId: z.number() }))
      .mutation(async ({ input }) => {
        const skill = await skillDb.getSkillById(input.skillId);
        if (!skill) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Skill not found",
          });
        }
        
        const testCases = skill.testCases ? JSON.parse(skill.testCases as string) : [];
        if (testCases.length === 0) {
          return { results: [], passRate: 0, message: "No test cases defined" };
        }
        
        const results = [];
        let passed = 0;
        
        for (const testCase of testCases) {
          const startTime = Date.now();
          try {
            const labels = skillDb.applySkillRules(skill, testCase.input, {});
            const actualOutput = JSON.stringify(labels);
            const isPassed = actualOutput === testCase.expectedOutput || 
                            labels.some((l: string) => testCase.expectedOutput.includes(l));
            
            if (isPassed) passed++;
            
            results.push({
              testCaseId: testCase.id,
              passed: isPassed,
              expectedOutput: testCase.expectedOutput,
              actualOutput,
              executionTimeMs: Date.now() - startTime,
            });
          } catch (error: any) {
            results.push({
              testCaseId: testCase.id,
              passed: false,
              expectedOutput: testCase.expectedOutput,
              actualOutput: null,
              errorMessage: error.message,
              executionTimeMs: Date.now() - startTime,
            });
          }
        }
        
        const passRate = passed / testCases.length;
        
        // Update skill with test results
        await skillDb.updateSkill(input.skillId, {
          lastTestedAt: new Date(),
          testPassRate: passRate.toFixed(2),
        });
        
        return { results, passRate, totalTests: testCases.length, passedTests: passed };
      }),

    // Get skill statistics
    getStats: adminProcedure.query(async () => {
      const skills = await skillDb.getAllSkills(true);
      const totalSkills = skills.length;
      const activeSkills = skills.filter(s => s.isActive).length;
      const builtInSkills = skills.filter(s => s.isBuiltIn).length;
      const customSkills = totalSkills - builtInSkills;
      
      const byCategory = {
        technique: skills.filter(s => s.skillCategory === 'technique').length,
        pattern: skills.filter(s => s.skillCategory === 'pattern').length,
        reference: skills.filter(s => s.skillCategory === 'reference').length,
      };
      
      const byType = skills.reduce((acc, s) => {
        acc[s.skillType] = (acc[s.skillType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      const totalUsage = skills.reduce((sum, s) => sum + (s.usageCount || 0), 0);
      const totalSuccess = skills.reduce((sum, s) => sum + (s.successCount || 0), 0);
      const overallSuccessRate = totalUsage > 0 ? (totalSuccess / totalUsage * 100).toFixed(1) : '0';
      
      return {
        totalSkills,
        activeSkills,
        builtInSkills,
        customSkills,
        byCategory,
        byType,
        totalUsage,
        overallSuccessRate,
      };
    }),

    // Get skill dependencies
    getDependencies: adminProcedure
      .input(z.object({ skillId: z.number() }))
      .query(async ({ input }) => {
        const skill = await skillDb.getSkillById(input.skillId);
        if (!skill) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Skill not found",
          });
        }
        
        const dependsOn = skill.dependsOn ? JSON.parse(skill.dependsOn as string) : [];
        const dependencies = [];
        
        for (const depId of dependsOn) {
          const depSkill = await skillDb.getSkillById(depId);
          if (depSkill) {
            dependencies.push({
              id: depSkill.id,
              skillName: depSkill.skillName,
              skillType: depSkill.skillType,
              skillCategory: depSkill.skillCategory,
            });
          }
        }
        
        return dependencies;
      }),

    // AI 自動學習 - 從內容中學習新關鍵字和技能
    aiLearn: adminProcedure
      .input(z.object({
        content: z.string(),
        contentType: z.enum(['tour', 'pdf', 'text']).optional(),
        metadata: z.object({
          title: z.string().optional(),
          source: z.string().optional(),
          region: z.string().optional(),
          country: z.string().optional(),
        }).optional(),
      }))
      .mutation(async ({ input }) => {
        const learner = new SkillLearnerAgent();
        const result = await learner.learnFromContent({
          title: input.metadata?.title || '未命名行程',
          description: input.content,
          country: input.metadata?.country,
        });
        return result;
      }),

    // AI 批量學習 - 從多個內容中學習
    aiBatchLearn: adminProcedure
      .input(z.object({
        contents: z.array(z.object({
          content: z.string(),
          metadata: z.object({
            title: z.string().optional(),
            source: z.string().optional(),
          }).optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const learner = new SkillLearnerAgent();
        const contents = input.contents.map(c => ({
          ...c.metadata,
          description: c.content,
        }));
        const result = await learner.batchLearn(contents);
        return result;
      }),

    // 應用學習到的關鍵字到技能
    applyLearnedKeywords: adminProcedure
      .input(z.object({
        skillId: z.number(),
        newKeywords: z.array(z.string()),
        approvedBy: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const learner = new SkillLearnerAgent();
        const success = await learner.applyKeywordSuggestion(
          input.skillId,
          input.newKeywords,
          input.approvedBy || ctx.user.name || 'admin'
        );
        return { success };
      }),

    // 創建 AI 建議的新技能
    createSuggestedSkill: adminProcedure
      .input(z.object({
        skillType: z.string(),
        skillName: z.string(),
        category: z.enum(['technique', 'pattern', 'reference']),
        description: z.string(),
        keywords: z.array(z.string()),
        whenToUse: z.string().optional(),
        corePattern: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const learner = new SkillLearnerAgent();
        // 轉換為 createNewSkill 所需的格式
        const suggestion = {
          skillName: input.skillName,
          skillType: input.skillType,
          category: input.category,
          description: input.description,
          keywords: input.keywords,
          whenToUse: input.whenToUse || '',
          corePattern: input.corePattern || '',
          confidence: 1.0,
          reason: '管理員手動創建'
        };
        const skillId = await learner.createNewSkill(suggestion);
        return { success: skillId !== null, skillId };
      }),

    // 獲取學習建議（待審核的關鍵字和新技能建議）
    getLearningRecommendations: adminProcedure.query(async () => {
      // 這裡可以從資料庫獲取待審核的學習建議
      // 目前返回空陣列，實際應用時需要建立學習建議資料表
      return {
        pendingKeywords: [],
        suggestedSkills: [],
        recentLearnings: [],
      };
    }),

    // === 排程學習 API ===
    
    // 獲取所有排程
    getSchedules: adminProcedure.query(async () => {
      const { scheduledLearningService } = await import('./services/scheduledLearningService');
      return await scheduledLearningService.getSchedules();
    }),

    // 創建排程
    createSchedule: adminProcedure
      .input(z.object({
        name: z.string(),
        frequency: z.enum(['daily', 'weekly', 'monthly']),
        dayOfWeek: z.number().min(0).max(6).optional(),
        dayOfMonth: z.number().min(1).max(31).optional(),
        hour: z.number().min(0).max(23).optional(),
        minute: z.number().min(0).max(59).optional(),
        maxToursPerRun: z.number().min(1).max(50).optional(),
        minTourAge: z.number().min(0).optional(),
        autoApplyHighConfidence: z.boolean().optional(),
        autoApplyThreshold: z.number().min(0).max(1).optional(),
        notifyOnComplete: z.boolean().optional(),
        notifyOnNewSuggestions: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { scheduledLearningService } = await import('./services/scheduledLearningService');
        const scheduleId = await scheduledLearningService.createSchedule({
          ...input,
          createdBy: ctx.user.id,
        });
        return { success: scheduleId !== null, scheduleId };
      }),

    // 更新排程
    updateSchedule: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        isEnabled: z.boolean().optional(),
        frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
        dayOfWeek: z.number().min(0).max(6).optional(),
        dayOfMonth: z.number().min(1).max(31).optional(),
        hour: z.number().min(0).max(23).optional(),
        minute: z.number().min(0).max(59).optional(),
        maxToursPerRun: z.number().min(1).max(50).optional(),
        minTourAge: z.number().min(0).optional(),
        autoApplyHighConfidence: z.boolean().optional(),
        autoApplyThreshold: z.number().min(0).max(1).optional(),
        notifyOnComplete: z.boolean().optional(),
        notifyOnNewSuggestions: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { scheduledLearningService } = await import('./services/scheduledLearningService');
        const { id, ...updates } = input;
        const success = await scheduledLearningService.updateSchedule(id, updates);
        return { success };
      }),

    // 刪除排程
    deleteSchedule: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { scheduledLearningService } = await import('./services/scheduledLearningService');
        const success = await scheduledLearningService.deleteSchedule(input.id);
        return { success };
      }),

    // 手動觸發排程學習
    triggerScheduledLearning: adminProcedure
      .input(z.object({ scheduleId: z.number() }))
      .mutation(async ({ input }) => {
        const { scheduledLearningService } = await import('./services/scheduledLearningService');
        const result = await scheduledLearningService.executeScheduledLearning(input.scheduleId);
        return { success: result !== null, result };
      }),

    // 手動學習（從指定行程）
    triggerManualLearning: adminProcedure
      .input(z.object({ tourIds: z.array(z.number()) }))
      .mutation(async ({ ctx, input }) => {
        const { scheduledLearningService } = await import('./services/scheduledLearningService');
        const result = await scheduledLearningService.triggerManualLearning(input.tourIds, ctx.user.id);
        return { success: result !== null, result };
      }),

    // 獲取學習歷史
    getLearningHistory: adminProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
        sourceType: z.enum(['tour', 'batch', 'scheduled', 'manual']).optional(),
      }).optional())
      .query(async ({ input }) => {
        const { scheduledLearningService } = await import('./services/scheduledLearningService');
        return await scheduledLearningService.getLearningHistory(input || {});
      }),

    // 更新學習歷史的建議狀態
    updateLearningHistoryStatus: adminProcedure
      .input(z.object({
        historyId: z.number(),
        accepted: z.number(),
        rejected: z.number(),
        skillsCreated: z.number(),
      }))
      .mutation(async ({ input }) => {
        const { scheduledLearningService } = await import('./services/scheduledLearningService');
        const success = await scheduledLearningService.updateSuggestionStatus(
          input.historyId,
          input.accepted,
          input.rejected,
          input.skillsCreated
        );
        return { success };
      }),

    // === 學習分析儀表板 API ===
    
    // 獲取儀表板統計數據
    getDashboardStats: adminProcedure.query(async () => {
      const { getDashboardStats } = await import('./services/learningAnalyticsService');
      return await getDashboardStats();
    }),

    // 獲取學習趨勢數據
    getLearningTrends: adminProcedure
      .input(z.object({ days: z.number().min(7).max(90).optional() }).optional())
      .query(async ({ input }) => {
        const { getLearningTrends } = await import('./services/learningAnalyticsService');
        return await getLearningTrends(input?.days || 30);
      }),

    // 獲取技能採納率數據
    getAdoptionRates: adminProcedure.query(async () => {
      const { getSkillAdoptionRates } = await import('./services/learningAnalyticsService');
      return await getSkillAdoptionRates();
    }),

    // 獲取學習來源分佈
    getSourceDistribution: adminProcedure.query(async () => {
      const { getSourceDistribution } = await import('./services/learningAnalyticsService');
      return await getSourceDistribution();
    }),

    // 獲取熱門行程排名
    getTopTours: adminProcedure
      .input(z.object({ limit: z.number().min(1).max(50).optional() }).optional())
      .query(async ({ input }) => {
        const { getTopToursByPopularity } = await import('./services/learningAnalyticsService');
        return await getTopToursByPopularity(input?.limit || 10);
      }),

    // 獲取優先學習的行程
    getPrioritizedTours: adminProcedure
      .input(z.object({ limit: z.number().min(1).max(20).optional() }).optional())
      .query(async ({ input }) => {
        const { getPrioritizedToursForLearning } = await import('./services/learningAnalyticsService');
        return await getPrioritizedToursForLearning(input?.limit || 5);
      }),

    // === 審核佇列 API ===
    
    // 獲取待審核的技能
    getReviewQueue: adminProcedure
      .input(z.object({
        status: z.enum(['pending', 'approved', 'rejected', 'merged']).optional(),
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
      }).optional())
      .query(async ({ input }) => {
        const { getDb } = await import('./db');
        const { skillReviewQueue } = await import('../drizzle/schema');
        const { eq, desc } = await import('drizzle-orm');
        
        const db = await getDb();
        if (!db) return { items: [], total: 0 };
        
        let query = db.select().from(skillReviewQueue);
        
        if (input?.status) {
          query = query.where(eq(skillReviewQueue.status, input.status)) as typeof query;
        }
        
        const items = await query
          .orderBy(desc(skillReviewQueue.createdAt))
          .limit(input?.limit || 20)
          .offset(input?.offset || 0);
        
        // Get total count
        const { count } = await import('drizzle-orm');
        let countQuery = db.select({ count: count() }).from(skillReviewQueue);
        if (input?.status) {
          countQuery = countQuery.where(eq(skillReviewQueue.status, input.status)) as typeof countQuery;
        }
        const [totalResult] = await countQuery;
        
        return { items, total: Number(totalResult?.count) || 0 };
      }),

    // 批准技能
    approveSkill: adminProcedure
      .input(z.object({
        reviewId: z.number(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getDb } = await import('./db');
        const { skillReviewQueue, agentSkills } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        
        const db = await getDb();
        if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
        
        // Get the review item
        const [review] = await db.select().from(skillReviewQueue).where(eq(skillReviewQueue.id, input.reviewId));
        if (!review) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review item not found' });
        if (review.status !== 'pending') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Item already reviewed' });
        
        // Create the actual skill
        // Map review skillType to agentSkills skillType
        const skillTypeMapping: Record<string, 'feature_classification' | 'tag_rule' | 'itinerary_structure' | 'highlight_detection' | 'transportation_type' | 'meal_classification' | 'accommodation_type'> = {
          'technique': 'feature_classification',
          'pattern': 'tag_rule',
          'reference': 'itinerary_structure',
        };
        const mappedSkillType = skillTypeMapping[review.skillType] || 'feature_classification';
        
        const [insertResult] = await db.insert(agentSkills).values({
          skillType: mappedSkillType,
          skillCategory: review.skillType as 'technique' | 'pattern' | 'reference',
          skillName: review.skillName,
          keywords: review.keywords,
          rules: review.rules,
          outputLabels: review.outputLabels,
          description: review.description,
          confidence: review.confidence,
          isActive: true,
          isBuiltIn: false,
          createdBy: ctx.user.id,
        });
        
        const skillId = insertResult.insertId;
        
        // Update review status
        await db.update(skillReviewQueue)
          .set({
            status: 'approved',
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            reviewNotes: input.notes,
            createdSkillId: Number(skillId),
          })
          .where(eq(skillReviewQueue.id, input.reviewId));
        
        return { success: true, skillId: Number(skillId) };
      }),

    // 拒絕技能
    rejectSkill: adminProcedure
      .input(z.object({
        reviewId: z.number(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getDb } = await import('./db');
        const { skillReviewQueue } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        
        const db = await getDb();
        if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
        
        // Get the review item
        const [review] = await db.select().from(skillReviewQueue).where(eq(skillReviewQueue.id, input.reviewId));
        if (!review) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review item not found' });
        if (review.status !== 'pending') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Item already reviewed' });
        
        // Update review status
        await db.update(skillReviewQueue)
          .set({
            status: 'rejected',
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            reviewNotes: input.notes,
          })
          .where(eq(skillReviewQueue.id, input.reviewId));
        
        return { success: true };
      }),

    // 新增待審核的技能（從 AI 學習結果）
    addToReviewQueue: adminProcedure
      .input(z.object({
        skillName: z.string(),
        skillType: z.enum(['technique', 'pattern', 'reference']),
        category: z.string(),
        keywords: z.array(z.string()),
        rules: z.unknown(),
        description: z.string().optional(),
        outputLabels: z.array(z.string()).optional(),
        confidence: z.number().min(0).max(1).optional(),
        sourceType: z.enum(['ai_learning', 'scheduled', 'manual']),
        sourceTourId: z.number().optional(),
        learningHistoryId: z.number().optional(),
        priority: z.enum(['low', 'medium', 'high']).optional(),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import('./db');
        const { skillReviewQueue } = await import('../drizzle/schema');
        
        const db = await getDb();
        if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
        
        const [result] = await db.insert(skillReviewQueue).values({
          skillName: input.skillName,
          skillType: input.skillType,
          category: input.category,
          keywords: JSON.stringify(input.keywords),
          rules: JSON.stringify(input.rules),
          description: input.description,
          outputLabels: input.outputLabels ? JSON.stringify(input.outputLabels) : null,
          confidence: input.confidence?.toFixed(2) || '0.80',
          sourceType: input.sourceType,
          sourceTourId: input.sourceTourId,
          learningHistoryId: input.learningHistoryId,
          priority: input.priority || 'medium',
          status: 'pending',
        });
        
        return { success: true, reviewId: Number(result.insertId) };
      }),

    // 更新行程統計（用於智能優先級）
    recordTourView: adminProcedure
      .input(z.object({ tourId: z.number() }))
      .mutation(async ({ input }) => {
        const { recordTourView } = await import('./services/learningAnalyticsService');
        await recordTourView(input.tourId);
        return { success: true };
      }),

    // 更新熱門度分數
    updatePopularityScores: adminProcedure.mutation(async () => {
      const { updatePopularityScores } = await import('./services/learningAnalyticsService');
      await updatePopularityScores();
      return { success: true };
    }),

    // ========== 技能效能追蹤 API ==========
    
    // 記錄技能觸發事件
    recordSkillTrigger: protectedProcedure
      .input(z.object({
        skillId: z.number(),
        skillName: z.string(),
        skillType: z.string(),
        contextType: z.enum(['chat', 'search', 'itinerary', 'content', 'classification']),
        contextId: z.string().optional(),
        inputText: z.string().optional(),
        matchedKeywords: z.array(z.string()).optional(),
        outputResult: z.string().optional(),
        wasSuccessful: z.boolean().optional(),
        errorMessage: z.string().optional(),
        processingTimeMs: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { recordSkillTrigger } = await import('./services/skillPerformanceService');
        const usageLogId = await recordSkillTrigger({
          ...input,
          userId: ctx.user.id,
          sessionId: ctx.req.headers['x-session-id'] as string,
        });
        return { success: true, usageLogId };
      }),

    // 記錄用戶回饋
    recordFeedback: protectedProcedure
      .input(z.object({
        usageLogId: z.number(),
        feedback: z.enum(['positive', 'negative', 'none']),
        comment: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { recordUserFeedback } = await import('./services/skillPerformanceService');
        await recordUserFeedback(input);
        return { success: true };
      }),

    // 記錄轉換事件
    recordConversion: protectedProcedure
      .input(z.object({
        usageLogId: z.number(),
        conversionType: z.enum(['booking', 'inquiry', 'favorite', 'share', 'none']),
        conversionId: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { recordConversion } = await import('./services/skillPerformanceService');
        await recordConversion(input);
        return { success: true };
      }),

    // 獲取效能儀表板數據
    getPerformanceDashboard: adminProcedure
      .input(z.object({ days: z.number().optional() }).optional())
      .query(async ({ input }) => {
        const { getPerformanceDashboard } = await import('./services/skillPerformanceService');
        return await getPerformanceDashboard(input?.days || 30);
      }),

    // 獲取技能效能摘要
    getSkillPerformanceSummary: adminProcedure
      .input(z.object({ days: z.number().optional() }).optional())
      .query(async ({ input }) => {
        const { getSkillPerformanceSummary } = await import('./services/skillPerformanceService');
        return await getSkillPerformanceSummary(input?.days || 30);
      }),

    // 獲取技能效能趨勢
    getSkillPerformanceTrend: adminProcedure
      .input(z.object({
        skillId: z.number(),
        days: z.number().optional(),
      }))
      .query(async ({ input }) => {
        const { getSkillPerformanceTrend } = await import('./services/skillPerformanceService');
        return await getSkillPerformanceTrend(input.skillId, input.days || 30);
      }),

    // 獲取使用記錄
    getUsageLogs: adminProcedure
      .input(z.object({
        skillId: z.number().optional(),
        contextType: z.enum(['chat', 'search', 'itinerary', 'content', 'classification']).optional(),
        feedback: z.enum(['positive', 'negative', 'none']).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        const { getUsageLogs } = await import('./services/skillPerformanceService');
        return await getUsageLogs({
          ...input,
          startDate: input?.startDate ? new Date(input.startDate) : undefined,
          endDate: input?.endDate ? new Date(input.endDate) : undefined,
        });
      }),

    // ========== 自動審核規則 API ==========
    
    // 獲取所有規則
    getAutoApprovalRules: adminProcedure.query(async () => {
      const { getAllRules } = await import('./services/autoApprovalService');
      return await getAllRules();
    }),

    // 創建規則
    createAutoApprovalRule: adminProcedure
      .input(z.object({
        ruleName: z.string(),
        description: z.string().optional(),
        ruleType: z.enum(['confidence_threshold', 'source_type', 'keyword_count', 'skill_category', 'combined']),
        conditions: z.array(z.object({
          field: z.string(),
          operator: z.enum(['>', '>=', '<', '<=', '==', '!=', 'in', 'not_in']),
          value: z.union([z.string(), z.number(), z.array(z.string())]),
        })),
        action: z.enum(['auto_approve', 'auto_reject', 'flag_priority', 'notify_admin']),
        priority: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createRule } = await import('./services/autoApprovalService');
        const ruleId = await createRule({
          ...input,
          createdBy: ctx.user.id,
        });
        return { success: true, ruleId };
      }),

    // 更新規則
    updateAutoApprovalRule: adminProcedure
      .input(z.object({
        ruleId: z.number(),
        ruleName: z.string().optional(),
        description: z.string().optional(),
        conditions: z.array(z.object({
          field: z.string(),
          operator: z.enum(['>', '>=', '<', '<=', '==', '!=', 'in', 'not_in']),
          value: z.union([z.string(), z.number(), z.array(z.string())]),
        })).optional(),
        action: z.enum(['auto_approve', 'auto_reject', 'flag_priority', 'notify_admin']).optional(),
        priority: z.number().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { updateRule } = await import('./services/autoApprovalService');
        const { ruleId, ...updateData } = input;
        await updateRule(ruleId, updateData);
        return { success: true };
      }),

    // 刪除規則
    deleteAutoApprovalRule: adminProcedure
      .input(z.object({ ruleId: z.number() }))
      .mutation(async ({ input }) => {
        const { deleteRule } = await import('./services/autoApprovalService');
        await deleteRule(input.ruleId);
        return { success: true };
      }),

    // 初始化預設規則
    initializeDefaultRules: adminProcedure.mutation(async ({ ctx }) => {
      const { initializeDefaultRules } = await import('./services/autoApprovalService');
      await initializeDefaultRules(ctx.user.id);
      return { success: true };
    }),

    // 獲取規則統計
    getRuleStatistics: adminProcedure.query(async () => {
      const { getRuleStatistics } = await import('./services/autoApprovalService');
      return await getRuleStatistics();
    }),

    // 應用自動審核規則到待審核項目
    applyAutoApprovalRules: adminProcedure
      .input(z.object({ reviewQueueId: z.number() }))
      .mutation(async ({ input }) => {
        const { applyAutoApprovalRules } = await import('./services/autoApprovalService');
        return await applyAutoApprovalRules(input.reviewQueueId);
      }),
  }),

  // Translation router — Phase 4E extracted to ./routers/translation.ts
  translation: translationRouter,
  
  // Exchange Rate router — Phase 4E extracted to ./routers/exchangeRate.ts
  exchangeRate: exchangeRateRouter,

  // Competitor Monitoring router — Phase 4E extracted to ./routers/competitor.ts
  competitor: competitorRouter,

  // Marketing automation router — Phase 4E extracted to ./routers/marketing.ts
  marketing: marketingRouter,

  // ══════════════════════════════════════════════════════════════
  // PHASE 6: 中國簽證代辦 tRPC 路由
  // ══════════════════════════════════════════════════════════════
  // China Visa router — Phase 4E extracted to ./routers/visa.ts
  visa: visaRouter,
  // Affiliate (Trip.com) router — Phase 4E extracted to ./routers/affiliate.ts
  affiliate: affiliateRouter,


  // Accounting router — Phase 4D extracted to ./routers/accounting.ts
  accounting: accountingRouter,

  // ──────────────────────────────────────────────────────────────────────────
  // v78: WeChat Assist — paste an inbound WeChat / 朋友圈 / LINE message,
  // AI drafts a reply in Jeff's voice, owner reviews/edits/approves.
  // Manual-paste mode works immediately; webhook mode lights up once Jeff
  // verifies his WeChat Official Account.
  // ──────────────────────────────────────────────────────────────────────────
  // WeChat assist router — Phase 4E extracted to ./routers/wechatAssist.ts
  wechatAssist: wechatAssistRouter,

  // ──────────────────────────────────────────────────────────────────────────
  // v78g: R2 storage healthcheck. Diagnostic so admin can verify R2 setup
  // after fixing the bucket in Cloudflare. Returns precise reason on failure.
  // ──────────────────────────────────────────────────────────────────────────
  // v78n Sprint 6B: AI marketing content generator (admin)
  // Marketing AI content router — Phase 4E extracted to ./routers/marketingContent.ts
  marketingContent: marketingContentRouter,

  // Ops router — Phase 4E extracted to ./routers/ops.ts
  ops: opsRouter,

  // Storage router — Phase 4E extracted to ./routers/storage.ts
  storage: storageRouter,

  // ──────────────────────────────────────────────────────────────────────────
  // v78: Auto Reconciliation — single dashboard that joins internal payments,
  // Stripe live ledger, and accounting entries to spot discrepancies.
  // Replaces ~2 hours of monthly close pain for a 1-person ops.
  // ──────────────────────────────────────────────────────────────────────────
  // Reconciliation router — Phase 4E extracted to ./routers/reconciliation.ts
  reconciliation: reconciliationRouter,

  // ──────────────────────────────────────────────────────────────────────────
  // v78: AI Quote Generator — customer free-form intent → matched tours →
  // PDF quote in ~30 seconds.  Replaces 1 hour of manual quoting per request,
  // so a 1-person operation can scale to 50+ quotes/day.
  // ──────────────────────────────────────────────────────────────────────────
  // v78z-z3 Sprint 11 (Image 2.0 Phase A v1): full ChatGPT-in-admin poster
  // composer. Free-form prompt + reference image library + iteration history
  // + edit endpoint for "fix this" loops. Replaces v0 templated tour-spotlight.
  // Poster generation router — Phase 4E extracted to ./routers/posterGen.ts
  posterGen: posterGenRouter,

  // AI Quotes router — Phase 4E extracted to ./routers/aiQuotes.ts
  aiQuotes: aiQuotesRouter,

  // Invoices router — Phase 4E extracted to ./routers/invoices.ts
  invoices: invoicesRouter,

  // Recurring expenses router — Phase 4E extracted to ./routers/recurringExpenses.ts
  recurringExpenses: recurringExpensesRouter,

  // ── Tour Monitor ──────────────────────────────────────────────────────────
  tourMonitor: tourMonitorRouter,

  // ── Autonomous AI Agents (Round 81) ───────────────────────────────────────
  // Layer 0+1 plumbing: outcome tracking + customer memory. Each individual
  // agent (Inquiry/Review/Marketing/Followup/Refund) reads/writes through
  // this single router so we have one audit point + admin gating.
  agent: agentRouter,

  // ── PACK&GO Skills (server-side PDF tools) ────────────────────────────────
  // Round 81 Phase A: packgo-quote integration. Wraps the existing Mac-side
  // Claude Code skill as a server-side endpoint so admin can generate PDFs
  // without leaving the browser.
  tools: toolsRouter,

  // ── Plaid bookkeeping (Phase 1.3, migration 0070) ─────────────────────
  // Bank/credit card sync, transaction list + override, trust account
  // marking. Mounted separately from `accounting` (which handles manual
  // entries) so the two data sources stay disentangled.
  plaid: plaidRouter,

  // ── Supplier sync — daily catalog mirror for Lion + UV ────────────────────
  // Phase 1E. Admin-only endpoints for dashboard data + manual sync trigger.
  // See server/services/supplierSyncService.ts for the orchestrator and
  // server/queues/supplierSyncQueue.ts for the BullMQ worker.
  suppliers: suppliersRouter,

  // ── Reviews — FTC-compliant testimonials ──────────────────────────────────
  // Round 80.7: stub endpoint that returns [] so TestimonialsCarousel doesn't
  // throw "No procedure found" in console on every page load. When Jeff
  // collects real customer reviews tied to completed bookings, this endpoint
  // will expand to query a `reviews` table joined to `bookings` (FTC 16 CFR
  // §465: each row MUST carry a verified bookingId — no fabricated reviews).
  /**
   * Round 80.22 Phase H2: Supplier poster distribution.
   * Admin uploads supplier poster → AI processes (~30s) → admin reviews
   * + edits 7 platform copies → distributes (manual paste for social,
   * auto for newsletter). Tracks distribution status per platform.
   */
  // Posters router — Phase 4E extracted to ./routers/posters.ts
  posters: postersRouter,

  // Reviews router — Phase 4E extracted to ./routers/reviews.ts
  reviews: reviewsRouter,

});
export type AppRouter = typeof appRouter;
