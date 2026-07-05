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
  computeLastContactAt,
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

describe("computeLastContactAt — 列表日期口徑 (Phase6 A2)", () => {
  it("both null, no fallback → null", () => {
    expect(computeLastContactAt(null, null)).toBeNull();
    expect(computeLastContactAt(undefined, undefined)).toBeNull();
  });

  it("both null, fallback given (e.g. registeredAt) → fallback", () => {
    const fallback = d("2026-05-13");
    expect(computeLastContactAt(null, null, fallback)).toBe(fallback);
  });

  it("only inbound set → inbound", () => {
    const inbound = d("2026-07-03T10:00:00Z");
    expect(computeLastContactAt(inbound, null)).toBe(inbound);
  });

  it("only outbound set → outbound", () => {
    const outbound = d("2026-07-03T10:00:00Z");
    expect(computeLastContactAt(null, outbound)).toBe(outbound);
  });

  it("inbound newer than outbound → inbound wins", () => {
    const inbound = d("2026-07-03T10:00:00Z");
    const outbound = d("2026-07-01T09:00:00Z");
    expect(computeLastContactAt(inbound, outbound)).toBe(inbound);
  });

  it("outbound newer than inbound (Jeff just replied) → outbound wins", () => {
    // This is the core bug this fixes: 0909 replied-to-by-Jeff-today case —
    // registration/lastSignedIn is 2 months stale but the outbound reply is now.
    const inbound = d("2026-05-13T00:00:00Z");
    const outbound = d("2026-07-03T12:00:00Z");
    expect(computeLastContactAt(inbound, outbound)).toBe(outbound);
  });

  it("exact tie → either (same instant), picks first candidate deterministically", () => {
    const tie = d("2026-07-03T10:00:00Z");
    const result = computeLastContactAt(tie, new Date(tie.getTime()));
    expect(result?.getTime()).toBe(tie.getTime());
  });

  it("fallback ignored when either pointer is present", () => {
    const inbound = d("2026-06-01");
    const fallback = d("2026-05-13");
    expect(computeLastContactAt(inbound, null, fallback)).toBe(inbound);
  });

  // ---- v787 P0 回爐:型別韌性(raw sql<Date> outbound 被 driver 當字串丟回) ----
  // customerList 的 lastOutboundAt 是 raw correlated subquery,drizzle 不解碼,
  // mysql2/TiDB 把 DATETIME 當「字串」回傳。舊版 `.getTime()` 直接 throw,rows.map()
  // 整批爆掉 → 註冊會員列表全空。這幾條鎖死「壞掉/字串日期永遠不准弄空列表」。
  describe("型別韌性 — 字串/雜型 candidate 不准 throw、不准弄空列表 (P0)", () => {
    it("outbound 是 mysql2 naive DATETIME 字串 → 當 UTC coerce(同 drizzle 基準),不 throw", () => {
      const inbound = d("2026-05-13T00:00:00Z");
      // 這正是 prod 打死 customerList 的形狀:字串,沒有 .getTime()。
      const outboundStr = "2026-07-03 12:00:00";
      expect(() => computeLastContactAt(inbound, outboundStr as unknown as Date)).not.toThrow();
      const result = computeLastContactAt(inbound, outboundStr as unknown as Date);
      expect(result).toBeInstanceOf(Date);
      // outbound(7/3)比 inbound(5/13)新 → outbound 勝出。naive 字串視為 UTC,
      // 與 drizzle 解碼 timestamp(new Date(v+"+0000"))同基準,不吃跑測機的時區。
      expect(result?.getTime()).toBe(new Date("2026-07-03T12:00:00Z").getTime());
    });

    it("outbound 字串比 inbound 舊 → inbound(真 Date)勝出且原樣回傳", () => {
      const inbound = d("2026-07-03T10:00:00Z");
      const result = computeLastContactAt(inbound, "2026-07-01 09:00:00" as unknown as Date);
      expect(result).toBe(inbound); // 參考相等:已是 Date 的不重建
    });

    it("outbound 是無法 parse 的垃圾字串 → 丟掉,不 throw,退回 inbound", () => {
      const inbound = d("2026-07-03T10:00:00Z");
      expect(() =>
        computeLastContactAt(inbound, "not-a-date" as unknown as Date),
      ).not.toThrow();
      expect(computeLastContactAt(inbound, "not-a-date" as unknown as Date)).toBe(inbound);
    });

    it("兩根指針都是垃圾字串 → 落 fallback,不 throw", () => {
      const fallback = d("2026-05-13T00:00:00Z");
      const result = computeLastContactAt(
        "" as unknown as Date,
        "garbage" as unknown as Date,
        fallback,
      );
      expect(result).toBe(fallback);
    });

    it("fallback 也是字串 → coerce 成 Date(呼叫端從 raw sql 餵 createdAt 字串也安全)", () => {
      const result = computeLastContactAt(null, null, "2026-05-13 08:00:00" as unknown as Date);
      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBe(new Date("2026-05-13T08:00:00Z").getTime());
    });
  });

  // ---- v787 P1 回爐:fallback 一律 createdAt,updatedAt 永不出現在「最後往來」----
  // 這是純函式層的契約鎖:呼叫端該餵 createdAt 當 fallback。有 inbound 的客人
  // (Emerald 案:inbound=7/3)絕不該掉回一個更晚的 fallback(cron 蓋章的 7/5)。
  describe("fallback 語意 — 有 inbound 就不准被更晚的 fallback 蓋掉 (P1)", () => {
    it("Emerald 形狀:inbound=7/3、outbound 空、fallback=createdAt → 回 7/3 inbound,不是 fallback", () => {
      const inbound = d("2026-07-03T14:30:00Z");
      const createdAt = d("2026-06-01T00:00:00Z");
      const result = computeLastContactAt(inbound, null, createdAt);
      expect(result).toBe(inbound);
    });

    it("即使 fallback 比 inbound 晚(模擬拿 updatedAt 當 fallback 的舊 bug),inbound 仍勝出 → 證明 fallback 只在兩指針全空時才用", () => {
      const inbound = d("2026-07-03T14:30:00Z");
      const cronStamped = d("2026-07-05T02:00:27Z"); // 若誤把 updatedAt 當 fallback
      // fallback 只在 candidates 皆空時採用;有 inbound → 一定回 inbound,永不回 fallback。
      expect(computeLastContactAt(inbound, null, cronStamped)).toBe(inbound);
    });
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
          return [{ insertId: 1 }];
        }),
      })),
    };
    const now = d("2026-07-01T08:00:00Z");
    await markCustomerSeen(db, { userId: 9 }, now);
    expect(db.update).not.toHaveBeenCalled();
    expect(inserted).toEqual({ userId: 9, jeffViewedAt: now });
  });

  it("2026-07-03 任務7 對抗審查 P0 — a concurrent call wins the uq_cp_user insert race: re-applies jeffViewedAt to the recovered profile instead of dropping it", async () => {
    const capture: { set?: any } = {};
    let selectCall = 0;
    const dupErr = Object.assign(new Error("Duplicate entry"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
    });
    const db: any = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => {
            const limit = async () => {
              selectCall += 1;
              // 1st call: markCustomerSeen's own "existing?" lookup → none.
              // 2nd call: insertCustomerProfileSafely's race-recovery re-select.
              // 3rd call: followMergePointer's own pointer lookup.
              return selectCall === 1 ? [] : [{ id: 909 }];
            };
            return { limit, orderBy: () => ({ limit }) };
          },
        }),
      })),
      update: updateChain(capture),
      insert: vi.fn(() => ({
        values: vi.fn().mockRejectedValue(dupErr),
      })),
    };
    const now = d("2026-07-01T08:00:00Z");
    await markCustomerSeen(db, { userId: 9 }, now);
    expect(capture.set).toEqual({ jeffViewedAt: now });
  });
});
