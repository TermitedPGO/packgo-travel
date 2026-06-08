/**
 * TourDetailPeony / PricingSection.tsx
 *
 * Pricing Section — departure calendar, CTAs, cost details, refund policy
 * and contact info. Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React from "react";
import { Check, X, Phone, Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { CONTACT, REFUND_POLICY } from "@/lib/brand";
import {
  DeparturePriceCalendar,
  PriceComparisonWidget,
  type getThemeColorByDestination,
} from "./helpers";
import { type InquiryMode } from "./actionArea.helpers";

export type PricingSectionProps = {
  tour: any;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  sectionRef: React.RefObject<HTMLElement | null>;
  costExplanation: any;
  language: string;
  navigate: (path: string) => void;
  ensureArray: (val: any) => any[];
  onInquire: (mode: InquiryMode) => void;
};

export default function PricingSection({
  tour,
  themeColor,
  sectionRef,
  costExplanation,
  language,
  navigate,
  ensureArray,
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

        {/* Dynamic Price Calendar */}
        <DeparturePriceCalendar
          tourId={tour.id}
          basePrice={tour.price || 0}
          themeColor={themeColor}
          onSelectDeparture={(departureId) => navigate(`/book/${tour.id}?departure=${departureId}`)}
        />

        {/* CTA Buttons (tour-page-redesign): inquiry promoted to primary,
            online checkout demoted to a secondary (kept, not removed). */}
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
            onClick={() => navigate(`/book/${tour.id}`)}
            className="px-8 py-4 text-lg font-medium border-2 rounded-lg btn-hover-lift transition-all duration-300 hover:bg-gray-50"
            style={{ borderColor: themeColor.primary, color: themeColor.primary }}
          >
            {t('tourDetail.action.cta.bookOnline')}
          </Button>
        </div>

        {/* Round 60: P2 - Cost Explanation in Pricing section */}
        {costExplanation && (costExplanation.included?.length > 0 || costExplanation.excluded?.length > 0) && (
          <div className="mt-12">
            <h3 className="text-2xl font-bold text-center mb-8" style={{ color: themeColor.primary }}>
              {t('tourDetail.costDetails')}
            </h3>
            <div className="grid md:grid-cols-2 gap-6">
              {/* Round 80.8: cost included/excluded normalised to B&W + Gold (was green/red) */}
              {costExplanation.included && costExplanation.included.length > 0 && (
                <div className="bg-[#c9a563]/[0.08] rounded-xl p-6 border border-[#c9a563]/30">
                  <h4 className="text-lg font-bold mb-4 flex items-center gap-2 text-[#8a6f3a]">
                    <Check className="h-5 w-5" />
                    {t('tourDetail.includedItems')}
                  </h4>
                  <ul className="space-y-2">
                    {ensureArray(costExplanation.included).map((item: string, index: number) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-gray-700">
                        <Check className="h-4 w-4 text-[#c9a563] mt-0.5 flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {costExplanation.excluded && costExplanation.excluded.length > 0 && (
                <div className="bg-foreground/[0.04] rounded-xl p-6 border border-foreground/15">
                  <h4 className="text-lg font-bold mb-4 flex items-center gap-2 text-foreground/75">
                    <X className="h-5 w-5" />
                    {t('tourDetail.excludedItems')}
                  </h4>
                  <ul className="space-y-2">
                    {ensureArray(costExplanation.excluded).map((item: string, index: number) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-gray-700">
                        <X className="h-4 w-4 text-foreground/55 mt-0.5 flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

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
