/**
 * agent.* Layer-2 demo-mode sub-router.
 *
 * v2 Wave 2 Module 2.10 (2026-05-21): extracted from
 * server/routers/agentRouter.ts when the monolith was split into eight
 * domain sub-routers. Covers the "Jeff pastes a sample → agent runs the
 * full pipeline → nothing is actually sent" demo procedures used by
 * AutonomousAgentsTab to dogfood each agent before wiring it to the
 * real ingest channels.
 *
 * Procedures (5):
 *   - demoInquiry
 *   - demoReview
 *   - demoMarketing
 *   - demoFollowup
 *   - demoRefund
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { router, adminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import { touchLastInbound } from "../../_core/customerUnread";
import {
  customerProfiles,
  customerInteractions,
  interactionOutcomes,
  agentPolicies,
  agentMessages,
} from "../../../drizzle/schema";
import {
  runInquiryAgent,
  DEFAULT_INQUIRY_POLICY,
} from "../../agents/autonomous/inquiryAgent";
import {
  runReviewAgent,
  DEFAULT_REVIEW_POLICY,
} from "../../agents/autonomous/reviewAgent";
import {
  runMarketingAgent,
  DEFAULT_MARKETING_POLICY,
} from "../../agents/autonomous/marketingAgent";
import {
  runFollowupAgent,
  DEFAULT_FOLLOWUP_POLICY,
} from "../../agents/autonomous/followupAgent";
import {
  runRefundAgent,
  DEFAULT_REFUND_POLICY,
} from "../../agents/autonomous/refundAgent";
import { ensurePolicy, ensureCustomerByEmail } from "./_shared";

export const demoRouter = router({
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
      }),
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
          // insertCustomerProfileSafely (2026-07-03, 任務7 對抗審查 P0) — closes
          // the race window between the `existing` SELECT above and this INSERT.
          const { insertCustomerProfileSafely } = await import("../../db/customerProfile");
          const insertResult = await insertCustomerProfileSafely(db, {
            email: senderEmail,
            preferredLanguage: decision.draftLanguage === "en" ? "en" : "zh-TW",
          });
          profileId = insertResult.profileId;
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
        // customer-unread (0108) — inbound landed, advance the red-dot pointer.
        await touchLastInbound(db, profileId, new Date());
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
      }),
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
        // customer-unread (0108) — inbound landed, advance the red-dot pointer.
        await touchLastInbound(db, profileId, new Date());
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
      }),
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
      }),
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
      }),
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
        // customer-unread (0108) — inbound landed, advance the red-dot pointer.
        await touchLastInbound(db, profileId, new Date());
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
});
