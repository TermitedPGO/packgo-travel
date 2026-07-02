/**
 * customerLanguage — 語言偵測 + 草稿語言 code gate 的純函式測試。
 *
 * 活反例(2026-07-01):純英文客人 Leslie 的升級草稿「Hi Leslie」開頭、
 * 內文整段中文。這組測試鎖住:en 客人的草稿含任何 CJK 字 → gate 擋;
 * 簽名行(帶中文的品牌簽名)白名單放行;zh 客人不設限。
 */

import { describe, it, expect } from "vitest";
import {
  detectLanguageFromText,
  detectInquiryCustomerLanguage,
  checkDraftLanguage,
  buildLanguageDirective,
  buildLanguageRetryDirective,
  hasCjk,
} from "./customerLanguage";

const BRAND_SIGNATURE = "PACK&GO Travel · Jeff & 團隊";

describe("detectLanguageFromText — 客人 inbound 零 CJK 字 → en", () => {
  it("純英文 → en", () => {
    expect(
      detectLanguageFromText("Hi Jeff, could you send me the itinerary for the Chicago tour?"),
    ).toBe("en");
  });

  it("繁中 → zh-TW", () => {
    expect(detectLanguageFromText("您好,想請問八月的日本團還有位子嗎?")).toBe("zh-TW");
  });

  it("簡體高頻字 → zh-CN", () => {
    expect(detectLanguageFromText("你好,请问这个团还有位置吗?我们两个人")).toBe("zh-CN");
  });

  it("空 / null → zh-TW(保守預設)", () => {
    expect(detectLanguageFromText("")).toBe("zh-TW");
    expect(detectLanguageFromText(null)).toBe("zh-TW");
    expect(detectLanguageFromText(undefined)).toBe("zh-TW");
  });

  it("英文夾一個中文字 → 不是 en", () => {
    expect(detectLanguageFromText("Please confirm the 團 schedule")).toBe("zh-TW");
  });
});

describe("detectInquiryCustomerLanguage — inquiry 鏈的客人語言", () => {
  it("rawMessage(觸發信 = 最新 inbound)英文 → en", () => {
    expect(
      detectInquiryCustomerLanguage({
        rawMessage: "Hello, I want to upgrade my room to ocean view.",
        threadHistory: [{ direction: "inbound", body: "您好,想報名夏威夷團" }],
      }),
    ).toBe("en");
  });

  it("rawMessage 空白 → 退回 threadHistory 最後一封 inbound(舊→新,取最新)", () => {
    expect(
      detectInquiryCustomerLanguage({
        rawMessage: "   ",
        threadHistory: [
          { direction: "inbound", body: "您好,想報名夏威夷團" },
          { direction: "outbound", body: "Sure, here is the quote." },
          { direction: "inbound", body: "Thanks! Can we add one more person?" },
        ],
      }),
    ).toBe("en");
  });

  it("outbound 不算客人語言:歷史只剩我方英文信,客人最後 inbound 是中文 → zh-TW", () => {
    expect(
      detectInquiryCustomerLanguage({
        rawMessage: "",
        threadHistory: [
          { direction: "inbound", body: "您好,麻煩報價" },
          { direction: "outbound", body: "Hi, here is the quote in English." },
        ],
      }),
    ).toBe("zh-TW");
  });

  it("什麼都沒有 → zh-TW(保守預設)", () => {
    expect(detectInquiryCustomerLanguage({ rawMessage: null, threadHistory: [] })).toBe("zh-TW");
    expect(detectInquiryCustomerLanguage({})).toBe("zh-TW");
  });
});

describe("checkDraftLanguage — en 客人草稿的 code gate", () => {
  it("en + 整段中文草稿 → 擋(活反例:Hi Leslie 開頭、內文中文)", () => {
    const r = checkDraftLanguage(
      "en",
      "Hi Leslie,\n\n關於您的升等需求,我們會盡快處理,大約 1-2 個工作天回覆您。\n\nJeff Hsieh",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violation).toBe("cjk_in_en_draft");
      expect(hasCjk(r.sample)).toBe(true);
    }
  });

  it("en + 純英文草稿 → 過", () => {
    expect(
      checkDraftLanguage(
        "en",
        "Hi Leslie,\n\nThanks for reaching out about the upgrade. We will confirm with the hotel and get back to you within 1-2 business days.\n\nJeff Hsieh",
      ),
    ).toEqual({ ok: true });
  });

  it("en + 英文草稿 + 帶中文的品牌簽名(白名單)→ 過", () => {
    expect(
      checkDraftLanguage(
        "en",
        `Hi Leslie,\n\nThanks for your email. We will follow up shortly.\n\n${BRAND_SIGNATURE}`,
        { ignore: [BRAND_SIGNATURE] },
      ),
    ).toEqual({ ok: true });
  });

  it("en + 簽名以外仍有中文 → 白名單救不了,照擋", () => {
    const r = checkDraftLanguage(
      "en",
      `Hi Leslie,\n\n我們收到您的來信了。\n\n${BRAND_SIGNATURE}`,
      { ignore: [BRAND_SIGNATURE] },
    );
    expect(r.ok).toBe(false);
  });

  it("zh-TW / zh-CN 客人不設限:中英夾雜、全英文都過", () => {
    expect(checkDraftLanguage("zh-TW", "您好,report 已附上,thanks!")).toEqual({ ok: true });
    expect(checkDraftLanguage("zh-CN", "Hello, entirely English draft.")).toEqual({ ok: true });
    expect(checkDraftLanguage("zh-TW", "整封都是中文也可以。")).toEqual({ ok: true });
  });

  it("空草稿 → 過(沒東西可違規)", () => {
    expect(checkDraftLanguage("en", "")).toEqual({ ok: true });
    expect(checkDraftLanguage("en", null)).toEqual({ ok: true });
  });
});

describe("語言指示(prompt 半邊)", () => {
  it("en → 硬性指示,含英文重申;zh → 空字串(不設限)", () => {
    const d = buildLanguageDirective("en");
    expect(d).toContain("硬性");
    expect(d).toContain("English only");
    expect(buildLanguageDirective("zh-TW")).toBe("");
    expect(buildLanguageDirective("zh-CN")).toBe("");
  });

  it("重試指令講明是語言違規重寫", () => {
    const d = buildLanguageRetryDirective();
    expect(d).toContain("LANGUAGE VIOLATION");
    expect(d).toContain("重寫");
  });

  it("指示文案自己不帶破折號(客人訊息鐵律的上游)", () => {
    expect(buildLanguageDirective("en")).not.toMatch(/—|–/);
    expect(buildLanguageRetryDirective()).not.toMatch(/—|–/);
  });
});
