/**
 * Batch P1a — publish-chain tests against the REAL query layer.
 *
 * Codex 2026-07-20 P1-5 asked for publish-chain coverage where only the DB
 * driver is mocked, NOT the query functions. Here `getDb` returns a
 * chainable stub that records which table each query hit and what WHERE
 * condition it carried (rendered to SQL via MySqlDialect so the
 * status='published' filters are asserted as real SQL, not trusted
 * implicitly), then resolves canned rows per table. The query functions
 * and the router run for real on top of that stub.
 */
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
  getTourDepartures: vi.fn(),
}));

import {
  feeContracts,
  itineraryDays,
  itineraryStops,
  itineraryVersions,
  productVersions,
  supplierDepartures,
  supplierProducts,
  suppliers,
  tours,
} from "../../drizzle/schema";
import * as dbModule from "../db";
import { storefrontRouter } from "../routers/storefront";
import {
  departureDateKey,
  getPublishedFeeContractsByProductVersionId,
  getPublishedItineraryVersionByProductVersionId,
  getPublishedProductVersionByTourId,
  getTrustedSupplierAvailabilityByTourId,
  resolveSupplierLinkage,
} from "./queries";

const dialect = new MySqlDialect();

interface CapturedQuery {
  table: unknown;
  whereSql: string;
  whereParams: unknown[];
}

/** Chainable thenable stub standing in for the drizzle DB driver. */
function makeStubDb(rowsByTable: Map<unknown, unknown[]>, captured: CapturedQuery[]) {
  return {
    select: () => {
      const q: any = {
        _table: null as unknown,
        _where: null as SQL | null,
        from(table: unknown) {
          q._table = table;
          return q;
        },
        where(condition: SQL) {
          q._where = condition;
          return q;
        },
        orderBy() {
          return q;
        },
        limit() {
          return q;
        },
        then(resolve: (rows: unknown[]) => unknown, reject: (err: unknown) => unknown) {
          const rendered = q._where
            ? dialect.sqlToQuery(q._where)
            : { sql: "", params: [] };
          captured.push({
            table: q._table,
            whereSql: rendered.sql,
            whereParams: rendered.params as unknown[],
          });
          return Promise.resolve(rowsByTable.get(q._table) ?? []).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

function makeContext() {
  return {
    req: { headers: {}, socket: {} } as any,
    res: { cookie: () => {}, clearCookie: () => {} } as any,
    user: null,
    ip: "127.0.0.1",
  };
}
const caller = () => (storefrontRouter as any).createCaller(makeContext());

let captured: CapturedQuery[];

function wireDb(rowsByTable: Map<unknown, unknown[]>) {
  captured = [];
  (dbModule.getDb as any).mockResolvedValue(makeStubDb(rowsByTable, captured));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pure helpers", () => {
  it("resolveSupplierLinkage: Lion host + NormGroupID ⇒ lion linkage", () => {
    expect(
      resolveSupplierLinkage({
        sourceUrl: "https://travel.liontravel.com/detail?NormGroupID=GG250715D&x=1",
        productCode: null,
      }),
    ).toEqual({ provider: "lion", externalCode: "GG250715D" });
  });
  it("resolveSupplierLinkage: Lion host WITHOUT NormGroupID ⇒ null (no Lion productCode fallback)", () => {
    // Lion's tours.productCode holds a DIFFERENT Lion id (tourId), never an
    // externalProductCode — matching it would be a provider-code mismatch.
    expect(
      resolveSupplierLinkage({
        sourceUrl: "https://travel.liontravel.com/detail?foo=1",
        productCode: "LION-TOURID-123",
      }),
    ).toBeNull();
  });
  it("resolveSupplierLinkage: UV host + /product/detail/ path ⇒ uv linkage", () => {
    expect(
      resolveSupplierLinkage({
        sourceUrl: "https://www.uvbookings.com/product/detail/ABC-123?ref=x",
        productCode: null,
      }),
    ).toEqual({ provider: "uv", externalCode: "ABC-123" });
    expect(
      resolveSupplierLinkage({
        sourceUrl: "https://uvbookings.toursbms.com/product/detail/P00002255",
        productCode: null,
      }),
    ).toEqual({ provider: "uv", externalCode: "P00002255" });
  });
  it("resolveSupplierLinkage: UV host without path code falls back to productCode (UV-only rule)", () => {
    expect(
      resolveSupplierLinkage({
        sourceUrl: "https://www.uvbookings.com/somewhere-else",
        productCode: "26JO217BRC-T",
      }),
    ).toEqual({ provider: "uv", externalCode: "26JO217BRC-T" });
    expect(
      resolveSupplierLinkage({
        sourceUrl: "https://www.uvbookings.com/somewhere-else",
        productCode: null,
      }),
    ).toBeNull();
  });
  it("resolveSupplierLinkage: no sourceUrl ⇒ null even when productCode exists (fail-closed)", () => {
    // A bare productCode carries NO provider identity — it could collide
    // with any supplier's code space (codes are only composite-unique).
    expect(
      resolveSupplierLinkage({ sourceUrl: null, productCode: "26JO217BRC-T" }),
    ).toBeNull();
    expect(resolveSupplierLinkage({ sourceUrl: null, productCode: null })).toBeNull();
  });
  it("resolveSupplierLinkage: unknown host ⇒ null, even with plausible code patterns", () => {
    expect(
      resolveSupplierLinkage({
        sourceUrl: "https://www.attacker.com/product/detail/ABC-123?NormGroupID=GG250715D",
        productCode: "ABC-123",
      }),
    ).toBeNull();
    // Substring tricks must not pass the host check.
    expect(
      resolveSupplierLinkage({
        sourceUrl: "https://uvbookings.com.evil.net/product/detail/ABC-123",
        productCode: null,
      }),
    ).toBeNull();
    expect(
      resolveSupplierLinkage({
        sourceUrl: "https://evilliontravel.com/detail?NormGroupID=GG250715D",
        productCode: null,
      }),
    ).toBeNull();
  });
  it("resolveSupplierLinkage: malformed sourceUrl ⇒ null", () => {
    expect(
      resolveSupplierLinkage({ sourceUrl: "not a url", productCode: "ABC-123" }),
    ).toBeNull();
  });
  it("departureDateKey normalizes Dates and strings to YYYY-MM-DD", () => {
    expect(departureDateKey(new Date("2026-09-14T12:34:00Z"))).toBe("2026-09-14");
    expect(departureDateKey("2026-09-14")).toBe("2026-09-14");
    expect(departureDateKey("2026-09-14T00:00:00.000Z")).toBe("2026-09-14");
  });
});

describe("query functions render status='published' filters (real WHERE SQL)", () => {
  it("getPublishedProductVersionByTourId filters tourId AND status='published'", async () => {
    wireDb(new Map([[productVersions, [{ id: 10, tourId: 42, status: "published" }]]]));
    const row = await getPublishedProductVersionByTourId(42);
    expect(row).toEqual({ id: 10, tourId: 42, status: "published" });
    expect(captured).toHaveLength(1);
    expect(captured[0].table).toBe(productVersions);
    expect(captured[0].whereSql).toContain("`status`");
    expect(captured[0].whereParams).toEqual([42, "published"]);
  });

  it("getPublishedItineraryVersionByProductVersionId filters parent id AND status='published'", async () => {
    wireDb(new Map([[itineraryVersions, []]]));
    const row = await getPublishedItineraryVersionByProductVersionId(10);
    expect(row).toBeNull();
    expect(captured[0].table).toBe(itineraryVersions);
    expect(captured[0].whereParams).toEqual([10, "published"]);
  });

  it("getPublishedFeeContractsByProductVersionId filters status='published'", async () => {
    wireDb(new Map([[feeContracts, []]]));
    await getPublishedFeeContractsByProductVersionId(10);
    expect(captured[0].table).toBe(feeContracts);
    expect(captured[0].whereParams).toEqual([10, "published"]);
  });

  it("returns null/[] honestly when the DB is unavailable", async () => {
    (dbModule.getDb as any).mockResolvedValue(null);
    expect(await getPublishedProductVersionByTourId(42)).toBeNull();
    expect(await getPublishedFeeContractsByProductVersionId(10)).toEqual([]);
    expect(await getTrustedSupplierAvailabilityByTourId(42)).toBeNull();
  });
});

describe("getTrustedSupplierAvailabilityByTourId — supplier-scoped trust chain (real query layer)", () => {
  const tourRow = {
    sourceUrl: "https://www.uvbookings.com/product/detail/UV-PROD-9",
    productCode: null,
  };
  /** suppliers canned row: the resolved UV suppliers.id. */
  const uvSupplier = { id: 2 };

  it("resolves tour → active supplier (kill switch) → supplierId-scoped product → availability map", async () => {
    wireDb(
      new Map<unknown, unknown[]>([
        [tours, [tourRow]],
        [suppliers, [uvSupplier]],
        [supplierProducts, [{ id: 501 }]],
        [
          supplierDepartures,
          [
            { departureDate: new Date("2026-09-14T00:00:00Z"), availability: "limited" },
            { departureDate: new Date("2026-10-01T00:00:00Z"), availability: "available" },
          ],
        ],
      ]),
    );
    const map = await getTrustedSupplierAvailabilityByTourId(42);
    expect(map).not.toBeNull();
    expect(map!.get("2026-09-14")).toBe("limited");
    expect(map!.get("2026-10-01")).toBe("available");

    // Kill switch: the suppliers lookup must bind code AND isActive=true.
    const supplierQuery = captured.find((c) => c.table === suppliers)!;
    expect(supplierQuery.whereParams).toEqual(["uv", true]);
    expect(supplierQuery.whereSql).toContain("`isActive`");

    // The supplierProducts lookup must bind the resolved supplierId FIRST,
    // then the code, then gate on active + not admin-hidden.
    const productQuery = captured.find((c) => c.table === supplierProducts)!;
    expect(productQuery.whereParams).toEqual([2, "UV-PROD-9", "active", false]);
    expect(productQuery.whereSql).toContain("`supplierId`");
    expect(productQuery.whereSql).toContain("`status`");
    expect(productQuery.whereSql).toContain("`isHiddenByAdmin`");
  });

  it("Lion tour: provider resolved as 'lion', code from NormGroupID only", async () => {
    wireDb(
      new Map<unknown, unknown[]>([
        [
          tours,
          [
            {
              sourceUrl: "https://travel.liontravel.com/detail?NormGroupID=GG250715D",
              productCode: "SOME-OTHER-LION-ID",
            },
          ],
        ],
        [suppliers, [{ id: 1 }]],
        [supplierProducts, [{ id: 601 }]],
        [supplierDepartures, []],
      ]),
    );
    const map = await getTrustedSupplierAvailabilityByTourId(43);
    expect(map).not.toBeNull();
    const supplierQuery = captured.find((c) => c.table === suppliers)!;
    expect(supplierQuery.whereParams).toEqual(["lion", true]);
    const productQuery = captured.find((c) => c.table === supplierProducts)!;
    expect(productQuery.whereParams).toEqual([1, "GG250715D", "active", false]);
  });

  it("two suppliers share one external code: the supplierId binding excludes the other supplier's mirror", async () => {
    // Codes are only (supplierId, externalProductCode) composite-unique.
    // Both Lion (id 1) and UV (id 2) own code "SHARED-1"; the tour is UV, so
    // the product WHERE must bind supplierId=2 — Lion's same-code row can
    // never serve as availability evidence.
    wireDb(
      new Map<unknown, unknown[]>([
        [
          tours,
          [
            {
              sourceUrl: "https://www.uvbookings.com/product/detail/SHARED-1",
              productCode: null,
            },
          ],
        ],
        [suppliers, [uvSupplier]],
        [supplierProducts, [{ id: 501 }]],
        [
          supplierDepartures,
          [{ departureDate: new Date("2026-09-14T00:00:00Z"), availability: "full" }],
        ],
      ]),
    );
    const map = await getTrustedSupplierAvailabilityByTourId(42);
    expect(map!.get("2026-09-14")).toBe("full");
    const productQuery = captured.find((c) => c.table === supplierProducts)!;
    expect(productQuery.whereSql).toContain("`supplierId`");
    expect(productQuery.whereParams).toEqual([2, "SHARED-1", "active", false]);
  });

  it("host/provider mismatch (Lion host, no NormGroupID) ⇒ null before ANY supplier query", async () => {
    wireDb(
      new Map<unknown, unknown[]>([
        [
          tours,
          [
            {
              sourceUrl: "https://travel.liontravel.com/product/detail/UV-PROD-9",
              productCode: "UV-PROD-9",
            },
          ],
        ],
        [suppliers, [uvSupplier]], // must be unreachable
        [supplierProducts, [{ id: 501 }]], // must be unreachable
      ]),
    );
    expect(await getTrustedSupplierAvailabilityByTourId(42)).toBeNull();
    expect(captured.map((c) => c.table)).toEqual([tours]);
  });

  it("unknown host ⇒ null before ANY supplier query", async () => {
    wireDb(
      new Map<unknown, unknown[]>([
        [
          tours,
          [
            {
              sourceUrl: "https://www.attacker.com/product/detail/UV-PROD-9",
              productCode: null,
            },
          ],
        ],
        [suppliers, [uvSupplier]],
        [supplierProducts, [{ id: 501 }]],
      ]),
    );
    expect(await getTrustedSupplierAvailabilityByTourId(42)).toBeNull();
    expect(captured.map((c) => c.table)).toEqual([tours]);
  });

  it("no sourceUrl + productCode that collides with some supplier's code ⇒ null (fail-closed)", async () => {
    // Without a host there is NO provider identity — a bare productCode must
    // never be allowed to match an arbitrary supplier's product.
    wireDb(
      new Map<unknown, unknown[]>([
        [tours, [{ sourceUrl: null, productCode: "SHARED-1" }]],
        [suppliers, [uvSupplier]], // must be unreachable
        [supplierProducts, [{ id: 501 }]], // must be unreachable
      ]),
    );
    expect(await getTrustedSupplierAvailabilityByTourId(42)).toBeNull();
    expect(captured.map((c) => c.table)).toEqual([tours]);
  });

  it("inactive supplier (kill switch) ⇒ null; products never queried", async () => {
    wireDb(
      new Map<unknown, unknown[]>([
        [tours, [tourRow]],
        [suppliers, []], // isActive=false rows are filtered out by the WHERE
        [supplierProducts, [{ id: 501 }]], // must be unreachable
      ]),
    );
    expect(await getTrustedSupplierAvailabilityByTourId(42)).toBeNull();
    expect(captured.map((c) => c.table)).toEqual([tours, suppliers]);
    const supplierQuery = captured.find((c) => c.table === suppliers)!;
    expect(supplierQuery.whereParams).toEqual(["uv", true]);
  });

  it("inactive/hidden supplier product ⇒ null; departures never queried", async () => {
    wireDb(
      new Map<unknown, unknown[]>([
        [tours, [tourRow]],
        [suppliers, [uvSupplier]],
        [supplierProducts, []], // hidden/inactive rows are filtered out by the WHERE
        [supplierDepartures, [{ departureDate: new Date(), availability: "available" }]],
      ]),
    );
    expect(await getTrustedSupplierAvailabilityByTourId(42)).toBeNull();
    expect(captured.map((c) => c.table)).toEqual([tours, suppliers, supplierProducts]);
  });

  it("ambiguous multi-match on supplierProducts ⇒ null (never an arbitrary pick)", async () => {
    // >1 row would mean the composite-unique invariant itself is broken —
    // ambiguous evidence must fail closed, not limit(1)-pick a winner.
    wireDb(
      new Map<unknown, unknown[]>([
        [tours, [tourRow]],
        [suppliers, [uvSupplier]],
        [supplierProducts, [{ id: 501 }, { id: 502 }]],
        [supplierDepartures, [{ departureDate: new Date(), availability: "available" }]],
      ]),
    );
    expect(await getTrustedSupplierAvailabilityByTourId(42)).toBeNull();
    expect(captured.map((c) => c.table)).toEqual([tours, suppliers, supplierProducts]);
  });

  it("correct provider + duplicate same-day rows keep the LEAST available state (fail-closed)", async () => {
    wireDb(
      new Map<unknown, unknown[]>([
        [tours, [tourRow]],
        [suppliers, [uvSupplier]],
        [supplierProducts, [{ id: 501 }]],
        [
          supplierDepartures,
          [
            { departureDate: new Date("2026-09-14T00:00:00Z"), availability: "available" },
            { departureDate: new Date("2026-09-14T00:00:00Z"), availability: "unavailable" },
          ],
        ],
      ]),
    );
    const map = await getTrustedSupplierAvailabilityByTourId(42);
    expect(map!.get("2026-09-14")).toBe("unavailable");
  });

  it("no matching tour ⇒ null (no trust chain)", async () => {
    wireDb(new Map([[tours, []]]));
    expect(await getTrustedSupplierAvailabilityByTourId(42)).toBeNull();
  });

  it("tour without any supplier linkage ⇒ null", async () => {
    wireDb(new Map([[tours, [{ sourceUrl: null, productCode: null }]]]));
    expect(await getTrustedSupplierAvailabilityByTourId(42)).toBeNull();
  });
});

describe("router publish-chain against the REAL query layer (driver-only stub)", () => {
  const publishedPv = { id: 10, tourId: 42, versionNumber: 2, status: "published" };
  const publishedIv = {
    id: 55,
    productVersionId: 10,
    schemaVersion: "packgo.itinerary.v1",
    itineraryId: "MAD-5D",
    versionNumber: 3,
    sourceStatus: "source_document",
    originMarket: "US-CA",
    destinationJurisdictions: null,
    status: "published",
  };

  it("getItineraryContract: no published productVersion ⇒ null, children never queried", async () => {
    wireDb(
      new Map<unknown, unknown[]>([
        [productVersions, []], // nothing published
        [itineraryVersions, [publishedIv]], // exists, but must be unreachable
      ]),
    );
    const result = await caller().getItineraryContract({ tourId: 42 });
    expect(result).toBeNull();
    expect(captured.map((c) => c.table)).toEqual([productVersions]);
  });

  it("getItineraryContract: full published chain walks top-down and serves the contract", async () => {
    wireDb(
      new Map<unknown, unknown[]>([
        [productVersions, [publishedPv]],
        [itineraryVersions, [publishedIv]],
        [itineraryDays, []],
        [itineraryStops, []],
      ]),
    );
    const result = await caller().getItineraryContract({ tourId: 42 });
    expect(result).not.toBeNull();
    expect(result!.itineraryId).toBe("MAD-5D");
    // Top-down ancestry order: parent gate first, then the child.
    expect(captured.map((c) => c.table)).toEqual([
      productVersions,
      itineraryVersions,
      itineraryDays,
    ]);
    expect(captured[0].whereParams).toEqual([42, "published"]);
    expect(captured[1].whereParams).toEqual([10, "published"]);
  });

  it("getFeeDisclosure: no published productVersion ⇒ awaiting, contracts never queried", async () => {
    wireDb(
      new Map<unknown, unknown[]>([
        [productVersions, []],
        [feeContracts, [{ id: 77, status: "published" }]], // unreachable
      ]),
    );
    const d = await caller().getFeeDisclosure({ tourId: 42 });
    expect(d.status).toBe("awaiting_supplier_quote");
    expect(d.totals).toBeNull();
    expect(captured.map((c) => c.table)).toEqual([productVersions]);
  });

  it("listDepartures: supplier-scoped trust chain drives buckets end-to-end", async () => {
    const depDate = new Date(Date.now() + 30 * 86_400_000);
    const retDate = new Date(Date.now() + 35 * 86_400_000);
    wireDb(
      new Map<unknown, unknown[]>([
        [productVersions, [publishedPv]],
        [
          tours,
          [
            {
              sourceUrl: "https://www.uvbookings.com/product/detail/UV-PROD-9",
              productCode: null,
            },
          ],
        ],
        [suppliers, [{ id: 2 }]],
        [supplierProducts, [{ id: 501 }]],
        [supplierDepartures, [{ departureDate: depDate, availability: "limited" }]],
      ]),
    );
    (dbModule.getTourDepartures as any).mockResolvedValue([
      {
        id: 900,
        tourId: 42,
        departureDate: depDate,
        returnDate: retDate,
        adultPrice: 1998,
        currency: "USD",
        status: "open",
        totalSlots: 20, // must be ignored — supplier says limited
        bookedSlots: 0,
      },
    ]);
    const result = await caller().listDepartures({ tourId: 42 });
    expect(result.map((d: any) => [d.id, d.bucket])).toEqual([[900, "few"]]);
    // The trust chain really was supplier-scoped: active-supplier kill
    // switch + supplierId-bound product lookup both executed.
    const supplierQuery = captured.find((c) => c.table === suppliers)!;
    expect(supplierQuery.whereParams).toEqual(["uv", true]);
    const productQuery = captured.find((c) => c.table === supplierProducts)!;
    expect(productQuery.whereParams).toEqual([2, "UV-PROD-9", "active", false]);
  });

  it("listDepartures: published product but NO supplier evidence ⇒ [] (fail-closed)", async () => {
    wireDb(
      new Map<unknown, unknown[]>([
        [productVersions, [publishedPv]],
        [tours, [{ sourceUrl: null, productCode: null }]], // no linkage
      ]),
    );
    (dbModule.getTourDepartures as any).mockResolvedValue([
      {
        id: 900,
        departureDate: new Date(Date.now() + 30 * 86_400_000),
        returnDate: new Date(Date.now() + 35 * 86_400_000),
        adultPrice: 1998,
        currency: "USD",
        status: "open",
      },
    ]);
    expect(await caller().listDepartures({ tourId: 42 })).toEqual([]);
  });

  it("listDepartures: host/provider mismatch ⇒ [] even when a same-code product exists", async () => {
    // Lion host without a NormGroupID + a productCode that WOULD match some
    // supplier's product — the router must still list nothing.
    wireDb(
      new Map<unknown, unknown[]>([
        [productVersions, [publishedPv]],
        [
          tours,
          [
            {
              sourceUrl: "https://travel.liontravel.com/product/detail/UV-PROD-9",
              productCode: "UV-PROD-9",
            },
          ],
        ],
        [suppliers, [{ id: 2 }]], // must be unreachable
        [supplierProducts, [{ id: 501 }]], // must be unreachable
        [
          supplierDepartures,
          [
            {
              departureDate: new Date(Date.now() + 30 * 86_400_000),
              availability: "available",
            },
          ],
        ],
      ]),
    );
    (dbModule.getTourDepartures as any).mockResolvedValue([
      {
        id: 900,
        departureDate: new Date(Date.now() + 30 * 86_400_000),
        returnDate: new Date(Date.now() + 35 * 86_400_000),
        adultPrice: 1998,
        currency: "USD",
        status: "open",
      },
    ]);
    expect(await caller().listDepartures({ tourId: 42 })).toEqual([]);
    expect(captured.map((c) => c.table)).toEqual([productVersions, tours]);
  });

  it("listDepartures: inactive supplier kill switch ⇒ [] (fail-closed)", async () => {
    wireDb(
      new Map<unknown, unknown[]>([
        [productVersions, [publishedPv]],
        [
          tours,
          [
            {
              sourceUrl: "https://www.uvbookings.com/product/detail/UV-PROD-9",
              productCode: null,
            },
          ],
        ],
        [suppliers, []], // inactive rows filtered out by the WHERE
        [supplierProducts, [{ id: 501 }]], // must be unreachable
      ]),
    );
    (dbModule.getTourDepartures as any).mockResolvedValue([
      {
        id: 900,
        departureDate: new Date(Date.now() + 30 * 86_400_000),
        returnDate: new Date(Date.now() + 35 * 86_400_000),
        adultPrice: 1998,
        currency: "USD",
        status: "open",
      },
    ]);
    expect(await caller().listDepartures({ tourId: 42 })).toEqual([]);
    expect(captured.map((c) => c.table)).toEqual([productVersions, tours, suppliers]);
  });
});
