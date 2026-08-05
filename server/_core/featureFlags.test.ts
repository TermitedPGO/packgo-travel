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
  storefrontMode,
  trustAutomatchAmountWindowUsd,
  trustAutomatchDateWindowDays,
  trustEarlyRecognitionWindowDays,
  uvImportLanguage,
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

describe("storefrontMode — storefront-split Phase 0 role flag", () => {
  const orig = process.env.STOREFRONT_MODE;
  afterEach(() => {
    if (orig === undefined) delete process.env.STOREFRONT_MODE;
    else process.env.STOREFRONT_MODE = orig;
  });

  it("未設定 → false(預設 = ops 角色,行為 byte-identical)", () => {
    delete process.env.STOREFRONT_MODE;
    expect(storefrontMode()).toBe(false);
  });

  it("設 '1'(藍圖 fly secrets 的值)→ true", () => {
    process.env.STOREFRONT_MODE = "1";
    expect(storefrontMode()).toBe(true);
  });

  it("設 'true'(與本檔其他 flag 慣例一致)→ true", () => {
    process.env.STOREFRONT_MODE = "true";
    expect(storefrontMode()).toBe(true);
  });

  it("其他值(''/'0'/'yes'/'TRUE')→ false(嚴格 opt-in,只認 '1' 或 'true')", () => {
    for (const v of ["", "0", "yes", "TRUE", "on", "false"]) {
      process.env.STOREFRONT_MODE = v;
      expect(storefrontMode()).toBe(false);
    }
  });
});

/* ─────────── uvImportLanguage(feature: supplier-import-language) ─────────── */

describe("uvImportLanguage — 供應商匯入語言(預設繁中)", () => {
  const KEY = "UV_IMPORT_LANGUAGE";
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("未設定 → zh-TW(2)。預設繁中是本 feature 的主要交付物", () => {
    delete process.env[KEY];
    const lang = uvImportLanguage();
    expect(lang.tag).toBe("zh-TW");
    expect(lang.code).toBe("2");
    expect(lang.num).toBe(2);
  });

  it("三個合法值各自對映正確的 UV 語言碼", () => {
    const cases = [
      ["zh-CN", "1", 1],
      ["zh-TW", "2", 2],
      ["en", "3", 3],
    ] as const;
    for (const [tag, code, num] of cases) {
      process.env[KEY] = tag;
      const lang = uvImportLanguage();
      expect(lang.tag).toBe(tag);
      expect(lang.code).toBe(code);
      expect(lang.num).toBe(num);
    }
  });

  it("不變量:code 與 num 恆為同一語言(對映若能分家就會拿到別的語言且不報錯)", () => {
    for (const v of ["zh-CN", "zh-TW", "en", "亂打", undefined]) {
      if (v === undefined) delete process.env[KEY];
      else process.env[KEY] = v;
      const lang = uvImportLanguage();
      expect(lang.num).toBe(Number(lang.code));
    }
  });

  it("正規化:大小寫與前後空白皆命中(Fly secret 是手打的)", () => {
    for (const v of ["zh-tw", " zh-TW ", "ZH-TW", "\tZh-Tw\n"]) {
      process.env[KEY] = v;
      expect(uvImportLanguage().tag).toBe("zh-TW");
    }
  });

  it("非法值退回繁中,且明確不等於英文 —— 退回英文即靜默重蹈覆轍", () => {
    for (const v of ["", "   ", "zh", "japanese", "2", "3", "true", "EN-GB", "zh_TW"]) {
      process.env[KEY] = v;
      const lang = uvImportLanguage();
      expect(lang.tag).toBe("zh-TW");
      expect(lang.tag).not.toBe("en");
      expect(lang.code).not.toBe("3");
    }
  });

  it("Accept-Language 與 tag 同語言", () => {
    process.env[KEY] = "en";
    expect(uvImportLanguage().acceptLanguage).toMatch(/^en/);
    process.env[KEY] = "zh-TW";
    expect(uvImportLanguage().acceptLanguage).toMatch(/^zh-TW/);
    process.env[KEY] = "zh-CN";
    expect(uvImportLanguage().acceptLanguage).toMatch(/^zh-CN/);
  });
});
