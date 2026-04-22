/**
 * CostExplanationSection Component
 * 費用說明區塊 - 顯示包含/不包含項目、額外費用、注意事項
 */

import React from "react";
import { CheckCircle2, XCircle, AlertCircle, Info } from "lucide-react";
import { ensureReadableOnWhite } from "@/lib/colorUtils";
import { useLocale } from "@/contexts/LocaleContext";

export interface CostExplanation {
  included?: string[];
  excluded?: string[];
  additionalCosts?: string[];
  notes?: string;
}

export interface CostExplanationSectionProps {
  costExplanation: CostExplanation;
  colorTheme: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

export const CostExplanationSection: React.FC<CostExplanationSectionProps> = ({
  costExplanation,
  colorTheme,
}) => {
  const { t } = useLocale();

  if (!costExplanation) {
    return null;
  }

  const { included = [], excluded = [], additionalCosts = [], notes } = costExplanation;

  return (
    <section id="cost" className="w-full py-8 lg:py-10 bg-gray-50">
      <div className="container mx-auto px-4">
        <h2
          className="text-2xl lg:text-3xl font-serif font-bold text-center mb-6"
          style={{ color: ensureReadableOnWhite(colorTheme.primary) }}
        >
          {t('tourDetail.sections.cost')}
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Included */}
          {included.length > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2
                  className="h-5 w-5"
                  style={{ color: ensureReadableOnWhite(colorTheme.accent) }}
                />
                <h3
                  className="text-lg font-bold"
                  style={{ color: ensureReadableOnWhite(colorTheme.primary) }}
                >
                  {t('tourDetail.sections.costIncluded')}
                </h3>
              </div>
              <ul className="space-y-2">
                {included.map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <CheckCircle2
                      className="h-5 w-5 flex-shrink-0 mt-0.5"
                      style={{ color: "#10B981" }}
                    />
                    <span className="text-gray-700 leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Excluded */}
          {excluded.length > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <XCircle
                  className="h-5 w-5"
                  style={{ color: "#EF4444" }}
                />
                <h3
                  className="text-lg font-bold"
                  style={{ color: ensureReadableOnWhite(colorTheme.primary) }}
                >
                  {t('tourDetail.sections.costExcluded')}
                </h3>
              </div>
              <ul className="space-y-2">
                {excluded.map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <XCircle
                      className="h-5 w-5 flex-shrink-0 mt-0.5"
                      style={{ color: "#EF4444" }}
                    />
                    <span className="text-gray-700 leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Additional Costs */}
        {additionalCosts.length > 0 && (
          <div className="bg-white rounded-xl p-5 shadow-sm mb-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle
                className="h-5 w-5"
                style={{ color: "#F59E0B" }}
              />
              <h3
                className="text-lg font-bold"
                style={{ color: ensureReadableOnWhite(colorTheme.primary) }}
              >
                {t('tourDetail.sections.costAdditional')}
              </h3>
            </div>
            <ul className="space-y-2">
              {additionalCosts.map((item, index) => (
                <li key={index} className="flex items-start gap-3">
                  <AlertCircle
                    className="h-5 w-5 flex-shrink-0 mt-0.5"
                    style={{ color: "#F59E0B" }}
                  />
                  <span className="text-gray-700 leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Notes */}
        {notes && (
          <div
            className="rounded-lg p-5"
            style={{
              backgroundColor: colorTheme.accent + "10",
              borderLeft: `4px solid ${colorTheme.accent}`,
            }}
          >
            <div className="flex items-start gap-2">
              <Info
                className="h-5 w-5 flex-shrink-0 mt-0.5"
                style={{ color: ensureReadableOnWhite(colorTheme.accent) }}
              />
              <div>
                <h4
                  className="font-bold mb-1.5"
                  style={{ color: ensureReadableOnWhite(colorTheme.primary) }}
                >
                  {t('tourDetail.sections.costReminder')}
                </h4>
                <p className="text-gray-700 leading-relaxed text-sm">{notes}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
