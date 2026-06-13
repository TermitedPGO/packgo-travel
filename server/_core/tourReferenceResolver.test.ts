/**
 * Tests for resolveTourReferences (2026-06-13 spike).
 * 含 YG7/YL7 測試案例 + 黃石關鍵字命中。
 */
import { describe, it, expect } from "vitest";
import { resolveTourReferences, type TourLite } from "./tourReferenceResolver";

const tour = (over: Partial<TourLite> & { id: number }): TourLite => ({
  title: "",
  productCode: null,
  sourceUrl: null,
  destinationCity: null,
  status: "active",
  ...over,
});

// 仿 prod:黃石團用 UUID 代碼、中文標題、draft 狀態
const CATALOG: TourLite[] = [
  tour({ id: 1, title: "經典美西黃石｜五大國家公園、傑克遜小鎮", productCode: "uuid-a", status: "draft" }),
  tour({ id: 2, title: "美西黃石｜羚羊峽谷、賭城、洛杉磯 12 日", productCode: "uuid-b", status: "draft" }),
  tour({ id: 3, title: "京阪神 5 日｜京都、大阪、奈良", productCode: "uuid-c", status: "active" }),
  tour({ id: 4, title: "北海道賞楓｜札幌、函館、小樽", productCode: "uuid-d", status: "active" }),
  tour({ id: 5, title: "Lion 黃石深度", productCode: "26YG7BRC-T", sourceUrl: "https://lion.com/?NormGroupID=26YG7BRC-T", status: "active" }),
];

describe("resolveTourReferences", () => {
  it("YG7/YL7 在無此碼的庫 → unknownCodes,不亂對(誠實不裝懂)", () => {
    const r = resolveTourReferences("想比較 YG7 or YL7 兩個團", [CATALOG[0], CATALOG[1], CATALOG[2]]);
    expect(r.codeMatches).toHaveLength(0);
    expect(r.unknownCodes).toEqual(expect.arrayContaining(["YG7", "YL7"]));
  });

  it("代碼真的在 productCode/sourceUrl 裡 → codeMatches 命中", () => {
    const r = resolveTourReferences("請問 YG7 黃石團", CATALOG);
    // YG7 是 26YG7BRC-T 的子字串 → tour #5 命中
    expect(r.codeMatches.map((t) => t.id)).toContain(5);
  });

  it("黃石 關鍵字 → 撈出庫裡的黃石團候選(即使代碼是 UUID)", () => {
    const r = resolveTourReferences("我想了解黃石團", [CATALOG[0], CATALOG[1], CATALOG[2]]);
    expect(r.keywordCandidates.map((c) => c.tour.id).sort()).toEqual([1, 2]);
    expect(r.keywordCandidates[0].terms).toContain("黃石");
  });

  it("關鍵字多命中分數高、排前面", () => {
    const r = resolveTourReferences("美西黃石 羚羊峽谷 賭城", [CATALOG[0], CATALOG[1]]);
    // tour #2 含 美西/黃石/羚羊峽谷/賭城 多項 → score 高 → 排第一
    expect(r.keywordCandidates[0].tour.id).toBe(2);
    expect(r.keywordCandidates[0].score).toBeGreaterThan(
      r.keywordCandidates[1]?.score ?? 0,
    );
  });

  it("代碼命中的團不重複出現在關鍵字候選", () => {
    const r = resolveTourReferences("YG7 黃石", CATALOG);
    const codeIds = new Set(r.codeMatches.map((t) => t.id));
    expect(r.keywordCandidates.every((c) => !codeIds.has(c.tour.id))).toBe(true);
  });

  it("京阪神 不會誤撈到黃石團", () => {
    const r = resolveTourReferences("京阪神 5 日多少錢", CATALOG);
    expect(r.keywordCandidates.map((c) => c.tour.id)).toEqual([3]);
  });

  it("純年份 2026 不被當代碼", () => {
    const r = resolveTourReferences("2026 年 7 月出發", CATALOG);
    expect(r.unknownCodes).not.toContain("2026");
  });

  it("空字串安全", () => {
    const r = resolveTourReferences("", CATALOG);
    expect(r).toEqual({ codeMatches: [], keywordCandidates: [], unknownCodes: [] });
  });
});
