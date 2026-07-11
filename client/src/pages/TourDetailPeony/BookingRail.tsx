/**
 * TourDetailPeony / BookingRail.tsx
 *
 * The "decision rail" (feature: tour-catalog-rebuild, detail page Direction 3).
 * One persistent card that answers "can I go, when, how much, what's included"
 * and points at a single next step. Sticky on desktop so it stays in view while
 * the customer scans the left column.
 *
 * Guidance rule: ONE primary action (預訂). 要報價 / 加微信 / 打電話 are the
 * lower-weight fallbacks for people not ready to book. (The old action area put
 * six equal-weight CTAs side by side — nobody knew which to press.)
 *
 * Red lines:
 *  - Price is retail only (deriveStartingUsd reads tour.price / departure
 *    adultPrice; agentPrice never reaches the client).
 *  - Availability is a bucket (有位 / 名額有限 / 已滿) — never an exact count.
 */

import React from "react";
import { CalendarClock, Plane, Ticket, MessageCircle, Phone, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { CONTACT } from "@/lib/brand";
import {
  deriveStartingUsd,
  deriveAvailability,
  deriveFlightInclusion,
  type AvailabilityBucket,
  type DepartureLike,
  type InquiryMode,
  type TourLike,
} from "./actionArea.helpers";
import { type getThemeColorByDestination } from "./helpers";

export type BookingRailProps = {
  tour: TourLike & Record<string, any>;
  departures?: DepartureLike[] | null;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  onInquire: (mode: InquiryMode) => void;
  onWeChat: () => void;
  navigate: (path: string) => void;
};

const BUCKET_LABEL: Record<AvailabilityBucket, string> = {
  available: "tours.availAvailable",
  limited: "tours.availLimited",
  soldout: "tours.availSoldout",
  unknown: "tours.availConfirm",
};

export default function BookingRail({
  tour,
  departures,
  themeColor,
  onInquire,
  onWeChat,
  navigate,
}: BookingRailProps) {
  const { t, language } = useLocale();
  const k = (s: string) => `tourDetail.action.specBar.${s}`;

  const price = deriveStartingUsd(tour, departures);
  const { next, isConfirmed, bucket } = deriveAvailability(departures);
  const flight = deriveFlightInclusion(tour);

  const formatDate = (d: string | number | Date) =>
    new Date(d).toLocaleDateString(language === "en" ? "en-US" : "zh-TW");

  // Availability colour: gold for the urgency state, muted for sold out, quiet
  // otherwise. Monochrome + single gold accent, per brand.
  const bucketStyle: Record<AvailabilityBucket, string> = {
    available: "text-gray-900",
    limited: "text-[#8a6f3a] font-semibold",
    soldout: "text-gray-400 line-through decoration-1",
    unknown: "text-gray-500",
  };

  return (
    <aside className="lg:sticky lg:top-[184px]">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        {/* Price — retail only */}
        <p className="text-[11px] uppercase tracking-wide text-gray-400">{t(k("fromPrice"))}</p>
        <p className="mt-0.5 font-serif text-3xl font-bold leading-none text-gray-900">
          {price ? `${price.approx ? "≈ " : ""}US$${price.usd.toLocaleString()}` : t("tourDetail.inquirePrice")}
        </p>
        <p className="mt-1 text-xs text-gray-500">{t("common.perPerson")}</p>

        {/* Facts: nearest departure · availability bucket · flight */}
        <dl className="mt-4 space-y-2.5 border-t border-gray-100 pt-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="inline-flex items-center gap-2 text-gray-500">
              <CalendarClock className="h-4 w-4" style={{ color: themeColor.secondary }} />
              {t(k("nextDeparture"))}
            </dt>
            <dd className="inline-flex items-center gap-1.5 font-medium text-gray-900">
              {next ? formatDate(next.departureDate) : t(k("inquireDeparture"))}
              {isConfirmed && (
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: themeColor.light, color: themeColor.accent }}
                >
                  {t(k("confirmed"))}
                </span>
              )}
            </dd>
          </div>

          <div className="flex items-center justify-between gap-3">
            <dt className="inline-flex items-center gap-2 text-gray-500">
              <Ticket className="h-4 w-4" style={{ color: themeColor.secondary }} />
              {t("tours.availLabel")}
            </dt>
            <dd className={`font-medium ${bucketStyle[bucket]}`}>{t(BUCKET_LABEL[bucket])}</dd>
          </div>

          {flight !== "unknown" && (
            <div className="flex items-center justify-between gap-3">
              <dt className="inline-flex items-center gap-2 text-gray-500">
                <Plane className="h-4 w-4" style={{ color: themeColor.secondary }} />
                {t(k("flight"))}
              </dt>
              <dd className="font-medium text-gray-900">
                {t(k(flight === "included" ? "flightIncluded" : "flightExcluded"))}
              </dd>
            </div>
          )}
        </dl>

        {/* ONE primary action — 臨時停止線 (2026-07-10): 即時結帳暫停,購買動作
            改為「提交訂位需求」走 inquiry 詢位流(我們確認團位與價格後寄付款連結),
            不再直連 /book/:id 結帳。checkout-verify 批的即時驗證上線後恢復可訂。 */}
        <Button
          onClick={() => onInquire("reserve")}
          disabled={bucket === "soldout"}
          className="mt-4 h-12 w-full rounded-lg text-base font-bold text-white disabled:opacity-50"
          style={{ backgroundColor: themeColor.primary }}
        >
          {t("tourDetail.action.cta.reserveRequest")}
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* Lower-weight fallbacks — not ready to book */}
        <div className="mt-3 flex items-center justify-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => onInquire("quote")}
            className="rounded px-2 py-1 font-medium text-gray-600 hover:text-gray-900"
          >
            {t("tourDetail.action.cta.requestQuote")}
          </button>
          <span className="text-gray-300">·</span>
          <button
            type="button"
            onClick={onWeChat}
            className="inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-gray-600 hover:text-gray-900"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {t("tourDetail.action.cta.addWeChat")}
          </button>
          <span className="text-gray-300">·</span>
          <a
            href={`tel:${CONTACT.whatsapp}`}
            className="inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-gray-600 hover:text-gray-900"
          >
            <Phone className="h-3.5 w-3.5" />
            {t("tourDetail.action.cta.callNow")}
          </a>
        </div>

        <p className="mt-3 text-center text-[11px] text-gray-400">{t("tours.availNote")}</p>
      </div>
    </aside>
  );
}
