/**
 * Batch P1b — publish command tests against the REAL module.
 *
 * Same driver-only stub discipline as queries.test.ts / importDraft.test.ts:
 * the module's transaction, reads, and writes all run for real; the stub
 * records every operation (WHERE rendered to real SQL) plus transaction
 * boundaries, so tests can prove the one-published-per-tour supersede and
 * the publish happen in the SAME transaction, and that publishing never
 * deletes rows (append-only history).
 */
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import {
  feeContracts,
  feeItems,
  itineraryDays,
  itineraryStops,
  itineraryVersions,
  productVersions,
  tours,
} from "../../drizzle/schema";
import * as dbModule from "../db";
import {
  buildContentHashPayload,
  canonicalJsonStringify,
  codePointCompare,
  computeContentHash,
  listVersionsForTour,
  publishProductVersion,
} from "./publish";

const dialect = new MySqlDialect();

interface Op {
  kind: "select" | "insert" | "update" | "delete" | "txStart" | "txCommit" | "txRollback";
  table?: unknown;
  values?: Record<string, unknown>;
  set?: Record<string, unknown>;
  whereSql?: string;
  whereParams?: unknown[];
  /** row-lock strength requested via .for("update") — null for plain reads */
  lock?: string | null;
}

type RowsSource = unknown[] | ((call: { whereParams: unknown[] }) => unknown[]);

/** affectedRows resolver for UPDATEs — default 1 per update. */
type UpdateAffected = (table: unknown, set: Record<string, unknown>, whereParams: unknown[]) => number;

function makeWriteStubDb(
  rowsByTable: Map<unknown, RowsSource>,
  ops: Op[],
  updateAffected: UpdateAffected = () => 1,
) {
  const render = (cond: SQL | null) =>
    cond ? dialect.sqlToQuery(cond) : { sql: "", params: [] as unknown[] };
  const stub: any = {
    select() {
      const q: any = {
        _table: null as unknown,
        _where: null as SQL | null,
        _lock: null as string | null,
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
        for(strength: string) {
          q._lock = strength;
          return q;
        },
        then(resolve: (rows: unknown[]) => unknown, reject: (err: unknown) => unknown) {
          const rendered = render(q._where);
          ops.push({
            kind: "select",
            table: q._table,
            whereSql: rendered.sql,
            whereParams: rendered.params as unknown[],
            lock: q._lock,
          });
          const source = rowsByTable.get(q._table);
          const rows =
            typeof source === "function"
              ? source({ whereParams: rendered.params as unknown[] })
              : (source ?? []);
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return q;
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          ops.push({ kind: "insert", table, values });
          return Promise.resolve([{ insertId: 1 }]);
        },
      };
    },
    update(table: unknown) {
      return {
        set(set: Record<string, unknown>) {
          return {
            where(condition: SQL) {
              const rendered = render(condition);
              const whereParams = rendered.params as unknown[];
              ops.push({
                kind: "update",
                table,
                set,
                whereSql: rendered.sql,
                whereParams,
              });
              return Promise.resolve([{ affectedRows: updateAffected(table, set, whereParams) }]);
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        where(condition: SQL) {
          const rendered = render(condition);
          ops.push({
            kind: "delete",
            table,
            whereSql: rendered.sql,
            whereParams: rendered.params as unknown[],
          });
          return Promise.resolve([{}]);
        },
      };
    },
    async transaction(cb: (tx: unknown) => Promise<unknown>) {
      ops.push({ kind: "txStart" });
      try {
        const result = await cb(stub);
        ops.push({ kind: "txCommit" });
        return result;
      } catch (err) {
        ops.push({ kind: "txRollback" });
        throw err;
      }
    },
  };
  return stub;
}

let ops: Op[];

function wireDb(rowsByTable: Map<unknown, RowsSource>, updateAffected?: UpdateAffected) {
  ops = [];
  (dbModule.getDb as any).mockResolvedValue(makeWriteStubDb(rowsByTable, ops, updateAffected));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Fixtures ─────────────────────────────────────────────────────────────

const tourRow = { id: 42, productCode: "MAD-5D", dailyItinerary: null, itineraryDetailed: null };
const draftPv = { id: 20, tourId: 42, versionNumber: 2, status: "draft" };
const previouslyPublishedId = 10;

const draftIv = {
  id: 55,
  productVersionId: 20,
  schemaVersion: "packgo.itinerary.v1",
  itineraryId: "MAD-5D",
  versionNumber: 3,
  sourceStatus: "demo_estimate",
  originMarket: "US-CA",
  destinationJurisdictions: null,
  status: "draft",
};

const dayRow = {
  id: 501,
  itineraryVersionId: 55,
  dayId: "MAD-5D-D01",
  dayNumber: 1,
  city: null,
  cityEn: null,
  summary: "抵達馬德里",
  sourceStatus: "demo_estimate",
  movementDurationMinutes: null,
  movementStatus: "pending",
  mealBreakfast: "pending",
  mealLunch: "self",
  mealDinner: "included_unconfirmed",
  stayPropertyStatus: "proposed_or_equivalent",
  stayBookingStatus: "unconfirmed",
  stayRatingValue: null,
  stayRatingSystem: null,
  stayRatingSourceStatus: null,
  mediaSourceStatus: "demo_placeholder",
  mediaRightsStatus: "prototype_only",
};

/**
 * productVersions rows dispatcher: lookup-by-id returns the draft;
 * the previously-published probe (params [tourId, 'published']) returns
 * the old published version.
 */
const pvDispatcher: RowsSource = ({ whereParams }) => {
  if (whereParams.includes("published")) return [{ id: previouslyPublishedId }];
  if (whereParams.includes(draftPv.id)) return [draftPv];
  return [];
};

function happyPathDb(extra: Array<[unknown, RowsSource]> = []) {
  wireDb(
    new Map<unknown, RowsSource>([
      [tours, [tourRow]],
      [productVersions, pvDispatcher],
      [itineraryVersions, [draftIv]],
      [itineraryDays, [dayRow]],
      [itineraryStops, []],
      [feeContracts, []],
      ...extra,
    ]),
  );
}

// ── One-published-per-tour invariant ─────────────────────────────────────

describe("publishProductVersion — one-published-per-tour invariant", () => {
  it("publishing v2 supersedes v1 in the SAME transaction", async () => {
    happyPathDb();
    const result = await publishProductVersion({ productVersionId: 20, publishedBy: 7 });

    expect(result).toMatchObject({
      productVersionId: 20,
      tourId: 42,
      versionNumber: 2,
      supersededProductVersionIds: [previouslyPublishedId],
      publishedItineraryVersionIds: [55],
      publishedFeeContractIds: [],
    });
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.publishedAt).toBeInstanceOf(Date);

    const updates = ops.filter((o) => o.kind === "update");
    expect(updates).toHaveLength(3);

    // 1) supersede the previous published version of the SAME tour
    expect(updates[0].table).toBe(productVersions);
    expect(updates[0].set).toEqual({ status: "superseded" });
    expect(updates[0].whereParams).toEqual([42, "published"]);

    // 2) child itineraryVersion draft → published, scoped to the EXACT
    //    validated ids AND this version AND status='draft'
    expect(updates[1].table).toBe(itineraryVersions);
    expect(updates[1].set).toEqual({ status: "published" });
    expect(updates[1].whereParams).toEqual([55, 20, "draft"]);

    // 3) this version → published, with publishedAt + contentHash; the
    //    WHERE carries status='draft' (concurrency backstop)
    expect(updates[2].table).toBe(productVersions);
    expect(updates[2].set).toMatchObject({ status: "published" });
    expect(updates[2].set!.contentHash).toBe(result.contentHash);
    expect(updates[2].set!.publishedAt).toBeInstanceOf(Date);
    expect(updates[2].whereParams).toEqual([20, "draft"]);

    // The tour-level FOR UPDATE lock was taken inside the tx before any
    // status read/update (shared serialization convention).
    const txStartIdx = ops.findIndex((o) => o.kind === "txStart");
    const lockIdx = ops.findIndex(
      (o) => o.kind === "select" && o.table === tours && o.lock === "update",
    );
    expect(lockIdx).toBeGreaterThan(txStartIdx);
    expect(ops.indexOf(updates[0])).toBeGreaterThan(lockIdx);
    // Post-lock pv re-read is a locking read.
    const pvReads = ops.filter((o) => o.kind === "select" && o.table === productVersions);
    expect(pvReads.length).toBeGreaterThanOrEqual(2); // peek + re-read (+probe)
    expect(pvReads[1].lock).toBe("update");

    // ALL updates ran between txStart and txCommit — same transaction.
    const txStart = ops.findIndex((o) => o.kind === "txStart");
    const txCommit = ops.findIndex((o) => o.kind === "txCommit");
    expect(txStart).toBeGreaterThanOrEqual(0);
    expect(txCommit).toBeGreaterThan(txStart);
    for (const u of updates) {
      const idx = ops.indexOf(u);
      expect(idx).toBeGreaterThan(txStart);
      expect(idx).toBeLessThan(txCommit);
    }
    expect(ops.some((o) => o.kind === "txRollback")).toBe(false);
  });

  it("publish never deletes rows, and children of superseded versions are untouched (append-only history)", async () => {
    happyPathDb();
    await publishProductVersion({ productVersionId: 20, publishedBy: 7 });
    expect(ops.filter((o) => o.kind === "delete")).toHaveLength(0);
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);
    // No child-table update is scoped to the superseded version's id.
    for (const u of ops.filter(
      (o) => o.kind === "update" && (o.table === itineraryVersions || o.table === feeContracts),
    )) {
      expect(u.whereParams).not.toContain(previouslyPublishedId);
    }
  });

  it("first publish of a tour (no previous published version) issues no supersede UPDATE", async () => {
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [
          productVersions,
          ({ whereParams }) => (whereParams.includes("published") ? [] : [draftPv]),
        ],
        [itineraryVersions, [draftIv]],
        [itineraryDays, [dayRow]],
        [itineraryStops, []],
        [feeContracts, []],
      ]),
    );
    const result = await publishProductVersion({ productVersionId: 20, publishedBy: 7 });
    expect(result.supersededProductVersionIds).toEqual([]);
    const supersedeUpdates = ops.filter(
      (o) => o.kind === "update" && o.set?.status === "superseded",
    );
    expect(supersedeUpdates).toHaveLength(0);
  });
});

// ── Completeness gates ───────────────────────────────────────────────────

describe("publishProductVersion — fail-closed completeness gates", () => {
  it("rejects a version with NO itinerary version; transaction rolls back, nothing written", async () => {
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [productVersions, pvDispatcher],
        [itineraryVersions, []],
      ]),
    );
    await expect(
      publishProductVersion({ productVersionId: 20, publishedBy: 7 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(ops.filter((o) => o.kind === "update")).toHaveLength(0);
    expect(ops.some((o) => o.kind === "txRollback")).toBe(true);
    expect(ops.some((o) => o.kind === "txCommit")).toBe(false);
  });

  it("rejects a missing productVersion", async () => {
    wireDb(new Map<unknown, RowsSource>([[productVersions, []]]));
    await expect(
      publishProductVersion({ productVersionId: 999, publishedBy: 7 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an already-published version and a superseded version", async () => {
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [productVersions, [{ ...draftPv, status: "published" }]],
      ]),
    );
    await expect(
      publishProductVersion({ productVersionId: 20, publishedBy: 7 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [productVersions, [{ ...draftPv, status: "superseded" }]],
      ]),
    );
    await expect(
      publishProductVersion({ productVersionId: 20, publishedBy: 7 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects a non-awaiting fee contract that fails the FROZEN buildFeeDisclosure validation (no lines)", async () => {
    happyPathDb([
      [
        feeContracts,
        [
          {
            id: 77,
            contractId: "FEE-T42-PV20-1",
            productVersionId: 20,
            originMarket: "US-CA",
            destinationJurisdictions: null,
            displayRegion: null,
            validFrom: null,
            validTo: null,
            sourceStatus: "supplier_quote", // claims a quote…
            status: "draft",
          },
        ],
      ],
      [feeItems, []], // …but has no fee lines ⇒ fail-closed
    ]);
    await expect(
      publishProductVersion({ productVersionId: 20, publishedBy: 7 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(ops.filter((o) => o.kind === "update")).toHaveLength(0);
  });

  it("rejects mixed-currency fee contracts (frozen cross-currency rule)", async () => {
    const item = (feeId: string, currency: string) => ({
      id: 1,
      feeContractId: 77,
      feeId,
      category: "mandatory",
      labelZh: "稅",
      labelEn: "Tax",
      amountMinorUnits: 100,
      currency,
      unit: "per_person",
      includedInPackgoCharge: false,
      requiredForTrip: true,
      payeeType: "government",
      paymentTiming: "before_departure",
      sourceStatus: "supplier_quote",
      sortOrder: 0,
    });
    happyPathDb([
      [
        feeContracts,
        [
          {
            id: 77,
            contractId: "FEE-T42-PV20-1",
            productVersionId: 20,
            originMarket: "US-CA",
            destinationJurisdictions: null,
            displayRegion: null,
            validFrom: null,
            validTo: null,
            sourceStatus: "supplier_quote",
            status: "draft",
          },
        ],
      ],
      [feeItems, [item("tax-a", "USD"), item("tax-b", "EUR")]],
    ]);
    await expect(
      publishProductVersion({ productVersionId: 20, publishedBy: 7 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("an honest awaiting_supplier_quote contract IS publishable and flips to published in the same tx", async () => {
    happyPathDb([
      [
        feeContracts,
        [
          {
            id: 77,
            contractId: "FEE-T42-PV20-1",
            productVersionId: 20,
            originMarket: "US-CA",
            destinationJurisdictions: null,
            displayRegion: null,
            validFrom: null,
            validTo: null,
            sourceStatus: "awaiting_supplier_quote",
            status: "draft",
          },
        ],
      ],
      [feeItems, []],
    ]);
    const result = await publishProductVersion({ productVersionId: 20, publishedBy: 7 });
    expect(result.publishedFeeContractIds).toEqual([77]);
    const fcUpdate = ops.find((o) => o.kind === "update" && o.table === feeContracts)!;
    expect(fcUpdate.set).toEqual({ status: "published" });
    expect(fcUpdate.whereParams).toEqual([77, 20, "draft"]);
    const txCommit = ops.findIndex((o) => o.kind === "txCommit");
    expect(ops.indexOf(fcUpdate)).toBeLessThan(txCommit);
  });

  it("a valid supplier_quote contract with real lines publishes", async () => {
    happyPathDb([
      [
        feeContracts,
        [
          {
            id: 78,
            contractId: "FEE-T42-PV20-2",
            productVersionId: 20,
            originMarket: "US-CA",
            destinationJurisdictions: null,
            displayRegion: null,
            validFrom: null,
            validTo: null,
            sourceStatus: "supplier_quote",
            status: "draft",
          },
        ],
      ],
      [
        feeItems,
        [
          {
            id: 5,
            feeContractId: 78,
            feeId: "guide-tips",
            category: "tips",
            labelZh: "司導小費",
            labelEn: "Tips",
            amountMinorUnits: 12_000,
            currency: "USD",
            unit: "per_person",
            includedInPackgoCharge: false,
            requiredForTrip: true,
            payeeType: "guide_and_driver",
            paymentTiming: "during_trip",
            sourceStatus: "supplier_quote",
            sortOrder: 0,
          },
        ],
      ],
    ]);
    const result = await publishProductVersion({ productVersionId: 20, publishedBy: 7 });
    expect(result.publishedFeeContractIds).toEqual([78]);
  });

  it("rejects overlapping validity windows across publishable contracts", async () => {
    const contract = (id: number, contractId: string) => ({
      id,
      contractId,
      productVersionId: 20,
      originMarket: "US-CA",
      destinationJurisdictions: null,
      displayRegion: null,
      validFrom: null, // open-ended windows overlap by definition
      validTo: null,
      sourceStatus: "awaiting_supplier_quote",
      status: "draft",
    });
    happyPathDb([
      [feeContracts, [contract(77, "FEE-A"), contract(78, "FEE-B")]],
      [feeItems, []],
    ]);
    await expect(
      publishProductVersion({ productVersionId: 20, publishedBy: 7 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects a reversed validity window (validFrom > validTo) at the publish layer — defense in depth behind the input refine", async () => {
    happyPathDb([
      [
        feeContracts,
        [
          {
            id: 77,
            contractId: "FEE-T42-PV20-1",
            productVersionId: 20,
            originMarket: "US-CA",
            destinationJurisdictions: null,
            displayRegion: null,
            validFrom: new Date("2026-09-01T00:00:00Z"), // reversed —
            validTo: new Date("2026-08-01T00:00:00Z"), // never date-valid
            sourceStatus: "awaiting_supplier_quote",
            status: "draft",
          },
        ],
      ],
      [feeItems, []],
    ]);
    await expect(
      publishProductVersion({ productVersionId: 20, publishedBy: 7 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(ops.filter((o) => o.kind === "update")).toHaveLength(0);
    expect(ops.some((o) => o.kind === "txRollback")).toBe(true);
  });

  it("parent publish UPDATE verifies affected rows: 0 rows matching id+status='draft' aborts with CONFLICT and rolls back", async () => {
    // Simulate a row that raced out of 'draft' between the gate reads and
    // the write: the parent UPDATE (status='published' SET on
    // productVersions) matches zero rows.
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [productVersions, pvDispatcher],
        [itineraryVersions, [draftIv]],
        [itineraryDays, [dayRow]],
        [itineraryStops, []],
        [feeContracts, []],
      ]),
      (table, set) => (table === productVersions && set.status === "published" ? 0 : 1),
    );
    await expect(
      publishProductVersion({ productVersionId: 20, publishedBy: 7 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(ops.some((o) => o.kind === "txRollback")).toBe(true);
    expect(ops.some((o) => o.kind === "txCommit")).toBe(false);
  });

  it("child itineraryVersion UPDATE verifies affected rows too — a mismatch aborts the whole publish", async () => {
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [productVersions, pvDispatcher],
        [itineraryVersions, [draftIv]],
        [itineraryDays, [dayRow]],
        [itineraryStops, []],
        [feeContracts, []],
      ]),
      (table) => (table === itineraryVersions ? 0 : 1),
    );
    await expect(
      publishProductVersion({ productVersionId: 20, publishedBy: 7 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(ops.some((o) => o.kind === "txRollback")).toBe(true);
    // The parent flip never ran — abort happened at the child step.
    expect(
      ops.filter((o) => o.kind === "update" && o.table === productVersions && o.set?.status === "published"),
    ).toHaveLength(0);
  });
});

// ── contentHash ──────────────────────────────────────────────────────────

describe("contentHash — canonical, stable, content-sensitive", () => {
  it("is stable across object key order", () => {
    const a = { b: 1, a: [{ y: 2, x: 1 }], nested: { z: null, k: "v" } };
    const b = { nested: { k: "v", z: null }, a: [{ x: 1, y: 2 }], b: 1 };
    expect(computeContentHash(a)).toBe(computeContentHash(b));
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
  });

  it("changes when content changes", () => {
    const base = { days: [{ dayId: "D01", summary: "抵達" }] };
    const changed = { days: [{ dayId: "D01", summary: "抵達馬德里" }] };
    expect(computeContentHash(base)).not.toBe(computeContentHash(changed));
  });

  it("canonicalizes Dates to ISO strings and drops undefined", () => {
    expect(
      computeContentHash({ d: new Date("2026-01-01T00:00:00Z"), u: undefined }),
    ).toBe(computeContentHash({ d: new Date("2026-01-01T00:00:00.000Z") }));
  });

  it("array order IS content (day/stop ordering is a customer-facing claim)", () => {
    expect(computeContentHash({ a: [1, 2] })).not.toBe(computeContentHash({ a: [2, 1] }));
  });

  it("the published contentHash equals the canonical hash of the version's content payload", async () => {
    happyPathDb();
    const first = await publishProductVersion({ productVersionId: 20, publishedBy: 7 });
    // It is exactly the exported builder's output hashed — directly testable.
    expect(first.contentHash).toBe(
      computeContentHash(
        buildContentHashPayload({
          itineraryVersions: [draftIv],
          itineraryDays: [dayRow],
          itineraryStops: [],
          feeContracts: [],
        }),
      ),
    );
    happyPathDb(); // identical canned content ⇒ identical hash
    const second = await publishProductVersion({ productVersionId: 20, publishedBy: 7 });
    expect(first.contentHash).toBe(second.contentHash);

    // Changing one customer-facing claim changes the hash.
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [productVersions, pvDispatcher],
        [itineraryVersions, [draftIv]],
        [itineraryDays, [{ ...dayRow, summary: "抵達馬德里（改）" }]],
        [itineraryStops, []],
        [feeContracts, []],
      ]),
    );
    const third = await publishProductVersion({ productVersionId: 20, publishedBy: 7 });
    expect(third.contentHash).not.toBe(first.contentHash);
  });
});

// ── buildContentHashPayload — canonical, content-only, order-independent ─

describe("buildContentHashPayload — Codex P1-4 regressions", () => {
  const contract = (over: Record<string, unknown> = {}) =>
    ({
      id: 77,
      contractId: "FEE-A",
      productVersionId: 20,
      originMarket: "US-CA",
      destinationJurisdictions: null,
      displayRegion: null,
      validFrom: null,
      validTo: null,
      sourceStatus: "supplier_quote",
      status: "draft",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
      ...over,
    }) as any;
  const item = (over: Record<string, unknown> = {}) =>
    ({
      id: 5,
      feeContractId: 77,
      feeId: "guide-tips",
      category: "tips",
      labelZh: "司導小費",
      labelEn: "Tips",
      amountMinorUnits: 12_000,
      currency: "USD",
      unit: "per_person",
      includedInPackgoCharge: false,
      requiredForTrip: true,
      payeeType: "guide_and_driver",
      paymentTiming: "during_trip",
      sourceStatus: "supplier_quote",
      sortOrder: 0,
      ...over,
    }) as any;
  const stopRow = (over: Record<string, unknown> = {}) => ({
    id: 900,
    itineraryDayId: 501,
    stopId: "d1-palace",
    name: "皇宮",
    nameEn: null,
    kind: "sight",
    summary: null,
    lat: null,
    lon: null,
    sourceStatus: "pending",
    visitStatus: "route_or_stop_unconfirmed",
    imageAssetId: null,
    mediaStatus: "demo_placeholder",
    sortOrder: 0,
    ...over,
  });

  const baseRows = () => ({
    itineraryVersions: [
      { ...draftIv, id: 55, itineraryId: "A-TOUR" },
      { ...draftIv, id: 56, itineraryId: "B-TOUR" },
    ],
    itineraryDays: [
      { ...dayRow, id: 501, itineraryVersionId: 55, dayId: "A-D01", dayNumber: 1 },
      { ...dayRow, id: 502, itineraryVersionId: 55, dayId: "A-D02", dayNumber: 2 },
      { ...dayRow, id: 503, itineraryVersionId: 56, dayId: "B-D01", dayNumber: 1 },
    ],
    itineraryStops: [
      stopRow({ id: 900, itineraryDayId: 501, stopId: "d1-a", sortOrder: 0 }),
      stopRow({ id: 901, itineraryDayId: 501, stopId: "d1-b", sortOrder: 1, name: "廣場" }),
    ],
    feeContracts: [
      { contract: contract({ id: 77, contractId: "FEE-A" }), items: [item({ feeId: "a-tip" }), item({ feeId: "b-tax" })] },
      { contract: contract({ id: 78, contractId: "FEE-B" }), items: [item()] },
    ],
  });

  it("DB rows returned in REVERSED order produce the identical hash", () => {
    const rows = baseRows();
    const reversed = {
      itineraryVersions: rows.itineraryVersions.slice().reverse(),
      itineraryDays: rows.itineraryDays.slice().reverse(),
      itineraryStops: rows.itineraryStops.slice().reverse(),
      feeContracts: rows.feeContracts
        .slice()
        .reverse()
        .map(({ contract: c, items }) => ({ contract: c, items: items.slice().reverse() })),
    };
    expect(computeContentHash(buildContentHashPayload(reversed))).toBe(
      computeContentHash(buildContentHashPayload(rows)),
    );
  });

  it("identical content in a DIFFERENT lifecycle version (row ids, versionNumbers, timestamps changed) hashes identically", () => {
    const rows = baseRows();
    const relifed = {
      itineraryVersions: [
        {
          ...draftIv,
          id: 5500,
          itineraryId: "A-TOUR",
          versionNumber: 99, // itinerary versionNumber excluded
          createdAt: new Date("2027-05-05T05:05:05Z"),
          updatedAt: new Date("2027-06-06T06:06:06Z"),
          publishedAt: new Date("2027-07-07T07:07:07Z"),
        },
        { ...draftIv, id: 5600, itineraryId: "B-TOUR", versionNumber: 100 },
      ],
      itineraryDays: [
        { ...dayRow, id: 9501, itineraryVersionId: 5500, dayId: "A-D01", dayNumber: 1 },
        { ...dayRow, id: 9502, itineraryVersionId: 5500, dayId: "A-D02", dayNumber: 2 },
        { ...dayRow, id: 9503, itineraryVersionId: 5600, dayId: "B-D01", dayNumber: 1 },
      ],
      itineraryStops: [
        stopRow({ id: 9900, itineraryDayId: 9501, stopId: "d1-a", sortOrder: 0 }),
        stopRow({ id: 9901, itineraryDayId: 9501, stopId: "d1-b", sortOrder: 1, name: "廣場" }),
      ],
      feeContracts: [
        {
          contract: contract({ id: 7700, contractId: "FEE-A", createdAt: new Date("2027-01-01T00:00:00Z") }),
          items: [item({ id: 505, feeContractId: 7700, feeId: "a-tip" }), item({ id: 506, feeContractId: 7700, feeId: "b-tax" })],
        },
        { contract: contract({ id: 7800, contractId: "FEE-B" }), items: [item({ id: 507, feeContractId: 7800 })] },
      ],
    };
    expect(computeContentHash(buildContentHashPayload(relifed))).toBe(
      computeContentHash(buildContentHashPayload(baseRows())),
    );
    // …and tourId / product versionNumber never enter the payload at all.
    expect(JSON.stringify(buildContentHashPayload(rows))).not.toContain("tourId");
    expect(JSON.stringify(buildContentHashPayload(rows))).not.toContain("versionNumber");
  });

  it("any customer-visible content change changes the hash", () => {
    const base = computeContentHash(buildContentHashPayload(baseRows()));
    const mealChanged = baseRows();
    (mealChanged.itineraryDays[0] as any).mealBreakfast = "included_unconfirmed";
    expect(computeContentHash(buildContentHashPayload(mealChanged))).not.toBe(base);
    const feeChanged = baseRows();
    (feeChanged.feeContracts[0].items[0] as any).amountMinorUnits = 12_001;
    expect(computeContentHash(buildContentHashPayload(feeChanged))).not.toBe(base);
    const stopRenamed = baseRows();
    (stopRenamed.itineraryStops[1] as any).name = "太陽門廣場";
    expect(computeContentHash(buildContentHashPayload(stopRenamed))).not.toBe(base);
  });

  it("comparator ties are stable: duplicate natural keys still hash order-independently", () => {
    // Two days with the SAME dayNumber (schema-legal tie) but different
    // dayId — reversed row order must not change the hash.
    const tie = () => ({
      itineraryVersions: [{ ...draftIv, id: 55, itineraryId: "A-TOUR" }],
      itineraryDays: [
        { ...dayRow, id: 501, itineraryVersionId: 55, dayId: "A-D01a", dayNumber: 1 },
        { ...dayRow, id: 502, itineraryVersionId: 55, dayId: "A-D01b", dayNumber: 1 },
      ],
      itineraryStops: [
        // Same sortOrder tie, distinct stopId.
        stopRow({ id: 900, itineraryDayId: 501, stopId: "d1-a", sortOrder: 0 }),
        stopRow({ id: 901, itineraryDayId: 501, stopId: "d1-b", sortOrder: 0, name: "廣場" }),
      ],
      feeContracts: [
        // Same contractId tie (distinct content) — final canonical-JSON
        // tie-breaker keeps ordering total and deterministic.
        { contract: contract({ id: 77, contractId: "FEE-X", displayRegion: "US" }), items: [item()] },
        { contract: contract({ id: 78, contractId: "FEE-X", displayRegion: "CA" }), items: [] },
      ],
    });
    const forward = tie();
    const backward = {
      itineraryVersions: forward.itineraryVersions,
      itineraryDays: forward.itineraryDays.slice().reverse(),
      itineraryStops: forward.itineraryStops.slice().reverse(),
      feeContracts: forward.feeContracts.slice().reverse(),
    };
    expect(computeContentHash(buildContentHashPayload(backward))).toBe(
      computeContentHash(buildContentHashPayload(tie())),
    );
  });

  it("ordering is code-point based, never locale-dependent (localeCompare banned)", () => {
    // UTF-16 code units: "B" (0x42) < "a" (0x61); most locales would sort
    // "a" before "B" via localeCompare.
    expect(codePointCompare("B", "a")).toBe(-1);
    expect(codePointCompare("a", "B")).toBe(1);
    expect(codePointCompare("same", "same")).toBe(0);
    const rows = () => ({
      itineraryVersions: [
        { ...draftIv, id: 55, itineraryId: "a-tour" },
        { ...draftIv, id: 56, itineraryId: "B-tour" },
      ],
      itineraryDays: [],
      itineraryStops: [],
      feeContracts: [],
    });
    const payload = buildContentHashPayload(rows()) as { itineraries: Array<{ itineraryId: string }> };
    expect(payload.itineraries.map((iv) => iv.itineraryId)).toEqual(["B-tour", "a-tour"]);
    const reversedInput = { ...rows(), itineraryVersions: rows().itineraryVersions.reverse() };
    expect(computeContentHash(buildContentHashPayload(reversedInput))).toBe(
      computeContentHash(buildContentHashPayload(rows())),
    );
  });

  it("END-TO-END: same content under a different product/itinerary versionNumber publishes with the SAME contentHash", async () => {
    happyPathDb();
    const v2 = await publishProductVersion({ productVersionId: 20, publishedBy: 7 });
    // Same tour content re-versioned: pv versionNumber 2→9, iv version 3→8,
    // different row ids — the customer sees identical content.
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [
          productVersions,
          ({ whereParams }) =>
            whereParams.includes("published")
              ? [{ id: previouslyPublishedId }]
              : [{ id: 20, tourId: 42, versionNumber: 9, status: "draft" }],
        ],
        [itineraryVersions, [{ ...draftIv, id: 66, versionNumber: 8 }]],
        [itineraryDays, [{ ...dayRow, id: 601, itineraryVersionId: 66 }]],
        [itineraryStops, []],
        [feeContracts, []],
      ]),
    );
    const v9 = await publishProductVersion({ productVersionId: 20, publishedBy: 7 });
    expect(v9.contentHash).toBe(v2.contentHash);
  });
});

// ── listVersionsForTour ──────────────────────────────────────────────────

describe("listVersionsForTour — admin sees all versions incl. drafts", () => {
  it("returns every version with its children grouped", async () => {
    wireDb(
      new Map<unknown, RowsSource>([
        [
          productVersions,
          [
            { id: 20, tourId: 42, versionNumber: 2, status: "draft" },
            { id: 10, tourId: 42, versionNumber: 1, status: "published" },
          ],
        ],
        [
          itineraryVersions,
          [
            { ...draftIv, id: 55, productVersionId: 20 },
            { ...draftIv, id: 54, productVersionId: 10, status: "published" },
          ],
        ],
        [
          feeContracts,
          [
            {
              id: 77,
              contractId: "FEE-A",
              productVersionId: 10,
              status: "published",
              sourceStatus: "supplier_quote",
              originMarket: "US-CA",
              destinationJurisdictions: null,
              displayRegion: null,
              validFrom: null,
              validTo: null,
            },
          ],
        ],
      ]),
    );
    const list = await listVersionsForTour(42);
    expect(list).toHaveLength(2);
    expect(list[0].productVersion.id).toBe(20);
    expect(list[0].itineraryVersions.map((iv) => iv.id)).toEqual([55]);
    expect(list[0].feeContracts).toEqual([]);
    expect(list[1].productVersion.id).toBe(10);
    expect(list[1].itineraryVersions.map((iv) => iv.id)).toEqual([54]);
    expect(list[1].feeContracts.map((fc) => fc.id)).toEqual([77]);
  });

  it("returns [] honestly when the DB is unavailable or the tour has no versions", async () => {
    (dbModule.getDb as any).mockResolvedValue(null);
    expect(await listVersionsForTour(42)).toEqual([]);
    wireDb(new Map<unknown, RowsSource>([[productVersions, []]]));
    expect(await listVersionsForTour(42)).toEqual([]);
  });
});

// ── Concurrency regressions (Codex P1-1): tour-level lock serialization ──

interface TableOps {
  select: (whereParams: unknown[]) => unknown[];
  update?: (set: Record<string, unknown>, whereParams: unknown[]) => number;
}

/**
 * Latch probe (Codex P1-1, round 3): onLockAcquired may return a pending
 * promise to FREEZE a transaction at the exact moment it holds the tour
 * lock; onLockAttempt observes every acquisition attempt before it may
 * block — together they let a test prove two publishes truly overlap
 * (A frozen holding the lock, B started and parked behind it).
 */
interface LockProbe {
  /** fires when a tx starts trying to take the tour lock (before it may block) */
  onLockAttempt?: () => void;
  /**
   * fires the moment a tx has ACQUIRED the tour lock (locking select
   * recorded, rows not yet returned). Returning a promise keeps the tx
   * paused right there, still holding the lock.
   */
  onLockAcquired?: () => void | Promise<void>;
}

/**
 * Stateful stub honoring the tours-row FOR UPDATE lock: a locking select
 * on tours blocks until the holding transaction commits/rolls back, and
 * updates mutate shared state — so two concurrent publishProductVersion
 * calls interleave exactly as they would against a real DB. Mutation
 * detection: the `await prev` below IS the blocking layer — removing it
 * lets transaction B run through while A is latch-paused holding the
 * lock, turning the overlap regressions below red.
 */
function makeLockingStubDb(
  handlers: Map<unknown, TableOps>,
  ops: Op[],
  lockTable: unknown,
  probe: LockProbe = {},
) {
  const render = (cond: SQL | null) =>
    cond ? dialect.sqlToQuery(cond) : { sql: "", params: [] as unknown[] };
  const lockTails = new Map<string, Promise<void>>();

  function makeConn(txCtx: { releases: Array<() => void>; held: Set<string> } | null) {
    const conn: any = {
      select() {
        const q: any = {
          _table: null as unknown,
          _where: null as SQL | null,
          _lock: null as string | null,
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
          for(strength: string) {
            q._lock = strength;
            return q;
          },
          then(resolve: (rows: unknown[]) => unknown, reject: (err: unknown) => unknown) {
            return (async () => {
              const rendered = render(q._where);
              const params = rendered.params as unknown[];
              let justAcquired = false;
              if (q._lock && q._table === lockTable && txCtx) {
                const key = `tour-lock:${String(params[0])}`;
                if (!txCtx.held.has(key)) {
                  probe.onLockAttempt?.();
                  const prev = lockTails.get(key) ?? Promise.resolve();
                  let release!: () => void;
                  const held = new Promise<void>((r) => (release = r));
                  lockTails.set(
                    key,
                    prev.then(() => held),
                  );
                  await prev; // BLOCK until the current holder finishes
                  txCtx.held.add(key);
                  txCtx.releases.push(release);
                  justAcquired = true;
                }
              }
              ops.push({
                kind: "select",
                table: q._table,
                whereSql: rendered.sql,
                whereParams: params,
                lock: q._lock,
              });
              // Latch point: pause HERE, holding the lock, if asked to.
              if (justAcquired) await probe.onLockAcquired?.();
              return handlers.get(q._table)?.select(params) ?? [];
            })().then(resolve, reject);
          },
        };
        return q;
      },
      update(table: unknown) {
        return {
          set(set: Record<string, unknown>) {
            return {
              where(condition: SQL) {
                const rendered = render(condition);
                const params = rendered.params as unknown[];
                const affectedRows = handlers.get(table)?.update?.(set, params) ?? 1;
                ops.push({ kind: "update", table, set, whereSql: rendered.sql, whereParams: params });
                return Promise.resolve([{ affectedRows }]);
              },
            };
          },
        };
      },
      insert(table: unknown) {
        return {
          values(values: Record<string, unknown>) {
            ops.push({ kind: "insert", table, values });
            return Promise.resolve([{ insertId: 1 }]);
          },
        };
      },
      delete(table: unknown) {
        return {
          where(condition: SQL) {
            const rendered = render(condition);
            ops.push({ kind: "delete", table, whereSql: rendered.sql, whereParams: rendered.params as unknown[] });
            return Promise.resolve([{}]);
          },
        };
      },
      async transaction(cb: (tx: unknown) => Promise<unknown>) {
        const ctx = { releases: [] as Array<() => void>, held: new Set<string>() };
        ops.push({ kind: "txStart" });
        try {
          const result = await cb(makeConn(ctx));
          ops.push({ kind: "txCommit" });
          return result;
        } catch (err) {
          ops.push({ kind: "txRollback" });
          throw err;
        } finally {
          for (const release of ctx.releases) release();
        }
      },
    };
    return conn;
  }
  return makeConn(null);
}

/** Spin the event loop until cond() holds (or fail loudly). */
async function waitFor(cond: () => boolean, label: string, tries = 5000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`waitFor timed out: ${label}`);
}

describe("publishProductVersion — concurrent publish serialization (Codex P1-1 regressions)", () => {
  /** Shared mutable pv/iv state + handlers for two draft versions of tour 42. */
  function makeState() {
    const state = {
      pvs: [
        { id: 20, tourId: 42, versionNumber: 1, status: "draft" },
        { id: 21, tourId: 42, versionNumber: 2, status: "draft" },
      ],
      ivs: [
        { ...draftIv, id: 55, productVersionId: 20, itineraryId: "MAD-5D" },
        { ...draftIv, id: 56, productVersionId: 21, itineraryId: "MAD-5D", versionNumber: 4 },
      ],
    };
    const handlers = new Map<unknown, TableOps>([
      [tours, { select: () => [tourRow] }],
      [
        productVersions,
        {
          select: (params) => {
            if (params.includes("published")) {
              return state.pvs
                .filter((p) => p.tourId === params[0] && p.status === "published")
                .map((p) => ({ id: p.id }));
            }
            return state.pvs.filter((p) => p.id === params[0]).map((p) => ({ ...p }));
          },
          update: (set, params) => {
            // supersede: [tourId, 'published'] — parent flip: [id, 'draft']
            let affected = 0;
            if (params.includes("published")) {
              for (const p of state.pvs) {
                if (p.tourId === params[0] && p.status === "published") {
                  Object.assign(p, set);
                  affected++;
                }
              }
              return affected;
            }
            for (const p of state.pvs) {
              if (p.id === params[0] && p.status === "draft") {
                Object.assign(p, set);
                affected++;
              }
            }
            return affected;
          },
        },
      ],
      [
        itineraryVersions,
        {
          select: (params) =>
            state.ivs.filter((iv) => iv.productVersionId === params[0]).map((iv) => ({ ...iv })),
          update: (set, params) => {
            let affected = 0;
            for (const iv of state.ivs) {
              if (iv.id === params[0] && iv.status === "draft") {
                Object.assign(iv, set);
                affected++;
              }
            }
            return affected;
          },
        },
      ],
      [itineraryDays, { select: () => [] }],
      [itineraryStops, { select: () => [] }],
      [feeContracts, { select: () => [] }],
      [feeItems, { select: () => [] }],
    ]);
    return { state, handlers };
  }

  function wireLockingDb(handlers: Map<unknown, TableOps>, probe?: LockProbe) {
    ops = [];
    (dbModule.getDb as any).mockResolvedValue(makeLockingStubDb(handlers, ops, tours, probe));
  }

  /** Test-controlled latch: `gate` stays pending until `release()` is called. */
  function makeLatch() {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    return { gate, release };
  }

  /**
   * Latch protocol shared by both regressions (Codex P1-1 round 3):
   * start A, freeze it the moment it HOLDS the tour lock, start B, prove
   * the two transactions truly overlap (two txStarts, zero commits, B's
   * lock acquisition not yet happened), prove B STAYS parked across
   * extra scheduler turns, and only then release A. Removing the stub's
   * `await prev` blocking lets B run to completion while A is frozen —
   * every overlap assertion here turns red.
   */
  async function driveOverlap(opts: {
    startA: () => Promise<unknown>;
    startB: () => Promise<unknown>;
    attempts: () => number;
    acquisitions: () => number;
    release: () => void;
  }) {
    const promiseA = opts.startA();
    await waitFor(
      () => opts.acquisitions() === 1,
      "publish A must take the tours FOR UPDATE lock (lock removed?)",
    );
    const promiseB = opts.startB();
    await waitFor(() => opts.attempts() === 2, "B must attempt the tour lock while A holds it");

    // TRUE-OVERLAP PROOF: both transactions open, nothing committed, B's
    // lock acquisition has NOT happened (it is parked behind frozen A).
    expect(ops.filter((o) => o.kind === "txStart")).toHaveLength(2);
    expect(ops.filter((o) => o.kind === "txCommit")).toHaveLength(0);
    expect(ops.filter((o) => o.kind === "txRollback")).toHaveLength(0);
    expect(opts.acquisitions()).toBe(1);
    expect(
      ops.filter((o) => o.kind === "select" && o.table === tours && o.lock === "update"),
    ).toHaveLength(1);
    // Extra scheduler turns: B must STAY parked while the latch is closed.
    for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));
    expect(opts.acquisitions()).toBe(1);
    expect(ops.filter((o) => o.kind === "txCommit")).toHaveLength(0);

    // Only now may A finish; the lock release lets B proceed.
    opts.release();
    return { promiseA, promiseB };
  }

  function latchedProbe() {
    let attempts = 0;
    let acquisitions = 0;
    const latch = makeLatch();
    const probe: LockProbe = {
      onLockAttempt: () => {
        attempts++;
      },
      onLockAcquired: () => {
        acquisitions++;
        if (acquisitions === 1) return latch.gate; // freeze FIRST holder
      },
    };
    return {
      probe,
      attempts: () => attempts,
      acquisitions: () => acquisitions,
      release: latch.release,
    };
  }

  it("REGRESSION: two concurrent FIRST publishes of the same tour serialize — exactly ONE published version survives", async () => {
    const { state, handlers } = makeState();
    const lp = latchedProbe();
    wireLockingDb(handlers, lp.probe);

    // A takes the tour lock and is frozen; B overlaps and must wait.
    const { promiseA, promiseB } = await driveOverlap({
      startA: () => publishProductVersion({ productVersionId: 20, publishedBy: 7 }),
      startB: () => publishProductVersion({ productVersionId: 21, publishedBy: 7 }),
      attempts: lp.attempts,
      acquisitions: lp.acquisitions,
      release: lp.release,
    });
    const resultA = (await promiseA) as Awaited<ReturnType<typeof publishProductVersion>>;
    const resultB = (await promiseB) as Awaited<ReturnType<typeof publishProductVersion>>;

    // A saw no published version (true first publish); B — serialized
    // behind the lock — RE-READ the probe and superseded A's version.
    expect(resultA.supersededProductVersionIds).toEqual([]);
    expect(resultB.supersededProductVersionIds).toEqual([20]);

    // One-published-per-tour invariant holds in final state.
    expect(state.pvs.filter((p) => p.status === "published").map((p) => p.id)).toEqual([21]);
    expect(state.pvs.find((p) => p.id === 20)!.status).toBe("superseded");

    // B's lock acquisition happened only after A committed.
    const firstCommit = ops.findIndex((o) => o.kind === "txCommit");
    const locks = ops
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.kind === "select" && o.table === tours && o.lock === "update");
    expect(locks).toHaveLength(2);
    expect(locks[0].i).toBeLessThan(firstCommit);
    expect(locks[1].i).toBeGreaterThan(firstCommit);
  });

  it("REGRESSION: the SAME draft version published twice concurrently — the loser re-reads post-lock and rejects; only one flip is written", async () => {
    const { state, handlers } = makeState();
    const lp = latchedProbe();
    wireLockingDb(handlers, lp.probe);

    const { promiseA, promiseB } = await driveOverlap({
      startA: () => publishProductVersion({ productVersionId: 20, publishedBy: 7 }),
      startB: () => publishProductVersion({ productVersionId: 20, publishedBy: 7 }),
      attempts: lp.attempts,
      acquisitions: lp.acquisitions,
      release: lp.release,
    });
    const resultA = (await promiseA) as Awaited<ReturnType<typeof publishProductVersion>>;
    const errB = await promiseB.catch((e) => e);

    expect(resultA.productVersionId).toBe(20);
    expect(errB).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(errB.message).toContain("already published");

    // State: v20 published once; v21 untouched draft; no double flip.
    expect(state.pvs.find((p) => p.id === 20)!.status).toBe("published");
    expect(state.pvs.find((p) => p.id === 21)!.status).toBe("draft");
    const parentFlips = ops.filter(
      (o) => o.kind === "update" && o.table === productVersions && o.set?.status === "published",
    );
    expect(parentFlips).toHaveLength(1);
    expect(ops.filter((o) => o.kind === "txCommit")).toHaveLength(1);
    expect(ops.filter((o) => o.kind === "txRollback")).toHaveLength(1);
  });
});
