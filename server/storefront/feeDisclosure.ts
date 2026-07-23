/**
 * Batch P1a — fee disclosure pure helpers.
 *
 * MONEY RULE: every amount in this module is INTEGER MINOR UNITS per
 * ISO-4217 (e.g. 1 USD = 100 minor units, 1 JPY = 1 minor unit — NOT
 * "cents"). Sums are plain integer addition with an overflow guard — no
 * floats, no division, no rounding.
 *
 * CURRENCY RULE (Codex 2026-07-20 P1-2/P1-3): every total is a
 * CurrencyAmount { amountMinorUnits, currency }. Bare cross-currency
 * addition is forbidden — a contract whose fee lines mix currencies is
 * treated as INVALID data and surfaces as the honest
 * 'awaiting_supplier_quote' shape (fail-closed), never a fabricated sum.
 *
 * HONESTY RULE (Codex 2026-07-20 P1-4): incomplete data is NEVER dressed
 * up as 'published' with zero totals. A disclosure is published only when
 * the contract carries real, single-currency fee lines; the ONLY published
 * zero-total case is an explicitly-evidenced confirmed-zero-fee contract:
 * contract.sourceStatus === 'confirmed' AND every line is an explicit
 * zero-amount item. A contract with NO fee items at all ⇒ awaiting
 * (documented fail-closed rule: absence of lines is missing data, not
 * evidence of "no fees").
 */
import type { FeeContract, FeeItem } from "../../drizzle/schema";
import { canonicalCurrencyCode } from "./availabilityBucket";

/** An amount that always carries its currency. Integer minor units only. */
export interface CurrencyAmount {
  amountMinorUnits: number;
  /** Canonical ISO-4217 code (uppercase). */
  currency: string;
}

/** Public shape of one disclosed fee line (subset of the feeItems row). */
export interface PublicFeeDto {
  feeId: string;
  category: FeeItem["category"];
  labelZh: string;
  labelEn: string;
  /** Integer minor units. */
  amountMinorUnits: number;
  /** Canonical ISO-4217 code (uppercase). */
  currency: string;
  unit: FeeItem["unit"];
  includedInPackgoCharge: boolean;
  requiredForTrip: boolean;
  payeeType: FeeItem["payeeType"];
  paymentTiming: FeeItem["paymentTiming"];
  sourceStatus: FeeItem["sourceStatus"];
  sortOrder: number;
}

export interface FeeTotals {
  /** Sum of category='mandatory', unit='per_person'. */
  mandatoryPerPerson: CurrencyAmount;
  /** Sum of category='tips', unit='per_person'. */
  tipsPerPerson: CurrencyAmount;
  /** Sum of category='self', unit='per_person'. */
  selfEstimatePerPerson: CurrencyAmount;
}

export interface PublicFeeDisclosure {
  status: "published" | "awaiting_supplier_quote";
  contractId: string | null;
  sourceStatus: FeeContract["sourceStatus"] | null;
  displayRegion: string | null;
  originMarket: string | null;
  /** Fees grouped by category, each group sorted by sortOrder. */
  feesByCategory: Record<FeeItem["category"], PublicFeeDto[]>;
  /** Flat list (same DTOs) for consumers that don't want grouping. */
  fees: PublicFeeDto[];
  /**
   * Currency-tagged per-person totals. null while awaiting — an absent
   * quote has NO totals; zero would be a fabricated claim.
   */
  totals: FeeTotals | null;
}

export const FEE_CATEGORIES: FeeItem["category"][] = [
  "mandatory",
  "tips",
  "self",
  "optional",
];

/**
 * Map a feeItems row to its public DTO (explicit allow-list, no spread).
 * Throws on non-integer amounts and unknown currency codes — corrupt
 * money data must fail loudly, never propagate.
 */
export function toPublicFeeDto(item: FeeItem): PublicFeeDto {
  if (!Number.isSafeInteger(item.amountMinorUnits)) {
    // Fail loudly rather than propagate a float into customer-facing math.
    throw new Error(
      `feeItems.${item.feeId}: amountMinorUnits must be a safe integer, got ${item.amountMinorUnits}`,
    );
  }
  return {
    feeId: item.feeId,
    category: item.category,
    labelZh: item.labelZh,
    labelEn: item.labelEn,
    amountMinorUnits: item.amountMinorUnits,
    currency: canonicalCurrencyCode(item.currency),
    unit: item.unit,
    includedInPackgoCharge: item.includedInPackgoCharge,
    requiredForTrip: item.requiredForTrip,
    payeeType: item.payeeType,
    paymentTiming: item.paymentTiming,
    sourceStatus: item.sourceStatus,
    sortOrder: item.sortOrder,
  };
}

/** Group DTOs by category, each group sorted by sortOrder ascending. */
export function groupFeesByCategory(
  fees: PublicFeeDto[],
): Record<FeeItem["category"], PublicFeeDto[]> {
  const grouped = {
    mandatory: [] as PublicFeeDto[],
    tips: [] as PublicFeeDto[],
    self: [] as PublicFeeDto[],
    optional: [] as PublicFeeDto[],
  };
  for (const fee of fees) grouped[fee.category].push(fee);
  for (const cat of FEE_CATEGORIES) {
    grouped[cat].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return grouped;
}

/** Overflow-guarded integer addition for minor-unit sums. */
function addMinorUnits(a: number, b: number, label: string): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new Error(`Fee total overflow while summing ${label}: ${a} + ${b}`);
  }
  return sum;
}

/**
 * Integer-only per-person totals in ONE declared currency.
 * - Only unit='per_person' lines are summed — a per_booking fee is not a
 *   per-person amount and mixing them would overstate the per-person figure.
 * - Every summed line MUST match `currency` (canonical compare); a
 *   mismatch throws — bare cross-currency addition is forbidden.
 */
export function computeFeeTotals(fees: PublicFeeDto[], currency: string): FeeTotals {
  const canonical = canonicalCurrencyCode(currency);
  let mandatory = 0;
  let tips = 0;
  let selfEstimate = 0;
  for (const fee of fees) {
    if (canonicalCurrencyCode(fee.currency) !== canonical) {
      throw new Error(
        `Cross-currency fee addition forbidden: fee "${fee.feeId}" is ${fee.currency}, totals are ${canonical}`,
      );
    }
    if (fee.unit !== "per_person") continue;
    if (fee.category === "mandatory") {
      mandatory = addMinorUnits(mandatory, fee.amountMinorUnits, "mandatory");
    } else if (fee.category === "tips") {
      tips = addMinorUnits(tips, fee.amountMinorUnits, "tips");
    } else if (fee.category === "self") {
      selfEstimate = addMinorUnits(selfEstimate, fee.amountMinorUnits, "self");
    }
  }
  return {
    mandatoryPerPerson: { amountMinorUnits: mandatory, currency: canonical },
    tipsPerPerson: { amountMinorUnits: tips, currency: canonical },
    selfEstimatePerPerson: { amountMinorUnits: selfEstimate, currency: canonical },
  };
}

/**
 * The honest empty disclosure: no published/complete contract ⇒ say so,
 * fabricate nothing. totals is null — an absent quote has no totals.
 */
export function awaitingSupplierQuoteDisclosure(): PublicFeeDisclosure {
  return {
    status: "awaiting_supplier_quote",
    contractId: null,
    sourceStatus: null,
    displayRegion: null,
    originMarket: null,
    feesByCategory: { mandatory: [], tips: [], self: [], optional: [] },
    fees: [],
    totals: null,
  };
}

/**
 * Build the full public disclosure from a resolved contract + its items.
 *
 * FAIL-CLOSED gates (all fall back to the honest awaiting shape):
 *   1. contract.sourceStatus === 'awaiting_supplier_quote' — even if the
 *      row was (wrongly) flipped to status='published', missing supplier
 *      data is never presented as a published disclosure.
 *   2. No fee items — absence of lines is missing data, not evidence of
 *      zero fees (documented rule; a genuine zero-fee contract must carry
 *      explicit zero-amount lines).
 *   3. Any item with an invalid/unknown currency code.
 *   4. Mixed currencies across items — cross-currency totals are
 *      meaningless; the contract is treated as invalid/awaiting.
 *   5. All lines are zero-amount but the contract is NOT
 *      sourceStatus='confirmed' — published zero requires explicit
 *      confirmed evidence.
 */
export function buildFeeDisclosure(
  contract: FeeContract,
  items: FeeItem[],
): PublicFeeDisclosure {
  if (contract.sourceStatus === "awaiting_supplier_quote") {
    return awaitingSupplierQuoteDisclosure(); // gate 1
  }
  if (items.length === 0) {
    return awaitingSupplierQuoteDisclosure(); // gate 2
  }

  let fees: PublicFeeDto[];
  try {
    fees = items.map(toPublicFeeDto);
  } catch {
    return awaitingSupplierQuoteDisclosure(); // gate 3 — bad currency/amount data
  }

  const currencies = new Set(fees.map((f) => f.currency));
  if (currencies.size !== 1) {
    return awaitingSupplierQuoteDisclosure(); // gate 4 — mixed-currency contract
  }

  const allZero = fees.every((f) => f.amountMinorUnits === 0);
  if (allZero && contract.sourceStatus !== "confirmed") {
    return awaitingSupplierQuoteDisclosure(); // gate 5 — unevidenced zero-fee claim
  }

  const [contractCurrency] = currencies;
  const feesByCategory = groupFeesByCategory(fees);
  return {
    status: "published",
    contractId: contract.contractId,
    sourceStatus: contract.sourceStatus,
    displayRegion: contract.displayRegion ?? null,
    originMarket: contract.originMarket ?? null,
    feesByCategory,
    fees,
    totals: computeFeeTotals(fees, contractCurrency),
  };
}

/**
 * Is `contract` valid on `date`? NULL bounds are open-ended.
 * validFrom <= date <= validTo.
 */
export function isContractValidOn(
  contract: Pick<FeeContract, "validFrom" | "validTo">,
  date: Date,
): boolean {
  const t = date.getTime();
  if (contract.validFrom && t < new Date(contract.validFrom).getTime()) return false;
  if (contract.validTo && t > new Date(contract.validTo).getTime()) return false;
  return true;
}
