/**
 * runTrustTransferDetection IO 路徑測試 — F2 塊B(2026-07-10)。
 *
 * 釘死:confirm 回填走冪等 UPDATE + systemAudit(fire-and-forget → 依 T2
 * 地雷 #6 用 vi.waitFor);dry_run 零寫入;「認了沒轉錢」提醒卡的噪音閘
 * (聚合一張 + 同簽名去重);任何內部錯誤降級不外拋。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const systemAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("../_core/auditLog", () => ({ systemAudit: (...a: unknown[]) => systemAudit(...a) }));

const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));

const redisGet = vi.fn();
const redisSet = vi.fn().mockResolvedValue("OK");
vi.mock("../redis", () => ({
  redis: {
    get: (...a: unknown[]) => redisGet(...a),
    set: (...a: unknown[]) => redisSet(...a),
    del: vi.fn().mockResolvedValue(1),
  },
}));

import { runTrustTransferDetection, TRANSFER_REMINDER_SIGNATURE_KEY } from "./trustTransferDetection";

const NOW = new Date("2026-07-10T12:00:00Z");

/** 三次順序 select(遞延列 → trust 帳戶 → 交易)+ update/insert 捕捉。 */
function makeDb(opts: {
  eligible: unknown[];
  trustAccounts?: unknown[];
  txns?: unknown[];
  affectedRows?: number;
}) {
  const selectResults = [opts.eligible, opts.trustAccounts ?? [{ id: 10 }], opts.txns ?? []];
  let i = 0;
  const updates: any[] = [];
  const inserted: any[] = [];
  return {
    db: {
      select: () => ({ from: () => ({ where: () => Promise.resolve(selectResults[i++]) }) }),
      update: () => ({
        set: (v: any) => ({
          where: () => {
            updates.push(v);
            return Promise.resolve([{ affectedRows: opts.affectedRows ?? 1 }]);
          },
        }),
      }),
      insert: () => ({
        values: (v: any) => {
          inserted.push(v);
          return Promise.resolve(undefined);
        },
      }),
    } as any,
    updates,
    inserted,
  };
}

const eligibleRow = (o: Record<string, unknown> = {}) => ({
  id: 501,
  linkedAccountId: 10,
  amount: "1500.00",
  recognizedAt: new Date("2026-06-20T10:00:00Z"),
  reversedAt: null,
  transferredAt: null,
  recognitionRunId: null,
  ...o,
});

const transferTxns = [
  { id: 900, linkedAccountId: 10, amount: "1500.00", date: "2026-07-05" }, // trust 流出
  { id: 901, linkedAccountId: 20, amount: "-1500.00", date: "2026-07-05" }, // operating 流入
];

beforeEach(() => {
  vi.clearAllMocks();
  redisGet.mockResolvedValue(null);
});

describe("runTrustTransferDetection — confirm 回填", () => {
  it("配對成功 → 冪等 UPDATE 回填 + systemAudit(trust.transfer_backfill,金額/流水 id 釘死)", async () => {
    const { db, updates } = makeDb({ eligible: [eligibleRow()], txns: transferTxns });
    getDb.mockResolvedValue(db);

    const report = await runTrustTransferDetection({ now: NOW });
    expect(report.pairsFound).toBe(1);
    expect(report.backfilled).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].transferBankTransactionId).toBe(900);
    expect(updates[0].transferredAt).toEqual(new Date("2026-07-05T00:00:00Z"));

    await vi.waitFor(() => {
      expect(systemAudit).toHaveBeenCalledWith(
        "system:trustTransfer",
        "trust.transfer_backfill",
        501,
        expect.objectContaining({
          amount: "1500.00",
          transferBankTransactionId: 900,
          transferDate: "2026-07-05",
          rule: "single",
        }),
      );
    });
    // 剛回填的列不算 overdue → 不出提醒卡
    expect(report.overdueCount).toBe(0);
    expect(report.reminderPosted).toBe(false);
  });

  it("dry_run:找得到配對但零寫入(不 UPDATE、不 systemAudit、不出卡、不動 Redis)", async () => {
    const { db, updates, inserted } = makeDb({ eligible: [eligibleRow()], txns: transferTxns });
    getDb.mockResolvedValue(db);

    const report = await runTrustTransferDetection({ dryRun: true, now: NOW });
    expect(report.pairsFound).toBe(1);
    expect(report.backfills).toHaveLength(1);
    expect(report.backfilled).toBe(0);
    expect(updates).toHaveLength(0);
    expect(inserted).toHaveLength(0);
    expect(systemAudit).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
    // dry_run 的 overdue 口徑與 confirm 一致:「confirm 之後還剩哪些沒著落」——
    // 這列會被回填,故不算 overdue。
    expect(report.overdueCount).toBe(0);
  });

  it("冪等守門:UPDATE affectedRows=0(已被別人回填)→ 不計數、不發稽核", async () => {
    const { db } = makeDb({ eligible: [eligibleRow()], txns: transferTxns, affectedRows: 0 });
    getDb.mockResolvedValue(db);
    const report = await runTrustTransferDetection({ now: NOW });
    expect(report.backfilled).toBe(0);
    expect(systemAudit).not.toHaveBeenCalled();
  });
});

describe("runTrustTransferDetection — 認了沒轉錢提醒(噪音閘)", () => {
  it("認列超過 7 天、無配對 → 聚合一張 high 卡,寫簽名;金額/筆數在標題", async () => {
    const { db, inserted } = makeDb({
      eligible: [
        eligibleRow(),
        eligibleRow({ id: 502, amount: "800.00", recognizedAt: new Date("2026-06-25T10:00:00Z") }),
      ],
      txns: [], // 找不到轉帳
    });
    getDb.mockResolvedValue(db);

    const report = await runTrustTransferDetection({ now: NOW });
    expect(report.overdueCount).toBe(2);
    expect(report.overdueTotal).toBeCloseTo(2300, 2);
    expect(report.reminderPosted).toBe(true);
    expect(inserted).toHaveLength(1); // 聚合一張,絕不逐筆
    expect(inserted[0].agentName).toBe("trust-transfer");
    expect(inserted[0].priority).toBe("high");
    expect(inserted[0].title).toContain("2 筆");
    expect(inserted[0].title).toContain("$2300.00");
    expect(redisSet).toHaveBeenCalledWith(TRANSFER_REMINDER_SIGNATURE_KEY, "501,502|230000");
  });

  it("同一批未轉列(簽名相同)→ 去重不再出卡", async () => {
    redisGet.mockResolvedValue("501,502|230000");
    const { db, inserted } = makeDb({
      eligible: [
        eligibleRow(),
        eligibleRow({ id: 502, amount: "800.00", recognizedAt: new Date("2026-06-25T10:00:00Z") }),
      ],
      txns: [],
    });
    getDb.mockResolvedValue(db);

    const report = await runTrustTransferDetection({ now: NOW });
    expect(report.overdueCount).toBe(2);
    expect(report.reminderPosted).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("認列未滿 7 天 → 不算 overdue、不出卡", async () => {
    const { db, inserted } = makeDb({
      eligible: [eligibleRow({ recognizedAt: new Date("2026-07-08T10:00:00Z") })],
      txns: [],
    });
    getDb.mockResolvedValue(db);
    const report = await runTrustTransferDetection({ now: NOW });
    expect(report.overdueCount).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});

describe("runTrustTransferDetection — 降級不外拋", () => {
  it("getDb 炸 → 空報表 resolve,不 throw(掛每日 worker,絕不影響認列主流程)", async () => {
    getDb.mockRejectedValue(new Error("DB down"));
    await expect(runTrustTransferDetection({ now: NOW })).resolves.toMatchObject({
      eligibleRows: 0,
      backfilled: 0,
      reminderPosted: false,
    });
  });

  it("零 eligible 列 → 便宜早退,不掃交易", async () => {
    const { db } = makeDb({ eligible: [] });
    getDb.mockResolvedValue(db);
    const report = await runTrustTransferDetection({ now: NOW });
    expect(report).toMatchObject({ eligibleRows: 0, scannedTxns: 0, pairsFound: 0 });
  });
});
