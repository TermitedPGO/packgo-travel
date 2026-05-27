/**
 * Newsletter router — public subscribe / unsubscribe + admin list/export.
 *
 * Extracted from server/routers.ts (Phase 4A · sub-PR 1 of 5) on
 * 2026-05-18 as part of the routers.ts split (audit P0-1).
 * All procedures verbatim from the source range L5325-5434.
 *
 * Security notes (preserved from origin):
 *   - SECURITY_AUDIT_2026_05_14 P1-4 hardening: 320-char email cap,
 *     per-IP rate limit (5 / hour), owner notification only fires for
 *     NEW subscribers — duplicate resubscribes don't notify, killing
 *     the email-spam-Jeff bot vector.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { checkRateLimit } from "../rateLimit";

export const newsletterRouter = router({
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
          const { sendNewsletterConfirmationEmail } = await import('../emailService');
          await sendNewsletterConfirmationEmail(input.email);
        } catch (emailErr) {
          console.warn('[Newsletter] Failed to send confirmation email:', emailErr);
        }
        // Notify owner ONLY for genuinely new subscribers — prevents
        // owner-inbox spam via repeated resubscribe attempts.
        if (isNewSubscriber) {
          try {
            const { notifyOwner } = await import('../_core/notification');
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

  // Admin: list all subscribers (including unsubscribed)
  listSubscribers: adminProcedure
    .input(z.object({
      status: z.enum(['active', 'unsubscribed', 'all']).default('active'),
      limit: z.number().default(100),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const subscribers = await db.getAllNewsletterSubscribersIncludingUnsubscribed();
      const filtered = input.status === 'all'
        ? subscribers
        : subscribers.filter((s: any) => s.status === input.status);
      return {
        subscribers: filtered.slice(input.offset, input.offset + input.limit),
        total: filtered.length,
      };
    }),

  // Admin: export subscribers as CSV (all statuses)
  exportSubscribers: adminProcedure
    .query(async () => {
      const subscribers = await db.getAllNewsletterSubscribersIncludingUnsubscribed();
      const csv = [
        'Email,Status,Subscribed At,Unsubscribed At',
        ...subscribers.map((s: any) =>
          `${s.email},${s.status},${new Date(s.subscribedAt).toISOString()},${s.unsubscribedAt ? new Date(s.unsubscribedAt).toISOString() : ''}`
        )
      ].join('\n');
      return { csv, count: subscribers.length };
    }),
});
