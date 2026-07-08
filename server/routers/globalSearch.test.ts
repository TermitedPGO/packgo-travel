/**
 * globalSearch — customer search + recentContacts legs of the v802 noise gate.
 *
 * Search + recentContacts are surfaces Jeff finds people through. They must
 * (a) still find/list any real customer — the search WHERE stays a pure
 * email/wechat/line/phone match with NO qualification gate, so a source=null
 * guest like Ann is fetched — and (b) drop inbound-only NOISE/SPAM guests via
 * the SAME isNoiseOnlyGuest applied on the list + badge (口徑一致), then strip
 * the internal gate signals from the response. A registered account, a
 * content-qualified guest, and a NO-INBOUND profile (reached by contact match
 * but never emailed us) must all still appear — the gate only hides genuine
 * inbound-only noise.
 *
 * Stubs the drizzle chain (no real DB, per project rule).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Flatten a drizzle SQL/condition node into text by walking queryChunks. */
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
 * search fires three parallel selects: [0] tours, [1] customerProfiles,
 * [2] bookings. recentContacts fires a single select. `rowsByCall[i]` is what
 * the i-th select's terminal `.limit()` resolves to.
 */
function makeSearchDbStub(rowsByCall: any[][] = []) {
  const wheres: Array<{ where: any }> = [];
  let callIndex = -1;
  const chainFor = () => {
    callIndex += 1;
    const myIndex = callIndex;
    const rec = { where: null as any };
    wheres.push(rec);
    const chain: any = {
      from: () => chain,
      where: (arg: any) => {
        rec.where = arg;
        return chain;
      },
      orderBy: () => chain,
      limit: async () => rowsByCall[myIndex] ?? [],
    };
    return chain;
  };
  const db = { select: vi.fn(() => chainFor()) };
  return { db, wheres };
}

function customerRow(o: Partial<Record<string, any>> = {}) {
  return {
    id: o.id ?? 1,
    email: o.email ?? "x@example.com",
    phone: o.phone ?? null,
    wechatId: o.wechatId ?? null,
    preferredLanguage: o.preferredLanguage ?? "zh-TW",
    lastInteractionAt: o.lastInteractionAt ?? null,
    vipScore: o.vipScore ?? 0,
    userId: o.userId ?? null,
    // has inbound by default; pass lastInboundAt:null explicitly for a no-inbound row.
    lastInboundAt: "lastInboundAt" in o ? o.lastInboundAt : new Date("2026-07-05T10:00:00Z"),
    qualifiesViaContent: o.qualifiesViaContent ?? 0,
    latestInboundIsSpam: o.latestInboundIsSpam ?? 0,
  };
}

// Shared fixtures: what should show vs hide on every surface.
const ann = customerRow({ id: 111, email: "ayuan@axt.com" }); // shown
const noise = customerRow({ id: 222, email: "alerts@chase.com" }); // hidden (known noise)
const spam = customerRow({ id: 333, email: "customer@example.com", latestInboundIsSpam: 1 }); // hidden
const registered = customerRow({ id: 444, email: "alerts@chase.com", userId: 42, latestInboundIsSpam: 1 }); // shown — registered
const content = customerRow({ id: 555, email: "alerts@chase.com", qualifiesViaContent: 1, latestInboundIsSpam: 1 }); // shown — content
const noInbound = customerRow({ id: 666, email: "alerts@chase.com", lastInboundAt: null }); // shown — no inbound

const SHOWN_IDS = [111, 444, 555, 666];
const ALL_FIXTURES = [ann, noise, spam, registered, content, noInbound];

describe("globalSearch.search — customer noise gate (v802 search leg)", () => {
  let getDbMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules();
    getDbMock = vi.fn();
  });

  it("WHERE stays a pure contact match (no source/inquiry/escalation gate) so any real customer is fetched", async () => {
    const { db, wheres } = makeSearchDbStub();
    getDbMock.mockResolvedValue(db);
    vi.doMock("../db", () => ({ getDb: getDbMock }));

    const { globalSearchRouter } = await import("./globalSearch");
    const caller = (globalSearchRouter as any).createCaller({
      user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    });
    await caller.search({ q: "ayuan" });

    const customerWhere = sqlToText(wheres[1].where).replace(/\s+/g, " ").toLowerCase();
    expect(customerWhere).toContain("col:email"); // matches Ann by her address
    // The noise gate runs in TS after the fetch — it must NOT be bolted onto the
    // WHERE (that would drop rows before the gate can exempt registered / content
    // / no-inbound customers).
    expect(customerWhere).not.toContain("manual");
    expect(customerWhere).not.toContain("escalation");
  });

  it("drops inbound-only noise + spam, keeps Ann + registered + content + no-inbound, strips internal signals", async () => {
    const { db } = makeSearchDbStub([[], ALL_FIXTURES, []]);
    getDbMock.mockResolvedValue(db);
    vi.doMock("../db", () => ({ getDb: getDbMock }));

    const { globalSearchRouter } = await import("./globalSearch");
    const caller = (globalSearchRouter as any).createCaller({
      user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    });
    const res = (await caller.search({ q: "a" })) as any;

    expect(res.customers.map((c: any) => c.id).sort((a: number, b: number) => a - b)).toEqual(
      SHOWN_IDS,
    );
    for (const c of res.customers) {
      expect(c).not.toHaveProperty("userId");
      expect(c).not.toHaveProperty("lastInboundAt");
      expect(c).not.toHaveProperty("qualifiesViaContent");
      expect(c).not.toHaveProperty("latestInboundIsSpam");
    }
  });
});

describe("globalSearch.recentContacts — same noise gate (v802 4th surface)", () => {
  let getDbMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules();
    getDbMock = vi.fn();
  });

  it("drops inbound-only noise + spam from recent contacts, keeps the rest, strips internal signals", async () => {
    // recentContacts fires ONE select → call index 0.
    const { db } = makeSearchDbStub([ALL_FIXTURES]);
    getDbMock.mockResolvedValue(db);
    vi.doMock("../db", () => ({ getDb: getDbMock }));

    const { globalSearchRouter } = await import("./globalSearch");
    const caller = (globalSearchRouter as any).createCaller({
      user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    });
    const rows = (await caller.recentContacts()) as any[];

    expect(rows.map((c) => c.id).sort((a: number, b: number) => a - b)).toEqual(SHOWN_IDS);
    for (const c of rows) {
      expect(c).not.toHaveProperty("userId");
      expect(c).not.toHaveProperty("lastInboundAt");
      expect(c).not.toHaveProperty("qualifiesViaContent");
      expect(c).not.toHaveProperty("latestInboundIsSpam");
    }
  });
});
