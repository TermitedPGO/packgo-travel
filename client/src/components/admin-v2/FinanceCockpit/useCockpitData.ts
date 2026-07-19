/**
 * useCockpitData —— 一次接好四個真相列資料源,摺成 CockpitData 給殼與左右欄。
 *
 * 資料源(全 adminProcedure,prod 唯讀):
 *   - 現金部位   plaid.linkedAccountsList          → mask #2174 可動用餘額
 *   - 本月損益   plaid.financeKpi                  → thisMonth.netProfit / income
 *   - 待認領     bankTransactionLinks.pendingSummary → { count, totalAmount }(F3 新增唯讀)
 *   - Trust未認列 plaid.trustReconciliation         → 加總 outstanding / unmatched / balance
 *
 * 1A0a 誠實化:逐格 state + 逐源 asOf(廢頁級 max asOf 與「四錯才 error」);
 * 數字欄 state 非 ready/stale 時一律 null,禁止 `?? 0` 折疊(plan v4.3 §3.2/U1-U3)。
 * 塊B/C 不要各自重接這些 —— 吃回傳的 CockpitData。要逐筆明細再各自加自己的 query。
 */
import { trpc } from "@/lib/trpc";
import {
  selectOperatingBalance,
  aggregateTrust,
  profitMargin,
  resolveTileState,
  deriveWorkState,
} from "./cockpitMath";
import type { CockpitData } from "./types";

const OPERATING_MASK = "2174";
// 真相列一般 120s 跟其它 KPI 同步;pendingSummary 走全量 dry-run 掃描較貴,放慢到 5 分鐘。
// 注意:cockpitMath.FRESH_MAX_AGE_MS = 2×這兩個常數;改輪詢間隔必須同步改門檻。
const KPI_POLL_MS = 120_000;
const PENDING_POLL_MS = 300_000;

export function useCockpitData(): CockpitData {
  const kpi = trpc.plaid.financeKpi.useQuery(undefined, {
    refetchInterval: KPI_POLL_MS,
  });
  const accounts = trpc.plaid.linkedAccountsList.useQuery(undefined, {
    refetchInterval: KPI_POLL_MS,
  });
  const trust = trpc.plaid.trustReconciliation.useQuery(undefined, {
    refetchInterval: KPI_POLL_MS,
  });
  const pending = trpc.bankTransactionLinks.pendingSummary.useQuery(undefined, {
    refetchInterval: PENDING_POLL_MS,
    staleTime: KPI_POLL_MS,
  });

  const st = (q: { isLoading: boolean; isError: boolean; data: unknown }) =>
    resolveTileState({ isLoading: q.isLoading, isError: q.isError, hasData: q.data !== undefined });
  const asOf = (q: { dataUpdatedAt: number }) =>
    q.dataUpdatedAt > 0 ? q.dataUpdatedAt : null;

  const cash = selectOperatingBalance(accounts.data, OPERATING_MASK);
  const trustAgg = trust.data !== undefined ? aggregateTrust(trust.data) : null;
  // 數字欄:無 data 一律 null(顯示交給逐格 state),絕不 `?? 0`。
  const income = kpi.data !== undefined ? kpi.data.thisMonth.income : null;
  const netProfit = kpi.data !== undefined ? kpi.data.thisMonth.netProfit : null;

  const work = deriveWorkState(
    {
      isLoading: pending.isLoading,
      isError: pending.isError,
      hasData: pending.data !== undefined,
      dataUpdatedAt: pending.dataUpdatedAt,
      count: pending.data !== undefined ? pending.data.count : null,
    },
    {
      isLoading: trust.isLoading,
      isError: trust.isError,
      hasData: trust.data !== undefined,
      dataUpdatedAt: trust.dataUpdatedAt,
      count: trustAgg !== null ? trustAgg.departedPendingCount : null,
    },
    Date.now(),
  );

  return {
    truth: {
      cash: { state: st(accounts), balance: cash, mask: OPERATING_MASK, asOf: asOf(accounts) },
      pl: {
        state: st(kpi),
        netProfit,
        income,
        margin: income !== null && netProfit !== null ? profitMargin(income, netProfit) : null,
        asOf: asOf(kpi),
      },
      pending: {
        state: st(pending),
        count: pending.data !== undefined ? pending.data.count : null,
        total: pending.data !== undefined ? pending.data.totalAmount : null,
        asOf: asOf(pending),
      },
      trust: {
        state: st(trust),
        // 主數字 = 已對應未出發(F3 回爐 P1:B-final 定稿口徑,非全部 outstanding)
        matchedNotDeparted: trustAgg?.matchedNotDeparted ?? null,
        outstanding: trustAgg?.outstanding ?? null,
        departedPending: trustAgg?.departedPending ?? null,
        departedPendingCount: trustAgg?.departedPendingCount ?? null,
        unmatchedTotal: trustAgg?.unmatchedTotal ?? null,
        unmatchedCount: trustAgg?.unmatchedCount ?? null,
        balance: trustAgg?.balance ?? null,
        enabled: trustAgg?.enabled ?? false,
        accountMask: trustAgg?.accountMask ?? null,
        asOf: asOf(trust),
      },
    },
    work,
    isLoading: kpi.isLoading || accounts.isLoading || trust.isLoading || pending.isLoading,
    // 任一源失敗即亮頁級警示 badge(主態仍由逐格 state 呈現;廢「四錯才 error」)。
    anySourceError: kpi.isError || accounts.isError || trust.isError || pending.isError,
  };
}
