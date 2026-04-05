import { Button } from "@/components/ui/button";
import { Search, Plane, Hotel, Users, Lock } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DateRange } from "react-day-picker";
import { DestinationAutocomplete } from "@/components/DestinationAutocomplete";
import { DepartureAutocomplete } from "@/components/DepartureAutocomplete";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";


export default function Hero() {
  const [activeTab, setActiveTab] = useState("group");
  const [departure, setDeparture] = useState("");
  const [destination, setDestination] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
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

  const handleLockedTabClick = () => {
    toast.info(t('common.comingSoon'));
  };

  const tabs = [
    { id: "group", labelKey: "hero.search.tabs.groupTours", icon: <Users className="h-4 w-4" />, locked: false },
    { id: "flight", labelKey: "hero.search.tabs.flights", icon: <Plane className="h-4 w-4" />, locked: true },
    { id: "hotel", labelKey: "hero.search.tabs.hotels", icon: <Hotel className="h-4 w-4" />, locked: true },
  ];

  return (
    <section className="relative w-full h-[600px] md:h-[700px] flex items-center justify-center">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img 
          src="/images/hero-sakura.webp" 
          alt="Cherry Blossoms Travel" 
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
              const isActive = !tab.locked && activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    if (tab.locked) {
                      handleLockedTabClick();
                    } else {
                      setActiveTab(tab.id);
                    }
                  }}
                  className={`
                    flex-1 py-4 px-4 text-sm font-bold tracking-wide transition-all
                    flex items-center justify-center gap-2 relative
                    border-r-2 border-black last:border-r-0
                    ${tab.locked
                      ? "text-gray-400 bg-gray-50 cursor-not-allowed"
                      : isActive
                        ? "text-white bg-black"
                        : "text-black bg-white hover:bg-gray-100"
                    }
                  `}
                >
                  {tab.icon}
                  <span className="uppercase tracking-wider text-xs">{t(tab.labelKey)}</span>
                  {tab.locked && <Lock className="h-3 w-3 opacity-50" />}
                </button>
              );
            })}
          </div>

          {/* Search Fields */}
          <div className="p-6 md:p-8 bg-white">
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

            {/* Hot Keywords */}
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
          </div>
        </div>
      </div>
    </section>
  );
}
