/**
 * kpiStripState —— 1A0a mobile KPI strip 七值折疊(plan v4.3 §3.2.1/U9)。
 *
 * 契約:七個值(income/expenses/net/growth/needsReviewCount/trustDeferred/
 * ytdNet)只在真 data 存在時折出卡片;查詢失敗且無快取值時 strip 顯示
 * 「無法核實」整條(render 層,由 resolveTileState 折 transport-error),
 * 絕不渲染 `?? 0` 假 $0。
 */
import { describe, expect, it } from "vitest";
import { foldKpiCards, type KpiStripData } from "./KpiStrip";
import { resolveTileState } from "@/components/admin-v2/FinanceCockpit/cockpitMath";

const DATA: KpiStripData = {
  thisMonth: { income: 12345, expenses: 2345, netProfit: 10000, needsReviewCount: 2 },
  vsLastMonthGrowthPct: -12,
  ytd: { trustDeferredIncome: 5000, netProfit: 34567 },
};

describe("foldKpiCards — 七值直取,零 fallback", () => {
  it("七值進六卡(ytdNet 為第七值,v3 漏列的 kpi.ytd.netProfit)", () => {
    const cards = foldKpiCards(DATA);
    expect(cards.map((c) => c.id)).toEqual([
      "income", "expenses", "net", "needs-review", "trust", "ytd",
    ]);
    expect(cards.find((c) => c.id === "income")!.primary).toBe("$12,345");
    expect(cards.find((c) => c.id === "net")!.primary).toBe("$10,000");
    expect(cards.find((c) => c.id === "needs-review")!.primary).toBe("2");
    expect(cards.find((c) => c.id === "trust")!.primary).toBe("$5,000");
    expect(cards.find((c) => c.id === "ytd")!.primary).toBe("$34,567");
  });

  it("負成長顯示負號、負淨利顯示虧損", () => {
    const cards = foldKpiCards({
      ...DATA,
      thisMonth: { ...DATA.thisMonth, netProfit: -500 },
    });
    expect(cards.find((c) => c.id === "income")!.secondary).toBe("-12%");
    expect(cards.find((c) => c.id === "net")!.secondary).toBe("虧損");
  });
});

describe("strip 狀態(resolveTileState 單一定義)", () => {
  it("失敗且無快取值 → transport-error(render 層顯示無法核實,不出 $0)", () => {
    expect(resolveTileState({ isLoading: false, isError: true, hasData: false })).toBe(
      "transport-error",
    );
  });
  it("失敗但留舊值 → stale(顯示舊值+標記)", () => {
    expect(resolveTileState({ isLoading: false, isError: true, hasData: true })).toBe("stale");
  });
});
