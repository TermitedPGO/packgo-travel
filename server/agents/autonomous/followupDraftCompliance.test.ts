/**
 * followupDraftCompliance — the deterministic "測 AI 回應" guard. Every
 * follow-up draft must pass these hard rules; a regression breaks the suite.
 * The real professional draft (the packgo-hospitality output for Jenny) is
 * pinned here as the positive case, so the rules can never drift away from a
 * draft Jeff actually approved.
 */
import { describe, it, expect } from "vitest";
import {
  checkFollowupDraftCompliance,
  summarizeCompliance,
  type ComplianceViolation,
} from "./followupDraftCompliance";

// The real hospitality-skill draft for Jenny (grounded in her Gmail thread).
const JENNY_DRAFT = `Jenny 姊姊 您好,

最近一切都還好嗎?天氣慢慢熱起來了,您和家人都要記得多喝水。前陣子在 EBTA 聚餐見到您很開心,後來我把台灣的行程初稿整理好寄給您,一直惦記著不曉得您看了感覺如何。

完全不用著急,我知道帶一個十人的大家庭出遊,光是要喬大家的時間和意見就很費心,我這邊隨時都在,不趕您。

行程那邊我都幫您留著,有兩個小地方等您方便的時候給我一聲就好。一個是英文導遊要不要加;另一個是 Day 8 花蓮那天,您想選池上伯朗大道,還是在花蓮附近輕鬆走走,這兩個都很好,看您和家人的心意。其他細節我都會幫您打點好,您只要決定這兩件,我就能往下幫您安排。

真的不急,您先忙您的,等有空再回我一句就行。有任何想法或想調整的地方,也都隨時跟我說。

祝您和家人這幾天都順心,

Jeff
PACK&GO Travel`;

const violations = (b: string): ComplianceViolation[] =>
  checkFollowupDraftCompliance(b).violations;

describe("checkFollowupDraftCompliance — positive case", () => {
  it("the real professional Jenny draft passes every hard rule", () => {
    const r = checkFollowupDraftCompliance(JENNY_DRAFT);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
    expect(summarizeCompliance(r)).toBe("compliant");
  });
  it("a short clean draft using 您 passes", () => {
    expect(checkFollowupDraftCompliance("林哥 您好,最近還好嗎?您方便時再回我一聲就好。").ok).toBe(true);
  });
});

describe("checkFollowupDraftCompliance — hard violations", () => {
  it("flags an em dash", () => {
    expect(violations("您好。— 後面的話")).toContain("em_dash");
    expect(violations("您好。– 後面")).toContain("em_dash"); // en dash too
  });
  it("does NOT flag an ASCII hyphen (compounds / phone numbers are fine)", () => {
    const r = checkFollowupDraftCompliance("您好,電話 +1 (510) 634-2307,A-B 兩個方案。");
    expect(r.violations).not.toContain("em_dash");
  });
  it("flags the informal 你 (must be 您)", () => {
    expect(violations("你好,最近還好嗎?")).toContain("informal_ni");
  });
  it("flags a body that never uses 您", () => {
    expect(violations("林先生好,行程幫忙留著了。")).toContain("missing_formal_you");
  });
  it("flags markdown bold and headings", () => {
    expect(violations("您好,**重點**在這。")).toContain("markdown");
    expect(violations("# 標題\n您好")).toContain("markdown");
  });
  it("flags check marks and emoji", () => {
    expect(violations("您好 ✓ 已確認")).toContain("emoji_or_check");
    expect(violations("您好 🎁 兌換成功")).toContain("emoji_or_check");
  });
  it("collects multiple violations at once", () => {
    const v = violations("你好 ✓ **重點** — 結束");
    expect(v).toEqual(
      expect.arrayContaining(["informal_ni", "emoji_or_check", "markdown", "em_dash", "missing_formal_you"]),
    );
    expect(checkFollowupDraftCompliance("你好 ✓").ok).toBe(false);
  });
  it("empty body has no violations (caught upstream, not a content rule)", () => {
    expect(checkFollowupDraftCompliance("").violations).toEqual([]);
  });
});

// A correct English follow-up (an English letter never contains 您). Before the
// language-aware fix this tripped missing_formal_you on EVERY correct English
// draft, drowning real drift signals in the eval.
const EN_DRAFT =
  "Hi Jenny, just checking in on the Taiwan itinerary I sent last week. No rush at all, whenever you have a moment.";

describe("checkFollowupDraftCompliance — language awareness (English drafts)", () => {
  it("explicit en: a correct English draft does NOT trip missing_formal_you", () => {
    const r = checkFollowupDraftCompliance(EN_DRAFT, "en");
    expect(r.violations).not.toContain("missing_formal_you");
    expect(r.ok).toBe(true);
  });
  it("explicit en: dash / markdown / emoji rules still run regardless of language", () => {
    const dash = checkFollowupDraftCompliance("Hi Jenny — checking in.", "en");
    expect(dash.violations).toContain("em_dash");
    expect(dash.violations).not.toContain("missing_formal_you");
    expect(checkFollowupDraftCompliance("**Hi** Jenny", "en").violations).toContain("markdown");
    expect(checkFollowupDraftCompliance("Hi Jenny ✓ confirmed", "en").violations).toContain(
      "emoji_or_check",
    );
  });
  it("explicit zh-TW: 你/您 rules still enforced", () => {
    expect(checkFollowupDraftCompliance("你好,最近還好嗎?", "zh-TW").violations).toEqual(
      expect.arrayContaining(["informal_ni", "missing_formal_you"]),
    );
    expect(
      checkFollowupDraftCompliance("林先生好,行程幫忙留著了。", "zh-TW").violations,
    ).toContain("missing_formal_you");
  });
  it("explicit zh-CN: 你/您 rules still enforced", () => {
    expect(checkFollowupDraftCompliance("你好,这个行程还好吗?", "zh-CN").violations).toContain(
      "informal_ni",
    );
  });
  it("no language param: zero-CJK body falls back to English → no 你/您 rules", () => {
    const r = checkFollowupDraftCompliance(EN_DRAFT);
    expect(r.violations).not.toContain("missing_formal_you");
    expect(r.ok).toBe(true);
  });
  it("no language param: CJK body still enforces 你/您 (fallback stays Chinese)", () => {
    expect(violations("你好,最近還好嗎?")).toEqual(
      expect.arrayContaining(["informal_ni", "missing_formal_you"]),
    );
    expect(violations("林先生好,行程幫忙留著了。")).toContain("missing_formal_you");
  });
});

describe("checkFollowupDraftCompliance — cjk_in_en_draft(2026-07-02 Leslie 中文跟進卡)", () => {
  it("language=en 且草稿含中文字 → cjk_in_en_draft 違規", () => {
    const r = checkFollowupDraftCompliance("Hi Leslie, 希望您一切都好. Best, Jeff", "en")
    expect(r.violations).toContain("cjk_in_en_draft")
  })

  it("language=en 純英文草稿 → 無此違規", () => {
    const r = checkFollowupDraftCompliance("Hi Leslie, hope you are well. Best, Jeff", "en")
    expect(r.violations).not.toContain("cjk_in_en_draft")
  })

  it("language=zh-TW 中文草稿 → 不觸發(zh 不設限)", () => {
    const r = checkFollowupDraftCompliance("您好,跟您問候一聲,祝順心", "zh-TW")
    expect(r.violations).not.toContain("cjk_in_en_draft")
  })

  it("未傳 language(內容 fallback)→ 不觸發此規則", () => {
    const r = checkFollowupDraftCompliance("您好,跟您問候一聲")
    expect(r.violations).not.toContain("cjk_in_en_draft")
  })
})

describe("checkFollowupDraftCompliance — corrupted_char(2026-07-02 「麻�煩」QUOTE_REQUEST 實例)", () => {
  it("U+FFFD 損毀字元 → corrupted_char 違規", () => {
    const r = checkFollowupDraftCompliance("您好,麻�煩您確認一下,謝謝您。");
    expect(r.violations).toContain("corrupted_char");
    expect(r.ok).toBe(false);
  });

  it("語言無關:en 草稿含 � 一樣抓", () => {
    const r = checkFollowupDraftCompliance("Hi Leslie, the tour� departs Friday.", "en");
    expect(r.violations).toContain("corrupted_char");
  });

  it("乾淨草稿不誤報", () => {
    expect(violations(JENNY_DRAFT)).not.toContain("corrupted_char");
    expect(
      checkFollowupDraftCompliance(EN_DRAFT, "en").violations,
    ).not.toContain("corrupted_char");
  });
});
