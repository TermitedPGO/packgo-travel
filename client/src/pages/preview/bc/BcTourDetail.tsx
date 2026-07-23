/**
 * Batch P1c — BC tour detail (internal preview /preview/bc/tours/:id).
 *
 * The whole point of this batch: the finalized BC detail design running on
 * the REAL public contracts — and ONLY the safe ones (Codex 2026-07-22
 * P0-2: no raw legacy tour-row endpoint anywhere in BC):
 *   - storefront.getTourSummary        → title + hero image + duration
 *                                        (active + published-ancestor gated,
 *                                        allow-listed fields only)
 *   - storefront.getItineraryContract  → 每日行程 (null ⇒ 行程內容整理中)
 *   - storefront.listDepartures        → 班期 (three buckets ONLY via
 *                                        bucketLabelKey; [] ⇒ 班期尚未開放;
 *                                        no seat numbers exist)
 *   - storefront.getFeeDisclosure      → 完整費用揭露, queried WITH the
 *                                        soonest departureDate when one
 *                                        exists (awaiting ⇒ honest
 *                                        待供應商報價, totals null, no zeros)
 *
 * Price fact = the SOONEST departure only, labeled 最近班期 — never a
 * cross-currency lowest-price comparison (Codex 2026-07-22 P1-5).
 * Every query error renders the distinct bilingual error state (P1-8).
 * Booking flow is a later batch: the only CTA is 先提交訂位需求 → /inquiry.
 */
import { useMemo } from "react";
import { Link, useRoute } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import BcChrome from "./BcChrome";
import {
  DeparturesSection,
  FeeDisclosureSection,
  ItinerarySection,
  QueryErrorCard,
  fmtDate,
  type BcDeparture,
} from "./BcDetailSections";
import { bucketLabelKey } from "./bcLabels";
import { formatMinorUnits } from "./bcMoney";

export default function BcTourDetail() {
  const { t } = useLocale();
  const [, params] = useRoute("/preview/bc/tours/:id");
  const tourId = Number(params?.id);
  const validId = Number.isInteger(tourId) && tourId > 0;

  const tourQuery = trpc.storefront.getTourSummary.useQuery(
    { tourId },
    { enabled: validId, retry: false },
  );
  const itineraryQuery = trpc.storefront.getItineraryContract.useQuery(
    { tourId },
    { enabled: validId },
  );
  const departuresQuery = trpc.storefront.listDepartures.useQuery(
    { tourId },
    { enabled: validId },
  );

  const departures: BcDeparture[] = useMemo(
    () => departuresQuery.data ?? [],
    [departuresQuery.data],
  );
  // Soonest departure (server returns them date-sorted ascending). This is
  // the ONLY departure the summary facts speak about — no cross-currency
  // minimum is ever computed.
  const soonest = departures[0] ?? null;

  // Fee disclosure is asked FOR the soonest departure date when one exists
  // (Codex 2026-07-22 P1-7): wait for the departures query to SUCCEED, then
  // pass its date so the server picks the contract valid on that departure.
  // A departures ERROR is NOT settled-with-no-departure (round-2 P1-2): the
  // fee query stays disabled — we must never fall back to querying today's
  // contract with departureDate=undefined when the real date is unknown.
  const feesQuery = trpc.storefront.getFeeDisclosure.useQuery(
    {
      tourId,
      departureDate: soonest ? new Date(soonest.departureDate) : undefined,
    },
    { enabled: validId && departuresQuery.isSuccess },
  );

  // Per-section tri-state (round-2 P1-3): error > loading > settled data.
  // 未發佈 / 班期尚未開放 / 待報價 may render ONLY after query success.
  const itineraryLoading = !itineraryQuery.isSuccess && !itineraryQuery.isError;
  const departuresLoading = !departuresQuery.isSuccess && !departuresQuery.isError;
  // The fee section inherits its dependency's failure: if departures
  // errored, the fee contract date is unknown ⇒ fees show the error /
  // unavailable state, never a possibly-wrong today-contract.
  const feesError = feesQuery.isError || departuresQuery.isError;
  // HARD dependency gate (round-3 P1-2): departures SUCCESS is a NECESSARY
  // condition for fee data to be trusted at all. Even though the fee query
  // is disabled while departures are unsettled, TanStack can still serve a
  // CACHED success for the same query key (e.g. a contract cached earlier
  // with departureDate=undefined) — feesQuery.isSuccess alone is NOT
  // settled. Until departures succeed, fees stay in the loading state and
  // no disclosure (fresh or cached) is surfaced.
  const feesSettled = departuresQuery.isSuccess && feesQuery.isSuccess;
  const feesLoading = !feesError && !feesSettled;
  // The departure fact handed to the fee section obeys the same gate: it
  // may only come from a SUCCESSFUL departures query.
  const settledSoonest = departuresQuery.isSuccess ? soonest : null;

  const tour = tourQuery.data ?? null;

  if (!validId || (tourQuery.isSuccess && tour === null)) {
    // Honest absent state: invalid id, unpublished, or inactive tour.
    return (
      <BcChrome>
        <div className="bc-shell bc-section" data-honest-state="tour-not-found">
          <div className="bc-honest" role="status">
            <b>{t("bcPreview.detail.notFoundTitle")}</b>
            <span>{t("bcPreview.detail.notFoundCopy")}</span>
            <span>
              <Link href="/preview/bc/tours" className="bc-btn bc-btn-ghost">
                {t("bcPreview.detail.backToTours")}
              </Link>
            </span>
          </div>
        </div>
      </BcChrome>
    );
  }

  if (tourQuery.isError) {
    // Distinct error state — a failed load is never presented as 找不到行程.
    return (
      <BcChrome>
        <div className="bc-shell bc-section" data-error-state="tour-load-failed">
          <QueryErrorCard onRetry={() => tourQuery.refetch()} />
        </div>
      </BcChrome>
    );
  }

  if (tourQuery.isLoading || !tour) {
    return (
      <BcChrome>
        <div className="bc-shell bc-section">
          <p>{t("common.loading")}</p>
        </div>
      </BcChrome>
    );
  }

  const destination = [tour.destinationCountry, tour.destinationCity]
    .filter(Boolean)
    .join(" · ");

  // Summary fact slots react to the departures query state individually —
  // an error shows the short bilingual error text, never 班期尚未開放.
  const factNext = departuresQuery.isError
    ? t("bcPreview.common.loadErrorShort")
    : departuresLoading
      ? t("common.loading")
      : soonest
        ? fmtDate(soonest.departureDate)
        : t("bcPreview.card.noDeparture");
  const factStatus = departuresQuery.isError
    ? t("bcPreview.common.loadErrorShort")
    : departuresLoading
      ? t("common.loading")
      : soonest
        ? t(bucketLabelKey(soonest.bucket))
        : t("bcPreview.card.noDeparture");
  const factPrice = departuresQuery.isError
    ? t("bcPreview.common.loadErrorShort")
    : departuresLoading
      ? t("common.loading")
      : soonest
        ? formatMinorUnits(soonest.pricePerPersonMinorUnits, soonest.currency)
        : t("bcPreview.common.pricePending");

  return (
    <BcChrome>
      <div className="bc-shell">
        {tour.heroImage ? (
          <div className="bc-detail-hero">
            <img src={tour.heroImage} alt={tour.title} fetchPriority="high" />
          </div>
        ) : null}
        <section className="bc-detail-summary" data-tour-id={tourId}>
          <div>
            {destination ? <span className="bc-tour-code">{destination}</span> : null}
            <h1 className="bc-serif">{tour.title}</h1>
            <div className="bc-summary-meta">
              {tour.duration ? (
                <span>
                  {t("bcPreview.detail.factDuration")}{" "}
                  {t("bcPreview.common.daysCount", { count: tour.duration })}
                </span>
              ) : null}
            </div>
          </div>
          <div className="bc-summary-facts">
            <div>
              <small>{t("bcPreview.detail.factNext")}</small>
              <b>{factNext}</b>
            </div>
            <div>
              <small>{t("bcPreview.detail.factStatus")}</small>
              <b>{factStatus}</b>
            </div>
            <div>
              <small>{t("bcPreview.card.soonestPrice")}</small>
              <b className="bc-price">{factPrice}</b>
            </div>
          </div>
        </section>
        <div className="bc-detail-actions">
          <Link href="/inquiry" className="bc-btn">
            {t("bcPreview.detail.ctaInquiry")}
          </Link>
          <a href="#bc-dates" className="bc-btn bc-btn-ghost">
            {t("bcPreview.detail.viewDates")}
          </a>
          <p className="bc-inquiry-note">{t("bcPreview.detail.ctaInquiryNote")}</p>
        </div>
      </div>

      <ItinerarySection
        contract={itineraryQuery.isSuccess ? (itineraryQuery.data ?? null) : null}
        queryLoading={itineraryLoading}
        queryError={itineraryQuery.isError}
        onRetry={() => itineraryQuery.refetch()}
      />
      <DeparturesSection
        departures={departures}
        queryLoading={departuresLoading}
        queryError={departuresQuery.isError}
        onRetry={() => departuresQuery.refetch()}
      />
      <FeeDisclosureSection
        disclosure={feesSettled ? (feesQuery.data ?? null) : null}
        departure={settledSoonest}
        queryLoading={feesLoading}
        queryError={feesError}
        onRetry={() =>
          departuresQuery.isError ? departuresQuery.refetch() : feesQuery.refetch()
        }
      />

      <div className="bc-shell bc-section-tight">
        <div className="bc-detail-actions">
          <Link href="/inquiry" className="bc-btn">
            {t("bcPreview.detail.ctaInquiry")}
          </Link>
          <p className="bc-inquiry-note">{t("bcPreview.detail.ctaInquiryNote")}</p>
        </div>
      </div>
    </BcChrome>
  );
}
