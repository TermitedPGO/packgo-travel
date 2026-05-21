/**
 * TourDetailPeony / ItinerarySection.tsx
 *
 * Itinerary Section - Zigzag Layout. Day-by-day timeline cards via DayCard.
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React from "react";
import { Info } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { EditableDayCard } from "@/components/inline-edit";
import { DayCard, type MealDetail, type getThemeColorByDestination } from "./helpers";

export type ItinerarySectionProps = {
  tour: any;
  tourId?: number;
  displayItinerary: any[];
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  sectionRef: React.RefObject<HTMLElement | null>;
  isEditMode: boolean;
  expandedDays: Set<number>;
  language: string;
  toggleDay: (dayNum: number) => void;
  setExpandedDays: (s: Set<number>) => void;
  handleShowMealDetail: (detail: MealDetail) => void;
  handleShowAttractionDetail: (activity: any) => void;
  updateField: (field: string, value: any) => void;
};

export default function ItinerarySection({
  tour,
  tourId,
  displayItinerary,
  themeColor,
  sectionRef,
  isEditMode,
  expandedDays,
  language,
  toggleDay,
  setExpandedDays,
  handleShowMealDetail,
  handleShowAttractionDetail,
  updateField,
}: ItinerarySectionProps) {
  const { t } = useLocale();

  return (
    <section ref={sectionRef} id="itinerary" className="py-16 lg:py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-center mb-4" style={{ color: themeColor.primary }}>
          {t('tourDetail.itineraryHighlights')}
        </h2>
        <p className="text-lg text-gray-700 text-center mb-8">{t('tourDetail.dailyItineraryDesc')}</p>

        {/* v78n Sprint 6C: expand/collapse all toggle */}
        {displayItinerary.length > 1 && (
          <div className="flex justify-center mb-12">
            <button
              onClick={() => {
                if (expandedDays.size >= displayItinerary.length) {
                  setExpandedDays(new Set([0]));
                } else {
                  setExpandedDays(new Set(displayItinerary.map((_: any, i: number) => i)));
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-gray-300 hover:border-gray-400 text-sm text-gray-700 hover:text-gray-900 transition-colors"
              style={{ borderColor: themeColor.primary, color: themeColor.primary }}
            >
              {expandedDays.size >= displayItinerary.length
                ? (language === "en" ? "Collapse all" : "全部收合")
                : (language === "en" ? "Expand all days" : `展開全部 ${displayItinerary.length} 天`)}
            </button>
          </div>
        )}

        {/* Daily Itinerary */}
        <div className="space-y-24">
          {displayItinerary.length > 0 ? (
            displayItinerary.map((day: any, index: number) => {
              // Round 80.21 v24: each day wrapped with id="day-N" so
              // the route-map chips below the map can scrollIntoView
              // here. scroll-mt-24 leaves room for the sticky header.
              const dayNum =
                typeof day?.day === "number" ? day.day : index + 1;
              return (
              <div
                key={index}
                id={`day-${dayNum}`}
                className="scroll-mt-28 transition-shadow rounded-xl"
              >
              {isEditMode ? (
                <EditableDayCard
                  day={day}
                  index={index}
                  isEditMode={isEditMode}
                  onUpdate={(updatedDay) => {
                    const newItinerary = [...displayItinerary];
                    newItinerary[index] = updatedDay;
                    updateField('itineraryDetailed', newItinerary);
                  }}
                  tourId={tourId}
                  themeColor={themeColor}
                />
              ) : (
                <DayCard
                  day={day}
                  index={index}
                  themeColor={themeColor}
                  isExpanded={expandedDays.has(index)}
                  onToggle={() => toggleDay(index)}
                  onShowMealDetail={handleShowMealDetail}
                  onShowAttractionDetail={handleShowAttractionDetail}
                  destinationCountry={tour?.destinationCountry}
                />
              )}
              </div>
              );
            })
          ) : (
            <div className="text-center py-12 text-gray-700">
              <Info className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>{t('tourDetail.itineraryComingSoon')}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
