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
// Phase 4E-bis-1 — sub-PR 5b of 6 (refactor 2026-05-19, audit P0-1)
// Final tours sub-extraction: 27 admin mutations split out into one
// flat file. Composition spreads all 3 sub-routers under `tours:` key.
import { toursAdminRouter } from "./routers/toursAdmin";
// Phase 4E-bis-2 — sub-PR 5c of 6 (refactor 2026-05-19, audit P0-1)
// Final large-domain extraction: 55 skills procedures into one flat file.
import { skillsRouter } from "./routers/skills";
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

  // Tour management router — composed from three sub-routers.
  //   - toursReadRouter (Phase 4A): public list / getById / search / suggest /
  //     getFilterOptions / getDepartureCities / generatePdf / getSimilar /
  //     getRecommended
  //   - toursRouteMapRouter (Phase 4A): getRouteMap / regenerateAiMap
  //   - toursAdminRouter (Phase 4E-bis-1): all 27 admin mutations
  // Public router keys preserved via _def.procedures spread so
  // `trpc.tours.<name>` still resolves identically.
  tours: router({
    ...toursReadRouter._def.procedures,
    ...toursRouteMapRouter._def.procedures,
    ...toursAdminRouter._def.procedures,
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

  // Agent Skills management router — Phase 4E-bis-2 extracted to
  // ./routers/skills.ts (55 procedures, final large-domain extraction).
  skills: skillsRouter,

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
