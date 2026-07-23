/**
 * Batch P1c — pure presentational sections for the BC tour detail page.
 *
 * These components take ALREADY-FETCHED P1a public DTOs as props (no tRPC
 * hooks here) so honest-state rendering is directly unit-testable:
 *   - ItinerarySection(null)                → 行程內容整理中 尚未發佈
 *   - FeeDisclosureSection(awaiting shape)  → 完整費用待供應商報價, no numbers
 *   - DeparturesSection([])                 → 班期尚未開放
 *   - queryError on any section             → 資料載入失敗 (Codex 2026-07-22
 *     P1-8: an API error is NEVER dressed up as an honest absent state)
 *
 * Money: amounts stay integer minor units in props/state; formatting
 * happens only at render via bcMoney. Availability: EVERY visible
 * availability path resolves through bucketLabelKey(dep.bucket) — unknown
 * buckets throw (Codex 2026-07-22 P1-2); never a seat count.
 *
 * Fee semantics (Codex 2026-07-22 P1-7 + round-2 P1-2 + round-3 P1-1):
 * every fee line renders its own includedInPackgoCharge / requiredForTrip /
 * unit / sourceStatus, and the MONEY MATH keys off those three flags
 * JOINTLY — category (mandatory/tips/self/optional) is display grouping
 * only. Category TITLES and NOTES are purely descriptive groupings (機票與
 * 稅費 / 小費與服務費 / 餐食與旅途開銷 / 其他項目) that make NO necessity or
 * inclusion claim; ALL truth claims live in the per-row badges (必要/可選,
 * 已含在團費/付給…, 每人/每次訂購, sourceStatus) and in flag-derived header
 * amounts and known-total notes:
 *   - includedInPackgoCharge=true  → 已含在團費不另收. NEVER in any
 *     separate-payment subtotal, NEVER in the per-booking reminder.
 *   - requiredForTrip=false        → optional-style: listed + labeled 可選,
 *     excluded from every total, no reminder (schema: only
 *     requiredForTrip=true means the trip cannot proceed without paying).
 *   - not-included + required + per_person   → the separate-payment
 *     per-person subtotal and the known total.
 *   - not-included + required + per_booking  → listed with amounts under an
 *     explicit per-booking heading; known-total footnote appears ONLY when
 *     such rows exist.
 *
 * Loading is a FIRST-CLASS state (round-2 P1-3): every section takes
 * queryLoading and renders a data-loading-state block while its query is in
 * flight. 未發佈 / 班期尚未開放 / 待報價 may appear ONLY after query
 * success. Precedence per section: error > loading > absent/populated —
 * the three states are mutually exclusive.
 *
 * Stable QA data attributes preserved from the prototype:
 *   data-fee-contract-id / data-fee-id / data-payee-type /
 *   data-payment-timing / data-itinerary-id / data-day-id / data-stop-id /
 *   data-departure-id / data-bucket.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import type { RouterOutputs } from "@/lib/trpc";
import { addMinorUnits, formatMinorUnits } from "./bcMoney";
import {
  FEE_CATEGORY_ORDER,
  bucketLabelKey,
  feeCategoryNoteKey,
  feeCategoryTitleKey,
  feeUnitLabelKey,
  mealStatusLabelKey,
  movementStatusLabelKey,
  payeeLabelKey,
  sourceStatusLabelKey,
  stayLabel,
  timingLabelKey,
} from "./bcLabels";

export type BcItineraryContract = RouterOutputs["storefront"]["getItineraryContract"];
export type BcFeeDisclosure = RouterOutputs["storefront"]["getFeeDisclosure"];
export type BcDeparture = RouterOutputs["storefront"]["listDepartures"][number];

/**
 * YYYY.MM.DD — timezone-INDEPENDENT date-only formatting (Codex 2026-07-22
 * P1-6). Departure/return dates are date-only facts; local getters would
 * show the previous day in any timezone west of UTC. ISO strings are read
 * by their literal date part; Date objects use UTC getters.
 */
export function fmtDate(d: Date | string): string {
  if (typeof d === "string") {
    const match = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}.${match[2]}.${match[3]}`;
    d = new Date(d);
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function HonestCard({ titleKey, copyKey }: { titleKey: string; copyKey: string }) {
  const { t } = useLocale();
  return (
    <div className="bc-honest" role="status">
      <b>{t(titleKey)}</b>
      <span>{t(copyKey)}</span>
    </div>
  );
}

/**
 * Distinct bilingual query-error state (Codex 2026-07-22 P1-8). A failed
 * query must NEVER render as 未發佈 / 空班期 / 待報價 — those are honest
 * absent-data claims; this is an explicit "we could not load" state.
 */
export function QueryErrorCard({ onRetry }: { onRetry?: () => void }) {
  const { t } = useLocale();
  return (
    <div className="bc-honest bc-query-error" role="alert" data-error-state="query-error">
      <b>{t("bcPreview.common.loadErrorTitle")}</b>
      <span>{t("bcPreview.common.loadErrorCopy")}</span>
      {onRetry ? (
        <span>
          <button type="button" className="bc-btn bc-btn-ghost" onClick={onRetry}>
            {t("bcPreview.common.retry")}
          </button>
        </span>
      ) : null}
    </div>
  );
}

/* ── Itinerary ───────────────────────────────────────────────────────── */

export function ItinerarySection({
  contract,
  queryLoading = false,
  queryError = false,
  onRetry,
}: {
  contract: BcItineraryContract;
  /** True while the itinerary query is IN FLIGHT — renders the loading state, never 尚未發佈. */
  queryLoading?: boolean;
  /** True when the itinerary query FAILED — renders the error state, never 尚未發佈. */
  queryError?: boolean;
  onRetry?: () => void;
}) {
  const { t, language } = useLocale();
  const [selectedDay, setSelectedDay] = useState(1);

  if (queryError) {
    return (
      <section className="bc-shell bc-detail-section" data-error-state="itinerary-load-failed">
        <header>
          <p className="bc-eyebrow">{t("bcPreview.itinerary.eyebrow")}</p>
          <h2>{t("bcPreview.itinerary.title")}</h2>
        </header>
        <QueryErrorCard onRetry={onRetry} />
      </section>
    );
  }

  if (queryLoading) {
    // Loading is a FIRST-CLASS state (round-2 P1-3): while the query is in
    // flight the section says so — 尚未發佈 may only follow query success.
    return (
      <section className="bc-shell bc-detail-section" data-loading-state="itinerary-loading">
        <header>
          <p className="bc-eyebrow">{t("bcPreview.itinerary.eyebrow")}</p>
          <h2>{t("bcPreview.itinerary.title")}</h2>
        </header>
        <p role="status">{t("common.loading")}</p>
      </section>
    );
  }

  if (!contract || contract.days.length === 0) {
    return (
      <section className="bc-shell bc-detail-section" data-honest-state="itinerary-unpublished">
        <header>
          <p className="bc-eyebrow">{t("bcPreview.itinerary.eyebrow")}</p>
          <h2>{t("bcPreview.itinerary.title")}</h2>
        </header>
        <HonestCard
          titleKey="bcPreview.itinerary.pendingTitle"
          copyKey="bcPreview.itinerary.pendingCopy"
        />
      </section>
    );
  }

  const day =
    contract.days.find((d) => d.dayNumber === selectedDay) ?? contract.days[0];
  const cityName = (d: typeof day) =>
    language === "en" ? d.cityEn || d.city || "" : d.city || d.cityEn || "";
  const stay = stayLabel(day.stay);
  const meals: Array<[string, string]> = [
    ["bcPreview.itinerary.breakfast", day.meals.breakfast],
    ["bcPreview.itinerary.lunch", day.meals.lunch],
    ["bcPreview.itinerary.dinner", day.meals.dinner],
  ];

  return (
    <section
      className="bc-shell bc-detail-section"
      data-itinerary-id={contract.itineraryId}
      data-itinerary-version={contract.versionNumber}
      data-source-status={contract.sourceStatus}
    >
      <header>
        <p className="bc-eyebrow">{t("bcPreview.itinerary.eyebrow")}</p>
        <h2>{t("bcPreview.itinerary.title")}</h2>
        <span className="bc-source-tag">{t(sourceStatusLabelKey(contract.sourceStatus))}</span>
      </header>
      <nav className="bc-day-rail" aria-label={t("bcPreview.itinerary.dayRail")}>
        {contract.days.map((d) => (
          <button
            key={d.dayId}
            type="button"
            className={d.dayNumber === day.dayNumber ? "is-active" : ""}
            aria-pressed={d.dayNumber === day.dayNumber}
            data-day-id={d.dayId}
            onClick={() => setSelectedDay(d.dayNumber)}
          >
            <small>D{String(d.dayNumber).padStart(2, "0")}</small>
            <b>{cityName(d) || t("bcPreview.itinerary.cityPending")}</b>
          </button>
        ))}
      </nav>
      <article className="bc-day-story" data-day-id={day.dayId} aria-live="polite">
        <div>
          <p className="bc-eyebrow">
            DAY {String(day.dayNumber).padStart(2, "0")}
          </p>
          <h3>{cityName(day) || t("bcPreview.itinerary.cityPending")}</h3>
          {day.summary ? <p className="bc-day-summary">{day.summary}</p> : null}
          {day.stops.length > 0 ? (
            <>
              <p className="bc-eyebrow">{t("bcPreview.itinerary.stops")}</p>
              <ul className="bc-day-stops">
                {day.stops.map((stop, index) => (
                  <li key={stop.stopId} data-stop-id={stop.stopId}>
                    <span className="bc-stop-no">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <b>{language === "en" ? stop.nameEn || stop.name : stop.name}</b>
                      {stop.summary ? <small> {stop.summary}</small> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="bc-day-summary">{t("bcPreview.itinerary.stopsPending")}</p>
          )}
        </div>
        <div className="bc-day-answers">
          <div>
            <p className="bc-eyebrow">{t("bcPreview.itinerary.mealsTitle")}</p>
            <dl className="bc-meal-grid">
              {meals.map(([labelKey, status]) => (
                <div key={labelKey} data-service-status={status}>
                  <dt>{t(labelKey)}</dt>
                  <dd
                    className={
                      status === "included" || status === "included_unconfirmed"
                        ? "is-included"
                        : ""
                    }
                  >
                    {t(mealStatusLabelKey(status))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="bc-stay-answer">
            <p className="bc-eyebrow">{t("bcPreview.itinerary.stayTitle")}</p>
            <b>{t(stay.key, stay.params)}</b>
            {day.stay.propertyStatus === "proposed_or_equivalent" ? (
              <span>{t("bcPreview.itinerary.stay.equivalentNote")}</span>
            ) : null}
          </div>
          <div className="bc-movement-line">
            <small>{t("bcPreview.itinerary.movementTitle")}</small>
            {day.movement.durationMinutes !== null ? (
              <>
                <b>
                  {t("bcPreview.itinerary.movementMinutes", {
                    count: day.movement.durationMinutes,
                  })}
                </b>
                <span className="bc-source-tag">
                  {t(movementStatusLabelKey(day.movement.status))}
                </span>
              </>
            ) : (
              <b>{t("bcPreview.itinerary.movement.pending")}</b>
            )}
          </div>
        </div>
      </article>
    </section>
  );
}

/* ── Departures (three buckets only — never a number) ────────────────── */

export function DeparturesSection({
  departures,
  queryLoading = false,
  queryError = false,
  onRetry,
}: {
  departures: BcDeparture[];
  /** True while the departures query is IN FLIGHT — renders the loading state, never 空班期. */
  queryLoading?: boolean;
  /** True when the departures query FAILED — renders the error state, never 空班期. */
  queryError?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useLocale();
  return (
    <section className="bc-shell bc-detail-section" id="bc-dates">
      <header>
        <p className="bc-eyebrow">{t("bcPreview.departures.eyebrow")}</p>
        <h2>{t("bcPreview.departures.title")}</h2>
      </header>
      {queryError ? (
        <div data-error-state="departures-load-failed">
          <QueryErrorCard onRetry={onRetry} />
        </div>
      ) : queryLoading ? (
        <div data-loading-state="departures-loading">
          <p role="status">{t("common.loading")}</p>
        </div>
      ) : departures.length === 0 ? (
        <div data-honest-state="departures-empty">
          <HonestCard
            titleKey="bcPreview.departures.emptyTitle"
            copyKey="bcPreview.departures.emptyCopy"
          />
        </div>
      ) : (
        <div className="bc-departures" role="table">
          <div className="bc-departure-row bc-departure-head" role="row">
            <span>{t("bcPreview.departures.thDates")}</span>
            <span>{t("bcPreview.departures.thStatus")}</span>
            <span>{t("bcPreview.departures.thPrice")}</span>
            <span aria-hidden="true" />
          </div>
          {departures.map((dep) => (
            <div
              key={dep.id}
              className="bc-departure-row"
              role="row"
              data-departure-id={dep.id}
              data-bucket={dep.bucket}
            >
              <span>
                <small>{t("bcPreview.departures.thDates")}</small>
                <span className="bc-departure-dates">
                  {fmtDate(dep.departureDate)} – {fmtDate(dep.returnDate)}
                </span>
              </span>
              <span className="bc-departure-bucket" data-bucket={dep.bucket}>
                {t(bucketLabelKey(dep.bucket))}
              </span>
              <span>
                <small>{t("bcPreview.departures.thPrice")}</small>
                <span className="bc-departure-price">
                  {formatMinorUnits(dep.pricePerPersonMinorUnits, dep.currency)}
                </span>
              </span>
              <Link href="/inquiry" className="bc-btn bc-btn-ghost">
                {t("bcPreview.detail.ctaInquiry")}
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Fee disclosure (BC 完整費用揭露) ────────────────────────────────── */

/**
 * Per-category client-side sums over the fee LINES (Codex 2026-07-22 P1-7,
 * completed per round-2 P1-2 and round-3 P1-1): includedInPackgoCharge +
 * requiredForTrip + unit decide the money math JOINTLY; category is display
 * grouping only.
 *   - separateRequiredPerPersonMinorUnits: ONLY lines with
 *     includedInPackgoCharge=false AND requiredForTrip=true AND
 *     unit=per_person AND (when a summing currency is given) the SAME
 *     currency. This is the number a category header may claim as 另外支付
 *     and the only per-person money that can enter the known total. An
 *     included line is never re-added; an optional (requiredForTrip=false)
 *     line is never counted anywhere; a cross-currency amount is never
 *     added into a sum of another currency.
 *   - perBooking: EVERY per_booking line, for display under the explicit
 *     per-booking heading (never folded into a per-person figure).
 *   - requiredPerBooking: the ACCOUNTING subset of perBooking —
 *     includedInPackgoCharge=false AND requiredForTrip=true. Only these
 *     trigger the known-total per-booking reminder; an included required
 *     per-booking fee must NEVER read as 另有必要費用未計入 (round-2
 *     counterexample a).
 *   - crossCurrencyRequired: separately-required per-person lines whose
 *     currency differs from the summing currency — listed with their own
 *     currency, excluded from every sum, surfaced by the known-total
 *     cross-currency note.
 *   - allIncludedInCharge / allOptional (round-3 P1-1): whole-category
 *     claims may only be made when EVERY line supports them. A single
 *     included line must never make a mixed category read 已含在團費.
 *   - hasExcludedOptional: whether any not-included optional line exists —
 *     drives the known-total 另付之可選項目未計入 note, rendered ONLY when
 *     such rows were actually excluded.
 *   - hasSeparatePerPersonLine (round-4 P1-1 item 1): whether ANY
 *     not-included per-person line exists in the category — optional and
 *     zero-amount lines included. The perBookingOnly header wording is a
 *     whole-category claim ("separate charges are per booking only") and may
 *     ONLY render when this is false; any not-included per-person row forces
 *     the neutral seeLines pointer instead.
 *   - CONTRADICTORY UPSTREAM FLAGS → NO CLAIM, NO SUM (round-4 P1-1 item 5,
 *     honest floor): requiredForTrip=true means the trip cannot proceed
 *     without paying, but paymentTiming=if_selected means the fee exists
 *     only after an opt-in — both cannot be true of one row. Such a row
 *     cannot be trusted as required money, so it is excluded from EVERY
 *     required accounting bucket here (per-person sum, requiredPerBooking
 *     reminder, crossCurrencyRequired note) and FeeLine renders a neutral
 *     收費條件待確認 badge instead of 必要 + a timing claim. The row is
 *     still LISTED with its amount — money is shown, but never claimed
 *     necessary and never summed. The math and the copy make the SAME
 *     no-claim statement.
 */
export function hasContradictoryRequiredFlags(fee: BcPublishedFee): boolean {
  return fee.requiredForTrip && fee.paymentTiming === "if_selected";
}

export function splitCategoryFees(
  items: BcPublishedFee[],
  summingCurrency?: string,
): {
  separateRequiredPerPersonMinorUnits: number;
  perBooking: BcPublishedFee[];
  requiredPerBooking: BcPublishedFee[];
  crossCurrencyRequired: BcPublishedFee[];
  allIncludedInCharge: boolean;
  allOptional: boolean;
  hasExcludedOptional: boolean;
  hasSeparatePerPersonLine: boolean;
} {
  let separate = 0;
  const perBooking: BcPublishedFee[] = [];
  const requiredPerBooking: BcPublishedFee[] = [];
  const crossCurrencyRequired: BcPublishedFee[] = [];
  let includedCount = 0;
  let excludedOptionalCount = 0;
  let hasSeparatePerPersonLine = false;
  for (const fee of items) {
    if (fee.includedInPackgoCharge) includedCount += 1;
    // Contradictory upstream flags → no claim, no sum (honest floor): a
    // required-yet-if-selected row is NEVER trusted as required money.
    const separatelyRequired =
      !fee.includedInPackgoCharge &&
      fee.requiredForTrip &&
      !hasContradictoryRequiredFlags(fee);
    if (!fee.includedInPackgoCharge && !fee.requiredForTrip) excludedOptionalCount += 1;
    if (!fee.includedInPackgoCharge && fee.unit !== "per_booking") {
      hasSeparatePerPersonLine = true;
    }
    if (fee.unit === "per_booking") {
      perBooking.push(fee);
      if (separatelyRequired) requiredPerBooking.push(fee);
      continue;
    }
    if (separatelyRequired) {
      if (summingCurrency !== undefined && fee.currency !== summingCurrency) {
        // NEVER added across currencies (Codex 2026-07-22 P1-5) — listed
        // with its own currency and flagged by the known-total note.
        crossCurrencyRequired.push(fee);
      } else {
        separate = addMinorUnits(separate, fee.amountMinorUnits);
      }
    }
  }
  return {
    separateRequiredPerPersonMinorUnits: separate,
    perBooking,
    requiredPerBooking,
    crossCurrencyRequired,
    allIncludedInCharge: items.length > 0 && includedCount === items.length,
    allOptional: items.length > 0 && excludedOptionalCount === items.length,
    hasExcludedOptional: excludedOptionalCount > 0,
    hasSeparatePerPersonLine,
  };
}

type BcPublishedFee = NonNullable<
  BcFeeDisclosure["feesByCategory"]
>["mandatory"][number];

function FeeLine({ fee }: { fee: BcPublishedFee }) {
  const { t, language } = useLocale();
  // Contradictory upstream flags → no claim, no sum (round-4 P1-1 item 5,
  // honest floor): requiredForTrip=true + paymentTiming=if_selected cannot
  // both be true of one row, so the row makes NEITHER claim — the necessity
  // badge (必要/可選) and the timing claim (選擇後才確認與支付) are both
  // suppressed in favor of one neutral 收費條件待確認 badge. splitCategoryFees
  // makes the matching math statement by excluding the row from every
  // required sum, so the page never counts money it declines to claim.
  const flagsContradictory = hasContradictoryRequiredFlags(fee);
  return (
    <li
      data-fee-id={fee.feeId}
      data-payee-type={fee.payeeType}
      data-payment-timing={fee.paymentTiming}
      data-fee-unit={fee.unit}
      data-included-in-charge={fee.includedInPackgoCharge ? "true" : "false"}
      data-required-for-trip={fee.requiredForTrip ? "true" : "false"}
      data-flag-conflict={flagsContradictory ? "true" : "false"}
      data-fee-source-status={fee.sourceStatus}
    >
      <span>
        <b>{language === "en" ? fee.labelEn : fee.labelZh}</b>
        <small>
          {t(feeUnitLabelKey(fee.unit))}{" "}
          {formatMinorUnits(fee.amountMinorUnits, fee.currency)} ·{" "}
          {fee.includedInPackgoCharge
            ? t("bcPreview.fees.includedInCharge")
            : flagsContradictory
              ? `${t("bcPreview.fees.payTo")} ${t(payeeLabelKey(fee.payeeType))}`
              : `${t("bcPreview.fees.payTo")} ${t(payeeLabelKey(fee.payeeType))} · ${t(
                  timingLabelKey(fee.paymentTiming),
                )}`}{" "}
          ·{" "}
          {flagsContradictory
            ? t("bcPreview.fees.termsPending")
            : t(
                fee.requiredForTrip
                  ? "bcPreview.fees.required"
                  : "bcPreview.fees.optionalChoice",
              )}
        </small>
        <small className="bc-source-tag">{t(sourceStatusLabelKey(fee.sourceStatus))}</small>
      </span>
      <strong>{formatMinorUnits(fee.amountMinorUnits, fee.currency)}</strong>
    </li>
  );
}

export function FeeDisclosureSection({
  disclosure,
  departure,
  queryLoading = false,
  queryError = false,
  onRetry,
}: {
  disclosure: BcFeeDisclosure | null;
  /** Soonest departure — supplies the 團費 pay-now row when available. */
  departure: BcDeparture | null;
  /** True while the fee query (or its departure dependency) is IN FLIGHT — renders the loading state, never 待報價. */
  queryLoading?: boolean;
  /** True when the fee query (or its departure dependency) FAILED — renders the error state, never 待報價. */
  queryError?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useLocale();

  if (queryError) {
    return (
      <section className="bc-shell bc-detail-section" id="bc-cost" data-error-state="fees-load-failed">
        <header>
          <p className="bc-eyebrow">{t("bcPreview.fees.eyebrow")}</p>
          <h2>{t("bcPreview.fees.title")}</h2>
        </header>
        <QueryErrorCard onRetry={onRetry} />
      </section>
    );
  }

  if (queryLoading) {
    // Loading is a FIRST-CLASS state (round-2 P1-3): 待報價 may only
    // follow a SUCCESSFUL fee query — never a query still in flight.
    return (
      <section className="bc-shell bc-detail-section" id="bc-cost" data-loading-state="fees-loading">
        <header>
          <p className="bc-eyebrow">{t("bcPreview.fees.eyebrow")}</p>
          <h2>{t("bcPreview.fees.title")}</h2>
        </header>
        <p role="status">{t("common.loading")}</p>
      </section>
    );
  }

  // No data, no error, not loading ⇒ nothing to claim — render nothing
  // rather than guessing a state.
  if (!disclosure) return null;

  if (disclosure.status !== "published" || disclosure.totals === null) {
    return (
      <section className="bc-shell bc-detail-section" id="bc-cost" data-honest-state="fees-awaiting">
        <header>
          <p className="bc-eyebrow">{t("bcPreview.fees.eyebrow")}</p>
          <h2>{t("bcPreview.fees.title")}</h2>
        </header>
        <HonestCard
          titleKey="bcPreview.fees.awaitingTitle"
          copyKey="bcPreview.fees.awaitingCopy"
        />
      </section>
    );
  }

  const feeCurrency = disclosure.totals.mandatoryPerPerson.currency;

  // Per-category line-level splits (never double-counting a line that is
  // already inside the PACK&GO charge; per_booking never folded per-person;
  // cross-currency amounts never added into the fee-currency sums).
  const splits = Object.fromEntries(
    FEE_CATEGORY_ORDER.map((category) => [
      category,
      splitCategoryFees(disclosure.feesByCategory[category] ?? [], feeCurrency),
    ]),
  ) as Record<(typeof FEE_CATEGORY_ORDER)[number], ReturnType<typeof splitCategoryFees>>;

  // Required NON-INCLUDED per_booking lines across categories — surfaced
  // explicitly, and explicitly EXCLUDED from the per-person known total.
  // A fee already included in the PACK&GO charge never appears here, so it
  // can never trigger the 另有必要 per-booking 未計入 reminder (round-2
  // counterexample a).
  const requiredPerBooking = FEE_CATEGORY_ORDER.flatMap(
    (category) => splits[category].requiredPerBooking,
  );
  // Known-total exclusion notes are DYNAMIC (round-3 P1-1): each renders
  // ONLY when rows of that kind actually exist and were actually excluded
  // from the sum — the copy can never claim an exclusion that didn't happen.
  const hasExcludedOptional = FEE_CATEGORY_ORDER.some(
    (category) => splits[category].hasExcludedOptional,
  );
  const crossCurrencyRequired = FEE_CATEGORY_ORDER.flatMap(
    (category) => splits[category].crossCurrencyRequired,
  );
  // Page-level basis claim is DYNAMIC (round-4 P1-1 item 2): 金額以每人計 is
  // a whole-page claim, so the moment ANY per-booking line renders anywhere
  // on the page (included or not, required or not), the header must switch
  // to the mixed-basis wording that names the per-booking exception instead
  // of claiming all amounts are per person.
  const hasPerBookingLine = FEE_CATEGORY_ORDER.some(
    (category) => splits[category].perBooking.length > 0,
  );

  // Known per-person trip total = departure price + every SEPARATELY-PAID
  // REQUIRED per-person sum across ALL categories — the flags decide, not
  // the category (round-2 counterexamples b/c: a mandatory-category
  // optional line stays out; an optional-category required line goes in).
  // Only computed when a real departure price exists in the SAME currency —
  // cross-currency addition is forbidden, so we honestly omit the line.
  // Optional (requiredForTrip=false), included, and per_booking lines are
  // never inside this number.
  let knownTotalMinorUnits: number | null = null;
  if (departure && departure.currency === feeCurrency) {
    knownTotalMinorUnits = FEE_CATEGORY_ORDER.reduce(
      (sum, category) =>
        addMinorUnits(sum, splits[category].separateRequiredPerPersonMinorUnits),
      departure.pricePerPersonMinorUnits,
    );
  }

  return (
    <section
      className="bc-shell bc-detail-section"
      id="bc-cost"
      aria-label={t("bcPreview.fees.ariaLabel")}
      data-fee-contract-id={disclosure.contractId ?? ""}
      data-source-status={disclosure.sourceStatus ?? ""}
    >
      <div className="bc-fee-disclosure">
        <header className="bc-fee-head">
          <div>
            <p className="bc-eyebrow">{t("bcPreview.fees.eyebrow")}</p>
            <h2>{t("bcPreview.fees.title")}</h2>
            <small>
              {disclosure.displayRegion
                ? `${t("bcPreview.fees.region")} ${disclosure.displayRegion} · `
                : ""}
              {t(sourceStatusLabelKey(disclosure.sourceStatus))}
            </small>
          </div>
          <span className="bc-source-tag">
            {t(
              hasPerBookingLine
                ? "bcPreview.fees.mixedBasis"
                : "bcPreview.fees.perPersonBasis",
            )}
          </span>
        </header>

        {departure ? (
          <div className="bc-fee-pay-now" data-departure-id={departure.id}>
            <span>
              <small>{t("bcPreview.fees.payNowTag")}</small>
              <b>{t("bcPreview.fees.payNowLabel")}</b>
            </span>
            <strong>
              {formatMinorUnits(departure.pricePerPersonMinorUnits, departure.currency)}
            </strong>
          </div>
        ) : null}

        {FEE_CATEGORY_ORDER.map((category) => {
          const items = disclosure.feesByCategory[category];
          if (!items || items.length === 0) return null;
          const split = splits[category];
          const perPersonLines = items.filter((fee) => fee.unit !== "per_booking");
          // The header claim is FLAG-driven, category-independent, and may
          // only make a whole-category claim EVERY line supports (round-3
          // P1-1):
          //   - a required cross-currency line exists → no single number or
          //     whole-category claim is true → neutral 詳見逐筆標示;
          //   - a positive separately-required per-person sum is the only
          //     amount a header may claim;
          //   - required per-booking lines are pointed at with the
          //     perBookingOnly wording ONLY when the category has NO
          //     not-included per-person line at all (round-4 P1-1 item 1) —
          //     "另付項目僅每次訂購計費" is a whole-category claim, and one
          //     not-included per-person row (even an optional or zero-amount
          //     one) falsifies it → neutral 詳見逐筆標示 instead;
          //   - 已含在團費 only when ALL lines are included — one included
          //     line in a mixed category must never speak for the others;
          //   - 未計入 only when ALL lines are excluded optionals;
          //   - any other mix → neutral 詳見逐筆標示 (rows carry the truth).
          const headerAmount =
            split.crossCurrencyRequired.length > 0
              ? t("bcPreview.fees.seeLines")
              : split.separateRequiredPerPersonMinorUnits > 0
                ? formatMinorUnits(split.separateRequiredPerPersonMinorUnits, feeCurrency)
                : split.requiredPerBooking.length > 0
                  ? split.hasSeparatePerPersonLine
                    ? t("bcPreview.fees.seeLines")
                    : t("bcPreview.fees.perBookingOnly")
                  : split.allIncludedInCharge
                    ? t("bcPreview.fees.includedInCharge")
                    : split.allOptional
                      ? t("bcPreview.fees.notIncluded")
                      : t("bcPreview.fees.seeLines");
          return (
            <section
              key={category}
              className={`bc-fee-category bc-fee-${category}`}
            >
              <header>
                <div>
                  <h3>{t(feeCategoryTitleKey(category))}</h3>
                  <p>{t(feeCategoryNoteKey(category))}</p>
                </div>
                <strong>{headerAmount}</strong>
              </header>
              <ul>
                {perPersonLines.map((fee) => (
                  <FeeLine key={fee.feeId} fee={fee} />
                ))}
              </ul>
              {split.perBooking.length > 0 ? (
                <>
                  <p className="bc-fee-per-booking-note">
                    {t("bcPreview.fees.perBookingHeading")}
                  </p>
                  <ul>
                    {split.perBooking.map((fee) => (
                      <FeeLine key={fee.feeId} fee={fee} />
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          );
        })}

        {knownTotalMinorUnits !== null ? (
          <div className="bc-fee-known-total">
            <span>
              <small>{t("bcPreview.fees.knownTotalTag")}</small>
              <b>{t("bcPreview.fees.knownTotalLabel")}</b>
              {requiredPerBooking.length > 0 ? (
                <small>{t("bcPreview.fees.knownTotalExcludesPerBooking")}</small>
              ) : null}
              {hasExcludedOptional ? (
                <small>{t("bcPreview.fees.knownTotalExcludesOptional")}</small>
              ) : null}
              {crossCurrencyRequired.length > 0 ? (
                <small>{t("bcPreview.fees.knownTotalExcludesCrossCurrency")}</small>
              ) : null}
            </span>
            <strong>{formatMinorUnits(knownTotalMinorUnits, feeCurrency)}</strong>
          </div>
        ) : null}

        <p className="bc-fee-note">{t("bcPreview.fees.note")}</p>
      </div>
    </section>
  );
}
