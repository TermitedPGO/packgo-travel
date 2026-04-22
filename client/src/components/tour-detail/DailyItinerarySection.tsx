/**
 * DailyItinerarySection Component
 * 每日行程區塊 - 重新設計：更易讀、更多照片、支援 Inline Editing
 */

import React, { useState } from "react";
import { 
  Clock, MapPin, Car, Utensils, Hotel, ChevronDown, ChevronUp,
  Camera, Sunrise, Sun, Moon
} from "lucide-react";
import { EditableText } from "./EditableText";
import { EditableImage } from "./EditableImage";
import { useEditMode } from "@/contexts/EditModeContext";
import { cn } from "@/lib/utils";
import { ensureReadableOnWhite } from "@/lib/colorUtils";
import { useLocale } from "@/contexts/LocaleContext";

export interface DailyActivity {
  time: string;
  title: string;
  description: string;
  transportation?: string;
  location?: string;
  image?: string;
  imageAlt?: string;
}

export interface DailyItinerary {
  day: number;
  title: string;
  subtitle?: string;
  heroImage?: string;
  activities: DailyActivity[];
  meals: {
    breakfast?: string;
    lunch?: string;
    dinner?: string;
  };
  accommodation?: string;
  accommodationImage?: string;
}

export interface DailyItinerarySectionProps {
  itineraries: DailyItinerary[];
  colorTheme: {
    primary: string;
    secondary: string;
    accent: string;
  };
  tourId?: number;
  onUpdate?: (field: string, value: string) => Promise<void>;
  onImageUpload?: (file: File, path: string) => Promise<string>;
}

export const DailyItinerarySection: React.FC<DailyItinerarySectionProps> = ({
  itineraries,
  colorTheme,
  tourId,
  onUpdate,
  onImageUpload,
}) => {
  const { isEditMode } = useEditMode();
  const { t } = useLocale();
  const [expandedDays, setExpandedDays] = useState<number[]>(
    itineraries.map((_, i) => i) // 預設全部展開
  );

  if (!itineraries || itineraries.length === 0) {
    return null;
  }

  const toggleDay = (dayIndex: number) => {
    setExpandedDays(prev => 
      prev.includes(dayIndex) 
        ? prev.filter(i => i !== dayIndex)
        : [...prev, dayIndex]
    );
  };

  const getMealIcon = (mealType: 'breakfast' | 'lunch' | 'dinner') => {
    switch (mealType) {
      case 'breakfast': return <Sunrise className="h-4 w-4" />;
      case 'lunch': return <Sun className="h-4 w-4" />;
      case 'dinner': return <Moon className="h-4 w-4" />;
    }
  };

  return (
    <section id="itinerary" className="w-full py-12 lg:py-16 bg-white">
      <div className="container mx-auto px-4">
        {/* 標題 */}
        <div className="text-center mb-10">
          <h2
            className="text-3xl lg:text-4xl font-serif font-bold mb-3"
            style={{ color: ensureReadableOnWhite(colorTheme.primary) }}
          >
            {t('tourDetail.sections.itinerary')}
          </h2>
          <p className="text-gray-600 max-w-2xl mx-auto">
            {t('tourDetail.sections.itinerarySubtitle')}
          </p>
        </div>

        {/* 行程列表 */}
        <div className="space-y-6">
          {itineraries.map((day, dayIndex) => {
            const isExpanded = expandedDays.includes(dayIndex);
            
            return (
              <div
                key={day.day}
                className="bg-gray-50 overflow-hidden rounded-xl shadow-sm hover:shadow-md transition-shadow"
              >
                {/* Day Header - 可點擊展開/收合 */}
                <button
                  onClick={() => toggleDay(dayIndex)}
                  className="w-full p-6 flex items-center gap-4 text-left hover:bg-gray-100 transition-colors"
                >
                  {/* Day Badge */}
                  <div
                    className="flex-shrink-0 w-16 h-16 rounded-lg flex flex-col items-center justify-center text-white font-bold shadow-md"
                    style={{ backgroundColor: colorTheme.accent }}
                  >
                    <span className="text-xs uppercase tracking-wide">Day</span>
                    <span className="text-2xl">{day.day}</span>
                  </div>

                  {/* Title & Subtitle */}
                  <div className="flex-1 min-w-0">
                    {isEditMode && onUpdate ? (
                      <EditableText
                        value={day.title}
                        onSave={async (newValue) => {
                          const updatedItineraries = [...itineraries];
                          updatedItineraries[dayIndex].title = newValue;
                          await onUpdate('itineraryDetailed', JSON.stringify(updatedItineraries));
                        }}
                        isEditable={isEditMode}
                        className="text-xl lg:text-2xl font-bold"
                        style={{ color: ensureReadableOnWhite(colorTheme.primary) }}
                        as="h3"
                      />
                    ) : (
                      <h3
                        className="text-xl lg:text-2xl font-bold truncate"
                        style={{ color: ensureReadableOnWhite(colorTheme.primary) }}
                      >
                        {day.title}
                      </h3>
                    )}
                    {day.subtitle && (
                      <p className="text-gray-600 mt-1 text-sm lg:text-base">
                        {day.subtitle}
                      </p>
                    )}
                  </div>

                  {/* Expand/Collapse Icon */}
                  <div className="flex-shrink-0 flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">
                      {isExpanded ? t('tourDetail.collapse') : t('tourDetail.readMore')}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="h-6 w-6 text-gray-900" />
                    ) : (
                      <ChevronDown className="h-6 w-6 text-gray-900" />
                    )}
                  </div>
                </button>

                {/* Day Content - 展開時顯示 */}
                {isExpanded && (
                  <div className="px-6 pb-6">
                    {/* Hero Image for the Day */}
                    {(day.heroImage || isEditMode) && (
                      <div className="mb-6">
                        {isEditMode && onImageUpload ? (
                          <EditableImage
                            src={day.heroImage || ""}
                            alt={`Day ${day.day} - ${day.title}`}
                            onUpload={async (file) => {
                              const url = await onImageUpload(file, `day-${day.day}-hero`);
                              const updatedItineraries = [...itineraries];
                              updatedItineraries[dayIndex].heroImage = url;
                              await onUpdate?.('itineraryDetailed', JSON.stringify(updatedItineraries));
                              return url;
                            }}
                            isEditable={isEditMode}
                            aspectRatio="16/9"
                            className="w-full rounded-lg shadow-md"
                          />
                        ) : day.heroImage ? (
                          <img
                            src={day.heroImage}
                            alt={`Day ${day.day} - ${day.title}`}
                            className="w-full aspect-[16/9] object-cover rounded-lg shadow-md"
                          />
                        ) : null}
                      </div>
                    )}

                    {/* Activities Grid */}
                    <div className="space-y-4">
                      {day.activities.map((activity, actIndex) => (
                        <div
                          key={actIndex}
                          className={cn(
                            "bg-white rounded-xl p-5 shadow-sm",
                            "flex flex-col lg:flex-row gap-4",
                            actIndex % 2 === 1 && "lg:flex-row-reverse" // Zigzag layout
                          )}
                        >
                          {/* Activity Image */}
                          {(activity.image || isEditMode) && (
                            <div className="lg:w-1/3 flex-shrink-0">
                              {isEditMode && onImageUpload ? (
                                <EditableImage
                                  src={activity.image || ""}
                                  alt={activity.imageAlt || activity.title}
                                  onUpload={async (file) => {
                                    const url = await onImageUpload(file, `day-${day.day}-activity-${actIndex}`);
                                    const updatedItineraries = [...itineraries];
                                    updatedItineraries[dayIndex].activities[actIndex].image = url;
                                    await onUpdate?.('itineraryDetailed', JSON.stringify(updatedItineraries));
                                    return url;
                                  }}
                                  isEditable={isEditMode}
                                  aspectRatio="4/3"
                                  className="w-full rounded-xl"
                                />
                              ) : activity.image ? (
                                <img
                                  src={activity.image}
                                  alt={activity.imageAlt || activity.title}
                                  className="w-full aspect-[4/3] object-cover rounded-xl"
                                />
                              ) : null}
                            </div>
                          )}

                          {/* Activity Content */}
                          <div className="flex-1">
                            {/* Time Badge */}
                            <div className="flex items-center gap-2 mb-3">
                              <div
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium"
                                style={{
                                  backgroundColor: colorTheme.accent + "15",
                                  color: colorTheme.accent,
                                }}
                              >
                                <Clock className="h-3.5 w-3.5" />
                                {activity.time}
                              </div>
                            </div>

                            {/* Title */}
                            {isEditMode && onUpdate ? (
                              <EditableText
                                value={activity.title}
                                onSave={async (newValue) => {
                                  const updatedItineraries = [...itineraries];
                                  updatedItineraries[dayIndex].activities[actIndex].title = newValue;
                                  await onUpdate('itineraryDetailed', JSON.stringify(updatedItineraries));
                                }}
                                isEditable={isEditMode}
                                className="text-lg font-bold mb-2"
                                style={{ color: ensureReadableOnWhite(colorTheme.primary) }}
                                as="h4"
                              />
                            ) : (
                              <h4
                                className="text-lg font-bold mb-2"
                                style={{ color: ensureReadableOnWhite(colorTheme.primary) }}
                              >
                                {activity.title}
                              </h4>
                            )}

                            {/* Description */}
                            {isEditMode && onUpdate ? (
                              <EditableText
                                value={activity.description}
                                onSave={async (newValue) => {
                                  const updatedItineraries = [...itineraries];
                                  updatedItineraries[dayIndex].activities[actIndex].description = newValue;
                                  await onUpdate('itineraryDetailed', JSON.stringify(updatedItineraries));
                                }}
                                isEditable={isEditMode}
                                multiline
                                className="text-gray-700 leading-relaxed"
                                as="p"
                              />
                            ) : (
                              <p className="text-gray-700 leading-relaxed mb-3">
                                {activity.description}
                              </p>
                            )}

                            {/* Location & Transportation */}
                            <div className="flex flex-wrap gap-3 mt-3">
                              {activity.location && (
                                <div className="inline-flex items-center gap-1.5 text-sm text-gray-600">
                                  <MapPin className="h-4 w-4" style={{ color: ensureReadableOnWhite(colorTheme.accent) }} />
                                  {activity.location}
                                </div>
                              )}
                              {activity.transportation && (
                                <div className="inline-flex items-center gap-1.5 text-sm text-gray-600">
                                  <Car className="h-4 w-4" style={{ color: ensureReadableOnWhite(colorTheme.accent) }} />
                                  {activity.transportation}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Meals & Accommodation Row */}
                    <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Meals Card */}
                      <div className="bg-white rounded-xl p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                          <Utensils className="h-5 w-5" style={{ color: ensureReadableOnWhite(colorTheme.accent) }} />
                          <h5 className="font-bold text-lg" style={{ color: ensureReadableOnWhite(colorTheme.primary) }}>
                            {t('tourDetail.todayMeals')}
                          </h5>
                        </div>
                        <div className="space-y-3">
                          {day.meals.breakfast && (
                            <div className="flex items-start gap-3">
                              <div className="flex-shrink-0 w-20 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                                {getMealIcon('breakfast')}
                                {t('tourPrint.breakfast')}
                              </div>
                              <p className="text-gray-700 flex-1">{day.meals.breakfast}</p>
                            </div>
                          )}
                          {day.meals.lunch && (
                            <div className="flex items-start gap-3">
                              <div className="flex-shrink-0 w-20 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                                {getMealIcon('lunch')}
                                {t('tourPrint.lunch')}
                              </div>
                              <p className="text-gray-700 flex-1">{day.meals.lunch}</p>
                            </div>
                          )}
                          {day.meals.dinner && (
                            <div className="flex items-start gap-3">
                              <div className="flex-shrink-0 w-20 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                                {getMealIcon('dinner')}
                                {t('tourPrint.dinner')}
                              </div>
                              <p className="text-gray-700 flex-1">{day.meals.dinner}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Accommodation Card */}
                      {day.accommodation && (
                        <div className="bg-white rounded-xl p-5 shadow-sm">
                          <div className="flex items-center gap-2 mb-4">
                            <Hotel className="h-5 w-5" style={{ color: ensureReadableOnWhite(colorTheme.accent) }} />
                            <h5 className="font-bold text-lg" style={{ color: ensureReadableOnWhite(colorTheme.primary) }}>
                              {t('tourDetail.tonightHotel')}
                            </h5>
                          </div>
                          <div className="flex gap-4">
                            {/* Accommodation Image */}
                            {(day.accommodationImage || isEditMode) && (
                              <div className="w-24 h-24 flex-shrink-0">
                                {isEditMode && onImageUpload ? (
                                  <EditableImage
                                    src={day.accommodationImage || ""}
                                    alt={day.accommodation}
                                    onUpload={async (file) => {
                                      const url = await onImageUpload(file, `day-${day.day}-hotel`);
                                      const updatedItineraries = [...itineraries];
                                      updatedItineraries[dayIndex].accommodationImage = url;
                                      await onUpdate?.('itineraryDetailed', JSON.stringify(updatedItineraries));
                                      return url;
                                    }}
                                    isEditable={isEditMode}
                                    aspectRatio="1/1"
                                    className="w-full h-full rounded-lg"
                                  />
                                ) : day.accommodationImage ? (
                                  <img
                                    src={day.accommodationImage}
                                    alt={day.accommodation}
                                    className="w-full h-full object-cover rounded-lg"
                                  />
                                ) : null}
                              </div>
                            )}
                            <div className="flex-1">
                              {isEditMode && onUpdate ? (
                                <EditableText
                                  value={day.accommodation}
                                  onSave={async (newValue) => {
                                    const updatedItineraries = [...itineraries];
                                    updatedItineraries[dayIndex].accommodation = newValue;
                                    await onUpdate('itineraryDetailed', JSON.stringify(updatedItineraries));
                                  }}
                                  isEditable={isEditMode}
                                  multiline
                                  className="text-gray-700"
                                  as="p"
                                />
                              ) : (
                                <p className="text-gray-700">{day.accommodation}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
