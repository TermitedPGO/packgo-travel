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
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock,
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
} from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CompareBar, { addToCompare, removeFromCompare, useCompareIds } from "@/components/CompareBar";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { useDebounce } from "@/hooks/useDebounce";
import { translateDestination } from "@/utils/locationMapping";

// Round 80.4: Custom (客製) removed from category chips — it doesn't fit the
// "browse pre-made tours" model (you can't filter for custom tours; they're
// generated on-demand). Custom now has a dedicated entry CTA below the chip
// row that links to /custom-tour-request, where the AI agent will eventually
// learn the customer's pattern and chat with them in real time.
const CATEGORY_TAGS = [
  { value: "all",     labelKey: "tours.categoryAll",     descKey: "tours.categoryAllDesc",     icon: Globe },
  { value: "group",   labelKey: "tours.categoryGroup",   descKey: "tours.categoryGroupDesc",   icon: Users },
  { value: "theme",   labelKey: "tours.categoryTheme",   descKey: "tours.categoryThemeDesc",   icon: Sparkles },
  { value: "package", labelKey: "tours.categoryPackage", descKey: "tours.categoryPackageDesc", icon: Package },
  { value: "cruise",  labelKey: "tours.categoryCruise",  descKey: "tours.categoryCruiseDesc",  icon: Anchor },
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
  const { t } = useLocale();
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
          if (!ok) toast.error(t("compareBar.maxLimitError"));
        }
      }}
      className={`absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-md ${
        inCompare
          ? "bg-black text-white"
          : "bg-white/90 text-gray-700 hover:bg-white"
      }`}
      aria-label={inCompare ? t("compareBar.removeFromCompare") : t("compareBar.addToCompare")}
      title={inCompare ? t("compareBar.inCompareList") : t("compareBar.addToCompare")}
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
  t: (key: string, params?: Record<string, string | number>) => string;
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

  // Round 80.2: parse highlights / tags JSON from tour record so the card
  // shows real itinerary content (was previously plain text-only).
  const highlightChips = useMemo(() => {
    const out: string[] = [];
    const tryParse = (raw: unknown): string[] => {
      if (!raw) return [];
      if (Array.isArray(raw)) return raw.filter((s) => typeof s === "string");
      if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string");
        } catch {
          // bare comma-separated fallback
          return raw.split(/[,，、；;]/g).map((s) => s.trim()).filter(Boolean);
        }
      }
      return [];
    };
    out.push(...tryParse(tour.highlights));
    if (out.length === 0) out.push(...tryParse(tour.tags));
    // Trim each chip to keep card tidy & dedupe
    return Array.from(new Set(out)).slice(0, 3).map((s) =>
      s.length > 14 ? `${s.slice(0, 13)}…` : s
    );
  }, [tour.highlights, tour.tags]);

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
    // Show max 3 tags now that the card has more breathing room
    return tags.slice(0, 3);
  }, [tour.included]);

  const isEn = language === "en";

  // Round 80.2: low-seats nudge for active urgency cue. We trust availableSeats
  // when present, otherwise compute from max - current.
  const seatsLeft = useMemo(() => {
    const left = typeof tour.availableSeats === "number"
      ? tour.availableSeats
      : (typeof tour.maxParticipants === "number" && typeof tour.currentParticipants === "number"
          ? Math.max(0, tour.maxParticipants - tour.currentParticipants)
          : null);
    if (left === null) return null;
    if (left > 0 && left <= 5) return left;
    return null;
  }, [tour.availableSeats, tour.maxParticipants, tour.currentParticipants]);

  return (
    <Card className="relative overflow-hidden hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 group border border-gray-200 flex flex-col rounded-xl bg-white">
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
                  div.className = 'img-fallback absolute inset-0 bg-foreground/[0.04] border border-foreground/10 flex items-center justify-center rounded-xl';
                  div.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>';
                  parent.appendChild(div);
                }
              }}
            />
          ) : (
            <div className="w-full h-full bg-foreground/[0.04] border border-foreground/10 flex items-center justify-center rounded-xl">
              <MapPin className="h-12 w-12 text-foreground/30" />
            </div>
          )}
          {/* Round 80.2: bottom gradient on image so the duration + featured
              chips have a guaranteed contrast surface */}
          <div
            className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 via-black/20 to-transparent rounded-b-xl pointer-events-none"
            aria-hidden
          />
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
          {/* Featured ribbon — top-left, gold for premium signal */}
          {!!tour.featured && tour.status !== "soldout" && (
            <div className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-1 bg-[#c9a563] text-white text-[10px] font-semibold tracking-[0.15em] uppercase rounded-md shadow-md">
              <Sparkles className="h-3 w-3" />
              {t("tours.featuredBadgeShort")}
            </div>
          )}
          {/* Duration badge overlay — bottom left, on the gradient */}
          <div className="absolute bottom-3 left-3 inline-flex items-center gap-1 bg-white/95 text-foreground text-xs font-bold px-2.5 py-1 rounded-md shadow-sm backdrop-blur">
            <Clock className="h-3 w-3" />
            {tour.duration} {t("tours.days")}{tour.nights ? ` ${tour.nights} ${t("tours.nights")}` : ""}
          </div>
          {/* Round 80.2: low-seats urgency badge — bottom right */}
          {seatsLeft !== null && (
            <div className="absolute bottom-3 right-3 inline-flex items-center gap-1 bg-[#c9a563]/95 text-white text-[10px] font-bold px-2 py-1 rounded-md shadow-sm backdrop-blur">
              {t("tours.seatsOnly", { n: String(seatsLeft) })}
            </div>
          )}
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
        {typeof tour.rating === "number" && tour.rating > 0 && (
          <div className="flex items-center gap-1 mb-2">
            {[1,2,3,4,5].map(i => (
              <Star
                key={i}
                className={`h-3.5 w-3.5 ${i <= Math.round(tour.rating as number) ? 'fill-[#c9a563] text-[#c9a563]' : 'text-gray-300'}`}
              />
            ))}
            <span className="text-xs text-gray-500 ml-1">
              ({(tour.rating as number).toFixed(1)})
            </span>
          </div>
        )}

        {/* Title */}
        <Link href={`/tours/${tour.id}`}>
          <h3 className="text-base md:text-[17px] font-bold mb-1.5 line-clamp-2 text-gray-900 group-hover:text-foreground transition-colors leading-snug cursor-pointer font-serif tracking-tight">
            {displayTitle}
          </h3>
        </Link>

        {/* v78h: 2-line selling-point preview (matches Lion Travel pattern) */}
        {displaySubtitle && (
          <p className="text-xs text-gray-600 mb-2.5 line-clamp-2 leading-relaxed">
            {(displaySubtitle as string).slice(0, 90)}
          </p>
        )}

        {/* Round 80.2: Origin → Destination meta line. Was just a single MapPin
            location row; now shows the departure city → destination arrow so
            travellers immediately see "where I leave from / where I go" — the
            two questions every customer asks first. */}
        <div className="flex items-center text-xs text-foreground/60 mb-2.5 gap-1.5">
          {tour.departureCity && (
            <>
              <span className="font-medium text-foreground/75">
                {translateDestination(tour.departureCity, language)}
              </span>
              <ArrowRight className="h-3 w-3 text-foreground/35" />
            </>
          )}
          <MapPin className="h-3.5 w-3.5 text-foreground/45 flex-shrink-0" />
          <span className="font-medium text-foreground/85 line-clamp-1">
            {translateDestination(tour.destinationCountry || '', language)}{tour.destinationCity && tour.destinationCity !== tour.destinationCountry ? ` · ${translateDestination(tour.destinationCity, language)}` : ""}
          </span>
        </div>

        {/* Round 80.2: highlights chips — pulled from tour.highlights (or tags fallback).
            Adds real itinerary detail to the card so users see what makes the
            trip distinctive at a glance ("古蹟 / 美食 / 溫泉" type signals). */}
        {highlightChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {highlightChips.map((chip, i) => (
              <span
                key={i}
                className="inline-flex items-center text-[11px] text-foreground/70 bg-foreground/[0.04] border border-foreground/10 px-2 py-0.5 rounded-md"
              >
                {chip}
              </span>
            ))}
          </div>
        )}

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
                // Round 80.1: monochrome chips per B&W rule. Gold accent for
                // "confirmed" (the trust-positive state); subtle gray for the
                // rest so the chip strip doesn't compete with the price.
                open: { label: t("tourDeparturesTable.statusAvailable"), cls: "bg-foreground/[0.04] text-foreground/75 border-foreground/15" },
                confirmed: { label: t("tourDeparturesTable.statusConfirmed"), cls: "bg-[#c9a563]/10 text-[#8a6f3a] border-[#c9a563]/35" },
                full: { label: t("tourDeparturesTable.statusSoldOut"), cls: "bg-foreground/5 text-foreground/40 border-foreground/10 line-through" },
                waitlist: { label: t("tourDeparturesTable.statusWaitlist"), cls: "bg-foreground/[0.04] text-foreground/60 border-foreground/15" },
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
                <span key={i} className="inline-flex items-center gap-1 text-[11px] text-foreground/70 bg-foreground/[0.04] px-2 py-0.5 rounded-md border border-foreground/10">
                  <Icon className="h-3 w-3 text-[#c9a563]" />
                  {t(tag.labelKey)}
                </span>
              );
            })}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-grow" />

        {/* Price + CTA — Round 80.2: gold-accented price baseline + arrow CTA */}
        <div className="pt-3 border-t border-foreground/10">
          <div className="flex items-end justify-between mb-3 gap-2">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-[0.15em] text-foreground/45 font-medium">
                {t("tours.startingFrom")}
              </span>
              <span className="text-xl md:text-[22px] font-bold text-foreground leading-tight font-serif tracking-tight">
                {formatPrice(tour.price || 0, (tour.priceCurrency || "TWD") as "TWD" | "USD")}
              </span>
            </div>
            {/* Tiny gold rule under price column */}
            <span className="self-end mb-1 h-px w-6 bg-[#c9a563]" aria-hidden />
          </div>
          <Link href={`/tours/${tour.id}`} className="block">
            <Button className="w-full bg-foreground text-white hover:bg-foreground/85 group/cta text-xs py-2 h-10 rounded-lg font-medium tracking-wide">
              {t("tours.viewDetails")}
              <ArrowRight className="h-3.5 w-3.5 ml-1.5 transition-transform group-hover/cta:translate-x-0.5" />
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
  // Round 79 follow-up: seed search input from `?destination=`. Round 80.13
  // also accepts `?q=` (used by the new HeroSearchBar). Both feed the same
  // destination filter on `tours.search` (fuzzy match across title +
  // destinationCountry + destinationCity).
  const urlDestination = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return params.get("destination") || params.get("q") || "";
  }, [searchString]);
  const [searchInput, setSearchInput] = useState(urlDestination);
  // Sync when URL ?q= changes after mount (e.g. user runs another search)
  useEffect(() => {
    setSearchInput(urlDestination);
  }, [urlDestination]);
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
      {/* Round 80.7: per-page SEO meta — was using a generic default, now
          targets "美西/亞洲/歐洲精品客製" + "灣區華人家庭" search intent. */}
      <SEO
        title={{
          zh: "全行程列表｜美西、亞洲、歐洲精品客製｜PACK&GO 旅行社",
          en: "All Tours | West Coast, Asia, Europe Custom Trips | PACK&GO",
        }}
        description={{
          zh: "瀏覽 PACK&GO 全部精品客製行程：美西深度、日本櫻花、歐洲莊園、郵輪假期。每條行程皆可個人化調整，灣區華人家庭首選。",
          en: "Browse all PACK&GO custom tours: California, Japan, Europe, cruises. Every itinerary tailorable. Mandarin-speaking experts trusted by Bay Area families.",
        }}
        image="/images/dest-asia.webp"
        url="/tours"
        type="website"
      />
      <Header />

      <main className="flex-grow">
        {/* Round 80.2: layered hero — was solid black & monotonous, now has
            a real travel photo background with dark overlay (still B&W brand
            but visually richer) and reduced height so the hero doesn't eat
            half the viewport. Topographic SVG decoration adds texture without
            color. */}
        <section className="relative w-full overflow-hidden bg-foreground h-[40vh] min-h-[320px] max-h-[440px] flex items-end pb-12 md:pb-16">
          {/* Background photo — subtle, behind a heavy overlay so the title
              still reads as B&W brand but the eye has somewhere to land. */}
          <div className="absolute inset-0" aria-hidden>
            {/* aria-hidden because this is purely decorative texture under
                a heavy black overlay — it carries no informational value. */}
            <img
              src="https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=2400&q=70"
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover opacity-[0.32]"
              loading="eager"
            />
            {/* Vignette: dark at edges, slightly lifted in the middle so the
                photo reads as texture rather than competing with the headline */}
            <div className="absolute inset-0 bg-gradient-to-b from-foreground/85 via-foreground/70 to-foreground/95" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_55%,_transparent_0%,_rgba(0,0,0,0.55)_60%,_rgba(0,0,0,0.85)_100%)]" />
          </div>
          {/* Topographic SVG pattern — adds visual rhythm without color */}
          <svg
            className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
          >
            <defs>
              <pattern id="topo" x="0" y="0" width="120" height="120" patternUnits="userSpaceOnUse">
                <path d="M0 60 Q30 20, 60 60 T120 60" fill="none" stroke="#c9a563" strokeWidth="1" />
                <path d="M0 90 Q30 50, 60 90 T120 90" fill="none" stroke="#fff" strokeWidth="0.5" />
                <path d="M0 30 Q30 -10, 60 30 T120 30" fill="none" stroke="#fff" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#topo)" />
          </svg>

          <div className="container relative z-10 mx-auto px-6 md:px-10">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-white/65 hover:text-white text-sm tracking-wide mb-5 md:mb-6 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("common.backToHome")}
            </Link>
            <div className="flex items-center gap-3 mb-3 text-[#c9a563]">
              <span className="h-px w-8 bg-[#c9a563]" aria-hidden />
              <p className="text-xs md:text-sm tracking-[0.35em] uppercase">
                PACK&amp;GO TRAVEL · {pagination?.total ?? tours.length}{" "}
                {t("tours.curatedRoutes")}
              </p>
            </div>
            <h1 className="font-serif font-bold text-white text-3xl md:text-5xl lg:text-6xl leading-[1.05] tracking-tight">
              {t("tours.title")}
            </h1>
            <p className="mt-3 md:mt-4 text-sm md:text-base text-white/75 leading-relaxed max-w-2xl">
              {t("tours.subtitle")}
            </p>
          </div>
          {/* Gold rule at bottom edge — anchors brand baseline */}
          <div
            className="absolute left-0 right-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#c9a563] to-transparent opacity-60"
            aria-hidden
          />
        </section>

        {/* Round 80: prominent search bar. Replaces the tiny inline search
            users said they couldn't find ("搜尋不見了"). Overlaps the hero
            via -mt so visually it grows out of the brand layer. */}
        <section className="relative w-full bg-white pb-8 md:pb-10">
          <div className="container mx-auto px-6 md:px-10 -mt-8 md:-mt-12 relative z-20">
            <div className="bg-white border border-black/10 rounded-2xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] divide-y md:divide-y-0 md:divide-x divide-black/10">
                <div className="px-5 py-4 md:px-6 md:py-5">
                  <label
                    htmlFor="tours-keyword"
                    className="flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-foreground/50 mb-1.5"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    {t("hero.search.keyword")}
                  </label>
                  <input
                    id="tours-keyword"
                    type="text"
                    value={searchInput}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder={t("tours.searchPlaceholder")}
                    className="w-full bg-transparent text-base md:text-lg font-medium text-foreground placeholder:text-foreground/40 focus:outline-none border-none p-0"
                  />
                </div>
                <div className="p-3 md:flex md:items-stretch">
                  <button
                    onClick={() => {
                      const el = document.getElementById("tours-results");
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className="w-full md:w-auto md:px-10 inline-flex items-center justify-center gap-2 bg-foreground text-white rounded-xl md:rounded-lg font-semibold tracking-wide h-12 md:h-full hover:bg-foreground/90 transition-colors"
                    aria-label={t("hero.search.searchButton")}
                  >
                    <Search className="h-4 w-4" />
                    <span>{t("hero.search.searchButton")}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Round 80.4: Custom-tour CTA banner. Custom (客製) was previously a
            filter chip, but it never made sense — you can't filter for tours
            that don't exist yet. Now it's a prominent, gold-accented entry to
            /custom-tour-request, where the AI advisor takes over.
            Sits between the search bar and the country/category filters so it
            feels like a parallel path ("browse OR build"), not a filter. */}
        <section className="relative w-full bg-white border-b border-foreground/5">
          <div className="container mx-auto px-6 md:px-10 py-5 md:py-6">
            <Link
              href="/custom-tour-request"
              className="group flex items-center gap-4 md:gap-5 rounded-xl border border-[#c9a563]/30 bg-gradient-to-r from-[#c9a563]/[0.07] via-white to-white hover:border-[#c9a563]/55 hover:shadow-md transition-all px-5 py-4 md:px-7 md:py-5"
            >
              <span className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-xl bg-[#c9a563]/15 border border-[#c9a563]/35 group-hover:bg-[#c9a563]/25 transition-colors">
                <Compass className="h-5 w-5 md:h-6 md:w-6 text-[#c9a563]" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] md:text-[11px] tracking-[0.3em] uppercase text-[#8a6f3a] font-semibold mb-0.5">
                  {t("tours.customCtaEyebrow")}
                </p>
                <p className="text-sm md:text-base font-bold text-foreground leading-tight font-serif tracking-tight">
                  {t("tours.customCtaTitle")}
                </p>
                <p className="hidden md:block text-xs text-foreground/60 mt-1 leading-snug line-clamp-1">
                  {t("tours.customCtaDesc")}
                </p>
              </div>
              <span className="flex-shrink-0 hidden sm:inline-flex items-center gap-1.5 text-xs md:text-sm font-medium text-foreground group-hover:gap-2.5 transition-all">
                <span className="hidden md:inline">{t("tours.customCtaButton")}</span>
                <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          </div>
        </section>

        {/* Round 80.1: country quick-filter shown as text links (not chips)
            so it visually subordinates to the category chip filter below. */}
        {topDestinations.length > 0 && (
          <section className="bg-white border-b border-black/5 py-2.5">
            <div className="container">
              <div className="flex items-center gap-x-1 gap-y-1 overflow-x-auto flex-nowrap" style={{ scrollbarWidth: "none" }}>
                <span className="flex-shrink-0 text-[11px] tracking-[0.2em] uppercase text-foreground/45 font-medium whitespace-nowrap mr-3">
                  {t("tours.destinationLabel")}
                </span>
                <button
                  onClick={() => handleCountryChange("all")}
                  className={`flex-shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 transition-colors ${
                    selectedCountry === "all"
                      ? "text-foreground font-semibold border-b-2 border-foreground"
                      : "text-foreground/55 hover:text-foreground border-b-2 border-transparent"
                  }`}
                >
                  <Globe className="h-3 w-3" />
                  {t("tours.allDestinations")}
                </button>
                {topDestinations.map((dest) => (
                  <button
                    key={dest.country}
                    onClick={() => handleCountryChange(dest.country)}
                    className={`flex-shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 transition-colors whitespace-nowrap ${
                      selectedCountry === dest.country
                        ? "text-foreground font-semibold border-b-2 border-foreground"
                        : "text-foreground/55 hover:text-foreground border-b-2 border-transparent"
                    }`}
                  >
                    <span>{translateDestination(dest.country, language)}</span>
                    <span className="text-foreground/35 text-[10px]">{dest.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Filter Bar */}
        <section className="bg-white border-b sticky top-0 z-10 shadow-sm">
          <div className="container">
            {/* Round 80.2: richer category cards (was: flat chips). Each card
                now shows the category icon, label, AND a one-line description
                so users immediately understand what each filter does, instead
                of decoding "主題旅遊" vs "客製旅遊" by category name alone.
                Active card flips to inverted (foreground bg + gold accent rule). */}
            <div className="flex items-stretch gap-2 md:gap-3 py-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {CATEGORY_TAGS.map((tag) => {
                const Icon = tag.icon;
                const label = t(tag.labelKey);
                const desc = t(tag.descKey);
                const isActive = selectedCategory === tag.value;
                return (
                  <button
                    key={tag.value}
                    onClick={() => handleCategoryChange(tag.value)}
                    className={`flex-shrink-0 group relative flex items-center gap-2.5 md:gap-3 px-3.5 md:px-4 py-2 md:py-2.5 rounded-xl border text-left transition-all duration-200 ${
                      isActive
                        ? "bg-foreground text-white border-foreground shadow-md"
                        : "bg-white text-foreground/80 border-foreground/15 hover:border-foreground/40 hover:bg-foreground/5 hover:shadow-sm"
                    }`}
                  >
                    <span className={`flex-shrink-0 inline-flex items-center justify-center w-8 h-8 md:w-9 md:h-9 rounded-lg transition-colors ${
                      isActive
                        ? "bg-[#c9a563]/20 text-[#c9a563]"
                        : "bg-foreground/[0.04] text-foreground/55 group-hover:bg-[#c9a563]/10 group-hover:text-[#c9a563]"
                    }`}>
                      <Icon className="h-4 w-4 md:h-[18px] md:w-[18px]" />
                    </span>
                    <span className="flex flex-col leading-tight">
                      <span className="text-sm font-semibold tracking-tight whitespace-nowrap">
                        {label}
                      </span>
                      <span className={`hidden sm:block text-[10px] md:text-[11px] tracking-[0.05em] mt-0.5 whitespace-nowrap ${
                        isActive ? "text-white/65" : "text-foreground/50"
                      }`}>
                        {desc}
                      </span>
                    </span>
                    {/* Tiny gold accent rule under active chip — anchors brand */}
                    {isActive && (
                      <span
                        className="absolute left-3.5 right-3.5 bottom-0 h-px bg-[#c9a563]/55"
                        aria-hidden
                      />
                    )}
                  </button>
                );
              })}

              {/* Round 80.1: removed redundant inline keyword search — the
                  prominent search bar above already handles this. */}
              <div className="flex-shrink-0 w-px h-10 bg-gray-200 mx-1 ml-auto self-center" />

              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className={`flex-shrink-0 self-center flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 ${
                  showAdvanced || activeFiltersCount > 0
                    ? "bg-foreground text-white border-foreground"
                    : "bg-white text-foreground/70 border-foreground/15 hover:border-foreground/40 hover:bg-foreground/5"
                }`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {t("tours.filtersButton")}
                {activeFiltersCount > 0 && (
                  <span className="bg-[#c9a563] text-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center ml-1">
                    {activeFiltersCount}
                  </span>
                )}
              </button>

              {activeFiltersCount > 0 && (
                <button
                  onClick={clearAllFilters}
                  className="flex-shrink-0 self-center flex items-center gap-1 px-3 py-2.5 rounded-xl text-sm text-foreground/60 hover:text-foreground hover:bg-foreground/5 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
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
                    {t("tours.filtersTitle")}
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
                      {t("tours.priceLabel")}
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
                  {t("tours.viewNTours", { count: String(pagination?.total ?? tours.length) })}
                </Button>
              </div>
              </div>
            </>
          )}
        </section>

        {/* Tours Grid */}
        <section id="tours-results" className="py-12 scroll-mt-20">
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
                  {t("tours.emptyState.title")}
                </h3>
                <p className="text-gray-500 mb-6 leading-relaxed">
                  {activeFiltersCount > 0
                    ? t("tours.emptyState.hintWithFilters")
                    : t("tours.emptyState.hintNoFilters")}
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
                    {t("tours.emptyState.requestCustom")}
                  </Button>
                </div>
                {/* Suggest popular destinations as next-best-action */}
                {topDestinations && topDestinations.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-gray-400 mb-3">
                      {t("tours.emptyState.popularDestinations")}
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
