/**
 * TourCard — the one shared tour card for the entire public site.
 *
 * One component, three layouts (Jeff's pick, 2026-06-16):
 *   - "card":      photo-top, info-below. /tours grid + home secondary grids.
 *   - "row":       horizontal, price/availability pinned right. /search +
 *                  /destinations long lists (scan-fast, dense).
 *   - "editorial":  title over a large photo. Home featured spotlight.
 *
 * Presentational only — it does NO data fetching. The list page hands it a
 * lean `TourCardData` (id + a few display fields + a PRE-DERIVED availability
 * bucket / starting USD / flight flag, computed server-side). That is what
 * kills the old per-card N+1 (each card used to query departures + a
 * translation). Red lines: retail USD only (never agentPrice), availability is
 * a bucket only (never a seat count).
 */
import { Link } from "wouter";
import type { ReactNode } from "react";
import { Clock, Calendar, MapPin, Plane, ArrowRight, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/contexts/LocaleContext";
import { translateDestination } from "@/utils/locationMapping";
import { AvailabilityBadge } from "./AvailabilityBadge";
import { PriceTag } from "./PriceTag";
import type { TourCardData, TourCardLayout } from "./types";

export type { TourCardData, TourCardLayout } from "./types";

function formatMonthDay(value: string, language: string): string | null {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return language === "en"
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Image with a quiet brand fallback when src is missing or fails to load. */
function CardImage({
  src,
  alt,
  className,
  imgClassName,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <div className={cn("relative bg-foreground/[0.04] overflow-hidden", className)}>
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className={cn(
            "w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 rounded-xl",
            imgClassName,
          )}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageIcon className="h-10 w-10 text-foreground/20" aria-hidden />
        </div>
      )}
    </div>
  );
}

export function TourCard({
  tour,
  layout = "card",
  actionSlot,
  className,
}: {
  tour: TourCardData;
  layout?: TourCardLayout;
  /** Optional overlay (e.g. a compare toggle), positioned top-right by the card. */
  actionSlot?: ReactNode;
  className?: string;
}) {
  const { t, language } = useLocale();
  const href = `/tours/${tour.id}`;

  const destination = [
    translateDestination(tour.destinationCountry || "", language),
    tour.destinationCity && tour.destinationCity !== tour.destinationCountry
      ? translateDestination(tour.destinationCity, language)
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const durationText = tour.duration
    ? `${tour.duration} ${t("tours.days")}${tour.nights ? ` ${tour.nights} ${t("tours.nights")}` : ""}`
    : null;

  const eyebrow = [destination, durationText].filter(Boolean).join(" · ");

  const nextDay = tour.soonestDepartureDate
    ? formatMonthDay(tour.soonestDepartureDate, language)
    : null;

  const flightLabel =
    tour.flightInclusion === "included"
      ? t("tours.flightIncluded")
      : tour.flightInclusion === "excluded"
        ? t("tours.flightExcluded")
        : null;

  const featuredRibbon =
    tour.featured && tour.status !== "soldout" ? (
      <div className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-1 bg-[#c9a563] text-white text-[10px] font-semibold tracking-[0.12em] uppercase rounded-md">
        {t("tours.featuredBadgeShort")}
      </div>
    ) : null;

  // ─── Editorial (A): title over a large photo ─────────────────────────────
  if (layout === "editorial") {
    return (
      <Link
        href={href}
        className={cn(
          "group relative block aspect-[16/10] rounded-2xl overflow-hidden bg-foreground isolate",
          className,
        )}
      >
        <CardImage src={tour.heroImage} alt={tour.title} className="absolute inset-0" />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"
          aria-hidden
        />
        {featuredRibbon}
        {actionSlot && <div className="absolute top-3 right-3 z-10">{actionSlot}</div>}
        <div className="absolute inset-x-0 bottom-0 p-5 md:p-6 text-white">
          {eyebrow && (
            <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#c9a563] mb-2">
              {eyebrow}
            </div>
          )}
          <h3 className="font-serif font-bold text-xl md:text-2xl leading-snug line-clamp-2">
            {tour.title}
          </h3>
          <div className="mt-3 flex items-center justify-between gap-3">
            <PriceTag
              amountUsd={tour.startingUsd}
              approx={tour.startingApprox}
              from
              tone="onDark"
              size="md"
            />
            <AvailabilityBadge bucket={tour.availabilityBucket} />
          </div>
        </div>
      </Link>
    );
  }

  // ─── Row (C): horizontal, price/availability pinned right ─────────────────
  if (layout === "row") {
    return (
      <Link
        href={href}
        className={cn(
          "group flex rounded-xl overflow-hidden border border-foreground/10 bg-white hover:shadow-md transition-shadow",
          className,
        )}
      >
        <CardImage
          src={tour.heroImage}
          alt={tour.title}
          className="w-[34%] max-w-[260px] min-h-[140px] shrink-0"
        />
        <div className="flex-1 min-w-0 flex flex-col sm:flex-row gap-3 sm:gap-5 p-4 sm:p-5">
          <div className="flex-1 min-w-0 flex flex-col gap-1.5 justify-center">
            {eyebrow && (
              <div className="text-[11px] font-medium tracking-wide text-foreground/55">
                {eyebrow}
              </div>
            )}
            <h3 className="font-serif font-bold text-base md:text-lg leading-snug line-clamp-2 text-foreground">
              {tour.title}
            </h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/60">
              {nextDay && (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-foreground/40" />
                  {t("tours.nextShort")} {nextDay}
                </span>
              )}
              {flightLabel && (
                <span className="inline-flex items-center gap-1">
                  <Plane className="h-3.5 w-3.5 text-foreground/40" />
                  {flightLabel}
                </span>
              )}
            </div>
          </div>
          <div className="sm:w-[150px] sm:border-l sm:border-foreground/10 sm:pl-5 flex sm:flex-col items-end sm:items-start justify-between sm:justify-center gap-2 shrink-0">
            <PriceTag amountUsd={tour.startingUsd} approx={tour.startingApprox} from size="sm" />
            <div className="flex items-center gap-2">
              <AvailabilityBadge bucket={tour.availabilityBucket} />
              <ArrowRight className="h-4 w-4 text-foreground/30 group-hover:text-[#c9a563] transition-colors" />
            </div>
          </div>
        </div>
      </Link>
    );
  }

  // ─── Card (B): photo-top, info-below (default) ───────────────────────────
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col rounded-xl overflow-hidden border border-foreground/10 bg-white hover:shadow-md hover:-translate-y-0.5 transition-all",
        className,
      )}
    >
      <div className="relative">
        <CardImage src={tour.heroImage} alt={tour.title} className="aspect-[16/11]" />
        {featuredRibbon}
        {actionSlot && <div className="absolute top-3 right-3 z-10">{actionSlot}</div>}
        {durationText && (
          <div className="absolute bottom-3 left-3 inline-flex items-center gap-1 bg-white/95 text-foreground text-[11px] font-bold px-2 py-1 rounded-md backdrop-blur">
            <Clock className="h-3 w-3" />
            {durationText}
          </div>
        )}
      </div>
      <div className="flex flex-col flex-1 p-4">
        {destination && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-foreground/55 mb-1.5">
            <MapPin className="h-3 w-3 text-foreground/40 shrink-0" />
            <span className="line-clamp-1">{destination}</span>
          </div>
        )}
        <h3 className="font-serif font-bold text-[16px] md:text-[17px] leading-snug line-clamp-2 text-foreground min-h-[2.6em]">
          {tour.title}
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/60">
          {nextDay && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-foreground/40" />
              {t("tours.nextShort")} {nextDay}
            </span>
          )}
          {flightLabel && (
            <span className="inline-flex items-center gap-1">
              <Plane className="h-3.5 w-3.5 text-foreground/40" />
              {flightLabel}
            </span>
          )}
        </div>
        <div className="mt-3 pt-3 flex items-end justify-between gap-2 border-t border-foreground/10">
          <PriceTag amountUsd={tour.startingUsd} approx={tour.startingApprox} from size="sm" />
          <AvailabilityBadge bucket={tour.availabilityBucket} />
        </div>
      </div>
    </Link>
  );
}
