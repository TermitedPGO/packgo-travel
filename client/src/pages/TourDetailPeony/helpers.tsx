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

// ─── Title cleaning (display layer — fixes existing stock + all future) ──────
// Supplier / promo titles arrive wrapped in tier or promo frames:
// "[Gold] 東京五日", "【早鳥優惠】京都賞櫻", "  雙人成行  ". These read as noise on
// the customer page. We strip them at DISPLAY time (not at hydrate) so every
// already-imported tour is cleaned on the next render, not only re-scraped ones.
// Zero LLM — deterministic regex, promo-keyword-gated so real 【】 content stays.
const PROMO_INNER =
  /gold|silver|bronze|platinum|diamond|vip|hot\b|new\b|sale|promo|限時|限量|早鳥|促銷|特惠|優惠|折扣|下殺|加碼|熱賣|熱銷|獨家|超值|團購|首選|推薦|季節限定/i;

/**
 * Strip [..]/【..】 promo/tier frames and squeeze whitespace from a tour title.
 * Only removes bracket frames whose inner text is a promo label — real bracketed
 * content (e.g. a genuine subtitle) is preserved. Pure + deterministic.
 */
export function cleanTourTitle(title: string | null | undefined): string {
  if (!title) return "";
  let t = String(title);
  // Remove [..] / 【..】 frames whose inner text matches a promo keyword.
  t = t.replace(/[【\[]([^】\]]*)[】\]]/g, (m, inner) =>
    PROMO_INNER.test(inner) ? " " : m,
  );
  // Collapse runs of whitespace + trim leftover leading/trailing separators.
  t = t
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s|｜·・、,\-–—]+|[\s|｜·・、,\-–—]+$/g, "")
    .trim();
  return t;
}

/**
 * Format a tour duration for display. A bare numeric duration (the schema stores
 * an int like 5) rendered「5」as an orphan digit with no unit; this appends the
 * localised unit ("5 天" / "5 Days"). Already-unit'd strings pass through
 * unchanged, and an empty duration falls back to the multi-day label. (Wave 1 C.6)
 */
export function formatDuration(
  duration: unknown,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (duration == null || duration === "") return t("tourDetail.multiDayTour");
  const s = String(duration).trim();
  return /^\d+$/.test(s) ? t("tourDetail.daysUnit", { days: s }) : s;
}

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
