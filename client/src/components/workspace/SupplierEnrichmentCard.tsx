/**
 * SupplierEnrichmentCard — 批5 m3 行程詳情解析進度卡 (absorbs the old
 * SupplierEnrichmentTabV2; split out for the 300-line rule).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { BtnB, BtnO, Badge } from "./ws-ui";
import { formatRelTime } from "./relTime";
import { enrichmentPct } from "./workspaceSuppliers.helpers";

export default function EnrichmentCard() {
  const { t } = useLocale();
  const enrichQ = trpc.suppliers.enrichmentOverview.useQuery();
  const [confirming, setConfirming] = useState(false);

  const backfillMut = trpc.suppliers.triggerFullBackfill.useMutation({
    onSuccess: (res) => {
      toast.success(t("workspace.supEnrQueued", { n: res.total }));
      setConfirming(false);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold">
          {t("workspace.supEnrTitle")}
        </span>
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500">
              {t("workspace.supEnrConfirm")}
            </span>
            <BtnB
              onClick={() => backfillMut.mutate({ supplierCode: "all" })}
              disabled={backfillMut.isPending}
            >
              {t("workspace.supEnrGo")}
            </BtnB>
            <BtnO onClick={() => setConfirming(false)}>
              {t("workspace.supCancel")}
            </BtnO>
          </span>
        ) : (
          <BtnO onClick={() => setConfirming(true)}>
            {t("workspace.supEnrBackfill")}
          </BtnO>
        )}
      </div>
      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(enrichQ.data ?? []).map((s) => {
          const pct = enrichmentPct(s.itineraryParsed, s.total);
          return (
            <div key={s.code} className="min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[12px] font-medium flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{s.name}</span>
                  <Badge>{s.code}</Badge>
                </span>
                <span className="text-[11px] text-gray-500 flex-shrink-0">
                  {s.itineraryParsed.toLocaleString()} /{" "}
                  {s.total.toLocaleString()} · {pct}%
                </span>
              </div>
              <div className="h-2 rounded-md bg-gray-100 overflow-hidden">
                <div
                  className="h-full bg-black rounded-md"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400 flex-wrap">
                {s.itineraryParseFailed > 0 && (
                  <span className="font-medium text-black">
                    {t("workspace.supEnrFailed", { n: s.itineraryParseFailed })}
                  </span>
                )}
                <span>
                  {t("workspace.supEnrMissing", { n: s.itineraryMissing })}
                </span>
                {s.lastEnrichedAt && (
                  <span>{formatRelTime(s.lastEnrichedAt, t)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
