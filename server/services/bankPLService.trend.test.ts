/**
 * generateBankMonthlyTrend 遞延口徑接線測試 — F2 塊D 回爐 P2(2026-07-10)。
 *
 * 趨勢是年終稅 CSV(taxCsvService)的資料源:flag ON 時必須「存入月減、
 * 認列月加回」,否則稅表系統性短報認列收入。跨月紅綠 + flag OFF byte-identical。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));
vi.mock("../_core/errorFunnel", () => ({
  reportFunnelError: vi.fn().mockResolvedValue(undefined),
}));

import { generateBankMonthlyTrend } from "./bankPLService";

const NOW = new Date("2026-07-10T12:00:00Z");

function chain(result: unknown) {
  const p = Promise.resolve(result);
  const o: any = { then: p.then.bind(p), catch: p.catch.bind(p) };
  o.where = () => o;
  o.leftJoin = () => o;
  return o;
}

function makeDb(selectResults: unknown[]) {
  let i = 0;
  return {
    select: () => ({ from: () => chain(selectResults[i++]) }),
  } as any;
}

/** 6 月一筆 $1,000 income_booking 入帳(Plaid 負=入帳)。 */
const TREND_ROWS = [
  {
    date: "2026-06-05",
    amount: "-1000.00",
    agentCategory: "income_booking",
    jeffOverrideCategory: null,
    excludeFromAccounting: 0,
    isPending: 0,
    ownerUserId: 1,
  },
];

/** 同一筆錢的遞延列:6 月存入、7 月 5 日(LA)認列。 */
const DEFERRAL_ROWS = [
  {
    amount: "1000.00",
    depositDate: "2026-06-05",
    recognizedAt: new Date("2026-07-05T18:00:00Z"),
    reversedAt: null,
    linkedAccountId: 30003,
    ownerUserId: 1,
    accountIsActive: 1,
  },
];

const ORIGINAL_PLAID = process.env.PLAID_TRUST_DEFERRAL_ENABLED;
const ORIGINAL_STRIPE = process.env.STRIPE_TRUST_DEFERRAL_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_PLAID === undefined) delete process.env.PLAID_TRUST_DEFERRAL_ENABLED;
  else process.env.PLAID_TRUST_DEFERRAL_ENABLED = ORIGINAL_PLAID;
  if (ORIGINAL_STRIPE === undefined) delete process.env.STRIPE_TRUST_DEFERRAL_ENABLED;
  else process.env.STRIPE_TRUST_DEFERRAL_ENABLED = ORIGINAL_STRIPE;
});

describe("generateBankMonthlyTrend — 遞延口徑接線(稅 CSV 資料源)", () => {
  it("綠(flag ON 跨月):6 月存入的訂金從 6 月收入消失,7 月認列時出現", async () => {
    process.env.PLAID_TRUST_DEFERRAL_ENABLED = "true";
    getDb.mockResolvedValue(makeDb([TREND_ROWS, DEFERRAL_ROWS]));

    const trend = await generateBankMonthlyTrend({ months: 3, now: NOW });
    const june = trend.find((r) => r.month === "2026-06")!;
    const july = trend.find((r) => r.month === "2026-07")!;
    expect(june.income).toBe(0); // 1000 銀行入帳 − 1000 存入減項
    expect(june.netProfit).toBe(0);
    expect(july.income).toBe(1000); // 認列月加回
    expect(july.netProfit).toBe(1000);
  });

  it("紅(flag OFF byte-identical):訂金留在存入月,認列月不出現", async () => {
    delete process.env.PLAID_TRUST_DEFERRAL_ENABLED;
    delete process.env.STRIPE_TRUST_DEFERRAL_ENABLED;
    getDb.mockResolvedValue(makeDb([TREND_ROWS, DEFERRAL_ROWS]));

    const trend = await generateBankMonthlyTrend({ months: 3, now: NOW });
    const june = trend.find((r) => r.month === "2026-06")!;
    const july = trend.find((r) => r.month === "2026-07")!;
    expect(june.income).toBe(1000); // 舊行為原封不動
    expect(july.income).toBe(0);
  });
});
