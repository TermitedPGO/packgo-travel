/**
 * Horizontal-scroll KPI strip — Mobile Phase 1 (2026-05-22).
 *
 * Replaces the 6-card desktop grid (which on mobile wraps to 3 rows ×
 * 2 cols = 720px tall and eats the entire phone screen). One swipeable
 * row, 130w × 88h per card, scroll-snap so Jeff doesn't accidentally
 * stop between cards.
 *
 * Reads `plaid.financeKpi` (same query desktop uses) — no backend change.
 *
 * 1A0a 誠實化(U9):七個值的折 0 fallback 全部撤除 —— 查詢失敗且無快取值顯示
 * 「無法核實」整條,絕不渲染假 $0;refetch 失敗留舊值 = stale(降透明度+標記)。
 * 狀態判定復用 FinanceCockpit/cockpitMath.resolveTileState(單一定義)。
 */

import {
  Wallet,
  TrendingDown,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Lock,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { resolveTileState } from "@/components/admin-v2/FinanceCockpit/cockpitMath";
import { useLocale } from "@/contexts/LocaleContext";

const fmt = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

type KpiSpec = {
  id: string;
  label: string;
  icon: typeof Wallet;
  accent: "emerald" | "rose" | "amber" | "slate" | "indigo";
  primary: string;
  secondary?: string;
};

const accentClasses: Record<KpiSpec["accent"], string> = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
  rose: "bg-rose-50 text-rose-700 border-rose-100",
  amber: "bg-amber-50 text-amber-700 border-amber-100",
  slate: "bg-slate-50 text-slate-700 border-slate-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-100",
};

/** financeKpi 回傳中 strip 消費的欄位(寬鬆型別以吃真 tRPC row)。 */
export interface KpiStripData {
  thisMonth: { income: number; expenses: number; netProfit: number; needsReviewCount: number };
  vsLastMonthGrowthPct: number;
  ytd: { trustDeferredIncome: number; netProfit: number };
}

/** 純 fold(1A0a 可測 Seam):只有真 data 才進得來,七值直取零 fallback。 */
export function foldKpiCards(d: KpiStripData): KpiSpec[] {
  const income = Number(d.thisMonth.income);
  const expenses = Number(d.thisMonth.expenses);
  const net = Number(d.thisMonth.netProfit);
  const growth = d.vsLastMonthGrowthPct;
  const needsReviewCount = d.thisMonth.needsReviewCount;
  const trustDeferred = Number(d.ytd.trustDeferredIncome);
  const ytdNet = Number(d.ytd.netProfit);
  return [
    {
      id: "income",
      label: "本月賺",
      icon: Wallet,
      accent: growth >= 0 ? "emerald" : "rose",
      primary: fmt(income),
      secondary: growth >= 0 ? `+${growth}%` : `${growth}%`,
    },
    {
      id: "expenses",
      label: "本月付",
      icon: TrendingDown,
      accent: "rose",
      primary: fmt(expenses),
      secondary: "COGS+營運",
    },
    {
      id: "net",
      label: "本月淨",
      icon: DollarSign,
      accent: net >= 0 ? "emerald" : "rose",
      primary: fmt(net),
      secondary: net >= 0 ? "獲利" : "虧損",
    },
    {
      id: "needs-review",
      label: "待 Jeff",
      icon: AlertTriangle,
      accent: needsReviewCount > 0 ? "amber" : "slate",
      primary: String(needsReviewCount),
      secondary: needsReviewCount > 0 ? "需確認" : "已清",
    },
    {
      id: "trust",
      label: "訂金 (trust)",
      icon: Lock,
      accent: "slate",
      primary: fmt(trustDeferred),
      secondary: "出發後算",
    },
    {
      id: "ytd",
      label: "YTD 淨",
      icon: TrendingUp,
      accent: "indigo",
      primary: fmt(ytdNet),
      secondary: "2026 累計",
    },
  ];
}

export default function KpiStrip({ onSelectCard }: { onSelectCard?: (id: string) => void }) {
  const { t } = useLocale();
  const kpi = trpc.plaid.financeKpi.useQuery(undefined, { refetchInterval: 60_000 });
  const state = resolveTileState({
    isLoading: kpi.isLoading,
    isError: kpi.isError,
    hasData: kpi.data !== undefined,
  });

  if (state === "loading") {
    return (
      <div className="px-4 py-3">
        <div className="flex gap-2 overflow-hidden">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex-shrink-0 w-[130px] h-[88px] rounded-xl bg-gray-100 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (state === "transport-error") {
    // 連線失敗且無任何快取值(resolveTileState:isError && !hasData):整條無法核實,不渲染假 $0
    return (
      <div className="px-4 py-3">
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-5 text-center">
          <div className="text-xs font-semibold text-amber-700">{t("mobile.kpiUnverifiable")}</div>
          <div className="mt-1 text-[10px] text-amber-700/70">{t("mobile.kpiUnverifiableDesc")}</div>
        </div>
      </div>
    );
  }

  // 型別窄化:ready/stale 必有 data(resolveTileState 保證);防禦性守衛。
  if (kpi.data === undefined) return null;
  const cards = foldKpiCards(kpi.data);
  const isStale = state === "stale";

  return (
    <div
      className="overflow-x-auto overscroll-x-contain snap-x snap-mandatory scrollbar-hide -mx-4 px-4 py-3"
      style={{ scrollbarWidth: "none" }}
    >
      {isStale && (
        <div className="mb-1 text-[10px] text-gray-400">{t("mobile.staleNotice")}</div>
      )}
      <div className={cn("flex gap-2", isStale && "opacity-60")}>
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelectCard?.(c.id)}
              className={cn(
                "flex-shrink-0 w-[130px] h-[88px] rounded-xl border p-3 text-left snap-start active:scale-95 transition-transform",
                accentClasses[c.accent],
              )}
            >
              <div className="flex items-center gap-1 mb-1">
                <Icon className="w-3.5 h-3.5" />
                <span className="text-[10px] uppercase tracking-wider font-medium opacity-80">
                  {c.label}
                </span>
              </div>
              <div className="text-base font-bold leading-tight tabular-nums">
                {c.primary}
              </div>
              {c.secondary && (
                <div className="text-[10px] opacity-70 mt-0.5">{c.secondary}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
