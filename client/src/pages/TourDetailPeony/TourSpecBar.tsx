/**
 * TourDetailPeony / TourSpecBar.tsx
 *
 * "At-a-glance" fact strip for the redesigned action area
 * (feature: tour-page-redesign, Stage 1). Pure facts, no marketing copy.
 * Every chip is rendered ONLY when its data exists — missing data omits the
 * chip rather than showing a blank or a guess.
 *
 * Data derivation lives in actionArea.helpers.ts (unit-tested); this file is
 * just presentation + i18n.
 */

import React from "react";
import {
  DollarSign,
  CalendarDays,
  MapPin,
  Plane,
  Users,
  CalendarClock,
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import {
  deriveStartingUsd,
  deriveFlightInclusion,
  deriveNextDeparture,
  deriveGroupSize,
  type DepartureLike,
  type TourLike,
} from "./actionArea.helpers";
import { type getThemeColorByDestination } from "./helpers";

export type TourSpecBarProps = {
  tour: TourLike & Record<string, any>;
  departures?: DepartureLike[] | null;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
};

type Chip = { key: string; icon: React.ReactNode; label: string; value: React.ReactNode };

export default function TourSpecBar({ tour, departures, themeColor }: TourSpecBarProps) {
  const { t, language } = useLocale();
  const k = (s: string) => `tourDetail.action.specBar.${s}`;
  const iconCls = "h-4 w-4 flex-shrink-0";
  const iconStyle = { color: themeColor.secondary };

  const formatDate = (d: string | number | Date) =>
    new Date(d).toLocaleDateString(language === "en" ? "en-US" : "zh-TW");

  const chips: Chip[] = [];

  // Starting price (USD)
  const price = deriveStartingUsd(tour, departures);
  if (price) {
    chips.push({
      key: "price",
      icon: <DollarSign className={iconCls} style={iconStyle} />,
      label: t(k("fromPrice")),
      value: `${price.approx ? "≈ " : ""}US$${price.usd.toLocaleString()}`,
    });
  }

  // Duration
  if (tour?.duration) {
    chips.push({
      key: "duration",
      icon: <CalendarDays className={iconCls} style={iconStyle} />,
      label: t(k("duration")),
      value: tour?.nights
        ? t(k("daysNights"), { d: tour.duration, n: tour.nights })
        : t(k("daysOnly"), { d: tour.duration }),
    });
  }

  // Departure city
  const departFrom = tour?.departureCity || tour?.departureCountry;
  if (departFrom) {
    chips.push({
      key: "depart",
      icon: <MapPin className={iconCls} style={iconStyle} />,
      label: t(k("departFrom")),
      value: departFrom,
    });
  }

  // Flight inclusion (only when costExplanation is conclusive)
  const flight = deriveFlightInclusion(tour);
  if (flight !== "unknown") {
    chips.push({
      key: "flight",
      icon: <Plane className={iconCls} style={iconStyle} />,
      label: t(k("flight")),
      value: t(k(flight === "included" ? "flightIncluded" : "flightExcluded")),
    });
  }

  // Next departure (+ confirmed badge) — fallback "ask us" only once loaded
  const next = deriveNextDeparture(departures);

  // Small-group size
  const groupSize = deriveGroupSize(tour, next?.departure);
  if (groupSize) {
    chips.push({
      key: "group",
      icon: <Users className={iconCls} style={iconStyle} />,
      label: t(k("groupSize")),
      value: t(k("groupSizeValue"), { n: groupSize }),
    });
  }

  if (next || Array.isArray(departures)) {
    chips.push({
      key: "next",
      icon: <CalendarClock className={iconCls} style={iconStyle} />,
      label: t(k("nextDeparture")),
      value: next ? (
        <span className="inline-flex items-center gap-1.5">
          {formatDate(next.departure.departureDate)}
          {next.isConfirmed && (
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: themeColor.light, color: themeColor.accent }}
            >
              {t(k("confirmed"))}
            </span>
          )}
        </span>
      ) : (
        t(k("inquireDeparture"))
      ),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
      <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3">
        {chips.map((chip) => (
          <div key={chip.key} className="flex items-center gap-2.5 rounded-lg bg-gray-50 px-3 py-2">
            {chip.icon}
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide leading-tight text-gray-400">
                {chip.label}
              </p>
              <p className="text-sm font-semibold leading-tight text-gray-900">{chip.value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
