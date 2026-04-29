import { useState, useMemo, useCallback, useEffect } from "react";
import { Link, useSearch, useLocation } from "wouter";
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
import CompareBar, { addToCompare, removeFromCompare, useCompareIds } from "@/components/CompareBar";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { useDebounce } from "@/hooks/useDebounce";
import { translateDestination } from "@/utils/locationMapping";

const CATEGORY_TAGS = [
  { value: "all",     labelKey: "tours.categoryAll",     icon: Globe },
  { value: "group",   labelKey: "tours.categoryGroup",   icon: Users },
  { value: "theme",   labelKey: "tours.categoryTheme",   icon: Sparkles },
  { value: "custom",  labelKey: "tours.categoryCustom",  icon: Compass },
  { value: "package", labelKey: "tours.categoryPackage", icon: Package },
  { value: "cruise",  labelKey: "tours.categoryCruise",  icon: Anchor },
];

const DURATION_PRESETS = [
  { labelKey: "tours.durationAny",     min: undefined as number | undefined, max: undefined as number | undefined },
  { labelKey: "tours.duration1_5",     min: 1,  max: 5  },
  { labelKey: "tours.duration6_10",    min: 6,  max: 10 },
  { labelKey: "tours.duration11_15",   min: 11, max: 15 },
  { labelKey: "tours.duration16Plus",  min: 16, max: undefined as number | undefined },
];

// v78u: Price range presets (TWD-based, since most tour data is stored in TWD).
// formatPrice in render layer handles the displayed currency conversion.
const PRICE_PRESETS = [
  { label: { zh: "不限", en: "Any" }, min: undefined as number | undefined, max: undefined as number | undefined },
  { label: { zh: "$50K 以下", en: "Under $50K" }, min: undefined, max: 50000 },
  { label: { zh: "$50K–$100K", en: "$50K–$100K" }, min: 50000, max: 100000 },
  { label: { zh: "$100K–$150K", en: "$100K–$150K" }, min: 100000, max: 150000 },
  { label: { zh: "$150K 以上", en: "$150K+" }, min: 150000, max: undefined },
];

// v78h: removed getFlagEmoji() — emoji flags violate the no-emoji design rule.
// Country is now rendered via lucide `Globe` icon + country name only.

// v78j: tiny "+ compare" toggle for tour cards. Reactive — uses useCompareIds()
// so the same tour pinned across multiple cards stays in sync.
function CompareToggle({ tourId }: { tourId: number }) {
  const ids = useCompareIds();
  const inCompare = ids.includes(tourId);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (inCompare) removeFromCompare(tourId);
        else {
          const ok = addToCompare(tourId);
          if (!ok) toast.error("最多比較 3 個行程");
        }
      }}
      className={`absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-md ${
        inCompare
          ? "bg-black text-white"
          : "bg-white/90 text-gray-700 hover:bg-white"
      }`}
      aria-label={inCompare ? "移出比較" : "加入比較"}
      title={inCompare ? "已在比較清單" : "加入比較"}
    >
      {inCompare ? <X className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
    </button>
  );
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

  // v78p: Same fallback chain for the subtitle / description preview text shown
  // under the tour title — was leaking ZH on EN site because we read tour.heroSubtitle
  // directly without the translation lookup.
  const displaySubtitle = useMemo(() => {
    if (language === "zh-TW") return tour.heroSubtitle || tour.description;
    return translations?.heroSubtitle || translations?.description || tour.heroSubtitle || tour.description;
  }, [language, translations, tour.heroSubtitle, tour.description]);

  // v78s: Fetch top-3 upcoming departures (Lion Travel chip pattern)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: upcomingDepartures } = (trpc.departures as any).getUpcoming.useQuery(
    { tourId: tour.id, limit: 3 },
    { staleTime: 1000 * 60 * 5 }
  );
  const nextDeparture = (upcomingDepartures as any[] | undefined)?.[0] ?? null;

  // Determine included items from tour data
  const includedTags = useMemo(() => {
    const tags: { icon: typeof Plane; labelKey: string }[] = [];
    const inc = tour.included || "";
    if (inc.includes("機票") || inc.includes("flight") || inc.toLowerCase().includes("air")) {
      tags.push({ icon: Plane, labelKey: "tours.tagFlights" });
    }
    if (inc.includes("飯店") || inc.includes("hotel") || inc.includes("住宿") || inc.toLowerCase().includes("hotel")) {
      tags.push({ icon: Hotel, labelKey: "tours.tagHotels" });
    }
    if (inc.includes("餐") || inc.includes("meal") || inc.includes("food") || inc.toLowerCase().includes("meal")) {
      tags.push({ icon: Utensils, labelKey: "tours.tagMeals" });
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
    <Card className="relative overflow-hidden hover:shadow-lg transition-all duration-300 group border border-gray-200 flex flex-col">
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
              {t("tours.fullyBooked")}
            </Badge>
          )}
          {tour.status === "inactive" && (
            <Badge className="absolute top-4 right-4 bg-red-500 text-white">
              {t("tours.inactive")}
            </Badge>
          )}
          {/* Duration badge overlay */}
          <div className="absolute bottom-3 left-3 bg-black/70 text-white text-xs font-bold px-2 py-1 rounded-md">
            {tour.duration} {t("tours.days")}{tour.nights ? ` ${tour.nights} ${t("tours.nights")}` : ""}
          </div>
        </div>
      </Link>
      {/* v78j: compare toggle — small unobtrusive button overlay top-right */}
      <CompareToggle tourId={tour.id} />

      <div className="p-5 flex flex-col flex-grow">
        {/*
          Rating Row — FTC 16 CFR Part 465 / Act §5 compliance.
          Previously rendered a hardcoded 5-star display with "(5.0)" on every
          card regardless of whether any reviews existed. That is a deceptive
          testimonial under the FTC fake review rule. We now only render real
          ratings sourced from the tour record; otherwise show "no reviews yet".
        */}
        {/* Rating Row — only render when there's a real rating, otherwise show
            "精選" featured badge (if applicable) so the card doesn't display
            an empty/awkward "no reviews" state. v78h. */}
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
        ) : tour.featured ? (
          <div className="inline-flex items-center gap-1 mb-2 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold w-fit">
            <Sparkles className="h-3 w-3" />
            {t("tours.featuredBadge") || "精選"}
          </div>
        ) : null}

        {/* Title */}
        <Link href={`/tours/${tour.id}`}>
          <h3 className="text-base font-bold mb-2 line-clamp-2 text-gray-900 group-hover:text-primary transition-colors leading-snug cursor-pointer">
            {displayTitle}
          </h3>
        </Link>

        {/* v78h: 2-line selling-point preview (matches Lion Travel pattern) */}
        {displaySubtitle && (
          <p className="text-xs text-gray-600 mb-2 line-clamp-2 leading-relaxed">
            {(displaySubtitle as string).slice(0, 80)}
          </p>
        )}

        {/* Location */}
        <div className="flex items-center text-gray-500 mb-2">
          <MapPin className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
          <span className="text-xs">
            {translateDestination(tour.destinationCountry || '', language)}{tour.destinationCity && tour.destinationCity !== tour.destinationCountry ? ` · ${translateDestination(tour.destinationCity, language)}` : ""}
          </span>
        </div>

        {/* v78s: Multi-departure chip strip — Lion-Travel pattern.
            Shows up to 3 upcoming dates with status pill ("Available"/"Confirmed"/"Sold out").
            More informative than single-date label, helps users see frequency at a glance. */}
        {upcomingDepartures && (upcomingDepartures as any[]).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {(upcomingDepartures as any[]).slice(0, 3).map((dep: any) => {
              const d = new Date(dep.departureDate);
              const dateLabel = isEn
                ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                : `${d.getMonth() + 1}/${d.getDate()}`;
              const status = dep.status as string;
              const statusConfig: Record<string, { label: string; cls: string }> = {
                open: { label: isEn ? "Available" : "可預訂", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                confirmed: { label: isEn ? "Confirmed" : "確定出發", cls: "bg-blue-50 text-blue-700 border-blue-200" },
                full: { label: isEn ? "Sold out" : "額滿", cls: "bg-gray-100 text-gray-500 border-gray-200" },
                waitlist: { label: isEn ? "Waitlist" : "候補", cls: "bg-amber-50 text-amber-700 border-amber-200" },
              };
              const sCfg = statusConfig[status] || statusConfig.open;
              return (
                <span
                  key={dep.id}
                  className={`inline-flex items-center gap-1 text-[10px] md:text-xs font-medium px-1.5 py-0.5 rounded border ${sCfg.cls}`}
                  title={`${dateLabel} · ${sCfg.label}`}
                >
                  <Calendar className="h-2.5 w-2.5 md:h-3 md:w-3" />
                  <span>{dateLabel}</span>
                </span>
              );
            })}
            {(upcomingDepartures as any[]).length > 3 && (
              <span className="text-[10px] md:text-xs text-gray-400 px-1.5 py-0.5">
                +{(upcomingDepartures as any[]).length - 3}
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
                <span key={i} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md border border-gray-200">
                  <Icon className="h-3 w-3" />
                  {t(tag.labelKey)}
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
          {/* v78h: single primary CTA (removed secondary chat button to reduce
              cognitive load on tour cards — matches signettours pattern). */}
          <Link href={`/tours/${tour.id}`} className="block">
            <Button className="w-full bg-black text-white hover:bg-gray-800 text-xs py-2 h-9">
              {t("tours.viewDetails")}
            </Button>
          </Link>
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
  const [, setLocation] = useLocation(); // v78v: empty-state CTA navigation
  const searchString = useSearch();
  const urlCategory = useMemo(() => new URLSearchParams(searchString).get("category") || "all", [searchString]);
  const [searchInput, setSearchInput] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>(urlCategory);
  const [selectedDurationIdx, setSelectedDurationIdx] = useState<number>(0);
  const [selectedPriceIdx, setSelectedPriceIdx] = useState<number>(0); // v78u
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
  const selectedPrice = PRICE_PRESETS[selectedPriceIdx]; // v78u

  const resetPage = useCallback(() => setPage(1), []);
  const handleSearchChange = useCallback((value: string) => { setSearchInput(value); resetPage(); }, [resetPage]);
  const handleCategoryChange = useCallback((value: string) => { setSelectedCategory(value); resetPage(); }, [resetPage]);
  const handleDurationChange = useCallback((idx: number) => { setSelectedDurationIdx(idx); resetPage(); }, [resetPage]);
  const handlePriceChange = useCallback((idx: number) => { setSelectedPriceIdx(idx); resetPage(); }, [resetPage]); // v78u
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
    minPrice: selectedPrice.min, // v78u
    maxPrice: selectedPrice.max, // v78u
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
    if (selectedPriceIdx !== 0) count++; // v78u
    if (selectedSortBy !== "popular") count++;
    if (debouncedSearch) count++;
    return count;
  }, [selectedCategory, selectedDurationIdx, selectedPriceIdx, selectedSortBy, debouncedSearch]);

  const clearAllFilters = useCallback(() => {
    setSearchInput("");
    setSelectedCategory("all");
    setSelectedDurationIdx(0);
    setSelectedPriceIdx(0); // v78u
    setSelectedSortBy("popular");
    setSelectedCountry("all");
    setPage(1);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <SEO
        title={{ zh: "所有行程", en: "All Tours" }}
        description={{
          zh: "瀏覽 PACK&GO 旅行社所有精選旅遊行程，包含日本、歐洲、東南亞等熱門目的地，提供客製化旅遊規劃服務。",
          en: "Browse all curated PACK&GO Travel tour packages, featuring Japan, Europe, Southeast Asia and more — with custom itinerary planning available.",
        }}
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
                  {t("tours.destinationLabel")}
                </span>
                <button
                  onClick={() => handleCountryChange("all")}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all duration-200 ${
                    selectedCountry === "all"
                      ? "bg-teal-700 text-white border-teal-700"
                      : "bg-white text-gray-600 border-gray-200 hover:border-teal-400 hover:bg-teal-50"
                  }`}
                >
                  <Globe className="h-3.5 w-3.5" />
                  {t("tours.allDestinations")}
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
                const label = t(tag.labelKey);
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
                  placeholder={t('common.searchToursPlaceholder')}
                  value={searchInput}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9 pr-8 rounded-lg h-9 text-sm border-gray-200 focus:border-gray-400"
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
                {t("tours.filtersButton")}
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
                  {t("tours.clear")}
                </button>
              )}
            </div>
          </div>

          {showAdvanced && (
            <>
              {/* v78v: Mobile slide-over backdrop — taps outside to close */}
              <div
                onClick={() => setShowAdvanced(false)}
                className="md:hidden fixed inset-0 bg-black/40 z-40"
                aria-hidden
              />
              <div className={`
                border-t bg-gray-50
                md:relative md:block
                fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl shadow-2xl
                md:max-h-none md:overflow-visible md:rounded-none md:shadow-none md:inset-auto md:bottom-auto
                animate-in slide-in-from-bottom-4 md:animate-none
              `}>
                {/* Mobile-only header with close button */}
                <div className="md:hidden flex items-center justify-between px-4 py-3 border-b bg-white sticky top-0">
                  <h3 className="font-semibold text-base">
                    {language === "en" ? "Filters" : "篩選"}
                    {activeFiltersCount > 0 && (
                      <span className="ml-2 inline-flex items-center justify-center bg-gray-900 text-white text-xs font-bold rounded-full w-5 h-5">
                        {activeFiltersCount}
                      </span>
                    )}
                  </h3>
                  <button
                    onClick={() => setShowAdvanced(false)}
                    className="p-1.5 -mr-1.5 rounded-full hover:bg-gray-100"
                    aria-label="Close filters"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
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
                      {t("tours.durationLabel")}
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
                        {t(preset.labelKey)}
                      </button>
                    ))}
                  </div>

                  {/* v78u: Price range chips — major missing filter, customers always ask "what's my budget" */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-500 font-medium whitespace-nowrap">
                      {language === "en" ? "Price" : "預算"}
                    </span>
                    {PRICE_PRESETS.map((preset, idx) => (
                      <button
                        key={idx}
                        onClick={() => handlePriceChange(idx)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          selectedPriceIdx === idx
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                        }`}
                      >
                        {language === "en" ? preset.label.en : preset.label.zh}
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
              {/* v78v: Mobile-only "View N tours" sticky footer */}
              <div className="md:hidden sticky bottom-0 bg-white border-t px-4 py-3 flex items-center justify-between gap-3">
                {activeFiltersCount > 0 && (
                  <button onClick={clearAllFilters} className="text-sm text-red-600 font-medium">
                    {t("tours.clear")}
                  </button>
                )}
                <Button onClick={() => setShowAdvanced(false)} className="ml-auto rounded-lg">
                  {language === "en"
                    ? `View ${pagination?.total ?? tours.length} tours`
                    : `查看 ${pagination?.total ?? tours.length} 個行程`}
                </Button>
              </div>
              </div>
            </>
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
              // v78v: rich empty state — illustrative + actionable next steps
              <div className="max-w-xl mx-auto text-center py-16 px-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-5">
                  <Search className="h-7 w-7 text-gray-400" />
                </div>
                <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-2">
                  {language === "en" ? "No tours match your search" : "沒有符合的行程"}
                </h3>
                <p className="text-gray-500 mb-6 leading-relaxed">
                  {activeFiltersCount > 0
                    ? (language === "en"
                        ? "Try removing one of your filters, or browse other destinations below."
                        : "試試移除一些篩選條件，或瀏覽下方其他目的地。")
                    : (language === "en"
                        ? "Be the first to plan a custom trip — our AI will draft an itinerary in 30 seconds."
                        : "您可以提交客製需求 — AI 30 秒內為您草擬行程。")}
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
                  {activeFiltersCount > 0 && (
                    <Button variant="outline" onClick={clearAllFilters} className="rounded-lg">
                      <X className="h-4 w-4 mr-1.5" />
                      {t("tours.clearAllFilters")}
                    </Button>
                  )}
                  <Button onClick={() => setLocation("/custom-tour-request")} className="rounded-lg">
                    <Sparkles className="h-4 w-4 mr-1.5" />
                    {language === "en" ? "Request a custom tour" : "客製化行程"}
                  </Button>
                </div>
                {/* Suggest popular destinations as next-best-action */}
                {topDestinations && topDestinations.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-gray-400 mb-3">
                      {language === "en" ? "Popular destinations" : "熱門目的地"}
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {topDestinations.slice(0, 6).map((dest: any) => (
                        <button
                          key={dest.country}
                          onClick={() => {
                            clearAllFilters();
                            handleSearchChange(dest.country);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 hover:border-gray-400 hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors"
                        >
                          <MapPin className="h-3.5 w-3.5 text-gray-400" />
                          {translateDestination(dest.country, language)}
                          <span className="text-gray-400 text-xs">({dest.count})</span>
                        </button>
                      ))}
                    </div>
                  </div>
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
                        ({t("tours.pageIndicator", { page: String(pagination.page), total: String(pagination.totalPages) })})
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
      <CompareBar />
    </div>
  );
}
