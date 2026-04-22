/**
 * TourPrintView.tsx
 * 專屬列印/PDF 版行程頁面
 * 設計特點：
 * - A4 紙張專用排版 (210mm x 297mm)
 * - 專業旅行社行程表風格
 * - 清晰的分頁控制
 * - 適合列印和 PDF 下載
 */

import React, { useEffect, useState, useRef } from "react";
import { LoadingPage } from "@/components/ui/spinner";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { translateDestination } from "@/utils/locationMapping";
import { 
  Printer,
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  Users,
  Utensils,
  Building,
  Check,
  X,
  Phone,
  Mail,
  Globe
} from "lucide-react";

// 解析 JSON 字串
const parseJSON = (str: string | null | undefined, defaultValue: any = null) => {
  if (!str) return defaultValue;
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
};

// 根據目的地獲取主題色
const getThemeColor = (country: string) => {
  const countryLower = country?.toLowerCase() || "";
  
  if (countryLower.includes("日本") || countryLower.includes("japan")) {
    return { primary: "#BE185D", secondary: "#EC4899", light: "#FDF2F8" };
  }
  if (countryLower.includes("韓國") || countryLower.includes("korea")) {
    return { primary: "#1E40AF", secondary: "#3B82F6", light: "#EFF6FF" };
  }
  if (countryLower.includes("泰國") || countryLower.includes("thailand")) {
    return { primary: "#B45309", secondary: "#F59E0B", light: "#FFFBEB" };
  }
  if (countryLower.includes("歐洲") || countryLower.includes("europe")) {
    return { primary: "#0F766E", secondary: "#14B8A6", light: "#F0FDFA" };
  }
  if (countryLower.includes("台灣") || countryLower.includes("taiwan")) {
    return { primary: "#991B1B", secondary: "#DC2626", light: "#FEF2F2" };
  }
  
  return { primary: "#0A0A0A", secondary: "#374151", light: "#F9FAFB" };
};

// 格式化日期
const formatDate = (dateStr: string) => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  });
};

export default function TourPrintView() {
  const { t, language } = useLocale();
  const [, params] = useRoute("/tours/:id/print");
  const [, setLocation] = useLocation();
  const tourId = params?.id ? parseInt(params.id) : null;
  const printRef = useRef<HTMLDivElement>(null);
  
  // 獲取行程資料
  const { data: tour, isLoading, error } = trpc.tours.getById.useQuery(
    { id: tourId! },
    { enabled: !!tourId }
  );

  // Fetch single-tour translation when not in Chinese mode
  const { data: tourTranslation } = trpc.translation.getTourTranslations.useQuery(
    { tourId: tourId!, targetLanguage: language as 'zh-TW' | 'en' | 'ja' | 'ko' },
    { enabled: language !== 'zh-TW' && !!tourId }
  );
  const displayTitle = language === 'zh-TW'
    ? (tour?.title || '')
    : (tourTranslation?.title || tour?.title || '');
  const displayDescription = language === 'zh-TW'
    ? (tour?.description || '')
    : (tourTranslation?.description || tour?.description || '');

  // 頁面載入後自動觸發列印
  useEffect(() => {
    if (tour && !isLoading) {
      // 延遲一下讓頁面完全渲染
      const timer = setTimeout(() => {
        window.print();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [tour, isLoading]);
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <LoadingPage text={t('tourPrint.loading')} />
      </div>
    );
  }
  
  if (error || !tour) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <p className="text-red-600 mb-4">{t('tourPrint.loadError')}</p>
          <Button onClick={() => setLocation("/")}>{t('tourPrint.backHome')}</Button>
        </div>
      </div>
    );
  }
  
  const themeColor = getThemeColor(tour.destinationCountry || "");
  const dailyItinerary = parseJSON(tour.itineraryDetailed, []);
  const inclusions = parseJSON(tour.includes, []);
  const exclusions = parseJSON(tour.excludes, []);
  const notes = parseJSON(tour.notes, []);
  const keyFeatures = parseJSON(tour.keyFeatures, []);
  const hotels = parseJSON(tour.hotels, []);
  const itinerary = dailyItinerary;
  
  return (
    <>
      {/* 列印控制按鈕（螢幕上顯示，列印時隱藏） */}
      <div className="print:hidden fixed top-4 left-4 z-50 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLocation(`/tours/${tourId}`)}
          className="bg-white shadow-md"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('tourPrint.backToTour')}
        </Button>
        <Button
          size="sm"
          onClick={() => window.print()}
          className="bg-black text-white shadow-md"
        >
          <Printer className="h-4 w-4 mr-2" />
          {t('tourPrint.printOrDownload')}
        </Button>
      </div>
      
      {/* 列印版內容 */}
      <div ref={printRef} className="print-document bg-white">
        
        {/* ===== 封面頁 ===== */}
        <div className="print-page print-cover-page">
          {/* 公司 Logo 和名稱 */}
          <div className="print-header">
            <div className="flex items-center gap-3">
              <img 
                src="/logo.png" 
                alt="PACK&GO" 
                className="h-12 w-auto"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div>
                <h1 className="text-xl font-bold text-gray-900">{t('tourPrint.companyName')}</h1>
                <p className="text-sm text-gray-500">{t('tourPrint.companySlogan')}</p>
              </div>
            </div>
            <div className="text-right text-sm text-gray-500">
              <p className="font-medium text-gray-700">{t('tourPrint.phone')}</p>
              <p>Email：jeffhsieh09@gmail.com</p>
              <p>{t('tourPrint.tourCode')}{tour.productCode || `T${tour.id}`}</p>
              <p>{t('tourPrint.printDate')}{new Date().toLocaleDateString(language === 'en' ? 'en-US' : 'zh-TW')}</p>
            </div>
          </div>
          
          {/* 行程封面圖 */}
          <div className="print-cover-image">
            {tour.heroImage ? (
              <img
                src={tour.heroImage}
                alt={displayTitle}
                className="w-full h-full object-cover"
              />
            ) : (
              <div 
                className="w-full h-full flex items-center justify-center"
                style={{ backgroundColor: themeColor.light }}
              >
                <Globe className="h-24 w-24 text-gray-300" />
              </div>
            )}
            <div className="print-cover-overlay">
              <div className="print-cover-content">
                <div 
                  className="inline-block px-3 py-1 text-sm font-medium mb-3"
                  style={{ backgroundColor: themeColor.primary, color: "white" }}
                >
                  {tour.destinationCountry ? translateDestination(tour.destinationCountry, language) : t('tourPrint.featuredTour')}
                </div>
                <h1 className="print-tour-title">{displayTitle}</h1>
                <div className="print-tour-meta">
                  <span><Calendar className="inline h-4 w-4 mr-1" />{tour.duration} {t('tourPrint.days')}</span>
                  <span><MapPin className="inline h-4 w-4 mr-1" />{translateDestination(tour.destination || tour.destinationCountry || '', language)}</span>
                  <span><Users className="inline h-4 w-4 mr-1" />{t('tourPrint.groupSize')}</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* 行程簡介 */}
          <div className="print-intro">
            <h2 className="print-section-title" style={{ color: themeColor.primary }}>
              {t('tourPrint.tourIntro')}
            </h2>
            <p className="print-intro-text">{displayDescription}</p>
          </div>
          
          {/* 行程亮點 */}
          {keyFeatures.length > 0 && (
            <div className="print-highlights">
              <h3 className="text-sm font-bold text-gray-700 mb-2">{t('tourPrint.tourHighlights')}</h3>
              <ul className="print-highlights-list">
                {keyFeatures.slice(0, 6).map((feature: any, idx: number) => (
                  <li key={idx} className="print-highlight-item">
                    <Check className="h-4 w-4 flex-shrink-0" style={{ color: themeColor.secondary }} />
                    <span>{typeof feature === 'string' ? feature : feature.title || feature.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* 頁腳 */}
          <div className="print-page-footer">
            <span>{t('tourPrint.companyName')}</span>
            <span>{t('tourPrint.pageNum').replace('{num}', '1')}</span>
          </div>
        </div>
        
        {/* ===== 每日行程頁 ===== */}
        {dailyItinerary.map((day: any, dayIndex: number) => (
          <div key={dayIndex} className="print-page print-itinerary-page">
            {/* 頁眉 */}
            <div className="print-page-header">
              <span className="font-medium">{displayTitle}</span>
              <span className="text-gray-500">{t('tourPrint.tourCode')}{tour.productCode || `T${tour.id}`}</span>
            </div>
            
            {/* 日期標題 */}
            <div 
              className="print-day-header"
              style={{ backgroundColor: themeColor.light, borderLeftColor: themeColor.primary }}
            >
              <div className="print-day-number" style={{ backgroundColor: themeColor.primary }}>
                DAY {day.day || dayIndex + 1}
              </div>
              <div className="print-day-title">
                <h2>{day.title || `${t('tourPrint.dayLabel').replace('{day}', String(day.day || dayIndex + 1))}`}</h2>
                {day.date && <span className="text-sm text-gray-500">{formatDate(day.date)}</span>}
              </div>
            </div>
            
            {/* 行程描述 */}
            {day.description && (
              <div className="print-day-description">
                <p>{day.description}</p>
              </div>
            )}
            
            {/* 活動列表 */}
            {day.activities && day.activities.length > 0 && (
              <div className="print-activities">
                <h3 className="print-subsection-title">
                  <Clock className="h-4 w-4" style={{ color: themeColor.secondary }} />
                  {t('tourPrint.todayItinerary')}
                </h3>
                <div className="print-activities-list">
                  {day.activities.map((activity: any, actIdx: number) => (
                    <div key={actIdx} className="print-activity-card">
                      {/* 景點圖片 */}
                      {activity.image && (
                        <div className="print-activity-image">
                          <img src={activity.image} alt={activity.title || activity.name} />
                        </div>
                      )}
                      <div className="print-activity-details">
                        <div className="print-activity-header">
                          <div 
                            className="print-activity-time"
                            style={{ color: themeColor.primary }}
                          >
                            {activity.time || `${9 + actIdx}:00`}
                          </div>
                          <span className="font-medium">{activity.title || activity.name || activity}</span>
                        </div>
                        {activity.description && (
                          <p className="print-activity-desc">{activity.description}</p>
                        )}
                        {/* 開放時間和票價 */}
                        <div className="print-activity-info">
                          {activity.openingHours && (
                            <span className="print-activity-hours">
                              <Clock className="inline h-3 w-3 mr-1" />
                              {activity.openingHours}
                            </span>
                          )}
                          {activity.ticketPrice && (
                            <span className="print-activity-price">
                              {t('tourPrint.ticketPrice')}{activity.ticketPrice}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* 餐食安排 */}
            <div className="print-meals">
              <h3 className="print-subsection-title">
                <Utensils className="h-4 w-4" style={{ color: themeColor.secondary }} />
                {t('tourPrint.todayMeals')}
              </h3>
              <div className="print-meals-grid">
                <div className="print-meal-item">
                  <span className="print-meal-label">{t('tourPrint.breakfast')}</span>
                  <span className="print-meal-value">{day.meals?.breakfast || day.breakfast || t('tourPrint.hotelMeal')}</span>
                </div>
                <div className="print-meal-item">
                  <span className="print-meal-label">{t('tourPrint.lunch')}</span>
                  <span className="print-meal-value">{day.meals?.lunch || day.lunch || t('tourPrint.localMeal')}</span>
                </div>
                <div className="print-meal-item">
                  <span className="print-meal-label">{t('tourPrint.dinner')}</span>
                  <span className="print-meal-value">{day.meals?.dinner || day.dinner || t('tourPrint.hotelMeal')}</span>
                </div>
              </div>
            </div>
            
            {/* 住宿資訊 */}
            {day.hotel && (
              <div className="print-hotel">
                <h3 className="print-subsection-title">
                  <Building className="h-4 w-4" style={{ color: themeColor.secondary }} />
                  {t('tourPrint.tonightHotel')}
                </h3>
                <div className="print-hotel-info">
                  <span className="font-medium">{day.hotel}</span>
                  {day.hotelAddress && (
                    <span className="text-gray-500 text-sm ml-2">
                      <MapPin className="inline h-3 w-3 mr-1" />
                      {day.hotelAddress}
                    </span>
                  )}
                </div>
              </div>
            )}
            
            {/* 頁腳 */}
            <div className="print-page-footer">
              <span>{t('tourPrint.companyName')}</span>
              <span>{t('tourPrint.pageNum').replace('{num}', String(dayIndex + 2))}</span>
            </div>
          </div>
        ))}
        
        {/* ===== 飯店資訊頁 ===== */}
        {hotels && hotels.length > 0 && (
          <div className="print-page print-hotels-page">
            {/* 頁眉 */}
            <div className="print-page-header">
              <span className="font-medium">{displayTitle}</span>
              <span className="text-gray-500">{t('tourPrint.hotelInfo')}</span>
            </div>
            
            <h2 className="print-section-title" style={{ color: themeColor.primary }}>
              {t('tourPrint.selectedAccommodation')}
            </h2>
            
            <div className="print-hotels-grid">
              {hotels.map((hotel: any, idx: number) => (
                <div key={idx} className="print-hotel-card">
                  {/* 飯店圖片 */}
                  {hotel.image && (
                    <div className="print-hotel-image">
                      <img src={hotel.image} alt={hotel.name} />
                    </div>
                  )}
                  
                  {/* 飯店資訊 */}
                  <div className="print-hotel-details">
                    <div className="print-hotel-header">
                      <h3 className="print-hotel-name">{hotel.name}</h3>
                      {hotel.rating && (
                        <div className="print-hotel-rating">
                          {Array.from({ length: hotel.rating }).map((_, i) => (
                            <span key={i} className="text-yellow-500">★</span>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    {hotel.address && (
                      <p className="print-hotel-address">
                        <MapPin className="inline h-3 w-3 mr-1" />
                        {hotel.address}
                      </p>
                    )}
                    
                    {hotel.description && (
                      <p className="print-hotel-description">{hotel.description}</p>
                    )}
                    
                    {/* 飯店設施 */}
                    {hotel.amenities && hotel.amenities.length > 0 && (
                      <div className="print-hotel-amenities">
                        <span className="font-medium text-gray-700">{t('tourPrint.facilities')}</span>
                        <span className="text-gray-600">{hotel.amenities.join('、')}</span>
                      </div>
                    )}
                    
                    {/* 入住日期 */}
                    {hotel.nights && (
                      <p className="print-hotel-nights">
                        <Calendar className="inline h-3 w-3 mr-1" />
                        {t('tourPrint.stayNights').replace('{nights}', String(hotel.nights))}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            {/* 頁腳 */}
            <div className="print-page-footer">
              <span>{t('tourPrint.companyName')}</span>
              <span>{t('tourPrint.pageNum').replace('{num}', String(itinerary.length + 2))}</span>
            </div>
          </div>
        )}
        
        {/* ===== 費用說明頁 ===== */}
        <div className="print-page print-pricing-page">
          {/* 頁眉 */}
          <div className="print-page-header">
            <span className="font-medium">{displayTitle}</span>
            <span className="text-gray-500">{t('tourPrint.pricingInfo')}</span>
          </div>
          
          <h2 className="print-section-title" style={{ color: themeColor.primary }}>
            {t('tourPrint.pricingInfo')}
          </h2>
          
          {/* 價格資訊 */}
          <div className="print-price-box" style={{ backgroundColor: themeColor.light }}>
            <div className="print-price-label">{t('tourPrint.tourFee')}</div>
            <div className="print-price-value" style={{ color: themeColor.primary }}>
              NT$ {tour.price?.toLocaleString() || t('tourPrint.inquire')}
              <span className="text-sm font-normal text-gray-500"> /{t('tourPrint.person')}</span>
            </div>
          </div>
          
          {/* 費用包含 */}
          <div className="print-inclusions">
            <h3 className="print-subsection-title">
              <Check className="h-4 w-4 text-green-600" />
              {t('tourPrint.included')}
            </h3>
            <ul className="print-list">
              {inclusions.length > 0 ? (
                inclusions.map((item: string, idx: number) => (
                  <li key={idx} className="print-list-item">
                    <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))
              ) : (
                <>
                  <li className="print-list-item"><Check className="h-4 w-4 text-green-600" /><span>{t('tourPrint.defaultInclude1')}</span></li>
                  <li className="print-list-item"><Check className="h-4 w-4 text-green-600" /><span>{t('tourPrint.defaultInclude2')}</span></li>
                  <li className="print-list-item"><Check className="h-4 w-4 text-green-600" /><span>{t('tourPrint.defaultInclude3')}</span></li>
                  <li className="print-list-item"><Check className="h-4 w-4 text-green-600" /><span>{t('tourPrint.defaultInclude4')}</span></li>
                  <li className="print-list-item"><Check className="h-4 w-4 text-green-600" /><span>{t('tourPrint.defaultInclude5')}</span></li>
                </>
              )}
            </ul>
          </div>
          
          {/* 費用不含 */}
          <div className="print-exclusions">
            <h3 className="print-subsection-title">
              <X className="h-4 w-4 text-red-600" />
              {t('tourPrint.notIncluded')}
            </h3>
            <ul className="print-list">
              {exclusions.length > 0 ? (
                exclusions.map((item: string, idx: number) => (
                  <li key={idx} className="print-list-item">
                    <X className="h-4 w-4 text-red-600 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))
              ) : (
                <>
                  <li className="print-list-item"><X className="h-4 w-4 text-red-600" /><span>{t('tourPrint.defaultExclude1')}</span></li>
                  <li className="print-list-item"><X className="h-4 w-4 text-red-600" /><span>{t('tourPrint.defaultExclude2')}</span></li>
                  <li className="print-list-item"><X className="h-4 w-4 text-red-600" /><span>{t('tourPrint.defaultExclude3')}</span></li>
                  <li className="print-list-item"><X className="h-4 w-4 text-red-600" /><span>{t('tourPrint.defaultExclude4')}</span></li>
                  <li className="print-list-item"><X className="h-4 w-4 text-red-600" /><span>{t('tourPrint.defaultExclude5')}</span></li>
                </>
              )}
            </ul>
          </div>
          
          {/* 頁腳 */}
          <div className="print-page-footer">
              <span>{t('tourPrint.companyName')}</span>
              <span>{t('tourPrint.pageNum').replace('{num}', String(dailyItinerary.length + 2))}</span>
          </div>
        </div>
        
        {/* ===== 注意事項頁 ===== */}
        <div className="print-page print-notes-page">
          {/* 頁眉 */}
          <div className="print-page-header">
            <span className="font-medium">{displayTitle}</span>
            <span className="text-gray-500">{t('tourPrint.notes')}</span>
          </div>
          
          <h2 className="print-section-title" style={{ color: themeColor.primary }}>
            {t('tourPrint.notes')}
          </h2>
          
          {/* 注意事項列表 */}
          <div className="print-notes-content">
            {notes.length > 0 ? (
              notes.map((note: any, idx: number) => (
                <div key={idx} className="print-note-section">
                  {typeof note === 'object' ? (
                    <>
                      <h3 className="print-note-title">{note.title || `${t('tourPrint.noteItem')} ${idx + 1}`}</h3>
                      {note.items ? (
                        <ul className="print-note-list">
                          {note.items.map((item: string, itemIdx: number) => (
                            <li key={itemIdx}>{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>{note.content || note.description}</p>
                      )}
                    </>
                  ) : (
                    <p>{note}</p>
                  )}
                </div>
              ))
            ) : (
              <>
                <div className="print-note-section">
                  <h3 className="print-note-title">{t('tourPrint.preTrip')}</h3>
                  <ul className="print-note-list">
                    <li>{t('tourPrint.preTrip1')}</li>
                    <li>{t('tourPrint.preTrip2')}</li>
                    <li>{t('tourPrint.preTrip3')}</li>
                    <li>{t('tourPrint.preTrip4')}</li>
                    <li>{t('tourPrint.preTrip5')}</li>
                    <li>{t('tourPrint.preTrip6')}</li>
                  </ul>
                </div>
                <div className="print-note-section">
                  <h3 className="print-note-title">{t('tourPrint.meetingInfo')}</h3>
                  <ul className="print-note-list">
                    <li>{t('tourPrint.meetingInfo1')}</li>
                    <li>{t('tourPrint.meetingInfo2')}</li>
                    <li>{t('tourPrint.meetingInfo3')}</li>
                  </ul>
                </div>
                <div className="print-note-section">
                  <h3 className="print-note-title">{t('tourPrint.travelTips')}</h3>
                  <ul className="print-note-list">
                    <li>{t('tourPrint.travelTip1')}</li>
                    <li>{t('tourPrint.travelTip2')}</li>
                    <li>{t('tourPrint.travelTip3')}</li>
                    <li>{t('tourPrint.travelTip4')}</li>
                    <li>{t('tourPrint.travelTip5')}</li>
                  </ul>
                </div>
                <div className="print-note-section">
                  <h3 className="print-note-title">{t('tourPrint.cancellationPolicy')}</h3>
                  <ul className="print-note-list">
                    <li>{t('tourPrint.cancel1')}</li>
                    <li>{t('tourPrint.cancel2')}</li>
                    <li>{t('tourPrint.cancel3')}</li>
                    <li>{t('tourPrint.cancel4')}</li>
                    <li>{t('tourPrint.cancel5')}</li>
                  </ul>
                </div>
                <div className="print-note-section">
                  <h3 className="print-note-title">{t('tourPrint.emergency')}</h3>
                  <ul className="print-note-list">
                    <li>{t('tourPrint.emergency1')}</li>
                    <li>{t('tourPrint.emergency2')}</li>
                    <li>{t('tourPrint.emergency3')}</li>
                  </ul>
                </div>
              </>
            )}
          </div>
          
          {/* 聯絡資訊 */}
          <div className="print-contact-box" style={{ backgroundColor: themeColor.light }}>
            <h3 className="font-bold mb-3" style={{ color: themeColor.primary }}>{t('tourPrint.contactUs')}</h3>
            <div className="print-contact-grid">
              <div className="print-contact-item">
                <Phone className="h-4 w-4" style={{ color: themeColor.secondary }} />
                <span>+1 (510) 634-2307</span>
              </div>
              <div className="print-contact-item">
                <Mail className="h-4 w-4" style={{ color: themeColor.secondary }} />
                <span>jeffhsieh09@gmail.com</span>
              </div>
              <div className="print-contact-item">
                <Globe className="h-4 w-4" style={{ color: themeColor.secondary }} />
                <span>www.packgo.com</span>
              </div>
            </div>
          </div>
          
          {/* 頁腳 */}
          <div className="print-page-footer">
              <span>{t('tourPrint.companyName')}</span>
              <span>{t('tourPrint.pageNum').replace('{num}', String(dailyItinerary.length + 3))}</span>
          </div>
        </div>
        
      </div>
      
      {/* 列印專用樣式 */}
      <style>{`
        /* 螢幕顯示樣式 */
        @media screen {
          .print-document {
            max-width: 210mm;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
          }
          
          .print-page {
            background: white;
            margin-bottom: 20px;
            padding: 20mm 15mm;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            min-height: 297mm;
            position: relative;
          }
        }
        
        /* 列印樣式 */
        @media print {
          @page {
            size: A4 portrait;
            margin: 15mm 12mm 20mm 12mm;
          }
          
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          
          .print-document {
            background: white;
          }
          
          .print-page {
            page-break-after: always;
            padding: 0;
            min-height: auto;
          }
          
          .print-page:last-child {
            page-break-after: auto;
          }
        }
        
        /* 通用樣式 */
        .print-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 15mm;
          padding-bottom: 5mm;
          border-bottom: 1px solid #e5e7eb;
        }
        
        .print-page-header {
          display: flex;
          justify-content: space-between;
          font-size: 10pt;
          color: #6b7280;
          margin-bottom: 8mm;
          padding-bottom: 3mm;
          border-bottom: 1px solid #e5e7eb;
        }
        
        .print-page-footer {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
          justify-content: space-between;
          font-size: 9pt;
          color: #9ca3af;
          padding-top: 3mm;
          border-top: 1px solid #e5e7eb;
        }
        
        .print-cover-image {
          position: relative;
          width: 100%;
          height: 80mm;
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 10mm;
        }
        
        .print-cover-overlay {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
          padding: 15mm 8mm 8mm;
        }
        
        .print-cover-content {
          color: white;
        }
        
        .print-tour-title {
          font-size: 18pt;
          font-weight: bold;
          margin-bottom: 3mm;
          line-height: 1.3;
        }
        
        .print-tour-meta {
          display: flex;
          gap: 15px;
          font-size: 10pt;
          opacity: 0.9;
        }
        
        .print-section-title {
          font-size: 14pt;
          font-weight: bold;
          margin-bottom: 5mm;
          padding-bottom: 2mm;
          border-bottom: 2px solid currentColor;
        }
        
        .print-subsection-title {
          font-size: 11pt;
          font-weight: 600;
          margin-bottom: 3mm;
          display: flex;
          align-items: center;
          gap: 6px;
          color: #374151;
        }
        
        .print-intro {
          margin-bottom: 8mm;
        }
        
        .print-intro-text {
          font-size: 10pt;
          line-height: 1.7;
          color: #4b5563;
          text-align: justify;
        }
        
        .print-highlights {
          margin-bottom: 8mm;
        }
        
        .print-highlights-list {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 2mm 8mm;
        }
        
        .print-highlight-item {
          display: flex;
          align-items: flex-start;
          gap: 4px;
          font-size: 9pt;
          color: #4b5563;
        }
        
        .print-day-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 4mm 5mm;
          border-left: 4px solid;
          margin-bottom: 5mm;
        }
        
        .print-day-number {
          color: white;
          font-size: 10pt;
          font-weight: bold;
          padding: 2mm 4mm;
          border-radius: 4px;
        }
        
        .print-day-title h2 {
          font-size: 12pt;
          font-weight: bold;
          color: #1f2937;
        }
        
        .print-day-description {
          font-size: 10pt;
          line-height: 1.6;
          color: #4b5563;
          margin-bottom: 5mm;
          padding-left: 5mm;
          border-left: 2px solid #e5e7eb;
        }
        
        .print-activities {
          margin-bottom: 5mm;
        }
        
        .print-activities-list {
          display: flex;
          flex-direction: column;
          gap: 2mm;
        }
        
        .print-activity-item {
          display: flex;
          align-items: baseline;
          gap: 8px;
          font-size: 10pt;
        }
        
        .print-activity-time {
          font-weight: 600;
          min-width: 40px;
        }
        
        .print-meals {
          margin-bottom: 5mm;
        }
        
        .print-meals-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 5mm;
        }
        
        .print-meal-item {
          background: #f9fafb;
          padding: 3mm;
          border-radius: 4px;
          text-align: center;
        }
        
        .print-meal-label {
          display: block;
          font-size: 9pt;
          color: #6b7280;
          margin-bottom: 1mm;
        }
        
        .print-meal-value {
          font-size: 10pt;
          font-weight: 500;
          color: #1f2937;
        }
        
        .print-hotel {
          margin-bottom: 5mm;
        }
        
        .print-hotel-info {
          font-size: 10pt;
          padding: 3mm;
          background: #f9fafb;
          border-radius: 4px;
        }
        
        .print-price-box {
          padding: 5mm;
          border-radius: 8px;
          margin-bottom: 8mm;
          text-align: center;
        }
        
        .print-price-label {
          font-size: 10pt;
          color: #6b7280;
          margin-bottom: 2mm;
        }
        
        .print-price-value {
          font-size: 20pt;
          font-weight: bold;
        }
        
        .print-inclusions,
        .print-exclusions {
          margin-bottom: 6mm;
        }
        
        .print-list {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 2mm 8mm;
        }
        
        .print-list-item {
          display: flex;
          align-items: flex-start;
          gap: 4px;
          font-size: 10pt;
          color: #4b5563;
        }
        
        .print-notes-content {
          margin-bottom: 8mm;
        }
        
        .print-note-section {
          margin-bottom: 5mm;
        }
        
        .print-note-title {
          font-size: 11pt;
          font-weight: 600;
          color: #374151;
          margin-bottom: 2mm;
        }
        
        .print-note-list {
          padding-left: 5mm;
          font-size: 10pt;
          color: #4b5563;
          line-height: 1.6;
        }
        
        .print-note-list li {
          margin-bottom: 1mm;
          list-style-type: disc;
        }
        
        .print-contact-box {
          padding: 5mm;
          border-radius: 8px;
        }
        
        .print-contact-grid {
          display: flex;
          gap: 15mm;
        }
        
        .print-contact-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10pt;
        }
        
        /* 飯店資訊頁樣式 */
        .print-hotels-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 6mm;
        }
        
        .print-hotel-card {
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          overflow: hidden;
          page-break-inside: avoid;
        }
        
        .print-hotel-image {
          height: 35mm;
          overflow: hidden;
        }
        
        .print-hotel-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        .print-hotel-details {
          padding: 4mm;
        }
        
        .print-hotel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2mm;
        }
        
        .print-hotel-name {
          font-size: 11pt;
          font-weight: 600;
          color: #1f2937;
          margin: 0;
        }
        
        .print-hotel-rating {
          font-size: 10pt;
        }
        
        .print-hotel-address {
          font-size: 9pt;
          color: #6b7280;
          margin: 0 0 2mm 0;
        }
        
        .print-hotel-description {
          font-size: 9pt;
          color: #4b5563;
          line-height: 1.4;
          margin: 0 0 2mm 0;
        }
        
        .print-hotel-amenities {
          font-size: 9pt;
          margin-bottom: 2mm;
        }
        
        .print-hotel-nights {
          font-size: 9pt;
          color: #6b7280;
          margin: 0;
        }
        
        /* 景點卡片樣式 */
        .print-activity-card {
          display: flex;
          gap: 3mm;
          padding: 3mm;
          background: #fafafa;
          border-radius: 4px;
          margin-bottom: 2mm;
        }
        
        .print-activity-image {
          width: 25mm;
          height: 20mm;
          flex-shrink: 0;
          border-radius: 4px;
          overflow: hidden;
        }
        
        .print-activity-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        .print-activity-details {
          flex: 1;
        }
        
        .print-activity-header {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 1mm;
        }
        
        .print-activity-desc {
          font-size: 9pt;
          color: #6b7280;
          margin: 0 0 1mm 0;
          line-height: 1.4;
        }
        
        .print-activity-info {
          display: flex;
          gap: 10px;
          font-size: 8pt;
          color: #9ca3af;
        }
        
        .print-activity-hours,
        .print-activity-price {
          display: flex;
          align-items: center;
        }
      `}</style>
    </>
  );
}
