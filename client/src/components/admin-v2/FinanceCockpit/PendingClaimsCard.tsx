/**
 * PendingClaimsCard —— 待認領入帳表(F3 塊B#1,B-final 左欄第一卡)。
 *
 * 每列:日期 + #流水號 + 老化天數(>30 天紅字,dot+文字不填底)、金額(amber-700
 * 粗體)、候選 chip(引擎猜的,點選預選)、認領按鈕(開 ClaimDialog,永遠 Jeff 按)。
 * 卡頭彙總(N 筆 · 共 $X)接 pendingSummary —— 與真相列同源;表列接 listPending
 * (limit 200),列數少於總數時表尾標「僅顯示前 N 筆」。
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Check, Inbox, Info } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { agingDays, laTodayClient, fmtMoney } from "./cockpitMath";
import { ClaimDialog } from "./ClaimDialog";
import type { PendingTile } from "./types";

export interface PendingItem {
  bankTransactionId: number;
  amount: number;
  date: string;
  candidates: {
    orderId: number;
    orderNumber: string;
    title: string;
    legKind: string;
    matchedAmount: number;
  }[];
}

const AGING_RED_DAYS = 30;

function fmtShortDate(d: string): string {
  // 'YYYY-MM-DD' → 'MM/DD'(B-final .cdate)
  return `${d.slice(5, 7)}/${d.slice(8, 10)}`;
}

export function PendingClaimsCard({ pending }: { pending: PendingTile }) {
  const { t } = useLocale();
  const today = laTodayClient();
  const list = trpc.bankTransactionLinks.listPending.useQuery({ limit: 200 });

  // 每列的預選候選(點 chip = 預選;按認領帶進 dialog)
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [dialogItem, setDialogItem] = useState<PendingItem | null>(null);

  const items: PendingItem[] = list.data?.items ?? [];

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {/* 卡頭(B-final .card-h) */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
          <Inbox className="h-3.5 w-3.5 text-gray-400" />
          {t("financeCockpit.work.pendingCardTitle")}
        </div>
        <div className="text-[11px] text-gray-500">
          {pending.count > 0 ? (
            <>
              {t("financeCockpit.work.pendingCardMetaCount", { count: String(pending.count) })}{" "}
              <b className="font-semibold text-amber-700 tabular-nums">{fmtMoney(pending.total)}</b>
            </>
          ) : (
            t("financeCockpit.work.pendingCardMetaEmpty")
          )}
        </div>
      </div>

      {/* 表(B-final DataTable 高密度樣式) */}
      {list.isLoading ? (
        <div className="animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-11 border-b border-gray-50 bg-gray-50/40 last:border-0" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="px-4 py-8 text-center text-xs text-gray-400">
          {t("financeCockpit.truth.loadError")}
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-gray-400">
          {t("financeCockpit.work.pendingEmpty")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  {t("financeCockpit.work.colDate")}
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  {t("financeCockpit.work.colAmount")}
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  {t("financeCockpit.work.colTarget")}
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  {t("financeCockpit.work.colActions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const days = agingDays(item.date, today);
                const pickedId = picked[item.bankTransactionId] ?? null;
                return (
                  <tr key={item.bankTransactionId} className="border-t border-gray-100 align-middle hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800">{fmtShortDate(item.date)}</div>
                      <div className="text-[11px] text-gray-400">#{item.bankTransactionId}</div>
                      {days !== null && days > AGING_RED_DAYS && (
                        <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 tabular-nums">
                          <span className="h-[5px] w-[5px] flex-shrink-0 rounded-full bg-red-500" />
                          {t("financeCockpit.work.agingDays", { days: String(days) })}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="text-[13px] font-bold text-amber-700 tabular-nums">
                        {fmtMoney(item.amount)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {item.candidates.length === 0 && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-700">
                            <span className="h-[5px] w-[5px] rounded-full bg-current" />
                            {t("financeCockpit.work.noCandidate")}
                          </span>
                        )}
                        {item.candidates.map((c) => {
                          const sel = pickedId === c.orderId;
                          return (
                            <button
                              key={c.orderId}
                              type="button"
                              onClick={() =>
                                setPicked((prev) => ({ ...prev, [item.bankTransactionId]: c.orderId }))
                              }
                              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] transition-colors ${
                                sel
                                  ? "border-gray-900 bg-gray-900 text-white"
                                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                              }`}
                            >
                              <span className={`font-medium ${sel ? "text-white" : "text-gray-900"}`}>
                                {c.orderNumber}
                              </span>
                              {c.title}
                              {t(`financeCockpit.claim.leg_${c.legKind}` as any)}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setDialogItem(item)}
                          className="whitespace-nowrap rounded-md border border-dashed border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
                        >
                          {t("financeCockpit.work.orCategory")}
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setDialogItem(item)}
                        className={`inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors ${
                          pickedId !== null
                            ? "bg-gray-900 text-white hover:bg-gray-800"
                            : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <Check className="h-[13px] w-[13px]" />
                        {t("financeCockpit.work.actionClaim")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 表尾 note(B-final .note.top) */}
      <div className="flex gap-1.5 border-t border-gray-50 px-4 pb-3 pt-2.5 text-[10px] leading-relaxed text-gray-400">
        <Info className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-300" />
        <span>
          {t("financeCockpit.work.pendingNote")}
          {items.length > 0 && pending.count > items.length && (
            <> {t("financeCockpit.work.pendingTruncated", { shown: String(items.length) })}</>
          )}
        </span>
      </div>

      <ClaimDialog
        key={dialogItem?.bankTransactionId ?? "closed"}
        item={dialogItem}
        initialOrderId={dialogItem ? (picked[dialogItem.bankTransactionId] ?? null) : null}
        onClose={() => setDialogItem(null)}
      />
    </div>
  );
}
