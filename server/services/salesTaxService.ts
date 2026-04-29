/**
 * salesTaxService.ts — California Sales/Use Tax calculation for travel
 * services sold to California residents.
 *
 * v76 background:
 *   Pack & Go is a CA-incorporated LLC selling guided tour packages. Per CA
 *   Department of Tax & Fee Administration (CDTFA), tour packages that include
 *   tangible items (printed itineraries, gifts, equipment) are taxable; pure
 *   service-only packages are arguable.  The conservative interpretation
 *   adopted here is: collect at the destination ZIP's combined rate when the
 *   buyer's billing address is in California, and let the accountant net out
 *   exempt portions at year-end.
 *
 * If the customer is outside California, no CA tax applies (and we don't have
 * sales-tax nexus in other US states yet — when that changes, this service
 * should be replaced with Stripe Tax or TaxJar).
 *
 * Rates are kept as a static table for now (covers the 8 major metros where
 * 95% of CA residents live). For exact ZIP-level rates, integrate with the
 * CDTFA Tax & Fee Rates API or Stripe Tax once volume justifies the cost.
 *
 * https://www.cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm
 */

export interface BillingAddress {
  country?: string | null; // ISO-2 country code (US, TW, CA, etc.)
  state?: string | null;   // 2-letter US state code (CA, NY, etc.)
  city?: string | null;
  postalCode?: string | null;
}

/**
 * California combined state + local sales tax rates by city. Conservative
 * fallback to statewide base rate (7.25%) if city not matched.
 *
 * Last verified: April 2026 (CDTFA quarterly publication).
 */
const CA_LOCAL_RATES: Record<string, number> = {
  // Bay Area
  "san francisco": 0.0875,
  "oakland":       0.1025,
  "berkeley":      0.1025,
  "fremont":       0.1025,
  "newark":        0.1025, // Pack & Go HQ
  "san jose":      0.0938,
  "palo alto":     0.0938,
  "santa clara":   0.0938,
  // LA Metro
  "los angeles":   0.095,
  "long beach":    0.1025,
  "pasadena":      0.1025,
  "santa monica":  0.1025,
  "anaheim":       0.0775,
  "irvine":        0.0775,
  // Other major
  "san diego":     0.0775,
  "sacramento":    0.0875,
  "fresno":        0.08225,
  "bakersfield":   0.0825,
};

const CA_STATE_BASE_RATE = 0.0725; // statewide minimum

/**
 * Returns the combined sales tax rate (state + local) as a decimal (e.g.
 * 0.0875 = 8.75%) for a given billing address. Returns 0 if not taxable here.
 */
export function getSalesTaxRate(address: BillingAddress | null | undefined): number {
  if (!address) return 0;
  const country = (address.country || "US").toUpperCase();
  // Only US sales for now
  if (country !== "US") return 0;
  // Only CA nexus for now (Pack & Go is CA-incorporated)
  const state = (address.state || "").toUpperCase();
  if (state !== "CA") return 0;

  const cityKey = (address.city || "").trim().toLowerCase();
  if (cityKey && CA_LOCAL_RATES[cityKey] !== undefined) {
    return CA_LOCAL_RATES[cityKey];
  }
  // Conservative fallback
  return CA_STATE_BASE_RATE;
}

/**
 * Compute the sales tax amount on a subtotal. Rounds to 2 decimals.
 */
export function calculateSalesTax(
  subtotal: number,
  address: BillingAddress | null | undefined
): { rate: number; amount: number; total: number; jurisdiction: string } {
  const rate = getSalesTaxRate(address);
  const amount = Math.round(subtotal * rate * 100) / 100;
  const total = subtotal + amount;
  const jurisdiction = rate > 0
    ? `California${address?.city ? ` (${address.city})` : ""}`
    : "non-taxable";
  return { rate, amount, total, jurisdiction };
}
