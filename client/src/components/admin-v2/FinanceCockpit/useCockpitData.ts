/**
 * useCockpitData —— 一次接好四個真相列資料源,摺成 CockpitData 給殼與左右欄。
 *
 * 資料源(全 adminProcedure,prod 唯讀):
 *   - 現金部位   plaid.linkedAccountsList          → mask #2174 可動用餘額
 *   - 本月損益   plaid.financeKpi                  → thisMonth.netProfit / income
 *   - 待認領     bankTransactionLinks.pendingSummary → { count, totalAmount }(F3 新增唯讀)
 *   - Trust未認列 plaid.trustReconciliation         → 加總 outstanding / unmatched / balance
 *
 * 塊B/C 不要各自重接這些 —— 吃回傳的 CockpitData。要逐筆明細再各自加自己的 query。
 */
import { trpc } from "@/lib/trpc";
import {
  selectOperatingBalance,
  aggregateTrust,
  profitMargin,
  resolveTileState,
} from "./cockpitMath";
import type { CockpitData } from "./types";

const OPERATING_MASK = "2174";
// 真相列一般 120s 跟其它 KPI 同步;pendingSummary 走全量 dry-run 掃描較貴,放慢到 5 分鐘。
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

  const cash = selectOperatingBalance(accounts.data, OPERATING_MASK);
  const trustAgg = aggregateTrust(trust.data);
  const income = kpi.data?.thisMonth.income ?? 0;
  const netProfit = kpi.data?.thisMonth.netProfit ?? 0;

  const st = (q: { isLoading: boolean; isError: boolean; data: unknown }) =>
    resolveTileState({ isLoading: q.isLoading, isError: q.isError, hasData: q.data !== undefined });

  const asOfCandidates = [
    kpi.dataUpdatedAt,
    accounts.dataUpdatedAt,
    trust.dataUpdatedAt,
    pending.dataUpdatedAt,
  ].filter((n): n is number => typeof n === "number" && n > 0);

  return {
    truth: {
      cash: { state: st(accounts), balance: cash, mask: OPERATING_MASK },
      pl: { state: st(kpi), netProfit, income, margin: profitMargin(income, netProfit) },
      pending: {
        state: st(pending),
        count: pending.data?.count ?? 0,
        total: pending.data?.totalAmount ?? 0,
      },
      trust: {
        state: st(trust),
        // 主數字 = 已對應未出發(F3 回爐 P1:B-final 定稿口徑,非全部 outstanding)
        matchedNotDeparted: trustAgg.matchedNotDeparted,
        outstanding: trustAgg.outstanding,
        departedPending: trustAgg.departedPending,
        departedPendingCount: trustAgg.departedPendingCount,
        unmatchedTotal: trustAgg.unmatchedTotal,
        unmatchedCount: trustAgg.unmatchedCount,
        balance: trustAgg.balance,
        enabled: trustAgg.enabled,
        accountMask: trustAgg.accountMask,
      },
    },
    counts: {
      pendingCount: pending.data?.count ?? 0,
      departedPendingCount: trustAgg.departedPendingCount,
    },
    asOf: asOfCandidates.length ? Math.max(...asOfCandidates) : null,
    // 頁級 loading:任一還在首載;頁級 error:全部都錯(單格錯走各格 fail-open)。
    isLoading: kpi.isLoading || accounts.isLoading || trust.isLoading || pending.isLoading,
    isError: kpi.isError && accounts.isError && trust.isError && pending.isError,
  };
}
