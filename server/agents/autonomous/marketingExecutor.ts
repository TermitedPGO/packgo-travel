/**
 * marketingExecutor — 指揮中心 行銷頁 approval executor (P3).
 *
 * Registers the lane executor for taskType "marketing_draft" on the
 * approval-box spine (server/_core/approvalTasks.ts). When an admin approves
 * a marketing draft in the 審核箱, the commandCenter router looks up THIS
 * executor by the task's taskType and runs it.
 *
 * v1 executor behaviour (Jeff requirement #4: manual publish):
 *   - Logs the approval for audit.
 *   - Returns { status: "sent" } unconditionally.
 *   - Does NOT automatically post to any platform. Jeff copies the approved
 *     content himself and pastes it to XHS / WeChat / email.
 *
 * Future phases may add platform-specific auto-publish (WeChat API, SendGrid
 * EDM, etc.) behind feature flags; this executor is the extension point.
 *
 * ⚠️ MUST NOT THROW for expected failures (ApprovalExecutor contract): parse
 * errors resolve to { status: "failed" } so the router marks the row failed
 * cleanly instead of crashing the approve.
 *
 * REGISTRATION-AT-BOOT: `registerMarketingExecutors()` is imported + called by
 * commandCenter.ts at module load. Because server/routers.ts imports the
 * commandCenter router to build appRouter (loaded at server boot), the
 * registration is guaranteed to have run before any approve can dispatch.
 */

import {
  registerApprovalExecutor,
  type ApprovalExecutor,
  type ApprovalExecutorResult,
} from "../../_core/approvalTasks";
import { createChildLogger } from "../../_core/logger";

const log = createChildLogger({ module: "marketingExecutor" });

/** The taskType this executor is registered under (matches the producer). */
export const MARKETING_DRAFT_TASK_TYPE = "marketing_draft";

/**
 * Minimal payload shape validation — only checks the fields the executor
 * strictly needs to log meaningfully. The full MarketingDraftPayload is
 * defined in the producer; the executor only needs proof it's a real draft.
 */
interface MarketingExecutorPayload {
  contentType: string;
  title: string;
  body: string;
  platform?: string;
}

function parsePayload(raw: string): MarketingExecutorPayload | null {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !obj ||
    typeof obj.contentType !== "string" ||
    typeof obj.title !== "string" ||
    typeof obj.body !== "string" ||
    obj.body.trim().length === 0
  ) {
    return null;
  }
  return obj as MarketingExecutorPayload;
}

/**
 * The executor. Never throws for expected failures — returns a failed result.
 *
 * v1: approve always succeeds (no platform integration yet). The approval
 * itself IS the "send" — Jeff then manually copies the content to the target
 * platform.
 */
export const marketingDraftExecutor: ApprovalExecutor = async (
  task,
): Promise<ApprovalExecutorResult> => {
  const payload = parsePayload(task.payload);
  if (!payload) {
    log.warn(
      { taskId: task.id },
      "[marketingExecutor] invalid payload — missing contentType/title/body",
    );
    return { status: "failed", errorMessage: "invalid marketing_draft payload" };
  }

  try {
    // v1: no auto-publish. Log the approval for audit trail and return sent.
    // Future: platform-specific publish (WeChat API, SendGrid, XHS, etc.)
    log.info(
      {
        taskId: task.id,
        contentType: payload.contentType,
        platform: payload.platform,
        titlePreview: payload.title.slice(0, 50),
      },
      "[marketingExecutor] marketing draft approved — ready for manual publish",
    );

    return { status: "sent" };
  } catch (err) {
    // Defensive: unexpected errors must never throw out of the executor.
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { taskId: task.id, err },
      "[marketingExecutor] unexpected error",
    );
    return { status: "failed", errorMessage: message };
  }
};

let registered = false;

/**
 * Register the marketing-lane executor(s) on the spine. Idempotent — safe to
 * call more than once (the commandCenter router calls it at module load).
 */
export function registerMarketingExecutors(): void {
  if (registered) return;
  registerApprovalExecutor(MARKETING_DRAFT_TASK_TYPE, marketingDraftExecutor);
  registered = true;
  log.info(
    { taskType: MARKETING_DRAFT_TASK_TYPE },
    "[marketingExecutor] marketing lane executor registered",
  );
}
