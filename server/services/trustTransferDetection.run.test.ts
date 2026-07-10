/**
 * runTrustTransferDetection / runManualTransferBackfill IO 路徑測試 —
 * F2 塊B(2026-07-10;塊C 回令後更新)。
 *
 * 釘死:confirm 自動回填(僅規則 1)走冪等 UPDATE + systemAudit(fire-and-forget
 * → 依 T2 地雷 #6 用 vi.waitFor);dry_run 零寫入;run_group 建議上提醒卡且
 * 絕不自動寫;manual_backfill 全驗證 fail-closed + trust.transfer_backfill.manual
 * 稽核;「認了沒轉錢」提醒卡的噪音閘(聚合一張 + 同簽名去重);錯誤降級不外拋。
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

import {
  runTrustTransferDetection,
  runManualTransferBackfill,
  TRANSFER_REMINDER_SIGNATURE_KEY,
} from "./trustTransferDetection";

const NOW = new Date("2026-07-10T12:00:00Z");

/** 萬用 select 鏈:每次 db.select() 消耗一個結果;鏈上任何 where/limit/orderBy
 *  都回同一 thenable(涵蓋「無 where 的 accounts 查詢」與「limit(1) 的
 *  manual_backfill 查詢」兩種形狀)。 */
function chain(result: unknown) {
  const p = Promise.resolve(result);
  const o: any = { then: p.then.bind(p), catch: p.catch.bind(p) };
  o.where = () => o;
  o.limit = () => o;
  o.orderBy = () => o;
  return o;
}

function makeDb(selectResults: unknown[], opts?: { affectedRows?: number }) {
  let i = 0;
  const updates: any[] = [];
  const inserted: any[] = [];
  return {
    db: {
      select: () => ({ from: () => chain(selectResults[i++]) }),
      update: () => ({
        set: (v: any) => ({
          where: () => {
            updates.push(v);
            return Promise.resolve([{ affectedRows: opts?.affectedRows ?? 1 }]);
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

const ACCOUNTS = [
  { id: 10, accountMask: "5442", isTrustAccount: 1 }, // trust
  { id: 20, accountMask: "2174", isTrustAccount: 0 }, // Operating 白名單
  { id: 40, accountMask: "4899", isTrustAccount: 0 }, // 信用卡:非白名單
];

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

describe("runTrustTransferDetection — confirm 自動回填(僅規則 1)", () => {
  it("配對成功 → 冪等 UPDATE 回填 + systemAudit(trust.transfer_backfill,金額/流水 id 釘死)", async () => {
    const { db, updates } = makeDb([[eligibleRow()], ACCOUNTS, transferTxns]);
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

  it("Operating 白名單生效:流入落在非白名單帳戶 → 不配對、不回填", async () => {
    const txnsOffWhitelist = [
      { id: 900, linkedAccountId: 10, amount: "1500.00", date: "2026-07-05" },
      { id: 902, linkedAccountId: 40, amount: "-1500.00", date: "2026-07-05" }, // 4899 非白名單
    ];
    const { db, updates } = makeDb([[eligibleRow()], ACCOUNTS, txnsOffWhitelist]);
    getDb.mockResolvedValue(db);
    const report = await runTrustTransferDetection({ now: NOW });
    expect(report.pairsFound).toBe(0);
    expect(report.backfilled).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("dry_run:找得到配對但零寫入(不 UPDATE、不 systemAudit、不出卡、不動 Redis)", async () => {
    const { db, updates, inserted } = makeDb([[eligibleRow()], ACCOUNTS, transferTxns]);
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
    const { db } = makeDb([[eligibleRow()], ACCOUNTS, transferTxns], { affectedRows: 0 });
    getDb.mockResolvedValue(db);
    const report = await runTrustTransferDetection({ now: NOW });
    expect(report.backfilled).toBe(0);
    expect(systemAudit).not.toHaveBeenCalled();
  });
});

describe("runTrustTransferDetection — run_group 建議(塊C 回令 #1:不自動寫)", () => {
  const groupRows = [
    eligibleRow({ id: 601, amount: "1500.00", recognitionRunId: "cron-42" }),
    eligibleRow({ id: 602, amount: "1000.00", recognitionRunId: "cron-42" }),
  ];
  const groupTxns = [
    { id: 900, linkedAccountId: 10, amount: "2500.00", date: "2026-07-05" },
    { id: 901, linkedAccountId: 20, amount: "-2500.00", date: "2026-07-05" },
  ];

  it("加總配對 → 零回填、建議進報表、提醒卡帶出配對建議與 manual_backfill 指引", async () => {
    const { db, updates, inserted } = makeDb([groupRows, ACCOUNTS, groupTxns]);
    getDb.mockResolvedValue(db);

    const report = await runTrustTransferDetection({ now: NOW });
    expect(report.backfilled).toBe(0); // 絕不自動寫
    expect(updates).toHaveLength(0);
    expect(report.suggestions).toHaveLength(1);
    expect(report.suggestions[0]).toMatchObject({
      recognitionRunId: "cron-42",
      deferredIds: [601, 602],
      trustOutflowId: 900,
      totalCents: 250000,
    });
    // 兩列仍 overdue(認列 06-20 > 7 天)→ 卡照出,建議帶在卡上
    expect(report.overdueCount).toBe(2);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].body).toContain("配對建議");
    expect(inserted[0].body).toContain("#900");
    expect(inserted[0].body).toContain("manual_backfill");
    expect(systemAudit).not.toHaveBeenCalled();
  });

  it("建議變化會重出卡:簽名含建議(runId/流水/列集合)", async () => {
    const { db, inserted } = makeDb([groupRows, ACCOUNTS, groupTxns]);
    getDb.mockResolvedValue(db);
    // 上次簽名只有 overdue 集合、沒有建議 → 這次(多了建議)簽名不同 → 重出卡
    redisGet.mockResolvedValue("601,602|250000|");
    const report = await runTrustTransferDetection({ now: NOW });
    expect(report.reminderPosted).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(redisSet).toHaveBeenCalledWith(
      TRANSFER_REMINDER_SIGNATURE_KEY,
      "601,602|250000|cron-42:900:601+602",
    );
  });
});

describe("runTrustTransferDetection — 認了沒轉錢提醒(噪音閘)", () => {
  it("認列超過 7 天、無配對 → 聚合一張 high 卡,寫簽名;金額/筆數在標題", async () => {
    const rows = [
      eligibleRow(),
      eligibleRow({ id: 502, amount: "800.00", recognizedAt: new Date("2026-06-25T10:00:00Z") }),
    ];
    const { db, inserted } = makeDb([rows, ACCOUNTS, []]);
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
    expect(redisSet).toHaveBeenCalledWith(TRANSFER_REMINDER_SIGNATURE_KEY, "501,502|230000|");
  });

  it("同一批未轉列(簽名相同)→ 去重不再出卡", async () => {
    redisGet.mockResolvedValue("501,502|230000|");
    const rows = [
      eligibleRow(),
      eligibleRow({ id: 502, amount: "800.00", recognizedAt: new Date("2026-06-25T10:00:00Z") }),
    ];
    const { db, inserted } = makeDb([rows, ACCOUNTS, []]);
    getDb.mockResolvedValue(db);

    const report = await runTrustTransferDetection({ now: NOW });
    expect(report.overdueCount).toBe(2);
    expect(report.reminderPosted).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("認列未滿 7 天 → 不算 overdue、不出卡", async () => {
    const { db, inserted } = makeDb([
      [eligibleRow({ recognizedAt: new Date("2026-07-08T10:00:00Z") })],
      ACCOUNTS,
      [],
    ]);
    getDb.mockResolvedValue(db);
    const report = await runTrustTransferDetection({ now: NOW });
    expect(report.overdueCount).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});

describe("runManualTransferBackfill — Jeff 確認後的落地路(fail-closed)", () => {
  const TXN = { id: 900, linkedAccountId: 10, amount: "2500.00", date: "2026-07-05" };
  const TRUST_ACCT = { isTrustAccount: 1 };
  const ROWS = [
    eligibleRow({ id: 601, amount: "1500.00", recognitionRunId: "cron-42" }),
    eligibleRow({ id: 602, amount: "1000.00", recognitionRunId: "cron-42" }),
  ];

  it("全驗證通過 → 逐列回填 + systemAudit(trust.transfer_backfill.manual)", async () => {
    const { db, updates } = makeDb([[TXN], [TRUST_ACCT], ROWS]);
    getDb.mockResolvedValue(db);

    const res = await runManualTransferBackfill({ deferredIds: [601, 602], bankTransactionId: 900 });
    expect(res).toEqual({ ok: true, backfilled: 2 });
    expect(updates).toHaveLength(2);
    expect(updates[0].transferBankTransactionId).toBe(900);

    await vi.waitFor(() => {
      expect(systemAudit).toHaveBeenCalledWith(
        "system:trustTransfer",
        "trust.transfer_backfill.manual",
        601,
        expect.objectContaining({ amount: "1500.00", rule: "manual", transferDate: "2026-07-05" }),
      );
      expect(systemAudit).toHaveBeenCalledWith(
        "system:trustTransfer",
        "trust.transfer_backfill.manual",
        602,
        expect.objectContaining({ amount: "1000.00" }),
      );
    });
  });

  it("金額加總不等於流水金額 → 整批拒絕零寫入", async () => {
    const { db, updates } = makeDb([
      [{ ...TXN, amount: "2400.00" }], // 差 $100
      [TRUST_ACCT],
      ROWS,
    ]);
    getDb.mockResolvedValue(db);
    const res = await runManualTransferBackfill({ deferredIds: [601, 602], bankTransactionId: 900 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("!=");
    expect(updates).toHaveLength(0);
    expect(systemAudit).not.toHaveBeenCalled();
  });

  it("任一列不 eligible(未認列)→ 整批拒絕(§17550:認列後才可轉出)", async () => {
    const { db, updates } = makeDb([
      [TXN],
      [TRUST_ACCT],
      [ROWS[0], eligibleRow({ id: 602, amount: "1000.00", recognizedAt: null })],
    ]);
    getDb.mockResolvedValue(db);
    const res = await runManualTransferBackfill({ deferredIds: [601, 602], bankTransactionId: 900 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not eligible");
    expect(updates).toHaveLength(0);
  });

  it("流水不是 trust 帳戶流出 → 拒絕(非 trust 帳 / 流入方向都擋)", async () => {
    const { db } = makeDb([[TXN], [{ isTrustAccount: 0 }], ROWS]);
    getDb.mockResolvedValue(db);
    const res = await runManualTransferBackfill({ deferredIds: [601, 602], bankTransactionId: 900 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not on a trust account");

    const { db: db2 } = makeDb([[{ ...TXN, amount: "-2500.00" }], [TRUST_ACCT], ROWS]);
    getDb.mockResolvedValue(db2);
    const res2 = await runManualTransferBackfill({ deferredIds: [601, 602], bankTransactionId: 900 });
    expect(res2.ok).toBe(false);
    expect(res2.error).toContain("not a trust outflow");
  });

  it("流水不存在 / 列缺漏 → 拒絕", async () => {
    const { db } = makeDb([[], [], []]);
    getDb.mockResolvedValue(db);
    const res = await runManualTransferBackfill({ deferredIds: [601], bankTransactionId: 999 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not found");

    const { db: db2 } = makeDb([[TXN], [TRUST_ACCT], [ROWS[0]]]); // 只找到一列
    getDb.mockResolvedValue(db2);
    const res2 = await runManualTransferBackfill({ deferredIds: [601, 602], bankTransactionId: 900 });
    expect(res2.ok).toBe(false);
    expect(res2.error).toContain("some deferredIds not found");
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
    const { db } = makeDb([[]]);
    getDb.mockResolvedValue(db);
    const report = await runTrustTransferDetection({ now: NOW });
    expect(report).toMatchObject({ eligibleRows: 0, scannedTxns: 0, pairsFound: 0 });
  });
});
