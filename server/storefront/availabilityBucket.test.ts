/**
 * Batch P1a — availability bucket mapping + forbidden-field guard +
 * fail-closed currency table tests.
 *
 * Jeff's 2026-07-20 ruling: public availability is EXACTLY three buckets
 * (充足/少量/候補); not-on-sale departures are excluded entirely (null).
 * Round 2 (Codex P0-1): the ONLY availability source is the supplier
 * mapper — the local seat-count derivation no longer exists.
 */
import { describe, expect, it } from "vitest";
import {
  BUCKET_LABEL_KEYS,
  FORBIDDEN_PUBLIC_FIELDS,
  assertNoForbiddenPublicFields,
  bucketFromSupplierAvailability,
  buildPublicDepartureDto,
  canonicalCurrencyCode,
  minorUnitExponent,
  stripForbiddenFields,
  toMinorUnits,
  type PublicDepartureDto,
  type PublicSafe,
} from "./availabilityBucket";
import * as availabilityModule from "./availabilityBucket";

describe("bucketFromSupplierAvailability — the only availability mapper", () => {
  it.each([
    ["available", "plenty"],
    ["limited", "few"],
    ["full", "waitlist"],
  ] as const)("maps supplier '%s' → '%s'", (supplier, bucket) => {
    expect(bucketFromSupplierAvailability(supplier)).toBe(bucket);
  });

  it("maps 'unavailable' (停售) → null (excluded, not a fourth state)", () => {
    expect(bucketFromSupplierAvailability("unavailable")).toBeNull();
  });

  it("the local seat-count bucket function is GONE (Codex P0-1)", () => {
    // No production path may derive public availability from local
    // totalSlots/bookedSlots; the former helper must not exist at all.
    expect((availabilityModule as any).bucketFromTourDeparture).toBeUndefined();
    expect((availabilityModule as any).bucketFromNativeSeats).toBeUndefined();
    expect((availabilityModule as any).PLENTY_MIN_REMAINING_SEATS).toBeUndefined();
  });
});

describe("BUCKET_LABEL_KEYS", () => {
  it("covers exactly the three public buckets with i18n keys", () => {
    expect(Object.keys(BUCKET_LABEL_KEYS).sort()).toEqual(["few", "plenty", "waitlist"]);
    for (const key of Object.values(BUCKET_LABEL_KEYS)) {
      expect(key).toMatch(/^storefront\.availability\./);
    }
  });
});

describe("canonical fail-closed ISO-4217 currency table", () => {
  it("2-decimal currencies (USD/TWD/EUR)", () => {
    expect(minorUnitExponent("USD")).toBe(2);
    expect(minorUnitExponent("TWD")).toBe(2);
    expect(minorUnitExponent("EUR")).toBe(2);
  });

  it("0-decimal currencies (JPY/KRW/VND)", () => {
    expect(minorUnitExponent("JPY")).toBe(0);
    expect(minorUnitExponent("KRW")).toBe(0);
    expect(minorUnitExponent("VND")).toBe(0);
  });

  it("3-decimal currencies (KWD/BHD/JOD)", () => {
    expect(minorUnitExponent("KWD")).toBe(3);
    expect(minorUnitExponent("BHD")).toBe(3);
    expect(minorUnitExponent("JOD")).toBe(3);
  });

  it("unknown code THROWS — never silently defaults to 2 (fail-closed)", () => {
    expect(() => minorUnitExponent("ZZZ")).toThrow(/Unknown currency/);
    expect(() => toMinorUnits(100, "ZZZ")).toThrow(/Unknown currency/);
  });

  it("malformed codes throw", () => {
    expect(() => canonicalCurrencyCode("US")).toThrow(/Invalid currency/);
    expect(() => canonicalCurrencyCode("USDT")).toThrow(/Invalid currency/);
    expect(() => canonicalCurrencyCode("U$D")).toThrow(/Invalid currency/);
    expect(() => canonicalCurrencyCode("")).toThrow(/Invalid currency/);
  });

  it("case-insensitive canonicalization: 'jpy' and ' usd ' resolve correctly", () => {
    expect(canonicalCurrencyCode("jpy")).toBe("JPY");
    expect(canonicalCurrencyCode(" usd ")).toBe("USD");
    expect(minorUnitExponent("jpy")).toBe(0);
    expect(minorUnitExponent("kwd")).toBe(3);
  });
});

describe("toMinorUnits (integer money math)", () => {
  it("converts whole USD to integer minor units", () => {
    expect(toMinorUnits(1998, "USD")).toBe(199800);
  });
  it("JPY is zero-decimal — amount unchanged", () => {
    expect(toMinorUnits(50000, "JPY")).toBe(50000);
  });
  it("KWD is three-decimal", () => {
    expect(toMinorUnits(150, "KWD")).toBe(150000);
  });
  it("lowercase currency codes work (canonicalized)", () => {
    expect(toMinorUnits(50000, "jpy")).toBe(50000);
  });
  it("always returns integers", () => {
    expect(Number.isInteger(toMinorUnits(123456, "TWD"))).toBe(true);
  });
  it("rejects non-integer input instead of silently flooring", () => {
    expect(() => toMinorUnits(19.99, "USD")).toThrow(/integer/);
  });
  it("overflow guard: result beyond MAX_SAFE_INTEGER throws", () => {
    expect(() => toMinorUnits(Number.MAX_SAFE_INTEGER - 1, "USD")).toThrow(/overflow/);
    expect(() => toMinorUnits(Number.MAX_SAFE_INTEGER - 1, "KWD")).toThrow(/overflow/);
    // 0-decimal safe integer passes through untouched
    expect(toMinorUnits(Number.MAX_SAFE_INTEGER - 1, "JPY")).toBe(
      Number.MAX_SAFE_INTEGER - 1,
    );
  });
});

describe("forbidden-field guard", () => {
  it("guards the full seat/cost list", () => {
    expect([...FORBIDDEN_PUBLIC_FIELDS].sort()).toEqual(
      [
        "agentPrice",
        "availableSeats",
        "bookedSlots",
        "spareSeats",
        "supplierCost",
        "totalSeats",
        "totalSlots",
      ].sort(),
    );
  });

  it.each([...FORBIDDEN_PUBLIC_FIELDS])(
    "assertNoForbiddenPublicFields throws on top-level '%s'",
    (field) => {
      expect(() => assertNoForbiddenPublicFields({ [field]: 1 })).toThrow(field);
    },
  );

  it("throws on deeply nested forbidden keys (arrays + objects)", () => {
    const nested = { list: [{ inner: { departures: [{ agentPrice: "99.00" }] } }] };
    expect(() => assertNoForbiddenPublicFields(nested)).toThrow("agentPrice");
  });

  it("passes clean objects", () => {
    expect(() =>
      assertNoForbiddenPublicFields({ id: 1, bucket: "plenty", nested: [{ ok: true }] }),
    ).not.toThrow();
  });

  it("stripForbiddenFields deep-removes every forbidden key", () => {
    const dirty = {
      id: 1,
      totalSlots: 20,
      nested: { bookedSlots: 5, keep: "yes", deeper: [{ spareSeats: 2, agentPrice: 1 }] },
    };
    const clean = stripForbiddenFields(dirty) as any;
    expect(clean).toEqual({ id: 1, nested: { keep: "yes", deeper: [{}] } });
    expect(() => assertNoForbiddenPublicFields(clean)).not.toThrow();
  });
});

describe("PublicSafe type-level guard — compile-time regressions (Codex 2026-07-21 P2-2)", () => {
  // NOTE: tsconfig excludes **/*.test.ts from `pnpm check`, so the
  // ENFORCING compile-time assertions live in availabilityBucket.ts
  // (PublicSafeRejectsTopLevelUnion etc. — those break `pnpm check` on any
  // fail-open regression). The @ts-expect-error cases below mirror them at
  // IDE/tsserver level, and their runtime expects document the shapes.
  type SafeShape = { id: number; nested: { ok: boolean } };
  type UnsafeShape = { agentPrice: string };

  it("accepts a fully safe type (and a fully safe union)", () => {
    const ok: PublicSafe<SafeShape> = { id: 1, nested: { ok: true } };
    const okUnion: PublicSafe<SafeShape | { name: string }> = { name: "x" };
    const okDto: PublicSafe<PublicDepartureDto> extends { __error__: string }
      ? never
      : true = true;
    expect(ok.id).toBe(1);
    expect(okUnion).toBeDefined();
    expect(okDto).toBe(true);
  });

  it("rejects a directly forbidden type", () => {
    // @ts-expect-error a type declaring agentPrice must not compile as PublicSafe
    const bad: PublicSafe<UnsafeShape> = { agentPrice: "999.00" };
    expect(bad).toBeDefined();
  });

  it("rejects forbidden fields nested in objects and array elements", () => {
    // @ts-expect-error nested totalSlots must be caught at depth
    const badNested: PublicSafe<{ inner: { totalSlots: number } }> = {
      inner: { totalSlots: 20 },
    };
    // @ts-expect-error array-element spareSeats must be caught at depth
    const badArray: PublicSafe<{ list: { spareSeats: number }[] }> = {
      list: [{ spareSeats: 3 }],
    };
    expect(badNested).toBeDefined();
    expect(badArray).toBeDefined();
  });

  it("FAIL-CLOSED on a TOP-LEVEL union containing one forbidden branch", () => {
    // Regression for the fail-open bug: HasForbiddenFieldDeep distributes
    // over `SafeShape | UnsafeShape` into `false | true` (= boolean), and the
    // old `extends true` check let the whole union through. One unsafe
    // branch must poison the entire type.
    type UnionResult = PublicSafe<SafeShape | UnsafeShape>;
    const rejected: UnionResult = {
      __error__: "public DTO contains a forbidden seat/cost field",
    };
    // @ts-expect-error the SAFE branch is no longer assignable either — the union is rejected as a whole
    const safeBranch: UnionResult = { id: 1, nested: { ok: true } };
    // @ts-expect-error the unsafe branch is rejected
    const unsafeBranch: UnionResult = { agentPrice: "999.00" };
    expect(rejected.__error__).toContain("forbidden");
    expect(safeBranch).toBeDefined();
    expect(unsafeBranch).toBeDefined();
  });

  it("FAIL-CLOSED on a top-level union nested inside arrays/promise-like wrappers", () => {
    type ListResult = PublicSafe<(SafeShape | UnsafeShape)[]>;
    // @ts-expect-error an array of a poisoned union is rejected as a whole
    const badList: ListResult = [{ id: 1, nested: { ok: true } }];
    expect(badList).toBeDefined();
  });
});

describe("buildPublicDepartureDto — supplier availability is the only source", () => {
  const base = {
    id: 7,
    departureDate: new Date("2026-09-14T00:00:00Z"),
    returnDate: new Date("2026-09-19T00:00:00Z"),
    adultPrice: 1998,
    currency: "USD",
  };

  it("builds a bucket + retail-minor-units DTO with a label key", () => {
    const dto = buildPublicDepartureDto(base, "available")!;
    expect(dto).toEqual({
      id: 7,
      departureDate: base.departureDate,
      returnDate: base.returnDate,
      pricePerPersonMinorUnits: 199800,
      currency: "USD",
      bucket: "plenty",
      displayStatusKey: "storefront.availability.plenty",
    });
  });

  it("maps supplier limited/full to few/waitlist", () => {
    expect(buildPublicDepartureDto(base, "limited")!.bucket).toBe("few");
    expect(buildPublicDepartureDto(base, "full")!.bucket).toBe("waitlist");
  });

  it("returns null for supplier 停售 (unavailable) — excluded", () => {
    expect(buildPublicDepartureDto(base, "unavailable")).toBeNull();
  });

  it("never leaks any forbidden field even when inputs are poisoned", () => {
    // Simulate a raw row that carries seat counts + agent price.
    const poisoned = {
      ...base,
      totalSlots: 20,
      bookedSlots: 3,
      spareSeats: 17,
      agentPrice: "999.00",
    } as any;
    const dto = buildPublicDepartureDto(poisoned, "available")!;
    for (const field of FORBIDDEN_PUBLIC_FIELDS) {
      expect(Object.keys(dto)).not.toContain(field);
    }
    expect(() => assertNoForbiddenPublicFields(dto)).not.toThrow();
  });
});
