/**
 * approvalEscalation — 指揮中心 executor-failure escalation.
 *
 * When a lane executor fails (status → "failed"), the failure used to be
 * visible only as a dimmed FYI card. This module raises it into the 今日待辦
 * 「需要你決定」bucket by inserting an agentMessages escalation row — the same
 * surface escalationBox.ts already lists, so zero client wiring is needed.
 *
 * Contract:
 *   - NEVER throws (failure to escalate must not break the approve/retry
 *     flow that triggered it) — every path resolves.
 *   - Dedup-by-unread: while an UNREAD escalation for the same task id
 *     exists, repeated failures (e.g. retry → fail again) do not insert
 *     another row. Once Jeff marks it handled, the next failure escalates
 *     again. The task ref lives in the `context` JSON as
 *     `"ref":"approvalTask:<id>"` — the quoted-string LIKE match cannot
 *     collide with longer ids (123 never matches 1234).
 *
 * Lives outside approvalTasks.ts to keep the spine file from growing past
 * its already-over-budget size; the marker calls in via dynamic import.
 */

import { and, eq, like } from "drizzle-orm";
import { getDb } from "../db";
import { agentMessages, type ApprovalTask } from "../../drizzle/schema";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "approvalEscalation" });

/** The agentName these escalations are filed under. */
export const ESCALATION_AGENT_NAME = "commandCenter";

/**
 * Raise an unread high-priority escalation for a failed approval task.
 * Resolves silently on db-unavailable, duplicate-unread, or insert failure.
 */
export async function escalateFailedApprovalTask(
  task: Pick<ApprovalTask, "id" | "lane" | "title" | "taskType">,
  errorMessage: string,
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      log.warn(
        { taskId: task.id },
        "[approvalEscalation] database not available, skipping escalation",
      );
      return;
    }

    const ref = `approvalTask:${task.id}`;

    // Dedup: an unread escalation for this task is already on the board.
    const existing = await db
      .select({ id: agentMessages.id })
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.messageType, "escalation"),
          eq(agentMessages.agentName, ESCALATION_AGENT_NAME),
          eq(agentMessages.readByJeff, 0),
          like(agentMessages.context, `%"ref":"${ref}"%`),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      log.info(
        { taskId: task.id, existingId: existing[0].id },
        "[approvalEscalation] unread escalation already exists, skipping",
      );
      return;
    }

    await db.insert(agentMessages).values({
      agentName: ESCALATION_AGENT_NAME,
      senderRole: "agent",
      messageType: "escalation",
      priority: "high",
      title: `[${task.lane}] 執行失敗 · ${task.title}`.slice(0, 200),
      body: errorMessage,
      context: JSON.stringify({ ref, lane: task.lane, taskType: task.taskType }),
      readByJeff: 0,
    });
    log.info(
      { taskId: task.id, lane: task.lane },
      "[approvalEscalation] executor failure escalated to 今日待辦",
    );
  } catch (err) {
    // Escalation is best-effort — the failed task row itself is already the
    // durable record; never let notification problems propagate.
    log.warn(
      { err, taskId: task.id },
      "[approvalEscalation] failed to escalate (swallowed)",
    );
  }
}
