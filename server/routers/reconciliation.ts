/**
 * Reconciliation router — admin auto-reconciliation report.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1). Source range
 * (verbatim from origin): L4543-4576.
 *
 * Procedures (1):
 *   - runReport  – v78: monthly auto-reconciliation joining payments,
 *                  Stripe ledger, and accounting entries to flag drift
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";

export const reconciliationRouter = router({
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

        const { runReconciliation } = await import("../services/reconciliationService");
        const report = await runReconciliation(start, end);

        const { audit } = await import("../_core/auditLog");
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
  });
