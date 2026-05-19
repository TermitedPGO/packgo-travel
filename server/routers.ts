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
  
  // Authentication router (Email/Password + Google OAuth)
  auth: router({
    // Get current user
    me: publicProcedure.query(opts => {
      const u = opts.ctx.user;
      if (!u) return null;
      const { password, resetPasswordToken, resetPasswordExpires, loginAttempts, lockoutUntil, ...safeUser } = u as any;
      return safeUser;
    }),
    
    // Register with email/password
    register: publicProcedure
      // v73: bounded inputs — public auth endpoint, must be DoS-safe.
      .input(z.object({
        email: z.string().email().max(320),
        password: z.string().min(8).max(128),
        name: shortStr.optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          await auth.createUser(input.email, input.password, input.name);
          
          // Auto login after registration
          const user = await auth.authenticateUser(input.email, input.password);
          
          // Create JWT token
          const token = createToken({
            userId: user.id,
            email: user.email,
            name: user.name || undefined,
            role: user.role,
          });
          
          // Set cookie.
          //
          // SECURITY_AUDIT_2026_05_14 P2-4: maxAge was 365d while
          // createToken defaults to a 14d JWT (server/jwt.ts), so the
          // browser kept the cookie for 351 useless days after the JWT
          // stopped verifying. Match the JWT TTL.
          const cookieOptions = getSessionCookieOptions(ctx.req);
          ctx.res.cookie(COOKIE_NAME, token, {
            ...cookieOptions,
            maxAge: 14 * 24 * 60 * 60 * 1000,
          });

          return { success: true, user: { id: user.id, email: user.email, name: user.name } };
        } catch (error: any) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error.message || 'Registration failed',
          });
        }
      }),
    
    // Login with email/password
    login: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string(),
        rememberMe: z.boolean().optional().default(false),
      }))
      .mutation(async ({ input, ctx }) => {
        // QA audit 2026-05-11 Phase 6 fix: login was previously wide open
        // to credential brute-force. Now rate-limited by IP (10 / 15 min)
        // AND by email (5 / 15 min) so credential-stuffing across rotating
        // IPs still hits the per-account ceiling.
        const ip = (
          (ctx.req.headers["x-forwarded-for"] as string) ||
          ctx.req.socket?.remoteAddress ||
          "unknown"
        )
          .split(",")[0]
          .trim();
        const ipLimit = await checkLoginRateLimitByIP(ip);
        if (!ipLimit.allowed) {
          console.warn(`[Auth] IP rate limit exceeded for login: ${ip}`);
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "登入嘗試過於頻繁,請 15 分鐘後再試",
          });
        }
        const emailLimit = await checkLoginRateLimitByEmail(input.email);
        if (!emailLimit.allowed) {
          // 2026-05-17 red-team round 4 — redact email in logs (PII leak via
          // Fly logs / log aggregator)
          const { redactEmail } = await import("./_core/redact");
          console.warn(`[Auth] Email rate limit exceeded for login (account lock): ${redactEmail(input.email)}`);
          // Same generic 401 to avoid revealing which accounts are locked.
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "登入失敗",
          });
        }

        try {
          const user = await auth.authenticateUser(input.email, input.password);
          
          // Determine token expiry based on rememberMe option
          // rememberMe: true -> 30 days, false -> 7 days
          const maxAge = input.rememberMe 
            ? 30 * 24 * 60 * 60 * 1000  // 30 days
            : 7 * 24 * 60 * 60 * 1000;  // 7 days
          
          // Create JWT token with expiry
          const token = createToken(
            {
              userId: user.id,
              email: user.email,
              name: user.name || undefined,
              role: user.role,
            },
            input.rememberMe ? '30d' : '7d'
          );
          
          // Set cookie
          const cookieOptions = getSessionCookieOptions(ctx.req);
          ctx.res.cookie(COOKIE_NAME, token, { 
            ...cookieOptions, 
            maxAge 
          });
          
          return { success: true, user: { id: user.id, email: user.email, name: user.name } };
        } catch (error: any) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: error.message || 'Login failed',
          });
        }
      }),
    
    // Request password reset
    requestPasswordReset: publicProcedure
      .input(z.object({
        email: z.string().email(),
        recaptchaToken: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // ── Abuse Prevention Layer ──────────────────────────────────────
        // 0. reCAPTCHA v3 verification (skip in test environment)
        const recaptchaSecretKey = process.env.RECAPTCHA_SECRET_KEY;
        const isTestEnv = process.env.VITEST || process.env.NODE_ENV === 'test';
        if (recaptchaSecretKey && !isTestEnv) {
          if (!input.recaptchaToken) {
            console.warn('[Auth] Missing reCAPTCHA token for forgot-password');
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: '驗證失敗，請重新整理頁面後再試',
            });
          }
          try {
            const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                secret: recaptchaSecretKey,
                response: input.recaptchaToken,
              }).toString(),
            });
            const verifyData = await verifyRes.json() as { success: boolean; score: number; action: string; 'error-codes'?: string[] };
            console.log(`[Auth] reCAPTCHA result: success=${verifyData.success}, score=${verifyData.score}, action=${verifyData.action}`);
            if (!verifyData.success || verifyData.score < 0.5) {
              console.warn(`[Auth] reCAPTCHA rejected: score=${verifyData.score}, errors=${verifyData['error-codes']?.join(',')}`);
              // Return generic success to avoid leaking info
              return { success: true, message: '如果該電子郵件已註冊，您將收到重設密碼的連結' };
            }
          } catch (err) {
            // If reCAPTCHA service is down, log but allow the request through
            console.error('[Auth] reCAPTCHA verification error (allowing through):', err);
          }
        }

        // 1. Block disposable / fake email domains (e.g. example.com)
        if (isBlockedEmailDomain(input.email)) {
          // Return generic success to avoid leaking info, but do NOT send email
          const { redactEmail: r1 } = await import("./_core/redact");
          console.warn(`[Auth] Blocked forgot-password request to fake domain: ${r1(input.email)}`);
          return { success: true, message: '如果該電子郵件已註冊，您將收到重設密碼的連結' };
        }

        // 2. Global circuit breaker (100 req/min across all IPs)
        const globalLimit = await checkForgotPasswordGlobalRateLimit();
        if (!globalLimit.allowed) {
          console.warn(`[Auth] Global forgot-password rate limit exceeded`);
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: '系統繁忙，請稍後再試',
          });
        }

        // 3. Per-IP rate limit (5 req / 15 min)
        const ip = (ctx.req.headers['x-forwarded-for'] as string || ctx.req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
        const ipLimit = await checkForgotPasswordRateLimitByIP(ip);
        if (!ipLimit.allowed) {
          console.warn(`[Auth] IP rate limit exceeded for forgot-password: ${ip}`);
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: '請求過於頻繁，請 15 分鐘後再試',
          });
        }

        // 4. Per-email rate limit (3 req / hour)
        const emailLimit = await checkForgotPasswordRateLimitByEmail(input.email);
        if (!emailLimit.allowed) {
          const { redactEmail: r2 } = await import("./_core/redact");
          console.warn(`[Auth] Email rate limit exceeded for forgot-password: ${r2(input.email)}`);
          // Return generic success to avoid email enumeration
          return { success: true, message: '如果該電子郵件已註冊，您將收到重設密碼的連結' };
        }
        // ── End Abuse Prevention ────────────────────────────────────────

        try {
          const result = await auth.requestPasswordReset(input.email);
          return result;
        } catch (error: any) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error.message || 'Password reset request failed',
          });
        }
      }),
    
    // Reset password with token
    resetPassword: publicProcedure
      .input(z.object({
        token: z.string().min(32).max(256).regex(/^[a-f0-9]+$/, 'Invalid token format'),
        newPassword: z.string().min(8).max(128), // v73: bound max length
      }))
      .mutation(async ({ input }) => {
        try {
          await auth.resetPassword(input.token, input.newPassword);
          return { success: true };
        } catch (error: any) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error.message || 'Password reset failed',
          });
        }
      }),
    
    // Logout
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
    
    // Update user profile
    updateProfile: protectedProcedure
      .input(
        z.object({
          name: z.string().min(2).max(50).optional(),
          phone: z.string().max(20).optional(),
          address: z.string().optional(),
          // Round 80.22 Phase E: birthday for the +100 annual Packpoint cron.
          // Stored as YYYY-MM-DD on the client and parsed to a Date here.
          // Once set, can't be changed (anti-fraud — would let users harvest
          // birthday bonuses by toggling the field). Returns 409 on retry.
          birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Special-case birthDate: write directly via drizzle so we can enforce
        // "set once" and validate the date is sane (not future, not before 1900).
        if (input.birthDate) {
          const parsed = new Date(input.birthDate + "T12:00:00Z"); // noon UTC for tz safety
          if (isNaN(parsed.getTime())) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid birthDate" });
          }
          if (parsed > new Date() || parsed < new Date("1900-01-01")) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "請輸入合理的生日日期" });
          }
          if ((ctx.user as any).birthDate) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "生日已設定,如需更改請聯絡客服",
            });
          }
          const drizzleDb = await db.getDb();
          if (drizzleDb) {
            const { users: usersTable } = await import("../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            await drizzleDb
              .update(usersTable)
              .set({ birthDate: parsed })
              .where(eq(usersTable.id, ctx.user.id));
          }
        }
        const profileUpdates = { ...input };
        delete (profileUpdates as any).birthDate; // handled above
        const updated = Object.keys(profileUpdates).length > 0
          ? await db.updateUserProfile(ctx.user.id, profileUpdates)
          : true;
        if (!updated) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update profile",
          });
        }
        return { ok: true };
      }),
    
    // Upload avatar
    uploadAvatar: protectedProcedure
      .input(
        z.object({
          avatarUrl: z.string().url(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const updated = await db.updateUserAvatar(ctx.user.id, input.avatarUrl);
        if (!updated) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to upload avatar",
          });
        }
        return updated;
      }),
    
    // Delete avatar
    deleteAvatar: protectedProcedure
      .mutation(async ({ ctx }) => {
        const updated = await db.updateUserAvatar(ctx.user.id, null);
        if (!updated) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to delete avatar",
          });
        }
        return updated;
      }),
  }),
  
  // Round 80.20: Membership Phase 2 — Stripe subscription lifecycle.
  // Public endpoints for /membership page; webhook handles tier flips.
  membership: router({
    // Read current user's membership status (for /membership UI to show
    // "Manage subscription" instead of "Subscribe" when already paid).
    getStatus: publicProcedure.query(async ({ ctx }) => {
      const user = ctx.user as any;
      if (!user) {
        return { tier: "free" as const, expiresAt: null, hasSubscription: false };
      }
      return {
        tier: (user.tier || "free") as "free" | "plus" | "concierge",
        expiresAt: user.tierExpiresAt || null,
        hasSubscription: Boolean(user.stripeSubscriptionId),
      };
    }),

    // Create a Stripe Checkout session for the given paid tier. Logged-in
    // users only — anonymous flow would need email capture first which we
    // defer to Phase 3.
    createCheckoutSession: protectedProcedure
      .input(
        z.object({
          tier: z.enum(["plus", "concierge"]),
          period: z.enum(["yearly", "monthly"]).default("yearly"),
          // Round 81 / migration 0075 — AB 390 compliant 10-day trial.
          // Defaults to true (better UX = lower bounce); set false for
          // promo flows that already gave the user other discounts.
          withTrial: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { isMembershipPricingConfigured, priceIdForTier, hasMonthlyOption } =
          await import("./_core/membershipPricing");
        if (!isMembershipPricingConfigured()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Stripe membership pricing is not yet configured. Please set yearly Stripe price IDs.",
          });
        }
        // Round 80.21: monthly is optional — if user picks monthly but it's
        // not configured for this tier, fall back to yearly with a hint.
        const period =
          input.period === "monthly" && !hasMonthlyOption(input.tier)
            ? "yearly"
            : input.period;

        const Stripe = (await import("stripe")).default;
        const stripe = new Stripe(ENV.stripeSecretKey);
        const baseUrl = ENV.baseUrl || "https://packgoplay.com";

        // Reuse existing customer if user already has one
        let customerId = (ctx.user as any).stripeCustomerId as string | null;
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: ctx.user.email || undefined,
            name: ctx.user.name || undefined,
            metadata: { userId: String(ctx.user.id) },
          });
          customerId = customer.id;
          // Save for next time (best-effort — webhook also captures it)
          try {
            const { getDb } = await import("./db");
            const { users } = await import("../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            const dbInstance = await getDb();
            if (dbInstance) {
              await dbInstance
                .update(users)
                .set({ stripeCustomerId: customerId })
                .where(eq(users.id, ctx.user.id));
            }
          } catch (e) {
            console.warn("[Membership] Failed to persist stripeCustomerId:", e);
          }
        }

        // Round 81 / migration 0075 — AB 390 compliant 10-day trial.
        //   - Allowed once per tier per user (enforced by plus/conciergeTrialUsedAt
        //     check below; abuse via creating new accounts is the residual risk).
        //   - Stripe handles the trial mechanics; we just say "give them 10 days
        //     before charging". `trial_will_end` webhook (fires ~3 days before)
        //     is what triggers our AB 390 reminder email.
        //   - subscription_data.trial_settings.end_behavior.missing_payment_method
        //     = 'cancel' means: if the customer somehow loses their card during
        //     trial, Stripe cancels the trial → never charges. Safer default than
        //     'create_invoice' which would try to charge and fail.
        let trialPeriodDays: number | undefined = undefined;
        let trialAlreadyUsed = false;
        if (input.withTrial) {
          const trialFlag = input.tier === "plus" ? "plusTrialUsedAt" : "conciergeTrialUsedAt";
          const alreadyUsedAt = (ctx.user as any)[trialFlag];

          // 2026-05-17 red-team round 1 — also check any OTHER user account
          // that resolves to the same physical Gmail inbox (j.e.f.f@gmail.com,
          // jeff+tag@gmail.com, jeff@googlemail.com all → jeff@gmail.com).
          // Without this check, attacker can register N variants and get N
          // trials from one inbox.
          const { normalizeEmail } = await import("./_core/emailNormalize");
          const normalized = normalizeEmail(ctx.user.email);
          let dotTrickAlreadyUsed = false;
          if (normalized && normalized !== ctx.user.email.toLowerCase()) {
            try {
              const { getDb } = await import("./db");
              const { users } = await import("../drizzle/schema");
              const { ne, isNotNull, and: dAnd, sql: dSql } = await import("drizzle-orm");
              const db = await getDb();
              if (db) {
                // Find any OTHER account whose normalized email matches AND
                // has already used this tier's trial.
                const rows = await db
                  .select({ id: users.id, usedAt: (users as any)[trialFlag] })
                  .from(users)
                  .where(
                    dAnd(
                      ne(users.id, ctx.user.id),
                      isNotNull((users as any)[trialFlag]),
                      // Subquery would be cleaner but MySQL needs computed col
                      // Cheap: load + compare in app code
                    )
                  );
                for (const r of rows as any[]) {
                  // We don't have normalizedEmail column yet — manual recompute.
                  // For perf, future migration should add users.normalizedEmail
                  // with unique index.
                  const otherUser = await db
                    .select({ email: users.email })
                    .from(users)
                    .where(dSql`${users.id} = ${r.id}`)
                    .limit(1);
                  if (otherUser[0] && normalizeEmail(otherUser[0].email) === normalized) {
                    dotTrickAlreadyUsed = true;
                    console.warn(
                      `[Membership] User ${ctx.user.id} (${ctx.user.email}) blocked from trial: same physical inbox as user ${r.id} already trialed ${input.tier}`
                    );
                    break;
                  }
                }
              }
            } catch (err) {
              console.warn("[Membership] dot-trick check failed (non-fatal):", err);
            }
          }

          if (alreadyUsedAt || dotTrickAlreadyUsed) {
            trialAlreadyUsed = true;
            console.log(
              `[Membership] User ${ctx.user.id} already used ${input.tier} trial — billing immediately`
            );
          } else {
            trialPeriodDays = 10;
          }
        }

        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          customer: customerId,
          line_items: [{ price: priceIdForTier(input.tier, period), quantity: 1 }],
          success_url: `${baseUrl}/membership?success=1&tier=${input.tier}&period=${period}${trialPeriodDays ? "&trial=1" : ""}`,
          cancel_url: `${baseUrl}/membership?canceled=1`,
          // Metadata so webhook can identify the user even if subscription
          // lookup fails (defensive).
          subscription_data: {
            metadata: {
              userId: String(ctx.user.id),
              tier: input.tier,
              period,
            },
            ...(trialPeriodDays ? {
              trial_period_days: trialPeriodDays,
              trial_settings: {
                end_behavior: {
                  missing_payment_method: "cancel" as const,
                },
              },
            } : {}),
          },
          // AB 390: trial users must enter a payment method upfront so
          // auto-charge works at trial end. This is Stripe's default
          // behavior — explicitly stating for documentation.
          payment_method_collection: trialPeriodDays ? "always" : "always",
          // Allow customer to enter promotion code at checkout (set up in
          // Stripe Dashboard) — useful for "FRIENDS" / "EARLYBIRD" discounts.
          allow_promotion_codes: true,
        });

        return {
          url: session.url,
          // Surface to UI so it can show "free trial" badge or not
          trialDays: trialPeriodDays || 0,
          trialAlreadyUsed,
        };
      }),

    // Customer portal — let users manage / cancel their subscription.
    createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
      const customerId = (ctx.user as any).stripeCustomerId as string | null;
      if (!customerId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No subscription found for your account.",
        });
      }
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(ENV.stripeSecretKey);
      const baseUrl = ENV.baseUrl || "https://packgoplay.com";
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${baseUrl}/membership`,
      });
      return { url: portal.url };
    }),
  }),

  // Packpoint loyalty router — Phase 4D extracted to ./routers/packpoint.ts
  packpoint: packpointRouter,

  // Vouchers router — Phase 4D extracted to ./routers/vouchers.ts
  vouchers: vouchersRouter,

  /**
   * Round 80.22 Phase F: Trip photos. Customer uploads photos from a
   * completed booking; +10 Packpoint per photo (capped per booking via
   * a UNIQUE check on photo count). Used by photo book voucher gate.
   */
  photos: router({
    /** Upload a photo URL (from S3 / pre-signed upload). */
    upload: protectedProcedure
      .input(
        z.object({
          bookingId: z.number().int().positive(),
          photoUrl: z.string().url().max(1024),
          caption: z.string().max(500).optional(),
          isPublic: z.boolean().default(false),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const booking = await db.getBookingById(input.bookingId);
        if (!booking) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }
        if ((booking as any).userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
        }
        if (booking.bookingStatus !== "completed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "只能上傳已完成行程的照片",
          });
        }

        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tripPhotos } = await import("../drizzle/schema");
        const { eq, and, sql } = await import("drizzle-orm");

        // Count existing photos for THIS booking — cap at 10 with bonus pt
        // (per policy §4 — photo bonus is +10 each, max 100 pts per booking).
        const [countRow] = await drizzleDb
          .select({ c: sql<number>`COUNT(*)` })
          .from(tripPhotos)
          .where(eq(tripPhotos.bookingId, input.bookingId));
        const existingCount = Number(countRow?.c || 0);
        const eligibleForBonus = existingCount < 10;

        // Insert the photo
        const result = await drizzleDb.insert(tripPhotos).values({
          userId: ctx.user.id,
          bookingId: input.bookingId,
          photoUrl: input.photoUrl,
          caption: input.caption || null,
          isPublic: input.isPublic,
          pointsAwarded: false, // updated below if eligible
        });
        const photoId = (result as any)[0]?.insertId ?? 0;

        // Award +10 if eligible
        let pointsEarned = 0;
        if (eligibleForBonus) {
          try {
            const { awardPackpoint } = await import("./_core/packpoint");
            await awardPackpoint({
              userId: ctx.user.id,
              delta: 10,
              reason: "photo_bonus",
              referenceType: "photo",
              referenceId: photoId,
              description: `上傳行程照片 (booking #${input.bookingId})`,
            });
            await drizzleDb
              .update(tripPhotos)
              .set({ pointsAwarded: true })
              .where(eq(tripPhotos.id, photoId));
            pointsEarned = 10;
          } catch (err) {
            console.error("[Photos] Bonus award failed:", err);
          }
        }

        return { photoId, pointsEarned, capReached: !eligibleForBonus };
      }),

    /** List user's own photos (optionally for one booking). */
    myPhotos: protectedProcedure
      .input(z.object({ bookingId: z.number().int().positive().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return [];
        const { tripPhotos } = await import("../drizzle/schema");
        const { eq, and, desc } = await import("drizzle-orm");
        const conditions = input?.bookingId
          ? and(eq(tripPhotos.userId, ctx.user.id), eq(tripPhotos.bookingId, input.bookingId))
          : eq(tripPhotos.userId, ctx.user.id);
        return await drizzleDb
          .select()
          .from(tripPhotos)
          .where(conditions)
          .orderBy(desc(tripPhotos.id));
      }),

    /** Delete a photo (soft delete via removal — points are NOT clawed back). */
    delete: protectedProcedure
      .input(z.object({ photoId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tripPhotos } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        await drizzleDb
          .delete(tripPhotos)
          .where(and(eq(tripPhotos.id, input.photoId), eq(tripPhotos.userId, ctx.user.id)));
        return { ok: true };
      }),
  }),

  // AI Travel Advisor router
  ai: router({
    // Round 80.19: query current quota status without consuming a message.
    // Used by dialog open to show the counter pill + paywall preview.
    getQuota: publicProcedure.query(async ({ ctx }) => {
      const userTier = (ctx.user as any)?.tier || "free";
      const isPaidTier = userTier === "plus" || userTier === "concierge";
      if (isPaidTier) {
        return { tier: userTier as "plus" | "concierge", used: 0, cap: -1, windowDays: 30 };
      }
      const FREE_TIER_LIMIT = 5;
      const FREE_TIER_WINDOW_DAYS = 30;
      const ip = ctx.ip;
      const { createHash } = await import("crypto");
      const ipHashKey = ip ? createHash("sha256").update(ip).digest("hex").slice(0, 64) : null;
      const userIdKey = ctx.user?.id ?? null;
      const { aiAdvisorUsage } = await import("../drizzle/schema");
      const { sql, and, gt, eq } = await import("drizzle-orm");
      const { getDb } = await import("./db");
      const db = await getDb();
      let usage = 0;
      if (db) {
        const since = new Date(Date.now() - FREE_TIER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const conditions = userIdKey
          ? and(eq(aiAdvisorUsage.userId, userIdKey), gt(aiAdvisorUsage.createdAt, since))
          : ipHashKey
          ? and(eq(aiAdvisorUsage.ipHash, ipHashKey), gt(aiAdvisorUsage.createdAt, since))
          : null;
        if (conditions) {
          const rows = await db
            .select({ c: sql<number>`COUNT(*)` })
            .from(aiAdvisorUsage)
            .where(conditions);
          usage = Number(rows[0]?.c || 0);
        }
      }
      return {
        tier: "free" as const,
        used: usage,
        cap: FREE_TIER_LIMIT,
        windowDays: FREE_TIER_WINDOW_DAYS,
      };
    }),

    // Skill-enhanced AI chat with performance tracking.
    // Code-review 2026-05-09: bounded message + history to prevent DoS
    // (single 100MB request could stall LLM and rack up cost). 5000 chars
    // is plenty for natural-language travel inquiries; 50 history items
    // covers any realistic conversation turn.
    chat: publicProcedure
      .input(
        z.object({
          message: z.string().max(5000),
          conversationHistory: z.array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().max(5000),
            })
          ).max(50).optional(),
          sessionId: z.string().max(200).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // Round 72: Multi-layered rate limit for AI chat.
        // Prior state: (ctx as any).ip was ALWAYS undefined because TrpcContext
        // didn't expose ip, so the per-IP hourly bucket was effectively global.
        // Now ctx.ip is populated by getClientIp() in context.ts (Fly-Client-IP
        // → X-Forwarded-For → socket → "unknown"), and we layer three caps:
        //   1. Per-IP hourly (60/hr) — slows single-IP burst abuse
        //   2. Per-IP daily  (200/day) — catches persistent low-burst abuse
        //   3. Global anonymous daily (5000/day) — caps total $ cost ceiling
        // Logged-in users get their own user-scoped daily cap (500/day) and
        // bypass the global anonymous bucket.
        const ip = ctx.ip;
        const isAuthenticated = !!ctx.user?.id;

        // Per-IP hourly cap always applies.
        const hourlyLimit = await checkAiChatRateLimit(ip);
        if (!hourlyLimit.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "AI 對話請求過於頻繁，請稍後再試",
          });
        }

        // Per-IP daily cap always applies.
        const dailyLimit = await checkAiChatDailyLimit(ip);
        if (!dailyLimit.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "今日 AI 對話配額已達上限，請明日再試或登入取得更高配額",
          });
        }

        if (isAuthenticated) {
          // Authenticated users: per-user daily cap (more generous).
          const userDailyLimit = await checkAiChatUserDailyLimit(ctx.user!.id);
          if (!userDailyLimit.allowed) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "今日 AI 對話配額已達上限（500 則 / 日），明日重置",
            });
          }
        } else {
          // Anonymous users: also counted against global anon bucket (cost ceiling).
          const globalAnon = await checkAiChatGlobalAnonymousLimit();
          if (!globalAnon.allowed) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "AI 助理今日流量已達上限，請登入或稍後再試",
            });
          }
        }

        // Round 80.19: AI Advisor Phase 1 — tier-based rate limit.
        // Free / anonymous users: 5 messages / rolling 30-day window.
        // Plus / Concierge members: unlimited (still logged for abuse cap).
        // We check BEFORE calling the LLM so users hitting the limit get
        // an immediate paywall response instead of paying for one more
        // turn.
        const userTier = (ctx.user as any)?.tier || "free";
        const isPaidTier = userTier === "plus" || userTier === "concierge";
        const FREE_TIER_LIMIT = 5;
        const FREE_TIER_WINDOW_DAYS = 30;

        let usageBefore = 0;
        if (!isPaidTier) {
          // Compute identity key for rate limit: userId for logged-in,
          // sha256(ip) for anonymous.
          const { createHash } = await import("crypto");
          const ipHashKey = ip ? createHash("sha256").update(ip).digest("hex").slice(0, 64) : null;
          const userIdKey = ctx.user?.id ?? null;

          // Count messages in the rolling 30-day window. Use raw SQL because
          // Drizzle's count() doesn't support `gt` on timestamps cleanly here.
          const { aiAdvisorUsage } = await import("../drizzle/schema");
          const { sql, and, gt, eq } = await import("drizzle-orm");
          const { getDb } = await import("./db");
          const db = await getDb();
          if (db) {
            const since = new Date(Date.now() - FREE_TIER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
            const conditions = userIdKey
              ? and(eq(aiAdvisorUsage.userId, userIdKey), gt(aiAdvisorUsage.createdAt, since))
              : ipHashKey
              ? and(eq(aiAdvisorUsage.ipHash, ipHashKey), gt(aiAdvisorUsage.createdAt, since))
              : null;
            if (conditions) {
              const rows = await db
                .select({ c: sql<number>`COUNT(*)` })
                .from(aiAdvisorUsage)
                .where(conditions);
              usageBefore = Number(rows[0]?.c || 0);
            }
          }

          if (usageBefore >= FREE_TIER_LIMIT) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: JSON.stringify({
                kind: "QUOTA_EXCEEDED",
                tier: "free",
                used: usageBefore,
                cap: FREE_TIER_LIMIT,
                windowDays: FREE_TIER_WINDOW_DAYS,
                upgradeUrl: "/membership",
              }),
            });
          }
        }

        const { message, conversationHistory = [], sessionId } = input;
        const { processMessageWithSkills } = await import("./services/aiChatSkillService");

        try {
          // Process message with skill integration
          const result = await processMessageWithSkills({
            message,
            conversationHistory,
            userId: ctx.user?.id,
            sessionId: sessionId || `session_${Date.now()}`,
          });

          // Round 80.19: log usage (regardless of tier, for analytics + abuse).
          try {
            const { aiAdvisorUsage } = await import("../drizzle/schema");
            const { getDb } = await import("./db");
            const db = await getDb();
            if (db) {
              const { createHash } = await import("crypto");
              const ipHashKey = ip ? createHash("sha256").update(ip).digest("hex").slice(0, 64) : null;
              await db.insert(aiAdvisorUsage).values({
                ipHash: ctx.user?.id ? null : ipHashKey,
                userId: ctx.user?.id ?? null,
                sessionId: sessionId || null,
                messagePreview: message.slice(0, 500),
                tokenCount: 0, // could be filled from result if exposed
                tier: userTier,
              });
            }
          } catch (logErr) {
            console.warn("[AI Chat] Usage log failed (non-fatal):", logErr);
          }

          return {
            response: result.response,
            triggeredSkills: result.triggeredSkills.map(s => ({
              skillId: s.skillId,
              skillName: s.skillName,
              confidence: s.confidence,
            })),
            usageLogIds: result.usageLogIds,
            // Round 80.19: surface remaining quota so the UI can show a counter.
            quota: isPaidTier
              ? null
              : {
                  used: usageBefore + 1, // we just consumed one
                  cap: FREE_TIER_LIMIT,
                  windowDays: FREE_TIER_WINDOW_DAYS,
                  tier: "free" as const,
                },
          };
        } catch (error) {
          console.error("[AI Chat] Error:", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "無法連接到 AI 服務，請稍後再試。",
          });
        }
      }),

    // Record user feedback for AI chat response.
    //
    // SECURITY_AUDIT_2026_05_14 P2-5: was an unauthenticated publicProcedure
    // accepting any usageLogIds — anyone could pollute skill-performance
    // analytics. Now requires either:
    //   (a) `sessionId` matching the chat session that produced the logs, OR
    //   (b) authenticated user whose own logs are being annotated.
    // Server checks every passed-in id and rejects if any of them doesn't
    // belong to the caller. Tighter than the audit's two suggested options
    // ("session token" or "protectedProcedure") because it accepts both,
    // which preserves anonymous-chat feedback while still gating writes.
    recordFeedback: publicProcedure
      .input(
        z.object({
          sessionId: z.string().min(1).max(200).optional(),
          usageLogIds: z.array(z.number().int().positive()).max(100),
          feedback: z.enum(["positive", "negative"]),
          comment: mediumStr.optional(), // v73: bound 5KB max
        })
      )
      .mutation(async ({ input, ctx }) => {
        await assertOwnsUsageLogs(input.usageLogIds, {
          userId: ctx.user?.id,
          sessionId: input.sessionId,
        });
        const { recordChatFeedback } = await import("./services/aiChatSkillService");
        await recordChatFeedback(input.usageLogIds, input.feedback, input.comment);
        return { success: true };
      }),

    // Record conversion from AI chat session.
    //
    // SECURITY_AUDIT_2026_05_14 P2-5: same session-or-user gate as
    // recordFeedback above. Conversion writes feed the skill-performance
    // training loop, so anonymous tampering would poison future skill
    // matching.
    recordConversion: publicProcedure
      .input(
        z.object({
          sessionId: z.string().min(1).max(200).optional(),
          usageLogIds: z.array(z.number().int().positive()).max(100),
          conversionType: z.enum(["booking", "inquiry", "favorite", "share"]),
          conversionId: z.number().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await assertOwnsUsageLogs(input.usageLogIds, {
          userId: ctx.user?.id,
          sessionId: input.sessionId,
        });
        const { recordChatConversion } = await import("./services/aiChatSkillService");
        await recordChatConversion(input.usageLogIds, input.conversionType, input.conversionId);
        return { success: true };
      }),
  }),

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

  // Translation router - AI-powered translation agent
  translation: router({
    // Translate single text
    translate: publicProcedure
      .input(z.object({
        text: z.string(),
        targetLanguage: z.enum(['zh-TW', 'en']),
        sourceLanguage: z.enum(['zh-TW', 'en']).optional().default('zh-TW'),
      }))
      .mutation(async ({ input }) => {
        const translated = await translateText(
          input.text,
          input.targetLanguage,
          input.sourceLanguage
        );
        return { translated };
      }),

    // Translate multiple texts in batch
    translateBatch: publicProcedure
      .input(z.object({
        texts: z.array(z.string()),
        targetLanguage: z.enum(['zh-TW', 'en']),
        sourceLanguage: z.enum(['zh-TW', 'en']).optional().default('zh-TW'),
      }))
      .mutation(async ({ input }) => {
        const translated = await translateBatch(
          input.texts,
          input.targetLanguage,
          input.sourceLanguage
        );
        return { translated };
      }),

    // Translate a single tour to multiple languages
    translateTour: adminProcedure
      .input(z.object({
        tourId: z.number(),
        targetLanguages: z.array(z.enum(['zh-TW', 'en', 'ja', 'ko'])),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await translateTour(
          input.tourId,
          input.targetLanguages as Language[],
          'zh-TW',
          ctx.user.id
        );
        return result;
      }),

    // Translate all tours to multiple languages
    translateAllTours: adminProcedure
      .input(z.object({
        targetLanguages: z.array(z.enum(['zh-TW', 'en', 'ja', 'ko'])),
      }))
      .mutation(async ({ input, ctx }) => {
        // Get all tour IDs
        const allTours = await db.getAllTours();
        const tourIds = allTours.map(t => t.id);
        
        if (tourIds.length === 0) {
          return { success: true, message: 'No tours to translate', results: [] };
        }

        const result = await translateMultipleTours(
          tourIds,
          input.targetLanguages as Language[],
          ctx.user.id
        );
        
        return {
          success: result.success,
          jobId: result.jobId,
          totalTours: tourIds.length,
          results: result.results,
        };
      }),

    // Get translation summary for all tours (admin only)
    getAllTranslationsSummary: adminProcedure
      .query(async () => {
        return await getAllTranslationsSummary();
      }),
    // Get translations for a specific tour
    getTourTranslations: publicProcedure
      .input(z.object({
        tourId: z.number(),
        targetLanguage: z.enum(['zh-TW', 'en', 'ja', 'ko']),
      }))
      .query(async ({ input }) => {
        const translations = await getTourTranslations(
          input.tourId,
          input.targetLanguage as Language
        );
        // Fix 3 (Round 61): If no translations found and target is not zh-TW, trigger fallback translation job
        if (Object.keys(translations).length === 0 && input.targetLanguage !== 'zh-TW') {
          import('./queue').then(({ addTourTranslationJob }) =>
            addTourTranslationJob({
              tourId: input.tourId,
              targetLanguages: [input.targetLanguage],
              sourceLanguage: 'zh-TW',
              userId: 0, // system-triggered
            })
          ).catch((e) => console.warn(`[TranslateFallback] Failed to queue translation for tour ${input.tourId}:`, e));
        }
        return translations;
      }),

    // Batch get translations for multiple tours
    getBatchTourTranslations: publicProcedure
      .input(z.object({
        tourIds: z.array(z.number()),
        targetLanguage: z.enum(['zh-TW', 'en', 'ja', 'ko']),
      }))
      .query(async ({ input }) => {
        const result = await getBatchTourTranslations(
          input.tourIds,
          input.targetLanguage as Language
        );
        return result;
      }),

    // Get all translations for a tour (all languages)
    getAllTourTranslations: publicProcedure
      .input(z.object({
        tourId: z.number(),
      }))
      .query(async ({ input }) => {
        const translations = await getAllTourTranslations(input.tourId);
        return translations;
      }),

    // Get translation job history
    getJobs: adminProcedure
      .input(z.object({
        limit: z.number().optional().default(20),
      }))
      .query(async ({ input }) => {
        const jobs = await getTranslationJobs(input.limit);
        return jobs;
      }),

    // Get supported languages
    getSupportedLanguages: publicProcedure
      .query(() => {
        return getSupportedLanguages();
      }),
  }),
  
  // Exchange Rate router - 匯率轉換服務
  exchangeRate: router({
    // 獲取所有匯率
    getRates: publicProcedure.query(async () => {
      const rates = await getExchangeRates();
      return {
        base: rates.base,
        rates: rates.rates,
        lastUpdated: rates.lastUpdated,
        // 免責聲明
        disclaimer: '匯率僅供參考，實際價格以屆時人員提供的報價為準'
      };
    }),
    
    // 轉換單一金額
    convert: publicProcedure
      .input(z.object({
        amount: z.number(),
        fromCurrency: z.enum(['TWD', 'USD', 'EUR', 'JPY', 'CNY', 'HKD', 'KRW', 'SGD', 'GBP', 'AUD']),
        toCurrency: z.enum(['TWD', 'USD', 'EUR', 'JPY', 'CNY', 'HKD', 'KRW', 'SGD', 'GBP', 'AUD']),
      }))
      .query(async ({ input }) => {
        const convertedAmount = await convertCurrency(
          input.amount,
          input.fromCurrency as SupportedCurrency,
          input.toCurrency as SupportedCurrency
        );
        const rate = await getExchangeRate(
          input.fromCurrency as SupportedCurrency,
          input.toCurrency as SupportedCurrency
        );
        
        return {
          originalAmount: input.amount,
          convertedAmount,
          fromCurrency: input.fromCurrency,
          toCurrency: input.toCurrency,
          rate,
          disclaimer: '匯率僅供參考，實際價格以屆時人員提供的報價為準'
        };
      }),
    
    // 獲取特定貨幣對的匯率
    getRate: publicProcedure
      .input(z.object({
        fromCurrency: z.enum(['TWD', 'USD', 'EUR', 'JPY', 'CNY', 'HKD', 'KRW', 'SGD', 'GBP', 'AUD']),
        toCurrency: z.enum(['TWD', 'USD', 'EUR', 'JPY', 'CNY', 'HKD', 'KRW', 'SGD', 'GBP', 'AUD']),
      }))
      .query(async ({ input }) => {
        const rate = await getExchangeRate(
          input.fromCurrency as SupportedCurrency,
          input.toCurrency as SupportedCurrency
        );
        
        return {
          fromCurrency: input.fromCurrency,
          toCurrency: input.toCurrency,
          rate,
          disclaimer: '匯率僅供參考，實際價格以屆時人員提供的報價為準'
        };
      }),
    
    // 獲取貨幣符號
    getSymbol: publicProcedure
      .input(z.object({
        currency: z.enum(['TWD', 'USD', 'EUR', 'JPY', 'CNY', 'HKD', 'KRW', 'SGD', 'GBP', 'AUD']),
      }))
      .query(({ input }) => {
        return {
          currency: input.currency,
          symbol: getCurrencySymbol(input.currency as SupportedCurrency)
        };
      }),
    
    // 獲取支援的貨幣列表
    getSupportedCurrencies: publicProcedure.query(() => {
      return [
        { code: 'TWD', name: '新台幣', symbol: 'NT$' },
        { code: 'USD', name: '美元', symbol: '$' },
        { code: 'EUR', name: '歐元', symbol: '€' },
        { code: 'JPY', name: '日圓', symbol: '¥' },
        { code: 'CNY', name: '人民幣', symbol: '¥' },
        { code: 'HKD', name: '港幣', symbol: 'HK$' },
        { code: 'KRW', name: '韓元', symbol: '₩' },
        { code: 'SGD', name: '新加坡元', symbol: 'S$' },
        { code: 'GBP', name: '英鎊', symbol: '£' },
        { code: 'AUD', name: '澳幣', symbol: 'A$' },
      ];
    }),
  }),

  // ============================================
  // Competitor Monitoring API
  // ============================================
  competitor: router({
    // Get all competitor tours with filters
    list: adminProcedure
      .input(z.object({
        competitor: z.string().optional(),
        scrapeStatus: z.string().optional(),
        search: z.string().optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        return db.getCompetitorTours(input ?? {});
      }),

    // Get a single competitor tour by ID with departures
    getById: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const tour = await db.getCompetitorTourById(input.id);
        if (!tour) throw new TRPCError({ code: "NOT_FOUND", message: "Competitor tour not found" });
        const departures = await db.getLatestDepartures(input.id);
        return { tour, departures };
      }),

    // Add a new competitor tour to monitor
    create: adminProcedure
      .input(z.object({
        competitor: z.enum(["liontravel", "colatour", "settour"]),
        tourUrl: z.string().url(),
        normGroupId: z.string().optional(),
        tourTitle: z.string().optional(),
        destination: z.string().optional(),
        duration: z.number().optional(),
        basePrice: z.number().optional(),
        scrapeFrequency: z.enum(["6h", "12h", "daily", "weekly"]).optional(),
        matchedTourId: z.number().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const tour = await db.createCompetitorTour({
          ...input,
          normGroupId: input.normGroupId ?? null,
          tourTitle: input.tourTitle ?? null,
          destination: input.destination ?? null,
          duration: input.duration ?? null,
          basePrice: input.basePrice ?? null,
          scrapeFrequency: input.scrapeFrequency ?? "daily",
          matchedTourId: input.matchedTourId ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
        });
        return tour;
      }),

    // Update a competitor tour
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        tourTitle: z.string().optional(),
        destination: z.string().optional(),
        duration: z.number().optional(),
        basePrice: z.number().optional(),
        scrapeFrequency: z.enum(["6h", "12h", "daily", "weekly"]).optional(),
        scrapeStatus: z.enum(["active", "paused", "error"]).optional(),
        matchedTourId: z.number().nullable().optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return db.updateCompetitorTour(id, data);
      }),

    // Delete a competitor tour
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteCompetitorTour(input.id);
        return { success: true };
      }),

    // Trigger manual scrape for a competitor tour
    triggerScrape: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const tour = await db.getCompetitorTourById(input.id);
        if (!tour) throw new TRPCError({ code: "NOT_FOUND", message: "Competitor tour not found" });
        
        const { addCompetitorMonitorJob } = await import("./queue");
        await addCompetitorMonitorJob({
          competitorTourId: tour.id,
          tourUrl: tour.tourUrl,
          competitor: tour.competitor,
          triggeredBy: "manual",
        });
        return { success: true, message: "Scrape job queued" };
      }),

    // Get price history for a competitor tour
    priceHistory: adminProcedure
      .input(z.object({
        competitorTourId: z.number(),
        departureDate: z.string().optional(),
        limit: z.number().optional(),
      }))
      .query(async ({ input }) => {
        return db.getPriceHistory(input.competitorTourId, input.departureDate, input.limit);
      }),

    // Get alerts with filters
    alerts: adminProcedure
      .input(z.object({
        competitorTourId: z.number().optional(),
        alertType: z.string().optional(),
        severity: z.string().optional(),
        isRead: z.boolean().optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        return db.getCompetitorAlerts(input ?? {});
      }),

    // Get unread alert count (for badge)
    unreadAlertCount: adminProcedure
      .query(async () => {
        return db.getUnreadAlertCount();
      }),

    // Mark alert as read
    markAlertRead: adminProcedure
      .input(z.object({ alertId: z.number() }))
      .mutation(async ({ input }) => {
        await db.markAlertAsRead(input.alertId);
        return { success: true };
      }),

    // Mark all alerts as read
    markAllAlertsRead: adminProcedure
      .mutation(async () => {
        await db.markAllAlertsAsRead();
        return { success: true };
      }),
  }),

  // ── Marketing Automation ─────────────────────────────────
  marketing: router({
    // List campaigns
    listCampaigns: adminProcedure
      .input(z.object({
        page: z.number().default(1),
        pageSize: z.number().default(20),
        status: z.enum(["draft", "scheduled", "sent", "cancelled"]).optional(),
      }))
      .query(async ({ input }) => {
        return db.getMarketingCampaigns(input);
      }),

    // Get single campaign
    getCampaign: adminProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        return db.getMarketingCampaignById(input.campaignId);
      }),

    // Create campaign
    createCampaign: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        type: z.enum(["social_post", "email_newsletter", "poster"]),
        tourId: z.number().optional(),
        subject: z.string().optional(),
        scheduledAt: z.number().optional(),
        metadata: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { tourId, scheduledAt, ...rest } = input;
        return db.createMarketingCampaign({ ...rest, createdBy: ctx.user.id });
      }),

    // Update campaign
    updateCampaign: adminProcedure
      .input(z.object({
        campaignId: z.number(),
        name: z.string().optional(),
        status: z.enum(["draft", "scheduled", "sent", "cancelled"]).optional(),
        subject: z.string().optional(),
        scheduledAt: z.number().optional(),
        metadata: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { campaignId, ...rawData } = input;
        const { scheduledAt, ...data } = rawData;
        return db.updateMarketingCampaign(campaignId, data);
      }),

    // Delete campaign
    deleteCampaign: adminProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteMarketingCampaign(input.campaignId);
        return { success: true };
      }),

    // Generate AI social copy
    generateCopy: adminProcedure
      .input(z.object({
        tourId: z.number(),
        platform: z.enum(["facebook", "instagram", "line"]),
        tone: z.enum(["professional", "casual", "exciting", "luxury"]).optional(),
        language: z.enum(["zh-TW", "en"]).optional(),
        campaignId: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { generateSocialCopy } = await import("./services/marketingCopyService");
        const result = await generateSocialCopy(input);
        if (input.campaignId) {
          await db.saveMarketingMaterial({
            campaignId: input.campaignId,
            tourId: input.tourId,
            type: `social_copy_${input.platform === 'facebook' ? 'fb' : input.platform === 'instagram' ? 'ig' : 'line'}`,
            content: JSON.stringify(result),
            createdBy: 0,
            metadata: JSON.stringify({ platform: input.platform, tone: input.tone }),
          });
        }
        return result;
      }),

    // Generate poster
    generatePoster: adminProcedure
      .input(z.object({
        tourId: z.number(),
        format: z.enum(["landscape", "square", "story"]),
        campaignId: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const tour = await db.getTourById(input.tourId);
        if (!tour) throw new TRPCError({ code: "NOT_FOUND", message: "Tour not found" });
        const { generatePoster } = await import("./services/posterGeneratorService");
        const result = await generatePoster({
          tourId: input.tourId,
          format: input.format,
          heroImageUrl: tour.heroImage || "",
          title: tour.title,
          // tour.destination is legacy nullable (schema v81); fall back
          // through canonical destinationCity (notNull) before empty string.
          destination: tour.destination ?? tour.destinationCity ?? "",
          duration: `${tour.duration}天${tour.duration - 1}夜`,
          price: `USD $${tour.price.toLocaleString()} 起`,
          highlights: JSON.parse(tour.highlights || "[]").slice(0, 3),
        });
        if (input.campaignId) {
          await db.saveMarketingMaterial({
            campaignId: input.campaignId,
            tourId: input.tourId,
            type: `poster_${input.format}`,
            imageUrl: result.s3Url,
            createdBy: 0,
            metadata: JSON.stringify({ format: input.format, width: result.width, height: result.height }),
          });
        }
        return { s3Url: result.s3Url, format: result.format, width: result.width, height: result.height };
      }),

    // Send newsletter
    sendNewsletter: adminProcedure
      .input(z.object({
        campaignId: z.number(),
        subject: z.string().min(1),
        htmlContent: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const subscribers = await db.getActiveSubscribers();
        const emails = subscribers.map((s) => s.email);
        if (emails.length === 0) return { success: true, sent: 0, failed: 0 };
        const { sendNewsletter } = await import("./services/emailMarketingService");
        const result = await sendNewsletter({
          campaignId: input.campaignId,
          subject: input.subject,
          htmlContent: input.htmlContent,
          subscribers: emails,
        });
        await db.updateMarketingCampaign(input.campaignId, { status: "sent" });
        return result;
      }),

    // List materials for a campaign
    listMaterials: adminProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        return db.getMarketingMaterials({ campaignId: input.campaignId });
      }),

    // Delete material
    deleteMaterial: adminProcedure
      .input(z.object({ materialId: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteMarketingMaterial(input.materialId);
        return { success: true };
      }),

    // Get subscriber stats
    subscriberStats: adminProcedure
      .query(async () => {
        const stats = await db.getSubscriberCount();
        return { active: stats.active, total: stats.total };
      }),

    // List email send logs
    emailLogs: adminProcedure
      .input(z.object({
        campaignId: z.number().optional(),
        page: z.number().default(1),
        pageSize: z.number().default(50),
      }))
      .query(async ({ input }) => {
        return db.getEmailSendLogs(input.campaignId ?? 0);
      }),
  }),

  // ══════════════════════════════════════════════════════════════
  // PHASE 6: 中國簽證代辦 tRPC 路由
  // ══════════════════════════════════════════════════════════════
  visa: router({
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
  affiliate: router({
    generateAffiliateLink: publicProcedure
      .input(z.object({
        type: z.enum(["flights", "hotels", "homepage"]),
        // Flight params
        origin: z.string().optional(),
        destination: z.string().optional(),
        departDate: z.string().optional(),
        returnDate: z.string().optional(),
        adults: z.number().min(1).max(9).optional(),
        children: z.number().min(0).max(9).optional(),
        infants: z.number().min(0).max(9).optional(),
        cabinClass: z.enum(['economy', 'premiumEconomy', 'business', 'first']).optional(),
        // Hotel params
        city: z.string().optional(),
        checkIn: z.string().optional(),
        checkOut: z.string().optional(),
        rooms: z.number().min(1).max(8).optional(),
        hotelAdults: z.number().min(1).max(6).optional(),
        hotelChildren: z.number().min(0).max(4).optional(),
        // Common
        ouid: z.string().optional(),
      }))
      .query(({ input }) => {
        let url: string;
        if (input.type === "flights") {
          url = generateFlightLink({
            origin: input.origin,
            destination: input.destination,
            departDate: input.departDate,
            returnDate: input.returnDate,
            ouid: input.ouid,
            adults: input.adults,
            children: input.children,
            infants: input.infants,
            cabinClass: input.cabinClass,
          });
        } else if (input.type === "hotels") {
          url = generateHotelLink({
            city: input.city,
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            ouid: input.ouid,
            rooms: input.rooms,
            adults: input.hotelAdults,
            children: input.hotelChildren,
          });
        } else {
          url = generateHomepageLink(input.ouid);
        }
        return { url };
      }),

    trackClick: publicProcedure
      .input(z.object({
        platform: z.enum(["trip_flights", "trip_hotels", "trip_homepage"]),
        targetUrl: z.string(),
        referrerPage: z.string().optional(),
        tourId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const req = (ctx as any).req;
        const ipAddress = req?.ip ?? req?.headers?.["x-forwarded-for"] ?? null;
        const userAgent = req?.headers?.["user-agent"] ?? null;
        await trackAffiliateClick({
          userId: ctx.user?.id,
          platform: input.platform,
          targetUrl: input.targetUrl,
          referrerPage: input.referrerPage,
          tourId: input.tourId,
          ipAddress: typeof ipAddress === "string" ? ipAddress : undefined,
          userAgent: typeof userAgent === "string" ? userAgent : undefined,
        });
        return { success: true };
      }),

    getStats: adminProcedure
      .input(z.object({ days: z.number().default(30) }))
      .query(async ({ input }) => {
        return db.getAffiliateStats(input.days);
      }),

    getClicks: adminProcedure
      .input(z.object({
        platform: z.string().optional(),
        limit: z.number().default(100),
      }))
      .query(async ({ input }) => {
        return db.getAffiliateClicks({ platform: input.platform, limit: input.limit });
      }),

    upsertPriceComparison: adminProcedure
      .input(z.object({
        tourId: z.number(),
        flightEstimate: z.number().optional(),
        hotelEstimate: z.number().optional(),
        activityEstimate: z.number().optional(),
        mealEstimate: z.number().optional(),
        transportEstimate: z.number().optional(),
        otherEstimate: z.number().optional(),
        flightSource: z.string().optional(),
        hotelSource: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const total = (input.flightEstimate ?? 0)
          + (input.hotelEstimate ?? 0)
          + (input.activityEstimate ?? 0)
          + (input.mealEstimate ?? 0)
          + (input.transportEstimate ?? 0)
          + (input.otherEstimate ?? 0);
        await db.upsertTourPriceComparison({
          ...input,
          totalSelfBook: total > 0 ? total : null,
          updatedBy: ctx.user.id,
        });
        return { success: true };
      }),

    getPriceComparisons: adminProcedure
      .query(async () => {
        return db.getAllPriceComparisons();
      }),

    deletePriceComparison: adminProcedure
      .input(z.object({ tourId: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteTourPriceComparison(input.tourId);
        return { success: true };
      }),

    getPriceComparison: publicProcedure
      .input(z.object({ tourId: z.number() }))
      .query(async ({ input }) => {
        return db.getTourPriceComparison(input.tourId);
      }),
  }),


  // Accounting router — Phase 4D extracted to ./routers/accounting.ts
  accounting: accountingRouter,

  // ──────────────────────────────────────────────────────────────────────────
  // v78: WeChat Assist — paste an inbound WeChat / 朋友圈 / LINE message,
  // AI drafts a reply in Jeff's voice, owner reviews/edits/approves.
  // Manual-paste mode works immediately; webhook mode lights up once Jeff
  // verifies his WeChat Official Account.
  // ──────────────────────────────────────────────────────────────────────────
  wechatAssist: router({
    // Admin pastes inbound message → gets AI draft back
    draftReply: adminProcedure
      .input(
        z.object({
          inboundText: z.string().min(1).max(5000),
          source: z.enum(["wechat_oa", "manual_paste", "moments_reply"]).default("manual_paste"),
          fromDisplayName: shortStr.optional(),
          fromOpenId: shortStr.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { draftReply } = await import("./services/wechatAssistService");
        const result = await draftReply(input);
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "wechat.draftReply",
          targetType: "wechatMessage",
          targetId: result.messageId || "n/a",
          changes: { source: input.source, intent: result.detectedIntent.join(",") },
        });
        return result;
      }),

    // List pending messages (status=ready_review)
    listPending: adminProcedure.query(async () => {
      const dbi = await db.getDb();
      if (!dbi) return [];
      const { wechatMessages } = await import("../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      return await dbi
        .select()
        .from(wechatMessages)
        .where(eq(wechatMessages.status, "ready_review" as any))
        .orderBy(desc(wechatMessages.receivedAt))
        .limit(50);
    }),

    // Approve / mark sent
    approve: adminProcedure
      .input(
        z.object({
          messageId: z.number().int().positive().max(2_147_483_647),
          finalText: mediumStr.min(1),
          markAsSent: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const dbi = await db.getDb();
        if (!dbi) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { wechatMessages } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await dbi
          .update(wechatMessages)
          .set({
            finalText: input.finalText,
            approvedAt: new Date(),
            sentAt: input.markAsSent ? new Date() : null,
            status: input.markAsSent ? "sent" : "approved",
          } as any)
          .where(eq(wechatMessages.id, input.messageId));

        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "wechat.approve",
          targetType: "wechatMessage",
          targetId: input.messageId,
          changes: { markAsSent: input.markAsSent },
        });
        return { success: true };
      }),

    // Mark as skipped (don't reply)
    skip: adminProcedure
      .input(z.object({ messageId: z.number().int().positive().max(2_147_483_647) }))
      .mutation(async ({ ctx, input }) => {
        const dbi = await db.getDb();
        if (!dbi) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { wechatMessages } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await dbi
          .update(wechatMessages)
          .set({ status: "skipped" as any })
          .where(eq(wechatMessages.id, input.messageId));
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "wechat.skip",
          targetType: "wechatMessage",
          targetId: input.messageId,
        });
        return { success: true };
      }),
  }),

  // ──────────────────────────────────────────────────────────────────────────
  // v78g: R2 storage healthcheck. Diagnostic so admin can verify R2 setup
  // after fixing the bucket in Cloudflare. Returns precise reason on failure.
  // ──────────────────────────────────────────────────────────────────────────
  // v78n Sprint 6B: AI marketing content generator (admin)
  marketingContent: router({
    generateWeekly: adminProcedure
      .input(
        z.object({
          topN: z.number().int().min(1).max(5).default(3),
          language: z.enum(["zh-TW", "en"]).default("zh-TW"),
          platforms: z
            .array(z.enum(["instagram", "facebook", "xiaohongshu"]))
            .default(["instagram", "facebook", "xiaohongshu"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { generateWeeklySocialPosts } = await import(
          "./services/marketingContentService"
        );
        const drafts = await generateWeeklySocialPosts(
          input.topN,
          input.language,
          input.platforms
        );
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "marketing.generateWeekly",
          targetType: "system",
          targetId: 0,
          changes: { drafts: drafts.length, language: input.language },
        });
        return { drafts };
      }),
  }),

  // v78m Sprint 5A: trigger the daily digest manually (admin)
  ops: router({
    /**
     * v78p: Flush translation cache + re-translate all active tours.
     * Use after fixing translator bugs (e.g. maxTokens too low). One-shot
     * script — safe to call multiple times, queue dedup handles concurrency.
     *
     * Returns: { flushedCacheKeys, translationsDeleted, queuedJobs, tourIds }
     */
    rerunAllTourTranslations: adminProcedure.mutation(async ({ ctx }) => {
      const { redis } = await import("./redis");
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // 1. Flush all translation:* cache keys (forces fresh LLM calls)
      let flushedCount = 0;
      try {
        // SCAN through the keyspace, deleting in batches
        let cursor = "0";
        do {
          const reply = await (redis as any).scan(cursor, "MATCH", "translate:*", "COUNT", 500);
          cursor = reply[0];
          const keys = reply[1] || [];
          if (keys.length > 0) {
            await (redis as any).del(...keys);
            flushedCount += keys.length;
          }
        } while (cursor !== "0");
      } catch (err) {
        console.warn("[rerunTranslations] cache flush failed (non-fatal):", (err as Error).message);
      }

      // 2. Delete existing translation rows for active tours so the worker re-saves fresh ones
      const { tours, translations } = await import("../drizzle/schema");
      const { eq, and, inArray } = await import("drizzle-orm");
      const activeTours = await drizzleDb
        .select({ id: tours.id })
        .from(tours)
        .where(eq(tours.status, "active" as any));
      const ids = activeTours.map((t: any) => t.id);
      let deleted = 0;
      if (ids.length > 0) {
        const r = await drizzleDb
          .delete(translations)
          .where(and(eq(translations.entityType, "tour"), inArray(translations.entityId, ids)));
        deleted = (r as any).affectedRows ?? 0;
      }

      // 3. Queue re-translation jobs (sequential, not parallel — Anthropic rate limits)
      const { addTourTranslationJob } = await import("./queue");
      const queued: number[] = [];
      for (const id of ids) {
        try {
          await addTourTranslationJob({
            tourId: id,
            targetLanguages: ["en"],
            sourceLanguage: "zh-TW",
            userId: ctx.user?.id || 1,
          });
          queued.push(id);
        } catch (err) {
          console.warn(`[rerunTranslations] queue failed for tour ${id}:`, (err as Error).message);
        }
      }

      const { audit } = await import("./_core/auditLog");
      audit({
        ctx,
        action: "ops.translations.rerunAll",
        targetType: "system",
        targetId: 0,
        changes: { flushedCacheKeys: flushedCount, translationsDeleted: deleted, queuedJobs: queued.length },
      });

      return {
        flushedCacheKeys: flushedCount,
        translationsDeleted: deleted,
        queuedJobs: queued.length,
        tourIds: queued,
      };
    }),

    sendDailyDigestNow: adminProcedure.mutation(async ({ ctx }) => {
      const { runDailyDigestJob } = await import("./services/dailyDigestService");
      const result = await runDailyDigestJob();
      const { audit } = await import("./_core/auditLog");
      audit({
        ctx,
        action: "ops.dailyDigest.manualTrigger",
        targetType: "system",
        targetId: 0,
        changes: { sent: result.sent },
      });
      return {
        sent: result.sent,
        summary: result.data
          ? {
              pendingWechat: result.data.pendingWechat.length,
              quotesToFollowUp: result.data.newQuotesToFollowUp.length,
              newInquiries: result.data.newInquiries,
              newQuotes24h: result.data.newQuotesCount,
              newBookings24h: result.data.newBookingsCount,
              revenue24h: result.data.revenue24h,
            }
          : null,
      };
    }),
  }),

  storage: router({
    healthcheck: adminProcedure.query(async () => {
      const { storagePut, storageGet } = await import("./storage");
      const { ENV } = await import("./_core/env");
      const result: any = {
        bucket: ENV.r2Bucket,
        endpoint: ENV.r2Endpoint,
        publicBaseUrl: ENV.r2PublicBaseUrl || null,
        put: { ok: false, error: null as string | null, key: null as string | null },
        get: { ok: false, error: null as string | null, url: null as string | null },
      };
      const probeKey = `healthcheck/probe-${Date.now()}.txt`;
      try {
        const put = await storagePut(probeKey, Buffer.from("ok", "utf-8"), "text/plain");
        result.put.ok = true;
        result.put.key = put.key;
      } catch (err: any) {
        result.put.error = `${err?.name || "Error"}: ${err?.message?.slice(0, 200) || String(err).slice(0, 200)}`;
      }
      if (result.put.ok) {
        try {
          const get = await storageGet(probeKey);
          result.get.ok = true;
          result.get.url = get.url;
        } catch (err: any) {
          result.get.error = `${err?.name || "Error"}: ${err?.message?.slice(0, 200) || ""}`;
        }
      }
      result.summary = result.put.ok && result.get.ok
        ? "R2 storage is fully operational"
        : `R2 broken — fix: ${result.put.error || result.get.error}`;
      return result;
    }),
  }),

  // ──────────────────────────────────────────────────────────────────────────
  // v78: Auto Reconciliation — single dashboard that joins internal payments,
  // Stripe live ledger, and accounting entries to spot discrepancies.
  // Replaces ~2 hours of monthly close pain for a 1-person ops.
  // ──────────────────────────────────────────────────────────────────────────
  reconciliation: router({
    runReport: adminProcedure
      .input(
        z.object({
          // ISO dates: defaults to current month
          start: z.string().date().optional(),
          end: z.string().date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const now = new Date();
        const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        const start = input.start ? new Date(input.start) : defaultStart;
        const end = input.end ? new Date(input.end) : defaultEnd;

        const { runReconciliation } = await import("./services/reconciliationService");
        const report = await runReconciliation(start, end);

        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "reconciliation.run",
          targetType: "report",
          targetId: `${start.toISOString().slice(0,10)}_${end.toISOString().slice(0,10)}`,
          changes: {
            discrepancies: report.discrepancies.length,
            netProfit: report.pnl.netProfit,
          },
        });

        return report;
      }),
  }),

  // ──────────────────────────────────────────────────────────────────────────
  // v78: AI Quote Generator — customer free-form intent → matched tours →
  // PDF quote in ~30 seconds.  Replaces 1 hour of manual quoting per request,
  // so a 1-person operation can scale to 50+ quotes/day.
  // ──────────────────────────────────────────────────────────────────────────
  // v78z-z3 Sprint 11 (Image 2.0 Phase A v1): full ChatGPT-in-admin poster
  // composer. Free-form prompt + reference image library + iteration history
  // + edit endpoint for "fix this" loops. Replaces v0 templated tour-spotlight.
  posterGen: router({
    /**
     * Upload a reference asset (logo / photo / past poster / scene ref) to
     * the marketingAssets library. Asset is base64-encoded in the request
     * for simplicity (max ~5 MB; chunked upload is Phase B).
     */
    uploadReference: adminProcedure
      .input(
        z.object({
          kind: z.enum(["logo", "photo", "past_poster", "scene_ref"]),
          label: z.string().min(1).max(200),
          mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
          base64Data: z.string().max(7_500_000), // ~5MB after base64 expansion
          notes: z.string().max(1000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { storagePut } = await import("./storage");
        const { marketingAssets } = await import("../drizzle/schema");
        const { TRPCError } = await import("@trpc/server");
        const sharpMod = (await import("sharp")).default;
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        const buf = Buffer.from(input.base64Data, "base64");
        const meta = await sharpMod(buf).metadata();

        const ext = input.mimeType === "image/png" ? "png" : input.mimeType === "image/webp" ? "webp" : "jpg";
        const ts = Date.now();
        const safeLabel = input.label.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 40);
        const key = `marketing-assets/${input.kind}/${ts}-${safeLabel}.${ext}`;
        await storagePut(key, buf, input.mimeType);

        const [insertResult] = await drizzleDb.insert(marketingAssets).values({
          ownerId: ctx.user?.id ?? null,
          kind: input.kind,
          label: input.label,
          storageKey: key,
          width: meta.width ?? null,
          height: meta.height ?? null,
          fileSize: buf.length,
          mimeType: input.mimeType,
          notes: input.notes ?? null,
        } as any) as any;

        return {
          id: Number(insertResult?.insertId ?? 0),
          storageKey: key,
        };
      }),

    /** List reference assets, optionally filtered by kind. */
    listReferences: adminProcedure
      .input(z.object({ kind: z.enum(["logo", "photo", "past_poster", "scene_ref", "all"]).default("all") }))
      .query(async ({ input }) => {
        const { marketingAssets } = await import("../drizzle/schema");
        const { eq, desc } = await import("drizzle-orm");
        const { storageGet } = await import("./storage");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return [];
        let rows;
        if (input.kind === "all") {
          rows = await drizzleDb.select().from(marketingAssets).orderBy(desc(marketingAssets.createdAt)).limit(100);
        } else {
          rows = await drizzleDb
            .select()
            .from(marketingAssets)
            .where(eq(marketingAssets.kind, input.kind))
            .orderBy(desc(marketingAssets.createdAt))
            .limit(100);
        }
        // Surface signed URLs for previewing in admin
        return Promise.all(
          rows.map(async (r: any) => ({
            id: r.id,
            kind: r.kind,
            label: r.label,
            width: r.width,
            height: r.height,
            mimeType: r.mimeType,
            createdAt: r.createdAt,
            url: (await storageGet(r.storageKey)).url,
          }))
        );
      }),

    /** Delete a reference asset (R2 file kept; can be GC'd later). */
    deleteReference: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const { marketingAssets } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { ok: false };
        await drizzleDb.delete(marketingAssets).where(eq(marketingAssets.id, input.id));
        return { ok: true };
      }),

    /**
     * Generate or iterate. Two modes:
     *
     * generate (no parentIterationId):
     *   prompt → gpt-image-2 generate → optional Sharp lock → R2 → DB
     *
     * edit (with parentIterationId):
     *   load parent's image from R2 → gpt-image-2 edit with prompt → ...
     */
    generate: adminProcedure
      .input(
        z.object({
          projectKey: z.string().min(1).max(64),
          prompt: z.string().min(10).max(4000),
          quality: z.enum(["low", "medium", "high"]).default("medium"),
          size: z.enum(["1024x1024", "1024x1792", "1792x1024", "2048x2048"]).default("1024x1792"),
          parentIterationId: z.number().int().positive().optional(),
          referenceAssetIds: z.array(z.number().int().positive()).max(8).default([]),
          lockBranding: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { composePoster } = await import("./services/posterCompositeService");
        const { posterIterations, posterGenLogs } = await import("../drizzle/schema");
        const { eq, gte, sql, and } = await import("drizzle-orm");
        const { TRPCError } = await import("@trpc/server");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        // Soft daily budget guard: refuse if today's spend > $10 (raised from
        // v0's $5 since high quality + iteration burns more)
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const [todaySpendRow] = await drizzleDb
          .select({ total: sql<string>`COALESCE(SUM(CAST(${posterIterations.costUsd} AS DECIMAL(10,4))), 0)` })
          .from(posterIterations)
          .where(and(eq(posterIterations.status, "success"), gte(posterIterations.createdAt, startOfToday)));
        const todaySpend = Number(todaySpendRow?.total ?? 0);
        if (todaySpend > 10.0) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `Daily image-gen budget exceeded ($${todaySpend.toFixed(2)} / $10.00). Try again tomorrow.`,
          });
        }

        // If iterating, load the parent iteration to get its base image key
        let baseImageKey: string | undefined;
        if (input.parentIterationId) {
          const [parent] = await drizzleDb
            .select()
            .from(posterIterations)
            .where(eq(posterIterations.id, input.parentIterationId))
            .limit(1);
          if (!parent) throw new TRPCError({ code: "NOT_FOUND", message: "Parent iteration not found" });
          baseImageKey = (parent as any).storageKey;
          if (!baseImageKey) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Parent iteration has no image" });
        }

        try {
          const result = await composePoster({
            prompt: input.prompt,
            size: input.size,
            quality: input.quality,
            lockBranding: input.lockBranding,
            baseImageKey,
          });

          const [insertResult] = (await drizzleDb.insert(posterIterations).values({
            projectKey: input.projectKey,
            parentIterationId: input.parentIterationId ?? null,
            ownerId: ctx.user?.id ?? null,
            prompt: input.prompt,
            mode: result.mode,
            size: input.size,
            quality: input.quality,
            costUsd: result.cost.toFixed(4),
            durationMs: result.durationMs,
            storageKey: result.storageKey,
            status: "success",
            referenceAssetIds: JSON.stringify(input.referenceAssetIds),
          } as any)) as any;

          return {
            iterationId: Number(insertResult?.insertId ?? 0),
            posterUrl: result.posterUrl,
            storageKey: result.storageKey,
            costUsd: result.cost,
            durationMs: result.durationMs,
            mode: result.mode,
          };
        } catch (err) {
          await drizzleDb.insert(posterIterations).values({
            projectKey: input.projectKey,
            parentIterationId: input.parentIterationId ?? null,
            ownerId: ctx.user?.id ?? null,
            prompt: input.prompt,
            mode: input.parentIterationId ? "edit" : "generate",
            size: input.size,
            quality: input.quality,
            costUsd: "0",
            durationMs: 0,
            status: "errored",
            errorMessage: (err as Error).message?.slice(0, 1000) || "Unknown error",
            referenceAssetIds: JSON.stringify(input.referenceAssetIds),
          } as any);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Poster compose failed: ${(err as Error).message}`,
          });
        }
      }),

    /** List iterations for a given project, ordered chronologically. */
    listIterations: adminProcedure
      .input(z.object({ projectKey: z.string().min(1).max(64) }))
      .query(async ({ input }) => {
        const { posterIterations } = await import("../drizzle/schema");
        const { eq, asc } = await import("drizzle-orm");
        const { storageGet } = await import("./storage");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return [];
        const rows = await drizzleDb
          .select()
          .from(posterIterations)
          .where(eq(posterIterations.projectKey, input.projectKey))
          .orderBy(asc(posterIterations.createdAt));
        return Promise.all(
          rows.map(async (r: any) => ({
            id: r.id,
            parentIterationId: r.parentIterationId,
            prompt: r.prompt,
            mode: r.mode,
            quality: r.quality,
            size: r.size,
            costUsd: Number(r.costUsd),
            durationMs: r.durationMs,
            status: r.status,
            errorMessage: r.errorMessage,
            createdAt: r.createdAt,
            url: r.storageKey ? (await storageGet(r.storageKey)).url : null,
          }))
        );
      }),

    /** Cost surface — combines v0 posterGenLogs + v1 posterIterations. */
    getCostStatus: adminProcedure.query(async () => {
      const { posterIterations } = await import("../drizzle/schema");
      const { sql, gte, eq, and, desc } = await import("drizzle-orm");
      const drizzleDb = await db.getDb();
      if (!drizzleDb) return { todaySpend: 0, monthSpend: 0, todayCount: 0, monthCount: 0, dailyBudget: 10, monthlyBudget: 100, recentLogs: [] };
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const [today] = await drizzleDb.select({
        total: sql<string>`COALESCE(SUM(CAST(${posterIterations.costUsd} AS DECIMAL(10,4))), 0)`,
        n: sql<string>`COUNT(*)`,
      }).from(posterIterations).where(and(eq(posterIterations.status, "success"), gte(posterIterations.createdAt, startOfToday)));
      const [month] = await drizzleDb.select({
        total: sql<string>`COALESCE(SUM(CAST(${posterIterations.costUsd} AS DECIMAL(10,4))), 0)`,
        n: sql<string>`COUNT(*)`,
      }).from(posterIterations).where(and(eq(posterIterations.status, "success"), gte(posterIterations.createdAt, startOfMonth)));
      const recent = await drizzleDb.select().from(posterIterations).orderBy(desc(posterIterations.createdAt)).limit(10);
      return {
        todaySpend: Number(today?.total ?? 0),
        todayCount: Number(today?.n ?? 0),
        monthSpend: Number(month?.total ?? 0),
        monthCount: Number(month?.n ?? 0),
        dailyBudget: 10.0,
        monthlyBudget: 100.0,
        recentLogs: recent.map((r: any) => ({
          id: r.id,
          projectKey: r.projectKey,
          mode: r.mode,
          quality: r.quality,
          costUsd: Number(r.costUsd),
          status: r.status,
          createdAt: r.createdAt,
        })),
      };
    }),
  }),

  aiQuotes: router({
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
          await import("./services/aiQuoteService");

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
          const { ENV } = await import("./_core/env");
          const base = ENV.baseUrl || "https://packgo-travel.fly.dev";
          finalPdfUrl = `${base.replace(/\/+$/, "")}/api/aiQuotes/${inserted.id}/view`;
          // Update the row so adminList / external links see the resolvable URL
          await db.updateAiQuote(inserted.id, { pdfUrl: finalPdfUrl } as any);
        }

        // v78l Sprint 4B: schedule 24h/3d/7d follow-up emails (no-op if no email)
        if (inserted?.id && input.customerEmail) {
          try {
            const { scheduleQuoteFollowUps } = await import("./queues/quoteFollowUpQueue");
            await scheduleQuoteFollowUps(inserted.id, input.customerEmail);
          } catch (err) {
            console.warn("[aiQuotes.generate] Failed to schedule follow-ups:", (err as Error).message);
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
          const { cancelQuoteFollowUps } = await import("./queues/quoteFollowUpQueue");
          await cancelQuoteFollowUps(input.quoteId);
        } catch {}
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "aiQuote.markConverted",
          targetType: "aiQuote",
          targetId: input.quoteId,
          changes: { bookingId: input.bookingId },
        });
        return { success: true };
      }),
  }),

  invoices: router({
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
          const { ENV } = await import("./_core/env");
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
          const { ENV } = await import("./_core/env");
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
  }),

  recurringExpenses: router({
    // List recurring expenses
    list: adminProcedure.query(async () => {
      return db.getRecurringExpenses();
    }),

    // Create recurring expense template
    create: adminProcedure
      .input(z.object({
        name: z.string(),
        category: z.string(),
        amount: z.number().positive(),
        currency: z.string().default("TWD"),
        frequency: z.enum(["monthly", "quarterly", "yearly"]),
        nextDueDate: z.date(),
        isTaxDeductible: z.boolean().default(false),
        taxCategory: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return db.createRecurringExpense({
          description: input.name,
          category: input.category,
          amount: String(input.amount),
          currency: input.currency,
          frequency: input.frequency,
          dayOfMonth: new Date(input.nextDueDate).getDate(),
          isTaxDeductible: input.isTaxDeductible ? 1 : 0,
          taxCategory: input.taxCategory,
          createdBy: ctx.user.id,
        });
      }),

    // Update recurring expense
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        category: z.string().optional(),
        amount: z.number().positive().optional(),
        currency: z.string().optional(),
        frequency: z.enum(["monthly", "quarterly", "yearly"]).optional(),
        nextDueDate: z.date().optional(),
        isActive: z.boolean().optional(),
        isTaxDeductible: z.boolean().optional(),
        taxCategory: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...updates } = input;
        const mapped: Record<string, unknown> = { ...updates };
        if (updates.amount !== undefined) mapped.amount = String(updates.amount);
        if (updates.isTaxDeductible !== undefined) mapped.isTaxDeductible = updates.isTaxDeductible ? 1 : 0;
        if (updates.isActive !== undefined) mapped.isActive = updates.isActive ? 1 : 0;
        if ((updates as any).name !== undefined) { mapped.description = (updates as any).name; delete mapped.name; }
        if ((updates as any).nextDueDate !== undefined) { mapped.dayOfMonth = new Date((updates as any).nextDueDate).getDate(); delete mapped.nextDueDate; }
        return db.updateRecurringExpense(id, mapped);
      }),

    // Delete recurring expense
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteRecurringExpense(input.id);
        return { success: true };
      }),

    // Apply (generate accounting entry from) a recurring expense
    applyExpense: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const expense = await db.getRecurringExpenseById(input.id);
        if (!expense) throw new TRPCError({ code: "NOT_FOUND", message: "定期支出不存在" });
        const entry = await db.createAccountingEntry({
          entryType: "expense",
          category: expense.category as any,
          amount: expense.amount,
          currency: expense.currency,
          description: `[定期] ${expense.description}`,
          entryDate: new Date(),
          isTaxDeductible: expense.isTaxDeductible,
          taxCategory: expense.taxCategory ?? undefined,
          createdBy: ctx.user.id,
        });
        // Compute next due date from dayOfMonth
        const now = new Date();
        const nextDue = new Date(now.getFullYear(), now.getMonth(), expense.dayOfMonth ?? 1);
        if (expense.frequency === "monthly") nextDue.setMonth(nextDue.getMonth() + 1);
        else if (expense.frequency === "quarterly") nextDue.setMonth(nextDue.getMonth() + 3);
        else if (expense.frequency === "yearly") nextDue.setFullYear(nextDue.getFullYear() + 1);
        await db.updateRecurringExpense(input.id, { lastGeneratedAt: new Date() });
        return { entry, nextDueDate: nextDue };
      }),
  }),

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
  posters: router({
    /**
     * Admin: kick off processing on a freshly-uploaded raw poster.
     * Caller must have ALREADY uploaded the image to S3 via /api/upload/image
     * and obtained the URL (same flow as other admin image uploads).
     */
    create: adminProcedure
      .input(
        z.object({
          originalImageUrl: z.string().url().max(1024),
          originalCopyText: z.string().max(10_000).optional(),
          // Session B simplification: vendor + audience are rarely supplied
          // by Jeff — the AI infers them from the poster. Defaults let the
          // composer ship just (image, copy) without forcing dropdowns.
          sourceVendor: z
            .enum(["lion", "zongheng", "house", "other"])
            .default("other"),
          targetAudience: z
            .enum(["family", "honeymoon", "parent_child", "business", "senior", "general"])
            .default("general"),
          title: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { posterAssets } = await import("../drizzle/schema");

        const result = await drizzleDb.insert(posterAssets).values({
          sourceVendor: input.sourceVendor,
          targetAudience: input.targetAudience,
          originalImageUrl: input.originalImageUrl,
          originalCopyText: input.originalCopyText ?? null,
          title: input.title ?? null,
          status: "uploaded",
          createdBy: ctx.user.id,
        });
        const posterAssetId = (result as any)[0]?.insertId ?? 0;

        // Enqueue async processing (returns immediately, ~30s in background)
        try {
          const { enqueuePosterProcessing } = await import(
            "./queues/posterProcessingQueue"
          );
          await enqueuePosterProcessing(posterAssetId);
        } catch (err) {
          console.error("[posters.create] Failed to enqueue:", err);
          // Mark failed so admin knows
          const { eq } = await import("drizzle-orm");
          await drizzleDb
            .update(posterAssets)
            .set({ status: "failed", notes: "Failed to enqueue processing" })
            .where(eq(posterAssets.id, posterAssetId));
        }

        return { id: posterAssetId };
      }),

    /** Admin: list posters (most recent first) with status filter. */
    list: adminProcedure
      .input(
        z.object({
          status: z
            .enum([
              "uploaded",
              "processing",
              "ready",
              "approved",
              "distributed",
              "archived",
              "failed",
              "all",
            ])
            .default("all"),
          limit: z.number().int().positive().max(100).default(30),
          cursor: z.number().int().optional(),
        })
      )
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { items: [], nextCursor: null };
        const { posterAssets } = await import("../drizzle/schema");
        const { eq, and, lt, desc } = await import("drizzle-orm");
        const filters = [];
        if (input.status !== "all") filters.push(eq(posterAssets.status, input.status));
        if (input.cursor) filters.push(lt(posterAssets.id, input.cursor));
        const whereClause = filters.length ? and(...filters) : undefined;
        const rows = await drizzleDb
          .select()
          .from(posterAssets)
          .where(whereClause)
          .orderBy(desc(posterAssets.id))
          .limit(input.limit + 1);
        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
      }),

    /** Admin: get one poster + its 7 platform copies. Used for review page. */
    get: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return null;
        const { posterAssets, posterPlatformCopies } = await import(
          "../drizzle/schema"
        );
        const { eq } = await import("drizzle-orm");
        const [poster] = await drizzleDb
          .select()
          .from(posterAssets)
          .where(eq(posterAssets.id, input.id))
          .limit(1);
        if (!poster) return null;
        const copies = await drizzleDb
          .select()
          .from(posterPlatformCopies)
          .where(eq(posterPlatformCopies.posterAssetId, input.id));
        return { poster, copies };
      }),

    /** Admin: update a single platform copy (edit text or hashtags). */
    updateCopy: adminProcedure
      .input(
        z.object({
          copyId: z.number().int().positive(),
          copyText: z.string().max(10_000).optional(),
          hashtags: z.string().max(2000).nullable().optional(),
          status: z.enum(["draft", "approved", "posted", "skipped"]).optional(),
          postedUrl: z.string().max(1024).nullable().optional(),
          notes: z.string().max(1000).nullable().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { posterPlatformCopies } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const updates: any = {};
        if (input.copyText !== undefined) updates.copyText = input.copyText;
        if (input.hashtags !== undefined) updates.hashtags = input.hashtags;
        if (input.status !== undefined) {
          updates.status = input.status;
          if (input.status === "posted") updates.postedAt = new Date();
        }
        if (input.postedUrl !== undefined) updates.postedUrl = input.postedUrl;
        if (input.notes !== undefined) updates.notes = input.notes;
        await drizzleDb
          .update(posterPlatformCopies)
          .set(updates)
          .where(eq(posterPlatformCopies.id, input.copyId));
        return { ok: true };
      }),

    /** Admin: regenerate the AI poster image (call gpt-image-2 again). */
    regenerateImage: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { posterAssets } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await drizzleDb
          .update(posterAssets)
          .set({ status: "processing" })
          .where(eq(posterAssets.id, input.id));
        const { enqueuePosterProcessing } = await import(
          "./queues/posterProcessingQueue"
        );
        await enqueuePosterProcessing(input.id);
        return { ok: true };
      }),

    /** Admin: archive a poster (no longer surface in active queue). */
    archive: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { posterAssets } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await drizzleDb
          .update(posterAssets)
          .set({ status: "archived" })
          .where(eq(posterAssets.id, input.id));
        return { ok: true };
      }),

    /** Admin: mark whole poster as approved (all copies considered ready). */
    approve: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { posterAssets, posterPlatformCopies } = await import(
          "../drizzle/schema"
        );
        const { eq, and } = await import("drizzle-orm");
        await drizzleDb.transaction(async (tx) => {
          await tx
            .update(posterAssets)
            .set({ status: "approved" })
            .where(eq(posterAssets.id, input.id));
          // Promote all draft copies to approved (skip ones already 'posted'/'skipped')
          await tx
            .update(posterPlatformCopies)
            .set({ status: "approved" })
            .where(
              and(
                eq(posterPlatformCopies.posterAssetId, input.id),
                eq(posterPlatformCopies.status, "draft")
              )
            );
        });
        return { ok: true };
      }),
  }),

  reviews: router({
    /**
     * Public list of approved reviews for a given tour (or all tours if
     * tourId is omitted). Used by TourDetail page + TestimonialsCarousel
     * on Home. Hidden / pending / rejected never surface here.
     */
    listVerified: publicProcedure
      .input(
        z
          .object({
            tourId: z.number().int().positive().optional(),
            limit: z.number().int().positive().max(50).default(10),
          })
          .optional()
      )
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return [];
        const { tourReviews, users: usersTable, tours: toursTable } = await import(
          "../drizzle/schema"
        );
        const { eq, and, desc } = await import("drizzle-orm");

        const conditions = input?.tourId
          ? and(eq(tourReviews.status, "approved"), eq(tourReviews.tourId, input.tourId))
          : eq(tourReviews.status, "approved");

        const rows = await drizzleDb
          .select({
            id: tourReviews.id,
            tourId: tourReviews.tourId,
            tourTitle: toursTable.title,
            rating: tourReviews.rating,
            title: tourReviews.title,
            content: tourReviews.content,
            photos: tourReviews.photos,
            language: tourReviews.language,
            publishedAt: tourReviews.publishedAt,
            authorName: usersTable.name,
            authorAvatar: usersTable.avatar,
          })
          .from(tourReviews)
          .leftJoin(usersTable, eq(tourReviews.userId, usersTable.id))
          .leftJoin(toursTable, eq(tourReviews.tourId, toursTable.id))
          .where(conditions)
          .orderBy(desc(tourReviews.publishedAt))
          .limit(input?.limit ?? 10);

        return rows;
      }),

    /**
     * List the current user's own reviews — surfaces draft/pending status
     * so they know what's awaiting moderation.
     */
    myReviews: protectedProcedure.query(async ({ ctx }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) return [];
      const { tourReviews, tours: toursTable } = await import("../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      return await drizzleDb
        .select({
          id: tourReviews.id,
          tourId: tourReviews.tourId,
          tourTitle: toursTable.title,
          bookingId: tourReviews.bookingId,
          rating: tourReviews.rating,
          title: tourReviews.title,
          content: tourReviews.content,
          status: tourReviews.status,
          rejectionReason: tourReviews.rejectionReason,
          createdAt: tourReviews.createdAt,
          publishedAt: tourReviews.publishedAt,
        })
        .from(tourReviews)
        .leftJoin(toursTable, eq(tourReviews.tourId, toursTable.id))
        .where(eq(tourReviews.userId, ctx.user.id))
        .orderBy(desc(tourReviews.createdAt));
    }),

    /**
     * Submit a review for a completed booking. Server validates:
     *   - Booking belongs to the user
     *   - Booking is 'completed' (not pending/cancelled)
     *   - No existing review for this booking (UNIQUE constraint backs this)
     * The review enters the moderation queue; +50 Packpoint is paid out
     * when the admin approves.
     */
    create: protectedProcedure
      .input(
        z.object({
          bookingId: z.number().int().positive(),
          rating: z.number().int().min(1).max(5),
          title: z.string().trim().min(3).max(200),
          content: z.string().trim().min(10).max(5000),
          photos: z.array(z.string().url()).max(10).optional(),
          language: z.enum(["zh-TW", "en"]).default("zh-TW"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const booking = await db.getBookingById(input.bookingId);
        if (!booking) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }
        if ((booking as any).userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
        }
        if (booking.bookingStatus !== "completed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "您只能在行程完成後才能評論此筆訂單",
          });
        }

        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tourReviews } = await import("../drizzle/schema");

        try {
          const result = await drizzleDb.insert(tourReviews).values({
            userId: ctx.user.id,
            tourId: booking.tourId,
            bookingId: input.bookingId,
            rating: input.rating,
            title: input.title,
            content: input.content,
            photos: input.photos ? JSON.stringify(input.photos) : null,
            language: input.language,
            status: "pending",
          });
          return { ok: true, status: "pending" as const };
        } catch (err: any) {
          if (/Duplicate entry/i.test(err?.message || "")) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "您已經評論過此行程 / You already reviewed this tour",
            });
          }
          throw err;
        }
      }),

    /**
     * Round 80.25 — open commenting on tour reviews.
     * Logged-in users can submit reviews/comments without a prior booking.
     * The compound UNIQUE on (userId, tourId) prevents one user from
     * spam-flooding a single tour. All entries enter the moderation queue
     * and only surface on TourDetail after admin approval.
     */
    createPublic: protectedProcedure
      .input(
        z.object({
          tourId: z.number().int().positive(),
          rating: z.number().int().min(1).max(5),
          title: z.string().trim().min(3).max(200),
          content: z.string().trim().min(10).max(5000),
          photos: z.array(z.string().url()).max(10).optional(),
          language: z.enum(["zh-TW", "en"]).default("zh-TW"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const tour = await db.getTourById(input.tourId);
        if (!tour) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tour not found" });
        }
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tourReviews } = await import("../drizzle/schema");
        try {
          await drizzleDb.insert(tourReviews).values({
            userId: ctx.user.id,
            tourId: input.tourId,
            bookingId: null,
            rating: input.rating,
            title: input.title,
            content: input.content,
            photos: input.photos ? JSON.stringify(input.photos) : null,
            language: input.language,
            status: "pending",
          });
          return { ok: true, status: "pending" as const };
        } catch (err: any) {
          if (/Duplicate entry/i.test(err?.message || "")) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "您已經評論過此行程 / You already reviewed this tour",
            });
          }
          throw err;
        }
      }),

    /**
     * Admin: paginated review queue with filter by status.
     */
    adminList: adminProcedure
      .input(
        z.object({
          status: z.enum(["pending", "approved", "rejected", "hidden", "all"]).default("all"),
          limit: z.number().int().positive().max(100).default(50),
          cursor: z.number().int().optional(),
        })
      )
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { items: [], nextCursor: null };
        const { tourReviews, users: usersTable, tours: toursTable } = await import(
          "../drizzle/schema"
        );
        const { eq, and, lt, desc } = await import("drizzle-orm");

        const filters = [];
        if (input.status !== "all") filters.push(eq(tourReviews.status, input.status));
        if (input.cursor) filters.push(lt(tourReviews.id, input.cursor));
        const whereClause = filters.length ? and(...filters) : undefined;

        const rows = await drizzleDb
          .select({
            id: tourReviews.id,
            userId: tourReviews.userId,
            authorName: usersTable.name,
            authorEmail: usersTable.email,
            tourId: tourReviews.tourId,
            tourTitle: toursTable.title,
            bookingId: tourReviews.bookingId,
            rating: tourReviews.rating,
            title: tourReviews.title,
            content: tourReviews.content,
            photos: tourReviews.photos,
            language: tourReviews.language,
            status: tourReviews.status,
            rejectionReason: tourReviews.rejectionReason,
            createdAt: tourReviews.createdAt,
            publishedAt: tourReviews.publishedAt,
          })
          .from(tourReviews)
          .leftJoin(usersTable, eq(tourReviews.userId, usersTable.id))
          .leftJoin(toursTable, eq(tourReviews.tourId, toursTable.id))
          .where(whereClause)
          .orderBy(desc(tourReviews.id))
          .limit(input.limit + 1);

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1].id : null;
        return { items, nextCursor };
      }),

    /**
     * Admin: approve a review. Awards +50 Packpoint to the author IFF
     * this is the first time we approved it (idempotent via status check).
     */
    adminApprove: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tourReviews } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const [review] = await drizzleDb
          .select()
          .from(tourReviews)
          .where(eq(tourReviews.id, input.id))
          .limit(1);
        if (!review) throw new TRPCError({ code: "NOT_FOUND", message: "Review not found" });
        const wasAlreadyApproved = review.status === "approved";

        await drizzleDb
          .update(tourReviews)
          .set({
            status: "approved",
            moderatedAt: new Date(),
            moderatedBy: ctx.user.id,
            publishedAt: review.publishedAt ?? new Date(),
            rejectionReason: null,
          })
          .where(eq(tourReviews.id, input.id));

        // Idempotent +50 Packpoint: only on first approval, not re-approve
        // after un-hide.
        if (!wasAlreadyApproved) {
          try {
            const { awardPackpoint } = await import("./_core/packpoint");
            await awardPackpoint({
              userId: review.userId,
              delta: 50,
              reason: "review_bonus",
              referenceType: "review",
              referenceId: review.id,
              description: `行程評論獎勵(已通過審核)`,
            });
          } catch (err) {
            console.error(`[Reviews] Packpoint award failed for review ${review.id}:`, err);
            // Don't fail the approval — admin retry / manual adjust available
          }
        }

        return { ok: true, awarded: !wasAlreadyApproved ? 50 : 0 };
      }),

    /**
     * Admin: reject a review with a customer-visible reason.
     */
    adminReject: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          reason: z.string().trim().min(3).max(500),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tourReviews } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        await drizzleDb
          .update(tourReviews)
          .set({
            status: "rejected",
            moderatedAt: new Date(),
            moderatedBy: ctx.user.id,
            rejectionReason: input.reason,
            publishedAt: null,
          })
          .where(eq(tourReviews.id, input.id));

        return { ok: true };
      }),

    /**
     * Admin: hide an approved review (e.g. policy violation discovered later).
     * Doesn't claw back the +50 Packpoint already paid.
     */
    adminHide: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { tourReviews } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await drizzleDb
          .update(tourReviews)
          .set({
            status: "hidden",
            moderatedAt: new Date(),
            moderatedBy: ctx.user.id,
          })
          .where(eq(tourReviews.id, input.id));
        return { ok: true };
      }),
  }),

});
export type AppRouter = typeof appRouter;
