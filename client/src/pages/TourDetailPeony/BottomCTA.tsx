/**
 * TourDetailPeony / BottomCTA.tsx
 *
 * Fixed Bottom CTA (v78i: phone now tel: link for 1-click call;
 * price respects tour currency). Extracted from TourDetailPeony.tsx
 * v2 Wave 2 Module 2.8.
 */

import React from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { CONTACT } from "@/lib/brand";
import { formatDualPrice, type getThemeColorByDestination } from "./helpers";
import { type InquiryMode } from "./actionArea.helpers";

export type BottomCTAProps = {
  tour: any;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  navigate: (path: string) => void;
  onInquire: (mode: InquiryMode) => void;
};

export default function BottomCTA({ tour, themeColor, navigate, onInquire }: BottomCTAProps) {
  const { t, formatPrice } = useLocale();
  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-gray-200 shadow-2xl z-50 rounded-t-xl">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              {tour.price && (tour.priceCurrency || 'TWD') === 'TWD' ? (() => {
                const dual = formatDualPrice(Number(tour.price));
                return (
                  <>
                    <p className="text-[10px] text-gray-400 leading-tight">{t('tourDetail.supplierRefPrice')}</p>
                    <p className="text-lg md:text-xl font-bold" style={{ color: themeColor.primary }}>
                      {dual.twd}
                    </p>
                    <p className="text-xs text-gray-500 leading-tight">
                      {t('tourDetail.approxUsd', { usd: dual.usd })}
                    </p>
                  </>
                );
              })() : (
                <>
                  <p className="text-xs text-gray-500">{t('tourDetail.pricePerPersonFrom')}</p>
                  <p className="text-xl md:text-2xl font-bold" style={{ color: themeColor.primary }}>
                    {tour.price
                      ? formatPrice(Number(tour.price), (tour.priceCurrency as any) || "TWD")
                      : t('tourDetail.inquirePrice')}
                  </p>
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              <a
                href={`tel:${CONTACT.whatsapp}`}
                className="hidden md:inline-flex items-center gap-2 px-5 py-3 font-medium rounded-lg border-2 transition-colors hover:bg-primary/5"
                style={{ borderColor: themeColor.primary, color: themeColor.primary }}
              >
                <Phone className="h-4 w-4" />
                <span className="hidden lg:inline">{CONTACT.phoneDisplay}</span>
                <span className="lg:hidden">{t('tourDetail.contactUs')}</span>
              </a>
              {/* 臨時停止線 (2026-07-10): 即時結帳暫停。原「線上預訂」→ /book/:id
                  結帳連結移除;改為「要報價」詢位 fallback,主 CTA 升為「提交訂位
                  需求」(走 inquiry 詢位流)。checkout-verify 批的即時驗證上線後恢復。 */}
              <button
                type="button"
                onClick={() => onInquire('quote')}
                className="hidden sm:inline text-sm text-gray-500 underline-offset-4 transition-colors hover:text-gray-700 hover:underline"
              >
                {t('tourDetail.action.cta.requestQuote')}
              </button>
              <Button
                onClick={() => onInquire('reserve')}
                className="px-6 md:px-10 py-3 text-white font-bold text-base md:text-lg rounded-lg"
                style={{ backgroundColor: themeColor.primary }}
              >
                {t('tourDetail.action.cta.reserveRequest')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Add padding for fixed bottom CTA */}
      <div className="h-20" />
    </>
  );
}
