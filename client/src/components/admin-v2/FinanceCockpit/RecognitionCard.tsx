/**
 * RecognitionCard —— 待認列確認卡(F3 塊B#3,B-final 左欄第二卡)。
 *
 * 「出發了 · 訂金可認列」:trustDeferredList(pending)前端摺 foldDepartedPending
 * (與 server trustOutstandingSplit.departedPending 同口徑 —— 卡上筆數 = 真相列
 * departedPendingCount)。「認列入帳」是 Jeff 按的錢的動作,接
 * plaid.trustRecognizeNow(server 端已接 audit);AI 不自動認列。
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
            count: String(r.recognized),
            amount: fmtMoney(r.totalRecognizedAmount),
          }),
        );
      }
    },
    onError: (err) => toast.error(t("financeCockpit.work.recogToastFailed") + err.message),
  });

  const { items, total, count } = foldDepartedPending(deferred.data as any, today);

  // 0 筆(含 loading / error)不佔位 —— 空態與讀取失敗由 WorkColumn 的其它卡承載
  if (count === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
          <Check className="h-3.5 w-3.5 text-gray-400" />
          {t("financeCockpit.work.recogCardTitle")}
        </div>
        <div className="text-[11px] text-gray-500">{t("financeCockpit.work.recogCardMeta")}</div>
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
                bookingId: String(row.bookingId),
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

      {/* 認列按鈕:批次認列所有已到期(server recognizeReadyDepartures + audit) */}
      <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-4 py-2.5">
        <div className="text-[11px] text-gray-500">
          {t("financeCockpit.work.recogFooter", {
            count: String(count),
            amount: fmtMoney(total),
          })}
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
