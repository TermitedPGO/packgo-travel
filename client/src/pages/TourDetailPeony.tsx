/**
 * TourDetailPeony.tsx
 * 參考 Peony Tours 設計風格的行程詳情頁面
 * 設計特點：
 * - 固定標籤導航（行程簡介、精彩行程、內容特色、豪華酒店、出發日期/售價）
 * - Zigzag 左右交錯的每日行程佈局
 * - 根據目的地自動調整主題色
 * - 現代、簡潔、專業的設計風格
 */

import React, { useEffect, useState, useRef, useMemo } from "react";
import SimilarTours from "@/components/SimilarTours";
import TourDeparturesTable from "@/components/TourDeparturesTable";
import { recordTourView } from "@/components/HomeWelcomeBack";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, 
  Download, 
  Calendar, 
  MapPin, 
  Clock, 
  Users,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Star,
  Plane,
  Train,
  Ship,
  Bus,
  Car,
  Share2,
  Printer,
  Phone,
  Mail,
  Building,
  Utensils,
  Camera,
  Info,
  AlertCircle,
  // 特色卡片圖示
  Sailboat,
  TreePine,
  Coffee,
  Mountain,
  Waves,
  Sunrise,
  Compass,
  Footprints,
  Bike,
  Tent,
  Landmark,
  UtensilsCrossed,
  Wine,
  Sparkles,
  // 注意事項圖示
  Luggage,
  FileText,
  Heart,
  PhoneCall,
  ChevronRight,
  ChevronLeft,
  ImageIcon,
  Globe,
  Ticket,
  ExternalLink,
  DollarSign,
  // v78t: trust signals strip
  ShieldCheck,
  Lock,
} from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import TourRouteMap from "@/components/tour-detail/TourRouteMap";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { translateDestination } from "@/utils/locationMapping";
import { trackViewTour } from "@/lib/analytics";
import SEO, { buildTourSchema } from "@/components/SEO";
import { EditableText, EditableImage, EditableDayCard, EditModeToggle, EditModeBanner } from "@/components/inline-edit";
import { toast } from "sonner";

// 交通工具類型英文對照表（集中管理，避免散落在 JSX 中）
const TRANSPORT_TYPE_EN: Record<string, string> = {
  '飛機': 'Flight',
  '火車': 'Train',
  '觀光列車': 'Sightseeing Train',
  '郵輪': 'Cruise',
  '自駕': 'Self-drive',
  '遊覽車': 'Coach',
  '巴士': 'Bus',
  '高鐵': 'High-Speed Rail',
  '船': 'Ferry',
};

// 解析 JSON 字串
const parseJSON = (str: string | null | undefined, defaultValue: any = null) => {
  if (!str) return defaultValue;
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
};

// 動態價格日曆組件
const DeparturePriceCalendar = ({ 
  tourId, 
  basePrice, 
  themeColor,
  onSelectDeparture 
}: { 
  tourId: number; 
  basePrice: number; 
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  onSelectDeparture: (departureId: number) => void;
}) => {
  const { t, tArray, formatPrice, currencySymbol } = useLocale();
  const { data: departures, isLoading } = trpc.departures.list.useQuery({ tourId });
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [selectedDeparture, setSelectedDeparture] = useState<number | null>(null);
  const [hasAutoJumped, setHasAutoJumped] = useState(false);

  // Auto-jump to the nearest upcoming departure month when data loads
  useEffect(() => {
    if (departures && departures.length > 0 && !hasAutoJumped) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const futureDepartures = (departures as any[])
        .filter((d) => new Date(d.departureDate) >= now && d.status !== 'cancelled')
        .sort((a, b) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime());
      if (futureDepartures.length > 0) {
        const nearest = new Date(futureDepartures[0].departureDate);
        setSelectedMonth(new Date(nearest.getFullYear(), nearest.getMonth(), 1));
      }
      setHasAutoJumped(true);
    }
  }, [departures, hasAutoJumped]);

  // 獲取當月的出發日期
  const monthDepartures = useMemo(() => {
    if (!departures) return [];
    return departures.filter((d: any) => {
      const depDate = new Date(d.departureDate);
      return depDate.getMonth() === selectedMonth.getMonth() && 
             depDate.getFullYear() === selectedMonth.getFullYear();
    });
  }, [departures, selectedMonth]);

  // 生成日曆網格
  const calendarDays = useMemo(() => {
    const year = selectedMonth.getFullYear();
    const month = selectedMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay();
    const days: (Date | null)[] = [];
    
    // 填充前面的空白
    for (let i = 0; i < startPadding; i++) {
      days.push(null);
    }
    
    // 填充日期
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(year, month, d));
    }
    
    return days;
  }, [selectedMonth]);

  // 檢查某天是否有出發日期
  const getDepartureForDay = (date: Date | null) => {
    if (!date || !departures) return null;
    return departures.find((d: any) => {
      const depDate = new Date(d.departureDate);
      return depDate.getDate() === date.getDate() && 
             depDate.getMonth() === date.getMonth() &&
             depDate.getFullYear() === date.getFullYear();
    });
  };

  const prevMonth = () => {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1));
  };

  // Round 72 follow-up: weekdays are provided by tArray() for both zh-TW and
  // en locales. The safety fallback uses English initials (language-neutral)
  // rather than hardcoded Chinese, so an i18n load failure never leaks zh
  // strings into an en-locale render.
  const weekDays = tArray('tourDetail.weekdays').length > 0 ? tArray('tourDetail.weekdays') : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  if (isLoading) {
    return (
      <div className="bg-gray-50 p-8 text-center mb-8">
        <p className="text-gray-500">{t('tourDetail.loading')}</p>
      </div>
    );
  }

  // 如果沒有出發日期，顯示基本價格 (v78o: 用 formatPrice 自動依使用者選的幣別轉換)
  if (!departures || departures.length === 0) {
    return (
      <div className="bg-gray-50 p-8 text-center mb-8">
        <p className="text-sm text-gray-500 mb-2">{t('tourDetail.pricePerPerson')}</p>
        <div className="flex items-baseline justify-center gap-2">
          <span className="text-5xl font-bold" style={{ color: themeColor.primary }}>
            {basePrice ? formatPrice(basePrice, "TWD") : t('tourDetail.inquirePrice')}
          </span>
          <span className="text-gray-500">{t('tourDetail.startingFrom')}</span>
        </div>
        <p className="text-gray-400 mt-4 text-sm">{t('tourDetail.contactForDeparture')}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-8 border border-gray-100">
      {/* 日曆標題 - 卓面級設計 */}
      <div 
        className="flex items-center justify-between p-6" 
        style={{ 
          background: `linear-gradient(135deg, ${themeColor.primary} 0%, ${themeColor.secondary} 100%)` 
        }}
      >
        <button 
          onClick={prevMonth}
          className="p-3 bg-white/20 hover:bg-white/30 rounded-lg transition-all duration-200 backdrop-blur-sm"
        >
          <ChevronUp className="h-5 w-5 rotate-[-90deg] text-white" />
        </button>
        <div className="text-center">
          <h3 className="text-2xl font-bold text-white tracking-wide">
            {(t('tourDetail.yearMonthFormat')).replace('{year}', String(selectedMonth.getFullYear())).replace('{month}', String(selectedMonth.getMonth() + 1))}
          </h3>
          <p className="text-white/80 text-sm mt-1">{t('tourDetail.selectDepartureDate')}</p>
        </div>
        <button 
          onClick={nextMonth}
          className="p-3 bg-white/20 hover:bg-white/30 rounded-lg transition-all duration-200 backdrop-blur-sm"
        >
          <ChevronUp className="h-5 w-5 rotate-90 text-white" />
        </button>
      </div>

      {/* 價格圖例 */}
      <div className="flex items-center justify-center gap-6 py-4 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-lg" style={{ backgroundColor: themeColor.secondary }}></div>
          <span className="text-sm text-gray-600">{t('tourDetail.available')}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gray-300"></div>
          <span className="text-sm text-gray-600">{t('tourDetail.soldOut')}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gray-100 border border-gray-200"></div>
          <span className="text-sm text-gray-600">{t('tourDetail.noDeparture')}</span>
        </div>
      </div>

      {/* 星期標題 */}
      <div className="grid grid-cols-7 bg-white">
        {weekDays.map((day, idx) => (
          <div 
            key={day} 
            className={`py-4 text-center text-sm font-semibold border-b border-gray-100 ${
              idx === 0 ? 'text-red-500' : idx === 6 ? 'text-blue-500' : 'text-gray-700'
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 日曆網格 - 卡片式設計 */}
      <div className="grid grid-cols-7 bg-white">
        {calendarDays.map((date, idx) => {
          const departure = getDepartureForDay(date);
          const isSelected = departure && selectedDeparture === departure.id;
          const isPast = date && date < new Date(new Date().setHours(0, 0, 0, 0));
          const isFull = departure?.status === 'full';
          const isConfirmed = departure?.status === 'confirmed';
          // Round 66: stopped surfacing numeric "剩 X 位" because imported tours
          // use LionTravel's placeholder `AvailableVacancy` field which is not
          // real inventory data. We rely on the status enum instead.
          
          return (
            <div 
              key={idx}
              className={`
                min-h-[90px] p-3 border-b border-r border-gray-50 relative transition-all duration-200
                ${!date ? 'bg-gray-50/50' : 'bg-white'}
                ${isPast ? 'bg-gray-50/50 opacity-40' : ''}
                ${isFull && !isPast ? 'bg-gray-100 opacity-60' : ''}
                ${departure && !isPast && !isFull ? 'cursor-pointer hover:bg-gray-50 hover:shadow-inner' : ''}
                ${isSelected ? 'bg-blue-50 shadow-inner' : ''}
              `}
              style={isSelected ? { 
                outline: `3px solid ${themeColor.secondary}`, 
                outlineOffset: '-3px',
                borderRadius: '8px'
              } : {}}
              onClick={() => {
                if (departure && !isPast && !isFull) {
                  setSelectedDeparture(departure.id);
                }
              }}
            >
              {date && (
                <div className="flex flex-col h-full">
                  <span className={`text-base font-medium ${
                    date.getDay() === 0 ? 'text-red-500' : 
                    date.getDay() === 6 ? 'text-blue-500' : 'text-gray-800'
                  }`}>
                    {date.getDate()}
                  </span>
                  
                  {departure && (
                    <div className="mt-auto">
                      {isFull ? (
                        <span className="text-xs text-gray-400 bg-gray-200 px-2 py-1 rounded-lg">{t('tourDetail.soldOut')}</span>
                      ) : (
                        <>
                          {isConfirmed && (
                            <span className="text-[9px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded mb-0.5 inline-block">
                              ✓ {t('tourDetail.confirmed')}
                            </span>
                          )}
                          <div
                            className="text-xs font-bold px-2 py-1 rounded-lg text-white shadow-sm"
                            style={{ backgroundColor: themeColor.secondary }}
                          >
                            ${(departure.adultPrice || basePrice).toLocaleString()}
                          </div>
                          {/* Round 66: status badge replaces numeric seat count.
                              For 'open', show a subtle pill; 'confirmed' already
                              renders above as a success badge. */}
                          {departure.status === 'open' && (
                            <p className="text-[10px] mt-1 font-medium text-emerald-600">
                              {t('tourDetail.statusOpen')}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 選中的出發日期詳情 */}
      {selectedDeparture && (
        <div className="p-6 border-t border-gray-200" style={{ backgroundColor: themeColor.light }}>
          {(() => {
            const dep = departures.find((d: any) => d.id === selectedDeparture);
            if (!dep) return null;
            const depDate = new Date(dep.departureDate);
            const retDate = new Date(dep.returnDate);
            
            return (
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-sm text-gray-500 mb-1">{t('tourDetail.selectedDeparture')}</p>
                  <p className="text-xl font-bold" style={{ color: themeColor.primary }}>
                    {depDate.getFullYear()}/{depDate.getMonth() + 1}/{depDate.getDate()} 
                    <span className="text-gray-400 mx-2">~</span>
                    {retDate.getFullYear()}/{retDate.getMonth() + 1}/{retDate.getDate()}
                  </p>
                  {/* Round 66: replaced numeric seat count with a status pill.
                      LionTravel's public API doesn't expose real remaining seats,
                      and we hadn't taken any bookings ourselves for imported tours,
                      so the number was misleading. */}
                  <p className="text-sm text-gray-500 mt-1 inline-flex items-center gap-2">
                    {dep.status === 'full' ? (
                      <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 text-xs font-medium">
                        {t('tourDetail.soldOut')}
                      </span>
                    ) : dep.status === 'confirmed' ? (
                      <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-xs font-medium">
                        ✓ {t('tourDetail.confirmed')}
                      </span>
                    ) : dep.status === 'cancelled' ? (
                      <span className="px-2 py-0.5 rounded-md bg-red-50 text-red-600 text-xs font-medium">
                        {t('tourDetail.statusCancelled')}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium">
                        ● {t('tourDetail.statusOpen')}
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500 mb-1">{t('tourDetail.pricePerPerson')}</p>
                  <p className="text-3xl font-bold" style={{ color: themeColor.secondary }}>
                    {formatPrice(Number(dep.adultPrice || basePrice), (dep.currency as any) || "TWD")}
                  </p>
                  {/* Round 60: Age-based pricing breakdown — v78o: formatPrice handles currency conversion */}
                  <div className="mt-2 text-left space-y-1">
                    <p className="text-xs text-gray-500">
                      <span className="font-medium text-gray-700">{t('tourDetail.adultPrice')}：</span>
                      {formatPrice(Number(dep.adultPrice || basePrice), (dep.currency as any) || "TWD")}
                    </p>
                    {(dep.childPriceWithBed ?? 0) > 0 && (
                      <p className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">{t('tourDetail.childWithBed')}：</span>
                        {formatPrice(Number(dep.childPriceWithBed ?? 0), (dep.currency as any) || "TWD")}
                      </p>
                    )}
                    {(dep.childPriceNoBed ?? 0) > 0 && (
                      <p className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">{t('tourDetail.childNoBed')}：</span>
                        {formatPrice(Number(dep.childPriceNoBed ?? 0), (dep.currency as any) || "TWD")}
                      </p>
                    )}
                    {(dep.infantPrice ?? 0) > 0 && (
                      <p className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">{t('tourDetail.infantPrice')}：</span>
                        {formatPrice(Number(dep.infantPrice ?? 0), (dep.currency as any) || "TWD")}
                      </p>
                    )}
                  </div>
                  <Button 
                    onClick={() => onSelectDeparture(dep.id)}
                    className="mt-3 px-6 py-2 text-white"
                    style={{ backgroundColor: themeColor.secondary }}
                  >
                    {t('tourDetail.selectDate')}
                  </Button>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

// 根據目的地生成主題色
const getThemeColorByDestination = (country: string | null | undefined) => {
  const countryLower = (country || "").toLowerCase();
  
  // 歐洲國家 - 藍色系
  if (countryLower.includes("法國") || countryLower.includes("france") ||
      countryLower.includes("義大利") || countryLower.includes("italy") ||
      countryLower.includes("英國") || countryLower.includes("uk") ||
      countryLower.includes("德國") || countryLower.includes("germany") ||
      countryLower.includes("西班牙") || countryLower.includes("spain") ||
      countryLower.includes("歐洲") || countryLower.includes("europe") ||
      countryLower.includes("奧地利") || countryLower.includes("austria") ||
      countryLower.includes("捷克") || countryLower.includes("czech") ||
      countryLower.includes("巴爾幹") || countryLower.includes("balkan")) {
    return {
      primary: "#1E3A5F",      // 深藍
      secondary: "#2563EB",    // 亮藍
      accent: "#3B82F6",       // 藍色
      light: "#EFF6FF",        // 淺藍背景
      gradient: "from-blue-900 to-blue-700"
    };
  }
  
  // 日本 - 櫻花粉/紅色系
  if (countryLower.includes("日本") || countryLower.includes("japan")) {
    return {
      primary: "#9D174D",      // 深粉紅
      secondary: "#DB2777",    // 粉紅
      accent: "#EC4899",       // 亮粉
      light: "#FDF2F8",        // 淺粉背景
      gradient: "from-pink-900 to-pink-700"
    };
  }
  
  // 東南亞 - 綠色系
  if (countryLower.includes("泰國") || countryLower.includes("thailand") ||
      countryLower.includes("越南") || countryLower.includes("vietnam") ||
      countryLower.includes("印尼") || countryLower.includes("indonesia") ||
      countryLower.includes("新加坡") || countryLower.includes("singapore") ||
      countryLower.includes("馬來西亞") || countryLower.includes("malaysia")) {
    return {
      primary: "#065F46",      // 深綠
      secondary: "#059669",    // 綠色
      accent: "#10B981",       // 亮綠
      light: "#ECFDF5",        // 淺綠背景
      gradient: "from-emerald-900 to-emerald-700"
    };
  }
  
  // 中國/台灣 - 紅色系
  if (countryLower.includes("中國") || countryLower.includes("china") ||
      countryLower.includes("台灣") || countryLower.includes("taiwan")) {
    return {
      primary: "#991B1B",      // 深紅
      secondary: "#DC2626",    // 紅色
      accent: "#EF4444",       // 亮紅
      light: "#FEF2F2",        // 淺紅背景
      gradient: "from-red-900 to-red-700"
    };
  }
  
  // 美洲 - 橙色系
  if (countryLower.includes("美國") || countryLower.includes("usa") ||
      countryLower.includes("加拿大") || countryLower.includes("canada") ||
      countryLower.includes("墨西哥") || countryLower.includes("mexico")) {
    return {
      primary: "#9A3412",      // 深橙
      secondary: "#EA580C",    // 橙色
      accent: "#F97316",       // 亮橙
      light: "#FFF7ED",        // 淺橙背景
      gradient: "from-orange-900 to-orange-700"
    };
  }
  
  // 預設 - 黑色系（極簡風格）
  return {
    primary: "#0A0A0A",      // 純黑
    secondary: "#1F2937",    // 更深的灰色
    accent: "#374151",       // 深灰色
    light: "#F9FAFB",        // 淺灰背景
    gradient: "from-gray-900 to-gray-700"
  };
};

// 交通類型圖標
const TransportIcon = ({ type, className = "h-5 w-5", style }: { type: string; className?: string; style?: React.CSSProperties }) => {
  switch (type) {
    case 'FLIGHT': return <Plane className={className} style={style} />;
    case 'TRAIN': return <Train className={className} style={style} />;
    case 'CRUISE': return <Ship className={className} style={style} />;
    case 'BUS': return <Bus className={className} style={style} />;
    case 'CAR': return <Car className={className} style={style} />;
    default: return <Plane className={className} style={style} />;
  }
};

// 導航標籤組件
const NavTabs = ({ 
  items, 
  activeTab, 
  onTabClick, 
  themeColor 
}: { 
  items: { id: string; label: string }[];
  activeTab: string;
  onTabClick: (id: string) => void;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
}) => {
  return (
    <div className="flex items-center gap-0 border-b border-gray-200 overflow-x-auto scrollbar-hide flex-nowrap min-w-0">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onTabClick(item.id)}
          className={`px-3 md:px-5 py-3 md:py-4 text-sm md:text-base font-semibold transition-all border-b-2 -mb-[2px] whitespace-nowrap flex-shrink-0 ${
            activeTab === item.id
              ? "border-current text-black"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
          style={activeTab === item.id ? { borderColor: themeColor.secondary } : {}}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};

// 餐廠詳情資料型別
interface MealDetail {
  name: string;
  description?: string;
  address?: string;
  phone?: string;
  menu?: string[];
  images?: string[];
  rating?: number;
  priceRange?: string;
}

// 景點詳情資料型別
interface AttractionDetail {
  name: string;
  title?: string;
  description?: string;
  address?: string;
  phone?: string;
  openingHours?: string;
  ticketPrice?: string;
  ticketInfo?: string;
  images?: string[];
  rating?: number;
  website?: string;
  tips?: string[];
  highlights?: string[];
  duration?: string;
}

// 景點詳情彈窗組件
const AttractionDetailDialog = ({
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
          <DialogTitle className="text-xl font-bold" style={{ color: themeColor.primary }}>
            {name}
          </DialogTitle>
        </DialogHeader>
        
        {/* 圖片輪播 */}
        {hasImages && (
          <div className="relative aspect-[16/9] rounded-xl overflow-hidden mb-4">
            <img
              src={images[currentImageIndex]}
              alt={name}
              className="w-full h-full object-cover rounded-xl"
            />
            {images.length > 1 && (
              <>
                <button 
                  onClick={() => setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-lg p-2 transition-colors"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button 
                  onClick={() => setCurrentImageIndex((prev) => (prev + 1) % images.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-lg p-2 transition-colors"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentImageIndex(idx)}
                      className={`w-2 h-2 rounded-lg transition-all ${idx === currentImageIndex ? 'bg-white w-4' : 'bg-white/50'}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        
        {/* 景點資訊 */}
        <div className="space-y-4">
          {/* 評分和建議遊覽時間 */}
          <div className="flex items-center gap-4 flex-wrap">
            {detail.rating && (
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
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
          
          {/* 景點介紹 */}
          {detail.description && (
            <div>
              <h4 className="font-semibold text-gray-900 mb-2">{t('tourDetail.attractionIntro')}</h4>
              <p className="text-gray-600 leading-relaxed">{detail.description}</p>
            </div>
          )}
          
          {/* 亮點特色 */}
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
          
          {/* 開放時間和門票資訊 */}
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
          
          {/* 貼心提示 */}
          {detail.tips && detail.tips.length > 0 && (
            <div className="bg-amber-50 rounded-lg p-4">
              <h4 className="font-semibold text-amber-800 mb-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {t('tourDetail.travelTips')}
              </h4>
              <ul className="space-y-1">
                {detail.tips.map((tip, idx) => (
                  <li key={idx} className="text-amber-700 text-sm flex items-start gap-2">
                    <span>•</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* 地址、電話和網站 */}
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
                <a 
                  href={detail.website} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {t('tourDetail.officialWebsite')}
                </a>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/// 餐食卡片組件 - 統一高度設計
const MealCard = ({
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
  
  const mealConfig = {
    breakfast: { 
      label: t('tourDetail.breakfast'), 
      icon: Coffee,
      borderColor: 'border-amber-300',
      bgColor: 'bg-amber-100', 
      textColor: 'text-amber-700',
      iconBg: 'bg-amber-200',
      hoverBg: 'hover:bg-amber-100/50'
    },
    lunch: { 
      label: t('tourDetail.lunch'), 
      icon: UtensilsCrossed,
      borderColor: 'border-orange-300',
      bgColor: 'bg-orange-100', 
      textColor: 'text-orange-700',
      iconBg: 'bg-orange-200',
      hoverBg: 'hover:bg-orange-100/50'
    },
    dinner: { 
      label: t('tourDetail.dinner'), 
      icon: Wine,
      borderColor: 'border-indigo-300',
      bgColor: 'bg-indigo-100', 
      textColor: 'text-indigo-700',
      iconBg: 'bg-indigo-200',
      hoverBg: 'hover:bg-indigo-100/50'
    }
  };
  
  const config = mealConfig[type];
  const IconComponent = config.icon;
  const hasImages = images && images.length > 0;
  const isSpecialMeal = name !== t('tourDetail.selfArranged') && name !== t('tourDetail.hotelMeal');
  
  const nextImage = () => {
    if (hasImages) {
      setCurrentImageIndex((prev) => (prev + 1) % images.length);
    }
  };
  
  const prevImage = () => {
    if (hasImages) {
      setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
    }
  };
  
  const handleClick = () => {
    if (isSpecialMeal && onShowDetail && detail) {
      onShowDetail(detail);
    }
  };
  
  return (
    <div 
      className={`bg-white border ${config.borderColor} rounded-xl overflow-hidden transition-all duration-300 ${config.hoverBg} ${isSpecialMeal ? 'cursor-pointer hover:shadow-md' : ''} flex flex-col h-full`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      {/* 圖片區域 - 固定高度 */}
      <div className="relative h-32 overflow-hidden rounded-lg bg-gray-100">
        {hasImages ? (
          <>
            <img 
              src={images[currentImageIndex]} 
              alt={name}
              className="w-full h-full object-cover transition-transform duration-500 rounded-xl"
              style={{ transform: isHovered ? 'scale(1.05)' : 'scale(1)' }}
            />
            {/* 滑動指示器 */}
            {images.length > 1 && (
              <>
                <button 
                  onClick={(e) => { e.stopPropagation(); prevImage(); }}
                  className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-lg p-1 transition-opacity"
                  style={{ opacity: isHovered ? 1 : 0 }}
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); nextImage(); }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-lg p-1 transition-opacity"
                  style={{ opacity: isHovered ? 1 : 0 }}
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-1">
                  {images.map((_, idx) => (
                    <div 
                      key={idx}
                      className={`w-1.5 h-1.5 rounded-lg transition-all ${idx === currentImageIndex ? 'bg-white w-3' : 'bg-white/50'}`}
                    />
                  ))}
                </div>
              </>
            )}
            {/* 特色餐食標籤 */}
            {isSpecialMeal && (
              <div className="absolute top-2 right-2 bg-white backdrop-blur-sm rounded-lg px-2 py-0.5 shadow-md border border-gray-200">
                <span className="text-xs font-medium text-gray-800">{t('tourDetail.specialMeal')}</span>
              </div>
            )}
          </>
        ) : (
          // 無圖片時顯示圖示
          <div className={`w-full h-full ${config.bgColor} flex items-center justify-center`}>
            <div className={`${config.iconBg} rounded-lg p-4`}>
              <IconComponent className={`h-8 w-8 ${config.textColor}`} />
            </div>
          </div>
        )}
      </div>
      
      {/* 餐食資訊 - 固定高度 */}
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

// 餐廳詳情彈窗組件
const MealDetailDialog = ({
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
          <DialogTitle className="text-xl font-bold" style={{ color: themeColor.primary }}>
            {detail.name}
          </DialogTitle>
        </DialogHeader>
        
        {/* 圖片輪播 */}
        {hasImages && (
          <div className="relative aspect-[16/9] rounded-xl overflow-hidden mb-4">
            <img
              src={images[currentImageIndex]}
              alt={detail.name}
              className="w-full h-full object-cover rounded-xl"
            />
            {images.length > 1 && (
              <>
                <button 
                  onClick={() => setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-lg p-2 transition-colors"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button 
                  onClick={() => setCurrentImageIndex((prev) => (prev + 1) % images.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-lg p-2 transition-colors"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentImageIndex(idx)}
                      className={`w-2 h-2 rounded-lg transition-all ${idx === currentImageIndex ? 'bg-white w-4' : 'bg-white/50'}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        
        {/* 餐廳資訊 */}
        <div className="space-y-4">
          {/* 評分和價格 */}
          <div className="flex items-center gap-4">
            {detail.rating && (
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                <span className="font-medium">{detail.rating}</span>
              </div>
            )}
            {detail.priceRange && (
              <div className="text-gray-600">
                <span className="font-medium">{t('tourDetail.priceRangeLabel')}</span>{detail.priceRange}
              </div>
            )}
          </div>
          
          {/* 餐廳介紹 */}
          {detail.description && (
            <div>
              <h4 className="font-semibold text-gray-900 mb-2">{t('tourDetail.restaurantIntro')}</h4>
              <p className="text-gray-600 leading-relaxed">{detail.description}</p>
            </div>
          )}
          
          {/* 推薦菜色 */}
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
          
          {/* 地址和電話 */}
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

// 每日行程卡片 - Zigzag 佈局
const DayCard = ({ 
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
      {/* Day Badge */}
      <div 
        className="absolute left-1/2 -translate-x-1/2 -top-5 z-10 px-6 py-2 text-base font-bold tracking-wider bg-white border-2 shadow-md rounded-lg"
        style={{ color: themeColor.primary, borderColor: themeColor.primary }}
      >
        DAY {day.day || index + 1}
      </div>
      
      {/* Content Container */}
      <div className={`flex flex-col ${isEven ? 'md:flex-row' : 'md:flex-row-reverse'} gap-0 bg-white`}>
        {/* Image Side */}
        <div className="md:w-1/2 aspect-[4/3] md:aspect-auto overflow-hidden rounded-xl img-hover-zoom">
          <img 
            src={dayImage}
            alt={day.title || `Day ${index + 1}`}
            className="w-full h-full object-cover transition-transform duration-700 rounded-xl"
            onError={() => setImgError(true)}
          />
        </div>
        
        {/* Content Side */}
        <div className="md:w-1/2 p-5 sm:p-8 md:p-12 flex flex-col justify-center">
          {/* Location */}
          <h3 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold mb-3 md:mb-4 leading-snug break-words" style={{ color: themeColor.primary }}>
            {day.title || day.location || `${t('tourDetail.day')} ${index + 1}`}
          </h3>
          
          {/* Description */}
          <p className="text-lg text-gray-600 leading-relaxed mb-6">
            {day.description || day.summary || t('tourDetail.description')}
          </p>
          
          {/* Activities Preview - 點擊可查看詳情 */}
          {day.activities && day.activities.length > 0 && (
            <div className="space-y-3 mb-6">
              {day.activities.slice(0, isExpanded ? undefined : 3).map((activity: any, actIndex: number) => (
                <div 
                  key={actIndex} 
                  className="flex items-start gap-3 cursor-pointer group hover:bg-gray-50 rounded-lg p-2 -ml-2 transition-colors"
                  onClick={() => onShowAttractionDetail(activity)}
                >
                  <div 
                    className="w-3 h-3 rounded-lg mt-2 flex-shrink-0 group-hover:scale-125 transition-transform"
                    style={{ backgroundColor: themeColor.primary }}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-lg group-hover:underline">{activity.title || activity.name}</span>
                      <ChevronRight className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    {activity.description && isExpanded && (
                      <p className="text-base text-gray-700 mt-1 line-clamp-2">{activity.description}</p>
                    )}
                    {/* 顯示快速資訊標籤 */}
                    {(activity.duration || activity.ticketPrice || activity.openingHours) && (
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-600">
                        {activity.duration && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {activity.duration}
                          </span>
                        )}
                        {activity.ticketPrice && (
                          <span className="flex items-center gap-1">
                            <Ticket className="h-3 w-3" />
                            {activity.ticketPrice}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {/* Expand Button - 每一日都顯示 */}
          {day.activities && day.activities.length > 0 && (
            <button
              onClick={onToggle}
              className="flex items-center gap-2 text-base font-bold transition-colors text-gray-900 hover:text-black"
            >
              {isExpanded ? (
                <>{t('tourDetail.collapse')} <ChevronUp className="h-4 w-4" /></>
              ) : (
                <>{t('tourDetail.readMore')} <ChevronDown className="h-4 w-4" /></>
              )}
            </button>
          )}
          
          {/* Meals Section - 獨立區塊 */}
          {day.meals && (day.meals.breakfast || day.meals.lunch || day.meals.dinner) && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <h4 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Utensils className="h-5 w-5" style={{ color: themeColor.primary }} />
                {t('tourDetail.todayMeals')}
              </h4>
              <div className="grid grid-cols-3 gap-3">
                {/* 早餐 */}
                <MealCard 
                  type="breakfast" 
                  name={day.meals.breakfast || t('tourDetail.selfArranged')}
                  images={day.meals.breakfastImages}
                  themeColor={themeColor}
                  detail={day.meals.breakfastDetail}
                  onShowDetail={onShowMealDetail}
                />
                {/* 午餐 */}
                <MealCard 
                  type="lunch" 
                  name={day.meals.lunch || t('tourDetail.selfArranged')}
                  images={day.meals.lunchImages}
                  themeColor={themeColor}
                  detail={day.meals.lunchDetail}
                  onShowDetail={onShowMealDetail}
                />
                {/* 晚餐 */}
                <MealCard 
                  type="dinner" 
                  name={day.meals.dinner || t('tourDetail.selfArranged')}
                  images={day.meals.dinnerImages}
                  themeColor={themeColor}
                  detail={day.meals.dinnerDetail}
                  onShowDetail={onShowMealDetail}
                />
              </div>
            </div>
          )}
          
          {/* Accommodation */}
          {day.accommodation && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2 text-base text-gray-800">
                <Building className="h-5 w-5" style={{ color: themeColor.primary }} />
                <span className="font-medium">{t('tourDetail.todayHotel')}</span>
                <span>{day.accommodation}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// 設施圖示映射
const getFacilityIcons = (t: (key: string) => string): Record<string, { icon: React.ReactNode; label: string }> => ({
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
const parseStarRating = (stars: string | undefined): number => {
  if (!stars) return 0;
  if (stars.includes('五星') || stars.includes('5')) return 5;
  if (stars.includes('四星') || stars.includes('4')) return 4;
  if (stars.includes('三星') || stars.includes('3')) return 3;
  if (stars.includes('二星') || stars.includes('2')) return 2;
  if (stars.includes('一星') || stars.includes('1')) return 1;
  return 0;
};

// 飯店詳情資料類型
interface HotelDetail {
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
const HotelCard = ({ hotel, themeColor }: { hotel: any; themeColor: ReturnType<typeof getThemeColorByDestination> }) => {
  const { t, formatPrice } = useLocale();
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
                  <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                ))}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        
        {/* 圖片輪播 */}
        {hasImages && (
          <div className="relative aspect-video overflow-hidden rounded-xl mb-6">
            <img
              src={images[currentImageIndex]}
              alt={hotel.imageAlt || hotel.name}
              className="w-full h-full object-cover rounded-xl"
            />
            {images.length > 1 && (
              <>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
                  }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-lg p-2 transition-colors"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentImageIndex((prev) => (prev + 1) % images.length);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-lg p-2 transition-colors"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCurrentImageIndex(idx);
                      }}
                      className={`w-2 h-2 rounded-lg transition-all ${idx === currentImageIndex ? 'bg-white w-4' : 'bg-white/50'}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        
        {/* 評分和評價數 */}
        {(detail?.rating || detail?.totalReviews) && (
          <div className="flex items-center gap-4 mb-4">
            {detail.rating && (
              <div className="flex items-center gap-1">
                <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
                <span className="font-bold text-lg">{detail.rating}</span>
              </div>
            )}
            {detail.totalReviews && (
              <span className="text-gray-500">{(t('tourDetail.reviewCount')).replace('{count}', String(detail.totalReviews))}</span>
            )}
          </div>
        )}
        
        {/* 位置資訊 */}
        {(detail?.address || hotel.location) && (hotel.location !== '待確認') && (
          <div className="flex items-center gap-2 text-gray-600 mb-4">
            <MapPin className="h-5 w-5" style={{ color: themeColor.secondary }} />
            <span className="text-lg">{detail?.address || hotel.location}</span>
          </div>
        )}
        
        {/* 入住/退房時間 */}
        {(detail?.checkIn || detail?.checkOut) && (
          <div className="flex items-center gap-6 mb-4 text-gray-600">
            {detail.checkIn && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" style={{ color: themeColor.secondary }} />
                <span>{t('tourDetail.checkIn')}{detail.checkIn}</span>
              </div>
            )}
            {detail.checkOut && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" style={{ color: themeColor.secondary }} />
                <span>{t('tourDetail.checkOut')}{detail.checkOut}</span>
              </div>
            )}
          </div>
        )}
        
        {/* 詳細描述 */}
        {(detail?.description || hotel.description) && (hotel.description !== '待確認') && (
          <div className="mb-6">
            <h4 className="font-semibold text-lg mb-2" style={{ color: themeColor.primary }}>{t('tourDetail.hotelIntroTitle')}</h4>
            <p className="text-gray-600 leading-relaxed">{detail?.description || hotel.description}</p>
          </div>
        )}
        
        {/* 設施列表 */}
        {(detail?.amenities?.length || facilities.length > 0) && (
          <div className="mb-6">
            <h4 className="font-semibold text-lg mb-3" style={{ color: themeColor.primary }}>{t('tourDetail.hotelFacilities')}</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {(detail?.amenities || facilities).map((facility: string, idx: number) => {
                const facilityInfo = facilityIcons[facility.toLowerCase()];
                return (
                  <div 
                    key={idx} 
                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                  >
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
        
        {/* 房型資訊 */}
        <div className="mb-6">
          <h4 className="font-semibold text-lg mb-3" style={{ color: themeColor.primary }}>{t('tourDetail.roomTypeInfo')}</h4>
          <div className="grid gap-3">
            {detail?.roomTypes?.length ? (
              detail.roomTypes.map((room, idx) => (
                <div key={idx} className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
                  {room.image && (
                    <img src={room.image} alt={room.name} className="w-24 h-16 object-cover rounded-xl flex-shrink-0" />
                  )}
                  <div className="flex-grow">
                    <p className="font-medium">{room.name}</p>
                    <p className="text-sm text-gray-500">{room.description}</p>
                  </div>
                  {room.price && (
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold" style={{ color: themeColor.secondary }}>{room.price}</p>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <>
                <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
                  <div>
                    <p className="font-medium">{t('tourDetail.standardRoom')}</p>
                    <p className="text-sm text-gray-500">{t('tourDetail.standardRoomDesc')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">{t('tourDetail.perNight')}</p>
                    <p className="font-bold" style={{ color: themeColor.secondary }}>{t('tourDetail.includedInTour')}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
                  <div>
                    <p className="font-medium">{t('tourDetail.upgradeRoom')}</p>
                    <p className="text-sm text-gray-500">{t('tourDetail.upgradeRoomDesc')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">{t('tourDetail.perNightExtra')}</p>
                    <p className="font-bold" style={{ color: themeColor.secondary }}>+{formatPrice(2000, "TWD")}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        
        {/* 住客評價 */}
        {detail?.reviews && detail.reviews.length > 0 && (
          <div className="mb-6">
            <h4 className="font-semibold text-lg mb-3" style={{ color: themeColor.primary }}>{t('tourDetail.reviews')}</h4>
            <div className="space-y-4">
              {detail.reviews.map((review, idx) => (
                <div key={idx} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gray-300 flex items-center justify-center text-white font-medium">
                        {review.author.charAt(0)}
                      </div>
                      <span className="font-medium">{review.author}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {[...Array(5)].map((_, i) => (
                        <Star 
                          key={i} 
                          className={`h-4 w-4 ${i < review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} 
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-gray-600 text-sm">{review.comment}</p>
                  {review.date && (
                    <p className="text-gray-400 text-xs mt-2">{review.date}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* 聯絡資訊 */}
        {(detail?.phone || detail?.website) && (
          <div className="mb-6 pt-4 border-t border-gray-100">
            <h4 className="font-semibold text-lg mb-3" style={{ color: themeColor.primary }}>{t('tourDetail.contactInfo')}</h4>
            <div className="space-y-2">
              {detail.phone && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Phone className="h-4 w-4" style={{ color: themeColor.secondary }} />
                  <span>{detail.phone}</span>
                </div>
              )}
              {detail.website && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Building className="h-4 w-4" style={{ color: themeColor.secondary }} />
                  <a href={detail.website} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: themeColor.secondary }}>
                    {t('tourDetail.officialWebsite')}
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* 備註 */}
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
    <div 
      className="bg-white overflow-hidden rounded-xl shadow-lg hover:shadow-lg transition-all duration-300 group cursor-pointer card-hover-scale"
      onClick={() => setIsDialogOpen(true)}
    >
      {/* 圖片區域 */}
      <div className="relative aspect-[16/10] overflow-hidden rounded-xl">
        <img 
          src={hotel.image || "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800"}
          alt={hotel.imageAlt || hotel.name}
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 rounded-xl"
        />
        {/* 星級標籤 */}
        {starRating > 0 && (
          <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-sm px-3 py-1.5 flex items-center gap-1 shadow-md rounded-md">
            {[...Array(starRating)].map((_, i) => (
              <Star key={i} className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
            ))}
          </div>
        )}
        {/* 漸層遮罩 */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </div>
      
      {/* 內容區域 */}
      <div className="p-6">
        {/* 飯店名稱 */}
        <h3 className="text-xl font-bold mb-2 text-gray-900 group-hover:text-primary transition-colors">
          {hotel.name}
        </h3>
        
        {/* 位置 */}
        {hotel.location && hotel.location !== '待確認' && (
          <p className="text-sm text-gray-500 mb-3 flex items-center gap-1.5">
            <MapPin className="h-4 w-4 flex-shrink-0" style={{ color: themeColor.secondary }} />
            <span className="truncate">{hotel.location}</span>
          </p>
        )}
        
        {/* 描述 */}
        {hotel.description && hotel.description !== '待確認' && (
          <p className="text-gray-600 text-sm leading-relaxed mb-4 line-clamp-3">
            {hotel.description}
          </p>
        )}
        
        {/* 設施圖示 */}
        {facilities.length > 0 && (
          <div className="pt-4 border-t border-gray-100">
            <div className="flex flex-wrap gap-3">
              {facilities.slice(0, 6).map((facility: string, idx: number) => {
                const facilityInfo = facilityIcons[facility.toLowerCase()];
                if (!facilityInfo) return null;
                return (
                  <div 
                    key={idx} 
                    className="flex items-center gap-1.5 text-gray-500 text-xs"
                    title={facilityInfo.label}
                  >
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

// ─── Price Comparison Widget ───────────────────────────────────────────────
const PriceComparisonWidget = ({
  tourId,
  tourPrice,
  themeColor,
}: {
  tourId: number;
  tourPrice: number;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
}) => {
  const { t, formatPrice } = useLocale();
  const utils = trpc.useUtils();
  const trackClickMutation = trpc.affiliate.trackClick.useMutation();
  const { data: comparison, isLoading } = trpc.affiliate.getPriceComparison.useQuery({ tourId });
  if (isLoading || !comparison) return null;
  const selfBookTotal = comparison.totalSelfBook ?? 0;
  const savings = selfBookTotal > 0 ? selfBookTotal - tourPrice : 0;
  const savingsPct = selfBookTotal > 0 ? Math.round((savings / selfBookTotal) * 100) : 0;

  const handleFlightClick = async () => {
    try {
      const result = await utils.affiliate.generateAffiliateLink.fetch({ type: "flights" });
      await trackClickMutation.mutateAsync({
        platform: "trip_flights",
        targetUrl: result.url,
        referrerPage: `/tours/${tourId}`,
      });
      window.open(result.url, "_blank");
    } catch {}
  };

  const handleHotelClick = async () => {
    try {
      const result = await utils.affiliate.generateAffiliateLink.fetch({ type: "hotels" });
      await trackClickMutation.mutateAsync({
        platform: "trip_hotels",
        targetUrl: result.url,
        referrerPage: `/tours/${tourId}`,
      });
      window.open(result.url, "_blank");
    } catch {}
  };

  return (
    <div className="mt-10 bg-gray-50 rounded-2xl border border-gray-200 p-6">
      <h3 className="text-lg font-bold text-gray-900 mb-1">{t('tourDetail.priceComparison.title')}</h3>
      <p className="text-sm text-gray-500 mb-5">{t('tourDetail.priceComparison.subtitle')}</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        {[
          { label: t('tourDetail.priceComparison.flightEstimate'), value: comparison.flightEstimate, onClick: handleFlightClick, clickLabel: t('tourDetail.priceComparison.searchFlights') },
          { label: t('tourDetail.priceComparison.hotelEstimate'), value: comparison.hotelEstimate, onClick: handleHotelClick, clickLabel: t('tourDetail.priceComparison.searchHotels') },
          { label: t('tourDetail.priceComparison.activityEstimate'), value: comparison.activityEstimate, onClick: null, clickLabel: null },
          { label: t('tourDetail.priceComparison.mealEstimate'), value: comparison.mealEstimate, onClick: null, clickLabel: null },
          { label: t('tourDetail.priceComparison.transportEstimate'), value: comparison.transportEstimate, onClick: null, clickLabel: null },
          { label: t('tourDetail.priceComparison.otherEstimate'), value: comparison.otherEstimate, onClick: null, clickLabel: null },
        ].map((item, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-500 mb-1">{item.label}</p>
            <p className="text-base font-bold text-gray-900">
              {item.value ? formatPrice(item.value, "TWD") : t('tourDetail.priceComparison.inquire')}
            </p>
            {item.onClick && item.value && (
              <button
                onClick={item.onClick}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 underline underline-offset-2"
              >
                {item.clickLabel} <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white rounded-xl border border-gray-200 p-4">
        <div>
          <p className="text-sm text-gray-500">{t('tourDetail.priceComparison.selfBookTotal')}</p>
          <p className="text-2xl font-bold text-gray-900">
            {selfBookTotal > 0 ? `NT$ ${selfBookTotal.toLocaleString()}` : t('tourDetail.priceComparison.inquire')}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-400">{t('tourDetail.priceComparison.vs')}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">{t('tourDetail.priceComparison.packagePrice')}</p>
          <p className="text-2xl font-bold" style={{ color: themeColor.primary }}>
            NT$ {tourPrice.toLocaleString()}
          </p>
        </div>
        {savings > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center">
            <p className="text-xs text-green-700 font-medium">{t('tourDetail.priceComparison.savings')}</p>
            <p className="text-xl font-bold text-green-700">NT$ {savings.toLocaleString()}</p>
            <p className="text-xs text-green-600">{t('tourDetail.priceComparison.savingsPct').replace('{pct}', String(savingsPct))}</p>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-3 text-center">{t('tourDetail.priceComparison.dataSource').replace('{flight}', comparison.flightSource || 'Trip.com').replace('{hotel}', comparison.hotelSource || 'Trip.com').replace('{date}', new Date(comparison.lastUpdated).toLocaleDateString())}</p>
    </div>
  );
};

export default function TourDetailPeony() {
  const { t, language, formatPrice } = useLocale();
  const [matchSipin, paramsSipin] = useRoute("/tours-sipin/:id");
  const [matchTours, paramsTours] = useRoute("/tours/:id");
  const [matchMinimal, paramsMinimal] = useRoute("/tours-minimal/:id");
  const [matchPeony, paramsPeony] = useRoute("/tours-peony/:id");
  const params = paramsSipin || paramsTours || paramsMinimal || paramsPeony;
  const [, navigate] = useLocation();
  const tourId = params?.id ? parseInt(params.id) : undefined;

  const { data: tour, isLoading, error, refetch } = trpc.tours.getById.useQuery(
    { id: tourId! },
    { enabled: !!tourId }
  );

  // v78m Sprint 5C: record this view in localStorage for the "Recently viewed"
  // section on the homepage (only fires when we successfully load a tour)
  useEffect(() => {
    if (tourId) recordTourView(tourId);
  }, [tourId]);

  // 多語言翻譯查詢：語系非 zh-TW 時自動載入翻譯
  const { data: tourTranslations } = trpc.translation.getTourTranslations.useQuery(
    { tourId: tourId!, targetLanguage: language as 'zh-TW' | 'en' | 'ja' | 'ko' },
    { enabled: !!tourId && language !== 'zh-TW' }
  );

  // 取得翻譯後的欄位值（優雅降級到原始中文）
  // API 回傳格式為 Record<string, string>，例如 { title: "...", description: "..." }
  const getTranslated = (fieldName: string, fallback: string | null | undefined): string | null | undefined => {
    if (language === 'zh-TW' || !tourTranslations) return fallback;
    const translationMap = tourTranslations as Record<string, string>;
    const translated = translationMap[fieldName];
    return translated ?? fallback;
  };

  // 編輯模式狀態
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedTour, setEditedTour] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  // 追蹤已修改的欄位（用於顯示修改數量）
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());
  const [showShareDialog, setShowShareDialog] = useState(false);

  // 更新行程 mutation
  const utils = trpc.useUtils();
  const updateTourMutation = trpc.tours.update.useMutation({
    onSuccess: () => {
      toast.success(t('tourDetail.tourUpdated'));
      utils.tours.getById.invalidate({ id: tourId! });
      refetch();
      setHasChanges(false);
      setIsEditMode(false);
      setEditedTour(null);
      setDirtyFields(new Set());
    },
    onError: (error) => {
      toast.error(`${t('tourDetail.updateFailed')}${error.message}`);
    },
  });

  // PDF 下載 mutation — calls server-side Puppeteer, returns S3 URL
  const generatePdfMutation = trpc.tours.generatePdf.useMutation({
    onSuccess: (data) => {
      toast.success(t('tourDetail.pdfGenerated'));
      // Open the signed PDF URL in a new tab so the browser downloads / previews it
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
    },
    onError: (error) => {
      toast.error(`${t('tourDetail.pdfFailed')}${error.message}`);
    },
  });

  // GA4: 行程詳情頁瀏覽事件
  useEffect(() => {
    if (tour) {
      trackViewTour({
        tourId: tour.id,
        tourName: getTranslated('title', tour.title) ?? tour.title,
        destination: (tour as any).destinationCountry ?? (tour as any).destination ?? "",
        price: (tour as any).price ?? 0,
        currency: "TWD",
      });
    }
  }, [tour?.id]);

  // 進入編輯模式時複製資料
  // 修復：依賴只放 isEditMode，避免 tRPC 每次 render 回傳新物件參考造成無限迴圈
  // 使用 useRef 快照 tour，確保切換時只執行一次深拷貝
  const tourRef = useRef(tour);
  useEffect(() => {
    tourRef.current = tour;
  });

  useEffect(() => {
    if (isEditMode && tourRef.current) {
      // 用 requestAnimationFrame 避免阻塞 UI thread，讓瀏覽器先渲染編輯模式 UI
      // 再用 structuredClone 進行深拷貝（效能優於 JSON.parse/stringify）
      const snapshot = tourRef.current;
      requestAnimationFrame(() => {
        setEditedTour(structuredClone(snapshot));
      });
    } else if (!isEditMode) {
      // 退出編輯模式時清空，避免殘留舊資料
      setEditedTour(null);
    }
  }, [isEditMode]);

  // 更新欄位
  const updateField = (field: string, value: any) => {
    setEditedTour((prev: any) => {
      if (!prev) return prev;
      const updated = { ...prev, [field]: value };
      setHasChanges(true);
      return updated;
    });
    // 記錄已修改的欄位
    setDirtyFields((prev) => new Set(prev).add(field));
  };

  // 儲存變更
  const handleSave = async () => {
    if (!editedTour || !hasChanges) return;
    setIsSaving(true);
    try {
      const toJsonStr = (val: any) =>
        typeof val === 'string' ? val : val != null ? JSON.stringify(val) : undefined;

      await updateTourMutation.mutateAsync({
        id: editedTour.id,
        // 基本欄位
        title: editedTour.title,
        poeticTitle: editedTour.poeticTitle,
        description: editedTour.description,
        heroSubtitle: editedTour.heroSubtitle,
        heroImage: editedTour.heroImage,
        price: editedTour.price,
        duration: editedTour.duration,
        departureCity: editedTour.departureCity,
        promotionText: editedTour.promotionText,
        notes: editedTour.notes,
        // JSON 內容欄位
        itineraryDetailed: toJsonStr(editedTour.itineraryDetailed),
        keyFeatures: toJsonStr(editedTour.keyFeatures),
        hotels: toJsonStr(editedTour.hotels),
        meals: toJsonStr(editedTour.meals),
        flights: toJsonStr(editedTour.flights),
        highlights: toJsonStr(editedTour.highlights),
        includes: toJsonStr(editedTour.includes),
        excludes: toJsonStr(editedTour.excludes),
        // 費用說明與注意事項（新增可編輯欄位）
        costExplanation: toJsonStr(editedTour.costExplanation),
        noticeDetailed: toJsonStr(editedTour.noticeDetailed),
        attractions: toJsonStr(editedTour.attractions),
      });
    } finally {
      setIsSaving(false);
    }
  };

  // 取消編輯
  const handleCancelEdit = () => {
    if (hasChanges) {
      if (confirm(t('tourDetail.unsavedChanges'))) {
        setIsEditMode(false);
        setEditedTour(null);
        setHasChanges(false);
        setDirtyFields(new Set());
      }
    } else {
      setIsEditMode(false);
      setEditedTour(null);
      setDirtyFields(new Set());
    }
  };

  // 取得當前顯示的資料（編輯模式下使用編輯中的資料）
  const displayTour = isEditMode && editedTour ? editedTour : tour;

  const [activeTab, setActiveTab] = useState("overview");
  // 預設展開所有天數
  // v78n Sprint 6C: default to collapsed (only Day 1 open) so users can scan
  // the itinerary at a glance, then expand the days they care about.
  const [expandedDays, setExpandedDays] = useState<Set<number>>(() => new Set([0]));
  const [selectedMealDetail, setSelectedMealDetail] = useState<MealDetail | null>(null);
  const [isMealDetailOpen, setIsMealDetailOpen] = useState(false);
  const [selectedAttractionDetail, setSelectedAttractionDetail] = useState<AttractionDetail | null>(null);
  const [isAttractionDetailOpen, setIsAttractionDetailOpen] = useState(false);

  // 景點詳情彈窗處理
  const handleShowAttractionDetail = (activity: any) => {
    // 將 activity 轉換為 AttractionDetail 格式
    const detail: AttractionDetail = {
      name: activity.title || activity.name || t('tourDetail.attraction'),
      description: activity.description || activity.summary,
      address: activity.address || activity.location,
      phone: activity.phone,
      openingHours: activity.openingHours || activity.hours,
      ticketPrice: activity.ticketPrice || activity.price,
      ticketInfo: activity.ticketInfo,
      images: activity.images || (activity.image ? [activity.image] : []),
      rating: activity.rating,
      website: activity.website || activity.url,
      tips: activity.tips,
      highlights: activity.highlights || activity.features,
      duration: activity.duration || activity.visitTime,
    };
    setSelectedAttractionDetail(detail);
    setIsAttractionDetailOpen(true);
  };

  // 餐廠詳情彈窗處理
  const handleShowMealDetail = (detail: MealDetail) => {
    setSelectedMealDetail(detail);
    setIsMealDetailOpen(true);
  };

  // Section refs for scroll tracking
  const sectionRefs = {
    overview: useRef<HTMLElement>(null),
    itinerary: useRef<HTMLElement>(null),
    features: useRef<HTMLElement>(null),
    hotels: useRef<HTMLElement>(null),
    pricing: useRef<HTMLElement>(null),
    notes: useRef<HTMLElement>(null),
  };

  // 根據目的地計算主題色
  const themeColor = useMemo(() => {
    if (tour?.colorTheme) {
      const parsed = parseJSON(tour.colorTheme, null);
      if (parsed) {
        return {
          primary: parsed.primary || "#0A0A0A",
          secondary: parsed.secondary || parsed.accent || "#2563EB",
          accent: parsed.accent || "#3B82F6",
          light: parsed.light || "#F9FAFB",
          gradient: "from-gray-900 to-gray-700"
        };
      }
    }
    return getThemeColorByDestination(tour?.destinationCountry);
  }, [tour]);

  // Scroll tracking
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 200;
      
      for (const [key, ref] of Object.entries(sectionRefs)) {
        if (ref.current) {
          const { offsetTop, offsetHeight } = ref.current;
          if (scrollPosition >= offsetTop && scrollPosition < offsetTop + offsetHeight) {
            setActiveTab(key);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const ref = sectionRefs[sectionId as keyof typeof sectionRefs];
    if (ref?.current) {
      const yOffset = -150;
      const y = ref.current.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  const toggleDay = (dayNum: number) => {
    setExpandedDays(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dayNum)) {
        newSet.delete(dayNum);
      } else {
        newSet.add(dayNum);
      }
      return newSet;
    });
  };

  // ====== JSON 欄位 useMemo 快取（必須在所有條件 return 之前，避免 React Error #310）======
  // keyFeatures: 編輯模式下從 editedTour 讀取，非中文模式使用翻譯
  const keyFeatures = useMemo(() => {
    if (isEditMode && editedTour?.keyFeatures != null) {
      const src = editedTour.keyFeatures;
      return typeof src === 'string' ? parseJSON(src, []) : (src || []);
    }
    const source = getTranslated('keyFeatures', tour?.keyFeatures) ?? tour?.keyFeatures;
    return typeof source === 'string' ? parseJSON(source, []) : (source || []);
  }, [isEditMode, editedTour?.keyFeatures, tour?.keyFeatures, language, tourTranslations]);

  const attractions = useMemo(() => parseJSON(tour?.attractions, []), [tour?.attractions]);
  const hotels = useMemo(() => {
    const source = getTranslated('hotels', tour?.hotels) ?? tour?.hotels;
    return parseJSON(source, []);
  }, [tour?.hotels, language, tourTranslations]);
  const meals = useMemo(() => {
    const source = getTranslated('meals', tour?.meals) ?? tour?.meals;
    return parseJSON(source, {});
  }, [tour?.meals, language, tourTranslations]);
  // v78p: Add `tourTranslations` to deps — was missing, causing stale memos
  // when async translation data loaded AFTER initial render. Symptom: pages
  // showed Chinese until next state change.
  const itineraryDetailed = useMemo(() => {
    const source = getTranslated('itineraryDetailed', tour?.itineraryDetailed) ?? tour?.itineraryDetailed;
    return parseJSON(source, []);
  }, [tour?.itineraryDetailed, language, tourTranslations]);
  const costExplanation = useMemo(() => parseJSON(
    getTranslated('costExplanation', tour?.costExplanation) ?? tour?.costExplanation, null
  ), [tour?.costExplanation, language, tourTranslations]);
  const transportationInfo = useMemo(() => parseJSON(
    getTranslated('flights', tour?.flights) ?? tour?.flights, null
  ), [tour?.flights, language, tourTranslations]);
  const noticeDetailed = useMemo(() => parseJSON(
    getTranslated('noticeDetailed', tour?.noticeDetailed) ?? tour?.noticeDetailed, null
  ), [tour?.noticeDetailed, language, tourTranslations]);

  // displayItinerary: 編輯模式下從 editedTour 讀取，消除 JSX 中重複 parse
  const displayItinerary = useMemo(() => {
    if (isEditMode && editedTour?.itineraryDetailed != null) {
      return typeof editedTour.itineraryDetailed === 'string'
        ? parseJSON(editedTour.itineraryDetailed, [])
        : editedTour.itineraryDetailed;
    }
    return itineraryDetailed;
  }, [isEditMode, editedTour?.itineraryDetailed, itineraryDetailed]);
  // ====== 結束 JSON 欄位 useMemo 快取 ======

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-black border-t-transparent rounded-lg animate-spin mx-auto"></div>
          <p className="mt-6 text-sm tracking-widest uppercase text-gray-500">Loading</p>
        </div>
      </div>
    );
  }

  if (error || !tour) {
    return (
      <div className="min-h-screen flex flex-col bg-white">
        <Header />
        <div className="flex-grow flex items-center justify-center">
          <div className="text-center max-w-md mx-auto px-6">
            <h2 className="text-4xl font-light mb-4">404</h2>
            <p className="text-gray-500 mb-8">{t('tourDetail.tourNotFound')}</p>
            <Button 
              onClick={() => navigate("/")} 
              className="bg-black text-white hover:bg-gray-800 rounded-lg px-8 py-3"
            >
              {t('tourDetail.backToHome')}
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  // 解析資料（多語言翻譯覆蓋）
  // 編輯模式下使用 editedTour，否則使用原始 tour
  const heroImage = (isEditMode && editedTour?.heroImage) 
    ? editedTour.heroImage 
    : (tour.heroImage || tour.imageUrl || "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1200");
  // 翻譯覆蓋：文字欄位
  const displayTitle = getTranslated('title', tour.title) ?? tour.title;
  // v78j: split long titles into clean primary headline + subtitle chips.
  // Heuristic: if first segment is < 6 chars (likely a marketing prefix like
  // "好運發發發"), skip it and use the second segment as primary.
  const _segments = (displayTitle || "").split(/[|｜]/).map(s => s.trim()).filter(Boolean);
  const _isMarketingPrefix = (s: string) => s.length < 6 && !/[0-9]|day|night|天|夜/i.test(s);
  const _primaryIdx = _segments.length > 1 && _isMarketingPrefix(_segments[0]) ? 1 : 0;
  const primaryTitle = _segments[_primaryIdx] || displayTitle || "";
  const titleChips = _segments.filter((_, i) => i !== _primaryIdx);
  const displayDescription = getTranslated('description', tour.description) ?? tour.description;
  const displayHeroSubtitle = getTranslated('heroSubtitle', (tour as any).heroSubtitle) ?? (tour as any).heroSubtitle;
  // 導覽項目
  const navItems = [
    // BUG-005 fix: removed duplicate 'features' tab (same section as 'overview')
    { id: "overview", label: t('tourDetail.tabs.overview') },
    { id: "itinerary", label: t('tourDetail.tabs.itinerary') },
    { id: "hotels", label: t('tourDetail.tabs.hotel') },
    { id: "pricing", label: t('tourDetail.tabs.pricing') },
    { id: "notes", label: t('tourDetail.tabs.notes') },
  ];

  // 確保陣列類型
  const ensureArray = (val: any) => Array.isArray(val) ? val : [];

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* 動態 SEO meta 標籤 */}
      {/* Round 72: always pass bilingual { zh, en } tuples so crawlers see the
          correct language regardless of the viewer's active locale. The zh
          value is the canonical DB content; en falls back to zh when no
          translation exists yet. */}
      <SEO
        title={{
          zh: tour.title,
          en: ((tourTranslations as Record<string, string> | undefined)?.title) ?? tour.title,
        }}
        description={{
          zh: tour.description ?? "",
          en: ((tourTranslations as Record<string, string> | undefined)?.description) ?? tour.description ?? "",
        }}
        image={(tour as any).heroImage || (tour as any).imageUrl || undefined}
        url={`/tours/${tour.id}`}
        type="article"
        schema={buildTourSchema({
          id: tour.id,
          title: displayTitle,
          description: displayDescription,
          price: (tour as any).price,
          currency: (tour as any).currency ?? "TWD",
          duration: (tour as any).duration,
          destination: (tour as any).destinationCountry ?? (tour as any).destination,
          images: (tour as any).images,
        })}
      />
      {/* 編輯模式標題橫幅 */}
      {isAdmin && <EditModeBanner isEditMode={isEditMode} hasChanges={hasChanges} />}
      
      {/* 編輯模式切換按鈕 */}
      {isAdmin && (
        <EditModeToggle
          isEditMode={isEditMode}
          onToggle={() => setIsEditMode(!isEditMode)}
          onSave={handleSave}
          onCancel={handleCancelEdit}
          isSaving={isSaving}
          hasChanges={hasChanges}
          changesCount={dirtyFields.size}
        />
      )}
      
      <Header />

      {/* Breadcrumb */}
      <div className="bg-gray-50 py-3 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <button onClick={() => navigate("/")} className="hover:text-black transition-colors">{t('nav.home')}</button>
            <span>&gt;</span>
            <button onClick={() => navigate("/tours")} className="hover:text-black transition-colors">{t('nav.allTours')}</button>
            <span>&gt;</span>
            <span className="text-black">{displayTitle}</span>
          </div>
        </div>
      </div>

      {/* Hero Section — v78r: compressed (was 60vh) so the title doesn't crowd out the photo */}
      <section className="relative h-[35vh] sm:h-[40vh] md:h-[45vh] min-h-[280px] max-h-[480px]">
        {isEditMode ? (
          <div className="absolute inset-0">
            <EditableImage
              src={displayTour.heroImage || heroImage}
              alt={displayTour.title || t('tourDetail.tourImageAlt')}
              onSave={(newSrc) => updateField('heroImage', newSrc)}
              isEditing={isEditMode}
              className="w-full h-full"
              aspectRatio="auto"
              tourId={tourId}
              imagePath="hero"
            />
            <div className={`absolute inset-0 bg-gradient-to-t ${themeColor.gradient} opacity-60 pointer-events-none`} />
          </div>
        ) : (
          <div 
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${heroImage})` }}
          >
            <div className={`absolute inset-0 bg-gradient-to-t ${themeColor.gradient} opacity-60`} />
          </div>
        )}
        
        <div className="relative h-full max-w-7xl mx-auto px-6 flex flex-col justify-center items-center text-center">
          {/* Title */}
          {isEditMode ? (
            <EditableText
              value={displayTour.title || ""}
              onSave={(value) => updateField("title", value)}
              isEditing={isEditMode}
              className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-3 max-w-4xl leading-tight drop-shadow-lg"
              placeholder={t('tourDetail.editTitlePlaceholder')}
              as="h1"
              darkBackground
            />
          ) : (
            <>
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-3 max-w-4xl leading-tight drop-shadow-lg" title={displayTitle}>
                {primaryTitle}
              </h1>
              {/* v78j: highlight chips from secondary title segments */}
              {/* v78r: keep only short, punchy chips (≤ 24 chars) max 2; the long
                  marketing copy was duplicating the main title and crowding the hero */}
              {titleChips.length > 0 && (() => {
                const punchy = titleChips.filter((c) => c.length <= 24).slice(0, 2);
                if (punchy.length === 0) return null;
                return (
                  <div className="flex flex-wrap items-center gap-2 mb-4 max-w-3xl">
                    {punchy.map((chip, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2.5 py-1 rounded-md bg-white/15 backdrop-blur-sm border border-white/20 text-xs md:text-sm text-white font-medium"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                );
              })()}
            </>
          )}

          {/* Subtitle / Poetic Title — v78p: respect translation lookup for EN */}
          {(displayTour.poeticTitle || isEditMode) && (
            isEditMode ? (
              <EditableText
                value={displayTour.poeticTitle || ""}
                onSave={(value) => updateField("poeticTitle", value)}
                isEditing={isEditMode}
                className="text-xl md:text-2xl text-white/90 mb-6 max-w-2xl"
                placeholder={t('tourDetail.editSubtitlePlaceholder')}
                as="p"
                darkBackground
              />
            ) : (
              <p className="text-xl md:text-2xl text-white/90 mb-6 max-w-2xl">
                {getTranslated('poeticTitle', displayTour.poeticTitle) ?? displayTour.poeticTitle}
              </p>
            )
          )}

          {/* Meta info */}
          <div className="flex flex-wrap items-center justify-center gap-2 md:gap-4 text-white/90 text-xs sm:text-sm md:text-base px-4">
            {/* Destination Country Badge */}
            {tour.destinationCountry && (
              <div 
                className="flex items-center gap-2 px-3 py-1 rounded-lg text-sm bg-white/95 backdrop-blur-sm shadow-md"
                style={{ color: themeColor.primary }}
              >
                <Globe className="h-4 w-4" />
                <span>{translateDestination(tour.destinationCountry, language)}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              <span>{tour.duration || t('tourDetail.multiDayTour')}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              <span>{(() => {
                const rawCities = (tour.destinationCity || tour.destinationCountry || '').split(/[,、]/).map((c: string) => c.trim()).filter(Boolean);
                const translatedCities = rawCities.map((c: string) => translateDestination(c, language));
                const sep = language === 'zh-TW' ? '、' : ', ';
                if (translatedCities.length <= 4) return translatedCities.join(sep);
                return translatedCities.slice(0, 4).join(sep) + '…';
              })()}</span>
            </div>
            {transportationInfo?.type && transportationInfo.typeName && transportationInfo.typeName !== '待確認' && (
              <div className="flex items-center gap-2">
                <TransportIcon type={transportationInfo.type} className="h-5 w-5" />
                <span>{language === 'en'
                  ? (TRANSPORT_TYPE_EN[transportationInfo.typeName] || transportationInfo.typeName)
                  : transportationInfo.typeName}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* v78t: Trust badges strip — under hero, above Quick Facts.
          Reinforces decision with visible legal credentials before the user even
          reaches the price + Book CTA. CST + TCRF are California Seller of Travel
          law requirements; Stripe + 24h support are competitive differentiators. */}
      <section className="bg-gray-50 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-2.5">
          <div className="flex items-center justify-center md:justify-between gap-3 md:gap-6 flex-wrap text-[11px] md:text-xs text-gray-600">
            <div className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
              <span className="hidden sm:inline">{language === 'en' ? 'California Seller of Travel' : '加州合法旅行社'} </span>
              <span className="font-semibold text-gray-800">CST #2166984</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Heart className="h-3.5 w-3.5 text-pink-600 flex-shrink-0" />
              <span>{language === 'en' ? 'TCRF Consumer Protection' : 'TCRF 消費者保障'}</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
              <span>{language === 'en' ? 'Stripe Encrypted Payment' : 'Stripe 加密付款'}</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <PhoneCall className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
              <span>{language === 'en' ? '24-hour customer support' : '24 小時客服'}</span>
            </div>
          </div>
        </div>
      </section>

      {/* v78o: Quick Facts Strip — 切入主題 — 讓使用者 3 秒看到核心資訊 */}
      <section className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
            {/* 天數 */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
              <Clock className="h-4 w-4 flex-shrink-0" style={{ color: themeColor.primary }} />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-gray-500 leading-none">{t('tourDetail.duration') || (language === 'en' ? 'Duration' : '行程天數')}</p>
                <p className="text-sm font-bold text-gray-900 mt-0.5 truncate">{tour.duration || t('tourDetail.multiDayTour')}</p>
              </div>
            </div>

            {/* 城市數 */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
              <MapPin className="h-4 w-4 flex-shrink-0" style={{ color: themeColor.primary }} />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-gray-500 leading-none">{language === 'en' ? 'Cities' : '途經城市'}</p>
                <p className="text-sm font-bold text-gray-900 mt-0.5 truncate">
                  {(() => {
                    const rawCities = (tour.destinationCity || tour.destinationCountry || '').split(/[,、]/).map((c: string) => c.trim()).filter(Boolean);
                    const n = rawCities.length;
                    if (n === 0) return tour.destinationCountry ? translateDestination(tour.destinationCountry, language) : '—';
                    return language === 'en' ? `${n} ${n === 1 ? 'city' : 'cities'}` : `${n} 座城市`;
                  })()}
                </p>
              </div>
            </div>

            {/* 交通 */}
            {transportationInfo?.type && (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
                <TransportIcon type={transportationInfo.type} className="h-4 w-4 flex-shrink-0" style={{ color: themeColor.primary }} />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 leading-none">{language === 'en' ? 'Transport' : '主要交通'}</p>
                  <p className="text-sm font-bold text-gray-900 mt-0.5 truncate">
                    {language === 'en'
                      ? (TRANSPORT_TYPE_EN[transportationInfo.typeName || ''] || transportationInfo.typeName || '—')
                      : (transportationInfo.typeName || '—')}
                  </p>
                </div>
              </div>
            )}

            {/* 起價 */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border" style={{ backgroundColor: `${themeColor.primary}08`, borderColor: `${themeColor.primary}30` }}>
              <DollarSign className="h-4 w-4 flex-shrink-0" style={{ color: themeColor.primary }} />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-gray-500 leading-none">{language === 'en' ? 'From / person' : '每人起價'}</p>
                <p className="text-sm font-bold mt-0.5 truncate" style={{ color: themeColor.primary }}>
                  {tour.price ? formatPrice(Number(tour.price), (tour.priceCurrency as any) || "TWD") : t('tourDetail.inquirePrice')}
                </p>
              </div>
            </div>

            {/* 立即預訂 CTA — 隱藏在手機，桌面顯示 */}
            <button
              onClick={() => navigate(`/book/${tour.id}`)}
              className="hidden lg:flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-white font-semibold text-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: themeColor.primary }}
            >
              <Calendar className="h-4 w-4" />
              {t('tourDetail.bookNowBtn')}
            </button>
          </div>
        </div>
      </section>

      {/* Sticky Navigation Tabs — v78r: Lion-Travel pattern: nav + price + Book CTA all in
          one row, always visible. Print/PDF/Share demoted to icon-only secondary actions. */}
      <nav className="sticky top-[80px] z-40 bg-white shadow-sm border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-2 md:px-6">
          <div className="flex items-center justify-between gap-2 md:gap-4">
            {/* Left: section nav */}
            <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
              <NavTabs
                items={navItems}
                activeTab={activeTab}
                onTabClick={scrollToSection}
                themeColor={themeColor}
              />
            </div>

            {/* Right: price + Book CTA + secondary actions (icon-only) */}
            <div className="flex items-center gap-2 md:gap-3 shrink-0">
              {/* Price label — desktop only, very prominent */}
              <div className="hidden lg:flex flex-col items-end leading-tight">
                <span className="text-[10px] uppercase tracking-wide text-gray-400">
                  {t('tourDetail.pricePerPersonFrom') || 'From / person'}
                </span>
                <span className="text-base font-bold" style={{ color: themeColor.primary }}>
                  {tour.price
                    ? formatPrice(Number(tour.price), (tour.priceCurrency as any) || 'TWD')
                    : t('tourDetail.inquirePrice')}
                </span>
              </div>

              {/* Book Now CTA — always visible (desktop + mobile) */}
              <Button
                onClick={() => navigate(`/book/${tour.id}`)}
                className="px-3 md:px-5 py-2 text-white text-sm md:text-base font-semibold shadow-sm rounded-lg"
                style={{ backgroundColor: themeColor.primary }}
              >
                {t('tourDetail.bookNowBtn')}
              </Button>

              {/* Print / PDF / Share — icon-only on hover, hidden on mobile */}
              <div className="hidden md:flex items-center gap-1 ml-1">
                <button
                  onClick={() => window.open(`/tours/${tourId}/print`, '_blank')}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                  aria-label={t('tourDetail.print')}
                  title={t('tourDetail.print')}
                >
                  <Printer className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    if (!tourId) return;
                    toast.info(t('tourDetail.pdfGenerating'));
                    generatePdfMutation.mutate({ id: tourId });
                  }}
                  disabled={generatePdfMutation.isPending}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors disabled:opacity-50"
                  aria-label={t('tourDetail.downloadPdf')}
                  title={t('tourDetail.downloadPdf')}
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setShowShareDialog(true)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                  aria-label={t('tourDetail.share')}
                  title={t('tourDetail.share')}
                >
                  <Share2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Promotion Banner */}
      {tour.promotionText && (
        <div 
          className="py-3 text-center text-white text-sm"
          style={{ backgroundColor: themeColor.secondary }}
        >
          <span className="font-medium">{tour.promotionText}</span>
        </div>
      )}

      {/* Overview Section */}
      <section ref={sectionRefs.overview} id="overview" className="py-16 lg:py-24">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-center mb-12" style={{ color: themeColor.primary }}>
            {t('tourDetail.description')}
          </h2>
          
          {/* Description */}
          <div className="prose prose-xl max-w-none text-gray-600 leading-relaxed text-center mb-12 text-lg md:text-xl">
            {isEditMode ? (
              <EditableText
                value={displayTour.description || ""}
                onSave={(value) => updateField("description", value)}
                isEditing={isEditMode}
                className="text-gray-600 leading-relaxed"
                placeholder={t('tourDetail.editDescPlaceholder')}
                multiline={true}
                as="p"
              />
            ) : (
              <p>{displayDescription}</p>
            )}
          </div>

          {/* Key Features Grid — v78r: 2-col grid; v78t: dynamic for sparse cases.
              1 feature → single centered card (avoids half-empty row).
              2+ features → 2-col grid. */}
          {keyFeatures.length > 0 && (
            <div className={`grid gap-5 mt-12 ${
              keyFeatures.length === 1
                ? 'grid-cols-1 max-w-2xl mx-auto'
                : 'md:grid-cols-2'
            }`}>
              {keyFeatures.map((feature: any, index: number) => {
                // Round 79: per Jeff's B&W brand rule (tour photos exception only),
                // dropped the 12-color rainbow icon palette. Visual variety now comes
                // purely from the icon shape; styling stays neutral foreground/5.
                const featureIcons = [
                  Sailboat, TreePine, Coffee, Mountain, Waves, Sunrise,
                  Compass, Footprints, Bike, Landmark, UtensilsCrossed, Wine,
                ];
                const IconComponent = featureIcons[index % featureIcons.length];
                
                // 檢查 feature 是否有圖片
                const featureImage = typeof feature !== 'string' ? (feature.image || feature.imageUrl || feature.photo) : null;
                const featureTitle = typeof feature === 'string' ? feature : (feature.title || feature.name || '');
                const featureDescription = typeof feature !== 'string' ? (feature.description || '') : '';
                
                // 編輯模式下更新特色卡片
                const handleFeatureUpdate = (field: 'title' | 'description' | 'image', newValue: string) => {
                  const updatedFeatures = [...keyFeatures];
                  if (typeof updatedFeatures[index] === 'string') {
                    // 將字串轉換為物件
                    updatedFeatures[index] = { title: updatedFeatures[index], description: '', image: '' };
                  }
                  updatedFeatures[index] = { ...updatedFeatures[index], [field]: newValue };
                  setEditedTour((prev: any) => ({
                    ...prev,
                    keyFeatures: updatedFeatures
                  }));
                  // 標記有未儲存的變更（修復 BUG-1：換圖片後儲存按鈕不顯示）
                  setHasChanges(true);
                  setDirtyFields((prev) => new Set(prev).add('keyFeatures'));
                };
                
                return (
                  <div 
                    key={index} 
                    className={`group rounded-xl border border-gray-100 hover:shadow-lg transition-all duration-300 bg-white hover:-translate-y-1 overflow-hidden ${isEditMode ? 'ring-2 ring-yellow-200' : ''}`}
                  >
                    {/* 圖片區域 - 支援編輯 */}
                    {isEditMode ? (
                      <EditableImage
                        src={featureImage || ''}
                        alt={featureTitle}
                        onSave={(newSrc) => handleFeatureUpdate('image', newSrc)}
                        isEditing={isEditMode}
                        className="h-40 w-full"
                        tourId={tour.id}
                        imagePath={`keyFeatures.${index}.image`}
                      />
                    ) : featureImage ? (
                      <div className="relative h-40 overflow-hidden rounded-xl">
                        <img
                          src={featureImage}
                          alt={featureTitle}
                          className="w-full h-full object-cover rounded-xl transition-transform duration-300 group-hover:scale-110"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                      </div>
                    ) : (
                      <div className="h-40 flex items-center justify-center bg-foreground/[0.04] transition-transform duration-300">
                        <IconComponent className="h-16 w-16 text-foreground/70 transition-transform duration-300 group-hover:scale-110" />
                      </div>
                    )}
                    {/* 文字區域 - 支援編輯 */}
                    <div className="p-5 flex flex-col">
                      {isEditMode ? (
                        <>
                          <EditableText
                            value={featureTitle}
                            onSave={(newValue) => handleFeatureUpdate('title', newValue)}
                            isEditing={isEditMode}
                            className="font-bold text-base text-gray-800 mb-2 leading-snug block min-h-[3rem]"
                            placeholder={t('tourDetail.editFeatureTitlePlaceholder')}
                            as="h3"
                          />
                          <EditableText
                            value={featureDescription}
                            onSave={(newValue) => handleFeatureUpdate('description', newValue)}
                            isEditing={isEditMode}
                            className="text-sm text-gray-600 leading-relaxed line-clamp-2 block"
                            placeholder={t('tourDetail.editFeatureDescPlaceholder')}
                            multiline
                            as="p"
                          />
                        </>
                      ) : (
                        <>
                          {/* v78r: removed min-h-3rem (was forcing artificial card height even when title is short)
                              and line-clamp-2 (was hiding 60% of LLM-generated descriptions) */}
                          <h3 className="font-bold text-base md:text-lg text-gray-800 mb-2 leading-snug">
                            {featureTitle}
                          </h3>
                          {featureDescription && (
                            <p className="text-sm text-gray-600 leading-relaxed">{featureDescription}</p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Quick Info Cards */}
          <div className="grid md:grid-cols-4 gap-4 mt-12">
            <div className="text-center p-6 bg-gray-50">
              <Clock className="h-10 w-10 mx-auto mb-3 text-gray-600" />
              <p className="text-base text-gray-700 mb-1">{t('tourDetail.duration')}</p>
              <p className="font-bold text-xl">{tour.duration || t('tourDetail.multiDayTour')}</p>
            </div>
            <div className="text-center p-6 bg-gray-50">
              <MapPin className="h-10 w-10 mx-auto mb-3 text-gray-600" />
              <p className="text-base text-gray-700 mb-1">{t('tourDetail.destination')}</p>
              <p className="font-bold text-xl">{(() => {
                const cities = (tour.destinationCity || tour.destinationCountry || '').split(/[,、]/).map((c: string) => c.trim()).filter(Boolean);
                // v78p: translate each city + use locale-appropriate separator
                const translated = cities.map((c: string) => translateDestination(c, language));
                const sep = language === 'zh-TW' ? '、' : ', ';
                if (translated.length <= 4) return translated.join(sep);
                return translated.slice(0, 4).join(sep) + '…';
              })()}</p>
            </div>
            <div className="text-center p-6 bg-gray-50">
              <Users className="h-10 w-10 mx-auto mb-3 text-gray-600" />
              <p className="text-base text-gray-700 mb-1">{t('tourDetail.groupSize')}</p>
              <p className="font-bold text-xl">{(t('tourDetail.groupPeople')).replace('{min}', String((tour as any).minGroupSize || 10)).replace('{max}', String((tour as any).maxGroupSize || 25))}</p>
            </div>
            <div className="text-center p-6 bg-gray-50">
              <Calendar className="h-10 w-10 mx-auto mb-3 text-gray-600" />
              <p className="text-base text-gray-700 mb-1">{t('tourDetail.departureDate')}</p>
              <p className="font-bold text-xl">{t('tourDetail.multipleDates')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* v78o: Tour Route Map — server-side geocode + Google Static Map */}
      {displayItinerary && displayItinerary.length > 0 && tour.id && (
        <TourRouteMap
          tourId={tour.id}
          itinerary={displayItinerary}
          destinationCountry={tour.destinationCountry || undefined}
          themeColor={themeColor}
        />
      )}

      {/* Itinerary Section - Zigzag Layout */}
      <section ref={sectionRefs.itinerary} id="itinerary" className="py-16 lg:py-24 bg-gray-50">
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
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-gray-300 hover:border-gray-400 text-sm text-gray-700 hover:text-gray-900 transition-colors"
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
              displayItinerary.map((day: any, index: number) => (
                isEditMode ? (
                  <EditableDayCard
                    key={index}
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
                    key={index}
                    day={day}
                    index={index}
                    themeColor={themeColor}
                    isExpanded={expandedDays.has(index)}
                    onToggle={() => toggleDay(index)}
                    onShowMealDetail={handleShowMealDetail}
                    onShowAttractionDetail={handleShowAttractionDetail}
                    destinationCountry={tour?.destinationCountry}
                  />
                )
              ))
            ) : (
              <div className="text-center py-12 text-gray-700">
                <Info className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>{t('tourDetail.itineraryComingSoon')}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section ref={sectionRefs.features} id="features" className="py-16 lg:py-24">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-center mb-4" style={{ color: themeColor.primary }}>
            {t('tourDetail.upgradeOptions')}
          </h2>
          <p className="text-lg text-gray-700 text-center mb-12">{t('tourDetail.highlightsDesc')}</p>

          {/* Attractions */}
          {attractions.length > 0 && (
            <div className="mb-12">
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                <Camera className="h-5 w-5" style={{ color: themeColor.secondary }} />
                {t('tourDetail.attractionFeatures')}
              </h3>
              <div className="grid md:grid-cols-2 gap-4">
                {attractions.map((attraction: any, index: number) => (
                  <div key={index} className="flex items-start gap-3 p-4 bg-gray-50">
                    <div 
                      className="w-2 h-2 rounded-lg mt-2 flex-shrink-0"
                      style={{ backgroundColor: themeColor.primary }}
                    />
                    <div>
                      <span className="font-medium">
                        {typeof attraction === 'string' ? attraction : attraction.name || attraction.title}
                      </span>
                      {typeof attraction !== 'string' && attraction.description && (
                        <p className="text-sm text-gray-700 mt-1">{attraction.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meals */}
          {meals.length > 0 && (
            <div className="mb-12">
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                <Utensils className="h-5 w-5" style={{ color: themeColor.secondary }} />
                {t('tourDetail.mealPlan')}
              </h3>
              {/* v78t: sparse case — 1 meal renders full-width instead of half-empty row */}
              <div className={`grid gap-4 ${meals.length === 1 ? 'grid-cols-1 max-w-2xl mx-auto' : 'md:grid-cols-2'}`}>
                {meals.map((meal: any, index: number) => (
                  <div key={index} className="flex items-start gap-3 p-4 bg-gray-50">
                    <div 
                      className="w-2 h-2 rounded-lg mt-2 flex-shrink-0"
                      style={{ backgroundColor: themeColor.secondary }}
                    />
                    <span>{typeof meal === 'string' ? meal : meal.name || meal.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cost Inclusions - 卡片式設計 */}
          {costExplanation && (
            <div className="grid md:grid-cols-2 gap-8">
              {/* Included */}
              {costExplanation.included && costExplanation.included.length > 0 && (
                <div className="bg-green-50 rounded-lg p-6 border border-green-100">
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-green-700">
                    <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                      <Check className="h-5 w-5 text-green-600" />
                    </div>
                    {t('tourDetail.includedItems')}
                  </h3>
                  <ul className="space-y-3">
                    {ensureArray(costExplanation.included).map((item: string, index: number) => (
                      <li key={index} className="flex items-start gap-3">
                        <Check className="h-4 w-4 text-green-600 mt-1 flex-shrink-0" />
                        <span className="text-gray-700">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Excluded */}
              {costExplanation.excluded && costExplanation.excluded.length > 0 && (
                <div className="bg-red-50 rounded-lg p-6 border border-red-100">
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-red-700">
                    <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                      <X className="h-5 w-5 text-red-600" />
                    </div>
                    {t('tourDetail.excludedItems')}
                  </h3>
                  <ul className="space-y-3">
                    {ensureArray(costExplanation.excluded).map((item: string, index: number) => (
                      <li key={index} className="flex items-start gap-3">
                        <X className="h-4 w-4 text-red-600 mt-1 flex-shrink-0" />
                        <span className="text-gray-700">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Hotels Section */}
      {hotels.length > 0 && (
        <section ref={sectionRefs.hotels} id="hotels" className="py-16 lg:py-24 bg-gray-50">
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
      )}

      {/* Pricing Section */}
      <section ref={sectionRefs.pricing} id="pricing" className="py-16 lg:py-24">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-center mb-4" style={{ color: themeColor.primary }}>
            {t('tourDetail.departurePricing')}
          </h2>
          <p className="text-lg text-gray-700 text-center mb-12">{t('tourDetail.selectDepartureDate')}</p>

          {/* Dynamic Price Calendar */}
          <DeparturePriceCalendar 
            tourId={tour.id} 
            basePrice={tour.price || 0} 
            themeColor={themeColor}
            onSelectDeparture={(departureId) => navigate(`/book/${tour.id}?departure=${departureId}`)}
          />

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
            <Button 
              onClick={() => navigate(`/book/${tour.id}`)}
              className="px-8 py-4 text-white text-lg font-medium btn-hover-lift transition-all duration-300 hover:shadow-lg"
              style={{ backgroundColor: themeColor.primary }}
            >
              {t('tourDetail.bookNowBtn')}
            </Button>
            <Button 
              variant="outline"
              onClick={() => navigate("/contact")}
              className="px-8 py-4 text-lg font-medium border-2 btn-hover-lift transition-all duration-300 hover:bg-gray-50"
              style={{ borderColor: themeColor.primary, color: themeColor.primary }}
            >
              {t('tourDetail.contactUs')}
            </Button>
          </div>

          {/* Round 60: P2 - Cost Explanation in Pricing section */}
          {costExplanation && (costExplanation.included?.length > 0 || costExplanation.excluded?.length > 0) && (
            <div className="mt-12">
              <h3 className="text-2xl font-bold text-center mb-8" style={{ color: themeColor.primary }}>
                {t('tourDetail.costDetails')}
              </h3>
              <div className="grid md:grid-cols-2 gap-6">
                {costExplanation.included && costExplanation.included.length > 0 && (
                  <div className="bg-green-50 rounded-xl p-6 border border-green-100">
                    <h4 className="text-lg font-bold mb-4 flex items-center gap-2 text-green-700">
                      <Check className="h-5 w-5" />
                      {t('tourDetail.includedItems')}
                    </h4>
                    <ul className="space-y-2">
                      {ensureArray(costExplanation.included).map((item: string, index: number) => (
                        <li key={index} className="flex items-start gap-2 text-sm text-gray-700">
                          <Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {costExplanation.excluded && costExplanation.excluded.length > 0 && (
                  <div className="bg-red-50 rounded-xl p-6 border border-red-100">
                    <h4 className="text-lg font-bold mb-4 flex items-center gap-2 text-red-700">
                      <X className="h-5 w-5" />
                      {t('tourDetail.excludedItems')}
                    </h4>
                    <ul className="space-y-2">
                      {ensureArray(costExplanation.excluded).map((item: string, index: number) => (
                        <li key={index} className="flex items-start gap-2 text-sm text-gray-700">
                          <X className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Price Comparison Widget */}
          <PriceComparisonWidget tourId={tour.id} tourPrice={tour.price || 0} themeColor={themeColor} />

          {/* Contact Info */}
          <div className="mt-12 text-center text-gray-700">
            <p className="mb-4">{t('tourDetail.contactAdvisor')}</p>
            <div className="flex flex-wrap justify-center gap-6">
              <a href="tel:+15106342307" className="flex items-center gap-2 hover:text-black transition-colors">
                <Phone className="h-4 w-4" />
                <span>+1 (510) 634-2307</span>
              </a>
              <a href="mailto:Jeffhsieh09@gmail.com" className="flex items-center gap-2 hover:text-black transition-colors">
                <Mail className="h-4 w-4" />
                <span>Jeffhsieh09@gmail.com</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Notes Section */}
      <section ref={sectionRefs.notes} id="notes" className="py-16 lg:py-24 bg-gray-50">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-center mb-4" style={{ color: themeColor.primary }}>
            {t('tourDetail.notices')}
          </h2>
          <p className="text-lg text-gray-700 text-center mb-12">{t('tourDetail.noticesDesc')}</p>

          {noticeDetailed ? (
            <div className="grid md:grid-cols-2 gap-6">
              {/* Preparation */}
              {noticeDetailed.preparation && ensureArray(noticeDetailed.preparation).length > 0 && (
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${themeColor.secondary}15` }}>
                      <Luggage className="h-5 w-5" style={{ color: themeColor.secondary }} />
                    </div>
                    <h3 className="text-lg font-bold">{t('tourDetail.preTrip')}</h3>
                  </div>
                  <ul className="space-y-2">
                    {ensureArray(noticeDetailed.preparation).map((item: string, index: number) => (
                      <li key={index} className="flex items-start gap-3 text-gray-600 text-sm">
                        <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Documents */}
              {noticeDetailed.documents && ensureArray(noticeDetailed.documents).length > 0 && (
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${themeColor.secondary}15` }}>
                      <FileText className="h-5 w-5" style={{ color: themeColor.secondary }} />
                    </div>
                    <h3 className="text-lg font-bold">{t('tourDetail.documents')}</h3>
                  </div>
                  <ul className="space-y-2">
                    {ensureArray(noticeDetailed.documents).map((item: string, index: number) => (
                      <li key={index} className="flex items-start gap-3 text-gray-600 text-sm">
                        <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Health */}
              {noticeDetailed.health && ensureArray(noticeDetailed.health).length > 0 && (
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${themeColor.secondary}15` }}>
                      <Heart className="h-5 w-5" style={{ color: themeColor.secondary }} />
                    </div>
                    <h3 className="text-lg font-bold">{t('tourDetail.health')}</h3>
                  </div>
                  <ul className="space-y-2">
                    {ensureArray(noticeDetailed.health).map((item: string, index: number) => (
                      <li key={index} className="flex items-start gap-3 text-gray-600 text-sm">
                        <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Emergency Contact */}
              {noticeDetailed.emergency && ensureArray(noticeDetailed.emergency).length > 0 && (
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${themeColor.secondary}15` }}>
                      <PhoneCall className="h-5 w-5" style={{ color: themeColor.secondary }} />
                    </div>
                    <h3 className="text-lg font-bold">{t('tourDetail.emergency')}</h3>
                  </div>
                  <ul className="space-y-2">
                    {ensureArray(noticeDetailed.emergency).map((item: string, index: number) => (
                      <li key={index} className="flex items-start gap-3 text-gray-600 text-sm">
                        <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Terms */}
              {noticeDetailed.terms && ensureArray(noticeDetailed.terms).length > 0 && (
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow md:col-span-2">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${themeColor.secondary}15` }}>
                      <Info className="h-5 w-5" style={{ color: themeColor.secondary }} />
                    </div>
                    <h3 className="text-lg font-bold">{t('tourDetail.terms')}</h3>
                  </div>
                  <ul className="grid md:grid-cols-2 gap-2">
                    {ensureArray(noticeDetailed.terms).map((item: string, index: number) => (
                      <li key={index} className="flex items-start gap-3 text-gray-600 text-sm">
                        <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-700">
              <Info className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>{t('tourDetail.noticesAdvisor')}</p>
            </div>
          )}
        </div>
      </section>

      {/* v78m Sprint 5B: Departures + pricing table (signettours pattern) */}
      {tour?.id && (
        <TourDeparturesTable
          tourId={tour.id}
          basePrice={tour.price || 0}
          baseCurrency={tour.priceCurrency || "TWD"}
          themeColor={themeColor}
        />
      )}

      {/* Similar Tours Recommendation */}
      {tour?.id && <SimilarTours tourId={tour.id} />}

      {/* Fixed Bottom CTA (v78i: phone now tel: link for 1-click call; price respects tour currency) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-gray-200 shadow-2xl z-50 rounded-t-xl">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-gray-500">{t('tourDetail.pricePerPersonFrom')}</p>
              <p className="text-xl md:text-2xl font-bold" style={{ color: themeColor.primary }}>
                {tour.price
                  ? formatPrice(Number(tour.price), (tour.priceCurrency as any) || "TWD")
                  : t('tourDetail.inquirePrice')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="tel:+15106342307"
                className="hidden md:inline-flex items-center gap-2 px-5 py-3 font-medium rounded-lg border-2 transition-colors hover:bg-primary/5"
                style={{ borderColor: themeColor.primary, color: themeColor.primary }}
              >
                <Phone className="h-4 w-4" />
                <span className="hidden lg:inline">+1 (510) 634-2307</span>
                <span className="lg:hidden">{t('tourDetail.contactUs')}</span>
              </a>
              <Button
                onClick={() => navigate(`/book/${tour.id}`)}
                className="px-6 md:px-10 py-3 text-white font-bold text-base md:text-lg"
                style={{ backgroundColor: themeColor.primary }}
              >
                {t('tourDetail.bookNowBtn')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Add padding for fixed bottom CTA */}
      <div className="h-20" />

      {/* 餐廠詳情彈窗 */}
      <MealDetailDialog
        isOpen={isMealDetailOpen}
        onClose={() => setIsMealDetailOpen(false)}
        detail={selectedMealDetail}
        themeColor={themeColor}
      />

      {/* 景點詳情彈窗 */}
      <AttractionDetailDialog
        isOpen={isAttractionDetailOpen}
        onClose={() => setIsAttractionDetailOpen(false)}
        detail={selectedAttractionDetail}
        themeColor={themeColor}
      />

      {/* 分享對話框 */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">{t('tourDetail.shareThisTour')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-gray-600 text-sm">{(t('tourDetail.shareRecommend')).replace('{title}', displayTitle)}</p>

            {/* v78h: Native share — opens iOS/Android system share sheet so user can pick WeChat, IG, etc. */}
            {typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function' && (
              <Button
                onClick={async () => {
                  try {
                    await (navigator as any).share({
                      title: displayTitle,
                      text: (t('tourDetail.lineShareText')).replace('{title}', displayTitle),
                      url: window.location.href,
                    });
                  } catch {
                    // user cancelled
                  }
                }}
                className="w-full"
                style={{ backgroundColor: themeColor.primary }}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                立刻分享 / Share
              </Button>
            )}

            {/* 複製連結 */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={typeof window !== 'undefined' ? window.location.href : ''}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50"
              />
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  toast.success(t('tourDetail.linkCopied'));
                }}
                className="shrink-0"
                style={{ backgroundColor: themeColor.primary }}
              >
                {t('tourDetail.copyLink')}
              </Button>
            </div>

            {/* 社群分享按鈕 */}
            <div className="grid grid-cols-4 gap-3 pt-2">
              {/* Facebook */}
              <button
                onClick={() => {
                  const url = encodeURIComponent(window.location.href);
                  window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'width=600,height=400');
                }}
                className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="w-10 h-10 bg-[#1877F2] rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                </div>
                <span className="text-xs text-gray-600">Facebook</span>
              </button>

              {/* LINE */}
              <button
                onClick={() => {
                  const url = encodeURIComponent(window.location.href);
                  const text = encodeURIComponent((t('tourDetail.lineShareText')).replace('{title}', displayTitle));
                  window.open(`https://social-plugins.line.me/lineit/share?url=${url}&text=${text}`, '_blank', 'width=600,height=400');
                }}
                className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="w-10 h-10 bg-[#00B900] rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
                  </svg>
                </div>
                <span className="text-xs text-gray-600">LINE</span>
              </button>

              {/* Twitter/X */}
              <button
                onClick={() => {
                  const url = encodeURIComponent(window.location.href);
                  const text = encodeURIComponent((t('tourDetail.lineShareText')).replace('{title}', displayTitle));
                  window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, '_blank', 'width=600,height=400');
                }}
                className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                </div>
                <span className="text-xs text-gray-600">X</span>
              </button>

              {/* WhatsApp */}
              <button
                onClick={() => {
                  const url = encodeURIComponent(window.location.href);
                  const text = encodeURIComponent((t('tourDetail.lineShareText')).replace('{title}', displayTitle) + ' ');
                  window.open(`https://wa.me/?text=${text}${url}`, '_blank', 'width=600,height=400');
                }}
                className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="w-10 h-10 bg-[#25D366] rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                </div>
                <span className="text-xs text-gray-600">WhatsApp</span>
              </button>
            </div>

            {/* v78h: Email + Print row */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100 mt-2">
              <button
                onClick={() => {
                  const subject = encodeURIComponent(displayTitle);
                  const body = encodeURIComponent(
                    (t('tourDetail.lineShareText')).replace('{title}', displayTitle) +
                      '\n\n' + window.location.href
                  );
                  window.location.href = `mailto:?subject=${subject}&body=${body}`;
                }}
                className="flex items-center justify-center gap-2 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm text-gray-700"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Email
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center justify-center gap-2 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm text-gray-700"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                列印 / Print
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  );
}
