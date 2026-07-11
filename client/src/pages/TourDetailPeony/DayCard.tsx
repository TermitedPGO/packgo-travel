/**
 * TourDetailPeony / DayCard.tsx
 *
 * Per-day itinerary card (Zigzag layout). Includes MealCard sub-component
 * and per-destination Unsplash fallback photos.
 *
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React, { useState } from "react";
import {
  Clock,
  ChevronDown,
  ChevronUp,
  Coffee,
  UtensilsCrossed,
  Wine,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  ImageIcon,
  Ticket,
  Utensils,
  Building,
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import type { MealDetail, getThemeColorByDestination } from "./helpers";

/// 餐食卡片組件 - 統一高度設計
export const MealCard = ({
  type,
  name,
  images,
  themeColor,
  detail,
  onShowDetail
}: {
  type: 'breakfast' | 'lunch' | 'dinner';
  name: string;
  images?: string[];
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  detail?: MealDetail;
  onShowDetail?: (detail: MealDetail) => void;
}) => {
  const { t } = useLocale();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  // Round 80.8: meal config normalised to B&W + Gold.
  const mealConfig = {
    breakfast: { label: t('tourDetail.breakfast'), icon: Coffee, borderColor: 'border-foreground/15', bgColor: 'bg-foreground/[0.04]', textColor: 'text-foreground/75', iconBg: 'bg-[#c9a563]/15', hoverBg: 'hover:bg-foreground/[0.06]' },
    lunch: { label: t('tourDetail.lunch'), icon: UtensilsCrossed, borderColor: 'border-foreground/15', bgColor: 'bg-foreground/[0.04]', textColor: 'text-foreground/75', iconBg: 'bg-[#c9a563]/15', hoverBg: 'hover:bg-foreground/[0.06]' },
    dinner: { label: t('tourDetail.dinner'), icon: Wine, borderColor: 'border-foreground/15', bgColor: 'bg-foreground/[0.04]', textColor: 'text-foreground/75', iconBg: 'bg-[#c9a563]/15', hoverBg: 'hover:bg-foreground/[0.06]' }
  };

  const config = mealConfig[type];
  const IconComponent = config.icon;
  const hasImages = images && images.length > 0;
  const isSpecialMeal = name !== t('tourDetail.selfArranged') && name !== t('tourDetail.hotelMeal');

  const nextImage = () => { if (hasImages) setCurrentImageIndex((prev) => (prev + 1) % images.length); };
  const prevImage = () => { if (hasImages) setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length); };
  const handleClick = () => { if (isSpecialMeal && onShowDetail && detail) onShowDetail(detail); };

  return (
    <div
      className={`bg-white border ${config.borderColor} rounded-xl overflow-hidden transition-all duration-300 ${config.hoverBg} ${isSpecialMeal ? 'cursor-pointer hover:shadow-md' : ''} flex flex-col h-full`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      <div className="relative h-32 overflow-hidden rounded-lg bg-gray-100">
        {hasImages ? (
          <>
            <img
              src={images[currentImageIndex]}
              alt={name}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover transition-transform duration-500 rounded-xl"
              style={{ transform: isHovered ? 'scale(1.05)' : 'scale(1)' }}
            />
            {images.length > 1 && (
              <>
                <button onClick={(e) => { e.stopPropagation(); prevImage(); }} className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-lg p-1 transition-opacity" style={{ opacity: isHovered ? 1 : 0 }}>
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); nextImage(); }} className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-lg p-1 transition-opacity" style={{ opacity: isHovered ? 1 : 0 }}>
                  <ChevronRight className="h-3 w-3" />
                </button>
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-1">
                  {images.map((_, idx) => (
                    <div key={idx} className={`w-1.5 h-1.5 rounded-lg transition-all ${idx === currentImageIndex ? 'bg-white w-3' : 'bg-white/50'}`} />
                  ))}
                </div>
              </>
            )}
            {isSpecialMeal && (
              <div className="absolute top-2 right-2 bg-white backdrop-blur-sm rounded-lg px-2 py-0.5 shadow-md border border-gray-200">
                <span className="text-xs font-medium text-gray-800">{t('tourDetail.specialMeal')}</span>
              </div>
            )}
          </>
        ) : (
          <div className={`w-full h-full ${config.bgColor} flex items-center justify-center`}>
            <div className={`${config.iconBg} rounded-lg p-4`}>
              <IconComponent className={`h-8 w-8 ${config.textColor}`} />
            </div>
          </div>
        )}
      </div>

      <div className="p-3 text-center flex-1 flex flex-col justify-center">
        <div className={`text-sm ${config.textColor} font-semibold mb-1 flex items-center justify-center gap-1`}>
          <IconComponent className="h-4 w-4" />
          {config.label}
        </div>
        <div className="text-base text-gray-800 font-medium line-clamp-2">{name}</div>
        {hasImages && (
          <div className="mt-1 flex items-center justify-center gap-1 text-xs text-gray-400">
            <ImageIcon className="h-3 w-3" />
            <span>{(t('tourDetail.photoCount')).replace('{count}', String(images.length))}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// 每日行程卡片 - Zigzag 佈局
export const DayCard = ({
  day,
  index,
  themeColor,
  isExpanded,
  onToggle,
  onShowMealDetail,
  onShowAttractionDetail,
  destinationCountry,
}: {
  day: any;
  index: number;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  isExpanded: boolean;
  onToggle: () => void;
  onShowMealDetail: (detail: MealDetail) => void;
  onShowAttractionDetail: (activity: any) => void;
  destinationCountry?: string;
}) => {
  const { t } = useLocale();
  const isEven = index % 2 === 0;
  const [imgError, setImgError] = React.useState(false);
  // Stable Unsplash fallback photos per destination (verified real photo IDs)
  const DEST_FALLBACK_PHOTOS: Record<string, string[]> = {
    '日本': ['photo-1528360983277-13d401cdc186', 'photo-1493976040374-85c8e12f0c0e', 'photo-1545569341-9eb8b30979d9', 'photo-1528360983277-13d401cdc186', 'photo-1540959733332-eab4deabeeaf'],
    '韓國': ['photo-1517154421773-0529f29ea451', 'photo-1538485399081-7191377e8241', 'photo-1601042879364-f3947d3f9c16', 'photo-1517154421773-0529f29ea451', 'photo-1538485399081-7191377e8241'],
    '泰國': ['photo-1528181304800-259b08848526', 'photo-1552465011-b4e21bf6e79a', 'photo-1506665531195-3566af2b4dfa', 'photo-1528181304800-259b08848526', 'photo-1552465011-b4e21bf6e79a'],
    '越南': ['photo-1557750255-c76072a7aad1', 'photo-1583417319070-4a69db38a482', 'photo-1540611025311-01df3cef54b5', 'photo-1557750255-c76072a7aad1', 'photo-1583417319070-4a69db38a482'],
    '義大利': ['photo-1516483638261-f4dbaf036963', 'photo-1534445867742-43195f401b6c', 'photo-1555992336-03a23c7b20ee', 'photo-1516483638261-f4dbaf036963', 'photo-1534445867742-43195f401b6c'],
    '法國': ['photo-1502602898657-3e91760cbb34', 'photo-1499856871958-5b9627545d1a', 'photo-1431274172761-fca41d930114', 'photo-1502602898657-3e91760cbb34', 'photo-1499856871958-5b9627545d1a'],
    '英國': ['photo-1513635269975-59663e0ac1ad', 'photo-1486299267070-83823f5448dd', 'photo-1520986606214-8b456906c813', 'photo-1513635269975-59663e0ac1ad', 'photo-1486299267070-83823f5448dd'],
    '德國': ['photo-1467269204594-9661b134dd2b', 'photo-1560969184-10fe8719e047', 'photo-1467269204594-9661b134dd2b', 'photo-1560969184-10fe8719e047', 'photo-1467269204594-9661b134dd2b'],
    '瑞士': ['photo-1506905925346-21bda4d32df4', 'photo-1527668752968-14dc70a27c95', 'photo-1491555103944-7c647fd857e6', 'photo-1506905925346-21bda4d32df4', 'photo-1527668752968-14dc70a27c95'],
    '奧地利': ['photo-1516550893923-42d28e5677af', 'photo-1573599852326-2d4da0bbe613', 'photo-1516550893923-42d28e5677af', 'photo-1573599852326-2d4da0bbe613', 'photo-1516550893923-42d28e5677af'],
    '台灣': ['photo-1470004914212-05527e49370b', 'photo-1558618666-fcd25c85cd64', 'photo-1580674684081-7617fbf3d745', 'photo-1470004914212-05527e49370b', 'photo-1558618666-fcd25c85cd64'],
    '馬來西亞': ['photo-1596422846543-75c6fc197f07', 'photo-1508009603885-50cf7c579365', 'photo-1596422846543-75c6fc197f07', 'photo-1508009603885-50cf7c579365', 'photo-1596422846543-75c6fc197f07'],
    '柬埔寨': ['photo-1508009603885-50cf7c579365', 'photo-1583417319070-4a69db38a482', 'photo-1508009603885-50cf7c579365', 'photo-1583417319070-4a69db38a482', 'photo-1508009603885-50cf7c579365'],
    '冰島': ['photo-1476610182048-b716b8518aae', 'photo-1509773896068-7fd415d91e2e', 'photo-1531168556467-80aace0d0144', 'photo-1476610182048-b716b8518aae', 'photo-1509773896068-7fd415d91e2e'],
  };
  const DEFAULT_FALLBACK = ['photo-1488085061387-422e29b40080', 'photo-1469854523086-cc02fe5d8800', 'photo-1503220317375-aaad61436b1b', 'photo-1488085061387-422e29b40080', 'photo-1469854523086-cc02fe5d8800'];
  const fallbackPhotos = (destinationCountry && DEST_FALLBACK_PHOTOS[destinationCountry]) || DEFAULT_FALLBACK;
  const fallbackUrl = `https://images.unsplash.com/${fallbackPhotos[index % fallbackPhotos.length]}?w=800&q=80&fit=crop`;
  const primaryImage = day.image || day.imageUrl;
  const dayImage = (!imgError && primaryImage) ? primaryImage : fallbackUrl;

  return (
    <div className="relative animate-fade-in" style={{ animationDelay: `${index * 100}ms` }}>
      <div className="absolute left-1/2 -translate-x-1/2 -top-5 z-10 px-6 py-2 text-base font-bold tracking-wider bg-white border-2 shadow-md rounded-lg" style={{ color: themeColor.primary, borderColor: themeColor.primary }}>
        DAY {day.day || index + 1}
      </div>

      <div className={`flex flex-col ${isEven ? 'md:flex-row' : 'md:flex-row-reverse'} gap-0 bg-white`}>
        <div className="md:w-1/2 aspect-[4/3] md:aspect-auto overflow-hidden rounded-xl img-hover-zoom">
          <img
            src={dayImage}
            alt={day.title || `Day ${index + 1}`}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover transition-transform duration-700 rounded-xl"
            onError={() => setImgError(true)}
          />
        </div>

        <div className="md:w-1/2 p-5 sm:p-8 md:p-12 flex flex-col justify-center">
          <h3 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold mb-3 md:mb-4 leading-snug break-words" style={{ color: themeColor.primary }}>
            {day.title || day.location || `${t('tourDetail.day')} ${index + 1}`}
          </h3>

          {(day.description || day.summary) && (
            <p className="text-lg text-gray-600 leading-relaxed mb-6">{day.description || day.summary}</p>
          )}

          {day.activities && day.activities.length > 0 && (
            <div className="space-y-3 mb-6">
              {day.activities.slice(0, isExpanded ? undefined : 3).map((activity: any, actIndex: number) => (
                <div
                  key={actIndex}
                  className="flex items-start gap-3 cursor-pointer group hover:bg-gray-50 rounded-lg p-2 -ml-2 transition-colors"
                  onClick={() => onShowAttractionDetail(activity)}
                >
                  <div className="w-3 h-3 rounded-lg mt-2 flex-shrink-0 group-hover:scale-125 transition-transform" style={{ backgroundColor: themeColor.primary }} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-lg group-hover:underline">{activity.title || activity.name}</span>
                      <ChevronRight className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    {activity.description && isExpanded && (<p className="text-base text-gray-700 mt-1 line-clamp-2">{activity.description}</p>)}
                    {(activity.duration || activity.ticketPrice || activity.openingHours) && (
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-600">
                        {activity.duration && (<span className="flex items-center gap-1"><Clock className="h-3 w-3" />{activity.duration}</span>)}
                        {activity.ticketPrice && (<span className="flex items-center gap-1"><Ticket className="h-3 w-3" />{activity.ticketPrice}</span>)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {day.activities && day.activities.length > 0 && (
            <button onClick={onToggle} className="flex items-center gap-2 text-base font-bold transition-colors text-gray-900 hover:text-black">
              {isExpanded ? (<>{t('tourDetail.collapse')} <ChevronUp className="h-4 w-4" /></>) : (<>{t('tourDetail.readMore')} <ChevronDown className="h-4 w-4" /></>)}
            </button>
          )}

          {day.meals && (day.meals.breakfast || day.meals.lunch || day.meals.dinner) && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <h4 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Utensils className="h-5 w-5" style={{ color: themeColor.primary }} />
                {t('tourDetail.todayMeals')}
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <MealCard type="breakfast" name={day.meals.breakfast || t('tourDetail.selfArranged')} images={day.meals.breakfastImages} themeColor={themeColor} detail={day.meals.breakfastDetail} onShowDetail={onShowMealDetail} />
                <MealCard type="lunch" name={day.meals.lunch || t('tourDetail.selfArranged')} images={day.meals.lunchImages} themeColor={themeColor} detail={day.meals.lunchDetail} onShowDetail={onShowMealDetail} />
                <MealCard type="dinner" name={day.meals.dinner || t('tourDetail.selfArranged')} images={day.meals.dinnerImages} themeColor={themeColor} detail={day.meals.dinnerDetail} onShowDetail={onShowMealDetail} />
              </div>
            </div>
          )}

          {/* Accommodation — Round 80.20 redesign:
              Old: `flex items-center gap-2` inline → label "今晚住宿:" got
              squeezed to 1 char/line whenever the hotel string was long
              ("RADISSON HOTEL ZURICH AIRPORT 或 Mercure Zurich City 或 …")
              because flex didn't wrap and the label had no flex-shrink-0.
              New: stacked card layout. We parse the 「或」 separator into a
              clean bullet list, treat trailing 「同級」 as a footnote
              ("或同級飯店"), and use the meals-section eyebrow style for
              consistency. No more vertical-text squeeze, multi-option lists
              read like a brand-grade itinerary instead of a debug print. */}
          {day.accommodation && (() => {
            const raw = String(day.accommodation).trim();
            const parts = raw.split(/\s*或\s*/g).map((p) => p.trim()).filter(Boolean);
            const trailingSimilar = parts.length > 1 && /^同級$/.test(parts[parts.length - 1]);
            const hotels = trailingSimilar ? parts.slice(0, -1) : parts;
            const isMulti = hotels.length > 1;
            return (
              <div className="mt-6 pt-6 border-t border-gray-100">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h4 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                    <Building className="h-5 w-5" style={{ color: themeColor.primary }} />
                    {t('tourDetail.tonightHotel')}
                  </h4>
                  {isMulti && (<span className="text-[10px] md:text-xs tracking-[0.2em] uppercase text-[#80652D] font-semibold">{t('tourDetail.accommodationOptions')}</span>)}
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
                  {isMulti ? (
                    <ul className="space-y-2">
                      {hotels.map((hotel, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm md:text-base text-gray-800">
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#c9a563] flex-shrink-0" aria-hidden />
                          <span className="leading-relaxed">{hotel}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm md:text-base text-gray-800 leading-relaxed">{hotels[0] || raw}</p>
                  )}
                  {trailingSimilar && (<p className="text-xs text-gray-500 mt-3 pl-4">{t('tourDetail.orSimilar')}</p>)}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
