/**
 * TourRouteMapSvg — Round 80.21 (Option C from Jeff).
 *
 * Real SVG world map rendered via react-simple-maps + world-atlas
 * TopoJSON. Replaces the previous Google Static Maps PNG approach which
 * Jeff rejected because:
 *   - Country fallbacks looked broken when geocoding failed
 *   - Static raster tiles never felt premium / brand-aligned
 *   - GOOGLE_API_KEY referrer restrictions caused empty grays in prod
 *
 * Why SVG works here:
 *   - 100% client-side once the TopoJSON loads (~120KB gzipped)
 *   - No API quota, no referrer issues, no key
 *   - We control every pixel — true PACK&GO B&W + gold styling
 *   - Vector accuracy at any zoom level, scales perfectly retina
 *
 * Accuracy guarantee (Jeff's requirement: "地圖一定準確位置"):
 *   - Coordinates still come from server-side Google Geocoding API
 *     (same source as before, accuracy unchanged)
 *   - We just RENDER them on a vector world map instead of a raster tile
 *   - The map auto-zooms to the bounding box of all stops
 *
 * Brand styling:
 *   - Land  : cream  #faf8f3
 *   - Water : pale gray #f3f4f6
 *   - Country borders : #e5e7eb (subtle)
 *   - Active country  : #e0d4b3 (warm cream — highlights destination)
 *   - Route line      : gold dashed #c9a563 (60% opacity)
 *   - City markers    : black circle + white day number, gold ring on hover
 *
 * Fallback chain:
 *   1. ≥1 geocoded stop  → render SVG world map with markers
 *   2. 0 geocoded stops  → RouteFlowFallback (chip flow diagram)
 *   3. No stops at all   → render nothing (return null upstream)
 */

import { useMemo, useState, lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Map as MapIcon, ExternalLink, Loader2 } from "lucide-react";

// v359c — removed dead helpers:
//   • themePhraseMap (35-entry dict of marketing phrase translations)
//   • translateDayName (function that consumed themePhraseMap + locationMapping)
// Both became dead in v353b when the day-chip list under the map was
// removed ("下面這部分很沒有用"); the chip rendering was the only
// caller of translateDayName. The wrapper now just renders the map
// frame + section header — no day-name translation here. Day-name
// translation still happens inside the canvas via translateDestination
// from "@/utils/locationMapping" (city-level only).

// react-simple-maps is heavy (~70KB) — lazy-load so the rest of the
// detail page never waits on it. The Suspense fallback shows the
// loading spinner inside the map frame.
// v320: switched primary map renderer to Google Maps JS API for native
// rivers, lakes, terrain shading, and city/country labels — matching
// Jeff's illustrated travel-magazine reference. Falls back to the SVG
// topojson renderer if the Google Maps script fails to load.
const MapCanvas = lazy(() => import("./TourRouteMapHybrid"));

interface ItineraryDay {
  day?: number | string;
  title?: string;
  location?: string;
  description?: string;
  city?: string;
}

interface Props {
  tourId: number;
  itinerary: ItineraryDay[];
  destinationCountry?: string;
  /** Tour departure city (e.g. "台北"). Round 80.21 v4: surfaced in the
   *  outlier banner when trans-continent stops get filtered off the
   *  primary cluster (e.g. "從台北出發 · Day 1 ✈️"). */
  departureCity?: string;
  /** Tour title — Round 80.21 v8: shown in the decorative title bar
   *  on top of the map (matching Jeff's reference travel infographic). */
  tourTitle?: string;
  themeColor: { primary: string; secondary?: string };
}

export default function TourRouteMapSvg({
  tourId,
  itinerary,
  themeColor,
  departureCity,
  tourTitle,
  destinationCountry,
}: Props) {
  const { language } = useLocale();
  const isEN = language === "en";

  // v315: two-way link between day chips below the map and red-dot
  // markers on the map. Hovering a chip pulses the matching marker
  // and shows its tooltip; hovering a marker highlights the chip.
  const [highlightedDay, setHighlightedDay] = useState<number | null>(null);

  const { data, isLoading } = trpc.tours.getRouteMap.useQuery(
    { id: tourId },
    {
      enabled: tourId > 0,
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    }
  );

  if (!Array.isArray(itinerary) || itinerary.length === 0) return null;

  const stops = data?.stops ?? [];
  // Round 80.21 v5 — server now returns `outliers` (TPE departure/return
  // for trans-continent tours) + branded `staticMapUrl` separately.
  const outliers = (data as any)?.outliers ?? [];
  const staticMapUrl = data?.staticMapUrl ?? null;
  const directionsUrl = data?.directionsUrl ?? null;
  // v331 — AI tour-map URL (R2-hosted PNG). When non-null, render this
  // image directly instead of the SVG canvas.
  const aiMapUrl = (data as any)?.aiMapUrl ?? null;
  // Markers with real lat/lng. Stops without geocoding are excluded from
  // the map but still surface in the legend below.
  const mappedStops = useMemo(
    () => stops.filter((s) => s.lat !== 0 || s.lng !== 0),
    [stops]
  );
  const mappedCount = mappedStops.length;

  // Round 80.21 v5 — server now returns primary cluster + outliers
  // separately. For the LEGEND chips below the map, we want ALL stops
  // (primary + outliers) sorted by day so users see the full journey
  // even though the map only shows the primary cluster.
  const allStopsForLegend = useMemo(() => {
    const merged = [...stops, ...outliers];
    return merged
      .filter((s, idx, arr) => arr.findIndex((x) => x.day === s.day) === idx)
      .sort((a, b) => a.day - b.day);
  }, [stops, outliers]);

  // Legend always shows raw itinerary names (even when geocode failed)
  const legendStops =
    allStopsForLegend.length > 0
      ? allStopsForLegend
      : itinerary.slice(0, 26).map((d, i) => ({
          day: typeof d.day === "number" ? d.day : i + 1,
          name: (d.title || d.location || d.city || "").replace(
            /^(day\s*\d+\s*[:\-]?\s*|第\s*\d+\s*日\s*[:\-]?\s*)/i,
            ""
          ),
          lat: 0,
          lng: 0,
        }));

  const subtitleText = (() => {
    if (mappedCount > 0) {
      return isEN
        ? `${itinerary.length}-day journey · ${mappedCount} mapped stops`
        : `${itinerary.length} 天行程．${mappedCount} 個地點`;
    }
    return isEN
      ? `${itinerary.length}-day journey`
      : `${itinerary.length} 天行程`;
  })();

  return (
    <section className="py-12 lg:py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
          <div>
            <h2
              className="text-2xl md:text-3xl font-bold mb-1"
              style={{ color: themeColor.primary }}
            >
              <MapIcon className="inline-block h-6 w-6 mr-2 -mt-1" />
              {isEN ? "Tour Route" : "行程路線"}
            </h2>
            <p className="text-sm text-gray-500">{subtitleText}</p>
          </div>
          {directionsUrl && (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium hover:bg-gray-50"
              style={{
                borderColor: themeColor.primary,
                color: themeColor.primary,
              }}
            >
              {isEN ? "Open in Google Maps" : "在 Google 地圖開啟"}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        <div className="relative rounded-2xl overflow-hidden border border-gray-200 shadow-sm bg-[#faf8f3]">
          {isLoading && (
            <div className="aspect-[12/5] flex items-center justify-center">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEN ? "Loading map…" : "正在載入地圖…"}
              </div>
            </div>
          )}
          {/* v331 — AI tour-map mode. When `tour.aiMapUrl` is set, render
              the painted PNG directly. The AI image contains all markers,
              routes, transport icons, time labels, and decorative elements
              (legend / world inset / disclaimer). Falls back to the SVG
              canvas for tours without an AI map. */}
          {!isLoading && mappedStops.length > 0 && aiMapUrl && (
            <img
              src={aiMapUrl}
              alt={isEN ? "Tour route map" : "行程路線地圖"}
              loading="lazy"
              className="block w-full h-auto"
            />
          )}
          {!isLoading && mappedStops.length > 0 && !aiMapUrl && (
            <Suspense
              fallback={
                <div className="aspect-[12/5] flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-[#c9a563]" />
                </div>
              }
            >
              <MapCanvas
                stops={mappedStops}
                outliers={outliers}
                staticMapUrl={staticMapUrl}
                themeColor={themeColor}
                departureCity={departureCity}
                tourTitle={tourTitle}
                destinationCountry={destinationCountry}
                highlightedDay={highlightedDay}
                onMarkerHover={setHighlightedDay}
              />
            </Suspense>
          )}
          {!isLoading && mappedStops.length === 0 && legendStops.length > 0 && (
            <RouteFlowFallback
              stops={legendStops}
              themeColor={themeColor}
              isEN={isEN}
            />
          )}
          {!isLoading &&
            mappedStops.length === 0 &&
            legendStops.length === 0 && (
              <div className="aspect-[12/5] flex flex-col items-center justify-center text-gray-400 p-6 text-center">
                <MapIcon className="h-10 w-10 mb-2" />
                <p className="text-sm">
                  {isEN ? "Map preview unavailable." : "暫無地圖預覽。"}
                </p>
              </div>
            )}
        </div>

        {/* v353b — REMOVED day chips list. Per Jeff's feedback "下面這部分
            很沒有用". The list duplicated the daily itinerary section
            below and added clutter. Direct customers there for full
            day details. */}
      </div>
    </section>
  );
}

/**
 * Same RouteFlowFallback as before — used only when geocoding returns 0
 * mapped stops (rare with the Round 80.21 server fix that handles → and
 * tries multiple candidate queries).
 */
function RouteFlowFallback({
  stops,
  themeColor,
  isEN,
}: {
  stops: Array<{ day: number; name: string; lat: number; lng: number }>;
  themeColor: { primary: string; secondary?: string };
  isEN: boolean;
}) {
  const display = stops.slice(0, 14);
  return (
    <div className="aspect-[12/5] relative bg-gradient-to-br from-gray-50 via-white to-gray-50 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(circle, #1f2937 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
        aria-hidden
      />
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
        <span className="text-[10px] md:text-xs tracking-[0.3em] uppercase text-[#c9a563] font-semibold">
          {isEN ? "Journey Flow" : "行程動線"}
        </span>
        <span className="text-[10px] md:text-xs text-gray-400 font-medium">
          {isEN ? `${display.length} stops` : `${display.length} 站行程`}
        </span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center px-6 md:px-10 py-12">
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3 md:gap-x-3 md:gap-y-4 max-w-full">
          {display.map((s, idx) => {
            const isLast = idx === display.length - 1;
            return (
              <div key={idx} className="flex items-center gap-2 md:gap-3">
                <div
                  className="flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3 py-1 md:py-1.5 rounded-full bg-white border-2 shadow-sm"
                  style={{ borderColor: themeColor.primary }}
                >
                  <span
                    className="inline-flex items-center justify-center w-4 h-4 md:w-5 md:h-5 rounded-full text-[9px] md:text-[10px] font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: themeColor.primary }}
                  >
                    {s.day}
                  </span>
                  <span className="text-[11px] md:text-xs font-medium text-gray-800 truncate max-w-[120px] md:max-w-[180px]">
                    {s.name || (isEN ? `Day ${s.day}` : `第 ${s.day} 天`)}
                  </span>
                </div>
                {!isLast && (
                  <span
                    className="text-[#c9a563] text-sm md:text-base font-bold"
                    aria-hidden
                  >
                    →
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {stops.length > 14 && (
        <div className="absolute bottom-3 left-0 right-0 text-center">
          <span className="text-[10px] md:text-xs text-gray-400">
            {isEN
              ? `+${stops.length - 14} more stops below`
              : `下方還有 ${stops.length - 14} 站`}
          </span>
        </div>
      )}
    </div>
  );
}
