/**
 * StickyNav Component (Sipincollection Style)
 * 固定導航列，顯示行程名稱和快速連結
 */

import React from "react";
import { ensureReadableOnWhite } from "@/lib/colorUtils";
import { useLocale } from "@/contexts/LocaleContext";

export interface StickyNavProps {
  tourTitle: string;
  colorTheme: {
    primary: string;
    secondary: string;
    accent: string;
  };
  transportationType?: 'FLIGHT' | 'TRAIN' | 'CAR' | 'CRUISE' | 'BUS' | 'UNKNOWN' | null;
}

export const StickyNav: React.FC<StickyNavProps> = ({ tourTitle, colorTheme, transportationType }) => {
  const { t } = useLocale();
  // 根據交通類型決定是否顯示航班資訊標籤
  const shouldShowFlightTab = !transportationType || transportationType === 'FLIGHT';
  
  // 根據交通類型決定標籤名稱
  const getTransportLabel = () => {
    switch (transportationType) {
      case 'TRAIN':
        return t('tourDetail.nav.transportTrain');
      case 'CRUISE':
        return t('tourDetail.nav.transportCruise');
      case 'CAR':
        return t('tourDetail.nav.transportCar');
      case 'BUS':
        return t('tourDetail.nav.transportBus');
      default:
        return t('tourDetail.nav.transportFlight');
    }
  };

  const navItems = [
    { label: t('tourDetail.nav.features'), href: "#features" },
    { label: t('tourDetail.nav.itinerary'), href: "#itinerary" },
    { label: t('tourDetail.nav.hotels'), href: "#hotels" },
    { label: t('tourDetail.nav.cost'), href: "#cost" },
    // 只有飛機行程才顯示航班資訊標籤，其他類型不顯示獨立的交通區塊
    ...(shouldShowFlightTab ? [{ label: getTransportLabel(), href: "#flights" }] : []),
    { label: t('tourDetail.nav.notice'), href: "#notice" },
    { label: t('tourDetail.nav.departures'), href: "#departures" },
  ];

  const scrollToSection = (href: string) => {
    const element = document.querySelector(href);
    if (element) {
      const offset = 80; // StickyNav height
      const elementPosition = element.getBoundingClientRect().top + window.pageYOffset;
      const offsetPosition = elementPosition - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });
    }
  };

  return (
    <nav
      className="sticky top-0 z-40 bg-white border-b shadow-sm"
      style={{
        backgroundColor: colorTheme.secondary + "20", // 20% opacity
        borderBottomColor: colorTheme.primary + "20",
      }}
    >
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          {/* 行程名稱 */}
          <h2
            className="text-sm lg:text-base font-bold truncate max-w-[300px] lg:max-w-[500px]"
            style={{ color: ensureReadableOnWhite(colorTheme.primary) }}
            title={tourTitle}
          >
            {tourTitle.length > 40 ? tourTitle.slice(0, 40) + '...' : tourTitle}
          </h2>

          {/* 快速連結 */}
          <div className="flex flex-wrap items-center gap-4 lg:gap-6">
            {navItems.map((item) => (
              <button
                key={item.href}
                onClick={() => scrollToSection(item.href)}
                className="text-sm lg:text-base font-medium tracking-wide hover:underline transition-all"
                style={{
                  color: colorTheme.primary,
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
};
