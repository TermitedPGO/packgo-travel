/**
 * TourDetailPeony / TourActionArea.tsx
 *
 * The "decision + action" area (feature: tour-catalog-rebuild, detail page
 * Direction 3 = booking rail). Two columns:
 *   left  — at-a-glance facts (TourSpecBar) + the fit wizard (guidance)
 *   right — a sticky BookingRail with the ONE primary action
 *
 * Placed right after the hero so the decision surfaces on the first screen.
 * Controlled container: wizard answers and which dialog is open are owned by
 * index.tsx. The old version stacked six equal-weight CTAs here; they now
 * collapse into the rail's single 預訂 + small fallbacks.
 */

import React from "react";
import TourSpecBar from "./TourSpecBar";
import TourFitWizard from "./TourFitWizard";
import BookingRail from "./BookingRail";
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
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-6">
        <div className="space-y-6">
          {/* Facts on the first screen (去哪 / 幾天 / 起價 / 最近出發 / 機票) */}
          <TourSpecBar tour={tour} departures={departures} themeColor={themeColor} />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
            {/* Rail first on mobile (price + one action early), left on desktop */}
            <div className="order-1 lg:order-2">
              <BookingRail
                tour={tour}
                departures={departures}
                themeColor={themeColor}
                onInquire={onInquire}
                onWeChat={onWeChat}
                navigate={navigate}
              />
            </div>
            <div className="order-2 lg:order-1 min-w-0">
              <TourFitWizard value={wizard} onChange={onWizardChange} themeColor={themeColor} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
