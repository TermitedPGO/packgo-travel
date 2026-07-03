import { describe, it, expect } from "vitest";
import { appleEpochToIso } from "./appleEpoch";

// Computed independently of the impl (not imported) so the boundary-year
// tests below are a genuine cross-check, not a tautology against the same
// constant the implementation uses.
const APPLE_EPOCH_OFFSET_SECONDS_FOR_TEST =
  new Date("2001-01-01T00:00:00Z").getTime() / 1000; // 978307200

// Fixture computed the same way the impl derives its offset (not hand-copied):
// new Date("2001-01-01T00:00:00Z").getTime() / 1000 === 978307200
// target 2024-06-15T12:00:00Z:
//   seconds since Apple epoch     = 740145600
//   nanoseconds since Apple epoch = 740145600000000000
const SECONDS_2024_06_15 = 740145600;
const NANOSECONDS_2024_06_15 = 740145600000000000;
// A second legacy-format fixture, distinct calendar day (2018-03-10), whose
// nanoseconds interpretation resolves to an implausible year (~2001) — this
// specifically exercises the "falls through nanoseconds, lands on seconds"
// branch rather than accidentally passing the nanoseconds check too.
const SECONDS_2018_03_10 = 542332800;

describe("appleEpochToIso", () => {
  it("resolves a modern nanoseconds-format value to the correct ISO date", () => {
    expect(appleEpochToIso(NANOSECONDS_2024_06_15)).toBe("2024-06-15T12:00:00.000Z");
  });

  it("resolves a legacy seconds-format value to the SAME calendar date", () => {
    expect(appleEpochToIso(SECONDS_2024_06_15)).toBe("2024-06-15T12:00:00.000Z");
  });

  it("both unit interpretations agree on 2024-06-15 (cross-check)", () => {
    const fromNano = appleEpochToIso(NANOSECONDS_2024_06_15);
    const fromSec = appleEpochToIso(SECONDS_2024_06_15);
    expect(fromNano).toBe(fromSec);
  });

  it("resolves rawValue=0 to the Apple epoch start (2001-01-01T00:00:00Z)", () => {
    expect(appleEpochToIso(0)).toBe("2001-01-01T00:00:00.000Z");
  });

  it("resolves a second legacy-format seconds fixture on a different calendar day", () => {
    expect(appleEpochToIso(SECONDS_2018_03_10)).toBe("2018-03-10T00:00:00.000Z");
  });

  it("throws on a negative value (before the Apple epoch, implausible for iMessage)", () => {
    expect(() => appleEpochToIso(-99999999999)).toThrow();
  });

  it("throws on an extreme oversized value that resolves to no plausible year", () => {
    expect(() => appleEpochToIso(Number.MAX_SAFE_INTEGER)).toThrow();
  });

  it("throws a clear, actionable error message (not a silent wrong date)", () => {
    try {
      appleEpochToIso(Number.MAX_SAFE_INTEGER);
      expect.fail("expected appleEpochToIso to throw");
    } catch (err) {
      expect((err as Error).message).toMatch(/appleEpochToIso/);
      expect((err as Error).message).toMatch(/plausible/i);
    }
  });

  it("throws on non-finite input (NaN)", () => {
    expect(() => appleEpochToIso(NaN)).toThrow();
  });

  it("throws on non-finite input (Infinity)", () => {
    expect(() => appleEpochToIso(Infinity)).toThrow();
  });

  it("throws on non-number input", () => {
    // @ts-expect-error deliberate bad input to verify runtime guard
    expect(() => appleEpochToIso("not-a-number")).toThrow();
  });

  // MIN_PLAUSIBLE_YEAR / MAX_PLAUSIBLE_YEAR boundary checks — the window is
  // 2015-2035 inclusive; verify both edges resolve (not off-by-one excluded)
  // and immediately outside the edges throws.
  it("resolves a value exactly at the start of MIN_PLAUSIBLE_YEAR (2015-01-01T00:00:00Z)", () => {
    const secondsSince2015 =
      new Date("2015-01-01T00:00:00Z").getTime() / 1000 - APPLE_EPOCH_OFFSET_SECONDS_FOR_TEST;
    expect(appleEpochToIso(secondsSince2015)).toBe("2015-01-01T00:00:00.000Z");
  });

  it("resolves a value exactly at the end of MAX_PLAUSIBLE_YEAR (2035-12-31T23:59:59Z)", () => {
    const secondsSince2035End =
      new Date("2035-12-31T23:59:59Z").getTime() / 1000 - APPLE_EPOCH_OFFSET_SECONDS_FOR_TEST;
    expect(appleEpochToIso(secondsSince2035End)).toBe("2035-12-31T23:59:59.000Z");
  });

  it("throws just before MIN_PLAUSIBLE_YEAR (2014-12-31T23:59:59Z, both units implausible)", () => {
    // A value whose seconds-interpretation lands in 2014 must also fail the
    // nanoseconds-interpretation (which would land near the Apple epoch
    // itself, year 2001) — so it throws under both branches.
    const secondsSince2014End =
      new Date("2014-12-31T23:59:59Z").getTime() / 1000 - APPLE_EPOCH_OFFSET_SECONDS_FOR_TEST;
    expect(() => appleEpochToIso(secondsSince2014End)).toThrow();
  });

  it("throws just after MAX_PLAUSIBLE_YEAR (2036-01-01T00:00:00Z, both units implausible)", () => {
    const secondsSince2036Start =
      new Date("2036-01-01T00:00:00Z").getTime() / 1000 - APPLE_EPOCH_OFFSET_SECONDS_FOR_TEST;
    expect(() => appleEpochToIso(secondsSince2036Start)).toThrow();
  });
});
