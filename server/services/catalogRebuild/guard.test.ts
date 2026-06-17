import { describe, it, expect } from "vitest";
import { assertRetailOnly, findCostLeaks, CostLeakGuardError } from "./guard";

/** A realistic retail-only tour payload (what a customer should get). */
const cleanTour = {
  id: 123,
  title: "江南五日遊",
  price: 28900, // retail
  priceCurrency: "TWD",
  destinationCountry: "中國",
  itineraryDetailed: [{ day: 1, title: "抵達" }],
  attractions: [{ name: "烏鎮" }],
  departures: [{ date: "2026-08-22", availability: "available" }], // no seat count, no agentPrice
};

describe("assertRetailOnly", () => {
  it("passes a clean retail-only payload", () => {
    expect(() => assertRetailOnly(cleanTour)).not.toThrow();
  });

  it("throws when agentPrice leaks at top level", () => {
    expect(() => assertRetailOnly({ ...cleanTour, agentPrice: 21000 })).toThrow(
      CostLeakGuardError,
    );
  });

  it("throws when agentPrice leaks nested in a departure row", () => {
    const leaky = {
      ...cleanTour,
      departures: [{ date: "2026-08-22", availability: "available", agentPrice: 21000 }],
    };
    expect(() => assertRetailOnly(leaky)).toThrow(CostLeakGuardError);
  });

  it("catches case/underscore variants (agent_price, AgentPrice, IndustryLowestPrice)", () => {
    expect(() => assertRetailOnly({ ...cleanTour, agent_price: 1 })).toThrow();
    expect(() => assertRetailOnly({ ...cleanTour, AgentPrice: 1 })).toThrow();
    expect(() => assertRetailOnly({ ...cleanTour, IndustryLowestPrice: 1 })).toThrow();
  });

  it("catches a whole raw supplierDepartures row dumped in (rawDepartureJson)", () => {
    expect(() =>
      assertRetailOnly({ ...cleanTour, rawDepartureJson: '{"IndustryLowestPrice":"21000"}' }),
    ).toThrow();
  });

  it("blocks spareSeats (raw seat count must never reach customer)", () => {
    expect(() =>
      assertRetailOnly({ ...cleanTour, departures: [{ date: "x", spareSeats: 3 }] }),
    ).toThrow();
  });

  it("does not throw on legitimate retail fields named with 'price'", () => {
    expect(() =>
      assertRetailOnly({ ...cleanTour, priceUnit: "人/起", retailPrice: 28900 }),
    ).not.toThrow();
  });

  it("names the offending path in the error", () => {
    try {
      assertRetailOnly({ ...cleanTour, departures: [{ agentPrice: 1 }] });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as CostLeakGuardError).path).toContain("agentPrice");
    }
  });
});

describe("findCostLeaks (non-throwing report)", () => {
  it("returns [] for a clean payload", () => {
    expect(findCostLeaks(cleanTour)).toEqual([]);
  });

  it("lists every leaking path", () => {
    const leaks = findCostLeaks({
      ...cleanTour,
      agentPrice: 1,
      departures: [{ spareSeats: 3 }],
    });
    expect(leaks.length).toBeGreaterThanOrEqual(2);
    expect(leaks.join(",")).toMatch(/agentPrice/i);
    expect(leaks.join(",")).toMatch(/spareSeats/i);
  });
});
