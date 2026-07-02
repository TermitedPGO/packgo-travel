/**
 * customerUnread — 來訊未讀通知的共用邏輯 (customer-cockpit, 2026-07-01)。
 *
 * Covers:
 *   - isUnreadInbound: the ONE unread rule customerList / guestList /
 *     customerUnreadCount all share (lastInboundAt 非空 且 (jeffViewedAt 空
 *     或 lastInboundAt > jeffViewedAt)).
 *   - touchLastInbound: monotonic pointer write — the WHERE carries the
 *     only-forward guard, invalid inputs no-op, and a DB failure NEVER
 *     escapes (紅點壞了不准弄死收信主流程).
 *   - markCustomerSeen: guest = direct update by profileId; registered =
 *     upsert-by-userId (existing row → update, none → insert minimal profile).
 *
 * db is a chain stub (approvalTasks.test.ts precedent) — no MySQL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  isUnreadInbound,
  touchLastInbound,
  markCustomerSeen,
} from "./customerUnread";

const d = (iso: string) => new Date(iso);

describe("isUnreadInbound — unread 計算", () => {
  it("no inbound ever (lastInboundAt null) → not unread", () => {
    expect(isUnreadInbound(null, null)).toBe(false);
    expect(isUnreadInbound(null, d("2026-07-01"))).toBe(false);
    expect(isUnreadInbound(undefined, null)).toBe(false);
  });

  it("inbound exists and Jeff never opened the customer → unread", () => {
    expect(isUnreadInbound(d("2026-07-01"), null)).toBe(true);
    expect(isUnreadInbound(d("2026-07-01"), undefined)).toBe(true);
  });

  it("inbound newer than Jeff's last view → unread", () => {
    expect(isUnreadInbound(d("2026-07-01T10:00:00Z"), d("2026-07-01T09:00:00Z"))).toBe(true);
  });

  it("Jeff viewed after (or at) the last inbound → read", () => {
    expect(isUnreadInbound(d("2026-07-01T09:00:00Z"), d("2026-07-01T10:00:00Z"))).toBe(false);
    // exact tie is READ — viewing at the same instant counts as seen
    expect(isUnreadInbound(d("2026-07-01T10:00:00Z"), d("2026-07-01T10:00:00Z"))).toBe(false);
  });
});

/** update(table).set(x).where(y) chain stub capturing set/where args. */
function updateChain(capture: { set?: any; where?: any }, fail = false) {
  return vi.fn(() => ({
    set: vi.fn((s: any) => {
      capture.set = s;
      return {
        where: vi.fn(async (w: any) => {
          capture.where = w;
          if (fail) throw new Error("DB down");
          return undefined;
        }),
      };
    }),
  }));
}

/** select().from().where().limit() chain stub returning rows. */
function selectChain(rows: any[]) {
  return vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => rows),
      })),
    })),
  }));
}

describe("touchLastInbound — 只往新更新的指針寫入", () => {
  let capture: { set?: any; where?: any };
  let db: any;

  beforeEach(() => {
    capture = {};
    db = { update: updateChain(capture) };
  });

  it("writes lastInboundAt=ts through a guarded conditional UPDATE", async () => {
    const ts = d("2026-07-01T12:00:00Z");
    await touchLastInbound(db, 7, ts);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(capture.set).toEqual({ lastInboundAt: ts });
    // The monotonic guard lives in the WHERE (id match AND (NULL OR older)) —
    // assert the condition object exists so a refactor can't silently drop it
    // into an unconditional overwrite.
    expect(capture.where).toBeTruthy();
  });

  it("profileId 0 / negative → no-op (never a WHERE-less write)", async () => {
    await touchLastInbound(db, 0, d("2026-07-01"));
    await touchLastInbound(db, -3, d("2026-07-01"));
    expect(db.update).not.toHaveBeenCalled();
  });

  it("invalid ts → no-op", async () => {
    await touchLastInbound(db, 7, new Date("not a date"));
    expect(db.update).not.toHaveBeenCalled();
  });

  it("DB failure is swallowed — filing pipelines never die for a red dot", async () => {
    const failDb: any = { update: updateChain({}, true) };
    await expect(touchLastInbound(failDb, 7, d("2026-07-01"))).resolves.toBeUndefined();
  });
});

describe("markCustomerSeen — upsert (markNotCustomer mirror)", () => {
  it("guest path: profileId IS the row → direct update, no select/insert", async () => {
    const capture: { set?: any } = {};
    const db: any = {
      update: updateChain(capture),
      select: vi.fn(),
      insert: vi.fn(),
    };
    const now = d("2026-07-01T08:00:00Z");
    await markCustomerSeen(db, { profileId: 12 }, now);
    expect(capture.set).toEqual({ jeffViewedAt: now });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("registered with an existing profile row → update that row", async () => {
    const capture: { set?: any } = {};
    const db: any = {
      select: selectChain([{ id: 44 }]),
      update: updateChain(capture),
      insert: vi.fn(),
    };
    const now = d("2026-07-01T08:00:00Z");
    await markCustomerSeen(db, { userId: 9 }, now);
    expect(capture.set).toEqual({ jeffViewedAt: now });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("registered with NO profile row → insert minimal profile carrying jeffViewedAt", async () => {
    let inserted: any = null;
    const db: any = {
      select: selectChain([]),
      update: vi.fn(),
      insert: vi.fn(() => ({
        values: vi.fn(async (v: any) => {
          inserted = v;
        }),
      })),
    };
    const now = d("2026-07-01T08:00:00Z");
    await markCustomerSeen(db, { userId: 9 }, now);
    expect(db.update).not.toHaveBeenCalled();
    expect(inserted).toEqual({ userId: 9, jeffViewedAt: now });
  });
});
