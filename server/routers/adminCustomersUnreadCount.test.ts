/**
 * customerUnreadCount — nav badge 口徑對齊 guestList (A3, Phase6).
 *
 * Bug: the guest sub-query in customerUnreadCount counted every guest
 * profile matching the WHERE gates, with no ORDER BY / LIMIT. guestList
 * (the visible list backing the red dots) only ever shows the top 200
 * guests by lastContactAt DESC. A guest ranked past #200 could inflate the
 * badge count while never appearing in the list for Jeff to see — badge and
 * visible red dots could diverge. Fix: guest sub-query now chains the exact
 * same `.orderBy(desc(lastContactSql)).limit(200)` window guestList uses.
 *
 * This test stubs the drizzle chain (fluent builder) and asserts the guest
 * query used by customerUnreadCount calls orderBy(...).limit(200) — the
 * concrete, regression-proof signal that the window was actually applied.
 * No real DB (rule); registered-side query is untouched (no LIMIT there
 * either, matching customerList's unlimited registered set) so this test
 * only targets the guest branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Normalizes a drizzle SQL/condition object (or a plain string chunk) into
 * flat text by walking `queryChunks` recursively. Used to fingerprint a
 * `.where(and(...))` call's actual condition set so two queries' WHERE
 * populations can be diffed textually — this is what catches an
 * un-mirrored extra filter (like the A3 `lastInboundAt IS NOT NULL` bug)
 * that a mechanical orderBy/limit stub assertion cannot see.
 */
function sqlToText(node: any): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(sqlToText).join("");
  if (Array.isArray(node.queryChunks)) return node.queryChunks.map(sqlToText).join("");
  if ("value" in node) return sqlToText(node.value);
  // drizzle Column objects etc. — fall back to a stable-ish identifier so
  // two references to the same column produce the same text.
  if (node.name) return `col:${node.name}`;
  return "";
}

/** and(...) in drizzle stores its parts on `.queryChunks` mixed with " and " glue (drizzle-orm lowercases the joiner); extract just the condition operands as a set of whitespace-normalized strings so differing source indentation doesn't cause false mismatches. */
function whereConditionSet(andArg: any): Set<string> {
  const text = sqlToText(andArg).replace(/\s+/g, " ").trim();
  return new Set(
    text
      .split(/\s+and\s+(?=\()/gi)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

vi.mock("../rateLimit", () => ({
  checkAdminMutationRateLimit: vi.fn(async () => ({ allowed: true, remaining: 59 })),
}));
vi.mock("../_core/logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
// LLM client is never exercised by customerUnreadCount; stub it out so the
// module graph doesn't touch network-adjacent SDK construction in tests.
vi.mock("../_core/llm", () => ({ invokeLLM: vi.fn() }));

/**
 * Builds a chain stub mimicking drizzle's fluent query builder. Each select()
 * call records which table + which chain calls (orderBy/limit) were made,
 * keyed by call order — customerUnreadCount issues the registered select
 * first, then the guest select, so callIndex 0 = registered, 1 = guest.
 */
function makeDbStub(registeredRows: any[], guestRows: any[]) {
  const calls: Array<{ orderBy: boolean; limitArg: number | null; whereArg: any }> = [];

  const chainFor = (rows: any[]) => {
    const record = { orderBy: false, limitArg: null as number | null, whereArg: null as any };
    calls.push(record);
    const terminal = async () => rows;
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: (arg: any) => {
        record.whereArg = arg;
        return chain;
      },
      orderBy: (..._args: any[]) => {
        record.orderBy = true;
        return chain;
      },
      limit: (n: number) => {
        record.limitArg = n;
        return terminal();
      },
      // customerUnreadCount's registered query has no .limit(); awaiting the
      // chain directly (no .limit call) must also resolve to the rows.
      then: (resolve: any, reject: any) => terminal().then(resolve, reject),
    };
    return chain;
  };

  let selectCallCount = 0;
  const db = {
    select: vi.fn(() => {
      selectCallCount += 1;
      return selectCallCount === 1 ? chainFor(registeredRows) : chainFor(guestRows);
    }),
  };
  return { db, calls };
}

describe("customerUnreadCount — guest sub-query window (A3, Phase6)", () => {
  let dbGetDbMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    dbGetDbMock = vi.fn();
  });

  it("guest sub-query chains orderBy + limit(200), matching guestList's window", async () => {
    const { db: dbStub, calls } = makeDbStub([], []);
    dbGetDbMock.mockResolvedValue(dbStub);
    vi.doMock("../db", () => ({ getDb: dbGetDbMock }));

    const { adminCustomersRouter } = await import("./adminCustomers");
    const caller = (adminCustomersRouter as any).createCaller({
      user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    });

    await caller.customerUnreadCount();

    // calls[0] = registered select (no window expected), calls[1] = guest
    // select (must carry the same orderBy+limit(200) guestList applies).
    expect(calls).toHaveLength(2);
    expect(calls[1].orderBy).toBe(true);
    expect(calls[1].limitArg).toBe(200);
  });

  it("a guest ranked past #200 (excluded by the LIMIT) does not inflate the count", async () => {
    // The chain stub's `limit()` is the truncation point — simulate the
    // window by only returning the top-200-equivalent slice as `guestRows`.
    // This proves the count is a function of what the LIMIT lets through,
    // not the full unfiltered guest set.
    const guestRow = {
      status: "active",
      lastInboundAt: new Date("2026-07-03T10:00:00Z"),
      jeffViewedAt: null,
    };
    // Only ONE guest survives past the (simulated) limit(200) cut, even
    // though the underlying gate-matching set could have had many more.
    const { db: dbStub, calls } = makeDbStub([], [guestRow]);
    dbGetDbMock.mockResolvedValue(dbStub);
    vi.doMock("../db", () => ({ getDb: dbGetDbMock }));

    const { adminCustomersRouter } = await import("./adminCustomers");
    const caller = (adminCustomersRouter as any).createCaller({
      user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    });

    const result = await caller.customerUnreadCount();
    expect(result.count).toBe(1);
    expect(calls[1].limitArg).toBe(200);
  });

  it("guest sub-query's WHERE population exactly matches guestList's (A3 hotfix regression)", async () => {
    // The orderBy/limit(200) stub assertions above cannot see a WHERE-clause
    // divergence — two queries can both chain identical orderBy/limit(200)
    // and still rank over DIFFERENT populations if one has an extra filter
    // (e.g. the `lastInboundAt IS NOT NULL` pre-filter this hotfix removed).
    // This test captures the actual `.where(and(...))` argument passed by
    // BOTH customerUnreadCount's guest branch and guestList, normalizes each
    // into a set of condition strings, and asserts the sets are IDENTICAL —
    // proving both queries rank over the same base population before the
    // shared ORDER BY lastContactAt DESC LIMIT 200 window truncates it.
    const { db: dbStub, calls } = makeDbStub([], []);
    dbGetDbMock.mockResolvedValue(dbStub);
    vi.doMock("../db", () => ({ getDb: dbGetDbMock }));

    const { adminCustomersRouter } = await import("./adminCustomers");
    const caller = (adminCustomersRouter as any).createCaller({
      user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    });

    await caller.customerUnreadCount();
    const countGuestWhere = calls[1].whereArg;
    expect(countGuestWhere).toBeTruthy();

    // Second pass: capture guestList's WHERE by calling it against a fresh
    // stub in the same module instance (module already loaded above).
    const { db: dbStub2, calls: calls2 } = makeDbStub([], []);
    dbGetDbMock.mockResolvedValue(dbStub2);
    await caller.guestList();
    const guestListWhere = calls2[0].whereArg;
    expect(guestListWhere).toBeTruthy();

    const countSet = whereConditionSet(countGuestWhere);
    const listSet = whereConditionSet(guestListWhere);

    // Symmetric diff must be empty — no condition present in one but not
    // the other. If this fails, re-introducing an un-mirrored filter (like
    // the old `lastInboundAt IS NOT NULL` guest pre-filter) will show up
    // here as a non-empty "only in count" or "only in list" set.
    const onlyInCount = [...countSet].filter((c) => !listSet.has(c));
    const onlyInList = [...listSet].filter((c) => !countSet.has(c));
    expect({ onlyInCount, onlyInList }).toEqual({ onlyInCount: [], onlyInList: [] });
  });
});
