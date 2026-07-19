/**
 * financeConsumersRender —— 1A0a R4/item5 承重 render 測試(Codex 7-18 固定窄修 5)。
 *
 * Codex 點名「零直接 render 測試」的 8 個 consumer 在此實際 renderToStaticMarkup,
 * 各至少鎖 cold-error + 一個以上其他態(stale / true-zero);BankTriage 另鎖
 * cached-stale 禁寫(banner + 按鈕 disabled)。刪對應分支斷言會紅。
 *
 * 可配置 trpc mock:模組級 Q 由每個 test 前設定;render 同步,單線程安全。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

// SSR(node env)無 window:BankTriagePage 的 useState 初值讀 window.location。
(globalThis as any).window = {
  location: { href: "http://localhost/" },
  history: { replaceState: () => {} },
  matchMedia: () => ({ matches: false }),
};

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (k: string, v?: Record<string, string>) => (v ? `${k}[${Object.values(v).join(",")}]` : k),
    language: "zh-TW",
  }),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {}, info: () => {} } }));

// Radix Tabs 只渲染 active TabsContent(SSR 亦然),AccountingTab 四張表分屬
// 非預設 tab —— 為了讓 per-tab 表格的 loading/stale/empty 分支能被靜態 render
// 承重,把 Tabs 換成「全部展開」的透明容器(受測物是表格分支邏輯,不是 Radix)。
// 本檔僅 AccountingTab 使用 ui/tabs(已核對),不影響其他 consumer 測試。
vi.mock("@/components/ui/tabs", () => ({
  Tabs: (p: { children?: unknown }) => createElement("div", null, p.children as any),
  TabsContent: (p: { children?: unknown }) => createElement("div", null, p.children as any),
  TabsList: (p: { children?: unknown }) => createElement("div", null, p.children as any),
  TabsTrigger: (p: { children?: unknown }) => createElement("button", { type: "button" }, p.children as any),
}));

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
const COLD: Q = {
  data: undefined, isLoading: false, isError: true, dataUpdatedAt: 0,
  hasNextPage: false, fetchNextPage: () => {}, isFetchingNextPage: false, refetch: () => {},
};
const LOADING: Q = { ...COLD, isError: false, isLoading: true };
let Q_STATE: Q = { ...COLD };
function setQ(over: Partial<Q>) { Q_STATE = { ...COLD, ...over }; }

/**
 * 1A0a(Codex 7-18 15:56 P1-3):per-procedure 狀態表 —— 多 query 頁
 * (AccountingTab / DailyCheckMobile / TaxDetail)的 shape 互斥由「逐 procedure
 * 給正確 shape」解掉,不再以單一共用 mock 的結構限制為由保留 stale/zero 殘留。
 * value 可為 Q 或 (input)=>Q(同 procedure 不同 input,如 TaxDetail cur/prev 兩個
 * profitLossReport)。未登記的 procedure 落回 Q_STATE(既有測試不受影響)。
 */
const Q_BY_PATH = new Map<string, Q | ((input: unknown) => Q)>();
function setQPath(path: string, q: Partial<Q> | ((input: unknown) => Q)) {
  Q_BY_PATH.set(path, typeof q === "function" ? q : { ...COLD, ...q });
}
function resolveQ(path: string, input: unknown): Q {
  const hit = Q_BY_PATH.get(path);
  if (!hit) return Q_STATE;
  return typeof hit === "function" ? hit(input) : hit;
}

vi.mock("@/lib/trpc", () => {
  const mutationResult = { mutate: () => {}, mutateAsync: async () => ({}), isPending: false, isError: false };
  const make = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get(_t, prop) {
        if (typeof prop !== "string") return undefined;
        if (prop === "useQuery" || prop === "useInfiniteQuery")
          return (input: unknown) => resolveQ(path.join("."), input);
        if (prop === "useMutation") return () => mutationResult;
        if (prop === "useUtils") return () => make([]);
        if (prop === "invalidate" || prop === "setInfiniteData") return () => {};
        return make([...path, prop]);
      },
      apply() { return undefined; },
    });
  return { trpc: make([]) };
});

const { RecognitionCard } = await import("./FinanceCockpit/RecognitionCard");
const { AutoHandledCard } = await import("./FinanceCockpit/AutoHandledCard");
const { default: PendingClaimsTab } = await import("../admin/PendingClaimsTab");
const { default: LedgerTrust } = await import("../workspace/LedgerTrust");
const { default: LedgerTriage } = await import("../workspace/LedgerTriage");
const { default: BankTriagePage } = await import("../mobile/BankTriagePage");
const { default: DailyCheckMobile } = await import("../mobile/DailyCheckMobile");
const { default: FinanceDashboard } = await import("./CommandCenter/FinanceDashboard");
const { default: BankLedgerV2 } = await import("./BankLedgerV2");
const { default: AccountingTab } = await import("../admin/AccountingTab");
const { TaxDetail } = await import("./FinanceCockpit/TaxDetail");
const { default: ProfitLossV2 } = await import("./ProfitLossV2");

beforeEach(() => { setQ(COLD); Q_BY_PATH.clear(); });
const el = (C: any, p: any = {}) => renderToStaticMarkup(createElement(C, p));

/** plaid.profitLossReport 完整 shape(真零)。 */
const PL_ZERO = {
  transactionCount: 0,
  income: { total: 0, byCategory: {} as Record<string, number> },
  expenses: { total: 0, cogs: 0, operating: 0, byCategory: {} as Record<string, number> },
  grossProfit: 0, netProfit: 0, profitMargin: 0, refunds: 0, trustDeferredIncome: 0,
  transfer: { total: 0, count: 0 }, stripePayout: { total: 0, count: 0 }, squarePayout: { total: 0, count: 0 },
  needsReviewAmount: 0, needsReviewCount: 0, excludedFromAccounting: 0,
};
const PL_NONZERO = {
  ...PL_ZERO,
  transactionCount: 5,
  income: { total: 1000, byCategory: { income_booking: 1000 } },
  grossProfit: 900, netProfit: 800, profitMargin: 80,
};
/** plaid.financeKpi 完整 shape(真零;KpiStrip 消費)。 */
const KPI_ZERO = {
  thisMonth: { income: 0, expenses: 0, netProfit: 0, needsReviewCount: 0 },
  vsLastMonthGrowthPct: 0,
  ytd: { trustDeferredIncome: 0, netProfit: 0 },
};

describe("RecognitionCard — cold / stale / true-zero", () => {
  it("cold-error → recogLoadError", () => {
    setQ(COLD);
    expect(el(RecognitionCard)).toContain("financeCockpit.work.recogLoadError");
  });
  it("true-zero(空清單)→ 不佔位(空 render)", () => {
    setQ({ isError: false, data: [], dataUpdatedAt: 1 });
    expect(el(RecognitionCard)).toBe("");
  });
  it("cached-stale(空+error)→ staleHint,不消失", () => {
    setQ({ isError: true, data: [], dataUpdatedAt: 1 });
    expect(el(RecognitionCard)).toContain("financeCockpit.truth.staleHint");
  });
});

describe("AutoHandledCard — cold / stale / true-zero", () => {
  it("cold-error → loadError", () => {
    setQ(COLD);
    expect(el(AutoHandledCard, { onOpenRecon: () => {} })).toContain("financeCockpit.truth.loadError");
  });
  it("true-zero → autoSummaryEmpty,不出 $0", () => {
    setQ({ isError: false, dataUpdatedAt: 1, data: { items: [], summary: { count: 0, totalAmount: 0 } } });
    const html = el(AutoHandledCard, { onOpenRecon: () => {} });
    expect(html).toContain("financeCockpit.work.autoSummaryEmpty");
    expect(html).not.toContain("$0");
  });
  it("cached-stale(有快取+error)→ staleHint(header 不報真零)", () => {
    setQ({ isError: true, dataUpdatedAt: 1, data: { items: [], summary: { count: 2, totalAmount: 100 } } });
    expect(el(AutoHandledCard, { onOpenRecon: () => {} })).toContain("financeCockpit.truth.staleHint");
  });
});

describe("PendingClaimsTab — cold / stale / true-zero", () => {
  it("cold-error → loadFailed 列", () => {
    setQ(COLD);
    expect(el(PendingClaimsTab)).toContain("pendingClaimsTab.loadFailed");
  });
  it("cached-stale(有快取 + refetch 失敗)→ staleHint 列", () => {
    setQ({ isError: true, dataUpdatedAt: 1, data: { items: [] } });
    const html = el(PendingClaimsTab);
    expect(html).toContain("financeCockpit.truth.staleHint");
  });
  it("true-zero(成功空)→ emptyList,非錯誤", () => {
    setQ({ isError: false, dataUpdatedAt: 1, data: { items: [] } });
    const html = el(PendingClaimsTab);
    expect(html).toContain("pendingClaimsTab.emptyList");
    expect(html).not.toContain("pendingClaimsTab.loadFailed");
  });
});

describe("LedgerTrust — cold / loading", () => {
  it("cold-error → ldgLoadFailed", () => {
    setQ(COLD);
    expect(el(LedgerTrust)).toContain("workspace.ldgLoadFailed");
  });
  it("loading(無快取)→ 顯骨架(animate-pulse),不畫空殼", () => {
    setQ(LOADING);
    expect(el(LedgerTrust)).toContain("animate-pulse");
  });
  it("cached-stale → ldgStaleNotice", () => {
    setQ({ isError: true, dataUpdatedAt: 1, data: [] });
    expect(el(LedgerTrust)).toContain("workspace.ldgStaleNotice");
  });
  it("true-zero(三 query 成功回無帳戶)→ 無錯屏/骨架/stale(空帳戶列表)", () => {
    setQ({ isError: false, isLoading: false, dataUpdatedAt: 1, data: [] });
    const html = el(LedgerTrust);
    expect(html).not.toContain("workspace.ldgLoadFailed");
    expect(html).not.toContain("workspace.ldgStaleNotice");
    expect(html).not.toContain("animate-pulse");
  });
});

describe("LedgerTriage — cold / stale / true-zero", () => {
  it("cold-error → ldgLoadFailed", () => {
    setQ(COLD);
    expect(el(LedgerTriage)).toContain("workspace.ldgLoadFailed");
  });
  it("cached-stale → ldgStaleNotice", () => {
    setQ({ isError: true, dataUpdatedAt: 1, data: { items: [] } });
    expect(el(LedgerTriage)).toContain("workspace.ldgStaleNotice");
  });
  it("true-zero → ldgTriageEmpty;副標 n 為 0(非「–」)", () => {
    setQ({ isError: false, dataUpdatedAt: 1, data: { items: [] } });
    const html = el(LedgerTriage);
    expect(html).toContain("workspace.ldgTriageEmpty");
    expect(html).toContain("workspace.ldgTriageSub[0]");
  });
  it("未取得(cold)→ 副標 n 顯「–」不報 0", () => {
    setQ(COLD);
    expect(el(LedgerTriage)).toContain("workspace.ldgTriageSub[–]");
  });
});

describe("BankTriagePage — cold / cached-stale 禁寫", () => {
  it("cold-error → txnsUnverifiable", () => {
    setQ(COLD);
    expect(el(BankTriagePage, { onExit: () => {} })).toContain("mobile.txnsUnverifiable");
  });
  it("cached-stale(有 current)→ staleWriteBlocked banner;寫入鈕/pill disabled、跳過鈕 enabled", () => {
    // 有一筆需分類的交易(cached)+ refetch 失敗 = stale;current 存在
    setQ({
      isError: true, dataUpdatedAt: 1,
      data: { items: [{ id: 1, date: "2026-07-01", amount: 100, agentCategory: "other_review", excludeFromAccounting: 0 }] },
    });
    const html = el(BankTriagePage, { onExit: () => {} });
    expect(html).toContain("mobile.staleWriteBlocked");
    // 收緊:寫入路徑元素各自 disabled —— 8 個改類別 pill + 排除個人 + 確認 AI = ≥10
    const disabledCount = (html.match(/disabled=""/g) || []).length;
    expect(disabledCount).toBeGreaterThanOrEqual(10);
    // 「跳過」是 advance(非寫入),必須仍可按 —— 該按鈕存在
    expect(html).toContain("跳過");
  });
  it("true-zero(成功且無待分類)→ 顯「全部清完」,非 stale/error", () => {
    setQ({ isError: false, dataUpdatedAt: 1, data: { items: [] } });
    const html = el(BankTriagePage, { onExit: () => {} });
    expect(html).toContain("全部清完");
    expect(html).not.toContain("mobile.staleWriteBlocked");
    expect(html).not.toContain("mobile.txnsUnverifiable");
  });
});

describe("DailyCheckMobile — cold / stale / true-zero(per-procedure,殘留清除)", () => {
  // 舊「單一共用 mock shape 互斥」殘留已由 per-procedure 狀態表解掉
  // (Codex 7-18 15:56 P1-3):activity=agent.listMessages(陣列)、
  // txns=plaid.transactionsList({items})、KpiStrip=plaid.financeKpi(KPI shape)。
  const dailyShapes = () => {
    setQPath("agent.listMessages", { isError: false, dataUpdatedAt: 1, data: [] });
    setQPath("plaid.transactionsList", { isError: false, dataUpdatedAt: 1, data: { items: [] } });
    setQPath("plaid.financeKpi", { isError: false, dataUpdatedAt: 1, data: KPI_ZERO });
  };
  const REVIEW_TX = { id: 1, amount: 100, agentCategory: "other_review", excludeFromAccounting: 0 };

  it("cold-error(交易未取得)→ reviewPileUnverifiable,按鈕顯「– 筆」不寫「0 筆」", () => {
    setQ(COLD);
    const html = el(DailyCheckMobile, { onNavigate: () => {} });
    expect(html).toContain("mobile.reviewPileUnverifiable");
    expect(html).toContain("– 筆");
    expect(html).not.toContain(">0 筆");
  });
  it("true-zero(三 query 成功、pile 空)→ activityEmpty + 按鈕「0 筆」,無 stale/unverifiable", () => {
    dailyShapes();
    const html = el(DailyCheckMobile, { onNavigate: () => {} });
    expect(html).toContain("mobile.activityEmpty");
    expect(html).toContain("0 筆");
    expect(html).not.toContain("mobile.reviewPileUnverifiable");
    expect(html).not.toContain("mobile.staleNotice");
  });
  it("txns cached-stale(有快取列 + refetch 失敗)→ staleNotice + 保留 review pile(不丟舊值)", () => {
    dailyShapes();
    setQPath("plaid.transactionsList", { isError: true, dataUpdatedAt: 1, data: { items: [REVIEW_TX] } });
    const html = el(DailyCheckMobile, { onNavigate: () => {} });
    expect(html).toContain("mobile.staleNotice");
    expect(html).toContain("需要你決定");
    expect(html).not.toContain("mobile.reviewPileUnverifiable");
  });
  it("activity cached-stale(有快取列)→ staleNotice badge + 保留 cached rows(不整段丟棄)", () => {
    dailyShapes();
    setQPath("agent.listMessages", {
      isError: true, dataUpdatedAt: 1,
      data: [{ id: 1, createdAt: new Date().toISOString(), agentName: "gmail", message: "已寄出回覆" }],
    });
    const html = el(DailyCheckMobile, { onNavigate: () => {} });
    expect(html).toContain("mobile.staleNotice");
    expect(html).toContain("#gmail");
    expect(html).toContain("已寄出回覆");
  });
});

describe("FinanceDashboard — 停用卡 render", () => {
  it("render 顯 finBlockedTitle(稅 CSV/AI 顧問撤除)", () => {
    setQ({ isError: false, data: {}, dataUpdatedAt: 1 });
    expect(el(FinanceDashboard)).toContain("admin.commandCenter.finBlockedTitle");
  });
});

describe("BankLedgerV2 — cached-empty stale(Codex 7-18 15:56 P1-1)", () => {
  it("counts 全顯「–」不報 0;不落 clean EmptyState/『暫無資料』;只顯 stale(不冒充 cold error)", () => {
    setQ({ isError: true, dataUpdatedAt: 1, data: { items: [] } });
    const html = el(BankLedgerV2);
    expect(html).toContain("financeCockpit.truth.staleHint");
    // 不得同時給 clean 空態(EmptyState 標題或 DataTable 預設「暫無資料」),
    // 也不得把 stale 冒充成 cold loadFailed(態別誠實)
    expect(html).not.toContain("admin.bankLedgerTab.emptyTitle");
    expect(html).not.toContain("暫無資料");
    expect(html).not.toContain("admin.bankLedgerTab.loadFailed");
    // 五個 filter pill 全「–」:StatusToggle 數字 span 不得出現 0
    const dashCount = (html.match(/–/g) || []).length;
    expect(dashCount).toBeGreaterThanOrEqual(5);
    expect(html).not.toMatch(/tabular-nums[^"]*">0</);
  });
  it("loading(無快取)→ counts 同樣「–」不報 0,無 clean 空態(未知 ≠ 零)", () => {
    setQ({ isError: false, isLoading: true });
    const html = el(BankLedgerV2);
    const dashCount = (html.match(/–/g) || []).length;
    expect(dashCount).toBeGreaterThanOrEqual(5);
    expect(html).not.toMatch(/tabular-nums[^"]*">0</);
    expect(html).not.toContain("暫無資料");
    expect(html).not.toContain("admin.bankLedgerTab.emptyTitle");
  });
  it("true-zero(成功空)對照組:EmptyState 出現、無 stale;counts 顯真 0 非「–」(雙向分離)", () => {
    setQ({ isError: false, dataUpdatedAt: 1, data: { items: [] } });
    const html = el(BankLedgerV2);
    expect(html).toContain("admin.bankLedgerTab.emptyTitle");
    expect(html).not.toContain("financeCockpit.truth.staleHint");
    // 真零必須顯 0:「counts 永遠顯–」的突變在此紅
    expect(html).toMatch(/tabular-nums[^"]*">0</);
  });
});

describe("AccountingTab — stale / true-zero(per-procedure,殘留清除)", () => {
  // 舊「多 query shape 互斥 + Radix Tabs SSR」殘留已由 per-procedure 狀態表解掉
  // (Codex 7-18 15:56 P1-3):P&L 物件 / trend 陣列 / pending count 物件逐一給對。
  const acctShapes = () => {
    setQPath("plaid.profitLossReport", { isError: false, dataUpdatedAt: 1, data: PL_ZERO });
    setQPath("plaid.profitLossTrend", { isError: false, dataUpdatedAt: 1, data: [] });
    setQPath("accounting.list", { isError: false, dataUpdatedAt: 1, data: { entries: [] } });
    setQPath("invoices.list", { isError: false, dataUpdatedAt: 1, data: [] });
    setQPath("recurringExpenses.list", { isError: false, dataUpdatedAt: 1, data: [] });
    setQPath("accounting.pendingExpenses.list", { isError: false, dataUpdatedAt: 1, data: { rows: [] } });
    setQPath("accounting.pendingExpenses.count", { isError: false, dataUpdatedAt: 1, data: { pending: 0 } });
    setQPath("globalSearch.search", { isError: false, dataUpdatedAt: 1, data: { bookings: [] } });
    setQPath("accounting.exportCsv", { isError: false, dataUpdatedAt: 1, data: "" });
  };

  it("true-zero(全 query 成功、全空)→ 顯真零(沒有趨勢資料),無 stale/unverifiable", () => {
    acctShapes();
    const html = el(AccountingTab);
    expect(html).toContain("沒有趨勢資料");
    expect(html).not.toContain("financeCockpit.truth.staleHint");
    expect(html).not.toContain("admin.accounting.plUnverifiable");
  });
  it("plTrend cached-empty stale → staleHint,不得畫 clean『沒有趨勢資料』(15:56 P1-2);panel 不冒充 cold loadFailed", () => {
    acctShapes();
    setQPath("plaid.profitLossTrend", { isError: true, dataUpdatedAt: 1, data: [] });
    const html = el(AccountingTab);
    expect(html).toContain("financeCockpit.truth.staleHint");
    expect(html).not.toContain("沒有趨勢資料");
    // panel 級態別誠實:stale 不得被替換成 cold error 文案(頁級 banner 餵不飽此斷言)
    expect(html).not.toContain("admin.trustCompliance.loadFailed");
  });
  it("plTrend loading → 骨架(animate-pulse),不得畫『沒有趨勢資料』(13:48 P1-3 原病灶回歸鎖)", () => {
    acctShapes();
    setQPath("plaid.profitLossTrend", { isError: false, isLoading: true, data: undefined });
    const html = el(AccountingTab);
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("沒有趨勢資料");
  });
  it("P&L cached-stale(有快取 + refetch 失敗)→ staleHint,不整區換錯誤", () => {
    acctShapes();
    setQPath("plaid.profitLossReport", { isError: true, dataUpdatedAt: 1, data: PL_NONZERO });
    const html = el(AccountingTab);
    expect(html).toContain("financeCockpit.truth.staleHint");
    expect(html).not.toContain("admin.accounting.plUnverifiable");
  });
  it("四表(pending/entries/invoices/recurring)cached-empty stale → 各自 staleHint 列,不落 clean empty(移除任一表 stale 分支必紅)", () => {
    acctShapes();
    setQPath("accounting.pendingExpenses.list", { isError: true, dataUpdatedAt: 1, data: { rows: [] } });
    setQPath("accounting.list", { isError: true, dataUpdatedAt: 1, data: { entries: [] } });
    setQPath("invoices.list", { isError: true, dataUpdatedAt: 1, data: [] });
    setQPath("recurringExpenses.list", { isError: true, dataUpdatedAt: 1, data: [] });
    const html = el(AccountingTab);
    // 四表各一列 staleHint(Radix Tabs SSR 全渲染,逐表計數承重)
    const staleCount = (html.match(/financeCockpit\.truth\.staleHint/g) || []).length;
    expect(staleCount).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain("admin.accounting.emptyEntries");
    expect(html).not.toContain("admin.accounting.emptyInvoices");
    expect(html).not.toContain("admin.accounting.emptyRecurring");
  });
});

describe("TaxDetail — stale / true-zero(per-procedure,殘留清除)", () => {
  const YEAR = String(new Date().getFullYear());
  // cur/prev 同 procedure 不同 input:startDate 落在本年 = cur,否則 prev。
  const setTaxPL = (cur: Partial<Q>, prev: Partial<Q>) => {
    const curQ: Q = { ...COLD, ...cur };
    const prevQ: Q = { ...COLD, ...prev };
    setQPath("plaid.profitLossReport", (input: unknown) => {
      const start = String((input as { startDate?: string } | undefined)?.startDate ?? "");
      return start.startsWith(YEAR) ? curQ : prevQ;
    });
  };
  const taxShapes = () => {
    setTaxPL(
      { isError: false, dataUpdatedAt: 1, data: PL_ZERO },
      { isError: false, dataUpdatedAt: 1, data: PL_ZERO },
    );
    setQPath("plaid.trustReconciliation", { isError: false, dataUpdatedAt: 1, data: [] });
    setQPath("plaid.trustDeferredList", { isError: false, dataUpdatedAt: 1, data: [] });
  };

  it("true-zero(四 query 成功、全零)→ 顯真 $0,無 loadError/staleHint", () => {
    taxShapes();
    const html = el(TaxDetail);
    expect(html).toContain("$0");
    expect(html).not.toContain("financeCockpit.truth.loadError");
    expect(html).not.toContain("financeCockpit.truth.staleHint");
  });
  it("cur cached-stale(有快取 + refetch 失敗)→ 顯舊值 + staleHint,不換 loadError", () => {
    taxShapes();
    setTaxPL(
      { isError: true, dataUpdatedAt: 1, data: PL_NONZERO },
      { isError: false, dataUpdatedAt: 1, data: PL_ZERO },
    );
    const html = el(TaxDetail);
    expect(html).toContain("financeCockpit.truth.staleHint");
    expect(html).not.toContain("financeCockpit.truth.loadError");
  });
  it("prev cached-stale → prevUnverifiable,不得把 stale 前期當 current 算 growth(15:56 窄修4)", () => {
    taxShapes();
    setTaxPL(
      { isError: false, dataUpdatedAt: 1, data: PL_NONZERO },
      { isError: true, dataUpdatedAt: 1, data: PL_NONZERO },
    );
    const html = el(TaxDetail);
    expect(html).toContain("financeCockpit.tax.prevUnverifiable");
    expect(html).not.toContain("financeCockpit.tax.kpiVsPrev");
  });
});

describe("ProfitLossV2 — stale / true-zero(cold 見 financePagesRender)", () => {
  it("cached-stale(有快取 + refetch 失敗)→ staleHint,不換 loadFailed", () => {
    setQPath("plaid.profitLossReport", { isError: true, dataUpdatedAt: 1, data: PL_NONZERO });
    const html = el(ProfitLossV2);
    expect(html).toContain("financeCockpit.truth.staleHint");
    expect(html).not.toContain("admin.profitLoss.loadFailed");
  });
  it("true-zero(成功、$0 期)→ 顯真 $0,無 loadFailed/staleHint", () => {
    setQPath("plaid.profitLossReport", { isError: false, dataUpdatedAt: 1, data: PL_ZERO });
    const html = el(ProfitLossV2);
    expect(html).toContain("$0");
    expect(html).not.toContain("admin.profitLoss.loadFailed");
    expect(html).not.toContain("financeCockpit.truth.staleHint");
  });
});
