import { Button } from "@/components/ui/button";
import { Search, Plane, Hotel, Users } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DateRange } from "react-day-picker";
import { DestinationAutocomplete } from "@/components/DestinationAutocomplete";
import { DepartureAutocomplete } from "@/components/DepartureAutocomplete";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { format } from "date-fns";


export default function Hero() {
  const [activeTab, setActiveTab] = useState("group");
  const [departure, setDeparture] = useState("");
  const [destination, setDestination] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  // Flight tab state
  const [flightFrom, setFlightFrom] = useState("");
  const [flightTo, setFlightTo] = useState("");
  const [flightDateRange, setFlightDateRange] = useState<DateRange | undefined>(undefined);
  // Hotel tab state
  const [hotelCity, setHotelCity] = useState("");
  const [hotelDateRange, setHotelDateRange] = useState<DateRange | undefined>(undefined);
  const [, setLocation] = useLocation();
  const { t, language } = useLocale();

  // Hot keywords for destinations - hardcoded for each language
  const hotKeywordsMap: Record<string, string[]> = {
    'zh-TW': ['北海道', '東京', '大阪', '歐洲', '土耳其', '郵輪', '滑雪'],
    'en': ['Hokkaido', 'Tokyo', 'Osaka', 'Europe', 'Turkey', 'Cruise', 'Skiing'],
  };
  const hotKeywords = hotKeywordsMap[language] || hotKeywordsMap['en'];

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

  const handleFlightSearch = () => {
    toast.info(t('hero.search.toastSearchingFlight'));
    const departDate = flightDateRange?.from ? format(flightDateRange.from, 'yyyy-MM-dd') : undefined;
    const returnDate = flightDateRange?.to ? format(flightDateRange.to, 'yyyy-MM-dd') : undefined;
    const params = new URLSearchParams();
    if (flightFrom) params.set('dcity', flightFrom);
    if (flightTo) params.set('acity', flightTo);
    if (departDate) params.set('ddate', departDate);
    if (returnDate) params.set('rdate', returnDate);
    params.set('triptype', returnDate ? 'rt' : 'ow');
    params.set('locale', language === 'zh-TW' ? 'zh-tw' : 'en-US');
    window.open(`https://www.trip.com/flights/?${params.toString()}`, '_blank');
  };

  const handleHotelSearch = () => {
    toast.info(t('hero.search.toastSearchingHotel'));
    const checkIn = hotelDateRange?.from ? format(hotelDateRange.from, 'yyyy-MM-dd') : undefined;
    const checkOut = hotelDateRange?.to ? format(hotelDateRange.to, 'yyyy-MM-dd') : undefined;
    const params = new URLSearchParams();
    if (hotelCity) params.set('city', hotelCity);
    if (checkIn) params.set('checkin', checkIn);
    if (checkOut) params.set('checkout', checkOut);
    params.set('locale', language === 'zh-TW' ? 'zh-tw' : 'en-US');
    window.open(`https://www.trip.com/hotels/?${params.toString()}`, '_blank');
  };

  const tabs = [
    { id: "group", labelKey: "hero.search.tabs.groupTours", icon: <Users className="h-4 w-4" /> },
    { id: "flight", labelKey: "hero.search.tabs.flights", icon: <Plane className="h-4 w-4" /> },
    { id: "hotel", labelKey: "hero.search.tabs.hotels", icon: <Hotel className="h-4 w-4" /> },
  ];

  return (
    <section className="relative w-full h-[600px] md:h-[700px] flex items-center justify-center">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img 
          src="/images/hero-travel.webp" 
          alt="PACK&GO Travel" 
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/30" />
      </div>

      {/* Content */}
      <div className="container relative z-10 flex flex-col items-center pt-10">
        {/* Hero Text */}
        <div className="text-center mb-10 animate-in fade-in zoom-in duration-1000">
          <h2 className="text-white text-xl md:text-2xl font-serif mb-2 tracking-widest" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
            {t('hero.subtitle')}
          </h2>
          <h1 className="text-white text-4xl md:text-6xl font-bold font-serif tracking-tight" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>
            {t('hero.title')}
          </h1>
        </div>

        {/* Search Console — Sharp Geometric Black & White */}
        <div className="w-full max-w-5xl bg-white border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] animate-in slide-in-from-bottom-10 duration-700 delay-300">
          
          {/* Tab Bar */}
          <div className="flex w-full border-b-2 border-black">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex-1 py-4 px-4 text-sm font-bold tracking-wide transition-all
                    flex items-center justify-center gap-2 relative
                    border-r-2 border-black last:border-r-0
                    ${isActive
                      ? "text-white bg-black"
                      : "text-black bg-white hover:bg-gray-100"
                    }
                  `}
                >
                  {tab.icon}
                  <span className="uppercase tracking-wider text-xs">{t(tab.labelKey)}</span>
                </button>
              );
            })}
          </div>

          {/* Search Fields */}
          <div className="p-6 md:p-8 bg-white">

            {/* Group Tour Search */}
            {activeTab === "group" && (
              <div className="flex flex-col md:flex-row gap-0 items-stretch">
                {/* Departure Location */}
                <div className="flex-1 border-2 border-black border-r-0 last:border-r-2 md:last:border-r-0">
                  <div className="px-4 pt-4 pb-1">
                    <label className="block text-xs font-black uppercase tracking-widest text-black mb-2">
                      {t('hero.search.departure')}
                    </label>
                  </div>
                  <div className="px-3 pb-3">
                    <DepartureAutocomplete
                      value={departure}
                      onChange={setDeparture}
                      placeholder={t('hero.search.departurePlaceholder')}
                      className="w-full [&_input]:rounded-lg [&_input]:border-0 [&_input]:border-b-2 [&_input]:border-black [&_input]:bg-transparent [&_input]:focus:ring-0 [&_input]:focus:outline-none [&_input]:h-10 [&_input]:w-full [&_input]:text-sm [&_input]:font-medium [&_input]:px-0 [&_input]:placeholder:text-gray-400"
                    />
                  </div>
                </div>
                {/* Keyword / Destination */}
                <div className="flex-1 border-2 border-black border-r-0 last:border-r-2 md:last:border-r-0">
                  <div className="px-4 pt-4 pb-1">
                    <label className="block text-xs font-black uppercase tracking-widest text-black mb-2">
                      {t('hero.search.keyword')}
                    </label>
                  </div>
                  <div className="px-3 pb-3">
                    <DestinationAutocomplete
                      value={destination}
                      onChange={setDestination}
                      onSelect={handleSearch}
                      placeholder={t('hero.search.destinationPlaceholder')}
                      className="w-full [&_input]:rounded-lg [&_input]:border-0 [&_input]:border-b-2 [&_input]:border-black [&_input]:bg-transparent [&_input]:focus:ring-0 [&_input]:focus:outline-none [&_input]:h-10 [&_input]:w-full [&_input]:text-sm [&_input]:font-medium [&_input]:px-0 [&_input]:placeholder:text-gray-400"
                    />
                  </div>
                </div>
                {/* Date Range */}
                <div className="flex-1 border-2 border-black border-r-0 last:border-r-2 md:last:border-r-0">
                  <div className="px-4 pt-4 pb-1">
                    <label className="block text-xs font-black uppercase tracking-widest text-black mb-2">
                      {t('hero.search.departureDate')}
                    </label>
                  </div>
                  <div className="px-3 pb-3">
                    <DateRangePicker
                      value={dateRange}
                      onChange={setDateRange}
                      placeholder={t('hero.search.selectDate')}
                      className="h-10 rounded-lg border-0 border-b-2 border-black bg-transparent w-full [&_button]:rounded-lg [&_button]:border-0 [&_button]:border-b-2 [&_button]:border-black [&_button]:bg-transparent [&_button]:h-10 [&_button]:px-0 [&_button]:text-sm [&_button]:font-medium [&_button]:text-gray-700 [&_button]:placeholder:text-gray-400"
                    />
                  </div>
                </div>
                {/* Search Button */}
                <div className="flex-shrink-0 border-2 border-black flex items-stretch">
                  <Button
                    onClick={handleSearch}
                    className="h-full min-h-[88px] w-20 md:w-24 bg-black hover:bg-gray-900 text-white rounded-lg font-black flex flex-col items-center justify-center gap-1 border-0"
                  >
                    <Search className="h-5 w-5 text-white" />
                    <span className="text-xs uppercase tracking-widest">{t('hero.search.searchButton')}</span>
                  </Button>
                </div>
              </div>
            )}

            {/* Flight Search */}
            {activeTab === "flight" && (
              <div className="flex flex-col md:flex-row gap-0 items-stretch">
                {/* From */}
                <div className="flex-1 border-2 border-black border-r-0">
                  <div className="px-4 pt-4 pb-1">
                    <label className="block text-xs font-black uppercase tracking-widest text-black mb-2">
                      {t('hero.search.flightFrom')}
                    </label>
                  </div>
                  <div className="px-3 pb-3">
                    <input
                      type="text"
                      value={flightFrom}
                      onChange={(e) => setFlightFrom(e.target.value)}
                      placeholder={t('hero.search.flightFromPlaceholder')}
                      className="w-full border-0 border-b-2 border-black bg-transparent h-10 text-sm font-medium px-0 placeholder:text-gray-400 focus:outline-none focus:ring-0"
                    />
                  </div>
                </div>
                {/* To */}
                <div className="flex-1 border-2 border-black border-r-0">
                  <div className="px-4 pt-4 pb-1">
                    <label className="block text-xs font-black uppercase tracking-widest text-black mb-2">
                      {t('hero.search.flightTo')}
                    </label>
                  </div>
                  <div className="px-3 pb-3">
                    <input
                      type="text"
                      value={flightTo}
                      onChange={(e) => setFlightTo(e.target.value)}
                      placeholder={t('hero.search.flightToPlaceholder')}
                      className="w-full border-0 border-b-2 border-black bg-transparent h-10 text-sm font-medium px-0 placeholder:text-gray-400 focus:outline-none focus:ring-0"
                    />
                  </div>
                </div>
                {/* Date Range */}
                <div className="flex-1 border-2 border-black border-r-0">
                  <div className="px-4 pt-4 pb-1">
                    <label className="block text-xs font-black uppercase tracking-widest text-black mb-2">
                      {t('hero.search.flightDate')}
                    </label>
                  </div>
                  <div className="px-3 pb-3">
                    <DateRangePicker
                      value={flightDateRange}
                      onChange={setFlightDateRange}
                      placeholder={t('hero.search.selectDate')}
                      className="h-10 rounded-lg border-0 border-b-2 border-black bg-transparent w-full [&_button]:rounded-lg [&_button]:border-0 [&_button]:border-b-2 [&_button]:border-black [&_button]:bg-transparent [&_button]:h-10 [&_button]:px-0 [&_button]:text-sm [&_button]:font-medium [&_button]:text-gray-700"
                    />
                  </div>
                </div>
                {/* Search Button */}
                <div className="flex-shrink-0 border-2 border-black flex items-stretch">
                  <Button
                    onClick={handleFlightSearch}
                    className="h-full min-h-[88px] w-20 md:w-24 bg-black hover:bg-gray-900 text-white rounded-lg font-black flex flex-col items-center justify-center gap-1 border-0"
                  >
                    <Plane className="h-5 w-5 text-white" />
                    <span className="text-xs uppercase tracking-widest">{t('hero.search.searchButton')}</span>
                  </Button>
                </div>
              </div>
            )}

            {/* Hotel Search */}
            {activeTab === "hotel" && (
              <div className="flex flex-col md:flex-row gap-0 items-stretch">
                {/* City */}
                <div className="flex-1 border-2 border-black border-r-0">
                  <div className="px-4 pt-4 pb-1">
                    <label className="block text-xs font-black uppercase tracking-widest text-black mb-2">
                      {t('hero.search.hotelCity')}
                    </label>
                  </div>
                  <div className="px-3 pb-3">
                    <input
                      type="text"
                      value={hotelCity}
                      onChange={(e) => setHotelCity(e.target.value)}
                      placeholder={t('hero.search.hotelCityPlaceholder')}
                      className="w-full border-0 border-b-2 border-black bg-transparent h-10 text-sm font-medium px-0 placeholder:text-gray-400 focus:outline-none focus:ring-0"
                    />
                  </div>
                </div>
                {/* Check-in / Check-out */}
                <div className="flex-1 border-2 border-black border-r-0">
                  <div className="px-4 pt-4 pb-1">
                    <label className="block text-xs font-black uppercase tracking-widest text-black mb-2">
                      {t('hero.search.hotelCheckIn')} / {t('hero.search.hotelCheckOut')}
                    </label>
                  </div>
                  <div className="px-3 pb-3">
                    <DateRangePicker
                      value={hotelDateRange}
                      onChange={setHotelDateRange}
                      placeholder={t('hero.search.selectDate')}
                      className="h-10 rounded-lg border-0 border-b-2 border-black bg-transparent w-full [&_button]:rounded-lg [&_button]:border-0 [&_button]:border-b-2 [&_button]:border-black [&_button]:bg-transparent [&_button]:h-10 [&_button]:px-0 [&_button]:text-sm [&_button]:font-medium [&_button]:text-gray-700"
                    />
                  </div>
                </div>
                {/* Search Button */}
                <div className="flex-shrink-0 border-2 border-black flex items-stretch">
                  <Button
                    onClick={handleHotelSearch}
                    className="h-full min-h-[88px] w-20 md:w-24 bg-black hover:bg-gray-900 text-white rounded-lg font-black flex flex-col items-center justify-center gap-1 border-0"
                  >
                    <Hotel className="h-5 w-5 text-white" />
                    <span className="text-xs uppercase tracking-widest">{t('hero.search.searchButton')}</span>
                  </Button>
                </div>
              </div>
            )}

            {/* Hot Keywords (group tab only) */}
            {activeTab === "group" && (
              <div className="flex items-center gap-3 mt-6 pt-5 border-t-2 border-black">
                <span className="text-xs font-black uppercase tracking-widest text-black whitespace-nowrap">
                  {t('hero.search.hotKeywords')}
                </span>
                <div className="flex flex-wrap gap-2">
                  {hotKeywords.map((keyword: string) => (
                    <button
                      key={keyword}
                      onClick={() => handleKeywordClick(keyword)}
                      className="text-xs font-semibold text-black border border-black px-3 py-1 hover:bg-black hover:text-white transition-colors tracking-wide"
                    >
                      {keyword}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Trip.com attribution for flight/hotel tabs */}
            {(activeTab === "flight" || activeTab === "hotel") && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-400">
                  {language === 'zh-TW'
                    ? '由 Trip.com 提供搜尋服務，點擊搜尋將跳轉至 Trip.com 完成預訂'
                    : 'Search powered by Trip.com. Clicking search will redirect you to Trip.com to complete your booking.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
