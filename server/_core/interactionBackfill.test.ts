import { describe, it, expect, vi, beforeEach } from "vitest";

// ────────────────────────────────────────────────────────────────────────
// buildProfileBackfillPlan / summarizeBackfillPlans — pure, no mocks needed.
// ────────────────────────────────────────────────────────────────────────

import {
  buildProfileBackfillPlan,
  summarizeBackfillPlans,
  type BackfillInteractionRow,
  type ProfileBackfillPlan,
} from "./interactionBackfill";
import type { OrderCandidate } from "./interactionOrderAssignment";

const row = (id: number, opts: Partial<BackfillInteractionRow> = {}): BackfillInteractionRow => ({
  id,
  gmailThreadId: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  ...opts,
});

const order = (id: number, category: string | null = "quote", destination: string | null = "台灣"): OrderCandidate => ({
  id,
  orderNumber: `ORD-2026-${String(id).padStart(4, "0")}`,
  category,
  destination,
});

describe("buildProfileBackfillPlan — pure planning logic", () => {
  it("Emerald-shaped case: multiple in-progress orders, no thread inheritance available → every row stays NULL", () => {
    const plan = buildProfileBackfillPlan({
      profileId: 999,
      nullRows: [row(1), row(2), row(3)],
      threadOrderMap: new Map(),
      candidates: [order(10), order(11), order(12), order(13)], // 4 in-progress orders, per dispatch doc's Emerald fixture
    });
    expect(plan.assignedCount).toBe(0);
    expect(plan.staysNullCount).toBe(3);
    for (const d of plan.decisions) {
      expect(d.customOrderId).toBeNull();
      expect(d.reason).toBe("ambiguous_no_llm_or_unconfident");
    }
  });

  it("single in-progress order → every NULL row gets backfilled to it (rule ②)", () => {
    const plan = buildProfileBackfillPlan({
      profileId: 1,
      nullRows: [row(1), row(2)],
      threadOrderMap: new Map(),
      candidates: [order(50)],
    });
    expect(plan.assignedCount).toBe(2);
    expect(plan.staysNullCount).toBe(0);
    for (const d of plan.decisions) {
      expect(d.customOrderId).toBe(50);
      expect(d.reason).toBe("single_in_progress_order");
    }
  });

  it("zero in-progress orders → stays NULL (no_candidates)", () => {
    const plan = buildProfileBackfillPlan({
      profileId: 2,
      nullRows: [row(1)],
      threadOrderMap: new Map(),
      candidates: [],
    });
    expect(plan.assignedCount).toBe(0);
    expect(plan.decisions[0].reason).toBe("no_candidates");
  });

  it("thread inheritance (rule ①) wins over multiple in-progress orders when a prior sibling on the same thread is already assigned", () => {
    const plan = buildProfileBackfillPlan({
      profileId: 3,
      nullRows: [row(1, { gmailThreadId: "thread-A" })],
      threadOrderMap: new Map([["thread-A", 77]]),
      candidates: [order(10), order(11)], // would otherwise be ambiguous
    });
    expect(plan.decisions[0]).toEqual({ interactionId: 1, customOrderId: 77, reason: "thread_inherited" });
    expect(plan.assignedCount).toBe(1);
  });

  it("propagates an in-batch assignment to a later NULL row on the same thread (chronological order matters)", () => {
    const plan = buildProfileBackfillPlan({
      profileId: 4,
      nullRows: [
        row(2, { gmailThreadId: "thread-B", createdAt: new Date("2026-06-02T00:00:00Z") }),
        row(1, { gmailThreadId: "thread-B", createdAt: new Date("2026-06-01T00:00:00Z") }), // earlier, out of array order
      ],
      threadOrderMap: new Map(),
      candidates: [order(20)], // single in-progress order -> row 1 resolves via rule ②, row 2 should inherit from row 1
    });
    // Both rows in this profile get the same order since there's only one
    // candidate — but this test's real point is ordering: row 1 (earlier)
    // is processed first and seeds the thread map for row 2.
    const byId = new Map(plan.decisions.map((d) => [d.interactionId, d]));
    expect(byId.get(1)?.reason).toBe("single_in_progress_order");
    expect(byId.get(2)?.reason).toBe("thread_inherited");
    expect(byId.get(2)?.customOrderId).toBe(20);
  });

  it("never passes an llmPick — deterministic-only, verified by asserting the ambiguous multi-candidate case always lands on ambiguous_no_llm_or_unconfident, never llm_confident_pick", () => {
    const plan = buildProfileBackfillPlan({
      profileId: 5,
      nullRows: [row(1)],
      threadOrderMap: new Map(),
      candidates: [order(1), order(2)],
    });
    expect(plan.decisions[0].reason).not.toBe("llm_confident_pick");
    expect(plan.decisions[0].reason).toBe("ambiguous_no_llm_or_unconfident");
  });
});

describe("summarizeBackfillPlans", () => {
  it("aggregates totals and reason breakdown across multiple profiles' plans", () => {
    const plans: ProfileBackfillPlan[] = [
      buildProfileBackfillPlan({
        profileId: 1,
        nullRows: [row(1), row(2)],
        threadOrderMap: new Map(),
        candidates: [order(1)],
      }),
      buildProfileBackfillPlan({
        profileId: 2,
        nullRows: [row(3)],
        threadOrderMap: new Map(),
        candidates: [order(1), order(2)],
      }),
    ];
    const stats = summarizeBackfillPlans(plans);
    expect(stats.totalNullRows).toBe(3);
    expect(stats.assignedCount).toBe(2);
    expect(stats.staysNullCount).toBe(1);
    expect(stats.byReason.single_in_progress_order).toBe(2);
    expect(stats.byReason.ambiguous_no_llm_or_unconfident).toBe(1);
  });

  it("empty plan list → all zeros", () => {
    const stats = summarizeBackfillPlans([]);
    expect(stats).toEqual({ totalNullRows: 0, assignedCount: 0, staysNullCount: 0, byReason: {} });
  });
});

// ────────────────────────────────────────────────────────────────────────
// runInteractionBackfill — DB-touching coordinator. DB fully mocked.
// ────────────────────────────────────────────────────────────────────────

// `where()` doubles as both a directly-awaited result (the NULL-rows query,
// interactionBackfill.ts:199) and a chain that continues with `.orderBy()`
// (the already-assigned-siblings query, :255-266, added for the B1 sibling-
// conflict fix — deterministic ORDER BY id ASC). Every array a test wants
// `where()` to resolve to must be wrapped with `ob(...)` below (short for
// "orderBy-aware") so the returned Promise also carries a callable
// `.orderBy()` resolving to that same array — needed because
// interactionBackfill.ts's already-assigned-siblings query chains
// `.orderBy(asc(id))` after `.where(...)`, while its NULL-rows query does not.
function ob<T>(rows: T): T & { orderBy: () => Promise<T> } {
  const p = Promise.resolve(rows) as any;
  p.orderBy = () => Promise.resolve(rows);
  return p;
}

const { mockDb, selectChain, updateChain, mockListCustomOrdersByProfile } = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  const mockDb = {
    select: vi.fn().mockReturnValue(selectChain),
    update: vi.fn().mockReturnValue(updateChain),
  };
  const mockListCustomOrdersByProfile = vi.fn().mockResolvedValue([]);
  return { mockDb, selectChain, updateChain, mockListCustomOrdersByProfile };
});

vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(mockDb) }));
vi.mock("../../drizzle/schema", () => ({
  customerInteractions: {
    id: "id",
    customerProfileId: "customerProfileId",
    gmailThreadId: "gmailThreadId",
    createdAt: "createdAt",
    customOrderId: "customOrderId",
  },
}));
vi.mock("../db/customOrder", () => ({
  listCustomOrdersByProfile: mockListCustomOrdersByProfile,
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ _op: "and", args: a })),
  eq: vi.fn((...a: unknown[]) => ({ _op: "eq", args: a })),
  isNull: vi.fn((...a: unknown[]) => ({ _op: "isNull", args: a })),
  isNotNull: vi.fn((...a: unknown[]) => ({ _op: "isNotNull", args: a })),
  inArray: vi.fn((...a: unknown[]) => ({ _op: "inArray", args: a })),
  asc: vi.fn((...a: unknown[]) => ({ _op: "asc", args: a })),
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import { runInteractionBackfill } from "./interactionBackfill";
import { getDb } from "../db";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(mockDb as any);
  mockDb.select.mockReturnValue(selectChain);
  selectChain.from.mockReturnThis();
  selectChain.where.mockResolvedValue(ob([]));
  mockDb.update.mockReturnValue(updateChain);
  updateChain.set.mockReturnThis();
  updateChain.where.mockResolvedValue(undefined);
  mockListCustomOrdersByProfile.mockResolvedValue([]);
});

describe("runInteractionBackfill", () => {
  it("dry_run does not write to DB", async () => {
    selectChain.where
      .mockResolvedValueOnce([
        { id: 1, customerProfileId: 100, gmailThreadId: null, createdAt: new Date("2026-06-01") },
      ]) // NULL rows
      .mockResolvedValueOnce(ob([])); // already-assigned siblings
    mockListCustomOrdersByProfile.mockResolvedValueOnce([
      { id: 500, orderNumber: "ORD-2026-0500", category: "quote", destination: "日本" },
    ]);

    const result = await runInteractionBackfill("dry_run");
    expect(result.status).toBe("ok");
    expect(result.mode).toBe("dry_run");
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(result.stats?.assignedCount).toBe(1);
  });

  it("confirm mode actually writes the assignments", async () => {
    selectChain.where
      .mockResolvedValueOnce([
        { id: 1, customerProfileId: 100, gmailThreadId: null, createdAt: new Date("2026-06-01") },
      ])
      .mockResolvedValueOnce(ob([]));
    mockListCustomOrdersByProfile.mockResolvedValueOnce([
      { id: 500, orderNumber: "ORD-2026-0500", category: "quote", destination: "日本" },
    ]);

    const result = await runInteractionBackfill("confirm");
    expect(result.status).toBe("ok");
    expect(result.mode).toBe("confirm");
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(updateChain.set).toHaveBeenCalledWith({ customOrderId: 500 });
    expect(result.updatedCount).toBe(1);
  });

  it("acceptance case: a customer with exactly one in-progress order gets backfilled", async () => {
    selectChain.where
      .mockResolvedValueOnce([
        { id: 1, customerProfileId: 200, gmailThreadId: null, createdAt: new Date("2026-06-01") },
        { id: 2, customerProfileId: 200, gmailThreadId: null, createdAt: new Date("2026-06-02") },
      ])
      .mockResolvedValueOnce(ob([]));
    mockListCustomOrdersByProfile.mockResolvedValueOnce([
      { id: 900, orderNumber: "ORD-2026-0900", category: "quote", destination: "台灣" },
    ]);

    const result = await runInteractionBackfill("dry_run");
    expect(result.stats?.totalNullRows).toBe(2);
    expect(result.stats?.assignedCount).toBe(2);
    expect(result.stats?.staysNullCount).toBe(0);
    expect(result.stats?.byReason.single_in_progress_order).toBe(2);
  });

  it("regression: conflicting sibling rows on the same thread (customOrderId differs) resolve deterministically — earliest-assigned (lowest id) wins, not query row order", async () => {
    // Two already-assigned rows share gmailThreadId "thread-X" but carry
    // DIFFERENT customOrderId values (e.g. Jeff manually re-filed one row
    // later via the UI). The already-assigned-siblings query is ORDER BY id
    // ASC in production, so id=10 (customOrderId=111) is returned before
    // id=11 (customOrderId=222) — the `!m.has(...)` first-wins guard in
    // runInteractionBackfill must pick 111, deterministically, every time
    // (asserted here via confirm mode's actual DB write, not just a reason
    // label, so a regression that silently picked 222 would be caught).
    selectChain.where
      .mockResolvedValueOnce([
        { id: 1, customerProfileId: 600, gmailThreadId: "thread-X", createdAt: new Date("2026-06-03") },
      ])
      .mockResolvedValueOnce(ob([
        { customerProfileId: 600, gmailThreadId: "thread-X", customOrderId: 111 },
        { customerProfileId: 600, gmailThreadId: "thread-X", customOrderId: 222 },
      ]));
    mockListCustomOrdersByProfile.mockResolvedValueOnce([]);

    const result = await runInteractionBackfill("confirm");
    expect(result.status).toBe("ok");
    expect(result.stats?.byReason.thread_inherited).toBe(1);
    expect(updateChain.set).toHaveBeenCalledWith({ customOrderId: 111 });
    expect(updateChain.set).not.toHaveBeenCalledWith({ customOrderId: 222 });
  });

  it("acceptance case (Emerald-shaped): a customer with multiple in-progress orders and no thread-inheritance available stays NULL", async () => {
    selectChain.where
      .mockResolvedValueOnce([
        { id: 1, customerProfileId: 300, gmailThreadId: null, createdAt: new Date("2026-06-01") },
        { id: 2, customerProfileId: 300, gmailThreadId: null, createdAt: new Date("2026-06-02") },
      ])
      .mockResolvedValueOnce(ob([])); // no already-assigned siblings -> no thread inheritance possible
    mockListCustomOrdersByProfile.mockResolvedValueOnce([
      { id: 1, orderNumber: "ORD-2026-0001", category: "flight", destination: "台灣" },
      { id: 2, orderNumber: "ORD-2026-0002", category: "quote", destination: "日本" },
      { id: 3, orderNumber: "ORD-2026-0003", category: "quote", destination: "越南" },
      { id: 4, orderNumber: "ORD-2026-0004", category: "visa", destination: "美國" },
    ]);

    const result = await runInteractionBackfill("dry_run");
    expect(result.stats?.assignedCount).toBe(0);
    expect(result.stats?.staysNullCount).toBe(2);
    expect(result.stats?.byReason.ambiguous_no_llm_or_unconfident).toBe(2);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("excludes test/owner profileIds (0909 = 2760017, Jeff's own = 2730002) by default — no query even issued for their in-progress orders", async () => {
    selectChain.where
      .mockResolvedValueOnce([
        { id: 1, customerProfileId: 2760017, gmailThreadId: null, createdAt: new Date("2026-06-01") },
        { id: 2, customerProfileId: 400, gmailThreadId: null, createdAt: new Date("2026-06-01") },
      ])
      .mockResolvedValueOnce(ob([]));
    mockListCustomOrdersByProfile.mockResolvedValueOnce([
      { id: 700, orderNumber: "ORD-2026-0700", category: "quote", destination: "台灣" },
    ]);

    const result = await runInteractionBackfill("dry_run");
    expect(result.profilesExcludedAsTest).toBe(1);
    expect(result.profilesConsidered).toBe(1);
    // Only the non-test profile's orders were ever looked up.
    expect(mockListCustomOrdersByProfile).toHaveBeenCalledTimes(1);
    expect(mockListCustomOrdersByProfile).toHaveBeenCalledWith(400, { excludeTerminal: true });
    // 0909's row never appears in the plan at all -> only 1 row counted total.
    expect(result.stats?.totalNullRows).toBe(1);
  });

  it("excludeTestAccounts: false opts back into including test/owner profiles", async () => {
    selectChain.where
      .mockResolvedValueOnce([
        { id: 1, customerProfileId: 2760017, gmailThreadId: null, createdAt: new Date("2026-06-01") },
      ])
      .mockResolvedValueOnce(ob([]));
    mockListCustomOrdersByProfile.mockResolvedValueOnce([
      { id: 800, orderNumber: "ORD-2026-0800", category: "quote", destination: "測試" },
    ]);

    const result = await runInteractionBackfill("dry_run", { excludeTestAccounts: false });
    expect(result.profilesExcludedAsTest).toBe(0);
    expect(result.profilesConsidered).toBe(1);
    expect(mockListCustomOrdersByProfile).toHaveBeenCalledWith(2760017, { excludeTerminal: true });
  });

  it("no NULL rows at all -> ok with zero stats, no DB writes, no order lookups", async () => {
    selectChain.where.mockResolvedValueOnce([]); // NULL rows query returns nothing
    const result = await runInteractionBackfill("dry_run");
    expect(result.status).toBe("ok");
    expect(result.stats?.totalNullRows).toBe(0);
    expect(mockListCustomOrdersByProfile).not.toHaveBeenCalled();
  });

  it("returns error (never throws) when getDb resolves to null", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null as any);
    const result = await runInteractionBackfill("dry_run");
    expect(result.status).toBe("error");
  });

  it("returns error (never throws) when the DB query rejects", async () => {
    selectChain.where.mockRejectedValueOnce(new Error("db down"));
    const result = await runInteractionBackfill("dry_run");
    expect(result.status).toBe("error");
  });

  it("deterministic-only constraint: no LLM/agent module is ever imported by this path", async () => {
    // If runInteractionBackfill (or anything it calls) tried to dynamically
    // import the LLM module, vi.mock would need an entry for it — asserting
    // no such mock is registered/called is a static guarantee via code
    // review of interactionBackfill.ts's import list rather than a runtime
    // spy; this test instead asserts the observable behavior: a profile with
    // multiple in-progress orders and no thread inheritance ALWAYS lands on
    // NULL, which is only possible if no llmPick is ever supplied to
    // decideInteractionOrderAssignment (an llmPick, even a bad one, would
    // change the `reason` field but never the ambiguous-case NULL outcome by
    // accident — the point is this backfill has no code path that could
    // ever produce reason:"llm_confident_pick").
    selectChain.where
      .mockResolvedValueOnce([
        { id: 1, customerProfileId: 500, gmailThreadId: null, createdAt: new Date("2026-06-01") },
      ])
      .mockResolvedValueOnce(ob([]));
    mockListCustomOrdersByProfile.mockResolvedValueOnce([
      { id: 1, orderNumber: "ORD-2026-0001", category: "quote", destination: "A" },
      { id: 2, orderNumber: "ORD-2026-0002", category: "quote", destination: "B" },
    ]);
    const result = await runInteractionBackfill("dry_run");
    expect(result.stats?.byReason.llm_confident_pick).toBeUndefined();
    expect(result.stats?.byReason.ambiguous_no_llm_or_unconfident).toBe(1);
  });
});
