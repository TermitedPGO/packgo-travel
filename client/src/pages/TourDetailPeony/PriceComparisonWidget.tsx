/**
 * TourDetailPeony / PriceComparisonWidget.tsx
 *
 * Price Comparison Widget — shows breakdown of self-book vs package price
 * with Trip.com affiliate click-tracking links.
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React from "react";
import { ExternalLink } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import type { getThemeColorByDestination } from "./helpers";

export const PriceComparisonWidget = ({
  tourId,
  tourPrice,
  themeColor,
}: {
  tourId: number;
  tourPrice: number;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
}) => {
  const { t, formatPrice } = useLocale();
  const utils = trpc.useUtils();
  const trackClickMutation = trpc.affiliate.trackClick.useMutation();
  const { data: comparison, isLoading } = trpc.affiliate.getPriceComparison.useQuery({ tourId });
  if (isLoading || !comparison) return null;
  const selfBookTotal = comparison.totalSelfBook ?? 0;
  const savings = selfBookTotal > 0 ? selfBookTotal - tourPrice : 0;
  const savingsPct = selfBookTotal > 0 ? Math.round((savings / selfBookTotal) * 100) : 0;

  const handleFlightClick = async () => {
    try {
      const result = await utils.affiliate.generateAffiliateLink.fetch({ type: "flights" });
      await trackClickMutation.mutateAsync({ platform: "trip_flights", targetUrl: result.url, referrerPage: `/tours/${tourId}` });
      window.open(result.url, "_blank");
    } catch {}
  };

  const handleHotelClick = async () => {
    try {
      const result = await utils.affiliate.generateAffiliateLink.fetch({ type: "hotels" });
      await trackClickMutation.mutateAsync({ platform: "trip_hotels", targetUrl: result.url, referrerPage: `/tours/${tourId}` });
      window.open(result.url, "_blank");
    } catch {}
  };

  return (
    <div className="mt-10 bg-gray-50 rounded-2xl border border-gray-200 p-6">
      <h3 className="text-lg font-bold text-gray-900 mb-1">{t('tourDetail.priceComparison.title')}</h3>
      <p className="text-sm text-gray-500 mb-5">{t('tourDetail.priceComparison.subtitle')}</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        {[
          { label: t('tourDetail.priceComparison.flightEstimate'), value: comparison.flightEstimate, onClick: handleFlightClick, clickLabel: t('tourDetail.priceComparison.searchFlights') },
          { label: t('tourDetail.priceComparison.hotelEstimate'), value: comparison.hotelEstimate, onClick: handleHotelClick, clickLabel: t('tourDetail.priceComparison.searchHotels') },
          { label: t('tourDetail.priceComparison.activityEstimate'), value: comparison.activityEstimate, onClick: null, clickLabel: null },
          { label: t('tourDetail.priceComparison.mealEstimate'), value: comparison.mealEstimate, onClick: null, clickLabel: null },
          { label: t('tourDetail.priceComparison.transportEstimate'), value: comparison.transportEstimate, onClick: null, clickLabel: null },
          { label: t('tourDetail.priceComparison.otherEstimate'), value: comparison.otherEstimate, onClick: null, clickLabel: null },
        ].map((item, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-500 mb-1">{item.label}</p>
            <p className="text-base font-bold text-gray-900">
              {item.value ? formatPrice(item.value, "TWD") : t('tourDetail.priceComparison.inquire')}
            </p>
            {item.onClick && item.value && (
              <button onClick={item.onClick} className="mt-2 text-xs text-foreground hover:text-[#8a6f3a] flex items-center gap-1 underline underline-offset-2 transition-colors">
                {item.clickLabel} <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>
      {/* v80.24: was hardcoding `NT$` and `.toLocaleString()` — now uses
          formatPrice so the comparison widget honours the user's selected
          currency just like the rest of the page. */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white rounded-xl border border-gray-200 p-4">
        <div>
          <p className="text-sm text-gray-500">{t('tourDetail.priceComparison.selfBookTotal')}</p>
          <p className="text-2xl font-bold text-gray-900">
            {selfBookTotal > 0 ? formatPrice(selfBookTotal, "TWD") : t('tourDetail.priceComparison.inquire')}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-400">{t('tourDetail.priceComparison.vs')}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">{t('tourDetail.priceComparison.packagePrice')}</p>
          <p className="text-2xl font-bold" style={{ color: themeColor.primary }}>{formatPrice(tourPrice, "TWD")}</p>
        </div>
        {savings > 0 && (
          <div className="bg-[#c9a563]/10 border border-[#c9a563]/35 rounded-xl px-4 py-3 text-center">
            <p className="text-xs text-[#8a6f3a] font-medium">{t('tourDetail.priceComparison.savings')}</p>
            <p className="text-xl font-bold text-[#8a6f3a]">{formatPrice(savings, "TWD")}</p>
            <p className="text-xs text-[#8a6f3a]/85">{t('tourDetail.priceComparison.savingsPct').replace('{pct}', String(savingsPct))}</p>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-3 text-center">{t('tourDetail.priceComparison.dataSource').replace('{flight}', comparison.flightSource || 'Trip.com').replace('{hotel}', comparison.hotelSource || 'Trip.com').replace('{date}', new Date(comparison.lastUpdated).toLocaleDateString())}</p>
    </div>
  );
};
