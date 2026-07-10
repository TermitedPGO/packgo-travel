/**
 * F2 塊A — systemAudit() 本體單測。
 *
 * systemAudit 是「無 ctx.user 的系統行為者稽核」:webhook / LOCAL_SCRIPT_TOKEN
 * 端點 / 排程等背景寫入,audit() 會靜默 no-op(auditLog.ts:171),留不下軌;
 * systemAudit 補這條 —— actor 標系統模組、userId=0、userRole="system",與 audit()
 * 共用底層 writeAuditRow(同一條防篡改雜湊鏈)。
 *
 * 兩條紅綠:
 *   1. 成功寫列:insert 收到的欄位釘死 actor→userEmail、userRole="system"、
 *      userId=0、action、targetId、金額(detail 序列化進 changes)。
 *   2. 底層炸不外拋:getDb / insert 爆掉時 systemAudit resolve、不 throw
 *      (絕不影響它掛著的財務主流程)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// 底層走真 writeAuditRow → 只 mock DB 與 redis(mutex)。
const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));
vi.mock("../redis", () => ({
  redis: {
    set: vi.fn().mockResolvedValue("OK"),
    eval: vi.fn().mockResolvedValue(1),
  },
}));

import {
  systemAudit,
  SYSTEM_ACTOR_USER_ID,
  verifyAuditChain,
  canonicalAuditRow,
  computeRowHash,
} from "./auditLog";

beforeEach(() => {
  vi.clearAllMocks();
});

/** 建一個支援 tip 查詢 + insert + update 的假 db。回傳 insert 收到的 spy。 */
function makeDb(insertId: number) {
  const insertValues = vi.fn().mockResolvedValue([{ insertId }]);
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const db = {
    select: () => ({
      from: () => ({
        orderBy: () => ({ limit: () => Promise.resolve([{ rowHash: "PREVHASH" }]) }),
      }),
    }),
    insert: () => ({ values: insertValues }),
    update: () => ({ set: () => ({ where: updateWhere }) }),
  };
  return { db, insertValues, updateWhere };
}

describe("systemAudit — 成功寫列", () => {
  it("寫入 auditLog 列:actor→userEmail、userRole=system、userId=0、action/target/金額齊全", async () => {
    const { db, insertValues, updateWhere } = makeDb(42);
    getDb.mockResolvedValue(db);

    await systemAudit("system:trustDeferral", "trust.defer", 77, {
      amount: 1234.56,
      paymentId: 5,
    });

    expect(insertValues).toHaveBeenCalledTimes(1);
    const row = insertValues.mock.calls[0][0];
    expect(row.userId).toBe(SYSTEM_ACTOR_USER_ID); // 0
    expect(row.userEmail).toBe("system:trustDeferral");
    expect(row.userRole).toBe("system");
    expect(row.action).toBe("trust.defer");
    expect(row.targetType).toBeNull();
    expect(row.targetId).toBe("77"); // number target coerced to string
    expect(row.success).toBe(1);
    // 金額進 changes(JSON 序列化)
    expect(row.changes).toContain("1234.56");
    expect(row.changes).toContain("amount");
    // 雜湊鏈補寫(previousHash/rowHash)有跑
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });

  it("target=null(批次作業)→ targetId 為 null,仍寫列", async () => {
    const { db, insertValues } = makeDb(43);
    getDb.mockResolvedValue(db);

    await systemAudit("system:bankLinkBackfill", "bank.backfill_links_confirm", null, {
      pendingTotalAmount: 447.73,
    });

    const row = insertValues.mock.calls[0][0];
    expect(row.targetId).toBeNull();
    expect(row.userEmail).toBe("system:bankLinkBackfill");
    expect(row.changes).toContain("447.73");
  });
});

describe("systemAudit — 底層炸不外拋", () => {
  it("getDb reject → resolve、不 throw(主流程不受影響)", async () => {
    getDb.mockRejectedValue(new Error("DB exploded"));
    await expect(
      systemAudit("system:trustDeferral", "trust.reverse", 9, { amount: "500.00" }),
    ).resolves.toBeUndefined();
  });

  it("insert throw → resolve、不 throw", async () => {
    const db = {
      select: () => ({
        from: () => ({
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
      insert: () => ({
        values: () => {
          throw new Error("insert blew up");
        },
      }),
      update: () => ({ set: () => ({ where: vi.fn() }) }),
    };
    getDb.mockResolvedValue(db);
    await expect(
      systemAudit("system:sandboxCleanup", "sandbox.cleanup_confirm", "First Platypus Bank", {
        deletedAccounts: 2,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("verifyAuditChain — 系統列(P3 #2,2026-07-10 指揮回令)", () => {
  it("userId=0 / userRole=system / targetType=null 的系統列 + 後接 admin 列,鏈驗證 ok:true", async () => {
    // 用真 canonicalAuditRow/computeRowHash 造一條「系統列 → admin 列」的合法鏈,
    // 釘死 systemAudit 寫出的欄位形狀(哨兵 userId=0、targetType null)不會被
    // 驗證器誤判為 row-modified / chain-broken。
    const sysData = {
      id: 1,
      userId: SYSTEM_ACTOR_USER_ID,
      userEmail: "system:trustDeferral",
      userRole: "system",
      action: "trust.defer",
      targetType: null,
      targetId: "77",
      changes: '{"amount":1234.56}',
      reason: null,
      ipAddress: null,
      userAgent: null,
      success: 1,
      errorMessage: null,
      createdAt: new Date("2026-07-10T00:00:00Z"),
    };
    const sysHash = computeRowHash("GENESIS", canonicalAuditRow(sysData));
    const sysRow = { ...sysData, previousHash: "GENESIS", rowHash: sysHash };

    const adminData = {
      id: 2,
      userId: 1,
      userEmail: "jeff@packgoplay.com",
      userRole: "admin",
      action: "tour.update",
      targetType: "tour",
      targetId: "5",
      changes: null,
      reason: null,
      ipAddress: "1.2.3.4",
      userAgent: "test",
      success: 1,
      errorMessage: null,
      createdAt: new Date("2026-07-10T00:01:00Z"),
    };
    const adminHash = computeRowHash(sysHash, canonicalAuditRow(adminData));
    const adminRow = { ...adminData, previousHash: sysHash, rowHash: adminHash };

    getDb.mockResolvedValue({
      select: () => ({
        from: () => ({ orderBy: () => Promise.resolve([sysRow, adminRow]) }),
      }),
    });

    const result = await verifyAuditChain();
    expect(result.ok).toBe(true);
    expect(result.hashedRows).toBe(2);
    expect(result.anomalies).toEqual([]);
  });
});
