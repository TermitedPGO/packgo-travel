/**
 * Currency formatting helpers — single source of truth for displaying prices.
 *
 * v71: PACK&GO had ~30+ scattered `NT$ {price.toLocaleString()}` snippets and a
 * handful of raw integers like `{tour.price}` that rendered "5000" with no
 * currency context. This module unifies them so:
 *   - prices always show a currency symbol/code
 *   - locale-aware grouping (e.g. zh-TW: "NT$5,000" / en: "TWD 5,000")
 *   - English locale prefers "TWD" over the localized "NT$" abbreviation
 *
 * Usage:
 *   import { formatPrice } from "@/lib/currency";
 *   formatPrice(5000, "TWD", language)  → "NT$5,000" or "TWD 5,000"
 */

export type SupportedCurrency = "TWD" | "USD" | "JPY" | "EUR" | "CNY" | "KRW";

/**
 * Format an amount with an explicit currency code.
 *
 * @param amount      The numeric amount (in the currency's major unit; e.g. 5000 = NT$5,000)
 * @param currency    ISO currency code. Defaults to TWD.
 * @param language    "zh-TW" | "en" (or any BCP-47 tag). Affects grouping separator.
 * @param options     Override fraction digits if needed.
 */
export function formatPrice(
  amount: number | null | undefined,
  currency: SupportedCurrency = "TWD",
  language: "zh-TW" | "en" | string = "zh-TW",
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";

  const locale = language === "en" ? "en-US" : language;
  // JPY/KRW conventionally have no decimals; default 0 fraction digits otherwise too,
  // since travel prices are typically whole-amount.
  const min = options?.minimumFractionDigits ?? 0;
  const max = options?.maximumFractionDigits ?? 0;

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    }).format(amount);
  } catch {
    // Fallback if currency isn't recognized by the runtime
    return `${currency} ${amount.toLocaleString(locale)}`;
  }
}

/**
 * Backwards-compatible "NT$" style for places that explicitly want the legacy
 * Taiwan-dollar look (admin internals where TWD is implicit).
 */
export function formatTWD(
  amount: number | null | undefined,
  language: "zh-TW" | "en" | string = "zh-TW"
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  if (language === "en") return formatPrice(amount, "TWD", "en");
  return `NT$${amount.toLocaleString("zh-TW")}`;
}

/**
 * Currency symbol for inline use in UI labels (e.g. "starting from $").
 */
export function currencySymbol(currency: SupportedCurrency): string {
  const map: Record<SupportedCurrency, string> = {
    TWD: "NT$",
    USD: "$",
    JPY: "¥",
    EUR: "€",
    CNY: "¥",
    KRW: "₩",
  };
  return map[currency] || currency;
}
