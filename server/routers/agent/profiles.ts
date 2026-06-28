/**
 * agent.* profile + interaction logging sub-router.
 *
 * v2 Wave 2 Module 2.10 (2026-05-21): extracted from
 * server/routers/agentRouter.ts when the monolith was split into eight
 * domain sub-routers. Covers Layer-1 customer-memory plumbing: identity
 * resolution across channels, profile reads with recent interactions,
 * preference learning, and inbound/outbound interaction logging.
 *
 * Procedures (5):
 *   - findProfile
 *   - upsertByIdentifier
 *   - getProfileWithContext
 *   - updateLearnedPreferences
 *   - logInteraction
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc, or } from "drizzle-orm";
import { router, adminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import { customerProfiles, customerInteractions } from "../../../drizzle/schema";
import { AGENT_NAMES, channelEnum } from "./_shared";

export const profilesRouter = router({
  /**
   * Look up a profile by any channel identifier (email / phone / wechat
   * / line / whatsapp / userId). Used by every agent to pull context
   * before deciding/replying. Returns null when no profile exists yet
   * (caller should create one via upsertByIdentifier).
   */
  findProfile: adminProcedure
    .input(
      z.object({
        userId: z.number().int().optional(),
        email: z.string().email().optional(),
        phone: z.string().max(32).optional(),
        wechatId: z.string().max(100).optional(),
        lineId: z.string().max(100).optional(),
        whatsappPhone: z.string().max(32).optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const conds = [];
      if (input.userId) conds.push(eq(customerProfiles.userId, input.userId));
      if (input.email) conds.push(eq(customerProfiles.email, input.email));
      if (input.phone) conds.push(eq(customerProfiles.phone, input.phone));
      if (input.wechatId) conds.push(eq(customerProfiles.wechatId, input.wechatId));
      if (input.lineId) conds.push(eq(customerProfiles.lineId, input.lineId));
      if (input.whatsappPhone)
        conds.push(eq(customerProfiles.whatsappPhone, input.whatsappPhone));
      if (conds.length === 0) return null;
      const rows = await db
        .select()
        .from(customerProfiles)
        .where(or(...conds))
        .limit(1);
      return rows[0] ?? null;
    }),

  /**
   * Upsert profile by identifier. If a profile exists matching ANY of
   * the provided identifiers, merge the new ones (multi-channel identity
   * resolution). Otherwise create. Returns the resolved profile id.
   */
  upsertByIdentifier: adminProcedure
    .input(
      z.object({
        userId: z.number().int().optional(),
        email: z.string().email().optional(),
        phone: z.string().max(32).optional(),
        wechatId: z.string().max(100).optional(),
        lineId: z.string().max(100).optional(),
        whatsappPhone: z.string().max(32).optional(),
        preferredLanguage: z.string().max(8).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conds = [];
      if (input.userId) conds.push(eq(customerProfiles.userId, input.userId));
      if (input.email) conds.push(eq(customerProfiles.email, input.email));
      if (input.phone) conds.push(eq(customerProfiles.phone, input.phone));
      if (input.wechatId) conds.push(eq(customerProfiles.wechatId, input.wechatId));
      if (input.lineId) conds.push(eq(customerProfiles.lineId, input.lineId));
      if (input.whatsappPhone)
        conds.push(eq(customerProfiles.whatsappPhone, input.whatsappPhone));
      if (conds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "At least one identifier required",
        });
      }
      const existing = await db
        .select()
        .from(customerProfiles)
        .where(or(...conds))
        .limit(1);
      if (existing[0]) {
        // Merge in any missing identifiers
        const mergeFields: Record<string, unknown> = {};
        if (input.userId && !existing[0].userId) mergeFields.userId = input.userId;
        if (input.email && !existing[0].email) mergeFields.email = input.email;
        if (input.phone && !existing[0].phone) mergeFields.phone = input.phone;
        if (input.wechatId && !existing[0].wechatId) mergeFields.wechatId = input.wechatId;
        if (input.lineId && !existing[0].lineId) mergeFields.lineId = input.lineId;
        if (input.whatsappPhone && !existing[0].whatsappPhone)
          mergeFields.whatsappPhone = input.whatsappPhone;
        if (Object.keys(mergeFields).length > 0) {
          await db
            .update(customerProfiles)
            .set(mergeFields)
            .where(eq(customerProfiles.id, existing[0].id));
        }
        return { id: existing[0].id, created: false };
      }
      const result = await db.insert(customerProfiles).values({
        userId: input.userId,
        email: input.email,
        phone: input.phone,
        wechatId: input.wechatId,
        lineId: input.lineId,
        whatsappPhone: input.whatsappPhone,
        preferredLanguage: input.preferredLanguage ?? "zh-TW",
      });
      return {
        id: Number((result as any)[0]?.insertId ?? 0),
        created: true,
      };
    }),

  /**
   * Read full profile with recent interactions for AI context. Limit
   * recent interactions to 20 so prompt size stays bounded.
   */
  getProfileWithContext: adminProcedure
    .input(z.object({ profileId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [profile] = await db
        .select()
        .from(customerProfiles)
        .where(eq(customerProfiles.id, input.profileId))
        .limit(1);
      if (!profile) return null;
      const recentInteractions = await db
        .select()
        .from(customerInteractions)
        .where(eq(customerInteractions.customerProfileId, input.profileId))
        .orderBy(desc(customerInteractions.createdAt))
        .limit(20);
      return { profile, recentInteractions };
    }),

  /**
   * Update AI-learned preferences (called by agents after each interaction
   * to refresh aiNotes / communicationStyle / budgetTier / etc).
   */
  updateLearnedPreferences: adminProcedure
    .input(
      z.object({
        profileId: z.number().int(),
        preferredLanguage: z.string().max(8).optional(),
        communicationStyle: z
          .enum(["formal", "casual", "detailed", "concise"])
          .optional(),
        preferredChannel: z.string().max(20).optional(),
        familyContext: z.string().max(2000).optional(),
        budgetTier: z.number().int().min(1).max(5).optional(),
        vipScore: z.number().int().min(0).max(100).optional(),
        aiNotes: z.string().max(5000).optional(),
        keyFacts: z.string().max(5000).optional(),
        preferences: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { profileId, ...fields } = input;
      const updates = Object.fromEntries(
        Object.entries(fields).filter(([_, v]) => v !== undefined),
      );
      if (Object.keys(updates).length === 0) return { updated: false };
      await db
        .update(customerProfiles)
        .set(updates)
        .where(eq(customerProfiles.id, profileId));
      return { updated: true };
    }),

  /**
   * Log every customer-side message (inbound) or agent reply (outbound).
   * AI agents call this for every action they take.
   */
  logInteraction: adminProcedure
    .input(
      z.object({
        customerProfileId: z.number().int(),
        channel: channelEnum,
        direction: z.enum(["inbound", "outbound"]),
        content: z.string().max(50_000),
        contentSummary: z.string().max(2000).optional(),
        generatedBy: z
          .enum(["human", "ai_auto", "ai_draft_human_approved"])
          .optional(),
        agentName: z.enum(AGENT_NAMES).optional(),
        sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
        classification: z.string().max(50).optional(),
        urgency: z.number().int().min(0).max(100).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const result = await db.insert(customerInteractions).values({
        customerProfileId: input.customerProfileId,
        channel: input.channel,
        direction: input.direction,
        content: input.content,
        contentSummary: input.contentSummary,
        generatedBy: input.generatedBy,
        agentName: input.agentName,
        sentiment: input.sentiment,
        classification: input.classification,
        urgency: input.urgency ?? 50,
      });
      const interactionId = Number((result as any)[0]?.insertId ?? 0);
      // Refresh lastInteractionAt + bookingCount on profile
      await db
        .update(customerProfiles)
        .set({ lastInteractionAt: new Date() })
        .where(eq(customerProfiles.id, input.customerProfileId));

      // customer-cockpit Step 3 — a new interaction means the card may be stale:
      // refresh the AI summary now (debounced) instead of waiting for the nightly
      // cron. Fire-forget; never blocks the write.
      void (async () => {
        try {
          const { enqueueCustomerSummaryRefresh } = await import("../../queue");
          await enqueueCustomerSummaryRefresh(input.customerProfileId);
        } catch {
          /* non-fatal */
        }
      })();

      return { interactionId };
    }),
});
