/**
 * Tests for customerMerge — the extracted merge core + the filing-entrance
 * guest→member auto-heal (2026-07-02 G2).
 *
 * The chat-facing merge behavior (validation, message wording, row movement
 * through executeWriteTool) keeps its guard in opsTools.test.ts — those tests
 * now run THROUGH mergeCustomerProfiles, so they cover the extraction 1:1.
 * This file covers what opsTools cannot: the pure heal decision table, the
 * resolveCanonicalForFiling wiring (fast paths, cap, throw-fallback), and the
 * core's defensive invariants for non-chat callers.
 *
 * DB is the same chainable drizzle mock opsTools.test.ts uses (rowQueue per
 * .limit() call, nextRows for awaited update/delete/bare-where selects); the
 * real drizzle-orm + schema are used so query construction stays honest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { mockAudit, mockTouchLastInbound, mockEnqueueRefresh } = vi.hoisted(() => ({
  mockAudit: vi.fn(),
  mockTouchLastInbound: vi.fn(),
  mockEnqueueRefresh: vi.fn(),
}));
vi.mock("./auditLog", () => ({ audit: mockAudit }));
vi.mock("./customerUnread", () => ({ touchLastInbound: mockTouchLastInbound }));
// fire-and-forget summary refresh must not pull the real BullMQ/Redis queue
vi.mock("../queue", () => ({ enqueueCustomerSummaryRefresh: mockEnqueueRefresh }));

import {
  decideFilingHeal,
  mergeCustomerProfiles,
  resolveCanonicalForFiling,
  mergeCustomerNote,
  laToday,
} from "./customerMerge";

// Chainable Drizzle query-builder mock (same shape as opsTools.test.ts).
let nextRows: any[] = [];
let rowQueue: any[][] = [];
const takeRows = () => (rowQueue.length ? rowQueue.shift()! : nextRows);
function makeDb() {
  const chain: any = {};
  for (const m of ["select", "from", "leftJoin", "orderBy", "groupBy", "insert", "values", "update", "set", "delete"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(() => Promise.resolve(takeRows()));
  chain.where = vi.fn(() => {
    const p: any = Promise.resolve(nextRows);
    p.orderBy = () => chain;
    p.groupBy = () => chain;
    // alias the SAME spy so `db.limit` call counts include .where().limit(n)
    p.limit = chain.limit;
    return p;
  });
  return chain;
}

beforeEach(() => {
  nextRows = [];
  rowQueue = [];
  mockAudit.mockReset();
  mockTouchLastInbound.mockReset();
  mockEnqueueRefresh.mockReset();
});

const EMAIL = "jeffhsieh0909@gmail.com";
const GUEST = {
  id: 2730001,
  userId: null,
  name: "Jeff Test",
  email: EMAIL,
  status: "active",
  jeffPersonalNote: null,
};
const MEMBER = {
  id: 2760017,
  name: "Jeff Hsieh",
  email: EMAIL,
  mergedIntoProfileId: null,
  status: "active",
};
/** resolved-card shape decideFilingHeal takes (id/userId/email). */
const GUEST_RESOLVED = { id: GUEST.id, userId: null, email: EMAIL };

// ── decideFilingHeal — pure decision table ──────────────────────────────────

describe("decideFilingHeal (收信入口自癒的決策表,cap:寄件人自己的訪客卡 + 恰好一張活的會員卡)", () => {
  it("guest + exactly one member twin → heal into the member (0909 實案 shape)", () => {
    expect(
      decideFilingHeal({
        filingEmail: EMAIL,
        resolved: GUEST_RESOLVED,
        memberMatches: [{ id: MEMBER.id }],
      }),
    ).toEqual({ heal: true, targetProfileId: MEMBER.id });
  });

  it("guest only (no member twin) → unchanged", () => {
    expect(
      decideFilingHeal({ filingEmail: EMAIL, resolved: GUEST_RESOLVED, memberMatches: [] }),
    ).toEqual({ heal: false, reason: "no_member_match" });
  });

  it("member resolved directly (userId set) → unchanged, never merges a member", () => {
    expect(
      decideFilingHeal({
        filingEmail: EMAIL,
        resolved: { id: MEMBER.id, userId: 60001, email: EMAIL },
        memberMatches: [{ id: 999 }],
      }),
    ).toEqual({ heal: false, reason: "already_member" });
  });

  it("several member twins → unchanged (ambiguous — duplicateProfileScan's job, no inline guess)", () => {
    expect(
      decideFilingHeal({
        filingEmail: EMAIL,
        resolved: GUEST_RESOLVED,
        memberMatches: [{ id: 1 }, { id: 2 }],
      }),
    ).toEqual({ heal: false, reason: "multiple_member_matches" });
  });

  it("resolved row missing → unchanged", () => {
    expect(
      decideFilingHeal({ filingEmail: EMAIL, resolved: undefined, memberMatches: [{ id: 1 }] }),
    ).toEqual({ heal: false, reason: "profile_missing" });
  });

  it("defensive: the resolved card itself in the member list is excluded, never self-merges", () => {
    expect(
      decideFilingHeal({
        filingEmail: EMAIL,
        resolved: GUEST_RESOLVED,
        memberMatches: [{ id: GUEST.id }],
      }),
    ).toEqual({ heal: false, reason: "no_member_match" });
    // …and self + one real member still heals into the real member.
    expect(
      decideFilingHeal({
        filingEmail: EMAIL,
        resolved: GUEST_RESOLVED,
        memberMatches: [{ id: GUEST.id }, { id: MEMBER.id }],
      }),
    ).toEqual({ heal: true, targetProfileId: MEMBER.id });
  });

  // ── P1 guard: heal 只准開在寄件人自己的卡上 ──────────────────────────────

  it("P1: pointer landed on ANOTHER person's card (email differs) → email_mismatch, never heals", () => {
    // leslie→Emerald 實案 shape:leslie 來信,舊卡指標走到 Emerald 的訪客卡,
    // 而 leslie 自己有(或剛註冊出)一張會員卡 — 在 Emerald 的卡上 heal 就是
    // 跨身分合併 + 指標循環。
    expect(
      decideFilingHeal({
        filingEmail: "leslie@gmail.com",
        resolved: { id: 222, userId: null, email: "emerald@axtours.com" },
        memberMatches: [{ id: 333 }],
      }),
    ).toEqual({ heal: false, reason: "email_mismatch" });
  });

  it("P1: email compare is case/whitespace-insensitive — same identity still heals", () => {
    expect(
      decideFilingHeal({
        filingEmail: " JeffHsieh0909@Gmail.com ",
        resolved: GUEST_RESOLVED,
        memberMatches: [{ id: MEMBER.id }],
      }),
    ).toEqual({ heal: true, targetProfileId: MEMBER.id });
  });

  it("P1 defensive: empty filing email or NULL resolved email → email_mismatch", () => {
    expect(
      decideFilingHeal({ filingEmail: "", resolved: { id: GUEST.id, userId: null, email: "" }, memberMatches: [{ id: MEMBER.id }] }),
    ).toEqual({ heal: false, reason: "email_mismatch" });
    expect(
      decideFilingHeal({ filingEmail: EMAIL, resolved: { id: GUEST.id, userId: null, email: null }, memberMatches: [{ id: MEMBER.id }] }),
    ).toEqual({ heal: false, reason: "email_mismatch" });
  });

  // ── P1/P2: 只有「活的」會員卡能當 heal 目標 ──────────────────────────────

  it("P1: member twin already merged away (0109 pointer set) → excluded, no heal into a dead card", () => {
    expect(
      decideFilingHeal({
        filingEmail: EMAIL,
        resolved: GUEST_RESOLVED,
        memberMatches: [{ id: MEMBER.id, mergedIntoProfileId: 999 }],
      }),
    ).toEqual({ heal: false, reason: "no_member_match" });
  });

  it("P2: member twin hidden via markNotCustomer (status=blocked) → excluded, mail stays on the visible guest", () => {
    expect(
      decideFilingHeal({
        filingEmail: EMAIL,
        resolved: GUEST_RESOLVED,
        memberMatches: [{ id: MEMBER.id, status: "blocked" }],
      }),
    ).toEqual({ heal: false, reason: "no_member_match" });
  });

  it("P2: blocked twin does NOT count toward ambiguity — blocked + one live member heals into the live one", () => {
    expect(
      decideFilingHeal({
        filingEmail: EMAIL,
        resolved: GUEST_RESOLVED,
        memberMatches: [
          { id: 555, status: "blocked" },
          { id: MEMBER.id, mergedIntoProfileId: null, status: "active" },
        ],
      }),
    ).toEqual({ heal: true, targetProfileId: MEMBER.id });
  });
});

// ── resolveCanonicalForFiling — DB wiring ───────────────────────────────────

describe("resolveCanonicalForFiling (兩個收信入口共用的一行 helper)", () => {
  it("guest + one member → merges guest into member and files to the member id", async () => {
    const db = makeDb();
    // pointer hop (no pointer) → resolved row (guest) → member match → dup-scan
    rowQueue = [[{ next: null }], [{ ...GUEST }], [{ ...MEMBER }], []];
    const MAX_AT = new Date("2026-07-02T10:00:00Z");
    nextRows = [{ affectedRows: 1, maxAt: MAX_AT }];

    const id = await resolveCanonicalForFiling(db as any, GUEST.id, GUEST.email);

    expect(id).toBe(MEMBER.id);
    // The four moves re-point rows at the member…
    expect(db.set).toHaveBeenCalledWith({ customerProfileId: MEMBER.id });
    // …the guest is hidden with the 0109 pointer (idempotence: next inbound
    // short-circuits at followMergePointer, no second merge)…
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "blocked",
        mergedIntoProfileId: MEMBER.id,
        jeffPersonalNote: expect.stringContaining(`已併入 Jeff Hsieh (#${MEMBER.id})`),
      }),
    );
    // …the member's unread pointer is recomputed (forward-only via helper)…
    expect(mockTouchLastInbound).toHaveBeenCalledWith(expect.anything(), MEMBER.id, MAX_AT);
    // …and the audit row carries the system actor + auto-heal reason.
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const arg = mockAudit.mock.calls[0][0];
    expect(arg.action).toBe("customer.mergeInto");
    expect(arg.targetId).toBe(GUEST.id);
    expect(arg.ctx.user).toEqual({ id: 0, email: "system-auto-heal", role: "system" });
    expect(arg.reason).toContain("auto-heal");
    expect(arg.reason).toContain(`source=${GUEST.id}`);
    expect(arg.reason).toContain(`target=${MEMBER.id}`);
  });

  it("guest with NO member twin → unchanged, nothing merged", async () => {
    const db = makeDb();
    rowQueue = [[{ next: null }], [{ ...GUEST }], []];
    const id = await resolveCanonicalForFiling(db as any, GUEST.id, GUEST.email);
    expect(id).toBe(GUEST.id);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("member card resolved directly → unchanged fast path (member query skipped)", async () => {
    const db = makeDb();
    rowQueue = [[{ next: null }], [{ ...MEMBER, userId: 60001, status: "active", jeffPersonalNote: null }]];
    const id = await resolveCanonicalForFiling(db as any, MEMBER.id, MEMBER.email);
    expect(id).toBe(MEMBER.id);
    // pointer hop + resolved row only — no member-twin lookup, no writes.
    expect(db.limit).toHaveBeenCalledTimes(2);
    expect(db.update).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("several member twins → capped out, files to the guest unchanged", async () => {
    const db = makeDb();
    rowQueue = [[{ next: null }], [{ ...GUEST }], [{ id: 1, name: "a", email: GUEST.email }, { id: 2, name: "b", email: GUEST.email }]];
    const id = await resolveCanonicalForFiling(db as any, GUEST.id, GUEST.email);
    expect(id).toBe(GUEST.id);
    expect(db.update).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("heal THROW → falls back to the guest id (mail processing must not break)", async () => {
    const db = makeDb();
    rowQueue = [[{ next: null }], [{ ...GUEST }], [{ ...MEMBER }], []];
    // First write of the merge blows up mid-heal.
    db.update.mockImplementation(() => {
      throw new Error("deadlock");
    });
    const id = await resolveCanonicalForFiling(db as any, GUEST.id, GUEST.email);
    expect(id).toBe(GUEST.id);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("no email → pointer resolution only, no heal lookup", async () => {
    const db = makeDb();
    rowQueue = [[{ next: null }]];
    const id = await resolveCanonicalForFiling(db as any, GUEST.id, null);
    expect(id).toBe(GUEST.id);
    expect(db.limit).toHaveBeenCalledTimes(1); // the pointer hop only
  });

  it("already-healed guest (0109 pointer set) routes to the member WITHOUT a second merge", async () => {
    const db = makeDb();
    // pointer hop: guest → member, member has no pointer; resolved row = member.
    rowQueue = [
      [{ next: MEMBER.id }],
      [{ next: null }],
      [{ ...MEMBER, userId: 60001, jeffPersonalNote: null }],
    ];
    const id = await resolveCanonicalForFiling(db as any, GUEST.id, GUEST.email);
    expect(id).toBe(MEMBER.id);
    expect(db.update).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("P1: pointer resolves to ANOTHER person's guest card (leslie→Emerald) → files there, never heals", async () => {
    const db = makeDb();
    const EMERALD = {
      id: 222,
      userId: null,
      name: "Emerald Young",
      email: "emerald@axtours.com",
      status: "active",
      jeffPersonalNote: null,
    };
    // leslie 的舊卡 #111 帶 0109 指標 → Emerald 的訪客卡 #222;leslie 同時有
    // 一張會員卡 #333(mock 直接回它 — prod SQL 會查到,決策層必須擋)。
    rowQueue = [
      [{ next: EMERALD.id }],
      [{ next: null }],
      [{ ...EMERALD }],
      [{ id: 333, name: "Leslie Green", email: "leslie@gmail.com", mergedIntoProfileId: null, status: "active" }],
    ];
    const id = await resolveCanonicalForFiling(db as any, 111, "leslie@gmail.com");
    // Emerald 的卡原封不動:信照舊 file 到指標目標,絕不跨身分合併。
    expect(id).toBe(EMERALD.id);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("P1: member twin already merged away (0109 pointer) → defensive filter skips it, files to the guest", async () => {
    const db = makeDb();
    // prod SQL 已用 isNull(mergedIntoProfileId) 擋掉;這裡故意讓 mock 回一張
    // 帶指標的會員卡,驗證純決策層的第二道防線。
    rowQueue = [
      [{ next: null }],
      [{ ...GUEST }],
      [{ ...MEMBER, mergedIntoProfileId: 999 }],
    ];
    const id = await resolveCanonicalForFiling(db as any, GUEST.id, GUEST.email);
    expect(id).toBe(GUEST.id);
    expect(db.update).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("P2: member twin hidden via markNotCustomer (status=blocked) → no heal, mail stays visible on the guest", async () => {
    const db = makeDb();
    rowQueue = [
      [{ next: null }],
      [{ ...GUEST }],
      [{ ...MEMBER, status: "blocked" }],
    ];
    const id = await resolveCanonicalForFiling(db as any, GUEST.id, GUEST.email);
    expect(id).toBe(GUEST.id);
    expect(db.update).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

// ── mergeCustomerProfiles — defensive invariants for non-chat callers ───────
// (chat-path behavior — dup-drop counts, note append, message — stays guarded
// by opsTools.test.ts, which now exercises this same core through the tool.)

describe("mergeCustomerProfiles (機械核心 invariants)", () => {
  const ACTOR = { id: 42, email: "ops-agent", role: "admin" };

  it("refuses a registered-member SOURCE even when the caller skipped validation", async () => {
    const db = makeDb();
    await expect(
      mergeCustomerProfiles(db as any, {
        sourceProfileId: MEMBER.id,
        targetProfileId: 999,
        actor: ACTOR,
        reason: "test",
        source: { ...GUEST, id: MEMBER.id, userId: 60001 },
      }),
    ).rejects.toThrow(/registered member/);
    expect(db.update).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("refuses a self-merge", async () => {
    const db = makeDb();
    await expect(
      mergeCustomerProfiles(db as any, {
        sourceProfileId: GUEST.id,
        targetProfileId: GUEST.id,
        actor: ACTOR,
        reason: "test",
        source: { ...GUEST },
        target: { id: GUEST.id, name: GUEST.name, email: GUEST.email },
      }),
    ).rejects.toThrow(/itself/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("throws when the source row is missing (un-preloaded caller)", async () => {
    const db = makeDb();
    rowQueue = [[]]; // source lookup misses
    await expect(
      mergeCustomerProfiles(db as any, {
        sourceProfileId: 12345,
        targetProfileId: MEMBER.id,
        actor: ACTOR,
        reason: "test",
      }),
    ).rejects.toThrow(/#12345 not found/);
  });

  it("un-preloaded happy path: loads source+target itself, moves, blocks, audits with the given actor/reason", async () => {
    const db = makeDb();
    // source lookup → target lookup → dup-scan (one shared thread)
    rowQueue = [[{ ...GUEST }], [{ ...MEMBER }], [{ externalId: "<msg-1@mail.gmail.com>" }]];
    nextRows = [{ affectedRows: 2, maxAt: null }];
    const out = await mergeCustomerProfiles(db as any, {
      sourceProfileId: GUEST.id,
      targetProfileId: MEMBER.id,
      actor: ACTOR,
      reason: "verbatim-reason",
    });
    expect(out.targetProfileId).toBe(MEMBER.id);
    expect(out.moved).toEqual({ interactions: 2, documents: 2, orders: 2, chatMessages: 2 });
    expect(out.duplicatesDropped).toBe(2); // delete reports affectedRows: 2
    expect(out.sourceLabel).toBe("Jeff Test");
    expect(out.targetLabel).toBe("Jeff Hsieh");
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "blocked", mergedIntoProfileId: MEMBER.id }),
    );
    const arg = mockAudit.mock.calls[0][0];
    expect(arg.reason).toBe("verbatim-reason");
    expect(arg.ctx.user).toBe(ACTOR);
    expect(arg.changes.before).toEqual({ status: "active" });
    expect(arg.changes.after).toEqual(
      expect.objectContaining({ status: "blocked", mergedInto: MEMBER.id }),
    );
  });
});

// ── moved pure helpers keep working from their new home ────────────────────

describe("mergeCustomerNote / laToday (moved from opsTools with the core)", () => {
  it("appends with an LA-dated [M/D] tag and preserves the old note", () => {
    const now = new Date("2026-07-02T20:00:00Z"); // LA = 7/2
    expect(mergeCustomerNote("舊備註", "新的一行", false, now)).toBe("舊備註\n[7/2] 新的一行");
    expect(laToday(now)).toBe("2026-07-02");
  });

  it("replace:true overwrites; empty old note returns the new text bare", () => {
    expect(mergeCustomerNote("舊", "新", true)).toBe("新");
    expect(mergeCustomerNote(null, "新", false)).toBe("新");
  });
});
