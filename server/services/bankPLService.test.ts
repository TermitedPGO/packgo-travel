/**
 * Unit tests for foldBankPLRows — the pure P&L summation core (M4, 2026-05-28).
 *
 * The whole point of splitting this out of generateBankPL is to lock down the
 * Schedule-C math without a DB. The financial red-lines under test:
 *   1. transfer (owner capital) NEVER touches income / expenses / netProfit
 *      (Jeff:「我自己拿出 不代表公司賺」) — it only shows in its own tile.
 *   2. refunds net against income; trust-deferred income is subtracted from
 *      both income.total and netProfit (CST §17550) and surfaced separately.
 *   3. uncategorized + other_review never silently become income — they land
 *      in needsReview (不準猜).
 *
 * Plaid sign convention: amount > 0 = outflow (expense), amount < 0 = inflow.
 */
import { describe, it, expect } from "vitest";
import { foldBankPLRows, type BankPLRowLike } from "./bankPLService";

const PERIOD = { startDate: "2026-01-01", endDate: "2026-01-31" };

function fold(rows: BankPLRowLike[], deferred = 0) {
  return foldBankPLRows(rows, { ...PERIOD, deferredIncomeSubtracted: deferred });
}

describe("foldBankPLRows — section math", () => {
  const rows: BankPLRowLike[] = [
    { amount: "-1000", agentCategory: "income_booking" }, // inflow → income +1000
    { amount: "-500", jeffOverrideCategory: "income_booking" }, // +500
    { amount: "300", agentCategory: "cogs_tour" }, // cogs 300
    { amount: "100", agentCategory: "expense_software" }, // operating 100
    { amount: "200", agentCategory: "refund" }, // refund out to customer
    { amount: "-5000", jeffOverrideCategory: "transfer" }, // owner capital IN
    { amount: "2000", agentCategory: "transfer" }, // owner draw OUT
    { amount: "999", excludeFromAccounting: 1, agentCategory: "cogs_tour" }, // skipped
    { amount: "888", isPending: 1, agentCategory: "income_booking" }, // skipped
    { amount: "42" }, // uncategorized → needsReview
    { amount: "-77", agentCategory: "other_review" }, // agent punt → needsReview
  ];

  it("income nets refunds; gross/net profit chain is correct", () => {
    const r = fold(rows);
    // totalIncome 1500 − refunds 200 = 1300 (income.total already nets refunds)
    expect(r.income.total).toBe(1300);
    expect(r.income.byCategory.income_booking).toBe(1500);
    expect(r.refunds).toBe(200);
    expect(r.expenses.cogs).toBe(300);
    expect(r.expenses.operating).toBe(100);
    expect(r.expenses.total).toBe(400);
    expect(r.grossProfit).toBe(1000); // 1300 − cogs 300
    expect(r.netProfit).toBe(900); // 1000 − operating 100
  });

  it("RED-LINE: transfer is surfaced but excluded from income/expense/netProfit", () => {
    const r = fold(rows);
    // net owner movement: +5000 in − 2000 out = 3000 (inflow-positive)
    expect(r.transfer.total).toBe(3000);
    expect(r.transfer.count).toBe(2);
    // none of that 5000 leaked into income or profit
    expect(r.income.byCategory.transfer).toBeUndefined();
    expect(r.netProfit).toBe(900); // unchanged by the 5000 inflow
  });

  it("uncategorized + other_review surface as needsReview, not income (不準猜)", () => {
    const r = fold(rows);
    expect(r.needsReviewCount).toBe(2);
    expect(r.needsReviewAmount).toBe(42 + 77);
    expect(r.uncategorizedCount).toBe(1);
  });

  it("excluded + pending rows are skipped but still counted in transactionCount", () => {
    const r = fold(rows);
    expect(r.excludedFromAccounting).toBe(1);
    expect(r.transactionCount).toBe(rows.length);
  });
});

describe("foldBankPLRows — trust deferral (CST §17550)", () => {
  const rows: BankPLRowLike[] = [
    { amount: "-1000", agentCategory: "income_booking" },
    { amount: "300", agentCategory: "cogs_tour" },
  ];

  it("subtracts deferred income from income.total and netProfit, surfaces it", () => {
    const r = fold(rows, 400);
    expect(r.income.total).toBe(600); // 1000 − 400 deferred
    expect(r.grossProfit).toBe(300); // 600 − cogs 300
    expect(r.netProfit).toBe(300); // no operating
    expect(r.trustDeferredIncome).toBe(400);
  });

  it("defaults deferral to 0 when not supplied", () => {
    const r = foldBankPLRows(rows, PERIOD);
    expect(r.trustDeferredIncome).toBe(0);
    expect(r.income.total).toBe(1000);
  });
});

describe("foldBankPLRows — stripe_payout (F1 塊C 雙計防護, 2026-07-08)", () => {
  // 2026-07-08 對抗審查 P1:stripe_payout 原本沒有分支接住,金額靜默消失,
  // Jeff 在 P&L UI 上完全看不到。這組測試鎖死它有自己的 tile,同時絕不
  // 進 income/expense/netProfit(跟 transfer 同級的紅線)。
  const rows: BankPLRowLike[] = [
    { amount: "-1000", agentCategory: "income_booking" }, // 真收入
    { amount: "-4200", agentCategory: "stripe_payout" }, // Stripe 撥款落地(進帳)
    { amount: "-808", jeffOverrideCategory: "stripe_payout" }, // Jeff 手動改標的也算
    { amount: "300", agentCategory: "cogs_tour" },
  ];

  it("RED-LINE: stripe_payout 有自己的 tile,金額不會靜默消失", () => {
    const r = fold(rows);
    expect(r.stripePayout.total).toBe(5008); // 4200 + 808,inflow-positive
    expect(r.stripePayout.count).toBe(2);
  });

  it("RED-LINE: stripe_payout 絕不進 income/expense/netProfit(雙計防護核心)", () => {
    const r = fold(rows);
    expect(r.income.total).toBe(1000); // 只有真收入,stripe_payout 沒混進來
    expect(r.income.byCategory.stripe_payout).toBeUndefined();
    expect(r.expenses.total).toBe(300);
    expect(r.grossProfit).toBe(700); // 1000 - 300,不受 5008 撥款影響
    expect(r.netProfit).toBe(700);
  });

  it("stripe_payout 不落入 needsReview(不是待審核,是已知的轉撥類別)", () => {
    const r = fold(rows);
    expect(r.needsReviewCount).toBe(0);
    expect(r.uncategorizedCount).toBe(0);
  });
});

describe("foldBankPLRows — transfer-only ledger", () => {
  it("a ledger of pure owner transfers yields zero profit, only a transfer tile", () => {
    const r = fold([
      { amount: "-8000", agentCategory: "transfer" },
      { amount: "-908", jeffOverrideCategory: "transfer" },
    ]);
    expect(r.income.total).toBe(0);
    expect(r.expenses.total).toBe(0);
    expect(r.netProfit).toBe(0);
    expect(r.transfer.total).toBe(8908);
    expect(r.transfer.count).toBe(2);
  });

  it("empty ledger is all zeros", () => {
    const r = fold([]);
    expect(r.income.total).toBe(0);
    expect(r.netProfit).toBe(0);
    expect(r.transfer.total).toBe(0);
    expect(r.transactionCount).toBe(0);
  });
});
