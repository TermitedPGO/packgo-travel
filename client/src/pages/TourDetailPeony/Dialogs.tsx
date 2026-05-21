/**
 * TourDetailPeony / Dialogs.tsx
 *
 * Detail dialogs reused across the page (Attraction + Meal). Their data
 * shapes (`AttractionDetail`, `MealDetail`) are re-exported from
 * `./helpers` for orchestrator + section files.
 *
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MapPin,
  Clock,
  Star,
  Phone,
  Utensils,
  AlertCircle,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Ticket,
  ExternalLink,
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import type {
  MealDetail,
  AttractionDetail,
  getThemeColorByDestination,
} from "./helpers";

// 景點詳情彈窗組件
export const AttractionDetailDialog = ({
  isOpen,
  onClose,
  detail,
  themeColor
}: {
  isOpen: boolean;
  onClose: () => void;
  detail: AttractionDetail | null;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
}) => {
  const { t } = useLocale();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  if (!detail) return null;

  const images = detail.images || [];
  const hasImages = images.length > 0;
  const name = detail.name || detail.title || t('tourDetail.attraction');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold" style={{ color: themeColor.primary }}>{name}</DialogTitle>
        </DialogHeader>

        {hasImages && (
          <div className="relative aspect-[16/9] rounded-xl overflow-hidden mb-4">
            <img src={images[currentImageIndex]} alt={name} loading="lazy" decoding="async" className="w-full h-full object-cover rounded-xl" />
            {images.length > 1 && (
              <>
                <button onClick={() => setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-lg p-2 transition-colors">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button onClick={() => setCurrentImageIndex((prev) => (prev + 1) % images.length)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-lg p-2 transition-colors">
                  <ChevronRight className="h-5 w-5" />
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, idx) => (
                    <button key={idx} onClick={() => setCurrentImageIndex(idx)} className={`w-2 h-2 rounded-lg transition-all ${idx === currentImageIndex ? 'bg-white w-4' : 'bg-white/50'}`} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            {detail.rating && (
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-[#c9a563] text-[#c9a563]" />
                <span className="font-medium">{detail.rating}</span>
              </div>
            )}
            {detail.duration && (
              <div className="flex items-center gap-1 text-gray-600">
                <Clock className="h-4 w-4" style={{ color: themeColor.secondary }} />
                <span>{t('tourDetail.suggestedVisit')}{detail.duration}</span>
              </div>
            )}
          </div>

          {detail.description && (
            <div>
              <h4 className="font-semibold text-gray-900 mb-2">{t('tourDetail.attractionIntro')}</h4>
              <p className="text-gray-600 leading-relaxed">{detail.description}</p>
            </div>
          )}

          {detail.highlights && detail.highlights.length > 0 && (
            <div>
              <h4 className="font-semibold text-gray-900 mb-2">{t('tourDetail.highlights')}</h4>
              <div className="grid grid-cols-1 gap-2">
                {detail.highlights.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-gray-600">
                    <Sparkles className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {detail.openingHours && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <Clock className="h-4 w-4" style={{ color: themeColor.secondary }} />
                  {t('tourDetail.openingHours')}
                </h4>
                <p className="text-gray-600 text-sm">{detail.openingHours}</p>
              </div>
            )}
            {(detail.ticketPrice || detail.ticketInfo) && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <Ticket className="h-4 w-4" style={{ color: themeColor.secondary }} />
                  {t('tourDetail.ticketInfo')}
                </h4>
                <p className="text-gray-600 text-sm">{detail.ticketPrice || detail.ticketInfo}</p>
              </div>
            )}
          </div>

          {detail.tips && detail.tips.length > 0 && (
            <div className="bg-[#FAF8F2] border-l-4 border-[#c9a563] rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" style={{ color: themeColor.secondary }} />
                {t('tourDetail.travelTips')}
              </h4>
              <ul className="space-y-1">
                {detail.tips.map((tip, idx) => (
                  <li key={idx} className="text-foreground/80 text-sm flex items-start gap-2">
                    <span style={{ color: themeColor.secondary }}>•</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-4 border-t border-gray-100 space-y-2">
            {detail.address && (
              <div className="flex items-start gap-2 text-gray-600">
                <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
                <span>{detail.address}</span>
              </div>
            )}
            {detail.phone && (
              <div className="flex items-center gap-2 text-gray-600">
                <Phone className="h-4 w-4 flex-shrink-0" style={{ color: themeColor.secondary }} />
                <span>{detail.phone}</span>
              </div>
            )}
            {detail.website && (
              <div className="flex items-center gap-2">
                <ExternalLink className="h-4 w-4 flex-shrink-0" style={{ color: themeColor.secondary }} />
                <a href={detail.website} target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2 hover:text-[#8a6f3a] transition-colors">{t('tourDetail.officialWebsite')}</a>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// 餐廳詳情彈窗組件
export const MealDetailDialog = ({
  isOpen,
  onClose,
  detail,
  themeColor
}: {
  isOpen: boolean;
  onClose: () => void;
  detail: MealDetail | null;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
}) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const { t } = useLocale();

  if (!detail) return null;

  const images = detail.images || [];
  const hasImages = images.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold" style={{ color: themeColor.primary }}>{detail.name}</DialogTitle>
        </DialogHeader>

        {hasImages && (
          <div className="relative aspect-[16/9] rounded-xl overflow-hidden mb-4">
            <img src={images[currentImageIndex]} alt={detail.name} loading="lazy" decoding="async" className="w-full h-full object-cover rounded-xl" />
            {images.length > 1 && (
              <>
                <button onClick={() => setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-lg p-2 transition-colors">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button onClick={() => setCurrentImageIndex((prev) => (prev + 1) % images.length)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-lg p-2 transition-colors">
                  <ChevronRight className="h-5 w-5" />
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, idx) => (
                    <button key={idx} onClick={() => setCurrentImageIndex(idx)} className={`w-2 h-2 rounded-lg transition-all ${idx === currentImageIndex ? 'bg-white w-4' : 'bg-white/50'}`} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            {detail.rating && (
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-[#c9a563] text-[#c9a563]" />
                <span className="font-medium">{detail.rating}</span>
              </div>
            )}
            {detail.priceRange && (
              <div className="text-gray-600">
                <span className="font-medium">{t('tourDetail.priceRangeLabel')}</span>{detail.priceRange}
              </div>
            )}
          </div>

          {detail.description && (
            <div>
              <h4 className="font-semibold text-gray-900 mb-2">{t('tourDetail.restaurantIntro')}</h4>
              <p className="text-gray-600 leading-relaxed">{detail.description}</p>
            </div>
          )}

          {detail.menu && detail.menu.length > 0 && (
            <div>
              <h4 className="font-semibold text-gray-900 mb-2">{t('tourDetail.recommendedDishes')}</h4>
              <div className="grid grid-cols-2 gap-2">
                {detail.menu.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-gray-600">
                    <Utensils className="h-4 w-4" style={{ color: themeColor.secondary }} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-gray-100">
            {detail.address && (
              <div className="flex items-start gap-2 text-gray-600 mb-2">
                <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
                <span>{detail.address}</span>
              </div>
            )}
            {detail.phone && (
              <div className="flex items-center gap-2 text-gray-600">
                <Phone className="h-4 w-4 flex-shrink-0" style={{ color: themeColor.secondary }} />
                <span>{detail.phone}</span>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
