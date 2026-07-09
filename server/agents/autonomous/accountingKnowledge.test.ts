/**
 * accountingKnowledge — F1 對帳引擎 塊A 新增部分的測試(2026-07-08)。
 *
 * 只測本批新增的 isStripePayoutInflow/norm(既有 preClassify 主體及其他規則
 * 沒有既存測試檔,不在本批範圍內補;新增的東西自己要有紅綠例)。
 */
import { describe, it, expect } from "vitest";
import { isStripePayoutInflow, norm, STRIPE_PAYOUT_DESCRIPTORS } from "./accountingKnowledge";

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
