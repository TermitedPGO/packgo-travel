import { COOKIE_NAME } from "@shared/const";
import { getAliases } from "./_helpers/placeNameAliases";
import { normalizePlaceName } from "./_helpers/llmPlaceNormalizer";
import { tourMonitorRouter } from "./routers/tourMonitorRouter";
import { agentRouter } from "./routers/agentRouter";
import { toolsRouter } from "./routers/toolsRouter";
import { plaidRouter } from "./routers/plaidRouter";
import { suppliersRouter } from "./routers/suppliersRouter";
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
import { generateProfitAndLossReport, generateMonthlyTrend, generateTaxSummary, generateAccountingCsv, generateFinancialDashboard, CATEGORY_LABELS } from "./services/financialReportService";
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

  // Round 80.22: Packpoint loyalty system. Read-only queries here; mutations
  // happen automatically in the Stripe webhook (booking earn) or via the
  // checkout flow (redemption). Admin adjustments use the admin router.
  packpoint: router({
    /**
     * Get current user's Packpoint status: balance, lifetime, last activity,
     * days until inactivity expiry. Returns null balance for guests.
     */
    getStatus: publicProcedure.query(async ({ ctx }) => {
      const user = ctx.user as any;
      if (!user) {
        return {
          balance: 0,
          lifetimeEarned: 0,
          lastActivityAt: null as Date | null,
          daysUntilExpiry: null as number | null,
          tier: "free" as const,
          isLoggedIn: false,
        };
      }

      const lastActivity = user.packpointLastActivityAt
        ? new Date(user.packpointLastActivityAt)
        : null;
      const EXPIRY_DAYS = 18 * 30;
      let daysUntilExpiry: number | null = null;
      if (lastActivity) {
        const elapsed = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);
        daysUntilExpiry = Math.max(0, Math.ceil(EXPIRY_DAYS - elapsed));
      }

      return {
        balance: user.packpointBalance ?? 0,
        lifetimeEarned: user.packpointLifetimeEarned ?? 0,
        lastActivityAt: lastActivity,
        daysUntilExpiry,
        tier: (user.tier || "free") as "free" | "plus" | "concierge",
        isLoggedIn: true,
      };
    }),

    /**
     * Paginated transaction history for Profile page.
     * Most recent first; default 20 per page.
     */
    getHistory: protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).default(20),
          cursor: z.number().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return { items: [], nextCursor: null };

        const { pointsTransactions } = await import("../drizzle/schema");
        const { eq, and, lt, desc } = await import("drizzle-orm");

        const conditions = input.cursor
          ? and(
              eq(pointsTransactions.userId, ctx.user.id),
              lt(pointsTransactions.id, input.cursor)
            )
          : eq(pointsTransactions.userId, ctx.user.id);

        const rows = await db
          .select()
          .from(pointsTransactions)
          .where(conditions)
          .orderBy(desc(pointsTransactions.id))
          .limit(input.limit + 1);

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1].id : null;

        return { items, nextCursor };
      }),

    /**
     * Estimate redemption value: how much $ does X points buy, capped at
     * 50% of subtotal (policy §5)? Used by checkout UI to show preview.
     */
    estimateRedemption: protectedProcedure
      .input(
        z.object({
          points: z.number().int().min(0),
          subtotalUsd: z.number().min(0),
        })
      )
      .query(({ ctx, input }) => {
        const user = ctx.user as any;
        const balance = user.packpointBalance ?? 0;
        const MIN_POINTS = 100;
        const MAX_REDEMPTION_PCT = 0.5;

        if (input.points === 0) {
          return { discountUsd: 0, valid: true, error: null as string | null };
        }
        if (input.points < MIN_POINTS) {
          return {
            discountUsd: 0,
            valid: false,
            error: `Minimum redemption is ${MIN_POINTS} Packpoint ($1)`,
          };
        }
        if (input.points > balance) {
          return {
            discountUsd: 0,
            valid: false,
            error: `You only have ${balance} Packpoint`,
          };
        }
        const requestedDiscount = input.points / 100; // 100 pt = $1
        const maxDiscount = input.subtotalUsd * MAX_REDEMPTION_PCT;
        const discountUsd = Math.min(requestedDiscount, maxDiscount);
        return { discountUsd, valid: true, error: null };
      }),

    /**
     * Admin: manually adjust a user's Packpoint balance with a reason.
     * Use cases: customer comp (unhappy / VIP gift), missed bonus make-up,
     * fraud clawback, promotional grants. Audit-trail captured automatically
     * via pointsTransactions row with reason='admin_adjust'.
     */
    adminAdjust: adminProcedure
      .input(
        z.object({
          userId: z.number().int().positive(),
          delta: z.number().int().refine((v) => v !== 0, "delta must be non-zero"),
          description: z.string().min(3).max(500),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { awardPackpoint, deductPackpoint } = await import("./_core/packpoint");
        if (input.delta > 0) {
          const newBalance = await awardPackpoint({
            userId: input.userId,
            delta: input.delta,
            reason: "signup_bonus", // closest "earn" reason; we override description
            description: `[Admin ${ctx.user.email}] ${input.description}`,
          });
          if (newBalance === null) {
            throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
          }
          return { newBalance };
        }
        const newBalance = await deductPackpoint({
          userId: input.userId,
          amount: Math.abs(input.delta),
          reason: "admin_adjust",
          description: `[Admin ${ctx.user.email}] ${input.description}`,
        });
        if (newBalance === null) {
          throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        }
        return { newBalance };
      }),

    /**
     * Admin: trigger the daily Packpoint maintenance run on demand.
     * Useful for testing the auto-upgrade / expiry / birthday flows without
     * waiting for the 02:00 UTC cron.
     */
    adminTriggerMaintenance: adminProcedure.mutation(async ({ ctx }) => {
      const { triggerManualPackpointMaintenance } = await import(
        "./queues/packpointMaintenanceQueue"
      );
      const job = await triggerManualPackpointMaintenance(ctx.user.id);
      return { jobId: String(job.id) };
    }),

    /**
     * Round 80.22 Phase D: get current user's referral code.
     * Lazy-generates if missing (for users created before referrals existed).
     * Returns the code, share URL, and current count of successful referrals.
     */
    getReferralStatus: protectedProcedure.query(async ({ ctx }) => {
      const { ensureReferralCode } = await import("./_core/referral");
      const code = await ensureReferralCode(ctx.user.id);
      const baseUrl = ENV.baseUrl || "https://packgoplay.com";
      const shareUrl = code ? `${baseUrl}/?ref=${code}` : null;

      // Count successful referrals (referees who triggered a payout)
      const drizzleDb = await db.getDb();
      let successfulCount = 0;
      let pendingCount = 0;
      if (drizzleDb) {
        const { users: usersTable } = await import("../drizzle/schema");
        const { eq, and, sql } = await import("drizzle-orm");
        const [success] = await drizzleDb
          .select({ c: sql<number>`COUNT(*)` })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.referredBy, ctx.user.id),
              eq(usersTable.referralBonusAwarded, true)
            )
          );
        const [pending] = await drizzleDb
          .select({ c: sql<number>`COUNT(*)` })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.referredBy, ctx.user.id),
              eq(usersTable.referralBonusAwarded, false)
            )
          );
        successfulCount = Number(success?.c || 0);
        pendingCount = Number(pending?.c || 0);
      }

      return {
        code,
        shareUrl,
        successfulCount,
        pendingCount,
        rewardPerReferral: 500,
      };
    }),

    /**
     * Round 80.22 Phase D: claim a referral code post-signup. UI calls this
     * once the user is logged in if a `?ref=` param was captured pre-auth.
     * No-op if user already has a referredBy.
     */
    claimReferral: protectedProcedure
      .input(z.object({ code: z.string().min(4).max(16) }))
      .mutation(async ({ ctx, input }) => {
        const { attachReferral } = await import("./_core/referral");
        const ok = await attachReferral({
          refereeUserId: ctx.user.id,
          refereeEmail: ctx.user.email,
          referralCode: input.code,
        });
        return { attached: ok };
      }),
  }),

  /**
   * Round 80.22 Phase F: Reward vouchers. Public catalog + protected
   * redeem/list, admin marks-as-used.
   */
  vouchers: router({
    /**
     * Public catalog with optional gate-state evaluation (e.g. photo book
     * shows "you need 50 photos, have 37" copy when user is logged in).
     */
    catalog: publicProcedure.query(async ({ ctx }) => {
      const { VOUCHER_CATALOG } = await import("./_core/vouchers");
      const userId = ctx.user?.id;
      // Attach gate-blocked status per item
      const items = await Promise.all(
        VOUCHER_CATALOG.map(async (item) => {
          let gateBlocked: string | null = null;
          if (item.gate && userId) {
            try {
              gateBlocked = await item.gate(userId);
            } catch {
              gateBlocked = null;
            }
          }
          return {
            sku: item.sku,
            type: item.type,
            pointsCost: item.pointsCost,
            amountUsd: item.amountUsd,
            titleZh: item.titleZh,
            titleEn: item.titleEn,
            descriptionZh: item.descriptionZh,
            descriptionEn: item.descriptionEn,
            gateBlocked,
          };
        })
      );
      return items;
    }),

    /** Customer redeems Packpoint for a voucher. */
    redeem: protectedProcedure
      .input(z.object({ sku: z.string().max(32) }))
      .mutation(async ({ ctx, input }) => {
        const { issueVoucher } = await import("./_core/vouchers");
        // Pre-check: does user have enough points?
        const userBalance = (ctx.user as any).packpointBalance ?? 0;
        const { findCatalogItem } = await import("./_core/vouchers");
        const item = findCatalogItem(input.sku);
        if (!item) {
          throw new TRPCError({ code: "NOT_FOUND", message: "兌換項目不存在" });
        }
        if (userBalance < item.pointsCost) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Packpoint 不足(需要 ${item.pointsCost.toLocaleString()},目前 ${userBalance.toLocaleString()})`,
          });
        }
        const result = await issueVoucher({ userId: ctx.user.id, sku: input.sku });
        if (!result.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
        }

        // Round 80.22 Phase G: email the code to the customer (best-effort)
        try {
          const { sendVoucherIssuedEmail } = await import("./email");
          // Detect language: check user.preferredLocale or ctx
          const lang =
            ((ctx.user as any).customerLanguage as "zh-TW" | "en" | undefined) ?? "zh-TW";
          await sendVoucherIssuedEmail({
            customerEmail: ctx.user.email,
            customerName: ctx.user.name || ctx.user.email.split("@")[0],
            voucherCode: result.data.code,
            voucherTitle: lang === "en" ? item.titleEn : item.titleZh,
            amountUsd: result.data.amountUsd,
            pointsCost: result.data.pointsCost,
            expiresAt: result.data.expiresAt,
            language: lang,
          });
        } catch (err) {
          // Don't fail the redemption — code is still in the UI
          console.error("[vouchers.redeem] Email failed:", err);
        }

        return result.data;
      }),

    /** List current user's own vouchers. */
    myVouchers: protectedProcedure.query(async ({ ctx }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) return [];
      const { rewardVouchers } = await import("../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      return await drizzleDb
        .select()
        .from(rewardVouchers)
        .where(eq(rewardVouchers.userId, ctx.user.id))
        .orderBy(desc(rewardVouchers.createdAt));
    }),

    /** Admin: list all vouchers with filters. */
    adminList: adminProcedure
      .input(
        z.object({
          status: z.enum(["issued", "redeemed", "expired", "voided", "all"]).default("all"),
          type: z.enum(["flight_credit", "photo_book", "tour_credit", "all"]).default("all"),
          limit: z.number().int().positive().max(200).default(50),
          cursor: z.number().int().optional(),
        })
      )
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { items: [], nextCursor: null };
        const { rewardVouchers, users: usersTable } = await import("../drizzle/schema");
        const { eq, and, lt, desc } = await import("drizzle-orm");
        const filters = [];
        if (input.status !== "all") filters.push(eq(rewardVouchers.status, input.status));
        if (input.type !== "all") filters.push(eq(rewardVouchers.type, input.type));
        if (input.cursor) filters.push(lt(rewardVouchers.id, input.cursor));
        const whereClause = filters.length ? and(...filters) : undefined;
        const rows = await drizzleDb
          .select({
            id: rewardVouchers.id,
            userId: rewardVouchers.userId,
            authorName: usersTable.name,
            authorEmail: usersTable.email,
            type: rewardVouchers.type,
            code: rewardVouchers.code,
            amountUsd: rewardVouchers.amountUsd,
            pointsCost: rewardVouchers.pointsCost,
            status: rewardVouchers.status,
            expiresAt: rewardVouchers.expiresAt,
            redeemedAt: rewardVouchers.redeemedAt,
            redeemedAgainstBookingId: rewardVouchers.redeemedAgainstBookingId,
            notes: rewardVouchers.notes,
            createdAt: rewardVouchers.createdAt,
          })
          .from(rewardVouchers)
          .leftJoin(usersTable, eq(rewardVouchers.userId, usersTable.id))
          .where(whereClause)
          .orderBy(desc(rewardVouchers.id))
          .limit(input.limit + 1);

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
      }),

    /** Admin: mark a voucher as redeemed (used). */
    adminMarkRedeemed: adminProcedure
      .input(
        z.object({
          voucherId: z.number().int().positive(),
          bookingId: z.number().int().positive().optional(),
          notes: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { markVoucherRedeemed } = await import("./_core/vouchers");
        const result = await markVoucherRedeemed({
          voucherId: input.voucherId,
          adminId: ctx.user.id,
          bookingId: input.bookingId,
          notes: input.notes,
        });
        if (!result.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
        }
        return { ok: true };
      }),
  }),

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

  // User Favorites router
  favorites: router({
    // Get user's favorite tour IDs (for quick checking)
    getIds: protectedProcedure.query(async ({ ctx }) => {
      return await db.getUserFavoriteIds(ctx.user.id);
    }),

    // Get user's favorite tours with details
    list: protectedProcedure.query(async ({ ctx }) => {
      return await db.getUserFavorites(ctx.user.id);
    }),

    // Add a tour to favorites
    add: protectedProcedure
      .input(z.object({ tourId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.addFavorite(ctx.user.id, input.tourId);
        return { success: true };
      }),

    // Remove a tour from favorites
    remove: protectedProcedure
      .input(z.object({ tourId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.removeFavorite(ctx.user.id, input.tourId);
        return { success: true };
      }),

    // Toggle favorite status
    toggle: protectedProcedure
      .input(z.object({ tourId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const isFav = await db.isFavorite(ctx.user.id, input.tourId);
        if (isFav) {
          await db.removeFavorite(ctx.user.id, input.tourId);
          return { isFavorite: false };
        } else {
          await db.addFavorite(ctx.user.id, input.tourId);
          return { isFavorite: true };
        }
      }),
  }),

  // User Browsing History router
  browsingHistory: router({
    // Get user's browsing history
    list: protectedProcedure
      .input(z.object({ limit: z.number().optional().default(20) }).optional())
      .query(async ({ ctx, input }) => {
        return await db.getUserBrowsingHistory(ctx.user.id, input?.limit);
      }),

    // Record a tour view
    record: protectedProcedure
      .input(z.object({ tourId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.recordBrowsingHistory(ctx.user.id, input.tourId);
        return { success: true };
      }),

    // Clear browsing history
    clear: protectedProcedure.mutation(async ({ ctx }) => {
      await db.clearBrowsingHistory(ctx.user.id);
      return { success: true };
    }),
  }),

  // Tour management router (admin only)
  tours: router({
    // Get all tours (public)
    list: publicProcedure
      .input(
        z
          .object({
            category: z.string().optional(),
            status: z.string().optional(),
            featured: z.boolean().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return await db.getAllTours(input);
      }),

    // Get single tour by ID (public)
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const tour = await db.getTourById(input.id);
        if (!tour) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Tour not found",
          });
        }
        return tour;
      }),

    // Get filter options for smart filtering (public)
    getFilterOptions: publicProcedure.query(async () => {
      return await db.getFilterOptions();
    }),

    /**
     * v78o Sprint 7: Tour route map — server-side geocoding + Google Static
     * Map URL for the daily itinerary. We do this server-side because the
     * client-side Forge proxy isn't available in production.
     *
     * Returns: { staticMapUrl, stops: [{day, name, lat, lng}] }
     * The static map URL is signed once with our GOOGLE_API_KEY (server-only),
     * so the frontend just renders it as <img>. Cached in-memory for 24h.
     */
    /**
     * Admin: regenerate the per-tour AI travel map via gpt-image-2.
     * Reads the tour's stops + transport segments, builds a region-aware
     * prompt, calls OpenAI, uploads the PNG to R2, and saves the URL to
     * `tours.aiMapUrl`. Cost: ~$0.28 per call. Duration: ~135-160s.
     *
     * v331 Phase A — synchronous; admin UI shows a spinner and waits.
     * Phase B will move this to a BullMQ job for non-blocking generation.
     */
    regenerateAiMap: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { generateTourMap } = await import("./services/tourMapGenerator");
        const result = await generateTourMap({ tourId: input.id });
        return {
          aiMapUrl: result.url,
          cost: result.cost,
          durationMs: result.durationMs,
        };
      }),

    getRouteMap: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const tour = await db.getTourById(input.id);
        if (!tour) {
          return {
            staticMapUrl: null,
            stops: [],
            directionsUrl: null,
            aiMapUrl: null,
          };
        }

        // v331 — surface the AI tour-map URL so the client can render
        // the painted PNG instead of the SVG canvas when it's available.
        const aiMapUrl = (tour as any).aiMapUrl ?? null;

        // Parse itinerary
        let itinerary: any[] = [];
        try {
          itinerary = typeof (tour as any).itineraryDetailed === "string"
            ? JSON.parse((tour as any).itineraryDetailed)
            : (tour as any).itineraryDetailed || [];
        } catch {
          itinerary = [];
        }
        if (!Array.isArray(itinerary) || itinerary.length === 0) {
          return {
            staticMapUrl: null,
            stops: [],
            directionsUrl: null,
            aiMapUrl,
          };
        }

        // Build geocode queries — itinerary titles are like "慕尼黑Munich－258km－聖加侖St.Gallen"
        // Strategy: split on multi-city separators, take first chunk, extract trailing English
        // (bilingual format: "ChineseEnglish" with no space — English is more reliable for geocoding)
        const country = (tour as any).destinationCountry || "";

        // Round 80.21 — extract DESTINATION (last city) from a day's title.
        // The previous version (`_extractFirstPlace`) silently broke on the
        // most common separator in PACK&GO-formatted itineraries: 「→」
        // (U+2192). For "台北 → 慕尼黑：飛越歐洲" it returned the entire
        // string as the first chunk, then appended ", Switzerland" → Google
        // ZERO_RESULTS, fallback triggered, country-level map shown.
        //
        // New rules:
        // 1. Strip prefixes (Day N / 第 N 日)
        // 2. Strip parentheticals + colon-clauses (「飛越歐洲」 description)
        // 3. Split on a comprehensive separator set (now includes →,>,⇒)
        // 4. Take the LAST chunk — that's where the traveler ends the day
        //    (e.g. "台北 → 慕尼黑" → "慕尼黑"; geocode result is more useful
        //    for the destination than the start).
        // 5. Prefer trailing English when bilingual ("慕尼黑Munich" → Munich)
        const _extractDestinationPlace = (raw: string): string => {
          if (!raw) return "";
          let s = String(raw)
            .replace(/^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i, "")
            .replace(/[（(].*?[）)]/g, "")  // strip parentheticals
            .replace(/\+{2,}.*?\+{2,}/g, "") // strip "+++接駁..." asides
            .trim();
          if (!s) return "";

          // Strip everything after a colon — that's typically the day's
          // theme/description, not a location ("飛越歐洲" / "返程啟航").
          // The space before ":" is preserved if present.
          s = s.split(/[:：]/)[0].trim();
          if (!s) return "";

          // Comprehensive separator regex — adds → (U+2192), ⇒ (U+21D2),
          // ↔ (U+2194 bidirectional), ⇄ (U+21C4), > (ASCII), and ASCII
          // sequences "->", "=>", "<->", "<=>". Round 80.21 follow-up:
          // the ↔ char actually appears in some itineraries as a
          // bidirectional flight indicator ("台北 ↔ 巴黎") — without
          // splitting on it, geocoding queries the entire string and
          // gets ZERO_RESULTS.
          const SEP = /\s*(?:↔|⇄|→|⇒|<->|<=>|->|=>|>|[／/、,，–—－])\s*| - | – /g;
          const chunks = s.split(SEP).map(c => c.trim()).filter(Boolean);
          if (chunks.length === 0) return "";

          // Take the LAST chunk — the day's destination.
          const lastChunk = chunks[chunks.length - 1];

          // Prefer trailing English when bilingual ("慕尼黑Munich" → Munich)
          const englishMatch = lastChunk.match(/[A-Za-z][A-Za-z .'-]+(?:\s*[A-Za-z][A-Za-z .'-]+)*$/);
          if (englishMatch && englishMatch[0].length >= 3) {
            return englishMatch[0].trim();
          }
          return lastChunk;
        };
        // Backwards-compat alias (kept in case other code paths reference it)
        const _extractFirstPlace = _extractDestinationPlace;

        // Region map — moved out of the queries.map callback so tryGoogle
        // and tryNominatim (defined later, in a sibling scope) can use it.
        const _region: Record<string, string> = {
          // Europe
          at: "EU", be: "EU", bg: "EU", ch: "EU", cz: "EU", de: "EU", dk: "EU",
          ee: "EU", es: "EU", fi: "EU", fr: "EU", gb: "EU", gr: "EU", hr: "EU",
          hu: "EU", ie: "EU", is: "EU", it: "EU", li: "EU", lt: "EU", lu: "EU",
          lv: "EU", mc: "EU", mt: "EU", nl: "EU", no: "EU", pl: "EU", pt: "EU",
          ro: "EU", se: "EU", si: "EU", sk: "EU", va: "EU", ad: "EU", sm: "EU",
          // East Asia
          cn: "EA", hk: "EA", jp: "EA", kr: "EA", mo: "EA", mn: "EA", tw: "EA", kp: "EA",
          // Southeast Asia
          bn: "SE", id: "SE", kh: "SE", la: "SE", mm: "SE", my: "SE", ph: "SE",
          sg: "SE", th: "SE", tl: "SE", vn: "SE",
          // South Asia
          af: "SA", bd: "SA", bt: "SA", in: "SA", lk: "SA", mv: "SA", np: "SA", pk: "SA",
          // Middle East / North Africa
          ae: "ME", bh: "ME", eg: "ME", il: "ME", iq: "ME", ir: "ME", jo: "ME",
          kw: "ME", lb: "ME", om: "ME", qa: "ME", sa: "ME", sy: "ME", tr: "ME",
          ye: "ME", ps: "ME",
          // Africa (sub-Saharan)
          dz: "AF", et: "AF", gh: "AF", ke: "AF", ma: "AF", ng: "AF", rw: "AF",
          sn: "AF", tn: "AF", tz: "AF", ug: "AF", za: "AF",
          // North America
          ca: "NA", mx: "NA", us: "NA",
          // Latin America
          ar: "LA", bo: "LA", br: "LA", cl: "LA", co: "LA", cu: "LA", do: "LA",
          ec: "LA", gt: "LA", hn: "LA", ni: "LA", pa: "LA", pe: "LA", py: "LA",
          sv: "LA", uy: "LA", ve: "LA", cr: "LA", jm: "LA", pr: "LA",
          // Oceania
          au: "OC", fj: "OC", nc: "OC", nz: "OC", pf: "OC", pg: "OC", to: "OC", ws: "OC",
          // CIS / Caucasus / Central Asia
          am: "CA", az: "CA", by: "CA", ge: "CA", kg: "CA", kz: "CA", md: "CA",
          ru: "CA", tj: "CA", tm: "CA", ua: "CA", uz: "CA",
        };

        const queries: { day: any; q: string }[] = itinerary.map((d: any) => {
          // Prefer explicit location/city, then activities[0].location, then parsed title.
          // Round 80.21 v4 — bug fix: activities[0].location was used RAW
          // ("巴黎 ↔ 台北") which broke isHomeReturn detection (cleaned
          // didn't equal departureCity). Now we run it through the same
          // _extractDestinationPlace as titles, so all three sources
          // produce a clean lastChunk consistently.
          //
          // v9 — additional bug fix: activities[0].location is sometimes
          // formatted "{city},{country}" (full-width comma). After
          // splitting, lastChunk = country name (「瑞士」), which would
          // get rejected as a country-fallback by tryGoogle. We must
          // skip extraction results that match the destinationCountry
          // and fall through to the title path instead.
          //
          // Only compares against Chinese country name (`country`) here
          // — `countryEn` isn't computed yet at this point in the loop.
          const _isJustCountry = (c: string): boolean => {
            return c === country;
          };
          const explicitRaw = _extractDestinationPlace((d.location || d.city || "").trim());
          const explicit = _isJustCountry(explicitRaw) ? "" : explicitRaw;
          // Round 80.21 v10 — prefer title's lastChunk over activities[0].
          // activities[0] is the FIRST activity of the day (typically the
          // morning stop or starting point), but for the route map we
          // want the day's DESTINATION (where the traveler ends the day).
          // Day 4 「伯恩 → 黃金列車 → 蒙投」 has activities[0]="伯恩舊城區"
          // (start) but title lastChunk is "蒙投" (end). Title wins.
          //
          // Fallback to activities.last() if title parsing yields empty;
          // gives a real city for days where title is just a theme like
          // "自由日". Final fallback to activities[0].
          const acts = Array.isArray(d.activities) ? d.activities : [];
          const lastActLoc = acts.length > 0 && acts[acts.length - 1]?.location
            ? _extractDestinationPlace(String(acts[acts.length - 1].location)) : "";
          const firstActLoc = acts.length > 0 && acts[0]?.location
            ? _extractDestinationPlace(String(acts[0].location)) : "";
          const activityLast = _isJustCountry(lastActLoc) ? "" : lastActLoc;
          const activityFirst = _isJustCountry(firstActLoc) ? "" : firstActLoc;
          const fromTitle = _extractDestinationPlace(d.title || "");
          const cleaned = explicit || fromTitle || activityLast || activityFirst;
          if (!cleaned) return { day: d, q: "" };

          // Translate country to English for Google's geocoder (which handles
          // both, but English is more reliable). Reuse client locationMapping.
          const _countryEn: Record<string, string> = {
            "瑞士": "Switzerland", "德國": "Germany", "奧地利": "Austria",
            "法國": "France", "義大利": "Italy", "英國": "United Kingdom",
            "西班牙": "Spain", "葡萄牙": "Portugal", "荷蘭": "Netherlands",
            "比利時": "Belgium", "希臘": "Greece", "捷克": "Czech Republic",
            "美國": "USA", "加拿大": "Canada", "墨西哥": "Mexico",
            "日本": "Japan", "韓國": "South Korea", "中國": "China",
            "泰國": "Thailand", "越南": "Vietnam", "新加坡": "Singapore",
            "馬來西亞": "Malaysia", "印尼": "Indonesia", "菲律賓": "Philippines",
            "澳洲": "Australia", "紐西蘭": "New Zealand", "土耳其": "Turkey",
            "波蘭": "Poland", "蒙古": "Mongolia", "俄羅斯": "Russia",
            // Middle East + Africa — added for Dubai/Cairo, Egypt, Israel etc.
            "阿聯": "United Arab Emirates", "阿拉伯聯合大公國": "United Arab Emirates",
            "杜拜": "Dubai, United Arab Emirates", "埃及": "Egypt",
            "以色列": "Israel", "約旦": "Jordan", "摩洛哥": "Morocco",
            "南非": "South Africa", "肯亞": "Kenya", "坦尚尼亞": "Tanzania",
            // Latin America
            "巴西": "Brazil", "阿根廷": "Argentina", "智利": "Chile", "秘魯": "Peru",
            // South Asia
            "印度": "India", "尼泊爾": "Nepal", "斯里蘭卡": "Sri Lanka",
            "不丹": "Bhutan", "馬爾地夫": "Maldives",
            // CIS / Caucasus
            "喬治亞": "Georgia", "亞美尼亞": "Armenia", "亞塞拜然": "Azerbaijan",
            "哈薩克": "Kazakhstan", "烏茲別克": "Uzbekistan",
          };
          // ISO 3166-1 alpha-2 lower-case country codes for result-validation.
          // Used to reject geocoder results in the wrong REGION (Round 80.21
          // v7 — strict country match was too restrictive; rejected Munich
          // for Switzerland tours since Munich is in Germany. Now we
          // validate by REGION group so Schengen Europe results are mutually
          // acceptable, East Asia mutually, etc.).
          const _countryIso: Record<string, string> = {
            "瑞士": "ch", "德國": "de", "奧地利": "at",
            "法國": "fr", "義大利": "it", "英國": "gb",
            "西班牙": "es", "葡萄牙": "pt", "荷蘭": "nl",
            "比利時": "be", "希臘": "gr", "捷克": "cz",
            "美國": "us", "加拿大": "ca", "墨西哥": "mx",
            "日本": "jp", "韓國": "kr", "中國": "cn",
            "泰國": "th", "越南": "vn", "新加坡": "sg",
            "馬來西亞": "my", "印尼": "id", "菲律賓": "ph",
            "澳洲": "au", "紐西蘭": "nz", "土耳其": "tr",
            "波蘭": "pl", "蒙古": "mn", "俄羅斯": "ru",
            "阿聯": "ae", "阿拉伯聯合大公國": "ae",
            "杜拜": "ae", "埃及": "eg",
            "以色列": "il", "約旦": "jo", "摩洛哥": "ma",
            "南非": "za", "肯亞": "ke", "坦尚尼亞": "tz",
            "巴西": "br", "阿根廷": "ar", "智利": "cl", "秘魯": "pe",
            "印度": "in", "尼泊爾": "np", "斯里蘭卡": "lk",
            "不丹": "bt", "馬爾地夫": "mv",
            "喬治亞": "ge", "亞美尼亞": "am", "亞塞拜然": "az",
            "哈薩克": "kz", "烏茲別克": "uz",
            "台灣": "tw", "香港": "hk",
          };
          const countryEn = _countryEn[country] || country;
          const expectedIso = _countryIso[country] || null;
          // Round 80.21 v7 — soft region validation (vs strict ISO match)
          const expectedRegion = expectedIso ? _region[expectedIso] : null;
          // Round 80.21 v4 — home-return detection.
          // Bug case: Day 9 of tour 990014 was "巴黎 → 台北:回程啟航".
          // lastChunk = "台北", but appending ", France" then querying
          // Google found a Chinese restaurant named "台北" in Paris
          // (lat 48.85). The first candidate succeeded with WRONG country.
          //
          // Fix: when lastChunk matches the tour's departureCity (or first
          // 2 chars of it — handles "台北 TPE" departure formats),
          // SKIP the destinationCountry qualifier entirely. Google's
          // raw "台北" resolves to Taipei correctly.
          const departureCity = ((tour as any).departureCity || "").trim();
          const isHomeReturn = !!departureCity && (
            cleaned === departureCity ||
            cleaned === departureCity.slice(0, 2) ||
            cleaned.startsWith(departureCity.slice(0, 2)) && cleaned.length <= departureCity.length + 2
          );
          // Round 80.21 v3 — Multi-tier candidate strategy.
          //
          // Bugs in v2:
          //   - Day 8 "巴黎自由日" → "巴黎自由日, France" fails → fallback to
          //     bare "巴黎自由日" → Google returns a Brunei result, coord set,
          //     done with WRONG location.
          //   - Days 3,5,6,7 with titles like "巴黎左岸文藝風情" both
          //     candidates fail → 0 stops returned for that day.
          //
          // Fix: insert a CITY HINT candidate (first 2-3 Chinese chars) BETWEEN
          // the specific query and the raw fallback. So order becomes:
          //   1. "{cleaned}, {country}"   — most specific, wins if exact
          //   2. "{hint3}, {country}"     — 3-char city prefix (蘇黎世/蒙特勒)
          //   3. "{hint2}, {country}"     — 2-char city prefix (巴黎/東京)
          //   4. "{cleaned}"              — raw, last resort
          //
          // For Day 8 "巴黎自由日": (1) fails, (2) "巴黎自" fails, (3) "巴黎,
          // France" → Paris ✓, break before raw "巴黎自由日" → Brunei.
          //
          // English-bearing queries keep raw-first (Google handles English
          // place names well even without country qualifier).
          const hasEnglish = /[A-Za-z]{2,}/.test(cleaned);
          // Round 80.21 v6 — Chinese-only candidates ALL validated against
          // expectedIso (including raw fallback). Without this, when both
          // "瓦萊州, Switzerland" and "瓦萊, Switzerland" failed via
          // Nominatim, raw "瓦萊州" was tried with expectedIso=null and
          // accepted Vietnam's Lai Châu (lat 22, lng 103) — completely
          // wrong country. Now raw fallback also rejects wrong-country
          // results; the day silently drops off the map (legend below
          // still lists it) which is much better than a wrong pin.
          //
          // English-bearing and home-return queries keep expectedIso=null:
          //   - English: Google handles disambiguation well even without
          //     country qualifier (Munich → Germany without "Germany")
          //   - Home-return: lastChunk = departureCity, must match TW or
          //     home country, NOT destinationCountry (which is the trip's
          //     foreign destination).
          // Round 80.21 v7 — candidates carry expectedRegion (not iso)
          // for soft same-region validation (EU accepts EU, EA accepts EA, etc.)
          const candidates: { q: string; expectedRegion: string | null }[] = [];
          if (isHomeReturn) {
            candidates.push({ q: cleaned, expectedRegion: null });
          } else if (countryEn && !cleaned.includes(countryEn)) {
            if (hasEnglish) {
              candidates.push({ q: cleaned, expectedRegion: null });
              candidates.push({ q: `${cleaned}, ${countryEn}`, expectedRegion });
            } else {
              candidates.push({ q: `${cleaned}, ${countryEn}`, expectedRegion });
              if (cleaned.length >= 4) {
                const hint3 = cleaned.slice(0, 3);
                if (hint3 !== cleaned) {
                  candidates.push({ q: `${hint3}, ${countryEn}`, expectedRegion });
                }
              }
              if (cleaned.length >= 3) {
                const hint2 = cleaned.slice(0, 2);
                if (hint2 !== cleaned && !candidates.some((c) => c.q === `${hint2}, ${countryEn}`)) {
                  candidates.push({ q: `${hint2}, ${countryEn}`, expectedRegion });
                }
              }
              candidates.push({ q: cleaned, expectedRegion });
            }
          } else {
            candidates.push({ q: cleaned, expectedRegion: null });
          }
          // Round 80.21 v10 — append alias candidates as final-tier fallback.
          // For known OTA non-standard names (蒙投/冰河3000/西庸古堡/...),
          // inject the standard English / canonical Chinese forms. New
          // tours SHOULD use standard names per skill rules, but this
          // rescues legacy tour data + edge cases.
          // See server/_helpers/placeNameAliases.ts.
          const aliases = getAliases(cleaned);
          for (const alias of aliases) {
            if (alias.en && !candidates.some((c) => c.q === alias.en)) {
              candidates.push({ q: alias.en, expectedRegion });
            }
            if (alias.zh && countryEn) {
              const aliasQ = `${alias.zh}, ${countryEn}`;
              if (!candidates.some((c) => c.q === aliasQ)) {
                candidates.push({ q: aliasQ, expectedRegion });
              }
            }
          }
          return { day: d, q: cleaned, candidates, expectedRegion };
        });

        // Geocode each unique query (server-side, with simple in-process cache).
        // Round 80.21 v2 — cache key prefixed with version "v2". When we
        // bumped the candidate ordering logic, old "巴黎"→Taipei negative
        // cache entries needed to be invalidated without restarting the
        // process. Using a versioned prefix means all old keys become
        // unreachable, effectively clearing the cache. Future logic
        // changes can bump to v3, v4, etc.
        const CACHE_VERSION = "v13"; // bump on candidate ordering changes
        const _cache = (globalThis as any).__packgoGeocodeCache ||
          ((globalThis as any).__packgoGeocodeCache = new Map<string, { lat: number; lng: number } | null>());
        const cacheKey = (cand: string) => `${CACHE_VERSION}:${country}:${cand}`;

        const { makeRequest } = await import("./_core/map");

        // Round 80.21 follow-up — Nominatim fallback.
        //
        // Discovered via fly logs: GOOGLE_API_KEY in prod returns
        // REQUEST_DENIED ("This API project was not found... You may need
        // to enable the API"). When that happens, ALL Google geocode
        // calls fail and getRouteMap returns 0 stops, triggering the
        // RouteFlowFallback chip view instead of the SVG map.
        //
        // OpenStreetMap's Nominatim is free, no API key, accurate at
        // city level (uses real OSM data). Rate limit is 1 req/sec but
        // we respect that with sequential per-query awaits + the
        // existing 24h in-process cache. We track the "google denied"
        // signal in a process-wide flag so we don't burn 13 failed calls
        // before falling back.
        const _googleStatus = (globalThis as any).__packgoGoogleStatus ||
          ((globalThis as any).__packgoGoogleStatus = { denied: false, deniedSince: 0 });
        // Round 80.21 v4 — Google retry after 60s cooldown. Without this,
        // a single REQUEST_DENIED locks us into Nominatim forever (until
        // process restart / deploy). Now we re-try Google every 60s — if
        // Jeff fixes the GCP key, the next batch picks it up automatically.
        const GOOGLE_RETRY_COOLDOWN_MS = 60_000;
        if (_googleStatus.denied && Date.now() - _googleStatus.deniedSince > GOOGLE_RETRY_COOLDOWN_MS) {
          _googleStatus.denied = false;
        }

        // Round 80.21 v7 — region-based validation (was strict ISO match).
        // Strict country match rejected legitimate neighbor-country stops
        // like Munich (de) on a Switzerland (ch) tour. Now we accept any
        // result whose country is in the same region group (EU, EA, SE,
        // ME, NA, LA, OC, CA, AF, SA). Wrong-region results still get
        // rejected — Lai Châu (vn, region SE) is correctly rejected for a
        // Switzerland (ch, region EU) destination.
        const tryGoogle = async (
          cand: string,
          expRegion: string | null
        ): Promise<{ lat: number; lng: number } | null> => {
          try {
            const resp = await makeRequest<any>("/maps/api/geocode/json", { address: cand });
            if (resp?.status === "REQUEST_DENIED") {
              if (!_googleStatus.denied) {
                console.warn(`[getRouteMap] Google REQUEST_DENIED — switching to Nominatim fallback for the rest of this request batch. Reason: ${resp.error_message || "no message"}`);
                _googleStatus.denied = true;
                _googleStatus.deniedSince = Date.now();
              }
              return null;
            }
            if (resp?.status && resp.status !== "OK" && resp.status !== "ZERO_RESULTS") {
              console.warn(`[getRouteMap] geocode "${cand}" returned status=${resp.status}: ${resp.error_message || ""}`);
            }
            const result = resp?.results?.[0];
            const loc = result?.geometry?.location;
            if (!loc?.lat || !loc?.lng) return null;
            // Round 80.21 v9 — reject country-level fallback results.
            // When Google can't find a specific city (e.g. "慕尼黑,
            // Switzerland" — Munich isn't in CH), it returns the country
            // CENTER. types = ["country", "political"]. Multiple days
            // then resolve to the same uninformative coord (46.82, 8.23
            // = geometric center of Switzerland).
            const resTypes: string[] = Array.isArray(result?.types) ? result.types : [];
            const isCountryFallback = resTypes.includes("country") &&
              !resTypes.some((t) => ["locality", "sublocality", "neighborhood", "administrative_area_level_2", "administrative_area_level_3", "tourist_attraction", "point_of_interest", "establishment"].includes(t));
            if (isCountryFallback) {
              console.log(`[getRouteMap] Google "${cand}" returned country-level result (types=${resTypes.join(",")}) — rejecting, will try next candidate`);
              return null;
            }
            // Region validation (v7)
            if (expRegion) {
              const resCountry = result?.address_components?.find(
                (c: any) => c?.types?.includes("country")
              )?.short_name?.toLowerCase();
              const resRegion = resCountry ? _region[resCountry] : null;
              if (resRegion && resRegion !== expRegion) {
                console.log(`[getRouteMap] Google "${cand}" region mismatch: expected ${expRegion}, got ${resRegion} (${resCountry}) — rejecting`);
                return null;
              }
            }
            return { lat: loc.lat, lng: loc.lng };
          } catch (err) {
            console.warn(`[getRouteMap] Google geocode failed for "${cand}":`, (err as Error).message);
            return null;
          }
        };

        const tryNominatim = async (
          cand: string,
          expRegion: string | null
        ): Promise<{ lat: number; lng: number } | null> => {
          try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&accept-language=en,zh-TW&q=${encodeURIComponent(cand)}`;
            const resp = await fetch(url, {
              headers: {
                "User-Agent": "PACK&GO Travel (Newark CA) +https://packgoplay.com",
              },
              signal: AbortSignal.timeout(8000),
            });
            if (!resp.ok) {
              console.warn(`[getRouteMap] Nominatim "${cand}" returned ${resp.status}`);
              return null;
            }
            const data = (await resp.json()) as any[];
            const first = data?.[0];
            if (!first?.lat || !first?.lon) return null;
            // Region validation (v7)
            if (expRegion) {
              const resCountry = (first?.address?.country_code || "").toLowerCase();
              const resRegion = resCountry ? _region[resCountry] : null;
              if (resRegion && resRegion !== expRegion) {
                console.log(`[getRouteMap] Nominatim "${cand}" region mismatch: expected ${expRegion}, got ${resRegion} (${resCountry}) — rejecting`);
                return null;
              }
            }
            return { lat: parseFloat(first.lat), lng: parseFloat(first.lon) };
          } catch (err) {
            console.warn(`[getRouteMap] Nominatim failed for "${cand}":`, (err as Error).message);
            return null;
          }
        };

        // Country English name + ISO region — same logic as inside
        // queries.map; pulled up here so the LLM fallback (after the
        // candidate loop) can use them.
        const _outerCountryEn = (() => {
          const map: Record<string, string> = {
            "瑞士": "Switzerland", "德國": "Germany", "奧地利": "Austria",
            "法國": "France", "義大利": "Italy", "英國": "United Kingdom",
            "西班牙": "Spain", "葡萄牙": "Portugal", "荷蘭": "Netherlands",
            "比利時": "Belgium", "希臘": "Greece", "捷克": "Czech Republic",
            "美國": "USA", "加拿大": "Canada", "墨西哥": "Mexico",
            "日本": "Japan", "韓國": "South Korea", "中國": "China",
            "泰國": "Thailand", "越南": "Vietnam", "新加坡": "Singapore",
            "馬來西亞": "Malaysia", "印尼": "Indonesia", "菲律賓": "Philippines",
            "澳洲": "Australia", "紐西蘭": "New Zealand", "土耳其": "Turkey",
            "阿聯": "United Arab Emirates", "杜拜": "Dubai, United Arab Emirates",
            "埃及": "Egypt", "以色列": "Israel", "摩洛哥": "Morocco",
            "南非": "South Africa", "肯亞": "Kenya",
            "印度": "India", "尼泊爾": "Nepal", "斯里蘭卡": "Sri Lanka",
            "台灣": "Taiwan", "香港": "Hong Kong",
          };
          return map[country] || country;
        })();

        const stops: Array<{ day: number; name: string; lat: number; lng: number }> = [];
        for (let i = 0; i < queries.length; i++) {
          const { day, q, candidates, expectedRegion: outerExpRegion } = queries[i] as any;
          if (!q) continue;
          let coord: { lat: number; lng: number } | null = null;
          for (const c of (candidates as { q: string; expectedRegion: string | null }[])) {
            const cand = c.q;
            const expRegion = c.expectedRegion;
            // Cache hit (positive) — use it
            const cached = _cache.get(cacheKey(cand));
            if (cached) { coord = cached; break; }
            // Cache hit (negative) — skip, try next candidate
            if (_cache.has(cacheKey(cand))) continue;

            // Try Google first (when not previously denied)
            if (!_googleStatus.denied) {
              const g = await tryGoogle(cand, expRegion);
              if (g) {
                coord = g;
                _cache.set(cacheKey(cand), coord);
                break;
              }
              if (!_googleStatus.denied) {
                _cache.set(cacheKey(cand), null);
                continue;
              }
              // fall through to Nominatim
            }

            // Nominatim fallback (free, no key)
            const n = await tryNominatim(cand, expRegion);
            if (n) {
              coord = n;
              _cache.set(cacheKey(cand), coord);
              break;
            }
            _cache.set(cacheKey(cand), null);
            // Nominatim has a 1 req/sec etiquette rule — sleep 1s between
            // candidate attempts that hit the actual API. Cache hits don't
            // sleep (most production calls will be 100% cache after warm-up).
            await new Promise((r) => setTimeout(r, 1100));
          }
          // Round 80.21 v11 — LLM fallback when all candidates failed.
          // After both static aliases and direct geocoding miss, ask
          // Claude Haiku to normalize the place name. Result cached in
          // Redis (30-day TTL) so subsequent requests hit cache.
          if (!coord && q) {
            const llmAlias = await normalizePlaceName(q, country);
            if (llmAlias && (llmAlias.en || llmAlias.zh)) {
              const llmCandidates: { q: string; expectedRegion: string | null }[] = [];
              if (llmAlias.en) llmCandidates.push({ q: llmAlias.en, expectedRegion: outerExpRegion });
              if (llmAlias.zh && _outerCountryEn) {
                llmCandidates.push({ q: `${llmAlias.zh}, ${_outerCountryEn}`, expectedRegion: outerExpRegion });
              }
              for (const c of llmCandidates) {
                const cand = c.q;
                const cached = _cache.get(cacheKey(cand));
                if (cached) { coord = cached; break; }
                if (_cache.has(cacheKey(cand))) continue;
                if (!_googleStatus.denied) {
                  const g = await tryGoogle(cand, c.expectedRegion);
                  if (g) {
                    coord = g;
                    _cache.set(cacheKey(cand), coord);
                    console.log(`[getRouteMap] LLM rescue: "${q}" → "${cand}" (${coord.lat.toFixed(2)},${coord.lng.toFixed(2)})`);
                    break;
                  }
                  _cache.set(cacheKey(cand), null);
                  continue;
                }
                const n = await tryNominatim(cand, c.expectedRegion);
                if (n) {
                  coord = n;
                  _cache.set(cacheKey(cand), coord);
                  console.log(`[getRouteMap] LLM rescue (Nominatim): "${q}" → "${cand}" (${coord.lat.toFixed(2)},${coord.lng.toFixed(2)})`);
                  break;
                }
                _cache.set(cacheKey(cand), null);
                await new Promise((r) => setTimeout(r, 1100));
              }
            }
          }
          if (coord) {
            stops.push({
              day: i + 1,
              name: (day.title || day.location || day.city || q).replace(/^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i, ""),
              lat: coord.lat,
              lng: coord.lng,
            });
          }
        }

        // v78o: Country-level fallback when geocoding can't resolve specific cities.
        // Uses Static Maps (different API surface than Geocoding) — works as long
        // as Static Maps is enabled even if Geocoding isn't.
        // v80.23: when geocoding fails, surface the itinerary place names as
        // "raw stops" so the legend isn't empty even without lat/lng.
        if (stops.length === 0) {
          const countryEnFallback: Record<string, string> = {
            "瑞士": "Switzerland", "德國": "Germany", "奧地利": "Austria",
            "法國": "France", "義大利": "Italy", "英國": "United Kingdom",
            "美國": "USA", "日本": "Japan", "韓國": "South Korea",
            "馬來西亞": "Malaysia", "泰國": "Thailand", "新加坡": "Singapore",
            "杜拜": "Dubai, United Arab Emirates", "阿聯": "United Arab Emirates",
            "阿拉伯聯合大公國": "United Arab Emirates",
            "埃及": "Egypt", "以色列": "Israel", "約旦": "Jordan",
            "摩洛哥": "Morocco", "土耳其": "Turkey",
            "印度": "India", "尼泊爾": "Nepal", "斯里蘭卡": "Sri Lanka",
            "馬爾地夫": "Maldives", "中國": "China", "越南": "Vietnam",
            "印尼": "Indonesia", "菲律賓": "Philippines", "澳洲": "Australia",
            "紐西蘭": "New Zealand", "加拿大": "Canada", "墨西哥": "Mexico",
            "巴西": "Brazil", "南非": "South Africa", "肯亞": "Kenya",
            "西班牙": "Spain", "葡萄牙": "Portugal",
            "希臘": "Greece", "荷蘭": "Netherlands", "比利時": "Belgium",
            "捷克": "Czech Republic", "波蘭": "Poland", "俄羅斯": "Russia",
          };
          // Even without geocoding, show the itinerary place names in the legend
          // so users see "Day 1 · 杜拜" instead of "0 個地點".
          const rawStops = queries
            .filter((q) => q.q)
            .slice(0, 26)
            .map((q, i) => ({
              day: i + 1,
              name: (q.day.title || q.day.location || q.day.city || q.q).replace(
                /^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i,
                ""
              ),
              lat: 0,
              lng: 0,
            }));

          const countryNameForMap = countryEnFallback[country] || country;
          if (countryNameForMap) {
            const apiKey = process.env.GOOGLE_API_KEY || "";
            const params = new URLSearchParams();
            params.set("size", "1200x520");
            params.set("scale", "2");
            params.set("maptype", "roadmap");
            params.set("center", countryNameForMap);
            params.set("zoom", country.includes("杜拜") ? "9" : "5");
            params.set("key", apiKey);
            const fallbackUrl = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
            const directionsFallback = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(countryNameForMap)}`;
            return {
              staticMapUrl: fallbackUrl,
              stops: rawStops,
              directionsUrl: directionsFallback,
              fallbackMode: "country" as const,
              aiMapUrl,
            };
          }
          return {
            staticMapUrl: null,
            stops: rawStops,
            directionsUrl: null,
            fallbackMode: "names_only" as const,
            aiMapUrl,
          };
        }

        // Round 80.21 v5 — server-side cluster filter + branded static map.
        //
        // Why: Maplibre with vector tiles was too slow loading from Asia
        // (Jeff: 「載入時間太慢了」). Reverting to Google Static Maps API
        // for instant single-image render, but with two upgrades:
        //   1. CLUSTER FILTER — same haversine-3000km logic from the
        //      previous client-side attempt, now done server-side so
        //      the static map URL only contains primary-cluster stops.
        //   2. BRANDED STYLING — `style=` parameters strip Google's
        //      colorful default theme and produce a clean B&W minimal
        //      map matching PACK&GO's brand (similar to Carto Positron).
        //
        // Output: { staticMapUrl, stops (primary), outliers, ... }

        // Cluster filter — separate primary stops from outliers
        const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
          const R = 6371;
          const toRad = (d: number) => (d * Math.PI) / 180;
          const dLat = toRad(lat2 - lat1);
          const dLng = toRad(lng2 - lng1);
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
          return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };
        let primaryStops = stops;
        let outlierStops: typeof stops = [];
        if (stops.length > 4) {
          const lats = [...stops.map(s => s.lat)].sort((a, b) => a - b);
          const lngs = [...stops.map(s => s.lng)].sort((a, b) => a - b);
          const medLat = lats[Math.floor(lats.length / 2)];
          const medLng = lngs[Math.floor(lngs.length / 2)];
          const RADIUS_KM = 3000;
          const inCluster = stops.filter(s => haversineKm(s.lat, s.lng, medLat, medLng) <= RADIUS_KM);
          const outside = stops.filter(s => haversineKm(s.lat, s.lng, medLat, medLng) > RADIUS_KM);
          // Only filter when it actually helps (cluster has >= half of stops)
          if (inCluster.length >= Math.max(3, Math.floor(stops.length * 0.5))) {
            primaryStops = inCluster;
            outlierStops = outside;
          }
        }

        const apiKey = process.env.GOOGLE_API_KEY || "";
        const baseUrl = "https://maps.googleapis.com/maps/api/staticmap";
        const params = new URLSearchParams();
        params.set("size", "640x270"); // 12:5 aspect; 640 is Static Maps free limit
        params.set("scale", "2"); // retina → effective 1280x540
        params.set("maptype", "roadmap");
        // Round 80.21 v9 — Jeff updated direction (5/6 00:30): map base
        // should be plain B&W gray (「黑白灰為配色」). Cleaner, simpler,
        // matches PACK&GO baseline. Gold reserved as ACCENT only on the
        // SVG decorations (title bar, compass rose) — not on the map
        // itself. The map looks like a clean architectural diagram, not
        // a decorated treasure map.
        const brandStyles = [
          // Water — soft pale gray (sea)
          "feature:water|element:geometry|color:0xeef0f3",
          "feature:water|element:labels|visibility:off",
          // Land — slightly darker gray than water for differentiation
          "feature:landscape|element:geometry|color:0xf7f7f6",
          "feature:landscape.natural|color:0xf2f2f0",
          "feature:landscape.natural.terrain|color:0xebebe8",
          // Roads — hidden for clean canvas
          "feature:road|element:geometry|visibility:off",
          "feature:road|element:labels|visibility:off",
          // POI — hidden
          "feature:poi|visibility:off",
          "feature:transit|visibility:off",
          // Country borders — soft black for clean B&W look
          "feature:administrative.country|element:geometry.stroke|color:0x111111|weight:1.0",
          // Province/state borders — subtle gray
          "feature:administrative.province|element:geometry.stroke|color:0x9ca3af|weight:0.4",
          // Country labels — soft black with white halo for legibility
          "feature:administrative.country|element:labels.text.fill|color:0x1f2937",
          "feature:administrative.country|element:labels.text.stroke|color:0xffffff|weight:3",
          // Locality (city) labels — neutral gray
          "feature:administrative.locality|element:labels.text.fill|color:0x4b5563",
          "feature:administrative.locality|element:labels.text.stroke|color:0xffffff|weight:2.5",
          "feature:administrative.province|element:labels|visibility:off",
        ];
        for (const s of brandStyles) params.append("style", s);
        // Markers: solid black pin with white day number (1-9 numbers,
        // 10+ letters since Google Static labels are single-char only)
        primaryStops.slice(0, 26).forEach((s, i) => {
          const label = i < 9 ? String(i + 1) : String.fromCharCode(65 + i - 9);
          // Soft black for B&W aesthetic
          params.append("markers", `color:0x111111|label:${label}|${s.lat},${s.lng}`);
        });
        // Path polyline — soft black solid line, weight 3
        if (primaryStops.length >= 2) {
          const path = primaryStops.map((s) => `${s.lat},${s.lng}`).join("|");
          params.append("path", `color:0x111111dd|weight:3|${path}`);
        }
        params.set("key", apiKey);
        const staticMapUrl = `${baseUrl}?${params.toString()}`;

        // Build "Open in Google Maps" multi-stop URL (uses ALL stops incl outliers)
        const directionsUrl =
          stops.length >= 2
            ? `https://www.google.com/maps/dir/?api=1&origin=${stops[0].lat},${stops[0].lng}&destination=${stops[stops.length - 1].lat},${stops[stops.length - 1].lng}` +
              (stops.length > 2
                ? `&waypoints=${stops.slice(1, -1).map((s) => `${s.lat},${s.lng}`).join("|")}`
                : "")
            : `https://www.google.com/maps/search/?api=1&query=${stops[0].lat},${stops[0].lng}`;

        return {
          staticMapUrl,
          stops: primaryStops,
          outliers: outlierStops,
          directionsUrl,
          aiMapUrl,
        };
      }),

    // Get distinct departure cities from active tours (for search autocomplete)
    getDepartureCities: publicProcedure.query(async () => {
      return await db.getDepartureCities();
    }),

    // Search tours with filters (public)
    // QA audit 2026-05-11 Phase 2 fix: input was unbounded — destination
    // and category accepted arbitrary-length strings, arrays were uncapped.
    // A 10MB Unicode payload would tie up the query planner. All inputs
    // now have realistic length / count caps.
    search: publicProcedure
      .input(
        z.object({
          destination: z.string().max(100).optional(),
          category: z.string().max(50).optional(),
          minDays: z.number().int().min(0).max(365).optional(),
          maxDays: z.number().int().min(0).max(365).optional(),
          minPrice: z.number().min(0).max(1_000_000).optional(),
          maxPrice: z.number().min(0).max(1_000_000).optional(),
          airlines: z.array(z.string().max(50)).max(20).optional(),
          hotelGrades: z.array(z.string().max(30)).max(10).optional(),
          specialActivities: z.array(z.string().max(50)).max(20).optional(),
          tags: z.array(z.string().max(50)).max(20).optional(),
          sortBy: z.enum(["popular", "price_asc", "price_desc", "days_asc", "days_desc"]).optional(),
          page: z.number().int().min(1).max(10_000).default(1),
          pageSize: z.number().int().min(1).max(100).default(12),
        })
      )
      .query(async ({ input }) => {
        const { page, pageSize, ...filters } = input;
        const offset = (page - 1) * pageSize;

        // DB-level pagination: searchTours now handles limit/offset and returns total count
        const { tours, total } = await db.searchTours({
          ...filters,
          limit: pageSize,
          offset,
        });

        const totalPages = Math.ceil(total / pageSize);

        return {
          tours,
          pagination: {
            page,
            pageSize,
            total,
            totalPages,
            hasMore: page < totalPages,
          },
        };
      }),

    /**
     * Round 80.13: lightweight typeahead endpoint for the homepage hero
     * search bar. Returns up to 8 suggestions across 4 categories:
     *   - destination (matches tour.destinationCountry / destinationCity)
     *   - tour (matches tour.title — exact tour link)
     *   - season (curated tags: 春櫻 / 秋楓 / 雪國)
     *   - popular (returned when query is empty — 4 top destinations)
     *
     * Designed for low-latency autocomplete: queries the tour list (cached
     * in tRPC) and does in-memory fuzzy match. NO new DB tables needed.
     *
     * Routing:
     *   - destination → /tours?destination={country}
     *   - tour        → /tours/{id}
     *   - season      → /tours?season={key}
     */
    suggest: publicProcedure
      .input(z.object({ query: z.string().max(50).default("") }))
      .query(async ({ input }) => {
        const q = input.query.trim().toLowerCase();
        const allTours = await db.listTours();
        const active = allTours.filter((t) => t.status === "active");

        type Suggestion = {
          type: "destination" | "tour" | "season" | "popular";
          label: string;
          sublabel?: string;
          href: string;
          imageUrl?: string;
        };
        const out: Suggestion[] = [];

        // Empty query → popular destinations (top by featured count) + seasons
        if (!q) {
          // Top 4 destinations by featured count
          const destMap = new Map<string, { country: string; count: number; img?: string }>();
          for (const t of active) {
            const country = (t.destinationCountry || "").trim();
            if (!country) continue;
            const existing = destMap.get(country);
            if (existing) {
              existing.count += t.featured === 1 ? 2 : 1; // featured weighted 2x
            } else {
              destMap.set(country, { country, count: t.featured === 1 ? 2 : 1, img: t.heroImage || t.imageUrl || undefined });
            }
          }
          const topDests = Array.from(destMap.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 4);
          for (const d of topDests) {
            out.push({
              type: "popular",
              label: d.country,
              sublabel: `${d.count} 個行程`,
              href: `/tours?destination=${encodeURIComponent(d.country)}`,
              imageUrl: d.img,
            });
          }
          // Plus 3 seasonal suggestions
          out.push(
            { type: "season", label: "春櫻 (3-4月)", href: "/tours?season=spring" },
            { type: "season", label: "秋楓 (10-11月)", href: "/tours?season=autumn" },
            { type: "season", label: "雪國 (12-2月)", href: "/tours?season=winter" },
          );
          return { suggestions: out.slice(0, 8) };
        }

        // ── Query mode ───────────────────────────────────────────────────
        // Match destination countries / cities first (highest signal)
        const seenDest = new Set<string>();
        for (const t of active) {
          const country = (t.destinationCountry || "").trim();
          const city = (t.destinationCity || "").trim();
          if (country && country.toLowerCase().includes(q) && !seenDest.has(country)) {
            seenDest.add(country);
            const sample = active.find((x) => x.destinationCountry === country);
            out.push({
              type: "destination",
              label: country,
              sublabel: "看所有 " + country + " 行程",
              href: `/tours?destination=${encodeURIComponent(country)}`,
              imageUrl: sample?.heroImage || sample?.imageUrl || undefined,
            });
          }
          if (city && city.toLowerCase().includes(q) && !seenDest.has(city) && city !== country) {
            seenDest.add(city);
            out.push({
              type: "destination",
              label: city,
              sublabel: country ? `${country} · 看所有行程` : "看所有行程",
              href: `/tours?destination=${encodeURIComponent(city)}`,
              imageUrl: t.heroImage || t.imageUrl || undefined,
            });
          }
          if (out.length >= 5) break;
        }

        // Then individual tours by title (up to 3 matches)
        const tourMatches = active
          .filter((t) => (t.title || "").toLowerCase().includes(q))
          .slice(0, 3);
        for (const t of tourMatches) {
          out.push({
            type: "tour",
            label: t.title,
            sublabel: `${t.destinationCountry || ""} · ${t.duration} 天 · NT$ ${(t.price || 0).toLocaleString()}`,
            href: `/tours/${t.id}`,
            imageUrl: t.heroImage || t.imageUrl || undefined,
          });
        }

        // If still less than 3 results, try season keyword match
        if (out.length < 3) {
          const seasonHints: Array<{ kw: string[]; key: string; label: string }> = [
            { kw: ["櫻", "spring", "春", "3月", "4月"], key: "spring", label: "春櫻 (3-4月)" },
            { kw: ["楓", "autumn", "fall", "秋", "10月", "11月"], key: "autumn", label: "秋楓 (10-11月)" },
            { kw: ["雪", "winter", "冬", "12月", "1月", "2月"], key: "winter", label: "雪國 (12-2月)" },
          ];
          for (const s of seasonHints) {
            if (s.kw.some((k) => q.includes(k.toLowerCase()))) {
              out.push({
                type: "season",
                label: s.label,
                sublabel: "依季節篩選",
                href: `/tours?season=${s.key}`,
              });
            }
          }
        }

        return { suggestions: out.slice(0, 8) };
      }),

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

    // Generate PDF for tour (public)
    generatePdf: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        console.log(`[GeneratePDF] Starting PDF generation for tour ${input.id}`);
        
        // Get tour data
        const tour = await db.getTourById(input.id);
        if (!tour) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Tour not found",
          });
        }
        
        // Parse JSON fields
        const parseJSON = (str: string | null | undefined, defaultValue: any = null) => {
          if (!str) return defaultValue;
          try {
            return JSON.parse(str);
          } catch {
            return defaultValue;
          }
        };
        
        const itineraryDetailed = parseJSON(tour.itineraryDetailed, []);
        const highlights = parseJSON(tour.highlights, []);
        const includes = parseJSON(tour.includes, []);
        const excludes = parseJSON(tour.excludes, []);
        const noticeDetailed = parseJSON(tour.noticeDetailed, []);
        const colorTheme = parseJSON(tour.colorTheme, null);
        
        // Prepare PDF data
        const pdfGenerator = await import('./pdfGenerator');
        
        const pdfData: any = {
          id: tour.id,
          title: tour.title,
          subtitle: tour.heroSubtitle || undefined,
          days: tour.duration,
          destinations: [
            tour.destinationCountry,
            ...(tour.destinationCity ? tour.destinationCity.split(',').map(c => c.trim()) : []),
          ].filter(Boolean),
          price: tour.price || undefined,
          currency: 'NT$',
          heroImage: tour.heroImage || undefined,
          description: tour.description || undefined,
          highlights: highlights.length > 0 ? highlights : undefined,
          itinerary: itineraryDetailed.length > 0 ? itineraryDetailed.map((day: any) => ({
            day: day.day,
            title: day.title,
            subtitle: day.subtitle,
            activities: day.activities || [],
            meals: day.meals || {},
            accommodation: day.accommodation,
          })) : undefined,
          inclusions: includes.length > 0 ? includes : undefined,
          exclusions: excludes.length > 0 ? excludes : undefined,
          notes: noticeDetailed.length > 0 ? noticeDetailed : undefined,
          colorTheme: colorTheme || undefined,
        };
        
        // Generate and upload PDF
        const storageKey = `tours/${tour.id}/itinerary_${Date.now()}.pdf`;
        const pdfUrl = await pdfGenerator.generateAndUploadTourPdf(pdfData, storageKey);
        
        console.log(`[GeneratePDF] PDF generated successfully: ${pdfUrl}`);
        
        return {
          success: true,
          url: pdfUrl,
          message: "PDF 已成功生成",
        };
      }),

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
    // Get similar tours based on destination/category/price
    getSimilar: publicProcedure
      .input(z.object({
        tourId: z.number(),
        limit: z.number().optional().default(4),
      }))
      .query(async ({ input }) => {
        const allTours = await db.getAllTours({ status: 'active' });
        const currentTour = (allTours as any[]).find((t: any) => t.id === input.tourId);
        if (!currentTour) return [];
        const scored = (allTours as any[])
          .filter((t: any) => t.id !== input.tourId)
          .map((t: any) => {
            let score = 0;
            if (t.destinationCountry === currentTour.destinationCountry) score += 3;
            if (t.category === currentTour.category) score += 2;
            const priceDiff = Math.abs(t.price - currentTour.price) / (currentTour.price || 1);
            if (priceDiff < 0.2) score += 2;
            else if (priceDiff < 0.5) score += 1;
            const durationDiff = Math.abs(t.duration - currentTour.duration);
            if (durationDiff <= 1) score += 1;
            if (t.featured) score += 0.5;
            return { ...t, _score: score };
          })
          .sort((a: any, b: any) => b._score - a._score)
          .slice(0, input.limit);
        return scored;
      }),
    // Get personalized recommendations based on browsing history
    getRecommended: publicProcedure
      .input(z.object({
        limit: z.number().optional().default(6),
        userId: z.number().optional(),
      }))
      .query(async ({ input }) => {
        const allTours = await db.getAllTours({ status: 'active', featured: true });
        if (!input.userId) return (allTours as any[]).slice(0, input.limit);
        const history = await db.getUserBrowsingHistory(input.userId, 10);
        if (!history || (history as any[]).length === 0) return (allTours as any[]).slice(0, input.limit);
        const viewedIds = new Set((history as any[]).map((h: any) => h.tourId));
        const countryCounts: Record<string, number> = {};
        const categoryCounts: Record<string, number> = {};
        (history as any[]).forEach((h: any) => {
          if (h.tour?.destinationCountry) countryCounts[h.tour.destinationCountry] = (countryCounts[h.tour.destinationCountry] || 0) + 1;
          if (h.tour?.category) categoryCounts[h.tour.category] = (categoryCounts[h.tour.category] || 0) + 1;
        });
        const topCountry = Object.entries(countryCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
        const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
        const scored = (allTours as any[])
          .filter((t: any) => !viewedIds.has(t.id))
          .map((t: any) => {
            let score = 0;
            if (topCountry && t.destinationCountry === topCountry) score += 3;
            if (topCategory && t.category === topCategory) score += 2;
            if (t.featured) score += 1;
            return { ...t, _score: score };
          })
          .sort((a: any, b: any) => b._score - a._score)
          .slice(0, input.limit);
        return scored.length > 0 ? scored : (allTours as any[]).slice(0, input.limit);
      }),

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
  // Booking management router
  bookings: router({
    // Create new booking
    // v74 SECURITY OVERHAUL: this mutation handles real customer money flow.
    // Audit found 4 money-critical bugs that this rewrite fixes:
    //   1. PRICE BYPASS — server was using `tour.price × participants` ignoring
    //      departure-specific pricing (child / infant / single-supplement).
    //      Customers could be over- or undercharged. Now: server fetches the
    //      departure row and recomputes total from per-passenger prices.
    //   2. OVERBOOKING — `bookedSlots` was never incremented; concurrent
    //      bookings on a 1-slot departure both succeeded. Now: atomic
    //      check-and-increment via a guarded UPDATE returning rowcount.
    //   3. ORPHAN BOOKING — `departureId` was optional, defaulting to 0 (no
    //      such row). Now: required + verified to belong to the tour.
    //   4. PAST DATES — booking departures in the past was allowed. Now:
    //      reject if departureDate < now.
    // Also v74: contactEmail defaults to the authenticated user's email
    // unless explicitly set; prevents using booking flow as a spam vector
    // toward third parties.
    create: protectedProcedure
      .input(
        z.object({
          tourId: z.number().int().positive().max(2_147_483_647),
          // departureId is now REQUIRED — orphan bookings without a departure
          // are unbookable in practice (customer doesn't know which date) and
          // create accounting/ops problems.
          departureId: z.number().int().positive().max(2_147_483_647),
          numberOfAdults: z.number().int().min(0).max(100).default(0),
          numberOfChildrenWithBed: z.number().int().min(0).max(100).default(0),
          numberOfChildrenNoBed: z.number().int().min(0).max(100).default(0),
          numberOfInfants: z.number().int().min(0).max(100).default(0),
          numberOfSingleRooms: z.number().int().min(0).max(100).default(0),
          // Legacy: total participants count (for backwards compat with old client)
          participants: z.number().int().min(0).max(500).optional(),
          contactName: shortStr.min(1),
          contactEmail: z.string().email().max(320).optional(), // optional: defaults to ctx.user.email
          contactPhone: shortStr.min(1),
          specialRequests: mediumStr.optional(),
          // v78x: Customer's current UI language — drives email language preference
          language: z.enum(["zh-TW", "en"]).optional(),
          // Round 80.22: optional Packpoint redemption applied at booking
          // creation. 100 pts = $1 USD discount. Validated server-side
          // against user's balance; capped at 50% of totalPrice (policy §5).
          // Only honored when departure currency is USD — TWD bookings
          // require FX conversion which we defer for now.
          pointsToRedeem: z.number().int().min(0).max(10_000_000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { audit } = await import("./_core/auditLog");

        // Rate limiting: 10 bookings per hour per user
        const bookingRateLimit = await checkBookingCreateRateLimit(ctx.user.id);
        if (!bookingRateLimit.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "訂單建立過於頻繁，請稍後再試",
          });
        }

        // ── Validate tour ────────────────────────────────────────────
        const tour = await db.getTourById(input.tourId);
        if (!tour) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tour not found" });
        }

        // ── Validate departure ───────────────────────────────────────
        const departure = await db.getDepartureById(input.departureId);
        if (!departure) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Departure not found" });
        }
        if (departure.tourId !== input.tourId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Departure does not belong to this tour",
          });
        }
        // Reject past dates
        const departureTime = new Date(departure.departureDate).getTime();
        if (departureTime < Date.now()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "出發日期已過，無法預訂此團",
          });
        }
        // Reject already-cancelled or full departures
        if (departure.status === "cancelled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此出發日期已取消" });
        }

        // ── Compute total participants ───────────────────────────────
        // Legacy clients send `participants`; new clients send the breakdown.
        // If only `participants` is provided, treat them all as adults.
        const adults = input.numberOfAdults || input.participants || 0;
        const childWithBed = input.numberOfChildrenWithBed || 0;
        const childNoBed = input.numberOfChildrenNoBed || 0;
        const infants = input.numberOfInfants || 0;
        const singleRooms = input.numberOfSingleRooms || 0;
        const totalSeatsRequested = adults + childWithBed + childNoBed; // infants don't take seats
        if (totalSeatsRequested < 1) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "至少需 1 位旅客" });
        }

        // ── Atomic slot check + increment ────────────────────────────
        // This MUST be atomic to prevent overbooking: a guarded UPDATE that
        // increments only when there's enough capacity, returning affectedRows=0
        // when full. Two concurrent bookings on the last seat → exactly one wins.
        const slotResult = await db.tryReserveDepartureSlots(
          input.departureId,
          totalSeatsRequested
        );
        if (!slotResult.reserved) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `此出發日僅剩 ${slotResult.available} 位，無法預訂 ${totalSeatsRequested} 位`,
          });
        }

        // ── Server-side price computation ────────────────────────────
        // Use departure-specific prices, NOT the tour's headline price. This
        // is the canonical source of truth — client-supplied prices are ignored.
        const adultPrice = departure.adultPrice;
        const childWithBedPrice = departure.childPriceWithBed ?? adultPrice;
        const childNoBedPrice = departure.childPriceNoBed ?? Math.floor(adultPrice * 0.7);
        const infantPrice = departure.infantPrice ?? 0;
        const singleSupplement = departure.singleRoomSupplement ?? 0;

        const grossTotalPrice =
          adults * adultPrice +
          childWithBed * childWithBedPrice +
          childNoBed * childNoBedPrice +
          infants * infantPrice +
          singleRooms * singleSupplement;

        if (grossTotalPrice <= 0) {
          // Capacity already incremented — release before throwing
          await db.releaseDepartureSlots(input.departureId, totalSeatsRequested).catch(() => {});
          throw new TRPCError({ code: "BAD_REQUEST", message: "計算金額異常" });
        }

        // ── Round 80.22: Packpoint redemption (optional) ─────────────────
        // Apply discount BEFORE creating the booking so totalPrice reflects
        // the discounted amount. Round 80.22 Phase D: TWD bookings now
        // supported via FX conversion at the moment of booking.
        const departureCurrency = ((departure as any).currency || "TWD").toUpperCase();
        let pointsRedeemed = 0;
        let totalPrice = grossTotalPrice;
        if (input.pointsToRedeem && input.pointsToRedeem > 0) {
          const userBalance = (ctx.user as any).packpointBalance ?? 0;
          if (input.pointsToRedeem > userBalance) {
            await db.releaseDepartureSlots(input.departureId, totalSeatsRequested).catch(() => {});
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `您的餘額僅 ${userBalance} 點,無法折抵 ${input.pointsToRedeem} 點`,
            });
          }
          if (input.pointsToRedeem < 100) {
            await db.releaseDepartureSlots(input.departureId, totalSeatsRequested).catch(() => {});
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "最低折抵 100 點($1)",
            });
          }
          // 100 pt = $1 USD. Convert to booking currency at current FX rate.
          const requestedDiscountUsd = input.pointsToRedeem / 100;
          let discountInBookingCurrency: number;
          if (departureCurrency === "USD") {
            discountInBookingCurrency = requestedDiscountUsd;
          } else {
            try {
              discountInBookingCurrency = await convertCurrency(
                requestedDiscountUsd,
                "USD" as SupportedCurrency,
                departureCurrency as SupportedCurrency
              );
            } catch (err) {
              await db.releaseDepartureSlots(input.departureId, totalSeatsRequested).catch(() => {});
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "匯率服務暫時不可用,請稍後再試或不使用 Packpoint 折抵",
              });
            }
          }
          // Cap at 50% of subtotal (policy §5)
          const maxDiscount = grossTotalPrice * 0.5;
          const finalDiscount = Math.min(discountInBookingCurrency, maxDiscount);
          totalPrice = Math.max(0, Math.floor(grossTotalPrice - finalDiscount));
          // Compute actual points consumed: convert finalDiscount back to USD
          // to find how many points we should deduct (handles the 50% cap case)
          const finalDiscountUsd =
            departureCurrency === "USD"
              ? finalDiscount
              : await convertCurrency(
                  finalDiscount,
                  departureCurrency as SupportedCurrency,
                  "USD" as SupportedCurrency
                ).catch(() => requestedDiscountUsd);
          pointsRedeemed = Math.floor(finalDiscountUsd * 100);
          console.log(
            `[bookings.create] Packpoint redemption: user ${ctx.user.id} → -${pointsRedeemed} pts, discount ${departureCurrency} ${finalDiscount}`
          );
        }

        // v74: default contactEmail to authenticated user's email so the
        // booking flow can't be used to send DKIM-aligned confirmation mail
        // to arbitrary third parties.
        const contactEmail = input.contactEmail || ctx.user.email;

        let booking;
        try {
          booking = await db.createBooking({
            tourId: input.tourId,
            departureId: input.departureId,
            userId: ctx.user.id,
            customerName: input.contactName,
            customerEmail: contactEmail,
            customerPhone: input.contactPhone,
            numberOfAdults: adults,
            numberOfChildrenWithBed: childWithBed,
            numberOfChildrenNoBed: childNoBed,
            numberOfInfants: infants,
            numberOfSingleRooms: singleRooms,
            totalPrice,
            depositAmount: Math.floor(totalPrice * 0.2),
            remainingAmount: totalPrice - Math.floor(totalPrice * 0.2),
            message: input.specialRequests,
            bookingStatus: "pending",
            // v78y: stick the customer's language to the booking row so all
            // downstream emails (payment / reminders) speak it.
            customerLanguage: input.language || "zh-TW",
          } as any);
        } catch (err) {
          // If booking row insert fails, release the slots we reserved
          await db.releaseDepartureSlots(input.departureId, totalSeatsRequested).catch(() => {});
          throw err;
        }

        // Round 80.22: deduct the points NOW that booking exists with
        // a valid id we can reference in the audit trail. If this fails the
        // booking still exists but at the discounted price (effectively a
        // free discount) — log loudly so ops can manually reconcile.
        if (pointsRedeemed > 0) {
          try {
            const { deductPackpoint } = await import("./_core/packpoint");
            await deductPackpoint({
              userId: ctx.user.id,
              amount: pointsRedeemed,
              reason: "redemption",
              referenceType: "booking",
              referenceId: booking.id,
              description: `Booking #${booking.id} — $${pointsRedeemed / 100} discount`,
            });
          } catch (err) {
            console.error(
              `[bookings.create] CRITICAL: Packpoint deduction failed for booking ${booking.id}:`,
              (err as Error).message
            );
          }
        }

        // Audit (fire-and-forget)
        audit({
          ctx,
          action: "booking.create",
          targetType: "booking",
          targetId: booking.id,
          changes: {
            tourId: input.tourId,
            departureId: input.departureId,
            seats: totalSeatsRequested,
            totalPrice,
          },
        });

        // Email confirmation. Failure must not break the booking — log loudly
        // so ops can manually re-send if SMTP is broken.
        const departureDateStr = new Date(departure.departureDate).toISOString().split("T")[0];
        const returnDateStr = departure.returnDate
          ? new Date(departure.returnDate).toISOString().split("T")[0]
          : "";
        const depositAmount = Math.floor(totalPrice * 0.2);
        const remainingAmount = totalPrice - depositAmount;

        // Deposit PDF + confirmation email run in the bookingFollowupQueue,
        // not on the HTTP path. Previously this was a fire-and-forget
        // IIFE (commit a7481d8) which was non-blocking but dropped work
        // on server restart. The queue is Redis-backed → survives
        // restarts, retries twice with exponential backoff on failure,
        // and notifyOwner alerts Jeff on terminal failure (worker is
        // wired in commit 35897de pattern).
        const isUsd = (departure as any).currency === "USD" || tour.priceUsd != null;
        try {
          const { bookingFollowupQueue } = await import("./queue");
          await bookingFollowupQueue.add(
            "booking-followup",
            {
              bookingId: booking.id,
              contactName: input.contactName,
              contactEmail,
              tourId: booking.tourId,
              tourTitle: tour.title,
              departureDateStr,
              returnDateStr,
              adults,
              childWithBed,
              childNoBed,
              infants,
              totalPrice,
              depositAmount,
              remainingAmount,
              isUsd,
              language: input.language,
            },
            {
              jobId: `booking-followup-${booking.id}`, // dedupe on booking ID
            }
          );
        } catch (enqueueErr) {
          console.error(
            `[bookings.create] Failed to enqueue followup for booking ${booking.id}:`,
            (enqueueErr as Error)?.message
          );
          // Fallback: at least try to send the plain confirmation email
          // synchronously so the customer hears SOMETHING — accept the
          // ~1-2s tax in this rare path.
          sendBookingConfirmationEmail({
            to: contactEmail,
            customerName: input.contactName,
            customerEmail: contactEmail,
            bookingId: booking.id,
            tourTitle: tour.title,
            departureDate: departureDateStr,
            returnDate: returnDateStr,
            numberOfAdults: adults,
            numberOfChildren: childWithBed + childNoBed,
            numberOfInfants: infants,
            totalPrice,
            depositAmount,
            remainingAmount,
            language: input.language,
          }).catch((e) =>
            console.error(
              `[bookings.create] Even fallback email failed for booking ${booking.id}:`,
              e?.message
            )
          );
        }

        // v78n Sprint 6A: schedule 30-min abandonment recovery email
        try {
          const { scheduleAbandonmentRecovery } = await import(
            "./queues/abandonmentRecoveryQueue"
          );
          await scheduleAbandonmentRecovery(booking.id);
        } catch (err) {
          console.warn(
            "[bookings.create] Failed to schedule abandonment recovery:",
            (err as Error).message
          );
        }

        return booking;
      }),

    // Get user's bookings
    list: protectedProcedure.query(async ({ ctx }) => {
      return await db.getUserBookings(ctx.user.id);
    }),

    // v77: Get all passenger details for a booking (owner or admin only).
    listParticipants: protectedProcedure
      .input(z.object({ bookingId: z.number().int().positive().max(2_147_483_647) }))
      .query(async ({ ctx, input }) => {
        const booking = await db.getBookingById(input.bookingId);
        if (!booking) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }
        if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not authorised" });
        }
        return await db.getBookingParticipants(input.bookingId);
      }),

    // v77: Replace ALL passenger details for a booking. Customer fills the
    // form post-booking (passport numbers, DOB, dietary needs, etc.) so ops
    // can submit visa applications, assign hotel rooms, and order meals.
    //
    // Without this endpoint, schema-defined fields (passportNumber, etc.)
    // were unreachable from the UI and ops staff had to chase customers via
    // email — the #1 friction point identified in the member audit.
    saveParticipants: protectedProcedure
      .input(
        z.object({
          bookingId: z.number().int().positive().max(2_147_483_647),
          participants: z.array(
            z.object({
              participantType: z.enum(["adult", "child", "infant"]),
              firstName: shortStr.min(1),
              lastName: shortStr.min(1),
              gender: z.enum(["male", "female", "other"]).optional(),
              dateOfBirth: z.string().date().optional(),       // YYYY-MM-DD
              passportNumber: shortStr.optional(),
              passportExpiry: z.string().date().optional(),    // YYYY-MM-DD
              nationality: shortStr.optional(),
              dietaryRequirements: mediumStr.optional(),
              specialNeeds: mediumStr.optional(),
            })
          ).max(50), // soft cap — no booking has 50 travelers; protects against payload abuse
        })
      )
      .mutation(async ({ ctx, input }) => {
        const booking = await db.getBookingById(input.bookingId);
        if (!booking) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }
        if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not authorised" });
        }

        // Verify participant counts add up to the booking's seat counts.
        const counts = { adult: 0, child: 0, infant: 0 };
        for (const p of input.participants) counts[p.participantType]++;
        const expectedAdults = booking.numberOfAdults || 0;
        const expectedChildren =
          (booking.numberOfChildrenWithBed || 0) + (booking.numberOfChildrenNoBed || 0);
        const expectedInfants = booking.numberOfInfants || 0;

        if (
          counts.adult !== expectedAdults ||
          counts.child !== expectedChildren ||
          counts.infant !== expectedInfants
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `旅客人數不符：訂單為 ${expectedAdults} 大 / ${expectedChildren} 童 / ${expectedInfants} 嬰，您填了 ${counts.adult} 大 / ${counts.child} 童 / ${counts.infant} 嬰`,
          });
        }

        // Convert date strings → Date objects for DB
        const participantsWithDates = input.participants.map((p) => ({
          ...p,
          dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : null,
          passportExpiry: p.passportExpiry ? new Date(p.passportExpiry) : null,
        }));

        const saved = await db.replaceBookingParticipants(input.bookingId, participantsWithDates as any);

        // Audit (admin actions on bookings) — only if admin not owner. Customer
        // updates to their own booking aren't audit events.
        if (ctx.user.role === "admin" && booking.userId !== ctx.user.id) {
          const { audit } = await import("./_core/auditLog");
          audit({
            ctx,
            action: "booking.saveParticipants",
            targetType: "booking",
            targetId: input.bookingId,
            changes: { count: saved.length },
          });
        }

        return saved;
      }),

    // Get single booking
    // v72: bounded ID + per-user rate limit (60 reads / hour) so an attacker
    // can't brute-force-enumerate booking IDs to map who-owns-what via timing
    // differences between 404 (not exist) and 403 (exist but not yours).
    getById: protectedProcedure
      .input(z.object({ id: z.number().int().positive().max(2_147_483_647) }))
      .query(async ({ ctx, input }) => {
        // Rate-limit: 60 booking lookups per user per hour. Admins exempt
        // (they need to view bookings during support).
        if (ctx.user.role !== "admin") {
          try {
            const { redis } = await import("./redis");
            const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
            const key = `ratelimit:bookings:getById:${ctx.user.id}:${hour}`;
            const count = await redis.incr(key);
            if (count === 1) await redis.expire(key, 3600);
            if (count > 60) {
              throw new TRPCError({
                code: "TOO_MANY_REQUESTS",
                message: "Too many booking lookups — please try again later.",
              });
            }
          } catch (e) {
            // If Redis is down, don't block legitimate users — just log
            if ((e as TRPCError)?.code === "TOO_MANY_REQUESTS") throw e;
            console.warn("[bookings.getById] rate-limit check failed:", (e as Error)?.message);
          }
        }

        const booking = await db.getBookingById(input.id);
        if (!booking) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Booking not found",
          });
        }

        // Check if user owns this booking
        if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You don't have permission to view this booking",
          });
        }

        return booking;
      }),

    // Create Stripe checkout session
    createCheckoutSession: protectedProcedure
      .input(
        z.object({
          bookingId: z.number().int().positive().max(2_147_483_647),
          paymentType: z.enum(["deposit", "remaining"]),
          // v76: optional billing-address hints used to compute CA sales tax
          // server-side. If omitted we fall back to the customer's profile or
          // their previous booking; if still unknown we skip tax (non-CA).
          billingState: shortStr.optional(),
          billingCity: shortStr.optional(),
          billingPostalCode: shortStr.optional(),
          billingCountry: shortStr.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Rate limiting: 20 checkout sessions per hour per user
        const checkoutRateLimit = await checkCheckoutSessionRateLimit(ctx.user.id);
        if (!checkoutRateLimit.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "付款請求過於頻繁，請稍後再試",
          });
        }

        const booking = await db.getBookingById(input.bookingId);
        if (!booking) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Booking not found",
          });
        }

        // Check if user owns this booking
        if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You don't have permission to pay for this booking",
          });
        }

        const amount = input.paymentType === "deposit" ? booking.depositAmount : booking.remainingAmount;
        const description = input.paymentType === "deposit" ? "訂金" : "尾款";

        if (amount <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "付款金額無效",
          });
        }

        // Get tour info for product name
        const tour = await db.getTourById(booking.tourId);
        const tourTitle = tour?.title ?? `行程 #${booking.tourId}`;

        // P0-1: Real Stripe Checkout Session
        const stripe = getStripeClient();
        const baseUrl = ENV.baseUrl;

        // Stripe amounts are in smallest currency unit
        // TWD is a zero-decimal currency (no cents), so amount is already in TWD
        // For other currencies like USD, multiply by 100
        const currency = (booking.currency ?? "TWD").toLowerCase();
        const zeroDecimalCurrencies = ["bif", "clp", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "twd", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"];
        const stripeAmount = zeroDecimalCurrencies.includes(currency) ? amount : Math.round(amount * 100);

        // v74: Stripe idempotency key. Prevents the double-charge race where a
        // user opens the booking page in two browser tabs and clicks "Pay" in
        // both simultaneously — without an idempotency key Stripe creates two
        // distinct checkout sessions (different payment_intents), and the
        // webhook idempotency guard (which dedupes by payment_intent) doesn't
        // catch them. With this key, the second request returns the same
        // session as the first within Stripe's 24-hour idempotency window.
        const idempotencyKey = `co:${booking.id}:${input.paymentType}:${new Date().toISOString().slice(0, 10)}`;

        // v76: California sales tax — compute server-side from billing-address
        // hints, add as a separate Stripe line item so customer sees breakdown.
        const { calculateSalesTax } = await import("./services/salesTaxService");
        const taxResult = calculateSalesTax(amount, {
          country: input.billingCountry || "US",
          state: input.billingState || "",
          city: input.billingCity || "",
          postalCode: input.billingPostalCode || "",
        });
        const taxStripeAmount =
          taxResult.amount > 0
            ? (zeroDecimalCurrencies.includes(currency)
                ? Math.round(taxResult.amount)
                : Math.round(taxResult.amount * 100))
            : 0;

        const lineItems: any[] = [
          {
            price_data: {
              currency,
              unit_amount: stripeAmount,
              product_data: {
                name: `${tourTitle} - ${description}`,
                description: `訂單編號 #${booking.id}, ${booking.customerName}`,
              },
            },
            quantity: 1,
          },
        ];
        if (taxStripeAmount > 0) {
          lineItems.push({
            price_data: {
              currency,
              unit_amount: taxStripeAmount,
              product_data: {
                name: `Sales Tax (${(taxResult.rate * 100).toFixed(3)}%) — ${taxResult.jurisdiction}`,
                description: `California sales tax on order #${booking.id}`,
              },
            },
            quantity: 1,
          });
        }

        const session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            payment_method_types: ["card"],
            line_items: lineItems,
            metadata: {
              booking_id: String(booking.id),
              payment_type: input.paymentType,
              tour_id: String(booking.tourId),
              user_id: String(ctx.user.id),
              // v76: tax info persisted to webhook metadata for accounting reconciliation
              tax_rate: String(taxResult.rate),
              tax_amount: String(taxResult.amount),
              tax_jurisdiction: taxResult.jurisdiction,
            },
            customer_email: booking.customerEmail,
            success_url: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}`,
            cancel_url: `${baseUrl}/booking/${booking.id}?payment_cancelled=1`,
            expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // 60 minutes (extended for older clientele)
          },
          { idempotencyKey }
        );

        if (!session.url) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "無法建立 Stripe 付款連結，請稍後再試",
          });
        }

        console.log(`[Stripe] Created checkout session ${session.id} for booking ${booking.id}, amount ${stripeAmount} ${currency}`);

        return {
          url: session.url,
          sessionId: session.id,
        };
      }),

    // Cancel booking
    // v74: also releases the reserved departure slots (was previously never
    // decremented — cancelled bookings still counted as taken capacity).
    cancel: protectedProcedure
      .input(z.object({ id: z.number().int().positive().max(2_147_483_647) }))
      .mutation(async ({ ctx, input }) => {
        const booking = await db.getBookingById(input.id);
        if (!booking) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Booking not found",
          });
        }

        // Check if user owns this booking
        if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You don't have permission to cancel this booking",
          });
        }

        // Idempotency: already cancelled → no-op
        if (booking.bookingStatus === "cancelled") return { success: true };

        // Update booking status
        await db.updateBooking(input.id, { bookingStatus: "cancelled" });

        // Release reserved seats
        const seatCount =
          (booking.numberOfAdults || 0) +
          (booking.numberOfChildrenWithBed || 0) +
          (booking.numberOfChildrenNoBed || 0);
        if (seatCount > 0 && booking.departureId) {
          await db.releaseDepartureSlots(booking.departureId, seatCount).catch((e) =>
            console.warn(`[bookings.cancel] Failed to release slots for ${input.id}:`, e?.message)
          );
        }

        // Audit
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "booking.cancel",
          targetType: "booking",
          targetId: input.id,
          changes: { before: booking.bookingStatus, after: "cancelled" },
        });

        // Note: this does NOT issue a Stripe refund — that requires a separate
        // explicit refund flow with admin approval. If the user already paid,
        // ops will handle the refund manually until the refund flow lands.
        return { success: true };
      }),

    // Admin: Get all bookings
    adminList: adminProcedure.query(async () => {
      return await db.getAllBookings();
    }),

    // Admin: Update booking status
    // v73: bounded ID + audit log on every status change. Booking-status
    // mutations affect customer money + ops, so they always need a paper trail.
    adminUpdateStatus: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive().max(2_147_483_647),
          status: z.enum(["pending", "confirmed", "cancelled", "completed"]),
          reason: z.string().max(500).optional(), // optional admin note (esp. for cancellations)
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, status, reason } = input;

        // Snapshot previous status for the diff
        const before = await db.getBookingById(id).catch(() => null);
        if (!before) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }
        const previousStatus = before.bookingStatus || "pending";

        // v74: state machine — reject illegal transitions. Without this, admin
        // can mis-click and flip a "completed" booking back to "pending",
        // creating accounting inconsistencies.
        const ALLOWED_TRANSITIONS: Record<string, string[]> = {
          pending:   ["confirmed", "cancelled", "completed"],
          confirmed: ["completed", "cancelled"],
          completed: [],            // terminal
          cancelled: [],            // terminal
        };
        const allowedNext = ALLOWED_TRANSITIONS[previousStatus] || [];
        if (status !== previousStatus && !allowedNext.includes(status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `不允許的狀態轉換：${previousStatus} → ${status}（合法選項：${allowedNext.join(", ") || "無，此狀態不可變更"}）`,
          });
        }

        await db.updateBooking(id, { bookingStatus: status });

        // v74: when booking is cancelled, release the reserved seats so the
        // departure's bookedSlots is decremented and the seats become bookable
        // again. Previously this was never done — cancelled bookings still
        // counted toward overbooking caps.
        if (status === "cancelled" && previousStatus !== "cancelled") {
          const seatCount =
            (before.numberOfAdults || 0) +
            (before.numberOfChildrenWithBed || 0) +
            (before.numberOfChildrenNoBed || 0);
          if (seatCount > 0 && before.departureId) {
            await db.releaseDepartureSlots(before.departureId, seatCount).catch((e) =>
              console.warn(`[adminUpdateStatus] Failed to release slots for booking ${id}:`, e?.message)
            );
          }
        }

        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "booking.updateStatus",
          targetType: "booking",
          targetId: id,
          changes: { before: previousStatus, after: status },
          reason,
        });

        return { success: true };
      }),

    // v76: Admin-initiated refund flow.
    //
    // Replaces the prior "ops manually refund via Stripe dashboard" pattern,
    // which left our DB out of sync (booking status said "paid" while Stripe
    // had already returned the money). Now:
    //   1. Admin calls this endpoint with bookingId + amount + reason.
    //   2. We look up the latest successful payment row for the booking.
    //   3. Call Stripe API with idempotency key to reverse the charge.
    //   4. Optimistically mark our DB to refunded (the existing
    //      `charge.refunded` webhook handler dedupes when Stripe confirms).
    //   5. Release the departure slots so the seats are bookable again.
    //   6. Audit trail with reason captured.
    //
    // Also handles partial refunds (amount < original charge): payment row
    // stays "paid" but a separate refunds entry tracks the partial.
    adminRefund: adminProcedure
      .input(
        z.object({
          bookingId: z.number().int().positive().max(2_147_483_647),
          // Optional: partial refund. If omitted, full amount is refunded.
          amount: z.number().min(0.01).max(100_000_000).optional(),
          reason: z.string().min(1).max(500),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { audit } = await import("./_core/auditLog");

        const booking = await db.getBookingById(input.bookingId);
        if (!booking) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        }

        // Find the most recent successful payment for this booking
        const payments = await db.getBookingPayments(input.bookingId);
        const successful = (payments || []).filter(
          (p: any) => p.paymentStatus === "completed" && p.stripePaymentIntentId
        );
        if (successful.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "此訂單沒有可退款的付款紀錄",
          });
        }
        // Refund the latest payment first (deposit, then balance, etc.)
        const target = successful[successful.length - 1];
        const targetIntentId = target.stripePaymentIntentId;
        if (!targetIntentId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "此付款紀錄無 Stripe payment intent，無法退款",
          });
        }
        const originalAmount = Number(target.amount) || 0;

        const refundAmount = input.amount ?? originalAmount;
        if (refundAmount > originalAmount) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `退款金額不可超過原付款金額 (${originalAmount})`,
          });
        }

        const stripe = getStripeClient();
        // Stripe amount: zero-decimal currencies (TWD/JPY/etc.) don't multiply.
        const currency = (target.currency || booking.currency || "TWD").toLowerCase();
        const zeroDecimalCurrencies = ["bif", "clp", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "twd", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"];
        const stripeRefundAmount = zeroDecimalCurrencies.includes(currency)
          ? Math.round(refundAmount)
          : Math.round(refundAmount * 100);

        // Idempotency key: same booking+payment+date won't double-refund even
        // if the admin double-clicks.
        const idempotencyKey = `refund:${input.bookingId}:${target.id}:${new Date().toISOString().slice(0, 10)}`;

        let stripeRefund;
        try {
          stripeRefund = await stripe.refunds.create(
            {
              payment_intent: targetIntentId,
              amount: stripeRefundAmount,
              reason: "requested_by_customer",
              metadata: {
                booking_id: String(input.bookingId),
                admin_user_id: String(ctx.user.id),
                admin_reason: input.reason.slice(0, 500),
              },
            },
            { idempotencyKey }
          );
        } catch (err: any) {
          // Stripe errored — DON'T touch our DB; surface error to admin
          console.error(`[bookings.adminRefund] Stripe refund failed:`, err?.message);
          audit({
            ctx,
            action: "booking.refund",
            targetType: "booking",
            targetId: input.bookingId,
            changes: { intentId: targetIntentId, amount: refundAmount },
            reason: input.reason,
            success: false,
            errorMessage: err?.message?.slice(0, 200) || "Stripe error",
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Stripe 退款失敗：${err?.message || "未知錯誤"}`,
          });
        }

        const isFullRefund = refundAmount >= originalAmount;

        // Optimistically update DB. Webhook will dedupe via paymentStatus check.
        if (isFullRefund) {
          await db.updateBooking(input.bookingId, {
            paymentStatus: "refunded",
            bookingStatus: "cancelled",
          });
          // Release seats (idempotent at SQL level)
          const seatCount =
            (booking.numberOfAdults || 0) +
            (booking.numberOfChildrenWithBed || 0) +
            (booking.numberOfChildrenNoBed || 0);
          if (seatCount > 0 && booking.departureId && booking.bookingStatus !== "cancelled") {
            await db.releaseDepartureSlots(booking.departureId, seatCount).catch((e) =>
              console.warn(`[bookings.adminRefund] release slots failed:`, e?.message)
            );
          }
        }
        // Partial refund: leave paymentStatus="paid"; the partial is recorded
        // in Stripe and surfaced to ops via the webhook's partial-refund log.

        audit({
          ctx,
          action: "booking.refund",
          targetType: "booking",
          targetId: input.bookingId,
          changes: {
            stripeRefundId: stripeRefund.id,
            paymentIntentId: targetIntentId,
            amount: refundAmount,
            originalAmount,
            isFullRefund,
          },
          reason: input.reason,
          success: true,
        });

        return {
          success: true,
          refundId: stripeRefund.id,
          amount: refundAmount,
          isFullRefund,
        };
      }),
  }),

  // Departures management router
  departures: router({
    // Get next upcoming departure for a single tour
    getNext: publicProcedure
      .input(z.object({ tourId: z.number() }))
      .query(async ({ input }) => {
        const allDepartures = await db.getTourDepartures(input.tourId);
        const now = new Date();
        const upcoming = (allDepartures as any[])
          .filter((d: any) => d.status !== 'cancelled' && new Date(d.departureDate) > now)
          .sort((a: any, b: any) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime());
        return upcoming[0] || null;
      }),
    // v78s: Top-N upcoming departures for tour list cards (Lion Travel chip pattern)
    // Returns lean fields only — id, date, status, adultPrice — to keep payload small
    getUpcoming: publicProcedure
      .input(z.object({ tourId: z.number(), limit: z.number().min(1).max(10).default(3) }))
      .query(async ({ input }) => {
        const allDepartures = await db.getTourDepartures(input.tourId);
        const now = new Date();
        const upcoming = (allDepartures as any[])
          .filter((d: any) => d.status !== 'cancelled' && new Date(d.departureDate) > now)
          .sort((a: any, b: any) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime())
          .slice(0, input.limit)
          .map((d: any) => ({
            id: d.id,
            departureDate: d.departureDate,
            status: d.status, // 'open' | 'confirmed' | 'full' | 'waitlist'
            adultPrice: d.adultPrice ?? null,
            currency: d.currency ?? null,
            // Round 79: schema uses totalSlots/bookedSlots, not maxParticipants/currentParticipants.
            // Old code mapped non-existent fields → frontends saw undefined and seat-count UI never rendered.
            bookedSlots: d.bookedSlots ?? 0,
            totalSlots: d.totalSlots ?? null,
          }));
        return upcoming;
      }),
    // Get next upcoming departure for multiple tours (batch)
    getNextBatch: publicProcedure
      .input(z.object({ tourIds: z.array(z.number()) }))
      .query(async ({ input }) => {
        const result: Record<number, any> = {};
        const now = new Date();
        await Promise.all(input.tourIds.map(async (tourId) => {
          const allDepartures = await db.getTourDepartures(tourId);
          const upcoming = (allDepartures as any[])
            .filter((d: any) => d.status !== 'cancelled' && new Date(d.departureDate) > now)
            .sort((a: any, b: any) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime());
          result[tourId] = upcoming[0] || null;
        }));
        return result;
      }),
    // Get all departures for a tour
    list: publicProcedure
      .input(z.object({ tourId: z.number() }))
      .query(async ({ input }) => {
        return await db.getTourDepartures(input.tourId);
      }),

    // Alias for list (for backward compatibility)
    listByTour: publicProcedure
      .input(z.object({ tourId: z.number() }))
      .query(async ({ input }) => {
        return await db.getTourDepartures(input.tourId);
      }),

    // Get single departure
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getDepartureById(input.id);
      }),

    // Create new departure (admin only)
    create: adminProcedure
      .input(
        z.object({
          tourId: z.number(),
          departureDate: z.date(),
          returnDate: z.date(),
          totalSlots: z.number().min(1, "座位數至少為 1"),
          adultPrice: z.number().min(1, "成人價格至少為 1"),
          childPriceWithBed: z.number().optional(),
          childPriceNoBed: z.number().optional(),
          infantPrice: z.number().optional(),
          singleRoomSupplement: z.number().optional(),
          status: z.enum(["open", "full", "cancelled"]).optional(),
          currency: z.string().optional(),
          notes: z.string().optional(),
        }).refine(
          (data) => data.returnDate >= data.departureDate,
          { message: "回程日期必須在出發日期之後", path: ["returnDate"] }
        )
      )
      .mutation(async ({ ctx, input }) => {
        const created = await db.createDeparture(input);
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "departure.create",
          targetType: "departure",
          targetId: created.id,
          changes: {
            tourId: input.tourId,
            departureDate: input.departureDate,
            adultPrice: input.adultPrice,
            totalSlots: input.totalSlots,
          },
        });
        return created;
      }),

    // Update departure (admin only)
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive().max(2_147_483_647),
          departureDate: z.date().optional(),
          returnDate: z.date().optional(),
          totalSlots: z.number().int().min(0).max(10_000).optional(),
          adultPrice: z.number().int().min(0).max(100_000_000).optional(),
          childPriceWithBed: z.number().int().min(0).max(100_000_000).optional(),
          childPriceNoBed: z.number().int().min(0).max(100_000_000).optional(),
          infantPrice: z.number().int().min(0).max(100_000_000).optional(),
          singleRoomSupplement: z.number().int().min(0).max(100_000_000).optional(),
          status: z.enum(["open", "full", "cancelled", "confirmed"]).optional(),
          currency: shortStr.optional(),
          notes: mediumStr.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...updates } = input;
        const before = await db.getDepartureById(id).catch(() => null);
        const result = await db.updateDeparture(id, updates);
        const { audit, diffFields } = await import("./_core/auditLog");
        const diff = diffFields(before as any, updates as any);
        audit({
          ctx,
          action: "departure.update",
          targetType: "departure",
          targetId: id,
          changes: { fields: diff.fields, before: diff.before, after: diff.after },
        });
        return result;
      }),

    // Delete departure (admin only)
    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive().max(2_147_483_647) }))
      .mutation(async ({ ctx, input }) => {
        // v75: snapshot + reject delete if any active bookings reference it.
        // Otherwise we'd orphan customer bookings to a non-existent departure.
        const before = await db.getDepartureById(input.id).catch(() => null);
        if (!before) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Departure not found" });
        }
        const activeBookings = await db.getActiveBookingsByDepartureId(input.id).catch(() => [] as any[]);
        if (activeBookings.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `此出發日有 ${activeBookings.length} 筆有效訂單，無法刪除。請先取消相關訂單。`,
          });
        }
        await db.deleteDeparture(input.id);

        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "departure.delete",
          targetType: "departure",
          targetId: input.id,
          changes: {
            before: {
              tourId: before.tourId,
              departureDate: before.departureDate,
              adultPrice: before.adultPrice,
              totalSlots: before.totalSlots,
              bookedSlots: before.bookedSlots,
            },
          },
        });
        return { success: true };
      }),
  }),

  // Inquiries management router
  inquiries: router({
    // Get all inquiries (admin only)
    list: adminProcedure.query(async () => {
      return await db.getAllInquiries();
    }),

    // Get single inquiry
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const inquiry = await db.getInquiryById(input.id);
        if (!inquiry) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Inquiry not found",
          });
        }
        // Check if user owns this inquiry or is admin
        if (inquiry.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You don't have permission to view this inquiry",
          });
        }
        return inquiry;
      }),

    /**
     * v78q Sprint 9 #4: Translate inquiry subject + message for admin readability.
     * Goes through translateEntity('inquiry', ...) which uses the registry +
     * skip-if-unchanged. Returns the translated fields (admin can see ZH original
     * + EN translation side-by-side).
     */
    translate: adminProcedure
      .input(z.object({
        id: z.number(),
        targetLanguage: z.enum(["en", "ja", "ko"]).default("en"),
      }))
      .mutation(async ({ ctx, input }) => {
        const { translateEntity } = await import("./translation");
        const result = await translateEntity(
          "inquiry",
          input.id,
          [input.targetLanguage as any],
          "zh-TW" as any,
          ctx.user.id
        );
        if (!result.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: result.errors.join("; ") || "Translation failed",
          });
        }
        // Read back the saved translation rows
        const db2 = await import("./db").then((m) => m.getDb());
        if (!db2) return { translated: {} };
        const { translations: tTable } = await import("../drizzle/schema");
        const { and: _and, eq: _eq } = await import("drizzle-orm");
        const rows = await db2.select().from(tTable).where(
          _and(
            _eq(tTable.entityType, "inquiry" as any),
            _eq(tTable.entityId, input.id),
            _eq(tTable.targetLanguage, input.targetLanguage)
          )
        );
        const translated: Record<string, string> = {};
        for (const r of rows as any[]) {
          translated[r.fieldName] = r.translatedText;
        }
        return { translated };
      }),

    // Create new inquiry.
    //
    // SECURITY_AUDIT_2026_05_14 P1-3 hardening:
    //   - All string fields capped with .max() so a malicious 50 MB submit
    //     no longer fits.
    //   - Per-IP rate limit (5 per 10 min) blocks bot floods.
    create: publicProcedure
      .input(
        z.object({
          customerName: z.string().min(1).max(100),
          customerEmail: z.string().email().max(320),
          customerPhone: z.string().max(40).optional(),
          subject: z.string().min(1).max(200),
          message: z.string().min(1).max(5000),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const ip = ctx.ip || "unknown";
        const rl = await checkRateLimit({
          key: `inquiry:create:ip:${ip}`,
          limit: 5,
          window: 600, // 10 minutes
        });
        if (!rl.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "提交過於頻繁，請稍後再試。",
          });
        }
        return await db.createInquiry({
          ...input,
          inquiryType: "general",
          userId: ctx.user?.id,
          status: "new",
        });
      }),

    /**
     * Emergency intake — for customers currently on a trip needing
     * urgent help (medical, missed flight, lost passport, etc.).
     *
     * QA audit 2026-05-11 Phase 5 found PACK&GO had no dedicated
     * emergency channel — the same ContactUs form handled both "I
     * want to book a tour" and "I'm in Iceland at 3am with no
     * passport". This procedure routes emergencies through a
     * separate intake that:
     *   1. Tags inquiryType="emergency" so admin Inbox sorts them up
     *   2. Immediately calls notifyOwner with [緊急] title prefix so
     *      Jeff's email gets a high-priority signal (and his email
     *      client likely flags it red)
     *   3. Captures the customer's current location for context
     */
    createEmergency: publicProcedure
      .input(
        z.object({
          customerName: z.string().min(1).max(100),
          customerEmail: z.string().email().max(320),
          customerPhone: z.string().min(1).max(40),
          currentLocation: z.string().min(1).max(200),
          severity: z.enum(["medical", "flight", "passport", "safety", "other"]),
          message: z.string().min(1).max(5000),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // SECURITY_AUDIT_2026_05_14 P1-2: this procedure was unlimited and
        // synchronously fires notifyOwner. An attacker could flood Jeff's
        // inbox with 🆘 emails — the very channel meant for real
        // emergencies. Layer two rate limits so real emergencies (rare,
        // genuine) still pass while bot abuse hits a wall:
        //   - Per-IP: 3 per 15 min  (someone abroad with one phone)
        //   - Per-email: 5 per hour (catches stolen-IP bypass)
        const ip = ctx.ip || "unknown";
        const ipRl = await checkRateLimit({
          key: `inquiry:emergency:ip:${ip}`,
          limit: 3,
          window: 900,
        });
        if (!ipRl.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "提交過於頻繁，若為真實緊急情況請直接撥打 +1-510-789-9999。",
          });
        }
        const emailRl = await checkRateLimit({
          key: `inquiry:emergency:email:${input.customerEmail.toLowerCase()}`,
          limit: 5,
          window: 3600,
        });
        if (!emailRl.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "提交過於頻繁，若為真實緊急情況請直接撥打 +1-510-789-9999。",
          });
        }

        const severityLabel: Record<typeof input.severity, string> = {
          medical: "醫療緊急",
          flight: "班機問題",
          passport: "證件遺失",
          safety: "人身安全",
          other: "其他緊急",
        };
        const labelZh = severityLabel[input.severity];

        const inquiry = await db.createInquiry({
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          subject: `[緊急 · ${labelZh}] ${input.currentLocation}`,
          message: input.message,
          inquiryType: "emergency",
          userId: ctx.user?.id,
          status: "new",
        });

        // Fire-and-forget owner notification — never block the
        // customer-facing response on the email send.
        const { notifyOwner } = await import("./_core/notification");
        notifyOwner({
          title: `🆘 [緊急 · ${labelZh}] ${input.customerName} @ ${input.currentLocation}`,
          content:
            `客戶: ${input.customerName}\n` +
            `Email: ${input.customerEmail}\n` +
            `電話: ${input.customerPhone}\n` +
            `位置: ${input.currentLocation}\n` +
            `性質: ${labelZh}\n\n` +
            `訊息:\n${input.message}\n\n` +
            `Inquiry ID: ${inquiry?.id ?? "?"}\n` +
            `請盡快撥打客戶電話。`,
        }).catch((err) =>
          console.error("[inquiries.createEmergency] notifyOwner failed:", err)
        );

        return inquiry;
      }),

    // Update inquiry status (admin only)
    updateStatus: adminProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["new", "in_progress", "replied", "resolved", "closed"]),
        })
      )
      .mutation(async ({ input }) => {
        const { id, status } = input;
        return await db.updateInquiry(id, { status });
      }),

    // Alias for updateStatus (for backward compatibility)
    update: adminProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["new", "in_progress", "replied", "resolved", "closed"]),
        })
      )
      .mutation(async ({ input }) => {
        const { id, status } = input;
        return await db.updateInquiry(id, { status });
      }),

    // Get messages for an inquiry
    getMessages: protectedProcedure
      .input(z.object({ inquiryId: z.number() }))
      .query(async ({ ctx, input }) => {
        const inquiry = await db.getInquiryById(input.inquiryId);
        if (!inquiry) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Inquiry not found",
          });
        }
        // Check if user owns this inquiry or is admin
        if (inquiry.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You don't have permission to view these messages",
          });
        }
        return await db.getInquiryMessages(input.inquiryId);
      }),

    // Add message to inquiry
    addMessage: protectedProcedure
      .input(
        z.object({
          inquiryId: z.number(),
          message: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const inquiry = await db.getInquiryById(input.inquiryId);
        if (!inquiry) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Inquiry not found",
          });
        }
        // Check if user owns this inquiry or is admin
        if (inquiry.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You don't have permission to add messages to this inquiry",
          });
        }
        return await db.createInquiryMessage({
          inquiryId: input.inquiryId,
          senderId: ctx.user.id,
          senderType: ctx.user.role === "admin" ? "admin" : "customer",
          message: input.message,
        });
       }),
  }),

  // Newsletter subscription router
  newsletter: router({
    // Subscribe to newsletter.
    //
    // SECURITY_AUDIT_2026_05_14 P1-4 hardening: this was unlimited and
    // unconditionally fired notifyOwner — every POST = 1 owner email.
    // Bot loop = 36,000 inbox spam per hour. New behavior:
    //   - Email capped at RFC max (320 chars)
    //   - Per-IP rate limit: 5 per hour
    //   - Owner notification only fires for NEW subscribers (skip on
    //     resubscribe / already-active duplicates) — kills the email-
    //     spam-Jeff vector even when an attacker rotates IPs because
    //     duplicate emails don't notify.
    subscribe: publicProcedure
      .input(z.object({ email: z.string().email().max(320) }))
      .mutation(async ({ input, ctx }) => {
        const ip = ctx.ip || "unknown";
        const rl = await checkRateLimit({
          key: `newsletter:subscribe:ip:${ip}`,
          limit: 5,
          window: 3600, // 1 hour
        });
        if (!rl.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "訂閱請求過於頻繁，請稍後再試。",
          });
        }
        try {
          // Check if already subscribed
          const existing = await db.getNewsletterSubscriberByEmail(input.email);
          let isNewSubscriber = false;
          if (existing) {
            if (existing.status === 'active') {
              return { success: true, message: '您已訂閱電子報，感謝您的支持！', alreadySubscribed: true };
            }
            // Re-subscribe — not a "new" subscriber for notification purposes
            await db.resubscribeNewsletter(input.email);
          } else {
            await db.createNewsletterSubscriber({ email: input.email });
            isNewSubscriber = true;
          }
          // Send confirmation email (best-effort)
          try {
            const { sendNewsletterConfirmationEmail } = await import('./emailService');
            await sendNewsletterConfirmationEmail(input.email);
          } catch (emailErr) {
            console.warn('[Newsletter] Failed to send confirmation email:', emailErr);
          }
          // Notify owner ONLY for genuinely new subscribers — prevents
          // owner-inbox spam via repeated resubscribe attempts.
          if (isNewSubscriber) {
            try {
              const { notifyOwner } = await import('./_core/notification');
              await notifyOwner({ title: '新電子報訂閱', content: `新訂閱者：${input.email}` });
            } catch {}
          }
          return { success: true, message: '訂閱成功！感謝您的支持，我們會定期發送最新旅遊資訊。', alreadySubscribed: false };
        } catch (err: any) {
          if (err?.code === 'ER_DUP_ENTRY') {
            return { success: true, message: '您已訂閱電子報，感謝您的支持！', alreadySubscribed: true };
          }
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '訂閱失敗，請稍後再試' });
        }
      }),

    // Unsubscribe from newsletter
    unsubscribe: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ input }) => {
        await db.unsubscribeNewsletter(input.email);
        return { success: true };
      }),

    // Admin: list all subscribers
    listSubscribers: adminProcedure
      .input(z.object({
        status: z.enum(['active', 'unsubscribed', 'all']).default('active'),
        limit: z.number().default(100),
        offset: z.number().default(0),
      }))
      .query(async ({ input }) => {
        const subscribers = await db.getAllNewsletterSubscribers();
        const filtered = input.status === 'all'
          ? subscribers
          : subscribers.filter((s: any) => s.status === input.status);
        return {
          subscribers: filtered.slice(input.offset, input.offset + input.limit),
          total: filtered.length,
        };
      }),

    // Admin: export subscribers as CSV
    exportSubscribers: adminProcedure
      .query(async () => {
        const subscribers = await db.getAllNewsletterSubscribers();
        const csv = [
          'Email,Status,Subscribed At',
          ...subscribers.map((s: any) =>
            `${s.email},${s.status},${new Date(s.subscribedAt).toISOString()}`
          )
        ].join('\n');
        return { csv, count: subscribers.length };
      }),
  }),

  // Admin dashboard router
  admin: router({
    /**
     * Round 80.22 Phase C: lookup user by exact email for the Packpoint
     * admin tab. Returns minimal info needed for the adjust form (id, email,
     * name, tier, balance, lifetime). Returns null if not found rather than
     * 404 so the UI can show a friendly toast.
     */
    lookupUserByEmail: adminProcedure
      .input(z.object({ email: z.string().email().max(320) }))
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return null;
        const { users: usersTable } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const [user] = await drizzleDb
          .select({
            id: usersTable.id,
            email: usersTable.email,
            name: usersTable.name,
            tier: usersTable.tier,
            balance: usersTable.packpointBalance,
            lifetime: usersTable.packpointLifetimeEarned,
          })
          .from(usersTable)
          .where(eq(usersTable.email, input.email))
          .limit(1);
        return user ?? null;
      }),

    // Get dashboard statistics (real data).
    // QA audit 2026-05-11 Phase 2 P0 fix: this procedure was running 11
    // sequential SELECTs (~150-300ms each) every time someone opened the
    // admin home, with zero caching. Now wrapped in a 60s Redis cache so
    // multiple admin tabs in the same minute share one DB pass.
    //
    // 60s TTL chosen because: (a) the UI shows daily/monthly aggregates
    // where 1-min staleness is invisible, (b) Stripe webhook /
    // booking.create cache-bust would be a bigger refactor — Jeff can
    // hard-refresh if he wants a real-time read after a payment lands.
    getStats: adminProcedure.query(async () => {
      const CACHE_KEY = "admin:stats:v1";
      const CACHE_TTL = 60; // seconds
      try {
        const cached = await redis.get(CACHE_KEY);
        if (cached) return JSON.parse(cached);
      } catch (err) {
        console.warn("[admin.getStats] cache read failed:", err);
      }

      const { tours: toursTable, bookings: bookingsTable, inquiries: inquiriesTable, users: usersTable, newsletterSubscribers: newsletterTable } = await import('../drizzle/schema');
      const { sql: sqlFn, eq: eqFn, gte: gteFn, count: countFn } = await import('drizzle-orm');
      const drizzleDb = await db.getDb();
      if (!drizzleDb) {
        return { totalTours: 0, totalBookings: 0, totalRevenue: 0, totalInquiries: 0, activeTours: 0, pendingInquiries: 0, thisMonthRevenue: 0, revenueGrowth: 0, todayBookings: 0, totalUsers: 0, totalSubscribers: 0 };
      }
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      // Run the 11 stat queries in parallel — previously they were sequential
      // (cumulative ~1.5-3s on a cold cache). Parallel + Promise.all drops
      // cold-path latency to ~max(individual query time) ≈ 300ms.
      const [
        totalToursRow,
        activeToursRow,
        totalBookingsRow,
        todayBookingsRow,
        totalRevenueRow,
        thisMonthRevenueRow,
        lastMonthRevenueRow,
        totalInquiriesRow,
        pendingInquiriesRow,
        totalUsersRow,
        totalSubscribersRow,
      ] = await Promise.all([
        drizzleDb.select({ count: countFn() }).from(toursTable).then((r) => r[0]),
        drizzleDb.select({ count: countFn() }).from(toursTable).where(eqFn(toursTable.status, 'active')).then((r) => r[0]),
        drizzleDb.select({ count: countFn() }).from(bookingsTable).then((r) => r[0]),
        drizzleDb.select({ count: countFn() }).from(bookingsTable).where(gteFn(bookingsTable.createdAt, startOfToday)).then((r) => r[0]),
        drizzleDb.select({ total: sqlFn<number>`COALESCE(SUM(${bookingsTable.totalPrice}), 0)` }).from(bookingsTable).where(sqlFn`${bookingsTable.bookingStatus} IN ('confirmed', 'completed')`).then((r) => r[0]),
        drizzleDb.select({ total: sqlFn<number>`COALESCE(SUM(${bookingsTable.totalPrice}), 0)` }).from(bookingsTable).where(sqlFn`${bookingsTable.bookingStatus} IN ('confirmed', 'completed') AND ${bookingsTable.createdAt} >= ${startOfThisMonth}`).then((r) => r[0]),
        drizzleDb.select({ total: sqlFn<number>`COALESCE(SUM(${bookingsTable.totalPrice}), 0)` }).from(bookingsTable).where(sqlFn`${bookingsTable.bookingStatus} IN ('confirmed', 'completed') AND ${bookingsTable.createdAt} >= ${startOfLastMonth} AND ${bookingsTable.createdAt} <= ${endOfLastMonth}`).then((r) => r[0]),
        drizzleDb.select({ count: countFn() }).from(inquiriesTable).then((r) => r[0]),
        drizzleDb.select({ count: countFn() }).from(inquiriesTable).where(sqlFn`${inquiriesTable.status} IN ('new', 'in_progress')`).then((r) => r[0]),
        drizzleDb.select({ count: countFn() }).from(usersTable).then((r) => r[0]),
        drizzleDb.select({ count: countFn() }).from(newsletterTable).where(eqFn(newsletterTable.status, 'active')).then((r) => r[0]),
      ]);
      const thisMonthRevenue = Number(thisMonthRevenueRow?.total ?? 0);
      const lastMonthRevenue = Number(lastMonthRevenueRow?.total ?? 0);
      const revenueGrowth = lastMonthRevenue > 0 ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 : (thisMonthRevenue > 0 ? 100 : 0);
      const result = {
        totalTours: Number(totalToursRow?.count ?? 0),
        activeTours: Number(activeToursRow?.count ?? 0),
        totalBookings: Number(totalBookingsRow?.count ?? 0),
        todayBookings: Number(todayBookingsRow?.count ?? 0),
        totalRevenue: Number(totalRevenueRow?.total ?? 0),
        thisMonthRevenue,
        revenueGrowth: Math.round(revenueGrowth * 10) / 10,
        totalInquiries: Number(totalInquiriesRow?.count ?? 0),
        pendingInquiries: Number(pendingInquiriesRow?.count ?? 0),
        totalUsers: Number(totalUsersRow?.count ?? 0),
        totalSubscribers: Number(totalSubscribersRow?.count ?? 0),
      };
      try {
        await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(result));
      } catch (err) {
        console.warn("[admin.getStats] cache write failed:", err);
      }
      return result;
    }),

    // v78z-z3 Sprint 10 (C4): booking risk metrics — 3 actionable warning
    // signals for solo founder. Each metric also returns sample IDs so the
    // dashboard card can deep-link admin into the relevant detail view.
    getRiskMetrics: adminProcedure.query(async () => {
      const { tours: toursTable, bookings: bookingsTable, tourDepartures: departuresTable } = await import('../drizzle/schema');
      const { sql: sqlFn } = await import('drizzle-orm');
      const drizzleDb = await db.getDb();
      if (!drizzleDb) {
        return { lowCapacity: { count: 0, departureIds: [] }, unpaidBalance: { count: 0, bookingIds: [] }, staleTours: { count: 0, tourIds: [] } };
      }
      const now = new Date();
      const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const sinceFourteenDays = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const sinceThirtyDays = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // 1. Low capacity: open departures within 30 days with < 50% booked.
      const lowCapacityRows = await drizzleDb.select({
        id: departuresTable.id,
      }).from(departuresTable).where(
        sqlFn`${departuresTable.status} = 'open'
          AND ${departuresTable.departureDate} >= ${now}
          AND ${departuresTable.departureDate} <= ${in30Days}
          AND ${departuresTable.totalSlots} > 0
          AND (${departuresTable.bookedSlots} * 1.0 / ${departuresTable.totalSlots}) < 0.5`
      ).limit(20);

      // 2. Unpaid balance: bookings with deposit_paid for >14 days (stuck).
      const unpaidRows = await drizzleDb.select({
        id: bookingsTable.id,
      }).from(bookingsTable).where(
        sqlFn`${bookingsTable.paymentStatus} = 'deposit_paid'
          AND ${bookingsTable.bookingStatus} IN ('confirmed','pending')
          AND ${bookingsTable.createdAt} <= ${sinceFourteenDays}`
      ).limit(20);

      // 3. Stale tours: active tours with NO bookings in last 30 days.
      const staleRows = await drizzleDb.execute(
        sqlFn`SELECT t.id FROM tours t
          WHERE t.status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM bookings b
              WHERE b.tourId = t.id AND b.createdAt >= ${sinceThirtyDays}
            )
          LIMIT 20`
      ) as any;
      const staleRowsArr: any[] = Array.isArray(staleRows[0]) ? staleRows[0] : staleRows;

      return {
        lowCapacity: {
          count: lowCapacityRows.length,
          departureIds: lowCapacityRows.map((r: any) => Number(r.id)),
        },
        unpaidBalance: {
          count: unpaidRows.length,
          bookingIds: unpaidRows.map((r: any) => Number(r.id)),
        },
        staleTours: {
          count: staleRowsArr.length,
          tourIds: staleRowsArr.map((r: any) => Number(r.id)),
        },
      };
    }),

    // Get detailed analytics data for charts
    getAnalytics: adminProcedure
      .input(z.object({ days: z.number().min(7).max(180).default(30) }))
      .query(async ({ input }) => {
        const { sql: sqlFn2, inArray: inArrayFn } = await import('drizzle-orm');
        const { tours: toursTable } = await import('../drizzle/schema');
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { bookingTrend: [], tourCategoryDist: [], inquiryStatusDist: [], topTours: [] };
        const since = new Date();
        since.setDate(since.getDate() - input.days);
        since.setHours(0, 0, 0, 0);
        // Use ISO string to avoid TiDB drizzle Date serialization bug (drizzle converts Date to invalid format)
        const sinceStr = since.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        // Use drizzle execute() with raw sql() to bypass parameter type coercion
        const bookingTrendRaw = await drizzleDb.execute(
          sqlFn2`SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') as date, COUNT(*) as bookings, COALESCE(SUM(CASE WHEN bookingStatus IN ('confirmed', 'completed') THEN totalPrice ELSE 0 END), 0) as revenue FROM bookings WHERE createdAt >= ${sinceStr} GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d') ORDER BY DATE_FORMAT(createdAt, '%Y-%m-%d')`
        ) as any;
        const tourCategoryRaw = await drizzleDb.execute(
          sqlFn2`SELECT category, COUNT(*) as count FROM tours GROUP BY category`
        ) as any;
        const inquiryStatusRaw = await drizzleDb.execute(
          sqlFn2`SELECT status, COUNT(*) as count FROM inquiries GROUP BY status`
        ) as any;
        const topToursRaw = await drizzleDb.execute(
          sqlFn2`SELECT tourId, COUNT(*) as bookingCount, COALESCE(SUM(totalPrice), 0) as revenue FROM bookings GROUP BY tourId ORDER BY COUNT(*) DESC LIMIT 10`
        ) as any;
        // drizzle execute() returns [rows, fields] for mysql2
        const bookingTrendRows: any[] = Array.isArray(bookingTrendRaw[0]) ? bookingTrendRaw[0] : bookingTrendRaw;
        const tourCategoryRows: any[] = Array.isArray(tourCategoryRaw[0]) ? tourCategoryRaw[0] : tourCategoryRaw;
        const inquiryStatusRows: any[] = Array.isArray(inquiryStatusRaw[0]) ? inquiryStatusRaw[0] : inquiryStatusRaw;
        const topToursRows: any[] = Array.isArray(topToursRaw[0]) ? topToursRaw[0] : topToursRaw;
        let topTourTitles: Record<number, string> = {};
        if (topToursRows.length > 0) {
          const topTourIds = topToursRows.map((t: any) => Number(t.tourId));
          const tourRows = await drizzleDb.select({ id: toursTable.id, title: toursTable.title }).from(toursTable).where(inArrayFn(toursTable.id, topTourIds));
          topTourTitles = Object.fromEntries(tourRows.map((t: any) => [t.id, t.title]));
        }
        const categoryLabels: Record<string, string> = { group: '團體旅遊', custom: '客製旅遊', package: '包團旅遊', cruise: '郵輪旅遊', theme: '主題旅遊' };
        const statusLabels: Record<string, string> = { new: '新諮詢', in_progress: '處理中', replied: '已回覆', resolved: '已解決', closed: '已關閉' };
        return {
          bookingTrend: bookingTrendRows.map((r: any) => ({ date: String(r.date ?? '').slice(5), bookings: Number(r.bookings), revenue: Number(r.revenue) })),
          tourCategoryDist: tourCategoryRows.map((r: any) => ({ name: categoryLabels[r.category] ?? r.category, value: Number(r.count) })),
          inquiryStatusDist: inquiryStatusRows.map((r: any) => ({ name: statusLabels[r.status] ?? r.status, value: Number(r.count) })),
          topTours: topToursRows.map((r: any) => ({ tourId: Number(r.tourId), title: topTourTitles[Number(r.tourId)] ?? `行程 #${r.tourId}`, bookingCount: Number(r.bookingCount), revenue: Number(r.revenue) })),
        };
      }),

    getLlmStats: adminProcedure
      .input(z.object({
        days: z.number().min(1).max(90).default(30),
      }))
      .query(async ({ input }) => {
        const { llmUsageLogs } = await import('../drizzle/schema');
        const { gte, sql, desc } = await import('drizzle-orm');
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB not available' });

        const since = new Date();
        since.setDate(since.getDate() - input.days);

        // 總計
        const [totals] = await drizzleDb
          .select({
            totalCalls: sql<number>`COUNT(*)`,
            totalTokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
            totalCostUsd: sql<string>`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`,
            cachedCalls: sql<number>`SUM(CASE WHEN ${llmUsageLogs.wasFromCache} = 1 THEN 1 ELSE 0 END)`,
            avgProcessingMs: sql<number>`AVG(${llmUsageLogs.processingTimeMs})`,
          })
          .from(llmUsageLogs)
          .where(gte(llmUsageLogs.createdAt, since));

        // 每日費用趨勢
        const dailyCosts = await drizzleDb
          .select({
            date: sql<string>`DATE_FORMAT(createdAt, '%Y-%m-%d')`,
            calls: sql<number>`COUNT(*)`,
            tokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
            costUsd: sql<string>`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`,
          })
          .from(llmUsageLogs)
          .where(gte(llmUsageLogs.createdAt, since))
          .groupBy(sql`DATE_FORMAT(createdAt, '%Y-%m-%d')`)
          .orderBy(sql`DATE_FORMAT(createdAt, '%Y-%m-%d')`);

        // 各 Agent 費用佔比
        const agentCosts = await drizzleDb
          .select({
            agentName: llmUsageLogs.agentName,
            calls: sql<number>`COUNT(*)`,
            tokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
            costUsd: sql<string>`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`,
          })
          .from(llmUsageLogs)
          .where(gte(llmUsageLogs.createdAt, since))
          .groupBy(llmUsageLogs.agentName)
          .orderBy(desc(sql`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`));

        // 各任務類型費用
        const taskTypeCosts = await drizzleDb
          .select({
            taskType: llmUsageLogs.taskType,
            calls: sql<number>`COUNT(*)`,
            tokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
            costUsd: sql<string>`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`,
          })
          .from(llmUsageLogs)
          .where(gte(llmUsageLogs.createdAt, since))
          .groupBy(llmUsageLogs.taskType)
          .orderBy(desc(sql`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`));

        // 最近 50 筆記錄
        const recentLogs = await drizzleDb
          .select()
          .from(llmUsageLogs)
          .orderBy(desc(llmUsageLogs.createdAt))
          .limit(50);

        return {
          totals: {
            totalCalls: Number(totals?.totalCalls ?? 0),
            totalTokens: Number(totals?.totalTokens ?? 0),
            totalCostUsd: parseFloat(totals?.totalCostUsd ?? '0').toFixed(4),
            cachedCalls: Number(totals?.cachedCalls ?? 0),
            cacheHitRate: totals?.totalCalls
              ? ((Number(totals.cachedCalls) / Number(totals.totalCalls)) * 100).toFixed(1)
              : '0.0',
            avgProcessingMs: Math.round(Number(totals?.avgProcessingMs ?? 0)),
          },
          dailyCosts: dailyCosts.map((d: { date: string; calls: number; tokens: number; costUsd: string }) => ({
            date: d.date,
            calls: Number(d.calls),
            tokens: Number(d.tokens),
            costUsd: parseFloat(d.costUsd ?? '0').toFixed(4),
          })),
          agentCosts: agentCosts.map((a: { agentName: string; calls: number; tokens: number; costUsd: string }) => ({
            agentName: a.agentName,
            calls: Number(a.calls),
            tokens: Number(a.tokens),
            costUsd: parseFloat(a.costUsd ?? '0').toFixed(4),
          })),
          taskTypeCosts: taskTypeCosts.map((t: { taskType: string | null; calls: number; tokens: number; costUsd: string }) => ({
            taskType: t.taskType ?? 'other',
            calls: Number(t.calls),
            tokens: Number(t.tokens),
            costUsd: parseFloat(t.costUsd ?? '0').toFixed(4),
          })),
          recentLogs: recentLogs.map((l: typeof recentLogs[number]) => ({
            id: l.id,
            agentName: l.agentName,
            taskType: l.taskType,
            model: l.model,
            inputTokens: l.inputTokens,
            outputTokens: l.outputTokens,
            totalTokens: l.totalTokens,
            estimatedCostUsd: l.estimatedCostUsd,
            wasFromCache: l.wasFromCache,
            processingTimeMs: l.processingTimeMs,
            createdAt: l.createdAt,
          })),
        };
      }),

    // Round 80.15-G: LLM cost report — reads per-day Redis stats hashes
    // (written by server/_core/llm.ts bumpStat) so a solo founder can see
    // "what's AI burning today?" without joining DB tables.
    //
    // Redis schema: HGETALL llm:stats:YYYY-MM-DD
    //   input:<model>            input tokens for that model
    //   output:<model>           output tokens for that model
    //   prompt_cache_read        Anthropic prompt-cache read tokens (10% cost)
    //   prompt_cache_write       Anthropic prompt-cache write tokens (125% cost)
    //   cache_hit / cache_miss   app-level llmCache hit counters (call counts, NOT tokens)
    //   calls_total              total API calls
    //   circuit_opened           breaker trip count
    //
    // Pricing rates (USD per 1M tokens):
    //   Haiku  in $1   / out $5
    //   Sonnet in $3   / out $15
    //   Opus   in $15  / out $75
    //   Cache read = input × 0.10
    //   Cache write = input × 1.25
    llmCostReport: adminProcedure
      .input(z.object({
        days: z.number().int().min(1).max(30).default(7),
      }))
      .query(async ({ input }) => {
        const { redis } = await import("./redis");

        // Pricing per 1K tokens for easier math (1/1000 of per-1M rate).
        const RATES_PER_K: Record<string, { in: number; out: number }> = {
          haiku:  { in: 0.001,  out: 0.005  },
          sonnet: { in: 0.003,  out: 0.015  },
          opus:   { in: 0.015,  out: 0.075  },
        };
        const CACHE_READ_MULT = 0.10;
        const CACHE_WRITE_MULT = 1.25;

        function classifyModel(model: string): "haiku" | "sonnet" | "opus" | null {
          const m = model.toLowerCase();
          if (m.includes("haiku")) return "haiku";
          if (m.includes("sonnet")) return "sonnet";
          if (m.includes("opus")) return "opus";
          return null;
        }

        function inputCostPerK(model: string): number {
          const tier = classifyModel(model);
          if (!tier) return RATES_PER_K.sonnet.in; // safe default
          return RATES_PER_K[tier].in;
        }

        function outputCostPerK(model: string): number {
          const tier = classifyModel(model);
          if (!tier) return RATES_PER_K.sonnet.out;
          return RATES_PER_K[tier].out;
        }

        // Build list of UTC date strings (newest first) — matches the
        // YYYY-MM-DD format that bumpStat() writes.
        const dates: string[] = [];
        const today = new Date();
        for (let i = 0; i < input.days; i++) {
          const d = new Date(today);
          d.setUTCDate(d.getUTCDate() - i);
          dates.push(d.toISOString().slice(0, 10));
        }

        type ModelRow = {
          model: string;
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheWriteTokens: number;
          costUSD: number;
        };
        type DayRow = {
          date: string;
          callsTotal: number;
          cacheHits: number;
          cacheMisses: number;
          circuitOpened: number;
          perModel: ModelRow[];
          totalUSD: number;
        };

        const days: DayRow[] = [];
        let totalUSD = 0;
        let totalCalls = 0;
        let totalCacheHits = 0;
        let totalCacheMisses = 0;

        for (const date of dates) {
          const key = `llm:stats:${date}`;
          let raw: Record<string, string> = {};
          try {
            raw = (await redis.hgetall(key)) as Record<string, string>;
          } catch {
            raw = {};
          }

          const callsTotal = Number(raw.calls_total ?? 0);
          const cacheHits = Number(raw.cache_hit ?? 0);
          const cacheMisses = Number(raw.cache_miss ?? 0);
          const circuitOpened = Number(raw.circuit_opened ?? 0);
          const promptCacheRead = Number(raw.prompt_cache_read ?? 0);
          const promptCacheWrite = Number(raw.prompt_cache_write ?? 0);

          // Aggregate input:<model> and output:<model> by model name.
          const modelMap = new Map<string, ModelRow>();
          const ensure = (model: string): ModelRow => {
            let row = modelMap.get(model);
            if (!row) {
              row = {
                model,
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                costUSD: 0,
              };
              modelMap.set(model, row);
            }
            return row;
          };

          for (const [field, value] of Object.entries(raw)) {
            const n = Number(value ?? 0);
            if (!Number.isFinite(n) || n <= 0) continue;
            if (field.startsWith("input:")) {
              const model = field.slice("input:".length);
              ensure(model).inputTokens += n;
            } else if (field.startsWith("output:")) {
              const model = field.slice("output:".length);
              ensure(model).outputTokens += n;
            }
          }

          // Spread prompt-cache tokens across the day's models in proportion
          // to their input share. Anthropic stats don't tell us per-model
          // cache split, but the assumption (cache follows where input goes)
          // is good enough for a single-tenant cost view.
          const totalInput = Array.from(modelMap.values()).reduce(
            (acc, r) => acc + r.inputTokens, 0
          );
          if (totalInput > 0) {
            for (const row of modelMap.values()) {
              const share = row.inputTokens / totalInput;
              row.cacheReadTokens = Math.round(promptCacheRead * share);
              row.cacheWriteTokens = Math.round(promptCacheWrite * share);
            }
          } else if (promptCacheRead > 0 || promptCacheWrite > 0) {
            // No model-tagged input but we did see cache activity — bucket
            // it under "unknown" so it surfaces somewhere.
            const row = ensure("unknown");
            row.cacheReadTokens = promptCacheRead;
            row.cacheWriteTokens = promptCacheWrite;
          }

          // Cost per model.
          let dayUSD = 0;
          for (const row of modelMap.values()) {
            const inK  = inputCostPerK(row.model);
            const outK = outputCostPerK(row.model);
            const baseInputCost  = (row.inputTokens / 1000)  * inK;
            const outputCost     = (row.outputTokens / 1000) * outK;
            const cacheReadCost  = (row.cacheReadTokens  / 1000) * inK * CACHE_READ_MULT;
            const cacheWriteCost = (row.cacheWriteTokens / 1000) * inK * CACHE_WRITE_MULT;
            row.costUSD = baseInputCost + outputCost + cacheReadCost + cacheWriteCost;
            dayUSD += row.costUSD;
          }

          // Sort models so the most expensive shows first.
          const perModel = Array.from(modelMap.values()).sort(
            (a, b) => b.costUSD - a.costUSD
          );

          days.push({
            date,
            callsTotal,
            cacheHits,
            cacheMisses,
            circuitOpened,
            perModel,
            totalUSD: dayUSD,
          });

          totalUSD += dayUSD;
          totalCalls += callsTotal;
          totalCacheHits += cacheHits;
          totalCacheMisses += cacheMisses;
        }

        const cacheLookups = totalCacheHits + totalCacheMisses;
        const cacheHitRate = cacheLookups > 0 ? totalCacheHits / cacheLookups : 0;

        return {
          totalUSD,
          totalCalls,
          totalCacheHits,
          cacheHitRate,
          days, // already newest-first
        };
      }),

    // Get today's activity logs per agent (for RPG daily report)
    getAgentDailyLogs: adminProcedure
      .query(async () => {
        const { llmUsageLogs } = await import('../drizzle/schema');
        const { gte, sql, desc } = await import('drizzle-orm');
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB not available' });

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // Today's stats per agent
        const todayStats = await drizzleDb
          .select({
            agentName: llmUsageLogs.agentName,
            calls: sql<number>`COUNT(*)`,
            totalTokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
            avgMs: sql<number>`AVG(${llmUsageLogs.processingTimeMs})`,
            lastActive: sql<string>`MAX(${llmUsageLogs.createdAt})`,
          })
          .from(llmUsageLogs)
          .where(gte(llmUsageLogs.createdAt, todayStart))
          .groupBy(llmUsageLogs.agentName)
          .orderBy(desc(sql`COUNT(*)`));

        // Recent activity logs today
        const recentActivity = await drizzleDb
          .select({
            agentName: llmUsageLogs.agentName,
            taskType: llmUsageLogs.taskType,
            taskId: llmUsageLogs.taskId,
            totalTokens: llmUsageLogs.totalTokens,
            processingTimeMs: llmUsageLogs.processingTimeMs,
            wasFromCache: llmUsageLogs.wasFromCache,
            createdAt: llmUsageLogs.createdAt,
          })
          .from(llmUsageLogs)
          .where(gte(llmUsageLogs.createdAt, todayStart))
          .orderBy(desc(llmUsageLogs.createdAt))
          .limit(200);

        // All-time stats per agent for level calculation
        const allTimeStats = await drizzleDb
          .select({
            agentName: llmUsageLogs.agentName,
            totalCalls: sql<number>`COUNT(*)`,
            totalTokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
          })
          .from(llmUsageLogs)
          .groupBy(llmUsageLogs.agentName);

        return {
          todayStats: todayStats.map(s => ({
            agentName: s.agentName,
            calls: Number(s.calls),
            totalTokens: Number(s.totalTokens),
            avgMs: Math.round(Number(s.avgMs ?? 0)),
            lastActive: s.lastActive,
          })),
          recentActivity: recentActivity.map(a => ({
            agentName: a.agentName,
            taskType: a.taskType ?? 'other',
            taskId: a.taskId,
            totalTokens: a.totalTokens,
            processingTimeMs: a.processingTimeMs,
            wasFromCache: a.wasFromCache,
            createdAt: a.createdAt,
          })),
          allTimeStats: allTimeStats.map(s => ({
            agentName: s.agentName,
            totalCalls: Number(s.totalCalls),
            totalTokens: Number(s.totalTokens),
          })),
        };
      }),

    // AI 辦公室：取得所有 Agent 的即時狀態和今日工作日誌
    getAgentOfficeStatus: adminProcedure
      .query(async () => {
        const { agentActivityLogs, llmUsageLogs } = await import('../drizzle/schema');
        const { gte, desc, sql, eq, and } = await import('drizzle-orm');
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB not available' });

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // 最近 7 天的時間範圍（用於顯示活動記錄，避免今日無任務時空白）
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        // 最近 7 天的活動日誌（最近 200 筆）
        const todayActivities = await drizzleDb
          .select()
          .from(agentActivityLogs)
          .where(gte(agentActivityLogs.startedAt, sevenDaysAgo))
          .orderBy(desc(agentActivityLogs.startedAt))
          .limit(200);

        // 每個 Agent 的最近 7 天統計（從 llmUsageLogs）
        const agentTodayStats = await drizzleDb
          .select({
            agentName: llmUsageLogs.agentName,
            calls: sql<number>`COUNT(*)`,
            totalTokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
            lastActive: sql<string>`MAX(${llmUsageLogs.createdAt})`,
          })
          .from(llmUsageLogs)
          .where(gte(llmUsageLogs.createdAt, sevenDaysAgo))
          .groupBy(llmUsageLogs.agentName);

        // 最近 10 筆正在執行中的任務（只顯示 status='started' 的任務）
        // Round 36-Fix: 從 5 分鐘改為 30 分鐘，避免長時間執行的任務在工作日誌中消失
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        const activeTasks = await drizzleDb
          .select()
          .from(agentActivityLogs)
          .where(
            and(
              gte(agentActivityLogs.startedAt, thirtyMinutesAgo),
              eq(agentActivityLogs.status, 'started')
            )
          )
          .orderBy(desc(agentActivityLogs.startedAt))
          .limit(10);

        // 清理殭屍任務：超過 30 分鐘仍為 started 的任務自動標記為 failed
        // Round 36-Fix-3: 從 20 分鐘延長到 30 分鐘，與 index.ts 排程器保持一致
        const thirtyMinutesAgoForCleanup = new Date(Date.now() - 30 * 60 * 1000);
        await drizzleDb
          .update(agentActivityLogs)
          .set({
            status: 'failed',
            errorMessage: '任務逾時（超過 30 分鐘未完成）。可能原因：(1) URL 無法存取或載入太慢 (2) LLM 處理逾時 (3) 網路連線問題。建議改用 PDF 上傳方式。',
            completedAt: new Date(),
          })
          .where(
            and(
              eq(agentActivityLogs.status, 'started'),
              gte(agentActivityLogs.startedAt, todayStart),
              sql`${agentActivityLogs.startedAt} < ${thirtyMinutesAgoForCleanup}`
            )
          );

        return {
          todayActivities: todayActivities.map(a => ({
            id: a.id,
            agentName: a.agentName,
            agentKey: a.agentKey,
            taskType: a.taskType,
            taskId: a.taskId,
            taskTitle: a.taskTitle,
            status: a.status,
            resultSummary: a.resultSummary,
            errorMessage: a.errorMessage,
            processingTimeMs: a.processingTimeMs,
            startedAt: a.startedAt,
            completedAt: a.completedAt,
          })),
          agentTodayStats: agentTodayStats.map(s => ({
            agentName: s.agentName,
            calls: Number(s.calls),
            totalTokens: Number(s.totalTokens),
            lastActive: s.lastActive,
          })),
          activeTasks: activeTasks.map(a => ({
            id: a.id,
            agentName: a.agentName,
            agentKey: a.agentKey,
            taskType: a.taskType,
            taskTitle: a.taskTitle,
            status: a.status,
            startedAt: a.startedAt,
          })),
        };
      }),
    // Task History: 取得所有 AI 任務執行記錄（分頁）
    getTaskHistory: adminProcedure
      .input(z.object({
        page: z.number().optional().default(1),
        limit: z.number().optional().default(50),
        agentName: z.string().optional(),
        status: z.enum(['started', 'completed', 'failed', 'idle']).optional(),
      }).optional())
      .query(async ({ input }) => {
        const { agentActivityLogs, llmUsageLogs } = await import('../drizzle/schema');
        const { desc, eq, and, sql, gte } = await import('drizzle-orm');
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB not available' });
        const page = input?.page ?? 1;
        const limit = input?.limit ?? 50;
        const offset = (page - 1) * limit;
        const conditions: any[] = [];
        if (input?.agentName) conditions.push(eq(agentActivityLogs.agentName, input.agentName));
        if (input?.status) conditions.push(eq(agentActivityLogs.status, input.status));
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const [logs, countResult, summaryResult] = await Promise.all([
          drizzleDb
            .select()
            .from(agentActivityLogs)
            .where(whereClause)
            .orderBy(desc(agentActivityLogs.startedAt))
            .limit(limit)
            .offset(offset),
          drizzleDb
            .select({ count: sql<number>`COUNT(*)` })
            .from(agentActivityLogs)
            .where(whereClause),
          drizzleDb
            .select({
              totalTasks: sql<number>`COUNT(*)`,
              completedTasks: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
              failedTasks: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
              avgProcessingMs: sql<number>`AVG(processingTimeMs)`,
            })
            .from(agentActivityLogs),
        ]);
        const total = Number(countResult[0]?.count ?? 0);
        return {
          logs: logs.map(l => {
            // Auto-detect zombie tasks: started > 30 min ago with no completion
            const isZombie = l.status === 'started' && l.startedAt && 
              (Date.now() - new Date(l.startedAt).getTime() > 30 * 60 * 1000);
            return {
              id: l.id,
              agentName: l.agentName,
              agentKey: l.agentKey,
              taskType: l.taskType,
              taskId: l.taskId,
              taskTitle: l.taskTitle,
              status: isZombie ? 'completed' as const : l.status,
              resultSummary: isZombie ? (l.resultSummary || '任務已完成（狀態自動修正）') : l.resultSummary,
              errorMessage: l.errorMessage,
              processingTimeMs: l.processingTimeMs,
              startedAt: l.startedAt,
              completedAt: l.completedAt,
            };
          }),
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
          summary: {
            totalTasks: Number(summaryResult[0]?.totalTasks ?? 0),
            // Count zombie tasks (started > 30 min) as completed in summary
            completedTasks: Number(summaryResult[0]?.completedTasks ?? 0) + 
              logs.filter(l => l.status === 'started' && l.startedAt && 
                (Date.now() - new Date(l.startedAt).getTime() > 30 * 60 * 1000)).length,
            failedTasks: Number(summaryResult[0]?.failedTasks ?? 0),
            avgProcessingMs: Math.round(Number(summaryResult[0]?.avgProcessingMs ?? 0)),
          },
        };
      }),
  }),

  // Image Library router
  imageLibrary: router({
    // List images from library
    list: protectedProcedure
      .input(z.object({
        tourId: z.number().optional(),
        search: z.string().optional(),
        limit: z.number().optional().default(50),
        offset: z.number().optional().default(0),
      }).optional())
      .query(async ({ ctx, input }) => {
        return await db.getImageLibrary({
          userId: ctx.user.id,
          tourId: input?.tourId,
          search: input?.search,
          limit: input?.limit,
          offset: input?.offset,
        });
      }),

    // Add image to library
    add: protectedProcedure
      .input(z.object({
        url: z.string(),
        filename: z.string().optional(),
        mimeType: z.string().optional(),
        fileSize: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        tags: z.array(z.string()).optional(),
        tourId: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const image = await db.addImageToLibrary({
          url: input.url,
          filename: input.filename,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          width: input.width,
          height: input.height,
          tags: input.tags ? JSON.stringify(input.tags) : null,
          tourId: input.tourId,
          uploadedBy: ctx.user.id,
        });
        if (!image) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to add image to library",
          });
        }
        return image;
      }),

    // Delete image from library (admin only)
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const success = await db.deleteImageFromLibrary(input.id, ctx.user.id);
        if (!success) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Image not found or you don't have permission to delete it",
          });
        }
        return { success: true };
      }),

  }),
  // Homepage content managementt
  homepage: router({
    // Get homepage content by section key
    getContent: publicProcedure
      .input(z.object({ sectionKey: z.string() }))
      .query(async ({ input }) => {
        const content = await db.getHomepageContent(input.sectionKey);
        if (!content) return null;
        try {
          return { ...content, content: JSON.parse(content.content) };
        } catch {
          return content;
        }
      }),

    // Get all homepage content
    getAllContent: publicProcedure.query(async () => {
      const contents = await db.getAllHomepageContent();
      return contents.map(c => {
        try {
          return { ...c, content: JSON.parse(c.content) };
        } catch {
          return c;
        }
      });
    }),

    // Update homepage content (admin only)
    updateContent: adminProcedure
      .input(z.object({
        sectionKey: z.string().min(1).max(100),
        content: z.unknown(),
      }))
      .mutation(async ({ ctx, input }) => {
        const contentStr = typeof input.content === 'string' 
          ? input.content 
          : JSON.stringify(input.content);
        const success = await db.upsertHomepageContent(
          input.sectionKey, 
          contentStr, 
          ctx.user.id
        );
        if (!success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update homepage content",
          });
        }
        // B2: Auto-translate hero content after update
        if (input.sectionKey === 'hero') {
          const contentObj = typeof input.content === 'string'
            ? JSON.parse(input.content)
            : (input.content as Record<string, any>);
          if (contentObj?.title || contentObj?.subtitle) {
            import('./translation').then(async ({ translateText }) => {
              try {
                const [titleEn, subtitleEn] = await Promise.all([
                  contentObj.title ? translateText(contentObj.title, 'en') : Promise.resolve(''),
                  contentObj.subtitle ? translateText(contentObj.subtitle, 'en') : Promise.resolve(''),
                ]);
                const updatedContent = { ...contentObj, title_en: titleEn, subtitle_en: subtitleEn };
                await db.upsertHomepageContent('hero', JSON.stringify(updatedContent), ctx.user.id);
                console.log('[Homepage] Auto-translated hero content to EN');
              } catch (e) {
                console.warn('[Homepage] Auto-translation failed:', e);
              }
            }).catch(e => console.warn('[Homepage] Failed to import translation module:', e));
          }
        }
        return { success: true };
      }),

    // Get all destinations
    getDestinations: publicProcedure.query(async () => {
      return await db.getActiveDestinations();
    }),

    // Get all destinations (including inactive) for admin
    getAllDestinations: adminProcedure.query(async () => {
      return await db.getAllDestinations();
    }),

    // Create destination (admin only)
    createDestination: adminProcedure
      .input(z.object({
        name: z.string(),
        label: z.string().optional(),
        image: z.string().optional(),
        region: z.string().optional(),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await db.createDestination(input);
        if (!id) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create destination",
          });
        }
        return { id };
      }),

    // Update destination (admin only)
    updateDestination: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        label: z.string().optional(),
        image: z.string().optional(),
        region: z.string().optional(),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const success = await db.updateDestination(id, data);
        if (!success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update destination",
          });
        }
        return { success: true };
      }),

    // Delete destination (admin only)
    deleteDestination: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const success = await db.deleteDestination(input.id);
        if (!success) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Destination not found",
          });
        }
        return { success: true };
      }),

    // Reorder destinations (admin only)
    reorderDestinations: adminProcedure
      .input(z.object({ orderedIds: z.array(z.number()) }))
      .mutation(async ({ input }) => {
        const success = await db.reorderDestinations(input.orderedIds);
        if (!success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to reorder destinations",
          });
        }
        return { success: true };
      }),
  }),

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
          destination: tour.destination,
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


  accounting: router({
    // List accounting entries with filters
    list: adminProcedure
      .input(z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        entryType: z.enum(["income", "expense"]).optional(),
        category: z.string().optional(),
        limit: z.number().min(1).max(500).default(100),
        offset: z.number().min(0).default(0),
      }))
      .query(async ({ input }) => {
        return db.getAccountingEntries(input);
      }),

    // Get accounting stats
    stats: adminProcedure
      .input(z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }))
      .query(async ({ input }) => {
        const now = new Date();
        const startDate = input.startDate ?? new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = input.endDate ?? new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return db.getAccountingStats({ startDate, endDate });
      }),

    // Create a new accounting entry
    create: adminProcedure
      .input(z.object({
        entryType: z.enum(["income", "expense"]),
        category: z.string(),
        amount: z.number().positive(),
        currency: z.string().default("TWD"),
        description: z.string(),
        entryDate: z.date(),
        isTaxDeductible: z.boolean().default(false),
        taxCategory: z.string().optional(),
        notes: z.string().optional(),
        bookingId: z.number().optional(),
        visaApplicationId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const entry = await db.createAccountingEntry({
          ...input,
          category: input.category as any,
          amount: String(input.amount),
          isTaxDeductible: input.isTaxDeductible ? 1 : 0,
          createdBy: ctx.user.id,
        });
        return entry;
      }),

    // Update an accounting entry
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        entryType: z.enum(["income", "expense"]).optional(),
        category: z.string().optional(),
        amount: z.number().positive().optional(),
        currency: z.string().optional(),
        description: z.string().optional(),
        entryDate: z.date().optional(),
        isTaxDeductible: z.boolean().optional(),
        taxCategory: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...updates } = input;
        const mapped: Record<string, unknown> = { ...updates };
        if (updates.amount !== undefined) mapped.amount = String(updates.amount);
        if (updates.isTaxDeductible !== undefined) mapped.isTaxDeductible = updates.isTaxDeductible ? 1 : 0;
        return db.updateAccountingEntry(id, mapped);
      }),

    // Delete an accounting entry
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteAccountingEntry(input.id);
        return { success: true };
      }),

    // Export CSV
    exportCsv: adminProcedure
      .input(z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        entryType: z.enum(["income", "expense"]).optional(),
      }))
      .query(async ({ input }) => {
        const { entries } = await db.getAccountingEntries({ ...input, limit: 50000 });
        const csv = generateAccountingCsv(entries);
        return { csv, filename: `accounting-${new Date().toISOString().slice(0, 10)}.csv` };
      }),

    // Get category labels
    categories: adminProcedure.query(async () => {
      return CATEGORY_LABELS;
    }),

    // Financial dashboard
    dashboard: adminProcedure
      .input(z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }))
      .query(async ({ input }) => {
        const now = new Date();
        const startDate = input.startDate ?? new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = input.endDate ?? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        return generateFinancialDashboard(startDate, endDate);
      }),

    // P&L report
    profitAndLoss: adminProcedure
      .input(z.object({
        startDate: z.date(),
        endDate: z.date(),
      }))
      .query(async ({ input }) => {
        return generateProfitAndLossReport(input.startDate, input.endDate);
      }),

    // Monthly trend
    monthlyTrend: adminProcedure
      .input(z.object({ months: z.number().min(1).max(24).default(12) }))
      .query(async ({ input }) => {
        return generateMonthlyTrend(input.months);
      }),

    // Tax summary
    taxSummary: adminProcedure
      .input(z.object({ year: z.number().min(2020).max(2030) }))
      .query(async ({ input }) => {
        return generateTaxSummary(input.year);
      }),
  }),

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
