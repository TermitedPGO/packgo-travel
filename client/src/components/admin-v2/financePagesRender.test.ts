/**
 * financePagesRender —— 1A0a 財務頁 error/stale/zero render 斷言(plan v4.3 §3.3)。
 *
 * repo 慣例 seam:node env + renderToStaticMarkup + mocked hook(無 jsdom/
 * Testing Library 依賴;先例 customerRowLayout.test.ts)。t() mock 成 key 恆等,
 * 斷言以 i18n key 出現與否為準。
 *
 * 覆蓋:
 * - TruthRow:transport-error 顯「無法核實」不顯 $0;stale 顯舊值+staleHint;
 *   true-zero 顯空態 hint;逐格 as-of。
 * - WorkColumn:任一源 transport-error → sourceErrorTitle(絕不綠勾);
 *   兩源 ready+真零 → emptyTitle 綠勾;count null → 「—」。
 */
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// vitest esbuild 對 .tsx 走 classic JSX transform(引用自由變數 React);
// app 端 vite react plugin 走 automatic runtime。此 seam 補 global,元件經
// 動態 import 於 global 就緒後載入。
(globalThis as { React?: typeof React }).React = React;

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    // key 恆等+插值串接:斷言可同時檢查 key 與帶入的值(如 count "—")
    t: (k: string, v?: Record<string, string>) =>
      v ? `${k}[${Object.values(v).join(",")}]` : k,
    language: "zh-TW",
  }),
}));

vi.mock("@/lib/trpc", () => {
  const queryResult = {
    data: undefined,
    isLoading: false,
    isError: true,
    dataUpdatedAt: 0,
    hasNextPage: false,
    fetchNextPage: () => {},
    isFetchingNextPage: false,
  };
  const mutationResult = {
    mutate: () => {},
    mutateAsync: async () => ({}),
    isPending: false,
  };
  const make = (): unknown =>
    new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "useQuery" || prop === "useInfiniteQuery") return () => queryResult;
        if (prop === "useMutation") return () => mutationResult;
        if (prop === "useUtils") return () => make();
        if (prop === "invalidate") return () => {};
        return make();
      },
      apply() {
        return undefined;
      },
    });
  return { trpc: make() };
});

const { TruthRow } = await import("./FinanceCockpit/TruthRow");
const { WorkColumn } = await import("./FinanceCockpit/WorkColumn");
const { TaxDetail } = await import("./FinanceCockpit/TaxDetail");
const { default: TrustComplianceV2 } = await import("./TrustComplianceV2");
const { default: ProfitLossV2 } = await import("./ProfitLossV2");
import type { CockpitData, TruthRowData } from "./FinanceCockpit/types";

const ASOF = 1_800_000_000_000;

function truth(over: Partial<TruthRowData> = {}): TruthRowData {
  const base: TruthRowData = {
    cash: { state: "ready", balance: 12300, mask: "2174", asOf: ASOF },
    pl: { state: "ready", netProfit: 100, income: 1000, margin: 10, asOf: ASOF },
    pending: { state: "ready", count: 0, total: 0, asOf: ASOF },
    trust: {
      state: "ready",
      matchedNotDeparted: 0,
      outstanding: 0,
      departedPending: 0,
      departedPendingCount: 0,
      unmatchedTotal: 0,
      unmatchedCount: 0,
      balance: 0,
      enabled: true,
      accountMask: "5442",
      asOf: ASOF,
    },
  };
  return { ...base, ...over };
}

function cockpit(over: Partial<CockpitData> = {}): CockpitData {
  return {
    truth: truth(),
    work: {
      pending: { state: "ready", count: 0 },
      recog: { state: "ready", count: 0 },
    },
    isLoading: false,
    anySourceError: false,
    ...over,
  };
}

describe("TruthRow — 逐格 error/stale/zero", () => {
  it("transport-error 格顯「無法核實」,不渲染任何 $ 數字", () => {
    const html = renderToStaticMarkup(
      createElement(TruthRow, {
        truth: truth({
          pl: { state: "transport-error", netProfit: null, income: null, margin: null, asOf: null },
        }),
      }),
    );
    expect(html).toContain("financeCockpit.truth.loadError");
    expect(html).not.toContain("+$0");
    expect(html).not.toContain("−$0");
  });

  it("stale 格照常顯上次數字+staleHint", () => {
    const html = renderToStaticMarkup(
      createElement(TruthRow, {
        truth: truth({
          pl: { state: "stale", netProfit: 100, income: 1000, margin: 10, asOf: ASOF },
        }),
      }),
    );
    expect(html).toContain("+$100");
    expect(html).toContain("financeCockpit.truth.staleHint");
  });

  it("true-zero(pending 0 筆)顯空態 hint,非錯誤", () => {
    const html = renderToStaticMarkup(createElement(TruthRow, { truth: truth() }));
    expect(html).toContain("financeCockpit.truth.pendingHintEmpty");
    expect(html).not.toContain("financeCockpit.truth.loadError");
  });

  it("逐格 as-of 標示(廢頁級單一時間戳)", () => {
    const html = renderToStaticMarkup(createElement(TruthRow, { truth: truth() }));
    expect(html).toContain("financeCockpit.truth.asOfLabel");
  });
});

describe("WorkColumn — allClear 三態", () => {
  it("任一源 transport-error → sourceErrorTitle,絕不綠勾 emptyTitle", () => {
    const html = renderToStaticMarkup(
      createElement(WorkColumn, {
        data: cockpit({
          work: {
            pending: { state: "transport-error", count: null },
            recog: { state: "ready", count: 0 },
          },
        }),
        onOpenRecon: () => {},
      }),
    );
    expect(html).toContain("financeCockpit.work.sourceErrorTitle");
    expect(html).not.toContain("financeCockpit.work.emptyTitle");
  });

  it("兩源 ready+真零 → emptyTitle 綠勾", () => {
    const html = renderToStaticMarkup(
      createElement(WorkColumn, { data: cockpit(), onOpenRecon: () => {} }),
    );
    expect(html).toContain("financeCockpit.work.emptyTitle");
  });

  it("count null 顯「—」不顯 0", () => {
    const html = renderToStaticMarkup(
      createElement(WorkColumn, {
        data: cockpit({
          work: {
            pending: { state: "stale", count: null },
            recog: { state: "ready", count: 0 },
          },
        }),
        onOpenRecon: () => {},
      }),
    );
    expect(html).toContain("financeCockpit.work.countPendingNum[—]");
    expect(html).not.toContain("financeCockpit.work.countPendingNum[0]");
  });
});

// 全域 trpc mock(上方)所有 useQuery 回 isError:true / data:undefined = cold error。
// 這組 render production 元件的冷錯誤分支:斷言無假 $0、有錯誤文案。
describe("production 元件 cold-error render(Codex 7-18 P1-7/R4)", () => {
  it("TaxDetail 冷錯誤:KPI 不出 $0,顯無法核實 + 停用卡", () => {
    const html = renderToStaticMarkup(createElement(TaxDetail));
    expect(html).toContain("financeCockpit.truth.loadError");
    expect(html).toContain("financeCockpit.tax.blockedTitle");
    // 冷載/錯誤期間不得出現任何 $0 金額
    expect(html).not.toContain("$0");
  });

  it("TrustComplianceV2 冷錯誤:頁首/KPI 不出假 $0 或假勾稽,顯 loadFailed", () => {
    const html = renderToStaticMarkup(createElement(TrustComplianceV2));
    expect(html).toContain("admin.trustCompliance.loadFailed");
    expect(html).not.toContain("$0");
    expect(html).not.toContain("admin.trustCompliance.driftClean");
  });

  it("ProfitLossV2 冷錯誤:顯 loadFailed,不渲染 $0 KPI", () => {
    const html = renderToStaticMarkup(createElement(ProfitLossV2));
    expect(html).toContain("admin.profitLoss.loadFailed");
    expect(html).not.toContain("$0");
  });
});
