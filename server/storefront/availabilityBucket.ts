/**
 * Batch P1a — public availability buckets + public-DTO safety guards.
 *
 * Jeff's 2026-07-20 ruling: the public storefront shows availability as
 * EXACTLY three buckets — 充足 / 少量 / 候補. There is no fourth public
 * state: departures that are not on sale (supplier 停售, cancelled groups)
 * are EXCLUDED from public listings entirely, represented here as `null`.
 *
 * Round 2 (Codex 2026-07-20 P0-1): public availability comes ONLY from
 * trusted supplier availability data (supplierDepartures.availability,
 * resolved through the tour → supplierProducts linkage). The local
 * tourDepartures totalSlots/bookedSlots mirror is an internal ops signal
 * and must NEVER be presented as public sellability — the previous
 * seat-count derivation has been removed entirely. A departure with no
 * trusted supplier evidence is not publicly listed at all.
 *
 * CRITICAL INVARIANT (enforced by types + runtime guard + tests):
 * public DTOs built by this module never contain raw seat counts
 * (totalSlots, bookedSlots, spareSeats, totalSeats, availableSeats) nor
 * any cost/agent price (agentPrice, supplierCost). Seat numbers are a
 * competitive/ops signal; agent prices are supplier cost — neither is
 * customer-facing, ever.
 */

/** The only three availability states the public may see. */
export type PublicAvailabilityBucket = "plenty" | "few" | "waitlist";

/**
 * i18n label keys per bucket (display words 充足 / 少量 / 候補 live in the
 * i18n dictionaries, never hardcoded here or in JSX).
 */
export const BUCKET_LABEL_KEYS: Record<PublicAvailabilityBucket, string> = {
  plenty: "storefront.availability.plenty",
  few: "storefront.availability.few",
  waitlist: "storefront.availability.waitlist",
};

/** supplierDepartures.availability — the ONLY trusted public availability source. */
export type SupplierAvailability = "available" | "limited" | "full" | "unavailable";

/**
 * Map a supplierDepartures.availability value to a public bucket.
 * 'unavailable' (供應商停售) ⇒ null ⇒ the departure is excluded from
 * public listings — it is NOT a fourth public state.
 *
 * This is the ONLY availability mapper: there is no local seat-count
 * fallback anywhere in the public path (Codex 2026-07-20 P0-1).
 */
export function bucketFromSupplierAvailability(
  availability: SupplierAvailability,
): PublicAvailabilityBucket | null {
  switch (availability) {
    case "available":
      return "plenty";
    case "limited":
      return "few";
    case "full":
      return "waitlist";
    case "unavailable":
      return null; // excluded from public listings entirely
  }
}

// ── Forbidden-field guard ────────────────────────────────────────────────

/**
 * Keys that must NEVER appear anywhere (at any depth) in a public DTO.
 * Seat counts + cost/agent prices.
 */
export const FORBIDDEN_PUBLIC_FIELDS = [
  "totalSlots",
  "bookedSlots",
  "spareSeats",
  "totalSeats",
  "availableSeats",
  "agentPrice",
  "supplierCost",
] as const;

export type ForbiddenPublicField = (typeof FORBIDDEN_PUBLIC_FIELDS)[number];

type PublicSafePrimitive = string | number | boolean | null | undefined | Date;

/**
 * Type-level DEEP scan: resolves to `true` when T (or any nested object /
 * array element type within it) declares a forbidden seat/cost key.
 */
type HasForbiddenFieldDeep<T> = T extends PublicSafePrimitive
  ? false
  : T extends (infer U)[]
    ? HasForbiddenFieldDeep<U>
    : T extends object
      ? keyof T & ForbiddenPublicField extends never
        ? true extends { [K in keyof T]-?: HasForbiddenFieldDeep<T[K]> }[keyof T]
          ? true
          : false
        : true
      : false;

/**
 * Type-level guard: `PublicSafe<T>` only compiles to T when T contains no
 * forbidden key AT ANY DEPTH (nested objects and array elements included).
 * Used on the return types of ALL public endpoints/builders so a future
 * edit that adds e.g. `totalSlots` anywhere inside a public DTO fails
 * typecheck.
 *
 * UNION FAIL-CLOSED (Codex 2026-07-21 P2-2): HasForbiddenFieldDeep
 * distributes over a naked top-level union, so `Safe | Unsafe` yields
 * `false | true` (= boolean). The previous `... extends true` check let
 * that boolean pass (fail-open). `true extends ...` instead asks "does ANY
 * branch resolve to true" — one unsafe union branch poisons the whole
 * type.
 */
export type PublicSafe<T> = true extends HasForbiddenFieldDeep<T>
  ? { __error__: "public DTO contains a forbidden seat/cost field" }
  : T;

// ── PublicSafe compile-time regression gate (Codex 2026-07-21 P2-2) ──────
// tsconfig excludes **/*.test.ts from `pnpm check`, so the ENFORCING
// compile-time assertions live here, in a type-checked source file: if
// PublicSafe ever fails open again (e.g. the `true extends` check reverts
// to `extends true`), `pnpm check` stops compiling on these lines.
// (availabilityBucket.test.ts mirrors these as @ts-expect-error cases for
// IDE-level checking.)
type StaticAssert<T extends true> = T;
type _SafeBranch = { id: number };
type _ForbiddenBranch = { agentPrice: string };
/** A TOP-LEVEL union with one forbidden branch must be rejected as a whole. */
export type PublicSafeRejectsTopLevelUnion = StaticAssert<
  PublicSafe<_SafeBranch | _ForbiddenBranch> extends { __error__: string }
    ? true
    : false
>;
/** An array of such a union must be rejected too. */
export type PublicSafeRejectsUnionArray = StaticAssert<
  PublicSafe<(_SafeBranch | _ForbiddenBranch)[]> extends { __error__: string }
    ? true
    : false
>;
/** A directly forbidden type stays rejected. */
export type PublicSafeRejectsForbiddenType = StaticAssert<
  PublicSafe<_ForbiddenBranch> extends { __error__: string } ? true : false
>;
/** A fully safe union must still pass through untouched. */
export type PublicSafeAcceptsSafeUnion = StaticAssert<
  PublicSafe<_SafeBranch | { name: string }> extends { __error__: string }
    ? false
    : true
>;

/**
 * Runtime guard: deep-walk `value` and throw if any forbidden key exists at
 * any depth. Called on EVERY public return path (including early returns)
 * as a safety net behind the type guard (types can be bypassed with
 * `as any` or by JSON columns; this cannot).
 */
export function assertNoForbiddenPublicFields(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenPublicFields(item, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((FORBIDDEN_PUBLIC_FIELDS as readonly string[]).includes(key)) {
        throw new Error(
          `Public DTO invariant violated: forbidden field "${key}" at ${path}.${key}`,
        );
      }
      assertNoForbiddenPublicFields(child, `${path}.${key}`);
    }
  }
}

/**
 * Belt-and-suspenders deep strip: returns a copy of `value` with every
 * forbidden key removed at every depth. DTO builders construct fields
 * explicitly (allow-list), so this is a last line of defense for objects
 * assembled elsewhere.
 */
export function stripForbiddenFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripForbiddenFields(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((FORBIDDEN_PUBLIC_FIELDS as readonly string[]).includes(key)) continue;
      out[key] = stripForbiddenFields(child);
    }
    return out as T;
  }
  return value;
}

// ── Canonical, fail-closed ISO-4217 minor-unit exponents ─────────────────

/**
 * ISO-4217 minor-unit exponents. Canonical and FAIL-CLOSED:
 *   - 0-, 2- and 3-decimal currencies are listed explicitly;
 *   - an unknown code is NEVER silently treated as 2-decimal — it throws;
 *   - codes are canonicalized (trimmed, uppercased) before lookup.
 * (Codex 2026-07-20 P1-3: the previous 4-entry table defaulted unknown
 * codes to exponent 2, which mis-prices JPY-family and KWD-family codes.)
 */
const CURRENCY_MINOR_UNIT_EXPONENT: Readonly<Record<string, 0 | 2 | 3>> = {
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
 * Canonicalize a currency code: trim + uppercase, then require it to be a
 * known ISO-4217 code from the exponent table. Unknown / malformed codes
 * throw — never guessed at (fail-closed).
 */
export function canonicalCurrencyCode(code: string): string {
  const canonical = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(canonical)) {
    throw new Error(`Invalid currency code "${code}" (expected 3 letters)`);
  }
  if (!(canonical in CURRENCY_MINOR_UNIT_EXPONENT)) {
    throw new Error(
      `Unknown currency code "${canonical}" — refusing to guess a minor-unit exponent`,
    );
  }
  return canonical;
}

/** Minor-unit exponent for a (canonicalizable) currency. Unknown ⇒ throw. */
export function minorUnitExponent(currency: string): number {
  return CURRENCY_MINOR_UNIT_EXPONENT[canonicalCurrencyCode(currency)];
}

/**
 * Integer-only whole-units → minor-units conversion with overflow guard.
 * Unknown currency ⇒ throw (never a silent exponent-2 default).
 */
export function toMinorUnits(wholeUnits: number, currency: string): number {
  if (!Number.isSafeInteger(wholeUnits)) {
    throw new Error(`toMinorUnits expects a safe integer amount, got ${wholeUnits}`);
  }
  const exponent = minorUnitExponent(currency);
  const result = wholeUnits * 10 ** exponent;
  if (!Number.isSafeInteger(result)) {
    throw new Error(
      `toMinorUnits overflow: ${wholeUnits} × 10^${exponent} exceeds Number.MAX_SAFE_INTEGER`,
    );
  }
  return result;
}

// ── Public departure DTO builder ─────────────────────────────────────────

/** What the public may know about one departure. Nothing else. */
export interface PublicDepartureDto {
  /** tourDepartures.id — needed by the booking flow to reference the date. */
  id: number;
  departureDate: Date;
  returnDate: Date;
  /** Retail price only, integer minor units. Never agent/cost price. */
  pricePerPersonMinorUnits: number;
  currency: string;
  bucket: PublicAvailabilityBucket;
  /** i18n label key (充足/少量/候補 resolved client-side via t()). */
  displayStatusKey: string;
}

/**
 * Build the public DTO for a departure. The bucket comes EXCLUSIVELY from
 * the trusted supplier availability the caller resolved for this
 * departure date (Codex 2026-07-20 P0-1) — never from local slot counts.
 * Returns null when the supplier state maps to no public bucket
 * (停售 ⇒ excluded from public listings).
 * Explicit allow-list construction + runtime deep guard.
 */
export function buildPublicDepartureDto(
  dep: {
    id: number;
    departureDate: Date;
    returnDate: Date;
    adultPrice: number;
    currency: string;
  },
  supplierAvailability: SupplierAvailability,
): PublicSafe<PublicDepartureDto> | null {
  const bucket = bucketFromSupplierAvailability(supplierAvailability);
  if (bucket === null) return null;
  const dto: PublicDepartureDto = {
    id: dep.id,
    departureDate: dep.departureDate,
    returnDate: dep.returnDate,
    pricePerPersonMinorUnits: toMinorUnits(dep.adultPrice, dep.currency),
    currency: canonicalCurrencyCode(dep.currency),
    bucket,
    displayStatusKey: BUCKET_LABEL_KEYS[bucket],
  };
  assertNoForbiddenPublicFields(dto);
  return dto as PublicSafe<PublicDepartureDto>;
}
