/**
 * Smoke test for Phase 4E · exchangeRate sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the 5
 * procedures originally at server/routers.ts L3475-3563. Structural
 * regression anchor only.
 */
import { describe, it, expect } from "vitest";
import { exchangeRateRouter } from "./exchangeRate";

describe("exchangeRateRouter (Phase 4E extraction)", () => {
  it("exposes all 5 procedures from the pre-split source", () => {
    const procs = Object.keys((exchangeRateRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "getRates",
        "convert",
        "getRate",
        "getSymbol",
        "getSupportedCurrencies",
      ].sort(),
    );
  });
});
