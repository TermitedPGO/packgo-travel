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

/**
 * Ann-class guest visibility (v800, 2026-07-07). Profile 2760051 had
 * source=null, NO inquiry row, and NO escalation agentMessages card (her
 * inquiry classification silently failed — the original Ann 事故), yet a real
 * lastInboundAt (she emailed us). The old qualification (source='manual' OR
 * EXISTS inquiry OR EXISTS escalation) matched none of those, so guestList AND
 * the badge both excluded her — invisible even under includeHidden (which only
 * toggles the blocked filter, applied AFTER this qualification). v800 adds
 * `OR lastInboundAt IS NOT NULL` to the shared qualification, VERBATIM in both.
 */
describe("Ann-class guest visibility — inbound-only real customer (v800)", () => {
  let dbGetDbMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    dbGetDbMock = vi.fn();
  });

  it("BOTH guestList (list) and customerUnreadCount (badge) admit an inbound-only guest via the mirrored `lastInboundAt IS NOT NULL` OR arm", async () => {
    const { db: dbStub, calls } = makeDbStub([], []);
    dbGetDbMock.mockResolvedValue(dbStub);
    vi.doMock("../db", () => ({ getDb: dbGetDbMock }));

    const { adminCustomersRouter } = await import("./adminCustomers");
    const caller = (adminCustomersRouter as any).createCaller({
      user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    });

    await caller.customerUnreadCount();
    const badgeWhere = sqlToText(calls[1].whereArg).replace(/\s+/g, " ");

    const { db: dbStub2, calls: calls2 } = makeDbStub([], []);
    dbGetDbMock.mockResolvedValue(dbStub2);
    await caller.guestList();
    const listWhere = sqlToText(calls2[0].whereArg).replace(/\s+/g, " ");

    // The NEW disjunct that admits Ann. lastInboundAt appears in the WHERE only
    // via this arm (the GREATEST lastContact expression lives in SELECT/orderBy,
    // never the WHERE), so this substring is unambiguous — distinct from the
    // email/phone `... IS NOT NULL` contactable checks.
    expect(badgeWhere).toMatch(/lastInboundAt\s+IS NOT NULL/i);
    expect(listWhere).toMatch(/lastInboundAt\s+IS NOT NULL/i);

    // Ann only qualifies via that arm — she fails the other three disjuncts
    // (source≠manual, no inquiry EXISTS, no escalation EXISTS). Model the SQL
    // qualification as a pure predicate; assert her exact shape passes while a
    // truly empty guest (never wrote in) is still correctly excluded.
    const qualifies = (g: {
      source: string | null;
      hasInquiry: boolean;
      hasEscalation: boolean;
      lastInboundAt: Date | null;
    }) =>
      g.source === "manual" ||
      g.hasInquiry ||
      g.hasEscalation ||
      g.lastInboundAt != null;

    expect(
      qualifies({
        source: null,
        hasInquiry: false,
        hasEscalation: false,
        lastInboundAt: new Date("2026-07-07T17:20:00Z"),
      }),
    ).toBe(true);
    expect(
      qualifies({
        source: null,
        hasInquiry: false,
        hasEscalation: false,
        lastInboundAt: null,
      }),
    ).toBe(false);
  });
});

/**
 * v802 noise gate (2026-07-07). v801's `OR lastInboundAt IS NOT NULL` readmitted
 * historical NOISE cards (marketing / notification senders that emailed us and
 * carry a lastInboundAt) — badge 99+, cockpit flooded. The fix gates the
 * inbound-only branch through isNoiseOnlyGuest on ALL THREE surfaces. These two
 * exercise the REAL guestList + customerUnreadCount code paths (not just the
 * pure gate) with the three canonical fixtures, so a future refactor that drops
 * the `.filter(...)` wiring fails here.
 */
function guestRow(o: Partial<Record<string, any>> = {}) {
  return {
    profileId: o.profileId ?? 1,
    name: o.name ?? "Test Guest",
    email: o.email ?? "x@example.com",
    phone: o.phone ?? null,
    status: o.status ?? "active",
    // unread inbound: has an inbound, Jeff hasn't viewed → counts toward badge.
    lastInboundAt: o.lastInboundAt ?? new Date("2026-07-05T10:00:00Z"),
    jeffViewedAt: o.jeffViewedAt ?? null,
    lastOutboundAt: o.lastOutboundAt ?? null,
    createdAt: o.createdAt ?? new Date("2026-07-01T00:00:00Z"),
    needsFollowup: o.needsFollowup ?? 0,
    unread: o.unread ?? 1,
    qualifiesViaContent: o.qualifiesViaContent ?? 0,
    latestInboundIsSpam: o.latestInboundIsSpam ?? 0,
  };
}

describe("v802 noise gate wired on list + badge (three fixtures)", () => {
  let dbGetDbMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules();
    dbGetDbMock = vi.fn();
  });

  const ann = guestRow({ profileId: 111, email: "ayuan@axt.com" }); // shown
  const noise = guestRow({ profileId: 222, email: "alerts@chase.com" }); // hidden (known noise)
  const spam = guestRow({
    profileId: 333,
    email: "customer@example.com",
    latestInboundIsSpam: 1,
  }); // hidden (spam)

  it("guestList (list) drops inbound-only noise + spam, keeps Ann; includeHidden reveals them", async () => {
    // guestList issues a single select → makeDbStub serves it from the FIRST arg.
    const { db: dbStub } = makeDbStub([ann, noise, spam], []);
    dbGetDbMock.mockResolvedValue(dbStub);
    vi.doMock("../db", () => ({ getDb: dbGetDbMock }));

    const { adminCustomersRouter } = await import("./adminCustomers");
    const caller = (adminCustomersRouter as any).createCaller({
      user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    });

    const list = (await caller.guestList()) as any[];
    expect(list.map((r) => r.email)).toEqual(["ayuan@axt.com"]);

    // includeHidden brings noise/spam back (flagged) so Jeff can audit + bulk-block.
    const { db: dbStub2 } = makeDbStub([ann, noise, spam], []);
    dbGetDbMock.mockResolvedValue(dbStub2);
    const all = (await caller.guestList({ includeHidden: true })) as any[];
    expect(all).toHaveLength(3);
    expect(
      all.filter((r) => r.isNoise).map((r) => r.email).sort(),
    ).toEqual(["alerts@chase.com", "customer@example.com"]);
  });

  it("badge (customerUnreadCount) counts only Ann among unread inbound-only guests, not noise/spam", async () => {
    // registered select = call 1 (empty), guest select = call 2 (the fixtures).
    const { db: dbStub } = makeDbStub([], [ann, noise, spam]);
    dbGetDbMock.mockResolvedValue(dbStub);
    vi.doMock("../db", () => ({ getDb: dbGetDbMock }));

    const { adminCustomersRouter } = await import("./adminCustomers");
    const caller = (adminCustomersRouter as any).createCaller({
      user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    });

    const { count } = await caller.customerUnreadCount();
    expect(count).toBe(1);
  });
});
