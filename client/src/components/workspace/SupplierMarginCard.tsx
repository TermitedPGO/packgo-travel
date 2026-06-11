/**
 * SupplierMarginCard — 批5 m5 成本毛利卡 (mockup 後台_07 PAGE 2 (b)).
 *
 * suppliers.marginAudit(唯讀)— 後台成本(min 未來班次同業價)vs 我的
 * 售價,毛利 < 15% 黑框警示。幣別不同不換匯不假算,照實標示。
 * 更新售價走 m2 的同一條 🔒 gated tours.update 路徑。
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { AlertTriangle } from "lucide-react";
import { BtnO, Badge, Kv, Src } from "./ws-ui";
import { UpdatePriceDialog, type PriceTarget } from "./SupplierMonitorCards";

export default function SupplierMarginCard() {
  const { t } = useLocale();
  const auditQ = trpc.suppliers.marginAudit.useQuery({
    limit: 10,
    threshold: 0.15,
  });
  const [target, setTarget] = useState<PriceTarget | null>(null);

  const data = auditQ.data;
  if (auditQ.isLoading || !data || data.items.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold">
          {t("workspace.supMgTitle")}
        </span>
        <span className="text-[10px] text-gray-400">
          {t("workspace.supMgCount", {
            low: data.belowThreshold,
            total: data.totalMatched,
          })}
        </span>
      </div>
      <div className="divide-y divide-gray-100">
        {data.items.map((m) => (
          <div
            key={m.tourId}
            className={`px-3 py-2.5 min-w-0 ${
              m.belowThreshold ? "border-l-4 border-l-black" : ""
            }`}
          >
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="text-[12.5px] font-medium truncate">
                {m.title}
              </span>
              <Badge>{m.supplierCode}</Badge>
              <span className="text-[10px] text-gray-400">
                {m.externalProductCode}
              </span>
            </div>
            <div className="max-w-sm space-y-0.5">
              <Kv
                k={t("workspace.supMgCost")}
                v={
                  m.cost != null
                    ? `${m.costCurrency ?? ""} ${m.cost.toLocaleString()}`
                    : "—"
                }
              />
              <Kv
                k={t("workspace.supMgPrice")}
                v={`${m.priceCurrency} ${m.price.toLocaleString()}`}
              />
              <div className="flex justify-between text-[12.5px]">
                <span className="text-gray-500">
                  {t("workspace.supMgMargin")}
                </span>
                <span className="font-bold inline-flex items-center gap-1">
                  {m.margin != null
                    ? `${Math.round(m.margin * 100)}%`
                    : t("workspace.supMgNA")}
                  {m.belowThreshold && (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  )}
                </span>
              </div>
            </div>
            {m.belowThreshold && (
              <div className="flex items-start gap-1.5 mt-1.5 text-[11px] font-medium">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                <span>{t("workspace.supMgWarn")}</span>
              </div>
            )}
            {m.currencyMismatch && (
              <div className="text-[11px] text-gray-500 mt-1">
                {t("workspace.supMgMismatch", {
                  cost: m.costCurrency ?? "?",
                  price: m.priceCurrency,
                })}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 mt-1.5">
              <Src>{t("workspace.supMgSrc")}</Src>
              <BtnO
                onClick={() =>
                  setTarget({
                    tourId: m.tourId,
                    tourTitle: m.title,
                    tourPrice: m.price,
                    tourPriceCurrency: m.priceCurrency,
                    previousPrice: null,
                    currentPrice: m.cost,
                  })
                }
              >
                {t("workspace.supMonUpdatePrice")}
              </BtnO>
            </div>
          </div>
        ))}
      </div>
      {target && (
        <UpdatePriceDialog log={target} onClose={() => setTarget(null)} />
      )}
    </div>
  );
}
