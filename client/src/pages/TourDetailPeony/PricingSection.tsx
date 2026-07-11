/**
 * TourDetailPeony / PricingSection.tsx
 *
 * Pricing Section — departure calendar, CTAs, cost details, refund policy
 * and contact info. Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React from "react";
import { Check, X, Phone, Mail, RefreshCw, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { CONTACT, REFUND_POLICY } from "@/lib/brand";
import {
  DeparturePriceCalendar,
  PriceComparisonWidget,
  type getThemeColorByDestination,
} from "./helpers";
import { splitCostEntries, type InquiryMode } from "./actionArea.helpers";

export type PricingSectionProps = {
  tour: any;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  sectionRef: React.RefObject<HTMLElement | null>;
  costExplanation: any;
  language: string;
  onInquire: (mode: InquiryMode) => void;
};

export default function PricingSection({
  tour,
  themeColor,
  sectionRef,
  costExplanation,
  language,
  onInquire,
}: PricingSectionProps) {
  const { t } = useLocale();

  return (
    <section ref={sectionRef} id="pricing" className="py-16 lg:py-24">
      <div className="max-w-5xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-center mb-4" style={{ color: themeColor.primary }}>
          {t('tourDetail.departurePricing')}
        </h2>
        <p className="text-lg text-gray-700 text-center mb-12">{t('tourDetail.selectDepartureDate')}</p>

        {/* Dynamic Price Calendar — 停止線:選團期改為提交訂位需求(reserve),
            不直連即時結帳。 */}
        <DeparturePriceCalendar
          tourId={tour.id}
          basePrice={tour.price || 0}
          themeColor={themeColor}
          onSelectDeparture={() => onInquire('reserve')}
        />

        {/* CTA Buttons — Wave 1 C.2 (停止線 UI 補完):即時結帳暫停,兩個動作都走
            詢問流 — 要報價(quote)+ 提交訂位需求(reserve),不再直連 /book/:id。 */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
          <Button
            onClick={() => onInquire('quote')}
            className="px-8 py-4 text-white text-lg font-medium rounded-lg btn-hover-lift transition-all duration-300 hover:shadow-lg"
            style={{ backgroundColor: themeColor.primary }}
          >
            {t('tourDetail.action.cta.requestQuote')}
          </Button>
          <Button
            variant="outline"
            onClick={() => onInquire('reserve')}
            className="px-8 py-4 text-lg font-medium border-2 rounded-lg btn-hover-lift transition-all duration-300 hover:bg-gray-50"
            style={{ borderColor: themeColor.primary, color: themeColor.primary }}
          >
            {t('tourDetail.action.cta.reserveRequest')}
          </Button>
        </div>

        {/* Round 60: P2 - Cost Explanation in Pricing section.
            Wave 1 A.2 (fail-honest): ✓/✗ only on clean line items; supplier
            prose walls render verbatim under「供應商費用說明原文」without marks.
            C.4: a lone card spans the row. */}
        {costExplanation && (() => {
          const inc = splitCostEntries(costExplanation.included);
          const exc = splitCostEntries(costExplanation.excluded);
          const walls = [...inc.walls, ...exc.walls];
          const bothCards = inc.items.length > 0 && exc.items.length > 0;
          if (inc.items.length === 0 && exc.items.length === 0 && walls.length === 0) return null;
          return (
            <div className="mt-12">
              <h3 className="text-2xl font-bold text-center mb-8" style={{ color: themeColor.primary }}>
                {t('tourDetail.costDetails')}
              </h3>
              {(inc.items.length > 0 || exc.items.length > 0) && (
                <div className={`grid gap-6 ${bothCards ? 'md:grid-cols-2' : 'grid-cols-1 max-w-2xl mx-auto'}`}>
                  {/* Round 80.8: cost included/excluded normalised to B&W + Gold (was green/red) */}
                  {inc.items.length > 0 && (
                    <div className="bg-[#c9a563]/[0.08] rounded-xl p-6 border border-[#c9a563]/30">
                      <h4 className="text-lg font-bold mb-4 flex items-center gap-2 text-[#8a6f3a]">
                        <Check className="h-5 w-5" />
                        {t('tourDetail.includedItems')}
                      </h4>
                      <ul className="space-y-2">
                        {inc.items.map((item: string, index: number) => (
                          <li key={index} className="flex items-start gap-2 text-sm text-gray-700">
                            <Check className="h-4 w-4 text-[#c9a563] mt-0.5 flex-shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {exc.items.length > 0 && (
                    <div className="bg-foreground/[0.04] rounded-xl p-6 border border-foreground/15">
                      <h4 className="text-lg font-bold mb-4 flex items-center gap-2 text-foreground/75">
                        <X className="h-5 w-5" />
                        {t('tourDetail.excludedItems')}
                      </h4>
                      <ul className="space-y-2">
                        {exc.items.map((item: string, index: number) => (
                          <li key={index} className="flex items-start gap-2 text-sm text-gray-700">
                            <X className="h-4 w-4 text-foreground/55 mt-0.5 flex-shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {walls.length > 0 && (
                <div className="mt-6 bg-gray-50 rounded-xl p-6 border border-gray-200">
                  <h4 className="text-base font-bold mb-4 flex items-center gap-2 text-gray-700">
                    <FileText className="h-5 w-5 text-gray-500" />
                    {t('tourDetail.supplierCostRaw')}
                  </h4>
                  <div className="space-y-3">
                    {walls.map((w: string, index: number) => (
                      <p key={index} className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{w}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Price Comparison Widget */}
        <PriceComparisonWidget tourId={tour.id} tourPrice={tour.price || 0} themeColor={themeColor} />

        {/* v80.24: Refund Policy summary — buyers want to see this near
            pricing. Centralized in lib/brand.ts so changes cascade. */}
        <div className="mt-12 bg-[#FAF8F2] border border-[#c9a563]/30 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[#c9a563]/15 flex items-center justify-center">
              <RefreshCw className="h-5 w-5 text-[#8a6f3a]" />
            </div>
            <div className="flex-1">
              <h3 className="font-serif font-bold text-lg text-foreground mb-1">
                {t('tourDetail.cancelRefundTitle')}
              </h3>
              <p className="text-xs text-foreground/55 mb-3">
                {t('tourDetail.cstFootnote')}
              </p>
              <ul className="space-y-1.5 text-sm text-foreground/80">
                {(language === 'en' ? REFUND_POLICY.en : REFUND_POLICY.zh).map((line, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-[#c9a563] flex-shrink-0 mt-1">✦</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Contact Info — v80.24 uses centralized CONTACT constants
            (was hardcoded personal Gmail; trust signal mismatch with CST badge) */}
        <div className="mt-12 text-center text-gray-700">
          <p className="mb-4">{t('tourDetail.contactAdvisor')}</p>
          <div className="flex flex-wrap justify-center gap-6">
            <a href={`tel:${CONTACT.whatsapp}`} className="flex items-center gap-2 hover:text-black transition-colors">
              <Phone className="h-4 w-4" />
              <span>{CONTACT.phoneDisplay}</span>
            </a>
            <a href={`mailto:${CONTACT.email}`} className="flex items-center gap-2 hover:text-black transition-colors">
              <Mail className="h-4 w-4" />
              <span>{CONTACT.email}</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
