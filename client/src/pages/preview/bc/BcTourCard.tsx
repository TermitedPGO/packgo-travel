/**
 * Batch P1c — BC shelf/home tour card.
 *
 * Data comes ONLY from the safe surface (Codex 2026-07-22 P0-1/P0-3):
 *   - tour: the allow-listed lean fields of tours.searchCards
 *     (id/title/destination/duration/heroImage) — no legacy price fields,
 *     no derived USD, no fixed FX, no text-derived flight claim (寧缺勿假:
 *     BC cards simply carry NO flight-inclusion badge).
 *   - facts: soonest departure DATE + native-currency integer minor-unit
 *     price from storefront.listDepartures, labeled 最近班期 — never a
 *     cross-currency "from" minimum.
 * States are honest and distinct: loading, query error (資料載入失敗),
 * no departures (班期尚未開放), scheduled.
 */
import { Link } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import type { BcCardDepartureFacts, BcShelfTour } from "./bcLabels";
import { formatMinorUnits } from "./bcMoney";
import { fmtDate } from "./BcDetailSections";

export default function BcTourCard({
  tour,
  facts,
}: {
  tour: BcShelfTour;
  facts: BcCardDepartureFacts;
}) {
  const { t } = useLocale();
  const destination = [tour.destinationCountry, tour.destinationCity]
    .filter(Boolean)
    .join(" · ");
  const dateText =
    facts.state === "error"
      ? t("bcPreview.common.loadErrorShort")
      : facts.state === "loading"
        ? t("common.loading")
        : facts.state === "none"
          ? t("bcPreview.card.noDeparture")
          : fmtDate(facts.departureDate);
  const priceText =
    facts.state === "error"
      ? t("bcPreview.common.loadErrorShort")
      : facts.state === "loading"
        ? t("common.loading")
        : facts.state === "none"
          ? t("bcPreview.common.pricePending")
          : formatMinorUnits(facts.priceMinorUnits, facts.currency);
  return (
    <article className="bc-tour-card" data-tour-card data-tour-id={tour.id}>
      <Link href={`/preview/bc/tours/${tour.id}`} aria-label={tour.title}>
        <div className="bc-tour-media">
          {tour.heroImage ? (
            <img src={tour.heroImage} alt={tour.title} loading="lazy" />
          ) : (
            <span className="bc-tour-noimg">{t("bcPreview.common.noImage")}</span>
          )}
        </div>
      </Link>
      <div className="bc-tour-body">
        <div>
          {destination ? <span className="bc-tour-code">{destination}</span> : null}
          <h2 className="bc-serif">{tour.title}</h2>
        </div>
        <div className="bc-tour-facts">
          <div>
            <small>{t("bcPreview.card.duration")}</small>
            <b>
              {tour.duration
                ? t("bcPreview.common.daysCount", { count: tour.duration })
                : t("bcPreview.card.airPending")}
            </b>
          </div>
          <div>
            <small>{t("bcPreview.card.nextDate")}</small>
            <b>{dateText}</b>
          </div>
        </div>
        <div className="bc-tour-bottom">
          <div className="bc-tour-price">
            <small>{t("bcPreview.card.soonestPrice")}</small>
            <strong>{priceText}</strong>
          </div>
          <Link href={`/preview/bc/tours/${tour.id}`} className="bc-btn">
            {t("bcPreview.card.viewDetails")}
          </Link>
        </div>
      </div>
    </article>
  );
}
