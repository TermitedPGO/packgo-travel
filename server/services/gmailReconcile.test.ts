/**
 * gmail-intake-ledger — red/green tests for the reconciliation tripwire (D §4)
 * + watch lifecycle health (§5). In-memory fakes only — no real DB/Redis/Gmail.
 * Covers the four P1 rules, the watch three-state alerts, incident-fingerprint
 * dedup, and recovery auto-close with duration.
 */
import { describe, it, expect } from "vitest";
import {
  reconcileIntegration,
  checkWatchHealth,
  type ReconcileDeps,
  type IncidentTracker,
} from "./gmailReconcile";
import {
  buildInboxScanQuery,
  type AlertPort,
  type LedgerStore,
  type IntegrationCursor,
  type LedgerStatus,
  type FailureKind,
} from "./gmailHistorySync";
import type { GmailMessageMetadata } from "../_core/gmail";

const NOW = 1_780_000_000_000;
const CUSTOMER = "customer@example.com";
const NOISE = "deals@marriott.com";

class FakeAlerts implements AlertPort {
  cards: Array<{ agentName: string; title: string; body: string; priority: string }> = [];
  async postCard(card: { agentName: string; title: string; body: string; priority: string }) {
    this.cards.push(card);
  }
  async alreadyAlerted() {
    return false;
  }
  titles() {
    return this.cards.map((c) => c.title);
  }
}

class FakeIncidents implements IncidentTracker {
  store = new Map<string, { firstSeenMs: number; lastAlertMs: number }>();
  async onActive(fp: string, nowMs: number, reAlertWindowMs: number) {
    const e = this.store.get(fp);
    if (!e) {
      this.store.set(fp, { firstSeenMs: nowMs, lastAlertMs: nowMs });
      return { firstSeenMs: nowMs, shouldAlert: true };
    }
    const shouldAlert = nowMs - e.lastAlertMs >= reAlertWindowMs;
    if (shouldAlert) e.lastAlertMs = nowMs;
    return { firstSeenMs: e.firstSeenMs, shouldAlert };
  }
  async onRecovered(fp: string) {
    const e = this.store.get(fp);
    if (!e) return null;
    this.store.delete(fp);
    return { firstSeenMs: e.firstSeenMs };
  }
}

function fakeStore(opts: {
  scanKnownIds?: string[];
  stuck?: { gmailMessageId: string; failureKind: FailureKind | null; ageMs: number } | null;
} = {}): LedgerStore {
  const known = new Set(opts.scanKnownIds ?? []);
  return {
    async existingMessageIds(_id: number, ids: string[]) {
      return new Set(ids.filter((i) => known.has(i)));
    },
    async oldestStuck(
      _id: number,
      _statuses: LedgerStatus[],
      _olderThanMs: number,
      _nowMs: number,
    ) {
      return opts.stuck ?? null;
    },
  } as unknown as LedgerStore;
}

function makeDeps(opts: {
  scanResults?: GmailMessageMetadata[];
  scanKnownIds?: string[];
  stuck?: { gmailMessageId: string; failureKind: FailureKind | null; ageMs: number } | null;
  topicConfigured?: boolean;
  clock?: () => number;
}) {
  const alerts = new FakeAlerts();
  const incidents = new FakeIncidents();
  const deps: ReconcileDeps = {
    gmail: { async scanQueryMetadata() { return { metas: opts.scanResults ?? [], truncated: false }; } },
    store: fakeStore({ scanKnownIds: opts.scanKnownIds, stuck: opts.stuck }),
    alerts,
    incidents,
    topicConfigured: opts.topicConfigured ?? true,
    clock: opts.clock ?? (() => NOW),
  };
  return { deps, alerts, incidents };
}

/** A healthy integration — used so each test isolates ONE failing rule. */
function healthy(overrides: Partial<IntegrationCursor> = {}): IntegrationCursor {
  return {
    id: 1,
    emailAddress: "jeffhsieh09@gmail.com",
    intakeMode: "shadow",
    lastHistoryId: "H1",
    lastSuccessfulSyncAt: new Date(NOW - 1000), // fresh
    watchExpiration: NOW + 48 * 60 * 60 * 1000, // healthy watch
    ...overrides,
  };
}

const oldMsg = (id: string, from = CUSTOMER): GmailMessageMetadata => ({
  id,
  threadId: `t-${id}`,
  from,
  internalDateMs: NOW - 15 * 60 * 1000, // 15 min old (> 10 min threshold)
});

// ── watch three-state (pure) ─────────────────────────────────────────────────

describe("checkWatchHealth — three-state + topic gate", () => {
  it("topic unset → P1 topic_unset", () => {
    expect(checkWatchHealth(NOW + 100000, false, NOW)).toEqual({ level: "p1", reason: "topic_unset" });
  });
  it("watchExpiration NULL → P1 never_registered", () => {
    expect(checkWatchHealth(null, true, NOW)).toEqual({ level: "p1", reason: "never_registered" });
  });
  it("expired → P1 expired", () => {
    expect(checkWatchHealth(NOW - 1, true, NOW)).toEqual({ level: "p1", reason: "expired" });
  });
  it("expiring within 24h → warning", () => {
    expect(checkWatchHealth(NOW + 12 * 60 * 60 * 1000, true, NOW)).toEqual({
      level: "warning",
      reason: "expiring_soon",
    });
  });
  it("healthy → ok", () => {
    expect(checkWatchHealth(NOW + 48 * 60 * 60 * 1000, true, NOW)).toEqual({ level: "ok" });
  });
});

// ── the four P1 rules, isolated ──────────────────────────────────────────────

describe("reconcileIntegration — four P1 rules", () => {
  it("rule 1: eligible mail > 10 min old with no ledger row → P1 card (firstMissing in body)", async () => {
    const { deps, alerts } = makeDeps({ scanResults: [oldMsg("mMiss")], scanKnownIds: [] });
    const report = await reconcileIntegration(deps, healthy());
    expect(report.missingFromLedger).toBe(1);
    expect(alerts.cards).toHaveLength(1);
    expect(alerts.cards[0].priority).toBe("high");
    expect(alerts.cards[0].body).toContain("mMiss");
    expect(alerts.cards[0].body).not.toContain(CUSTOMER); // PII-safe
  });

  it("rule 1: a message younger than 10 min is NOT flagged (too fresh)", async () => {
    const fresh: GmailMessageMetadata = { id: "mFresh", threadId: "t", from: CUSTOMER, internalDateMs: NOW - 60_000 };
    const { deps, alerts } = makeDeps({ scanResults: [fresh], scanKnownIds: [] });
    const report = await reconcileIntegration(deps, healthy());
    expect(report.missingFromLedger).toBe(0);
    expect(alerts.cards).toHaveLength(0);
  });

  it("rule 1 (v2 semantics): a message already in the ledger is not flagged; ANY inbox mail NOT in the ledger IS — regardless of eligibility", async () => {
    // v2 (P0-1): the ledger is the COMPLETE account (noise lands too), so rule 1 no
    // longer filters by eligibility. mKnown is in the ledger → fine; mNoise is a
    // noise sender NOT in the ledger → a漏接 (it should have been recorded).
    const { deps, alerts } = makeDeps({
      scanResults: [oldMsg("mKnown"), oldMsg("mNoise", NOISE)],
      scanKnownIds: ["mKnown"],
    });
    const report = await reconcileIntegration(deps, healthy());
    expect(report.missingFromLedger).toBe(1);
    expect(alerts.cards).toHaveLength(1);
    expect(alerts.cards[0].body).toContain("mNoise");
    expect(alerts.cards[0].body).not.toContain(NOISE); // PII-safe (ids/counts only)
  });

  it("三宇宙一致: rule 1 scans the SAME in:inbox universe query the engine's scans use (no eligibility narrowing)", async () => {
    // Captures the query reconcile passes to Gmail and pins it to the shared
    // buildInboxScanQuery output — so reconcile can never watch a universe the
    // discovery/fallback paths don't cover (labelAdded-into-inbox mail included).
    const captured: string[] = [];
    const alerts = new FakeAlerts();
    const deps: ReconcileDeps = {
      gmail: {
        async scanQueryMetadata(q: string) {
          captured.push(q);
          return { metas: [], truncated: false };
        },
      },
      store: fakeStore({}),
      alerts,
      incidents: new FakeIncidents(),
      topicConfigured: true,
      clock: () => NOW,
    };
    await reconcileIntegration(deps, healthy());
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(buildInboxScanQuery(NOW - 60 * 60 * 1000)); // 1h lookback
    expect(captured[0]).toMatch(/^after:\d+ in:inbox$/);
    expect(captured[0]).not.toContain("-from:noreply");
    expect(captured[0]).not.toContain("-label:");
  });

  it("rule 2: a ledger row stuck pending/failed > 30 min → P1 card", async () => {
    const { deps, alerts } = makeDeps({
      stuck: { gmailMessageId: "mStuck", failureKind: "gmail_api", ageMs: 40 * 60 * 1000 },
    });
    const report = await reconcileIntegration(deps, healthy());
    expect(report.stuck).toBe(1);
    expect(alerts.cards.some((c) => c.body.includes("mStuck"))).toBe(true);
  });

  it("rule 3: last successful sync > 10 min (or never) → channel P1", async () => {
    const stale = healthy({ lastSuccessfulSyncAt: new Date(NOW - 20 * 60 * 1000) });
    const { deps, alerts } = makeDeps({});
    const report = await reconcileIntegration(deps, stale);
    expect(report.syncStale).toBe(true);
    expect(alerts.titles().some((t) => t.includes("同步通道停擺"))).toBe(true);
  });

  it("rule 4: watch expired → P1 card", async () => {
    const badWatch = healthy({ watchExpiration: NOW - 1 });
    const { deps, alerts } = makeDeps({});
    const report = await reconcileIntegration(deps, badWatch);
    expect(report.watch).toEqual({ level: "p1", reason: "expired" });
    expect(alerts.cards.some((c) => c.title.includes("expired"))).toBe(true);
  });

  it("a fully healthy integration posts NO cards", async () => {
    const { deps, alerts } = makeDeps({});
    const report = await reconcileIntegration(deps, healthy());
    expect(report.cardsPosted).toBe(0);
    expect(alerts.cards).toHaveLength(0);
  });
});

// ── incident lifecycle: dedup + recovery ─────────────────────────────────────

describe("reconcileIntegration — incident fingerprint dedup + recovery", () => {
  it("same incident across ticks → alerts only once (dedup within the re-alert window)", async () => {
    const { deps, alerts } = makeDeps({ scanResults: [oldMsg("mMiss")], scanKnownIds: [] });
    await reconcileIntegration(deps, healthy());
    await reconcileIntegration(deps, healthy());
    await reconcileIntegration(deps, healthy());
    // three ticks, one incident → exactly one card (no re-alert inside 60 min).
    expect(alerts.cards.filter((c) => c.title.includes("未進 ledger"))).toHaveLength(1);
  });

  it("recovery auto-closes the incident and posts a resolved note with duration", async () => {
    const alerts = new FakeAlerts();
    const incidents = new FakeIncidents();
    let nowMs = NOW;
    const knownIds = new Set<string>();
    const deps: ReconcileDeps = {
      gmail: { async scanQueryMetadata() { return { metas: [oldMsg("mMiss")], truncated: false }; } },
      store: {
        async existingMessageIds(_id: number, ids: string[]) {
          return new Set(ids.filter((i) => knownIds.has(i)));
        },
        async oldestStuck() {
          return null;
        },
      } as unknown as LedgerStore,
      alerts,
      incidents,
      topicConfigured: true,
      clock: () => nowMs,
    };

    // tick 1 — mMiss is missing → incident opens + P1 card.
    await reconcileIntegration(deps, healthy());
    expect(alerts.cards.filter((c) => c.title.includes("未進 ledger"))).toHaveLength(1);
    expect(incidents.store.has("gmail-reconcile:1:missing_ledger")).toBe(true);

    // 8 minutes later mMiss finally landed in the ledger → incident recovers.
    nowMs = NOW + 8 * 60 * 1000;
    knownIds.add("mMiss");
    const report = await reconcileIntegration(deps, healthy());

    expect(report.missingFromLedger).toBe(0);
    expect(report.incidentsRecovered).toBeGreaterThanOrEqual(1);
    expect(incidents.store.has("gmail-reconcile:1:missing_ledger")).toBe(false); // auto-closed
    const recovery = alerts.cards.find((c) => c.title.includes("自動恢復"));
    expect(recovery).toBeDefined();
    expect(recovery!.body).toContain("8 分鐘"); // duration recorded
  });

  it("frozen-cursor channel: sync_stale P1 opens, then auto-closes once the cursor advances (recovery-close reuse)", async () => {
    // When a truncated round freezes the History cursor, lastSuccessfulSyncAt stops
    // advancing → reconcile Rule 3 raises the channel P1. When the backlog drains and
    // a later round advances the cursor, this SAME recover() path auto-closes it —
    // the visible auto-close the truncation flow relies on (沿用恢復關卡邏輯).
    const alerts = new FakeAlerts();
    const incidents = new FakeIncidents();
    let nowMs = NOW;
    const deps: ReconcileDeps = {
      gmail: { async scanQueryMetadata() { return { metas: [], truncated: false }; } },
      store: {
        async existingMessageIds() { return new Set<string>(); },
        async oldestStuck() { return null; },
      } as unknown as LedgerStore,
      alerts,
      incidents,
      topicConfigured: true,
      clock: () => nowMs,
    };

    // tick 1 — cursor frozen 20 min (truncation kept it from advancing) → P1 opens.
    await reconcileIntegration(deps, healthy({ lastSuccessfulSyncAt: new Date(NOW - 20 * 60 * 1000) }));
    expect(alerts.titles().some((t) => t.includes("同步通道停擺"))).toBe(true);
    expect(incidents.store.has("gmail-reconcile:1:sync_stale")).toBe(true);

    // 12 min later the backlog drained; the next round advanced the cursor → fresh sync.
    nowMs = NOW + 12 * 60 * 1000;
    const report = await reconcileIntegration(deps, healthy({ lastSuccessfulSyncAt: new Date(nowMs - 1000) }));
    expect(report.syncStale).toBe(false);
    expect(report.incidentsRecovered).toBeGreaterThanOrEqual(1);
    expect(incidents.store.has("gmail-reconcile:1:sync_stale")).toBe(false); // auto-closed
    expect(alerts.cards.some((c) => c.title.includes("自動恢復"))).toBe(true);
  });
});
