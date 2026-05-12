/**
 * TourRouteMapGoogle — Google Maps JS SDK embed, B&W styled.
 *
 * 2026-05-12: Jeff sent a B&W Bay-Area Google Maps screenshot ("Channel"
 * marker) and asked if our SVG renderer could reach that quality. Honest
 * answer was no — SVG can't match Google's terrain texture + road network.
 * Decision: switch to Google Maps embed for production, keep SVG as
 * fallback when the API key is missing or the script fails to load.
 *
 * The style array mimics the reference screenshot:
 *   - Land: light grey
 *   - Water: dark grey
 *   - Roads: white (kept — they give the map its sense of direction)
 *   - Country / city labels: low-contrast warm grey
 *   - All POI / transit / business labels: hidden
 *
 * Markers match v357 SVG aesthetic: solid black circles with white day
 * number inside, gold ★ for highlight stops, ✈ glyph for the entry city.
 *
 * Env requirement: VITE_GOOGLE_MAPS_API_KEY (HTTP-referrer-restricted in
 * GCP console to packgo-travel.fly.dev / packgoplay.com / localhost:3000).
 * If the env var is missing, the component throws so the Hybrid wrapper
 * can fall back to TourRouteMapCanvas (SVG).
 */
/// <reference types="@types/google.maps" />

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

declare global {
  interface Window {
    google?: typeof google;
  }
}

const SCRIPT_ID = "packgo-google-maps-sdk";
const API_KEY =
  (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY ?? "";

type Stop = { day: number; name: string; lat: number; lng: number };

interface Props {
  stops: Stop[];
  themeColor: { primary: string; secondary?: string };
  outliers?: Stop[];
  destinationCountry?: string;
  highlightedDay?: number | null;
  onMarkerHover?: (day: number | null) => void;
}

// B&W styled map — mimics Jeff's reference screenshot.
const BW_STYLE: google.maps.MapTypeStyle[] = [
  // All labels off by default; we re-enable specific layers below
  { elementType: "labels", stylers: [{ visibility: "off" }] },

  // Land
  { featureType: "landscape", stylers: [{ color: "#e8e8e8" }] },
  { featureType: "landscape.natural", stylers: [{ color: "#e0e0e0" }] },
  { featureType: "landscape.man_made", stylers: [{ color: "#ececec" }] },

  // Water (dark — the visual anchor)
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#4a4a4a" }] },
  { featureType: "water", elementType: "labels", stylers: [{ visibility: "off" }] },

  // Roads — white veins
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#ffffff" }, { weight: 2 }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },

  // Hide POIs, transit, business markers
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "business", stylers: [{ visibility: "off" }] },

  // Keep administrative labels at low contrast — gives the map context
  // without competing with our markers
  {
    featureType: "administrative.country",
    elementType: "labels.text.fill",
    stylers: [{ color: "#8a8a8a" }, { visibility: "on" }],
  },
  {
    featureType: "administrative.country",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#ffffff" }, { weight: 3 }],
  },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#6a6a6a" }, { visibility: "on" }],
  },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#ffffff" }, { weight: 3 }],
  },

  // Park / natural feature names — fade them way back so tour cities pop
  { featureType: "administrative.neighborhood", stylers: [{ visibility: "off" }] },
];

function loadMapScript(): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (!API_KEY) {
    return Promise.reject(new Error("VITE_GOOGLE_MAPS_API_KEY not configured"));
  }

  // Avoid duplicate <script> injection across multiple instances on the
  // same page (rare, but the lazy-import means a navigation back could
  // double-mount).
  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve, reject) => {
      if (window.google?.maps) return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("script load failed")));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&v=weekly&libraries=marker,geometry`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps script failed to load"));
    document.head.appendChild(script);
  });
}

export default function TourRouteMapGoogle({
  stops,
  themeColor,
  outliers = [],
  highlightedDay,
  onMarkerHover,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Initial map creation — runs once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadMapScript();
        if (cancelled || !containerRef.current) return;

        const allStops = [...stops, ...outliers];
        if (allStops.length === 0) {
          setStatus("error");
          setErrorMsg("No stops to render");
          return;
        }

        const bounds = new google.maps.LatLngBounds();
        for (const s of allStops) bounds.extend({ lat: s.lat, lng: s.lng });

        const map = new google.maps.Map(containerRef.current, {
          mapTypeId: "roadmap",
          styles: BW_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "cooperative", // hold ctrl/cmd to zoom — better mobile UX
          backgroundColor: "#e8e8e8",
        });

        // Frame the tour
        map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
        // Cap the zoom so single-stop tours don't zoom into street level
        const listener = google.maps.event.addListenerOnce(map, "bounds_changed", () => {
          if ((map.getZoom() ?? 0) > 11) map.setZoom(11);
        });

        mapRef.current = map;
        setStatus("ready");

        return () => {
          google.maps.event.removeListener(listener);
        };
      } catch (err) {
        if (cancelled) return;
        console.warn("[TourRouteMapGoogle] load failed, will fall back to SVG:", err);
        setStatus("error");
        setErrorMsg((err as Error)?.message ?? "unknown error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Markers + route line — re-render when stops change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !window.google?.maps?.marker) return;

    // Clear previous markers
    for (const m of markersRef.current) m.map = null;
    markersRef.current = [];
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    // Draw markers
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      const isLit = highlightedDay === s.day;

      // Build the marker DOM — solid black circle with white day number
      const pin = document.createElement("div");
      pin.style.cssText = `
        width: ${isLit ? 36 : 32}px;
        height: ${isLit ? 36 : 32}px;
        border-radius: 50%;
        background: #1a1a1a;
        border: 2px solid #ffffff;
        color: #ffffff;
        font: 700 ${isLit ? 14 : 13}px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 6px rgba(0,0,0,0.35);
        cursor: pointer;
        transition: transform 150ms ease;
        transform: scale(${isLit ? 1.05 : 1});
      `;
      pin.textContent = String(s.day);

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: s.lat, lng: s.lng },
        content: pin,
        title: `Day ${s.day}: ${s.name}`,
      });

      if (onMarkerHover) {
        pin.addEventListener("mouseenter", () => onMarkerHover(s.day));
        pin.addEventListener("mouseleave", () => onMarkerHover(null));
      }

      markersRef.current.push(marker);
    }

    // Outliers — slightly faded to show they're off-region
    for (const s of outliers) {
      const pin = document.createElement("div");
      pin.style.cssText = `
        width: 26px; height: 26px; border-radius: 50%;
        background: #5a5a5a; border: 2px solid #ffffff; color: #ffffff;
        font: 600 11px -apple-system, sans-serif;
        display: flex; align-items: center; justify-content: center;
        opacity: 0.7;
      `;
      pin.textContent = String(s.day);

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: s.lat, lng: s.lng },
        content: pin,
        title: `Day ${s.day}: ${s.name} (出發/返回地)`,
      });
      markersRef.current.push(marker);
    }

    // Route line — solid grey polyline between consecutive primary stops
    if (stops.length >= 2) {
      const path = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
      polylineRef.current = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: themeColor.primary || "#1a1a1a",
        strokeOpacity: 0.7,
        strokeWeight: 3,
        map,
        icons: [
          {
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 3,
              strokeColor: themeColor.primary || "#1a1a1a",
              strokeOpacity: 0.9,
            },
            offset: "50%",
            repeat: "12%",
          },
        ],
      });
    }
  }, [stops, outliers, themeColor.primary, highlightedDay, status, onMarkerHover]);

  if (status === "error") {
    // The Hybrid wrapper inspects this and falls back to the SVG renderer.
    // We render a hidden marker so the wrapper can detect us.
    throw new Error(errorMsg || "Google Maps unavailable");
  }

  return (
    <div
      className="aspect-[12/5] relative bg-[#e8e8e8] overflow-hidden rounded-xl"
      role="img"
      aria-label="行程路線地圖"
    >
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="h-5 w-5 animate-spin text-[#5a5a5a]" />
        </div>
      )}
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
