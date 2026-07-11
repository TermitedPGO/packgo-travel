/**
 * PendingClaimsCard —— 待認領入帳表(F3 塊B#1,B-final 左欄第一卡;
 * F-workbench 2026-07-11 升級成「敢清 322 筆」的工作台)。
 *
 * 每列:勾選框 + 日期 + #流水號 + 老化天數(>30 天紅字,dot+文字不填底)、金額
 * (amber-700 粗體)、候選 chip(引擎猜的,點選預選)、認領按鈕(開 ClaimDialog,
 * 永遠 Jeff 按)。卡頭彙總(N 筆 · 共 $X)接 pendingSummary —— 與真相列同源。
 *
 * F-workbench 三件事:
 *   1. 破 200 天花板:listPending 改 useInfiniteQuery(keyset 游標),表尾
 *      「載入更多」推進掃描窗;已載入 / 總數誠實顯示。
 *   2. 批次認領:勾選多筆 → 批次歸同一內部分類(batchClaim,server 逐筆稽核);
 *      仍是 Jeff 手動勾選親自按,AI 不動錢。鍵盤流:↑↓ 移動、空白鍵勾選、
 *      Enter 開認領 dialog;ClaimDialog 記上次選的類別。
 *   3. 認領後不全量重抓:本地 cache 手術(setInfiniteData 移除該列 +
 *      pendingSummary setData 遞減),不 invalidate 觸發 ≤200 次 dry-run +
 *      全量掃描;server 端 Redis 快取已主動失效,下一輪 5 分鐘 poll 自然對真。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Check, Inbox, Info, Loader2 } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { agingDays, laTodayClient, fmtMoney } from "./cockpitMath";
import { ClaimDialog } from "./ClaimDialog";
import { CLAIM_CATEGORIES, CLAIM_CATEGORY_LABEL_KEY, type ClaimCategory } from "./claimCategories";
import {
  flattenPages,
  sumSelectedAmount,
  toggleSelected,
  pruneSelected,
  moveFocus,
} from "./pendingClaimsHelpers";
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
const PAGE_SIZE = 200;
/** listPending infinite query 的穩定 input(cursor 由 react-query 管)。 */
const LIST_INPUT = { limit: PAGE_SIZE } as const;

function fmtShortDate(d: string): string {
  // 'YYYY-MM-DD' → 'MM/DD'(B-final .cdate)
  return `${d.slice(5, 7)}/${d.slice(8, 10)}`;
}

export function PendingClaimsCard({ pending }: { pending: PendingTile }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const today = laTodayClient();

  const list = trpc.bankTransactionLinks.listPending.useInfiniteQuery(LIST_INPUT, {
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // 每列的預選候選(點 chip = 預選;按認領帶進 dialog)
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [dialogItem, setDialogItem] = useState<PendingItem | null>(null);
  // 批次勾選 + 批次歸類類別 + ClaimDialog 類別記憶(記上次選擇)
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchCategory, setBatchCategory] = useState<ClaimCategory | "">("");
  const [lastCategory, setLastCategory] = useState<ClaimCategory | null>(null);
  // 鍵盤焦點列(-1 = 無)
  const [focusIdx, setFocusIdx] = useState(-1);
  const tableRef = useRef<HTMLDivElement>(null);

  const items: PendingItem[] = useMemo(
    () => flattenPages<PendingItem>(list.data?.pages),
    [list.data?.pages],
  );

  // 列表變動(翻頁 / 認領移除)後清掉已消失列的殘留勾選與焦點
  useEffect(() => {
    setSelected((prev) => pruneSelected(prev, items));
    setFocusIdx((prev) => (prev >= items.length ? items.length - 1 : prev));
  }, [items]);

  /* ── 認領後本地 cache 手術(取代全量 invalidate-refetch)────────────── */

  /** 從 listPending 快取移除(或減額)一列 + pendingSummary 遞減。 */
  const applyClaimedLocally = (claims: { bankTransactionId: number; amount: number }[]) => {
    if (claims.length === 0) return;
    const byId = new Map(claims.map((c) => [c.bankTransactionId, c.amount]));
    let fullyRemoved = 0;
    let totalClaimed = 0;
    utils.bankTransactionLinks.listPending.setInfiniteData(LIST_INPUT, (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          items: p.items
            .map((it) => {
              const claimed = byId.get(it.bankTransactionId);
              if (claimed === undefined) return it;
              totalClaimed += claimed;
              const remaining = Math.round((it.amount - claimed) * 100) / 100;
              if (remaining <= 0.01) {
                fullyRemoved++;
                return null; // 認滿 → 整列移除
              }
              return { ...it, amount: remaining }; // 部分認領 → 顯示剩餘
            })
            .filter((it): it is NonNullable<typeof it> => it !== null),
        })),
      };
    });
    // 真相列彙總同步遞減(server Redis 快取已失效,下一輪 poll 對真)
    utils.bankTransactionLinks.pendingSummary.setData(undefined, (old) =>
      old
        ? {
            count: Math.max(0, old.count - fullyRemoved),
            totalAmount: Math.max(0, Math.round((old.totalAmount - totalClaimed) * 100) / 100),
          }
        : old,
    );
  };

  /* ── 批次認領(Jeff 勾選 + 親自按;server 逐筆稽核)──────────────────── */

  const batchClaim = trpc.bankTransactionLinks.batchClaim.useMutation({
    onSuccess: (out, vars) => {
      const okIds = new Set(out.results.filter((r) => r.ok).map((r) => r.bankTransactionId));
      applyClaimedLocally(
        vars.items
          .filter((i) => okIds.has(i.bankTransactionId))
          .map((i) => ({ bankTransactionId: i.bankTransactionId, amount: i.amountAllocated })),
      );
      const firstError = out.results.find((r) => !r.ok)?.error;
      // 失敗筆保留勾選讓 Jeff 重試;成功筆的勾選由 pruneSelected 自動清
      if (out.failCount === 0) {
        toast.success(t("financeCockpit.work.batchToastDone", { count: String(out.successCount) }));
        setSelected(new Set());
      } else if (out.successCount > 0) {
        toast.warning(
          t("financeCockpit.work.batchToastPartial", {
            ok: String(out.successCount),
            fail: String(out.failCount),
          }) + (firstError ? ` — ${firstError}` : ""),
        );
      } else {
        toast.error(
          t("financeCockpit.work.batchToastAllFailed") + (firstError ? ` — ${firstError}` : ""),
        );
      }
    },
    onError: (err) => toast.error(t("financeCockpit.claim.toastFailed") + err.message),
  });

  const selectedAmount = sumSelectedAmount(items, selected);

  const submitBatch = () => {
    if (!batchCategory || selected.size === 0 || batchClaim.isPending) return;
    setLastCategory(batchCategory);
    batchClaim.mutate({
      items: items
        .filter((it) => selected.has(it.bankTransactionId))
        .map((it) => ({
          bankTransactionId: it.bankTransactionId,
          targetType: "category" as const,
          categoryCode: batchCategory,
          amountAllocated: it.amount,
        })),
    });
  };

  /* ── 鍵盤流:↑↓ 移動、空白鍵勾選、Enter 開認領 dialog ────────────────── */

  const onTableKeyDown = (e: React.KeyboardEvent) => {
    if (dialogItem) return; // dialog 開著時不搶鍵盤
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((prev) => moveFocus(prev, e.key === "ArrowDown" ? 1 : -1, items.length));
    } else if (e.key === " " && focusIdx >= 0 && focusIdx < items.length) {
      e.preventDefault();
      setSelected((prev) => toggleSelected(prev, items[focusIdx].bankTransactionId));
    } else if (e.key === "Enter" && focusIdx >= 0 && focusIdx < items.length) {
      e.preventDefault();
      setDialogItem(items[focusIdx]);
    }
  };

  const allOnPageSelected = items.length > 0 && items.every((it) => selected.has(it.bankTransactionId));
  const toggleAll = () => {
    setSelected(allOnPageSelected ? new Set() : new Set(items.map((it) => it.bankTransactionId)));
  };

  const checkboxCls =
    "h-3.5 w-3.5 cursor-pointer rounded-sm border-gray-300 accent-gray-900 align-middle";

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

      {/* 批次列(有勾選才顯示):同類多筆一次認領,Jeff 親自按 */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
          <span className="text-[11px] font-semibold text-gray-700 tabular-nums">
            {t("financeCockpit.work.batchSelected", {
              count: String(selected.size),
              amount: fmtMoney(selectedAmount),
            })}
          </span>
          <span className="text-[11px] text-gray-400">{t("financeCockpit.work.batchCategoryLabel")}</span>
          <Select
            value={batchCategory}
            onValueChange={(v) => setBatchCategory(v as ClaimCategory)}
          >
            <SelectTrigger className="h-7 w-[180px] rounded-lg bg-white text-xs">
              <SelectValue placeholder={t("financeCockpit.claim.categoryPlaceholder")} />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {CLAIM_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c} className="rounded-lg text-xs">
                  {t(CLAIM_CATEGORY_LABEL_KEY[c])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            disabled={!batchCategory || batchClaim.isPending}
            onClick={submitBatch}
            className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg bg-gray-900 px-3 text-xs font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {batchClaim.isPending ? (
              <Loader2 className="h-[13px] w-[13px] animate-spin" />
            ) : (
              <Check className="h-[13px] w-[13px]" />
            )}
            {t("financeCockpit.work.batchClaimAction")}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="h-7 rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
          >
            {t("financeCockpit.work.batchClear")}
          </button>
        </div>
      )}

      {/* 表(B-final DataTable 高密度樣式;容器收鍵盤事件) */}
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
        <div
          ref={tableRef}
          tabIndex={0}
          onKeyDown={onTableKeyDown}
          className="overflow-x-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-gray-300"
        >
          <table className="w-full border-collapse text-xs">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="w-8 px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                    title={t("financeCockpit.work.selectAllTitle")}
                    aria-label={t("financeCockpit.work.selectAllTitle")}
                    className={checkboxCls}
                  />
                </th>
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
              {items.map((item, idx) => {
                const days = agingDays(item.date, today);
                const pickedId = picked[item.bankTransactionId] ?? null;
                const isSelected = selected.has(item.bankTransactionId);
                const isFocused = idx === focusIdx;
                return (
                  <tr
                    key={item.bankTransactionId}
                    onClick={() => setFocusIdx(idx)}
                    className={`border-t border-gray-100 align-middle ${
                      isFocused ? "bg-gray-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <td className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() =>
                          setSelected((prev) => toggleSelected(prev, item.bankTransactionId))
                        }
                        aria-label={`#${item.bankTransactionId}`}
                        className={checkboxCls}
                      />
                    </td>
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

      {/* 表尾:載入進度(誠實顯示已載入 / 總數)+ 載入更多 + 鍵盤提示 */}
      {!list.isLoading && !list.isError && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-4 py-2.5">
          <span className="text-[10px] text-gray-400 tabular-nums">
            {list.hasNextPage
              ? t("financeCockpit.work.loadedOf", {
                  loaded: String(items.length),
                  total: String(Math.max(pending.count, items.length)),
                })
              : t("financeCockpit.work.allLoaded", { total: String(items.length) })}
          </span>
          {list.hasNextPage && (
            <button
              type="button"
              disabled={list.isFetchingNextPage}
              onClick={() => list.fetchNextPage()}
              className="inline-flex h-6 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {list.isFetchingNextPage && <Loader2 className="h-3 w-3 animate-spin" />}
              {list.isFetchingNextPage
                ? t("financeCockpit.work.loadingMore")
                : t("financeCockpit.work.loadMore")}
            </button>
          )}
          <span className="ml-auto text-[10px] text-gray-300">
            {t("financeCockpit.work.keyboardHint")}
          </span>
        </div>
      )}

      <div className="flex gap-1.5 border-t border-gray-50 px-4 pb-3 pt-2.5 text-[10px] leading-relaxed text-gray-400">
        <Info className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-300" />
        <span>{t("financeCockpit.work.pendingNote")}</span>
      </div>

      <ClaimDialog
        key={dialogItem?.bankTransactionId ?? "closed"}
        item={dialogItem}
        initialOrderId={dialogItem ? (picked[dialogItem.bankTransactionId] ?? null) : null}
        defaultCategory={lastCategory}
        onClaimed={(claim, category) => {
          applyClaimedLocally([claim]);
          if (category) setLastCategory(category);
        }}
        onClose={() => setDialogItem(null)}
      />
    </div>
  );
}
