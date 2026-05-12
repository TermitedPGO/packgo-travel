/**
 * TourRouteMapHybrid — v358 dual-renderer with Google Maps primary +
 * SVG fallback.
 *
 * 2026-05-12 (Jeff): "你覺得地圖能到這個水準嗎?" (Google Maps B&W reference).
 * Honest answer was no — SVG plateaus around 75% of reference quality.
 * Decision: switch to Google Maps JS SDK with custom B&W style, keep
 * SVG (commit 5fa4b2a v357) as the production-safe fallback.
 *
 * Lifecycle:
 *   1. Try TourRouteMapGoogle. Needs VITE_GOOGLE_MAPS_API_KEY env.
 *   2. If the env is missing, or the script fails to load, or the API
 *      key is rejected by GCP, the Google component throws.
 *   3. ErrorBoundary catches and renders the SVG canvas instead. End
 *      user sees no visible degradation — just a different map style.
 *
 * Earlier deletion note in v356b said "TourRouteMapGoogle was removed";
 * we're bringing it back, much sharper than the v320 experiment.
 */

import { Component, lazy, Suspense, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

const GoogleVariant = lazy(() => import("./TourRouteMapGoogle"));
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

/**
 * Catches errors thrown by the Google variant (missing API key, script
 * load failure, API rejection) and renders the SVG variant in its place.
 * Logs once so ops can spot persistent fallback (which means the env is
 * mis-configured on Fly).
 */
class MapErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn(
      "[TourRouteMapHybrid] Google Maps variant failed, falling back to SVG:",
      error?.message ?? error
    );
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

const LoadingShell = () => (
  <div className="aspect-[12/5] flex items-center justify-center">
    <Loader2 className="h-5 w-5 animate-spin text-[#c9a563]" />
  </div>
);

export default function TourRouteMapHybrid(props: Props) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <MapErrorBoundary
        fallback={
          <Suspense fallback={<LoadingShell />}>
            <SvgVariant {...props} />
          </Suspense>
        }
      >
        <GoogleVariant
          stops={props.stops}
          themeColor={props.themeColor}
          outliers={props.outliers}
          destinationCountry={props.destinationCountry}
          highlightedDay={props.highlightedDay}
          onMarkerHover={props.onMarkerHover}
        />
      </MapErrorBoundary>
    </Suspense>
  );
}
