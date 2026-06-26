/**
 * Tests for stripMarkdownForEmail — 客人回覆純文字清洗。
 * 含 2026-06-13 prod 截圖的實際 ** 案例(回歸鎖死)。
 */
import { describe, it, expect } from "vitest";
import { stripMarkdownForEmail, hasResidualMarkdown, hasEmDash, stripChatAnswer } from "./plainTextReply";

describe("stripMarkdownForEmail — prod 截圖實際案例", () => {
  it("移除 **粗體** 留人話(YG7/YL7 那封)", () => {
    const draft = [
      "Jeff 您好,",
      "",
      "關於 **YG7 和 YL7 兩個團的差別**,這兩條路線在行程天數上可能不同。",
      "至於 **費用部分**,實際價格依出發日期、人數而定。",
      "**下一步**:我們會在 **1-2 個工作天內**整理好用 email 回覆您。",
    ].join("\n");
    const out = stripMarkdownForEmail(draft);
    expect(out).not.toContain("**");
    expect(out).toContain("YG7 和 YL7 兩個團的差別");
    expect(out).toContain("費用部分");
    expect(out).toContain("下一步");
    expect(out).toContain("1-2 個工作天內");
  });

  it("hasResidualMarkdown 抓得到未清的 **", () => {
    expect(hasResidualMarkdown("關於 **差別**")).toBe(true);
    expect(hasResidualMarkdown(stripMarkdownForEmail("關於 **差別**"))).toBe(false);
  });
});

describe("stripMarkdownForEmail — 各 markdown 形狀", () => {
  it("__粗體__ 與 *斜體*", () => {
    expect(stripMarkdownForEmail("__重要__ 和 *補充*")).toBe("重要 和 補充");
  });

  it("# 標題 去井號留字", () => {
    expect(stripMarkdownForEmail("## 行程摘要\n內文")).toBe("行程摘要\n內文");
  });

  it("[文字](網址) → 文字 (網址)", () => {
    expect(stripMarkdownForEmail("詳見 [官網](https://packgoplay.com)")).toBe(
      "詳見 官網 (https://packgoplay.com)",
    );
  });

  it("行首 - / * / + bullet → 全形點", () => {
    const out = stripMarkdownForEmail("- 機票\n- 住宿\n* 領隊");
    expect(out).toBe("・機票\n・住宿\n・領隊");
  });

  it("inline `code` 去反引號", () => {
    expect(stripMarkdownForEmail("代碼 `YG7`")).toBe("代碼 YG7");
  });

  it("水平線 --- 整行移除", () => {
    expect(stripMarkdownForEmail("上段\n\n---\n\n下段")).toBe("上段\n\n下段");
  });
});

describe("stripMarkdownForEmail — 破折號正規化(Jeff 鐵律:客人訊息不用破折號)", () => {
  it("英文無空格 em dash(prod AFTER 實例 Leslie 草稿)→ 逗號", () => {
    const out = stripMarkdownForEmail(
      "I'll send a message as soon as it arrives—expecting it around Friday.",
    );
    expect(out).toBe(
      "I'll send a message as soon as it arrives, expecting it around Friday.",
    );
    expect(hasEmDash(out)).toBe(false);
  });

  it("英文有空格 em dash → 逗號(不留雙空格)", () => {
    expect(stripMarkdownForEmail("We can do A — or B works too.")).toBe(
      "We can do A, or B works too.",
    );
  });

  it("數字間 en dash 視為範圍 → ASCII 連字號", () => {
    expect(stripMarkdownForEmail("英文導遊全程約 US$174–226。")).toBe(
      "英文導遊全程約 US$174-226。",
    );
    expect(stripMarkdownForEmail("1–2 個工作天內回覆")).toBe("1-2 個工作天內回覆");
  });

  it("中文夾 em dash → 全形逗號(不插 ASCII 逗號/空格)", () => {
    expect(stripMarkdownForEmail("行程——報價都在確認裡")).toBe(
      "行程，報價都在確認裡",
    );
  });

  it("ASCII 連字號(複合字/範圍)永不被破折號規則動到", () => {
    const s = "台北-上海來回,4-人房型,1-2 天回覆";
    expect(stripMarkdownForEmail(s)).toBe(s);
  });

  it("已乾淨、無破折號的草稿完全不動", () => {
    const s = "Hi Leslie,\n\nWill do! I'll let you know as soon as it arrives.\n\nJeff Hsieh";
    expect(stripMarkdownForEmail(s)).toBe(s);
  });

  it("hasEmDash 抓 em/en dash,放過 ASCII 連字號", () => {
    expect(hasEmDash("arrives—expecting")).toBe(true);
    expect(hasEmDash("US$174–226")).toBe(true);
    expect(hasEmDash("台北-上海,1-2 天")).toBe(false);
    expect(hasEmDash(stripMarkdownForEmail("arrives—expecting"))).toBe(false);
  });
});

describe("stripChatAnswer — ops 聊天回 Jeff 的清洗(prod 實例:** 與 emoji)", () => {
  it("移除 ** 粗體(prod ops 回答實例)", () => {
    const out = stripChatAnswer("目前資料庫裡**9 月份的東京團沒有任何可推的產品**,建議先確認**出發日期**。");
    expect(out).not.toContain("**");
    expect(out).toContain("9 月份的東京團沒有任何可推的產品");
    expect(out).toContain("出發日期");
  });

  it("移除 emoji 👍 與打勾 ✓(prod ops 回答實例)", () => {
    expect(stripChatAnswer("收到！👍 我去查一下")).toBe("收到！ 我去查一下");
    expect(stripChatAnswer("已完成 ✓ 收進系統 ✅")).toBe("已完成 收進系統");
  });

  it("破折號比照 email 一起正規化", () => {
    expect(stripChatAnswer("最近一封是 6/15—等你回")).toBe("最近一封是 6/15, 等你回");
  });

  it("保留項目符號「•」、ASCII 連字號、中文標點(不可誤傷)", () => {
    const s = "• 第一項\n• 第二項,台北-上海,1-2 天「黃石團」";
    expect(stripChatAnswer(s)).toBe(s);
  });

  it("已乾淨的 ops 回答完全不動(串流 agent 實例)", () => {
    const s = "你只說「收」,但沒講要收誰。給我名字或 email,我先去翻一下他的往來。";
    expect(stripChatAnswer(s)).toBe(s);
  });

  it("null / 空字串安全", () => {
    expect(stripChatAnswer(null)).toBe("");
    expect(stripChatAnswer("")).toBe("");
  });
});

describe("stripMarkdownForEmail — 不可誤傷", () => {
  it("中文全形標點原樣保留", () => {
    const s = "您好!關於「黃石團」,我們會處理。";
    expect(stripMarkdownForEmail(s)).toBe(s);
  });

  it("句中連字號(4-人房、台北-上海)不動", () => {
    const s = "台北-上海來回,4-人房型";
    expect(stripMarkdownForEmail(s)).toBe(s);
  });

  it("email 裡的底線不被當斜體吃掉", () => {
    const s = "寄到 support_team@packgoplay.com";
    expect(stripMarkdownForEmail(s)).toBe(s);
  });

  it("null / 空字串安全", () => {
    expect(stripMarkdownForEmail(null)).toBe("");
    expect(stripMarkdownForEmail("")).toBe("");
  });

  it("純人話原樣(已乾淨的草稿不被改動)", () => {
    const s = "Jeff 您好,\n\n感謝詢問黃石團,我們 1-2 天內回覆您。\n\nPACK&GO Travel";
    expect(stripMarkdownForEmail(s)).toBe(s);
  });
});
