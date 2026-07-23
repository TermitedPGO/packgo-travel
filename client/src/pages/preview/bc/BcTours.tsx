/**
 * Batch P1c — BC tours shelf (internal preview /preview/bc/tours).
 *
 * BC 貨架 rebuilt on the REAL catalog: tours.searchCards drives the grid,
 * but ONLY its lean allow-listed fields (id/title/destination/duration/
 * heroImage) are consumed. Every date and price on a card comes from safe
 * storefront.listDepartures (native currency, integer minor units, soonest
 * departure labeled 最近班期) — no legacy batch-departure endpoint, no fixed FX,
 * no derived USD, no flight claim (Codex 2026-07-22 P0-1/P0-3).
 *
 * Filters follow the finalized BC two-layer ruling in simplified form
 * (destination search + 天數 + 排序 always visible); result counts
 * are real pagination totals, never invented "N 個團" copy. Empty result ⇒
 * honest empty card with a real clear-filters action; a FAILED query ⇒ the
 * distinct bilingual error state, never the empty claim (P1-8).
 *
 * NO price facet and NO price sort (Codex 2026-07-22 round-2 P1-1): the
 * only server-side price the catalog can filter/sort on is the legacy
 * whole-unit tours.price with NO currency gate, while priceCurrency may be
 * TWD or USD. A USD tour priced 1800 (whole units) would numerically pass
 * an "NT$50,000 以內" threshold, and the ascending/descending price sorts
 * would rank raw numbers across currencies. Until a same-currency contract
 * on listDepartures exists, the shelf offers no price facet at all —
 * client-side per-page filtering is NOT an acceptable substitute because
 * it would misrepresent the full result set.
 */
import { useMemo, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { useDebounce } from "@/hooks/useDebounce";
import {
  toBcCardDepartureFacts,
  toBcShelfTour,
  type BcCardDepartureFacts,
} from "./bcLabels";
import BcChrome from "./BcChrome";
import BcTourCard from "./BcTourCard";
import { QueryErrorCard } from "./BcDetailSections";

const DURATION_PRESETS = [
  { labelKey: "bcPreview.tours.durationAny", min: undefined, max: undefined },
  { labelKey: "bcPreview.tours.duration1_5", min: 1, max: 5 },
  { labelKey: "bcPreview.tours.duration6_10", min: 6, max: 10 },
  { labelKey: "bcPreview.tours.duration11_15", min: 11, max: 15 },
  { labelKey: "bcPreview.tours.duration16Plus", min: 16, max: undefined },
] as const;

// Currency-safe sorts ONLY: "popular" = featured/createdAt, days_* =
// duration. The server's price sorts compare raw cross-currency whole
// units and are banned from BC (Codex 2026-07-22 round-2 P1-1).
const SORT_OPTIONS = [
  { value: "popular", labelKey: "bcPreview.tours.sortPopular" },
  { value: "days_asc", labelKey: "bcPreview.tours.sortDaysAsc" },
  { value: "days_desc", labelKey: "bcPreview.tours.sortDaysDesc" },
] as const;

export default function BcTours() {
  const { t, language } = useLocale();
  const [searchInput, setSearchInput] = useState("");
  const [durationIdx, setDurationIdx] = useState(0);
  const [sortBy, setSortBy] =
    useState<(typeof SORT_OPTIONS)[number]["value"]>("popular");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(searchInput, 300);

  const duration = DURATION_PRESETS[durationIdx];
  // NO price bounds and NO price sort are ever sent to searchCards — the
  // legacy tours.price column has no currency gate (round-2 P1-1).
  const catalogQuery = trpc.tours.searchCards.useQuery({
    destination: debouncedSearch || undefined,
    minDays: duration.min,
    maxDays: duration.max,
    sortBy,
    page,
    pageSize: 12,
    language: language as "zh-TW" | "en",
  });
  const shelfTours = useMemo(
    () => (catalogQuery.data?.tours ?? []).map(toBcShelfTour),
    [catalogQuery.data],
  );
  const pagination = catalogQuery.data?.pagination;
  // Dates + prices come ONLY from the safe storefront DTO — one
  // listDepartures query per shown tour (batched over the tRPC link).
  const departureQueries = trpc.useQueries((q) =>
    shelfTours.map((tour) =>
      q.storefront.listDepartures(
        { tourId: tour.id },
        { staleTime: 1000 * 60 * 5 },
      ),
    ),
  );
  const factsByTourId = useMemo(() => {
    const map = new Map<number, BcCardDepartureFacts>();
    shelfTours.forEach((tour, index) => {
      const query = departureQueries[index];
      map.set(
        tour.id,
        query
          ? toBcCardDepartureFacts(query)
          : ({ state: "loading" } as BcCardDepartureFacts),
      );
    });
    return map;
  }, [shelfTours, departureQueries]);

  const hasActiveFilters = searchInput !== "" || durationIdx !== 0;
  const clearFilters = () => {
    setSearchInput("");
    setDurationIdx(0);
    setPage(1);
  };
  const introImage = shelfTours.find((c) => c.heroImage)?.heroImage ?? null;

  return (
    <BcChrome>
      <div className="bc-shell">
        <section className="bc-page-intro">
          <div>
            <p className="bc-eyebrow">{t("bcPreview.tours.introEyebrow")}</p>
            <h1>{t("bcPreview.tours.introTitle")}</h1>
            <p>{t("bcPreview.tours.introCopy")}</p>
          </div>
          {introImage ? (
            <figure>
              <img src={introImage} alt="" fetchPriority="high" />
            </figure>
          ) : null}
        </section>

        <section className="bc-finder" aria-label={t("bcPreview.tours.finderLabel")}>
          <div className="bc-finder-row">
            <label className="bc-search">
              <span className="bc-eyebrow">{t("bcPreview.tours.searchLabel")}</span>
              <input
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setPage(1);
                }}
                placeholder={t("bcPreview.tours.searchPlaceholder")}
              />
            </label>
            <span className="bc-finder-count" data-tour-results-count>
              {catalogQuery.isError
                ? t("bcPreview.common.loadErrorShort")
                : pagination
                  ? t("bcPreview.tours.resultsCount", { count: pagination.total })
                  : t("common.loading")}
            </span>
          </div>
          <div className="bc-finder-row">
            <label className="bc-facet">
              <small>{t("bcPreview.tours.filterDuration")}</small>
              <select
                value={durationIdx}
                onChange={(e) => {
                  setDurationIdx(Number(e.target.value));
                  setPage(1);
                }}
              >
                {DURATION_PRESETS.map((preset, index) => (
                  <option key={preset.labelKey} value={index}>
                    {t(preset.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="bc-facet">
              <small>{t("bcPreview.tours.filterSort")}</small>
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as typeof sortBy);
                  setPage(1);
                }}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            {hasActiveFilters ? (
              <button type="button" className="bc-finder-reset" onClick={clearFilters}>
                {t("bcPreview.tours.clearFilters")}
              </button>
            ) : null}
          </div>
        </section>

        {catalogQuery.isError ? (
          <div className="bc-section-tight" data-error-state="shelf-load-failed">
            <QueryErrorCard onRetry={() => catalogQuery.refetch()} />
          </div>
        ) : catalogQuery.isLoading ? (
          <div className="bc-section-tight">
            <p>{t("common.loading")}</p>
          </div>
        ) : shelfTours.length === 0 ? (
          <div className="bc-section-tight" data-honest-state="shelf-empty">
            <div className="bc-honest" role="status">
              <b>{t("bcPreview.tours.emptyTitle")}</b>
              <span>{t("bcPreview.tours.emptyCopy")}</span>
              {hasActiveFilters ? (
                <span>
                  <button
                    type="button"
                    className="bc-btn bc-btn-ghost"
                    onClick={clearFilters}
                  >
                    {t("bcPreview.tours.clearFilters")}
                  </button>
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="bc-tour-grid">
              {shelfTours.map((tour) => (
                <BcTourCard
                  key={tour.id}
                  tour={tour}
                  facts={factsByTourId.get(tour.id) ?? { state: "loading" }}
                />
              ))}
            </div>
            {pagination && pagination.totalPages > 1 ? (
              <nav className="bc-pagination" aria-label={t("bcPreview.tours.paginationLabel")}>
                <button
                  type="button"
                  className="bc-btn bc-btn-ghost"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t("bcPreview.tours.prevPage")}
                </button>
                <span>
                  {t("bcPreview.tours.pageOf", {
                    page: pagination.page,
                    total: pagination.totalPages,
                  })}
                </span>
                <button
                  type="button"
                  className="bc-btn bc-btn-ghost"
                  disabled={!pagination.hasMore}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("bcPreview.tours.nextPage")}
                </button>
              </nav>
            ) : null}
          </>
        )}
      </div>
    </BcChrome>
  );
}
