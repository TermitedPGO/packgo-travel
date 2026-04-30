import { COOKIE_NAME } from "@shared/const";
import { tourMonitorRouter } from "./routers/tourMonitorRouter";
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
const shortStr = z.string().max(255).refine(noControlChars, { message: "禁止控制字元" });
const mediumStr = z.string().max(5_000).refine(noControlChars, { message: "禁止控制字元" });
const longStr = z.string().max(50_000).refine(noControlChars, { message: "禁止控制字元" });
import * as db from "./db";
import * as skillDb from "./skillDb";
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
import { checkForgotPasswordRateLimitByIP, checkForgotPasswordRateLimitByEmail, checkForgotPasswordGlobalRateLimit, isBlockedEmailDomain, checkBookingCreateRateLimit, checkCheckoutSessionRateLimit, checkAiChatRateLimit, checkAiChatDailyLimit, checkAiChatGlobalAnonymousLimit, checkAiChatUserDailyLimit } from "./rateLimit";

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
          
          // Set cookie
          const cookieOptions = getSessionCookieOptions(ctx.req);
          ctx.res.cookie(COOKIE_NAME, token, { 
            ...cookieOptions, 
            maxAge: 365 * 24 * 60 * 60 * 1000 
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
          console.warn(`[Auth] Blocked forgot-password request to fake domain: ${input.email}`);
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
          console.warn(`[Auth] Email rate limit exceeded for forgot-password: ${input.email}`);
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
        })
      )
      .mutation(async ({ ctx, input }) => {
        const updated = await db.updateUserProfile(ctx.user.id, input);
        if (!updated) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update profile",
          });
        }
        return updated;
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
  
  // AI Travel Advisor router
  ai: router({
    // Skill-enhanced AI chat with performance tracking
    chat: publicProcedure
      .input(
        z.object({
          message: z.string(),
          conversationHistory: z.array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            })
          ).optional(),
          sessionId: z.string().optional(),
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

          return {
            response: result.response,
            triggeredSkills: result.triggeredSkills.map(s => ({
              skillId: s.skillId,
              skillName: s.skillName,
              confidence: s.confidence,
            })),
            usageLogIds: result.usageLogIds,
          };
        } catch (error) {
          console.error("[AI Chat] Error:", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "無法連接到 AI 服務，請稍後再試。",
          });
        }
      }),

    // Record user feedback for AI chat response
    recordFeedback: publicProcedure
      .input(
        z.object({
          usageLogIds: z.array(z.number().int().positive()).max(100),
          feedback: z.enum(["positive", "negative"]),
          comment: mediumStr.optional(), // v73: bound 5KB max
        })
      )
      .mutation(async ({ input }) => {
        const { recordChatFeedback } = await import("./services/aiChatSkillService");
        await recordChatFeedback(input.usageLogIds, input.feedback, input.comment);
        return { success: true };
      }),

    // Record conversion from AI chat session
    recordConversion: publicProcedure
      .input(
        z.object({
          usageLogIds: z.array(z.number()),
          conversionType: z.enum(["booking", "inquiry", "favorite", "share"]),
          conversionId: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
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
    getRouteMap: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const tour = await db.getTourById(input.id);
        if (!tour) return { staticMapUrl: null, stops: [], directionsUrl: null };

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
          return { staticMapUrl: null, stops: [], directionsUrl: null };
        }

        // Build geocode queries — itinerary titles are like "慕尼黑Munich－258km－聖加侖St.Gallen"
        // Strategy: split on multi-city separators, take first chunk, extract trailing English
        // (bilingual format: "ChineseEnglish" with no space — English is more reliable for geocoding)
        const country = (tour as any).destinationCountry || "";

        const _extractFirstPlace = (raw: string): string => {
          if (!raw) return "";
          // 1. Strip "Day N:" / "第 N 日：" prefixes
          let s = String(raw)
            .replace(/^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i, "")
            .replace(/[（(].*?[）)]/g, "")  // strip parentheticals
            .replace(/\+{2,}.*?\+{2,}/g, "") // strip "+++接駁..." asides
            .trim();
          if (!s) return "";

          // 2. Split on multi-city separators (slash, comma, 、, en/em-dash, hyphen-with-spaces, "/")
          // The "－" character is U+FF0D fullwidth hyphen — common in zh-tw itinerary text
          const firstChunk = s.split(/[／/、,，–—－]| - | – /)[0].trim();

          // 3. If chunk contains both Chinese and English (bilingual format), prefer English
          // Pattern: "慕尼黑Munich" → extract "Munich"; "台北 Taipei" → extract "Taipei"
          const englishMatch = firstChunk.match(/[A-Za-z][A-Za-z .'-]+(?:\s*[A-Za-z][A-Za-z .'-]+)*$/);
          if (englishMatch && englishMatch[0].length >= 3) {
            return englishMatch[0].trim();
          }
          return firstChunk;
        };

        const queries: { day: any; q: string }[] = itinerary.map((d: any) => {
          // Prefer explicit location/city, then activities[0].location, then parsed title
          const explicit = (d.location || d.city || "").trim();
          const activityLoc = Array.isArray(d.activities) && d.activities[0]?.location
            ? String(d.activities[0].location).trim() : "";
          const fromTitle = _extractFirstPlace(d.title || "");
          const cleaned = explicit || activityLoc || fromTitle;
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
          };
          const countryEn = _countryEn[country] || country;
          // Only append country if cleaned is purely Chinese (no English) — for
          // English-name queries, Google can geocode cities directly.
          const hasEnglish = /[A-Za-z]{2,}/.test(cleaned);
          const q = countryEn && !cleaned.includes(countryEn) && !hasEnglish
            ? `${cleaned}, ${countryEn}`
            : cleaned;
          return { day: d, q };
        });

        // Geocode each unique query (server-side, with simple in-process cache)
        const _cache = (globalThis as any).__packgoGeocodeCache ||
          ((globalThis as any).__packgoGeocodeCache = new Map<string, { lat: number; lng: number } | null>());

        const { makeRequest } = await import("./_core/map");

        const stops: Array<{ day: number; name: string; lat: number; lng: number }> = [];
        for (let i = 0; i < queries.length; i++) {
          const { day, q } = queries[i];
          if (!q) continue;
          let coord: { lat: number; lng: number } | null = _cache.get(q) ?? null;
          if (coord === null && !_cache.has(q)) {
            try {
              const resp = await makeRequest<any>("/maps/api/geocode/json", { address: q });
              if (resp?.status && resp.status !== "OK" && resp.status !== "ZERO_RESULTS") {
                console.warn(`[getRouteMap] geocode "${q}" returned status=${resp.status}: ${resp.error_message || ""}`);
              }
              const loc = resp?.results?.[0]?.geometry?.location;
              if (loc?.lat && loc?.lng) {
                coord = { lat: loc.lat, lng: loc.lng };
              }
            } catch (err) {
              console.warn(`[getRouteMap] geocode failed for "${q}":`, (err as Error).message);
            }
            _cache.set(q, coord);
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
        if (stops.length === 0) {
          const countryEnFallback: Record<string, string> = {
            "瑞士": "Switzerland", "德國": "Germany", "奧地利": "Austria",
            "法國": "France", "義大利": "Italy", "英國": "United Kingdom",
            "美國": "USA", "日本": "Japan", "韓國": "South Korea",
            "馬來西亞": "Malaysia", "泰國": "Thailand", "新加坡": "Singapore",
          };
          const countryNameForMap = countryEnFallback[country] || country;
          if (countryNameForMap) {
            const apiKey = process.env.GOOGLE_API_KEY || "";
            const params = new URLSearchParams();
            params.set("size", "1200x520");
            params.set("scale", "2");
            params.set("maptype", "roadmap");
            params.set("center", countryNameForMap);
            params.set("zoom", "6");
            params.set("key", apiKey);
            const fallbackUrl = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
            const directionsFallback = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(countryNameForMap)}`;
            return {
              staticMapUrl: fallbackUrl,
              stops: [],
              directionsUrl: directionsFallback,
              fallbackMode: "country" as const,
            };
          }
          return { staticMapUrl: null, stops: [], directionsUrl: null };
        }

        // Build Google Static Maps URL — numbered labels (max 26 supported via A-Z)
        // Use color "blue" + label number for each stop, plus a path connecting them
        const apiKey = process.env.GOOGLE_API_KEY || "";
        const baseUrl = "https://maps.googleapis.com/maps/api/staticmap";
        const params = new URLSearchParams();
        params.set("size", "1200x520");
        params.set("scale", "2"); // retina
        params.set("maptype", "roadmap");
        // Markers: one parameter per stop with auto-numbered label
        // Note: Static Maps labels only support A-Z so we use a series of markers
        stops.slice(0, 26).forEach((s, i) => {
          const label = String.fromCharCode(65 + i); // A, B, C, ...
          params.append("markers", `color:0x0d9488|label:${label}|${s.lat},${s.lng}`);
        });
        // Path polyline (semi-transparent teal)
        if (stops.length >= 2) {
          const path = stops.map((s) => `${s.lat},${s.lng}`).join("|");
          params.append("path", `color:0x0d9488aa|weight:3|${path}`);
        }
        params.set("key", apiKey);
        const staticMapUrl = `${baseUrl}?${params.toString()}`;

        // Build "Open in Google Maps" multi-stop URL
        const directionsUrl =
          stops.length >= 2
            ? `https://www.google.com/maps/dir/?api=1&origin=${stops[0].lat},${stops[0].lng}&destination=${stops[stops.length - 1].lat},${stops[stops.length - 1].lng}` +
              (stops.length > 2
                ? `&waypoints=${stops.slice(1, -1).map((s) => `${s.lat},${s.lng}`).join("|")}`
                : "")
            : `https://www.google.com/maps/search/?api=1&query=${stops[0].lat},${stops[0].lng}`;

        return { staticMapUrl, stops, directionsUrl };
      }),

    // Get distinct departure cities from active tours (for search autocomplete)
    getDepartureCities: publicProcedure.query(async () => {
      return await db.getDepartureCities();
    }),

    // Search tours with filters (public)
    search: publicProcedure
      .input(
        z.object({
          destination: z.string().optional(),
          category: z.string().optional(),
          minDays: z.number().optional(),
          maxDays: z.number().optional(),
          minPrice: z.number().optional(),
          maxPrice: z.number().optional(),
          airlines: z.array(z.string()).optional(),
          hotelGrades: z.array(z.string()).optional(),
          specialActivities: z.array(z.string()).optional(),
          tags: z.array(z.string()).optional(),
          sortBy: z.enum(["popular", "price_asc", "price_desc", "days_asc", "days_desc"]).optional(),
          page: z.number().min(1).default(1),
          pageSize: z.number().min(1).max(100).default(12),
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
          startDate: z.date().optional(),
          endDate: z.date().optional(),
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
          startDate: z.date().optional(),
          endDate: z.date().optional(),
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

        await db.deleteTour(input.id);

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
        await db.batchDeleteTours(input.ids);
        const { audit } = await import("./_core/auditLog");
        audit({
          ctx,
          action: "tour.batchDelete",
          targetType: "tour",
          targetId: `batch[${input.ids.length}]`,
          changes: { ids: input.ids },
        });
        return { success: true };
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

        // Toggle status: active <-> inactive
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

        const totalPrice =
          adults * adultPrice +
          childWithBed * childWithBedPrice +
          childNoBed * childNoBedPrice +
          infants * infantPrice +
          singleRooms * singleSupplement;

        if (totalPrice <= 0) {
          // Capacity already incremented — release before throwing
          await db.releaseDepartureSlots(input.departureId, totalSeatsRequested).catch(() => {});
          throw new TRPCError({ code: "BAD_REQUEST", message: "計算金額異常" });
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
          depositAmount: Math.floor(totalPrice * 0.2),
          remainingAmount: totalPrice - Math.floor(totalPrice * 0.2),
          language: input.language, // v78x: customer's preferred email language
        }).catch((emailErr) =>
          console.error(
            `[bookings.create] Email send failed for booking ${booking.id}:`,
            emailErr?.message
          )
        );

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

    // Create new inquiry
    create: publicProcedure
      .input(
        z.object({
          customerName: z.string().min(1),
          customerEmail: z.string().email(),
          customerPhone: z.string().optional(),
          subject: z.string().min(1),
          message: z.string().min(1),
        })
      )
      .mutation(async ({ input, ctx }) => {
        return await db.createInquiry({
          ...input,
          inquiryType: "general",
          userId: ctx.user?.id,
          status: "new",
        });
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
    // Subscribe to newsletter
    subscribe: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ input }) => {
        try {
          // Check if already subscribed
          const existing = await db.getNewsletterSubscriberByEmail(input.email);
          if (existing) {
            if (existing.status === 'active') {
              return { success: true, message: '您已訂閱電子報，感謝您的支持！', alreadySubscribed: true };
            }
            // Re-subscribe
            await db.resubscribeNewsletter(input.email);
          } else {
            await db.createNewsletterSubscriber({ email: input.email });
          }
          // Send confirmation email (best-effort)
          try {
            const { sendNewsletterConfirmationEmail } = await import('./emailService');
            await sendNewsletterConfirmationEmail(input.email);
          } catch (emailErr) {
            console.warn('[Newsletter] Failed to send confirmation email:', emailErr);
          }
          // Notify owner
          try {
            const { notifyOwner } = await import('./_core/notification');
            await notifyOwner({ title: '新電子報訂閱', content: `新訂閱者：${input.email}` });
          } catch {}
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
    // Get dashboard statistics (real data)
    getStats: adminProcedure.query(async () => {
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
      const [totalToursRow] = await drizzleDb.select({ count: countFn() }).from(toursTable);
      const [activeToursRow] = await drizzleDb.select({ count: countFn() }).from(toursTable).where(eqFn(toursTable.status, 'active'));
      const [totalBookingsRow] = await drizzleDb.select({ count: countFn() }).from(bookingsTable);
      const [todayBookingsRow] = await drizzleDb.select({ count: countFn() }).from(bookingsTable).where(gteFn(bookingsTable.createdAt, startOfToday));
      const [totalRevenueRow] = await drizzleDb.select({ total: sqlFn<number>`COALESCE(SUM(${bookingsTable.totalPrice}), 0)` }).from(bookingsTable).where(sqlFn`${bookingsTable.bookingStatus} IN ('confirmed', 'completed')`);
      const [thisMonthRevenueRow] = await drizzleDb.select({ total: sqlFn<number>`COALESCE(SUM(${bookingsTable.totalPrice}), 0)` }).from(bookingsTable).where(sqlFn`${bookingsTable.bookingStatus} IN ('confirmed', 'completed') AND ${bookingsTable.createdAt} >= ${startOfThisMonth}`);
      const [lastMonthRevenueRow] = await drizzleDb.select({ total: sqlFn<number>`COALESCE(SUM(${bookingsTable.totalPrice}), 0)` }).from(bookingsTable).where(sqlFn`${bookingsTable.bookingStatus} IN ('confirmed', 'completed') AND ${bookingsTable.createdAt} >= ${startOfLastMonth} AND ${bookingsTable.createdAt} <= ${endOfLastMonth}`);
      const [totalInquiriesRow] = await drizzleDb.select({ count: countFn() }).from(inquiriesTable);
      const [pendingInquiriesRow] = await drizzleDb.select({ count: countFn() }).from(inquiriesTable).where(sqlFn`${inquiriesTable.status} IN ('new', 'in_progress')`);
      const [totalUsersRow] = await drizzleDb.select({ count: countFn() }).from(usersTable);
      const [totalSubscribersRow] = await drizzleDb.select({ count: countFn() }).from(newsletterTable).where(eqFn(newsletterTable.status, 'active'));
      const thisMonthRevenue = Number(thisMonthRevenueRow?.total ?? 0);
      const lastMonthRevenue = Number(lastMonthRevenueRow?.total ?? 0);
      const revenueGrowth = lastMonthRevenue > 0 ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 : (thisMonthRevenue > 0 ? 100 : 0);
      return {
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

});
export type AppRouter = typeof appRouter;
