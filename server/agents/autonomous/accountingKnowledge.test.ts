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
  norm,
  STRIPE_PAYOUT_DESCRIPTORS,
  preClassify,
  type PreClassifyInput,
} from "./accountingKnowledge";

describe("isStripePayoutInflow — Stripe 撥款 descriptor(F1 塊A/塊C 共用來源)", () => {
  it("merchantName 含 STRIPE → 命中", () => {
    expect(isStripePayoutInflow("STRIPE TRANSFER")).toBe(true);
  });

  it("大小寫不拘", () => {
    expect(isStripePayoutInflow("Stripe Payout ACH")).toBe(true);
  });

  it("與其他文字混合(haystack 組合格式)仍命中", () => {
    expect(isStripePayoutInflow("stripe | stripe payment | ")).toBe(true);
  });

  it("不含 stripe 字樣 → 不命中(不誤傷真客人 Zelle 入帳)", () => {
    expect(isStripePayoutInflow("zelle payment to ann for tour deposit")).toBe(false);
  });

  it("空字串/純空白 → 不命中", () => {
    expect(isStripePayoutInflow("")).toBe(false);
    expect(isStripePayoutInflow("   ")).toBe(false);
  });

  it("descriptor 清單目前只有 'stripe' 一個 token(供未來擴充核對)", () => {
    expect(STRIPE_PAYOUT_DESCRIPTORS).toEqual(["stripe"]);
  });

  it("2026-07-08 對抗審查 P2:子字串誤中防護 — 'stripes'/'stripeman' 不算 stripe", () => {
    expect(isStripePayoutInflow("stripes diner payment")).toBe(false);
    expect(isStripePayoutInflow("zelle payment to j stripeman")).toBe(false);
    expect(isStripePayoutInflow("mystripe co")).toBe(false);
  });

  it("完整單字 'stripe' 前後接標點/管線分隔仍命中(不是只認裸字串)", () => {
    expect(isStripePayoutInflow("payout: stripe.")).toBe(true);
    expect(isStripePayoutInflow("stripe, inc")).toBe(true);
  });

  it("⚠ 已知風險(F1 塊D 回爐 2026-07-09,釘死現狀):客人名/memo 含獨立單字 'stripe' 會誤標成 payout", () => {
    // hasWord 單字邊界比對的必然副作用:真有客人姓名或 memo 出現獨立單字
    // "stripe"(例:客人姓 Stripe、或 memo 打了 "for stripe trip"),進帳側
    // 會被誤判成 Stripe 撥款 → 分類 stripe_payout(轉撥不計收入)→ 這筆真
    // 客人收入從損益表消失(漏計方向,不是雙計)。這是「單一 token 判斷」
    // 換來的低誤傷率下,剩餘的殘留風險。本測試釘死現狀:若哪天改判斷邏輯
    // (例如改吃 Plaid merchant 分類或加白名單)讓下面這幾例不再誤中,這條
    // 會亮,提醒同步更新 T6 的已知風險欄。真實補救靠 Jeff 在待認領/損益覆核
    // 時抓,不在本批範圍。
    expect(isStripePayoutInflow("zelle payment from stripe wong")).toBe(true); // 客人姓 Stripe
    expect(isStripePayoutInflow("ach from ann for stripe trip deposit")).toBe(true); // memo 出現 stripe 單字
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
