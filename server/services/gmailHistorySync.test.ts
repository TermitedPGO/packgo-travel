/**
 * gmail-intake-ledger v2 — red/green tests for the ledger-first History engine +
 * classification stage + downstream feeder + F skeleton (Codex 12 輪兩結構 P0).
 * Everything runs against in-memory fakes — ZERO real DB / Redis / Gmail / network
 * (禁真實資料禁真網路). No fixed waits: every effect is awaited directly.
 *
 * Covers:
 *   P0-1 ledger 先於分類 — noise/noreply/own mail LANDS then reaches a terminal
 *     audit state (route recorded, never dropped before recording); crash before
 *     classification restarts with zero loss; the receipt route (§五 five cases).
 *   P0-2 liveness — per-page prefix advance, safety-valve continuation (not freeze),
 *     backlog > 3×cap multi-round convergence, page-2 crash resume with no front-page
 *     loop, continuation (pageToken) invalidation resume-from-prefix.
 *   Plus: fencing / CAS, 404 fallback, bootstrap, feeder terminal states + backoff +
 *     dead-letter, and the pure classifiers.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// authoritative fail-closed gate (Codex 17 輪 §五.1). 實機閘 isGmailAuthoritativeApproved
// 硬回 false;這批既有 feed-path 測試把閘 mock 為可切,預設 true 以繼續守護那段 feed 碼
// (留待未來核准批復用)。下方另有 gate=false 的 fail-closed 測試;實機閘 === false 的斷言
// 在未 mock 的 gmailAuthoritativeGate.test.ts。
const authoritativeApproved = vi.fn(() => true);
vi.mock("./gmailAuthoritativeGate", () => ({
  isGmailAuthoritativeApproved: () => authoritativeApproved(),
}));

import {
  syncHistoryForIntegration,
  classifyPendingLedger,
  feedPendingDownstream,
  runIntakeStages,
  syncGrantsDownstream,
  classifyFailure,
  computeNextRetryAt,
  isHistoryIdNewer,
  buildInboxScanQuery,
  normalizeFromAddress,
  errorSummary,
  type GmailIntakePort,
  type ClassifierPort,
  type ClassificationSignals,
  type DiscoveredMessage,
  type LockPort,
  type LedgerStore,
  type AlertPort,
  type DownstreamPort,
  type HistorySyncDeps,
  type IntegrationCursor,
  type MinimalLedgerRow,
  type CancellableSleep,
  type LedgerRow,
  type LedgerStatus,
  type FailureKind,
  type IntakeRoute,
} from "./gmailHistorySync";

// ── in-memory fakes ──────────────────────────────────────────────────────────

type FakeRow = LedgerRow & { firstSeenMs: number };

/** A row is claimable when unleased, or its lease already lapsed (mirror of the
 *  adapter's `claimToken IS NULL OR claimExpiresAt <= now`). */
function leaseFree(r: FakeRow, nowMs: number): boolean {
  return r.claimToken == null || (r.claimExpiresAt != null && r.claimExpiresAt.getTime() <= nowMs);
}
/** Release the lease as part of a terminal/retry write (mirror of CLAIM_CLEAR). */
function clearClaim(r: FakeRow): void {
  r.claimToken = null;
  r.claimExpiresAt = null;
  r.claimStage = null;
}

/** The NUMERIC MAX of the non-NULL watermarks (Codex 18 §四/§七) — mirror of the real
 *  GREATEST-COALESCE WHERE. Returns null when ALL are null (fail-closed: no requeue). The
 *  old FakeStore used `lastRequeueEventId ?? lastSeenHistoryId` (COALESCE-first-non-null),
 *  which copied the production bug — a strictly-greater lastSeen was ignored. */
function maxWatermark(...ids: (string | null | undefined)[]): string | null {
  let max: string | null = null;
  for (const id of ids) {
    if (id == null) continue;
    if (max == null || isHistoryIdNewer(id, max)) max = id;
  }
  return max;
}

class FakeStore implements LedgerStore {
  integrations = new Map<number, IntegrationCursor>();
  rows: FakeRow[] = [];
  /** cap for listUnclassified / listActionable — bounds DOWNSTREAM batches only
   *  (never discovery). Small in liveness tests to exercise multi-round drain. */
  batchCap = 1000;
  private nextId = 1;
  constructor(
    integrations: IntegrationCursor[],
    private clock: () => number,
  ) {
    for (const i of integrations) this.integrations.set(i.id, { ...i });
  }
  async getIntegration(id: number) {
    const c = this.integrations.get(id);
    return c ? { ...c } : null;
  }
  async insertMinimalIgnore(rows: MinimalLedgerRow[]) {
    // Mirrors the real two-statement state-aware upsert (Codex 15 輪 P0-2 + 16 輪事件級
    // 冪等 + 17 輪 §四 事件消耗水位). ⚠ ORDER matches the real reorder: the REQUEUE runs
    // FIRST (reading the consumed watermark BEFORE this event — no self-shadow), then the
    // INSERT / forward-only lastSeen bump.
    let inserted = 0;
    for (const r of rows) {
      const dup = this.rows.find(
        (x) => x.integrationId === r.integrationId && x.gmailMessageId === r.gmailMessageId,
      );
      // statement 1 (FIRST): requeue ONLY a terminal-ignored row, ONLY for a discovery
      // carrying a labelAdded(INBOX) event id (labelEventId non-null; message_added / scan
      // carry null → never here), ONLY when that id is STRICTLY GREATER than the CONSUMED
      // watermark = NUMERIC MAX of the non-NULL values among (lastRequeueEventId,
      // lastSeenHistoryId, scanConsumedFloor) — the highest event id consumed BEFORE this
      // one (Codex 18 §四/§七 三值 MAX; the old `?? ` COALESCE copied the production bug).
      // ALL-NULL watermark → no requeue (fail-closed). Records consumption + advances
      // lastSeen monotonically atomically. scanConsumedFloor is never touched by a requeue.
      if (dup && dup.status === "ignored" && r.eventKind === "label_added_inbox" && r.labelEventId != null) {
        const watermark = maxWatermark(dup.lastRequeueEventId, dup.lastSeenHistoryId, dup.scanConsumedFloor);
        if (watermark != null && isHistoryIdNewer(r.labelEventId, watermark)) {
          dup.status = "pending";
          dup.route = null;
          dup.wouldRoute = null;
          dup.fromAddress = null;
          dup.internalDateMs = 0;
          dup.failureKind = null;
          dup.httpStatus = null;
          dup.retryCount = 0;
          dup.nextRetryAt = null;
          dup.interactionId = null;
          dup.discoveryReason = "inbox_requeue";
          dup.requeueCount += 1;
          dup.lastRequeuedAt = new Date(this.clock());
          dup.lastRequeueEventId = r.labelEventId;
          if (
            r.maxSeenEventId != null &&
            (dup.lastSeenHistoryId == null || isHistoryIdNewer(r.maxSeenEventId, dup.lastSeenHistoryId))
          ) {
            dup.lastSeenHistoryId = r.maxSeenEventId;
          }
          dup.claimToken = null;
          dup.claimExpiresAt = null;
          dup.claimStage = null;
        }
      }
      // statement 2 (SECOND): INSERT a new row, or forward-only lastSeen on any existing
      // row. A first-by-label discovery seeds lastRequeueEventId = labelEventId (§四.2);
      // message_added / scan → null.
      if (!dup) {
        this.rows.push({
          id: this.nextId++,
          integrationId: r.integrationId,
          gmailMessageId: r.gmailMessageId,
          gmailThreadId: r.gmailThreadId,
          gmailHistoryId: r.maxSeenEventId,
          internalDateMs: 0,
          fromAddress: null,
          source: r.source,
          status: "pending",
          route: null,
          wouldRoute: null,
          failureKind: null,
          httpStatus: null,
          retryCount: 0,
          nextRetryAt: null,
          interactionId: null,
          lastSeenHistoryId: r.maxSeenEventId,
          discoveryReason: "initial",
          requeueCount: 0,
          lastRequeuedAt: null,
          lastRequeueEventId: r.labelEventId,
          // Codex 18 §七 — scan/bootstrap rows persist the pre-scan baseline; history → null.
          scanConsumedFloor: r.scanConsumedFloor ?? null,
          claimToken: null,
          claimExpiresAt: null,
          claimStage: null,
          firstSeenMs: this.clock(),
        });
        inserted++;
        continue;
      }
      // FORWARD-ONLY lastSeen (BigInt-monotonic via isHistoryIdNewer) — a null scan-
      // discovery never clobbers, an older/reordered event never regresses; idempotent
      // for a row statement 1 just requeued.
      if (
        r.maxSeenEventId != null &&
        (dup.lastSeenHistoryId == null || isHistoryIdNewer(r.maxSeenEventId, dup.lastSeenHistoryId))
      ) {
        dup.lastSeenHistoryId = r.maxSeenEventId;
      }
    }
    return inserted;
  }
  async advanceCursorCAS(id: number, expected: string | null, newId: string, syncedAt: Date) {
    const c = this.integrations.get(id);
    if (!c) return false;
    if ((c.lastHistoryId ?? null) !== (expected ?? null)) return false;
    c.lastHistoryId = newId;
    c.lastSuccessfulSyncAt = syncedAt;
    return true;
  }
  async rebaselineCursor(id: number, newId: string, syncedAt: Date) {
    const c = this.integrations.get(id);
    if (c) {
      c.lastHistoryId = newId;
      c.lastSuccessfulSyncAt = syncedAt;
    }
  }
  async claimUnclassified(id: number, claimToken: string, leaseExpiresAt: Date, nowMs: number) {
    const claimed = this.rows
      .filter(
        (r) =>
          r.integrationId === id &&
          r.status === "pending" &&
          r.route === null &&
          // classify-retry backoff gate (對抗審查修正 2)
          (r.nextRetryAt == null || r.nextRetryAt.getTime() <= nowMs) &&
          leaseFree(r, nowMs),
      )
      .sort((a, b) => a.id - b.id)
      .slice(0, this.batchCap);
    for (const r of claimed) {
      r.claimToken = claimToken;
      r.claimExpiresAt = leaseExpiresAt;
      r.claimStage = "classify";
    }
    return claimed.map((r) => ({ ...r }));
  }
  async renewClaim(ledgerId: number, claimToken: string, leaseExpiresAt: Date) {
    const r = this.rows.find((x) => x.id === ledgerId && x.claimToken === claimToken);
    if (!r) return false;
    r.claimExpiresAt = leaseExpiresAt;
    return true;
  }
  async releaseClaim(ledgerId: number, claimToken: string) {
    const r = this.rows.find((x) => x.id === ledgerId && x.claimToken === claimToken);
    if (!r) return false;
    r.claimToken = null;
    r.claimExpiresAt = null;
    r.claimStage = null;
    return true;
  }
  async recordClassifyFailure(
    ledgerId: number,
    cls: { failureKind: FailureKind; httpStatus: number | null; errorDetail: string | null },
    retryCount: number,
    nextRetryAt: Date,
    _at: Date,
    claimToken: string,
  ) {
    const r = this.rows.find((x) => x.id === ledgerId && x.claimToken === claimToken);
    if (!r) return false; // lost lease → rejected
    // NON-terminal: status stays pending, route stays NULL.
    r.failureKind = cls.failureKind;
    r.httpStatus = cls.httpStatus;
    r.retryCount = retryCount;
    r.nextRetryAt = nextRetryAt;
    clearClaim(r);
    return true;
  }
  async classify(
    ledgerId: number,
    fields: {
      fromAddress: string;
      route: IntakeRoute;
      wouldRoute: IntakeRoute | null;
      internalDateMs: number;
      classifiedAt: Date;
      status: "pending" | "ignored";
    },
    claimToken: string,
  ) {
    const r = this.rows.find((x) => x.id === ledgerId && x.claimToken === claimToken);
    if (!r) return false; // lost lease → rejected
    r.fromAddress = fields.fromAddress;
    r.route = fields.route;
    r.wouldRoute = fields.wouldRoute;
    r.internalDateMs = fields.internalDateMs;
    r.status = fields.status;
    clearClaim(r);
    return true;
  }
  async claimActionable(id: number, claimToken: string, leaseExpiresAt: Date, nowMs: number) {
    const claimed = this.rows
      .filter(
        (r) =>
          r.integrationId === id &&
          ((r.status === "pending" && (r.route === "customer" || r.route === "receipt")) ||
            (r.status === "failed" &&
              r.nextRetryAt != null &&
              r.nextRetryAt.getTime() <= nowMs &&
              r.retryCount < 3)) &&
          leaseFree(r, nowMs),
      )
      .sort((a, b) => a.id - b.id)
      .slice(0, this.batchCap);
    for (const r of claimed) {
      r.claimToken = claimToken;
      r.claimExpiresAt = leaseExpiresAt;
      r.claimStage = "feed";
    }
    return claimed.map((r) => ({ ...r }));
  }
  async markProcessed(ledgerId: number, interactionId: number | null, _at: Date, claimToken: string) {
    const r = this.rows.find((x) => x.id === ledgerId && x.claimToken === claimToken);
    if (!r) return false; // lost lease → rejected (stale success can't clobber a peer)
    r.status = "processed";
    r.interactionId = interactionId;
    r.nextRetryAt = null;
    clearClaim(r);
    return true;
  }
  async markIgnored(ledgerId: number, failureKind: FailureKind, _at: Date, claimToken: string) {
    const r = this.rows.find((x) => x.id === ledgerId && x.claimToken === claimToken);
    if (!r) return false;
    r.status = "ignored";
    r.failureKind = failureKind;
    r.nextRetryAt = null;
    clearClaim(r);
    return true;
  }
  async markFailed(
    ledgerId: number,
    cls: { failureKind: FailureKind; httpStatus: number | null; errorDetail: string | null },
    retryCount: number,
    nextRetryAt: Date | null,
    _at: Date,
    claimToken: string,
  ) {
    const r = this.rows.find((x) => x.id === ledgerId && x.claimToken === claimToken);
    if (!r) return false; // §五: a stale-token markFailed can NEVER flip a peer's processed→failed
    r.status = "failed";
    r.failureKind = cls.failureKind;
    r.httpStatus = cls.httpStatus;
    r.retryCount = retryCount;
    r.nextRetryAt = nextRetryAt;
    clearClaim(r);
    return true;
  }
  async existingMessageIds(id: number, ids: string[]) {
    return new Set(
      this.rows.filter((r) => r.integrationId === id && ids.includes(r.gmailMessageId)).map((r) => r.gmailMessageId),
    );
  }
  async oldestStuck(id: number, statuses: LedgerStatus[], olderThanMs: number, nowMs: number) {
    const cand = this.rows
      .filter((r) => r.integrationId === id && statuses.includes(r.status) && nowMs - r.firstSeenMs > olderThanMs)
      .sort((a, b) => a.firstSeenMs - b.firstSeenMs)[0];
    if (!cand) return null;
    return { gmailMessageId: cand.gmailMessageId, failureKind: cand.failureKind, ageMs: nowMs - cand.firstSeenMs };
  }
  ledgerFor(id: number) {
    return this.rows.filter((r) => r.integrationId === id);
  }
}

class FakeLock implements LockPort {
  private held = new Map<string, string>();
  failVerify = false;
  refuseAcquire = false;
  async acquire(key: string, token: string) {
    if (this.refuseAcquire) return false;
    if (this.held.has(key)) return false;
    this.held.set(key, token);
    return true;
  }
  async verify(key: string, token: string) {
    if (this.failVerify) return false;
    return this.held.get(key) === token;
  }
  async release(key: string, token: string) {
    if (this.held.get(key) === token) this.held.delete(key);
  }
}

type HistoryPage = {
  messages: DiscoveredMessage[];
  boundaryHistoryId: string | null;
  nextPageToken: string | null;
  expired?: boolean;
};

class FakeGmail implements GmailIntakePort {
  /** FIFO of history pages (or Errors) — one shift per fetchHistoryPage call, so a
   *  multi-page round is just consecutive entries; a new round starts with the next. */
  historyPages: Array<HistoryPage | Error> = [];
  /** FIFO of scan pages for scanQueryPage (bootstrap / fallback). */
  scanPages: Array<{ messages: DiscoveredMessage[]; nextPageToken: string | null } | Error> = [];
  profileHistoryId = "H_PROFILE";
  profileThrows: Error | null = null;
  onFetchHistory: (() => void | Promise<void>) | null = null;
  fetchCalls = 0;
  async fetchHistoryPage(_start: string, _pageToken: string | null) {
    this.fetchCalls++;
    if (this.onFetchHistory) await this.onFetchHistory();
    const next = this.historyPages.shift();
    if (!next) throw new Error("no scripted history page");
    if (next instanceof Error) throw next;
    return {
      messages: next.messages,
      boundaryHistoryId: next.boundaryHistoryId,
      nextPageToken: next.nextPageToken,
      expired: next.expired ?? false,
    };
  }
  /** queries passed to scanQueryPage — for the三宇宙一致 universe assertions. */
  scanQueries: string[] = [];
  /** Interleaving hook: awaited INSIDE scanQueryPage (models mail arriving DURING the
   *  scan) so the P0-2 race fixture can prove the baseline was captured BEFORE the scan. */
  onScanQuery: (() => void | Promise<void>) | null = null;
  async scanQueryPage(query: string, _pageToken: string | null) {
    this.scanQueries.push(query);
    if (this.onScanQuery) await this.onScanQuery();
    const next = this.scanPages.shift();
    if (!next) return { messages: [], nextPageToken: null };
    if (next instanceof Error) throw next;
    return next;
  }
  async scanQueryMetadata(_q: string) {
    return { metas: [], truncated: false };
  }
  async getMailboxHistoryId() {
    if (this.profileThrows) throw this.profileThrows;
    return this.profileHistoryId;
  }
}

class FakeClassifier implements ClassifierPort {
  signals = new Map<string, ClassificationSignals | null>();
  /** per-id queue of errors to throw before succeeding (sniff-throw tests). */
  throws = new Map<string, unknown[]>();
  hydrateCalls = 0;
  set(id: string, s: ClassificationSignals | null) {
    this.signals.set(id, s);
  }
  throwFor(id: string, errors: unknown[]) {
    this.throws.set(id, [...errors]);
  }
  async hydrateSignals(id: string) {
    this.hydrateCalls++;
    const q = this.throws.get(id);
    if (q && q.length > 0) throw q.shift();
    // default: a plain customer at a fixed date, so tests only override the special ones.
    if (!this.signals.has(id)) return { from: CUSTOMER, isReceipt: false, internalDateMs: 1_780_000_000_000 };
    return this.signals.get(id) ?? null;
  }
}

class FakeAlerts implements AlertPort {
  cards: Array<{ agentName: string; title: string; body: string; priority: string }> = [];
  private alerted = new Set<string>();
  async postCard(card: { agentName: string; title: string; body: string; priority: string }) {
    this.cards.push(card);
  }
  async alreadyAlerted(fingerprint: string) {
    if (this.alerted.has(fingerprint)) return true;
    this.alerted.add(fingerprint);
    return false;
  }
}

class FakeDownstream implements DownstreamPort {
  behavior = new Map<string, { throw?: unknown; interactionId?: number | null }>();
  processed: string[] = [];
  /** Interleaving hook: awaited INSIDE process (before returning) so a test can drive a
   *  concurrent runner while THIS row is still leased — proves the claim excludes it. */
  onProcess: ((id: string) => Promise<void>) | null = null;
  async process(row: LedgerRow) {
    if (this.onProcess) await this.onProcess(row.gmailMessageId);
    const b = this.behavior.get(row.gmailMessageId);
    if (b?.throw) throw b.throw;
    this.processed.push(row.gmailMessageId);
    return { interactionId: b?.interactionId ?? 5000 };
  }
}

// ── fixtures / helpers ───────────────────────────────────────────────────────

const CUSTOMER = "customer@example.com";
const OWN = "support@packgoplay.com";
const NOISE = "deals@marriott.com";
const NOREPLY = "noreply@marriott.com";

function page(
  messages: string[] | DiscoveredMessage[],
  boundaryHistoryId: string | null,
  nextPageToken: string | null,
  extra: Partial<HistoryPage> = {},
): HistoryPage {
  // a bare string = a plain messageAdded discovery (eventKind → "message_added",
  // labelEventId null). Each message's PER-EVENT ids (maxSeenEventId / labelEventId,
  // Codex 17 輪 §四.3) default to the page boundary UNLESS the caller set explicit ones —
  // real fetchHistoryPage sets per-record ids distinct from the boundary (proven in
  // gmailPush.test.ts); the event-level tests below pass explicit ids to exercise that
  // distinction, while legacy tests that don't care keep the boundary as the stand-in.
  const msgs: DiscoveredMessage[] = messages.map((m) => {
    if (typeof m === "string") {
      return {
        id: m,
        threadId: `t-${m}`,
        eventKind: "message_added" as const,
        maxSeenEventId: boundaryHistoryId,
        labelEventId: null,
      };
    }
    const isLabel = m.eventKind === "label_added_inbox";
    const seen = m.maxSeenEventId ?? boundaryHistoryId;
    return {
      id: m.id,
      threadId: m.threadId,
      eventKind: m.eventKind,
      maxSeenEventId: seen,
      // a label discovery's requeue-trigger id defaults to its seen id; a message_added
      // discovery carries none.
      labelEventId: m.labelEventId ?? (isLabel ? seen : null),
    };
  });
  return { messages: msgs, boundaryHistoryId, nextPageToken, ...extra };
}

/** A labelAdded(INBOX) discovery — the ONE event kind allowed to requeue an ignored
 *  row (Codex 15 輪 §四.1). fetchHistoryPage emits this for real labelAdded(INBOX)
 *  records (and for a message seen in BOTH messagesAdded and labelsAdded — label wins,
 *  unit-tested in gmailPush.test.ts). Optional explicit eventId sets BOTH maxSeenEventId
 *  and labelEventId to the label event's own history record id (Codex 17 輪 §四.3);
 *  omitted → page() defaults both to the boundary. */
function inboxEvent(id: string, eventId?: string): DiscoveredMessage {
  return {
    id,
    threadId: `t-${id}`,
    eventKind: "label_added_inbox",
    ...(eventId !== undefined ? { maxSeenEventId: eventId, labelEventId: eventId } : {}),
  };
}

/** Seed a classified pending customer row directly (skip discovery for brevity),
 *  going through the real claim protocol (claim → token-gated classify). */
async function seedClassifiedCustomer(store: FakeStore, from = CUSTOMER, id = "m1") {
  await store.insertMinimalIgnore([
    { integrationId: 1, gmailMessageId: id, gmailThreadId: `t-${id}`, maxSeenEventId: "H2", labelEventId: null, source: "history", eventKind: "message_added" },
  ]);
  const row = store.ledgerFor(1).find((r) => r.gmailMessageId === id)!;
  const token = `seed-${id}`;
  await store.claimUnclassified(1, token, new Date(4_102_444_800_000), 1_780_000_050_000);
  await store.classify(
    row.id,
    {
      fromAddress: from,
      route: "customer",
      wouldRoute: null,
      internalDateMs: 1_780_000_000_000,
      classifiedAt: new Date(1_780_000_050_000),
      status: "pending",
    },
    token,
  );
}

function cursor(overrides: Partial<IntegrationCursor> = {}): IntegrationCursor {
  return {
    id: 1,
    emailAddress: "jeffhsieh09@gmail.com",
    intakeMode: "shadow",
    lastHistoryId: "H1",
    lastSuccessfulSyncAt: new Date(1_780_000_000_000),
    watchExpiration: null,
    ...overrides,
  };
}

function makeDeps(
  overrides: {
    integrations?: IntegrationCursor[];
    clock?: () => number;
    downstream?: DownstreamPort;
    classifier?: FakeClassifier;
    maxPagesPerRound?: number;
    batchCap?: number;
    heartbeatSleep?: CancellableSleep;
  } = {},
) {
  const clock = overrides.clock ?? (() => 1_780_000_100_000);
  const store = new FakeStore(overrides.integrations ?? [cursor()], clock);
  if (overrides.batchCap != null) store.batchCap = overrides.batchCap;
  const gmail = new FakeGmail();
  const lock = new FakeLock();
  const alerts = new FakeAlerts();
  const classifier = overrides.classifier ?? new FakeClassifier();
  const deps: HistorySyncDeps = {
    gmail,
    store,
    lock,
    alerts,
    classifier,
    downstream: overrides.downstream,
    clock,
    maxPagesPerRound: overrides.maxPagesPerRound,
    heartbeatSleep: overrides.heartbeatSleep,
  };
  return { deps, store, gmail, lock, alerts, classifier };
}

/** Manually-driven CancellableSleep for the claim heartbeat: each tick() fires the
 *  oldest still-pending heartbeat timer (deterministic — no real time involved). */
function manualSleep() {
  const pending: Array<{ resolve: () => void; done: boolean }> = [];
  const fn: CancellableSleep = () => {
    const entry = { resolve: () => {}, done: false };
    const done = new Promise<void>((r) => {
      entry.resolve = () => {
        entry.done = true;
        r();
      };
    });
    pending.push(entry);
    return { done, cancel: () => entry.resolve() };
  };
  const tick = () => {
    for (;;) {
      const e = pending.shift();
      if (!e) return;
      if (e.done) continue; // already cancelled/fired
      e.resolve();
      return;
    }
  };
  return { fn, tick };
}

/** Flush the task queue so an in-flight heartbeat renew completes deterministically. */
function macroTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// ── P0-1: ledger 先於分類 (discovery lands EVERYTHING, classify assigns route) ──

describe("ledger-first: discovery lands every message BEFORE eligibility (P0-1)", () => {
  it("read-before-poll: a message discovered via History lands regardless of read state", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyPages.push(page(["m1"], "H2", null));

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "advanced", landed: 1, cursor: "H2" });
    const ledger = store.ledgerFor(1);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ gmailMessageId: "m1", status: "pending", source: "history", route: null });
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H2");
  });

  it("noise / noreply / own-email ALL land at discovery (nothing dropped before recording)", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyPages.push(page(["m1", "m2", "m3", "m4"], "H2", null));

    await syncHistoryForIntegration(deps, 1);

    // every discovered message is recorded — the ledger is the COMPLETE account.
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["m1", "m2", "m3", "m4"]);
    expect(store.ledgerFor(1).every((r) => r.status === "pending" && r.route === null)).toBe(true);
  });

  it("classification assigns a terminal audit route to noise/own; keeps customer pending in history mode", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: CUSTOMER, isReceipt: false, internalDateMs: 1_780_000_000_001 });
    classifier.set("m2", { from: OWN, isReceipt: false, internalDateMs: 1_780_000_000_002 });
    classifier.set("m3", { from: NOISE, isReceipt: false, internalDateMs: 1_780_000_000_003 });
    const { deps, store, gmail } = makeDeps({
      integrations: [cursor({ intakeMode: "history" })],
      classifier,
    });
    gmail.historyPages.push(page(["m1", "m2", "m3"], "H2", null));

    await syncHistoryForIntegration(deps, 1);
    const cres = await classifyPendingLedger(deps, 1);

    expect(cres).toMatchObject({ deferredToFeeder: 1, ignoredTerminal: 2, skipped: 0 });
    const byId = Object.fromEntries(store.ledgerFor(1).map((r) => [r.gmailMessageId, r]));
    // noise + own reach a TERMINAL ignored state, WITH the route recorded (稽核態)…
    expect(byId.m2).toMatchObject({ route: "self_or_outbound", status: "ignored", fromAddress: OWN });
    expect(byId.m3).toMatchObject({ route: "noise", status: "ignored", fromAddress: NOISE });
    // …the customer stays pending (classified) for the feeder.
    expect(byId.m1).toMatchObject({ route: "customer", status: "pending", fromAddress: CUSTOMER });
  });

  it("crash BEFORE classification → restart re-classifies with zero loss", async () => {
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })] });
    gmail.historyPages.push(page(["m1", "m2"], "H2", null));

    // round 1: discovery lands the rows, then the process "crashes" before classify runs.
    await syncHistoryForIntegration(deps, 1);
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["m1", "m2"]);
    expect(store.ledgerFor(1).every((r) => r.route === null)).toBe(true); // not yet classified

    // restart: classification picks up the durable pending rows — nothing lost.
    const cres = await classifyPendingLedger(deps, 1);
    expect(cres.deferredToFeeder).toBe(2);
    expect(store.ledgerFor(1).every((r) => r.route === "customer" && r.status === "pending")).toBe(true);
  });

  it("same thread, two messages → two independent ledger rows (message-level key)", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyPages.push(
      page([{ id: "m1", threadId: "shared" }, { id: "m2", threadId: "shared" }], "H2", null),
    );

    await syncHistoryForIntegration(deps, 1);

    const ledger = store.ledgerFor(1);
    expect(ledger.map((r) => r.gmailMessageId).sort()).toEqual(["m1", "m2"]);
    expect(new Set(ledger.map((r) => r.gmailThreadId))).toEqual(new Set(["shared"]));
  });

  it("duplicate push / re-diff of the same message → exactly ONE ledger row", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyPages.push(page(["m1"], "H2", null));
    gmail.historyPages.push(page(["m1"], "H3", null));

    await syncHistoryForIntegration(deps, 1); // first delivery
    await syncHistoryForIntegration(deps, 1); // redelivery re-sees m1

    expect(store.ledgerFor(1).filter((r) => r.gmailMessageId === "m1")).toHaveLength(1);
  });
});

// ── receipt route (Codex §五 five cases) ──────────────────────────────────────

describe("receipt route — the five §五 acceptance cases", () => {
  it("1) a real noreply merchant receipt routes to receipt (before the noise terminal)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("mr", { from: NOREPLY, isReceipt: true, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });
    gmail.historyPages.push(page(["mr"], "H2", null));

    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);

    // a noreply sender that IS a receipt → route=receipt, NOT dropped as noise.
    expect(store.ledgerFor(1)[0]).toMatchObject({ route: "receipt", status: "pending", fromAddress: NOREPLY });
  });

  it("2) an ordinary noreply noise (not a receipt) routes to noise, NOT receipt", async () => {
    const classifier = new FakeClassifier();
    classifier.set("mn", { from: NOREPLY, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });
    gmail.historyPages.push(page(["mn"], "H2", null));

    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);

    expect(store.ledgerFor(1)[0]).toMatchObject({ route: "noise", status: "ignored" });
  });

  it("3) shadow mode records wouldRoute for a receipt but executes NO side effect (legacy stays the only writer)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("mr", { from: NOREPLY, isReceipt: true, internalDateMs: 1_780_000_000_000 });
    const downstream = new FakeDownstream();
    // shadow mode (default fixture) + a downstream present to PROVE it is never called.
    const { deps, store, gmail } = makeDeps({ classifier, downstream });
    gmail.historyPages.push(page(["mr"], "H2", null));

    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);

    const row = store.ledgerFor(1)[0];
    // shadow observes what history mode WOULD do (wouldRoute) but marks it terminal —
    // no processReceiptEmail, no double-write against the legacy scanner.
    expect(row).toMatchObject({ route: "receipt", wouldRoute: "receipt", status: "ignored" });
    expect(downstream.processed).toEqual([]);
  });

  it("4) duplicate push + backfill of the same receipt → zero duplicate rows (unique key)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("mr", { from: NOREPLY, isReceipt: true, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });
    // history discovers it, then a "backfill"-style re-discovery re-sees the same id.
    gmail.historyPages.push(page(["mr"], "H2", null));
    gmail.historyPages.push(page(["mr"], "H3", null));

    await syncHistoryForIntegration(deps, 1);
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);

    expect(store.ledgerFor(1).filter((r) => r.gmailMessageId === "mr")).toHaveLength(1);
  });

  it("5) a receipt handler failure retries + dead-letters (does not silently drop the receipt)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("mr", { from: NOREPLY, isReceipt: true, internalDateMs: 1_780_000_000_000 });
    const downstream = new FakeDownstream();
    downstream.behavior.set("mr", { throw: Object.assign(new Error("R2 upload failed"), { status: 500 }) });
    let nowMs = 1_780_000_100_000;
    const { deps, store, alerts, gmail } = makeDeps({
      integrations: [cursor({ intakeMode: "history" })],
      classifier,
      downstream,
      clock: () => nowMs,
    });
    gmail.historyPages.push(page(["mr"], "H2", null));

    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);

    // attempt 1 → failed (retry scheduled), no card yet
    await feedPendingDownstream(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ route: "receipt", status: "failed", retryCount: 1 });
    expect(alerts.cards).toHaveLength(0);

    // exhaust retries → terminal failed + dead-letter card (never silently dropped).
    nowMs += 130_000;
    await feedPendingDownstream(deps, 1);
    nowMs += 500_000;
    const r3 = await feedPendingDownstream(deps, 1);
    expect(r3.deadLettered).toBe(1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "failed", retryCount: 3, nextRetryAt: null });
    expect(alerts.cards).toHaveLength(1);
    expect(alerts.cards[0].body).toContain("mr");
  });

  it("a receipt row is NOT dropped by the customer eligibility drift check (noreply is legitimate)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("mr", { from: NOREPLY, isReceipt: true, internalDateMs: 1_780_000_000_000 });
    const downstream = new FakeDownstream();
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier, downstream });
    gmail.historyPages.push(page(["mr"], "H2", null));

    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    const feed = await feedPendingDownstream(deps, 1);

    // the feeder's drift guard drops re-classified customers, NOT receipts.
    expect(feed.processed).toBe(1);
    expect(downstream.processed).toEqual(["mr"]);
    expect(store.ledgerFor(1)[0].status).toBe("processed");
  });
});

// ── sniff-throw: classify failures are NON-terminal (對抗審查修正 2) ───────────

describe("sniff-throw: a hydrate/detectReceipt error never terminal-izes a row as noise", () => {
  it("classify throw → row stays pending + unclassified with a retry scheduled; a later good hydrate routes it as receipt", async () => {
    const classifier = new FakeClassifier();
    // first hydrate throws (sniff blew up on a weird attachment), second succeeds
    // and reveals it WAS a receipt — the exact case a swallowed error would noise.
    classifier.throwFor("mr", [new Error("attachment parse blew up in detectReceipt")]);
    classifier.set("mr", { from: NOREPLY, isReceipt: true, internalDateMs: 1_780_000_000_000 });
    let nowMs = 1_780_000_100_000;
    const { deps, store, gmail } = makeDeps({
      integrations: [cursor({ intakeMode: "history" })],
      classifier,
      clock: () => nowMs,
    });
    gmail.historyPages.push(page(["mr"], "H2", null));
    await syncHistoryForIntegration(deps, 1);

    // round 1: throw → NON-terminal. Still pending, still route NULL, NOT noise.
    const c1 = await classifyPendingLedger(deps, 1);
    expect(c1).toMatchObject({ retryScheduled: 1, ignoredTerminal: 0, deadLettered: 0 });
    let row = store.ledgerFor(1)[0];
    expect(row).toMatchObject({ status: "pending", route: null, failureKind: "attachment", retryCount: 1 });
    expect(row.nextRetryAt!.getTime()).toBe(nowMs + 120_000);

    // before the backoff elapses the row is NOT re-classified.
    const c2 = await classifyPendingLedger(deps, 1);
    expect(c2).toMatchObject({ retryScheduled: 0, deferredToFeeder: 0 });

    // after the backoff: hydrate succeeds → routed as receipt (never lost to noise).
    nowMs += 130_000;
    const c3 = await classifyPendingLedger(deps, 1);
    expect(c3).toMatchObject({ deferredToFeeder: 1 });
    row = store.ledgerFor(1)[0];
    expect(row).toMatchObject({ route: "receipt", status: "pending", fromAddress: NOREPLY });
  });

  it("classify retries exhausted → terminal failed (route stays NULL, not noise) + manual-review card", async () => {
    const classifier = new FakeClassifier();
    const boom = new Error("attachment parse blew up in detectReceipt");
    classifier.throwFor("mr", [boom, boom, boom, boom]); // never succeeds
    let nowMs = 1_780_000_100_000;
    const { deps, store, alerts, gmail } = makeDeps({
      integrations: [cursor({ intakeMode: "history" })],
      classifier,
      clock: () => nowMs,
    });
    gmail.historyPages.push(page(["mr"], "H2", null));
    await syncHistoryForIntegration(deps, 1);

    await classifyPendingLedger(deps, 1); // retryCount 1
    nowMs += 130_000;
    await classifyPendingLedger(deps, 1); // retryCount 2
    nowMs += 300_000;
    const c3 = await classifyPendingLedger(deps, 1); // retryCount 3 → terminal

    expect(c3).toMatchObject({ deadLettered: 1 });
    const row = store.ledgerFor(1)[0];
    // terminal failed with the classified failureKind; route NEVER guessed to noise.
    expect(row).toMatchObject({ status: "failed", route: null, failureKind: "attachment", retryCount: 3, nextRetryAt: null });
    const card = alerts.cards.find((c) => c.title.includes("manual_review"));
    expect(card).toBeDefined();
    expect(card!.body).toContain("mr");
    expect(card!.body).not.toContain(NOREPLY); // PII-safe
    // terminal classify-failure is NOT picked up by the feeder (no route decided).
    const downstream = new FakeDownstream();
    deps.downstream = downstream;
    nowMs += 1_000_000;
    await feedPendingDownstream(deps, 1);
    expect(downstream.processed).toEqual([]);
  });
});

// ── P0-2: liveness (per-page prefix advance, no starvation) ───────────────────

describe("liveness: per-page prefix advance + safety-valve continuation (P0-2)", () => {
  it("multi-page round: each page lands then the cursor advances to that page boundary", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyPages.push(page(["m1"], "H1a", "tokA")); // page 1
    gmail.historyPages.push(page(["m2"], "H2", null)); // page 2 (drained)

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "advanced", cursor: "H2" });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["m1", "m2"]);
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H2");
  });

  it("safety valve: a round hitting the page cap CONTINUES from the advanced prefix (not frozen)", async () => {
    const { deps, store, gmail, alerts } = makeDeps({ maxPagesPerRound: 2 });
    // 3 pages but the valve is 2 → round 1 lands pages 1-2, advances to H_b, continues.
    gmail.historyPages.push(page(["m1"], "H_a", "tokA"));
    gmail.historyPages.push(page(["m2"], "H_b", "tokB"));
    gmail.historyPages.push(page(["m3"], "H_c", null)); // page 3 — next round

    const r1 = await syncHistoryForIntegration(deps, 1);
    expect(r1).toMatchObject({ ok: true, outcome: "continued", phase: "history", cursor: "H_b" });
    // the cursor ADVANCED to the landed prefix (H_b) — NOT frozen at H1.
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H_b");
    // info card, normal priority (not a P1 freeze), PII-safe.
    const card = alerts.cards.find((c) => c.title.includes("續跑"));
    expect(card).toBeDefined();
    expect(card!.priority).toBe("normal");
    expect(card!.body).not.toContain(CUSTOMER);

    // round 2 resumes from H_b, lands page 3 → advances to H_c. No front-page loop, no dup.
    const r2 = await syncHistoryForIntegration(deps, 1);
    expect(r2).toMatchObject({ ok: true, outcome: "advanced", cursor: "H_c" });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["m1", "m2", "m3"]);
  });

  it("page-2 crash → prefix advanced to page-1 boundary; restart backfills with no front-page loop, zero dup", async () => {
    const { deps, store, gmail } = makeDeps();
    // page 1 lands m1 (advance H1→H1a), page 2 (a continuation) throws mid-round.
    gmail.historyPages.push(page(["m1"], "H1a", "tokA"));
    gmail.historyPages.push(new Error("history.list network error on page 2"));

    const crash = await syncHistoryForIntegration(deps, 1);
    // NOT frozen at H1 (old semantics) — the landed prefix advanced to H1a (P0-2).
    expect(crash).toMatchObject({ ok: true, outcome: "continued", phase: "history", cursor: "H1a" });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId)).toEqual(["m1"]);
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H1a");

    // restart from H1a: page 2's messages arrive fresh → landed, advance to H2.
    gmail.historyPages.push(page(["m2"], "H2", null));
    const restart = await syncHistoryForIntegration(deps, 1);
    expect(restart).toMatchObject({ ok: true, outcome: "advanced", cursor: "H2" });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["m1", "m2"]); // zero dup
  });

  it("continuation invalidated (pageToken expired) mid-round → resume from the advanced prefix", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyPages.push(page(["m1"], "H1a", "tokA"));
    // Gmail invalidates the pageToken mid-round (a distinct transient from a first-page fail).
    gmail.historyPages.push(Object.assign(new Error("Invalid pageToken"), { code: 400 }));

    const r1 = await syncHistoryForIntegration(deps, 1);
    expect(r1).toMatchObject({ ok: true, outcome: "continued", phase: "history", cursor: "H1a" });
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H1a"); // safe: prefix advanced

    // next round re-lists from H1a (the prefix) — no loss, no loop.
    gmail.historyPages.push(page(["m2"], "H2", null));
    const r2 = await syncHistoryForIntegration(deps, 1);
    expect(r2).toMatchObject({ ok: true, outcome: "advanced", cursor: "H2" });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["m1", "m2"]);
  });

  it("backlog > 3×cap converges over multiple rounds (every id lands, tail reachable, drains, zero dup)", async () => {
    const CAP = 3;
    const N = 10; // > 3 × CAP
    const ids = Array.from({ length: N }, (_, i) => `m${i}`);
    const downstream = new FakeDownstream();
    const { deps, store, gmail } = makeDeps({
      integrations: [cursor({ intakeMode: "history" })],
      downstream,
      batchCap: CAP,
    });
    // discovery has NO cap → all N land in one page/round; the cursor advances fully.
    gmail.historyPages.push(page(ids, "H2", null));

    const sync = await syncHistoryForIntegration(deps, 1);
    expect(sync).toMatchObject({ ok: true, outcome: "advanced", cursor: "H2" });
    expect(store.ledgerFor(1)).toHaveLength(N); // 逐 messageId 最終入帳
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H2");

    // classify + feed are cap-bounded → drain over multiple rounds until backlog is 0.
    let rounds = 0;
    for (;;) {
      const c = await classifyPendingLedger(deps, 1);
      const f = await feedPendingDownstream(deps, 1);
      rounds++;
      if (c.deferredToFeeder === 0 && c.ignoredTerminal === 0 && f.processed === 0) break;
      if (rounds > 20) throw new Error("did not converge");
    }

    // 歸零 + tail 可達 + 零重複: every id processed exactly once.
    expect(downstream.processed.sort()).toEqual([...ids].sort());
    expect(downstream.processed).toContain("m9"); // the tail is reachable, never starved
    expect(new Set(downstream.processed).size).toBe(N);
    expect(store.ledgerFor(1).every((r) => r.status === "processed")).toBe(true);
    expect(rounds).toBeGreaterThan(3); // took multiple rounds (> 3×cap backlog)
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H2"); // cursor unmoved by feeder
  });
});

// ── P0-1: cursor 語義 + 大數精度 (Codex 15 輪 §三) ──────────────────────────────

describe("isHistoryIdNewer — forward-only BigInt order (大數精度加固)", () => {
  it("uses full BigInt precision where Number() would collapse two distinct ids", () => {
    // 2^53 = 9007199254740992. Number('9007199254740993') === 9007199254740992 (the
    // +1 is lost), so a Number()-based compare would call these EQUAL (not newer).
    expect(isHistoryIdNewer("9007199254740993", "9007199254740992")).toBe(true);
    expect(isHistoryIdNewer("9007199254740992", "9007199254740993")).toBe(false);
    // far beyond 2^53 — a realistic Gmail-scale value.
    expect(isHistoryIdNewer("18446744073709551616", "18446744073709551615")).toBe(true);
  });
  it("is numeric order, NOT lexicographic ('100' > '99', though '100' < '99' as strings)", () => {
    expect(isHistoryIdNewer("100", "99")).toBe(true); // lexicographic would be false
    expect(isHistoryIdNewer("99", "100")).toBe(false);
  });
  it("equal → not newer (no advance on an unchanged cursor)", () => {
    expect(isHistoryIdNewer("9007199254740993", "9007199254740993")).toBe(false);
  });
  it("symbolic (non-decimal) test ids degrade to the equality gate", () => {
    expect(isHistoryIdNewer("H2", "H1")).toBe(true);
    expect(isHistoryIdNewer("H1", "H1")).toBe(false);
  });
});

describe("cursor advances to the record-id prefix (NOT the snapshot) + big-number replay", () => {
  it("non-final page: cursor advances only to the page's last history[].id, then resumes past a crash with zero loss", async () => {
    // Mirrors Codex §三's mandated fixture at the ENGINE level: a non-final page's
    // boundary is the LAST history record id (小於同頁頂層 snapshot — fetchHistoryPage's
    // "有 nextPageToken 時禁存頂層 historyId" is unit-proven in gmailPush.test.ts). All
    // ids exceed 2^53 to prove the flow keeps full string precision end-to-end.
    const START = "9007199254740000";
    const P1_RECORD = "9007199254740611"; // page-1 last history[].id (the prefix)
    const P2_SNAPSHOT = "9007199254749999"; // page-2 top-level snapshot (much larger)
    const { deps, store, gmail } = makeDeps({
      integrations: [cursor({ lastHistoryId: START, intakeMode: "history" })],
    });
    // page 1: has a continuation (nextPageToken) → boundary is the record id, NOT a snapshot.
    gmail.historyPages.push(page(["m1"], P1_RECORD, "tokA"));
    // page 2: the continuation crashes mid-round.
    gmail.historyPages.push(new Error("history.list network error on page 2"));

    const crash = await syncHistoryForIntegration(deps, 1);
    // cursor advanced ONLY to the landed record-id prefix — never the (unseen) snapshot.
    expect(crash).toMatchObject({ ok: true, outcome: "continued", phase: "history", cursor: P1_RECORD });
    expect((await store.getIntegration(1))!.lastHistoryId).toBe(P1_RECORD);
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId)).toEqual(["m1"]);

    // restart from the record-id prefix: page 2 arrives, drains, advances to the snapshot.
    gmail.historyPages.push(page(["m2"], P2_SNAPSHOT, null));
    const restart = await syncHistoryForIntegration(deps, 1);
    expect(restart).toMatchObject({ ok: true, outcome: "advanced", cursor: P2_SNAPSHOT });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["m1", "m2"]); // zero loss, zero dup
    expect((await store.getIntegration(1))!.lastHistoryId).toBe(P2_SNAPSHOT);
  });

  it("a full round with all history ids > 2^53 advances correctly (no precision loss)", async () => {
    const START = "9223372036854775800"; // near 2^63
    const B1 = "9223372036854775991";
    const B2 = "9223372036854776050";
    const { deps, store, gmail } = makeDeps({
      integrations: [cursor({ lastHistoryId: START, intakeMode: "history" })],
    });
    gmail.historyPages.push(page(["m1"], B1, "tokA")); // page 1
    gmail.historyPages.push(page(["m2"], B2, null)); // page 2 drained

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "advanced", cursor: B2 });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["m1", "m2"]);
    expect((await store.getIntegration(1))!.lastHistoryId).toBe(B2);
  });
});

// ── fencing + CAS + concurrency ───────────────────────────────────────────────

describe("syncHistoryForIntegration — fencing + CAS", () => {
  it("crash after ledger insert but before CAS (lost fencing) → replay dedups then advances", async () => {
    const { deps, store, gmail, lock } = makeDeps();
    gmail.historyPages.push(page(["m1"], "H2", null));
    gmail.historyPages.push(page(["m1"], "H2", null));

    lock.failVerify = true;
    const r1 = await syncHistoryForIntegration(deps, 1);
    expect(r1).toMatchObject({ ok: true, outcome: "noop", reason: "lost-fencing-token" });
    expect(store.ledgerFor(1)).toHaveLength(1); // ledger DID land (durable-first)
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H1"); // cursor frozen

    lock.failVerify = false;
    const r2 = await syncHistoryForIntegration(deps, 1);
    expect(r2).toMatchObject({ ok: true, outcome: "advanced", cursor: "H2" });
    expect(store.ledgerFor(1)).toHaveLength(1); // still ONE row (zero dup)
  });

  it("CAS does not clobber a newer cursor written by a concurrent writer", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyPages.push(page(["m1"], "H2", null));
    // a concurrent writer advances H1→H_CONCURRENT during our fetch.
    gmail.onFetchHistory = async () => {
      await store.advanceCursorCAS(1, "H1", "H_CONCURRENT", new Date());
      gmail.onFetchHistory = null; // once
    };

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "noop", reason: "cas-lost-to-concurrent" });
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H_CONCURRENT");
  });

  it("a second concurrent writer cannot even acquire the fencing lock", async () => {
    const { deps, gmail, lock } = makeDeps();
    lock.refuseAcquire = true;
    gmail.historyPages.push(page(["m1"], "H2", null));
    const res = await syncHistoryForIntegration(deps, 1);
    expect(res).toMatchObject({ ok: true, outcome: "noop", reason: "locked-by-concurrent-writer" });
    expect(gmail.fetchCalls).toBe(0); // never even fetched
  });

  it("first-page history.list transient failure (non-404) freezes cursor + classified failure", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyPages.push(Object.assign(new Error("Rate Limit Exceeded"), { code: 429 }));

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: false, reason: "history-list-failed" });
    expect(res.ok === false && res.failure?.failureKind).toBe("gmail_api");
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H1"); // frozen (no prefix landed)
  });

  it("insertMinimalIgnore throw → the SAME {ok:false, failure} shape; cursor stays at the landed prefix", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyPages.push(page(["m1"], "H1a", "tokA")); // page 1 lands + advances
    gmail.historyPages.push(page(["m2"], "H2", null)); // page 2 insert will throw
    const origInsert = store.insertMinimalIgnore.bind(store);
    let calls = 0;
    store.insertMinimalIgnore = async (rows) => {
      calls++;
      if (calls === 2) throw Object.assign(new Error("deadlock detected"), { code: "ER_LOCK_DEADLOCK" });
      return origInsert(rows);
    };

    const res = await syncHistoryForIntegration(deps, 1);

    // consistent error surface (一致錯誤面) — not an unhandled throw.
    expect(res).toMatchObject({ ok: false, reason: "ledger-insert-failed" });
    expect(res.ok === false && res.failure?.failureKind).toBe("db");
    // cursor semantics unchanged: page 2 did NOT land → cursor stays at page-1 prefix.
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H1a");
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId)).toEqual(["m1"]);

    // restart from the prefix re-lists page 2 → lands, advances, zero dup.
    store.insertMinimalIgnore = origInsert;
    gmail.historyPages.push(page(["m2"], "H2", null));
    const restart = await syncHistoryForIntegration(deps, 1);
    expect(restart).toMatchObject({ ok: true, outcome: "advanced", cursor: "H2" });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["m1", "m2"]);
  });
});

// ── 404 bounded fallback + bootstrap (per-page scan) ──────────────────────────

describe("syncHistoryForIntegration — 404 fallback + bootstrap (逐批落帳)", () => {
  it("History 404 → bounded per-page fallback scan lands the gap, then getProfile rebaselines", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyPages.push(page([], null, null, { expired: true }));
    gmail.scanPages.push({ messages: [{ id: "mf1", threadId: "t1" }, { id: "mf2", threadId: "t2" }], nextPageToken: null });
    gmail.profileHistoryId = "H_REBUILT";

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "recovered", cursor: "H_REBUILT" });
    // ledger-first: BOTH land (noise no longer filtered at scan time) as fallback_scan.
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["mf1", "mf2"]);
    expect(store.ledgerFor(1).every((r) => r.source === "fallback_scan")).toBe(true);
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H_REBUILT");
  });

  it("fallback scan hitting the valve does NOT rebaseline (stays expired), continuation card", async () => {
    const { deps, store, gmail, alerts } = makeDeps({ maxPagesPerRound: 1 });
    gmail.historyPages.push(page([], null, null, { expired: true }));
    gmail.scanPages.push({ messages: [{ id: "mf1", threadId: "t1" }], nextPageToken: "more" }); // more pages
    gmail.profileHistoryId = "H_REBUILT";

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "continued", phase: "fallback" });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId)).toEqual(["mf1"]);
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H1"); // NOT rebaselined
    expect(alerts.cards.filter((c) => c.title.includes("續跑"))).toHaveLength(1);
  });

  it("bootstrap: no lastHistoryId → getProfile baseline + one fallback scan", async () => {
    const { deps, store, gmail } = makeDeps({
      integrations: [cursor({ lastHistoryId: null, lastSuccessfulSyncAt: null })],
    });
    gmail.profileHistoryId = "H_BOOT";
    gmail.scanPages.push({ messages: [{ id: "mb1", threadId: "t1" }], nextPageToken: null });

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "bootstrapped", cursor: "H_BOOT" });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId)).toEqual(["mb1"]);
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H_BOOT");
  });

  it("inbox scan query = bare `after:X in:inbox` (24h overlap; NO noreply/label narrowing — ledger-first)", () => {
    const since = 1_780_000_000_000 - 24 * 60 * 60 * 1000;
    expect(buildInboxScanQuery(since)).toBe(`after:${Math.floor(since / 1000)} in:inbox`);
  });
});

// ── 三宇宙一致 — discovery / fallback scan / reconcile agree on the universe ────

describe("三宇宙一致: what counts as 'mail that must land' is identical across paths", () => {
  it("fallback + bootstrap scans use the SAME in:inbox universe query as reconcile (no eligibility narrowing)", async () => {
    // fallback (404 recovery)
    const fb = makeDeps();
    fb.gmail.historyPages.push(page([], null, null, { expired: true }));
    fb.gmail.scanPages.push({ messages: [], nextPageToken: null });
    await syncHistoryForIntegration(fb.deps, 1);
    // bootstrap (null cursor)
    const bs = makeDeps({ integrations: [cursor({ lastHistoryId: null, lastSuccessfulSyncAt: null })] });
    bs.gmail.scanPages.push({ messages: [], nextPageToken: null });
    await syncHistoryForIntegration(bs.deps, 1);

    for (const q of [...fb.gmail.scanQueries, ...bs.gmail.scanQueries]) {
      expect(q).toContain("in:inbox"); // same universe token reconcile scans
      expect(q).not.toContain("-from:noreply"); // no eligibility narrowing (P0-1)
      expect(q).not.toContain("-label:"); // no processed-label narrowing (reconcile has none)
    }
    // and it IS the shared builder's output verbatim (single source of truth).
    expect(fb.gmail.scanQueries[0]).toMatch(/^after:\d+ in:inbox$/);
  });

  it("a labelAdded-into-inbox message (fallback-visible) lands in the ledger — never a permanent rule-1 P1", async () => {
    // A message moved into the inbox later shows up in the in:inbox scan even when
    // history messageAdded missed it. Ledger-first: the scan lands it unconditionally
    // (fetchHistoryPage's labelAdded discovery is unit-tested in gmailPush.test.ts —
    // this covers the scan-side of the same universe).
    const { deps, store, gmail } = makeDeps();
    gmail.historyPages.push(page([], null, null, { expired: true }));
    gmail.scanPages.push({ messages: [{ id: "moved-in", threadId: "t-mv" }], nextPageToken: null });

    await syncHistoryForIntegration(deps, 1);

    expect(store.ledgerFor(1).map((r) => r.gmailMessageId)).toEqual(["moved-in"]);
    // reconcile's set-difference over the same universe now finds it in the ledger →
    // rule 1 stays quiet (asserted end-to-end in gmailReconcile.test.ts).
    expect(await store.existingMessageIds(1, ["moved-in"])).toEqual(new Set(["moved-in"]));
  });
});

// ── downstream feeder + F skeleton ────────────────────────────────────────────

describe("feedPendingDownstream — history mode terminal states + F skeleton", () => {
  it("pending customer → processed (+interactionId); a processed row is never re-fed", async () => {
    const downstream = new FakeDownstream();
    downstream.behavior.set("m1", { interactionId: 4242 });
    const { deps, store } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], downstream });
    await seedClassifiedCustomer(store);

    const r1 = await feedPendingDownstream(deps, 1);
    expect(r1).toMatchObject({ processed: 1, failed: 0 });
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "processed", interactionId: 4242 });

    const r2 = await feedPendingDownstream(deps, 1);
    expect(r2.processed).toBe(0);
    expect(downstream.processed).toEqual(["m1"]); // exactly one process call total
  });

  it("eligibility drift: a customer row whose sender is now noise → ignored, downstream not called", async () => {
    const downstream = new FakeDownstream();
    const { deps, store } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], downstream });
    await seedClassifiedCustomer(store, NOISE);

    await feedPendingDownstream(deps, 1);

    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "ignored", failureKind: "noise" });
    expect(downstream.processed).toEqual([]);
  });

  it("OAuth/API failure classify + exponential backoff + dead-letter after 3 tries", async () => {
    const downstream = new FakeDownstream();
    downstream.behavior.set("m1", { throw: Object.assign(new Error("Too Many Requests"), { status: 429 }) });
    let nowMs = 1_780_000_100_000;
    const { deps, store, alerts } = makeDeps({
      integrations: [cursor({ intakeMode: "history" })],
      downstream,
      clock: () => nowMs,
    });
    await seedClassifiedCustomer(store);

    await feedPendingDownstream(deps, 1);
    let row = store.ledgerFor(1)[0];
    expect(row).toMatchObject({ status: "failed", failureKind: "gmail_api", httpStatus: 429, retryCount: 1 });
    expect(row.nextRetryAt!.getTime()).toBe(1_780_000_100_000 + 120_000);
    expect(alerts.cards).toHaveLength(0);

    nowMs = 1_780_000_100_000 + 60_000;
    expect((await feedPendingDownstream(deps, 1)).failed).toBe(0); // before backoff → not actionable

    nowMs = 1_780_000_100_000 + 130_000;
    await feedPendingDownstream(deps, 1);
    expect(store.ledgerFor(1)[0].retryCount).toBe(2);

    nowMs = 1_780_000_100_000 + 500_000;
    const r3 = await feedPendingDownstream(deps, 1);
    row = store.ledgerFor(1)[0];
    expect(r3.deadLettered).toBe(1);
    expect(row).toMatchObject({ status: "failed", retryCount: 3, nextRetryAt: null });
    expect(alerts.cards).toHaveLength(1);
    expect(alerts.cards[0].body).toContain("m1");
    expect(alerts.cards[0].body).not.toContain(CUSTOMER); // PII-safe
  });
});

// ── P0-2: labelsAdded 狀態感知重排 (Codex 15 輪 §四 five cases) ─────────────────

describe("state-aware requeue: an inbox re-entry re-surfaces the right rows (P0-2)", () => {
  it("1) a NEW message seen via both messageAdded and labelAdded lands ONE row, routes ONCE, no spurious requeue", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: CUSTOMER, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });

    // fetchHistoryPage collapses a message present in BOTH messagesAdded and labelsAdded
    // to a single DiscoveredMessage tagged label_added_inbox (label wins — unit-tested in
    // gmailPush.test.ts), so the engine receives m1 once; a duplicate re-discovery round
    // must not add a second row, and a brand-new (pending) row is never "requeued".
    gmail.historyPages.push(page([inboxEvent("m1")], "H2", null));
    gmail.historyPages.push(page([inboxEvent("m1")], "H3", null));
    await syncHistoryForIntegration(deps, 1);
    await syncHistoryForIntegration(deps, 1);

    expect(store.ledgerFor(1)).toHaveLength(1); // exactly one row

    const c = await classifyPendingLedger(deps, 1);
    expect(c.deferredToFeeder).toBe(1); // routed exactly once
    expect(store.ledgerFor(1)).toHaveLength(1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ route: "customer", requeueCount: 0 });
  });

  it("2) an ignored row that receives a newer INBOX event is requeued to pending + re-classified", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: NOISE, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });

    // round 1: discover + classify m1 as noise → terminal ignored.
    gmail.historyPages.push(page(["m1"], "9007199254740801", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ route: "noise", status: "ignored", requeueCount: 0 });

    // m1 is moved back INTO the inbox → a newer labelAdded(INBOX) history event
    // (eventKind label_added_inbox — the ONE kind allowed to requeue, §四.1) re-
    // surfaces it. Classification now yields customer (rules updated / sender now
    // recognised) — the requeue re-evaluates instead of staying permanently stuck ignored.
    classifier.set("m1", { from: CUSTOMER, isReceipt: false, internalDateMs: 1_780_000_000_005 });
    gmail.historyPages.push(page([inboxEvent("m1")], "9007199254740950", null));
    await syncHistoryForIntegration(deps, 1);

    let row = store.ledgerFor(1)[0];
    expect(row).toMatchObject({
      status: "pending",
      route: null,
      requeueCount: 1,
      discoveryReason: "inbox_requeue",
      lastSeenHistoryId: "9007199254740950",
    });
    expect(row.lastRequeuedAt).not.toBeNull();

    // re-classification routes it as customer — the customer need is no longer stuck.
    await classifyPendingLedger(deps, 1);
    row = store.ledgerFor(1)[0];
    expect(row).toMatchObject({ route: "customer", status: "pending", requeueCount: 1 });
    expect(store.ledgerFor(1)).toHaveLength(1); // still exactly ONE row
  });

  it("3) a processed row hit by a later label change updates only lastSeenHistoryId — zero side effect", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: CUSTOMER, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const downstream = new FakeDownstream();
    const { deps, store, gmail } = makeDeps({
      integrations: [cursor({ intakeMode: "history" })],
      classifier,
      downstream,
    });

    // round 1: discover → classify customer → feed → processed.
    gmail.historyPages.push(page(["m1"], "9007199254740801", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    await feedPendingDownstream(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "processed", route: "customer" });
    expect(downstream.processed).toEqual(["m1"]);

    // a later GENUINE labelAdded(INBOX) event re-surfaces the SAME already-processed
    // message — even the requeue-capable event kind must not touch a processed row.
    gmail.historyPages.push(page([inboxEvent("m1")], "9007199254740950", null));
    await syncHistoryForIntegration(deps, 1);

    const row = store.ledgerFor(1)[0];
    // status stays processed (NOT requeued), only the latest-seen id advanced.
    expect(row).toMatchObject({
      status: "processed",
      route: "customer",
      requeueCount: 0,
      lastSeenHistoryId: "9007199254740950",
    });
    expect(row.lastRequeuedAt).toBeNull();

    // classify + feed again → the downstream chain is NEVER re-invoked (no double booking).
    await classifyPendingLedger(deps, 1);
    await feedPendingDownstream(deps, 1);
    expect(downstream.processed).toEqual(["m1"]); // still exactly one
  });

  it("4) duplicate labelAdded on a still-pending row → one row, no spurious requeue, routed once", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: CUSTOMER, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });

    // two rounds of DUPLICATE labelAdded(INBOX) re-see m1 BEFORE it is classified —
    // even the requeue-capable kind is a no-op on a still-pending row.
    gmail.historyPages.push(page([inboxEvent("m1")], "9007199254740801", null));
    gmail.historyPages.push(page([inboxEvent("m1")], "9007199254740950", null));
    await syncHistoryForIntegration(deps, 1);
    await syncHistoryForIntegration(deps, 1);

    // exactly ONE row; a pending row is never requeued (requeue is ignored-only).
    expect(store.ledgerFor(1)).toHaveLength(1);
    expect(store.ledgerFor(1)[0]).toMatchObject({
      status: "pending",
      requeueCount: 0,
      lastSeenHistoryId: "9007199254740950",
    });

    // classified exactly once.
    const c = await classifyPendingLedger(deps, 1);
    expect(c.deferredToFeeder).toBe(1);
    expect(store.ledgerFor(1)).toHaveLength(1);
  });

  it("5) requeue then crash before cursor advance → replay is idempotent (requeueCount stays 1, zero dup)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: NOISE, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail, lock } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });

    // classify m1 → ignored (cursor advances to H_A).
    gmail.historyPages.push(page(["m1"], "H_A", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "ignored", requeueCount: 0 });

    // a newer labelAdded(INBOX) event requeues m1, but the fencing token is lost right
    // before the cursor advance (a crash window) → the round lands + requeues but does
    // NOT advance.
    classifier.set("m1", { from: CUSTOMER, isReceipt: false, internalDateMs: 1_780_000_000_005 });
    gmail.historyPages.push(page([inboxEvent("m1")], "H_B", null));
    lock.failVerify = true;
    const r1 = await syncHistoryForIntegration(deps, 1);
    expect(r1).toMatchObject({ ok: true, outcome: "noop", reason: "lost-fencing-token" });
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "pending", route: null, requeueCount: 1 });
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H_A"); // cursor did NOT advance

    // replay from the un-advanced cursor re-sees the SAME labelAdded(INBOX) event for
    // m1 (now pending) → the requeue is a no-op (ignored-only gate).
    lock.failVerify = false;
    gmail.historyPages.push(page([inboxEvent("m1")], "H_B", null));
    await syncHistoryForIntegration(deps, 1);
    expect(store.ledgerFor(1)[0].requeueCount).toBe(1); // NOT 2 — idempotent under replay

    // classify once → routed once, still one row.
    await classifyPendingLedger(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "pending", route: "customer", requeueCount: 1 });
    expect(store.ledgerFor(1)).toHaveLength(1);
  });

  it("6) messageAdded replay re-seeing an ignored row does NOT requeue it (§四.1 gate)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: NOISE, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });

    // classify m1 → terminal ignored.
    gmail.historyPages.push(page(["m1"], "H_A", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "ignored", route: "noise", requeueCount: 0 });

    // a crash-replay round re-lists the SAME messageAdded diff (plain message_added —
    // no inbox-entry signal). The ignored row must stay ignored: seeing the id again
    // proves nothing about the mail re-entering the inbox.
    gmail.historyPages.push(page(["m1"], "H_B", null));
    await syncHistoryForIntegration(deps, 1);

    const row = store.ledgerFor(1)[0];
    expect(row).toMatchObject({
      status: "ignored", // NOT requeued
      route: "noise", // classification untouched
      requeueCount: 0,
      lastSeenHistoryId: "H_B", // statement 1 still tracked the latest sighting
    });
    expect(row.lastRequeuedAt).toBeNull();
    // and it is NOT re-classified.
    const c = await classifyPendingLedger(deps, 1);
    expect(c).toMatchObject({ deferredToFeeder: 0, ignoredTerminal: 0 });
  });

  it("7) 404 fallback full-inbox re-scan re-seeing ignored rows requeues NOTHING (無重排風暴)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: NOISE, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    classifier.set("m2", { from: NOREPLY, isReceipt: false, internalDateMs: 1_780_000_000_001 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });

    // two historical noise mails, both terminal ignored.
    gmail.historyPages.push(page(["m1", "m2"], "H_A", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    expect(store.ledgerFor(1).every((r) => r.status === "ignored")).toBe(true);

    // cursor expires → the 404 fallback re-scans the WHOLE inbox and re-discovers both
    // old ignored mails (scan discoveries are always message_added-equivalent). Neither
    // may be resurrected — otherwise every fallback round would be a requeue storm.
    gmail.historyPages.push(page([], null, null, { expired: true }));
    gmail.scanPages.push({
      messages: [
        { id: "m1", threadId: "t-m1", eventKind: "message_added" },
        { id: "m2", threadId: "t-m2", eventKind: "message_added" },
        { id: "m3", threadId: "t-m3", eventKind: "message_added" }, // genuinely new
      ],
      nextPageToken: null,
    });
    gmail.profileHistoryId = "H_REBUILT";
    const res = await syncHistoryForIntegration(deps, 1);
    expect(res).toMatchObject({ ok: true, outcome: "recovered", cursor: "H_REBUILT" });

    const byId = Object.fromEntries(store.ledgerFor(1).map((r) => [r.gmailMessageId, r]));
    // both old rows: still ignored, zero requeue, classification intact…
    expect(byId.m1).toMatchObject({ status: "ignored", route: "noise", requeueCount: 0 });
    expect(byId.m2).toMatchObject({ status: "ignored", route: "noise", requeueCount: 0 });
    // …and the fallback's null historyId did NOT clobber the real lastSeen (COALESCE).
    expect(byId.m1.lastSeenHistoryId).toBe("H_A");
    // the genuinely new mail landed pending as usual.
    expect(byId.m3).toMatchObject({ status: "pending", route: null });
    expect(store.ledgerFor(1)).toHaveLength(3);
  });

  it("8) both events on an IGNORED row (collapsed to label_added_inbox) → one row, requeued exactly once", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: NOISE, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });

    // m1 → terminal ignored.
    gmail.historyPages.push(page(["m1"], "H_A", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);

    // one diff carries BOTH messagesAdded and labelsAdded(INBOX) for m1 —
    // fetchHistoryPage collapses that to ONE discovery tagged label_added_inbox
    // (label wins, unit-tested in gmailPush.test.ts). The engine sees it once.
    classifier.set("m1", { from: CUSTOMER, isReceipt: false, internalDateMs: 1_780_000_000_005 });
    gmail.historyPages.push(page([inboxEvent("m1")], "H_B", null));
    await syncHistoryForIntegration(deps, 1);

    expect(store.ledgerFor(1)).toHaveLength(1); // one row
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "pending", route: null, requeueCount: 1 }); // requeued ONCE

    const c = await classifyPendingLedger(deps, 1);
    expect(c.deferredToFeeder).toBe(1); // re-routed exactly once
    expect(store.ledgerFor(1)[0]).toMatchObject({ route: "customer", requeueCount: 1 });
  });
});

// ── Codex 16 輪 P0-2: event-level requeue idempotency (§六.4-5) ───────────────────
describe("event-level requeue idempotency (Codex 16 輪 P0-2, §六.4-5)", () => {
  // history record ids all > 2^53 (9007199254740992) so a Number() collapse would be
  // visible — BigInt ordering is load-bearing (the requeue gate + forward-only lastSeen
  // both compare via isHistoryIdNewer).
  const E_LO = "9007199254740993";
  const E_HI = "9007199254740999";

  function msgAdded(id: string, eventId: string): DiscoveredMessage {
    // a plain messagesAdded discovery: its own maxSeenEventId, no label event.
    return { id, threadId: `t-${id}`, eventKind: "message_added", maxSeenEventId: eventId, labelEventId: null };
  }

  it("§六.4 requeue → re-ignored in the SAME run → replay of the SAME label event does NOT re-requeue (requeueCount stays 1)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: CUSTOMER, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    // shadow mode: a customer/receipt classification is TERMINAL ignored (wouldRoute
    // recorded, NO side effect) — so the row cycles back to ignored, the exact state
    // transition the old crash test (§四) avoided by leaving the row pending.
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "shadow" })], classifier });

    // discover m1 (message_added, its OWN event id E_LO) → classify → terminal ignored.
    gmail.historyPages.push(page([msgAdded("m1", E_LO)], "b1", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "ignored", requeueCount: 0, lastRequeueEventId: null });

    // a labelAdded(INBOX) event (record id E_HI) requeues the ignored row exactly once
    // and stamps the monotonic watermark lastRequeueEventId=E_HI.
    gmail.historyPages.push(page([inboxEvent("m1", E_HI)], "b2", null));
    await syncHistoryForIntegration(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({
      status: "pending",
      route: null,
      requeueCount: 1,
      lastRequeueEventId: E_HI,
    });

    // SAME run re-classifies (shadow) → the row returns to terminal ignored.
    await classifyPendingLedger(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "ignored", requeueCount: 1 });

    // replay: the cursor never advanced past the label window, so the NEXT round re-sees
    // the SAME labelAdded(INBOX) event (same record id E_HI). The monotonic gate (event
    // id must be STRICTLY GREATER than lastRequeueEventId=E_HI) makes it a no-op — the
    // OLD code (eventKind+ignored gate only) would requeue again → requeueCount 2.
    gmail.historyPages.push(page([inboxEvent("m1", E_HI)], "b2", null));
    await syncHistoryForIntegration(deps, 1);

    expect(store.ledgerFor(1)[0].requeueCount).toBe(1); // NOT 2 — replay never double-counts
    expect(store.ledgerFor(1)[0].status).toBe("ignored");
    expect(store.ledgerFor(1)).toHaveLength(1);
  });

  it("§六.5 an OLDER label event arriving out of order does NOT requeue and does NOT regress lastSeen", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: CUSTOMER, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "shadow" })], classifier });

    // m1 ignored → requeued by E_HI → re-ignored (shadow). watermark E_HI, lastSeen E_HI.
    gmail.historyPages.push(page([msgAdded("m1", E_LO)], "b1", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    gmail.historyPages.push(page([inboxEvent("m1", E_HI)], "b2", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({
      status: "ignored",
      requeueCount: 1,
      lastRequeueEventId: E_HI,
      lastSeenHistoryId: E_HI,
    });

    // an OLDER labelAdded(INBOX) event (E_LO < E_HI) arrives out of order (reordered
    // delivery / replay). NOT strictly greater → no requeue; forward-only lastSeen does
    // NOT regress to E_LO.
    gmail.historyPages.push(page([inboxEvent("m1", E_LO)], "b3", null));
    await syncHistoryForIntegration(deps, 1);

    expect(store.ledgerFor(1)[0]).toMatchObject({
      status: "ignored",
      requeueCount: 1, // unchanged
      lastSeenHistoryId: E_HI, // NOT regressed
    });
  });

  it("§六.5 lastSeenHistoryId is forward-only: a reordered older / null sighting keeps the higher watermark", async () => {
    const { store } = makeDeps();
    const row = (maxSeenEventId: string | null, source: MinimalLedgerRow["source"] = "history"): MinimalLedgerRow => ({
      integrationId: 1,
      gmailMessageId: "m1",
      gmailThreadId: "t",
      maxSeenEventId,
      labelEventId: null,
      source,
      eventKind: "message_added",
    });
    await store.insertMinimalIgnore([row(E_HI)]);
    expect(store.ledgerFor(1)[0].lastSeenHistoryId).toBe(E_HI);
    await store.insertMinimalIgnore([row(E_LO)]); // older → must NOT regress
    expect(store.ledgerFor(1)[0].lastSeenHistoryId).toBe(E_HI);
    await store.insertMinimalIgnore([row(null, "fallback_scan")]); // scan null → must NOT clobber
    expect(store.ledgerFor(1)[0].lastSeenHistoryId).toBe(E_HI);
  });
});

// ── Codex 17 輪 §四: event CONSUMPTION watermark (closes the P0-1 reversal) ────────
describe("event consumption watermark: requeue compares the watermark BEFORE this event (Codex 17 輪 §四)", () => {
  // all ids > 2^53 so BigInt ordering is load-bearing (a Number() collapse would be visible).
  const E = "9007199254740993";
  const E_LO = "9007199254740990";
  const E_MID = "9007199254740995";
  const E_HI = "9007199254740999";
  /** a plain messageAdded discovery carrying its OWN seen id, no label event. */
  const msg = (id: string, seen: string): DiscoveredMessage => ({
    id,
    threadId: `t-${id}`,
    eventKind: "message_added",
    maxSeenEventId: seen,
    labelEventId: null,
  });

  it("1) FIRST discovery by label event E → ignored → replay E does NOT requeue (§四.2 — closes the reversal)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: NOISE, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });

    // m1 is FIRST surfaced by a labelAdded(INBOX) event E (no prior messageAdded row). §四.2:
    // the new row is seeded lastRequeueEventId=E — that event already drove it to pending.
    gmail.historyPages.push(page([inboxEvent("m1", E)], "b1", null));
    await syncHistoryForIntegration(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({
      lastRequeueEventId: E,
      requeueCount: 0,
      discoveryReason: "initial",
    });

    // classify → noise → terminal ignored.
    await classifyPendingLedger(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "ignored", requeueCount: 0 });

    // the cursor never advanced past E → the next round REPLAYS the same label event E. The
    // OLD null-gate (lastRequeueEventId null → open) would spuriously requeue; the §四.2 seed
    // makes E NOT strictly greater than the consumed watermark E → no-op.
    gmail.historyPages.push(page([inboxEvent("m1", E)], "b2", null));
    await syncHistoryForIntegration(deps, 1);

    const row = store.ledgerFor(1)[0];
    expect(row).toMatchObject({ status: "ignored", requeueCount: 0 }); // UNCHANGED — reversal closed
    expect(row.lastRequeuedAt).toBeNull();
    expect(store.ledgerFor(1)).toHaveLength(1);
  });

  it("2) a stale label (id < lastSeen) on a never-requeued ignored row does NOT requeue (§四.1 null-gate stale hole)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: NOISE, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });

    // m1 discovered by a plain messageAdded at the HIGH id → lastSeen=E_HI, never requeued
    // (lastRequeueEventId stays null). classify → noise → ignored.
    gmail.historyPages.push(page([msg("m1", E_HI)], "b1", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({
      status: "ignored",
      lastRequeueEventId: null,
      lastSeenHistoryId: E_HI,
      requeueCount: 0,
    });

    // a STALE labelAdded(INBOX) event with a LOWER id (E_LO < E_HI). lastRequeueEventId is
    // null, so the OLD gate (null → open) would requeue. The consumed-watermark gate compares
    // E_LO against COALESCE(null, lastSeen=E_HI)=E_HI → not strictly greater → NO requeue.
    gmail.historyPages.push(page([inboxEvent("m1", E_LO)], "b2", null));
    await syncHistoryForIntegration(deps, 1);

    const row = store.ledgerFor(1)[0];
    expect(row).toMatchObject({ status: "ignored", requeueCount: 0, lastSeenHistoryId: E_HI });
    expect(row.lastRequeuedAt).toBeNull();
  });

  it("3) a label event id < lastRequeueEventId does NOT requeue (monotonic gate)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: NOISE, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });

    // m1: message_added → ignored → requeued by label E_MID → re-ignored (noise again),
    // so lastRequeueEventId=E_MID.
    gmail.historyPages.push(page([msg("m1", E_LO)], "b1", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    gmail.historyPages.push(page([inboxEvent("m1", E_MID)], "b2", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "ignored", requeueCount: 1, lastRequeueEventId: E_MID });

    // a label event E_LO < lastRequeueEventId E_MID → not strictly greater → no requeue.
    gmail.historyPages.push(page([inboxEvent("m1", E_LO)], "b3", null));
    await syncHistoryForIntegration(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "ignored", requeueCount: 1, lastRequeueEventId: E_MID });
  });

  it("4) split watermarks: the requeue gate uses labelEventId, NOT the (higher) maxSeenEventId", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: NOISE, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });

    // set up an ignored row whose lastRequeueEventId is E_MID (via a prior requeue).
    gmail.historyPages.push(page([msg("m1", "9007199254740900")], "b1", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    gmail.historyPages.push(page([inboxEvent("m1", E_MID)], "b2", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "ignored", lastRequeueEventId: E_MID, requeueCount: 1 });

    // a same-page discovery where the LABEL record id (E_LO) < E_MID but a same-page
    // messageAdded record pushes maxSeenEventId to E_HI (> E_MID). The gate must compare the
    // LABEL id (E_LO) — NOT maxSeen (E_HI) — against E_MID → E_LO < E_MID → NO requeue. If the
    // code wrongly used maxSeen, E_HI > E_MID would spuriously resurrect the row. lastSeen
    // still advances forward to E_HI (that is the max-seen watermark's job).
    gmail.historyPages.push(
      page(
        [{ id: "m1", threadId: "t-m1", eventKind: "label_added_inbox", maxSeenEventId: E_HI, labelEventId: E_LO }],
        "b3",
        null,
      ),
    );
    await syncHistoryForIntegration(deps, 1);

    const row = store.ledgerFor(1)[0];
    expect(row).toMatchObject({ status: "ignored", requeueCount: 1, lastRequeueEventId: E_MID }); // NOT requeued
    expect(row.lastSeenHistoryId).toBe(E_HI); // max-seen watermark still advanced
    expect(row.lastRequeuedAt).not.toBeNull(); // (from the earlier real requeue, unchanged)
  });
});

// ── Codex 18 輪 §四: 事件消耗水位 = 三值數值 MAX(不是 COALESCE-first-non-null) ──────────
describe("event consumption watermark is the numeric MAX, not COALESCE (Codex 18 輪 §四 — P0-1)", () => {
  // ids > 2^53 so BigInt ordering is load-bearing; E10 < E20 < E30 numerically.
  const E5 = "9007199254740905";
  const E10 = "9007199254740910";
  const E20 = "9007199254740920";
  const E30 = "9007199254740930";
  const mAdded = (id: string, seen: string): DiscoveredMessage => ({
    id,
    threadId: `t-${id}`,
    eventKind: "message_added",
    maxSeenEventId: seen,
    labelEventId: null,
  });

  it("lastRequeue=E10, lastSeen=E30, incoming label=E20 → NO requeue (status/route/requeueCount all unchanged)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: NOISE, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });

    // Build the exact split-watermark state:
    // 1) message_added at E5 → ignored (lastSeen=E5, lastRequeue=null).
    gmail.historyPages.push(page([mAdded("m1", E5)], "b1", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    // 2) label E10 requeues (E10 > MAX(null,E5)=E5) → re-classify noise → ignored,
    //    so lastRequeueEventId=E10, lastSeen advanced to E10.
    gmail.historyPages.push(page([inboxEvent("m1", E10)], "b2", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    // 3) a later message_added sighting at E30 advances forward-only lastSeen to E30 WITHOUT
    //    touching lastRequeueEventId (stays E10). Precondition: lastRequeue=E10, lastSeen=E30.
    gmail.historyPages.push(page([mAdded("m1", E30)], "b3", null));
    await syncHistoryForIntegration(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({
      status: "ignored",
      route: "noise",
      requeueCount: 1,
      lastRequeueEventId: E10,
      lastSeenHistoryId: E30,
    });
    const before = { ...store.ledgerFor(1)[0] };

    // 4) THE fixture: a label event E20 with E10 < E20 < E30. The OLD COALESCE(lastRequeue,
    //    lastSeen) took E10 → E20 > E10 → spurious requeue. The MAX is MAX(E10,E30)=E30 →
    //    E20 not > E30 → NO requeue: status, route, requeueCount ALL unchanged.
    gmail.historyPages.push(page([inboxEvent("m1", E20)], "b4", null));
    await syncHistoryForIntegration(deps, 1);

    const row = store.ledgerFor(1)[0];
    expect(row).toMatchObject({ status: "ignored", route: "noise", requeueCount: 1, lastRequeueEventId: E10 });
    expect(row.lastRequeuedAt).toEqual(before.lastRequeuedAt); // no fresh requeue stamp
    expect(row.lastSeenHistoryId).toBe(E30); // E20 < E30 → forward-only lastSeen unmoved
    expect(store.ledgerFor(1)).toHaveLength(1);
  });
});

// ── Codex 18 輪 §五: 404 recovery baseline-first (P0-2 掃描中新信零永久遺失) ───────────
describe("404 recovery captures the baseline BEFORE the scan (Codex 18 輪 §五 — P0-2)", () => {
  const B_PRESCAN = "9007199254740500";
  const DURING = "9007199254740700"; // a mail arriving during the scan (> B_PRESCAN)
  const B_POSTSCAN = "9007199254740999"; // mailbox head AFTER that mail (≥ DURING)

  it("recovers to the PRE-scan baseline (not the post-scan head); the during-scan mail is caught next History round — zero permanent loss", async () => {
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })] });
    // History 404 → recovery. getProfile (called FIRST now) returns the pre-scan baseline.
    gmail.historyPages.push(page([], null, null, { expired: true }));
    gmail.profileHistoryId = B_PRESCAN;
    // A new mail arrives DURING the scan → the mailbox head advances to B_POSTSCAN. With the
    // OLD order (scan → THEN getProfile) the cursor would jump to B_POSTSCAN, which already
    // covers the new mail's event → the next History round skips it (permanent loss).
    gmail.onScanQuery = () => {
      gmail.profileHistoryId = B_POSTSCAN;
    };
    gmail.scanPages.push({ messages: [{ id: "mold", threadId: "t-old" }], nextPageToken: null });

    const rec = await syncHistoryForIntegration(deps, 1);

    // THE discriminator: cursor is the PRE-scan baseline, NOT the post-scan head.
    expect(rec).toMatchObject({ ok: true, outcome: "recovered", cursor: B_PRESCAN });
    expect((await store.getIntegration(1))!.lastHistoryId).toBe(B_PRESCAN);
    // the scan row persists the pre-scan baseline as its consumed floor (§七), not lastSeen.
    const scanRow = store.ledgerFor(1).find((r) => r.gmailMessageId === "mold")!;
    expect(scanRow).toMatchObject({ source: "fallback_scan", scanConsumedFloor: B_PRESCAN, lastSeenHistoryId: null });

    // the during-scan mail (event > B_PRESCAN) is returned by the NEXT History round from
    // B_PRESCAN → landed. Nothing permanently lost.
    gmail.historyPages.push(page(["mnew"], DURING, null));
    const next = await syncHistoryForIntegration(deps, 1);
    expect(next).toMatchObject({ ok: true, outcome: "advanced", cursor: DURING });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["mnew", "mold"]);
  });
});

// ── Codex 18 輪 §七: scan-created row 的 consumed floor 守第一個真 label(四案) ─────────
describe("scan floor: a scan-created row's consumed floor guards the first real label (Codex 18 輪 §七)", () => {
  const FLOOR = "9007199254740600";
  const ABOVE = "9007199254740700"; // a real new label id > floor
  const BELOW = "9007199254740500"; // a stale label id < floor

  /** bootstrap (null cursor) → getProfile baseline FLOOR → scan creates `ms` with
   *  scanConsumedFloor=FLOOR → classify noise → terminal ignored. */
  async function seedScanRowIgnored() {
    const classifier = new FakeClassifier();
    classifier.set("ms", { from: NOISE, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const deps = makeDeps({
      integrations: [cursor({ lastHistoryId: null, lastSuccessfulSyncAt: null, intakeMode: "history" })],
      classifier,
    });
    deps.gmail.profileHistoryId = FLOOR;
    deps.gmail.scanPages.push({ messages: [{ id: "ms", threadId: "t-ms" }], nextPageToken: null });
    await syncHistoryForIntegration(deps.deps, 1);
    await classifyPendingLedger(deps.deps, 1);
    return deps;
  }

  it("precondition: the scan row stores the baseline as scanConsumedFloor (NOT as lastSeenHistoryId)", async () => {
    const { store } = await seedScanRowIgnored();
    expect(store.ledgerFor(1)[0]).toMatchObject({
      status: "ignored",
      route: "noise",
      scanConsumedFloor: FLOOR,
      lastSeenHistoryId: null,
      lastRequeueEventId: null,
      requeueCount: 0,
    });
  });

  it("1) a real new label (id > floor) requeues the scan row exactly ONCE", async () => {
    const { deps, store, gmail } = await seedScanRowIgnored();
    gmail.historyPages.push(page([inboxEvent("ms", ABOVE)], "b2", null));
    await syncHistoryForIntegration(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({
      status: "pending",
      requeueCount: 1,
      lastRequeueEventId: ABOVE,
      discoveryReason: "inbox_requeue",
    });
  });

  it("2) replaying the SAME event that first crossed the floor never re-requeues (requeueCount stays 1)", async () => {
    const { deps, store, gmail } = await seedScanRowIgnored();
    gmail.historyPages.push(page([inboxEvent("ms", ABOVE)], "b2", null));
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1); // noise again → back to ignored (lastRequeue=ABOVE)
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "ignored", requeueCount: 1 });
    // replay ABOVE → not strictly greater than MAX(ABOVE, ABOVE, FLOOR)=ABOVE → no requeue.
    gmail.historyPages.push(page([inboxEvent("ms", ABOVE)], "b3", null));
    await syncHistoryForIntegration(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "ignored", requeueCount: 1 });
  });

  it("3) a stale label (id < floor) does NOT requeue — the floor holds", async () => {
    const { deps, store, gmail } = await seedScanRowIgnored();
    gmail.historyPages.push(page([inboxEvent("ms", BELOW)], "b2", null));
    await syncHistoryForIntegration(deps, 1);
    const row = store.ledgerFor(1)[0];
    expect(row).toMatchObject({ status: "ignored", route: "noise", requeueCount: 0 });
    expect(row.lastRequeuedAt).toBeNull();
  });

  it("4) a message_added-created row is UNAFFECTED (scanConsumedFloor stays NULL)", async () => {
    const classifier = new FakeClassifier();
    classifier.set("mh", { from: NOISE, isReceipt: false, internalDateMs: 1_780_000_000_000 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });
    gmail.historyPages.push(
      page([{ id: "mh", threadId: "t-mh", eventKind: "message_added", maxSeenEventId: ABOVE, labelEventId: null }], "b1", null),
    );
    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);
    expect(store.ledgerFor(1)[0]).toMatchObject({
      status: "ignored",
      scanConsumedFloor: null,
      lastSeenHistoryId: ABOVE,
    });
  });
});

// ── Codex 16 輪 P0-3: orchestration fencing gate (§六.3/§六.6) ────────────────────
describe("P0-3 orchestration fencing gate (runIntakeStages, Codex 16 輪 §六.3/§六.6)", () => {
  it("predicate: only the authoritative sync winner is granted classify/feed", () => {
    expect(syncGrantsDownstream({ ok: true, outcome: "advanced", landed: 1, cursor: "H2" })).toBe(true);
    expect(syncGrantsDownstream({ ok: true, outcome: "recovered", landed: 0, cursor: "H2" })).toBe(true);
    expect(syncGrantsDownstream({ ok: true, outcome: "bootstrapped", landed: 0, cursor: "H2" })).toBe(true);
    expect(
      syncGrantsDownstream({ ok: true, outcome: "continued", landed: 1, phase: "history", cursor: "H2" }),
    ).toBe(true);
    expect(syncGrantsDownstream({ ok: true, outcome: "noop", reason: "no-history-advance", landed: 0 })).toBe(true);
    // non-authoritative → blocked
    expect(syncGrantsDownstream({ ok: true, outcome: "noop", reason: "lost-fencing-token", landed: 0 })).toBe(false);
    expect(syncGrantsDownstream({ ok: true, outcome: "noop", reason: "cas-lost-to-concurrent", landed: 0 })).toBe(false);
    expect(syncGrantsDownstream({ ok: true, outcome: "noop", reason: "locked-by-concurrent-writer" })).toBe(false);
    expect(syncGrantsDownstream({ ok: false, reason: "history-list-failed" })).toBe(false);
  });

  it("a runner that loses the fencing token mid-sync is DENIED classify+feed (m1 never fed)", async () => {
    const downstream = new FakeDownstream();
    const { deps, store, gmail, lock } = makeDeps({
      integrations: [cursor({ intakeMode: "history" })],
      downstream,
    });
    await seedClassifiedCustomer(store); // m1 classified pending customer, ready to feed

    // a sync round that lands a page but loses the fencing token right before the CAS.
    gmail.historyPages.push(page(["m2"], "H2", null));
    lock.failVerify = true;
    const out = await runIntakeStages(deps, 1, "history");

    expect(out.sync).toMatchObject({ ok: true, outcome: "noop", reason: "lost-fencing-token" });
    expect(out.classify).toBeUndefined(); // gate denied
    expect(out.feed).toBeUndefined();
    expect(downstream.processed).toEqual([]); // m1 was NOT fed
    expect(store.ledgerFor(1).find((r) => r.gmailMessageId === "m1")).toMatchObject({ status: "pending" });
  });

  it("a locked-out runner (a concurrent writer holds the fencing lock) is DENIED classify+feed", async () => {
    const downstream = new FakeDownstream();
    const { deps, store, lock } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], downstream });
    await seedClassifiedCustomer(store);
    lock.refuseAcquire = true; // a concurrent writer already holds the fencing lock
    const out = await runIntakeStages(deps, 1, "history");
    expect(out.sync).toMatchObject({ outcome: "noop", reason: "locked-by-concurrent-writer" });
    expect(out.classify).toBeUndefined();
    expect(out.feed).toBeUndefined();
    expect(downstream.processed).toEqual([]);
  });

  it("the authoritative winner DOES classify+feed (positive control — m1 fed exactly once)", async () => {
    // authoritative gate mocked OPEN here (authoritativeApproved default true) to guard the
    // feed wiring; the fail-closed default is proven in the §五.1 block + gmailAuthoritativeGate.test.ts.
    const downstream = new FakeDownstream();
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], downstream });
    await seedClassifiedCustomer(store);
    gmail.historyPages.push(page([], "H1", null)); // authoritative round, no new mail
    const out = await runIntakeStages(deps, 1, "history");
    expect(out.classify).toBeDefined();
    expect(out.feed).toBeDefined();
    expect(downstream.processed).toEqual(["m1"]);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "processed" });
  });
});

// ── Codex 17 輪 §五.1: authoritative fail-closed hard gate ────────────────────────
describe("authoritative fail-closed gate (runIntakeStages, Codex 17 輪 §五.1)", () => {
  // the whole-file mock defaults authoritativeApproved → true; these tests flip it false
  // to exercise the real production posture. Reset after each so later blocks stay open.
  afterEach(() => authoritativeApproved.mockReturnValue(true));

  it("gate CLOSED + history mode → classify RUNS but feed is REFUSED: zero downstream, rows stay pending, one deduped card", async () => {
    authoritativeApproved.mockReturnValue(false);
    const downstream = new FakeDownstream();
    const { deps, store, gmail, alerts } = makeDeps({
      integrations: [cursor({ intakeMode: "history" })],
      downstream,
    });
    await seedClassifiedCustomer(store); // m1 classified pending customer, ready to feed
    gmail.historyPages.push(page([], "H1", null)); // authoritative round, no new mail

    const out = await runIntakeStages(deps, 1, "history");

    expect(out.classify).toBeDefined(); // classification still runs
    expect(out.feed).toBeUndefined(); // feed refused by the gate
    expect(downstream.processed).toEqual([]); // ZERO downstream side effect
    // the customer row is unharmed: still pending + classified, ready to feed once opened.
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "pending", route: "customer" });
    // exactly one authoritative-blocked card.
    const blocked = alerts.cards.filter((c) => c.body.includes("authoritative_blocked"));
    expect(blocked).toHaveLength(1);
    expect(blocked[0].priority).toBe("high");

    // a SECOND round → still zero feed, and the card is deduped (still exactly one).
    gmail.historyPages.push(page([], "H1", null));
    const out2 = await runIntakeStages(deps, 1, "history");
    expect(out2.feed).toBeUndefined();
    expect(downstream.processed).toEqual([]);
    expect(alerts.cards.filter((c) => c.body.includes("authoritative_blocked"))).toHaveLength(1);
  });

  it("direct feeder call + gate CLOSED → claims + processes NOTHING (Codex 18 §六.1 sink gate — the direct-caller bypass反證)", async () => {
    // Codex 反證: calling feedPendingDownstream DIRECTLY (bypassing runIntakeStages' front
    // guard) with gate=false previously still returned processed=1. The sink gate inside the
    // feeder body now refuses to claim/process anything while the gate is closed.
    authoritativeApproved.mockReturnValue(false);
    const downstream = new FakeDownstream();
    const { deps, store } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], downstream });
    await seedClassifiedCustomer(store); // m1 pending customer, ready to feed

    const res = await feedPendingDownstream(deps, 1);

    expect(res).toMatchObject({ processed: 0, failed: 0, ignored: 0, deadLettered: 0, lostLease: 0 });
    expect(downstream.processed).toEqual([]); // ZERO downstream side effect
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "pending", route: "customer" }); // unharmed
  });

  it("gate CLOSED + shadow mode → unaffected (shadow never feeds, no block card)", async () => {
    authoritativeApproved.mockReturnValue(false);
    const downstream = new FakeDownstream();
    const { deps, store, gmail, alerts } = makeDeps({
      integrations: [cursor({ intakeMode: "shadow" })],
      downstream,
    });
    // a discovered customer mail → shadow classifies it TERMINAL ignored (wouldRoute), and
    // never reaches the feed path (mode !== history) → the gate is irrelevant to shadow.
    gmail.historyPages.push(page(["m1"], "H2", null));

    const out = await runIntakeStages(deps, 1, "shadow");

    expect(out.classify).toBeDefined();
    expect(out.feed).toBeUndefined(); // shadow never feeds regardless of the gate
    expect(downstream.processed).toEqual([]); // zero side effect
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "ignored", wouldRoute: "customer" });
    // no authoritative-blocked card — the block only concerns history-mode feed.
    expect(alerts.cards.filter((c) => c.body.includes("authoritative_blocked"))).toHaveLength(0);
  });
});

// ── Codex 16 輪 P0-3: DB row claim (§六.6-7) ──────────────────────────────────────
describe("P0-3 row claim: concurrent runners never double-process (Codex 16 輪 §六.6-7)", () => {
  const EVENT = "9007199254740993";
  function seedUnclassified(store: FakeStore, id = "m1"): Promise<number> {
    return store.insertMinimalIgnore([
      { integrationId: 1, gmailMessageId: id, gmailThreadId: `t-${id}`, maxSeenEventId: EVENT, labelEventId: null, source: "history", eventKind: "message_added" },
    ]);
  }

  it("§六.6 two interleaved feeders → downstream.process runs EXACTLY once for the same message", async () => {
    const downstream = new FakeDownstream();
    const { deps, store } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], downstream });
    await seedClassifiedCustomer(store); // m1 pending customer

    // While runner A is mid-process on m1 (m1 leased by A), runner B tries to feed. B's
    // claimActionable finds m1 already leased → B claims a DISJOINT (empty) set → B never
    // processes. downstream.process therefore fires exactly once (A only).
    let bResult: Awaited<ReturnType<typeof feedPendingDownstream>> | null = null;
    downstream.onProcess = async (id) => {
      if (id === "m1" && bResult === null) {
        bResult = await feedPendingDownstream(deps, 1);
      }
    };
    const aResult = await feedPendingDownstream(deps, 1);

    expect(downstream.processed).toEqual(["m1"]); // EXACTLY once
    expect(aResult.processed).toBe(1);
    expect(bResult!.processed).toBe(0); // B was handed nothing
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "processed" });
  });

  it("§五 corruption guard: a stale-token markFailed can NOT flip a peer's processed row → failed", async () => {
    const { store } = makeDeps({ integrations: [cursor({ intakeMode: "history" })] });
    await seedClassifiedCustomer(store);
    const rowId = store.ledgerFor(1)[0].id;
    const nowMs = 1_780_000_100_000;
    // Runner A claims + processes m1 → processed (lease released).
    const claimedA = await store.claimActionable(1, "A", new Date(nowMs + 120_000), nowMs);
    expect(claimedA).toHaveLength(1);
    expect(await store.markProcessed(rowId, 7777, new Date(nowMs), "A")).toBe(true);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "processed", claimToken: null });
    // Runner B, holding a stale token, hits a downstream UNIQUE-key collision and calls
    // markFailed — the row no longer holds B's token → REJECTED, stays processed.
    const won = await store.markFailed(
      rowId,
      { failureKind: "db", httpStatus: null, errorDetail: "dup" },
      1,
      new Date(nowMs + 60_000),
      new Date(nowMs),
      "B",
    );
    expect(won).toBe(false);
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "processed" }); // NOT failed
  });

  it("§六.7 claim expiry → a peer re-claims only AFTER the lease lapses", async () => {
    const { store } = makeDeps();
    await seedUnclassified(store);
    const t0 = 1_780_000_100_000;
    const a = await store.claimUnclassified(1, "A", new Date(t0 + 120_000), t0);
    expect(a).toHaveLength(1);
    // before expiry, B cannot claim it.
    expect(await store.claimUnclassified(1, "B", new Date(t0 + 240_000), t0 + 60_000)).toHaveLength(0);
    // after expiry, B re-claims it.
    const bLate = await store.claimUnclassified(1, "B", new Date(t0 + 360_000), t0 + 121_000);
    expect(bLate).toHaveLength(1);
    expect(store.ledgerFor(1)[0].claimToken).toBe("B");
  });

  it("§六.7 two classifiers competing for the same row → only one wins", async () => {
    const { store } = makeDeps();
    await seedUnclassified(store);
    const t0 = 1_780_000_100_000;
    const a = await store.claimUnclassified(1, "A", new Date(t0 + 120_000), t0);
    const b = await store.claimUnclassified(1, "B", new Date(t0 + 120_000), t0); // same instant
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0); // B loses — already leased by A
    expect(store.ledgerFor(1)[0].claimToken).toBe("A");
  });

  it("§六.7 a stale-token classify write is rejected (lost lease → no state change)", async () => {
    const { store } = makeDeps();
    await seedUnclassified(store);
    const rowId = store.ledgerFor(1)[0].id;
    const t0 = 1_780_000_100_000;
    await store.claimUnclassified(1, "A", new Date(t0 + 120_000), t0); // A holds the lease
    const won = await store.classify(
      rowId,
      { fromAddress: CUSTOMER, route: "customer", wouldRoute: null, internalDateMs: 1, classifiedAt: new Date(t0), status: "pending" },
      "STALE",
    );
    expect(won).toBe(false);
    expect(store.ledgerFor(1)[0]).toMatchObject({ route: null, status: "pending" }); // untouched
  });
});

// ── Codex 16 輪對抗審查修正: per-message claim heartbeat during feed ──────────────
describe("P0-3 claim heartbeat: a single slow downstream message keeps its lease (對抗審查修正)", () => {
  it("heartbeat renews BEFORE the lease expiry → coverage is continuous, no gap window ever opens (Codex 17 §六.1)", async () => {
    // Proof of NO GAP (not just "renew eventually works"): renew at t+60 — while the
    // ORIGINAL t+120 lease is still valid — extending it to t+180, THEN let a peer claim
    // at t+130. t+130 is past the original t+120 expiry but inside the renewed t+180, so
    // the peer must find the row still leased. Because the renew landed BEFORE t+120, the
    // lease was valid across the ENTIRE [t0, t+180] span — there is no instant a peer
    // could have won. (The old test renewed at t+130, AFTER t+120, leaving the t+120→t+130
    // window unproven.)
    let tNow = 1_780_000_100_000; // t0; claim lease → t0+120_000, heartbeat interval 60_000
    const sleeps = manualSleep();
    const downstream = new FakeDownstream();
    const { deps, store } = makeDeps({
      integrations: [cursor({ intakeMode: "history" })],
      downstream,
      clock: () => tNow,
      heartbeatSleep: sleeps.fn,
    });
    await seedClassifiedCustomer(store);

    let peer: Awaited<ReturnType<typeof feedPendingDownstream>> | null = null;
    let acted = false;
    downstream.onProcess = async (id) => {
      if (id !== "m1" || acted) return;
      acted = true;
      // t+60 — INSIDE the original t+120 lease. The heartbeat fires and renews to t+180.
      tNow += 60_000;
      sleeps.tick();
      await macroTick(); // let the renew land (lease t0+120 → t0+180, no gap)
      // t+130 — past the ORIGINAL t+120 expiry, inside the renewed t+180. A peer feeding
      // NOW must be handed NOTHING (row still leased). WITHOUT the mid-lease renew the lease
      // would have lapsed at t+120 and the peer would re-claim + re-process (§六.7 shows that).
      tNow += 70_000;
      peer = await feedPendingDownstream(deps, 1);
    };

    const res = await feedPendingDownstream(deps, 1);

    expect(peer!.processed).toBe(0); // peer was handed NOTHING mid-flight (lease never lapsed)
    expect(peer!.lostLease).toBe(0);
    expect(downstream.processed).toEqual(["m1"]); // downstream fired exactly once
    expect(res).toMatchObject({ processed: 1, lostLease: 0 }); // winner completed + wrote back
    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "processed", claimToken: null });
  });

  // ⚠ DO NOT DELETE — this test is the AT-LEAST-ONCE counter-evidence (Codex 17 §六.3):
  // it proves the downstream SIDE EFFECT is at-least-once (m1's process fires twice in the
  // heartbeat-failure window), which is exactly WHY authoritative feed is HARD-BLOCKED by
  // gmailAuthoritativeGate until every side effect has a durable idempotency key / outbox.
  // Removing it to make a guarantee "look" exactly-once would erase the proof the hard gate
  // exists for. It stays green as documented at-least-once behaviour, not a bug.
  it("at-least-once counter-evidence (authoritative 硬擋的反證,不得刪): heartbeat renew FAILURE → no write-back, round STOPS, row re-fed → m1 processed TWICE", async () => {
    let tNow = 1_780_000_100_000;
    const sleeps = manualSleep();
    const downstream = new FakeDownstream();
    const { deps, store } = makeDeps({
      integrations: [cursor({ intakeMode: "history" })],
      downstream,
      clock: () => tNow,
      heartbeatSleep: sleeps.fn,
    });
    await seedClassifiedCustomer(store, CUSTOMER, "m1");
    await seedClassifiedCustomer(store, CUSTOMER, "m2"); // second row proves the round stops

    let acted = false;
    downstream.onProcess = async (id) => {
      if (id !== "m1" || acted) return;
      acted = true;
      // a PEER takes over the row mid-flight (models: our lease lapsed + peer re-claimed).
      const r = store.rows.find((x) => x.gmailMessageId === "m1")!;
      r.claimToken = "PEER";
      r.claimExpiresAt = new Date(tNow + 120_000);
      r.claimStage = "feed";
      // next heartbeat tick: renew carries OUR token → mismatch → lost lease.
      sleeps.tick();
      await macroTick();
    };

    const res = await feedPendingDownstream(deps, 1);

    // m1's downstream DID run (the honest at-least-once window), but the ledger write-
    // back was aborted and the whole round stopped: m2 was never touched by this runner.
    expect(downstream.processed).toEqual(["m1"]);
    expect(res).toMatchObject({ processed: 0, failed: 0, lostLease: 1 });
    const byId = Object.fromEntries(store.ledgerFor(1).map((r) => [r.gmailMessageId, r]));
    expect(byId.m1).toMatchObject({ status: "pending", claimToken: "PEER" }); // OUR write rejected/aborted
    expect(byId.m2).toMatchObject({ status: "pending" }); // round stopped before m2

    // after ALL leases lapse, a fresh runner picks BOTH rows up (at-least-once recovery;
    // m1's duplicate downstream call is absorbed by external-id idempotency, design §5).
    downstream.onProcess = null;
    tNow += 300_000;
    const res2 = await feedPendingDownstream(deps, 1);
    expect(res2.processed).toBe(2);
    expect(downstream.processed).toEqual(["m1", "m1", "m2"]); // the documented duplicate
    expect(store.ledgerFor(1).every((r) => r.status === "processed")).toBe(true);
  });
});

// ── pure classifiers ───────────────────────────────────────────────────────────

describe("classifyFailure + computeNextRetryAt (F skeleton)", () => {
  it("classifies HTTP status buckets", () => {
    expect(classifyFailure(Object.assign(new Error("x"), { status: 401 })).failureKind).toBe("auth");
    expect(classifyFailure(Object.assign(new Error("x"), { status: 403 })).failureKind).toBe("auth");
    expect(classifyFailure(Object.assign(new Error("x"), { code: 429 })).failureKind).toBe("gmail_api");
    expect(classifyFailure(Object.assign(new Error("x"), { status: 500 })).failureKind).toBe("gmail_api");
    expect(classifyFailure(Object.assign(new Error("x"), { response: { status: 503 } })).failureKind).toBe("gmail_api");
  });
  it("classifies by message/code keywords", () => {
    expect(classifyFailure(new Error("invalid_grant: token revoked")).failureKind).toBe("auth");
    expect(classifyFailure(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" })).failureKind).toBe("db");
    expect(classifyFailure(new Error("attachment parse blew up")).failureKind).toBe("attachment");
    expect(classifyFailure(new Error("anthropic model overloaded")).failureKind).toBe("llm");
    expect(classifyFailure(new Error("something weird")).failureKind).toBe("unknown");
  });
  it("exponential backoff, then terminal at MAX_RETRIES", () => {
    const now = 1_000_000;
    expect(computeNextRetryAt(1, now)!.getTime()).toBe(now + 120_000);
    expect(computeNextRetryAt(2, now)!.getTime()).toBe(now + 240_000);
    expect(computeNextRetryAt(3, now)).toBeNull(); // terminal
  });
});

describe("normalizeFromAddress — bare lowercase, display name dropped", () => {
  it("strips the display name and lowercases the address", () => {
    expect(normalizeFromAddress("Jeff Hsieh <Jeff@Example.COM>")).toBe("jeff@example.com");
  });
  it("passes a bare address through lowercased", () => {
    expect(normalizeFromAddress("CUSTOMER@Example.com")).toBe("customer@example.com");
  });
  it("never throws on unparseable input + bounds to 320 chars", () => {
    expect(normalizeFromAddress("not an address")).toBe("not an address");
    expect(normalizeFromAddress("x".repeat(400))).toHaveLength(320);
  });
});

describe("classification lands a normalized fromAddress at classify time", () => {
  it("a display-name From is classified to a bare lowercase address", async () => {
    const classifier = new FakeClassifier();
    classifier.set("m1", { from: "Jane Customer <Jane.Customer@Example.COM>", isReceipt: false, internalDateMs: 1 });
    const { deps, store, gmail } = makeDeps({ integrations: [cursor({ intakeMode: "history" })], classifier });
    gmail.historyPages.push(page(["m1"], "H2", null));

    await syncHistoryForIntegration(deps, 1);
    await classifyPendingLedger(deps, 1);

    expect(store.ledgerFor(1)[0].fromAddress).toBe("jane.customer@example.com");
  });
});

describe("errorSummary — first line only + email redaction + bound", () => {
  it("keeps only the first line (drops appended payload/stack after a newline)", () => {
    expect(errorSummary(new Error("boom\ncustomer@example.com asked about Paris"))).toBe("boom");
  });
  it("redacts an email-like token left on the first line", () => {
    expect(errorSummary(new Error("rejected mail from customer@example.com now"))).toBe(
      "rejected mail from [redacted-email] now",
    );
  });
  it("bounds to 512 chars", () => {
    expect(errorSummary(new Error("a".repeat(900)))).toHaveLength(512);
  });
});
