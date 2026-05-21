/**
 * TourDetailPeony / HotelCard.tsx
 *
 * Hotel card with full-detail dialog (gallery / amenities / room types /
 * reviews / contact). Includes `getFacilityIcons` + `parseStarRating`
 * helpers + `HotelDetail` type.
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
  Check,
  Star,
  Phone,
  Building,
  Utensils,
  Camera,
  Info,
  ChevronRight,
  ChevronLeft,
  Car,
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import type { getThemeColorByDestination } from "./helpers";

// 設施圖示映射
export const getFacilityIcons = (t: (key: string) => string): Record<string, { icon: React.ReactNode; label: string }> => ({
  wifi: { icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" /></svg>, label: 'WiFi' },
  pool: { icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>, label: t('tourDetail.facilityPool') },
  spa: { icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>, label: 'SPA' },
  gym: { icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" /></svg>, label: t('tourDetail.facilityGym') },
  restaurant: { icon: <Utensils className="h-4 w-4" />, label: t('tourDetail.facilityRestaurant') },
  bar: { icon: <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>, label: t('tourDetail.facilityBar') },
  parking: { icon: <Car className="h-4 w-4" />, label: t('tourDetail.facilityParking') },
  breakfast: { icon: <Utensils className="h-4 w-4" />, label: t('tourDetail.facilityBreakfast') },
  view: { icon: <Camera className="h-4 w-4" />, label: t('tourDetail.facilityView') },
  roomservice: { icon: <Building className="h-4 w-4" />, label: t('tourDetail.facilityRoomService') },
});

// 解析星級數字
export const parseStarRating = (stars: string | undefined): number => {
  if (!stars) return 0;
  if (stars.includes('五星') || stars.includes('5')) return 5;
  if (stars.includes('四星') || stars.includes('4')) return 4;
  if (stars.includes('三星') || stars.includes('3')) return 3;
  if (stars.includes('二星') || stars.includes('2')) return 2;
  if (stars.includes('一星') || stars.includes('1')) return 1;
  return 0;
};

// 飯店詳情資料類型
export interface HotelDetail {
  name: string;
  description?: string;
  location?: string;
  address?: string;
  phone?: string;
  website?: string;
  checkIn?: string;
  checkOut?: string;
  images?: string[];
  roomTypes?: {
    name: string;
    description: string;
    price?: string;
    image?: string;
  }[];
  amenities?: string[];
  reviews?: {
    author: string;
    rating: number;
    comment: string;
    date?: string;
  }[];
  rating?: number;
  totalReviews?: number;
}

// 飯店卡片組件 - 重新設計版（含彈窗功能）
export const HotelCard = ({ hotel, themeColor }: { hotel: any; themeColor: ReturnType<typeof getThemeColorByDestination> }) => {
  const { t } = useLocale();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const starRating = hotel.rating || parseStarRating(hotel.stars);
  const facilities = hotel.facilities || [];
  const facilityIcons = getFacilityIcons(t);

  // 解析飯店詳情資料
  const detail: HotelDetail | null = hotel.detail ?
    (typeof hotel.detail === 'string' ? JSON.parse(hotel.detail) : hotel.detail) : null;

  // 合併圖片源（detail.images 優先，否則使用 hotel.image）
  const images = detail?.images?.length ? detail.images : (hotel.image ? [hotel.image] : []);
  const hasImages = images.length > 0;

  // 飯店詳情彈窗
  const HotelDetailDialog = () => (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            {hotel.name}
            {starRating > 0 && (
              <span className="flex items-center gap-0.5 ml-2">
                {[...Array(starRating)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-[#c9a563] text-[#c9a563]" />
                ))}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* 圖片輪播 */}
        {hasImages && (
          <div className="relative aspect-video overflow-hidden rounded-xl mb-6">
            <img src={images[currentImageIndex]} alt={hotel.imageAlt || hotel.name} className="w-full h-full object-cover rounded-xl" />
            {images.length > 1 && (
              <>
                <button onClick={(e) => { e.stopPropagation(); setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length); }} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-lg p-2 transition-colors">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); setCurrentImageIndex((prev) => (prev + 1) % images.length); }} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-lg p-2 transition-colors">
                  <ChevronRight className="h-5 w-5" />
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, idx) => (
                    <button key={idx} onClick={(e) => { e.stopPropagation(); setCurrentImageIndex(idx); }} className={`w-2 h-2 rounded-lg transition-all ${idx === currentImageIndex ? 'bg-white w-4' : 'bg-white/50'}`} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {(detail?.rating || detail?.totalReviews) && (
          <div className="flex items-center gap-4 mb-4">
            {detail.rating && (
              <div className="flex items-center gap-1">
                <Star className="h-5 w-5 fill-[#c9a563] text-[#c9a563]" />
                <span className="font-bold text-lg">{detail.rating}</span>
              </div>
            )}
            {detail.totalReviews && (
              <span className="text-gray-500">{(t('tourDetail.reviewCount')).replace('{count}', String(detail.totalReviews))}</span>
            )}
          </div>
        )}

        {(detail?.address || hotel.location) && (hotel.location !== '待確認') && (
          <div className="flex items-center gap-2 text-gray-600 mb-4">
            <MapPin className="h-5 w-5" style={{ color: themeColor.secondary }} />
            <span className="text-lg">{detail?.address || hotel.location}</span>
          </div>
        )}

        {(detail?.checkIn || detail?.checkOut) && (
          <div className="flex items-center gap-6 mb-4 text-gray-600">
            {detail.checkIn && (<div className="flex items-center gap-2"><Clock className="h-4 w-4" style={{ color: themeColor.secondary }} /><span>{t('tourDetail.checkIn')}{detail.checkIn}</span></div>)}
            {detail.checkOut && (<div className="flex items-center gap-2"><Clock className="h-4 w-4" style={{ color: themeColor.secondary }} /><span>{t('tourDetail.checkOut')}{detail.checkOut}</span></div>)}
          </div>
        )}

        {(detail?.description || hotel.description) && (hotel.description !== '待確認') && (
          <div className="mb-6">
            <h4 className="font-semibold text-lg mb-2" style={{ color: themeColor.primary }}>{t('tourDetail.hotelIntroTitle')}</h4>
            <p className="text-gray-600 leading-relaxed">{detail?.description || hotel.description}</p>
          </div>
        )}

        {(detail?.amenities?.length || facilities.length > 0) && (
          <div className="mb-6">
            <h4 className="font-semibold text-lg mb-3" style={{ color: themeColor.primary }}>{t('tourDetail.hotelFacilities')}</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {(detail?.amenities || facilities).map((facility: string, idx: number) => {
                const facilityInfo = facilityIcons[facility.toLowerCase()];
                return (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <span className="p-2 rounded-lg" style={{ backgroundColor: themeColor.light, color: themeColor.secondary }}>
                      {facilityInfo?.icon || <Check className="h-4 w-4" />}
                    </span>
                    <span className="font-medium">{facilityInfo?.label || facility}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mb-6">
          <h4 className="font-semibold text-lg mb-3" style={{ color: themeColor.primary }}>{t('tourDetail.roomTypeInfo')}</h4>
          <div className="grid gap-3">
            {detail?.roomTypes?.length ? (
              detail.roomTypes.map((room, idx) => (
                <div key={idx} className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
                  {room.image && (<img src={room.image} alt={room.name} loading="lazy" decoding="async" className="w-24 h-16 object-cover rounded-xl flex-shrink-0" />)}
                  <div className="flex-grow"><p className="font-medium">{room.name}</p><p className="text-sm text-gray-500">{room.description}</p></div>
                  {room.price && (<div className="text-right flex-shrink-0"><p className="font-bold" style={{ color: themeColor.secondary }}>{room.price}</p></div>)}
                </div>
              ))
            ) : (
              <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
                <div><p className="font-medium">{t('tourDetail.standardRoom')}</p><p className="text-sm text-gray-500">{t('tourDetail.standardRoomDesc')}</p></div>
                <div className="text-right"><p className="text-sm text-gray-500">{t('tourDetail.perNight')}</p><p className="font-bold" style={{ color: themeColor.secondary }}>{t('tourDetail.includedInTour')}</p></div>
              </div>
            )}
          </div>
        </div>

        {detail?.reviews && detail.reviews.length > 0 && (
          <div className="mb-6">
            <h4 className="font-semibold text-lg mb-3" style={{ color: themeColor.primary }}>{t('tourDetail.reviews')}</h4>
            <div className="space-y-4">
              {detail.reviews.map((review, idx) => (
                <div key={idx} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gray-300 flex items-center justify-center text-white font-medium">{review.author.charAt(0)}</div>
                      <span className="font-medium">{review.author}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {[...Array(5)].map((_, i) => (<Star key={i} className={`h-4 w-4 ${i < review.rating ? 'fill-[#c9a563] text-[#c9a563]' : 'text-gray-300'}`} />))}
                    </div>
                  </div>
                  <p className="text-gray-600 text-sm">{review.comment}</p>
                  {review.date && (<p className="text-gray-400 text-xs mt-2">{review.date}</p>)}
                </div>
              ))}
            </div>
          </div>
        )}

        {(detail?.phone || detail?.website) && (
          <div className="mb-6 pt-4 border-t border-gray-100">
            <h4 className="font-semibold text-lg mb-3" style={{ color: themeColor.primary }}>{t('tourDetail.contactInfo')}</h4>
            <div className="space-y-2">
              {detail.phone && (<div className="flex items-center gap-2 text-gray-600"><Phone className="h-4 w-4" style={{ color: themeColor.secondary }} /><span>{detail.phone}</span></div>)}
              {detail.website && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Building className="h-4 w-4" style={{ color: themeColor.secondary }} />
                  <a href={detail.website} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: themeColor.secondary }}>{t('tourDetail.officialWebsite')}</a>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-500 flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{t('tourDetail.hotelDisclaimer')}</span>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
    <div className="bg-white overflow-hidden rounded-xl shadow-lg hover:shadow-lg transition-all duration-300 group cursor-pointer card-hover-scale" onClick={() => setIsDialogOpen(true)}>
      <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-gradient-to-br from-[#FAF8F2] to-[#E5D4A8]/40">
        {hotel.image ? (
          <img
            src={hotel.image}
            alt={hotel.imageAlt || hotel.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 rounded-xl"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center px-6 text-center">
            <Building className="h-10 w-10 text-[#c9a563]/60 mb-2" />
            <p
              className={`font-serif font-bold text-foreground/80 leading-tight line-clamp-2 ${
                (hotel.name?.length || 0) > 25 ? 'text-sm md:text-base' : 'text-base md:text-lg'
              }`}
              title={hotel.name}
            >
              {hotel.name}
            </p>
            {starRating > 0 && (
              <div className="flex items-center gap-0.5 mt-2">
                {Array.from({ length: Math.min(starRating, 5) }).map((_, i) => (
                  <Star key={i} className="h-3 w-3 fill-[#c9a563] text-[#c9a563]" />
                ))}
              </div>
            )}
          </div>
        )}
        {starRating > 0 && (
          <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-sm px-3 py-1.5 flex items-center gap-1 shadow-md rounded-md">
            {[...Array(starRating)].map((_, i) => (<Star key={i} className="h-3.5 w-3.5 fill-[#c9a563] text-[#c9a563]" />))}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </div>

      <div className="p-6">
        <h3
          className={`font-bold mb-2 text-gray-900 group-hover:text-primary transition-colors leading-snug ${
            (hotel.name?.length || 0) > 28 ? 'text-base md:text-lg' : 'text-xl'
          }`}
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          title={hotel.name}
        >
          {hotel.name}
        </h3>

        {starRating > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-0.5">
              {Array.from({ length: Math.min(starRating, 5) }).map((_, i) => (
                <Star key={i} className="h-3.5 w-3.5 fill-[#c9a563] text-[#c9a563]" />
              ))}
            </div>
            <span className="text-xs text-gray-500 font-medium">
              {hotel.starsLabel || `${starRating} 星級`}
            </span>
            {hotel.brand && (<span className="text-xs text-gray-400 truncate">· {hotel.brand}</span>)}
          </div>
        )}

        {hotel.location && hotel.location !== '待確認' && (
          <p className="text-sm text-gray-500 mb-3 flex items-start gap-1.5">
            <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
            <span className="line-clamp-2">{hotel.location}</span>
          </p>
        )}

        {hotel.description && hotel.description !== '待確認' && (
          <p className="text-gray-600 text-sm leading-relaxed mb-4 line-clamp-3">{hotel.description}</p>
        )}

        {facilities.length > 0 && (
          <div className="pt-4 border-t border-gray-100">
            <div className="flex flex-wrap gap-3">
              {facilities.slice(0, 6).map((facility: string, idx: number) => {
                const facilityInfo = facilityIcons[facility.toLowerCase()];
                if (!facilityInfo) return null;
                return (
                  <div key={idx} className="flex items-center gap-1.5 text-gray-500 text-xs" title={facilityInfo.label}>
                    <span style={{ color: themeColor.secondary }}>{facilityInfo.icon}</span>
                    <span>{facilityInfo.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
    <HotelDetailDialog />
    </>
  );
};
