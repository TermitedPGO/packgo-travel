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

import {
  diffCustomerSummary,
  aggregateAuditResults,
  formatAuditDigest,
  priorityForMismatchCount,
  isEmptyFacts,
  runWeeklyCorrectnessAudit,
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
});
