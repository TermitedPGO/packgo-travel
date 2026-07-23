/**
 * TrustCard —— 兩本帳:客人訂金卡(F3 塊C#2,B-final 右欄第二卡)。
 *
 * 三段拆分直接吃 truth.trust(與真相列同源同口徑,不另開加總);逐團列表接
 * trustDeferredList(pending)+ join 名稱(客人名/團名,server 塊C join 補齊),
 * foldMatchedNotDeparted 摺疊(前 4 筆 + 「其他 N 筆」聚合列)。
 * footer 等式:未認列合計 = 三段之和(結構恆真);銀行餘額與合計有差(drift)
 * 時誠實附註,不假裝相等。
 */
import { trpc } from "@/lib/trpc";
import { Info, Lock } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import {
  foldDepartedPending,
  foldMatchedNotDeparted,
  fmtMoney,
  fmtSignedMoney,
  laTodayClient,
} from "./cockpitMath";
import type { TrustTile } from "./types";

const DRIFT_CLEAN_THRESHOLD = 1; // 與 TrustComplianceV2 同款:$1 內視為勾稽乾淨

function fmtDate(d: string | null): string {
  return d ? d.replace(/-/g, "/") : "—";
}

/** 逐團列的顯示名:客人名 + 團名;都沒有時 fallback Booking #id。 */
function rowName(
  t: (k: string, v?: Record<string, string>) => string,
  customerName: string | null,
  tourTitle: string | null,
  bookingId: number,
): string {
  const parts = [customerName, tourTitle].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return t("financeCockpit.ledger.trustBooking", { id: String(bookingId) });
}

export function TrustCard({ trust }: { trust: TrustTile }) {
  const { t } = useLocale();
  const today = laTodayClient();
  const deferred = trpc.plaid.trustDeferredList.useQuery(
    { status: "pending", limit: 200 },
    { refetchInterval: 120_000 },
  );

  const matched = foldMatchedNotDeparted(deferred.data as any, today, 4);
  const departed = foldDepartedPending(deferred.data as any, today);
  // 1A0a(Codex 7-18 P1-6):明細源(trustDeferredList)自己的狀態 —— aggregate
  // 成功但明細失敗時不得安靜省略 booking 明細。
  const detailCold = deferred.isError && deferred.data === undefined;
  const detailStale = deferred.isError && deferred.data !== undefined;
  const detailLoading = deferred.isLoading && deferred.data === undefined;
  // 1A0a:數字欄 null = 無法核實;任一 null 一律走「無法核實」態,不折 0。
  const n =
    trust.balance !== null &&
    trust.outstanding !== null &&
    trust.matchedNotDeparted !== null &&
    trust.unmatchedTotal !== null &&
    trust.unmatchedCount !== null &&
    trust.departedPending !== null &&
    trust.departedPendingCount !== null
      ? {
          balance: trust.balance,
          outstanding: trust.outstanding,
          matchedNotDeparted: trust.matchedNotDeparted,
          unmatchedTotal: trust.unmatchedTotal,
          unmatchedCount: trust.unmatchedCount,
          departedPending: trust.departedPending,
          departedPendingCount: trust.departedPendingCount,
        }
      : null;
  const drift = n !== null ? n.balance - n.outstanding : 0;
  const driftClean = Math.abs(drift) < DRIFT_CLEAN_THRESHOLD;
  const allZero =
    n !== null && n.outstanding === 0 && n.unmatchedCount === 0 && n.departedPendingCount === 0;

  const title = trust.accountMask
    ? t("financeCockpit.ledger.trustCardTitle", { mask: trust.accountMask })
    : t("financeCockpit.ledger.trustCardTitleNoMask");

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {/* 卡頭 */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
          <Lock className="h-3.5 w-3.5 text-gray-400" />
          {title}
        </div>
        <div className="text-[11px] text-gray-500">
          {trust.state === "stale" ? (
            t("financeCockpit.truth.staleHint")
          ) : (
            <>
              {t("financeCockpit.ledger.trustMetaBalance")}{" "}
              <b className="font-semibold text-gray-800 tabular-nums">
                {trust.balance !== null ? fmtMoney(trust.balance) : "—"}
              </b>
            </>
          )}
        </div>
      </div>

      {trust.state === "loading" ? (
        <div className="animate-pulse space-y-3 p-4">
          <div className="h-12 rounded bg-gray-100" />
          <div className="h-24 rounded bg-gray-50" />
        </div>
      ) : trust.state === "transport-error" || n === null ? (
        <div className="px-4 py-8 text-center text-xs text-gray-400">
          {t("financeCockpit.truth.loadError")}
        </div>
      ) : !trust.enabled ? (
        <div className="px-4 py-8 text-center text-xs text-gray-400">
          {t("financeCockpit.ledger.trustDisabledNote")}
        </div>
      ) : (
        <div className={trust.state === "stale" ? "opacity-60" : ""}>
          {/* 三段拆分(B-final .tsplit;吃 truth.trust,與真相列同源) */}
          <div className="flex border-b border-gray-100">
            <div className="flex-1 px-4 py-3">
              <div className="whitespace-nowrap text-[10px] text-gray-400">
                {t("financeCockpit.ledger.trustSplitMatched")}
              </div>
              <div className="text-base font-bold text-gray-900 tabular-nums">
                {fmtMoney(n.matchedNotDeparted)}
              </div>
            </div>
            <div className="flex-none self-center px-0.5 font-semibold text-gray-300">+</div>
            <div className="flex-1 border-l border-gray-100 px-4 py-3">
              <div className="whitespace-nowrap text-[10px] text-gray-400">
                {t("financeCockpit.ledger.trustSplitUnmatched")}
              </div>
              <div className="text-base font-bold text-amber-700 tabular-nums">
                {fmtMoney(n.unmatchedTotal)}
              </div>
            </div>
            <div className="flex-none self-center px-0.5 font-semibold text-gray-300">+</div>
            <div className="flex-1 border-l border-gray-100 px-4 py-3">
              <div className="whitespace-nowrap text-[10px] text-gray-400">
                {t("financeCockpit.ledger.trustSplitDeparted")}
              </div>
              <div className="text-base font-bold text-gray-900 tabular-nums">
                {fmtMoney(n.departedPending)}
              </div>
            </div>
          </div>

          {detailLoading ? (
            <div className="animate-pulse space-y-2 px-4 py-4">
              <div className="h-8 rounded bg-gray-50" />
              <div className="h-8 rounded bg-gray-50" />
            </div>
          ) : detailCold ? (
            <div className="px-4 py-4 text-center text-xs text-amber-700">
              {t("financeCockpit.ledger.trustDetailLoadFailed")}
            </div>
          ) : allZero && !detailStale ? (
            /* 1A0a(Codex 7-18 P2-1):allZero 空態只在非 stale 時顯示,stale 走下方
               保留舊值+badge,不被 trustEmpty 吞掉 */
            <div className="px-4 py-7 text-center text-xs text-gray-400">
              {t("financeCockpit.ledger.trustEmpty")}
            </div>
          ) : (
            <div className="px-4 pb-3 pt-1">
              {detailStale && (
                <div className="pb-1 text-[10px] text-amber-700">
                  {t("financeCockpit.truth.staleHint")}
                </div>
              )}
              {/* 逐團列表:已對應未出發(近出發 amber dot) */}
              {matched.listed.map((row) => (
                <div key={row.id} className="flex items-center gap-2 border-b border-gray-50 py-2 text-xs last:border-0">
                  <span
                    className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${row.soon ? "bg-amber-400" : "bg-gray-300"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-gray-900">
                      {rowName(t, row.customerName, row.tourTitle, row.bookingId)}
                    </div>
                    <div className="mt-px text-[10px] text-gray-400">
                      {row.recognitionDate === null
                        ? t("financeCockpit.ledger.trustRowNoDate")
                        : row.soon && row.daysUntil !== null
                          ? t("financeCockpit.ledger.trustRowDepartureSoon", {
                              date: fmtDate(row.recognitionDate),
                              days: String(row.daysUntil),
                            })
                          : t("financeCockpit.ledger.trustRowDeparture", {
                              date: fmtDate(row.recognitionDate),
                            })}
                    </div>
                  </div>
                  <span className="flex-shrink-0 font-semibold text-gray-800 tabular-nums">
                    {fmtMoney(row.amount)}
                  </span>
                </div>
              ))}
              {matched.othersCount > 0 && (
                <div className="flex items-center gap-2 border-b border-gray-50 py-2 text-xs last:border-0">
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-500">
                      {t("financeCockpit.ledger.trustRowOthers", { count: String(matched.othersCount) })}
                    </div>
                    <div className="mt-px text-[10px] text-gray-400">
                      {t("financeCockpit.ledger.trustRowOthersDesc")}
                    </div>
                  </div>
                  <span className="flex-shrink-0 font-semibold text-gray-500 tabular-nums">
                    {fmtMoney(matched.othersTotal)}
                  </span>
                </div>
              )}

              {/* 未對應列(amber,見左側待認領) */}
              {n.unmatchedCount > 0 && (
                <div className="flex items-center gap-2 border-b border-gray-50 py-2 text-xs last:border-0">
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-amber-700">
                      {t("financeCockpit.ledger.trustRowUnmatched", { count: String(n.unmatchedCount) })}
                    </div>
                    <div className="mt-px text-[10px] text-gray-400">
                      {t("financeCockpit.ledger.trustRowUnmatchedDesc")}
                    </div>
                  </div>
                  <span className="flex-shrink-0 font-semibold text-amber-700 tabular-nums">
                    {fmtMoney(n.unmatchedTotal)}
                  </span>
                </div>
              )}

              {/* 審查日已到列(red dot,舊規則到期 → 待人工審查,對應左側待審卡) */}
              {departed.items.map((row) => (
                <div key={row.id} className="flex items-center gap-2 border-b border-gray-50 py-2 text-xs last:border-0">
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-gray-900">
                      {rowName(t, row.customerName, row.tourTitle, row.bookingId)}
                    </div>
                    <div className="mt-px text-[10px] text-gray-400">
                      {t("financeCockpit.ledger.trustRowDepartedDesc", {
                        date: fmtDate(row.recognitionDate),
                      })}
                    </div>
                  </div>
                  <span className="flex-shrink-0 font-semibold text-gray-800 tabular-nums">
                    {fmtMoney(row.amount)}
                  </span>
                </div>
              ))}

              {/* limit 200 天花板:來源截斷時誠實標注(P3 回爐 #3) */}
              {(deferred.data?.length ?? 0) >= 200 && (
                <div className="pt-2 text-[10px] text-gray-400">
                  {t("financeCockpit.ledger.listTruncated", { limit: "200" })}
                </div>
              )}
            </div>
          )}

          {/* footer 等式(誠實:drift ≠ 0 附註,不假裝餘額相等) */}
          <div className="flex gap-1.5 border-t border-gray-50 px-4 pb-3 pt-2.5 text-[10px] leading-relaxed text-gray-400">
            <Info className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-300" />
            <span>
              {t("financeCockpit.ledger.trustNoteEq", {
                outstanding: fmtMoney(n.outstanding),
                matched: fmtMoney(n.matchedNotDeparted),
                unmatched: fmtMoney(n.unmatchedTotal),
                departed: fmtMoney(n.departedPending),
              })}
              {driftClean ? (
                <> {t("financeCockpit.ledger.trustNoteBalanceClean", { balance: fmtMoney(n.balance) })}</>
              ) : drift < 0 ? (
                /* F3 塊D 回爐 #3:負 drift 方向感知 —— 信託現金低於追蹤中的
                   未認列訂金,是查核級訊號(訂金可能未入信託或提前轉出) */
                <>{" "}
                  {t("financeCockpit.ledger.trustNoteBalanceDriftNegative", {
                    balance: fmtMoney(n.balance),
                    gap: fmtMoney(Math.abs(drift)),
                  })}
                </>
              ) : (
                <>{" "}
                  {t("financeCockpit.ledger.trustNoteBalanceDrift", {
                    balance: fmtMoney(n.balance),
                    drift: fmtSignedMoney(drift),
                  })}
                </>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
