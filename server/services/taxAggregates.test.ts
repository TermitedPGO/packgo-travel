/**
 * taxAggregates 測試 —— F3 塊D 回爐 #1(指揮總驗收回令:兩個新唯讀 procedure
 * 的核心邏輯補專屬單測)。
 */
import { describe, it, expect } from "vitest";
import {
  monthlyTrendWindows,
  foldVendor1099,
  type Vendor1099RowLike,
} from "./taxAggregates";

describe("monthlyTrendWindows — 月度趨勢期間窗", () => {
  const TODAY = "2026-07-10";

  it("當年:止於本月,當月 endDate = 今天(不含未來月)", () => {
    const w = monthlyTrendWindows(2026, TODAY);
    expect(w).toHaveLength(7);
    expect(w[0]).toEqual({ month: 1, startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(w[6]).toEqual({ month: 7, startDate: "2026-07-01", endDate: "2026-07-10" });
  });

  it("過去年:12 個月全出,每月 endDate 是該月最後一天", () => {
    const w = monthlyTrendWindows(2025, TODAY);
    expect(w).toHaveLength(12);
    expect(w[11]).toEqual({ month: 12, startDate: "2025-12-01", endDate: "2025-12-31" });
  });

  it("未來年:空(不編造未來月)", () => {
    expect(monthlyTrendWindows(2027, TODAY)).toEqual([]);
  });

  it("月界天數:2 月閏年 29 天、平年 28 天;4 月 30 天", () => {
    const w24 = monthlyTrendWindows(2024, TODAY);
    expect(w24[1].endDate).toBe("2024-02-29"); // 閏年
    const w25 = monthlyTrendWindows(2025, TODAY);
    expect(w25[1].endDate).toBe("2025-02-28"); // 平年
    expect(w25[3].endDate).toBe("2025-04-30");
  });

  it("當年 1 月時只出 1 個月(下界)", () => {
    const w = monthlyTrendWindows(2026, "2026-01-05");
    expect(w).toHaveLength(1);
    expect(w[0]).toEqual({ month: 1, startDate: "2026-01-01", endDate: "2026-01-05" });
  });
});

describe("foldVendor1099 — 1099-NEC 候選彙總", () => {
  const row = (over: Partial<Vendor1099RowLike>): Vendor1099RowLike => ({
    counterparty: "Lion Travel",
    merchantName: null,
    amount: "700.00",
    agentCategory: "cogs_tour",
    jeffOverrideCategory: null,
    ...over,
  });

  it("jeffOverride 優先:agent=cogs_tour 但 Jeff 改別類 → 不算;agent=別類但 Jeff 改 cogs_tour → 算", () => {
    const out = foldVendor1099([
      row({ jeffOverrideCategory: "expense_office" }), // Jeff 說不是供應商成本
      row({ counterparty: "Kuoni", agentCategory: "other_review", jeffOverrideCategory: "cogs_tour", amount: "900.00" }),
    ]);
    expect(out).toEqual([{ counterparty: "Kuoni", total: 900 }]);
  });

  it("amt <= 0 跳過(毛額語義:入帳 / 供應商退款不淨扣)", () => {
    const out = foldVendor1099([
      row({ amount: "700.00" }),
      row({ amount: "-200.00" }), // 供應商退款,不淨扣
      row({ amount: "0" }),
    ]);
    expect(out).toEqual([{ counterparty: "Lion Travel", total: 700 }]);
  });

  it(">= $600 門檻邊界:600.00 含、599.99 不含(含跨筆累計過線)", () => {
    const out = foldVendor1099([
      row({ counterparty: "At Threshold", amount: "600.00" }),
      row({ counterparty: "Below", amount: "599.99" }),
      row({ counterparty: "Accumulates", amount: "300.00" }),
      row({ counterparty: "Accumulates", amount: "300.00" }), // 兩筆合計 600 過線
    ]);
    expect(out.map((v) => v.counterparty).sort()).toEqual(["Accumulates", "At Threshold"]);
    expect(out.find((v) => v.counterparty === "At Threshold")?.total).toBe(600);
  });

  it("名稱 fallback 鏈:counterparty → merchantName → 空名跳過", () => {
    const out = foldVendor1099([
      row({ counterparty: null, merchantName: "Merchant Fallback", amount: "800.00" }),
      row({ counterparty: "  ", merchantName: null, amount: "900.00" }), // 空白名跳過
      row({ counterparty: null, merchantName: null, amount: "900.00" }), // 全空跳過
    ]);
    expect(out).toEqual([{ counterparty: "Merchant Fallback", total: 800 }]);
  });

  it("金額大到小排序 + 分位四捨五入", () => {
    const out = foldVendor1099([
      row({ counterparty: "A", amount: "600.005" }),
      row({ counterparty: "B", amount: "1200.00" }),
    ]);
    expect(out.map((v) => v.counterparty)).toEqual(["B", "A"]);
    expect(out[1].total).toBe(600.01);
  });
});
