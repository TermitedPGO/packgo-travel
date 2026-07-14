/**
 * agent.* Gmail integration sub-router.
 *
 * v2 Wave 2 Module 2.10 (2026-05-21): extracted from
 * server/routers/agentRouter.ts when the monolith was split into eight
 * domain sub-routers. Wraps the gmail OAuth + pipeline runner so the
 * AutonomousAgents/Gmail card in admin can connect, verify, run-once,
 * and disconnect without leaking the helper modules into the client.
 *
 * Procedures (5):
 *   - gmailGetAuthUrl
 *   - gmailStatus
 *   - gmailVerify
 *   - gmailRunNow
 *   - gmailDisconnect
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc } from "drizzle-orm";
import { router, adminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import { gmailIntegration } from "../../../drizzle/schema";
import { getGmailAuthUrl, verifyConnection } from "../../_core/gmail";
import { runGmailPipeline } from "../../agents/autonomous/gmailPipeline";

export const gmailRouter = router({
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

  /** Run the pipeline once now (for testing / on-demand).
   *
   * gmail-intake-ledger (Codex 18 §六 P0-3) — route by intakeMode. history is driven
   * ONLY by the ledger engine (runIntakeForIntegration; its feed is still subject to the
   * authoritative sink gate), so a manual "Run now" can NEVER push a history mailbox
   * through the legacy side-effect chain. legacy + shadow run the legacy pipeline (shadow
   * keeps it as the 並行對照 writer). A missing integration or unavailable DB STOPS + errors
   * (surfaced to admin) — it is NEVER guessed as legacy (fail-closed, not fail-open). */
  gmailRunNow: adminProcedure
    .input(z.object({ integrationId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [integration] = await db
        .select({ id: gmailIntegration.id, intakeMode: gmailIntegration.intakeMode })
        .from(gmailIntegration)
        .where(eq(gmailIntegration.id, input.integrationId))
        .limit(1);
      if (!integration)
        throw new TRPCError({ code: "NOT_FOUND", message: "Integration not found" });
      try {
        if (integration.intakeMode === "history") {
          const { runIntakeForIntegration } = await import(
            "../../services/gmailIntakeAdapters"
          );
          return await runIntakeForIntegration(input.integrationId);
        }
        return await runGmailPipeline(input.integrationId);
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }),

  /** Disconnect: marks inactive + records reason. Tokens stay in DB
   *  (so we can reactivate without re-auth) unless user reconnects via
   *  the consent flow which generates fresh tokens. */
  gmailDisconnect: adminProcedure
    .input(
      z.object({
        integrationId: z.number().int(),
        reason: z.string().max(500).optional(),
      }),
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
