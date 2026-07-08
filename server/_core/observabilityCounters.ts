/**
 * observabilityCounters — Wave1 Block C「D1 週稽核觀測計數器」.
 *
 * WHY: weeklyCorrectnessAudit.ts only posts a card when it finds a card-worthy
 * signal (mismatching/degraded customers). That means a perfectly quiet week
 * leaves Jeff with NO weekly touchpoint into overall system health — Gmail
 * ingestion failures, BullMQ queue backlogs, and LLM circuit trips can all
 * accumulate silently until something else surfaces them. This module adds
 * three independent, best-effort "how's the system doing" collectors whose
 * output is folded into the weekly correctness-audit card as a fixed
 * three-line "觀測計數器" section — so an unusual week is visually loud
 * (⚠ prefixes) and a normal week is still visible (explicit zeros), every
 * single Monday, not just the weeks something else was already wrong.
 *
 * Design contract for all three gather* functions: NEVER throw. Each wraps
 * its own IO in try/catch and degrades to a distinguishable "couldn't read"
 * result instead — a Redis blip or a queue-module import hiccup must never
 * take down the weekly correctness audit that hosts this section.
 *
 * LLM usage: ZERO. Pure Redis/DB reads + string formatting, same as the
 * audit this feeds into.
 */
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "observabilityCounters" });

const DAY_MS = 24 * 60 * 60 * 1000;

/** Same lazy-getDb-derived Db type as weeklyCorrectnessAudit.ts's own `Db`
 *  alias — duplicated (not imported from that file) to avoid a circular
 *  import between the two modules; both resolve to the identical underlying
 *  type structurally, so callers can pass one where the other is expected. */
export type Db = NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>;

// ── 1. messagesFailed weekly delta ──────────────────────────────────────────

/** Redis key holding the last-seen SUM of gmailIntegration.messagesFailed
 *  across all integration rows, so the next run can compute a week-over-week
 *  delta. Named/shaped after WEEKLY_AUDIT_HEARTBEAT_KEY's fire-forget style
 *  (weeklyCorrectnessAudit.ts). */
export const WEEKLY_AUDIT_MESSAGES_FAILED_SNAPSHOT_KEY = "weeklyAuditMessagesFailedSnapshot";

/**
 * `{kind:"first-run"}` — no prior snapshot in Redis (first time this ever
 * ran, or the key expired/was flushed); there is nothing to diff against yet,
 * NOT a delta of 0 (0 would be a real, meaningful reading — conflating the
 * two would hide a genuine "no failures this week" signal behind "we don't
 * actually know yet").
 * `{kind:"delta", value}` — currentTotal - previousSnapshot.
 * `{kind:"error"}` — DB read or Redis read/write failed; distinct from both
 * of the above so callers never mistake "couldn't check" for "checked, fine".
 */
export type MessagesFailedWeeklyDelta =
  | { kind: "first-run" }
  | { kind: "delta"; value: number }
  | { kind: "error" };

/**
 * Sums gmailIntegration.messagesFailed across every integration row (a
 * multi-account Gmail setup has one row per connected mailbox — the delta is
 * over the fleet total, not any single account), diffs against the last
 * snapshot, and always rewrites the snapshot to the current total — even on
 * a first-run (nothing to diff yet) or when the delta can't usefully be
 * reported, next week's run still needs *some* baseline to diff against.
 * Never throws.
 */
export async function gatherMessagesFailedWeeklyDelta(db: Db, now: Date): Promise<MessagesFailedWeeklyDelta> {
  void now; // reserved for parity with the other two collectors' signatures; no time-window logic needed here
  try {
    const { gmailIntegration } = await import("../../drizzle/schema");
    const rows = (await db
      .select({ messagesFailed: gmailIntegration.messagesFailed })
      .from(gmailIntegration)) as Array<{ messagesFailed: number }>;
    const currentTotal = rows.reduce((sum, r) => sum + (r.messagesFailed ?? 0), 0);

    const { redis } = await import("../redis");
    const prevRaw = await redis.get(WEEKLY_AUDIT_MESSAGES_FAILED_SNAPSHOT_KEY);
    // Always write the fresh snapshot — regardless of whether prevRaw gave us
    // anything usable — so next week's run has today's total as its baseline.
    await redis.set(WEEKLY_AUDIT_MESSAGES_FAILED_SNAPSHOT_KEY, String(currentTotal));

    if (prevRaw === null) {
      return { kind: "first-run" };
    }
    const prevTotal = parseInt(prevRaw, 10);
    if (Number.isNaN(prevTotal)) {
      // Corrupt/unexpected snapshot content — no usable baseline, same
      // treatment as a genuine first run rather than a nonsensical delta.
      return { kind: "first-run" };
    }
    return { kind: "delta", value: currentTotal - prevTotal };
  } catch (err) {
    log.warn(
      { err: (err as Error).message },
      "[observabilityCounters] gatherMessagesFailedWeeklyDelta failed",
    );
    return { kind: "error" };
  }
}

// ── 2. per-queue failed counts ──────────────────────────────────────────────

export interface QueueFailedCount {
  queueName: string;
  /** null = this specific queue's getFailedCount() call itself failed
   *  ("?" in the digest), NOT the same as a genuine 0. */
  failed: number | null;
}

interface QueueLike {
  name: string;
  getFailedCount: () => Promise<number>;
}

function isQueueLike(value: unknown): value is QueueLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { getFailedCount?: unknown }).getFailedCount === "function"
  );
}

/** Every module that exports a `new Queue(...)` instance — server/queue.ts
 *  (the ~24-queue monolith) plus the standalone files under server/queues/.
 *  Dynamic imports (not static top-level) so a module-load failure in any
 *  one file is independently catchable and can never break importing THIS
 *  module (weeklyCorrectnessAudit.ts imports this file at its own top
 *  level — a top-level import of all of queue.ts's transitive deps here
 *  would defeat that isolation). Importing these files is safe: Worker
 *  instances (BLPOP loops) are only constructed inside explicit
 *  initXWorker() functions, never at module scope — merely importing a
 *  queue-definition file does not start a live worker. */
const QUEUE_MODULE_IMPORTERS: Array<() => Promise<Record<string, unknown>>> = [
  () => import("../queue"),
  () => import("../queues/abandonmentRecoveryQueue"),
  () => import("../queues/packpointMaintenanceQueue"),
  () => import("../queues/posterProcessingQueue"),
  () => import("../queues/priorityRewriteCron"),
  () => import("../queues/quoteFollowUpQueue"),
  () => import("../queues/supplierSyncQueue"),
];

/**
 * Calls .getFailedCount() on every exported BullMQ Queue instance across the
 * repo's queue-definition modules. queueName is the actual BullMQ queue name
 * (Queue#name — the string passed to `new Queue(...)`), never the source
 * variable name, so it's meaningful outside the codebase too. Each queue's
 * call is independently try/catch'd (one queue's Redis hiccup never blanks
 * out the rest), and loading a queue-definition module itself is likewise
 * independently try/catch'd. Never throws.
 */
export async function gatherQueueFailedCounts(): Promise<QueueFailedCount[]> {
  const queues: QueueLike[] = [];
  for (const importer of QUEUE_MODULE_IMPORTERS) {
    try {
      const mod = await importer();
      for (const val of Object.values(mod)) {
        if (isQueueLike(val)) queues.push(val);
      }
    } catch (err) {
      log.warn(
        { err: (err as Error).message },
        "[observabilityCounters] failed to load a queue-definition module — skipping its queues",
      );
    }
  }

  const results: QueueFailedCount[] = [];
  for (const q of queues) {
    try {
      const failed = await q.getFailedCount();
      results.push({ queueName: q.name, failed });
    } catch (err) {
      log.warn(
        { queueName: q.name, err: (err as Error).message },
        "[observabilityCounters] getFailedCount() failed for one queue",
      );
      results.push({ queueName: q.name, failed: null });
    }
  }
  return results;
}

// ── 3. LLM circuit stats (near 7 days) ──────────────────────────────────────

/**
 * `{kind:"ok", ...}` — sums across up to 7 daily `llm:stats:YYYY-MM-DD` Redis
 * hashes (server/_core/llm.ts's bumpStat). A missing day-key is normal (no
 * LLM calls that day, or history not yet 7 days deep) and contributes 0, not
 * an error.
 * `{kind:"error"}` — Redis itself was unreachable/failed.
 */
export type LlmCircuitStats =
  | { kind: "ok"; circuitOpened: number; rateLimit429: number; callsTotal: number }
  | { kind: "error" };

/** UTC calendar-day string, matching llm.ts's bumpStat key derivation
 *  (`new Date().toISOString().slice(0, 10)`) EXACTLY — bumpStat does NOT use
 *  todayLA()/any timezone conversion, so reading back with any other
 *  timezone logic would systematically miss/misattribute days. */
function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Reads and sums circuit_opened / rate_limit_429 / calls_total across the
 * past 7 UTC calendar days (today + the 6 before it) of `llm:stats:*` hashes
 * written by server/_core/llm.ts's bumpStat. Never throws.
 */
export async function gatherLlmCircuitStats(now: Date): Promise<LlmCircuitStats> {
  try {
    const { redis } = await import("../redis");
    const days = Array.from({ length: 7 }, (_, i) => utcDateString(new Date(now.getTime() - i * DAY_MS)));
    const perDay = await Promise.all(
      days.map((day) => redis.hmget(`llm:stats:${day}`, "circuit_opened", "rate_limit_429", "calls_total")),
    );

    let circuitOpened = 0;
    let rateLimit429 = 0;
    let callsTotal = 0;
    for (const [co, rl, ct] of perDay) {
      circuitOpened += parseInt(co ?? "0", 10) || 0;
      rateLimit429 += parseInt(rl ?? "0", 10) || 0;
      callsTotal += parseInt(ct ?? "0", 10) || 0;
    }
    return { kind: "ok", circuitOpened, rateLimit429, callsTotal };
  } catch (err) {
    log.warn({ err: (err as Error).message }, "[observabilityCounters] gatherLlmCircuitStats failed");
    return { kind: "error" };
  }
}

// ── formatting (pure) ───────────────────────────────────────────────────────

function formatMessagesFailedLine(delta: MessagesFailedWeeklyDelta): string {
  if (delta.kind === "first-run") {
    return "messagesFailed 週增量:首次基線,下週起有增量";
  }
  if (delta.kind === "error") {
    return "messagesFailed 週增量:無法讀取(Redis 快照或 gmailIntegration 查詢失敗)";
  }
  const prefix = delta.value > 0 ? "⚠ " : "";
  return `${prefix}messagesFailed 週增量:${delta.value}`;
}

function formatQueueFailedLine(counts: QueueFailedCount[]): string {
  const nonZero = counts.filter((c) => c.failed !== null && c.failed > 0);
  const unknown = counts.filter((c) => c.failed === null);
  if (nonZero.length === 0 && unknown.length === 0) {
    return "各 queue failed 數:全部 queue failed=0";
  }
  // Non-zero AND unreadable ("?") queues are both worth a look, so they're
  // listed together in one ⚠ line rather than split into two lines — a
  // queue we couldn't even check is at least as worth attention as one with
  // a known nonzero count.
  const parts = [...nonZero.map((c) => `${c.queueName}=${c.failed}`), ...unknown.map((c) => `${c.queueName}=?`)];
  return `⚠ 各 queue failed 數:${parts.join(", ")}`;
}

function formatLlmCircuitLine(stats: LlmCircuitStats): string {
  if (stats.kind === "error") {
    return "LLM circuit 統計(近 7 天):無法讀取(Redis 查詢失敗)";
  }
  const prefix = stats.circuitOpened > 0 || stats.rateLimit429 > 0 ? "⚠ " : "";
  return `${prefix}LLM circuit 統計(近 7 天):circuit_opened=${stats.circuitOpened}, rate_limit_429=${stats.rateLimit429}, calls_total=${stats.callsTotal}`;
}

/**
 * Pure: three lines, ALWAYS all three (0/健康 states are shown explicitly,
 * never omitted) — a card that skipped the line entirely when everything's
 * fine would defeat the "trend visible every Monday" goal. Non-zero /
 * unreadable states get a "⚠ " prefix so an unusual week is visually loud
 * against five weeks of plain, unprefixed "all clear" lines.
 */
export function formatObservabilitySection(input: {
  messagesFailedDelta: MessagesFailedWeeklyDelta;
  queueFailedCounts: QueueFailedCount[];
  llmCircuitStats: LlmCircuitStats;
}): string {
  const line1 = formatMessagesFailedLine(input.messagesFailedDelta);
  const line2 = formatQueueFailedLine(input.queueFailedCounts);
  const line3 = formatLlmCircuitLine(input.llmCircuitStats);
  return `觀測計數器\n${line1}\n${line2}\n${line3}`;
}
