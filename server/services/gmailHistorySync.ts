/**
 * gmail-intake-ledger (2026-07-13) — the History sync engine (Codex 11 §2, the
 * authoritative incremental path). This module is the PURE ENGINE: it depends
 * only on injected ports (Gmail / ledger store / Redis lock / downstream / alert)
 * plus the leaf eligibility predicate, so every red-green test drives it with
 * in-memory fakes — ZERO real DB / Redis / Gmail / network (禁真實資料禁真網路).
 * The drizzle / ioredis / gmail-client adapters live in ./gmailIntakeAdapters.ts.
 *
 * Invariants enforced here (the whole point of the ledger):
 *   順序鐵律 — collect ALL history pages → eligibility → durably INSERT IGNORE
 *     every candidate into the ledger → only THEN CAS-advance the cursor. If any
 *     candidate fails to land (throw) the cursor does not move; a crash re-diffs
 *     the same window and the message-level UNIQUE key dedups (at-least-once).
 *   fencing — one writer per integration via a Redis lock whose value is a random
 *     token; the token is re-verified right before advancing the cursor, and the
 *     cursor advance is a CAS (WHERE lastHistoryId = the value we read) so a
 *     second writer can never overwrite a newer cursor.
 *   historyId is NEVER arithmetic'd — 404 (cursor too old) triggers a bounded
 *     -label fallback scan, then a fresh baseline from getProfile.
 */
import { isEligibleForIntake, classifyIntakeEligibility } from "../_core/gmailEligibility";
import { parseEmailAddress } from "../_core/knownNoise";
import type { GmailMessageMetadata } from "../_core/gmail";

// ── domain types ─────────────────────────────────────────────────────────────

export type LedgerSource = "history" | "push_wake" | "fallback_scan" | "backfill";
export type LedgerStatus = "pending" | "processed" | "ignored" | "failed";
export type FailureKind =
  | "llm"
  | "db"
  | "gmail_api"
  | "attachment"
  | "auth"
  | "noise"
  | "unknown";

/** What we durably land — no subject/body/attachment, only provenance. */
export interface LedgerCandidate {
  integrationId: number;
  gmailMessageId: string;
  gmailThreadId: string;
  gmailHistoryId: string | null;
  internalDateMs: number;
  fromAddress: string;
  source: LedgerSource;
}

export interface LedgerRow extends LedgerCandidate {
  id: number;
  status: LedgerStatus;
  failureKind: FailureKind | null;
  httpStatus: number | null;
  retryCount: number;
  nextRetryAt: Date | null;
  interactionId: number | null;
}

export interface IntegrationCursor {
  id: number;
  emailAddress: string;
  intakeMode: "legacy" | "shadow" | "history";
  lastHistoryId: string | null;
  lastSuccessfulSyncAt: Date | null;
  watchExpiration: number | null;
}

// ── injected ports ───────────────────────────────────────────────────────────

export interface GmailIntakePort {
  /** history.list from startHistoryId, walking ALL pages. expired=true on 404.
   *  truncated=true when the burst cap stopped collection before the window was
   *  drained (pages left / ids dropped) — the caller must freeze the cursor. */
  collectHistoryAdded(
    startHistoryId: string,
  ): Promise<{
    messageIds: string[];
    latestHistoryId: string | null;
    expired: boolean;
    truncated: boolean;
  }>;
  fetchMetadata(ids: string[]): Promise<GmailMessageMetadata[]>;
  /** paginated `-label:... -from:noreply after:...` metadata scan. truncated=true
   *  when the cap stopped the scan before every page was walked — the caller must
   *  NOT rebaseline (the gap is not fully covered). */
  scanQueryMetadata(query: string): Promise<{ metas: GmailMessageMetadata[]; truncated: boolean }>;
  getMailboxHistoryId(): Promise<string>;
}

export interface LockPort {
  acquire(key: string, token: string, ttlSeconds: number): Promise<boolean>;
  verify(key: string, token: string): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
}

export interface LedgerStore {
  getIntegration(integrationId: number): Promise<IntegrationCursor | null>;
  /** INSERT IGNORE each candidate; returns count of rows newly inserted. Throws
   *  on any non-duplicate DB error so the caller must NOT advance the cursor. */
  insertIgnore(rows: LedgerCandidate[]): Promise<number>;
  /** CAS: UPDATE ... SET lastHistoryId=new WHERE id=? AND lastHistoryId<=>expected.
   *  Returns true when exactly this writer advanced it, false on a concurrent race. */
  advanceCursorCAS(
    integrationId: number,
    expectedHistoryId: string | null,
    newHistoryId: string,
    syncedAt: Date,
  ): Promise<boolean>;
  /** Recovery/bootstrap rebaseline (unconditional set under the fencing lock). */
  rebaselineCursor(integrationId: number, newHistoryId: string, syncedAt: Date): Promise<void>;
  /** pending + retry-due failed rows for the downstream feeder (history mode). */
  listActionable(integrationId: number, nowMs: number): Promise<LedgerRow[]>;
  markProcessed(ledgerId: number, interactionId: number | null, at: Date): Promise<void>;
  markIgnored(ledgerId: number, failureKind: FailureKind, at: Date): Promise<void>;
  markFailed(
    ledgerId: number,
    cls: { failureKind: FailureKind; httpStatus: number | null; errorDetail: string | null },
    retryCount: number,
    nextRetryAt: Date | null,
    at: Date,
  ): Promise<void>;
  // ── reconciliation (D §4) set-difference queries ──
  /** Of the given message ids, which already have a ledger row (any status). */
  existingMessageIds(integrationId: number, gmailMessageIds: string[]): Promise<Set<string>>;
  /** The oldest ledger row in `statuses` whose firstSeenAt is older than the
   *  cutoff — powers rule 2 (pending/failed stuck) + the incident fingerprint. */
  oldestStuck(
    integrationId: number,
    statuses: LedgerStatus[],
    olderThanMs: number,
    nowMs: number,
  ): Promise<{ gmailMessageId: string; failureKind: FailureKind | null; ageMs: number } | null>;
}

/** history mode only — runs the real processOneEmail chain + post-commit label. */
export interface DownstreamPort {
  process(row: LedgerRow): Promise<{ interactionId: number | null }>;
}

export interface AlertPort {
  postCard(card: {
    agentName: string;
    title: string;
    body: string;
    priority: "low" | "normal" | "high" | "critical";
  }): Promise<void>;
  /** fingerprint dedup — returns true if this fingerprint was already alerted
   *  within the window (caller SKIPS), false when it records + should alert. */
  alreadyAlerted(fingerprint: string, windowSeconds: number): Promise<boolean>;
}

export interface HistorySyncDeps {
  gmail: GmailIntakePort;
  store: LedgerStore;
  lock: LockPort;
  alerts: AlertPort;
  downstream?: DownstreamPort;
  clock?: () => number;
}

// ── tunables ─────────────────────────────────────────────────────────────────

const LOCK_TTL_SECONDS = 300; // 5 min — covers a full sync + feed round
const FALLBACK_OVERLAP_MS = 24 * 60 * 60 * 1000; // 24h re-overlap window
const RETRY_BASE_MS = 60_000; // 1 min → exponential
const MAX_RETRIES = 3; // ≥3 → terminal + human card
const DEAD_LETTER_ALERT_WINDOW_S = 60 * 60; // 60 min re-alert cap

function lockKeyFor(integrationId: number): string {
  return `gmail:history-lock:${integrationId}`;
}

function randomToken(): string {
  // crypto.randomUUID exists in node18+; fallback keeps this dep-free + testable.
  try {
    return (globalThis.crypto as Crypto).randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

// ── pure helpers (exported for direct unit tests) ────────────────────────────

/**
 * Classify a downstream/API failure into a ledger failureKind + httpStatus.
 * Order: HTTP status first (auth vs rate/5xx), then message keywords. This is
 * the F skeleton's classifier — a best-effort bucket, never a hard contract.
 */
export function classifyFailure(err: unknown): {
  failureKind: FailureKind;
  httpStatus: number | null;
} {
  const e = err as
    | { code?: unknown; status?: unknown; response?: { status?: unknown }; message?: unknown }
    | null
    | undefined;
  const rawStatus =
    (typeof e?.status === "number" && e.status) ||
    (typeof e?.code === "number" && e.code) ||
    (typeof e?.response?.status === "number" && e.response.status) ||
    null;
  const httpStatus = typeof rawStatus === "number" ? rawStatus : null;
  const msg = (typeof e?.message === "string" ? e.message : String(err ?? "")).toLowerCase();
  const codeStr = typeof e?.code === "string" ? e.code : "";

  if (httpStatus === 401 || httpStatus === 403) return { failureKind: "auth", httpStatus };
  if (/invalid_grant|unauthorized|token has been (expired|revoked)|revoked/.test(msg)) {
    return { failureKind: "auth", httpStatus };
  }
  if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500)) {
    return { failureKind: "gmail_api", httpStatus };
  }
  if (/rate.?limit|quota|gmail|googleapis/.test(msg)) return { failureKind: "gmail_api", httpStatus };
  if (codeStr.startsWith("ER_") || /econnrefused|deadlock|database|sql|drizzle/.test(msg)) {
    return { failureKind: "db", httpStatus };
  }
  if (/attachment/.test(msg)) return { failureKind: "attachment", httpStatus };
  if (/llm|anthropic|openai|claude|model|token limit|context length/.test(msg)) {
    return { failureKind: "llm", httpStatus };
  }
  return { failureKind: "unknown", httpStatus };
}

/** Exponential backoff for the next retry, or null when retries are exhausted. */
export function computeNextRetryAt(retryCount: number, nowMs: number): Date | null {
  if (retryCount >= MAX_RETRIES) return null; // terminal
  return new Date(nowMs + RETRY_BASE_MS * Math.pow(2, retryCount));
}

/** The bounded fallback query (24h overlap, exclude processed + noreply). */
export function buildFallbackQuery(sinceMs: number): string {
  const sinceSeconds = Math.floor(sinceMs / 1000);
  return `after:${sinceSeconds} -label:PACKGO_AI_PROCESSED -from:noreply`;
}

/** Normalize a raw `From` header to the bare lowercase address the ledger stores
 *  (schema: fromAddress is the eligibility key, display name dropped). Falls back
 *  to the trimmed-lowercased raw when unparseable so nothing eligible lands blank;
 *  always bounded to the column width. Downstream eligibility re-checks parse the
 *  address again, so a bare address is a valid input to classifyIntakeEligibility. */
export function normalizeFromAddress(raw: string): string {
  const bare = parseEmailAddress(raw) ?? raw.trim().toLowerCase();
  return bare.slice(0, 320);
}

/** Map hydrated metadata → eligible ledger candidates (drops own/noise/noreply). */
function toEligibleCandidates(
  integrationId: number,
  metas: GmailMessageMetadata[],
  gmailHistoryId: string | null,
  source: LedgerSource,
): LedgerCandidate[] {
  const out: LedgerCandidate[] = [];
  for (const m of metas) {
    if (!m.id || !isEligibleForIntake(m.from)) continue;
    out.push({
      integrationId,
      gmailMessageId: m.id,
      gmailThreadId: m.threadId || "",
      gmailHistoryId,
      internalDateMs: m.internalDateMs || 0,
      fromAddress: normalizeFromAddress(m.from || ""),
      source,
    });
  }
  return out;
}

// ── the engine ───────────────────────────────────────────────────────────────

export type SyncResult =
  | { ok: true; outcome: "advanced"; landed: number; cursor: string }
  | { ok: true; outcome: "recovered"; landed: number; cursor: string }
  | { ok: true; outcome: "bootstrapped"; landed: number; cursor: string }
  // truncated: a subset landed durably but the collection was NOT exhausted, so
  // the cursor is deliberately FROZEN (no advance / no rebaseline) and a P1 card
  // fires. phase names which path hit the cap. Next round re-collects the window.
  | { ok: true; outcome: "truncated"; landed: number; phase: "history" | "fallback" | "bootstrap" }
  | { ok: true; outcome: "noop"; reason: string }
  | { ok: false; reason: string; failure?: { failureKind: FailureKind; httpStatus: number | null } };

/**
 * Run ONE authoritative sync round for an integration (shadow or history mode).
 * Acquires the fencing lock, lands ledger rows, CAS-advances the cursor. In
 * history mode the caller then invokes feedPendingDownstream — sync only ever
 * writes the ledger + cursor (shadow does not feed downstream or label).
 */
export async function syncHistoryForIntegration(
  deps: HistorySyncDeps,
  integrationId: number,
): Promise<SyncResult> {
  const now = () => (deps.clock ? deps.clock() : Date.now());
  const key = lockKeyFor(integrationId);
  const token = randomToken();

  const acquired = await deps.lock.acquire(key, token, LOCK_TTL_SECONDS);
  if (!acquired) return { ok: true, outcome: "noop", reason: "locked-by-concurrent-writer" };

  try {
    const cur = await deps.store.getIntegration(integrationId);
    if (!cur) return { ok: false, reason: "integration-not-found" };

    // ── bootstrap: no baseline yet → getProfile + one fallback scan ──────────
    if (!cur.lastHistoryId) {
      return await bootstrap(deps, cur, key, token, now());
    }

    // ── incremental: collect ALL history pages first (順序鐵律) ───────────────
    let diff: Awaited<ReturnType<GmailIntakePort["collectHistoryAdded"]>>;
    try {
      diff = await deps.gmail.collectHistoryAdded(cur.lastHistoryId);
    } catch (e) {
      // history.list itself failed (auth/rate/5xx/transient). Cursor stays; the
      // caller's queue applies backoff. Classify so the channel alert is useful.
      return { ok: false, reason: "history-list-failed", failure: classifyFailure(e) };
    }

    if (diff.expired) {
      return await runFallbackRecovery(deps, cur, key, token, now());
    }

    // no forward historyId to advance to → nothing to do, cursor untouched.
    if (!diff.latestHistoryId) {
      return { ok: true, outcome: "noop", reason: "no-history-id-returned" };
    }

    const metas = await deps.gmail.fetchMetadata(diff.messageIds);
    const candidates = toEligibleCandidates(
      integrationId,
      metas,
      diff.latestHistoryId,
      "history",
    );

    // durable land FIRST — throws propagate → cursor NOT advanced.
    await deps.store.insertIgnore(candidates);

    // 順序鐵律 break: history.list did not exhaust the window (cap hit). Land what
    // we collected (能救多少救多少) but FREEZE the cursor — advancing would skip the
    // uncollected tail. P1 card fires; next round re-collects from the same point.
    if (diff.truncated) {
      await postTruncationCard(deps, integrationId, "history", candidates.length);
      return { ok: true, outcome: "truncated", landed: candidates.length, phase: "history" };
    }

    // fencing: token must still be ours before we touch the cursor.
    if (!(await deps.lock.verify(key, token))) {
      return { ok: true, outcome: "noop", reason: "lost-fencing-token" };
    }

    // CAS advance — a concurrent writer that already moved the cursor wins.
    const advanced = await deps.store.advanceCursorCAS(
      integrationId,
      cur.lastHistoryId,
      diff.latestHistoryId,
      new Date(now()),
    );
    if (!advanced) return { ok: true, outcome: "noop", reason: "cas-lost-to-concurrent" };

    return { ok: true, outcome: "advanced", landed: candidates.length, cursor: diff.latestHistoryId };
  } finally {
    await deps.lock.release(key, token);
  }
}

/** bootstrap — capture baseline BEFORE scanning (so nothing arriving during the
 *  scan is missed), land the scan, then set the cursor to the captured id. */
async function bootstrap(
  deps: HistorySyncDeps,
  cur: IntegrationCursor,
  key: string,
  token: string,
  nowMs: number,
): Promise<SyncResult> {
  let baseline: string;
  try {
    baseline = await deps.gmail.getMailboxHistoryId();
  } catch (e) {
    return { ok: false, reason: "bootstrap-getprofile-failed", failure: classifyFailure(e) };
  }
  const sinceMs = (cur.lastSuccessfulSyncAt?.getTime() ?? nowMs) - FALLBACK_OVERLAP_MS;
  const scan = await deps.gmail.scanQueryMetadata(buildFallbackQuery(sinceMs));
  const candidates = toEligibleCandidates(cur.id, scan.metas, baseline, "fallback_scan");
  await deps.store.insertIgnore(candidates);

  // truncated first scan → do NOT set a baseline cursor (it would hide the未掃 tail
  // behind a live historyId). Land the subset, alert, stay un-bootstrapped; the next
  // round bootstraps again from a still-null cursor.
  if (scan.truncated) {
    await postTruncationCard(deps, cur.id, "bootstrap", candidates.length);
    return { ok: true, outcome: "truncated", landed: candidates.length, phase: "bootstrap" };
  }

  if (!(await deps.lock.verify(key, token))) {
    return { ok: true, outcome: "noop", reason: "lost-fencing-token" };
  }
  await deps.store.rebaselineCursor(cur.id, baseline, new Date(nowMs));
  return { ok: true, outcome: "bootstrapped", landed: candidates.length, cursor: baseline };
}

/** 404 recovery — scan the −24h overlap window, land ALL, THEN getProfile for a
 *  fresh baseline. Never jumps the cursor forward without scanning the gap. */
async function runFallbackRecovery(
  deps: HistorySyncDeps,
  cur: IntegrationCursor,
  key: string,
  token: string,
  nowMs: number,
): Promise<SyncResult> {
  const sinceMs = (cur.lastSuccessfulSyncAt?.getTime() ?? nowMs) - FALLBACK_OVERLAP_MS;
  const scan = await deps.gmail.scanQueryMetadata(buildFallbackQuery(sinceMs));
  const candidates = toEligibleCandidates(cur.id, scan.metas, null, "fallback_scan");
  // land the whole gap FIRST — a throw here means no rebaseline (cursor stays
  // expired, next round re-recovers). Only after all land do we take a baseline.
  await deps.store.insertIgnore(candidates);

  // truncated recovery scan → the gap is NOT fully covered. Land the subset but do
  // NOT rebaseline: the cursor stays expired so the next round re-runs fallback
  // (游標維持 expired 態). P1 card fires.
  if (scan.truncated) {
    await postTruncationCard(deps, cur.id, "fallback", candidates.length);
    return { ok: true, outcome: "truncated", landed: candidates.length, phase: "fallback" };
  }

  let baseline: string;
  try {
    baseline = await deps.gmail.getMailboxHistoryId();
  } catch (e) {
    return { ok: false, reason: "recovery-getprofile-failed", failure: classifyFailure(e) };
  }
  if (!(await deps.lock.verify(key, token))) {
    return { ok: true, outcome: "noop", reason: "lost-fencing-token" };
  }
  await deps.store.rebaselineCursor(cur.id, baseline, new Date(nowMs));
  return { ok: true, outcome: "recovered", landed: candidates.length, cursor: baseline };
}

// ── history mode — feed ledger pending through the real processing chain ──────

export interface FeedResult {
  processed: number;
  ignored: number;
  failed: number;
  deadLettered: number;
}

/**
 * Drain the ledger's actionable rows (pending + retry-due failed) through the
 * injected downstream chain. Records the terminal status back on the ledger.
 * The Gmail label is a POST-COMMIT side effect inside DownstreamPort.process
 * (label failure never rewinds the ledger — the row is already processed). A
 * retry NEVER rewinds the cursor. retryCount ≥ 3 → terminal failed + human card.
 */
export async function feedPendingDownstream(
  deps: HistorySyncDeps,
  integrationId: number,
): Promise<FeedResult> {
  if (!deps.downstream) throw new Error("feedPendingDownstream requires a DownstreamPort");
  const now = () => (deps.clock ? deps.clock() : Date.now());
  const res: FeedResult = { processed: 0, ignored: 0, failed: 0, deadLettered: 0 };

  const rows = await deps.store.listActionable(integrationId, now());
  for (const row of rows) {
    // eligibility drift re-check (attack surface 8): a row that became noise
    // (filter moved it, sender re-classified) is closed as ignored, not fed.
    const verdict = classifyIntakeEligibility(row.fromAddress);
    if (!verdict.eligible) {
      await deps.store.markIgnored(row.id, "noise", new Date(now()));
      res.ignored++;
      continue;
    }
    try {
      const { interactionId } = await deps.downstream.process(row);
      await deps.store.markProcessed(row.id, interactionId, new Date(now()));
      res.processed++;
    } catch (e) {
      const cls = classifyFailure(e);
      const retryCount = row.retryCount + 1;
      const nextRetryAt = computeNextRetryAt(retryCount, now());
      const errorDetail = errorSummary(e);
      await deps.store.markFailed(
        row.id,
        { failureKind: cls.failureKind, httpStatus: cls.httpStatus, errorDetail },
        retryCount,
        nextRetryAt,
        new Date(now()),
      );
      res.failed++;
      if (nextRetryAt === null) {
        res.deadLettered++;
        await postDeadLetterCard(deps, integrationId, row, cls);
      }
    }
  }
  return res;
}

/** Truncated, PII-safe error string for the ledger (no body/attachment leak).
 *  Downstream error messages can carry echoed email content, so before storing:
 *  keep only the FIRST line (drops stacks / appended payloads after a newline),
 *  redact any email-like token, then bound to the column width. */
export function errorSummary(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const firstLine = raw.split("\n", 1)[0];
  const redacted = firstLine.replace(/\S+@\S+/g, "[redacted-email]");
  return redacted.slice(0, 512);
}

/** Truncation P1 — the collection hit its cap without draining the window, so the
 *  cursor was frozen (未耗盡立即告警, requirement A). Deduped through the SAME
 *  AlertPort fingerprint pattern as the dead-letter card (failureKind=truncation),
 *  one card per (integration, phase) until the 60-min window lapses. The visible
 *  auto-close rides on the reconcile channel-stale recovery (Rule 3) once the
 *  cursor advances again. Card carries only ids/counts — never sender/body. */
async function postTruncationCard(
  deps: HistorySyncDeps,
  integrationId: number,
  phase: "history" | "fallback" | "bootstrap",
  landed: number,
): Promise<void> {
  const fingerprint = `gmail-intake-truncation:${integrationId}:${phase}`;
  if (await deps.alerts.alreadyAlerted(fingerprint, DEAD_LETTER_ALERT_WINDOW_S)) return;
  const phaseZh =
    phase === "history"
      ? "增量 history 掃描"
      : phase === "fallback"
        ? "404 回復掃描"
        : "首啟 bootstrap 掃描";
  await deps.alerts.postCard({
    agentName: "gmail-intake",
    priority: "high",
    title: `客戶信攝取截斷(游標已凍結)`.slice(0, 200),
    body:
      `${phaseZh}達到單輪上限仍未收完,已落已收子集 ${landed} 筆但刻意凍結游標(不前進/不重設基準),` +
      `以免跳過未收的尾段。下輪將從同一游標續收;若持續截斷代表積壓超過單輪容量,需人工介入。\n` +
      `integrationId:${integrationId}\n` +
      `階段:${phase}\n` +
      `失敗分類:truncation\n` +
      `(卡片只含 id/計數,不含寄件人或內容)`,
  });
}

/** F skeleton dead-letter — one human card per (integration+failureKind+msgId)
 *  fingerprint, deduped through the AlertPort (mirrors the watchdog pattern).
 *  Card carries only ids/kind/httpStatus — never sender content or body. */
async function postDeadLetterCard(
  deps: HistorySyncDeps,
  integrationId: number,
  row: LedgerRow,
  cls: { failureKind: FailureKind; httpStatus: number | null },
): Promise<void> {
  const fingerprint = `gmail-intake-deadletter:${integrationId}:${cls.failureKind}:${row.gmailMessageId}`;
  if (await deps.alerts.alreadyAlerted(fingerprint, DEAD_LETTER_ALERT_WINDOW_S)) return;
  await deps.alerts.postCard({
    agentName: "gmail-intake",
    priority: "high",
    title: `客戶信攝取重試耗盡(${cls.failureKind})`.slice(0, 200),
    body:
      `一封客戶信在下游處理連續失敗 ${MAX_RETRIES} 次,已標記終態 failed,需人工處理。\n` +
      `integrationId:${integrationId}\n` +
      `gmail messageId:${row.gmailMessageId}\n` +
      `失敗分類:${cls.failureKind}` +
      (cls.httpStatus != null ? ` (http ${cls.httpStatus})` : "") +
      `\n(卡片只含 id/分類,不含信件內容)`,
  });
}
