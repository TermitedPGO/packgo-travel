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
import { describe, it, expect } from "vitest";
import {
  syncHistoryForIntegration,
  classifyPendingLedger,
  feedPendingDownstream,
  classifyFailure,
  computeNextRetryAt,
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
  type LedgerRow,
  type LedgerStatus,
  type FailureKind,
  type IntakeRoute,
} from "./gmailHistorySync";

// ── in-memory fakes ──────────────────────────────────────────────────────────

type FakeRow = LedgerRow & { firstSeenMs: number };

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
    let inserted = 0;
    for (const r of rows) {
      const dup = this.rows.find(
        (x) => x.integrationId === r.integrationId && x.gmailMessageId === r.gmailMessageId,
      );
      if (dup) continue;
      this.rows.push({
        id: this.nextId++,
        integrationId: r.integrationId,
        gmailMessageId: r.gmailMessageId,
        gmailThreadId: r.gmailThreadId,
        gmailHistoryId: r.gmailHistoryId,
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
        firstSeenMs: this.clock(),
      });
      inserted++;
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
  async listUnclassified(id: number, nowMs: number) {
    return this.rows
      .filter(
        (r) =>
          r.integrationId === id &&
          r.status === "pending" &&
          r.route === null &&
          // classify-retry backoff gate (對抗審查修正 2)
          (r.nextRetryAt == null || r.nextRetryAt.getTime() <= nowMs),
      )
      .sort((a, b) => a.id - b.id)
      .slice(0, this.batchCap)
      .map((r) => ({ ...r }));
  }
  async recordClassifyFailure(
    ledgerId: number,
    cls: { failureKind: FailureKind; httpStatus: number | null; errorDetail: string | null },
    retryCount: number,
    nextRetryAt: Date,
  ) {
    const r = this.rows.find((x) => x.id === ledgerId);
    if (r) {
      // NON-terminal: status stays pending, route stays NULL.
      r.failureKind = cls.failureKind;
      r.httpStatus = cls.httpStatus;
      r.retryCount = retryCount;
      r.nextRetryAt = nextRetryAt;
    }
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
  ) {
    const r = this.rows.find((x) => x.id === ledgerId);
    if (r) {
      r.fromAddress = fields.fromAddress;
      r.route = fields.route;
      r.wouldRoute = fields.wouldRoute;
      r.internalDateMs = fields.internalDateMs;
      r.status = fields.status;
    }
  }
  async listActionable(id: number, nowMs: number) {
    return this.rows
      .filter(
        (r) =>
          r.integrationId === id &&
          ((r.status === "pending" && (r.route === "customer" || r.route === "receipt")) ||
            (r.status === "failed" &&
              r.nextRetryAt != null &&
              r.nextRetryAt.getTime() <= nowMs &&
              r.retryCount < 3)),
      )
      .sort((a, b) => a.id - b.id)
      .slice(0, this.batchCap)
      .map((r) => ({ ...r }));
  }
  async markProcessed(ledgerId: number, interactionId: number | null) {
    const r = this.rows.find((x) => x.id === ledgerId);
    if (r) {
      r.status = "processed";
      r.interactionId = interactionId;
      r.nextRetryAt = null;
    }
  }
  async markIgnored(ledgerId: number, failureKind: FailureKind) {
    const r = this.rows.find((x) => x.id === ledgerId);
    if (r) {
      r.status = "ignored";
      r.failureKind = failureKind;
      r.nextRetryAt = null;
    }
  }
  async markFailed(
    ledgerId: number,
    cls: { failureKind: FailureKind; httpStatus: number | null; errorDetail: string | null },
    retryCount: number,
    nextRetryAt: Date | null,
  ) {
    const r = this.rows.find((x) => x.id === ledgerId);
    if (r) {
      r.status = "failed";
      r.failureKind = cls.failureKind;
      r.httpStatus = cls.httpStatus;
      r.retryCount = retryCount;
      r.nextRetryAt = nextRetryAt;
    }
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
  async scanQueryPage(query: string, _pageToken: string | null) {
    this.scanQueries.push(query);
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
  async process(row: LedgerRow) {
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
  const msgs: DiscoveredMessage[] = messages.map((m) =>
    typeof m === "string" ? { id: m, threadId: `t-${m}` } : m,
  );
  return { messages: msgs, boundaryHistoryId, nextPageToken, ...extra };
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
  };
  return { deps, store, gmail, lock, alerts, classifier };
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
  /** seed a classified pending customer row directly (skip discovery for brevity). */
  async function seedClassifiedCustomer(store: FakeStore, from = CUSTOMER, id = "m1") {
    await store.insertMinimalIgnore([
      { integrationId: 1, gmailMessageId: id, gmailThreadId: `t-${id}`, gmailHistoryId: "H2", source: "history" },
    ]);
    const row = store.ledgerFor(1).find((r) => r.gmailMessageId === id)!;
    await store.classify(row.id, {
      fromAddress: from,
      route: "customer",
      wouldRoute: null,
      internalDateMs: 1_780_000_000_000,
      classifiedAt: new Date(1_780_000_050_000),
      status: "pending",
    });
  }

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
