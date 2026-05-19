/**
 * Phase 5A · module 5A — Lion supplier sync tests.
 *
 * Mix of pure-function tests (no DB / no network) and orchestrator tests
 * (in-memory drizzle stub + mocked Lion HTTP client). Same precedent as
 * server/_core/stripeWebhook.refunds.test.ts: mock the DB module's
 * `getDb` to hand back a hand-rolled drizzle-ish stub.
 *
 * Cases (7):
 *   1. Happy 2-product / 6-departure sync
 *   2. Missing NormGroupID — row skipped, no crash, productsAdded=2
 *   3. Missing TourName with valid NormGroupID — pending-flag insert
 *   4. Unparseable GoDate regex — row skipped, no exception
 *   5. Single-digit month/day GoDate — zero-padded to YYYY-MM-DD
 *   6. Mid-page SupplierApiError — status="partial", partial data saved
 *   7. Stale-detection — disappeared products marked inactive
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import lionHappy from "./__fixtures__/lion-happy.json";
import lionMalformed from "./__fixtures__/lion-malformed.json";
import type { LionGroupEntry, LionNormGroup } from "../../suppliers/lionClient";

/* ─── helpers under test (pure) ─── */
import { lionToProductInsert, lionGroupToDeparture } from "./lion";

/* ─── orchestrator under test ─── */
// Imported lazily AFTER mocks are installed below.

/* ─────────────────────────────────────────────────────────────────────
 *  In-memory store for the drizzle-ish stub.
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
  // Stored as STRING per Phase 5A · audit P1-10 (Drizzle date column is
  // ISO-string-native at the wire level).
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
  productsScanned?: number;
  productsAdded?: number;
  productsUpdated?: number;
  productsDeactivated?: number;
  departuresScanned?: number;
  departuresUpdated?: number;
  errorMessage?: string;
  finishedAt?: Date;
  durationMs?: number;
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
  store.suppliers = [{ id: 100, code: "lion" }];
  store.products = [];
  store.departures = [];
  store.runs = [];
  store.nextProductId = 1;
  store.nextDepartureId = 1;
  store.nextRunId = 1;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Drizzle stub. We model the chains:
 *    db.select({...}).from(tbl).where(token).limit(n)
 *    db.insert(tbl).values(v).onDuplicateKeyUpdate({ set: u })
 *    db.update(tbl).set(updates).where(token)
 * ─────────────────────────────────────────────────────────────────── */

type TableId = "suppliers" | "products" | "departures" | "runs";

function tableIdFor(tbl: unknown): TableId {
  return (tbl as { __table?: TableId })?.__table ?? "products";
}

// Predicate-token interpreter (eq / and / sql<IN>). All tokens are opaque
// objects produced by the mocked drizzle-orm operators (see vi.mock block).
function matchToken(token: any, row: any, tableId: TableId): boolean {
  if (!token) return true;
  if (token.__and) return token.children.every((c: any) => matchToken(c, row, tableId));
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
        store.runs.push({
          id,
          supplierId: value.supplierId,
          kind: value.kind,
          status: value.status,
          startedAt: new Date(),
        });
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
          currency: value.currency ?? "TWD",
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

/* ─────────────────────────────────────────────────────────────────────
 *  Mocks for db + drizzle/schema + drizzle-orm + lionClient.
 * ─────────────────────────────────────────────────────────────────── */

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => currentDb),
}));

vi.mock("../../../drizzle/schema", () => ({
  suppliers: {
    __table: "suppliers",
    id: { __column: "id" },
    code: { __column: "code" },
    displayName: { __column: "displayName" },
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
  // The `sql` tag is used in two ways inside supplierSync/lion + uv:
  //   1. sql.join(stale, sql`, `) — builds a comma-separated list of ids
  //   2. sql`${productsTable.id} IN (${sql.join(...)})` — embeds it in IN
  // We pattern-match the resulting token shape and pull the id list out
  // so the stub can filter rows correctly.
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      // Find any embedded `__sqlInValues` token in the values array.
      const inValuesEmbed = values.find(
        (v) => v && typeof v === "object" && (v as any).__sqlInValues
      );
      if (inValuesEmbed) {
        // Determine which column the IN is filtering on. The first value
        // is the column reference (e.g. productsTable.id).
        const firstVal = values[0] as any;
        const field = firstVal?.__column ?? "id";
        return {
          __sqlIn: true,
          field,
          values: (inValuesEmbed as any).__sqlInValues,
        };
      }
      // Generic SQL clauses (used for COUNT/SUM in reporting) — opaque.
      return { __sqlRaw: true, strings, values };
    },
    {
      join: (arr: any[], _sep: any) => ({ __sqlInValues: arr }),
    }
  ),
}));

// Lion HTTP client — mocked so tests are deterministic + offline.
// `vi.hoisted` ensures the mock fn exists BEFORE vi.mock's factory runs
// (mocks are hoisted to the top of the module by vitest at transform time).
const { lionSearchMock } = vi.hoisted(() => ({ lionSearchMock: (vi as any).fn() }));
vi.mock("../../suppliers/lionClient", async () => {
  const types = await vi.importActual<typeof import("../../suppliers/types")>(
    "../../suppliers/types"
  );
  return {
    searchProducts: lionSearchMock,
    SupplierApiError: (types as any).SupplierApiError,
  };
});

/* ─────────────────────────────────────────────────────────────────────
 *  Pure helpers — no mocks needed for these.
 * ─────────────────────────────────────────────────────────────────── */

describe("lionToProductInsert (pure)", () => {
  const SUPPLIER_ID = 100;

  it("returns null when NormGroupID is missing", () => {
    const norm = { ...(lionHappy.NormGroupList[0] as LionNormGroup), NormGroupID: "" };
    expect(lionToProductInsert(norm, SUPPLIER_ID)).toBeNull();
  });

  it("returns null when TourName is missing", () => {
    const norm = { ...(lionHappy.NormGroupList[0] as LionNormGroup), TourName: "" };
    expect(lionToProductInsert(norm, SUPPLIER_ID)).toBeNull();
  });

  it("maps a canonical Lion group to InsertSupplierProduct", () => {
    const insert = lionToProductInsert(
      lionHappy.NormGroupList[0] as LionNormGroup,
      SUPPLIER_ID
    );
    expect(insert).not.toBeNull();
    expect(insert).toMatchObject({
      supplierId: SUPPLIER_ID,
      externalProductCode: "LION-NG-0001",
      title: "美西黃石9日精選遊",
      days: 9,
      departureCity: "台北",
      currency: "TWD",
      status: "active",
    });
  });
});

describe("lionGroupToDeparture (pure) — date parsing", () => {
  const SUPPLIER_ID = 100;
  const PRODUCT_ID = 1;

  it("parses canonical YYYY/MM/DD to YYYY-MM-DD STRING (not Date)", () => {
    const grp: LionGroupEntry = lionHappy.NormGroupList[0].GroupList[0] as LionGroupEntry;
    const dep = lionGroupToDeparture(grp, PRODUCT_ID, SUPPLIER_ID);
    expect(dep).not.toBeNull();
    // Drizzle's $inferInsert type says `Date` but we cast a string in to
    // avoid Asia/Taipei↔UTC drift. Confirm the stored value IS a string.
    expect(typeof (dep as any).departureDate).toBe("string");
    expect((dep as any).departureDate).toBe("2026-06-15");
  });

  it("zero-pads single-digit month/day in GoDate (\"2026/4/15\" → \"2026-04-15\")", () => {
    const grp: LionGroupEntry = lionHappy.NormGroupList[1].GroupList[2] as LionGroupEntry;
    const dep = lionGroupToDeparture(grp, PRODUCT_ID, SUPPLIER_ID);
    expect(dep).not.toBeNull();
    expect((dep as any).departureDate).toBe("2026-04-15");
  });

  it("returns null for unparseable GoDate (\"2026-13-45\")", () => {
    const grp: LionGroupEntry = {
      ...(lionHappy.NormGroupList[0].GroupList[0] as LionGroupEntry),
      GoDate: "2026-13-45",
    };
    expect(lionGroupToDeparture(grp, PRODUCT_ID, SUPPLIER_ID)).toBeNull();
  });

  it("returns null for garbage GoDate (\"garbage\")", () => {
    const grp: LionGroupEntry = {
      ...(lionHappy.NormGroupList[0].GroupList[0] as LionGroupEntry),
      GoDate: "garbage",
    };
    expect(lionGroupToDeparture(grp, PRODUCT_ID, SUPPLIER_ID)).toBeNull();
  });

  it("maps Status correctly to availability bucket", () => {
    const list = lionHappy.NormGroupList[0].GroupList as LionGroupEntry[];
    expect(
      lionGroupToDeparture(list[0], PRODUCT_ID, SUPPLIER_ID)?.availability
    ).toBe("available");
    expect(
      lionGroupToDeparture(list[1], PRODUCT_ID, SUPPLIER_ID)?.availability
    ).toBe("limited");
    expect(
      lionGroupToDeparture(list[2], PRODUCT_ID, SUPPLIER_ID)?.availability
    ).toBe("full");
  });
});

/* ─────────────────────────────────────────────────────────────────────
 *  Orchestrator: syncLionCatalog (mocked HTTP + drizzle stub).
 * ─────────────────────────────────────────────────────────────────── */

describe("syncLionCatalog (orchestrator)", () => {
  beforeEach(() => {
    resetStore();
    currentDb = makeDrizzleStub();
    lionSearchMock.mockReset();
  });

  it("Case 1 — happy 2-product / 6-departure sync", async () => {
    lionSearchMock.mockResolvedValueOnce(lionHappy);
    const { syncLionCatalog } = await import("./lion");
    const res = await syncLionCatalog();
    expect(res.status).toBe("success");
    expect(res.productsAdded).toBe(2);
    expect(res.departuresUpdated).toBe(6);
    expect(res.newProductCodes).toEqual(["LION-NG-0001", "LION-NG-0002"]);
    // Verify rows landed in our in-memory store.
    expect(store.products.filter((p) => p.status === "active").length).toBe(2);
    expect(store.departures.length).toBe(6);
    // Sanity-check: all departureDate values are ISO strings (not Date).
    for (const d of store.departures) {
      expect(typeof d.departureDate).toBe("string");
      expect(d.departureDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("Case 2 — missing NormGroupID is skipped; pending TourName-missing row inserted (then stale-flagged)", async () => {
    // The malformed fixture has 3 NormGroups:
    //   1. LION-NG-OK             — valid (active)
    //   2. ""                      — skipped (no NormGroupID at all)
    //   3. LION-NG-PENDING         — pending-flag insert (NormGroupID OK, TourName empty)
    //
    // OBSERVED PRODUCTION BEHAVIOR (preserved by this refactor):
    //   The pending-flag insert path at lines 317-331 of lion.ts does NOT
    //   add the code to `seenCodes`. As a result, the FIRST-sync stale-
    //   detection sweep at the end of the run flips the brand-new
    //   pending row to status="inactive". A subsequent re-sync with the
    //   same malformed payload would keep it inactive (because it's
    //   still not in seenCodes).
    //
    // This is a latent quirk of the production code (worth fixing in
    // a follow-up: add `seenCodes.add(norm.NormGroupID)` to the pending
    // branch). Phase 5A is structural-only, so we LOCK IN the current
    // behavior with this regression-anchor test — if a future cleanup
    // adds the missing seenCodes.add() the assertion below must update.
    lionSearchMock.mockResolvedValueOnce(lionMalformed);
    const { syncLionCatalog } = await import("./lion");
    const res = await syncLionCatalog();
    expect(res.status).toBe("success");

    // Active path: 1 row (LION-NG-OK).
    const active = store.products.filter((p) => p.status === "active");
    expect(active.length).toBe(1);
    expect(active[0].externalProductCode).toBe("LION-NG-OK");

    // The pending row got inserted, then flipped to inactive during
    // stale-detection (see comment above). Both states are evidence the
    // pending-write path executed without crashing.
    const pendingRow = store.products.find(
      (p) => p.externalProductCode === "LION-NG-PENDING"
    );
    expect(pendingRow).toBeDefined();
    // Status post-sync: inactive (stale-flagged). Title was the fallback.
    expect(pendingRow?.status).toBe("inactive");
    expect(pendingRow?.title).toBe("(missing title)");

    // The empty-NormGroupID row should never have been inserted.
    expect(
      store.products.find((p) => p.externalProductCode === "")
    ).toBeUndefined();

    // productsScanned counts all 3 NormGroups even though one is dropped.
    expect(res.productsScanned).toBe(3);
    expect(res.productsAdded).toBe(1); // only the OK one gets counted in productsAdded
  });

  it("Case 6 — mid-page Lion API throw → status='partial', earlier products preserved", async () => {
    // Simulate Lion mid-sync: page 1 succeeds and reports TotalPage=2
    // with EXACTLY 200 NormGroups (so the early-break heuristic at
    // `groups.length < PAGE_SIZE` doesn't fire). Page 2 throws.
    const page1Groups = Array.from({ length: 200 }, (_, i) => ({
      ...(lionHappy.NormGroupList[0] as LionNormGroup),
      NormGroupID: `LION-PAGE1-${String(i).padStart(3, "0")}`,
      TourName: `Page1 Product ${i}`,
      GroupList: [],
    }));
    lionSearchMock
      .mockResolvedValueOnce({
        TotalCount: 201,
        TotalPage: 2,
        CurrentPage: 1,
        Count: 200,
        NormGroupList: page1Groups,
      })
      .mockRejectedValueOnce(new Error("simulated Lion 500"));
    const { syncLionCatalog } = await import("./lion");
    const res = await syncLionCatalog();
    expect(res.status).toBe("partial");
    expect(res.errorMessage).toMatch(/simulated Lion 500/);
    // Page 1's 200 products should have been persisted before page 2 threw.
    expect(store.products.length).toBeGreaterThanOrEqual(200);
  });

  it("Case 7 — stale-detection: products absent from sync are marked inactive", async () => {
    // Pre-seed two products that won't appear in this sync.
    store.products.push(
      {
        id: store.nextProductId++,
        supplierId: 100,
        externalProductCode: "LION-OLD-A",
        title: "舊產品 A",
        days: 5,
        departureCity: null,
        destinationCountry: null,
        destinationCity: null,
        imageUrl: null,
        currency: "TWD",
        status: "active",
        isHiddenByAdmin: false,
        rawProductJson: null,
        lastSyncedAt: new Date(),
      },
      {
        id: store.nextProductId++,
        supplierId: 100,
        externalProductCode: "LION-OLD-B",
        title: "舊產品 B",
        days: 5,
        departureCity: null,
        destinationCountry: null,
        destinationCity: null,
        imageUrl: null,
        currency: "TWD",
        status: "active",
        isHiddenByAdmin: false,
        rawProductJson: null,
        lastSyncedAt: new Date(),
      }
    );

    lionSearchMock.mockResolvedValueOnce(lionHappy);
    const { syncLionCatalog } = await import("./lion");
    const res = await syncLionCatalog();
    expect(res.status).toBe("success");
    expect(res.productsDeactivated).toBe(2);
    expect(
      store.products.find((p) => p.externalProductCode === "LION-OLD-A")?.status
    ).toBe("inactive");
    expect(
      store.products.find((p) => p.externalProductCode === "LION-OLD-B")?.status
    ).toBe("inactive");
    // Fresh ones from the sync are still active.
    expect(
      store.products.find((p) => p.externalProductCode === "LION-NG-0001")?.status
    ).toBe("active");
  });
});
