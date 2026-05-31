/**
 * quoteExecutor — 指揮中心 報價頁 approval executor (P2).
 *
 * Registers the lane executor for taskType "quote_draft" on the approval-box
 * spine (server/_core/approvalTasks.ts). When Jeff approves a quote draft in
 * the 審核箱, the commandCenter router looks up THIS executor by the task's
 * taskType and runs it.
 *
 * v1 scope (Jeff Q&A): the executor ONLY marks the quote「已報價」(a structured
 * log line). It does NOT auto-generate a PDF and does NOT auto-email the
 * customer — Jeff takes the confirmed price and runs the packgo-quote skill by
 * hand. So a successful approve resolves to { status: "sent" } (the router then
 * flips the task row to "sent"), and the side effect is purely the audit log.
 *
 * ⚠️ MUST NOT THROW for expected failures (ApprovalExecutor contract): a
 * bad/empty payload resolves to { status: "failed" } so the router marks the
 * row failed cleanly instead of crashing the approve. The router still has a
 * defensive try/catch, but this executor owns its own error handling.
 *
 * REGISTRATION-AT-BOOT: the side-effecting `registerApprovalExecutor` call only
 * runs if something imports it. It is wired into the import graph via
 * `registerQuoteExecutors()` (exported below), which the commandCenter router
 * imports + calls at module load. Because server/routers.ts imports the
 * commandCenter router to build appRouter (loaded at server boot), the
 * registration is guaranteed to have run before any approve can dispatch.
 */

import {
  registerApprovalExecutor,
  type ApprovalExecutor,
  type ApprovalExecutorResult,
  type ApprovalTask,
} from "../../_core/approvalTasks";
import { createChildLogger } from "../../_core/logger";

const log = createChildLogger({ module: "quoteExecutor" });

/** The taskType this executor is registered under (matches the producer). */
export const QUOTE_DRAFT_TASK_TYPE = "quote_draft";

/**
 * Shape the producer writes into approvalTasks.payload (JSON). Only `tourId` +
 * `tourTitle` are load-bearing for the v1 mark; the rest is preview / future
 * metadata. Jeff may have edited `finalPrice` / `notes` before approving —
 * decideApprovalTask persisted the edit, so `task.payload` already reflects it.
 */
interface QuoteDraftPayload {
  tourId: number;
  tourTitle: string;
  departureId?: number;
  customerName?: string;
  customerEmail?: string;
  customerChannel?: string;
  supplierPrice?: number;
  aiEstimate?: number;
  finalPrice?: number;
  currency?: string;
  notes?: string;
  isCustomTrip?: boolean;
}

function parsePayload(raw: string): QuoteDraftPayload | null {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !obj ||
    typeof obj.tourId !== "number" ||
    typeof obj.tourTitle !== "string" ||
    obj.tourTitle.trim().length === 0
  ) {
    return null;
  }
  return obj as QuoteDraftPayload;
}

/**
 * The structured「已報價」record written to the audit log on a successful
 * approve. Pure + exported so the test can assert the field mapping (notably
 * `decidedBy` — who approved) without a logger spy. The quoted number is the
 * edited finalPrice when present, else the supplier reference price.
 */
export function buildQuoteMarkedRecord(
  task: ApprovalTask,
  payload: QuoteDraftPayload,
) {
  return {
    taskId: task.id,
    tourId: payload.tourId,
    tourTitle: payload.tourTitle,
    /** users.id of the admin who approved (NULL for system flows). */
    decidedBy: task.decidedBy ?? null,
    quotedPrice: payload.finalPrice ?? payload.supplierPrice ?? null,
    currency: payload.currency ?? "USD",
    isCustomTrip: payload.isCustomTrip ?? false,
  };
}

/**
 * The executor. Never throws for expected failures — returns a failed result.
 * v1: marks 已報價 via a structured log line, then reports { status: "sent" }.
 */
export const quoteDraftExecutor: ApprovalExecutor = async (
  task,
): Promise<ApprovalExecutorResult> => {
  const payload = parsePayload(task.payload);
  if (!payload) {
    log.warn(
      { taskId: task.id },
      "[quoteExecutor] invalid payload — missing tourId/tourTitle",
    );
    return { status: "failed", errorMessage: "invalid quote_draft payload" };
  }

  try {
    const record = buildQuoteMarkedRecord(task, payload);
    log.info(
      record,
      "[quoteExecutor] quote marked 已報價 (v1: no auto-PDF / no auto-email — run packgo-quote manually)",
    );
    return { status: "sent" };
  } catch (err) {
    // Defensive: nothing here should throw in v1, but never let it escape so
    // the router marks the row failed cleanly instead of crashing the approve.
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { taskId: task.id, tourId: payload.tourId, err },
      "[quoteExecutor] unexpected error",
    );
    return { status: "failed", errorMessage: message };
  }
};

let registered = false;

/**
 * Register the quote-lane executor(s) on the spine. Idempotent — safe to call
 * more than once (the commandCenter router calls it at module load). Exposed as
 * a function (rather than a bare top-level side effect) so the import that
 * wires it into the boot graph is explicit + greppable.
 */
export function registerQuoteExecutors(): void {
  if (registered) return;
  registerApprovalExecutor(QUOTE_DRAFT_TASK_TYPE, quoteDraftExecutor);
  registered = true;
  log.info(
    { taskType: QUOTE_DRAFT_TASK_TYPE },
    "[quoteExecutor] quote lane executor registered",
  );
}
