/**
 * TourDetailPanels — 批7 右欄卡片(價格+毛利 / 出發日庫存 / 內含不含 /
 * 品質 calibration).
 */
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Check, AlertTriangle } from "lucide-react";
import { Kv, Pill, Src, Warn } from "./ws-ui";
import {
  parseCost,
  upcomingDepartures,
} from "./workspaceTours.helpers";
import TourCalibrationCard from "./TourCalibrationCard";

type TourForPanels = {
  id: number;
  status: string;
  price: number;
  priceCurrency?: string | null;
  costExplanation?: string | null;
  calibrationScore?: number | null;
  calibrationVerdict?: string | null;
};

export default function TourDetailPanels({ tour }: { tour: TourForPanels }) {
  const { t } = useLocale();
  const cost = parseCost(tour.costExplanation);

  return (
    <div className="space-y-4 min-w-0">
      <PriceCard tour={tour} />

      <DeparturesCard tourId={tour.id} />

      {/* 內含 / 不含 */}
      {(cost.included.length > 0 || cost.excluded.length > 0) && (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <h3 className="text-[12px] font-semibold mb-1.5">
            {t("workspace.trsIncluded")}
          </h3>
          <div className="text-[11px] text-gray-600 space-y-1">
            {cost.included.slice(0, 8).map((s, i) => (
              <div key={i} className="flex items-start gap-1 min-w-0">
                <Check className="w-3 h-3 flex-shrink-0 mt-0.5" />
                <span className="break-words">{s}</span>
              </div>
            ))}
            {cost.excluded.length > 0 && (
              <div className="text-gray-400 break-words">
                {t("workspace.trsExcluded")}:{" "}
                {cost.excluded.slice(0, 6).join(" · ")}
              </div>
            )}
          </div>
        </div>
      )}

      <TourCalibrationCard tour={tour} />
    </div>
  );
}

/* ── 價格 + 毛利 (m3: suppliers.marginAudit single-tour mode) ── */

function PriceCard({ tour }: { tour: TourForPanels }) {
  const { t } = useLocale();
  const marginQ = trpc.suppliers.marginAudit.useQuery({
    limit: 1,
    threshold: 0.15,
    tourId: tour.id,
  });

  const m = marginQ.data?.items[0];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <h3 className="text-[12px] font-semibold mb-1.5">
        {t("workspace.trsPriceCard")}
      </h3>
      {m?.cost != null && (
        <Kv
          k={t("workspace.supMgCost")}
          v={`${m.costCurrency ?? ""} ${m.cost.toLocaleString()}`}
        />
      )}
      <Kv
        k={t("workspace.trsSellPrice")}
        v={`${tour.priceCurrency ?? ""} ${Number(tour.price).toLocaleString()}`}
      />
      {m?.margin != null && (
        <div className="flex justify-between text-[12.5px]">
          <span className="text-gray-500">{t("workspace.supMgMargin")}</span>
          <span className="font-bold inline-flex items-center gap-1">
            {Math.round(m.margin * 100)}%
            {m.belowThreshold && <AlertTriangle className="w-3.5 h-3.5" />}
          </span>
        </div>
      )}
      {m?.belowThreshold && <Warn>{t("workspace.supMgWarn")}</Warn>}
      {m?.currencyMismatch && (
        <div className="text-[11px] text-gray-500 mt-1">
          {t("workspace.supMgMismatch", {
            cost: m.costCurrency ?? "?",
            price: tour.priceCurrency ?? "?",
          })}
        </div>
      )}
      <Src>{t("workspace.trsPriceSrc")}</Src>
    </div>
  );
}

function DeparturesCard({ tourId }: { tourId: number }) {
  const { t } = useLocale();
  const depsQ = trpc.departures.listByTour.useQuery({ tourId });

  const upcoming = upcomingDepartures(
    (depsQ.data ?? []) as {
      departureDate: Date | string;
      status: string;
      totalSlots: number | null;
      bookedSlots: number | null;
    }[],
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <h3 className="text-[12px] font-semibold mb-1.5">
        {t("workspace.trsDepartures")}
      </h3>
      {upcoming.length === 0 ? (
        <p className="text-[11px] text-gray-400">
          {t("workspace.trsNoDepartures")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {upcoming.slice(0, 8).map((d, i) => {
            const date = new Date(d.departureDate);
            const label = `${date.getMonth() + 1}/${String(date.getDate()).padStart(2, "0")}`;
            return (
              <Pill key={i}>
                {label}
                {d.status === "full" || d.seatsLeft === 0
                  ? ` ${t("workspace.trsFull")}`
                  : d.seatsLeft != null
                    ? ` ${t("workspace.trsSeatsLeft", { n: d.seatsLeft })}`
                    : ""}
              </Pill>
            );
          })}
        </div>
      )}
      <Src>{t("workspace.trsPastHidden")}</Src>
    </div>
  );
}
