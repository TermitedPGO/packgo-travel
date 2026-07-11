/**
 * pendingClaimsHelpers 純函式紅綠例(F-workbench)——批次選取加總、勾選修剪、
 * 鍵盤焦點邊界。分頁邊界本身在 server engine paginateUnlinkedInflows 測。
 */
import { describe, it, expect } from "vitest";
import {
  flattenPages,
  sumSelectedAmount,
  toggleSelected,
  pruneSelected,
  moveFocus,
} from "./pendingClaimsHelpers";

describe("flattenPages — useInfiniteQuery 多頁攤平", () => {
  it("依頁序串成單一陣列", () => {
    expect(
      flattenPages([{ items: [1, 2] }, { items: [3] }, { items: [] }]),
    ).toEqual([1, 2, 3]);
  });
  it("undefined / null → 空陣列", () => {
    expect(flattenPages(undefined)).toEqual([]);
    expect(flattenPages(null)).toEqual([]);
  });
});

describe("sumSelectedAmount — 批次選取金額加總", () => {
  const items = [
    { bankTransactionId: 1, amount: 100.1 },
    { bankTransactionId: 2, amount: 200.2 },
    { bankTransactionId: 3, amount: 300 },
  ];
  it("只加勾選的列,四捨五入到分", () => {
    expect(sumSelectedAmount(items, new Set([1, 2]))).toBe(300.3);
  });
  it("空選取 → 0", () => {
    expect(sumSelectedAmount(items, new Set())).toBe(0);
  });
  it("勾選了不在列表的 id → 不計入", () => {
    expect(sumSelectedAmount(items, new Set([1, 999]))).toBe(100.1);
  });
});

describe("toggleSelected — 切換勾選(不改原集)", () => {
  it("未勾 → 勾;已勾 → 取消", () => {
    const a = toggleSelected(new Set<number>(), 5);
    expect([...a]).toEqual([5]);
    const b = toggleSelected(a, 5);
    expect([...b]).toEqual([]);
    // 原集不被改
    expect([...a]).toEqual([5]);
  });
});

describe("pruneSelected — 清掉已不在列表的殘留勾選", () => {
  it("翻頁/認領後,已消失列的勾選被移除", () => {
    const items = [
      { bankTransactionId: 1, amount: 10 },
      { bankTransactionId: 3, amount: 30 },
    ];
    expect([...pruneSelected(new Set([1, 2, 3]), items)].sort()).toEqual([1, 3]);
  });
});

describe("moveFocus — 鍵盤焦點邊界", () => {
  it("空列表 → -1", () => {
    expect(moveFocus(0, 1, 0)).toBe(-1);
    expect(moveFocus(-1, -1, 0)).toBe(-1);
  });
  it("無焦點:往下到 0、往上到最後一列", () => {
    expect(moveFocus(-1, 1, 5)).toBe(0);
    expect(moveFocus(-1, -1, 5)).toBe(4);
  });
  it("頭尾夾住不繞回", () => {
    expect(moveFocus(0, -1, 5)).toBe(0);
    expect(moveFocus(4, 1, 5)).toBe(4);
    expect(moveFocus(2, 1, 5)).toBe(3);
    expect(moveFocus(2, -1, 5)).toBe(1);
  });
});
