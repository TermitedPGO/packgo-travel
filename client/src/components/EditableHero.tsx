import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Calendar, MapPin, Search, Sparkles, Plane, Hotel, Ticket, Users, Pencil, X, Check, Upload, ImageIcon, ArrowLeftRight, Lock } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DateRange } from "react-day-picker";
import { DestinationAutocomplete } from "@/components/DestinationAutocomplete";
import { DepartureAutocomplete } from "@/components/DepartureAutocomplete";
import { toast } from "sonner";
import { useHomeEdit } from "@/contexts/HomeEditContext";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/contexts/LocaleContext";

interface HeroContent {
  title: string;
  subtitle: string;
  title_en?: string;
  subtitle_en?: string;
  backgroundImage: string;
  hotKeywords: string[];
}

const defaultContent: HeroContent = {
  title: "探索世界 從這裡開始",
  subtitle: "PACK&GO — Your Journey Starts Here",
  backgroundImage: "/images/hero-travel.webp",
  hotKeywords: ["北海道", "東京", "大阪", "歐洲", "土耳其", "郵輪", "滑雪"],
};

// 多語言熱門關鍵字映射（繁體中文和英文）
const hotKeywordsTranslations: Record<string, Record<string, string>> = {
  '北海道': { 'zh-TW': '北海道', 'en': 'Hokkaido' },
  '東京': { 'zh-TW': '東京', 'en': 'Tokyo' },
  '大阪': { 'zh-TW': '大阪', 'en': 'Osaka' },
  '歐洲': { 'zh-TW': '歐洲', 'en': 'Europe' },
  '土耳其': { 'zh-TW': '土耳其', 'en': 'Turkey' },
  '郵輪': { 'zh-TW': '郵輪', 'en': 'Cruise' },
  '滑雪': { 'zh-TW': '滑雪', 'en': 'Skiing' },
  '台灣': { 'zh-TW': '台灣', 'en': 'Taiwan' },
  '日本': { 'zh-TW': '日本', 'en': 'Japan' },
  '韓國': { 'zh-TW': '韓國', 'en': 'Korea' },
  '泰國': { 'zh-TW': '泰國', 'en': 'Thailand' },
  '新加坡': { 'zh-TW': '新加坡', 'en': 'Singapore' },
  '美國': { 'zh-TW': '美國', 'en': 'USA' },
  '加拿大': { 'zh-TW': '加拿大', 'en': 'Canada' },
  '澳洲': { 'zh-TW': '澳洲', 'en': 'Australia' },
  '紐西蘭': { 'zh-TW': '紐西蘭', 'en': 'New Zealand' },
  '義大利': { 'zh-TW': '義大利', 'en': 'Italy' },
  '法國': { 'zh-TW': '法國', 'en': 'France' },
  '西班牙': { 'zh-TW': '西班牙', 'en': 'Spain' },
  '英國': { 'zh-TW': '英國', 'en': 'UK' },
  '德國': { 'zh-TW': '德國', 'en': 'Germany' },
  '瑞士': { 'zh-TW': '瑞士', 'en': 'Switzerland' },
  '希臘': { 'zh-TW': '希臘', 'en': 'Greece' },
  '埃及': { 'zh-TW': '埃及', 'en': 'Egypt' },
  '以色列': { 'zh-TW': '以色列', 'en': 'Israel' },
  '越南': { 'zh-TW': '越南', 'en': 'Vietnam' },
  '峇里島': { 'zh-TW': '峇里島', 'en': 'Bali' },
  '馬爾地夫': { 'zh-TW': '馬爾地夫', 'en': 'Maldives' },
};

// 翻譯熱門關鍵字的輔助函數
const translateKeyword = (keyword: string, language: string): string => {
  const translations = hotKeywordsTranslations[keyword];
  if (translations && translations[language]) {
    return translations[language];
  }
  return keyword;
};

export default function EditableHero() {
  const [activeTab, setActiveTab] = useState("group");
  const [departure, setDeparture] = useState("");
  const [destination, setDestination] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  // Flight search state
  const [tripType, setTripType] = useState<'roundtrip' | 'oneway'>('roundtrip');
  const [flightOrigin, setFlightOrigin] = useState('');
  const [flightDestination, setFlightDestination] = useState('');
  const [flightDepartDate, setFlightDepartDate] = useState('');
  const [flightReturnDate, setFlightReturnDate] = useState('');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [cabinClass, setCabinClass] = useState<'economy' | 'premiumEconomy' | 'business' | 'first'>('economy');
  const [showPassengerPicker, setShowPassengerPicker] = useState(false);

  // Hotel search state
  const [hotelCity, setHotelCity] = useState('');
  const [hotelCheckIn, setHotelCheckIn] = useState('');
  const [hotelCheckOut, setHotelCheckOut] = useState('');
  const [rooms, setRooms] = useState(1);
  const [hotelAdults, setHotelAdults] = useState(2);
  const [hotelChildren, setHotelChildren] = useState(0);
  const [showRoomPicker, setShowRoomPicker] = useState(false);

  // Search loading state
  const [isFlightSearching, setIsFlightSearching] = useState(false);
  const [isHotelSearching, setIsHotelSearching] = useState(false);

  const [, setLocation] = useLocation();
  const { t, language } = useLocale();

  const { isEditMode, canEdit } = useHomeEdit();
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState<HeroContent>(defaultContent);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Refs for click-outside close
  const passengerPickerRef = useRef<HTMLDivElement>(null);
  const roomPickerRef = useRef<HTMLDivElement>(null);

  // Fetch hero content from database
  const { data: heroData, refetch, isLoading: isHeroLoading } = trpc.homepage.getContent.useQuery(
    { sectionKey: 'hero' },
    { enabled: true }
  );

  const utils = trpc.useUtils();
  const trackClickMutation = trpc.affiliate.trackClick.useMutation();

  const updateContentMutation = trpc.homepage.updateContent.useMutation({
    onSuccess: () => {
      toast.success(t('hero.edit.updateSuccess'));
      setIsEditing(false);
      refetch();
    },
    onError: (error) => {
      toast.error(t('hero.edit.updateError') + ': ' + error.message);
    },
  });

  // Use database content — only fall back to default if DB query completed with no data
  const rawContent: HeroContent = isHeroLoading
    ? defaultContent  // temporary while loading, but hidden by skeleton
    : (heroData?.content || defaultContent);

  // B4 Fix: If DB hotKeywords has fewer than 3 items, use the default 7 keywords as fallback
  const content: HeroContent = {
    ...rawContent,
    hotKeywords: (rawContent.hotKeywords && rawContent.hotKeywords.length >= 3)
      ? rawContent.hotKeywords
      : defaultContent.hotKeywords,
  };

  useEffect(() => {
    if (heroData?.content) {
      setEditContent(heroData.content as HeroContent);
    }
  }, [heroData]);

  // Click-outside close for pickers
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (passengerPickerRef.current && !passengerPickerRef.current.contains(e.target as Node)) {
        setShowPassengerPicker(false);
      }
      if (roomPickerRef.current && !roomPickerRef.current.contains(e.target as Node)) {
        setShowRoomPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (destination.trim()) {
      params.set("destination", destination.trim());
    }
    if (departure.trim()) {
      params.set("departure", departure.trim());
    }
    const queryString = params.toString();
    setLocation(`/search${queryString ? `?${queryString}` : ""}`);
  };

  const handleKeywordClick = (keyword: string) => {
    setLocation(`/search?destination=${encodeURIComponent(keyword)}`);
  };

  // Swap cities helper
  const handleSwapCities = () => {
    const temp = flightOrigin;
    setFlightOrigin(flightDestination);
    setFlightDestination(temp);
  };

  // Flight search handler
  const handleFlightSearch = async () => {
    setIsFlightSearching(true);
    try {
      const result = await utils.affiliate.generateAffiliateLink.fetch({
        type: 'flights',
        origin: flightOrigin || undefined,
        destination: flightDestination || undefined,
        departDate: flightDepartDate || undefined,
        returnDate: tripType === 'roundtrip' ? (flightReturnDate || undefined) : undefined,
        adults,
        children,
        infants,
        cabinClass,
      });
      await trackClickMutation.mutateAsync({
        platform: 'trip_flights',
        targetUrl: result.url,
        referrerPage: '/',
      });
      window.open(result.url, '_blank');
    } catch {
      toast.error(t('hero.search.searchError'));
    } finally {
      setIsFlightSearching(false);
    }
  };

  // Hotel search handler
  const handleHotelSearch = async () => {
    setIsHotelSearching(true);
    try {
      const result = await utils.affiliate.generateAffiliateLink.fetch({
        type: 'hotels',
        city: hotelCity || undefined,
        checkIn: hotelCheckIn || undefined,
        checkOut: hotelCheckOut || undefined,
        rooms,
        hotelAdults,
        hotelChildren,
      });
      await trackClickMutation.mutateAsync({
        platform: 'trip_hotels',
        targetUrl: result.url,
        referrerPage: '/',
      });
      window.open(result.url, '_blank');
    } catch {
      toast.error(t('hero.search.searchError'));
    } finally {
      setIsHotelSearching(false);
    }
  };

  // Passenger/room total display helpers
  const totalPassengers = adults + children + infants;
  const passengerSummary = `${totalPassengers} ${t('hero.search.flight.passengers')}`;
  const roomSummary = `${rooms} ${t('hero.search.hotel.room')}, ${hotelAdults + hotelChildren} ${t('hero.search.hotel.guests')}`;

  const handleSaveContent = () => {
    updateContentMutation.mutate({
      sectionKey: 'hero',
      content: editContent,
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error(t('hero.edit.selectImageFile'));
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('hero.edit.imageSizeLimit'));
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'hero');

      const response = await fetch('/api/upload/tour-image', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(t('hero.edit.uploadFailed'));
      }

      const data = await response.json();
      setEditContent(prev => ({ ...prev, backgroundImage: data.url }));
      setShowImageDialog(false);
      toast.success(t('hero.edit.uploadSuccess'));
    } catch (error) {
      toast.error(t('hero.edit.uploadFailed'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleKeywordsChange = (value: string) => {
    const keywords = value.split(',').map(k => k.trim()).filter(k => k);
    setEditContent(prev => ({ ...prev, hotKeywords: keywords }));
  };

  // 搜尋標籤配置
  const searchTabs = [
    { id: "group", labelKey: "hero.search.tabs.groupTours", icon: <Users className="h-4 w-4" /> },
    { id: "flight", labelKey: "hero.search.tabs.flights", icon: <Plane className="h-4 w-4" /> },
    { id: "hotel", labelKey: "hero.search.tabs.hotels", icon: <Hotel className="h-4 w-4" /> },
  ];

  // Show loading skeleton while hero data is being fetched
  if (isHeroLoading) {
    return (
      <section className="relative w-full h-[600px] md:h-[700px] flex items-center justify-center overflow-hidden bg-gray-200 animate-pulse">
        <div className="absolute inset-0 bg-gradient-to-b from-gray-300 to-gray-200" />
      </section>
    );
  }

  return (
    <section className="relative w-full h-[600px] md:h-[700px] flex items-center justify-center overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img 
          src={isEditing ? editContent.backgroundImage : content.backgroundImage} 
          alt="PACK&GO Travel" 
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/20" />
        
        {/* Edit Image Button */}
        {isEditMode && canEdit && isEditing && (
          <button
            onClick={() => setShowImageDialog(true)}
            className="absolute top-4 right-4 z-20 bg-black/70 hover:bg-black text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
          >
            <ImageIcon className="h-4 w-4" />
            {t('hero.edit.changeBackground')}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="container relative z-10 flex flex-col items-center pt-10">
        {/* Hero Text */}
        <div className="text-center mb-8 animate-in fade-in zoom-in duration-1000 relative">
          {isEditing ? (
            <div className="space-y-4">
              <input
                type="text"
                value={editContent.subtitle}
                onChange={(e) => setEditContent(prev => ({ ...prev, subtitle: e.target.value }))}
                className="text-white text-xl md:text-2xl font-serif mb-2 tracking-widest text-shadow bg-transparent border-b border-white/50 text-center w-full focus:outline-none focus:border-white"
              />
              <input
                type="text"
                value={editContent.title}
                onChange={(e) => setEditContent(prev => ({ ...prev, title: e.target.value }))}
                className="text-white text-4xl md:text-6xl font-bold font-serif tracking-tight text-shadow-lg bg-transparent border-b border-white/50 text-center w-full focus:outline-none focus:border-white"
              />
            </div>
          ) : (
            <>
              <h2 className="text-white text-xl md:text-2xl font-serif mb-2 tracking-widest text-shadow">
                {language === 'en'
                  ? (content.subtitle_en || t('hero.subtitle'))
                  : (content.subtitle || t('hero.subtitle'))}
              </h2>
              <h1 className="text-white text-4xl md:text-6xl font-bold font-serif tracking-tight text-shadow-lg">
                {language === 'en'
                  ? (content.title_en || t('hero.title'))
                  : (content.title || t('hero.title'))}
              </h1>
            </>
          )}
          
          {/* Edit Button */}
          {isEditMode && canEdit && !isEditing && (
            <button
              onClick={() => {
                setEditContent(content);
                setIsEditing(true);
              }}
              className="absolute -top-2 -right-12 bg-black/70 hover:bg-black text-white p-2 rounded-full transition-colors"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Edit Controls */}
        {isEditing && (
          <div className="flex gap-2 mb-4">
            <Button
              onClick={handleSaveContent}
              disabled={updateContentMutation.isPending}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Check className="h-4 w-4 mr-2" />
              {t('common.save')}
            </Button>
            <Button
              onClick={() => {
                setIsEditing(false);
                setEditContent(content);
              }}
              variant="outline"
              className="bg-white/20 hover:bg-white/30 text-white border-white/50"
            >
              <X className="h-4 w-4 mr-2" />
              {t('common.cancel')}
            </Button>
          </div>
        )}

        {/* Search Console */}
        <div className="w-full max-w-5xl bg-white shadow-2xl animate-in slide-in-from-bottom-10 duration-700 delay-300 rounded-3xl">
          {/* Tabs */}
          <div className="flex w-full border-b border-gray-200 bg-gray-50 rounded-t-3xl">
            {searchTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-4 px-2 text-base font-medium transition-all relative flex items-center justify-center gap-2 ${
                  activeTab === tab.id 
                    ? "text-primary bg-white border-t-2 border-t-primary" 
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                {tab.icon}
                {t(tab.labelKey)}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-4 bg-white rounded-b-3xl" style={{ minHeight: '180px' }}>
            <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">

              {/* ═══ GROUP TOURS TAB ═══ */}
              {activeTab === "group" && (
                <>
                  <div className="flex flex-col md:flex-row gap-4 items-end">
                    <div className="w-full" style={{ flex: '1 1 0', minWidth: 0 }}>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.departure')}</label>
                      <DepartureAutocomplete 
                        value={departure}
                        onChange={setDeparture}
                        placeholder={t('hero.search.departurePlaceholder')}
                        className="w-full [[&_input]:rounded-full_input]:rounded-lg [&_input]:bg-gray-50 [&_input]:border-gray-200 [&_input]:focus:ring-primary [&_input]:focus:border-primary [&_input]:h-12 [&_input]:w-full"
                      />
                    </div>
                    <div className="w-full" style={{ flex: '1 1 0', minWidth: 0 }}>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.keyword')}</label>
                      <DestinationAutocomplete 
                        value={destination}
                        onChange={setDestination}
                        onSelect={handleSearch}
                        placeholder={t('hero.search.destinationPlaceholder')}
                        className="w-full [[&_input]:rounded-full_input]:rounded-lg [&_input]:bg-gray-50 [&_input]:border-gray-200 [&_input]:focus:ring-primary [&_input]:focus:border-primary [&_input]:h-12 [&_input]:w-full"
                      />
                    </div>
                    <div className="w-full" style={{ flex: '1 1 0', minWidth: 0 }}>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.departureDate')}</label>
                      <DateRangePicker 
                        value={dateRange}
                        onChange={setDateRange}
                        placeholder={t('hero.search.selectDate')}
                        className="h-12 rounded-lg w-full"
                      />
                    </div>
                    <div className="w-full md:w-32 flex-shrink-0">
                      <Button 
                        onClick={handleSearch}
                        className="w-full h-12 bg-black hover:bg-gray-900 text-white rounded-lg font-bold shadow-md transition-all hover:shadow-lg"
                      >
                        {t('hero.search.searchButton')}
                      </Button>
                    </div>
                  </div>
                  {/* Hot Keywords */}
                  <div className="flex items-center gap-2 text-sm text-gray-500 mt-2 pt-2 border-t border-gray-100">
                    <span className="font-medium text-primary">{t('hero.search.hotKeywords')}：</span>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editContent.hotKeywords.join(', ')}
                        onChange={(e) => handleKeywordsChange(e.target.value)}
                        placeholder={t('hero.edit.keywordsPlaceholder')}
                        className="flex-1 bg-gray-100 px-3 py-1 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {content.hotKeywords.map((keyword) => (
                          <button 
                            key={keyword} 
                            onClick={() => handleKeywordClick(keyword)}
                            className="hover:text-primary hover:underline transition-colors"
                          >
                            {translateKeyword(keyword, language)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ═══ FLIGHT TAB ═══ */}
              {activeTab === "flight" && (
                <>
                  {/* Row 1: Trip type toggle + Cabin class + Passenger picker */}
                  <div className="flex flex-wrap items-center gap-3 mb-1">
                    {/* Trip type toggle */}
                    <div className="flex bg-gray-100 rounded-lg p-0.5">
                      <button
                        onClick={() => setTripType('roundtrip')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                          tripType === 'roundtrip' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {t('hero.search.flight.roundtrip')}
                      </button>
                      <button
                        onClick={() => setTripType('oneway')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                          tripType === 'oneway' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {t('hero.search.flight.oneway')}
                      </button>
                    </div>

                    {/* Cabin class dropdown */}
                    <select
                      value={cabinClass}
                      onChange={(e) => setCabinClass(e.target.value as 'economy' | 'premiumEconomy' | 'business' | 'first')}
                      className="h-9 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-700 focus:ring-primary focus:border-primary"
                    >
                      <option value="economy">{t('hero.search.flight.cabinEconomy')}</option>
                      <option value="premiumEconomy">{t('hero.search.flight.cabinPremiumEconomy')}</option>
                      <option value="business">{t('hero.search.flight.cabinBusiness')}</option>
                      <option value="first">{t('hero.search.flight.cabinFirst')}</option>
                    </select>

                    {/* Passenger picker button */}
                    <div className="relative" ref={passengerPickerRef}>
                      <button
                        onClick={() => setShowPassengerPicker(!showPassengerPicker)}
                        className="h-9 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-700 hover:border-gray-300 flex items-center gap-2"
                      >
                        <Users className="h-3.5 w-3.5" />
                        {passengerSummary}
                      </button>
                      {/* Passenger dropdown */}
                      {showPassengerPicker && (
                        <div className="absolute top-full mt-2 bg-white rounded-xl shadow-xl border border-gray-200 p-4 z-50 w-72 left-0">
                          {/* Adults */}
                          <div className="flex items-center justify-between py-2">
                            <div>
                              <div className="text-sm font-medium text-gray-900">{t('hero.search.flight.adults')}</div>
                              <div className="text-xs text-gray-500">{t('hero.search.flight.adultsAge')}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setAdults(Math.max(1, adults - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={adults <= 1}>−</button>
                              <span className="w-6 text-center font-medium">{adults}</span>
                              <button onClick={() => setAdults(Math.min(9, adults + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={adults >= 9}>+</button>
                            </div>
                          </div>
                          {/* Children */}
                          <div className="flex items-center justify-between py-2 border-t border-gray-100">
                            <div>
                              <div className="text-sm font-medium text-gray-900">{t('hero.search.flight.children')}</div>
                              <div className="text-xs text-gray-500">{t('hero.search.flight.childrenAge')}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setChildren(Math.max(0, children - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={children <= 0}>−</button>
                              <span className="w-6 text-center font-medium">{children}</span>
                              <button onClick={() => setChildren(Math.min(9, children + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={children >= 9}>+</button>
                            </div>
                          </div>
                          {/* Infants */}
                          <div className="flex items-center justify-between py-2 border-t border-gray-100">
                            <div>
                              <div className="text-sm font-medium text-gray-900">{t('hero.search.flight.infants')}</div>
                              <div className="text-xs text-gray-500">{t('hero.search.flight.infantsAge')}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setInfants(Math.max(0, infants - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={infants <= 0}>−</button>
                              <span className="w-6 text-center font-medium">{infants}</span>
                              <button onClick={() => setInfants(Math.min(adults, infants + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={infants >= adults}>+</button>
                            </div>
                          </div>
                          {/* Close button */}
                          <button onClick={() => setShowPassengerPicker(false)} className="mt-3 w-full py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800">
                            {t('common.confirm')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Origin ⇄ Destination + Dates + Search */}
                  <div className="flex flex-col md:flex-row gap-4 items-end">
                    {/* Origin */}
                    <div className="w-full" style={{ flex: '1 1 0', minWidth: 0 }}>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.flight.origin')}</label>
                      <Input
                        value={flightOrigin}
                        onChange={(e) => setFlightOrigin(e.target.value)}
                        placeholder={t('hero.search.flight.originPlaceholder')}
                        className="h-12 rounded-lg bg-gray-50 border-gray-200"
                      />
                    </div>

                    {/* Swap button */}
                    <button
                      onClick={handleSwapCities}
                      className="hidden md:flex w-10 h-10 flex-shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white hover:bg-gray-50 text-gray-500 hover:text-black transition-colors mb-1"
                      title={t('hero.search.flight.swap')}
                    >
                      <ArrowLeftRight className="h-4 w-4" />
                    </button>

                    {/* Destination */}
                    <div className="w-full" style={{ flex: '1 1 0', minWidth: 0 }}>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.flight.destination')}</label>
                      <Input
                        value={flightDestination}
                        onChange={(e) => setFlightDestination(e.target.value)}
                        placeholder={t('hero.search.flight.destinationPlaceholder')}
                        className="h-12 rounded-lg bg-gray-50 border-gray-200"
                      />
                    </div>

                    {/* Depart date */}
                    <div className="w-full" style={{ flex: '0.8 1 0', minWidth: 0 }}>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.flight.departDate')}</label>
                      <Input type="date" value={flightDepartDate} onChange={(e) => setFlightDepartDate(e.target.value)} className="h-12 rounded-lg bg-gray-50 border-gray-200" />
                    </div>

                    {/* Return date (only if roundtrip) */}
                    {tripType === 'roundtrip' && (
                      <div className="w-full" style={{ flex: '0.8 1 0', minWidth: 0 }}>
                        <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.flight.returnDate')}</label>
                        <Input type="date" value={flightReturnDate} onChange={(e) => setFlightReturnDate(e.target.value)} className="h-12 rounded-lg bg-gray-50 border-gray-200" />
                      </div>
                    )}

                    {/* Search button */}
                    <div className="w-full md:w-36 flex-shrink-0">
                      <Button
                        onClick={handleFlightSearch}
                        disabled={isFlightSearching}
                        className="w-full h-12 bg-black hover:bg-gray-900 text-white rounded-lg font-bold shadow-md transition-all hover:shadow-lg flex items-center justify-center gap-2"
                      >
                        <Search className="h-4 w-4" />
                        {isFlightSearching ? t('hero.search.searching') : t('hero.search.flight.searchFlights')}
                      </Button>
                    </div>
                  </div>

                  {/* Trip.com note */}
                  <p className="text-xs text-gray-400 text-center mt-1">{t('hero.search.flight.tripComNote')}</p>
                </>
              )}

              {/* ═══ HOTEL TAB ═══ */}
              {activeTab === "hotel" && (
                <>
                  <div className="flex flex-col md:flex-row gap-4 items-end">
                    {/* Destination city */}
                    <div className="w-full" style={{ flex: '1.2 1 0', minWidth: 0 }}>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.hotel.destination')}</label>
                      <Input
                        value={hotelCity}
                        onChange={(e) => setHotelCity(e.target.value)}
                        placeholder={t('hero.search.hotel.destinationPlaceholder')}
                        className="h-12 rounded-lg bg-gray-50 border-gray-200"
                      />
                    </div>

                    {/* Check-in */}
                    <div className="w-full" style={{ flex: '0.8 1 0', minWidth: 0 }}>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.hotel.checkIn')}</label>
                      <Input type="date" value={hotelCheckIn} onChange={(e) => setHotelCheckIn(e.target.value)} className="h-12 rounded-lg bg-gray-50 border-gray-200" />
                    </div>

                    {/* Check-out */}
                    <div className="w-full" style={{ flex: '0.8 1 0', minWidth: 0 }}>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.hotel.checkOut')}</label>
                      <Input type="date" value={hotelCheckOut} onChange={(e) => setHotelCheckOut(e.target.value)} className="h-12 rounded-lg bg-gray-50 border-gray-200" />
                    </div>

                    {/* Room & Guest picker button */}
                    <div className="w-full relative" style={{ flex: '1 1 0', minWidth: 0 }} ref={roomPickerRef}>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.hotel.roomsGuests')}</label>
                      <button
                        onClick={() => setShowRoomPicker(!showRoomPicker)}
                        className="w-full h-12 px-4 text-sm text-left border border-gray-200 rounded-lg bg-gray-50 text-gray-700 hover:border-gray-300 flex items-center justify-between"
                      >
                        <span>{roomSummary}</span>
                        <Users className="h-4 w-4 text-gray-400" />
                      </button>
                      {/* Room picker dropdown */}
                      {showRoomPicker && (
                        <div className="absolute top-full mt-2 bg-white rounded-xl shadow-xl border border-gray-200 p-4 z-50 w-full md:w-72 left-0 md:left-auto md:right-0">
                          {/* Rooms */}
                          <div className="flex items-center justify-between py-2">
                            <div className="text-sm font-medium text-gray-900">{t('hero.search.hotel.room')}</div>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setRooms(Math.max(1, rooms - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={rooms <= 1}>−</button>
                              <span className="w-6 text-center font-medium">{rooms}</span>
                              <button onClick={() => setRooms(Math.min(8, rooms + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={rooms >= 8}>+</button>
                            </div>
                          </div>
                          {/* Adults */}
                          <div className="flex items-center justify-between py-2 border-t border-gray-100">
                            <div>
                              <div className="text-sm font-medium text-gray-900">{t('hero.search.flight.adults')}</div>
                              <div className="text-xs text-gray-500">{t('hero.search.hotel.perRoom')}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setHotelAdults(Math.max(1, hotelAdults - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={hotelAdults <= 1}>−</button>
                              <span className="w-6 text-center font-medium">{hotelAdults}</span>
                              <button onClick={() => setHotelAdults(Math.min(6, hotelAdults + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={hotelAdults >= 6}>+</button>
                            </div>
                          </div>
                          {/* Children */}
                          <div className="flex items-center justify-between py-2 border-t border-gray-100">
                            <div>
                              <div className="text-sm font-medium text-gray-900">{t('hero.search.flight.children')}</div>
                              <div className="text-xs text-gray-500">{t('hero.search.hotel.childrenAge')}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setHotelChildren(Math.max(0, hotelChildren - 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40" disabled={hotelChildren <= 0}>−</button>
                              <span className="w-6 text-center font-medium">{hotelChildren}</span>
                              <button onClick={() => setHotelChildren(Math.min(4, hotelChildren + 1))} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50" disabled={hotelChildren >= 4}>+</button>
                            </div>
                          </div>
                          <button onClick={() => setShowRoomPicker(false)} className="mt-3 w-full py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800">
                            {t('common.confirm')}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Search button */}
                    <div className="w-full md:w-36 flex-shrink-0">
                      <Button
                        onClick={handleHotelSearch}
                        disabled={isHotelSearching}
                        className="w-full h-12 bg-black hover:bg-gray-900 text-white rounded-lg font-bold shadow-md transition-all hover:shadow-lg flex items-center justify-center gap-2"
                      >
                        <Search className="h-4 w-4" />
                        {isHotelSearching ? t('hero.search.searching') : t('hero.search.hotel.searchHotels')}
                      </Button>
                    </div>
                  </div>

                  {/* Trip.com note */}
                  <p className="text-xs text-gray-400 text-center mt-1">{t('hero.search.hotel.tripComNote')}</p>
                </>
              )}

            </div>
          </div>
        </div>
      </div>

      {/* Image Upload Dialog */}
      <Dialog open={showImageDialog} onOpenChange={setShowImageDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('hero.edit.changeBackground')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div 
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Spinner size="lg" />
                  <p className="text-sm text-gray-500">{t('hero.edit.uploading')}</p>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 mx-auto text-gray-400 mb-2" />
                  <p className="text-sm text-gray-600">{t('hero.edit.dropImage')}</p>
                  <p className="text-xs text-gray-400 mt-1">{t('hero.edit.imageFormats')}</p>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <div>
              <Label>{t('hero.edit.orEnterUrl')}</Label>
              <Input
                type="url"
                placeholder="https://example.com/image.jpg"
                value={editContent.backgroundImage}
                onChange={(e) => setEditContent(prev => ({ ...prev, backgroundImage: e.target.value }))}
                className="mt-1"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
