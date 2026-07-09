/**
 * featureFlags — F1 塊B (2026-07-08) 新增部分的測試。
 *
 * 只測本批新增/收口的函式:stripeTrustDeferralEnabled(新 flag)+
 * trustAutomatchAmountWindowUsd/trustAutomatchDateWindowDays/
 * trustEarlyRecognitionWindowDays(從 trustDeferralService.ts 收口進來的三個
 * 裸 process.env 讀取)。既有的 trustDeferralEnabled/trustRecognitionOffsetDays/
 * trustAutomatchMinConfidence 沒有既存測試檔,不在本批範圍內補。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  stripeTrustDeferralEnabled,
  trustAutomatchAmountWindowUsd,
  trustAutomatchDateWindowDays,
  trustEarlyRecognitionWindowDays,
} from "./featureFlags";

const ENV_KEYS = [
  "STRIPE_TRUST_DEFERRAL_ENABLED",
  "PLAID_TRUST_AUTOMATCH_AMOUNT_WINDOW_USD",
  "PLAID_TRUST_AUTOMATCH_DATE_WINDOW_DAYS",
  "PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS",
] as const;
const originals: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) originals[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originals[k] === undefined) delete process.env[k];
    else process.env[k] = originals[k];
  }
});

describe("stripeTrustDeferralEnabled — F1 塊B 新 flag(預設 off)", () => {
  it("未設定 → false(預設關,dispatch 明文要求)", () => {
    delete process.env.STRIPE_TRUST_DEFERRAL_ENABLED;
    expect(stripeTrustDeferralEnabled()).toBe(false);
  });

  it("設 'true'(字串,大小寫敏感)→ true", () => {
    process.env.STRIPE_TRUST_DEFERRAL_ENABLED = "true";
    expect(stripeTrustDeferralEnabled()).toBe(true);
  });

  it("設其他值(如 '1'/'TRUE'/'yes')→ false(只認精確字串 'true',同既有 trustDeferralEnabled 慣例,防打錯字靜默失效)", () => {
    process.env.STRIPE_TRUST_DEFERRAL_ENABLED = "1";
    expect(stripeTrustDeferralEnabled()).toBe(false);
    process.env.STRIPE_TRUST_DEFERRAL_ENABLED = "TRUE";
    expect(stripeTrustDeferralEnabled()).toBe(false);
  });
});

describe("trustAutomatchAmountWindowUsd — 收口自 trustDeferralService.ts 裸 process.env", () => {
  it("未設定 → 預設 1.00", () => {
    delete process.env.PLAID_TRUST_AUTOMATCH_AMOUNT_WINDOW_USD;
    expect(trustAutomatchAmountWindowUsd()).toBe(1.0);
  });
  it("設有效值 → 採用", () => {
    process.env.PLAID_TRUST_AUTOMATCH_AMOUNT_WINDOW_USD = "2.50";
    expect(trustAutomatchAmountWindowUsd()).toBe(2.5);
  });
  it("負值/非數字 → 退回預設", () => {
    process.env.PLAID_TRUST_AUTOMATCH_AMOUNT_WINDOW_USD = "-1";
    expect(trustAutomatchAmountWindowUsd()).toBe(1.0);
    process.env.PLAID_TRUST_AUTOMATCH_AMOUNT_WINDOW_USD = "nope";
    expect(trustAutomatchAmountWindowUsd()).toBe(1.0);
  });
});

describe("trustAutomatchDateWindowDays — 收口自 trustDeferralService.ts 裸 process.env", () => {
  it("未設定 → 預設 2", () => {
    delete process.env.PLAID_TRUST_AUTOMATCH_DATE_WINDOW_DAYS;
    expect(trustAutomatchDateWindowDays()).toBe(2);
  });
  it("設有效值 → 採用", () => {
    process.env.PLAID_TRUST_AUTOMATCH_DATE_WINDOW_DAYS = "5";
    expect(trustAutomatchDateWindowDays()).toBe(5);
  });
  it("負值 → 退回預設", () => {
    process.env.PLAID_TRUST_AUTOMATCH_DATE_WINDOW_DAYS = "-3";
    expect(trustAutomatchDateWindowDays()).toBe(2);
  });
  it("非數字字串 → 退回預設(2026-07-08 對抗審查 P2 補齊,原本只測負值)", () => {
    process.env.PLAID_TRUST_AUTOMATCH_DATE_WINDOW_DAYS = "nope";
    expect(trustAutomatchDateWindowDays()).toBe(2);
  });
});

describe("trustEarlyRecognitionWindowDays — 收口自 trustDeferralService.ts 裸 process.env", () => {
  it("未設定 → 預設 30", () => {
    delete process.env.PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS;
    expect(trustEarlyRecognitionWindowDays()).toBe(30);
  });
  it("設 0(關閉早鳥認列)→ 採用 0,不是退回預設", () => {
    process.env.PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS = "0";
    expect(trustEarlyRecognitionWindowDays()).toBe(0);
  });
  it("負值 → 退回預設 30", () => {
    process.env.PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS = "-5";
    expect(trustEarlyRecognitionWindowDays()).toBe(30);
  });
  it("非數字字串 → 退回預設(2026-07-08 對抗審查 P2 補齊,原本只測負值)", () => {
    process.env.PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS = "nope";
    expect(trustEarlyRecognitionWindowDays()).toBe(30);
  });
});
