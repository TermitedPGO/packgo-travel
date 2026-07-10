/**
 * processInboundTransaction 四態分派整合測試(F1 對帳引擎 塊D 回爐,2026-07-09)。
 *
 * 監工回爐 #2:用可注入的假 db 補整合測試,斷言一筆入帳處理後只會落在
 * {linked, pending_claim, already_handled} 三個「已處理」態,skipped 僅限
 * 範圍外情境(db 掛、找不到交易、出帳非入帳)。四態各有紅綠例。
 *
 * 假 db 作法:getDb() 回一個依「查的是哪張表」路由結果的 fake,每張表的
 * 回傳列由測試逐案設定(vi.hoisted 讓 mock factory 能引用同一個 Map)。
 * dryRun:true 讓 write 路徑回 {id:-1} 佔位,不碰 createBankTransactionLink
 * 的 db.transaction/insert —— 這樣測的是「規則分派」本身,不是寫入細節。
 *
 * 誠實揭露:fake 不解析 drizzle 的 where/join 條件,只按 .from(table) 路由;
 * 測試作者負責讓每張表的 fixture 反映「條件已正確篩過」的結果。SQL 條件文字
 * 的正確性仍靠 code review(同 stripePayoutDeclassifyBackfill.test.ts 的
 * 同款揭露)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => {
  const rows = new Map<unknown, any[]>();
  const makeBuilder = () => {
    let table: unknown = null;
    const b: any = {
      from(t: unknown) { table = t; return b; },
      where() { return b; },
      leftJoin() { return b; },
      innerJoin() { return b; },
      orderBy() { return b; },
      limit() { return b; },
      then(resolve: (v: any) => any, reject: (e: any) => any) {
        return Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
      },
    };
    return b;
  };
  const fakeDb: any = {
    select: () => makeBuilder(),
    transaction: async (fn: any) => fn(fakeDb),
  };
  return { rows, fakeDb };
});

vi.mock("../db", () => ({
  getDb: vi.fn(async () => H.fakeDb),
}));

import { processInboundTransaction } from "./bankTransactionLinkEngine";
import { getDb } from "../db";
import {
  bankTransactions,
  bankTransactionLinks,
  trustDeferredIncome,
  customOrders,
} from "../../drizzle/schema";

/** 組一列 bankTransactions 主查詢會用到的欄位。amount 是 Plaid 字串(負=入帳)。 */
function txnRow(over: Partial<{
  id: number; amount: string; date: string; merchantName: string | null;
  description: string | null; originalDescription: string | null; paymentMeta: any; accountOwner: string | null;
}> = {}) {
  return {
    id: 1, amount: "-500.00", date: "2026-07-01", merchantName: null,
    description: null, originalDescription: null, paymentMeta: null, accountOwner: null,
    ...over,
  };
}

beforeEach(() => {
  H.rows.clear();
  (getDb as any).mockReset();
  (getDb as any).mockImplementation(async () => H.fakeDb);
});

describe("processInboundTransaction — 四態分派(F1 塊D 回爐,可注入假 db)", () => {
  // ── skipped:僅限範圍外情境 ──
  it("skipped:db 掛(getDb 回 null)", async () => {
    (getDb as any).mockResolvedValueOnce(null);
    const r = await processInboundTransaction(1, { dryRun: true });
    expect(r.status).toBe("skipped");
  });

  it("skipped:找不到交易(bankTransactions 查無此列)", async () => {
    H.rows.set(bankTransactions, []); // 空 → row undefined
    const r = await processInboundTransaction(999, { dryRun: true });
    expect(r.status).toBe("skipped");
    if (r.status === "skipped") expect(r.reason).toContain("not found");
  });

  it("skipped:出帳非入帳(amount >= 0,頭號地雷符號守門)", async () => {
    H.rows.set(bankTransactions, [txnRow({ amount: "500.00" })]); // 正=出帳
    const r = await processInboundTransaction(1, { dryRun: true });
    expect(r.status).toBe("skipped");
    if (r.status === "skipped") expect(r.reason).toContain("inflow");
  });

  // ── already_handled ──
  it("already_handled:既有分配已滿額(SUM >= |amount|)", async () => {
    H.rows.set(bankTransactions, [txnRow({ amount: "-100.00" })]);
    H.rows.set(bankTransactionLinks, [{ amountAllocated: "100.00" }]); // 已分配 100 = 全額
    const r = await processInboundTransaction(1, { dryRun: true });
    expect(r.status).toBe("already_handled");
    if (r.status === "already_handled") expect(r.existingAllocated).toBeCloseTo(100, 2);
  });

  // ── pending_claim ──
  it("pending_claim:部分認領(0 < SUM < |amount|),不重跑規則搶餘額", async () => {
    H.rows.set(bankTransactions, [txnRow({ amount: "-100.00" })]);
    H.rows.set(bankTransactionLinks, [{ amountAllocated: "40.00" }]); // 只分配 40
    const r = await processInboundTransaction(1, { dryRun: true });
    expect(r.status).toBe("pending_claim");
  });

  it("pending_claim:全新入帳、無任何規則命中、金額高於門檻 → 出待認領", async () => {
    H.rows.set(bankTransactions, [txnRow({ amount: "-5000.00", merchantName: "ZELLE FROM ANN CHEN", description: "tour deposit" })]);
    // bankTransactionLinks 空 → existing 0;trustDeferredIncome 空 → 無 trust_sync;
    // customOrders 空 → 無 exact_amount 候選;descriptor 不含 stripe/ORD → 落 pending_claim
    const r = await processInboundTransaction(1, { dryRun: true });
    expect(r.status).toBe("pending_claim");
  });

  // ── linked ──
  it("linked:Stripe 撥款 descriptor → auto:stripe_payout(最短命中路徑,dryRun 不寫入)", async () => {
    H.rows.set(bankTransactions, [txnRow({ amount: "-6150.00", merchantName: "STRIPE PAYOUT" })]);
    // 前置規則都不命中(trust 空),落到 stripe_payout
    const r = await processInboundTransaction(1, { dryRun: true });
    expect(r.status).toBe("linked");
    if (r.status === "linked") {
      expect(r.rule).toBe("stripe_payout");
      expect(r.link.categoryCode).toBe("stripe_payout");
      expect(r.linkId).toBe(-1); // dryRun 佔位,證明沒真的寫 DB
    }
  });

  it("不變式:任何入帳處理後狀態 ∈ {linked, pending_claim, already_handled, skipped},不存在第五態", async () => {
    H.rows.set(bankTransactions, [txnRow({ amount: "-6150.00", merchantName: "STRIPE PAYOUT" })]);
    const r = await processInboundTransaction(1, { dryRun: true });
    expect(["linked", "pending_claim", "already_handled", "skipped"]).toContain(r.status);
  });
});
