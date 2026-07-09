/**
 * stripePayoutDeclassifyBackfill 測試(F1 對帳引擎 塊C 雙計防護存量回填,
 * 2026-07-08)。
 *
 * 兩層:
 * 1. buildStripePayoutDeclassifyReport 純函式(空輸入、金額加總、200 筆
 *    截斷邊界、autoEligible/humanOverridden 分桶)。
 * 2. runStripePayoutProbeDryRun/runStripePayoutProbeConfirm 透過 mock
 *    "../db"(比照 server/_core/stripeWebhook.refunds.test.ts 的既有慣例,
 *    2026-07-08 對抗審查 P1 指出「本地無 DATABASE_URL 測不到」站不住腳,
 *    repo 已有現成 mock 慣例可用)。
 *
 *    **誠實揭露範圍**:mock 的 db.select().from().where().orderBy().limit()
 *    鏈不會真的解析 drizzle SQL 條件樹——fixture 直接提供「假設 SQL WHERE
 *    已經正確篩過」的列(amount<0、excludeFromAccounting=0、effective
 *    category=income_booking 三個條件由測試作者手動確保成立)。這層測試
 *    驗證的是 scanMisclassified 收到 DB 列之後的 JS 邏輯(paymentMeta
 *    payee/payer 併入 haystack、isStripePayoutInflow 篩選、
 *    isHumanOverridden 分桶、confirm 只改 autoEligible 桶),不是 SQL
 *    WHERE 條件本身的文字正確性——那部分仍是人工 review 保證(CASE WHEN
 *    優先權 + exclude 篩選邏輯簡單,語意已在 code review 核實)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildStripePayoutDeclassifyReport,
  type MisclassifiedStripePayoutRow,
} from "./stripePayoutDeclassifyBackfill";

describe("buildStripePayoutDeclassifyReport — 疑似雙計彙總", () => {
  const row = (over: Partial<MisclassifiedStripePayoutRow> = {}): MisclassifiedStripePayoutRow => ({
    bankTransactionId: 1,
    date: "2026-06-01",
    amount: -100,
    merchantName: "STRIPE",
    description: null,
    isHumanOverridden: false,
    ...over,
  });

  it("空輸入 → 全部歸零", () => {
    const report = buildStripePayoutDeclassifyReport([]);
    expect(report.totalMisclassified).toBe(0);
    expect(report.totalAmount).toBe(0);
    expect(report.autoEligibleCount).toBe(0);
    expect(report.humanOverriddenCount).toBe(0);
    expect(report.items).toEqual([]);
    expect(report.truncated).toBe(false);
  });

  it("加總金額正確(浮點誤差收斂到分)", () => {
    const rows = [
      row({ bankTransactionId: 1, amount: -1000.5 }),
      row({ bankTransactionId: 2, amount: -250.25 }),
    ];
    const report = buildStripePayoutDeclassifyReport(rows);
    expect(report.totalMisclassified).toBe(2);
    expect(report.totalAmount).toBeCloseTo(-1250.75, 2);
    expect(report.truncated).toBe(false);
  });

  it("autoEligible / humanOverridden 分桶正確(confirm 只動前者)", () => {
    const rows = [
      row({ bankTransactionId: 1, amount: -100, isHumanOverridden: false }),
      row({ bankTransactionId: 2, amount: -200, isHumanOverridden: false }),
      row({ bankTransactionId: 3, amount: -300, isHumanOverridden: true }),
    ];
    const report = buildStripePayoutDeclassifyReport(rows);
    expect(report.totalMisclassified).toBe(3);
    expect(report.autoEligibleCount).toBe(2);
    expect(report.autoEligibleAmount).toBeCloseTo(-300, 2);
    expect(report.humanOverriddenCount).toBe(1);
    expect(report.humanOverriddenAmount).toBeCloseTo(-300, 2);
  });

  it("剛好 200 筆 → 不截斷(truncated=false,邊界情況,2026-07-08 對抗審查補齊)", () => {
    const rows = Array.from({ length: 200 }, (_, i) => row({ bankTransactionId: i + 1 }));
    const report = buildStripePayoutDeclassifyReport(rows);
    expect(report.totalMisclassified).toBe(200);
    expect(report.items.length).toBe(200);
    expect(report.truncated).toBe(false);
  });

  it("超過 200 筆樣本上限 → items 截斷但 totalMisclassified 仍是完整數字", () => {
    const rows = Array.from({ length: 250 }, (_, i) => row({ bankTransactionId: i + 1 }));
    const report = buildStripePayoutDeclassifyReport(rows);
    expect(report.totalMisclassified).toBe(250);
    expect(report.items.length).toBe(200);
    expect(report.truncated).toBe(true);
  });
});

// ─── scanMisclassified 的 JS 後處理邏輯(mock DB,2026-07-08 對抗審查 P1 補齊)──

function makeFakeSelectResult(rows: any[]) {
  const builder: any = {
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
  };
  return builder;
}

const updateSetSpy = vi.fn();
const updateWhereSpy = vi.fn(async () => undefined);
let dbRows: any[] = [];

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    select: () => makeFakeSelectResult(dbRows),
    update: () => ({
      set: (patch: any) => {
        updateSetSpy(patch);
        return { where: updateWhereSpy };
      },
    }),
  })),
}));

import { runStripePayoutProbeDryRun, runStripePayoutProbeConfirm } from "./stripePayoutDeclassifyBackfill";

function fakeDbRow(over: Partial<{
  id: number;
  date: string;
  amount: string;
  merchantName: string | null;
  description: string | null;
  originalDescription: string | null;
  paymentMeta: any;
  jeffOverrideCategory: string | null;
}> = {}) {
  return {
    id: 1,
    date: "2026-06-01",
    amount: "-1000.00",
    merchantName: null,
    description: null,
    originalDescription: null,
    paymentMeta: null,
    jeffOverrideCategory: null,
    ...over,
  };
}

describe("runStripePayoutProbeDryRun — paymentMeta payee/payer 併入 haystack", () => {
  beforeEach(() => {
    dbRows = [];
    updateSetSpy.mockClear();
    updateWhereSpy.mockClear();
  });

  it("merchantName/description 都是通用文字,只有 paymentMeta.payee 含 'stripe' → 仍命中(對齊 live preClassify 的 counterparty 訊號)", async () => {
    dbRows = [
      fakeDbRow({
        id: 42,
        merchantName: "ACH TRANSFER",
        description: "generic ach inflow",
        paymentMeta: { payee: "STRIPE", payer: null },
      }),
    ];
    const report = await runStripePayoutProbeDryRun();
    expect(report.totalMisclassified).toBe(1);
    expect(report.autoEligibleCount).toBe(1);
  });

  it("paymentMeta.payer(payee 缺)含 stripe → 一樣命中(payee||payer 的 fallback 順序)", async () => {
    dbRows = [
      fakeDbRow({ id: 43, merchantName: "ACH", paymentMeta: { payee: null, payer: "Stripe Inc" } }),
    ];
    const report = await runStripePayoutProbeDryRun();
    expect(report.totalMisclassified).toBe(1);
  });

  it("完全不含 stripe 字樣(merchantName/description/paymentMeta 都沒有)→ 不誤判", async () => {
    dbRows = [
      fakeDbRow({ id: 44, merchantName: "ZELLE FROM ANN CHEN", paymentMeta: { payee: "ann chen" } }),
    ];
    const report = await runStripePayoutProbeDryRun();
    expect(report.totalMisclassified).toBe(0);
  });

  it("jeffOverrideCategory 已被 Jeff 設過(非空字串)→ 分進 humanOverridden 桶,不進 autoEligible", async () => {
    dbRows = [
      fakeDbRow({ id: 45, merchantName: "STRIPE PAYOUT", jeffOverrideCategory: "income_booking" }),
    ];
    const report = await runStripePayoutProbeDryRun();
    expect(report.totalMisclassified).toBe(1);
    expect(report.humanOverriddenCount).toBe(1);
    expect(report.autoEligibleCount).toBe(0);
  });
});

describe("runStripePayoutProbeConfirm — 只改標 autoEligible 桶,humanOverridden 桶絕不覆寫", () => {
  beforeEach(() => {
    dbRows = [];
    updateSetSpy.mockClear();
    updateWhereSpy.mockClear();
  });

  it("全部 autoEligible → db.update 呼叫一次,jeffOverrideCategory 改成 stripe_payout,updatedCount 正確", async () => {
    dbRows = [
      fakeDbRow({ id: 1, merchantName: "STRIPE" }),
      fakeDbRow({ id: 2, merchantName: "STRIPE TRANSFER" }),
    ];
    const result = await runStripePayoutProbeConfirm();
    expect(result.updatedCount).toBe(2);
    expect(updateSetSpy).toHaveBeenCalledTimes(1);
    expect(updateSetSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ jeffOverrideCategory: "stripe_payout" }),
    );
  });

  it("全部 humanOverridden → db.update 完全不呼叫,updatedCount=0(絕不覆寫人工決定)", async () => {
    dbRows = [
      fakeDbRow({ id: 1, merchantName: "STRIPE", jeffOverrideCategory: "income_booking" }),
    ];
    const result = await runStripePayoutProbeConfirm();
    expect(result.updatedCount).toBe(0);
    expect(result.humanOverriddenCount).toBe(1);
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("混合桶 → 只有 autoEligible 那筆進 updatedCount,humanOverridden 那筆保留在報表但不被改", async () => {
    dbRows = [
      fakeDbRow({ id: 1, merchantName: "STRIPE" }),
      fakeDbRow({ id: 2, merchantName: "STRIPE PAYOUT", jeffOverrideCategory: "income_booking" }),
    ];
    const result = await runStripePayoutProbeConfirm();
    expect(result.updatedCount).toBe(1);
    expect(result.humanOverriddenCount).toBe(1);
    expect(result.totalMisclassified).toBe(2);
  });
});
