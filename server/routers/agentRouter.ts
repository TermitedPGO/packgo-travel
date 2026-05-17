/**
 * Round 81 — Autonomous AI Agents foundation.
 *
 * tRPC endpoints for the Layer 0 (outcome tracking) + Layer 1 (customer
 * memory) infrastructure. Each individual agent (Inquiry / Review /
 * Marketing / Followup / Refund) reads + writes through this router so
 * we have a single point of audit + access control.
 *
 * No agent decision logic lives here yet — that goes in
 * server/agents/autonomous/<agentName>.ts in subsequent rounds. This file
 * is just plumbing: read profiles, log interactions, record outcomes,
 * version policies.
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  customerProfiles,
  customerInteractions,
  interactionOutcomes,
  agentPolicies,
  agentMetrics,
  agentActivityLogs,
  agentMessages,
  gmailIntegration,
} from "../../drizzle/schema";
import { eq, and, desc, or, sql, inArray } from "drizzle-orm";
import {
  runInquiryAgent,
  DEFAULT_INQUIRY_POLICY,
} from "../agents/autonomous/inquiryAgent";
import { runReviewAgent, DEFAULT_REVIEW_POLICY } from "../agents/autonomous/reviewAgent";
import { runMarketingAgent, DEFAULT_MARKETING_POLICY } from "../agents/autonomous/marketingAgent";
import { runFollowupAgent, DEFAULT_FOLLOWUP_POLICY } from "../agents/autonomous/followupAgent";
import { runRefundAgent, DEFAULT_REFUND_POLICY } from "../agents/autonomous/refundAgent";
import { getGmailAuthUrl, verifyConnection } from "../_core/gmail";
import { runGmailPipeline } from "../agents/autonomous/gmailPipeline";
import { runAgentChat } from "../agents/autonomous/agentChat";
import { runAgentReport, formatReportAsMessage } from "../agents/autonomous/agentReport";
import { runOfficeAssistant } from "../agents/autonomous/officeAssistant";
import {
  runSelfRetrospective,
  formatRetrospectiveAsMessage,
} from "../agents/autonomous/selfRetrospective";

const AGENT_NAMES = [
  "inquiry",
  "review",
  "marketing",
  "followup",
  "refund",
  "self_retrospective",
] as const;

const channelEnum = z.enum([
  "email",
  "whatsapp",
  "wechat",
  "line",
  "sms",
  "phone",
  "web_form",
  "review",
]);

export const agentRouter = router({
  // ─────────────────────────────────────────────────────────────────
  // Customer Profiles — Layer 1
  // ─────────────────────────────────────────────────────────────────

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
      })
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
      })
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
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { profileId, ...fields } = input;
      const updates = Object.fromEntries(
        Object.entries(fields).filter(([_, v]) => v !== undefined)
      );
      if (Object.keys(updates).length === 0) return { updated: false };
      await db
        .update(customerProfiles)
        .set(updates)
        .where(eq(customerProfiles.id, profileId));
      return { updated: true };
    }),

  // ─────────────────────────────────────────────────────────────────
  // Customer Interactions — Layer 1
  // ─────────────────────────────────────────────────────────────────

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
      })
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
      return { interactionId };
    }),

  // ─────────────────────────────────────────────────────────────────
  // Outcome Tracking — Layer 0
  // ─────────────────────────────────────────────────────────────────

  /**
   * Record an outcome the moment an agent acts. Most fields are filled
   * later via measureOutcomes (cron job). The initial record captures
   * which decision was made + the policy version + AI confidence.
   */
  recordAction: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        interactionId: z.number().int(),
        customerProfileId: z.number().int().optional(),
        actionTaken: z.string().max(50),
        confidence: z.number().int().min(0).max(100).optional(),
        policyVersion: z.number().int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const result = await db.insert(interactionOutcomes).values({
        agentName: input.agentName,
        interactionId: input.interactionId,
        customerProfileId: input.customerProfileId,
        actionTaken: input.actionTaken,
        confidence: input.confidence,
        policyVersion: input.policyVersion,
      });
      return { outcomeId: Number((result as any)[0]?.insertId ?? 0) };
    }),

  /**
   * Update outcome with downstream observations. Called by background
   * jobs that detect customer reply / booking / review / refund events.
   */
  updateOutcome: adminProcedure
    .input(
      z.object({
        outcomeId: z.number().int(),
        customerReplied: z.boolean().optional(),
        customerReplyTimeMs: z.number().int().optional(),
        customerSentiment: z
          .enum(["positive", "neutral", "negative"])
          .optional(),
        customerBooked: z.boolean().optional(),
        bookedAmount: z.number().int().optional(),
        customerOptedOut: z.boolean().optional(),
        reviewSubmitted: z.boolean().optional(),
        reviewRating: z.number().int().min(1).max(5).optional(),
        refundRequested: z.boolean().optional(),
        jeffOverride: z.boolean().optional(),
        jeffOverrideReason: z.string().max(500).optional(),
        outcomeFinalized: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { outcomeId, ...fields } = input;
      const updates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        if (typeof v === "boolean") updates[k] = v ? 1 : 0;
        else updates[k] = v;
      }
      if (Object.keys(updates).length === 0) return { updated: false };
      await db
        .update(interactionOutcomes)
        .set(updates)
        .where(eq(interactionOutcomes.id, outcomeId));
      return { updated: true };
    }),

  /**
   * Read recent outcomes for an agent — used by self-retrospective +
   * admin dashboard.
   */
  recentOutcomes: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        limit: z.number().int().min(1).max(500).default(100),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(interactionOutcomes)
        .where(eq(interactionOutcomes.agentName, input.agentName))
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(input.limit);
    }),

  // ─────────────────────────────────────────────────────────────────
  // Agent Policies — Layer 0
  // ─────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────
  // Phase 2 (Round 81 — Learning System): auto-send threshold
  //
  // Each Round 81 agent has two fields in its policy JSON:
  //   - autoSendEnabled (boolean) — master toggle
  //   - autoSendMinConfidence (number 50-95) — threshold
  //
  // When ON + confidence ≥ threshold + agent says shouldAutoReply, the
  // pipeline marks the outcome as "auto_replied" instead of "auto_draft".
  // (Actually sending the email is gated by a separate switch that lives
  // in the gmail pipeline — flipping autoSendEnabled here only authorizes
  // the system; real send needs Phase 2.5 wiring.)
  // ─────────────────────────────────────────────────────────────────

  getAutoSendSettings: adminProcedure
    .input(z.object({ agentName: z.enum(AGENT_NAMES) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { enabled: false, minConfidence: 85 };
      const [row] = await db
        .select({ rules: agentPolicies.rules })
        .from(agentPolicies)
        .where(and(eq(agentPolicies.agentName, input.agentName), eq(agentPolicies.active, 1)))
        .limit(1);
      if (!row) return { enabled: false, minConfidence: 85 };
      try {
        const policy = JSON.parse(row.rules);
        return {
          enabled: Boolean(policy.autoSendEnabled),
          minConfidence:
            typeof policy.autoSendMinConfidence === "number"
              ? policy.autoSendMinConfidence
              : 85,
        };
      } catch {
        return { enabled: false, minConfidence: 85 };
      }
    }),

  setAutoSendSettings: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        enabled: z.boolean(),
        minConfidence: z.number().int().min(50).max(95),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [row] = await db
        .select()
        .from(agentPolicies)
        .where(and(eq(agentPolicies.agentName, input.agentName), eq(agentPolicies.active, 1)))
        .limit(1);

      let policy: any = {};
      if (row) {
        try {
          policy = JSON.parse(row.rules);
        } catch {
          policy = {};
        }
      }
      policy.autoSendEnabled = input.enabled;
      policy.autoSendMinConfidence = input.minConfidence;
      const newRules = JSON.stringify(policy, null, 2);

      if (row) {
        // Update in place (don't bump version for tweaks like this)
        await db
          .update(agentPolicies)
          .set({ rules: newRules })
          .where(eq(agentPolicies.id, row.id));
        return { ok: true, version: row.version };
      } else {
        // Cold-start — seed v1 with the new auto-send fields baked in
        const ins = await db.insert(agentPolicies).values({
          agentName: input.agentName,
          version: 1,
          rules: newRules,
          active: 1,
          createdBy: "human",
          reasonNote: "Initial v1 (created when Jeff set auto-send settings)",
        });
        return {
          ok: true,
          version: 1,
          newId: Number((ins as any)[0]?.insertId ?? 0),
        };
      }
    }),

  /**
   * Get the active policy for an agent. Falls back to a hardcoded v1
   * default if no row exists yet (cold-start safety).
   */
  getActivePolicy: adminProcedure
    .input(z.object({ agentName: z.enum(AGENT_NAMES) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db
        .select()
        .from(agentPolicies)
        .where(
          and(
            eq(agentPolicies.agentName, input.agentName),
            eq(agentPolicies.active, 1)
          )
        )
        .limit(1);
      return row ?? null;
    }),

  /**
   * Create a new policy version. The new version becomes active and any
   * previously-active version is deactivated. Used by both human admin
   * and the self-retrospective agent.
   */
  upsertPolicy: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        rules: z.string().max(50_000),
        createdBy: z.enum(["human", "self_retrospective", "rollback"]),
        reasonNote: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Deactivate the current active version
      await db
        .update(agentPolicies)
        .set({ active: 0 })
        .where(
          and(
            eq(agentPolicies.agentName, input.agentName),
            eq(agentPolicies.active, 1)
          )
        );
      // Find next version number
      const [latest] = await db
        .select({ version: agentPolicies.version })
        .from(agentPolicies)
        .where(eq(agentPolicies.agentName, input.agentName))
        .orderBy(desc(agentPolicies.version))
        .limit(1);
      const nextVersion = (latest?.version ?? 0) + 1;
      const result = await db.insert(agentPolicies).values({
        agentName: input.agentName,
        version: nextVersion,
        rules: input.rules,
        active: 1,
        createdBy: input.createdBy,
        reasonNote: input.reasonNote,
      });
      return {
        policyId: Number((result as any)[0]?.insertId ?? 0),
        version: nextVersion,
      };
    }),

  /**
   * Roll back to an older policy version. Marks that version active
   * again, deactivates current. Audit trail preserved (no rows deleted).
   */
  rollbackPolicy: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        targetVersion: z.number().int(),
        reasonNote: z.string().max(2000),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(agentPolicies)
        .set({ active: 0 })
        .where(
          and(
            eq(agentPolicies.agentName, input.agentName),
            eq(agentPolicies.active, 1)
          )
        );
      await db
        .update(agentPolicies)
        .set({ active: 1, reasonNote: input.reasonNote })
        .where(
          and(
            eq(agentPolicies.agentName, input.agentName),
            eq(agentPolicies.version, input.targetVersion)
          )
        );
      return { ok: true };
    }),

  // ─────────────────────────────────────────────────────────────────
  // Agent Metrics — Layer 0
  // ─────────────────────────────────────────────────────────────────

  /**
   * Read recent weekly metrics for the dashboard. Returns last 12 weeks
   * by default — enough to render a trend chart.
   */
  recentMetrics: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        weeks: z.number().int().min(1).max(52).default(12),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(agentMetrics)
        .where(eq(agentMetrics.agentName, input.agentName))
        .orderBy(desc(agentMetrics.weekStart))
        .limit(input.weeks);
    }),

  /**
   * Aggregate snapshot for the admin dashboard top card. Returns counts
   * per agent over the last 7 days.
   */
  snapshot: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        agentName: interactionOutcomes.agentName,
        total: sql<number>`COUNT(*)`,
        autoActions: sql<number>`SUM(CASE WHEN actionTaken NOT IN ('escalated', 'manual') THEN 1 ELSE 0 END)`,
        escalated: sql<number>`SUM(CASE WHEN actionTaken = 'escalated' THEN 1 ELSE 0 END)`,
        overrides: sql<number>`SUM(jeffOverride)`,
        avgConfidence: sql<number>`AVG(confidence)`,
      })
      .from(interactionOutcomes)
      .where(sql`createdAt >= ${sevenDaysAgo}`)
      .groupBy(interactionOutcomes.agentName);
    return rows;
  }),

  // ─────────────────────────────────────────────────────────────────
  // Office view — Layer 0+1 surfaced as Jeff's inbox/desk
  // ─────────────────────────────────────────────────────────────────

  /**
   * Items needing Jeff's attention. Returns outcomes that have either:
   *   - actionTaken contains "escalate" (agent explicitly handed off)
   *   - confidence < 70 (agent uncertain, even if it drafted)
   * AND have not yet been ack'd (outcomeFinalized = 0).
   *
   * Joined with customerInteractions for content preview + customerProfiles
   * for sender info — single round trip for the dashboard.
   */
  pendingForJeff: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const limit = input?.limit ?? 50;
      const rows = await db
        .select({
          outcomeId: interactionOutcomes.id,
          agentName: interactionOutcomes.agentName,
          actionTaken: interactionOutcomes.actionTaken,
          confidence: interactionOutcomes.confidence,
          createdAt: interactionOutcomes.createdAt,
          interactionId: customerInteractions.id,
          channel: customerInteractions.channel,
          content: customerInteractions.content,
          contentSummary: customerInteractions.contentSummary,
          classification: customerInteractions.classification,
          sentiment: customerInteractions.sentiment,
          urgency: customerInteractions.urgency,
          customerProfileId: customerProfiles.id,
          customerEmail: customerProfiles.email,
        })
        .from(interactionOutcomes)
        .leftJoin(
          customerInteractions,
          eq(interactionOutcomes.interactionId, customerInteractions.id)
        )
        .leftJoin(
          customerProfiles,
          eq(interactionOutcomes.customerProfileId, customerProfiles.id)
        )
        .where(
          and(
            eq(interactionOutcomes.outcomeFinalized, 0),
            or(
              // QA audit 2026-05-11 Phase 8 fix: was LIKE '%escalate%' which
              // forces a leading-wildcard scan that no index can serve.
              // The actual writers store exact values: 'auto_escalate'
              // (gmailPipeline auto-escalation), 'escalated' (selfRetrospective
              // tag), and 'escalate' (policy default in inquiryAgent). IN
              // clause is index-eligible and ~50x faster on 10k+ outcome rows.
              sql`${interactionOutcomes.actionTaken} IN ('auto_escalate', 'escalate', 'escalated')`,
              sql`${interactionOutcomes.confidence} < 70`
            )
          )
        )
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(limit);
      return rows;
    }),

  /**
   * Timeline of every agent action today + yesterday. Used by the
   * "today's office" timeline view. Newest first.
   */
  recentActivity: adminProcedure
    .input(
      z
        .object({
          hours: z.number().int().min(1).max(168).default(48),
          agentName: z.enum(AGENT_NAMES).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const hours = input?.hours ?? 48;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      const whereConds = [sql`${interactionOutcomes.createdAt} >= ${since}`];
      if (input?.agentName) {
        whereConds.push(eq(interactionOutcomes.agentName, input.agentName));
      }
      const rows = await db
        .select({
          outcomeId: interactionOutcomes.id,
          agentName: interactionOutcomes.agentName,
          actionTaken: interactionOutcomes.actionTaken,
          confidence: interactionOutcomes.confidence,
          outcomeFinalized: interactionOutcomes.outcomeFinalized,
          jeffOverride: interactionOutcomes.jeffOverride,
          createdAt: interactionOutcomes.createdAt,
          channel: customerInteractions.channel,
          contentSummary: customerInteractions.contentSummary,
          classification: customerInteractions.classification,
          customerEmail: customerProfiles.email,
        })
        .from(interactionOutcomes)
        .leftJoin(
          customerInteractions,
          eq(interactionOutcomes.interactionId, customerInteractions.id)
        )
        .leftJoin(
          customerProfiles,
          eq(interactionOutcomes.customerProfileId, customerProfiles.id)
        )
        .where(and(...whereConds))
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(200);
      return rows;
    }),

  /**
   * Jeff acknowledges an outcome:
   *   - "approved" → mark outcomeFinalized=1, no override
   *   - "override" → mark outcomeFinalized=1, jeffOverride=1, save reason
   *   - "needs_change" → keep finalized=0 but log reason (agent will see)
   *
   * Critical to self-retrospective: every weekly retro reads jeffOverride
   * rows to learn what the agent got wrong.
   */
  acknowledge: adminProcedure
    .input(
      z.object({
        outcomeId: z.number().int(),
        verdict: z.enum(["approved", "override", "needs_change"]),
        reason: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const updates: Record<string, unknown> = {};
      if (input.verdict === "approved") {
        updates.outcomeFinalized = 1;
      } else if (input.verdict === "override") {
        updates.outcomeFinalized = 1;
        updates.jeffOverride = 1;
        if (input.reason) updates.jeffOverrideReason = input.reason;
      } else if (input.verdict === "needs_change") {
        if (input.reason) updates.jeffOverrideReason = input.reason;
      }
      await db
        .update(interactionOutcomes)
        .set(updates)
        .where(eq(interactionOutcomes.id, input.outcomeId));
      return { ok: true };
    }),

  /**
   * Per-agent office summary used by each "desk" card. Returns:
   *   - today + 7d action counts
   *   - pending count (escalations + low-confidence not ack'd)
   *   - latest action timestamp
   *   - active policy version
   */
  agentOffice: adminProcedure
    .input(z.object({ agentName: z.enum(AGENT_NAMES) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return {
          todayCount: 0,
          weekCount: 0,
          pendingCount: 0,
          latestAt: null,
          policyVersion: null,
          status: "off" as const,
        };
      }
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [todayCountRow] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(interactionOutcomes)
        .where(
          and(
            eq(interactionOutcomes.agentName, input.agentName),
            sql`${interactionOutcomes.createdAt} >= ${startOfDay}`
          )
        );

      const [weekCountRow] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(interactionOutcomes)
        .where(
          and(
            eq(interactionOutcomes.agentName, input.agentName),
            sql`${interactionOutcomes.createdAt} >= ${weekAgo}`
          )
        );

      const [pendingCountRow] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(interactionOutcomes)
        .where(
          and(
            eq(interactionOutcomes.agentName, input.agentName),
            eq(interactionOutcomes.outcomeFinalized, 0),
            or(
              sql`${interactionOutcomes.actionTaken} LIKE '%escalate%'`,
              sql`${interactionOutcomes.confidence} < 70`
            )
          )
        );

      const [latest] = await db
        .select({ at: interactionOutcomes.createdAt })
        .from(interactionOutcomes)
        .where(eq(interactionOutcomes.agentName, input.agentName))
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(1);

      const [policy] = await db
        .select({ version: agentPolicies.version })
        .from(agentPolicies)
        .where(
          and(
            eq(agentPolicies.agentName, input.agentName),
            eq(agentPolicies.active, 1)
          )
        )
        .limit(1);

      // Status: only "inquiry" is live in demo mode right now. Others are
      // "off" until their Layer 2 build lands. This will change as we
      // ship more agents.
      const status =
        input.agentName === "inquiry"
          ? ("demo" as const)
          : ("off" as const);

      return {
        todayCount: Number(todayCountRow?.c ?? 0),
        weekCount: Number(weekCountRow?.c ?? 0),
        pendingCount: Number(pendingCountRow?.c ?? 0),
        latestAt: latest?.at ?? null,
        policyVersion: policy?.version ?? null,
        status,
      };
    }),

  // ─────────────────────────────────────────────────────────────────
  // Global Office Overview — all PACK&GO agents in one place
  //
  // Merges data from:
  //   - interactionOutcomes (Round 81 autonomous agents: inquiry/review/etc)
  //   - agentActivityLogs (tooling agents: master tour-gen / translation /
  //     calibration / etc — these write to agentActivityLogs as they run)
  //
  // Returns a department-grouped tree that the OfficeOverview tab renders
  // as the "office floor plan."
  // ─────────────────────────────────────────────────────────────────

  officeOverview: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { departments: [] };

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    // Round 81 agents — from interactionOutcomes
    const round81Rows = await db
      .select({
        agentName: interactionOutcomes.agentName,
        total: sql<number>`COUNT(*)`,
        today: sql<number>`SUM(CASE WHEN ${interactionOutcomes.createdAt} >= ${startOfDay} THEN 1 ELSE 0 END)`,
        pending: sql<number>`SUM(CASE WHEN ${interactionOutcomes.outcomeFinalized}=0 AND (${interactionOutcomes.actionTaken} LIKE '%escalate%' OR ${interactionOutcomes.confidence} < 70) THEN 1 ELSE 0 END)`,
        latestAt: sql<Date | null>`MAX(${interactionOutcomes.createdAt})`,
      })
      .from(interactionOutcomes)
      .groupBy(interactionOutcomes.agentName);

    const round81Map = new Map<string, (typeof round81Rows)[number]>();
    for (const r of round81Rows) round81Map.set(r.agentName, r);

    // Tooling agents — from agentActivityLogs
    const toolingRows = await db
      .select({
        agentKey: agentActivityLogs.agentKey,
        agentName: agentActivityLogs.agentName,
        total: sql<number>`COUNT(*)`,
        today: sql<number>`SUM(CASE WHEN ${agentActivityLogs.startedAt} >= ${startOfDay} THEN 1 ELSE 0 END)`,
        failed: sql<number>`SUM(CASE WHEN ${agentActivityLogs.status}='failed' THEN 1 ELSE 0 END)`,
        running: sql<number>`SUM(CASE WHEN ${agentActivityLogs.status}='started' AND ${agentActivityLogs.completedAt} IS NULL THEN 1 ELSE 0 END)`,
        latestAt: sql<Date | null>`MAX(${agentActivityLogs.startedAt})`,
      })
      .from(agentActivityLogs)
      .groupBy(agentActivityLogs.agentKey, agentActivityLogs.agentName);

    const toolingMap = new Map<string, (typeof toolingRows)[number]>();
    for (const r of toolingRows) {
      const key = r.agentKey ?? r.agentName;
      if (!key) continue;
      toolingMap.set(key, r);
    }

    // Department + agent definitions (curated for display)
    type DeptAgent = {
      id: string;
      name: string;
      persona: string;
      source: "round81" | "tooling";
      sourceKey: string;
      deepLink: string;
      colorTone: "emerald" | "blue" | "purple" | "amber" | "rose" | "slate";
      today: number;
      pending: number;
      latestAt: Date | null;
      isOnline: boolean;
      isLive: boolean;
    };

    function buildAgent(
      id: string,
      name: string,
      persona: string,
      source: DeptAgent["source"],
      sourceKey: string,
      deepLink: string,
      tone: DeptAgent["colorTone"],
      _isLiveHint: boolean // kept for call-site compat; now ignored
    ): DeptAgent {
      let today = 0,
        pending = 0;
      let latestAt: Date | null = null;
      if (source === "round81") {
        const row = round81Map.get(sourceKey);
        if (row) {
          today = Number(row.today ?? 0);
          pending = Number(row.pending ?? 0);
          latestAt = row.latestAt ?? null;
        }
      } else {
        const row = toolingMap.get(sourceKey);
        if (row) {
          today = Number(row.today ?? 0);
          pending = Number(row.failed ?? 0);
          latestAt = row.latestAt ?? null;
        }
      }
      // isOnline: actual activity within last 1 hour
      const isOnline =
        latestAt != null &&
        now.getTime() - new Date(latestAt).getTime() < 60 * 60 * 1000;
      // isLive (v449+): computed from real activity in last 30 days. The
      // hardcoded "I think this exists" flag was misleading — claimed 14/19
      // online when most tooling agents hadn't run in months.
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const isLive =
        latestAt != null &&
        now.getTime() - new Date(latestAt).getTime() < THIRTY_DAYS;
      return {
        id,
        name,
        persona,
        source,
        sourceKey,
        deepLink,
        colorTone: tone,
        today,
        pending,
        latestAt,
        isOnline,
        isLive,
      };
    }

    const departments = [
      {
        name: "客戶經營部",
        icon: "users",
        description: "面對客戶的第一線 — 詢問、評論、退款、關懷",
        agents: [
          buildAgent(
            "inquiry",
            "InquiryAgent",
            "我看每一封新客戶來信,分類、起草、不確定時找你",
            "round81",
            "inquiry",
            "autonomous-agents",
            "emerald",
            true
          ),
          buildAgent(
            "review",
            "ReviewAgent",
            "我審核並回覆每條評論,批評稱讚一視同仁",
            "round81",
            "review",
            "autonomous-agents",
            "blue",
            false
          ),
          buildAgent(
            "followup",
            "FollowupAgent",
            "出發前 / 旅途中 / 回國後 三段式關懷",
            "round81",
            "followup",
            "autonomous-agents",
            "amber",
            false
          ),
          buildAgent(
            "refund",
            "RefundAgent",
            "退款 triage,最終 escalate Jeff 親自決定",
            "round81",
            "refund",
            "autonomous-agents",
            "rose",
            false
          ),
        ],
      },
      {
        name: "行銷部",
        icon: "megaphone",
        description: "推廣 / 內容 / 廣告素材",
        agents: [
          buildAgent(
            "marketing",
            "MarketingAgent",
            "我區隔受眾發 EDM,有 opt-out 和頻率上限",
            "round81",
            "marketing",
            "autonomous-agents",
            "purple",
            false
          ),
          buildAgent(
            "marketing_content",
            "ContentAgent",
            "我為小紅書 / 微信 / FB / IG 寫貼文文案",
            "tooling",
            "marketingContent",
            "marketing-content",
            "purple",
            true
          ),
          buildAgent(
            "posters",
            "PostersAgent",
            "我把供應商海報轉成 7 個平台的版本",
            "tooling",
            "posters",
            "posters",
            "purple",
            true
          ),
        ],
      },
      {
        name: "行程生成部",
        icon: "plane",
        description: "Master 協同 9 個子 agent 自動生成完整行程",
        agents: [
          buildAgent(
            "master_tour_gen",
            "MasterAgent",
            "我是行程生成的指揮官,協同 9 個子 agent",
            "tooling",
            "master",
            "tours",
            "slate",
            true
          ),
          buildAgent(
            "itinerary",
            "ItineraryAgent",
            "我把長 PDF 或網頁拆成 day-by-day 結構",
            "tooling",
            "itinerary",
            "tours",
            "slate",
            true
          ),
          buildAgent(
            "image_gen",
            "ImageGenAgent",
            "我為每個行程生成 hero / 子景點圖",
            "tooling",
            "imageGeneration",
            "tours",
            "slate",
            true
          ),
          buildAgent(
            "color_theme",
            "ColorThemeAgent",
            "我為每個行程選定品牌色調與字體",
            "tooling",
            "colorTheme",
            "tours",
            "slate",
            true
          ),
          buildAgent(
            "calibration",
            "CalibrationAgent",
            "我抽查生成內容的品質,標記需 Jeff 複審的",
            "tooling",
            "calibration",
            "calibration-review",
            "slate",
            true
          ),
          buildAgent(
            "translation",
            "TranslationAgent",
            "中 ↔ 英 雙向翻譯,保持品牌語氣",
            "tooling",
            "translation",
            "tours",
            "slate",
            true
          ),
        ],
      },
      {
        name: "情報部",
        icon: "binoculars",
        description: "監控供應商網站 + 競品動態",
        agents: [
          buildAgent(
            "tour_monitor",
            "TourMonitor",
            "我盯著供應商網站,飯店 / 行程異動立刻通報",
            "tooling",
            "tourMonitor",
            "tour-monitor",
            "blue",
            true
          ),
          buildAgent(
            "competitor",
            "CompetitorMonitor",
            "我追蹤同業價格 / 行程 / 文案變化",
            "tooling",
            "competitor",
            "competitor-monitor",
            "blue",
            true
          ),
        ],
      },
      {
        name: "服務部",
        icon: "shield",
        description: "簽證、特殊需求",
        agents: [
          buildAgent(
            "visa_assistant",
            "VisaAssistant",
            "中國簽證申請流程 SOP,自動分流 ID 種類",
            "tooling",
            "visa",
            "visa",
            "amber",
            true
          ),
          buildAgent(
            "ai_quotes",
            "QuotesAgent",
            "我把客戶詢價秒生報價單",
            "tooling",
            "aiQuotes",
            "ai-quotes",
            "amber",
            true
          ),
        ],
      },
      {
        name: "AI 自學部",
        icon: "brain",
        description: "讓所有 agent 隨時間變更聰明",
        agents: [
          buildAgent(
            "self_retrospective",
            "RetrospectiveAgent",
            "每週讀所有 agent 的 outcomes,自動 update policy",
            "round81",
            "self_retrospective",
            "autonomous-agents",
            "slate",
            false
          ),
          buildAgent(
            "skill_learner",
            "SkillLearner",
            "我把過去成功的 task pattern 變成可重用的 skill",
            "tooling",
            "skillLearner",
            "ai-hub",
            "slate",
            true
          ),
        ],
      },
    ];

    // Aggregate office stats
    const allAgents = departments.flatMap((d) => d.agents);
    const totalToday = allAgents.reduce((s, a) => s + a.today, 0);
    const totalPending = allAgents.reduce((s, a) => s + a.pending, 0);
    const liveCount = allAgents.filter((a) => a.isLive).length;
    const onlineCount = allAgents.filter((a) => a.isOnline).length;

    return {
      departments,
      summary: {
        totalAgents: allAgents.length,
        liveCount,
        onlineCount,
        totalToday,
        totalPending,
      },
    };
  }),

  // ─────────────────────────────────────────────────────────────────
  // Layer 2 — InquiryAgent (demo mode)
  //
  // Paste a customer email/message → agent runs the full pipeline:
  //   1. Get/seed v1 policy (cold-start safety)
  //   2. Run runInquiryAgent (LLM call with structured output + policy gate)
  //   3. Upsert customerProfile from extracted identifiers
  //   4. Log inbound interaction
  //   5. Record outcome with actionTaken = demo_draft / demo_escalate
  //   6. Return full decision to caller for review
  //
  // Demo mode means: nothing is sent to the customer. Jeff reviews the
  // draft + classification in the dashboard. When confidence + quality
  // are consistently high, we'll wire this to the actual email-ingest
  // pipeline (separate round).
  // ─────────────────────────────────────────────────────────────────

  demoInquiry: adminProcedure
    .input(
      z.object({
        rawMessage: z.string().min(10).max(50_000),
        channel: z
          .enum(["email", "web_form", "whatsapp", "wechat", "line", "sms"])
          .default("email"),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1. Get active policy, or seed v1 default
      let policy = await db
        .select()
        .from(agentPolicies)
        .where(and(eq(agentPolicies.agentName, "inquiry"), eq(agentPolicies.active, 1)))
        .limit(1)
        .then((r) => r[0]);

      if (!policy) {
        // Cold-start: seed v1
        const result = await db.insert(agentPolicies).values({
          agentName: "inquiry",
          version: 1,
          rules: JSON.stringify(DEFAULT_INQUIRY_POLICY, null, 2),
          active: 1,
          createdBy: "human",
          reasonNote: "Initial v1 default policy (cold-start seed by InquiryAgent demo)",
        });
        const seededId = Number((result as any)[0]?.insertId ?? 0);
        policy = await db
          .select()
          .from(agentPolicies)
          .where(eq(agentPolicies.id, seededId))
          .limit(1)
          .then((r) => r[0]);
      }

      // 2. Run agent
      const decision = await runInquiryAgent({
        rawMessage: input.rawMessage,
        channel: input.channel,
        policyRules: policy?.rules,
      });

      // 3. Upsert profile from extracted sender email (if any)
      let profileId: number | undefined;
      const senderEmail = decision.extractedCustomer.senderEmail?.trim();
      if (senderEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
        const existing = await db
          .select()
          .from(customerProfiles)
          .where(eq(customerProfiles.email, senderEmail))
          .limit(1);
        if (existing[0]) {
          profileId = existing[0].id;
        } else {
          const ins = await db.insert(customerProfiles).values({
            email: senderEmail,
            preferredLanguage: decision.draftLanguage === "en" ? "en" : "zh-TW",
          });
          profileId = Number((ins as any)[0]?.insertId ?? 0);
        }
      }

      // 4. Log inbound interaction
      let interactionId: number | undefined;
      if (profileId) {
        const urgencyMap: Record<string, number> = {
          critical: 90,
          high: 75,
          normal: 50,
          low: 25,
        };
        const ins = await db.insert(customerInteractions).values({
          customerProfileId: profileId,
          channel: input.channel,
          direction: "inbound",
          content: input.rawMessage,
          contentSummary: decision.intent,
          sentiment: decision.sentiment,
          classification: decision.classification,
          urgency: urgencyMap[decision.urgency] ?? 50,
        });
        interactionId = Number((ins as any)[0]?.insertId ?? 0);
      }

      // 5. Record outcome (demo mode — no actual send)
      let outcomeId: number | undefined;
      if (interactionId) {
        const ins = await db.insert(interactionOutcomes).values({
          agentName: "inquiry",
          interactionId,
          customerProfileId: profileId,
          actionTaken: decision.shouldEscalate ? "demo_escalate" : "demo_draft",
          confidence: decision.confidence,
          policyVersion: policy?.version,
        });
        outcomeId = Number((ins as any)[0]?.insertId ?? 0);
      }

      // 6. Update profile last-interaction stamp
      if (profileId) {
        await db
          .update(customerProfiles)
          .set({ lastInteractionAt: new Date() })
          .where(eq(customerProfiles.id, profileId));
      }

      return {
        decision,
        profileId,
        interactionId,
        outcomeId,
        policyVersion: policy?.version,
      };
    }),

  // ─────────────────────────────────────────────────────────────────
  // Layer 2 — ReviewAgent (demo mode)
  // ─────────────────────────────────────────────────────────────────

  demoReview: adminProcedure
    .input(
      z.object({
        reviewText: z.string().min(5).max(10_000),
        rating: z.number().int().min(1).max(5),
        senderEmail: z.string().email().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const policy = await ensurePolicy(db, "review", DEFAULT_REVIEW_POLICY);
      const decision = await runReviewAgent({
        reviewText: input.reviewText,
        rating: input.rating,
        policyRules: policy.rules,
      });

      let profileId: number | undefined;
      if (input.senderEmail) {
        const r = await ensureCustomerByEmail(db, input.senderEmail);
        profileId = r.id;
      }

      let interactionId: number | undefined;
      if (profileId) {
        const ins = await db.insert(customerInteractions).values({
          customerProfileId: profileId,
          channel: "review",
          direction: "inbound",
          content: `[${input.rating}★] ${input.reviewText}`,
          contentSummary: `${input.rating}-star: ${decision.themes.join(", ")}`,
          sentiment: decision.sentiment,
          classification: decision.classification,
          urgency: input.rating === 1 ? 80 : 40,
        });
        interactionId = Number((ins as any)[0]?.insertId ?? 0);
      }

      let outcomeId: number | undefined;
      if (interactionId) {
        const ins = await db.insert(interactionOutcomes).values({
          agentName: "review",
          interactionId,
          customerProfileId: profileId,
          actionTaken: decision.shouldEscalate ? "demo_escalate" : "demo_draft",
          confidence: decision.confidence,
          policyVersion: policy.version,
        });
        outcomeId = Number((ins as any)[0]?.insertId ?? 0);
      }

      return { decision, profileId, interactionId, outcomeId, policyVersion: policy.version };
    }),

  // ─────────────────────────────────────────────────────────────────
  // Layer 2 — MarketingAgent (demo mode)
  // ─────────────────────────────────────────────────────────────────

  demoMarketing: adminProcedure
    .input(
      z.object({
        segment: z.string().min(2).max(500),
        topic: z.string().min(2).max(500),
        language: z.enum(["zh-TW", "zh-CN", "en"]).default("zh-TW"),
        additionalContext: z.string().max(5000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const policy = await ensurePolicy(db, "marketing", DEFAULT_MARKETING_POLICY);
      const decision = await runMarketingAgent({
        segment: input.segment,
        topic: input.topic,
        language: input.language,
        additionalContext: input.additionalContext,
        policyRules: policy.rules,
      });

      // Marketing has no specific customer — we log it as an outcome
      // under a synthetic interaction so the dashboards reflect activity.
      const ins = await db.insert(interactionOutcomes).values({
        agentName: "marketing",
        interactionId: 0,
        actionTaken: "demo_edm_draft",
        confidence: decision.confidence,
        policyVersion: policy.version,
      });
      const outcomeId = Number((ins as any)[0]?.insertId ?? 0);

      return { decision, outcomeId, policyVersion: policy.version };
    }),

  // ─────────────────────────────────────────────────────────────────
  // Layer 2 — FollowupAgent (demo mode)
  // ─────────────────────────────────────────────────────────────────

  demoFollowup: adminProcedure
    .input(
      z.object({
        stage: z.enum(["pre_departure", "mid_trip", "post_trip"]),
        daysFromStart: z.number().int().min(-365).max(365),
        customerName: z.string().max(100).optional(),
        destinationSummary: z.string().min(2).max(500),
        bookingNotes: z.string().max(2000).optional(),
        language: z.enum(["zh-TW", "zh-CN", "en"]).default("zh-TW"),
        isFirstFollowup: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const policy = await ensurePolicy(db, "followup", DEFAULT_FOLLOWUP_POLICY);
      const decision = await runFollowupAgent({
        ...input,
        policyRules: policy.rules,
      });

      const ins = await db.insert(interactionOutcomes).values({
        agentName: "followup",
        interactionId: 0,
        actionTaken: `demo_${input.stage}`,
        confidence: decision.confidence,
        policyVersion: policy.version,
      });
      const outcomeId = Number((ins as any)[0]?.insertId ?? 0);

      return { decision, outcomeId, policyVersion: policy.version };
    }),

  // ─────────────────────────────────────────────────────────────────
  // Layer 2 — RefundAgent (demo mode) — always escalates
  // ─────────────────────────────────────────────────────────────────

  demoRefund: adminProcedure
    .input(
      z.object({
        rawMessage: z.string().min(10).max(50_000),
        senderEmail: z.string().email().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const policy = await ensurePolicy(db, "refund", DEFAULT_REFUND_POLICY);
      const decision = await runRefundAgent({
        rawMessage: input.rawMessage,
        policyRules: policy.rules,
      });

      let profileId: number | undefined;
      if (input.senderEmail) {
        const r = await ensureCustomerByEmail(db, input.senderEmail);
        profileId = r.id;
      }

      let interactionId: number | undefined;
      if (profileId) {
        const urgencyMap: Record<string, number> = {
          critical: 95,
          high: 80,
          medium: 60,
          low: 40,
        };
        const ins = await db.insert(customerInteractions).values({
          customerProfileId: profileId,
          channel: "email",
          direction: "inbound",
          content: input.rawMessage,
          contentSummary: `Refund triage: ${decision.severity} / ${decision.reasonCategory}`,
          classification: "refund_request",
          urgency: urgencyMap[decision.severity] ?? 60,
        });
        interactionId = Number((ins as any)[0]?.insertId ?? 0);
      }

      let outcomeId: number | undefined;
      if (interactionId) {
        const ins = await db.insert(interactionOutcomes).values({
          agentName: "refund",
          interactionId,
          customerProfileId: profileId,
          actionTaken: "demo_escalate", // always
          confidence: decision.confidence,
          policyVersion: policy.version,
        });
        outcomeId = Number((ins as any)[0]?.insertId ?? 0);

        // Auto-post an escalation message to Jeff's chatbox
        await db.insert(agentMessages).values({
          agentName: "refund",
          messageType: "escalation",
          title: `退款請求 · ${decision.severity} · ${input.senderEmail ?? "unknown"}`,
          body: decision.jeffInternalBriefing,
          context: JSON.stringify({
            severity: decision.severity,
            reasonCategory: decision.reasonCategory,
            extractedFacts: decision.extractedFacts,
            suggestedActions: decision.suggestedJeffActions,
          }),
          priority:
            decision.severity === "critical"
              ? "critical"
              : decision.severity === "high"
              ? "high"
              : "normal",
          relatedOutcomeId: outcomeId,
          relatedInteractionId: interactionId,
          relatedCustomerProfileId: profileId,
        });
      }

      return { decision, profileId, interactionId, outcomeId, policyVersion: policy.version };
    }),

  // ─────────────────────────────────────────────────────────────────
  // Chatbox — agent → Jeff messages
  // ─────────────────────────────────────────────────────────────────

  /**
   * List messages addressed to Jeff. Filter by readByJeff/agentName.
   * Default: unread first, then last 50 of all.
   */
  listMessages: adminProcedure
    .input(
      z
        .object({
          onlyUnread: z.boolean().default(false),
          agentName: z.enum(AGENT_NAMES).optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const args = input ?? { onlyUnread: false, limit: 50 };
      const conds = [];
      if (args.onlyUnread) conds.push(eq(agentMessages.readByJeff, 0));
      if (args.agentName) conds.push(eq(agentMessages.agentName, args.agentName));
      const query = db
        .select()
        .from(agentMessages)
        .orderBy(desc(agentMessages.priority), desc(agentMessages.createdAt))
        .limit(args.limit);
      const result =
        conds.length > 0 ? await query.where(and(...conds)) : await query;
      return result;
    }),

  /** Unread message count, plus per-priority breakdown for badge UI. */
  unreadMessageCount: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, critical: 0, high: 0, normal: 0, low: 0 };
    const rows = await db
      .select({
        priority: agentMessages.priority,
        c: sql<number>`COUNT(*)`,
      })
      .from(agentMessages)
      .where(eq(agentMessages.readByJeff, 0))
      .groupBy(agentMessages.priority);
    const result = { total: 0, critical: 0, high: 0, normal: 0, low: 0 };
    for (const r of rows) {
      const n = Number(r.c ?? 0);
      result.total += n;
      result[r.priority as keyof typeof result] = n;
    }
    return result;
  }),

  /** Jeff replies to / acknowledges a message. */
  replyToMessage: adminProcedure
    .input(
      z.object({
        messageId: z.number().int(),
        response: z.string().max(5000).optional(),
        markRead: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const updates: Record<string, unknown> = {};
      if (input.markRead) {
        updates.readByJeff = 1;
        updates.readAt = new Date();
      }
      if (input.response) updates.jeffResponse = input.response;
      await db
        .update(agentMessages)
        .set(updates)
        .where(eq(agentMessages.id, input.messageId));
      return { ok: true };
    }),

  // ─────────────────────────────────────────────────────────────────
  // Round 81 / 2026-05-17 — OpsAgent
  //
  // Natural-language ops queries. Jeff types in #ops channel of
  // ChatsTab → this procedure runs OpsAgent + writes both Jeff's
  // question and the agent answer to agentMessages so the conversation
  // is persistent + visible to the future mobile app.
  // ─────────────────────────────────────────────────────────────────

  askOps: adminProcedure
    .input(
      z.object({
        question: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Round 81 Phase 1 (2026-05-17): pull last 10 #ops messages as
      // conversation memory. Without this, every question is treated as
      // standalone and Jeff has to re-specify customer/date for follow-ups.
      const historyRows = await db
        .select({
          senderRole: agentMessages.senderRole,
          body: agentMessages.body,
          createdAt: agentMessages.createdAt,
        })
        .from(agentMessages)
        .where(eq(agentMessages.agentName, "ops"))
        .orderBy(desc(agentMessages.createdAt))
        .limit(10);

      // Reverse to chronological order
      const history = historyRows.reverse().map((r) => ({
        role: (r.senderRole === "jeff" ? "user" : "agent") as "user" | "agent",
        content: r.body,
      }));

      // 1. Log Jeff's question as senderRole='jeff' so the channel shows it
      await db.insert(agentMessages).values({
        agentName: "ops",
        senderRole: "jeff",
        messageType: "question",
        title: input.question.slice(0, 80),
        body: input.question,
        priority: "normal",
        readByJeff: 1, // Jeff's own message — pre-marked read
      } as any);

      // 2. Run the agent with history context
      const { runOpsAgent } = await import("../agents/autonomous/opsAgent");
      let answer = "";
      let suggestedActions: any[] = [];
      let error: string | null = null;
      try {
        const result = await runOpsAgent(input.question, history);
        answer = result.answer;
        suggestedActions = result.suggestedActions;

        // 3. Log agent answer + suggestedActions (rendered as chips in UI)
        await db.insert(agentMessages).values({
          agentName: "ops",
          senderRole: "agent",
          messageType: "observation",
          title: input.question.slice(0, 80),
          body: result.answer,
          context: JSON.stringify({
            hintsExtracted: result.hints,
            queriesRun: Object.keys(result.contextUsed),
            suggestedActions: result.suggestedActions,
          }),
          priority: "normal",
        } as any);
      } catch (err) {
        error = (err as Error).message;
        await db.insert(agentMessages).values({
          agentName: "ops",
          senderRole: "agent",
          messageType: "alert",
          title: `OpsAgent failed: ${input.question.slice(0, 60)}`,
          body: `Error: ${error}\n\nQuestion was: ${input.question}`,
          priority: "high",
        } as any);
      }

      return { answer, suggestedActions, error };
    }),

  /**
   * Round 81 Phase 2 (2026-05-17) — Execute an OpsAgent action proposal.
   *
   * Jeff clicks a chip in ChatsTab → frontend shows confirmation modal
   * (with typed-confirm for sensitivity='sensitive') → on confirm, this
   * mutation runs. The action is executed, result logged as a new
   * #ops message, so the conversation shows "I asked X, agent suggested Y,
   * I confirmed, agent did Z".
   */
  executeOpsAction: adminProcedure
    .input(
      z.object({
        actionType: z.string().min(1),
        args: z.any(),
        // Echo back to UI for the audit log entry
        proposalContext: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { executeOpsAction, ActionTypeEnum } = await import(
        "../agents/autonomous/opsActions"
      );

      // Validate actionType is one of the known enum values
      const parsed = ActionTypeEnum.safeParse(input.actionType);
      if (!parsed.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown actionType: ${input.actionType}`,
        });
      }

      const result = await executeOpsAction(parsed.data, input.args);

      // Log the execution as a new #ops message — both confirmation by Jeff
      // (as 'jeff' role) and the result (as 'agent' role)
      await db.insert(agentMessages).values({
        agentName: "ops",
        senderRole: "jeff",
        messageType: "observation",
        title: `→ 執行: ${input.proposalContext?.slice(0, 60) ?? parsed.data}`,
        body: `Action type: ${parsed.data}\nArgs: ${JSON.stringify(input.args, null, 2)}`,
        priority: "low",
        readByJeff: 1,
      } as any);

      await db.insert(agentMessages).values({
        agentName: "ops",
        senderRole: "agent",
        messageType: result.ok ? "observation" : "alert",
        title: result.summary,
        body: result.error
          ? `失敗: ${result.error}\n\n${result.summary}`
          : result.summary +
            (result.details
              ? `\n\nDetails:\n${JSON.stringify(result.details, null, 2)}`
              : ""),
        priority: result.ok ? "normal" : "high",
        context: JSON.stringify({ executedAction: parsed.data, args: input.args }),
      } as any);

      return result;
    }),

  // ─────────────────────────────────────────────────────────────────
  // Phase 3 (Round 81 — Learning System): Self-Retrospective
  //
  // Reads past N days of outcomes + policies, asks the retrospective
  // agent to propose policy improvements. Posts result as an
  // agentMessages row (messageType=proposal, agentName=self_retrospective)
  // which surfaces in the Inbox.
  // Phase 3.5 will add a weekly cron trigger.
  // ─────────────────────────────────────────────────────────────────

  runRetrospective: adminProcedure
    .input(
      z
        .object({ windowDays: z.number().int().min(1).max(60).default(7) })
        .optional()
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const windowDays = input?.windowDays ?? 7;
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

      // Pull outcomes for ALL agents over the window
      const outcomes = await db
        .select({
          agentName: interactionOutcomes.agentName,
          actionTaken: interactionOutcomes.actionTaken,
          confidence: interactionOutcomes.confidence,
          customerSentiment: interactionOutcomes.customerSentiment,
          customerBooked: interactionOutcomes.customerBooked,
          refundRequested: interactionOutcomes.refundRequested,
          jeffOverride: interactionOutcomes.jeffOverride,
          jeffOverrideReason: interactionOutcomes.jeffOverrideReason,
          outcomeFinalized: interactionOutcomes.outcomeFinalized,
          createdAt: interactionOutcomes.createdAt,
        })
        .from(interactionOutcomes)
        .where(sql`${interactionOutcomes.createdAt} >= ${since}`)
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(500);

      // Pull all active policies (one per agent)
      const policies = await db
        .select({
          agentName: agentPolicies.agentName,
          version: agentPolicies.version,
          rules: agentPolicies.rules,
        })
        .from(agentPolicies)
        .where(eq(agentPolicies.active, 1));

      let retro;
      try {
        retro = await runSelfRetrospective({
          outcomes: outcomes.map((o) => ({
            ...o,
            customerSentiment: o.customerSentiment ?? null,
          })),
          policies,
          windowDays,
        });
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Retrospective failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      // Persist as a proposal message in #全體 (so Inbox can pick it up)
      const formatted = formatRetrospectiveAsMessage(retro, windowDays);
      const ins = await db.insert(agentMessages).values({
        agentName: "general",
        senderRole: "agent",
        messageType: "proposal",
        title: formatted.title,
        body: formatted.body,
        context: formatted.context,
        priority: retro.proposals.length > 0 ? "high" : "normal",
      });
      const messageId = Number((ins as any)[0]?.insertId ?? 0);

      return { messageId, retro, totalOutcomesAnalyzed: outcomes.length };
    }),

  /**
   * Apply one proposed policy change from a retrospective. Bumps the
   * agent's policy to version+1 with the proposed rules.
   */
  applyRetrospectiveProposal: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        proposedRules: z.string().min(1).max(50_000),
        reasonNote: z.string().max(2000).optional(),
        sourceMessageId: z.number().int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Validate it's valid JSON before activating
      try {
        JSON.parse(input.proposedRules);
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "proposedRules is not valid JSON",
        });
      }

      // Deactivate current
      await db
        .update(agentPolicies)
        .set({ active: 0 })
        .where(
          and(eq(agentPolicies.agentName, input.agentName), eq(agentPolicies.active, 1))
        );

      // Find next version
      const [latest] = await db
        .select({ version: agentPolicies.version })
        .from(agentPolicies)
        .where(eq(agentPolicies.agentName, input.agentName))
        .orderBy(desc(agentPolicies.version))
        .limit(1);
      const nextVersion = (latest?.version ?? 0) + 1;

      const result = await db.insert(agentPolicies).values({
        agentName: input.agentName,
        version: nextVersion,
        rules: input.proposedRules,
        active: 1,
        createdBy: "self_retrospective",
        reasonNote: input.reasonNote ?? "Applied via retrospective approval",
      });

      // Mark the source message as read + record Jeff's response
      if (input.sourceMessageId) {
        await db
          .update(agentMessages)
          .set({
            readByJeff: 1,
            readAt: new Date(),
            jeffResponse: `Applied → policy v${nextVersion} for ${input.agentName}`,
          })
          .where(eq(agentMessages.id, input.sourceMessageId));
      }

      return {
        ok: true,
        policyId: Number((result as any)[0]?.insertId ?? 0),
        agentName: input.agentName,
        newVersion: nextVersion,
      };
    }),

  /** List recent policy proposal messages from retrospective. */
  listPolicyProposals: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.agentName, "general"),
          eq(agentMessages.messageType, "proposal")
        )
      )
      .orderBy(desc(agentMessages.createdAt))
      .limit(10);
    return rows;
  }),

  /**
   * Mark a Self-Retrospective proposal as adopted or rejected.
   *
   * QA audit 2026-05-11 Phase 1: previously proposals were write-only
   * — Jeff could read them but had no way to record whether he
   * acted on them. So the next retrospective had no signal about
   * which suggestions worked, and re-suggested the same things.
   * Now: proposalDecision column (drizzle/0069) captures it, and
   * future runSelfRetrospective can read past decisions as context.
   */
  markProposal: adminProcedure
    .input(
      z.object({
        messageId: z.number().int().positive(),
        decision: z.enum(["adopted", "rejected"]),
        note: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      // Code-review v2: guard with proposalDecision='pending' so a
      // double-click / two-tab race / re-fire of the same mutation
      // doesn't clobber the original decision + readAt + note. The
      // second call returns alreadyDecided=true so the UI can show
      // "this was already decided" instead of silently overwriting.
      const result: any = await db
        .update(agentMessages)
        .set({
          proposalDecision: input.decision,
          jeffResponse: input.note ?? null,
          readByJeff: 1,
          readAt: new Date(),
        })
        .where(
          and(
            eq(agentMessages.id, input.messageId),
            eq(agentMessages.proposalDecision, "pending")
          )
        );
      const affected =
        (result?.[0]?.affectedRows ?? result?.affectedRows ?? 0) | 0;
      return { success: true, alreadyDecided: affected === 0 };
    }),

  /** Internal: agent posts a message to Jeff. Used by future cron jobs / self-retrospective. */
  postMessage: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        messageType: z.enum([
          "proposal",
          "observation",
          "question",
          "alert",
          "digest",
          "escalation",
        ]),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(10_000),
        context: z.string().max(20_000).optional(),
        priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
        relatedOutcomeId: z.number().int().optional(),
        relatedInteractionId: z.number().int().optional(),
        relatedCustomerProfileId: z.number().int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const ins = await db.insert(agentMessages).values(input);
      return { messageId: Number((ins as any)[0]?.insertId ?? 0) };
    }),

  // ─────────────────────────────────────────────────────────────────
  // Gmail integration — connect / status / run / disconnect
  // ─────────────────────────────────────────────────────────────────

  /** Generate the consent-screen URL. Frontend opens this in a new tab. */
  gmailGetAuthUrl: adminProcedure.query(() => {
    try {
      return { ok: true as const, url: getGmailAuthUrl("admin-connect") };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }),

  /** Returns connection status for all integrations. */
  gmailStatus: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { integrations: [] };
    const rows = await db
      .select({
        id: gmailIntegration.id,
        emailAddress: gmailIntegration.emailAddress,
        isActive: gmailIntegration.isActive,
        lastPollAt: gmailIntegration.lastPollAt,
        messagesProcessed: gmailIntegration.messagesProcessed,
        messagesFailed: gmailIntegration.messagesFailed,
        disconnectReason: gmailIntegration.disconnectReason,
        createdAt: gmailIntegration.createdAt,
      })
      .from(gmailIntegration)
      .orderBy(desc(gmailIntegration.createdAt));
    return { integrations: rows };
  }),

  /** Test the connection without actually polling. */
  gmailVerify: adminProcedure
    .input(z.object({ integrationId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [integration] = await db
        .select()
        .from(gmailIntegration)
        .where(eq(gmailIntegration.id, input.integrationId))
        .limit(1);
      if (!integration)
        throw new TRPCError({ code: "NOT_FOUND", message: "Integration not found" });
      return verifyConnection(integration);
    }),

  /** Run the pipeline once now (for testing / on-demand). */
  gmailRunNow: adminProcedure
    .input(z.object({ integrationId: z.number().int() }))
    .mutation(async ({ input }) => {
      try {
        return await runGmailPipeline(input.integrationId);
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }),

  // ─────────────────────────────────────────────────────────────────
  // Per-agent chat — Jeff talks 1-on-1 with each agent
  // ─────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────
  // #全體辦公群 — group channel where agents broadcast + Jeff posts
  // announcements. Stored in agentMessages with agentName='general'.
  // Jeff's posts here DON'T trigger auto-replies (one-way broadcast).
  // ─────────────────────────────────────────────────────────────────

  listGeneralChannel: adminProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(200).default(80) })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.agentName, "general"))
        .orderBy(desc(agentMessages.createdAt))
        .limit(input?.limit ?? 80);
      return rows.reverse();
    }),

  postToGeneralChannel: adminProcedure
    .input(
      z.object({
        body: z.string().min(1).max(10_000),
        title: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1. Save Jeff's message
      const ins = await db.insert(agentMessages).values({
        agentName: "general",
        senderRole: "jeff",
        messageType: "observation",
        title: input.title ?? input.body.slice(0, 80),
        body: input.body,
        priority: "normal",
        readByJeff: 1,
        readAt: new Date(),
      });
      const messageId = Number((ins as any)[0]?.insertId ?? 0);

      // 2. Trigger office assistant reply (best-effort — don't fail the post if it errors)
      let assistantMessageId: number | undefined;
      try {
        const { reply } = await runOfficeAssistant(input.body);
        const assistantIns = await db.insert(agentMessages).values({
          agentName: "general",
          senderRole: "agent",
          messageType: "observation",
          title: reply.slice(0, 80),
          body: reply,
          priority: "normal",
          readByJeff: 1, // counted as read since Jeff is in the channel
          readAt: new Date(),
          context: JSON.stringify({ source: "office_assistant" }),
        });
        assistantMessageId = Number((assistantIns as any)[0]?.insertId ?? 0);
      } catch (e) {
        // Log but don't fail — Jeff's post still went through
        console.error(
          "[officeAssistant] reply failed:",
          e instanceof Error ? e.message : String(e)
        );
      }

      return { messageId, assistantMessageId };
    }),

  /**
   * Unread count for #general (messages from agents Jeff hasn't ack'd).
   * Separate from per-agent DMs to keep the sidebar badges accurate.
   */
  generalChannelUnread: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return 0;
    const [row] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.agentName, "general"),
          eq(agentMessages.readByJeff, 0),
          eq(agentMessages.senderRole, "agent")
        )
      );
    return Number(row?.c ?? 0);
  }),

  markGeneralChannelRead: adminProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) return { ok: true };
    await db
      .update(agentMessages)
      .set({ readByJeff: 1, readAt: new Date() })
      .where(
        and(
          eq(agentMessages.agentName, "general"),
          eq(agentMessages.readByJeff, 0)
        )
      );
    return { ok: true };
  }),

  /** Mark all messages from a specific agent as read. */
  markAgentChannelRead: adminProcedure
    .input(z.object({ agentName: z.enum(AGENT_NAMES) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { ok: true };
      await db
        .update(agentMessages)
        .set({ readByJeff: 1, readAt: new Date() })
        .where(
          and(
            eq(agentMessages.agentName, input.agentName),
            eq(agentMessages.readByJeff, 0)
          )
        );
      return { ok: true };
    }),

  /** Full conversation between Jeff and a specific agent (newest last). */
  listConversation: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        limit: z.number().int().min(1).max(200).default(80),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.agentName, input.agentName))
        .orderBy(desc(agentMessages.createdAt))
        .limit(input.limit);
      // Return newest-last for easier chat rendering
      return rows.reverse();
    }),

  /** Unread per-agent counts for the office sidebar. */
  unreadPerAgent: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return {};
    const rows = await db
      .select({
        agentName: agentMessages.agentName,
        c: sql<number>`COUNT(*)`,
      })
      .from(agentMessages)
      .where(and(eq(agentMessages.readByJeff, 0), eq(agentMessages.senderRole, "agent")))
      .groupBy(agentMessages.agentName);
    const result: Record<string, number> = {};
    for (const r of rows) result[r.agentName] = Number(r.c ?? 0);
    return result;
  }),

  /**
   * Jeff requests a status report from a specific agent. Agent reads its
   * own outcomes + recent DM and produces a structured digest, which is
   * saved as a new bubble in the agent's DM. Returns the new messageId so
   * the UI can scroll to it.
   */
  requestAgentReport: adminProcedure
    .input(z.object({ agentName: z.enum(AGENT_NAMES) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1. Gather data the agent needs to write its report
      const recentOutcomes = await db
        .select()
        .from(interactionOutcomes)
        .where(eq(interactionOutcomes.agentName, input.agentName))
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(50);

      const recentDmRows = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.agentName, input.agentName))
        .orderBy(desc(agentMessages.createdAt))
        .limit(20);
      const recentDmMessages = recentDmRows.reverse();

      const [activePolicy] = await db
        .select({ version: agentPolicies.version, rules: agentPolicies.rules })
        .from(agentPolicies)
        .where(and(eq(agentPolicies.agentName, input.agentName), eq(agentPolicies.active, 1)))
        .limit(1);

      // 2. Run the LLM-driven report
      let report;
      try {
        report = await runAgentReport({
          agentName: input.agentName,
          recentOutcomes: recentOutcomes.map((o) => ({
            agentName: o.agentName,
            actionTaken: o.actionTaken,
            confidence: o.confidence,
            customerSentiment: o.customerSentiment,
            customerReplied: o.customerReplied,
            customerBooked: o.customerBooked,
            reviewSubmitted: o.reviewSubmitted,
            refundRequested: o.refundRequested,
            jeffOverride: o.jeffOverride,
            jeffOverrideReason: o.jeffOverrideReason,
            outcomeFinalized: o.outcomeFinalized,
            createdAt: o.createdAt,
          })),
          recentDmMessages: recentDmMessages.map((m) => ({
            senderRole: m.senderRole as "agent" | "jeff",
            messageType: m.messageType,
            body: m.body,
            jeffResponse: m.jeffResponse,
            createdAt: m.createdAt,
          })),
          activePolicy: activePolicy ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `runAgentReport: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      // 3. Persist as a chat bubble
      const formatted = formatReportAsMessage(report);
      const priority = report.concerns.length > 0 || report.questions.length > 0
        ? "high"
        : "normal";
      const ins = await db.insert(agentMessages).values({
        agentName: input.agentName,
        senderRole: "agent",
        messageType: "digest",
        title: formatted.title,
        body: formatted.body,
        context: formatted.context,
        priority,
      });
      const messageId = Number((ins as any)[0]?.insertId ?? 0);

      return { messageId, report };
    }),

  /**
   * Request a report from every Round 81 agent in parallel. Each agent's
   * report lands in its own DM (5 separate bubbles). Returns array of
   * results with any errors per-agent (doesn't fail the whole call if one
   * agent fails).
   */
  requestAllAgentReports: adminProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const reportableAgents = AGENT_NAMES.filter(
      (n) => n !== "self_retrospective" // skip until we build that loop
    );

    const results = await Promise.all(
      reportableAgents.map(async (agentName) => {
        try {
          const recentOutcomes = await db
            .select()
            .from(interactionOutcomes)
            .where(eq(interactionOutcomes.agentName, agentName))
            .orderBy(desc(interactionOutcomes.createdAt))
            .limit(50);
          const recentDmRows = await db
            .select()
            .from(agentMessages)
            .where(eq(agentMessages.agentName, agentName))
            .orderBy(desc(agentMessages.createdAt))
            .limit(20);
          const [activePolicy] = await db
            .select({
              version: agentPolicies.version,
              rules: agentPolicies.rules,
            })
            .from(agentPolicies)
            .where(
              and(eq(agentPolicies.agentName, agentName), eq(agentPolicies.active, 1))
            )
            .limit(1);

          const report = await runAgentReport({
            agentName,
            recentOutcomes: recentOutcomes.map((o) => ({
              agentName: o.agentName,
              actionTaken: o.actionTaken,
              confidence: o.confidence,
              customerSentiment: o.customerSentiment,
              customerReplied: o.customerReplied,
              customerBooked: o.customerBooked,
              reviewSubmitted: o.reviewSubmitted,
              refundRequested: o.refundRequested,
              jeffOverride: o.jeffOverride,
              jeffOverrideReason: o.jeffOverrideReason,
              outcomeFinalized: o.outcomeFinalized,
              createdAt: o.createdAt,
            })),
            recentDmMessages: recentDmRows.reverse().map((m) => ({
              senderRole: m.senderRole as "agent" | "jeff",
              messageType: m.messageType,
              body: m.body,
              jeffResponse: m.jeffResponse,
              createdAt: m.createdAt,
            })),
            activePolicy: activePolicy ?? null,
          });

          const formatted = formatReportAsMessage(report);
          const priority =
            report.concerns.length > 0 || report.questions.length > 0
              ? "high"
              : "normal";
          const ins = await db.insert(agentMessages).values({
            agentName,
            senderRole: "agent",
            messageType: "digest",
            title: formatted.title,
            body: formatted.body,
            context: formatted.context,
            priority,
          });
          const messageId = Number((ins as any)[0]?.insertId ?? 0);
          return { agentName, ok: true as const, messageId };
        } catch (e) {
          return {
            agentName,
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      })
    );

    return { results };
  }),

  /**
   * Jeff sends a message to a specific agent. Saves Jeff's message, then
   * invokes the agent's chat function to generate a reply, saves the reply
   * too. Returns both rows so the UI can append them atomically.
   */
  sendToAgent: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        body: z.string().min(1).max(10_000),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1. Save Jeff's message
      const jeffIns = await db.insert(agentMessages).values({
        agentName: input.agentName,
        senderRole: "jeff",
        messageType: "observation",
        title: input.body.slice(0, 80),
        body: input.body,
        priority: "normal",
        readByJeff: 1,
        readAt: new Date(),
      });
      const jeffMessageId = Number((jeffIns as any)[0]?.insertId ?? 0);

      // 2. Pull last 30 messages to feed as history (excluding the one we just inserted)
      const history = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.agentName, input.agentName))
        .orderBy(desc(agentMessages.createdAt))
        .limit(30);
      const historyAsc = history.reverse();
      // Drop the just-inserted Jeff message from history (we pass it as newJeffMessage)
      const filteredHistory = historyAsc.filter((r) => r.id !== jeffMessageId);

      // 3. Get active policy
      const [policy] = await db
        .select({ rules: agentPolicies.rules })
        .from(agentPolicies)
        .where(and(eq(agentPolicies.agentName, input.agentName), eq(agentPolicies.active, 1)))
        .limit(1);

      // 3b. Gather real-data context (outcomes + interactions + stats) so the
      //     agent can answer "how have you been doing" with actual numbers.
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const recentOutcomesRaw = await db
        .select()
        .from(interactionOutcomes)
        .where(eq(interactionOutcomes.agentName, input.agentName))
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(20);

      // Join recent outcomes to interactions for the most-recent 10
      const interactionIds = recentOutcomesRaw
        .map((o) => o.interactionId)
        .filter((id) => id != null && id > 0);
      const recentInteractionsRaw =
        interactionIds.length > 0
          ? await db
              .select({
                channel: customerInteractions.channel,
                classification: customerInteractions.classification,
                sentiment: customerInteractions.sentiment,
                contentSummary: customerInteractions.contentSummary,
                createdAt: customerInteractions.createdAt,
                customerEmail: customerProfiles.email,
              })
              .from(customerInteractions)
              .leftJoin(
                customerProfiles,
                eq(customerInteractions.customerProfileId, customerProfiles.id)
              )
              .where(inArray(customerInteractions.id, interactionIds.slice(0, 10)))
              .orderBy(desc(customerInteractions.createdAt))
              .limit(10)
          : [];

      // Aggregate stats
      const [todayRow] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(interactionOutcomes)
        .where(
          and(
            eq(interactionOutcomes.agentName, input.agentName),
            sql`${interactionOutcomes.createdAt} >= ${startOfDay}`
          )
        );
      const [weekRow] = await db
        .select({
          total: sql<number>`COUNT(*)`,
          auto: sql<number>`SUM(CASE WHEN ${interactionOutcomes.actionTaken} NOT LIKE '%escalate%' THEN 1 ELSE 0 END)`,
          esc: sql<number>`SUM(CASE WHEN ${interactionOutcomes.actionTaken} LIKE '%escalate%' THEN 1 ELSE 0 END)`,
          overrides: sql<number>`SUM(${interactionOutcomes.jeffOverride})`,
          avgConf: sql<number>`AVG(${interactionOutcomes.confidence})`,
        })
        .from(interactionOutcomes)
        .where(
          and(
            eq(interactionOutcomes.agentName, input.agentName),
            sql`${interactionOutcomes.createdAt} >= ${since7d}`
          )
        );

      // 4. Run chat — now with context injected
      let reply = "";
      try {
        const out = await runAgentChat({
          agentName: input.agentName,
          history: filteredHistory.map((r) => ({
            senderRole: r.senderRole as "agent" | "jeff",
            body: r.body,
            title: r.title,
            createdAt: r.createdAt,
          })),
          newJeffMessage: input.body,
          activePolicyRules: policy?.rules,
          context: {
            recentOutcomes: recentOutcomesRaw.map((o) => ({
              actionTaken: o.actionTaken,
              confidence: o.confidence,
              customerSentiment: o.customerSentiment,
              customerReplied: o.customerReplied,
              customerBooked: o.customerBooked,
              refundRequested: o.refundRequested,
              jeffOverride: o.jeffOverride,
              jeffOverrideReason: o.jeffOverrideReason,
              outcomeFinalized: o.outcomeFinalized,
              createdAt: o.createdAt,
            })),
            recentInteractions: recentInteractionsRaw.map((i) => ({
              channel: i.channel,
              classification: i.classification,
              sentiment: i.sentiment,
              contentSummary: i.contentSummary,
              createdAt: i.createdAt,
              customerEmail: i.customerEmail,
            })),
            stats: {
              todayActions: Number(todayRow?.c ?? 0),
              week7dActions: Number(weekRow?.total ?? 0),
              week7dAuto: Number(weekRow?.auto ?? 0),
              week7dEscalations: Number(weekRow?.esc ?? 0),
              overrides: Number(weekRow?.overrides ?? 0),
              avgConfidence: weekRow?.avgConf != null ? Math.round(Number(weekRow.avgConf)) : null,
            },
          },
        });
        reply = out.reply;
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Agent chat failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      // 5. Save agent's reply
      const agentIns = await db.insert(agentMessages).values({
        agentName: input.agentName,
        senderRole: "agent",
        messageType: "observation",
        title: reply.slice(0, 80),
        body: reply,
        priority: "normal",
        readByJeff: 1, // since Jeff is in the active chat, count as read
        readAt: new Date(),
      });
      const agentMessageId = Number((agentIns as any)[0]?.insertId ?? 0);

      return {
        jeffMessageId,
        agentMessageId,
        reply,
      };
    }),

  /** Disconnect: marks inactive + records reason. Tokens stay in DB
   *  (so we can reactivate without re-auth) unless user reconnects via
   *  the consent flow which generates fresh tokens. */
  gmailDisconnect: adminProcedure
    .input(
      z.object({
        integrationId: z.number().int(),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(gmailIntegration)
        .set({
          isActive: 0,
          disconnectReason: input.reason ?? "Disconnected by admin",
        })
        .where(eq(gmailIntegration.id, input.integrationId));
      return { ok: true };
    }),
});

// ────────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────────

async function ensurePolicy(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  agentName: typeof AGENT_NAMES[number],
  defaults: unknown
) {
  let policy = await db
    .select()
    .from(agentPolicies)
    .where(and(eq(agentPolicies.agentName, agentName), eq(agentPolicies.active, 1)))
    .limit(1)
    .then((r) => r[0]);
  if (!policy) {
    const result = await db.insert(agentPolicies).values({
      agentName,
      version: 1,
      rules: JSON.stringify(defaults, null, 2),
      active: 1,
      createdBy: "human",
      reasonNote: `Initial v1 default policy (cold-start seed by ${agentName} demo)`,
    });
    const seededId = Number((result as any)[0]?.insertId ?? 0);
    policy = await db
      .select()
      .from(agentPolicies)
      .where(eq(agentPolicies.id, seededId))
      .limit(1)
      .then((r) => r[0]);
  }
  return policy!;
}

async function ensureCustomerByEmail(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  email: string
): Promise<{ id: number; created: boolean }> {
  const existing = await db
    .select()
    .from(customerProfiles)
    .where(eq(customerProfiles.email, email))
    .limit(1);
  if (existing[0]) return { id: existing[0].id, created: false };
  const ins = await db.insert(customerProfiles).values({ email });
  return { id: Number((ins as any)[0]?.insertId ?? 0), created: true };
}
