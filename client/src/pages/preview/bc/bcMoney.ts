/**
 * Batch P1c — BC storefront money formatting (client side, render-only).
 *
 * MONEY RULE (mirrors server/storefront/feeDisclosure.ts): every amount that
 * reaches this module is an INTEGER in ISO-4217 minor units. State never
 * holds floats — division by the currency exponent happens HERE, at render
 * time, and the result goes straight into Intl.NumberFormat output.
 *
 * CURRENCY RULE (Codex 2026-07-22 P1-4): the minor-unit exponent comes from
 * an EXPLICIT allow-list, never from Intl (Intl silently formats unknown
 * ISO-shaped codes like "ZZZ" with a guessed exponent of 2). Unknown or
 * malformed codes throw — fail-closed, never a display guess.
 *
 * CROSS-CURRENCY RULE (Codex 2026-07-22 P1-5): minor units of different
 * currencies are NEVER compared or added. This module only ever formats or
 * adds amounts the caller has already proven share one currency.
 */

/**
 * Client copy of the server's frozen currency table.
 *
 * PINNED to CURRENCY_MINOR_UNIT_EXPONENT in
 * server/storefront/availabilityBucket.ts — same codes, same exponents.
 * The server file is frozen surface and is not importable from the client
 * bundle, so the values are duplicated here verbatim; bcMoney.test.ts
 * asserts every entry matches the server's minorUnitExponent() so drift
 * fails tests.
 */
export const BC_CURRENCY_MINOR_UNIT_EXPONENT: Readonly<Record<string, 0 | 2 | 3>> = {
  // 0-decimal (minor unit == major unit)
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  // 3-decimal
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  // 2-decimal (explicit allow-list — NOT a default)
  AED: 2, AUD: 2, BRL: 2, CAD: 2, CHF: 2, CNY: 2, CZK: 2, DKK: 2,
  EUR: 2, GBP: 2, HKD: 2, IDR: 2, ILS: 2, INR: 2, MOP: 2, MXN: 2,
  MYR: 2, NOK: 2, NZD: 2, PHP: 2, PLN: 2, SAR: 2, SEK: 2, SGD: 2,
  THB: 2, TRY: 2, TWD: 2, USD: 2, ZAR: 2,
};

/**
 * Minor-unit exponent for a currency, from the explicit allow-list above.
 * Malformed (non-3-letter) AND unknown-but-well-formed codes (ZZZ, AAA)
 * both throw — fail-closed, mirroring the server's canonicalCurrencyCode.
 */
export function currencyExponent(currency: string): number {
  const canonical = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(canonical)) {
    throw new Error(`Invalid currency code "${currency}" (expected 3 letters)`);
  }
  const exponent = BC_CURRENCY_MINOR_UNIT_EXPONENT[canonical];
  if (exponent === undefined) {
    throw new Error(
      `Unknown currency code "${canonical}" — refusing to guess a minor-unit exponent`,
    );
  }
  return exponent;
}

/**
 * Format integer minor units for display (e.g. 155000 USD ⇒ "US$1,550",
 * 12000 JPY ⇒ "¥12,000"). Whole amounts drop the fraction; non-whole
 * amounts keep the currency's full precision (e.g. 155050 USD ⇒
 * "US$1,550.50"). Locale defaults to zh-TW per the BC design ruling.
 */
export function formatMinorUnits(
  amountMinorUnits: number,
  currency: string,
  locale: string = "zh-TW",
): string {
  if (!Number.isSafeInteger(amountMinorUnits)) {
    throw new Error(
      `formatMinorUnits expects integer minor units, got ${amountMinorUnits}`,
    );
  }
  const exponent = currencyExponent(currency);
  const divisor = 10 ** exponent;
  const isWhole = amountMinorUnits % divisor === 0;
  const value = amountMinorUnits / divisor;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.trim().toUpperCase(),
    minimumFractionDigits: isWhole ? 0 : exponent,
    maximumFractionDigits: isWhole ? 0 : exponent,
  }).format(value);
}

/**
 * Overflow-guarded integer addition for minor-unit sums (client mirror of
 * the server helper). Used only to combine already-integer amounts of the
 * SAME currency before a single render-time format call.
 */
export function addMinorUnits(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    throw new Error(`addMinorUnits expects safe integers, got ${a} + ${b}`);
  }
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new Error(`addMinorUnits overflow: ${a} + ${b}`);
  }
  return sum;
}
