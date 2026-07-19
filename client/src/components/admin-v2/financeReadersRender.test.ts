/**
 * financeReadersRender —— 1A0a R4 承重 render 測試(Codex 7-18 R4)。
 *
 * Codex 點名「零直接 render 測試」的 production 元件在此實際 renderToStaticMarkup,
 * 讓 error/stale/zero 分支變承重:刪掉某元件的 transport-error/stale JSX 分支,
 * 對應斷言會紅(突變抽核意圖)。
 *
 * 可配置 trpc mock:模組級 Q 由每個 test 前設定;render 同步,故單線程安全。
 * node env + createElement(.test.ts 不做 JSX transform)。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({ t: (k: string, v?: Record<string, string>) => (v ? `${k}[${Object.values(v).join(",")}]` : k), language: "zh-TW" }),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {}, info: () => {} } }));

// 可配置 query 狀態:所有 useQuery/useInfiniteQuery 回這個 live 物件。
type Q = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
  refetch: () => void;
};
const COLD_ERROR: Q = {
  data: undefined, isLoading: false, isError: true, dataUpdatedAt: 0,
  hasNextPage: false, fetchNextPage: () => {}, isFetchingNextPage: false, refetch: () => {},
};
let Q_STATE: Q = { ...COLD_ERROR };
function setQ(over: Partial<Q>) {
  Q_STATE = { ...COLD_ERROR, ...over };
}

vi.mock("@/lib/trpc", () => {
  const mutationResult = { mutate: () => {}, mutateAsync: async () => ({}), isPending: false, isError: false };
  const make = (): unknown =>
    new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "useQuery" || prop === "useInfiniteQuery") return () => Q_STATE;
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

const { default: BankLedgerV2 } = await import("./BankLedgerV2");
const { default: AccountingTab } = await import("../admin/AccountingTab");
const { default: TrustComplianceV2 } = await import("./TrustComplianceV2");
const { TrustCard } = await import("./FinanceCockpit/TrustCard");
const { PendingClaimsCard } = await import("./FinanceCockpit/PendingClaimsCard");
const { PLCard } = await import("./FinanceCockpit/PLCard");
const { default: KpiStrip } = await import("../mobile/KpiStrip");
import type { PendingTile, TrustTile } from "./FinanceCockpit/types";

beforeEach(() => setQ(COLD_ERROR));

/** 冷錯誤 render 不得出現任何 $0 金額(核心不變式)。 */
function noFakeZero(html: string) {
  expect(html).not.toContain("$0");
}

describe("BankLedgerV2 — cold / stale / true-zero 承重 render", () => {
  it("cold-error:主 list 顯 loadFailed,不出 $0", () => {
    setQ(COLD_ERROR);
    const html = renderToStaticMarkup(createElement(BankLedgerV2));
    expect(html).toContain("admin.bankLedgerTab.loadFailed");
    noFakeZero(html);
  });
  it("cached-stale(有快取列 + refetch 失敗)→ stale banner,filter count 仍為快取值非「–」", () => {
    setQ({ isError: true, dataUpdatedAt: 1, data: { items: [
      { id: 1, amount: 100, agentCategory: null, excludeFromAccounting: 0, isPending: 0 },
    ] } });
    const html = renderToStaticMarkup(createElement(BankLedgerV2));
    expect(html).toContain("financeCockpit.truth.staleHint");
    // 標題宣稱的承重斷言:cached-nonempty stale 沿用快取 counts(all=1),不顯「–」
    expect(html).toMatch(/tabular-nums[^"]*">1</);
    expect(html).not.toContain("–");
  });
  it("true-zero(成功空)→ EmptyState(emptyTitle),不出 loadFailed/stale", () => {
    setQ({ isError: false, dataUpdatedAt: 1, data: { items: [] } });
    const html = renderToStaticMarkup(createElement(BankLedgerV2));
    expect(html).toContain("admin.bankLedgerTab.emptyTitle");
    expect(html).not.toContain("admin.bankLedgerTab.loadFailed");
    expect(html).not.toContain("financeCockpit.truth.staleHint");
  });
  it("cold-error:filter count 顯「–」不報 0", () => {
    setQ(COLD_ERROR);
    const html = renderToStaticMarkup(createElement(BankLedgerV2));
    expect(html).toContain("–");
    expect(html).not.toMatch(/tabular-nums[^"]*">0</);
  });
  it("loading:filter count 顯「–」不報 0(未知 ≠ 零;loading 腿突變必紅)", () => {
    setQ({ data: undefined, isLoading: true, isError: false, dataUpdatedAt: 0 });
    const html = renderToStaticMarkup(createElement(BankLedgerV2));
    expect(html).toContain("–");
    expect(html).not.toMatch(/tabular-nums[^"]*">0</);
  });
});

describe("AccountingTab — cold-error 承重 render", () => {
  // 本檔的單一共用 mock 只跑 cold-error(全 query 同態安全);stale / true-zero
  // 三態已由 financeConsumersRender.test.ts 的 per-procedure 狀態表補齊
  // (15:56 P1-3 —— 逐 procedure 給正確 shape,舊「shape 互斥」殘留已清零)。
  it("cold-error:P&L 區顯專屬 plUnverifiable(刪 banner 必紅),不出 $0", () => {
    setQ(COLD_ERROR);
    const html = renderToStaticMarkup(createElement(AccountingTab));
    expect(html).toContain("admin.accounting.plUnverifiable");
    noFakeZero(html);
  });
});

describe("TrustComplianceV2 — cached-stale / true-zero 頁級承重 render", () => {
  const acctRow = {
    id: 1, accountName: "Trust", institutionName: "BofA", accountMask: "5442",
    enabled: true, outstandingTotal: 0, balance: 0, unmatchedTotal: 0, unmatchedCount: 0, drift: 0,
  };
  it("cached-stale(recon isError 但有快取列)→ 顯 staleHint,不出假勾稽乾淨錯亂", () => {
    // recon/deferred/audit 共用 Q:回快取陣列 + isError → stale 標記
    setQ({ isError: true, dataUpdatedAt: 1, data: [acctRow] });
    const html = renderToStaticMarkup(createElement(TrustComplianceV2));
    expect(html).toContain("financeCockpit.truth.staleHint");
  });
  it("true-zero(recon 成功回無帳戶)→ noAccounts,非錯誤、非 stale", () => {
    setQ({ isError: false, dataUpdatedAt: 1, data: [] });
    const html = renderToStaticMarkup(createElement(TrustComplianceV2));
    expect(html).toContain("admin.trustCompliance.noAccounts");
    expect(html).not.toContain("admin.trustCompliance.loadFailed");
  });
});

describe("PLCard — cold-error / true-zero 承重 render", () => {
  it("冷錯誤顯無法核實,不出 $0", () => {
    setQ(COLD_ERROR);
    const html = renderToStaticMarkup(createElement(PLCard));
    expect(html).toContain("financeCockpit.truth.loadError");
    noFakeZero(html);
  });
  it("cached-stale(有快取 + refetch 失敗)→ 顯舊值 opacity + staleHint(不整卡換錯誤)", () => {
    setQ({ isError: true, dataUpdatedAt: 1, data: {
      transactionCount: 5,
      income: { total: 1000, byCategory: { income_booking: 1000 } },
      expenses: { total: 200, cogs: 100, operating: 100, byCategory: {} },
      grossProfit: 900, netProfit: 800, profitMargin: 80, refunds: 0, trustDeferredIncome: 0,
      transfer: { total: 0, count: 0 }, stripePayout: { total: 0, count: 0 }, squarePayout: { total: 0, count: 0 },
      needsReviewAmount: 0, needsReviewCount: 0, excludedFromAccounting: 0,
    } });
    const html = renderToStaticMarkup(createElement(PLCard));
    expect(html).toContain("financeCockpit.truth.staleHint");
    expect(html).not.toContain("financeCockpit.truth.loadError");
  });
  it("true-zero($0 月:transactionCount===0)→ 顯零月態 plEmptyNote,非錯誤", () => {
    // profitLossReport 成功且 transactionCount===0:isZeroMonth 分支($0 為真零,合法)
    setQ({
      isError: false,
      dataUpdatedAt: 1,
      data: {
        transactionCount: 0,
        income: { total: 0, byCategory: {} },
        expenses: { total: 0, cogs: 0, operating: 0, byCategory: {} },
        grossProfit: 0,
        netProfit: 0,
        profitMargin: 0,
        refunds: 0,
        trustDeferredIncome: 0,
        transfer: { total: 0, count: 0 },
        stripePayout: { total: 0, count: 0 },
        squarePayout: { total: 0, count: 0 },
        needsReviewAmount: 0,
        needsReviewCount: 0,
        excludedFromAccounting: 0,
      },
    });
    const html = renderToStaticMarkup(createElement(PLCard));
    expect(html).not.toContain("financeCockpit.truth.loadError");
    expect(html).toContain("financeCockpit.ledger.plEmptyNote");
  });
});

describe("TrustCard — cold-error / stale / true-zero(prop 驅動)", () => {
  const zero: TrustTile = {
    state: "ready", matchedNotDeparted: 0, outstanding: 0, departedPending: 0,
    departedPendingCount: 0, unmatchedTotal: 0, unmatchedCount: 0, balance: 0,
    enabled: true, accountMask: "5442", asOf: 1,
  };
  it("tile transport-error → 無法核實,不出 $0", () => {
    setQ({ data: [], isError: false });
    const html = renderToStaticMarkup(createElement(TrustCard, { trust: { ...zero, state: "transport-error", balance: null, outstanding: null, matchedNotDeparted: null } }));
    expect(html).toContain("financeCockpit.truth.loadError");
  });
  it("true-zero(enabled 全 0)→ trustEmpty,非錯誤", () => {
    setQ({ data: [], isError: false });
    const html = renderToStaticMarkup(createElement(TrustCard, { trust: zero }));
    expect(html).toContain("financeCockpit.ledger.trustEmpty");
    expect(html).not.toContain("financeCockpit.truth.loadError");
  });
  it("tile state=transport-error 但數字全非 null → 仍走無法核實(獨立釘 state token)", () => {
    setQ({ data: [], isError: false });
    // n 全非 null(zero 全 0);只有 state 是 transport-error → 刪條件裡的 state token 會使此測試紅
    const html = renderToStaticMarkup(createElement(TrustCard, { trust: { ...zero, state: "transport-error" } }));
    expect(html).toContain("financeCockpit.truth.loadError");
  });
  it("cached-stale(tile state=stale,數字非 null)→ 卡頭顯 staleHint(保留舊值,不換錯誤)", () => {
    setQ({ data: [], isError: false });
    const html = renderToStaticMarkup(
      createElement(TrustCard, { trust: { ...zero, matchedNotDeparted: 500, outstanding: 500, state: "stale" } }),
    );
    expect(html).toContain("financeCockpit.truth.staleHint");
    expect(html).not.toContain("financeCockpit.truth.loadError");
  });
  it("明細 cold-error(deferred 失敗)→ 明細無法核實,不安靜省略", () => {
    setQ(COLD_ERROR); // deferred query 冷錯誤
    const html = renderToStaticMarkup(createElement(TrustCard, { trust: zero }));
    expect(html).toContain("financeCockpit.ledger.trustDetailLoadFailed");
  });
});

describe("PendingClaimsCard — cold-error / true-zero(pending prop + list query)", () => {
  const zeroPending: PendingTile = { state: "ready", count: 0, total: 0, asOf: 1 };
  it("list 冷錯誤 → loadFailed 列,不出 $0", () => {
    setQ(COLD_ERROR);
    const html = renderToStaticMarkup(createElement(PendingClaimsCard, { pending: zeroPending }));
    expect(html).toContain("financeCockpit.truth.loadError");
    noFakeZero(html);
  });
  it("true-zero(list 成功空 + pending count 0)→ 空態 pendingEmpty,非錯誤", () => {
    setQ({ isError: false, dataUpdatedAt: 1, data: { pages: [{ items: [], nextCursor: null }], pageParams: [undefined] } });
    const html = renderToStaticMarkup(createElement(PendingClaimsCard, { pending: zeroPending }));
    expect(html).not.toContain("financeCockpit.truth.loadError");
    expect(html).toContain("financeCockpit.work.pendingEmpty");
  });
  it("header count===null(count query 失敗)→ 顯無法核實而非隱藏", () => {
    setQ({ isError: false, dataUpdatedAt: 1, data: { pages: [{ items: [], nextCursor: null }], pageParams: [undefined] } });
    const html = renderToStaticMarkup(
      createElement(PendingClaimsCard, { pending: { state: "transport-error", count: null, total: null, asOf: null } }),
    );
    expect(html).toContain("financeCockpit.truth.loadError");
  });
  it("cached-stale(有快取列 + refetch 失敗)→ 保留舊列 + 表首 staleHint,不換 cold loadError", () => {
    setQ({
      isError: true, dataUpdatedAt: 1,
      data: { pages: [{ items: [{ id: 1, bankTransactionId: 9, amount: "100.00", date: "2026-07-01", description: "x", merchantName: null, candidates: [] }], nextCursor: null }], pageParams: [undefined] },
    });
    const html = renderToStaticMarkup(createElement(PendingClaimsCard, { pending: zeroPending }));
    expect(html).toContain("financeCockpit.truth.staleHint");
    // 冷 loadError 只在 data===undefined:此處有快取 → 不得整表換錯誤頁
    expect(html).not.toContain("px-4 py-8 text-center text-xs text-gray-400");
  });
});

describe("KpiStrip — cold-error / true-zero / stale 承重 render", () => {
  const zeroData = {
    thisMonth: { income: 0, expenses: 0, netProfit: 0, needsReviewCount: 0 },
    vsLastMonthGrowthPct: 0,
    ytd: { trustDeferredIncome: 0, netProfit: 0 },
  };
  it("冷錯誤 → 無法核實整條,不出 $0", () => {
    setQ(COLD_ERROR);
    const html = renderToStaticMarkup(createElement(KpiStrip, {}));
    expect(html).toContain("mobile.kpiUnverifiable");
    noFakeZero(html);
  });
  it("true-zero → 顯 $0(真零應顯,非隱藏)", () => {
    setQ({ data: zeroData, isError: false, dataUpdatedAt: 1 });
    const html = renderToStaticMarkup(createElement(KpiStrip, {}));
    expect(html).toContain("$0");
    expect(html).not.toContain("mobile.kpiUnverifiable");
  });
  it("cached-stale(留舊值 refetch 失敗)→ 顯舊值 + staleNotice", () => {
    setQ({ data: { thisMonth: { income: 111, expenses: 0, netProfit: 111, needsReviewCount: 0 }, vsLastMonthGrowthPct: 0, ytd: { trustDeferredIncome: 0, netProfit: 0 } }, isError: true, dataUpdatedAt: 1 });
    const html = renderToStaticMarkup(createElement(KpiStrip, {}));
    expect(html).toContain("mobile.staleNotice");
    expect(html).toContain("$111");
  });
});
