/**
 * TourDetailPeony / TourFitWizard.tsx
 *
 * Three-question option wizard for the redesigned action area
 * (feature: tour-page-redesign, Stage 2). Controlled component: it holds no
 * state of its own — the parent owns `value` and receives `onChange`, so the
 * answers can flow straight into the inquiry payload (see buildInquiryInput).
 *
 * All options are optional; tapping a selected option clears it.
 */

import React from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { type WizardAnswers } from "./actionArea.helpers";
import { type getThemeColorByDestination } from "./helpers";

export type TourFitWizardProps = {
  value: WizardAnswers;
  onChange: (next: WizardAnswers) => void;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
};

type RowKey = keyof WizardAnswers;

// Config drives both rows; option `val`s are the language-neutral keys stored
// in wizardAnswers, `labelKey` resolves the localized display string.
const ROWS: { key: RowKey; labelKey: string; options: { val: string; labelKey: string }[] }[] = [
  {
    key: "people",
    labelKey: "peopleLabel",
    options: [
      { val: "1-2", labelKey: "people_1_2" },
      { val: "3-5", labelKey: "people_3_5" },
      { val: "6+", labelKey: "people_6plus" },
    ],
  },
  {
    key: "timeframe",
    labelKey: "timeLabel",
    options: [
      { val: "soon", labelKey: "time_soon" },
      { val: "school_break", labelKey: "time_break" },
      { val: "discuss", labelKey: "time_discuss" },
    ],
  },
  {
    key: "budget",
    labelKey: "budgetLabel",
    options: [
      { val: "economy", labelKey: "budget_economy" },
      { val: "comfort", labelKey: "budget_comfort" },
      { val: "luxury", labelKey: "budget_luxury" },
    ],
  },
];

export default function TourFitWizard({ value, onChange, themeColor }: TourFitWizardProps) {
  const { t } = useLocale();
  const w = (s: string) => `tourDetail.action.wizard.${s}`;

  return (
    <div className="space-y-4">
      <h3 className="font-serif text-lg font-bold" style={{ color: themeColor.primary }}>
        {t(w("title"))}
      </h3>

      {ROWS.map((row) => (
        <div key={row.key}>
          <p className="mb-2 text-sm font-medium text-gray-600">{t(w(row.labelKey))}</p>
          <div className="grid grid-cols-3 gap-2">
            {row.options.map((opt) => {
              const selected = value[row.key] === opt.val;
              return (
                <button
                  key={opt.val}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    // runtime val is always a valid union member (fixed config)
                    onChange({ ...value, [row.key]: selected ? undefined : opt.val } as WizardAnswers)
                  }
                  className="rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors"
                  style={
                    selected
                      ? { backgroundColor: themeColor.primary, borderColor: themeColor.primary, color: "#fff" }
                      : { backgroundColor: "#fff", borderColor: "#d1d5db", color: "#374151" }
                  }
                >
                  {t(w(opt.labelKey))}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
