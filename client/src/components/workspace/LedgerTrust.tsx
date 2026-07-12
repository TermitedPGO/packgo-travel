/**
 * LedgerTrust — 批3 m2 信託合規卡 (mockup 後台_06 PAGE 3).
 *
 * 餘額卡(drift 照實)+ 到期待審卡(🔒 → plaid.trustRecognizeNow **唯讀掃描**,
 * 零寫入)+ 在途訂金明細(已認列淡化)。鐵律:訂金 ≠ 營收,出發後才認列
 * (CST §17550,見 memory feedback_packgo_trust_accounting)。B1 fail-closed
 * (2026-07-13):掃描不自動認列,等 CPA 認列矩陣核准後由 Jeff 逐筆核。
 */
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { Lock, Check, AlertTriangle } from "lucide-react";
import { BtnB, Vault, Warn, Src } from "./ws-ui";
import { dueForRecognition } from "./workspaceLedger.helpers";

export default function LedgerTrust() {
  const { t } = useLocale();
  const reconQ = trpc.plaid.trustReconciliation.useQuery();
  const pendingQ = trpc.plaid.trustDeferredList.useQuery({
    status: "pending",
    limit: 200,
  });
  const recognizedQ = trpc.plaid.trustDeferredList.useQuery({
    status: "recognized",
    limit: 20,
  });

  const due = dueForRecognition(pendingQ.data ?? []);

  return (
    <div className="space-y-4">
      {(reconQ.data ?? []).map((a) => {
        const driftOk = Math.abs(a.drift) < 1;
        return (
          <div
            key={a.id}
            className="rounded-xl border border-gray-200 bg-white p-4 max-w-lg"
          >
            <div className="flex items-center justify-between mb-2 gap-2">
              <span className="inline-flex items-center gap-1.5 text-[13px] text-gray-600 min-w-0">
                <Lock className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">
                  {a.accountName ?? a.institutionName}
                  {a.accountMask ? ` ····${a.accountMask}` : ""}
                </span>
              </span>
              <Vault>{t("workspace.ldgTrustVault")}</Vault>
            </div>
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <span className="font-bold text-2xl">
                ${a.balance.toLocaleString()}
              </span>
              <span className="text-[12px] text-gray-500">
                {t("workspace.ldgTrustRows", { n: a.outstandingRows })}
              </span>
            </div>
            <div className="border-t border-gray-200 my-2.5" />
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-gray-500">
                {t("workspace.ldgTrustRecon")}
              </span>
              <span className="inline-flex items-center gap-1 font-semibold">
                {driftOk ? (
                  <>
                    <Check className="w-4 h-4" />
                    {t("workspace.ldgTrustMatch")}
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4" />
                    {t("workspace.ldgTrustDrift", {
                      n: a.drift.toLocaleString(),
                    })}
                  </>
                )}
              </span>
            </div>
            {a.unmatchedCount > 0 && (
              <Warn>
                {t("workspace.ldgTrustUnmatched", { n: a.unmatchedCount })}
              </Warn>
            )}
            <Src>{t("workspace.ldgTrustNote")}</Src>
          </div>
        );
      })}

      {due.rows.length > 0 && <RecognizeCard due={due} />}

      <DeferredTable
        title={t("workspace.ldgDeferredPending")}
        rows={pendingQ.data ?? []}
        dimRecognized={false}
      />
      <DeferredTable
        title={t("workspace.ldgDeferredRecognized")}
        rows={recognizedQ.data ?? []}
        dimRecognized
      />
    </div>
  );
}

/* ── 🔒 到期待審卡 — trustRecognizeNow(唯讀全域掃描,零寫入) ── */

function RecognizeCard({
  due,
}: {
  due: { rows: unknown[]; total: number };
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();

  // B1 fail-closed:按鈕只做唯讀掃描(零寫入),不再有「確認認列」寫入閘。
  const recognizeMut = trpc.plaid.trustRecognizeNow.useMutation({
    onSuccess: (r) => {
      if ("error" in r && r.error) {
        toast.error(String(r.error));
      } else {
        toast.success(t("workspace.ldgRecognized", { n: r.dueForReview }));
      }
      utils.plaid.trustDeferredList.invalidate();
      utils.plaid.trustReconciliation.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="rounded-xl border-2 border-black bg-white p-3 max-w-lg">
      <div className="flex items-center gap-2 mb-1.5">
        <Lock className="w-3.5 h-3.5" />
        <span className="text-[12px] font-semibold">
          {t("workspace.ldgRecognizeTitle")}
        </span>
      </div>
      <div className="font-semibold text-[14px] mb-1">
        {t("workspace.ldgRecognizeBody", {
          n: due.rows.length,
          total: due.total.toLocaleString(),
        })}
      </div>
      <div className="text-[11px] text-gray-500 mb-2">
        {t("workspace.ldgRecognizeHint")}
      </div>
      <BtnB
        onClick={() => recognizeMut.mutate()}
        disabled={recognizeMut.isPending}
      >
        {recognizeMut.isPending
          ? t("workspace.ldgRecognizing")
          : t("workspace.ldgRecognizeOpen")}
      </BtnB>
    </div>
  );
}

function DeferredTable({
  title,
  rows,
  dimRecognized,
}: {
  title: string;
  rows: {
    id: number;
    amount: string | number;
    depositDate: Date | string | null;
    expectedRecognitionDate: Date | string | null;
    bookingId: number | null;
    matchMethod: string | null;
  }[];
  dimRecognized: boolean;
}) {
  const { t } = useLocale();
  if (rows.length === 0) return null;
  const fmtD = (v: Date | string | null) => {
    if (!v) return "—";
    const d = new Date(v);
    return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
  };
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-500 mb-2">
        {title}
      </div>
      <div
        className={`rounded-xl border border-gray-200 bg-white overflow-hidden ${
          dimRecognized ? "opacity-50" : ""
        }`}
      >
        <div className="grid grid-cols-[1fr_0.8fr_0.8fr_1fr] gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-500">
          <div>{t("workspace.ldgColBooking")}</div>
          <div className="text-right">{t("workspace.ldgColAmount")}</div>
          <div>{t("workspace.ldgColDeposit")}</div>
          <div>{t("workspace.ldgColRecognize")}</div>
        </div>
        <div className="divide-y divide-gray-100 text-[12px]">
          {rows.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[1fr_0.8fr_0.8fr_1fr] gap-2 px-3 py-2 items-center min-w-0"
            >
              <div className="font-medium truncate">
                {r.bookingId
                  ? `#${r.bookingId}`
                  : t("workspace.ldgUnmatchedRow")}
              </div>
              <div className="text-right font-semibold">
                ${Math.abs(Number(r.amount)).toLocaleString()}
              </div>
              <div className="text-gray-500">{fmtD(r.depositDate)}</div>
              <div className="text-gray-500">
                {fmtD(r.expectedRecognitionDate)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
