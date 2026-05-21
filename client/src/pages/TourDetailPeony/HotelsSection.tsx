/**
 * TourDetailPeony / HotelsSection.tsx
 *
 * Hotels listing section — v78t dynamic grid for sparse cases.
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { HotelCard, type getThemeColorByDestination } from "./helpers";

export type HotelsSectionProps = {
  hotels: any[];
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  sectionRef: React.RefObject<HTMLElement | null>;
};

export default function HotelsSection({
  hotels,
  themeColor,
  sectionRef,
}: HotelsSectionProps) {
  const { t } = useLocale();

  if (hotels.length === 0) {
    return null;
  }

  return (
    <section ref={sectionRef} id="hotels" className="py-16 lg:py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-center mb-4" style={{ color: themeColor.primary }}>
          {t('tourDetail.luxuryHotel')}
        </h2>
        <p className="text-lg text-gray-700 text-center mb-12">{t('tourDetail.hotelDesc')}</p>

        {/* v78t: dynamic grid — sparse cases (1-2 hotels) get more-balanced layout */}
        <div className={`grid gap-8 ${
          hotels.length === 1
            ? 'grid-cols-1 max-w-2xl mx-auto'
            : hotels.length === 2
              ? 'md:grid-cols-2 max-w-5xl mx-auto'
              : 'md:grid-cols-2 lg:grid-cols-3'
        }`}>
          {hotels.map((hotel: any, index: number) => (
            <HotelCard key={index} hotel={hotel} themeColor={themeColor} />
          ))}
        </div>
      </div>
    </section>
  );
}
