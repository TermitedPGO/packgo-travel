/**
 * gmail-intake-ledger v2 (2026-07-13, Codex 12 輪退回兩結構 P0) — the History sync
 * engine. This module is the PURE ENGINE: it depends only on injected ports
 * (Gmail / ledger store / Redis lock / classifier / downstream / alert), so every
 * red-green test drives it with in-memory fakes — ZERO real DB / Redis / Gmail /
 * network (禁真實資料禁真網路). Adapters live in ./gmailIntakeAdapters.ts.
 *
 * The two v2 structural fixes (Codex 12 輪):
 *
 *   P0-1 ledger 先於分類 — the ledger is the唯一事實源, so a message is recorded
 *     at DISCOVERY (minimal row: integrationId/messageId/threadId/historyId/source,
 *     status=pending, fromAddress NULL) BEFORE any eligibility judgment. Nothing is
 *     dropped before it is durably recorded. A downstream CLASSIFICATION stage
 *     (classifyPendingLedger) then hydrates the From header + a rules-only receipt
 *     sniff and assigns a `route` (customer/receipt/noise/self_or_outbound/
 *     manual_review). The receipt classifier runs BEFORE the noise/self terminal,
 *     so a noreply merchant receipt routes to receipt, never silently dropped.
 *     noise/self reach a terminal ignored state WITH the route recorded (稽核), so
 *     the ledger stays a COMPLETE account, not just the kept subset.
 *
 *   P0-2 liveness — discovery has NO cap (the cap only bounds downstream
 *     classification/processing batches). The engine paginates history.list one
 *     page at a time, lands each page durably, THEN CAS-advances the cursor to that
 *     page's boundary historyId (逐頁前綴推進). A crash resumes from the last landed
 *     prefix; the message-level UNIQUE key dedups (at-least-once). A per-round
 *     safety valve bounds pathological bursts with a CONTINUATION info card (not a
 *     freeze) — the cursor already advanced, so the next round continues from the
 *     prefix with no front-page loop and no permanent starvation.
 *
 * Invariants still enforced: fencing (one writer per integration via a Redis lock
 * whose value is a random token, re-verified right before every cursor advance),
 * CAS advance (never clobber a newer cursor), and historyId is NEVER arithmetic'd
 * (404 triggers a bounded -label fallback scan → fresh getProfile baseline; page
 * boundaries are API-returned historyIds).
 */
import {
  classifyIntakeEligibility,
  decideIntakeRoute,
  normalizeFromAddress,
  type IntakeRoute,
} from "../_core/gmailEligibility";

// re-export so existing importers (tests / adapters) keep resolving these here.
export { normalizeFromAddress };
export type { IntakeRoute };

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

/** What kind of event surfaced a discovery (mirrors gmail.ts DiscoveryEventKind —
 *  Codex 15 輪 P0-2 重排閘門). Only "label_added_inbox" (an explicit labelAdded event
 *  carrying INBOX) may requeue a terminal-ignored row; messagesAdded and ALL query
 *  scans (fallback/bootstrap/backfill) are "message_added" and NEVER requeue — a 404
 *  fallback re-scan of the whole inbox must not resurrect every old ignored row. */
export type DiscoveryEventKind = "message_added" | "label_added_inbox";

/** What lands at DISCOVERY — no From / subject / body, only provenance. The
 *  classification stage hydrates fromAddress + route downstream (P0-1). eventKind is
 *  RUNTIME-ONLY routing for the state-aware upsert's requeue gate — deliberately NOT
 *  persisted (discoveryReason already records the audit outcome on the row). */
export interface MinimalLedgerRow {
  integrationId: number;
  gmailMessageId: string;
  gmailThreadId: string;
  gmailHistoryId: string | null;
  source: LedgerSource;
  eventKind: DiscoveryEventKind;
}

export interface LedgerRow {
  id: number;
  integrationId: number;
  gmailMessageId: string;
  gmailThreadId: string;
  gmailHistoryId: string | null;
  internalDateMs: number;
  /** NULL until classification hydrates the From header (P0-1). */
  fromAddress: string | null;
  source: LedgerSource;
  status: LedgerStatus;
  /** NULL until classification runs. */
  route: IntakeRoute | null;
  /** shadow-mode parity record (what history mode WOULD execute); NULL otherwise. */
  wouldRoute: IntakeRoute | null;
  failureKind: FailureKind | null;
  httpStatus: number | null;
  retryCount: number;
  nextRetryAt: Date | null;
  interactionId: number | null;
  // ── v3 state-aware requeue audit (Codex 15 輪 P0-2) ──
  /** Latest inbox-arrival historyId that (re)surfaced this row (gmailHistoryId stays
   *  the first-discovery id). */
  lastSeenHistoryId: string | null;
  /** 'initial' at first discovery, 'inbox_requeue' after an ignored→pending flip. */
  discoveryReason: string | null;
  /** # times a terminal-ignored row was requeued to pending by a newer INBOX event. */
  requeueCount: number;
  /** When the row was last requeued (NULL until the first ignored→pending flip). */
  lastRequeuedAt: Date | null;
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

/** A discovered message id + thread id (mirrors gmail.ts DiscoveredMessage).
 *  eventKind is optional at the PORT boundary and defaults to "message_added" in
 *  toMinimalRows — fail-safe: an adapter that doesn't tag events can never trigger
 *  a requeue by accident (only an explicit label_added_inbox does). */
export interface DiscoveredMessage {
  id: string;
  threadId: string;
  eventKind?: DiscoveryEventKind;
}

/** The raw signals the classification stage needs — hydrated per message. */
export interface ClassificationSignals {
  from: string;
  isReceipt: boolean;
  internalDateMs: number;
}

export interface GmailIntakePort {
  /** ONE history.list page from startHistoryId (pageToken=null for the first).
   *  boundaryHistoryId = the historyId to advance to after this page's ids land
   *  (已落帳前綴). nextPageToken=null when the window is drained. expired=true on
   *  a 404 (cursor too old → fallback). NO discovery cap — the engine paginates. */
  fetchHistoryPage(
    startHistoryId: string,
    pageToken: string | null,
  ): Promise<{
    messages: DiscoveredMessage[];
    boundaryHistoryId: string | null;
    nextPageToken: string | null;
    expired: boolean;
  }>;
  /** ONE messages.list page for the bounded fallback / bootstrap scan (逐批落帳). */
  scanQueryPage(
    query: string,
    pageToken: string | null,
  ): Promise<{ messages: DiscoveredMessage[]; nextPageToken: string | null }>;
  /** The reconcile tripwire's set-difference scan (metas incl. From + date). */
  scanQueryMetadata(
    query: string,
  ): Promise<{ metas: import("../_core/gmail").GmailMessageMetadata[]; truncated: boolean }>;
  getMailboxHistoryId(): Promise<string>;
}

/** Hydrates the From header + rules-only receipt sniff for one landed row. Pure
 *  read (no side effect). null = the message vanished (deleted/moved between
 *  discovery + classification) → the row stays pending, retried next round. */
export interface ClassifierPort {
  hydrateSignals(gmailMessageId: string): Promise<ClassificationSignals | null>;
}

export interface LockPort {
  acquire(key: string, token: string, ttlSeconds: number): Promise<boolean>;
  verify(key: string, token: string): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
}

export interface LedgerStore {
  getIntegration(integrationId: number): Promise<IntegrationCursor | null>;
  /** State-aware upsert of minimal discovery rows (Codex 15 輪 P0-2 —取代單純 INSERT
   *  IGNORE). Per (integrationId, gmailMessageId):
   *    • row absent → INSERT pending (fromAddress/route NULL, internalDateMs 0,
   *      discoveryReason 'initial'); lastSeenHistoryId = the discovery historyId.
   *    • row exists, status='ignored' AND the discovery's eventKind =
   *      'label_added_inbox' → REQUEUE: flip to pending, clear route/wouldRoute
   *      (re-classify from scratch), reset retry track, bump requeueCount + stamp
   *      lastRequeuedAt/discoveryReason='inbox_requeue' (audit — the counter records
   *      the resurrection). eventKind='message_added' NEVER requeues (§四.1): a 404
   *      fallback scan / crash-replay re-seeing old ignored rows must not resurrect
   *      them (重排風暴閘門).
   *    • row exists, status='processed' → ONLY update lastSeenHistoryId; NEVER
   *      re-generate business side effects (any eventKind).
   *    • row exists, status='failed'/'pending' → ONLY update lastSeenHistoryId; the
   *      existing retry/classify track continues untouched (any eventKind).
   *  Idempotent under duplicate labelAdded / crash-replay (a re-hit on a now-pending
   *  row matches no ignored branch). Returns count of input rows. Throws on any
   *  non-duplicate DB error so the caller must NOT advance the cursor (順序鐵律). */
  insertMinimalIgnore(rows: MinimalLedgerRow[]): Promise<number>;
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
  /** Pending rows not yet classified (route IS NULL) whose retry backoff (if any)
   *  has elapsed (nextRetryAt IS NULL OR <= now). Batch-capped by the impl — this
   *  cap bounds downstream CLASSIFICATION, never discovery (P0-2). */
  listUnclassified(integrationId: number, nowMs: number): Promise<LedgerRow[]>;
  /** A NON-terminal classification failure (hydrate/sniff threw): keep status
   *  pending + route NULL, stamp failureKind/httpStatus/errorDetail + retryCount +
   *  nextRetryAt (F skeleton backoff). The row is re-classified after the backoff;
   *  it is NEVER terminal-ized as noise by a sniff error (對抗審查修正 2). */
  recordClassifyFailure(
    ledgerId: number,
    cls: { failureKind: FailureKind; httpStatus: number | null; errorDetail: string | null },
    retryCount: number,
    nextRetryAt: Date,
    at: Date,
  ): Promise<void>;
  /** Persist a classification decision. status='pending' leaves the row for the
   *  feeder (history-mode customer/receipt); status='ignored' is terminal (noise/
   *  self, or a shadow-observed row). Always stamps route + fromAddress + date. */
  classify(
    ledgerId: number,
    fields: {
      fromAddress: string;
      route: IntakeRoute;
      wouldRoute: IntakeRoute | null;
      internalDateMs: number;
      classifiedAt: Date;
      status: "pending" | "ignored";
    },
  ): Promise<void>;
  /** Classified pending customer/receipt rows + retry-due failed rows for the
   *  history-mode feeder. Batch-capped by the impl. */
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
  existingMessageIds(integrationId: number, gmailMessageIds: string[]): Promise<Set<string>>;
  oldestStuck(
    integrationId: number,
    statuses: LedgerStatus[],
    olderThanMs: number,
    nowMs: number,
  ): Promise<{ gmailMessageId: string; failureKind: FailureKind | null; ageMs: number } | null>;
}

/** history mode only — runs the real processOneEmail / processReceiptEmail chain
 *  + post-commit label. */
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
  classifier?: ClassifierPort;
  downstream?: DownstreamPort;
  clock?: () => number;
  /** per-round page safety valve (P0-2). Default SAFETY_VALVE_PAGES; tests lower it. */
  maxPagesPerRound?: number;
}

// ── tunables ─────────────────────────────────────────────────────────────────

const LOCK_TTL_SECONDS = 300; // 5 min — covers a full sync + feed round
const FALLBACK_OVERLAP_MS = 24 * 60 * 60 * 1000; // 24h re-overlap window
const RETRY_BASE_MS = 60_000; // 1 min → exponential
const MAX_RETRIES = 3; // ≥3 → terminal + human card
const DEAD_LETTER_ALERT_WINDOW_S = 60 * 60; // 60 min re-alert cap
const SAFETY_VALVE_PAGES = 200; // P0-2 — bound one round; continuation card, resume next round

function lockKeyFor(integrationId: number): string {
  return `gmail:history-lock:${integrationId}`;
}

function randomToken(): string {
  try {
    return (globalThis.crypto as Crypto).randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

// ── pure helpers (exported for direct unit tests) ────────────────────────────

/** Classify a downstream/API failure into a ledger failureKind + httpStatus. */
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

/** A decimal-string historyId → bigint, or null if it isn't a plain decimal string. */
function tryHistoryBigInt(s: string): bigint | null {
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

/**
 * Forward-only historyId comparison — the ONLY ordering ever applied to a historyId
 * (Codex 15 輪 P0-1 精度加固). Returns true iff `candidate` is STRICTLY greater than
 * `current` (a real forward step); equal or smaller → false (no advance, never a
 * regression). The whole point is precision: Gmail history ids routinely exceed
 * Number.MAX_SAFE_INTEGER (2^53), so they MUST be compared as BigInt — Number()
 * collapses distinct ids ('…992' vs '…993' both round to the same double) and a
 * lexicographic string compare is plain wrong ('100' < '99'). Both traps are unit-
 * tested. Real Gmail ids are always decimal strings → the BigInt path is always taken
 * in prod; the fallback below only exists so unit tests may use symbolic ids ('H2').
 */
export function isHistoryIdNewer(candidate: string, current: string): boolean {
  const a = tryHistoryBigInt(candidate);
  const b = tryHistoryBigInt(current);
  if (a !== null && b !== null) return a > b; // real ids: full-precision BigInt order
  return candidate !== current; // symbolic test ids: degrade to the equality gate
}

/**
 * The ONE inbox-universe scan query — shared by the 404 fallback scan, bootstrap,
 * AND the reconcile tripwire (三宇宙一致, v2 對抗審查修正). Universe = "mail in
 * INBOX", nothing narrower: no `-from:noreply` (ledger-first lands noise too — the
 * classifier terminal-izes it downstream) and no `-label:PACKGO_AI_PROCESSED`
 * (reconcile scans without it, so a fallback that skipped labeled mail would leave
 * rows reconcile flags forever). This matches the history discovery universe
 * (labelId=INBOX + messageAdded/labelAdded in fetchHistoryPage): a message moved
 * into the inbox later is visible to all three paths.
 */
export function buildInboxScanQuery(sinceMs: number): string {
  const sinceSeconds = Math.floor(sinceMs / 1000);
  return `after:${sinceSeconds} in:inbox`;
}

/** Map discovered messages → minimal ledger rows (NO eligibility filter — P0-1).
 *  eventKind defaults to "message_added" (fail-safe: absent tag can never requeue);
 *  fetchHistoryPage tags real labelAdded(INBOX) events, scans never do. */
function toMinimalRows(
  integrationId: number,
  messages: DiscoveredMessage[],
  gmailHistoryId: string | null,
  source: LedgerSource,
): MinimalLedgerRow[] {
  return messages
    .filter((m) => !!m.id)
    .map((m) => ({
      integrationId,
      gmailMessageId: m.id,
      gmailThreadId: m.threadId || "",
      gmailHistoryId,
      source,
      eventKind: m.eventKind ?? "message_added",
    }));
}

// ── the engine ───────────────────────────────────────────────────────────────

export type SyncResult =
  | { ok: true; outcome: "advanced"; landed: number; cursor: string }
  | { ok: true; outcome: "recovered"; landed: number; cursor: string }
  | { ok: true; outcome: "bootstrapped"; landed: number; cursor: string }
  // continuation: the safety valve (or a mid-round pageToken invalidation) bounded
  // this round AFTER a prefix landed + the cursor advanced to it. NOT a freeze —
  // the next round resumes from the advanced prefix (無前頁循環). An info card fires.
  | {
      ok: true;
      outcome: "continued";
      landed: number;
      phase: "history" | "fallback" | "bootstrap";
      cursor: string | null;
    }
  | { ok: true; outcome: "noop"; reason: string; landed?: number }
  | { ok: false; reason: string; failure?: { failureKind: FailureKind; httpStatus: number | null } };

/**
 * Run ONE authoritative sync round for an integration. Acquires the fencing lock,
 * lands each history page's minimal rows durably, and CAS-advances the cursor to
 * every landed page boundary. Sync only ever writes the ledger + cursor;
 * classification (classifyPendingLedger) + downstream feeding (feedPendingDownstream)
 * are separate stages the caller runs after.
 */
export async function syncHistoryForIntegration(
  deps: HistorySyncDeps,
  integrationId: number,
): Promise<SyncResult> {
  const now = () => (deps.clock ? deps.clock() : Date.now());
  const key = lockKeyFor(integrationId);
  const token = randomToken();
  const maxPages = deps.maxPagesPerRound ?? SAFETY_VALVE_PAGES;

  const acquired = await deps.lock.acquire(key, token, LOCK_TTL_SECONDS);
  if (!acquired) return { ok: true, outcome: "noop", reason: "locked-by-concurrent-writer" };

  try {
    const cur = await deps.store.getIntegration(integrationId);
    if (!cur) return { ok: false, reason: "integration-not-found" };

    // ── bootstrap: no baseline yet → getProfile + one fallback scan ──────────
    if (!cur.lastHistoryId) return await bootstrap(deps, cur, key, token, now());

    // ── incremental: paginate history.list, land + advance PER PAGE (P0-2) ───
    const roundStart = cur.lastHistoryId;
    let expectedCursor: string = cur.lastHistoryId;
    let pageToken: string | null = null;
    let pages = 0;
    let landed = 0;

    for (;;) {
      let page: Awaited<ReturnType<GmailIntakePort["fetchHistoryPage"]>>;
      try {
        page = await deps.gmail.fetchHistoryPage(roundStart, pageToken);
      } catch (e) {
        if (pageToken !== null) {
          // continuation invalidated (pageToken expired / transient) AFTER a prefix
          // landed + advanced. End the round; the next round resumes from
          // expectedCursor (無前頁循環, 唯一鍵去重).
          await postContinuationCard(deps, integrationId, "history", landed);
          return { ok: true, outcome: "continued", landed, phase: "history", cursor: expectedCursor };
        }
        // first-page failure (auth/rate/5xx/transient) → cursor stays; queue backs off.
        return { ok: false, reason: "history-list-failed", failure: classifyFailure(e) };
      }

      if (page.expired) return await runFallbackRecovery(deps, cur, key, token, now());

      // land THIS page's minimal rows durably FIRST (順序鐵律 per page). An insert
      // failure returns the SAME {ok:false, failure} shape as a first-page fetch
      // failure (一致錯誤面) — cursor semantics unchanged: this page did NOT land,
      // so the cursor stays at the last landed prefix and the next round re-lists.
      const minimal = toMinimalRows(integrationId, page.messages, page.boundaryHistoryId, "history");
      if (minimal.length > 0) {
        try {
          await deps.store.insertMinimalIgnore(minimal);
        } catch (e) {
          return { ok: false, reason: "ledger-insert-failed", failure: classifyFailure(e) };
        }
        landed += minimal.length;
      }

      // advance the cursor to this page's boundary (已落帳前綴) — forward only. The
      // guard is a BigInt strict-greater (isHistoryIdNewer): a boundary equal to the
      // current cursor is a no-op, and an anomalous boundary that is NOT strictly newer
      // can never drag the cursor backward (精度加固, Codex 15 §三).
      if (page.boundaryHistoryId !== null && isHistoryIdNewer(page.boundaryHistoryId, expectedCursor)) {
        if (!(await deps.lock.verify(key, token))) {
          return { ok: true, outcome: "noop", reason: "lost-fencing-token", landed };
        }
        const advanced = await deps.store.advanceCursorCAS(
          integrationId,
          expectedCursor,
          page.boundaryHistoryId,
          new Date(now()),
        );
        if (!advanced) return { ok: true, outcome: "noop", reason: "cas-lost-to-concurrent", landed };
        expectedCursor = page.boundaryHistoryId;
      }

      pages++;

      if (page.nextPageToken === null) {
        // window drained.
        return expectedCursor !== roundStart
          ? { ok: true, outcome: "advanced", landed, cursor: expectedCursor }
          : { ok: true, outcome: "noop", reason: "no-history-advance", landed };
      }
      if (pages >= maxPages) {
        // safety valve — bound this round; resume from the advanced prefix next round.
        await postContinuationCard(deps, integrationId, "history", landed);
        return { ok: true, outcome: "continued", landed, phase: "history", cursor: expectedCursor };
      }
      pageToken = page.nextPageToken;
    }
  } finally {
    await deps.lock.release(key, token);
  }
}

/** Land every page of a bounded scan (逐批落帳). Returns landed count + whether the
 *  scan fully drained (false = the safety valve bounded it → caller emits a
 *  continuation card and does NOT rebaseline). A per-page insert throw propagates. */
async function runScanPages(
  deps: HistorySyncDeps,
  integrationId: number,
  query: string,
  gmailHistoryId: string | null,
  source: LedgerSource,
): Promise<{ landed: number; drained: boolean }> {
  const maxPages = deps.maxPagesPerRound ?? SAFETY_VALVE_PAGES;
  let pageToken: string | null = null;
  let pages = 0;
  let landed = 0;
  for (;;) {
    const page = await deps.gmail.scanQueryPage(query, pageToken);
    const minimal = toMinimalRows(integrationId, page.messages, gmailHistoryId, source);
    if (minimal.length > 0) {
      await deps.store.insertMinimalIgnore(minimal);
      landed += minimal.length;
    }
    pages++;
    if (page.nextPageToken === null) return { landed, drained: true };
    if (pages >= maxPages) return { landed, drained: false };
    pageToken = page.nextPageToken;
  }
}

/** bootstrap — capture baseline BEFORE scanning (so nothing arriving during the
 *  scan is missed), land the scan per page, then rebaseline to the captured id. */
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
  // scan/insert failures surface as the SAME {ok:false, failure} shape as a
  // first-page history fetch failure (一致錯誤面); un-bootstrapped cursor stays null.
  let scan: { landed: number; drained: boolean };
  try {
    scan = await runScanPages(deps, cur.id, buildInboxScanQuery(sinceMs), baseline, "fallback_scan");
  } catch (e) {
    return { ok: false, reason: "ledger-insert-failed", failure: classifyFailure(e) };
  }

  // valve hit → do NOT set a baseline cursor (it would hide the未掃 tail behind a
  // live historyId). Land the subset, continuation card, stay un-bootstrapped; the
  // next round bootstraps again from a still-null cursor.
  if (!scan.drained) {
    await postContinuationCard(deps, cur.id, "bootstrap", scan.landed);
    return { ok: true, outcome: "continued", landed: scan.landed, phase: "bootstrap", cursor: null };
  }

  if (!(await deps.lock.verify(key, token))) {
    return { ok: true, outcome: "noop", reason: "lost-fencing-token" };
  }
  await deps.store.rebaselineCursor(cur.id, baseline, new Date(nowMs));
  return { ok: true, outcome: "bootstrapped", landed: scan.landed, cursor: baseline };
}

/** 404 recovery — scan the −24h overlap window per page, land ALL, THEN getProfile
 *  for a fresh baseline. Never jumps the cursor forward without scanning the gap. */
async function runFallbackRecovery(
  deps: HistorySyncDeps,
  cur: IntegrationCursor,
  key: string,
  token: string,
  nowMs: number,
): Promise<SyncResult> {
  const sinceMs = (cur.lastSuccessfulSyncAt?.getTime() ?? nowMs) - FALLBACK_OVERLAP_MS;
  // scan/insert failures surface as the SAME {ok:false, failure} shape (一致錯誤面);
  // the cursor stays expired so the next round re-runs fallback.
  let scan: { landed: number; drained: boolean };
  try {
    scan = await runScanPages(deps, cur.id, buildInboxScanQuery(sinceMs), null, "fallback_scan");
  } catch (e) {
    return { ok: false, reason: "ledger-insert-failed", failure: classifyFailure(e) };
  }

  // valve hit → the gap is NOT fully covered. Land the subset but do NOT rebaseline:
  // the cursor stays expired so the next round re-runs fallback (query idempotent,
  // 唯一鍵去重). Continuation card fires.
  if (!scan.drained) {
    await postContinuationCard(deps, cur.id, "fallback", scan.landed);
    return {
      ok: true,
      outcome: "continued",
      landed: scan.landed,
      phase: "fallback",
      cursor: cur.lastHistoryId,
    };
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
  return { ok: true, outcome: "recovered", landed: scan.landed, cursor: baseline };
}

// ── classification stage (P0-1) — downstream of landing ───────────────────────

export interface ClassifyResult {
  /** history-mode customer/receipt rows left pending for the feeder. */
  deferredToFeeder: number;
  /** noise/self terminal, or shadow-observed customer/receipt (terminal ignored). */
  ignoredTerminal: number;
  /** message vanished (hydrate returned null) — stays pending, retried next round. */
  skipped: number;
  /** hydrate/sniff THREW — retry scheduled via the F skeleton (still unclassified). */
  retryScheduled: number;
  /** classification retries exhausted → terminal failed + manual-review card. */
  deadLettered: number;
}

/**
 * The classification stage. For each landed-but-unclassified pending row: hydrate
 * the From header + a rules-only receipt sniff, decide the route (receipt BEFORE
 * noise/self terminal, §五), and persist it. Runs in BOTH shadow and history mode:
 *   - noise / self_or_outbound → terminal ignored (route recorded for audit).
 *   - shadow mode customer/receipt → terminal ignored + wouldRoute recorded (legacy
 *     parity observation; NO side effect — legacy stays the only副作用 writer).
 *   - history mode customer/receipt → left pending (classified) for the feeder.
 */
export async function classifyPendingLedger(
  deps: HistorySyncDeps,
  integrationId: number,
): Promise<ClassifyResult> {
  if (!deps.classifier) throw new Error("classifyPendingLedger requires a ClassifierPort");
  const now = () => (deps.clock ? deps.clock() : Date.now());
  const cur = await deps.store.getIntegration(integrationId);
  if (!cur) throw new Error("integration-not-found");
  const shadow = cur.intakeMode === "shadow";
  const res: ClassifyResult = {
    deferredToFeeder: 0,
    ignoredTerminal: 0,
    skipped: 0,
    retryScheduled: 0,
    deadLettered: 0,
  };

  const rows = await deps.store.listUnclassified(integrationId, now());
  for (const row of rows) {
    // 對抗審查修正 2 — a hydrate/sniff THROW must never terminal-ize a potential
    // receipt as noise. It goes NON-terminal through the F skeleton: retryCount +
    // backoff, re-classified after nextRetryAt; retries exhausted → terminal failed
    // (classified failureKind) + a manual-review card. Only a SUCCESSFUL hydrate
    // may decide a route.
    let sig: ClassificationSignals | null;
    try {
      sig = await deps.classifier.hydrateSignals(row.gmailMessageId);
    } catch (e) {
      const cls = classifyFailure(e);
      const retryCount = row.retryCount + 1;
      const nextRetryAt = computeNextRetryAt(retryCount, now());
      const errorDetail = errorSummary(e);
      if (nextRetryAt === null) {
        await deps.store.markFailed(
          row.id,
          { failureKind: cls.failureKind, httpStatus: cls.httpStatus, errorDetail },
          retryCount,
          null,
          new Date(now()),
        );
        res.deadLettered++;
        await postClassifyManualReviewCard(deps, integrationId, row, cls);
      } else {
        await deps.store.recordClassifyFailure(
          row.id,
          { failureKind: cls.failureKind, httpStatus: cls.httpStatus, errorDetail },
          retryCount,
          nextRetryAt,
          new Date(now()),
        );
        res.retryScheduled++;
      }
      continue;
    }
    if (!sig) {
      // vanished/transient — leave pending, retried next round (reconcile rule 2
      // eventually flags a persistently stuck row for a human).
      res.skipped++;
      continue;
    }
    const { route, fromAddress } = decideIntakeRoute(sig.from, sig.isReceipt);
    const classifiedAt = new Date(now());
    const actionable = route === "customer" || route === "receipt";

    if (!actionable) {
      await deps.store.classify(row.id, {
        fromAddress,
        route,
        wouldRoute: null,
        internalDateMs: sig.internalDateMs,
        classifiedAt,
        status: "ignored",
      });
      res.ignoredTerminal++;
    } else if (shadow) {
      await deps.store.classify(row.id, {
        fromAddress,
        route,
        wouldRoute: route, // parity record: what history mode WOULD do
        internalDateMs: sig.internalDateMs,
        classifiedAt,
        status: "ignored",
      });
      res.ignoredTerminal++;
    } else {
      await deps.store.classify(row.id, {
        fromAddress,
        route,
        wouldRoute: null,
        internalDateMs: sig.internalDateMs,
        classifiedAt,
        status: "pending", // history mode — the feeder processes it
      });
      res.deferredToFeeder++;
    }
  }
  return res;
}

// ── history mode — feed classified ledger rows through the real chain ─────────

export interface FeedResult {
  processed: number;
  ignored: number;
  failed: number;
  deadLettered: number;
}

/**
 * Drain the ledger's classified actionable rows (pending customer/receipt + retry-
 * due failed) through the injected downstream chain. Records the terminal status
 * back on the ledger. The Gmail label is a POST-COMMIT side effect inside
 * DownstreamPort.process (label failure never rewinds the ledger). retryCount ≥ 3
 * → terminal failed + human card.
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
    // eligibility drift re-check (attack surface 8) applies ONLY to customer rows —
    // a receipt legitimately comes from a noreply sender, so it must NOT be dropped.
    if (row.route === "customer") {
      const verdict = classifyIntakeEligibility(row.fromAddress ?? "");
      if (!verdict.eligible) {
        await deps.store.markIgnored(row.id, "noise", new Date(now()));
        res.ignored++;
        continue;
      }
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

/** Truncated, PII-safe error string for the ledger (no body/attachment leak). */
export function errorSummary(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const firstLine = raw.split("\n", 1)[0];
  const redacted = firstLine.replace(/\S+@\S+/g, "[redacted-email]");
  return redacted.slice(0, 512);
}

/** Continuation info card (P0-2 — replaces the old truncation-freeze card). The
 *  cursor already advanced to the landed prefix, so this is INFORMATIONAL (normal
 *  priority), not a P1 freeze: the next round resumes from the prefix. Deduped per
 *  (integration, phase) for 60 min. Card carries only ids/counts — never PII. */
async function postContinuationCard(
  deps: HistorySyncDeps,
  integrationId: number,
  phase: "history" | "fallback" | "bootstrap",
  landed: number,
): Promise<void> {
  const fingerprint = `gmail-intake-continuation:${integrationId}:${phase}`;
  if (await deps.alerts.alreadyAlerted(fingerprint, DEAD_LETTER_ALERT_WINDOW_S)) return;
  const phaseZh =
    phase === "history"
      ? "增量 history 分頁"
      : phase === "fallback"
        ? "404 回復掃描"
        : "首啟 bootstrap 掃描";
  await deps.alerts.postCard({
    agentName: "gmail-intake",
    priority: "normal",
    title: `客戶信攝取續跑中(游標已推進至已落帳前綴)`.slice(0, 200),
    body:
      `${phaseZh}單輪達安全閥(頁數上限),已落已收前綴 ${landed} 筆並將游標推進到該前綴,` +
      `剩餘積壓下輪從前綴續收(無前頁循環,唯一鍵去重)。若持續多輪未收斂代表積壓極大,需人工關注。\n` +
      `integrationId:${integrationId}\n` +
      `階段:${phase}\n` +
      `分類:continuation\n` +
      `(卡片只含 id/計數,不含寄件人或內容)`,
  });
}

/** Classification dead-letter (對抗審查修正 2) — the hydrate/sniff kept throwing
 *  until retries exhausted, so the route was NEVER decided (a potential receipt
 *  must not be guessed as noise). Terminal failed + one manual-review human card
 *  per (integration+msgId). Card carries only ids/kind — never sender content. */
async function postClassifyManualReviewCard(
  deps: HistorySyncDeps,
  integrationId: number,
  row: LedgerRow,
  cls: { failureKind: FailureKind; httpStatus: number | null },
): Promise<void> {
  const fingerprint = `gmail-intake-classify-manual:${integrationId}:${row.gmailMessageId}`;
  if (await deps.alerts.alreadyAlerted(fingerprint, DEAD_LETTER_ALERT_WINDOW_S)) return;
  await deps.alerts.postCard({
    agentName: "gmail-intake",
    priority: "high",
    title: `客戶信分類重試耗盡,需人工判讀(manual_review)`.slice(0, 200),
    body:
      `一封已入帳的信在分類階段(補抓 headers / 收據判定)連續失敗 ${MAX_RETRIES} 次,` +
      `已標記終態 failed 且未指派 route(可能是收據,不可猜成 noise),需人工判讀。\n` +
      `integrationId:${integrationId}\n` +
      `gmail messageId:${row.gmailMessageId}\n` +
      `失敗分類:${cls.failureKind}` +
      (cls.httpStatus != null ? ` (http ${cls.httpStatus})` : "") +
      `\n(卡片只含 id/分類,不含信件內容)`,
  });
}

/** F skeleton dead-letter — one human card per (integration+failureKind+msgId)
 *  fingerprint. Card carries only ids/kind/httpStatus — never sender content. */
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
