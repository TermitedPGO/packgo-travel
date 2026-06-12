/**
 * agent.* policy + proposal management sub-router.
 *
 * v2 Wave 2 Module 2.10 (2026-05-21): extracted from
 * server/routers/agentRouter.ts when the monolith was split into eight
 * domain sub-routers. Covers policy versioning (active/rollback/upsert),
 * the Phase 2 auto-send threshold tweak, and the Phase 3 retrospective
 * proposal lifecycle (propose / decide / apply).
 *
 * Procedures (8):
 *   - getAutoSendSettings
 *   - setAutoSendSettings
 *   - getActivePolicy
 *   - upsertPolicy
 *   - rollbackPolicy
 *   - listPolicyProposals
 *   - markProposal
 *   - applyRetrospectiveProposal
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc } from "drizzle-orm";
import { router, adminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import { agentPolicies, agentMessages } from "../../../drizzle/schema";
import { AGENT_NAMES } from "./_shared";

export const policyRouter = router({
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
      }),
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

  // ─────────────────────────────────────────────────────────────────
  // email-auto-reply m4 (拍板 2026-06-12) — 信任階梯政策卡的完整六鍵
  // 讀寫。寫入只准動這六鍵(其他政策內容不經此路),audit 留底。
  // 硬編碼排除類在 zod 層就擋(autoSendGate.AUTO_SEND_HARD_EXCLUDED)。
  // ─────────────────────────────────────────────────────────────────

  getAutoSendPolicyFull: adminProcedure
    .input(z.object({ agentName: z.enum(AGENT_NAMES) }))
    .query(async ({ input }) => {
      const { readAutoSendPolicy } = await import(
        "../../agents/autonomous/autoSendGate"
      );
      const db = await getDb();
      if (!db) return { ...readAutoSendPolicy(null), version: 0 };
      const [row] = await db
        .select({ rules: agentPolicies.rules, version: agentPolicies.version })
        .from(agentPolicies)
        .where(
          and(
            eq(agentPolicies.agentName, input.agentName),
            eq(agentPolicies.active, 1),
          ),
        )
        .limit(1);
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = row ? JSON.parse(row.rules) : null;
      } catch {
        parsed = null;
      }
      return { ...readAutoSendPolicy(parsed), version: row?.version ?? 0 };
    }),

  setAutoSendPolicyFull: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        enabled: z.boolean(),
        shadowMode: z.boolean(),
        classes: z.array(z.string().max(64)).max(20),
        minConfidence: z.number().int().min(50).max(99),
        dailyCap: z.number().int().min(0).max(100),
        blockAttachments: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { AUTO_SEND_HARD_EXCLUDED } = await import(
        "../../agents/autonomous/autoSendGate"
      );
      const blocked = input.classes.filter((c) => AUTO_SEND_HARD_EXCLUDED.has(c));
      if (blocked.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `這些類別永不自動(碰錢/法律,改碼才能動):${blocked.join(", ")}`,
        });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [row] = await db
        .select()
        .from(agentPolicies)
        .where(
          and(
            eq(agentPolicies.agentName, input.agentName),
            eq(agentPolicies.active, 1),
          ),
        )
        .limit(1);

      let policy: any = {};
      if (row) {
        try {
          policy = JSON.parse(row.rules);
        } catch {
          policy = {};
        }
      }
      const before = {
        autoSendEnabled: policy.autoSendEnabled,
        autoSendShadowMode: policy.autoSendShadowMode,
        autoSendClasses: policy.autoSendClasses,
        autoSendMinConfidence: policy.autoSendMinConfidence,
        autoSendDailyCap: policy.autoSendDailyCap,
        autoSendBlockAttachments: policy.autoSendBlockAttachments,
      };
      policy.autoSendEnabled = input.enabled;
      policy.autoSendShadowMode = input.shadowMode;
      policy.autoSendClasses = input.classes;
      policy.autoSendMinConfidence = input.minConfidence;
      policy.autoSendDailyCap = input.dailyCap;
      policy.autoSendBlockAttachments = input.blockAttachments;
      const newRules = JSON.stringify(policy, null, 2);

      const { audit } = await import("../../_core/auditLog");
      if (row) {
        await db
          .update(agentPolicies)
          .set({ rules: newRules })
          .where(eq(agentPolicies.id, row.id));
        audit({
          ctx,
          action: "agentPolicy.autoSendUpdate",
          targetType: "agentPolicy",
          targetId: row.id,
          changes: { before, after: input },
        });
        return { ok: true, version: row.version };
      }
      const ins = await db.insert(agentPolicies).values({
        agentName: input.agentName,
        version: 1,
        rules: newRules,
        active: 1,
        createdBy: "human",
        reasonNote: "Initial v1 (created from 自動回覆政策卡)",
      });
      const newId = Number((ins as any)[0]?.insertId ?? 0);
      audit({
        ctx,
        action: "agentPolicy.autoSendUpdate",
        targetType: "agentPolicy",
        targetId: newId,
        changes: { before: null, after: input },
      });
      return { ok: true, version: 1, newId };
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
            eq(agentPolicies.active, 1),
          ),
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
      }),
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
            eq(agentPolicies.active, 1),
          ),
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
      }),
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
            eq(agentPolicies.active, 1),
          ),
        );
      await db
        .update(agentPolicies)
        .set({ active: 1, reasonNote: input.reasonNote })
        .where(
          and(
            eq(agentPolicies.agentName, input.agentName),
            eq(agentPolicies.version, input.targetVersion),
          ),
        );
      return { ok: true };
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
          eq(agentMessages.messageType, "proposal"),
        ),
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
      }),
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
            eq(agentMessages.proposalDecision, "pending"),
          ),
        );
      const affected =
        (result?.[0]?.affectedRows ?? result?.affectedRows ?? 0) | 0;
      return { success: true, alreadyDecided: affected === 0 };
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
      }),
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
          and(eq(agentPolicies.agentName, input.agentName), eq(agentPolicies.active, 1)),
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
});
