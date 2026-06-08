/**
 * TourDetailPeony / TourActionArea.tsx
 *
 * The "decision + action" area (feature: tour-page-redesign): an at-a-glance
 * spec strip, a 3-question fit wizard, and the CTA row. Placed high on the page
 * so the decision surfaces early. Controlled container: wizard answers and
 * which dialog is open are owned by index.tsx.
 *
 * CTA hierarchy (mobile-first, equal-height, all rounded-lg):
 *   primary    要報價 (request quote):  filled, themeColor
 *   secondary  客製這團 (customize):     outline, emphasized
 *   support    加微信 / 打電話:           form-free direct paths (outline)
 *   tertiary   線上預訂 (book online):    lowest-weight text button (kept, not removed)
 */

import React from "react";
import { MessageCircle, Phone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { CONTACT } from "@/lib/brand";
import TourSpecBar from "./TourSpecBar";
import TourFitWizard from "./TourFitWizard";
import {
  type WizardAnswers,
  type InquiryMode,
  type DepartureLike,
  type TourLike,
} from "./actionArea.helpers";
import { type getThemeColorByDestination } from "./helpers";

export type TourActionAreaProps = {
  tour: TourLike & Record<string, any>;
  departures?: DepartureLike[] | null;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  wizard: WizardAnswers;
  onWizardChange: (next: WizardAnswers) => void;
  onInquire: (mode: InquiryMode) => void;
  onWeChat: () => void;
  navigate: (path: string) => void;
};

export default function TourActionArea({
  tour,
  departures,
  themeColor,
  wizard,
  onWizardChange,
  onInquire,
  onWeChat,
  navigate,
}: TourActionAreaProps) {
  const { t } = useLocale();
  const c = (s: string) => `tourDetail.action.cta.${s}`;

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
        <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <TourSpecBar tour={tour} departures={departures} themeColor={themeColor} />

          <TourFitWizard value={wizard} onChange={onWizardChange} themeColor={themeColor} />

          {/* CTA row */}
          <div className="space-y-3">
            <p className="text-sm text-gray-600">{t(c("subheading"))}</p>

            {/* Primary: request quote / customize */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Button
                onClick={() => onInquire("quote")}
                className="h-12 w-full rounded-lg text-base font-bold text-white"
                style={{ backgroundColor: themeColor.primary }}
              >
                <Sparkles className="h-4 w-4" />
                {t(c("requestQuote"))}
              </Button>
              <Button
                variant="outline"
                onClick={() => onInquire("custom")}
                className="h-12 w-full rounded-lg border-2 text-base font-semibold"
                style={{ borderColor: themeColor.primary, color: themeColor.primary }}
              >
                {t(c("customize"))}
              </Button>
            </div>

            {/* Support: form-free direct paths */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={onWeChat}
                className="h-11 w-full rounded-lg border-2"
                style={{ borderColor: themeColor.secondary, color: themeColor.accent }}
              >
                <MessageCircle className="h-4 w-4" />
                {t(c("addWeChat"))}
              </Button>
              <a
                href={`tel:${CONTACT.whatsapp}`}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border-2 text-sm font-medium transition-colors hover:bg-gray-50"
                style={{ borderColor: themeColor.primary, color: themeColor.primary }}
              >
                <Phone className="h-4 w-4" />
                {t(c("callNow"))}
              </a>
            </div>

            {/* Online checkout kept, demoted to lowest visual weight. */}
            <div className="pt-1 text-center">
              <button
                type="button"
                onClick={() => navigate(`/book/${tour.id}`)}
                className="text-sm text-gray-500 underline-offset-4 hover:text-gray-700 hover:underline"
              >
                {t(c("bookOnline"))}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
