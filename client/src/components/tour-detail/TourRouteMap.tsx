/**
 * TourRouteMap — v78o Sprint 7: tour route map for the detail page.
 *
 * Why a static map (not interactive Google Maps):
 *   - Client-side Maps requires an exposed API key. Our existing key is
 *     server-side only.
 *   - Static maps render as a single <img>, work everywhere, and our PROD
 *     server already has GOOGLE_API_KEY for geocoding the itinerary.
 *   - "Open in Google Maps" link gives users full interactivity if they want it.
 *
 * Server-side flow (in `server/routers.ts → tours.getRouteMap`):
 *   1. Read tour itinerary
 *   2. Geocode each day's `location/city/title` using Google Geocoding API
 *   3. Build a Google Static Maps URL with numbered markers + connecting polyline
 *   4. Return URL + stop list (with lat/lng) for legend rendering
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Map as MapIcon, ExternalLink, Loader2 } from "lucide-react";

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
  themeColor: { primary: string; secondary?: string };
}

export default function TourRouteMap({ tourId, itinerary, themeColor }: Props) {
  const { language } = useLocale();
  const isEN = language === "en";
  const [imgFailed, setImgFailed] = useState(false);

  const { data, isLoading } = trpc.tours.getRouteMap.useQuery(
    { id: tourId },
    {
      enabled: tourId > 0,
      staleTime: 60 * 60 * 1000, // 1 hour client cache
      refetchOnWindowFocus: false,
    }
  );

  if (!Array.isArray(itinerary) || itinerary.length === 0) return null;

  const stops = data?.stops ?? [];
  const staticMapUrl = imgFailed ? null : (data?.staticMapUrl ?? null);
  const directionsUrl = data?.directionsUrl ?? null;
  const validCount = stops.length;

  return (
    <section className="py-12 lg:py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold mb-1" style={{ color: themeColor.primary }}>
              <MapIcon className="inline-block h-6 w-6 mr-2 -mt-1" />
              {isEN ? "Tour Route" : "行程路線"}
            </h2>
            <p className="text-sm text-gray-500">
              {isEN
                ? `${itinerary.length}-day journey · ${validCount} mapped stops`
                : `${itinerary.length} 天行程．${validCount} 個地點`}
            </p>
          </div>
          {directionsUrl && (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium hover:bg-gray-50"
              style={{ borderColor: themeColor.primary, color: themeColor.primary }}
            >
              {isEN ? "Open in Google Maps" : "在 Google 地圖開啟"}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        <div className="relative rounded-2xl overflow-hidden border border-gray-200 shadow-sm bg-gray-100">
          {isLoading && (
            <div className="aspect-[12/5] flex items-center justify-center">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEN ? "Loading map…" : "正在載入地圖…"}
              </div>
            </div>
          )}
          {!isLoading && staticMapUrl && (
            <img
              src={staticMapUrl}
              alt={isEN ? "Tour route map" : "行程路線地圖"}
              loading="lazy"
              className="w-full h-auto block"
              onError={() => setImgFailed(true)}
            />
          )}
          {!isLoading && !staticMapUrl && (
            <div className="aspect-[12/5] flex flex-col items-center justify-center text-gray-400 p-6 text-center">
              <MapIcon className="h-10 w-10 mb-2" />
              <p className="text-sm">
                {isEN
                  ? "Map preview unavailable for this tour."
                  : "此行程暫無地圖預覽。"}
              </p>
            </div>
          )}
        </div>

        {/* Numbered legend of stops (matches the A/B/C labels on the static map) */}
        {validCount > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {stops.slice(0, 26).map((s, idx) => (
              <div
                key={idx}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-xs"
              >
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: themeColor.primary }}
                >
                  {String.fromCharCode(65 + idx)}
                </span>
                <span className="text-gray-700 font-medium">
                  {isEN ? `Day ${s.day}` : `第 ${s.day} 天`} · {s.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
