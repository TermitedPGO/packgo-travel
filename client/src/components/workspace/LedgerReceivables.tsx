/**
 * LedgerReceivables — 批3 m3 催款唯讀列表 (mockup 後台_06 PAGE 2 的
 * 「誰還沒付」段).
 *
 * 誠實邊界:催款草稿/語氣/送出整條無後端 — 此頁唯讀,系統不自動發,
 * 不放死按鈕(gap 記錄於 batch-3-finance.md)。
 */
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Badge, BadgeK, Pill, Src } from "./ws-ui";
import {
  receivableOf,
  sortReceivables,
  type BookingLike,
  type Receivable,
} from "./workspaceLedger.helpers";

export default function LedgerReceivables() {
  const { t } = useLocale();
  const bookingsQ = trpc.bookings.adminList.useQuery();

  const receivables = sortReceivables(
    ((bookingsQ.data ?? []) as BookingLike[])
      .map((b) => receivableOf(b))
      .filter((r): r is Receivable => r != null),
  );

  const totalDue = receivables.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        {t("workspace.ldgRecvSub", {
          n: receivables.length,
          total: totalDue.toLocaleString(),
        })}
      </p>

      {bookingsQ.isLoading && (
        <p className="text-xs text-gray-400 py-4">{t("workspace.loading")}</p>
      )}
      {!bookingsQ.isLoading && receivables.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-400">
          {t("workspace.ldgRecvEmpty")}
        </div>
      )}

      {receivables.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
          {receivables.map((r) => (
            <ReceivableRow key={`${r.bookingId}-${r.kind}`} r={r} />
          ))}
        </div>
      )}

      <Src>{t("workspace.ldgRecvReadonly")}</Src>
    </div>
  );
}

function ReceivableRow({ r }: { r: Receivable }) {
  const { t } = useLocale();
  const overdue = r.daysLeft != null && r.daysLeft < 0;
  const initial = r.customerName.trim().charAt(0) || "?";

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 min-w-0 ${
        overdue ? "border-l-4 border-l-black" : ""
      }`}
    >
      <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate">
          {r.customerName}
          <span className="text-gray-400 font-normal">
            {" · "}
            {r.kind === "deposit"
              ? t("workspace.ldgRecvDeposit")
              : t("workspace.ldgRecvBalance")}
            {" · #"}
            {r.bookingId}
          </span>
        </div>
      </div>
      <div className="text-[13px] font-semibold flex-shrink-0">
        {r.currency} {r.amount.toLocaleString()}
      </div>
      <div className="w-[88px] text-right flex-shrink-0">
        {r.daysLeft == null ? (
          <span className="text-[11px] text-gray-400">
            {t("workspace.ldgRecvNoDue")}
          </span>
        ) : overdue ? (
          <BadgeK>
            {t("workspace.ldgRecvOverdue", { n: Math.abs(r.daysLeft) })}
          </BadgeK>
        ) : r.daysLeft <= 3 ? (
          <Pill>T-{r.daysLeft}</Pill>
        ) : (
          <span className="text-[11px] text-gray-400">T-{r.daysLeft}</span>
        )}
      </div>
      <span className="flex-shrink-0">
        {r.kind === "deposit" ? (
          <Badge>{t("workspace.ldgRecvSeatNote")}</Badge>
        ) : null}
      </span>
    </div>
  );
}
