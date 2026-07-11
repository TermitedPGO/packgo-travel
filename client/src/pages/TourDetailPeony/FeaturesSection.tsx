/**
 * TourDetailPeony / FeaturesSection.tsx
 *
 * Features Section — attractions + meals + cost inclusions.
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React from "react";
import { Camera, Utensils, Check, X, FileText } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import type { getThemeColorByDestination } from "./helpers";
import { splitCostEntries } from "./actionArea.helpers";

export type FeaturesSectionProps = {
  attractions: any[];
  meals: any[];
  costExplanation: any;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  sectionRef: React.RefObject<HTMLElement | null>;
};

export default function FeaturesSection({
  attractions,
  meals,
  costExplanation,
  themeColor,
  sectionRef,
}: FeaturesSectionProps) {
  const { t } = useLocale();

  return (
    <section ref={sectionRef} id="features" className="py-16 lg:py-24">
      <div className="max-w-5xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-center mb-4" style={{ color: themeColor.primary }}>
          {t('tourDetail.upgradeOptions')}
        </h2>
        <p className="text-lg text-gray-700 text-center mb-12">{t('tourDetail.highlightsDesc')}</p>

        {/* Attractions */}
        {attractions.length > 0 && (
          <div className="mb-12">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Camera className="h-5 w-5" style={{ color: themeColor.secondary }} />
              {t('tourDetail.attractionFeatures')}
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              {attractions.map((attraction: any, index: number) => (
                <div key={index} className="flex items-start gap-3 p-4 bg-gray-50">
                  <div
                    className="w-2 h-2 rounded-lg mt-2 flex-shrink-0"
                    style={{ backgroundColor: themeColor.primary }}
                  />
                  <div>
                    <span className="font-medium">
                      {typeof attraction === 'string' ? attraction : attraction.name || attraction.title}
                    </span>
                    {typeof attraction !== 'string' && attraction.description && (
                      <p className="text-sm text-gray-700 mt-1">{attraction.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Meals */}
        {meals.length > 0 && (
          <div className="mb-12">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Utensils className="h-5 w-5" style={{ color: themeColor.secondary }} />
              {t('tourDetail.mealPlan')}
            </h3>
            {/* v78t: sparse case — 1 meal renders full-width instead of half-empty row */}
            <div className={`grid gap-4 ${meals.length === 1 ? 'grid-cols-1 max-w-2xl mx-auto' : 'md:grid-cols-2'}`}>
              {meals.map((meal: any, index: number) => (
                <div key={index} className="flex items-start gap-3 p-4 bg-gray-50">
                  <div
                    className="w-2 h-2 rounded-lg mt-2 flex-shrink-0"
                    style={{ backgroundColor: themeColor.secondary }}
                  />
                  <span>{typeof meal === 'string' ? meal : meal.name || meal.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cost Inclusions — Wave 1 A.2 (fail-honest checkmarks): only CLEAN
            line items get a ✓/✗. Supplier prose "walls" (one giant paragraph
            that itself lists exclusions like airfare/visa) are shown verbatim
            under「供應商費用說明原文」with NO mark, so we never falsely tick an
            exclusion as included. C.4: a lone card spans the row (no half-empty
            column). */}
        {costExplanation && (() => {
          // demoteNegations:included 裡的短排除句(「機票自理」)降去無勾號
          // 原文區,絕不打 ✓(2026-07-11 驗收回令 P2)。
          const inc = splitCostEntries(costExplanation.included, { demoteNegations: true });
          const exc = splitCostEntries(costExplanation.excluded);
          const walls = [...inc.walls, ...exc.walls];
          const bothCards = inc.items.length > 0 && exc.items.length > 0;
          if (inc.items.length === 0 && exc.items.length === 0 && walls.length === 0) return null;
          return (
            <>
              {(inc.items.length > 0 || exc.items.length > 0) && (
                <div className={`grid gap-8 ${bothCards ? 'md:grid-cols-2' : 'grid-cols-1 max-w-2xl mx-auto'}`}>
                  {/* Included — Round 80.4: gold accent (was green) */}
                  {inc.items.length > 0 && (
                    <div className="bg-[#c9a563]/[0.08] rounded-lg p-6 border border-[#c9a563]/30">
                      <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-[#8a6f3a]">
                        <div className="w-8 h-8 rounded-lg bg-[#c9a563]/20 flex items-center justify-center">
                          <Check className="h-5 w-5 text-[#c9a563]" />
                        </div>
                        {t('tourDetail.includedItems')}
                      </h3>
                      <ul className="space-y-3">
                        {inc.items.map((item: string, index: number) => (
                          <li key={index} className="flex items-start gap-3">
                            <Check className="h-4 w-4 text-[#c9a563] mt-1 flex-shrink-0" />
                            <span className="text-gray-700">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Excluded — Round 80.4: neutral foreground (was red) */}
                  {exc.items.length > 0 && (
                    <div className="bg-foreground/[0.04] rounded-lg p-6 border border-foreground/15">
                      <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-foreground/75">
                        <div className="w-8 h-8 rounded-lg bg-foreground/[0.08] flex items-center justify-center">
                          <X className="h-5 w-5 text-foreground/60" />
                        </div>
                        {t('tourDetail.excludedItems')}
                      </h3>
                      <ul className="space-y-3">
                        {exc.items.map((item: string, index: number) => (
                          <li key={index} className="flex items-start gap-3">
                            <X className="h-4 w-4 text-foreground/55 mt-1 flex-shrink-0" />
                            <span className="text-gray-700">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Prose walls — raw supplier text, no checkmarks (fail-honest). */}
              {walls.length > 0 && (
                <div className="mt-8 bg-gray-50 rounded-lg p-6 border border-gray-200">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-700">
                    <FileText className="h-5 w-5 text-gray-500" />
                    {t('tourDetail.supplierCostRaw')}
                  </h3>
                  <div className="space-y-3">
                    {walls.map((w: string, index: number) => (
                      <p key={index} className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{w}</p>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </section>
  );
}
