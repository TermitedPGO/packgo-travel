/**
 * TourDetailPeony / LoadingState.tsx
 *
 * Loading spinner + 404 fallback for the tour detail page.
 * Round 80.21 — replaced rotated-rounded-square trick with a real circular
 * SVG spinner (stroke-linecap="round" + brand gold) so the loading state
 * looks intentional, not broken.
 *
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import Footer from "@/components/Footer";
import { useLocale } from "@/contexts/LocaleContext";

export const LoadingSpinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-white">
    <div className="text-center">
      <svg
        className="h-12 w-12 mx-auto animate-spin"
        viewBox="0 0 50 50"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <circle cx="25" cy="25" r="20" fill="none" stroke="#e5e7eb" strokeWidth="3" />
        <circle
          cx="25" cy="25" r="20" fill="none" stroke="#c9a563" strokeWidth="3"
          strokeLinecap="round" strokeDasharray="125.6" strokeDashoffset="94.2"
        />
      </svg>
      <p className="mt-6 text-sm tracking-widest uppercase text-gray-500">Loading</p>
    </div>
  </div>
);

export const NotFoundState = ({ navigate }: { navigate: (path: string) => void }) => {
  const { t } = useLocale();
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="flex-grow flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-6">
          <h2 className="text-4xl font-light mb-4">404</h2>
          <p className="text-gray-500 mb-8">{t('tourDetail.tourNotFound')}</p>
          <Button
            onClick={() => navigate("/")}
            className="bg-black text-white hover:bg-gray-800 rounded-lg px-8 py-3"
          >
            {t('tourDetail.backToHome')}
          </Button>
        </div>
      </div>
      <Footer />
    </div>
  );
};
