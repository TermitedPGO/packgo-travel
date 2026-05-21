/**
 * TourDetailPeony / RouteMapSection.tsx
 *
 * v78o: Tour Route Map — server-side geocode + Google Static Map.
 * Round 80.20: wrapped in <section id="routemap"> with sectionRefs
 * so sticky nav can scroll to it. Without the wrapper the section
 * rendered but had no anchor — clicking 「行程路線」 in the tab bar
 * did nothing.
 *
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React from "react";
import TourRouteMap from "@/components/tour-detail/TourRouteMapSvg";
import type { getThemeColorByDestination } from "./helpers";

export type RouteMapSectionProps = {
  tour: any;
  displayItinerary: any[];
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  sectionRef: React.RefObject<HTMLElement | null>;
};

export default function RouteMapSection({
  tour,
  displayItinerary,
  themeColor,
  sectionRef,
}: RouteMapSectionProps) {
  if (!(displayItinerary && displayItinerary.length > 0 && tour.id)) {
    return null;
  }

  return (
    <section ref={sectionRef} id="routemap">
      <TourRouteMap
        tourId={tour.id}
        itinerary={displayItinerary}
        destinationCountry={tour.destinationCountry || undefined}
        departureCity={tour.departureCity || undefined}
        tourTitle={tour.title || undefined}
        themeColor={themeColor}
      />
    </section>
  );
}
