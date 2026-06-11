/**
 * TourDetail — 批7 m2 單一行程全貌 (mockup 後台_09).
 *
 * Header + 圖片 + 每日行程 timeline + 路線地圖卡 (left), 價格/出發日/
 * 內含不含/品質 cards (right panel, TourDetailPanels). Read-only in m2;
 * 動作列 lands in m3.
 */
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { ArrowLeft, Bed, Utensils, Map as MapIcon } from "lucide-react";
import { Badge, BadgeK, BtnO, Warn } from "./ws-ui";
import { parseItinerary } from "./workspaceTours.helpers";
import TourDetailPanels from "./TourDetailPanels";

export default function TourDetail({
  tourId,
  onBack,
}: {
  tourId: number;
  onBack: () => void;
}) {
  const { t } = useLocale();
  const tourQ = trpc.tours.getById.useQuery({ id: tourId });

  const tour = tourQ.data;
  if (tourQ.isLoading || !tour) {
    return (
      <div className="space-y-3">
        <BtnO onClick={onBack}>
          <span className="inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" />
            {t("workspace.trsBack")}
          </span>
        </BtnO>
        <p className="text-xs text-gray-400 py-4">
          {tourQ.isLoading ? t("workspace.loading") : t("workspace.trsNotFound")}
        </p>
      </div>
    );
  }

  const days = parseItinerary(tour.itineraryDetailed);
  const gallery = parseGallery(tour.galleryImages);
  const pending = tour.status === "pending_review";

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <BtnO onClick={onBack}>
              <span className="inline-flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" />
                {t("workspace.trsBack")}
              </span>
            </BtnO>
            {pending ? (
              <BadgeK>{t(`workspace.trsSt_${tour.status}`)}</BadgeK>
            ) : (
              <Badge>{t(`workspace.trsSt_${tour.status}`)}</Badge>
            )}
            {tour.productCode && (
              <span className="text-[11px] text-gray-400">
                {tour.productCode}
              </span>
            )}
          </div>
          <h2 className="font-serif text-xl font-bold break-words">
            {tour.title}
          </h2>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {[
              tour.destinationCountry,
              tour.destinationCity,
              t("workspace.supCatDays", { n: tour.duration }),
              tour.departureCity
                ? `${tour.departureCity} ${t("workspace.trsDeparts")}`
                : null,
              tour.calibrationScore != null
                ? `${t("workspace.trsCalib")} ${tour.calibrationScore}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* LEFT 2 cols */}
        <div className="lg:col-span-2 space-y-5 min-w-0">
          {/* images */}
          <section>
            <h3 className="text-[12px] font-semibold mb-1.5">
              {t("workspace.trsImages")}
            </h3>
            {tour.heroImage || tour.imageUrl ? (
              <img
                src={tour.heroImage || tour.imageUrl || ""}
                alt={tour.title}
                className="rounded-xl object-cover w-full h-40 mb-2"
              />
            ) : (
              <div className="rounded-xl bg-gray-100 w-full h-40 mb-2 flex items-center justify-center text-[11px] text-gray-400">
                {t("workspace.trsNoHero")}
              </div>
            )}
            {gallery.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {gallery.slice(0, 5).map((g, i) => (
                  <img
                    key={i}
                    src={g.url}
                    alt={g.alt ?? ""}
                    className="rounded-lg object-cover w-full aspect-[4/3]"
                  />
                ))}
              </div>
            )}
          </section>

          <RouteMapCard tourId={tourId} />

          {/* itinerary */}
          <section>
            <h3 className="text-[12px] font-semibold mb-2">
              {t("workspace.trsItinerary")}
            </h3>
            {days.length === 0 && (
              <p className="text-[11px] text-gray-400">
                {t("workspace.trsNoItinerary")}
              </p>
            )}
            {days.map((d, i) => (
              <div key={i} className="flex gap-3 min-w-0">
                <div className="flex flex-col items-center pt-0.5">
                  <div className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                    {d.day}
                  </div>
                  {i < days.length - 1 && (
                    <div className="w-px flex-1 bg-gray-200 my-1" />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-3">
                  <div className="text-[13px] font-semibold break-words">
                    {d.title}
                  </div>
                  {d.description && (
                    <div className="text-[12px] text-gray-600 mt-0.5 break-words">
                      {d.description}
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400 flex-wrap">
                    {d.hotel && (
                      <span className="inline-flex items-center gap-1">
                        <Bed className="w-3.5 h-3.5" />
                        {d.hotel}
                      </span>
                    )}
                    {d.meals && (
                      <span className="inline-flex items-center gap-1">
                        <Utensils className="w-3.5 h-3.5" />
                        {d.meals}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </section>
        </div>

        {/* RIGHT panel */}
        <TourDetailPanels tour={tour} />
      </div>
    </div>
  );
}

function parseGallery(
  raw: string | null | undefined,
): { url: string; alt?: string }[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (g): g is { url: string; alt?: string } =>
          g != null && typeof g === "object" && typeof g.url === "string",
      )
      .slice(0, 10);
  } catch {
    return [];
  }
}

/* ── 路線地圖卡 (landmark-ref 唯讀狀態) ── */

function RouteMapCard({ tourId }: { tourId: number }) {
  const { t } = useLocale();
  const mapQ = trpc.tours.getRouteMap.useQuery({ id: tourId });

  const data = mapQ.data;
  if (mapQ.isLoading || !data) return null;

  const stops = data.stops ?? [];
  if (stops.length === 0 && !data.staticMapUrl) return null;

  return (
    <section>
      <h3 className="text-[12px] font-semibold mb-1.5">
        {t("workspace.trsRouteMap")}
      </h3>
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        {data.staticMapUrl ? (
          <img
            src={data.staticMapUrl}
            alt=""
            className="w-full h-32 object-cover border-b border-gray-100"
          />
        ) : (
          <div className="h-24 bg-gray-50 border-b border-gray-100 flex flex-col items-center justify-center text-gray-300">
            <MapIcon className="w-7 h-7" />
          </div>
        )}
        <div className="px-3 py-2 text-[11px] text-gray-500">
          {t("workspace.trsStopsLocated", { n: stops.length })}
        </div>
      </div>
      {data.fallbackMode && (
        <Warn>{t("workspace.trsMapFallback")}</Warn>
      )}
    </section>
  );
}
