/**
 * trustTransferDetection 純函式測試 — F2 塊B(2026-07-10;塊C 回令後更新)。
 *
 * 覆蓋:
 *   - 金額符號地雷(T2):Plaid 正=流出、負=流入,配對兩邊各認各的符號。
 *   - Operating 白名單(塊C 回令 #2):流入候選限定白名單帳戶,非白名單的
 *     非 trust 帳戶不再是候選。
 *   - 保守配對:同額多候選(歧義)一律跳過;每筆流入只用一次。
 *   - §17550 第三條紅綠:認列後才可轉出 —— 未認列列金額對上也絕不回填;
 *     轉帳曆日早於認列曆日不回填(前兩條在 trustDeferralService.test.ts
 *     的 isRecognitionDue)。
 *   - run_group 降級(塊C 回令 #1):同批認列加總配對只出「建議」,絕不
 *     自動回填 —— 純金額訊號無第二佐證,巧合等額會錯誤閉環且靜音。
 */
import { describe, it, expect } from "vitest";
import {
  pairTransfers,
  matchPairsToDeferrals,
  isTransferBackfillEligible,
  toCents,
  type TransferTxnLike,
  type TransferPair,
  type DeferralRowLike,
} from "./trustTransferDetection";

const TRUST = new Set([10]); // linkedAccountId 10 = trust
const OPERATING = new Set([20]); // 20 = Operating 白名單(#2174)

function txn(o: Partial<TransferTxnLike> & { id: number }): TransferTxnLike {
  return { linkedAccountId: 10, amount: 0, date: "2026-07-01", ...o };
}

function pair(o: Partial<TransferPair> = {}): TransferPair {
  return {
    trustOutflowId: 900,
    operatingInflowId: 901,
    trustAccountId: 10,
    amountCents: 150000, // $1,500
    date: "2026-07-05",
    ...o,
  };
}

function row(o: Partial<DeferralRowLike> & { id: number }): DeferralRowLike {
  return {
    linkedAccountId: 10,
    amount: "1500.00",
    recognizedAt: new Date("2026-07-01T10:00:00Z"),
    reversedAt: null,
    transferredAt: null,
    recognitionRunId: null,
    ...o,
  };
}

describe("pairTransfers — Trust 流出 + Operating 流入 同額近日配對", () => {
  it("符號地雷釘死:trust 正額(流出)配 operating 負額(流入),同額同窗 → 一對", () => {
    const pairs = pairTransfers(
      [
        txn({ id: 1, linkedAccountId: 10, amount: 1500, date: "2026-07-05" }), // trust 流出
        txn({ id: 2, linkedAccountId: 20, amount: -1500, date: "2026-07-05" }), // operating 流入
      ],
      TRUST,
      OPERATING,
      { dateWindowDays: 3 },
    );
    expect(pairs).toEqual([
      {
        trustOutflowId: 1,
        operatingInflowId: 2,
        trustAccountId: 10,
        amountCents: 150000,
        date: "2026-07-05",
      },
    ]);
  });

  it("符號反了(trust 負額=入帳、operating 正額=支出)→ 不配對", () => {
    const pairs = pairTransfers(
      [
        txn({ id: 1, linkedAccountId: 10, amount: -1500 }), // trust 收錢,不是流出
        txn({ id: 2, linkedAccountId: 20, amount: 1500 }), // operating 花錢,不是流入
      ],
      TRUST,
      OPERATING,
    );
    expect(pairs).toEqual([]);
  });

  it("Operating 白名單(塊C 回令 #2):同額流入落在非白名單帳戶(信用卡之類)→ 不是候選", () => {
    const pairs = pairTransfers(
      [
        txn({ id: 1, amount: 1500, date: "2026-07-05" }),
        txn({ id: 2, linkedAccountId: 40, amount: -1500, date: "2026-07-05" }), // 非白名單非 trust
      ],
      TRUST,
      OPERATING,
      { dateWindowDays: 3 },
    );
    expect(pairs).toEqual([]);
  });

  it("超出日窗不配;窗界剛好(=windowDays)配得上", () => {
    const mk = (inflowDate: string) =>
      pairTransfers(
        [
          txn({ id: 1, amount: 800, date: "2026-07-01" }),
          txn({ id: 2, linkedAccountId: 20, amount: -800, date: inflowDate }),
        ],
        TRUST,
        OPERATING,
        { dateWindowDays: 3 },
      );
    expect(mk("2026-07-04")).toHaveLength(1); // 差 3 天 = 窗界,配
    expect(mk("2026-07-05")).toHaveLength(0); // 差 4 天,不配
  });

  it("金額差一分錢不配(到分毫全等)", () => {
    const pairs = pairTransfers(
      [
        txn({ id: 1, amount: 1500.0 }),
        txn({ id: 2, linkedAccountId: 20, amount: -1500.01 }),
      ],
      TRUST,
      OPERATING,
    );
    expect(pairs).toEqual([]);
  });

  it("歧義(一筆流出對到兩筆同額流入)→ 保守跳過,不猜", () => {
    const pairs = pairTransfers(
      [
        txn({ id: 1, amount: 1500 }),
        txn({ id: 2, linkedAccountId: 20, amount: -1500 }),
        txn({ id: 3, linkedAccountId: 20, amount: -1500 }),
      ],
      TRUST,
      OPERATING,
    );
    expect(pairs).toEqual([]);
  });

  it("兩筆流出、一筆流入 → 先到先得配一對,第二筆流出無候選跳過", () => {
    const pairs = pairTransfers(
      [
        txn({ id: 1, amount: 700, date: "2026-07-01" }),
        txn({ id: 4, amount: 700, date: "2026-07-02" }),
        txn({ id: 2, linkedAccountId: 20, amount: -700, date: "2026-07-01" }),
      ],
      TRUST,
      OPERATING,
      { dateWindowDays: 3 },
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].trustOutflowId).toBe(1); // 日期序先到先得,確定性
  });
});

describe("isTransferBackfillEligible — §17550 認列後才可轉出(紅綠)", () => {
  it("綠:已認列、未撤銷、未轉出 → 有資格", () => {
    expect(
      isTransferBackfillEligible({
        recognizedAt: new Date("2026-07-01"),
        reversedAt: null,
        transferredAt: null,
      }),
    ).toBe(true);
  });

  it("紅:未認列 → 沒資格(就算金額對上也不准標 transferred)", () => {
    expect(
      isTransferBackfillEligible({ recognizedAt: null, reversedAt: null, transferredAt: null }),
    ).toBe(false);
  });

  it("紅:已撤銷 → 沒資格", () => {
    expect(
      isTransferBackfillEligible({
        recognizedAt: new Date("2026-07-01"),
        reversedAt: new Date("2026-07-02"),
        transferredAt: null,
      }),
    ).toBe(false);
  });

  it("紅:已轉出 → 沒資格(冪等,不覆寫)", () => {
    expect(
      isTransferBackfillEligible({
        recognizedAt: new Date("2026-07-01"),
        reversedAt: null,
        transferredAt: new Date("2026-07-03"),
      }),
    ).toBe(false);
  });
});

describe("matchPairsToDeferrals — 配對 → 遞延列回填/建議", () => {
  it("single 規則:恰好一列已認列同額 → 自動回填,金額/流水 id/曆日釘死", () => {
    const { backfills, suggestions } = matchPairsToDeferrals([pair()], [row({ id: 501 })]);
    expect(backfills).toEqual([
      {
        deferredId: 501,
        transferBankTransactionId: 900,
        transferDate: "2026-07-05",
        amountCents: 150000,
        rule: "single",
      },
    ]);
    expect(suggestions).toEqual([]);
  });

  it("紅(§17550 #3):未認列列金額全等也絕不回填", () => {
    const { backfills, suggestions } = matchPairsToDeferrals(
      [pair()],
      [row({ id: 501, recognizedAt: null })],
    );
    expect(backfills).toEqual([]);
    expect(suggestions).toEqual([]);
  });

  it("紅:轉帳曆日早於認列曆日 → 不回填(錢不可能先轉再認)", () => {
    const { backfills } = matchPairsToDeferrals(
      [pair({ date: "2026-06-30" })], // 轉帳在認列(07-01)之前
      [row({ id: 501 })],
    );
    expect(backfills).toEqual([]);
  });

  it("歧義:兩列同額都 eligible → 跳過留給人", () => {
    const { backfills, suggestions } = matchPairsToDeferrals(
      [pair()],
      [row({ id: 501 }), row({ id: 502 })],
    );
    expect(backfills).toEqual([]);
    expect(suggestions).toEqual([]);
  });

  it("帳戶不符(遞延列掛別的 trust 帳)→ 不回填;哨兵列 linkedAccountId=0 天然不中", () => {
    expect(
      matchPairsToDeferrals([pair()], [row({ id: 501, linkedAccountId: 99 })]).backfills,
    ).toEqual([]);
    expect(
      matchPairsToDeferrals([pair()], [row({ id: 502, linkedAccountId: 0 })]).backfills,
    ).toEqual([]);
  });

  it("run_group 降級(塊C 回令 #1):同 runId 兩列加總全等 → 只出建議,絕不自動回填", () => {
    const { backfills, suggestions } = matchPairsToDeferrals(
      [pair({ amountCents: 250000 })], // $2,500 = $1,500 + $1,000
      [
        row({ id: 601, amount: "1500.00", recognitionRunId: "cron-42" }),
        row({ id: 602, amount: "1000.00", recognitionRunId: "cron-42" }),
      ],
    );
    expect(backfills).toEqual([]); // 錢寧漏不錯:不寫
    expect(suggestions).toEqual([
      {
        recognitionRunId: "cron-42",
        deferredIds: [601, 602],
        rowAmountsCents: [150000, 100000],
        totalCents: 250000,
        trustOutflowId: 900,
        operatingInflowId: 901,
        transferDate: "2026-07-05",
      },
    ]);
  });

  it("run_group 歧義:兩組不同 runId 加總都全等 → 連建議都不出", () => {
    const { backfills, suggestions } = matchPairsToDeferrals(
      [pair({ amountCents: 250000 })],
      [
        row({ id: 601, amount: "1500.00", recognitionRunId: "cron-42" }),
        row({ id: 602, amount: "1000.00", recognitionRunId: "cron-42" }),
        row({ id: 603, amount: "2000.00", recognitionRunId: "cron-43" }),
        row({ id: 604, amount: "500.00", recognitionRunId: "cron-43" }),
      ],
    );
    expect(backfills).toEqual([]);
    expect(suggestions).toEqual([]);
  });

  it("每列最多出現一次:兩對同額配對搶同一列 → 第二對落空", () => {
    const { backfills } = matchPairsToDeferrals(
      [pair(), pair({ trustOutflowId: 910, operatingInflowId: 911, date: "2026-07-06" })],
      [row({ id: 501 })],
    );
    expect(backfills).toHaveLength(1);
    expect(backfills[0].transferBankTransactionId).toBe(900);
  });

  it("建議中的列被鎖住,不再被後續 pair 自動回填(回填與建議互斥)", () => {
    const { backfills, suggestions } = matchPairsToDeferrals(
      [
        pair({ amountCents: 250000 }),
        pair({ trustOutflowId: 910, operatingInflowId: 911, amountCents: 150000, date: "2026-07-06" }),
      ],
      [
        row({ id: 601, amount: "1500.00", recognitionRunId: "cron-42" }),
        row({ id: 602, amount: "1000.00", recognitionRunId: "cron-42" }),
      ],
    );
    expect(suggestions).toHaveLength(1); // 第一對出建議鎖住兩列
    expect(backfills).toEqual([]); // 第二對($1,500)不能再吃 #601
  });
});

describe("toCents — 金額字串/數字 → 分", () => {
  it("字串小數、數字、垃圾值", () => {
    expect(toCents("1500.00")).toBe(150000);
    expect(toCents(0.1 + 0.2)).toBe(30); // 浮點雷:四捨五入到分
    expect(toCents("not-a-number")).toBe(0);
  });
});
