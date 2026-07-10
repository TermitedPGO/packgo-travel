/**
 * accountingKnowledge — F1 對帳引擎 塊A/塊C 新增部分的測試(2026-07-08)。
 *
 * 只測本批新增的 isStripePayoutInflow/norm/preClassify 的 stripe_payout 分支
 * (既有 preClassify 主體其他規則沒有既存測試檔,不在本批範圍內補;新增的東西
 * 自己要有紅綠例)。
 */
import { describe, it, expect } from "vitest";
import {
  isStripePayoutInflow,
  isSquarePayoutInflow,
  norm,
  STRIPE_PAYOUT_DESCRIPTORS,
  STRIPE_PAYOUT_CONTEXT_TOKENS,
  preClassify,
  type PreClassifyInput,
} from "./accountingKnowledge";

describe("isStripePayoutInflow — Stripe 撥款需撥款語境(F1 塊D 回爐 2026-07-09,prod 探真後收緊)", () => {
  // 綠例:stripe 錨點 + 撥款語境 token(payout / transfer)
  it("STRIPE TRANSFER(Stripe 預設 ACH statement descriptor)→ 命中", () => {
    expect(isStripePayoutInflow("STRIPE TRANSFER")).toBe(true);
  });

  it("Stripe Payout ACH → 命中(大小寫不拘)", () => {
    expect(isStripePayoutInflow("Stripe Payout ACH")).toBe(true);
  });

  it("haystack 組合格式含 transfer → 命中", () => {
    expect(isStripePayoutInflow("stripe | stripe transfer | ")).toBe(true);
  });

  it("完整單字 stripe + 撥款語境 前後接標點/管線仍命中(不是只認裸字串)", () => {
    expect(isStripePayoutInflow("payout: stripe.")).toBe(true);
    expect(isStripePayoutInflow("stripe transfer, inc")).toBe(true);
  });

  // 🔧 回爐真修:裸 stripe(無撥款語境)不再命中 —— 這就是指揮打回的漏斗漏洞
  it("🔧 回爐修:裸 stripe(無 payout/transfer,如 'stripe payment'/'stripe, inc')不再命中 → 落 pending_claim 交 Jeff", () => {
    expect(isStripePayoutInflow("stripe, inc")).toBe(false);
    expect(isStripePayoutInflow("stripe | stripe payment | ")).toBe(false); // "payment" 非撥款語境
  });

  it("🔧 回爐修:客人姓 Stripe 的 Zelle 入帳 → 不再誤標 payout(原釘現狀 true,改真修 false)", () => {
    // 指揮打回:這是今天在跑的認領漏斗題不是 F2 損益題。原本裸 stripe 命中會
    // 把真客人收入自動排除成撥款、永不進待認領、靜默消失(Ann 同類病)。
    expect(isStripePayoutInflow("zelle payment from stripe wong")).toBe(false);
  });

  it("🔧 回爐修:memo 含獨立單字 stripe 的客人入帳 → 不再誤標 payout", () => {
    expect(isStripePayoutInflow("ach from ann for stripe trip deposit")).toBe(false);
  });

  it("不含 stripe → 不命中(真客人 Zelle 入帳)", () => {
    expect(isStripePayoutInflow("zelle payment to ann for tour deposit")).toBe(false);
  });

  it("空字串/純空白 → 不命中", () => {
    expect(isStripePayoutInflow("")).toBe(false);
    expect(isStripePayoutInflow("   ")).toBe(false);
  });

  it("子字串誤中防護 — stripes/stripeman/mystripe 不算 stripe(即使帶 transfer)", () => {
    expect(isStripePayoutInflow("stripes diner transfer")).toBe(false);
    expect(isStripePayoutInflow("zelle to j stripeman transfer")).toBe(false);
    expect(isStripePayoutInflow("mystripe co payout")).toBe(false);
  });

  it("錨點/語境 token 清單(供未來按真 Stripe 撥款 descriptor 校準)", () => {
    expect(STRIPE_PAYOUT_DESCRIPTORS).toEqual(["stripe"]);
    expect(STRIPE_PAYOUT_CONTEXT_TOKENS).toEqual(["payout", "transfer"]);
  });
});

describe("norm — lowercase + 收斂空白(既有私有函式,本批 export 供跨檔重用)", () => {
  it("lowercase + trim + 收斂多空白", () => {
    expect(norm("  STRIPE   Transfer  ")).toBe("stripe transfer");
  });

  it("null/undefined → 空字串", () => {
    expect(norm(null)).toBe("");
    expect(norm(undefined)).toBe("");
  });
});

describe("preClassify — stripe_payout 分支(F1 塊C 雙計防護,2026-07-08)", () => {
  const base: PreClassifyInput = {
    amount: -1000,
    merchantName: null,
    description: null,
    originalDescription: null,
    counterparty: null,
    accountName: "PACK&GO Checking",
    accountType: "depository",
  };

  it("紅綠例(綠):Stripe 撥款進帳 → category=stripe_payout,高信心,不落 income_booking", () => {
    const r = preClassify({ ...base, merchantName: "STRIPE TRANSFER" });
    expect(r.category).toBe("stripe_payout");
    expect(r.source).toBe("stripe_payout");
    expect(r.confidence).toBeGreaterThanOrEqual(90);
  });

  it("紅綠例(紅):真客人 Zelle 團費進帳 → 不受影響,仍正確落 income_booking(memo 提示)", () => {
    // 2026-07-08 對抗審查 P1(mutation test 證明):原本只斷言
    // `not.toBe("stripe_payout")` 太弱——拿掉 MEMO_HINTS 的 "tour deposit"
    // token 模擬一個讓真實客人收入掉出正確分類的回歸,14 個測試全部照樣
    // PASS,代表舊斷言完全沒在驗證 dispatch 要求的「不受影響」。改成直接
    // 鎖 category==="income_booking" + source==="memo"。同時把 descriptor
    // 換成不借用 KNOWN_OUTFLOW_VENDORS 裡「Ann(中國簽證 vendor)」出帳
    // 字串的乾淨客人 Zelle 格式,避免語意混淆。
    const r = preClassify({
      ...base,
      description: "ZELLE PAYMENT FROM LIN WEI CHEN",
      originalDescription: "zelle from lin wei chen - taiwan tour deposit",
    });
    expect(r.category).toBe("income_booking");
    expect(r.source).toBe("memo");
    expect(r.category).not.toBe("stripe_payout");
  });

  it("出帳側含 stripe(手續費扣款)→ 不套用本規則(呼叫端契約:只在進帳判斷)", () => {
    const r = preClassify({ ...base, amount: 25, merchantName: "STRIPE FEE" });
    expect(r.category).not.toBe("stripe_payout");
  });

  it("與已知供應商/業主規則不衝突 — Stripe descriptor 優先於 memo 提示分支", () => {
    const r = preClassify({
      ...base,
      merchantName: "STRIPE PAYOUT",
      description: "tour deposit settlement",
    });
    expect(r.category).toBe("stripe_payout");
  });
});

describe("isSquarePayoutInflow — Square 撥款錨點+語境(F2 塊C 2026-07-10,prod 探真錨定)", () => {
  it("真形狀 a(Plaid description):ACH CREDIT Square Inc SQ ON 06/01 → 命中", () => {
    expect(isSquarePayoutInflow("ACH CREDIT Square Inc SQ ON 06/01")).toBe(true);
  });

  it("真形狀 b(BofA originalDescription):Square Inc DES:SQ190723 ID:Txxx INDN:PACK & GO, LLC CO ID:xxx PPD → 命中", () => {
    expect(
      isSquarePayoutInflow(
        "Square Inc DES:SQ190723 ID:T2DJEJC0VJZ8W3K INDN:PACK & GO, LLC CO ID:9424300002 PPD",
      ),
    ).toBe(true);
  });

  it("裸 square 字樣(客人姓氏/memo)→ 永不命中(防姓氏誤傷)", () => {
    expect(isSquarePayoutInflow("zelle payment from ann square")).toBe(false);
    expect(isSquarePayoutInflow("wire from SQUARE WONG for tour deposit")).toBe(false);
    expect(isSquarePayoutInflow("square")).toBe(false);
  });

  it("有 square inc 詞組但無語境 token → 不命中(錨點+語境雙要求)", () => {
    expect(isSquarePayoutInflow("payment to square inc for hardware")).toBe(false);
  });

  it("子字串不算單字命中:squareinc / mysquare 不中", () => {
    expect(isSquarePayoutInflow("squareinc sq transfer")).toBe(false);
    expect(isSquarePayoutInflow("mysquare inc ach")).toBe(false);
  });
});
