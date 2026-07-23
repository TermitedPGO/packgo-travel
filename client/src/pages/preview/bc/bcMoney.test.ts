/**
 * Batch P1c — money formatter tests (integer minor units → display).
 *
 * Guards the BC money rule: state carries integers, division by the ISO
 * exponent happens only at render, and the JPY-family 0-exponent case is
 * never mis-divided by 100.
 *
 * Round 2 (Codex 2026-07-22 P1-4): the exponent comes from an explicit
 * allow-list pinned to the server's frozen currency table — unknown but
 * ISO-SHAPED codes (ZZZ, AAA) must throw, not silently format as
 * 2-decimal like Intl would.
 */
import { describe, expect, it } from "vitest";
import { minorUnitExponent as serverMinorUnitExponent } from "../../../../../server/storefront/availabilityBucket";
import {
  BC_CURRENCY_MINOR_UNIT_EXPONENT,
  addMinorUnits,
  currencyExponent,
  formatMinorUnits,
} from "./bcMoney";

describe("currencyExponent — explicit allow-list, pinned to the server table", () => {
  it("USD/TWD are 2, JPY/KRW are 0, KWD is 3", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("TWD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KRW")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });

  it("every client table entry matches the server's frozen exponent table (drift fails here)", () => {
    for (const [code, exponent] of Object.entries(BC_CURRENCY_MINOR_UNIT_EXPONENT)) {
      expect(serverMinorUnitExponent(code), `exponent drift for ${code}`).toBe(exponent);
    }
    // Same size class as the server list: 17 zero + 7 three + 29 two = 53.
    expect(Object.keys(BC_CURRENCY_MINOR_UNIT_EXPONENT)).toHaveLength(53);
  });

  it("BIDIRECTIONAL exact drift gate (Codex 2026-07-22 round-2 P2-2): the server's key set is recovered by full enumeration and must equal the client's — a server-side addition fails here too", () => {
    // The server table itself is not exported (frozen file), so recover its
    // exact key set by enumerating EVERY possible ISO-shaped 3-letter code
    // (26^3 = 17,576) against minorUnitExponent, which throws for unknown
    // codes. This is complete: any code the server knows appears here.
    const serverTable = new Map<string, number>();
    const A = "A".charCodeAt(0);
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        for (let k = 0; k < 26; k++) {
          const code = String.fromCharCode(A + i, A + j, A + k);
          try {
            serverTable.set(code, serverMinorUnitExponent(code));
          } catch {
            // unknown to the server — must also be unknown to the client
          }
        }
      }
    }
    const clientCodes = Object.keys(BC_CURRENCY_MINOR_UNIT_EXPONENT).sort();
    const serverCodes = [...serverTable.keys()].sort();
    // Exact set equality in BOTH directions: client-only codes AND
    // server-only codes each make these arrays differ.
    expect(serverCodes).toEqual(clientCodes);
    for (const code of serverCodes) {
      expect(
        BC_CURRENCY_MINOR_UNIT_EXPONENT[code],
        `exponent drift for ${code}`,
      ).toBe(serverTable.get(code));
    }
  });

  it("UNKNOWN but ISO-shaped 3-letter codes throw (Codex 2026-07-22 P1-4: ZZZ/AAA)", () => {
    expect(() => currencyExponent("ZZZ")).toThrow(/Unknown currency/);
    expect(() => currencyExponent("AAA")).toThrow(/Unknown currency/);
    expect(() => currencyExponent("QQQ")).toThrow(/Unknown currency/);
  });

  it("malformed currency code throws (fail-closed, never a guessed exponent)", () => {
    expect(() => currencyExponent("NOPE")).toThrow();
    expect(() => currencyExponent("XXXX")).toThrow();
    expect(() => currencyExponent("")).toThrow();
    expect(() => currencyExponent("US")).toThrow();
  });
});

describe("formatMinorUnits", () => {
  it("USD: 155000 minor units render as 1,550 with no fraction", () => {
    const out = formatMinorUnits(155000, "USD");
    expect(out).toContain("1,550");
    expect(out).not.toContain(".");
  });

  it("USD: non-whole 155050 keeps two decimals (1,550.50)", () => {
    const out = formatMinorUnits(155050, "USD");
    expect(out).toContain("1,550.50");
  });

  it("JPY 0-exponent: 12000 minor units are 12,000 yen, NOT 120", () => {
    const out = formatMinorUnits(12000, "JPY");
    expect(out).toContain("12,000");
    expect(out).not.toContain("120.00");
    expect(out).not.toContain(".");
  });

  it("KWD 3-exponent: 1500 minor units are 1.500 dinar, not 15", () => {
    const out = formatMinorUnits(1500, "KWD");
    expect(out).toContain("1.500");
  });

  it("zero renders as 0 without fabricated decimals", () => {
    expect(formatMinorUnits(0, "USD")).toContain("0");
  });

  it("rejects non-integer minor units (floats never enter money display)", () => {
    expect(() => formatMinorUnits(1550.5, "USD")).toThrow();
    expect(() => formatMinorUnits(Number.NaN, "USD")).toThrow();
  });

  it("rejects malformed AND unknown-ISO currency codes (ZZZ never renders as 'ZZZ 1')", () => {
    expect(() => formatMinorUnits(100, "XXXX")).toThrow();
    expect(() => formatMinorUnits(100, "ZZZ")).toThrow(/Unknown currency/);
    expect(() => formatMinorUnits(100, "AAA")).toThrow(/Unknown currency/);
  });
});

describe("addMinorUnits", () => {
  it("adds integers", () => {
    expect(addMinorUnits(155000, 126000)).toBe(281000);
  });

  it("throws on overflow and on non-integers", () => {
    expect(() => addMinorUnits(Number.MAX_SAFE_INTEGER, 1)).toThrow();
    expect(() => addMinorUnits(1.5, 1)).toThrow();
  });
});
