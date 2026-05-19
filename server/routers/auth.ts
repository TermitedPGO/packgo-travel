/**
 * Auth router — email/password registration, login, password reset, profile.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 *
 * Procedures (9):
 *   - me                      – current user (sanitized)
 *   - register                – create account + auto-login
 *   - login                   – authenticate + cookie (rate-limited)
 *   - requestPasswordReset    – send reset email (reCAPTCHA + multi-layer rate limit)
 *   - resetPassword           – consume reset token
 *   - logout                  – clear session cookie
 *   - updateProfile           – update name/phone/address/birthDate (set-once)
 *   - uploadAvatar            – set avatar URL
 *   - deleteAvatar            – clear avatar
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getSessionCookieOptions } from "../_core/cookies";
import * as auth from "../auth";
import * as db from "../db";
import { createToken } from "../jwt";
import {
  checkForgotPasswordRateLimitByIP,
  checkForgotPasswordRateLimitByEmail,
  checkForgotPasswordGlobalRateLimit,
  checkLoginRateLimitByIP,
  checkLoginRateLimitByEmail,
  isBlockedEmailDomain,
} from "../rateLimit";

// v74 bounded string helpers
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const noControlChars = (s: string) => !CONTROL_CHARS.test(s);
const shortStr = z.string().max(255).refine(noControlChars, { message: "禁止控制字元 / Control characters not allowed" });

export const authRouter = router({
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
          const { redactEmail } = await import("../_core/redact");
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
          const { redactEmail: r1 } = await import("../_core/redact");
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
          const { redactEmail: r2 } = await import("../_core/redact");
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
            const { users: usersTable } = await import("../../drizzle/schema");
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
  });
