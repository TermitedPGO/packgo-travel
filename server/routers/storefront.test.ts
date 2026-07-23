/**
 * Batch P1a — storefront public router tests.
 *
 * Repo pattern (see inquiries.test.ts): mock collaborators BEFORE importing
 * the router, then drive procedures via createCaller with a minimal public
 * context. No real DB is ever touched.
 *
 * NOTE: publish-chain tests against the REAL (non-mocked) query layer live
 * in server/storefront/queries.test.ts — there only the DB driver is
 * stubbed, not the query functions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getTourDepartures: vi.fn(),
  getTourById: vi.fn(),
}));
// Spy-wrap the runtime guard WITHOUT changing its behavior, so tests can
// prove the guard EXECUTED on every return path (Codex 2026-07-21 P2-1) —
// not just deep-scan the returned shapes after the fact.
vi.mock("../storefront/availabilityBucket", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../storefront/availabilityBucket")>();
  return {
    ...actual,
    assertNoForbiddenPublicFields: vi.fn(actual.assertNoForbiddenPublicFields),
  };
});
vi.mock("../storefront/queries", () => ({
  getPublishedProductVersionByTourId: vi.fn(),
  getPublishedItineraryVersionByProductVersionId: vi.fn(),
  getItineraryDaysByVersionId: vi.fn(),
  getItineraryStopsByDayIds: vi.fn(),
  getPublishedFeeContractsByProductVersionId: vi.fn(),
  getFeeItemsByContractId: vi.fn(),
  getTrustedSupplierAvailabilityByTourId: vi.fn(),
  departureDateKey: (value: Date | string) =>
    value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10),
}));

import * as db from "../db";
import {
  assertNoForbiddenPublicFields,
  FORBIDDEN_PUBLIC_FIELDS,
} from "../storefront/availabilityBucket";
import * as storefrontDb from "../storefront/queries";
import { storefrontRouter } from "./storefront";

/** The spy-wrapped runtime guard (same function the router calls). */
const guardSpy = assertNoForbiddenPublicFields as unknown as ReturnType<typeof vi.fn>;

/** Minimal public tRPC context — publicProcedure reads nothing from it. */
function makeContext() {
  return {
    req: { headers: {}, socket: {} } as any,
    res: { cookie: () => {}, clearCookie: () => {} } as any,
    user: null,
    ip: "127.0.0.1",
  };
}
const caller = () => (storefrontRouter as any).createCaller(makeContext());

/** Collect every key at every depth of a JSON-ish value. */
function deepKeys(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => deepKeys(v, acc));
  else if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.add(k);
      deepKeys(v, acc);
    }
  }
  return acc;
}

function expectNoForbiddenKeysDeep(value: unknown) {
  const keys = deepKeys(value);
  for (const forbidden of FORBIDDEN_PUBLIC_FIELDS) {
    expect(keys.has(forbidden), `forbidden key "${forbidden}" leaked`).toBe(false);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("storefrontRouter — structure", () => {
  // Round 2 (Codex 2026-07-22 rework item 2): getTourSummary is the single
  // additively-declared fourth procedure — nothing else may appear here.
  it("exposes exactly the 4 public read procedures", () => {
    const procs = Object.keys((storefrontRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "getFeeDisclosure",
        "getItineraryContract",
        "getTourSummary",
        "listDepartures",
      ].sort(),
    );
  });
});

const publishedProductVersion = { id: 10, tourId: 42, versionNumber: 2, status: "published" };

describe("getItineraryContract", () => {
  const version = {
    id: 55,
    productVersionId: 10,
    schemaVersion: "packgo.itinerary.v1",
    itineraryId: "MAD-5D",
    versionNumber: 3,
    sourceStatus: "source_document",
    originMarket: "US-CA",
    destinationJurisdictions: ["ES"],
    status: "published",
  };
  const day = {
    id: 501,
    itineraryVersionId: 55,
    dayId: "MAD-5D-D01",
    dayNumber: 1,
    city: "馬德里",
    cityEn: "Madrid",
    summary: "抵達馬德里",
    sourceStatus: "source_document",
    movementDurationMinutes: 45,
    movementStatus: "estimated",
    mealBreakfast: "in_flight",
    mealLunch: "self",
    mealDinner: "included_unconfirmed",
    stayPropertyStatus: "proposed_or_equivalent",
    stayBookingStatus: "unconfirmed",
    stayRatingValue: 4,
    stayRatingSystem: "hotel_classification",
    stayRatingSourceStatus: "source_document_claim",
    stayRatingVerifiedAt: null,
    mediaSourceStatus: "demo_placeholder",
    mediaRightsStatus: "prototype_only",
  };
  const stop = {
    id: 9001,
    itineraryDayId: 501,
    stopId: "d1-prado",
    name: "普拉多美術館",
    nameEn: "Museo del Prado",
    kind: "museum",
    summary: null,
    lat: "40.4137800",
    lon: "-3.6921000",
    sourceStatus: "source_document",
    visitStatus: "planned_from_source",
    imageAssetId: null,
    mediaStatus: "demo_placeholder",
    sortOrder: 1,
  };

  it("accepts ONLY tourId — the direct itineraryId entrypoint is gone (P1-1)", async () => {
    await expect(caller().getItineraryContract({ itineraryId: "MAD-5D" })).rejects.toThrow();
    await expect(caller().getItineraryContract({})).rejects.toThrow();
  });

  it("ancestry gate: null when the tour has no published productVersion", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(null);
    const result = await caller().getItineraryContract({ tourId: 42 });
    expect(result).toBeNull();
    expect(storefrontDb.getPublishedProductVersionByTourId).toHaveBeenCalledWith(42);
    // Child lookups must never run when the parent is unpublished.
    expect(
      storefrontDb.getPublishedItineraryVersionByProductVersionId,
    ).not.toHaveBeenCalled();
  });

  it("ancestry gate: null when the published productVersion has no published itineraryVersion", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedItineraryVersionByProductVersionId as any).mockResolvedValue(
      null,
    );
    const result = await caller().getItineraryContract({ tourId: 42 });
    expect(result).toBeNull();
    expect(
      storefrontDb.getPublishedItineraryVersionByProductVersionId,
    ).toHaveBeenCalledWith(10);
  });

  it("assembles the packgo.itinerary.v1 shape (days + nested statuses + stops)", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedItineraryVersionByProductVersionId as any).mockResolvedValue(
      version,
    );
    (storefrontDb.getItineraryDaysByVersionId as any).mockResolvedValue([day]);
    (storefrontDb.getItineraryStopsByDayIds as any).mockResolvedValue([stop]);

    const contract = await caller().getItineraryContract({ tourId: 42 });
    expect(contract).not.toBeNull();
    expect(contract!.schemaVersion).toBe("packgo.itinerary.v1");
    expect(contract!.itineraryId).toBe("MAD-5D");
    expect(contract!.days).toHaveLength(1);
    const d1 = contract!.days[0];
    expect(d1.dayId).toBe("MAD-5D-D01");
    expect(d1.movement).toEqual({ durationMinutes: 45, status: "estimated" });
    expect(d1.meals).toEqual({
      breakfast: "in_flight",
      lunch: "self",
      dinner: "included_unconfirmed",
    });
    expect(d1.stay.propertyStatus).toBe("proposed_or_equivalent");
    expect(d1.stay.rating).toEqual({
      value: 4,
      system: "hotel_classification",
      sourceStatus: "source_document_claim",
      verifiedAt: null,
    });
    expect(d1.media).toEqual({
      sourceStatus: "demo_placeholder",
      rightsStatus: "prototype_only",
    });
    expect(d1.stops).toHaveLength(1);
    expect(d1.stops[0].stopId).toBe("d1-prado");
    expect(d1.stops[0].lat).toBeCloseTo(40.41378);
    expect(d1.stops[0].visitStatus).toBe("planned_from_source");
  });

  it("populated nested output carries no forbidden keys at any depth", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedItineraryVersionByProductVersionId as any).mockResolvedValue(
      version,
    );
    (storefrontDb.getItineraryDaysByVersionId as any).mockResolvedValue([
      day,
      { ...day, id: 502, dayId: "MAD-5D-D02", dayNumber: 2 },
    ]);
    (storefrontDb.getItineraryStopsByDayIds as any).mockResolvedValue([
      stop,
      { ...stop, id: 9002, itineraryDayId: 502, stopId: "d2-retiro", sortOrder: 1 },
    ]);
    const contract = await caller().getItineraryContract({ tourId: 42 });
    expect(contract!.days).toHaveLength(2);
    expect(contract!.days[1].stops).toHaveLength(1);
    expectNoForbiddenKeysDeep(contract);
  });

  it("omits the rating claim entirely when no stayRatingValue exists", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedItineraryVersionByProductVersionId as any).mockResolvedValue(
      version,
    );
    (storefrontDb.getItineraryDaysByVersionId as any).mockResolvedValue([
      { ...day, stayRatingValue: null, stayRatingSystem: null, stayRatingSourceStatus: null },
    ]);
    (storefrontDb.getItineraryStopsByDayIds as any).mockResolvedValue([]);
    const contract = await caller().getItineraryContract({ tourId: 42 });
    expect(contract!.days[0].stay.rating).toBeNull();
  });

  it("JSON-poison at nested level: guard throws instead of leaking (fail-closed)", async () => {
    // destinationJurisdictions is a JSON column — a poisoned row could smuggle
    // forbidden keys past the type layer. The runtime deep guard must refuse
    // to serve the response.
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedItineraryVersionByProductVersionId as any).mockResolvedValue({
      ...version,
      destinationJurisdictions: [{ agentPrice: "999.00", nested: { spareSeats: 3 } }],
    });
    (storefrontDb.getItineraryDaysByVersionId as any).mockResolvedValue([day]);
    (storefrontDb.getItineraryStopsByDayIds as any).mockResolvedValue([stop]);
    await expect(caller().getItineraryContract({ tourId: 42 })).rejects.toThrow(
      /forbidden field "agentPrice"/,
    );
  });
});

describe("getFeeDisclosure", () => {
  const publishedContract = {
    id: 77,
    contractId: "MAD-5D-FEES-2026",
    productVersionId: 10,
    originMarket: "US-CA",
    destinationJurisdictions: ["ES"],
    displayRegion: "us-west",
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validTo: new Date("2026-12-31T23:59:59Z"),
    sourceStatus: "supplier_quote",
    status: "published",
  };
  const items = [
    {
      id: 1, feeContractId: 77, feeId: "intl-air-tax", category: "mandatory",
      labelZh: "國際機場稅", labelEn: "International air taxes",
      amountMinorUnits: 12050, currency: "USD", unit: "per_person",
      includedInPackgoCharge: false, requiredForTrip: true, payeeType: "airline",
      paymentTiming: "before_departure", sourceStatus: "supplier_quote", sortOrder: 1,
    },
    {
      id: 2, feeContractId: 77, feeId: "guide-tips", category: "tips",
      labelZh: "導遊司機小費", labelEn: "Guide and driver tips",
      amountMinorUnits: 6000, currency: "USD", unit: "per_person",
      includedInPackgoCharge: false, requiredForTrip: true, payeeType: "guide_and_driver",
      paymentTiming: "during_trip", sourceStatus: "demo_estimate", sortOrder: 2,
    },
    {
      id: 3, feeContractId: 77, feeId: "private-room", category: "optional",
      labelZh: "單人房差", labelEn: "Single room supplement",
      amountMinorUnits: 45000, currency: "USD", unit: "per_booking",
      includedInPackgoCharge: false, requiredForTrip: false, payeeType: "packgo_or_hotel",
      paymentTiming: "if_selected", sourceStatus: "supplier_quote", sortOrder: 3,
    },
  ];

  it("accepts ONLY tourId — the direct productVersionId entrypoint is gone (P1-1)", async () => {
    await expect(caller().getFeeDisclosure({ productVersionId: 10 })).rejects.toThrow();
    await expect(caller().getFeeDisclosure({})).rejects.toThrow();
  });

  it("returns the honest awaiting shape (totals null) when the tour has no published productVersion", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(null);
    const d = await caller().getFeeDisclosure({ tourId: 42 });
    expect(d.status).toBe("awaiting_supplier_quote");
    expect(d.fees).toEqual([]);
    expect(d.totals).toBeNull();
    expect(storefrontDb.getPublishedFeeContractsByProductVersionId).not.toHaveBeenCalled();
  });

  it("returns the honest awaiting shape when no published contract covers the date", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedFeeContractsByProductVersionId as any).mockResolvedValue([
      publishedContract,
    ]);
    const d = await caller().getFeeDisclosure({
      tourId: 42,
      departureDate: new Date("2027-06-01T00:00:00Z"), // outside window
    });
    expect(d.status).toBe("awaiting_supplier_quote");
    expect(d.fees).toEqual([]);
    expect(d.totals).toBeNull();
    expect(storefrontDb.getFeeItemsByContractId).not.toHaveBeenCalled();
  });

  it("published happy path: resolves the date-valid contract and computes CurrencyAmount totals", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedFeeContractsByProductVersionId as any).mockResolvedValue([
      publishedContract,
    ]);
    (storefrontDb.getFeeItemsByContractId as any).mockResolvedValue(items);

    const d = await caller().getFeeDisclosure({
      tourId: 42,
      departureDate: new Date("2026-06-15T00:00:00Z"),
    });
    expect(d.status).toBe("published");
    expect(d.contractId).toBe("MAD-5D-FEES-2026");
    expect(storefrontDb.getPublishedFeeContractsByProductVersionId).toHaveBeenCalledWith(10);
    expect(d.feesByCategory.mandatory.map((f: any) => f.feeId)).toEqual(["intl-air-tax"]);
    expect(d.feesByCategory.optional.map((f: any) => f.feeId)).toEqual(["private-room"]);
    // currency-tagged integer sums; the per_booking optional fee is not in
    // per-person totals
    expect(d.totals).toEqual({
      mandatoryPerPerson: { amountMinorUnits: 12050, currency: "USD" },
      tipsPerPerson: { amountMinorUnits: 6000, currency: "USD" },
      selfEstimatePerPerson: { amountMinorUnits: 0, currency: "USD" },
    });
    expect(Number.isInteger(d.totals.mandatoryPerPerson.amountMinorUnits)).toBe(true);
    expectNoForbiddenKeysDeep(d);
  });

  it("contract with awaiting sourceStatus is served as awaiting, never published-zero", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedFeeContractsByProductVersionId as any).mockResolvedValue([
      { ...publishedContract, sourceStatus: "awaiting_supplier_quote" },
    ]);
    (storefrontDb.getFeeItemsByContractId as any).mockResolvedValue(items);
    const d = await caller().getFeeDisclosure({
      tourId: 42,
      departureDate: new Date("2026-06-15T00:00:00Z"),
    });
    expect(d.status).toBe("awaiting_supplier_quote");
    expect(d.totals).toBeNull();
  });

  it("contract with zero fee items is served as awaiting, never published-zero (P1-4)", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedFeeContractsByProductVersionId as any).mockResolvedValue([
      publishedContract,
    ]);
    (storefrontDb.getFeeItemsByContractId as any).mockResolvedValue([]);
    const d = await caller().getFeeDisclosure({
      tourId: 42,
      departureDate: new Date("2026-06-15T00:00:00Z"),
    });
    expect(d.status).toBe("awaiting_supplier_quote");
    expect(d.fees).toEqual([]);
    expect(d.totals).toBeNull();
  });

  it("mixed-currency contract is served as awaiting (no bare cross-currency sum)", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedFeeContractsByProductVersionId as any).mockResolvedValue([
      publishedContract,
    ]);
    (storefrontDb.getFeeItemsByContractId as any).mockResolvedValue([
      items[0],
      { ...items[1], currency: "JPY" },
    ]);
    const d = await caller().getFeeDisclosure({
      tourId: 42,
      departureDate: new Date("2026-06-15T00:00:00Z"),
    });
    expect(d.status).toBe("awaiting_supplier_quote");
    expect(d.totals).toBeNull();
  });

  it("JSON-poison in fee rows: guard throws instead of leaking", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedFeeContractsByProductVersionId as any).mockResolvedValue([
      publishedContract,
    ]);
    // labelZh smuggles an object (simulating driver/JSON corruption) with a
    // forbidden key nested inside — allow-list keeps the value, so the deep
    // runtime guard must catch it.
    (storefrontDb.getFeeItemsByContractId as any).mockResolvedValue([
      { ...items[0], labelZh: { evil: { supplierCost: 123 } } },
    ]);
    await expect(
      caller().getFeeDisclosure({
        tourId: 42,
        departureDate: new Date("2026-06-15T00:00:00Z"),
      }),
    ).rejects.toThrow(/forbidden field "supplierCost"/);
  });
});

describe("listDepartures", () => {
  const future = (days: number) => new Date(Date.now() + days * 86_400_000);
  const dateKey = (d: Date) => d.toISOString().slice(0, 10);
  const dep = (overrides: Record<string, unknown>) => ({
    id: 1,
    tourId: 42,
    departureDate: future(30),
    returnDate: future(35),
    adultPrice: 1998,
    currency: "USD",
    status: "open",
    totalSlots: 20,
    bookedSlots: 0,
    agentPrice: "999.00", // deliberately poisoned input — must never leak
    ...overrides,
  });

  beforeEach(() => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
  });

  it("ancestry gate: [] when the tour has no published productVersion", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(null);
    expect(await caller().listDepartures({ tourId: 42 })).toEqual([]);
    expect(storefrontDb.getTrustedSupplierAvailabilityByTourId).not.toHaveBeenCalled();
    expect(db.getTourDepartures).not.toHaveBeenCalled();
  });

  it("trust gate: [] when there is no trusted supplier evidence chain (P0-1)", async () => {
    (storefrontDb.getTrustedSupplierAvailabilityByTourId as any).mockResolvedValue(null);
    (db.getTourDepartures as any).mockResolvedValue([dep({ id: 1 })]);
    expect(await caller().listDepartures({ tourId: 42 })).toEqual([]);
  });

  it("buckets come ONLY from supplier availability — local seat counts are ignored", async () => {
    const d1 = future(30);
    const d2 = future(40);
    const d3 = future(50);
    const d4 = future(60);
    (storefrontDb.getTrustedSupplierAvailabilityByTourId as any).mockResolvedValue(
      new Map([
        [dateKey(d1), "available"],
        [dateKey(d2), "limited"],
        [dateKey(d3), "full"],
        [dateKey(d4), "unavailable"],
      ]),
    );
    (db.getTourDepartures as any).mockResolvedValue([
      // Local counters deliberately CONTRADICT supplier truth — supplier wins.
      dep({ id: 1, departureDate: d1, bookedSlots: 19 }), // locally 1 left, supplier available
      dep({ id: 2, departureDate: d2, bookedSlots: 0 }), // locally wide open, supplier limited
      dep({ id: 3, departureDate: d3, bookedSlots: 0 }), // supplier full → waitlist
      dep({ id: 4, departureDate: d4 }), // supplier 停售 → excluded
      dep({ id: 5, departureDate: future(70) }), // no supplier evidence → excluded
      dep({ id: 6, departureDate: d1, status: "cancelled" }), // locally cancelled → excluded
      dep({ id: 7, departureDate: new Date(Date.now() - 86_400_000) }), // past → excluded
    ]);
    const result = await caller().listDepartures({ tourId: 42 });
    expect(result.map((d: any) => [d.id, d.bucket])).toEqual([
      [1, "plenty"],
      [2, "few"],
      [3, "waitlist"],
    ]);
    expect(result[0].pricePerPersonMinorUnits).toBe(199800);
    expect(result[0].displayStatusKey).toBe("storefront.availability.plenty");
  });

  it("sorts by departure date ascending", async () => {
    const dLate = future(60);
    const dSoon = future(10);
    (storefrontDb.getTrustedSupplierAvailabilityByTourId as any).mockResolvedValue(
      new Map([
        [dateKey(dLate), "available"],
        [dateKey(dSoon), "available"],
      ]),
    );
    (db.getTourDepartures as any).mockResolvedValue([
      dep({ id: 1, departureDate: dLate }),
      dep({ id: 2, departureDate: dSoon }),
    ]);
    const result = await caller().listDepartures({ tourId: 42 });
    expect(result.map((d: any) => d.id)).toEqual([2, 1]);
  });

  it("CRITICAL: never returns seat counts or agent prices at any depth", async () => {
    const d1 = future(30);
    (storefrontDb.getTrustedSupplierAvailabilityByTourId as any).mockResolvedValue(
      new Map([[dateKey(d1), "full"]]),
    );
    (db.getTourDepartures as any).mockResolvedValue([
      dep({ id: 1, departureDate: d1 }),
      dep({ id: 2, departureDate: d1 }),
    ]);
    const result = await caller().listDepartures({ tourId: 42 });
    expect(result.length).toBeGreaterThan(0);
    expectNoForbiddenKeysDeep(result);
  });

  it("returns [] honestly when the tour has no future departures", async () => {
    (storefrontDb.getTrustedSupplierAvailabilityByTourId as any).mockResolvedValue(
      new Map(),
    );
    (db.getTourDepartures as any).mockResolvedValue([]);
    expect(await caller().listDepartures({ tourId: 42 })).toEqual([]);
  });
});

describe("getTourSummary (Codex 2026-07-22 rework item 2)", () => {
  /**
   * The tours-row part of the poison fixture (round-3 P2-1 fixture
   * fidelity): EVERY key below is a REAL column of the drizzle tours table
   * (drizzle/schema.ts, `export const tours = mysqlTable("tours", …)`) —
   * customer-safe display columns, the seats trio (maxParticipants/
   * currentParticipants/availableSeats), the supplier-contact block
   * (supplierName/supplierEmail/supplierPhone/supplierNotes), the four
   * CalibrationAgent columns (calibrationScore/calibrationVerdict/
   * calibrationReport/calibratedAt), estimatedCommissionPct, and the legacy
   * price/priceCurrency pair. Nothing here is made up.
   */
  const realToursColumnsRow = {
    id: 42,
    title: "馬德里五日",
    productCode: "26MAD5D-T",
    destinationCountry: "西班牙",
    destinationCity: "馬德里",
    duration: 5,
    nights: 4,
    heroImage: "https://img.example/mad-hero.jpg",
    imageUrl: "https://img.example/mad-main.jpg",
    status: "active",
    // internal tours columns that must NEVER cross the wire:
    maxParticipants: 32,
    currentParticipants: 18,
    availableSeats: 14,
    supplierName: "西班牙地接社 A",
    supplierEmail: "ops@supplier.example",
    supplierPhone: "0912-xxx-xxx",
    supplierNotes: "同業價另議",
    calibrationScore: 87,
    calibrationVerdict: "warn",
    calibrationReport: '{"issues":["price drift"]}',
    calibratedAt: new Date("2026-07-01T00:00:00Z"),
    estimatedCommissionPct: 12.5,
    price: 64000,
    priceCurrency: "TWD",
  };

  /**
   * SEPARATE extra-poison fixture (round-3 P2-1): these four keys are NOT
   * tours-schema columns — they are guard-listed forbidden field names from
   * OTHER internal shapes (departure economics / slot counters), injected as
   * extra malicious keys to prove the exact allow-list drops fields it has
   * never seen on a tours row. They must never be described as tours
   * columns.
   */
  const extraPoisonNonToursKeys = {
    agentPrice: "999.00",
    supplierCost: "888.00",
    totalSlots: 32,
    bookedSlots: 18,
  };

  /** What getTourById is mocked to return: real columns + extra poison. */
  const rawTourRow = { ...realToursColumnsRow, ...extraPoisonNonToursKeys };

  it("fixture fidelity (round-3 P2-1): every realToursColumnsRow key IS a real tours column; every extra-poison key is NOT", async () => {
    const { getTableColumns } = await import("drizzle-orm");
    const { tours } = await import("../../drizzle/schema");
    const toursColumns = new Set(Object.keys(getTableColumns(tours)));
    for (const key of Object.keys(realToursColumnsRow)) {
      expect(toursColumns.has(key), `"${key}" must be a real tours column`).toBe(true);
    }
    for (const key of Object.keys(extraPoisonNonToursKeys)) {
      expect(toursColumns.has(key), `"${key}" must NOT be a tours column`).toBe(false);
    }
    // exact split: 24 real columns + 4 extra malicious keys = the 28-key row
    expect(Object.keys(realToursColumnsRow)).toHaveLength(24);
    expect(Object.keys(extraPoisonNonToursKeys)).toHaveLength(4);
    expect(Object.keys(rawTourRow)).toHaveLength(28);
  });

  it("accepts ONLY tourId — no raw id entrypoint shape", async () => {
    await expect(caller().getTourSummary({ id: 42 })).rejects.toThrow();
    await expect(caller().getTourSummary({})).rejects.toThrow();
    await expect(caller().getTourSummary({ tourId: -1 })).rejects.toThrow();
    await expect(caller().getTourSummary({ tourId: 1.5 })).rejects.toThrow();
  });

  it("published-ancestor gate: null when the tour has no published productVersion — the raw row is never even read", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(null);
    (db.getTourById as any).mockResolvedValue(rawTourRow);
    const result = await caller().getTourSummary({ tourId: 42 });
    expect(result).toBeNull();
    expect(storefrontDb.getPublishedProductVersionByTourId).toHaveBeenCalledWith(42);
    expect(db.getTourById).not.toHaveBeenCalled();
  });

  it("active gate: draft/pending_review/inactive/soldout tours are null even with a published ancestor", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    for (const status of ["draft", "pending_review", "inactive", "soldout"]) {
      (db.getTourById as any).mockResolvedValue({ ...rawTourRow, status });
      expect(await caller().getTourSummary({ tourId: 42 })).toBeNull();
    }
  });

  it("missing tour row: null (indistinguishable from unpublished)", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (db.getTourById as any).mockResolvedValue(undefined);
    expect(await caller().getTourSummary({ tourId: 42 })).toBeNull();
  });

  it("happy path: EXACTLY the allow-listed customer-safe fields, nothing else", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (db.getTourById as any).mockResolvedValue(rawTourRow);
    const summary = await caller().getTourSummary({ tourId: 42 });
    expect(summary).toEqual({
      id: 42,
      title: "馬德里五日",
      heroImage: "https://img.example/mad-hero.jpg",
      duration: 5,
      nights: 4,
      productCode: "26MAD5D-T",
      destinationCountry: "西班牙",
      destinationCity: "馬德里",
    });
    // Exact key set — an accidental extra field fails, not just forbidden ones.
    expect(Object.keys(summary!).sort()).toEqual(
      [
        "destinationCity",
        "destinationCountry",
        "duration",
        "heroImage",
        "id",
        "nights",
        "productCode",
        "title",
      ].sort(),
    );
  });

  it("falls back to imageUrl when heroImage is absent", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (db.getTourById as any).mockResolvedValue({ ...rawTourRow, heroImage: null });
    const summary = await caller().getTourSummary({ tourId: 42 });
    expect(summary!.heroImage).toBe("https://img.example/mad-main.jpg");
  });

  it("forbidden-field deep scan: the poisoned raw row leaks NOTHING", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (db.getTourById as any).mockResolvedValue(rawTourRow);
    const summary = await caller().getTourSummary({ tourId: 42 });
    expectNoForbiddenKeysDeep(summary);
    const keys = deepKeys(summary);
    for (const internal of [
      "maxParticipants",
      "currentParticipants",
      "availableSeats",
      "supplierName",
      "supplierEmail",
      "supplierPhone",
      "supplierNotes",
      "calibrationScore",
      "calibrationVerdict",
      "calibrationReport",
      "calibratedAt",
      "estimatedCommissionPct",
      "agentPrice",
      "supplierCost",
      "totalSlots",
      "bookedSlots",
      "price",
      "priceCurrency",
      "status",
    ]) {
      expect(keys.has(internal), `internal key "${internal}" leaked`).toBe(false);
    }
  });

  it("runtime guard EXECUTES on the unpublished null return", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(null);
    const result = await caller().getTourSummary({ tourId: 42 });
    expect(result).toBeNull();
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy).toHaveBeenCalledWith(null);
  });

  it("runtime guard EXECUTES on the inactive-tour null return", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (db.getTourById as any).mockResolvedValue({ ...rawTourRow, status: "draft" });
    const result = await caller().getTourSummary({ tourId: 42 });
    expect(result).toBeNull();
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy).toHaveBeenCalledWith(null);
  });

  it("runtime guard EXECUTES on the populated return with the exact returned object", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (db.getTourById as any).mockResolvedValue(rawTourRow);
    const summary = await caller().getTourSummary({ tourId: 42 });
    expect(summary).not.toBeNull();
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy.mock.calls[0][0]).toBe(summary);
  });
});

describe("public DTO forbidden-fields sweep (all three procedures)", () => {
  it("getItineraryContract output carries no seat/cost keys", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedItineraryVersionByProductVersionId as any).mockResolvedValue({
      id: 55,
      productVersionId: 10,
      schemaVersion: "packgo.itinerary.v1",
      itineraryId: "MAD-5D",
      versionNumber: 1,
      sourceStatus: "demo_estimate",
      originMarket: null,
      destinationJurisdictions: null,
      status: "published",
    });
    (storefrontDb.getItineraryDaysByVersionId as any).mockResolvedValue([]);
    (storefrontDb.getItineraryStopsByDayIds as any).mockResolvedValue([]);
    const contract = await caller().getItineraryContract({ tourId: 42 });
    expectNoForbiddenKeysDeep(contract);
  });

  it("getFeeDisclosure awaiting early-return carries no seat/cost keys", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(null);
    const d = await caller().getFeeDisclosure({ tourId: 1 });
    expectNoForbiddenKeysDeep(d);
  });

  it("listDepartures empty early-returns carry no seat/cost keys", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(null);
    expectNoForbiddenKeysDeep(await caller().listDepartures({ tourId: 1 }));
  });
});

describe("runtime guard EXECUTES on every return path (Codex 2026-07-21 P2-1)", () => {
  // These tests spy on assertNoForbiddenPublicFields itself: they prove the
  // guard function actually ran on each return path — including the null/[]
  // early returns — instead of inferring safety from the returned shape.

  it("getItineraryContract: guard runs on the no-published-productVersion null return", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(null);
    const result = await caller().getItineraryContract({ tourId: 42 });
    expect(result).toBeNull();
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy).toHaveBeenCalledWith(null);
  });

  it("getItineraryContract: guard runs on the no-published-itineraryVersion null return", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedItineraryVersionByProductVersionId as any).mockResolvedValue(
      null,
    );
    const result = await caller().getItineraryContract({ tourId: 42 });
    expect(result).toBeNull();
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy).toHaveBeenCalledWith(null);
  });

  it("getItineraryContract: guard runs on the populated contract return", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedItineraryVersionByProductVersionId as any).mockResolvedValue({
      id: 55,
      productVersionId: 10,
      schemaVersion: "packgo.itinerary.v1",
      itineraryId: "MAD-5D",
      versionNumber: 1,
      sourceStatus: "demo_estimate",
      originMarket: null,
      destinationJurisdictions: null,
      status: "published",
    });
    (storefrontDb.getItineraryDaysByVersionId as any).mockResolvedValue([]);
    (storefrontDb.getItineraryStopsByDayIds as any).mockResolvedValue([]);
    const result = await caller().getItineraryContract({ tourId: 42 });
    expect(result).not.toBeNull();
    expect(guardSpy).toHaveBeenCalledTimes(1);
    // The exact object that was returned is the one the guard walked.
    expect(guardSpy.mock.calls[0][0]).toBe(result);
  });

  it("getFeeDisclosure: guard runs on the no-published-productVersion awaiting return", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(null);
    const d = await caller().getFeeDisclosure({ tourId: 42 });
    expect(d.status).toBe("awaiting_supplier_quote");
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy.mock.calls[0][0]).toBe(d);
  });

  it("getFeeDisclosure: guard runs on the no-date-valid-contract awaiting return", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedFeeContractsByProductVersionId as any).mockResolvedValue([]);
    const d = await caller().getFeeDisclosure({ tourId: 42 });
    expect(d.status).toBe("awaiting_supplier_quote");
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy.mock.calls[0][0]).toBe(d);
  });

  it("getFeeDisclosure: guard runs on the published populated return (Codex 2026-07-21 R3 P2-1)", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedFeeContractsByProductVersionId as any).mockResolvedValue([
      {
        id: 77,
        contractId: "MAD-5D-FEES-2026",
        productVersionId: 10,
        originMarket: "US-CA",
        destinationJurisdictions: ["ES"],
        displayRegion: "us-west",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validTo: new Date("2026-12-31T23:59:59Z"),
        sourceStatus: "supplier_quote",
        status: "published",
      },
    ]);
    (storefrontDb.getFeeItemsByContractId as any).mockResolvedValue([
      {
        id: 1, feeContractId: 77, feeId: "intl-air-tax", category: "mandatory",
        labelZh: "國際機場稅", labelEn: "International air taxes",
        amountMinorUnits: 12050, currency: "USD", unit: "per_person",
        includedInPackgoCharge: false, requiredForTrip: true, payeeType: "airline",
        paymentTiming: "before_departure", sourceStatus: "supplier_quote", sortOrder: 1,
      },
    ]);
    const d = await caller().getFeeDisclosure({
      tourId: 42,
      departureDate: new Date("2026-06-15T00:00:00Z"),
    });
    expect(d.status).toBe("published");
    expect(guardSpy).toHaveBeenCalledTimes(1);
    // The exact object that was returned is the one the guard walked.
    expect(guardSpy.mock.calls[0][0]).toBe(d);
  });

  it("listDepartures: guard runs on the ancestry-gate [] return", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(null);
    const result = await caller().listDepartures({ tourId: 42 });
    expect(result).toEqual([]);
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy.mock.calls[0][0]).toBe(result);
  });

  it("listDepartures: guard runs on the trust-gate [] return", async () => {
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getTrustedSupplierAvailabilityByTourId as any).mockResolvedValue(null);
    const result = await caller().listDepartures({ tourId: 42 });
    expect(result).toEqual([]);
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy.mock.calls[0][0]).toBe(result);
  });

  it("listDepartures: guard runs on the populated DTO-list return", async () => {
    const d1 = new Date(Date.now() + 30 * 86_400_000);
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getTrustedSupplierAvailabilityByTourId as any).mockResolvedValue(
      new Map([[d1.toISOString().slice(0, 10), "available"]]),
    );
    (db.getTourDepartures as any).mockResolvedValue([
      {
        id: 1,
        tourId: 42,
        departureDate: d1,
        returnDate: new Date(Date.now() + 35 * 86_400_000),
        adultPrice: 1998,
        currency: "USD",
        status: "open",
      },
    ]);
    const result = await caller().listDepartures({ tourId: 42 });
    expect(result).toHaveLength(1);
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy.mock.calls[0][0]).toBe(result);
  });

  it("guard executions really enforce: a poisoned payload on a populated path throws through the SAME spy", async () => {
    // Sanity check that the spy wraps the REAL guard (behavior unchanged):
    // the JSON-poison rejection flows through this exact spy instance.
    (storefrontDb.getPublishedProductVersionByTourId as any).mockResolvedValue(
      publishedProductVersion,
    );
    (storefrontDb.getPublishedItineraryVersionByProductVersionId as any).mockResolvedValue({
      id: 55,
      productVersionId: 10,
      schemaVersion: "packgo.itinerary.v1",
      itineraryId: "MAD-5D",
      versionNumber: 1,
      sourceStatus: "demo_estimate",
      originMarket: null,
      destinationJurisdictions: { totalSeats: 40 },
      status: "published",
    });
    (storefrontDb.getItineraryDaysByVersionId as any).mockResolvedValue([]);
    (storefrontDb.getItineraryStopsByDayIds as any).mockResolvedValue([]);
    await expect(caller().getItineraryContract({ tourId: 42 })).rejects.toThrow(
      /forbidden field "totalSeats"/,
    );
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy.mock.results[0].type).toBe("throw");
  });
});
