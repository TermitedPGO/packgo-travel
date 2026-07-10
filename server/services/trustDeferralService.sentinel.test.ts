/**
 * F2 收案補丁 #1(2026-07-10)— 稅表 Trust Summary 恆等式(含哨兵)。
 *
 * 破裂案例(指揮收案審抓到):STRIPE-only 穩態下哨兵列(linkedAccountId=0)
 * 被 totalDeferredForUser 的 isActive=1 join 過濾排除 → Received 0,但
 * recognizedTrustIncomeInPeriod 含哨兵 → Recognized 1000,
 * 恆等式 Received = Recognized + Remaining 破裂。
 * 修:includeSentinel 讓 Received/Remaining 與 Recognized 同 scope。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));

import {
  totalDeferredForUser,
  recognizedTrustIncomeInPeriod,
} from "./trustDeferralService";

function chain(result: unknown) {
  const p = Promise.resolve(result);
  const o: any = { then: p.then.bind(p), catch: p.catch.bind(p) };
  o.where = () => o;
  o.leftJoin = () => o;
  return o;
}
function makeDb(selectResults: unknown[]) {
  let i = 0;
  return { select: () => ({ from: () => chain(selectResults[i++]) }) } as any;
}

// 哨兵列(Stripe-direct):join 不到帳戶 → owner/isActive 皆 null
const SENTINEL_RECOGNIZED = {
  amount: "1000.00",
  depositDate: "2026-03-01",
  linkedAccountId: 0,
  ownerUserId: null,
  accountIsActive: null,
  recognizedAt: new Date("2026-06-20T18:00:00Z"),
  reversedAt: null,
};
const SENTINEL_UNRECOGNIZED = {
  ...SENTINEL_RECOGNIZED,
  amount: "500.00",
  depositDate: "2026-05-01",
  recognizedAt: null,
};

const ORIGINAL_PLAID = process.env.PLAID_TRUST_DEFERRAL_ENABLED;
const ORIGINAL_STRIPE = process.env.STRIPE_TRUST_DEFERRAL_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  // STRIPE-only 穩態(破裂案例的情境)
  delete process.env.PLAID_TRUST_DEFERRAL_ENABLED;
  process.env.STRIPE_TRUST_DEFERRAL_ENABLED = "true";
});
afterEach(() => {
  if (ORIGINAL_PLAID === undefined) delete process.env.PLAID_TRUST_DEFERRAL_ENABLED;
  else process.env.PLAID_TRUST_DEFERRAL_ENABLED = ORIGINAL_PLAID;
  if (ORIGINAL_STRIPE === undefined) delete process.env.STRIPE_TRUST_DEFERRAL_ENABLED;
  else process.env.STRIPE_TRUST_DEFERRAL_ENABLED = ORIGINAL_STRIPE;
});

describe("Trust Summary 恆等式 — Received = Recognized + Remaining(含哨兵)", () => {
  it("STRIPE-only 穩態:哨兵一筆已認列($1,000)+ 一筆未認列($500)→ 1500 = 1000 + 500", async () => {
    // 三次查詢的 SQL 端結果(SQL 條件由測試模擬;JS scope 判斷是被測物):
    // received(本年存入,含已認列)→ 兩筆;recognized → 已認列那筆;
    // remaining(全期未認列)→ 未認列那筆。
    getDb.mockResolvedValue(
      makeDb([
        [SENTINEL_RECOGNIZED, SENTINEL_UNRECOGNIZED],
        [SENTINEL_RECOGNIZED],
        [SENTINEL_UNRECOGNIZED],
      ]),
    );

    const received = await totalDeferredForUser({
      asOfDate: "2026-12-31",
      depositSince: "2026-01-01",
      includeRecognized: true,
      includeSentinel: true,
    });
    const recognized = await recognizedTrustIncomeInPeriod({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    const remaining = await totalDeferredForUser({
      asOfDate: "2026-12-31",
      includeSentinel: true,
    });

    expect(received).toBe(1500); // 收到就是收到,哨兵列計入
    expect(recognized).toBe(1000);
    expect(remaining).toBe(500);
    expect(received).toBe(recognized + remaining); // 恆等式成立
  });

  it("預設 includeSentinel:false(P&L 存入減項口徑)→ 哨兵列照舊排除,行為不變", async () => {
    getDb.mockResolvedValue(makeDb([[SENTINEL_RECOGNIZED, SENTINEL_UNRECOGNIZED]]));
    const total = await totalDeferredForUser({
      asOfDate: "2026-12-31",
      includeRecognized: true,
    });
    expect(total).toBe(0); // 哨兵無銀行入帳列可抵,不進 P&L 減項
  });

  it("includeSentinel:true 仍排除 inactive 真實帳戶列(scope 謂詞同認列側)", async () => {
    const inactiveReal = {
      ...SENTINEL_UNRECOGNIZED,
      linkedAccountId: 30099,
      ownerUserId: 1,
      accountIsActive: 0,
    };
    getDb.mockResolvedValue(makeDb([[inactiveReal]]));
    const total = await totalDeferredForUser({
      asOfDate: "2026-12-31",
      includeSentinel: true,
    });
    expect(total).toBe(0);
  });
});
