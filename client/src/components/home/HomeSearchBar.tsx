import { useState } from "react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { Search, MapPin, Calendar } from "lucide-react";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/DateRangePicker";
import { useLocale } from "@/contexts/LocaleContext";
import { cn } from "@/lib/utils";

interface HomeSearchBarProps {
  hotKeywords?: string[];
  className?: string;
}

const DEFAULT_HOT_KEYWORDS = [
  "北海道",
  "東京",
  "歐洲",
  "土耳其",
  "郵輪",
  "義大利",
];

const HOT_KEYWORD_TRANSLATIONS: Record<string, string> = {
  "北海道": "Hokkaido",
  "東京": "Tokyo",
  "大阪": "Osaka",
  "歐洲": "Europe",
  "土耳其": "Turkey",
  "郵輪": "Cruise",
  "義大利": "Italy",
  "日本": "Japan",
  "韓國": "Korea",
};

export default function HomeSearchBar({ hotKeywords, className }: HomeSearchBarProps) {
  const { t, language } = useLocale();
  const [, setLocation] = useLocation();
  const [keyword, setKeyword] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const keywordsRaw = hotKeywords && hotKeywords.length > 0 ? hotKeywords : DEFAULT_HOT_KEYWORDS;
  const keywords = keywordsRaw.map((k) => ({
    raw: k,
    display: language === "en" ? HOT_KEYWORD_TRANSLATIONS[k] ?? k : k,
  }));

  const goToResults = (overrideKeyword?: string) => {
    const params = new URLSearchParams();
    const finalKw = overrideKeyword ?? keyword;
    if (finalKw) params.set("destination", finalKw);
    if (dateRange?.from) params.set("from", format(dateRange.from, "yyyy-MM-dd"));
    if (dateRange?.to) params.set("to", format(dateRange.to, "yyyy-MM-dd"));
    const qs = params.toString();
    setLocation(qs ? `/tours?${qs}` : "/tours");
  };

  return (
    <section className={cn("relative w-full bg-white pb-12 md:pb-16", className)}>
      <div className="container mx-auto px-6 md:px-10 -mt-12 md:-mt-16 relative z-20">
        <div className="bg-white border border-black/10 rounded-2xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1.2fr_auto] divide-y md:divide-y-0 md:divide-x divide-black/10">
            {/* Keyword */}
            <div className="px-5 py-4 md:px-6 md:py-5">
              <label
                htmlFor="home-keyword"
                className="flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-foreground/50 mb-1.5"
              >
                <MapPin className="h-3.5 w-3.5" />
                {t("hero.search.keyword")}
              </label>
              <input
                id="home-keyword"
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") goToResults();
                }}
                placeholder={t("hero.search.destinationPlaceholder")}
                className="w-full bg-transparent text-base md:text-lg font-medium text-foreground placeholder:text-foreground/40 focus:outline-none border-none p-0"
              />
            </div>

            {/* Date range */}
            <div className="px-5 py-4 md:px-6 md:py-5">
              <label className="flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-foreground/50 mb-1.5">
                <Calendar className="h-3.5 w-3.5" />
                {t("hero.search.departureDate")}
              </label>
              <DateRangePicker
                value={dateRange}
                onChange={setDateRange}
                className="border-none bg-transparent hover:bg-transparent shadow-none px-0 h-auto py-0 justify-start text-base md:text-lg font-medium [&>svg]:hidden"
              />
            </div>

            {/* Submit */}
            <div className="p-3 md:p-3 md:flex md:items-stretch">
              <button
                onClick={() => goToResults()}
                className="w-full md:w-auto md:px-10 inline-flex items-center justify-center gap-2 bg-foreground text-white rounded-xl md:rounded-lg font-semibold tracking-wide h-12 md:h-full hover:bg-foreground/90 transition-colors"
                aria-label={t("hero.search.searchButton")}
              >
                <Search className="h-4 w-4" />
                <span>{t("hero.search.searchButton")}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Hot keywords */}
        {keywords.length > 0 && (
          <div className="mt-5 md:mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs uppercase tracking-[0.25em] text-foreground/50">
              {t("hero.search.hotKeywords")}
            </span>
            {keywords.map((kw) => (
              <button
                key={kw.raw}
                onClick={() => goToResults(kw.raw)}
                className="text-sm text-foreground/70 hover:text-foreground border border-foreground/15 hover:border-foreground/40 rounded-full px-3.5 py-1 transition-colors"
              >
                {kw.display}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
