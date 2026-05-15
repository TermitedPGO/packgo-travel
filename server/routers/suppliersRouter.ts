/**
 * suppliersRouter — admin tRPC for the supplier-sync subsystem.
 *
 * Phase 1E. Powers the admin dashboard panel (forthcoming React tab in
 * client/src/components/admin/SuppliersTab.tsx) and the "Sync now"
 * button.
 *
 * All procedures are `adminProcedure` — no customer-facing reads here.
 * The customer-facing /catalog page (Phase 1F) reads supplierProducts
 * directly through publicProcedure queries in a separate router.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import {
  getRecentSyncRuns,
  getSuppliersOverview,
} from "../services/supplierSyncService";
import { triggerManualSync } from "../queues/supplierSyncQueue";

export const suppliersRouter = router({
  /**
   * Dashboard overview: each supplier + product counts by status.
   * Used to render the "Suppliers" card grid at the top of the panel.
   */
  overview: adminProcedure.query(async () => {
    return getSuppliersOverview();
  }),

  /**
   * Recent sync-run history (last N rows joined with supplier name).
   * Used for the timeline list at the bottom of the panel.
   */
  recentRuns: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(({ input }) => getRecentSyncRuns(input.limit)),

  /**
   * Trigger an out-of-schedule sync. Returns the Bull job id so the UI
   * can poll for completion (recentRuns will pick up the new row in
   * status='running' within seconds of this returning).
   */
  triggerSync: adminProcedure
    .input(
      z.object({
        kind: z
          .enum(["full", "lion-only", "uv-only"])
          .default("full"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const jobId = await triggerManualSync({
          kind: input.kind,
          adminUserId: ctx.user.id,
        });
        return { jobId };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to enqueue sync job: ${(err as Error).message}`,
        });
      }
    }),
});
