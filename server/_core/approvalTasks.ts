/**
 * approvalTasks — 指揮中心 (Command Center) 審核箱脊椎 S-2 helper.
 *
 * Single producer/decider entry point for the approval inbox. Every
 * operational lane (cs / quote / marketing / finance) funnels work that
 * needs Jeff's sign-off through `createApprovalTask`, and the 指揮中心 UI
 * approves/rejects through `decideApprovalTask`. Both write an audit row.
 *
 * Design boundary (docs/features/command-center/design.md §2 S-2):
 *   - `createApprovalTask` writes ONE pending row and returns its id.
 *   - `decideApprovalTask` ONLY flips status (+ optional payload edit) and
 *     audits. It NEVER sends/executes — the router layer (S-3) looks up the
 *     lane executor and runs it after a successful approve. Keeping the send
 *     out of here lets the spine stay pure and testable without dragging in
 *     lane material (emailService / inquiries / Stripe / …).
 *
 * Executor registry: lanes register a `taskType → executor` mapping at module
 * load (P1-P4). v1 registers none; the router treats "no executor" as a no-op
 * approve (status stays "approved", nothing is sent). When an executor runs,
 * the router calls `markApprovalTaskSent` / `markApprovalTaskFailed`.
 *
 * riskLevel policy (proposal §3 鐵律):
 *   auto      → may be batch-approved in one click
 *   review    → per-item review before send
 *   hard_gate → money / irreversible / customer-visible — ALWAYS per-item,
 *               NEVER bulk-approved (enforced at the router layer).
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "../db";
import { approvalTasks, type ApprovalTask } from "../../drizzle/schema";

/** Re-export the row type so the router/lanes import it from this domain module. */
export type { ApprovalTask };
import { audit } from "./auditLog";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "approvalTasks" });

// ── Domain types ────────────────────────────────────────────────────────────

/** Operational lane that produced the task (executor namespace). */
export type ApprovalLane = "cs" | "quote" | "marketing" | "finance";

/** Approval risk tier — drives bulk eligibility (see policy above). */
export type RiskLevel = "auto" | "review" | "hard_gate";

/** Lifecycle of an approval task. */
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "sent"
  | "failed"
  | "expired";

/**
 * Minimal audit context. We re-declare it locally because auditLog.ts does
 * not export its AuditCtx; this shape is structurally compatible (the tRPC
 * ctx satisfies it). `ctx` is optional everywhere — when omitted (system
 * producers, tests) the audit row is simply skipped, never thrown.
 */
export type ApprovalAuditCtx = {
  user?: { id: number; email: string; role: string } | null;
  req?: { ip?: string; headers?: Record<string, any> };
};

export interface CreateApprovalTaskInput {
  lane: ApprovalLane;
  /** Fine-grained executor route within the lane, e.g. "cs.reply_inquiry". */
  taskType: string;
  riskLevel: RiskLevel;
  title: string;
  summary?: string;
  /** Lane-specific JSON string; the executor parses it on approve. */
  payload: string;
  relatedType?: string;
  relatedId?: string;
  /** Producer identity — agent name or "system"/"admin:<id>". */
  createdBy: string;
}

export interface DecideApprovalTaskInput {
  id: number;
  decision: "approve" | "reject";
  /** users.id of the admin pressing the button (NULL for system flows). */
  decidedBy?: number;
  /** Reject reason / approve note — recorded in the audit row. */
  reason?: string;
  /**
   * On approve, optionally replace the stored payload (admin edited the draft
   * before sending). Ignored on reject.
   */
  editedPayload?: string;
}

/** What an executor reports back so the router can mark the task. */
export interface ApprovalExecutorResult {
  status: "sent" | "failed";
  errorMessage?: string;
}

/**
 * Lane executor contract. The router calls this AFTER a successful approve.
 * Receives the freshly-approved task (payload already reflects any edit) and
 * the acting admin's ctx. Must not throw for expected failures — return
 * `{ status: "failed", errorMessage }` instead so the row is marked cleanly.
 */
export type ApprovalExecutor = (
  task: ApprovalTask,
  ctx?: ApprovalAuditCtx,
) => Promise<ApprovalExecutorResult>;

// ── Executor registry ─────────────────────────────────────────────────────

const executors = new Map<string, ApprovalExecutor>();

/** Register a lane executor for a given taskType (called at lane module load). */
export function registerApprovalExecutor(
  taskType: string,
  executor: ApprovalExecutor,
): void {
  if (executors.has(taskType)) {
    log.warn({ taskType }, "[approvalTasks] executor re-registered (overwriting)");
  }
  executors.set(taskType, executor);
}

/** Look up the executor for a taskType, or undefined if none registered. */
export function getApprovalExecutor(taskType: string): ApprovalExecutor | undefined {
  return executors.get(taskType);
}

/** Test-only: drop all registered executors so each test starts clean. */
export function _clearApprovalExecutors_forTests(): void {
  executors.clear();
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** Fetch a single approval task by id, or undefined if not found. */
export async function getApprovalTaskById(
  id: number,
): Promise<ApprovalTask | undefined> {
  const db = await getDb();
  if (!db) {
    log.warn({ id }, "[approvalTasks] getApprovalTaskById: database not available");
    return undefined;
  }
  const rows = await db
    .select()
    .from(approvalTasks)
    .where(eq(approvalTasks.id, id))
    .limit(1);
  return rows.length > 0 ? rows[0] : undefined;
}

export interface ListApprovalTasksFilter {
  lane?: ApprovalLane;
  status?: ApprovalStatus;
  limit?: number;
  offset?: number;
}

/**
 * Inbox list — optionally filtered by lane and/or status, newest first.
 * Hits the idx_approvalTasks_lane_status / idx_approvalTasks_status indexes.
 */
export async function listApprovalTasks(
  filter: ListApprovalTasksFilter = {},
): Promise<ApprovalTask[]> {
  const db = await getDb();
  if (!db) {
    log.warn("[approvalTasks] listApprovalTasks: database not available");
    return [];
  }
  const conditions = [];
  if (filter.lane) conditions.push(eq(approvalTasks.lane, filter.lane));
  if (filter.status) conditions.push(eq(approvalTasks.status, filter.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(approvalTasks)
    .where(where)
    .orderBy(desc(approvalTasks.createdAt))
    .limit(filter.limit ?? 100)
    .offset(filter.offset ?? 0);
}

export interface ApprovalStats {
  /** Pending count per lane (every lane present, zero-filled). */
  pendingByLane: Record<ApprovalLane, number>;
  /** Total pending across all lanes. */
  totalPending: number;
}

/**
 * Stats strip data — per-lane pending counts for the 狀態 block. One grouped
 * query over the idx_approvalTasks_lane_status index.
 */
export async function getApprovalStats(): Promise<ApprovalStats> {
  const pendingByLane: Record<ApprovalLane, number> = {
    cs: 0,
    quote: 0,
    marketing: 0,
    finance: 0,
  };
  const db = await getDb();
  if (!db) {
    log.warn("[approvalTasks] getApprovalStats: database not available");
    return { pendingByLane, totalPending: 0 };
  }

  const rows = await db
    .select({ lane: approvalTasks.lane, n: sql<number>`count(*)` })
    .from(approvalTasks)
    .where(eq(approvalTasks.status, "pending"))
    .groupBy(approvalTasks.lane);

  let totalPending = 0;
  for (const r of rows) {
    const n = Number(r.n);
    pendingByLane[r.lane as ApprovalLane] = n;
    totalPending += n;
  }
  return { pendingByLane, totalPending };
}

// ── Producer entry point ─────────────────────────────────────────────────

/**
 * Write one pending approval task. The single funnel every lane producer
 * uses. Returns the new row id. Audits action "approvalTask.create".
 */
export async function createApprovalTask(
  input: CreateApprovalTaskInput,
  ctx?: ApprovalAuditCtx,
): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(approvalTasks).values({
    lane: input.lane,
    taskType: input.taskType,
    riskLevel: input.riskLevel,
    status: "pending",
    title: input.title,
    summary: input.summary,
    payload: input.payload,
    relatedType: input.relatedType,
    relatedId: input.relatedId,
    createdBy: input.createdBy,
  });
  const id = Number((result as any)[0].insertId);

  // Fire-and-forget audit — never blocks the producer, never throws.
  if (ctx?.user) {
    audit({
      ctx,
      action: "approvalTask.create",
      targetType: "approvalTask",
      targetId: id,
      changes: {
        lane: input.lane,
        taskType: input.taskType,
        riskLevel: input.riskLevel,
        title: input.title,
      },
    });
  }

  log.info(
    { id, lane: input.lane, taskType: input.taskType, riskLevel: input.riskLevel },
    "[approvalTasks] created pending task",
  );
  return { id };
}

// ── Decision entry point ─────────────────────────────────────────────────

/**
 * Approve or reject a pending task. ONLY mutates status (+ optional payload
 * edit on approve) and writes the decision metadata. Does NOT send/execute —
 * the router runs the lane executor after this resolves on approve.
 *
 * Guards: the task must exist and be "pending"; otherwise throws so the
 * router surfaces a clear error (double-approve / race).
 *
 * Audits action "approvalTask.approve" or "approvalTask.reject".
 */
export async function decideApprovalTask(
  input: DecideApprovalTaskInput,
  ctx?: ApprovalAuditCtx,
): Promise<ApprovalTask> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const existing = await getApprovalTaskById(input.id);
  if (!existing) {
    throw new Error(`Approval task ${input.id} not found`);
  }
  if (existing.status !== "pending") {
    throw new Error(
      `Approval task ${input.id} is already ${existing.status}, cannot ${input.decision}`,
    );
  }

  const nextStatus: ApprovalStatus =
    input.decision === "approve" ? "approved" : "rejected";

  const updates: Partial<typeof approvalTasks.$inferInsert> = {
    status: nextStatus,
    decidedBy: input.decidedBy,
    decidedAt: new Date(),
  };
  // Admin edited the draft before approving — persist it so the executor
  // sends the edited version.
  if (input.decision === "approve" && input.editedPayload !== undefined) {
    updates.payload = input.editedPayload;
  }

  await db.update(approvalTasks).set(updates).where(eq(approvalTasks.id, input.id));

  if (ctx?.user) {
    audit({
      ctx,
      action: input.decision === "approve" ? "approvalTask.approve" : "approvalTask.reject",
      targetType: "approvalTask",
      targetId: input.id,
      changes: {
        from: existing.status,
        to: nextStatus,
        payloadEdited:
          input.decision === "approve" && input.editedPayload !== undefined,
      },
      reason: input.reason,
    });
  }

  const updated = await getApprovalTaskById(input.id);
  if (!updated) {
    throw new Error(`Failed to retrieve decided approval task ${input.id}`);
  }
  log.info(
    { id: input.id, decision: input.decision, decidedBy: input.decidedBy },
    "[approvalTasks] task decided",
  );
  return updated;
}

// ── Executor result markers (called by the router after running) ───────────

/** Mark an approved task as successfully sent by its executor. */
export async function markApprovalTaskSent(id: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }
  await db
    .update(approvalTasks)
    .set({ status: "sent", errorMessage: null })
    .where(eq(approvalTasks.id, id));
  log.info({ id }, "[approvalTasks] task marked sent");
}

/** Mark an approved task as failed (executor error). Stores the message. */
export async function markApprovalTaskFailed(
  id: number,
  errorMessage: string,
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }
  await db
    .update(approvalTasks)
    .set({ status: "failed", errorMessage: errorMessage.slice(0, 2000) })
    .where(eq(approvalTasks.id, id));
  log.warn({ id, errorMessage }, "[approvalTasks] task marked failed");
}
