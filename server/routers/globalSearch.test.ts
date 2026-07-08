/**
 * globalSearch.search — Ann-class (source=null) customer findable by contact
 * field (v800 search leg, 2026-07-07).
 *
 * The customer-visibility fix (v800) added `OR lastInboundAt IS NOT NULL` to
 * guestList + the nav badge so an inbound-only guest like Ann (profile 2760051:
 * source=null, no inquiry, no escalation card) shows in the list and counts in
 * the badge. The third surface Jeff finds people through is search. globalSearch
 * intentionally has NO qualification gate at all — it matches customerProfiles
 * purely by contact field (email / wechat / line / phone) — so a source=null
 * guest is already returned when her email matches. This test LOCKS THAT IN:
 * if someone ever bolts a `source='manual' OR ...` qualification onto the
 * customer sub-query, Ann-class customers would silently vanish from search and
 * this guard fails.
 *
 * Stubs the drizzle chain (no real DB, per project rule) and fingerprints the
 * customer sub-query's `.where(...)` argument as flat text.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Flatten a drizzle SQL/condition node into text by walking queryChunks — same
 * fingerprinting approach as adminCustomersUnreadCount.test.ts. */
function sqlToText(node: any): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(sqlToText).join("");
  if (Array.isArray(node.queryChunks)) return node.queryChunks.map(sqlToText).join("");
  if ("value" in node) return sqlToText(node.value);
  if (node.name) return `col:${node.name}`;
  return "";
}

/**
 * globalSearch.search fires three parallel selects via Promise.all in a fixed
 * order: [0] tours, [1] customerProfiles, [2] bookings. Each is a
 * `.select().from().where().orderBy().limit()` chain. This stub records the
 * `.where(arg)` of each select by call order so the customer branch ([1]) can
 * be inspected.
 */
function makeSearchDbStub() {
  const wheres: Array<{ where: any }> = [];
  const chainFor = () => {
    const rec = { where: null as any };
    wheres.push(rec);
    const chain: any = {
      from: () => chain,
      where: (arg: any) => {
        rec.where = arg;
        return chain;
      },
      orderBy: () => chain,
      limit: async () => [],
    };
    return chain;
  };
  const db = { select: vi.fn(() => chainFor()) };
  return { db, wheres };
}

describe("globalSearch.search — Ann-class customer findable by email (v800 search leg)", () => {
  let getDbMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    getDbMock = vi.fn();
  });

  it("customer sub-query matches by contact field with NO source/inquiry/escalation gate — a source=null guest is returned when her email matches", async () => {
    const { db, wheres } = makeSearchDbStub();
    getDbMock.mockResolvedValue(db);
    vi.doMock("../db", () => ({ getDb: getDbMock }));

    const { globalSearchRouter } = await import("./globalSearch");
    const caller = (globalSearchRouter as any).createCaller({
      user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    });

    // Ann's email is ayuan@axt.com — search a fragment of it.
    await caller.search({ q: "ayuan" });

    // wheres[0]=tours, [1]=customerProfiles, [2]=bookings.
    expect(wheres.length).toBe(3);
    const customerWhere = sqlToText(wheres[1].where).replace(/\s+/g, " ").toLowerCase();

    // Matches by email (so Ann is found by her address) ...
    expect(customerWhere).toContain("col:email");
    // ... and applies NO qualification gate, so a source=null / no-card guest
    // is not filtered out. If either token appears, someone added a gate that
    // would re-hide Ann-class customers from search — exactly the v800 bug.
    expect(customerWhere).not.toContain("manual");
    expect(customerWhere).not.toContain("escalation");
  });
});
