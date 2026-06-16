import { describe, it, expect } from "vitest";
import {
  extractCostCandidates,
  costLeakCheck,
  stripHtmlToVisibleText,
  assertNoCostLeakInHtml,
} from "./costLeakGate";

describe("extractCostCandidates", () => {
  it("pulls 4+ digit numbers, comma-tolerant + deduped", () => {
    const text =
      "每人 tour cost 1,749，扣折扣後淨成本 1,089；總成本 28,900。重複 1749。";
    const c = extractCostCandidates(text);
    expect(c).toContain("1749");
    expect(c).toContain("1089");
    expect(c).toContain("28900");
    // deduped: 1749 appears twice but listed once
    expect(c.filter((x) => x === "1749")).toHaveLength(1);
  });

  it("excludes 4-digit years (1900-2099) so dates don't become cost candidates", () => {
    const c = extractCostCandidates("出發 2026 年 8 月,行程 1999 年首發,成本 2099");
    // 2026 + 1999 + 2099 all look like years → excluded
    expect(c).not.toContain("2026");
    expect(c).not.toContain("1999");
    expect(c).not.toContain("2099");
  });

  it("skips numbers under 4 digits (discounts/小數字 collide with正文)", () => {
    const c = extractCostCandidates("折扣 300,車程 40 分鐘,小費 260");
    expect(c).not.toContain("300");
    expect(c).not.toContain("40");
    expect(c).not.toContain("260");
  });

  it("returns empty for blank / number-free text", () => {
    expect(extractCostCandidates("")).toEqual([]);
    expect(extractCostCandidates("純文字沒有數字")).toEqual([]);
  });
});

describe("costLeakCheck", () => {
  it("BLOCKS when a supplier cost number appears in the customer text", () => {
    const r = costLeakCheck("整團報價 28,900 美金", ["28900"]);
    expect(r.ok).toBe(false);
    expect(r.hits).toContain("28900");
  });

  it("PASSES when no cost number appears", () => {
    const r = costLeakCheck("整團報價 待確認,每人 待確認", ["28900", "1749"]);
    expect(r.ok).toBe(true);
    expect(r.hits).toEqual([]);
  });

  it("comma / 全形 comma tolerant on both sides", () => {
    expect(costLeakCheck("價 3，498 元", ["3498"]).ok).toBe(false); // 全形 in text
    expect(costLeakCheck("價 3498 元", ["3,498"]).ok).toBe(false); // comma in cost arg
  });

  it("digit-boundary: 3498 does NOT match inside 34980 or 134980", () => {
    expect(costLeakCheck("編號 34980 與 134981", ["3498"]).ok).toBe(true);
  });

  it("accepts number-typed costs and skips sub-3-digit noise", () => {
    const r = costLeakCheck("車程 40 分鐘,10 人,房 5 間", [40, 10, 5]);
    expect(r.ok).toBe(true); // all < 3 digits → skipped, never compared
  });

  it("phone/CST contiguous digits don't false-hit a 3-digit candidate", () => {
    // customer footer has +1 (510) 634-2307 → digits 5106342307 contiguous
    const r = costLeakCheck("聯絡 +1 (510) 634-2307", ["634"]);
    expect(r.ok).toBe(true); // 634 is followed by 2 → digit-boundary fails
  });
});

describe("stripHtmlToVisibleText", () => {
  it("removes <style> so CSS numbers (300px, mm) never reach the gate", () => {
    const html = `<style>.day-photo{height:300px}.page{min-height:297mm}</style><body><p>每日行程</p></body>`;
    const text = stripHtmlToVisibleText(html);
    expect(text).not.toContain("300");
    expect(text).not.toContain("297");
    expect(text).toContain("每日行程");
  });

  it("decodes entities and collapses whitespace", () => {
    expect(stripHtmlToVisibleText("<p>Pack &amp;  Go</p>")).toBe("Pack & Go");
  });
});

describe("assertNoCostLeakInHtml", () => {
  it("does NOT false-block on a CSS height that equals a 3-digit candidate", () => {
    const html = `<style>.x{height:300px}</style><div>車程約 1.5 小時</div>`;
    // 300 only lives in CSS — stripped before gating
    const r = assertNoCostLeakInHtml(html, ["300"]);
    expect(r.ok).toBe(true);
  });

  it("BLOCKS when a cost leaks into a visible day description", () => {
    const html = `<style>.x{color:#1A1A1A}</style><div class="day-desc">含每人成本 1,749 美金</div>`;
    const r = assertNoCostLeakInHtml(html, ["1749"]);
    expect(r.ok).toBe(false);
    expect(r.hits).toContain("1749");
  });

  it("PASSES a clean 待確認 quote HTML against supplier candidates", () => {
    const html = `<div class="price">報價 待確認</div><div class="day-desc">出發 2026 年,10 人 5 房,車程 40 分鐘</div>`;
    const r = assertNoCostLeakInHtml(html, ["28900", "1749", "1089"]);
    expect(r.ok).toBe(true);
  });
});
