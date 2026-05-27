/**
 * TourDetailPeony / helpers.tsx
 *
 * Pure helpers + small sub-components + shared type re-exports for the
 * TourDetailPeony directory.
 *
 * Heavy sub-components (HotelCard, DayCard, DeparturePriceCalendar,
 * PriceComparisonWidget, Dialogs) live in their own sibling files for LOC
 * budget compliance; we re-export them here so call-sites have a single
 * import surface.
 *
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React from "react";
import { Plane, Train, Ship, Bus, Car } from "lucide-react";

// ─── Pure helpers ─────────────────────────────────────────────────────────

// 交通工具類型英文對照表（集中管理，避免散落在 JSX 中）
export const TRANSPORT_TYPE_EN: Record<string, string> = {
  '飛機': 'Flight',
  '火車': 'Train',
  '觀光列車': 'Sightseeing Train',
  '郵輪': 'Cruise',
  '自駕': 'Self-drive',
  '遊覽車': 'Coach',
  '巴士': 'Bus',
  '高鐵': 'High-Speed Rail',
  '船': 'Ferry',
};

// 解析 JSON 字串
export const parseJSON = (str: string | null | undefined, defaultValue: any = null) => {
  if (!str) return defaultValue;
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
};

// ─── TWD → USD conversion constant ────────────────────────────────────────
// Approximate rate used for display. Matches FALLBACK_RATES in LocaleContext.
// Will be replaced by a dynamic rate fetch later.
export const TWD_PER_USD = 32;

/**
 * Format a TWD price as "NT$xx,xxx" with an approximate USD equivalent.
 * Returns { twd: "NT$44,440", usd: "1,388" } for downstream rendering.
 */
export function formatDualPrice(priceTWD: number): { twd: string; usd: string } {
  return {
    twd: `NT$${priceTWD.toLocaleString()}`,
    usd: Math.round(priceTWD / TWD_PER_USD).toLocaleString(),
  };
}

/**
 * Detect supplier from sourceUrl.
 * Returns 'lion' | 'uv' | null.
 */
export function detectSupplier(sourceUrl: string | null | undefined): 'lion' | 'uv' | null {
  if (!sourceUrl) return null;
  const lower = sourceUrl.toLowerCase();
  if (lower.includes('liontravel')) return 'lion';
  if (lower.includes('uvbookings')) return 'uv';
  return null;
}

// 根據目的地生成主題色
// Round 80.8: Unified B&W + Gold brand theme — replaces the previous
// per-country rainbow (歐洲藍 / 日本粉 / 東南亞綠 / 中國紅 / 美洲橙) which
// directly contradicted the brand baseline. Every TourDetail page now uses
// the same brand palette: black primary, gold accent, cream backgrounds.
// The function signature is preserved so the 123 downstream references
// (`themeColor.primary` / `secondary` / `light` / etc.) keep working without
// any call-site changes.
//
// Mapping rationale:
// - primary:   #0A0A0A — heading text, calendar headers, hero overlay
// - secondary: #c9a563 — selected date, badge, gradient accent (brand gold)
// - accent:    #8a6f3a — deep gold for hover / pressed states
// - light:     #FAF8F2 — barely-warm cream for accent backgrounds
// - gradient:  black-to-soft-gray for hero / day-card gradients
export const BRAND_THEME = {
  primary: "#0A0A0A",
  secondary: "#c9a563",
  accent: "#8a6f3a",
  light: "#FAF8F2",
  gradient: "from-foreground to-foreground/85",
};

export const getThemeColorByDestination = (_country: string | null | undefined) => {
  // Country argument intentionally ignored — Round 80.8 unified all destinations
  // to a single B&W + Gold brand theme. Param kept for API stability.
  return BRAND_THEME;
};

// ─── Small components ─────────────────────────────────────────────────────

// 交通類型圖標
export const TransportIcon = ({ type, className = "h-5 w-5", style }: { type: string; className?: string; style?: React.CSSProperties }) => {
  switch (type) {
    case 'FLIGHT': return <Plane className={className} style={style} />;
    case 'TRAIN': return <Train className={className} style={style} />;
    case 'CRUISE': return <Ship className={className} style={style} />;
    case 'BUS': return <Bus className={className} style={style} />;
    case 'CAR': return <Car className={className} style={style} />;
    default: return <Plane className={className} style={style} />;
  }
};

// 導航標籤組件
export const NavTabs = ({
  items,
  activeTab,
  onTabClick,
  themeColor
}: {
  items: { id: string; label: string }[];
  activeTab: string;
  onTabClick: (id: string) => void;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
}) => {
  return (
    <div className="flex items-center gap-0 border-b border-gray-200 overflow-x-auto scrollbar-hide flex-nowrap min-w-0">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onTabClick(item.id)}
          className={`px-3 md:px-5 py-3 md:py-4 text-sm md:text-base font-semibold transition-all border-b-2 -mb-[2px] whitespace-nowrap flex-shrink-0 ${
            activeTab === item.id
              ? "border-current text-black"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
          style={activeTab === item.id ? { borderColor: themeColor.secondary } : {}}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};

// ─── Shared types ─────────────────────────────────────────────────────────

// 餐廳詳情資料型別
export interface MealDetail {
  name: string;
  description?: string;
  address?: string;
  phone?: string;
  menu?: string[];
  images?: string[];
  rating?: number;
  priceRange?: string;
}

// 景點詳情資料型別
export interface AttractionDetail {
  name: string;
  title?: string;
  description?: string;
  address?: string;
  phone?: string;
  openingHours?: string;
  ticketPrice?: string;
  ticketInfo?: string;
  images?: string[];
  rating?: number;
  website?: string;
  tips?: string[];
  highlights?: string[];
  duration?: string;
}

// ─── Re-exports of heavier sub-components (kept in sibling files for LOC budgets) ───

export { DeparturePriceCalendar } from "./DeparturePriceCalendar";
export { HotelCard, getFacilityIcons, parseStarRating } from "./HotelCard";
export type { HotelDetail } from "./HotelCard";
export { DayCard, MealCard } from "./DayCard";
export { AttractionDetailDialog, MealDetailDialog } from "./Dialogs";
export { PriceComparisonWidget } from "./PriceComparisonWidget";
