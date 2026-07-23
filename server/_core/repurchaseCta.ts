/**
 * Round 81 / 2026-05-17 — Repurchase upgrade CTA appender.
 *
 * Detects "repeat customer who hasn't been pitched Plus" and appends a
 * short PS to InquiryAgent's draft reply offering the 10-day Plus trial.
 *
 * Rules (gates):
 *   1. Customer has ≥1 confirmed booking OR is on their ≥2nd inquiry in 60 days
 *   2. Customer is currently on `free` tier (not Plus or Concierge)
 *   3. We've never sent them this upgrade prompt before (users.upgradePromptSentAt is null)
 *
 * Side effects:
 *   • Sets users.upgradePromptSentAt = now() so we don't double-pitch
 *   • Increments users.inquiryCount + sets lastInquiryAt
 *
 * Idempotent: re-calling with the same email returns the same input
 * unchanged if any gate fails (no duplicate PS).
 */
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "repurchaseCta" });

export interface MaybeAppendUpgradeArgs {
  draftReply: string;
  senderEmail: string;
  language?: "zh-TW" | "en" | string;
  /** Optional: caller may pass current bookingCount to avoid an extra query. */
  bookingCount?: number;
}

/**
 * The literal CTA copy appended to a draft. Exported PURE so the final send
 * chokepoint regression can prove the real copy — which deliberately still
 * contains Markdown `**` and em dashes — is neutralized by
 * stripMarkdownForEmail before any autonomous send (Codex 16:02 P1-3).
 */
export function buildUpgradeCta(language: string | undefined, baseUrl: string): string {
  const isEN = language === "en";
  return isEN
    ? `\n\n— — — — — — — — — — — — — — — — —\nP.S. Since you've travelled with us before, you may enjoy **PACK&GO Plus**. AI remembers your preferences (food, accommodation, pace) so next time we plan your trip, you get 3 tailored options in seconds — not generic catalog. 10-day free trial, cancel anytime online.\nLearn more: ${baseUrl}/membership`
    : `\n\n— — — — — — — — — — — — — — — — —\nP.S. 您之前跟我們旅行過,可能會喜歡 **PACK&GO Plus**。讓 AI 記住您的偏好(飲食、住宿、節奏),下次規劃旅程 10 秒給您 3 個量身選項,不再是制式 catalog。10 天免費試用,可隨時線上取消。\n了解更多:${baseUrl}/membership`;
}

export async function maybeAppendUpgradeCta(args: MaybeAppendUpgradeArgs): Promise<{
  draftReply: string;
  appended: boolean;
  reason?: string;
}> {
  const senderEmail = args.senderEmail?.toLowerCase().trim();
  if (!senderEmail) {
    return { draftReply: args.draftReply, appended: false, reason: "no_email" };
  }

  try {
    const { getDb } = await import("../db");
    const { users } = await import("../../drizzle/schema");
    const { eq, and, gte, sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { draftReply: args.draftReply, appended: false, reason: "no_db" };

    // Lookup user by email
    const rows = await db
      .select({
        id: users.id,
        tier: users.tier,
        bookingCount: users.bookingCount,
        inquiryCount: users.inquiryCount,
        lastInquiryAt: users.lastInquiryAt,
        upgradePromptSentAt: users.upgradePromptSentAt,
      })
      .from(users)
      .where(eq(users.email, senderEmail))
      .limit(1);

    if (rows.length === 0) {
      // Unknown sender — increment will happen elsewhere (gmailPipeline)
      // and we don't pitch to people not in our users table.
      return { draftReply: args.draftReply, appended: false, reason: "user_not_found" };
    }

    const user = rows[0];

    // Always bump inquiry counters
    await db
      .update(users)
      .set({
        inquiryCount: sql`${users.inquiryCount} + 1`,
        lastInquiryAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Gate 1: tier must be free (paid members already get personalization)
    if (user.tier !== "free") {
      return { draftReply: args.draftReply, appended: false, reason: "already_paid_member" };
    }

    // Gate 2: must be a "repeat customer" signal
    const isRepeatBooker = (args.bookingCount ?? user.bookingCount ?? 0) >= 1;
    const recentInquiryThreshold = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    const isRepeatInquirer =
      (user.inquiryCount ?? 0) >= 1 && // about to be ≥2 after this one
      user.lastInquiryAt != null &&
      user.lastInquiryAt > recentInquiryThreshold;

    if (!isRepeatBooker && !isRepeatInquirer) {
      return { draftReply: args.draftReply, appended: false, reason: "not_repeat_customer" };
    }

    // Gate 3: never pitched before
    if (user.upgradePromptSentAt) {
      return { draftReply: args.draftReply, appended: false, reason: "already_pitched" };
    }

    // All gates passed → append CTA + mark pitched
    const baseUrl = process.env.BASE_URL || "https://packgoplay.com";
    const cta = buildUpgradeCta(args.language, baseUrl);

    const augmentedDraft = args.draftReply + cta;

    await db
      .update(users)
      .set({ upgradePromptSentAt: new Date() })
      .where(eq(users.id, user.id));

    log.info(
      {
        userId: user.id,
        senderEmail,
        bookingCount: user.bookingCount,
        inquiryCount: user.inquiryCount,
      },
      "[repurchaseCta] Appended upgrade CTA",
    );

    return { draftReply: augmentedDraft, appended: true, reason: "appended" };
  } catch (err) {
    log.error({ err }, "[repurchaseCta] Failed");
    // Never fail the inquiry pipeline because of a marketing append
    return { draftReply: args.draftReply, appended: false, reason: "error" };
  }
}
