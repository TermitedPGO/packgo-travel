/**
 * gmail-intake-ledger — red/green tests for the History sync engine + downstream
 * feeder + F skeleton. Everything runs against in-memory fakes (ledger store /
 * lock / gmail / alerts / downstream) — ZERO real DB, Redis, Gmail, or network
 * (禁真實資料禁真網路). No fixed waits: every effect is awaited directly.
 *
 * Covers: read-before-poll, same-thread double message, duplicate-push idempotency,
 * page-2 crash (cursor frozen + zero-loss/zero-dup restart), crash-before-CAS
 * (fencing) idempotent replay, History 404 → bounded fallback rebaseline,
 * bootstrap, CAS-does-not-clobber-newer-cursor, lost-fencing-token, eligibility
 * gating, label-post-commit idempotency, and OAuth 401/429/5xx classify + backoff
 * + dead-letter.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  syncHistoryForIntegration,
  feedPendingDownstream,
  classifyFailure,
  computeNextRetryAt,
  buildFallbackQuery,
  normalizeFromAddress,
  errorSummary,
  type GmailIntakePort,
  type LockPort,
  type LedgerStore,
  type AlertPort,
  type DownstreamPort,
  type HistorySyncDeps,
  type IntegrationCursor,
  type LedgerCandidate,
  type LedgerRow,
  type LedgerStatus,
  type FailureKind,
} from "./gmailHistorySync";
import type { GmailMessageMetadata } from "../_core/gmail";

// ── in-memory fakes ──────────────────────────────────────────────────────────

type FakeRow = LedgerRow & { firstSeenMs: number };

class FakeStore implements LedgerStore {
  integrations = new Map<number, IntegrationCursor>();
  rows: FakeRow[] = [];
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
  async insertIgnore(rows: LedgerCandidate[]) {
    let inserted = 0;
    for (const r of rows) {
      const dup = this.rows.find(
        (x) => x.integrationId === r.integrationId && x.gmailMessageId === r.gmailMessageId,
      );
      if (dup) continue;
      this.rows.push({
        id: this.nextId++,
        ...r,
        status: "pending",
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
  async advanceCursorCAS(
    id: number,
    expected: string | null,
    newId: string,
    syncedAt: Date,
  ) {
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
  async listActionable(id: number, nowMs: number) {
    return this.rows
      .filter(
        (r) =>
          r.integrationId === id &&
          (r.status === "pending" ||
            (r.status === "failed" &&
              r.nextRetryAt != null &&
              r.nextRetryAt.getTime() <= nowMs &&
              r.retryCount < 3)),
      )
      .sort((a, b) => a.id - b.id)
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
      .filter(
        (r) => r.integrationId === id && statuses.includes(r.status) && nowMs - r.firstSeenMs > olderThanMs,
      )
      .sort((a, b) => a.firstSeenMs - b.firstSeenMs)[0];
    if (!cand) return null;
    return {
      gmailMessageId: cand.gmailMessageId,
      failureKind: cand.failureKind,
      ageMs: nowMs - cand.firstSeenMs,
    };
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

class FakeGmail implements GmailIntakePort {
  historyQueue: Array<
    | { messageIds: string[]; latestHistoryId: string | null; expired: boolean; truncated?: boolean }
    | Error
  > = [];
  metadata = new Map<string, GmailMessageMetadata>();
  scanResults: GmailMessageMetadata[] = [];
  scanTruncated = false;
  profileHistoryId = "H_PROFILE";
  profileThrows: Error | null = null;
  onFetchMetadata: (() => void | Promise<void>) | null = null;
  collectCalls = 0;
  async collectHistoryAdded(_start: string) {
    this.collectCalls++;
    const next = this.historyQueue.shift();
    if (!next) throw new Error("no scripted history response");
    if (next instanceof Error) throw next;
    return {
      messageIds: next.messageIds,
      latestHistoryId: next.latestHistoryId,
      expired: next.expired,
      truncated: next.truncated ?? false,
    };
  }
  async fetchMetadata(ids: string[]) {
    if (this.onFetchMetadata) await this.onFetchMetadata();
    return ids.map((id) => this.metadata.get(id)).filter((m): m is GmailMessageMetadata => !!m);
  }
  async scanQueryMetadata(_q: string) {
    return { metas: this.scanResults, truncated: this.scanTruncated };
  }
  async getMailboxHistoryId() {
    if (this.profileThrows) throw this.profileThrows;
    return this.profileHistoryId;
  }
  addMessage(m: GmailMessageMetadata) {
    this.metadata.set(m.id, m);
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

function meta(id: string, from = CUSTOMER, threadId = `t-${id}`, ms = 1_780_000_000_000): GmailMessageMetadata {
  return { id, threadId, from, internalDateMs: ms };
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

function makeDeps(overrides: {
  integrations?: IntegrationCursor[];
  clock?: () => number;
  downstream?: DownstreamPort;
} = {}) {
  const clock = overrides.clock ?? (() => 1_780_000_100_000);
  const store = new FakeStore(overrides.integrations ?? [cursor()], clock);
  const gmail = new FakeGmail();
  const lock = new FakeLock();
  const alerts = new FakeAlerts();
  const deps: HistorySyncDeps = { gmail, store, lock, alerts, downstream: overrides.downstream, clock };
  return { deps, store, gmail, lock, alerts };
}

// ── engine: discovery / ledger / cursor ──────────────────────────────────────

describe("syncHistoryForIntegration — discovery lands ledger + advances cursor", () => {
  it("read-before-poll: a message discovered via History (not is:unread) lands regardless of read state", async () => {
    const { deps, store, gmail } = makeDeps();
    // History diff returns m1 — the engine never queries is:unread, so whether
    // Jeff already opened it is irrelevant; it is still discovered + landed.
    gmail.historyQueue.push({ messageIds: ["m1"], latestHistoryId: "H2", expired: false });
    gmail.addMessage(meta("m1"));

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "advanced", landed: 1, cursor: "H2" });
    const ledger = store.ledgerFor(1);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ gmailMessageId: "m1", status: "pending", source: "history" });
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H2");
  });

  it("same thread, two messages → two independent ledger rows (message-level key)", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyQueue.push({ messageIds: ["m1", "m2"], latestHistoryId: "H2", expired: false });
    gmail.addMessage(meta("m1", CUSTOMER, "shared-thread"));
    gmail.addMessage(meta("m2", CUSTOMER, "shared-thread"));

    await syncHistoryForIntegration(deps, 1);

    const ledger = store.ledgerFor(1);
    expect(ledger.map((r) => r.gmailMessageId).sort()).toEqual(["m1", "m2"]);
    expect(new Set(ledger.map((r) => r.gmailThreadId))).toEqual(new Set(["shared-thread"]));
  });

  it("duplicate push / re-diff of the same message → exactly ONE ledger row", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyQueue.push({ messageIds: ["m1"], latestHistoryId: "H2", expired: false });
    gmail.historyQueue.push({ messageIds: ["m1"], latestHistoryId: "H3", expired: false });
    gmail.addMessage(meta("m1"));

    await syncHistoryForIntegration(deps, 1); // first delivery
    await syncHistoryForIntegration(deps, 1); // redelivery re-sees m1

    expect(store.ledgerFor(1).filter((r) => r.gmailMessageId === "m1")).toHaveLength(1);
  });

  it("eligibility gate: own-email + known-noise senders are NOT landed", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyQueue.push({ messageIds: ["m1", "m2", "m3"], latestHistoryId: "H2", expired: false });
    gmail.addMessage(meta("m1", CUSTOMER));
    gmail.addMessage(meta("m2", OWN));
    gmail.addMessage(meta("m3", NOISE));

    await syncHistoryForIntegration(deps, 1);

    expect(store.ledgerFor(1).map((r) => r.gmailMessageId)).toEqual(["m1"]);
  });
});

// ── engine: crash / atomicity / concurrency ──────────────────────────────────

describe("syncHistoryForIntegration — 順序鐵律 + fencing + CAS", () => {
  it("page-2 crash during pagination → cursor frozen; restart backfills zero-loss zero-dup", async () => {
    const { deps, store, gmail } = makeDeps();
    // call 1 throws mid-pagination (nothing collected → nothing landed).
    gmail.historyQueue.push(new Error("history.list network error on page 2"));
    // call 2 (restart) returns the FULL set.
    gmail.historyQueue.push({ messageIds: ["m1", "m2"], latestHistoryId: "H2", expired: false });
    gmail.addMessage(meta("m1"));
    gmail.addMessage(meta("m2"));

    const crash = await syncHistoryForIntegration(deps, 1);
    expect(crash).toMatchObject({ ok: false, reason: "history-list-failed" });
    expect(store.ledgerFor(1)).toHaveLength(0);
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H1"); // frozen

    const restart = await syncHistoryForIntegration(deps, 1);
    expect(restart).toMatchObject({ ok: true, outcome: "advanced", cursor: "H2" });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["m1", "m2"]);
  });

  it("crash after ledger insert but before CAS (lost fencing) → cursor frozen; replay dedups then advances", async () => {
    const { deps, store, gmail, lock } = makeDeps();
    gmail.historyQueue.push({ messageIds: ["m1"], latestHistoryId: "H2", expired: false });
    gmail.historyQueue.push({ messageIds: ["m1"], latestHistoryId: "H2", expired: false });
    gmail.addMessage(meta("m1"));

    // simulate crash-before-CAS: fencing token verify fails right before advance.
    lock.failVerify = true;
    const r1 = await syncHistoryForIntegration(deps, 1);
    expect(r1).toMatchObject({ ok: true, outcome: "noop", reason: "lost-fencing-token" });
    expect(store.ledgerFor(1)).toHaveLength(1); // ledger DID land (durable-first)
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H1"); // cursor frozen

    // restart with a healthy lock: re-diff same window, INSERT IGNORE dedups.
    lock.failVerify = false;
    const r2 = await syncHistoryForIntegration(deps, 1);
    expect(r2).toMatchObject({ ok: true, outcome: "advanced", cursor: "H2" });
    expect(store.ledgerFor(1)).toHaveLength(1); // still ONE row (zero dup)
  });

  it("CAS does not clobber a newer cursor written by a concurrent writer", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyQueue.push({ messageIds: ["m1"], latestHistoryId: "H2", expired: false });
    gmail.addMessage(meta("m1"));
    // a concurrent writer advances the cursor H1→H_CONCURRENT during our fetch,
    // AFTER we read cursor=H1 but BEFORE our CAS.
    gmail.onFetchMetadata = async () => {
      await store.advanceCursorCAS(1, "H1", "H_CONCURRENT", new Date());
    };

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "noop", reason: "cas-lost-to-concurrent" });
    // our stale H2 must NOT overwrite the newer H_CONCURRENT.
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H_CONCURRENT");
  });

  it("a second concurrent writer cannot even acquire the fencing lock", async () => {
    const { deps, gmail, lock } = makeDeps();
    lock.refuseAcquire = true; // lock already held by writer 1
    gmail.historyQueue.push({ messageIds: ["m1"], latestHistoryId: "H2", expired: false });
    const res = await syncHistoryForIntegration(deps, 1);
    expect(res).toMatchObject({ ok: true, outcome: "noop", reason: "locked-by-concurrent-writer" });
    expect(gmail.collectCalls).toBe(0); // never even diffed
  });
});

// ── engine: 404 fallback + bootstrap ─────────────────────────────────────────

describe("syncHistoryForIntegration — 404 bounded fallback + bootstrap", () => {
  it("History 404 → bounded -label fallback scan lands the gap, then getProfile rebaselines", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyQueue.push({ messageIds: [], latestHistoryId: null, expired: true });
    gmail.scanResults = [meta("mf1"), meta("mf2", NOISE)]; // one eligible, one noise
    gmail.profileHistoryId = "H_REBUILT";

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "recovered", cursor: "H_REBUILT" });
    const ledger = store.ledgerFor(1);
    expect(ledger.map((r) => r.gmailMessageId)).toEqual(["mf1"]); // noise excluded
    expect(ledger[0].source).toBe("fallback_scan");
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H_REBUILT");
  });

  it("bootstrap: no lastHistoryId → getProfile baseline + one fallback scan", async () => {
    const { deps, store, gmail } = makeDeps({
      integrations: [cursor({ lastHistoryId: null, lastSuccessfulSyncAt: null })],
    });
    gmail.profileHistoryId = "H_BOOT";
    gmail.scanResults = [meta("mb1")];

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "bootstrapped", cursor: "H_BOOT" });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId)).toEqual(["mb1"]);
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H_BOOT");
  });

  it("bounded fallback query re-overlaps 24h + excludes processed/noreply", () => {
    const since = 1_780_000_000_000 - 24 * 60 * 60 * 1000;
    expect(buildFallbackQuery(since)).toBe(
      `after:${Math.floor(since / 1000)} -label:PACKGO_AI_PROCESSED -from:noreply`,
    );
  });

  it("history.list transient failure (non-404) freezes cursor + returns a classified failure", async () => {
    const { deps, store, gmail } = makeDeps();
    const err = Object.assign(new Error("Rate Limit Exceeded"), { code: 429 });
    gmail.historyQueue.push(err);

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: false, reason: "history-list-failed" });
    expect(res.ok === false && res.failure?.failureKind).toBe("gmail_api");
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H1"); // frozen
  });
});

// ── engine: truncation (B1 — 順序鐵律 break, cursor frozen + P1) ──────────────

describe("syncHistoryForIntegration — truncated collection freezes the cursor + alerts", () => {
  it("incremental truncation: subset lands, cursor FROZEN, P1 card (no advance)", async () => {
    const { deps, store, gmail, alerts } = makeDeps();
    // 700-arrived-but-cap-hit: history returns a subset flagged truncated.
    gmail.historyQueue.push({ messageIds: ["m1"], latestHistoryId: "H2", expired: false, truncated: true });
    gmail.addMessage(meta("m1"));

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "truncated", phase: "history", landed: 1 });
    // subset WAS durably landed (能救多少救多少)…
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId)).toEqual(["m1"]);
    // …but the cursor did NOT move past the uncollected tail.
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H1");
    const cards = alerts.cards.filter((c) => c.title.includes("截斷"));
    expect(cards).toHaveLength(1);
    expect(cards[0].priority).toBe("high");
    expect(cards[0].body).toContain("truncation");
    expect(cards[0].body).not.toContain(CUSTOMER); // PII-safe (ids/counts only)
  });

  it("fallback truncation: subset lands, cursor NOT rebaselined (stays expired), P1 card", async () => {
    const { deps, store, gmail, alerts } = makeDeps();
    gmail.historyQueue.push({ messageIds: [], latestHistoryId: null, expired: true });
    gmail.scanResults = [meta("mf1"), meta("mf2")];
    gmail.scanTruncated = true;
    gmail.profileHistoryId = "H_REBUILT";

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "truncated", phase: "fallback" });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["mf1", "mf2"]);
    // cursor stays H1 (the expired one) — NOT jumped to H_REBUILT; next round re-recovers.
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H1");
    expect(alerts.cards.filter((c) => c.title.includes("截斷"))).toHaveLength(1);
  });

  it("bootstrap truncation: subset lands, NO baseline cursor set, P1 card", async () => {
    const { deps, store, gmail, alerts } = makeDeps({
      integrations: [cursor({ lastHistoryId: null, lastSuccessfulSyncAt: null })],
    });
    gmail.profileHistoryId = "H_BOOT";
    gmail.scanResults = [meta("mb1")];
    gmail.scanTruncated = true;

    const res = await syncHistoryForIntegration(deps, 1);

    expect(res).toMatchObject({ ok: true, outcome: "truncated", phase: "bootstrap" });
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId)).toEqual(["mb1"]);
    // cursor stays null — un-bootstrapped, so the next round bootstraps again.
    expect((await store.getIntegration(1))!.lastHistoryId).toBeNull();
    expect(alerts.cards.filter((c) => c.title.includes("截斷"))).toHaveLength(1);
  });

  it("recovery: a later NON-truncated round advances the cursor (freeze is not permanent, dedup holds)", async () => {
    const { deps, store, gmail, alerts } = makeDeps();
    // round 1 truncated (freeze at H1), round 2 drained the backlog (full, advance).
    gmail.historyQueue.push({ messageIds: ["m1"], latestHistoryId: "H2", expired: false, truncated: true });
    gmail.historyQueue.push({ messageIds: ["m1", "m2"], latestHistoryId: "H3", expired: false, truncated: false });
    gmail.addMessage(meta("m1"));
    gmail.addMessage(meta("m2"));

    const r1 = await syncHistoryForIntegration(deps, 1);
    expect(r1).toMatchObject({ ok: true, outcome: "truncated", phase: "history" });
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H1"); // frozen

    const r2 = await syncHistoryForIntegration(deps, 1);
    expect(r2).toMatchObject({ ok: true, outcome: "advanced", cursor: "H3" });
    expect((await store.getIntegration(1))!.lastHistoryId).toBe("H3"); // un-frozen
    // m1 (landed in round 1) deduped by the unique key; m2 newly landed.
    expect(store.ledgerFor(1).map((r) => r.gmailMessageId).sort()).toEqual(["m1", "m2"]);
    // exactly ONE truncation card across both rounds (fingerprint dedup + healthy
    // round posts none; the visible auto-close rides on reconcile Rule 3).
    expect(alerts.cards.filter((c) => c.title.includes("截斷"))).toHaveLength(1);
  });

  it("dedup: two consecutive truncated rounds → exactly ONE card (per-phase fingerprint)", async () => {
    const { deps, gmail, alerts } = makeDeps();
    gmail.historyQueue.push({ messageIds: ["m1"], latestHistoryId: "H2", expired: false, truncated: true });
    gmail.historyQueue.push({ messageIds: ["m1"], latestHistoryId: "H2", expired: false, truncated: true });
    gmail.addMessage(meta("m1"));

    await syncHistoryForIntegration(deps, 1);
    await syncHistoryForIntegration(deps, 1);

    expect(alerts.cards.filter((c) => c.title.includes("截斷"))).toHaveLength(1);
  });
});

// ── downstream feeder + F skeleton ───────────────────────────────────────────

describe("feedPendingDownstream — history mode terminal states + F skeleton", () => {
  async function seedPending(store: FakeStore, from = CUSTOMER, id = "m1") {
    await store.insertIgnore([
      {
        integrationId: 1,
        gmailMessageId: id,
        gmailThreadId: `t-${id}`,
        gmailHistoryId: "H2",
        internalDateMs: 1_780_000_000_000,
        fromAddress: from,
        source: "history",
      },
    ]);
  }

  it("pending → processed (+interactionId); a processed row is never re-fed (label is post-commit)", async () => {
    const downstream = new FakeDownstream();
    downstream.behavior.set("m1", { interactionId: 4242 });
    const { deps, store } = makeDeps({ downstream });
    await seedPending(store);

    const r1 = await feedPendingDownstream(deps, 1);
    expect(r1).toMatchObject({ processed: 1, failed: 0 });
    const row = store.ledgerFor(1)[0];
    expect(row).toMatchObject({ status: "processed", interactionId: 4242 });

    // re-run: the processed row is not actionable → downstream not called again
    // (even if a prior label side-effect failed, the message is filed once).
    const r2 = await feedPendingDownstream(deps, 1);
    expect(r2.processed).toBe(0);
    expect(downstream.processed).toEqual(["m1"]); // exactly one process call total
  });

  it("eligibility drift: a row whose sender is now noise → ignored, downstream not called", async () => {
    const downstream = new FakeDownstream();
    const { deps, store } = makeDeps({ downstream });
    await seedPending(store, NOISE);

    await feedPendingDownstream(deps, 1);

    expect(store.ledgerFor(1)[0]).toMatchObject({ status: "ignored", failureKind: "noise" });
    expect(downstream.processed).toEqual([]);
  });

  it("OAuth/API failure classify + exponential backoff + dead-letter after 3 tries", async () => {
    const downstream = new FakeDownstream();
    downstream.behavior.set("m1", { throw: Object.assign(new Error("Too Many Requests"), { status: 429 }) });
    let nowMs = 1_780_000_100_000;
    const { deps, store, alerts } = makeDeps({ downstream, clock: () => nowMs });
    await seedPending(store);

    // attempt 1 → failed, retryCount=1, nextRetryAt=+120s, no card yet
    await feedPendingDownstream(deps, 1);
    let row = store.ledgerFor(1)[0];
    expect(row).toMatchObject({ status: "failed", failureKind: "gmail_api", httpStatus: 429, retryCount: 1 });
    expect(row.nextRetryAt!.getTime()).toBe(1_780_000_100_000 + 120_000);
    expect(alerts.cards).toHaveLength(0);

    // before the backoff elapses the row is NOT actionable
    nowMs = 1_780_000_100_000 + 60_000;
    expect((await feedPendingDownstream(deps, 1)).failed).toBe(0);

    // attempt 2 (past backoff) → retryCount=2
    nowMs = 1_780_000_100_000 + 130_000;
    await feedPendingDownstream(deps, 1);
    expect(store.ledgerFor(1)[0].retryCount).toBe(2);

    // attempt 3 → retryCount=3 → terminal (nextRetryAt null) + dead-letter card
    nowMs = 1_780_000_100_000 + 500_000;
    const r3 = await feedPendingDownstream(deps, 1);
    row = store.ledgerFor(1)[0];
    expect(r3.deadLettered).toBe(1);
    expect(row).toMatchObject({ status: "failed", retryCount: 3, nextRetryAt: null });
    expect(alerts.cards).toHaveLength(1);
    // card is PII-safe: ids/kind only, never the sender address or body
    expect(alerts.cards[0].body).toContain("m1");
    expect(alerts.cards[0].body).not.toContain(CUSTOMER);
  });
});

// ── pure classifiers ─────────────────────────────────────────────────────────

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

// ── low-risk hardening: fromAddress normalization + errorDetail scrub ─────────

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

describe("ledger fromAddress is normalized at land time", () => {
  it("a display-name From lands as a bare lowercase address", async () => {
    const { deps, store, gmail } = makeDeps();
    gmail.historyQueue.push({ messageIds: ["m1"], latestHistoryId: "H2", expired: false });
    gmail.addMessage(meta("m1", "Jane Customer <Jane.Customer@Example.COM>"));

    await syncHistoryForIntegration(deps, 1);

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
