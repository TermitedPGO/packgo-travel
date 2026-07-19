/**
 * AutoHandledCard —— 已自動處理卡(F3 塊B#4,B-final 左欄第三卡)。
 *
 * 「引擎本月自動對上 N 筆,共 $X」摘要 + 最近幾列。只讓 Jeff 知道引擎做了
 * 什麼,不需要他決定;要複查 / 撤銷(unlink,server 端 tRPC + audit 已建)走
 * 「對帳明細」入口(dispatch-f3 塊B#4:撤銷 UI 掛明細層,本塊先留入口)。
 */
import { trpc } from "@/lib/trpc";
import { Check, Info, ShieldCheck } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { fmtMoney, dateOnlyClient, toNum } from "./cockpitMath";

function fmtShortDate(d: string | Date | null): string {
  const s = dateOnlyClient(d);
  return s ? `${s.slice(5, 7)}/${s.slice(8, 10)}` : "—";
}

export function AutoHandledCard({ onOpenRecon }: { onOpenRecon: () => void }) {
  const { t } = useLocale();
  const auto = trpc.bankTransactionLinks.listAutoLinked.useQuery(
    { limit: 5 },
    { refetchInterval: 300_000 },
  );

  const items = auto.data?.items ?? [];
  // 1A0a(Codex 7-18 P2-4):未知態(loading/cold error)不得先報真零 —— header
  // 計數只在有 data 時顯示數字,否則「—」;stale(留舊值的 refetch 失敗)標記。
  const summary = auto.data?.summary ?? null;
  const stale = auto.isError && auto.data !== undefined;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
          <ShieldCheck className="h-3.5 w-3.5 text-gray-400" />
          {t("financeCockpit.work.autoCardTitle")}
        </div>
        <div className="text-[11px] text-gray-500">
          {stale
            ? t("financeCockpit.truth.staleHint")
            : t("financeCockpit.work.autoCardMeta", {
                count: summary !== null ? String(summary.count) : "—",
              })}
        </div>
      </div>

      {auto.isLoading ? (
        <div className="animate-pulse">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-9 border-b border-gray-50 bg-gray-50/40 last:border-0" />
          ))}
        </div>
      ) : auto.isError && auto.data === undefined ? (
        <div className="px-4 py-6 text-center text-xs text-gray-400">
          {t("financeCockpit.truth.loadError")}
        </div>
      ) : (
        <div className={stale ? "opacity-60" : ""}>
          {/* 摘要行(B-final .autosum);此分支 data 必在(cold error 已擋) */}
          <div className="flex items-start gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-600">
            <Check className="mt-0.5 h-[15px] w-[15px] flex-shrink-0 text-emerald-700" />
            <span>
              {summary !== null && summary.count > 0
                ? t("financeCockpit.work.autoSummary", {
                    count: String(summary?.count ?? 0),
                    amount: fmtMoney(summary?.totalAmount ?? 0),
                  })
                : t("financeCockpit.work.autoSummaryEmpty")}
            </span>
          </div>

          {/* 最近幾列(B-final .autorow) */}
          {items.map((row, i) => (
            <div
              key={row.linkId}
              className={`flex items-center gap-3 px-4 py-2 text-xs ${i > 0 ? "border-t border-gray-50" : ""}`}
            >
              <div className="w-[92px] flex-shrink-0 font-medium text-gray-700">
                {fmtShortDate(row.date as any)}
                <span className="ml-1 font-normal text-gray-400">#{row.bankTransactionId}</span>
              </div>
              <div className="min-w-0 flex-1 truncate text-gray-500">
                {row.orderNumber ? (
                  <>
                    <b className="font-medium text-gray-700">{row.orderNumber}</b>{" "}
                    {row.orderTitle ?? ""}
                  </>
                ) : (
                  <b className="font-medium text-gray-700">
                    {row.categoryCode ?? row.targetType}
                  </b>
                )}
              </div>
              <span className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap text-[9px] font-semibold text-gray-500">
                <span className="h-[5px] w-[5px] rounded-full bg-current" />
                {row.matchMethod}
              </span>
              <span className="flex-shrink-0 font-medium text-gray-500 tabular-nums">
                {(() => {
                  // 1A0a U8:爛值不折 0,顯示「—」
                  const a = toNum(row.amountAllocated);
                  return a !== null ? fmtMoney(a) : "—";
                })()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* note + 對帳明細入口(撤銷 unlink 的 UI 掛在明細層) */}
      <div className="flex items-center gap-1.5 border-t border-gray-50 px-4 pb-3 pt-2.5 text-[10px] leading-relaxed text-gray-400">
        <Info className="h-3 w-3 flex-shrink-0 text-gray-300" />
        <span className="flex-1">{t("financeCockpit.work.autoNote")}</span>
        <button
          type="button"
          onClick={onOpenRecon}
          className="whitespace-nowrap rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900"
        >
          {t("financeCockpit.work.autoReviewLink")}
        </button>
      </div>
    </div>
  );
}
