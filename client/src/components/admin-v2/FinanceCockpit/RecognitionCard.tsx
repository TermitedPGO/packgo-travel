/**
 * RecognitionCard —— 到期待審卡(F3 塊B#3,B-final 左欄第二卡)。
 *
 * B1 fail-closed(2026-07-12):「出發了 · 訂金到期待審」。trustDeferredList
 * (pending)前端摺 foldDepartedPending(與 server trustOutstandingSplit.
 * departedPending 同口徑 —— 卡上筆數 = 真相列 departedPendingCount)。按鈕接
 * plaid.trustRecognizeNow —— 現為**唯讀掃描**(零寫入,server 端接 audit),
 * 只列出到期待審;認列是 Jeff 的動錢權,等 CPA 認列矩陣核准後逐筆核。
 * 0 筆時整卡隱藏(空態由 WorkColumn 統一顯示)。
 */
import { trpc } from "@/lib/trpc";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { foldDepartedPending, laTodayClient, fmtMoney } from "./cockpitMath";

function fmtShortDate(d: string | null): string {
  return d ? `${d.slice(5, 7)}/${d.slice(8, 10)}` : "—";
}

export function RecognitionCard() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const today = laTodayClient();

  const deferred = trpc.plaid.trustDeferredList.useQuery(
    { status: "pending", limit: 200 },
    { refetchInterval: 120_000 },
  );

  const recognize = trpc.plaid.trustRecognizeNow.useMutation({
    onSuccess: (r) => {
      utils.plaid.trustDeferredList.invalidate();
      utils.plaid.trustReconciliation.invalidate();
      utils.plaid.financeKpi.invalidate();
      if ("error" in r && r.error) {
        toast.error(String(r.error));
      } else {
        toast.success(
          t("financeCockpit.work.recogToastDone", {
            count: String(r.dueForReview),
          }),
        );
      }
    },
    onError: (err) => toast.error(t("financeCockpit.work.recogToastFailed") + err.message),
  });

  const { items, total, count } = foldDepartedPending(deferred.data as any, today);

  // 1A0a U7:讀取失敗且無任何快取值 → 顯性「無法核實」,不再靜默消失。
  if (deferred.isError && deferred.data === undefined) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="px-4 py-4 text-center text-xs text-gray-400">
          {t("financeCockpit.work.recogLoadError")}
        </div>
      </div>
    );
  }

  // cached refetch 失敗 = stale(顯舊列+標記,Codex 7-18 P1-6/P2-1:stale 判定在
  // count===0 return 之前,避免 stale 訊號被空態吞掉)
  const stale = deferred.isError && deferred.data !== undefined;

  // 真零且非 stale(有資料且 0 筆)或首載中不佔位 —— 空態由 WorkColumn 的 allClear 承載
  if (count === 0 && !stale) return null;
  // stale 但本頁 0 筆:顯最小 stale 提示卡(不靜默消失)
  if (count === 0 && stale) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="px-4 py-4 text-center text-xs text-amber-700">
          {t("financeCockpit.truth.staleHint")}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
          <Check className="h-3.5 w-3.5 text-gray-400" />
          {t("financeCockpit.work.recogCardTitle")}
        </div>
        <div className="text-[11px] text-gray-500">
          {stale ? t("financeCockpit.truth.staleHint") : t("financeCockpit.work.recogCardMeta")}
        </div>
      </div>

      {items.map((row, i) => (
        <div
          key={row.id}
          className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}
        >
          <span className="h-[7px] w-[7px] flex-shrink-0 rounded-full bg-red-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-gray-900">
              {t("financeCockpit.work.recogLine1", {
                // 塊C:join 名稱補齊(客人名+團名);沒有才 fallback Booking #id
                name:
                  [row.customerName, row.tourTitle].filter(Boolean).join(" ") ||
                  t("financeCockpit.ledger.trustBooking", { id: String(row.bookingId) }),
                date: fmtShortDate(row.recognitionDate),
              })}{" "}
              <b className="font-bold text-amber-700 tabular-nums">{fmtMoney(row.amount)}</b>{" "}
              {t("financeCockpit.work.recogLine1Suffix")}
            </div>
            <div className="mt-0.5 text-[11px] text-gray-400">
              {t("financeCockpit.work.recogLine2", { amount: fmtMoney(row.amount) })}
            </div>
          </div>
        </div>
      ))}

      {/* 掃描按鈕:唯讀掃描所有到期待審(server scanRecognitionDue + audit,零寫入) */}
      <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-4 py-2.5">
        <div className="text-[11px] text-gray-500">
          {t("financeCockpit.work.recogFooter", {
            count: String(count),
            amount: fmtMoney(total),
          })}
          {/* limit 200 天花板:來源截斷時誠實標注(P3 回爐 #3) */}
          {(deferred.data?.length ?? 0) >= 200 && (
            <> {t("financeCockpit.ledger.listTruncated", { limit: "200" })}</>
          )}
        </div>
        <button
          type="button"
          disabled={recognize.isPending}
          onClick={() => recognize.mutate()}
          className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-gray-900 px-3 text-xs font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
        >
          {recognize.isPending ? (
            <Loader2 className="h-[13px] w-[13px] animate-spin" />
          ) : (
            <Check className="h-[13px] w-[13px]" />
          )}
          {t("financeCockpit.work.recogAction")}
        </button>
      </div>
    </div>
  );
}
