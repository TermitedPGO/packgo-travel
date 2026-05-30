/**
 * Phase 5A · module 5A — UV Bookings supplier sync tests.
 *
 * The MONEY-ADJACENT module — wrong departure dates → wrong calendar →
 * wrong prices → refund liability. See audit P1-10.
 *
 * Cases (11):
 *   1. Happy 2-product / 4-departure sync
 *   2. groupDate "YYYY-MM-DD" (already ISO) — slice intact
 *   3. groupDate "YYYY-MM-DDTHH:mm:ss" — time portion stripped
 *   4. groupDate "YYYY-MM-DD+08:00" — timezone offset stripped, NO UTC drift
 *   5. Leap year "2024-02-29" — accepted verbatim
 *   6. Non-leap-year "2026-02-29" — accepted verbatim (downstream surfaces anomaly)
 *   7. DST "2026-03-08" — stored verbatim, NO timezone drift (regression anchor)
 *   8. Year boundary "2026-12-31" + "2027-01-01" — verbatim, no rollover bug
 *   9. Empty groupDate — uvRowToDeparture returns null, no crash
 *  10. Spare-seats arithmetic with negative-clamp at Math.max(0, ...)
 *  11. stockStatus !== 200 closed-flag → availability bucket via deriveAvailability
 *
 * Date-handling stance: `supplierDepartures.departureDate` is Drizzle's
 * `date()` column. We KEEP the ISO `YYYY-MM-DD` STRING throughout —
 * wrapping in `new Date()` would introduce Asia/Taipei↔UTC drift on
 * production. The DST + year-boundary tests below regression-anchor
 * this against any future regression that adds `new Date(...)`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import uvHappy from "./__fixtures__/uv-happy.json";
import uvDepartures from "./__fixtures__/uv-departures.json";
import type { UvDepartureRow, UvProductListItem } from "../../suppliers/uvClient";

import { uvToProductInsert, uvRowToDeparture } from "./uv";

/* ─────────────────────────────────────────────────────────────────────
 *  In-memory store (same shape as lion.test.ts).
 * ─────────────────────────────────────────────────────────────────── */

interface ProductRow {
  id: number;
  supplierId: number;
  externalProductCode: string;
  title: string;
  days: number;
  departureCity: string | null;
  destinationCountry: string | null;
  destinationCity: string | null;
  imageUrl: string | null;
  currency: string;
  status: "active" | "inactive" | "pending";
  isHiddenByAdmin: boolean;
  rawProductJson: string | null;
  lastSyncedAt: Date;
}

interface DepartureRow {
  id: number;
  supplierProductId: number;
  supplierId: number;
  externalDepartureCode: string;
  departureDate: string;
  retailPrice: string;
  agentPrice: string | null;
  currency: string;
  totalSeats: number;
  spareSeats: number;
  availability: "available" | "limited" | "full" | "unavailable";
  rawDepartureJson: string | null;
  lastSyncedAt: Date;
}

interface RunRow {
  id: number;
  supplierId: number;
  kind: string;
  status: string;
  startedAt: Date;
}

const store = {
  suppliers: [] as Array<{ id: number; code: string }>,
  products: [] as ProductRow[],
  departures: [] as DepartureRow[],
  runs: [] as RunRow[],
  nextProductId: 1,
  nextDepartureId: 1,
  nextRunId: 1,
};

function resetStore() {
  store.suppliers = [{ id: 200, code: "uv" }];
  store.products = [];
  store.departures = [];
  store.runs = [];
  store.nextProductId = 1;
  store.nextDepartureId = 1;
  store.nextRunId = 1;
}

/* ─── Same drizzle stub as Lion test, replicated locally for isolation. ─── */

type TableId = "suppliers" | "products" | "departures" | "runs";

function tableIdFor(tbl: unknown): TableId {
  return (tbl as { __table?: TableId })?.__table ?? "products";
}

function matchToken(token: any, row: any, _tableId: TableId): boolean {
  if (!token) return true;
  if (token.__and) return token.children.every((c: any) => matchToken(c, row, _tableId));
  if (token.__eq) return row[token.field] === token.value;
  if (token.__sqlIn) return token.values.includes(row[token.field]);
  return true;
}

function makeDrizzleStub() {
  const db: any = {
    select(fields?: Record<string, { __column: string }>) {
      return {
        from(tbl: unknown) {
          const tableId = tableIdFor(tbl);
          let collected: any[] = [];
          if (tableId === "suppliers") collected = store.suppliers;
          else if (tableId === "products") collected = store.products;
          else if (tableId === "departures") collected = store.departures;
          else if (tableId === "runs") collected = store.runs;

          const builder: any = {
            _where: undefined as any,
            _limit: undefined as number | undefined,
            where(token: any) {
              this._where = token;
              return this;
            },
            limit(n: number) {
              this._limit = n;
              return this._exec();
            },
            innerJoin() {
              return this;
            },
            orderBy() {
              return this;
            },
            _exec() {
              let rows = collected.filter((r) => matchToken(this._where, r, tableId));
              if (this._limit !== undefined) rows = rows.slice(0, this._limit);
              if (!fields) return rows;
              return rows.map((r) => {
                const out: any = {};
                for (const [outKey, col] of Object.entries(fields)) {
                  const colName = (col as any).__column ?? outKey;
                  out[outKey] = r[colName];
                }
                return out;
              });
            },
            then(onFulfilled: any, onRejected: any) {
              return Promise.resolve(this._exec()).then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
      };
    },

    insert(tbl: unknown) {
      const tableId = tableIdFor(tbl);
      return {
        values(v: any) {
          return {
            onDuplicateKeyUpdate(opts: { set: any }) {
              const out = db._performInsert(tableId, v, opts.set);
              return Promise.resolve(out);
            },
            then(onFulfilled: any, onRejected: any) {
              const out = db._performInsert(tableId, v, null);
              return Promise.resolve(out).then(onFulfilled, onRejected);
            },
          };
        },
      };
    },

    update(tbl: unknown) {
      const tableId = tableIdFor(tbl);
      return {
        set(updates: any) {
          return {
            where(token: any) {
              return Promise.resolve(db._performUpdate(tableId, updates, token));
            },
          };
        },
      };
    },

    _performInsert(tableId: TableId, value: any, updateOnDuplicate: any): any {
      if (tableId === "runs") {
        const id = store.nextRunId++;
        store.runs.push({ id, supplierId: value.supplierId, kind: value.kind, status: value.status, startedAt: new Date() });
        return [{ insertId: id }];
      }
      if (tableId === "products") {
        const existing = store.products.find(
          (p) =>
            p.supplierId === value.supplierId &&
            p.externalProductCode === value.externalProductCode
        );
        if (existing && updateOnDuplicate) {
          Object.assign(existing, updateOnDuplicate);
          return [{ insertId: existing.id, affectedRows: 2 }];
        }
        if (existing) return [{ insertId: existing.id, affectedRows: 0 }];
        const id = store.nextProductId++;
        store.products.push({
          id,
          supplierId: value.supplierId,
          externalProductCode: value.externalProductCode,
          title: value.title ?? "",
          days: value.days ?? 0,
          departureCity: value.departureCity ?? null,
          destinationCountry: value.destinationCountry ?? null,
          destinationCity: value.destinationCity ?? null,
          imageUrl: value.imageUrl ?? null,
          currency: value.currency ?? "USD",
          status: value.status ?? "active",
          isHiddenByAdmin: false,
          rawProductJson: value.rawProductJson ?? null,
          lastSyncedAt: new Date(),
        });
        return [{ insertId: id, affectedRows: 1 }];
      }
      if (tableId === "departures") {
        const existing = store.departures.find(
          (d) =>
            d.supplierProductId === value.supplierProductId &&
            d.externalDepartureCode === value.externalDepartureCode
        );
        if (existing && updateOnDuplicate) {
          Object.assign(existing, updateOnDuplicate);
          return [{ insertId: existing.id, affectedRows: 2 }];
        }
        if (existing) return [{ insertId: existing.id, affectedRows: 0 }];
        const id = store.nextDepartureId++;
        store.departures.push({
          id,
          supplierProductId: value.supplierProductId,
          supplierId: value.supplierId,
          externalDepartureCode: value.externalDepartureCode,
          // CRITICAL: store as STRING so the test surfaces any future
          // `new Date(...)` regression as a type mismatch in the assert.
          departureDate: String(value.departureDate),
          retailPrice: value.retailPrice,
          agentPrice: value.agentPrice ?? null,
          currency: value.currency,
          totalSeats: value.totalSeats ?? 0,
          spareSeats: value.spareSeats ?? 0,
          availability: value.availability,
          rawDepartureJson: value.rawDepartureJson ?? null,
          lastSyncedAt: new Date(),
        });
        return [{ insertId: id, affectedRows: 1 }];
      }
      return [{ insertId: 0, affectedRows: 0 }];
    },

    _performUpdate(tableId: TableId, updates: any, token: any): any {
      const rows =
        tableId === "products"
          ? store.products
          : tableId === "departures"
            ? store.departures
            : tableId === "runs"
              ? store.runs
              : tableId === "suppliers"
                ? store.suppliers
                : [];
      let affected = 0;
      for (const r of rows) {
        if (matchToken(token, r, tableId)) {
          Object.assign(r, updates);
          affected++;
        }
      }
      return [{ affectedRows: affected }];
    },
  };
  return db;
}

let currentDb: any = null;

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => currentDb),
}));

vi.mock("../../../drizzle/schema", () => ({
  suppliers: {
    __table: "suppliers",
    id: { __column: "id" },
    code: { __column: "code" },
  },
  supplierProducts: {
    __table: "products",
    id: { __column: "id" },
    supplierId: { __column: "supplierId" },
    externalProductCode: { __column: "externalProductCode" },
    status: { __column: "status" },
    isHiddenByAdmin: { __column: "isHiddenByAdmin" },
  },
  supplierDepartures: {
    __table: "departures",
    id: { __column: "id" },
    supplierProductId: { __column: "supplierProductId" },
    externalDepartureCode: { __column: "externalDepartureCode" },
    departureDate: { __column: "departureDate" },
  },
  supplierSyncRuns: { __table: "runs", id: { __column: "id" } },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((field: any, value: unknown) => ({
    __eq: true,
    field: field?.__column ?? field,
    value,
  })),
  and: vi.fn((...children: any[]) => ({ __and: true, children })),
  desc: vi.fn((c: any) => c),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const inValuesEmbed = values.find(
        (v) => v && typeof v === "object" && (v as any).__sqlInValues
      );
      if (inValuesEmbed) {
        const firstVal = values[0] as any;
        const field = firstVal?.__column ?? "id";
        return {
          __sqlIn: true,
          field,
          values: (inValuesEmbed as any).__sqlInValues,
        };
      }
      return { __sqlRaw: true, strings, values };
    },
    {
      join: (arr: any[], _sep: any) => ({ __sqlInValues: arr }),
    }
  ),
}));

// UV HTTP client mocks. `vi.hoisted` so the mock fns exist when the
// vi.mock factory runs.
const { uvListMock, uvDeparturesMock } = vi.hoisted(() => ({
  uvListMock: (vi as any).fn(),
  uvDeparturesMock: (vi as any).fn(),
}));
vi.mock("../../suppliers/uvClient", async () => {
  return {
    listProducts: uvListMock,
    getDeparturesNext180Days: uvDeparturesMock,
  };
});

/* ─────────────────────────────────────────────────────────────────────
 *  Pure helpers — uvToProductInsert.
 * ─────────────────────────────────────────────────────────────────── */

describe("uvToProductInsert (pure)", () => {
  const SUPPLIER_ID = 200;

  it("returns null when productCode is missing", () => {
    const item = { ...(uvHappy.list[0] as UvProductListItem), productCode: "" };
    expect(uvToProductInsert(item, SUPPLIER_ID)).toBeNull();
  });

  it("returns null when productName is missing", () => {
    const item = { ...(uvHappy.list[0] as UvProductListItem), productName: "" };
    expect(uvToProductInsert(item, SUPPLIER_ID)).toBeNull();
  });

  it("maps a canonical UV item to InsertSupplierProduct with USD currency", () => {
    const insert = uvToProductInsert(
      uvHappy.list[0] as UvProductListItem,
      SUPPLIER_ID
    );
    expect(insert).toMatchObject({
      supplierId: SUPPLIER_ID,
      externalProductCode: "P00100001",
      title: "California Coast 7-Day Tour",
      days: 7,
      departureCity: "Los Angeles",
      destinationCity: "San Francisco",
      currency: "USD",
      status: "active",
    });
  });
});

/* ─────────────────────────────────────────────────────────────────────
 *  Pure helpers — uvRowToDeparture (date-edge cases live here).
 * ─────────────────────────────────────────────────────────────────── */

describe("uvRowToDeparture (pure) — date edge cases", () => {
  const SUPPLIER_ID = 200;
  const PRODUCT_ID = 1;
  const PRODUCT_CODE = "P00100001";

  function makeRow(overrides: Partial<UvDepartureRow>): UvDepartureRow {
    return {
      groupDate: "2026-06-01",
      groupStock: 20,
      groupSaleStock: 5,
      stockStatus: 200,
      groupPrice: [{ priceType: 4, groupPrice: 1499 }],
      currencyNum: "USD",
      ...overrides,
    };
  }

  it("Case 9 — empty groupDate returns null, no crash", () => {
    expect(
      uvRowToDeparture(makeRow({ groupDate: "" }), PRODUCT_CODE, PRODUCT_ID, SUPPLIER_ID)
    ).toBeNull();
  });

  it("Case 2 — ISO YYYY-MM-DD stored as plain STRING (not Date)", () => {
    const dep = uvRowToDeparture(
      makeRow({ groupDate: "2026-06-15" }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    expect(dep).not.toBeNull();
    expect(typeof (dep as any).departureDate).toBe("string");
    expect((dep as any).departureDate).toBe("2026-06-15");
  });

  it("Case 3 — datetime YYYY-MM-DDTHH:mm:ss → date portion stripped", () => {
    const dep = uvRowToDeparture(
      makeRow({ groupDate: "2026-06-15T08:30:00" }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    expect((dep as any).departureDate).toBe("2026-06-15");
  });

  it("Case 4 — date+timezone-offset YYYY-MM-DD+08:00 → date portion stripped, NO UTC drift", () => {
    // UV publishes departure dates in Asia/Taipei local. We store the
    // calendar day as-published. If we were to wrap with new Date() the
    // server's local timezone (typically UTC) would shift this to the
    // previous day for Taipei evening times. The slice(0,10) approach
    // is timezone-safe. This test pins that.
    const dep = uvRowToDeparture(
      makeRow({ groupDate: "2026-12-31+08:00" }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    expect((dep as any).departureDate).toBe("2026-12-31");
    // Critical: NOT "2026-12-30" (which is what new Date("2026-12-31+08:00")
    // followed by toISOString().slice(0,10) on a UTC server would produce).
    expect((dep as any).departureDate).not.toBe("2026-12-30");
  });

  it("Case 5 — leap year 2024-02-29 accepted verbatim", () => {
    const dep = uvRowToDeparture(
      makeRow({ groupDate: "2024-02-29" }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    expect((dep as any).departureDate).toBe("2024-02-29");
  });

  it("Case 6 — non-leap-year 2026-02-29 accepted verbatim (no crash; surfaced downstream)", () => {
    // 2026 is not a leap year. The .slice(0,10) approach treats this
    // lexically — no validation, no crash. Downstream catalog renders
    // will surface impossible dates as red flags but the sync MUST NOT
    // crash. This documents that behavior.
    const dep = uvRowToDeparture(
      makeRow({ groupDate: "2026-02-29" }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    expect(dep).not.toBeNull();
    expect((dep as any).departureDate).toBe("2026-02-29");
  });

  it("Case 7 — DST transition 2026-03-08 (US spring-forward) stored verbatim — REGRESSION ANCHOR", () => {
    // 2026-03-08 is the US DST "spring forward" day. If any future
    // refactor wraps with `new Date("2026-03-08")` then calls
    // toISOString().slice(0,10) on a server in a US timezone, the
    // result can shift to 2026-03-07 (the JS Date constructor parses
    // YYYY-MM-DD as UTC midnight, then local-time formatters can show
    // it as the prior day). This test locks the string-form approach.
    const dep = uvRowToDeparture(
      makeRow({ groupDate: "2026-03-08" }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    expect((dep as any).departureDate).toBe("2026-03-08");
    expect((dep as any).departureDate).not.toBe("2026-03-07");
    expect((dep as any).departureDate).not.toBe("2026-03-09");
  });

  it("Case 7b — DST transition 2026-11-01 (US fall-back) stored verbatim", () => {
    // Companion regression-anchor: US fall-back DST date.
    const dep = uvRowToDeparture(
      makeRow({ groupDate: "2026-11-01" }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    expect((dep as any).departureDate).toBe("2026-11-01");
  });

  it("Case 8 — year boundary 2026-12-31 and 2027-01-01 stored verbatim", () => {
    const dec = uvRowToDeparture(
      makeRow({ groupDate: "2026-12-31" }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    expect((dec as any).departureDate).toBe("2026-12-31");
    const jan = uvRowToDeparture(
      makeRow({ groupDate: "2027-01-01" }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    expect((jan as any).departureDate).toBe("2027-01-01");
  });

  it("Case 10 — spare-seats arithmetic + Math.max(0,...) clamp", () => {
    // Happy: groupStock=20, sold=5 → spare=15
    const happy = uvRowToDeparture(
      makeRow({ groupStock: 20, groupSaleStock: 5 }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    expect(happy?.totalSeats).toBe(20);
    expect(happy?.spareSeats).toBe(15);

    // Negative: groupStock=20, sold=25 → spare clamped to 0
    const oversold = uvRowToDeparture(
      makeRow({ groupStock: 20, groupSaleStock: 25 }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    expect(oversold?.spareSeats).toBe(0);
    // With spareSeats=0 and not closed, availability is "full".
    expect(oversold?.availability).toBe("full");
  });

  it("Case 11 — stockStatus !== 200 (closed) → availability='unavailable'", () => {
    const closed = uvRowToDeparture(
      makeRow({ stockStatus: 100, groupStock: 20, groupSaleStock: 0 }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    // deriveAvailability(spareSeats=20, supplierClosed=true) → "unavailable"
    expect(closed?.availability).toBe("unavailable");
  });

  it("constructs externalDepartureCode from productCode + dateStr", () => {
    const dep = uvRowToDeparture(
      makeRow({ groupDate: "2026-06-15T08:30:00" }),
      "P00100001",
      1,
      200
    );
    expect(dep?.externalDepartureCode).toBe("P00100001__2026-06-15");
  });

  it("picks 兩人一房 (priceType=4, double-occupancy) price, not 單人入住 (priceType=3)", () => {
    // priceType is ROOM OCCUPANCY: 3=單人入住 (single, dearest) descends to
    // 6=四人 (cheapest). We must quote the 兩人一房 (priceType=4) per-person
    // price; using priceType=3 (single, single-supp baked in) over-quotes.
    const withDouble = uvRowToDeparture(
      makeRow({
        groupPrice: [
          { priceType: 3, groupPrice: 1348 }, // 單人入住 (single — must NOT pick)
          { priceType: 4, groupPrice: 998 }, // 兩人一房 (the standard basis)
          { priceType: 5, groupPrice: 898 }, // 三人
          { priceType: 6, groupPrice: 868 }, // 四人
        ],
      }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    expect(withDouble?.retailPrice).toBe("998");

    // Fallback: if priceType 4 is absent, use the first row.
    const noDouble = uvRowToDeparture(
      makeRow({ groupPrice: [{ priceType: 3, groupPrice: 1348 }] }),
      PRODUCT_CODE,
      PRODUCT_ID,
      SUPPLIER_ID
    );
    expect(noDouble?.retailPrice).toBe("1348");
  });
});

/* ─────────────────────────────────────────────────────────────────────
 *  Orchestrator: syncUvCatalog — Case 1 (happy 2-product / 4-departure).
 * ─────────────────────────────────────────────────────────────────── */

describe("syncUvCatalog (orchestrator)", () => {
  beforeEach(() => {
    resetStore();
    currentDb = makeDrizzleStub();
    uvListMock.mockReset();
    uvDeparturesMock.mockReset();
  });

  it("Case 1 — happy 2-product / 4-departure sync", async () => {
    uvListMock.mockResolvedValueOnce(uvHappy);
    // First product fetch → departures for P00100001 (2 rows)
    // Second → departures for P00100002 (2 rows)
    uvDeparturesMock.mockImplementation(async (productCode: string) => {
      return (uvDepartures as any)[productCode] ?? [];
    });

    const { syncUvCatalog } = await import("./uv");
    const res = await syncUvCatalog();
    expect(res.status).toBe("success");
    expect(res.productsAdded).toBe(2);
    expect(res.departuresUpdated).toBe(4);
    expect(res.newProductCodes).toEqual(["P00100001", "P00100002"]);

    // All inserted departures must have STRING dates.
    for (const d of store.departures) {
      expect(typeof d.departureDate).toBe("string");
      expect(d.departureDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Spot-check availability bucketing:
    //   P00100001 / 2026-06-01: spare=15 → available
    //   P00100001 / 2026-06-08: spare=0  → full
    //   P00100002 / 2026-07-04: spare=2  → limited
    //   P00100002 / 2026-07-11: stockStatus=100 → unavailable
    const findByCode = (code: string) =>
      store.departures.find((d) => d.externalDepartureCode === code);
    expect(findByCode("P00100001__2026-06-01")?.availability).toBe("available");
    expect(findByCode("P00100001__2026-06-08")?.availability).toBe("full");
    expect(findByCode("P00100002__2026-07-04")?.availability).toBe("limited");
    expect(findByCode("P00100002__2026-07-11")?.availability).toBe("unavailable");
  });
});
