/**
 * Batch P1c — BC home (internal preview /preview/bc).
 *
 * Faithful rebuild of the finalized BC home direction on REAL data:
 *   - Cohesive-A hero stage (2026-07-17 ruling): one color travel image,
 *     serif declaration headline, single 準備出發 entry, trade facts on
 *     the image's bottom baseline. Full-width hero image is the one
 *     rounded-corner exemption (repo red line 6).
 *   - 風景先行 photo catalog (catalog-B ruling): three color journey
 *     photos leading into the shelf.
 *
 * Data (Codex 2026-07-22 P0-1/P0-3): lead + catalog tours come from
 * tours.searchCards, consuming ONLY its lean allow-listed fields; every
 * date and price comes from safe storefront.listDepartures (native
 * currency, integer minor units, soonest departure labeled 最近班期).
 * No legacy batch-departure endpoint, no fixed FX, no derived USD, no flight
 * claim. Query errors render the distinct bilingual error state (P1-8);
 * no tours published ⇒ honest 行程整理中 state.
 */
import { useMemo } from "react";
import { Link } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import {
  toBcCardDepartureFacts,
  toBcShelfTour,
  type BcCardDepartureFacts,
} from "./bcLabels";
import { formatMinorUnits } from "./bcMoney";
import BcChrome from "./BcChrome";
import { QueryErrorCard, fmtDate } from "./BcDetailSections";

function factText(
  facts: BcCardDepartureFacts,
  t: (key: string) => string,
  kind: "date" | "price",
): string {
  switch (facts.state) {
    case "error":
      return t("bcPreview.common.loadErrorShort");
    case "loading":
      return t("common.loading");
    case "none":
      return kind === "date"
        ? t("bcPreview.card.noDeparture")
        : t("bcPreview.common.pricePending");
    case "scheduled":
      return kind === "date"
        ? fmtDate(facts.departureDate)
        : formatMinorUnits(facts.priceMinorUnits, facts.currency);
  }
}

export default function BcHome() {
  const { t, language } = useLocale();
  const catalogQuery = trpc.tours.searchCards.useQuery({
    page: 1,
    pageSize: 3,
    sortBy: "popular",
    language: language as "zh-TW" | "en",
  });
  const shelfTours = useMemo(
    () => (catalogQuery.data?.tours ?? []).map(toBcShelfTour),
    [catalogQuery.data],
  );
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

  const lead = shelfTours[0];
  const leadFacts: BcCardDepartureFacts = lead
    ? (factsByTourId.get(lead.id) ?? { state: "loading" })
    : { state: "loading" };

  return (
    <BcChrome>
      {catalogQuery.isError ? (
        <div className="bc-shell bc-section" data-error-state="home-load-failed">
          <QueryErrorCard onRetry={() => catalogQuery.refetch()} />
        </div>
      ) : catalogQuery.isLoading ? (
        <div className="bc-shell bc-section">
          <p>{t("common.loading")}</p>
        </div>
      ) : !lead ? (
        <div className="bc-shell bc-section" data-honest-state="home-empty">
          <div className="bc-honest" role="status">
            <b>{t("bcPreview.home.emptyTitle")}</b>
            <span>{t("bcPreview.home.emptyCopy")}</span>
          </div>
        </div>
      ) : (
        <>
          <section className="bc-hero">
            <figure>
              {lead.heroImage ? (
                <img src={lead.heroImage} alt={lead.title} fetchPriority="high" />
              ) : null}
              <div className="bc-hero-copy">
                <p className="bc-eyebrow">{t("bcPreview.home.heroEyebrow")}</p>
                <h1>
                  <span>{t("bcPreview.home.heroTitle1")}</span>
                  <span>{t("bcPreview.home.heroTitle2")}</span>
                </h1>
                <p className="bc-hero-lead">{t("bcPreview.home.heroLead")}</p>
                <div className="bc-hero-actions">
                  <Link href="/preview/bc/tours" className="bc-hero-cta bc-serif">
                    {t("bcPreview.home.ctaPrimary")}
                  </Link>
                </div>
                <div className="bc-hero-trip">
                  <span>
                    <small>{t("bcPreview.home.featuredTag")}</small>
                    <b>{lead.title}</b>
                  </span>
                  {lead.duration ? (
                    <span>
                      <small>{t("bcPreview.card.duration")}</small>
                      <b>{t("bcPreview.common.daysCount", { count: lead.duration })}</b>
                    </span>
                  ) : null}
                  <span>
                    <small>{t("bcPreview.card.nextDate")}</small>
                    <b>{factText(leadFacts, t, "date")}</b>
                  </span>
                  <span>
                    <small>{t("bcPreview.card.soonestPrice")}</small>
                    <b className="bc-price">{factText(leadFacts, t, "price")}</b>
                  </span>
                  <Link href={`/preview/bc/tours/${lead.id}`}>
                    {t("bcPreview.home.viewJourney")}
                  </Link>
                </div>
              </div>
            </figure>
          </section>

          <section className="bc-shell bc-section" aria-label={t("bcPreview.home.catalogTitle")}>
            <header className="bc-catalog-head">
              <div>
                <p className="bc-eyebrow">{t("bcPreview.home.catalogEyebrow")}</p>
                <h2>{t("bcPreview.home.catalogTitle")}</h2>
                <span>{t("bcPreview.home.catalogSub")}</span>
              </div>
              <Link href="/preview/bc/tours" className="bc-catalog-all">
                {t("bcPreview.home.catalogAll")}
              </Link>
            </header>
            <div className="bc-catalog-film">
              {shelfTours.map((tour, index) => {
                const facts: BcCardDepartureFacts =
                  factsByTourId.get(tour.id) ?? { state: "loading" };
                return (
                  <Link key={tour.id} href={`/preview/bc/tours/${tour.id}`}>
                    {tour.heroImage ? (
                      <img src={tour.heroImage} alt={tour.title} loading="lazy" />
                    ) : (
                      <span className="bc-tour-noimg" style={{ height: 330 }}>
                        {t("bcPreview.common.noImage")}
                      </span>
                    )}
                    <span>
                      <small>
                        {String(index + 1).padStart(2, "0")}{" "}
                        {[tour.destinationCountry, tour.destinationCity]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                      <b className="bc-serif">{tour.title}</b>
                      <em>
                        {factText(facts, t, "date")}
                        {tour.duration
                          ? `　${t("bcPreview.common.daysCount", { count: tour.duration })}`
                          : ""}
                        {facts.state === "scheduled"
                          ? `　${formatMinorUnits(facts.priceMinorUnits, facts.currency)}`
                          : ""}
                      </em>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        </>
      )}
    </BcChrome>
  );
}
