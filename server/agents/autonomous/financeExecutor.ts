/**
 * financeExecutor — 指揮中心 財務頁 approval executor (P4).
 *
 * Registers the lane executor for taskType "finance_alert" on the approval-box
 * spine. When Jeff acknowledges a finance alert in the 審核箱, the router calls
 * this executor. It does exactly ONE thing: log + return { status: "sent" }.
 *
 * 鐵律: finance lane NEVER moves money, NEVER executes transactions, NEVER
 * initiates transfers. The executor is an ACKNOWLEDGE-ONLY marker. "sent" here
 * means "Jeff has seen and acknowledged this alert", not "money was moved".
 *
 * Never-throw contract (same as P1 cs executor): expected failures resolve to
 * { status: "failed" } so the router marks the row cleanly.
 */

import {
  registerApprovalExecutor,
  type ApprovalExecutor,
  type ApprovalExecutorResult,
} from "../../_core/approvalTasks";
import { createChildLogger } from "../../_core/logger";

const log = createChildLogger({ module: "financeExecutor" });

/** The taskType this executor is registered under (matches the producer). */
export const FINANCE_ALERT_TASK_TYPE = "finance_alert";

/**
 * The executor. Acknowledge-only: log the acknowledgement and return sent.
 * Never throws for expected failures.
 */
export const financeAlertExecutor: ApprovalExecutor = async (
  task,
): Promise<ApprovalExecutorResult> => {
  try {
    log.info(
      { taskId: task.id, lane: task.lane, taskType: task.taskType },
      "[financeExecutor] finance alert acknowledged",
    );
    return { status: "sent" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { taskId: task.id, err },
      "[financeExecutor] unexpected error",
    );
    return { status: "failed", errorMessage: message };
  }
};

let registered = false;

/**
 * Register the finance-lane executor on the spine. Idempotent. Called by the
 * commandCenter router at module load (same pattern as registerCsExecutors).
 */
export function registerFinanceExecutors(): void {
  if (registered) return;
  registerApprovalExecutor(FINANCE_ALERT_TASK_TYPE, financeAlertExecutor);
  registered = true;
  log.info(
    { taskType: FINANCE_ALERT_TASK_TYPE },
    "[financeExecutor] finance lane executor registered",
  );
}
