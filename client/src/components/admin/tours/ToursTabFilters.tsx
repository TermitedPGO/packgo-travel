/**
 * ToursTabFilters — single-row filter bar.
 *
 * Round 80.10 redesign:
 * - Search input (left, flex-1)
 * - Status pills with counts (全部 / 上架中 / 下架)
 * - Featured-only toggle (gold accent when active)
 * - View toggle (列表 / 卡片)
 * - Sort select stays as a small dropdown on the right
 *
 * Brand baseline (CLAUDE.md): rounded-lg, rounded-md for badges, no purple/blue.
 */
import { useLocale } from "@/contexts/LocaleContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Star } from "lucide-react";

export type StatusFilter = "all" | "active" | "inactive";
export type FeaturedFilter = "all" | "featured" | "normal";
export type SortKey =
  | "default"
  | "price-asc"
  | "price-desc"
  | "duration-asc"
  | "duration-desc"
  | "date-asc"
  | "date-desc";
export type ViewMode = "list" | "card";

interface ToursTabFiltersProps {
  searchKeyword: string;
  onSearchChange: (v: string) => void;
  statusFilter: StatusFilter;
  onStatusChange: (v: StatusFilter) => void;
  statusCounts: { all: number; active: number; inactive: number };
  featuredFilter: FeaturedFilter;
  onFeaturedToggle: () => void;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  sortBy: SortKey;
  onSortChange: (v: SortKey) => void;
}

export function ToursTabFilters({
  searchKeyword,
  onSearchChange,
  statusFilter,
  onStatusChange,
  statusCounts,
  featuredFilter,
  onFeaturedToggle,
  view,
  onViewChange,
  sortBy,
  onSortChange,
}: ToursTabFiltersProps) {
  const { t } = useLocale();

  const statusOptions: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: t("toursTab.statusAll"), count: statusCounts.all },
    {
      key: "active",
      label: t("toursTab.statusActive"),
      count: statusCounts.active,
    },
    {
      key: "inactive",
      label: t("toursTab.statusInactive"),
      count: statusCounts.inactive,
    },
  ];

  const showFeaturedOnly = featuredFilter === "featured";

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3 flex-wrap">
      {/* Search */}
      <div className="flex-1 min-w-[200px] relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder={t("toursTab.searchPlaceholder")}
          value={searchKeyword}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-3 h-9 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-foreground/40"
        />
      </div>

      {/* Status pills */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
        {statusOptions.map((f) => {
          const isActive = statusFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => onStatusChange(f.key)}
              className={`px-3 h-7 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                isActive
                  ? "bg-white text-foreground shadow-sm"
                  : "text-gray-600 hover:text-foreground"
              }`}
            >
              {f.label}
              <span
                className={`text-[10px] tabular-nums ${
                  isActive ? "text-foreground/60" : "text-gray-400"
                }`}
              >
                {f.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Featured toggle */}
      <button
        type="button"
        onClick={onFeaturedToggle}
        className={`flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border transition-colors ${
          showFeaturedOnly
            ? "border-[#c9a563] bg-[#c9a563]/10 text-[#8a6f3a]"
            : "border-gray-200 text-gray-600 hover:border-gray-300"
        }`}
      >
        <Star
          className={`w-3.5 h-3.5 ${showFeaturedOnly ? "fill-current" : ""}`}
        />
        {t("toursTab.featuredOnlyToggle")}
      </button>

      {/* Sort */}
      <Select value={sortBy} onValueChange={(v: any) => onSortChange(v)}>
        <SelectTrigger className="w-[140px] h-9 text-xs border-gray-200 rounded-lg">
          <SelectValue placeholder={t("toursTab.sortLabel")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">{t("toursTab.sortDefault")}</SelectItem>
          <SelectItem value="price-asc">{t("toursTab.sortPriceAsc")}</SelectItem>
          <SelectItem value="price-desc">
            {t("toursTab.sortPriceDesc")}
          </SelectItem>
          <SelectItem value="duration-asc">
            {t("toursTab.sortDaysAsc")}
          </SelectItem>
          <SelectItem value="duration-desc">
            {t("toursTab.sortDaysDesc")}
          </SelectItem>
          <SelectItem value="date-desc">{t("toursTab.sortNewest")}</SelectItem>
          <SelectItem value="date-asc">{t("toursTab.sortOldest")}</SelectItem>
        </SelectContent>
      </Select>

      {/* View toggle */}
      <div className="flex items-center bg-gray-100 rounded-lg p-1">
        <button
          type="button"
          onClick={() => onViewChange("list")}
          className={`px-3 h-7 text-xs font-medium rounded-md transition-colors ${
            view === "list"
              ? "bg-white text-foreground shadow-sm"
              : "text-gray-600"
          }`}
        >
          {t("toursTab.viewList")}
        </button>
        <button
          type="button"
          onClick={() => onViewChange("card")}
          className={`px-3 h-7 text-xs font-medium rounded-md transition-colors ${
            view === "card"
              ? "bg-white text-foreground shadow-sm"
              : "text-gray-600"
          }`}
        >
          {t("toursTab.viewCard")}
        </button>
      </div>
    </div>
  );
}
