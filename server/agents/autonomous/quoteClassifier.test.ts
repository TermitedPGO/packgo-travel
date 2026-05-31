/**
 * Tests for the 指揮中心 報價頁 risk classifier (P2).
 *
 * Contract (Jeff Q&A · proposal §3 鐵律): the quote lane ALWAYS returns
 * hard_gate — money + CST §17550 trust law, per-item review only. There is no
 * input (custom trip, prices, anything) that produces "review" or "auto".
 */

import { describe, it, expect } from "vitest";
import { classifyQuoteRisk } from "./quoteClassifier";

describe("classifyQuoteRisk — always hard_gate", () => {
  it("supplier trip with both prices → hard_gate", () => {
    const r = classifyQuoteRisk({
      isCustomTrip: false,
      supplierPrice: 1880,
      aiEstimate: 1950,
    });
    expect(r.riskLevel).toBe("hard_gate");
  });

  it("custom trip → hard_gate", () => {
    expect(classifyQuoteRisk({ isCustomTrip: true }).riskLevel).toBe(
      "hard_gate",
    );
  });

  it("hard_gate regardless of price presence / values", () => {
    const variants = [
      { isCustomTrip: false },
      { isCustomTrip: false, supplierPrice: 0 },
      { isCustomTrip: true, supplierPrice: 999999, aiEstimate: 1 },
      { isCustomTrip: false, aiEstimate: 500 },
    ];
    for (const v of variants) {
      expect(classifyQuoteRisk(v).riskLevel).toBe("hard_gate");
    }
  });

  it("never emits auto or review, and reasons say hard_gate", () => {
    const r = classifyQuoteRisk({ isCustomTrip: false });
    expect(r.riskLevel).not.toBe("auto");
    expect(r.riskLevel).not.toBe("review");
    expect(r.reason).toMatch(/hard_gate/i);
  });
});
