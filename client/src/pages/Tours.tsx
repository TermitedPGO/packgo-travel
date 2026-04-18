import { useState, useMemo, useCallback, useEffect } from "react";
import { Link, useSearch } from "wouter";
import SEO from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  MapPin,
  Calendar,
  Loader2,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Users,
  Compass,
  Package,
  Anchor,
  Sparkles,
  Globe,
  SlidersHorizontal,
  X,
  Star,
  Plane,
  Hotel,
  Utensils,
  MessageCircle,
} from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLocale } from "@/contexts/LocaleContext";
import { useDebounce } from "@/hooks/useDebounce";
import { translateDestination } from "@/utils/locationMapping";

const CATEGORY_TAGS = [
  { value: "all",     labelZh: "全部",     labelEn: "All",           icon: Globe },
  { value: "group",   labelZh: "團體旅遊", labelEn: "Group Tours",   icon: Users },
  { value: "theme",   labelZh: "主題旅遊", labelEn: "Theme Tours",   icon: Sparkles },
  { value: "custom",  labelZh: "客製旅遊", labelEn: "Custom Tours",  icon: Compass },
  { value: "package", labelZh: "包團旅遊", labelEn: "Package Tours", icon: Package },
  { value: "cruise",  labelZh: "郵輪旅遊", labelEn: "Cruise Tours",  icon: Anchor },
];

const DURATION_PRESETS = [
  { labelZh: "全部天數",  labelEn: "Any Duration", min: undefined as number | undefined, max: undefined as number | undefined },
  { labelZh: "1-5 天",   labelEn: "1-5 Days",     min: 1,  max: 5  },
  { labelZh: "6-10 天",  labelEn: "6-10 Days",    min: 6,  max: 10 },
  { labelZh: "11-15 天", labelEn: "11-15 Days",   min: 11, max: 15 },
  { labelZh: "16 天以上", labelEn: "16+ Days",     min: 16, max: undefined as number | undefined },
];

// Country flag emoji helper
function getFlagEmoji(country: string): string {
  const flags: Record<string, string> = {
    "日本": "🇯🇵", "韓國": "🇰🇷", "台灣": "🇹🇼", "泰國": "🇹🇭",
    "越南": "🇻🇳", "新加坡": "🇸🇬", "馬來西亞": "🇲🇾", "印尼": "🇮🇩",
    "菲律賓": "🇵🇭", "帛琉": "🇵🇼", "澳洲": "🇦🇺", "紐西蘭": "🇳🇿",
    "美國": "🇺🇸", "加拿大": "🇨🇦", "英國": "🇬🇧", "法國": "🇫🇷",
    "德國": "🇩🇪", "義大利": "🇮🇹", "西班牙": "🇪🇸", "瑞士": "🇨🇭",
    "希臘": "🇬🇷", "土耳其": "🇹🇷", "埃及": "🇪🇬", "摩洛哥": "🇲🇦",
    "中國": "🇨🇳", "香港": "🇭🇰", "澳門": "🇲🇴",
  };
  return flags[country] || "🌍";
}

function TourCard({
  tour,
  language,
  t,
  formatPrice,
}: {
  tour: any;
  language: string;
  t: (key: string) => string;
  formatPrice: (price: number, originalCurrency?: "TWD" | "USD") => string;
}) {
  const shouldLoadTranslation = language !== "zh-TW";
  const { data: translations } = trpc.translation.getTourTranslations.useQuery(
    { tourId: tour.id, targetLanguage: language as "en" | "ja" | "ko" },
    { enabled: shouldLoadTranslation, staleTime: 1000 * 60 * 5 }
  );
  const displayTitle = useMemo(() => {
    if (language === "zh-TW") return tour.title;
    return translations?.title || tour.title;
  }, [language, translations, tour.title]);

  // Fetch next departure for this tour
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: nextDeparture } = (trpc.departures as any).getNext.useQuery(
    { tourId: tour.id },
    { staleTime: 1000 * 60 * 5 }
  );

  // Determine included items from tour data
  const includedTags = useMemo(() => {
    const tags: { icon: typeof Plane; labelZh: string; labelEn: string }[] = [];
    const inc = tour.included || "";
    if (inc.includes("機票") || inc.includes("flight") || inc.toLowerCase().includes("air")) {
      tags.push({ icon: Plane, labelZh: "含機票", labelEn: "Flights" });
    }
    if (inc.includes("飯店") || inc.includes("hotel") || inc.includes("住宿") || inc.toLowerCase().includes("hotel")) {
      tags.push({ icon: Hotel, labelZh: "含住宿", labelEn: "Hotels" });
    }
    if (inc.includes("餐") || inc.includes("meal") || inc.includes("food") || inc.toLowerCase().includes("meal")) {
      tags.push({ icon: Utensils, labelZh: "含餐食", labelEn: "Meals" });
    }
    // Show max 2 tags to keep card clean
    return tags.slice(0, 2);
  }, [tour.included]);

  const isEn = language === "en";

  // Format departure date
  const nextDepartureLabel = useMemo(() => {
    if (!nextDeparture?.departureDate) return null;
    const d = new Date(nextDeparture.departureDate);
    if (isEn) {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }, [nextDeparture, isEn]);

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-all duration-300 group border border-gray-200 flex flex-col">
      <Link href={`/tours/${tour.id}`} className="block">
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl">
          {tour.imageUrl || tour.heroImage ? (
            <img
              src={tour.imageUrl || tour.heroImage}
              alt={displayTitle}
              className="w-full h-full object-cover rounded-xl group-hover:scale-105 transition-transform duration-500"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const parent = e.currentTarget.parentElement;
                if (parent && !parent.querySelector('.img-fallback')) {
                  const div = document.createElement('div');
                  div.className = 'img-fallback absolute inset-0 bg-gradient-to-br from-teal-600 to-teal-800 flex items-center justify-center rounded-xl';
                  div.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>';
                  parent.appendChild(div);
                }
              }}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-teal-600 to-teal-800 flex items-center justify-center rounded-xl">
              <MapPin className="h-12 w-12 text-white/40" />
            </div>
          )}
          {tour.status === "soldout" && (
            <Badge className="absolute top-4 right-4 bg-gray-800 text-white">
              {isEn ? "Fully Booked" : "已額滿"}
            </Badge>
          )}
          {tour.status === "inactive" && (
            <Badge className="absolute top-4 right-4 bg-red-500 text-white">
              {t("tours.inactive")}
            </Badge>
          )}
          {/* Duration badge overlay */}
          <div className="absolute bottom-3 left-3 bg-black/70 text-white text-xs font-bold px-2 py-1">
            {tour.duration}{isEn ? " Days" : " 天"}{tour.nights ? (isEn ? ` ${tour.nights} Nights` : ` ${tour.nights} 夜`) : ""}
          </div>
        </div>
      </Link>

      <div className="p-5 flex flex-col flex-grow">
        {/*
          Rating Row — FTC 16 CFR Part 465 / Act §5 compliance.
          Previously rendered a hardcoded 5-star display with "(5.0)" on every
          card regardless of whether any reviews existed. That is a deceptive
          testimonial under the FTC fake review rule. We now only render real
          ratings sourced from the tour record; otherwise show "no reviews yet".
        */}
        {typeof tour.rating === "number" && tour.rating > 0 ? (
          <div className="flex items-center gap-1 mb-2">
            {[1,2,3,4,5].map(i => (
              <Star
                key={i}
                className={`h-3.5 w-3.5 ${i <= Math.round(tour.rating as number) ? 'fill-black text-black' : 'text-gray-300'}`}
              />
            ))}
            <span className="text-xs text-gray-500 ml-1">
              ({(tour.rating as number).toFixed(1)})
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1 mb-2">
            <span className="text-xs text-gray-400">
              {isEn ? "No reviews yet" : "尚無評價"}
            </span>
          </div>
        )}

        {/* Title */}
        <Link href={`/tours/${tour.id}`}>
          <h3 className="text-base font-bold mb-2 line-clamp-2 text-gray-900 group-hover:text-primary transition-colors leading-snug cursor-pointer">
            {displayTitle}
          </h3>
        </Link>

        {/* Location */}
        <div className="flex items-center text-gray-500 mb-2">
          <MapPin className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
          <span className="text-xs">
            {translateDestination(tour.destinationCountry || '', language)}{tour.destinationCity && tour.destinationCity !== tour.destinationCountry ? ` · ${translateDestination(tour.destinationCity, language)}` : ""}
          </span>
        </div>

        {/* Next Departure Date */}
        {nextDepartureLabel && (
          <div className="flex items-center text-gray-500 mb-2">
            <Calendar className="h-3.5 w-3.5 mr-1 flex-shrink-0 text-teal-600" />
            <span className="text-xs text-teal-700 font-medium">
              {isEn ? "Next: " : "最近出發："}{nextDepartureLabel}
            </span>
            {nextDeparture?.totalSlots && nextDeparture.bookedSlots !== undefined && (
              <span className="ml-2 text-xs text-gray-400">
                ({nextDeparture.totalSlots - nextDeparture.bookedSlots} {isEn ? "seats left" : "席"})
              </span>
            )}
          </div>
        )}

        {/* Included Tags */}
        {includedTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {includedTags.map((tag, i) => {
              const Icon = tag.icon;
              return (
                <span key={i} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 border border-gray-200">
                  <Icon className="h-3 w-3" />
                  {isEn ? tag.labelEn : tag.labelZh}
                </span>
              );
            })}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-grow" />

        {/* Price + Dual CTA */}
        <div className="pt-3 border-t border-gray-100">
          <div className="mb-3">
            <span className="text-xl font-bold text-black">
              {formatPrice(tour.price || 0, (tour.priceCurrency || "TWD") as "TWD" | "USD")}
            </span>
            <span className="text-xs text-gray-400 ml-1">{t("tours.startingFrom")}</span>
          </div>
          <div className="flex gap-2">
            <Link href={`/tours/${tour.id}`} className="flex-1">
              <Button className="w-full bg-black text-white hover:bg-gray-800 text-xs py-2 h-9">
                {isEn ? "View Details" : "查看詳情"}
              </Button>
            </Link>
            <Link href={`/contact-us?tour=${encodeURIComponent(displayTitle)}`}>
              <Button variant="outline" className="border-gray-300 hover:border-black text-xs py-2 h-9 px-3">
                <MessageCircle className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const pages: number[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="flex items-center justify-center gap-2 mt-8">
      <Button variant="outline" size="sm" className="rounded-lg" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {start > 1 && (
        <>
          <Button variant="outline" size="sm" className="rounded-lg w-9 h-9 p-0" onClick={() => onPageChange(1)}>1</Button>
          {start > 2 && <span className="text-gray-400">...</span>}
        </>
      )}
      {pages.map((p) => (
        <Button
          key={p}
          variant={p === page ? "default" : "outline"}
          size="sm"
          className={`rounded-lg w-9 h-9 p-0 ${p === page ? "bg-black text-white" : ""}`}
          onClick={() => onPageChange(p)}
        >
          {p}
        </Button>
      ))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="text-gray-400">...</span>}
          <Button variant="outline" size="sm" className="rounded-lg w-9 h-9 p-0" onClick={() => onPageChange(totalPages)}>{totalPages}</Button>
        </>
      )}
      <Button variant="outline" size="sm" className="rounded-lg" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function Tours() {
  const searchString = useSearch();
  const urlCategory = useMemo(() => new URLSearchParams(searchString).get("category") || "all", [searchString]);
  const [searchInput, setSearchInput] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>(urlCategory);
  const [selectedDurationIdx, setSelectedDurationIdx] = useState<number>(0);
  const [selectedSortBy, setSelectedSortBy] = useState<string>("popular");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Sync category when URL changes (e.g. navigating from header menu)
  useEffect(() => {
    setSelectedCategory(urlCategory);
    setPage(1);
  }, [urlCategory]);
  const { t, language, formatPrice } = useLocale();

  const debouncedSearch = useDebounce(searchInput, 400);
  const selectedDuration = DURATION_PRESETS[selectedDurationIdx];

  const resetPage = useCallback(() => setPage(1), []);
  const handleSearchChange = useCallback((value: string) => { setSearchInput(value); resetPage(); }, [resetPage]);
  const handleCategoryChange = useCallback((value: string) => { setSelectedCategory(value); resetPage(); }, [resetPage]);
  const handleDurationChange = useCallback((idx: number) => { setSelectedDurationIdx(idx); resetPage(); }, [resetPage]);
  const handleSortChange = useCallback((value: string) => { setSelectedSortBy(value); resetPage(); }, [resetPage]);
  const handleCountryChange = useCallback((country: string) => {
    setSelectedCountry(country);
    // When selecting a country, also set it as the destination search
    if (country !== "all") {
      setSearchInput(country);
    } else {
      setSearchInput("");
    }
    resetPage();
  }, [resetPage]);

  // Fetch filter options to get destination countries
  const { data: filterOptions } = trpc.tours.getFilterOptions.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
  });

  // Top destinations (show max 8 countries)
  const topDestinations = useMemo(() => {
    if (!filterOptions?.destinations) return [];
    return filterOptions.destinations.slice(0, 8);
  }, [filterOptions]);

  const searchParams = {
    destination: debouncedSearch || undefined,
    category: selectedCategory !== "all" ? selectedCategory : undefined,
    minDays: selectedDuration.min,
    maxDays: selectedDuration.max,
    sortBy: selectedSortBy as "popular" | "price_asc" | "price_desc" | "days_asc" | "days_desc",
    page,
    pageSize: 12,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = trpc.tours.search.useQuery(searchParams as any);

  const tours = data?.tours ?? [];
  const pagination = data?.pagination;

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (selectedCategory !== "all") count++;
    if (selectedDurationIdx !== 0) count++;
    if (selectedSortBy !== "popular") count++;
    if (debouncedSearch) count++;
    return count;
  }, [selectedCategory, selectedDurationIdx, selectedSortBy, debouncedSearch]);

  const clearAllFilters = useCallback(() => {
    setSearchInput("");
    setSelectedCategory("all");
    setSelectedDurationIdx(0);
    setSelectedSortBy("popular");
    setSelectedCountry("all");
    setPage(1);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <SEO
        title={language === "en" ? "All Tours" : "所有行程"}
        description="瀏覽 PACK&GO 旅行社所有精選旅遊行程，包含日本、歐洲、東南亞等熱門目的地，提供客製化旅遊規劃服務。"
        url="/tours"
        type="website"
      />
      <Header />

      <main className="flex-grow">
        {/* Hero Section */}
        <section className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-16">
          <div className="container">
            <Link href="/">
              <Button variant="ghost" className="text-white hover:text-gray-200 mb-4 rounded-lg">
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t("common.backToHome")}
              </Button>
            </Link>
            <h1 className="text-4xl font-bold mb-4">{t("tours.title")}</h1>
            <p className="text-xl text-gray-300">{t("tours.subtitle")}</p>
          </div>
        </section>

        {/* Destination Country Quick Filter */}
        {topDestinations.length > 0 && (
          <section className="bg-white border-b py-3">
            <div className="container">
              <div className="flex items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                <span className="flex-shrink-0 text-xs text-gray-500 font-medium whitespace-nowrap">
                  {language === "en" ? "Destination:" : "目的地："}
                </span>
                <button
                  onClick={() => handleCountryChange("all")}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all duration-200 ${
                    selectedCountry === "all"
                      ? "bg-teal-700 text-white border-teal-700"
                      : "bg-white text-gray-600 border-gray-200 hover:border-teal-400 hover:bg-teal-50"
                  }`}
                >
                  🌍 {language === "en" ? "All" : "全部"}
                </button>
                {topDestinations.map((dest) => (
                  <button
                    key={dest.country}
                    onClick={() => handleCountryChange(dest.country)}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all duration-200 ${
                      selectedCountry === dest.country
                        ? "bg-teal-700 text-white border-teal-700"
                        : "bg-white text-gray-600 border-gray-200 hover:border-teal-400 hover:bg-teal-50"
                    }`}
                  >
                    <span>{getFlagEmoji(dest.country)}</span>
                    <span>{translateDestination(dest.country, language)}</span>
                    <span className={`text-xs ${selectedCountry === dest.country ? "text-teal-100" : "text-gray-400"}`}>
                      ({dest.count})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Filter Bar */}
        <section className="bg-white border-b sticky top-0 z-10 shadow-sm">
          <div className="container">
            <div className="flex items-center gap-2 py-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {CATEGORY_TAGS.map((tag) => {
                const Icon = tag.icon;
                const label = language === "en" ? tag.labelEn : tag.labelZh;
                const isActive = selectedCategory === tag.value;
                return (
                  <button
                    key={tag.value}
                    onClick={() => handleCategoryChange(tag.value)}
                    className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? "bg-gray-900 text-white border-gray-900 shadow-md"
                        : "bg-white text-gray-700 border-gray-200 hover:border-gray-400 hover:bg-gray-50"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}

              <div className="flex-shrink-0 w-px h-8 bg-gray-200 mx-1" />

              {/* Always-visible keyword search input */}
              <div className="relative flex-shrink-0 w-56">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                <Input
                  placeholder={language === "en" ? "Search tours..." : "搜尋行程..."}
                  value={searchInput}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9 pr-8 rounded-full h-9 text-sm border-gray-200 focus:border-gray-400"
                />
                {searchInput && (
                  <button
                    onClick={() => handleSearchChange("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium transition-all duration-200 ${
                  showAdvanced || activeFiltersCount > 0
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                }`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {language === "en" ? "Filters" : "篩選"}
                {activeFiltersCount > 0 && (
                  <span className="bg-white text-gray-900 text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center ml-1">
                    {activeFiltersCount}
                  </span>
                )}
              </button>

              {activeFiltersCount > 0 && (
                <button
                  onClick={clearAllFilters}
                  className="flex-shrink-0 flex items-center gap-1 px-3 py-2 rounded-full text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <X className="h-3 w-3" />
                  {language === "en" ? "Clear" : "清除"}
                </button>
              )}
            </div>
          </div>

          {showAdvanced && (
            <div className="border-t bg-gray-50">
              <div className="container py-4">
                <div className="flex flex-col md:flex-row gap-4 items-start md:items-center flex-wrap">
                  <div className="relative flex-grow max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder={t("tours.searchPlaceholder")}
                      value={searchInput}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      className="pl-9 rounded-lg h-9 text-sm"
                    />
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-500 font-medium whitespace-nowrap">
                      {language === "en" ? "Duration:" : "天數："}
                    </span>
                    {DURATION_PRESETS.map((preset, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleDurationChange(idx)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          selectedDurationIdx === idx
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                        }`}
                      >
                        {language === "en" ? preset.labelEn : preset.labelZh}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 md:ml-auto">
                    <span className="text-sm text-gray-500 whitespace-nowrap">
                      {t("tours.sortBy")}:
                    </span>
                    <Select value={selectedSortBy} onValueChange={handleSortChange}>
                      <SelectTrigger className="w-[160px] rounded-lg h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="popular">{t("tours.sortPopular")}</SelectItem>
                        <SelectItem value="price_asc">{t("tours.sortPriceAsc")}</SelectItem>
                        <SelectItem value="price_desc">{t("tours.sortPriceDesc")}</SelectItem>
                        <SelectItem value="days_asc">{t("tours.sortDaysAsc")}</SelectItem>
                        <SelectItem value="days_desc">{t("tours.sortDaysDesc")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Tours Grid */}
        <section className="py-12">
          <div className="container">
            {isLoading ? (
              <div className="flex justify-center items-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : tours.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-gray-500 text-lg mb-4">{t("tours.noResults")}</p>
                {activeFiltersCount > 0 && (
                  <Button variant="outline" onClick={clearAllFilters} className="rounded-lg">
                    {language === "en" ? "Clear all filters" : "清除所有篩選條件"}
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center mb-6">
                  <p className="text-gray-600">
                    {t("tours.found")}{" "}
                    <span className="font-bold text-gray-900">{pagination?.total ?? tours.length}</span>{" "}
                    {t("tours.tours")}
                    {pagination && pagination.totalPages > 1 && (
                      <span className="text-gray-400 ml-2">
                        ({language === "en"
                          ? `Page ${pagination.page} / ${pagination.totalPages}`
                          : `第 ${pagination.page} / ${pagination.totalPages} 頁`})
                      </span>
                    )}
                  </p>
                  {!showAdvanced && (
                    <Select value={selectedSortBy} onValueChange={handleSortChange}>
                      <SelectTrigger className="w-[160px] rounded-lg h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="popular">{t("tours.sortPopular")}</SelectItem>
                        <SelectItem value="price_asc">{t("tours.sortPriceAsc")}</SelectItem>
                        <SelectItem value="price_desc">{t("tours.sortPriceDesc")}</SelectItem>
                        <SelectItem value="days_asc">{t("tours.sortDaysAsc")}</SelectItem>
                        <SelectItem value="days_desc">{t("tours.sortDaysDesc")}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {tours.map((tour: any) => (
                    <TourCard
                      key={tour.id}
                      tour={tour}
                      language={language}
                      t={t}
                      formatPrice={formatPrice}
                    />
                  ))}
                </div>
                {pagination && (
                  <Pagination
                    page={pagination.page}
                    totalPages={pagination.totalPages}
                    onPageChange={setPage}
                  />
                )}
              </>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
