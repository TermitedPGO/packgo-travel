/**
 * commandCenter — 指揮中心 (Command Center) 審核箱脊椎 S-3 tRPC router.
 *
 * The single API the 指揮中心 UI talks to. Reads the approval inbox and routes
 * approve/reject back to the lane executor registered for each task's
 * `taskType` (server/_core/approvalTasks.ts). v1 registers no executors, so
 * approve flips status to "approved" and stops there; lanes P1-P4 plug in
 * their executors and the same approve path starts sending.
 *
 * All procedures use adminProcedure → automatic role check + 60 req/min/admin
 * mutation rate-limit (server/_core/trpc.ts). Decision + create audit rows are
 * written inside the helper.
 *
 * riskLevel policy (design.md §2 S-3 line 99/101):
 *   - approve / reject are per-item.
 *   - bulkApprove allows riskLevel = auto / review only; hard_gate is BLOCKED
 *     (money / irreversible / customer-visible must never be batch-approved).
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  listApprovalTasks,
  getApprovalStats,
  getApprovalTaskById,
  decideApprovalTask,
  getApprovalExecutor,
  markApprovalTaskSent,
  markApprovalTaskFailed,
  type ApprovalAuditCtx,
  type ApprovalTask,
} from "../_core/approvalTasks";

const laneEnum = z.enum(["cs", "quote", "marketing", "finance"]);
const statusEnum = z.enum([
  "pending",
  "approved",
  "rejected",
  "sent",
  "failed",
  "expired",
]);

/** Outcome of approving one task (shared by approve + bulkApprove). */
export interface ApproveOutcome {
  id: number;
  /** Terminal status after the executor ran (or "approved" if none). */
  status: ApprovalTask["status"];
  /** Whether a lane executor was found and invoked. */
  executed: boolean;
  errorMessage?: string;
}

/**
 * Approve one task, then run its lane executor if registered. Centralized so
 * approve (single) and bulkApprove share identical send semantics. The caller
 * is responsible for the hard_gate / pending guards before invoking this.
 */
async function approveAndExecute(
  id: number,
  ctx: ApprovalAuditCtx,
  decidedBy: number | undefined,
  editedPayload?: string,
): Promise<ApproveOutcome> {
  // 1. Flip status → "approved" (audited). Throws if not pending.
  const task = await decideApprovalTask(
    { id, decision: "approve", decidedBy, editedPayload },
    ctx,
  );

  // 2. Look up the lane executor. None registered (v1) → stop at "approved".
  const executor = getApprovalExecutor(task.taskType);
  if (!executor) {
    return { id, status: task.status, executed: false };
  }

  // 3. Run it. The executor must report sent/failed rather than throw, but we
  //    still wrap to mark the row failed on an unexpected throw.
  try {
    const result = await executor(task, ctx);
    if (result.status === "sent") {
      await markApprovalTaskSent(id);
      return { id, status: "sent", executed: true };
    }
    await markApprovalTaskFailed(id, result.errorMessage ?? "executor failed");
    return {
      id,
      status: "failed",
      executed: true,
      errorMessage: result.errorMessage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markApprovalTaskFailed(id, message);
    return { id, status: "failed", executed: true, errorMessage: message };
  }
}

export const commandCenterRouter = router({
  /** Inbox list — optional lane / status filter, newest first. */
  list: adminProcedure
    .input(
      z
        .object({
          lane: laneEnum.optional(),
          status: statusEnum.optional(),
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return listApprovalTasks(input ?? {});
    }),

  /** Per-lane pending counts for the 狀態 strip. */
  stats: adminProcedure.query(async () => {
    return getApprovalStats();
  }),

  /** Approve one task → run its lane executor (per-item; hard_gate allowed here). */
  approve: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        editedPayload: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return approveAndExecute(
        input.id,
        ctx as ApprovalAuditCtx,
        ctx.user.id,
        input.editedPayload,
      );
    }),

  /** Reject one task (status → rejected, audited). No executor runs. */
  reject: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        reason: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await decideApprovalTask(
        {
          id: input.id,
          decision: "reject",
          decidedBy: ctx.user.id,
          reason: input.reason,
        },
        ctx as ApprovalAuditCtx,
      );
      return { id: task.id, status: task.status };
    }),

  /**
   * Batch-approve auto / review tasks in one click. hard_gate tasks are
   * BLOCKED (reported back, never approved). Non-pending / missing ids are
   * also reported as blocked so the UI can show exactly what happened.
   */
  bulkApprove: adminProcedure
    .input(z.object({ ids: z.array(z.number().int()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const approved: ApproveOutcome[] = [];
      const blocked: Array<{ id: number; reason: string }> = [];

      for (const id of input.ids) {
        const task = await getApprovalTaskById(id);
        if (!task) {
          blocked.push({ id, reason: "not_found" });
          continue;
        }
        if (task.riskLevel === "hard_gate") {
          // 鐵律：碰錢 / 不可逆 / 對客可見一律逐筆，不准批次。
          blocked.push({ id, reason: "hard_gate" });
          continue;
        }
        if (task.status !== "pending") {
          blocked.push({ id, reason: `already_${task.status}` });
          continue;
        }
        approved.push(
          await approveAndExecute(id, ctx as ApprovalAuditCtx, ctx.user.id),
        );
      }

      return { approved, blocked };
    }),
});
