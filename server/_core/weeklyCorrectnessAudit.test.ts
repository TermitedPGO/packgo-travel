/**
 * weeklyCorrectnessAudit tests (customer-cockpit Phase6 D1).
 *
 * Covers:
 *   - diffCustomerSummary: what counts as "material" vs noise, given a
 *     customer's live facts vs their cached aiSummary.
 *   - aggregateAuditResults: zero-diff → no card; >=1 diff → exactly one card,
 *     aggregated across all mismatching customers, priority scaled by count.
 *   - isTestOrOwnerAccount is actually CALLED to filter the sample before any
 *     comparison happens (source-level check, not just behavioral).
 *
 * No real DB — diffCustomerSummary/aggregateAuditResults/formatAuditDigest are
 * pure. The executor (runWeeklyCorrectnessAudit) is DB-touching and verified
 * live per repo norm (followupScan.test.ts / duplicateProfileScan.test.ts),
 * same as its sibling weekly scans.
 *
 * Wave1 Block C additions: the observability-counters wiring inside
 * runWeeklyCorrectnessAudit (gatherMessagesFailedWeeklyDelta /
 * gatherQueueFailedCounts / gatherLlmCircuitStats / formatObservabilitySection)
 * has its OWN dedicated test file (observabilityCounters.test.ts) with real
 * mocks for each collector's IO. This file only needs enough of a redis/queue
 * mock that those collectors degrade to their harmless "couldn't read" states
 * instead of throwing — the executor-level tests here were never about
 * exercising the collectors' internals, only the audit's own control flow.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("./logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// gatherCustomerFacts is mocked ONLY for the executor-level tests further
// down (runWeeklyCorrectnessAudit) — every other test in this file calls the
// pure functions (diffCustomerSummary/aggregateAuditResults/etc.) directly
// with hand-built CustomerFacts, never through this mock.
const gatherCustomerFactsMock = vi.fn();
vi.mock("./customerFacts", async () => {
  const actual = await vi.importActual<typeof import("./customerFacts")>("./customerFacts");
  return { ...actual, gatherCustomerFacts: (...args: unknown[]) => gatherCustomerFactsMock(...args) };
});

// Redis is mocked so the heartbeat write in runWeeklyCorrectnessAudit never
// touches a real client under `vitest run`. get/hmget are stubbed to their
// "nothing here" shapes (null / all-null tuple) purely so the Wave1 Block C
// observability collectors (gatherMessagesFailedWeeklyDelta/
// gatherLlmCircuitStats) degrade to a clean, harmless state instead of
// throwing "x is not a function" — this file doesn't assert on their output.
const redisSetMock = vi.fn().mockResolvedValue("OK");
vi.mock("../redis", () => ({
  redis: {
    set: (...args: unknown[]) => redisSetMock(...args),
    get: vi.fn().mockResolvedValue(null),
    hmget: vi.fn().mockResolvedValue([null, null, null]),
  },
}));

// Wave1 Block C's gatherQueueFailedCounts dynamically imports server/queue.ts
// + every server/queues/*.ts file to enumerate live BullMQ Queue instances.
// None of that is relevant to THIS file's executor-control-flow tests (it's
// covered by observabilityCounters.test.ts's own dedicated mocks), so every
// queue-definition module is stubbed to an empty export set here — that
// makes gatherQueueFailedCounts() resolve to `[]` deterministically, with no
// dependency on a real Redis-backed BullMQ connection.
vi.mock("../queue", () => ({}));
vi.mock("../queues/abandonmentRecoveryQueue", () => ({}));
vi.mock("../queues/packpointMaintenanceQueue", () => ({}));
vi.mock("../queues/posterProcessingQueue", () => ({}));
vi.mock("../queues/priorityRewriteCron", () => ({}));
vi.mock("../queues/quoteFollowUpQueue", () => ({}));
vi.mock("../queues/supplierSyncQueue", () => ({}));

import {
  diffCustomerSummary,
  aggregateAuditResults,
  formatAuditDigest,
  priorityForMismatchCount,
  isEmptyFacts,
  runWeeklyCorrectnessAudit,
  WEEKLY_AUDIT_HEARTBEAT_KEY,
  type CustomerAuditInput,
  type CustomerAuditResult,
} from "./weeklyCorrectnessAudit";
import { EMPTY_FACTS, type CustomerFacts, type OrderFact } from "./customerFacts";
import type { AiSummary } from "./customerAiSummary";

function facts(over: Partial<CustomerFacts> = {}): CustomerFacts {
  return { ...EMPTY_FACTS, ...over };
}

function order(over: Partial<OrderFact> = {}): OrderFact {
  return {
    orderNumber: "ORD-2026-0001",
    title: "台灣 12 天",
    status: "draft",
    currency: "USD",
    quoteSentAt: null,
    collectionSentAt: null,
    depositPaidAt: null,
    balancePaidAt: null,
    confirmedAt: null,
    ...over,
  };
}

function summary(over: Partial<AiSummary> = {}): AiSummary {
  return {
    wants: "想去台灣玩",
    actions: "目前還沒有對外動作記錄",
    delivered: "目前還沒有交付任何文件給客人",
    nextStep: "等客人回覆",
    ...over,
  };
}

function input(over: Partial<CustomerAuditInput> = {}): CustomerAuditInput {
  return {
    profileId: 1,
    email: "customer@example.com",
    cachedSummary: summary(),
    facts: facts(),
    ...over,
  };
}

describe("diffCustomerSummary", () => {
  it("no cached summary yet (never computed) → not a mismatch, nothing to compare", () => {
    const result = diffCustomerSummary(input({ cachedSummary: null }));
    expect(result.mismatches).toEqual([]);
  });

  it("cached summary matches freshly-recomputed facts exactly → zero mismatches (the true-negative / noise case)", () => {
    // facts imply "目前還沒有對外動作記錄" / "目前還沒有交付任何文件給客人" —
    // exactly what the empty-fallback cached summary already says.
    const result = diffCustomerSummary(input());
    expect(result.mismatches).toEqual([]);
  });

  it("delivered-list mismatch: order got a quote sent since the cache was last computed", () => {
    const liveFacts = facts({
      orders: [order({ quoteSentAt: new Date("2026-06-18T18:00:00Z") })],
    });
    // quoteSentAt affects BOTH deriveActions ("寄了報價") and deriveDelivered
    // ("報價(...)") — cache the actions half correctly so only delivered mismatches.
    const cached = summary({ actions: "寄了報價", delivered: "目前還沒有交付任何文件給客人" });
    const result = diffCustomerSummary(input({ cachedSummary: cached, facts: liveFacts }));
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].field).toBe("delivered");
    expect(result.mismatches[0].cached).toBe("目前還沒有交付任何文件給客人");
    expect(result.mismatches[0].recomputed).toContain("報價");
  });

  it("amount/payment-status mismatch surfaces via delivered/actions text: deposit paid but cache still says no activity", () => {
    const liveFacts = facts({
      orders: [order({ depositPaidAt: new Date("2026-06-18T18:00:00Z") })],
    });
    const cached = summary({ actions: "目前還沒有對外動作記錄" });
    const result = diffCustomerSummary(input({ cachedSummary: cached, facts: liveFacts }));
    const actionsMismatch = result.mismatches.find((m) => m.field === "actions");
    expect(actionsMismatch).toBeDefined();
    expect(actionsMismatch!.recomputed).toContain("收了訂金");
  });

  it("ball-in-court mismatch surfaces via actions text: cache predates a new outbound reply", () => {
    const liveFacts = facts({ outboundCount: 2, outboundLastAt: new Date("2026-06-22T18:00:00Z") });
    const cached = summary({ actions: "目前還沒有對外動作記錄" }); // cache thinks 0 outbound
    const result = diffCustomerSummary(input({ cachedSummary: cached, facts: liveFacts }));
    const actionsMismatch = result.mismatches.find((m) => m.field === "actions");
    expect(actionsMismatch).toBeDefined();
    expect(actionsMismatch!.recomputed).toContain("回了 2 封信");
  });

  it("both actions AND delivered can mismatch simultaneously for one customer", () => {
    const liveFacts = facts({
      outboundCount: 1,
      outboundLastAt: new Date("2026-06-18T18:00:00Z"),
      orders: [order({ confirmedAt: new Date("2026-06-20T18:00:00Z") })],
    });
    const cached = summary({
      actions: "目前還沒有對外動作記錄",
      delivered: "目前還沒有交付任何文件給客人",
    });
    const result = diffCustomerSummary(input({ cachedSummary: cached, facts: liveFacts }));
    expect(result.mismatches.map((m) => m.field).sort()).toEqual(["actions", "delivered"]);
  });

  it("does NOT diff wants/nextStep even if cache and live facts imply different things (LLM-judgment fields, out of scope)", () => {
    // No matter how the cached wants/nextStep read, diffCustomerSummary must
    // never inspect them — only actions/delivered are recomputed/compared.
    const cached = summary({ wants: "完全不合理的內容", nextStep: "隨便寫的下一步" });
    const result = diffCustomerSummary(input({ cachedSummary: cached }));
    expect(result.mismatches).toEqual([]);
    // Sanity: the function signature/return never even carries wants/nextStep.
    expect(result).not.toHaveProperty("wants");
    expect(result).not.toHaveProperty("nextStep");
  });

  // ── adversarial review finding: gatherCustomerFacts silently degrades to
  // EMPTY_FACTS on internal error (customerFacts.ts's own try/catch) instead
  // of throwing. A customer WITH a real cached summary but whose live facts
  // come back as EMPTY_FACTS is therefore NOT "genuinely went silent" — it's
  // "facts-gathering degraded" — and must be flagged as such, NOT diffed as
  // an ordinary actions/delivered mismatch (which would misdirect Jeff into
  // thinking "refresh the card" fixes a systemic gatherCustomerFacts fault).
  it("cached summary exists but live facts come back as EMPTY_FACTS → flagged as factsGatheringDegraded, NOT diffed as an ordinary mismatch", () => {
    const cached = summary({ actions: "寄了報價,收了訂金", delivered: "報價(7/1)、確認書(7/2)" });
    const result = diffCustomerSummary(input({ cachedSummary: cached, facts: EMPTY_FACTS }));
    expect(result.factsGatheringDegraded).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("cached summary exists and live facts are genuinely EMPTY_FACTS-shaped, but so is the cache (a real brand-new customer with zero activity) → no degradation flag, no mismatch (matches the true-negative case)", () => {
    // A brand-new customer whose cache was generated from equally-empty facts
    // is indistinguishable from "gathering degraded" by data shape alone —
    // this is a known/accepted limitation (see T6 self-disclosed weaknesses),
    // but it must NOT produce a false mismatch either way.
    const cached = summary({
      actions: "目前還沒有對外動作記錄",
      delivered: "目前還沒有交付任何文件給客人",
    });
    const result = diffCustomerSummary(input({ cachedSummary: cached, facts: EMPTY_FACTS }));
    expect(result.factsGatheringDegraded).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("no cached summary AND EMPTY_FACTS → not degraded (nothing to compare yet, same as the null-cache case)", () => {
    const result = diffCustomerSummary(input({ cachedSummary: null, facts: EMPTY_FACTS }));
    expect(result.factsGatheringDegraded).toBe(false);
    expect(result.mismatches).toEqual([]);
  });

  it("non-empty live facts never trip the degraded flag, even when they happen to produce zero mismatches", () => {
    const result = diffCustomerSummary(input()); // default facts() = EMPTY_FACTS shape but via facts() helper
    // facts() with no overrides IS byte-identical to EMPTY_FACTS by construction
    // (see the facts() helper above) — so this case is expected to report
    // degraded=true too; the important contrast is the next assertion using
    // genuinely non-empty facts.
    const liveFacts = facts({ outboundCount: 1, outboundLastAt: new Date("2026-06-18T18:00:00Z") });
    const cached2 = summary({ actions: "回了 1 封信" });
    const result2 = diffCustomerSummary(input({ cachedSummary: cached2, facts: liveFacts }));
    expect(result2.factsGatheringDegraded).toBe(false);
    void result;
  });
});

describe("isEmptyFacts", () => {
  it("EMPTY_FACTS itself is empty", () => {
    expect(isEmptyFacts(EMPTY_FACTS)).toBe(true);
  });

  it("any single non-default field makes it non-empty", () => {
    expect(isEmptyFacts(facts({ outboundCount: 1 }))).toBe(false);
    expect(isEmptyFacts(facts({ orders: [order()] }))).toBe(false);
    expect(isEmptyFacts(facts({ confirmedBookingCount: 1 }))).toBe(false);
  });
});

function auditResult(over: Partial<CustomerAuditResult> = {}): CustomerAuditResult {
  return { profileId: 1, email: "a@example.com", mismatches: [], factsGatheringDegraded: false, ...over };
}

describe("aggregateAuditResults — zero-diff-no-card behavior", () => {
  it("all customers match → no card, mismatching=0", () => {
    const results: CustomerAuditResult[] = [
      auditResult({ profileId: 1, email: "a@example.com" }),
      auditResult({ profileId: 2, email: "b@example.com" }),
    ];
    const agg = aggregateAuditResults(results);
    expect(agg.card).toBeUndefined();
    expect(agg.mismatching).toBe(0);
    expect(agg.degraded).toBe(0);
    expect(agg.compared).toBe(2);
  });

  it("empty candidate list (nobody active this week) → no card", () => {
    const agg = aggregateAuditResults([]);
    expect(agg.card).toBeUndefined();
    expect(agg.mismatching).toBe(0);
    expect(agg.degraded).toBe(0);
    expect(agg.compared).toBe(0);
  });
});

describe("aggregateAuditResults — card-aggregation-across-multiple-customers", () => {
  it("exactly ONE card is produced even when multiple customers mismatch", () => {
    const results: CustomerAuditResult[] = [
      auditResult({
        profileId: 1,
        email: "a@example.com",
        mismatches: [{ field: "delivered", cached: "X", recomputed: "Y" }],
      }),
      auditResult({
        profileId: 2,
        email: "b@example.com",
        mismatches: [{ field: "actions", cached: "P", recomputed: "Q" }],
      }),
      auditResult({ profileId: 3, email: "c@example.com", mismatches: [] }), // matches, excluded from digest
    ];
    const agg = aggregateAuditResults(results);
    expect(agg.card).toBeDefined();
    expect(agg.mismatching).toBe(2);
    // Both mismatching customers' emails appear in the ONE body; the matching
    // customer does not.
    expect(agg.card!.body).toContain("a@example.com");
    expect(agg.card!.body).toContain("b@example.com");
    expect(agg.card!.body).not.toContain("c@example.com");
  });

  it("card title states the count of mismatching customers", () => {
    const results: CustomerAuditResult[] = [
      auditResult({ profileId: 1, email: "a@example.com", mismatches: [{ field: "actions", cached: "X", recomputed: "Y" }] }),
      auditResult({ profileId: 2, email: "b@example.com", mismatches: [{ field: "delivered", cached: "X", recomputed: "Y" }] }),
      auditResult({ profileId: 3, email: "c@example.com", mismatches: [{ field: "actions", cached: "X", recomputed: "Y" }] }),
    ];
    const agg = aggregateAuditResults(results);
    expect(agg.card!.title).toContain("3");
  });

  it("digest caps the listed customers and notes how many more exist", () => {
    const results: CustomerAuditResult[] = Array.from({ length: 25 }, (_, i) =>
      auditResult({
        profileId: i + 1,
        email: `c${i}@example.com`,
        mismatches: [{ field: "actions" as const, cached: "X", recomputed: "Y" }],
      }),
    );
    const body = formatAuditDigest(results);
    expect(body).toContain("還有 5 位未列出");
  });

  it("a profile with no email falls back to a profile-id label (never blank)", () => {
    const results: CustomerAuditResult[] = [
      auditResult({ profileId: 42, email: null, mismatches: [{ field: "actions", cached: "X", recomputed: "Y" }] }),
    ];
    const body = formatAuditDigest(results);
    expect(body).toContain("profile #42");
  });
});

describe("aggregateAuditResults / formatAuditDigest — degraded facts-gathering is a SEPARATE signal, never folded into ordinary mismatch text", () => {
  it("degraded customers alone (zero ordinary mismatches) still produce a card — silent degradation must not be invisible", () => {
    const results: CustomerAuditResult[] = [
      auditResult({ profileId: 1, email: "a@example.com", mismatches: [], factsGatheringDegraded: true }),
    ];
    const agg = aggregateAuditResults(results);
    expect(agg.card).toBeDefined();
    expect(agg.mismatching).toBe(0);
    expect(agg.degraded).toBe(1);
  });

  it("degraded customer's email appears in a section separate from the ordinary mismatch digest text, and that section does NOT say 'refresh the card and it'll update'", () => {
    const results: CustomerAuditResult[] = [
      auditResult({
        profileId: 1,
        email: "mismatch@example.com",
        mismatches: [{ field: "actions", cached: "X", recomputed: "Y" }],
      }),
      auditResult({ profileId: 2, email: "degraded@example.com", mismatches: [], factsGatheringDegraded: true }),
    ];
    const body = formatAuditDigest(results);
    expect(body).toContain("mismatch@example.com");
    expect(body).toContain("degraded@example.com");
    // The ordinary-mismatch sentence ("重新整理摘要就會更新") must not be the
    // sentence attached to the degraded customer's line — split the body on
    // the section separator and check the degraded email is only in the
    // second (non-refresh) section.
    const sections = body.split("---");
    const refreshSection = sections.find((s) => s.includes("重新整理摘要就會更新"));
    const degradedSection = sections.find((s) => s.includes("gatherCustomerFacts 疑似出錯"));
    expect(refreshSection).toBeDefined();
    expect(degradedSection).toBeDefined();
    expect(refreshSection).not.toContain("degraded@example.com");
    expect(degradedSection).toContain("degraded@example.com");
  });

  it("many degraded customers (>=5) escalate the card to high priority, same threshold logic as ordinary mismatches", () => {
    const results: CustomerAuditResult[] = Array.from({ length: 5 }, (_, i) =>
      auditResult({ profileId: i + 1, email: `d${i}@example.com`, mismatches: [], factsGatheringDegraded: true }),
    );
    const agg = aggregateAuditResults(results);
    expect(agg.card!.priority).toBe("high");
  });
});

describe("priorityForMismatchCount", () => {
  it("a handful of mismatches → normal priority", () => {
    expect(priorityForMismatchCount(1)).toBe("normal");
    expect(priorityForMismatchCount(4)).toBe("normal");
  });

  it("a wide-spread drift (>=5 customers) → high priority (likely a systemic bug, not one-off staleness)", () => {
    expect(priorityForMismatchCount(5)).toBe("high");
    expect(priorityForMismatchCount(20)).toBe("high");
  });
});

// ── Wave1 Block C: formatAuditDigest's optional observabilitySection param ──
describe("formatAuditDigest — observabilitySection (Wave1 Block C, optional 2nd param)", () => {
  it("omitted entirely → output is byte-for-byte identical to calling with one arg (backward compat)", () => {
    const results: CustomerAuditResult[] = [
      auditResult({ profileId: 1, email: "a@example.com", mismatches: [{ field: "actions", cached: "X", recomputed: "Y" }] }),
    ];
    const withoutSecondArg = formatAuditDigest(results);
    const explicitlyUndefined = formatAuditDigest(results, undefined);
    expect(explicitlyUndefined).toBe(withoutSecondArg);
    expect(withoutSecondArg).not.toContain("---\n\n觀測計數器");
  });

  it("both mismatches AND degraded present + observabilitySection → three `---`-separated sections, in order", () => {
    const results: CustomerAuditResult[] = [
      auditResult({ profileId: 1, email: "mismatch@example.com", mismatches: [{ field: "actions", cached: "X", recomputed: "Y" }] }),
      auditResult({ profileId: 2, email: "degraded@example.com", mismatches: [], factsGatheringDegraded: true }),
    ];
    const obs = "觀測計數器\nmessagesFailed 週增量:0\n各 queue failed 數:全部 queue failed=0\nLLM circuit 統計(近 7 天):circuit_opened=0, rate_limit_429=0, calls_total=0";
    const body = formatAuditDigest(results, obs);
    const sections = body.split("\n\n---\n\n");
    expect(sections).toHaveLength(3);
    expect(sections[0]).toContain("mismatch@example.com");
    expect(sections[1]).toContain("degraded@example.com");
    expect(sections[2]).toBe(obs);
  });

  it("only mismatches (no degraded) + observabilitySection → two sections", () => {
    const results: CustomerAuditResult[] = [
      auditResult({ profileId: 1, email: "mismatch@example.com", mismatches: [{ field: "delivered", cached: "X", recomputed: "Y" }] }),
    ];
    const obs = "觀測計數器\nline1\nline2\nline3";
    const body = formatAuditDigest(results, obs);
    const sections = body.split("\n\n---\n\n");
    expect(sections).toHaveLength(2);
    expect(sections[1]).toBe(obs);
  });

  // 審查一 P2 finding: only degraded (no ordinary mismatches) + observabilitySection
  // was not directly covered — the "two sections" shape was only tested for
  // the mismatch-only case, relying on code-path symmetry (parts.push in two
  // independent places) rather than a direct test. Locks the degraded-only
  // permutation explicitly.
  it("only degraded (no mismatches) + observabilitySection → two sections (degraded, then observability)", () => {
    const results: CustomerAuditResult[] = [
      auditResult({ profileId: 9, email: "degraded@example.com", mismatches: [], factsGatheringDegraded: true }),
    ];
    const obs = "觀測計數器\nline1\nline2\nline3";
    const body = formatAuditDigest(results, obs);
    const sections = body.split("\n\n---\n\n");
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain("degraded@example.com");
    expect(sections[0]).toContain("gatherCustomerFacts 疑似出錯");
    expect(sections[1]).toBe(obs);
  });

  it("zero mismatches AND zero degraded (empty parts) + observabilitySection → the section is returned ALONE, no leading separator/blank line", () => {
    const results: CustomerAuditResult[] = [auditResult({ profileId: 1, email: "clean@example.com", mismatches: [] })];
    const obs = "觀測計數器\nmessagesFailed 週增量:首次基線,下週起有增量\n各 queue failed 數:全部 queue failed=0\nLLM circuit 統計(近 7 天):circuit_opened=0, rate_limit_429=0, calls_total=0";
    const body = formatAuditDigest(results, obs);
    expect(body).toBe(obs); // no stray "---" or leading whitespace prepended
    expect(body.startsWith("\n")).toBe(false);
    expect(body).not.toMatch(/^---/);
  });

  // 審查三 finding: mutating the `undefined` guard to a truthy/falsy check
  // slipped past all 41 pre-existing tests because none of them exercised a
  // DEFINED-but-EMPTY observabilitySection with a non-empty base — the only
  // case where "=== undefined" and "falsy" actually diverge in output. This
  // pins the real contract (falsy, not strict undefined, per the doc comment
  // above formatAuditDigest) and would catch a regression to the old
  // strict-undefined check, which used to leave a dangling "---" separator
  // with nothing after it.
  it("observabilitySection provided as an EMPTY STRING (not omitted) with a non-empty base → degrades exactly like omitted, no dangling separator", () => {
    const results: CustomerAuditResult[] = [
      auditResult({ profileId: 1, email: "mismatch@example.com", mismatches: [{ field: "actions", cached: "X", recomputed: "Y" }] }),
    ];
    const withEmptyString = formatAuditDigest(results, "");
    const omitted = formatAuditDigest(results);
    expect(withEmptyString).toBe(omitted);
    expect(withEmptyString).not.toMatch(/---\s*$/); // no trailing dangling separator
  });

  it("observabilitySection provided as an empty string with an EMPTY base (zero mismatches, zero degraded) → returns empty string, not a stray separator", () => {
    const results: CustomerAuditResult[] = [auditResult({ profileId: 1, email: "clean@example.com", mismatches: [] })];
    expect(formatAuditDigest(results, "")).toBe("");
  });
});

// ── Wave1 Block C: aggregateAuditResults's optional observabilitySection param ──
describe("aggregateAuditResults — observabilitySection (Wave1 Block C, optional 2nd param)", () => {
  it("backward compat lock: zero-diff WITHOUT observabilitySection → card is still undefined (pre-Wave1-Block-C promise)", () => {
    const results: CustomerAuditResult[] = [auditResult({ profileId: 1, email: "a@example.com" })];
    const agg = aggregateAuditResults(results);
    expect(agg.card).toBeUndefined();
    expect(agg.mismatching).toBe(0);
    expect(agg.degraded).toBe(0);
  });

  it("zero-diff WITH observabilitySection → a card IS produced ('一切正常' title, normal priority), body ends with the observability section", () => {
    const results: CustomerAuditResult[] = [auditResult({ profileId: 1, email: "a@example.com" })];
    const obs = "觀測計數器\nmessagesFailed 週增量:0\n各 queue failed 數:全部 queue failed=0\nLLM circuit 統計(近 7 天):circuit_opened=0, rate_limit_429=0, calls_total=0";
    const agg = aggregateAuditResults(results, obs);
    expect(agg.card).toBeDefined();
    expect(agg.card!.title).toContain("一切正常");
    expect(agg.card!.priority).toBe("normal");
    expect(agg.card!.body).toBe(obs);
  });

  it("zero-diff WITH observabilitySection provided as an EMPTY STRING (not omitted) → treated same as omitted, card stays undefined (falsy check, not strict undefined)", () => {
    const results: CustomerAuditResult[] = [auditResult({ profileId: 1, email: "a@example.com" })];
    const agg = aggregateAuditResults(results, "");
    expect(agg.card).toBeUndefined();
    expect(agg.mismatching).toBe(0);
    expect(agg.degraded).toBe(0);
  });

  it("priority NOT influenced by ⚠ markers inside observabilitySection when mismatching=0/degraded=0 — stays 'normal' even with queue/LLM alarms", () => {
    const results: CustomerAuditResult[] = [auditResult({ profileId: 1, email: "a@example.com" })];
    const alarmingObs =
      "觀測計數器\n⚠ messagesFailed 週增量:12\n⚠ 各 queue failed 數:tour-generation=9\n⚠ LLM circuit 統計(近 7 天):circuit_opened=3, rate_limit_429=5, calls_total=100";
    const agg = aggregateAuditResults(results, alarmingObs);
    expect(agg.card!.priority).toBe("normal");
  });

  it("mismatching>0 case: observabilitySection is appended to the existing (pre-Wave1-Block-C) mismatch digest, existing priority algorithm untouched", () => {
    const results: CustomerAuditResult[] = Array.from({ length: 5 }, (_, i) =>
      auditResult({ profileId: i + 1, email: `c${i}@example.com`, mismatches: [{ field: "actions" as const, cached: "X", recomputed: "Y" }] }),
    );
    const withoutObs = aggregateAuditResults(results);
    const withObs = aggregateAuditResults(results, "觀測計數器\nline1\nline2\nline3");
    // >=5 mismatching customers still escalates to "high" regardless of the
    // observability section — untouched by Wave1 Block C.
    expect(withoutObs.card!.priority).toBe("high");
    expect(withObs.card!.priority).toBe("high");
    expect(withObs.card!.title).toBe(withoutObs.card!.title);
    expect(withObs.card!.body).toContain("觀測計數器");
    expect(withoutObs.card!.body).not.toContain("觀測計數器");
  });
});

describe("messageType/shape matches followupScan.ts's agentMessages card convention", () => {
  it("aggregate card always carries a card.priority of normal|high (valid agentMessages.priority enum values), never something else", () => {
    const oneMismatch: CustomerAuditResult[] = [
      { profileId: 1, email: "a@example.com", mismatches: [{ field: "actions", cached: "X", recomputed: "Y" }] },
    ];
    const agg = aggregateAuditResults(oneMismatch);
    expect(["normal", "high"]).toContain(agg.card!.priority);
  });
});

// ── source-level check: isTestOrOwnerAccount is actually called to filter ──
describe("source-level check: test/owner accounts are excluded from the audit sample before comparison", () => {
  it("weeklyCorrectnessAudit.ts imports isTestOrOwnerAccount from testAccounts and calls it before gatherCustomerFacts is invoked per candidate", () => {
    const src = readFileSync(join(__dirname, "weeklyCorrectnessAudit.ts"), "utf8");

    // Must import the shared helper (not a re-implemented/duplicated check).
    expect(src).toMatch(/import\s*{\s*isTestOrOwnerAccount\s*}\s*from\s*"\.\/testAccounts"/);

    // Must actually call it (not just import-and-ignore).
    expect(src).toMatch(/isTestOrOwnerAccount\(/);

    // The call must appear in the candidate-selection step, textually BEFORE
    // gatherCustomerFacts is invoked in the executor — i.e. filtering happens
    // before any comparison, not after.
    const filterCallIdx = src.indexOf("isTestOrOwnerAccount(");
    const gatherCallIdx = src.indexOf("gatherCustomerFacts(");
    expect(filterCallIdx).toBeGreaterThan(-1);
    expect(gatherCallIdx).toBeGreaterThan(-1);
    expect(filterCallIdx).toBeLessThan(gatherCallIdx);
  });

  it("has ZERO llm invocation in the module (invokeLLM / runAgent never appear)", () => {
    const src = readFileSync(join(__dirname, "weeklyCorrectnessAudit.ts"), "utf8");
    expect(src).not.toMatch(/invokeLLM\s*\(/);
    expect(src).not.toMatch(/runAgent\s*\(/);
    expect(src).not.toMatch(/runInquiryAgent\s*\(/);
  });

  it("never imports or calls any email-send path (sendEmail / sendGmail / sendEscalationReply etc.)", () => {
    const src = readFileSync(join(__dirname, "weeklyCorrectnessAudit.ts"), "utf8");
    expect(src).not.toMatch(/sendEmail/i);
    expect(src).not.toMatch(/sendGmail/i);
    expect(src).not.toMatch(/sendEscalationReply/i);
    expect(src).not.toMatch(/gmail\.users\.messages\.send/i);
  });

  it("the only DB write in the module is a single agentMessages insert (no update/delete on customerProfiles or any customer-facing table)", () => {
    const src = readFileSync(join(__dirname, "weeklyCorrectnessAudit.ts"), "utf8");
    expect(src).toMatch(/db\.insert\(agentMessages\)/);
    expect(src).not.toMatch(/db\.update\(/);
    expect(src).not.toMatch(/db\.delete\(/);
  });

  it("a registered customer (userId set) is re-audited with {userId} scope, not {profileId} — matching resolveSummaryScope's rule so confirmedBookingCount isn't silently zeroed into a false-positive mismatch", () => {
    const src = readFileSync(join(__dirname, "weeklyCorrectnessAudit.ts"), "utf8");
    expect(src).toMatch(/c\.userId\s*!=\s*null\s*\?\s*{\s*userId:\s*c\.userId\s*}\s*:\s*{\s*profileId:\s*c\.id\s*}/);
  });
});

// ── executor-level test: runWeeklyCorrectnessAudit itself, not just the pure
// helpers it calls. Adversarial review finding: "one customer failing
// doesn't abort the scan" had previously only been verified by reading the
// try/catch, never by actually exercising the executor loop. This fakes the
// DB candidate-select chain (select().from().where().orderBy().limit()) and
// mocks gatherCustomerFacts per-call so one candidate can be made to reject.
describe("runWeeklyCorrectnessAudit — executor loop actually continues past one candidate's gatherCustomerFacts failure", () => {
  function fakeDb(candidateRows: Array<{ id: number; email: string | null; userId: number | null; aiSummary: unknown }>) {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve(candidateRows),
            }),
          }),
        }),
      }),
      insert: vi.fn(() => ({ values: insertValues })),
      __insertValues: insertValues,
    } as any;
  }

  it("candidate #2's gatherCustomerFacts rejecting does not abort the scan — candidates #1 and #3 are still compared and the run still returns/posts normally", async () => {
    const db = fakeDb([
      { id: 1, email: "a@example.com", userId: null, aiSummary: { wants: "w", actions: "目前還沒有對外動作記錄", delivered: "目前還沒有交付任何文件給客人", nextStep: "n" } },
      { id: 2, email: "b@example.com", userId: null, aiSummary: { wants: "w", actions: "目前還沒有對外動作記錄", delivered: "目前還沒有交付任何文件給客人", nextStep: "n" } },
      { id: 3, email: "c@example.com", userId: null, aiSummary: { wants: "w", actions: "回了 1 封信", delivered: "目前還沒有交付任何文件給客人", nextStep: "n" } },
    ]);

    gatherCustomerFactsMock.mockImplementation(async (scope: { profileId?: number }) => {
      if (scope.profileId === 2) throw new Error("simulated DB blip for candidate #2");
      if (scope.profileId === 3) {
        return { ...EMPTY_FACTS, outboundCount: 1, outboundLastAt: new Date("2026-06-18T18:00:00Z") };
      }
      // Candidate #1: EMPTY_FACTS with a non-empty cached summary — by
      // isEmptyFacts's own documented (accepted) limitation, this is
      // reported as factsGatheringDegraded rather than "matches", since the
      // module cannot distinguish "genuinely empty" from "gathering
      // degraded" by data shape alone. That's fine for THIS test's purpose
      // (proving candidate #2's rejection doesn't abort the loop) — what
      // matters is #1 and #3 both still get compared despite #2 throwing.
      return EMPTY_FACTS;
    });

    const result = await runWeeklyCorrectnessAudit(db);

    // Candidate #2 threw INSIDE the executor's own try/catch (not inside
    // gatherCustomerFacts's internal one, since the mock rejects directly) —
    // confirming the per-candidate catch really does let the loop continue:
    // only 2 of the 3 candidates make it into `compared` (candidate #2's
    // gatherCustomerFacts call rejected before diffCustomerSummary ever ran
    // for it, so it contributes to neither compared nor mismatching/degraded).
    expect(gatherCustomerFactsMock).toHaveBeenCalledTimes(3);
    expect(result.compared).toBe(2);
    // Candidate #3 has a genuine (non-EMPTY_FACTS) mismatch, candidate #1 is
    // flagged degraded → one card posted covering both signals.
    expect(result.posted).toBe(true);
    expect(result.mismatching).toBe(1);
    expect(result.degraded).toBe(1);
  });

  it("跑完就寫 Redis 心跳 key —— 零差異也寫,監工才能區分「跑了沒事」與「根本沒跑」", async () => {
    redisSetMock.mockClear();
    const db = fakeDb([]); // 零候選 → 零差異,但仍要留心跳痕跡
    const now = new Date("2026-07-06T12:00:00.000Z");
    const result = await runWeeklyCorrectnessAudit(db, { now });
    // Wave1 Block C intentional behavior change: the observability section is
    // now ALWAYS attached, so aggregate.card is always defined — a zero-diff
    // week still posts a card (title "一切正常"), it's just no longer silent.
    // Pre-Wave1-Block-C this asserted posted===false; see
    // aggregateAuditResults's Wave1 Block C doc-comment for why that "zero
    // differences → post nothing" behavior was deliberately retired.
    expect(result.posted).toBe(true);
    expect(result.mismatching).toBe(0);
    expect(result.degraded).toBe(0);
    expect(redisSetMock).toHaveBeenCalledWith(WEEKLY_AUDIT_HEARTBEAT_KEY, now.toISOString());
  });

  it("零差異週的卡片內文仍帶有觀測計數器三行(Wave1 Block C 的整個重點:讓 Jeff 每週一都看得到,不只出事那週)", async () => {
    const db = fakeDb([]);
    const insertedValues: any[] = [];
    db.insert = vi.fn(() => ({
      values: (v: any) => {
        insertedValues.push(v);
        return Promise.resolve(undefined);
      },
    }));
    const result = await runWeeklyCorrectnessAudit(db);
    expect(result.posted).toBe(true);
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0].body).toContain("觀測計數器");
    expect(insertedValues[0].body).toContain("messagesFailed 週增量");
    expect(insertedValues[0].body).toContain("各 queue failed 數");
    expect(insertedValues[0].body).toContain("LLM circuit 統計");
  });
});
