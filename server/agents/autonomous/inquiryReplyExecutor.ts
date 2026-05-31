/**
 * inquiryReplyExecutor — 指揮中心 客服頁 approval executor (P1-d).
 *
 * Registers the lane executor for taskType "inquiry_reply" on the approval-box
 * spine (server/_core/approvalTasks.ts). When an admin approves a cs draft in
 * the 審核箱, the commandCenter router (S-3) looks up THIS executor by the
 * task's taskType and runs it. The executor:
 *   1. parses the task payload (the draft body + inquiry refs),
 *   2. calls the shared sendAdminInquiryReply helper — persist the reply on the
 *      thread + email the customer + advance status (identical to a manual
 *      Inbox reply),
 *   3. reports { status: "sent" } on a successful send, or
 *      { status: "failed", errorMessage } otherwise.
 *
 * ⚠️ MUST NOT THROW for expected failures (ApprovalExecutor contract): a
 * bad/empty payload or a bounced email resolves to { status: "failed" } so the
 * router marks the row failed cleanly instead of crashing the approve. The
 * router still has a defensive try/catch, but this executor owns its own
 * error handling.
 *
 * REGISTRATION-AT-BOOT: this module's side-effecting `registerApprovalExecutor`
 * call only runs if something imports it. It is wired into the import graph via
 * `registerCsExecutors()` (exported below), which the commandCenter router
 * imports + calls at module load. Because server/routers.ts imports the
 * commandCenter router to build appRouter (loaded at server boot), the
 * registration is guaranteed to have run before any approve can dispatch.
 */

import {
  registerApprovalExecutor,
  type ApprovalExecutor,
  type ApprovalExecutorResult,
} from "../../_core/approvalTasks";
import { sendAdminInquiryReply } from "../../_core/inquiryReply";
import { createChildLogger } from "../../_core/logger";

const log = createChildLogger({ module: "inquiryReplyExecutor" });

/** The taskType this executor is registered under (matches the producer). */
export const INQUIRY_REPLY_TASK_TYPE = "inquiry_reply";

/**
 * Shape the producer writes into approvalTasks.payload (JSON). Only `inquiryId`
 * + `draftBody` are load-bearing for the send; the rest is preview metadata.
 * The admin may have edited `draftBody` before approving — decideApprovalTask
 * persisted the edit, so `task.payload` already reflects it.
 */
interface InquiryReplyPayload {
  inquiryId: number;
  draftBody: string;
  customerEmail?: string;
  customerName?: string;
  subject?: string;
  classification?: string;
  confidence?: number;
  language?: string;
}

function parsePayload(raw: string): InquiryReplyPayload | null {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !obj ||
    typeof obj.inquiryId !== "number" ||
    typeof obj.draftBody !== "string" ||
    obj.draftBody.trim().length === 0
  ) {
    return null;
  }
  return obj as InquiryReplyPayload;
}

/**
 * The executor. Never throws for expected failures — returns a failed result.
 */
export const inquiryReplyExecutor: ApprovalExecutor = async (
  task,
): Promise<ApprovalExecutorResult> => {
  const payload = parsePayload(task.payload);
  if (!payload) {
    log.warn(
      { taskId: task.id },
      "[inquiryReplyExecutor] invalid payload — missing inquiryId/draftBody",
    );
    return { status: "failed", errorMessage: "invalid inquiry_reply payload" };
  }

  try {
    const res = await sendAdminInquiryReply({
      inquiryId: payload.inquiryId,
      body: payload.draftBody,
      // The approving admin's id is on the task; stamp it on the message.
      senderId: task.decidedBy ?? null,
    });

    if (res.emailSent) {
      log.info(
        { taskId: task.id, inquiryId: payload.inquiryId },
        "[inquiryReplyExecutor] reply sent + thread updated",
      );
      return { status: "sent" };
    }

    log.warn(
      { taskId: task.id, inquiryId: payload.inquiryId, err: res.errorMessage },
      "[inquiryReplyExecutor] reply not sent (email best-effort failed)",
    );
    return {
      status: "failed",
      errorMessage: res.errorMessage ?? "email send failed",
    };
  } catch (err) {
    // Defensive: sendAdminInquiryReply swallows the email bounce, but an
    // unexpected db error could still surface here. Never let it throw out.
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { taskId: task.id, inquiryId: payload.inquiryId, err },
      "[inquiryReplyExecutor] unexpected error",
    );
    return { status: "failed", errorMessage: message };
  }
};

let registered = false;

/**
 * Register the cs-lane executor(s) on the spine. Idempotent — safe to call
 * more than once (the commandCenter router calls it at module load). Exposed
 * as a function (rather than a bare top-level side effect) so the import that
 * wires it into the boot graph is explicit + greppable.
 */
export function registerCsExecutors(): void {
  if (registered) return;
  registerApprovalExecutor(INQUIRY_REPLY_TASK_TYPE, inquiryReplyExecutor);
  registered = true;
  log.info(
    { taskType: INQUIRY_REPLY_TASK_TYPE },
    "[inquiryReplyExecutor] cs lane executor registered",
  );
}
