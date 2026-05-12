/**
 * TourRouteMapHybrid — v356b (post-orphan-cleanup).
 *
 * Per Jeff's 雄獅 reference (illustrated travel-magazine map style),
 * the SVG topojson renderer is the only renderer. This component
 * exists purely as a lazy-import boundary so the SVG canvas + its
 * world-atlas TopoJSON (~108KB parsed) only load when the tour-
 * detail page actually scrolls to the map section.
 *
 * Earlier experiments (TourRouteMapGoogle / TourRouteMapMapLibre)
 * were deleted in the v356b cleanup pass — they were unimported
 * orphans from v320/v321 evaluation rounds.
 */

import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const SvgVariant = lazy(() => import("./TourRouteMapCanvas"));

interface Props {
  stops: Array<{ day: number; name: string; lat: number; lng: number }>;
  themeColor: { primary: string; secondary?: string };
  outliers?: Array<{ day: number; name: string; lat: number; lng: number }>;
  staticMapUrl?: string | null;
  departureCity?: string;
  tourTitle?: string;
  destinationCountry?: string;
  highlightedDay?: number | null;
  onMarkerHover?: (day: number | null) => void;
}

export default function TourRouteMapHybrid(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="aspect-[12/5] flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[#c9a563]" />
        </div>
      }
    >
      <SvgVariant {...props} />
    </Suspense>
  );
}
