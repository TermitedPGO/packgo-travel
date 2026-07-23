/**
 * Batch P1b — importDraft tests against the REAL module.
 *
 * Repo pattern (queries.test.ts): only the DB driver is stubbed — never
 * the module functions. The stub records every select/insert/update/
 * delete (WHERE rendered to real SQL via MySqlDialect, SELECT projections
 * captured as column-key lists) so tests can assert exactly what was
 * read, what was written, and that everything ran inside a transaction.
 *
 * Focus areas (batch task):
 *   - import honesty: demo_estimate / pending / unconfirmed /
 *     proposed_or_equivalent / demo_placeholder / prototype_only defaults;
 *     'confirmed' unreachable; unparseable input ⇒ fewer rows, never
 *     invented ones;
 *   - idempotency: re-import replaces the DRAFT version's children only;
 *   - supplier-cost firewall: agentPrice/supplierCost keys are rejected
 *     by zod (.strict()) AND the frozen deep guard; the tours SELECT
 *     projection contains no cost/image columns;
 *   - money: integer minor units only, unknown currency fail-closed.
 */
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));
// Router-path (real ingress) tests: ONLY infra collaborators are mocked —
// the input schema, this module, and the router wiring all stay REAL.
vi.mock("../rateLimit", () => ({
  checkAdminMutationRateLimit: vi.fn(async () => ({ allowed: true, remaining: 59 })),
}));
vi.mock("../_core/auditLog", () => ({ audit: vi.fn(async () => {}) }));

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
import { assertNoForbiddenPublicFields } from "./availabilityBucket";
import {
  createDraftProductVersion,
  createFeeContractDraft,
  createFeeContractDraftInputSchema,
  deriveItineraryId,
  feeItemDraftInputSchema,
  importItineraryDraft,
  parseItineraryDays,
  parseStayRating,
} from "./importDraft";
import { publishProductVersion } from "./publish";
import { storefrontPublishRouter } from "../routers/storefrontPublish";

const dialect = new MySqlDialect();

interface Op {
  kind: "select" | "insert" | "update" | "delete" | "txStart" | "txCommit" | "txRollback";
  table?: unknown;
  fields?: string[] | null;
  values?: Record<string, unknown>;
  set?: Record<string, unknown>;
  whereSql?: string;
  whereParams?: unknown[];
  /** row-lock strength requested via .for("update") — null for plain reads */
  lock?: string | null;
}

type RowsSource = unknown[] | ((call: { whereParams: unknown[] }) => unknown[]);

/** Write-capable chainable stub standing in for the drizzle driver. */
function makeWriteStubDb(rowsByTable: Map<unknown, RowsSource>, ops: Op[]) {
  let nextInsertId = 1000;
  const render = (cond: SQL | null) =>
    cond ? dialect.sqlToQuery(cond) : { sql: "", params: [] as unknown[] };
  const stub: any = {
    select(fields?: Record<string, unknown>) {
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
            fields: fields ? Object.keys(fields) : null,
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
          return Promise.resolve([{ insertId: nextInsertId++ }]);
        },
      };
    },
    update(table: unknown) {
      return {
        set(set: Record<string, unknown>) {
          return {
            where(condition: SQL) {
              const rendered = render(condition);
              ops.push({
                kind: "update",
                table,
                set,
                whereSql: rendered.sql,
                whereParams: rendered.params as unknown[],
              });
              return Promise.resolve([{ affectedRows: 1 }]);
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

interface TableOps {
  select: (whereParams: unknown[]) => unknown[];
  insert?: (values: Record<string, unknown>) => number;
  /** returns affectedRows */
  update?: (set: Record<string, unknown>, whereParams: unknown[]) => number;
  delete?: (whereParams: unknown[]) => void;
}

/**
 * Latch probe for the locking stub (Codex P1-1, round 3): lets a test
 * PAUSE a transaction at the exact moment it holds the tour lock
 * (onLockAcquired returning a pending promise) and observe every lock
 * acquisition ATTEMPT (onLockAttempt fires before the blocking wait), so
 * two module calls can be proven to truly overlap: A holds the lock and
 * is frozen mid-transaction, B has started and is parked on the lock.
 */
interface LockProbe {
  /** fires when a tx starts trying to take the tour lock (before it may block) */
  onLockAttempt?: () => void;
  /**
   * fires the moment a tx has ACQUIRED the tour lock (its locking select
   * is recorded in ops but has not returned rows yet). Returning a
   * promise keeps the tx paused right there, still holding the lock.
   */
  onLockAcquired?: () => void | Promise<void>;
}

/**
 * Stateful stub that HONORS the tour row lock: a `SELECT … FOR UPDATE`
 * on the tours table blocks until the transaction holding the same tour
 * row commits or rolls back — so tests can drive real interleavings of
 * two module calls and prove the shared serialization convention works.
 * Mutation detection: the `await prev` below IS the blocking layer —
 * removing it lets the second transaction run through while the first
 * is latch-paused, turning the overlap regressions red.
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
      select(fields?: Record<string, unknown>) {
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
                fields: fields ? Object.keys(fields) : null,
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
      insert(table: unknown) {
        return {
          values(values: Record<string, unknown>) {
            ops.push({ kind: "insert", table, values });
            const insertId = handlers.get(table)?.insert?.(values) ?? 1;
            return Promise.resolve([{ insertId }]);
          },
        };
      },
      update(table: unknown) {
        return {
          set(set: Record<string, unknown>) {
            return {
              where(condition: SQL) {
                const rendered = render(condition);
                const params = rendered.params as unknown[];
                const affectedRows = handlers.get(table)?.update?.(set, params) ?? 1;
                ops.push({
                  kind: "update",
                  table,
                  set,
                  whereSql: rendered.sql,
                  whereParams: params,
                });
                return Promise.resolve([{ affectedRows }]);
              },
            };
          },
        };
      },
      delete(table: unknown) {
        return {
          where(condition: SQL) {
            const rendered = render(condition);
            const params = rendered.params as unknown[];
            handlers.get(table)?.delete?.(params);
            ops.push({ kind: "delete", table, whereSql: rendered.sql, whereParams: params });
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

/** Spin the microtask/event loop until cond() holds (or fail loudly). */
async function waitFor(cond: () => boolean, label: string, tries = 5000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`waitFor timed out: ${label}`);
}

let ops: Op[];

function wireDb(rowsByTable: Map<unknown, RowsSource>) {
  ops = [];
  (dbModule.getDb as any).mockResolvedValue(makeWriteStubDb(rowsByTable, ops));
}

function wireLockingDb(handlers: Map<unknown, TableOps>, lockTable: unknown, probe?: LockProbe) {
  ops = [];
  (dbModule.getDb as any).mockResolvedValue(makeLockingStubDb(handlers, ops, lockTable, probe));
}

/** Test-controlled latch: `gate` stays pending until `release()` is called. */
function makeLatch() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return { gate, release };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Pure helpers ─────────────────────────────────────────────────────────

describe("pure parse helpers — honesty mapping", () => {
  it("parseStayRating parses conservative star claims, else null", () => {
    expect(parseStayRating("五星豪華酒店或同級")).toBe(5);
    expect(parseStayRating("4星商務酒店")).toBe(4);
    expect(parseStayRating("4-star hotel")).toBe(4);
    expect(parseStayRating("精品酒店")).toBeNull();
    expect(parseStayRating(null)).toBeNull();
  });

  it("deriveItineraryId sanitizes productCode, falls back to TOUR-<id>", () => {
    expect(deriveItineraryId({ id: 42, productCode: "26JO217BRC-T" })).toBe("26JO217BRC-T");
    expect(deriveItineraryId({ id: 42, productCode: "ab c/12" })).toBe("AB-C-12");
    expect(deriveItineraryId({ id: 42, productCode: null })).toBe("TOUR-42");
    expect(deriveItineraryId({ id: 42, productCode: "  " })).toBe("TOUR-42");
  });

  it("parseItineraryDays skips entries without a valid day number and duplicate days (fewer rows, never invented)", () => {
    const days = parseItineraryDays(
      JSON.stringify([
        { day: 2, title: "第二天", activities: [], meals: {}, accommodation: "酒店" },
        { title: "沒有 day 欄位" },
        { day: 2, title: "重複的 day" },
        { day: "not-a-number", title: "壞 day" },
        null,
        "not-an-object",
        { day: 1, title: "第一天" },
      ]),
    );
    expect(days.map((d) => d.dayNumber)).toEqual([1, 2]);
    expect(days[1].title).toBe("第二天"); // first claim wins, duplicate skipped
  });

  it("day accepts only genuine positive integers (or explicit plain-digit legacy strings) — boolean/array/object/float coercion is skipped (Codex P1-3 counterexamples)", () => {
    const days = parseItineraryDays(
      JSON.stringify([
        { day: true, title: "boolean day" }, // verdict counterexample
        { day: [1], title: "array day" }, // verdict counterexample
        { day: {}, title: "object day" },
        { day: 1.5, title: "float day" },
        { day: "1.5", title: "float string" },
        { day: "02", title: "zero-padded string" },
        { day: "", title: "empty string" },
        { day: -3, title: "negative" },
        { day: 0, title: "zero" },
        { day: null, title: "null day" },
        { day: "3", title: "legacy numeric string" }, // explicit /^[1-9][0-9]{0,2}$/
        { day: 7, title: "genuine int" },
      ]),
    );
    // Fewer honest rows: only the genuine claims survive; nothing is
    // coerced into an invented Day 1.
    expect(days.map((d) => d.dayNumber)).toEqual([3, 7]);
    expect(days.map((d) => d.title)).toEqual(["legacy numeric string", "genuine int"]);
  });

  it("parseItineraryDays: unparseable / non-array JSON ⇒ [] (no fabricated rows)", () => {
    expect(parseItineraryDays(null)).toEqual([]);
    expect(parseItineraryDays("not json at all")).toEqual([]);
    expect(parseItineraryDays(JSON.stringify({ day: 1 }))).toEqual([]);
    expect(parseItineraryDays(JSON.stringify([]))).toEqual([]);
  });

  it("parseItineraryDays skips activities without an honest title", () => {
    const days = parseItineraryDays(
      JSON.stringify([
        {
          day: 1,
          activities: [{ title: "皇宮", description: "參觀" }, { title: "  " }, {}, null],
        },
      ]),
    );
    expect(days[0].stops).toEqual([{ title: "皇宮", description: "參觀" }]);
  });
});

// ── createDraftProductVersion ────────────────────────────────────────────

describe("createDraftProductVersion", () => {
  it("errors when the tour is missing; nothing is written", async () => {
    wireDb(new Map<unknown, RowsSource>([[tours, []]]));
    await expect(
      createDraftProductVersion({ tourId: 42, createdBy: 7 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);
  });

  it("assigns the next versionNumber (max + 1) with status 'draft'", async () => {
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [{ id: 42, productCode: "P1", dailyItinerary: null, itineraryDetailed: null }]],
        [productVersions, [{ versionNumber: 2 }]],
      ]),
    );
    const result = await createDraftProductVersion({ tourId: 42, createdBy: 7 });
    expect(result).toMatchObject({ tourId: 42, versionNumber: 3, status: "draft" });
    const insert = ops.find((o) => o.kind === "insert" && o.table === productVersions)!;
    expect(insert.values).toMatchObject({
      tourId: 42,
      versionNumber: 3,
      status: "draft",
      createdBy: 7,
    });
  });

  it("first version of a tour is versionNumber 1", async () => {
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [{ id: 42, productCode: null, dailyItinerary: null, itineraryDetailed: null }]],
        [productVersions, []],
      ]),
    );
    const result = await createDraftProductVersion({ tourId: 42, createdBy: 7 });
    expect(result.versionNumber).toBe(1);
  });
});

// ── importItineraryDraft ─────────────────────────────────────────────────

const sampleItineraryJson = JSON.stringify([
  {
    day: 1,
    title: "啟程 洛杉磯前往馬德里",
    activities: [
      {
        time: "18:00",
        title: "LAX 集合出發",
        description: "搭乘豪華客機",
        transportation: "飛機",
        location: "LAX",
        image: "https://supplier-cdn.example.com/secret-supplier-photo.jpg",
        imageAlt: "supplier photo",
      },
    ],
    meals: { breakfast: "敬請自理", lunch: "自理", dinner: "機上" },
    accommodation: "夜宿機上",
  },
  {
    day: 2,
    title: "馬德里市區觀光",
    activities: [
      { title: "皇宮", description: "參觀馬德里皇宮" },
      { title: "太陽門廣場", description: "" },
    ],
    meals: { breakfast: "飯店內享用", lunch: "風味料理", dinner: "西式自助餐" },
    accommodation: "五星豪華酒店或同級",
  },
]);

const tourRow = {
  id: 42,
  productCode: "26JO217BRC-T",
  dailyItinerary: null,
  itineraryDetailed: sampleItineraryJson,
};
const draftPv = { id: 10, tourId: 42, versionNumber: 1, status: "draft" };

function freshImportDb(overrides: Partial<typeof tourRow> = {}) {
  wireDb(
    new Map<unknown, RowsSource>([
      [tours, [{ ...tourRow, ...overrides }]],
      [productVersions, ({ whereParams }) => (whereParams.includes("draft") ? [draftPv] : [draftPv])],
      [itineraryVersions, []],
      [itineraryDays, []],
    ]),
  );
}

// ── Meals: adjudicated no-claim import (Jeff 2026-07-22 ruling) ──────────
//
// Free-text meal parsing (the former mapMealText) was removed per Jeff's
// 2026-07-22 ruling, after Codex rounds 1-5 showed adversarial free-text
// meal classification cannot be made honest in either direction. Imports
// now make NO meal claims: every imported meal field is written 'pending'
// (待確認); a human explicitly sets 含/不含/機上 in the admin backend
// later (separate batch). The FULL historical adversarial matrix from
// rounds 2-5 — every string that ever flipped a verdict, both directions —
// is retained below and must uniformly produce 'pending' through the REAL
// parse + DB-write chain: never 'included', never 'included_unconfirmed',
// never 'self', never 'in_flight'.

describe("meals are never auto-claimed — every import writes 'pending' (Jeff 2026-07-22 ruling)", () => {
  const FORBIDDEN_MEAL_CLAIMS = ["included", "included_unconfirmed", "self", "in_flight"] as const;

  // Rounds 2-5 adversarial matrix (union of every historical attack /
  // counterexample string from the prior mapMealText suites and the Codex
  // round-2..5 verdicts). Direction no longer matters: ALL ⇒ 'pending'.
  const ADVERSARIAL_MEAL_MATRIX: string[] = [
    // Positive-claim family (previously included_unconfirmed).
    "含早餐",
    "含早餐，恕不外帶",
    "早餐包含，但恕不打包",
    "早餐包含，但未提供機場接送",
    "午餐包含，但未提供機場接送",
    "早餐包含內容清楚、不含糊",
    "無麩質早餐已包含",
    "無需加價早餐已包含",
    "無限量早餐已包含",
    "早餐無限供應",
    "已包含，但未提供機場接送",
    "飯店內享用",
    "西式自助餐",
    "included",
    "hotel buffet",
    "breakfast included but airport transfer isn't provided",
    "breakfast included, no breakfast-related fee",
    "breakfast included, no extra breakfast charge",
    "dinner included, no extra dinner charge",
    "breakfast service charge is included",
    "self-service breakfast is included",
    "breakfast is not only included but upgraded",
    "breakfast isn't only included but upgraded",
    "breakfast isn’t only included but upgraded", // curly-apostrophe R5 attack
    "lunch is not only included but upgraded",
    // Negation family (previously 'self').
    "不含早餐",
    "早餐不含",
    "不包含午餐",
    "不含",
    "晚餐不提供",
    "飯店不供應早餐",
    "未包含早餐",
    "未包含飯店早餐",
    "早餐未包含",
    "未提供晚餐",
    "未含午餐",
    "沒有含早餐",
    "恕不供應晚餐",
    "恕不提供早餐",
    "不含飯店早餐",
    "午餐不含，請自理",
    "飯店沒有早餐",
    "早餐未被包含",
    "早餐並非包含項目",
    "早餐不是包含項目",
    "餐廳不供早餐",
    "飯店早餐未再被提供",
    "飯店早餐不會再提供",
    "早餐不在房價內提供",
    "早餐無法提供",
    "早餐不計入房價",
    "飯店早餐不計入房價",
    "飯店早餐未列入團費",
    "breakfast not included",
    "breakfast isn't included",
    "hotel breakfast isn't included",
    "lunch is not included",
    "meals are not included",
    "no breakfast included",
    "no hotel breakfast",
    "without breakfast",
    "without buffet breakfast",
    "excluded",
    "hotel breakfast isn't provided",
    "breakfast was never included",
    "breakfast is not currently included",
    "breakfast is no longer included",
    "dinner is no longer included",
    "hotel breakfast is no longer available",
    "hotel breakfast won't be provided",
    "breakfast can't be provided",
    "breakfast hasn't been included",
    "breakfast is neither included nor provided",
    "breakfast is not part of the package",
    "hotel breakfast isn't part of the package",
    // Self / in-flight / no-claim family (previously self / in_flight /
    // pending).
    "敬請自理",
    "自理",
    "自費",
    "機上",
    "機內",
    "in-flight",
    "無",
    "none",
    "n/a",
    "-",
    "",
    "隨便寫的字",
    // Round-6 completion (Codex 2026-07-22 P2-1): the exact historical
    // literals the 87-string matrix was missing — 7 from round 5 and 8
    // from earlier rounds. Matrix is now the complete 102-literal set.
    "breakfast included with no breakfast service fee",
    "早餐包含而機場接送未提供",
    "hotel breakfast is no longer part of the package",
    "hotel breakfast is not covered by the package",
    "hotel breakfast isn't complimentary",
    "飯店早餐取消供應",
    "飯店早餐非房價包含項目",
    "未來三天均含早餐",
    "不僅含早餐還含午餐",
    "無限供應",
    "no meals provided",
    "不提供餐食",
    "恕不",
    "機上用餐",
    "飯店早餐",
  ];

  it("FULL rounds 2-5 adversarial matrix through the REAL parseItineraryDays + importItineraryDraft chain: every meal write is exactly 'pending'", async () => {
    expect(ADVERSARIAL_MEAL_MATRIX).toHaveLength(102);
    expect(new Set(ADVERSARIAL_MEAL_MATRIX).size).toBe(102);
    // Pack the whole matrix into day fixtures, 3 strings per day, rotating
    // through the breakfast/lunch/dinner slots.
    const dayFixtures: unknown[] = [];
    for (let i = 0; i < ADVERSARIAL_MEAL_MATRIX.length; i += 3) {
      dayFixtures.push({
        day: dayFixtures.length + 1,
        title: `矩陣日 ${dayFixtures.length + 1}`,
        activities: [],
        meals: {
          breakfast: ADVERSARIAL_MEAL_MATRIX[i],
          lunch: ADVERSARIAL_MEAL_MATRIX[i + 1] ?? "",
          dinner: ADVERSARIAL_MEAL_MATRIX[i + 2] ?? "",
        },
        accommodation: "四星酒店或同級",
      });
    }
    const matrixJson = JSON.stringify(dayFixtures);

    // REAL parser: the parsed day carries NO meal claim at all — meal
    // text in the source JSON is never even read.
    const parsedDays = parseItineraryDays(matrixJson);
    expect(parsedDays).toHaveLength(dayFixtures.length);
    for (const day of parsedDays) {
      expect(day).not.toHaveProperty("mealBreakfast");
      expect(day).not.toHaveProperty("mealLunch");
      expect(day).not.toHaveProperty("mealDinner");
    }

    // REAL DB-write chain: every itineraryDays insert stamps all three
    // meal columns exactly 'pending', regardless of the source text.
    freshImportDb({ itineraryDetailed: matrixJson, dailyItinerary: null });
    const result = await importItineraryDraft({ tourId: 42, createdBy: 7 });
    expect(result.dayCount).toBe(dayFixtures.length);
    const dayInserts = ops.filter((o) => o.kind === "insert" && o.table === itineraryDays);
    expect(dayInserts).toHaveLength(dayFixtures.length);
    for (const insert of dayInserts) {
      for (const col of ["mealBreakfast", "mealLunch", "mealDinner"] as const) {
        expect(insert.values![col]).toBe("pending");
        for (const forbidden of FORBIDDEN_MEAL_CLAIMS) {
          expect(insert.values![col]).not.toBe(forbidden);
        }
      }
    }
  });

  it("non-string / missing / exotic meal shapes also write 'pending' (no claim invented)", async () => {
    const weirdShapesJson = JSON.stringify([
      { day: 1, title: "數字與 null", activities: [], meals: { breakfast: 42, lunch: null, dinner: ["含早餐"] } },
      { day: 2, title: "meals 是字串", activities: [], meals: "含早餐" },
      { day: 3, title: "meals 缺席", activities: [] },
      { day: 4, title: "巢狀物件", activities: [], meals: { breakfast: { text: "含早餐" }, lunch: true, dinner: undefined } },
    ]);
    freshImportDb({ itineraryDetailed: weirdShapesJson, dailyItinerary: null });
    await importItineraryDraft({ tourId: 42, createdBy: 7 });
    const dayInserts = ops.filter((o) => o.kind === "insert" && o.table === itineraryDays);
    expect(dayInserts).toHaveLength(4);
    for (const insert of dayInserts) {
      expect(insert.values).toMatchObject({
        mealBreakfast: "pending",
        mealLunch: "pending",
        mealDinner: "pending",
      });
    }
  });
});

describe("importItineraryDraft — honest fresh import", () => {
  it("creates a draft itineraryVersion with sourceStatus demo_estimate and packgo.itinerary.v1", async () => {
    freshImportDb();
    const result = await importItineraryDraft({ tourId: 42, createdBy: 7 });
    expect(result).toMatchObject({
      itineraryId: "26JO217BRC-T",
      versionNumber: 1,
      productVersionId: 10,
      sourceStatus: "demo_estimate",
      dayCount: 2,
      stopCount: 3,
      replacedExistingDraft: false,
    });
    const ivInsert = ops.find((o) => o.kind === "insert" && o.table === itineraryVersions)!;
    expect(ivInsert.values).toMatchObject({
      productVersionId: 10,
      schemaVersion: "packgo.itinerary.v1",
      itineraryId: "26JO217BRC-T",
      versionNumber: 1,
      sourceStatus: "demo_estimate", // provenance NOT provable ⇒ honest floor
      status: "draft",
    });
  });

  it("day rows carry honest defaults: pending/unconfirmed/proposed_or_equivalent/demo_placeholder/prototype_only", async () => {
    freshImportDb();
    await importItineraryDraft({ tourId: 42, createdBy: 7 });
    const dayInserts = ops.filter((o) => o.kind === "insert" && o.table === itineraryDays);
    expect(dayInserts).toHaveLength(2);

    const day1 = dayInserts[0].values!;
    expect(day1).toMatchObject({
      dayId: "26JO217BRC-T-D01",
      dayNumber: 1,
      sourceStatus: "demo_estimate",
      movementDurationMinutes: null, // never guessed
      movementStatus: "pending",
      // Meal expectations changed per Jeff 2026-07-22 ruling (the ruled
      // behavior itself changed, NOT test weakening): imports make no
      // meal claims — the fixture's 自理/機上 text is deliberately ignored
      // and every meal is written 'pending'.
      mealBreakfast: "pending",
      mealLunch: "pending",
      mealDinner: "pending",
      // 夜宿機上 ⇒ honestly no stay claim at all
      stayPropertyStatus: "not_applicable",
      stayBookingStatus: "not_applicable",
      stayRatingValue: null,
      mediaSourceStatus: "demo_placeholder",
      mediaRightsStatus: "prototype_only",
    });

    const day2 = dayInserts[1].values!;
    expect(day2).toMatchObject({
      dayId: "26JO217BRC-T-D02",
      dayNumber: 2,
      // Changed per Jeff 2026-07-22 ruling (behavior change, not test
      // weakening): the fixture's 飯店內享用/風味料理/自助餐 text no
      // longer yields included_unconfirmed — no claim, 'pending'.
      mealBreakfast: "pending",
      mealLunch: "pending",
      mealDinner: "pending",
      stayPropertyStatus: "proposed_or_equivalent", // 「同級」language
      stayBookingStatus: "unconfirmed",
      stayRatingValue: 5, // parsed claim…
      stayRatingSystem: "unverified", // …but never verified
      stayRatingSourceStatus: "itinerary_standard_unverified",
      stayRatingVerifiedAt: null,
      mediaSourceStatus: "demo_placeholder",
      mediaRightsStatus: "prototype_only",
    });
    // No city claim is fabricated from the blob.
    expect(day1.city).toBeNull();
    expect(day2.city).toBeNull();
  });

  it("REGRESSION (Codex R3 fixtures, re-adjudicated): negation-family and 恕不-disclaimer meal text ALL write 'pending' — imports make no meal claims", async () => {
    // Meal expectations changed per Jeff 2026-07-22 ruling (the ruled
    // behavior itself changed, NOT test weakening): the R3 fixtures are
    // kept verbatim, but every meal now writes 'pending' through the
    // actual importItineraryDraft write chain.
    const negationChainJson = JSON.stringify([
      {
        day: 1,
        title: "抵達",
        activities: [{ title: "接機", description: "" }],
        meals: {
          breakfast: "飯店沒有早餐",
          lunch: "早餐並非包含項目".replace("早餐", "午餐"),
          dinner: "breakfast was never included".replace("breakfast", "dinner"),
        },
        accommodation: "四星酒店或同級",
      },
      {
        day: 2,
        title: "市區觀光",
        activities: [{ title: "皇宮", description: "" }],
        meals: {
          breakfast: "含早餐，恕不外帶",
          lunch: "午餐包含，但恕不打包",
          dinner: "hotel breakfast isn't provided".replace("breakfast", "dinner"),
        },
        accommodation: "四星酒店或同級",
      },
    ]);
    freshImportDb({ itineraryDetailed: negationChainJson, dailyItinerary: null });
    await importItineraryDraft({ tourId: 42, createdBy: 7 });
    const dayInserts = ops.filter((o) => o.kind === "insert" && o.table === itineraryDays);
    expect(dayInserts).toHaveLength(2);
    // Day 1: negation-family text ⇒ no claim, 'pending' (Jeff 2026-07-22).
    expect(dayInserts[0].values).toMatchObject({
      dayNumber: 1,
      mealBreakfast: "pending",
      mealLunch: "pending",
      mealDinner: "pending",
    });
    // Day 2: positive-claim text ⇒ equally no claim, 'pending'.
    expect(dayInserts[1].values).toMatchObject({
      dayNumber: 2,
      mealBreakfast: "pending",
      mealLunch: "pending",
      mealDinner: "pending",
    });
  });

  it("REGRESSION (Codex R4/R5 fixtures, re-adjudicated): clause-scoped attack families ALL write 'pending' through the DB write — imports make no meal claims", async () => {
    // Meal expectations changed per Jeff 2026-07-22 ruling (the ruled
    // behavior itself changed, NOT test weakening): the R4/R5 fixtures
    // are kept verbatim, but every meal now writes 'pending' through the
    // actual importItineraryDraft write chain.
    const clauseScopeJson = JSON.stringify([
      {
        day: 1,
        title: "抵達",
        activities: [{ title: "接機", description: "" }],
        meals: {
          breakfast: "無麩質早餐已包含", // 無-modifier positive, NOT a negation
          lunch: "lunch is not only included but upgraded", // positive contrast
          dinner: "dinner is no longer included", // en no-longer negation
        },
        accommodation: "四星酒店或同級",
      },
      {
        day: 2,
        title: "市區觀光",
        activities: [{ title: "皇宮", description: "" }],
        meals: {
          breakfast: "飯店早餐不會再提供", // multi-particle zh negation
          lunch: "午餐包含，但未提供機場接送", // non-meal-clause negation
          dinner: "dinner included, no extra dinner charge", // fee-talk clause
        },
        accommodation: "四星酒店或同級",
      },
    ]);
    freshImportDb({ itineraryDetailed: clauseScopeJson, dailyItinerary: null });
    await importItineraryDraft({ tourId: 42, createdBy: 7 });
    const dayInserts = ops.filter((o) => o.kind === "insert" && o.table === itineraryDays);
    expect(dayInserts).toHaveLength(2);
    expect(dayInserts[0].values).toMatchObject({
      dayNumber: 1,
      mealBreakfast: "pending",
      mealLunch: "pending",
      mealDinner: "pending",
    });
    expect(dayInserts[1].values).toMatchObject({
      dayNumber: 2,
      mealBreakfast: "pending",
      mealLunch: "pending",
      mealDinner: "pending",
    });
    // Never the confirmed 'included' through any meal write.
    for (const d of dayInserts) {
      expect(d.values!.mealBreakfast).not.toBe("included");
      expect(d.values!.mealLunch).not.toBe("included");
      expect(d.values!.mealDinner).not.toBe("included");
    }
  });

  it("stop rows are honest: route_or_stop_unconfirmed, pending source, no coordinates, NO supplier images", async () => {
    freshImportDb();
    await importItineraryDraft({ tourId: 42, createdBy: 7 });
    const stopInserts = ops.filter((o) => o.kind === "insert" && o.table === itineraryStops);
    expect(stopInserts).toHaveLength(3);
    for (const stop of stopInserts) {
      expect(stop.values).toMatchObject({
        kind: "sight",
        sourceStatus: "pending",
        visitStatus: "route_or_stop_unconfirmed",
        lat: null,
        lon: null,
        imageAssetId: null, // supplier image from the JSON was NOT copied
        mediaStatus: "demo_placeholder",
      });
      // The supplier image URL must not appear ANYWHERE in the written row.
      expect(JSON.stringify(stop.values)).not.toContain("supplier-cdn.example.com");
    }
    expect(stopInserts.map((s) => s.values!.stopId)).toEqual(["d1-lax", "d2-s1", "d2-s2"]);
    expect(stopInserts[1].values!.summary).toBe("參觀馬德里皇宮");
    expect(stopInserts[2].values!.summary).toBeNull(); // empty description ⇒ no claim
  });

  it("'confirmed'/'supplier_confirmed' provenance is unreachable through import", async () => {
    freshImportDb();
    await importItineraryDraft({ tourId: 42, createdBy: 7 });
    for (const op of ops) {
      const written = JSON.stringify(op.values ?? op.set ?? {});
      expect(written).not.toContain("supplier_confirmed");
      expect(written).not.toContain('"confirmed"');
    }
  });

  it("unparseable itinerary JSON ⇒ honest minimal result (version row, zero days/stops)", async () => {
    freshImportDb({ itineraryDetailed: "not json", dailyItinerary: "{broken" });
    const result = await importItineraryDraft({ tourId: 42, createdBy: 7 });
    expect(result.dayCount).toBe(0);
    expect(result.stopCount).toBe(0);
    expect(ops.filter((o) => o.kind === "insert" && o.table === itineraryDays)).toHaveLength(0);
    expect(ops.filter((o) => o.kind === "insert" && o.table === itineraryStops)).toHaveLength(0);
  });

  it("falls back to dailyItinerary when itineraryDetailed is unparseable", async () => {
    freshImportDb({ itineraryDetailed: null, dailyItinerary: sampleItineraryJson });
    const result = await importItineraryDraft({ tourId: 42, createdBy: 7 });
    expect(result.dayCount).toBe(2);
  });

  it("supplier-cost firewall: the tours SELECT projection contains no cost/image/price columns", async () => {
    freshImportDb();
    await importItineraryDraft({ tourId: 42, createdBy: 7 });
    const tourSelect = ops.find((o) => o.kind === "select" && o.table === tours)!;
    expect(tourSelect.fields).toEqual([
      "id",
      "productCode",
      "dailyItinerary",
      "itineraryDetailed",
    ]);
    for (const forbidden of [
      "agentPrice",
      "supplierCost",
      "galleryImages",
      "hotelImages",
      "imageUrl",
      "heroImage",
      "price",
    ]) {
      expect(tourSelect.fields).not.toContain(forbidden);
    }
  });

  it("day-level image/imageAlt fields in real source JSON are never written anywhere (fixture regression)", async () => {
    // Real-shaped fixture: image fields at BOTH the day level and the
    // activity level, exactly as the AI pipeline emits them.
    const dayLevelImageJson = JSON.stringify([
      {
        day: 1,
        title: "第一天 抵達",
        image: "https://supplier-cdn.example.com/day-hero.jpg",
        imageAlt: "supplier day hero",
        activities: [
          {
            title: "機場集合",
            description: "LAX 出發",
            image: "https://supplier-cdn.example.com/activity.jpg",
            imageAlt: "supplier activity photo",
          },
        ],
        meals: { breakfast: "自理", lunch: "自理", dinner: "機上" },
        accommodation: "夜宿機上",
      },
    ]);
    freshImportDb({ itineraryDetailed: dayLevelImageJson, dailyItinerary: null });
    const result = await importItineraryDraft({ tourId: 42, createdBy: 7 });
    expect(result.dayCount).toBe(1);
    expect(result.stopCount).toBe(1);
    // Full write scan: no written value or SET may carry the supplier
    // image URL or the imageAlt text.
    for (const op of ops) {
      const written = JSON.stringify({ values: op.values ?? null, set: op.set ?? null });
      expect(written).not.toContain("supplier-cdn.example.com");
      expect(written).not.toContain("supplier day hero");
      expect(written).not.toContain("supplier activity photo");
      expect(written).not.toContain("imageAlt");
    }
    // Media stays demo placeholder; the stop image column stays null.
    const dayInsert = ops.find((o) => o.kind === "insert" && o.table === itineraryDays)!;
    expect(dayInsert.values).toMatchObject({
      mediaSourceStatus: "demo_placeholder",
      mediaRightsStatus: "prototype_only",
    });
    const stopInsert = ops.find((o) => o.kind === "insert" && o.table === itineraryStops)!;
    expect(stopInsert.values).toMatchObject({ imageAssetId: null, mediaStatus: "demo_placeholder" });
  });

  it("errors when the tour has no draft productVersion", async () => {
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [productVersions, []],
      ]),
    );
    await expect(importItineraryDraft({ tourId: 42, createdBy: 7 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("rejects an explicit productVersionId that is not a draft (corrections are a NEW version)", async () => {
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [productVersions, [{ id: 11, tourId: 42, versionNumber: 2, status: "published" }]],
      ]),
    );
    await expect(
      importItineraryDraft({ tourId: 42, productVersionId: 11, createdBy: 7 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("importItineraryDraft — idempotent re-import", () => {
  it("re-import replaces the DRAFT version's children only, inside one transaction", async () => {
    const existingDraftIv = {
      id: 55,
      productVersionId: 10,
      itineraryId: "26JO217BRC-T",
      versionNumber: 3,
      sourceStatus: "demo_estimate",
      status: "draft",
    };
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [productVersions, [draftPv]],
        [itineraryVersions, ({ whereParams }) => (whereParams.includes("draft") ? [existingDraftIv] : [])],
        [itineraryDays, [{ id: 501 }, { id: 502 }]],
      ]),
    );
    const result = await importItineraryDraft({ tourId: 42, createdBy: 7 });
    expect(result).toMatchObject({
      itineraryVersionId: 55,
      versionNumber: 3, // versionNumber preserved — same draft version
      replacedExistingDraft: true,
      dayCount: 2,
    });

    // No second itineraryVersions row is created.
    expect(ops.filter((o) => o.kind === "insert" && o.table === itineraryVersions)).toHaveLength(0);

    // Children of THIS draft version (and only this one) were replaced.
    const deletes = ops.filter((o) => o.kind === "delete");
    expect(deletes).toHaveLength(2);
    expect(deletes[0].table).toBe(itineraryStops);
    expect(deletes[0].whereParams).toEqual([501, 502]);
    expect(deletes[1].table).toBe(itineraryDays);
    expect(deletes[1].whereParams).toEqual([55]);

    // Fresh honest children re-inserted.
    expect(ops.filter((o) => o.kind === "insert" && o.table === itineraryDays)).toHaveLength(2);
    expect(ops.filter((o) => o.kind === "insert" && o.table === itineraryStops)).toHaveLength(3);

    // Everything ran between txStart and txCommit.
    const txStart = ops.findIndex((o) => o.kind === "txStart");
    const txCommit = ops.findIndex((o) => o.kind === "txCommit");
    expect(txStart).toBeGreaterThanOrEqual(0);
    expect(txCommit).toBeGreaterThan(txStart);
    for (const op of ops) {
      if (op.kind === "delete" || op.kind === "insert" || op.kind === "update") {
        const idx = ops.indexOf(op);
        expect(idx).toBeGreaterThan(txStart);
        expect(idx).toBeLessThan(txCommit);
      }
    }
  });

  it("re-import UPDATE path: FULL scan of every written value and SET — no confirmed/cost/image content (Codex write-scan gap)", async () => {
    const existingDraftIv = {
      id: 55,
      productVersionId: 10,
      itineraryId: "26JO217BRC-T",
      versionNumber: 3,
      sourceStatus: "demo_estimate",
      status: "draft",
    };
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [productVersions, [draftPv]],
        [itineraryVersions, ({ whereParams }) => (whereParams.includes("draft") ? [existingDraftIv] : [])],
        [itineraryDays, [{ id: 501 }, { id: 502 }]],
      ]),
    );
    await importItineraryDraft({ tourId: 42, createdBy: 7 });
    // The UPDATE (re-stamp) op itself is included in the scan — this is
    // the write path the first-round tests missed.
    const restamp = ops.find((o) => o.kind === "update" && o.table === itineraryVersions)!;
    expect(restamp).toBeDefined();
    expect(restamp.set).toEqual({
      sourceStatus: "demo_estimate",
      schemaVersion: "packgo.itinerary.v1",
    });
    let scannedWrites = 0;
    for (const op of ops) {
      if (op.kind !== "insert" && op.kind !== "update") continue;
      scannedWrites++;
      const written = JSON.stringify(op.values ?? op.set ?? {});
      expect(written).not.toContain("supplier_confirmed");
      expect(written).not.toContain('"confirmed"');
      expect(written).not.toContain("source_document");
      expect(written).not.toContain("agentPrice");
      expect(written).not.toContain("supplierCost");
      expect(written).not.toContain("supplier-cdn.example.com");
      expect(written).not.toContain("imageAlt");
    }
    // 1 re-stamp UPDATE + 2 day INSERTs + 3 stop INSERTs all scanned.
    expect(scannedWrites).toBe(6);
  });
});

// ── createFeeContractDraft ───────────────────────────────────────────────

const validFee = {
  feeId: "guide-tips",
  category: "tips" as const,
  labelZh: "司導小費",
  labelEn: "Guide & driver tips",
  amountMinorUnits: 12_000,
  currency: "usd", // canonicalized to USD on write
  unit: "per_person" as const,
  payeeType: "guide_and_driver" as const,
  paymentTiming: "during_trip" as const,
  sourceStatus: "supplier_quote" as const,
};

const validContractInput = {
  tourId: 42,
  productVersionId: 10,
  contract: { sourceStatus: "supplier_quote" as const },
  fees: [validFee],
};

function feeDb() {
  wireDb(
    new Map<unknown, RowsSource>([
      [tours, [tourRow]],
      [productVersions, [draftPv]],
      [feeContracts, []],
    ]),
  );
}

describe("createFeeContractDraft — validation and honesty", () => {
  it("writes a draft contract with canonicalized currency and generated contractId", async () => {
    feeDb();
    const result = await createFeeContractDraft(validContractInput);
    expect(result).toMatchObject({
      contractId: "FEE-T42-PV10-1",
      status: "draft",
      sourceStatus: "supplier_quote",
      itemCount: 1,
    });
    const contractInsert = ops.find((o) => o.kind === "insert" && o.table === feeContracts)!;
    expect(contractInsert.values).toMatchObject({
      contractId: "FEE-T42-PV10-1",
      productVersionId: 10,
      sourceStatus: "supplier_quote",
      status: "draft",
    });
    const itemInsert = ops.find((o) => o.kind === "insert" && o.table === feeItems)!;
    expect(itemInsert.values).toMatchObject({
      feeId: "guide-tips",
      amountMinorUnits: 12_000,
      currency: "USD", // canonicalized
      sourceStatus: "supplier_quote",
      sortOrder: 0,
    });
  });

  it("rejects unknown currency codes (frozen fail-closed table)", async () => {
    feeDb();
    await expect(
      createFeeContractDraft({
        ...validContractInput,
        fees: [{ ...validFee, currency: "XXX" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);
  });

  it("rejects non-integer amounts (integer minor units only)", async () => {
    feeDb();
    await expect(
      createFeeContractDraft({
        ...validContractInput,
        fees: [{ ...validFee, amountMinorUnits: 120.5 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);
  });

  it("rejects negative amounts", async () => {
    feeDb();
    await expect(
      createFeeContractDraft({
        ...validContractInput,
        fees: [{ ...validFee, amountMinorUnits: -1 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("'confirmed' is unreachable: contract-level sourceStatus rejected", async () => {
    feeDb();
    await expect(
      createFeeContractDraft({
        ...validContractInput,
        contract: { sourceStatus: "confirmed" as any },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);
  });

  it("'confirmed' is unreachable: item-level sourceStatus rejected", async () => {
    feeDb();
    await expect(
      createFeeContractDraft({
        ...validContractInput,
        fees: [{ ...validFee, sourceStatus: "confirmed" as any }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("supplier-cost firewall: agentPrice / supplierCost keys in fee input are REJECTED by zod strict", async () => {
    feeDb();
    await expect(
      createFeeContractDraft({
        ...validContractInput,
        fees: [{ ...validFee, agentPrice: 999 } as any],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      createFeeContractDraft({
        ...validContractInput,
        fees: [{ ...validFee, supplierCost: 999 } as any],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);
  });

  it("schema-level firewall assertions (safeParse, no DB involved)", () => {
    expect(
      feeItemDraftInputSchema.safeParse({ ...validFee, agentPrice: 100 }).success,
    ).toBe(false);
    expect(
      feeItemDraftInputSchema.safeParse({ ...validFee, supplierCost: 100 }).success,
    ).toBe(false);
    expect(
      createFeeContractDraftInputSchema.safeParse({
        ...validContractInput,
        contract: { sourceStatus: "supplier_quote", agentPrice: 100 },
      }).success,
    ).toBe(false);
    // The valid input itself parses.
    expect(createFeeContractDraftInputSchema.safeParse(validContractInput).success).toBe(true);
    // 'confirmed' is not a member of either sourceStatus enum.
    expect(
      feeItemDraftInputSchema.safeParse({ ...validFee, sourceStatus: "confirmed" }).success,
    ).toBe(false);
  });

  it("rejects duplicate feeIds within one contract", async () => {
    feeDb();
    await expect(
      createFeeContractDraft({
        ...validContractInput,
        fees: [validFee, { ...validFee }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a productVersion that is not a draft", async () => {
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [productVersions, [{ id: 10, tourId: 42, versionNumber: 1, status: "published" }]],
      ]),
    );
    await expect(
      createFeeContractDraft({ ...validContractInput, productVersionId: 10 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("awaiting_supplier_quote contracts are honestly creatable (no fabricated lines required)", async () => {
    feeDb();
    const result = await createFeeContractDraft({
      tourId: 42,
      productVersionId: 10,
      contract: { sourceStatus: "awaiting_supplier_quote" },
      fees: [],
    });
    expect(result.sourceStatus).toBe("awaiting_supplier_quote");
    expect(result.itemCount).toBe(0);
  });

  it("existing-draft replace branch: same contractId on the same draft pv UPDATEs the draft, replaces its items, stays 'draft'", async () => {
    const existingDraftContract = {
      id: 88,
      contractId: "FEE-CUSTOM",
      productVersionId: 10,
      originMarket: "US-CA",
      destinationJurisdictions: null,
      displayRegion: null,
      validFrom: null,
      validTo: null,
      sourceStatus: "demo_estimate",
      status: "draft",
    };
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [productVersions, [draftPv]],
        [feeContracts, [existingDraftContract]],
      ]),
    );
    const result = await createFeeContractDraft({
      ...validContractInput,
      contract: { contractId: "FEE-CUSTOM", sourceStatus: "supplier_quote" },
    });
    expect(result).toMatchObject({
      feeContractId: 88,
      contractId: "FEE-CUSTOM",
      status: "draft",
      sourceStatus: "supplier_quote",
      itemCount: 1,
      replacedExistingDraft: true,
    });
    // The contract row is UPDATEd in place (no second contract row).
    expect(ops.filter((o) => o.kind === "insert" && o.table === feeContracts)).toHaveLength(0);
    const upd = ops.find((o) => o.kind === "update" && o.table === feeContracts)!;
    expect(upd.whereParams).toEqual([88]);
    expect(upd.set).toMatchObject({ status: "draft", sourceStatus: "supplier_quote" });
    // Old items dropped, new validated items inserted.
    const del = ops.find((o) => o.kind === "delete")!;
    expect(del.table).toBe(feeItems);
    expect(del.whereParams).toEqual([88]);
    expect(ops.filter((o) => o.kind === "insert" && o.table === feeItems)).toHaveLength(1);
    // Full-value scan of everything this branch wrote.
    for (const op of ops) {
      if (op.kind !== "insert" && op.kind !== "update") continue;
      const written = JSON.stringify(op.values ?? op.set ?? {});
      expect(written).not.toContain("agentPrice");
      expect(written).not.toContain("supplierCost");
      expect(written).not.toContain('"confirmed"');
    }
  });

  it("existing NON-draft contract with the same contractId is never replaced (corrections are a NEW version)", async () => {
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [tourRow]],
        [productVersions, [draftPv]],
        [
          feeContracts,
          [
            {
              id: 89,
              contractId: "FEE-CUSTOM",
              productVersionId: 10,
              status: "published",
              sourceStatus: "supplier_quote",
            },
          ],
        ],
      ]),
    );
    await expect(
      createFeeContractDraft({
        ...validContractInput,
        contract: { contractId: "FEE-CUSTOM", sourceStatus: "supplier_quote" },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(ops.filter((o) => o.kind === "insert" || o.kind === "update" || o.kind === "delete")).toHaveLength(0);
  });
});

// ── Cost firewall: two INDEPENDENT load-bearing layers ───────────────────
//
// Layer 1 = pre-parse deep scan of the RAW input (assertNoForbiddenPublicFields
//   before zod runs). If it were removed, the error for a forbidden key
//   would become zod's "Invalid fee contract draft input" message — the
//   tests below asserting the "pre-parse deep scan" message turn red.
// Layer 2 = zod `.strict()`. If it regressed to key-stripping, the direct
//   safeParse assertions (forbidden AND non-forbidden unknown keys) turn
//   red, as does the module-level non-forbidden-unknown-key rejection
//   (which the deep scan deliberately does not catch).

describe("cost firewall — each layer bears load independently", () => {
  it("LAYER 1: raw input with forbidden keys is rejected by the PRE-PARSE deep scan (error identity proves the scan ran first)", async () => {
    feeDb();
    const err = await createFeeContractDraft({
      ...validContractInput,
      fees: [{ ...validFee, agentPrice: 999 } as any],
    }).catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(err.message).toContain("pre-parse deep scan");
    expect(err.message).toContain("agentPrice");
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);

    feeDb();
    const err2 = await createFeeContractDraft({
      ...validContractInput,
      fees: [{ ...validFee, supplierCost: 999 } as any],
    }).catch((e) => e);
    expect(err2.message).toContain("pre-parse deep scan");
    expect(err2.message).toContain("supplierCost");
  });

  it("LAYER 1 catches forbidden keys at depths the zod shape never reaches", async () => {
    feeDb();
    const err = await createFeeContractDraft({
      ...validContractInput,
      contract: {
        sourceStatus: "supplier_quote",
        smuggled: { deeper: { agentPrice: 123 } },
      } as any,
    }).catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(err.message).toContain("pre-parse deep scan");
    expect(err.message).toContain("agentPrice");
  });

  it("LAYER 1 is a separate exported function callable without any zod parse", () => {
    expect(() =>
      assertNoForbiddenPublicFields({ contract: { agentPrice: 1 } }),
    ).toThrow(/agentPrice/);
    expect(() =>
      assertNoForbiddenPublicFields({ fees: [{ nested: { supplierCost: 2 } }] }),
    ).toThrow(/supplierCost/);
    expect(() => assertNoForbiddenPublicFields(validContractInput)).not.toThrow();
  });

  it("LAYER 2: zod .strict() alone rejects forbidden keys (red if strict regresses to strip)", () => {
    expect(feeItemDraftInputSchema.safeParse({ ...validFee, agentPrice: 100 }).success).toBe(false);
    expect(feeItemDraftInputSchema.safeParse({ ...validFee, supplierCost: 100 }).success).toBe(false);
  });

  it("LAYER 2: strict also rejects NON-forbidden unknown keys — coverage the deep scan does not provide", async () => {
    // Schema-level: only .strict() catches this key.
    expect(feeItemDraftInputSchema.safeParse({ ...validFee, someRandomKey: 1 }).success).toBe(false);
    // Module-level: the deep scan passes (not a cost key), so the
    // rejection MUST come from the zod layer — removing .strict() (or the
    // module's re-parse) turns this red.
    feeDb();
    const err = await createFeeContractDraft({
      ...validContractInput,
      fees: [{ ...validFee, someRandomKey: 1 } as any],
    }).catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(err.message).toContain("Invalid fee contract draft input");
    expect(err.message).not.toContain("pre-parse deep scan");
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);
  });
});

// ── RAW guard at the REAL ingress (Codex P2-1, round 3) ──────────────────
//
// The shared exported schema itself performs a raw-preserving pre-parse
// deep scan (LAYER 0), so the FIRST parse anywhere — the router's tRPC
// `.input()` parse included — scans the ORIGINAL object before zod can
// strip or validate anything. Error identity pins the layer:
//   - "raw ingress pre-parse deep scan" ⇒ LAYER 0 (schema raw scan);
//     removing the raw pre-parse wrapper turns every assertion on that
//     marker red (the rejection would then come from .strict() with an
//     "Unrecognized key" identity instead).
//   - "Unrecognized key" ⇒ `.strict()`; reverting any .strict() to zod's
//     default strip turns the non-forbidden-unknown-key tests red (the
//     raw scan deliberately ignores non-cost keys).

describe("RAW ingress firewall — shared schema deep-scans the raw object before any zod strip", () => {
  const rawScanIssue = (result: ReturnType<typeof createFeeContractDraftInputSchema.safeParse>) =>
    result.success ? [] : result.error.issues.map((i) => i.message);

  it("SCHEMA raw scan rejects a TOP-LEVEL forbidden key (raw-scan error identity)", () => {
    const result = createFeeContractDraftInputSchema.safeParse({
      ...validContractInput,
      agentPrice: 999,
    });
    expect(result.success).toBe(false);
    const messages = rawScanIssue(result);
    expect(messages.some((m) => m.includes("raw ingress pre-parse deep scan"))).toBe(true);
    expect(messages.some((m) => m.includes("agentPrice"))).toBe(true);
  });

  it("SCHEMA raw scan rejects a CONTRACT-LEVEL forbidden key, even nested past the zod shape", () => {
    const flat = createFeeContractDraftInputSchema.safeParse({
      ...validContractInput,
      contract: { sourceStatus: "supplier_quote", supplierCost: 500 },
    });
    expect(flat.success).toBe(false);
    expect(rawScanIssue(flat).some((m) => m.includes("raw ingress pre-parse deep scan"))).toBe(true);
    expect(rawScanIssue(flat).some((m) => m.includes("supplierCost"))).toBe(true);
    // Depth the object shape never validates — only the raw scan sees it.
    const deep = createFeeContractDraftInputSchema.safeParse({
      ...validContractInput,
      contract: { sourceStatus: "supplier_quote", smuggled: { deeper: { agentPrice: 1 } } },
    });
    expect(deep.success).toBe(false);
    expect(rawScanIssue(deep).some((m) => m.includes("raw ingress pre-parse deep scan"))).toBe(true);
  });

  it("SCHEMA raw scan rejects a FEE-ITEM-LEVEL forbidden key", () => {
    const result = createFeeContractDraftInputSchema.safeParse({
      ...validContractInput,
      fees: [{ ...validFee, agentPrice: 999 }],
    });
    expect(result.success).toBe(false);
    expect(rawScanIssue(result).some((m) => m.includes("raw ingress pre-parse deep scan"))).toBe(true);
    expect(rawScanIssue(result).some((m) => m.includes("agentPrice"))).toBe(true);
  });

  it("STRICT layer stays independently load-bearing: NON-forbidden unknown keys at all three depths are rejected by .strict(), not the raw scan", () => {
    const cases = [
      { ...validContractInput, junkTopLevel: 1 },
      { ...validContractInput, contract: { sourceStatus: "supplier_quote", junkContract: 1 } },
      { ...validContractInput, fees: [{ ...validFee, junkFeeItem: 1 }] },
    ];
    for (const input of cases) {
      const result = createFeeContractDraftInputSchema.safeParse(input);
      expect(result.success).toBe(false);
      const messages = rawScanIssue(result);
      expect(messages.some((m) => /unrecognized key/i.test(m))).toBe(true);
      expect(messages.some((m) => m.includes("raw ingress pre-parse deep scan"))).toBe(false);
    }
    // Valid input still parses through the wrapped schema.
    expect(createFeeContractDraftInputSchema.safeParse(validContractInput).success).toBe(true);
  });

  // ── Real ingress path: the ACTUAL router with the REAL schema+module ──
  const routerCtx = () => ({
    req: { headers: {}, socket: {} } as any,
    res: { cookie: () => {}, clearCookie: () => {} } as any,
    user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    ip: "127.0.0.1",
  });
  const routerCaller = () => (storefrontPublishRouter as any).createCaller(routerCtx());

  it("ROUTER path: forbidden keys at all three depths are rejected by the FIRST (router) parse via the raw scan — module and DB never touched", async () => {
    const badInputs = [
      { ...validContractInput, agentPrice: 999 }, // top level
      { ...validContractInput, contract: { sourceStatus: "supplier_quote", supplierCost: 500 } }, // contract level
      { ...validContractInput, fees: [{ ...validFee, agentPrice: 999 }] }, // fee-item level
    ];
    for (const bad of badInputs) {
      vi.clearAllMocks();
      const err = await routerCaller()
        .createFeeContractDraft(bad as any)
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "BAD_REQUEST" });
      // Error identity: the RAW pre-parse deep scan inside the shared
      // schema fired on the untouched input at the router boundary.
      expect(String((err as any).cause ?? (err as any).message)).toContain(
        "raw ingress pre-parse deep scan",
      );
      // The rejection happened at ingress parse: the module never even
      // asked for a DB connection.
      expect(dbModule.getDb).not.toHaveBeenCalled();
    }
  });

  it("ROUTER path: a NON-forbidden unknown key is rejected by .strict() through the real ingress (red if strict regresses to strip)", async () => {
    const err = await routerCaller()
      .createFeeContractDraft({
        ...validContractInput,
        fees: [{ ...validFee, someRandomKey: 1 }],
      } as any)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(String((err as any).cause ?? (err as any).message)).toMatch(/unrecognized key/i);
    expect(String((err as any).cause ?? (err as any).message)).not.toContain(
      "raw ingress pre-parse deep scan",
    );
    expect(dbModule.getDb).not.toHaveBeenCalled();
  });

  it("ROUTER path: valid input flows through the real schema into the REAL module and writes the draft (chain un-mocked)", async () => {
    feeDb();
    const result = await routerCaller().createFeeContractDraft(validContractInput as any);
    expect(result).toMatchObject({
      contractId: "FEE-T42-PV10-1",
      status: "draft",
      sourceStatus: "supplier_quote",
      itemCount: 1,
    });
    // The REAL module ran: the stubbed driver recorded the actual writes.
    expect(ops.filter((o) => o.kind === "insert" && o.table === feeContracts)).toHaveLength(1);
    expect(ops.filter((o) => o.kind === "insert" && o.table === feeItems)).toHaveLength(1);
  });
});

// ── Validity-window integrity (input layer) ──────────────────────────────

describe("fee contract validity window — input-layer rejection", () => {
  it("schema layer rejects validFrom > validTo (reversed window)", () => {
    const parsed = createFeeContractDraftInputSchema.safeParse({
      ...validContractInput,
      contract: {
        sourceStatus: "supplier_quote",
        validFrom: new Date("2026-09-01T00:00:00Z"),
        validTo: new Date("2026-08-01T00:00:00Z"),
      },
    });
    expect(parsed.success).toBe(false);
    // Forward and single-day windows stay valid.
    expect(
      createFeeContractDraftInputSchema.safeParse({
        ...validContractInput,
        contract: {
          sourceStatus: "supplier_quote",
          validFrom: new Date("2026-08-01T00:00:00Z"),
          validTo: new Date("2026-08-01T00:00:00Z"),
        },
      }).success,
    ).toBe(true);
    // Open-ended windows (either bound missing) stay valid.
    expect(
      createFeeContractDraftInputSchema.safeParse({
        ...validContractInput,
        contract: { sourceStatus: "supplier_quote", validFrom: new Date("2026-08-01T00:00:00Z") },
      }).success,
    ).toBe(true);
  });

  it("module layer rejects a reversed window before any DB write", async () => {
    feeDb();
    await expect(
      createFeeContractDraft({
        ...validContractInput,
        contract: {
          sourceStatus: "supplier_quote",
          validFrom: new Date("2026-09-01T00:00:00Z"),
          validTo: new Date("2026-08-01T00:00:00Z"),
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);
  });
});

// ── Shared tour-level write serialization (Codex P1-1) ───────────────────

describe("shared tour-level write serialization", () => {
  function lockSelects(list: Op[]) {
    return list
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.kind === "select" && o.table === tours && o.lock === "update");
  }

  it("createDraftProductVersion: tours row locked FOR UPDATE inside the tx, before the versionNumber read and the insert", async () => {
    wireDb(
      new Map<unknown, RowsSource>([
        [tours, [{ id: 42, productCode: "P1", dailyItinerary: null, itineraryDetailed: null }]],
        [productVersions, [{ versionNumber: 2 }]],
      ]),
    );
    await createDraftProductVersion({ tourId: 42, createdBy: 7 });
    const txStart = ops.findIndex((o) => o.kind === "txStart");
    const txCommit = ops.findIndex((o) => o.kind === "txCommit");
    const locks = lockSelects(ops);
    expect(locks).toHaveLength(1);
    expect(locks[0].i).toBeGreaterThan(txStart);
    const versionRead = ops.findIndex(
      (o) => o.kind === "select" && o.table === productVersions,
    );
    const insertIdx = ops.findIndex((o) => o.kind === "insert");
    expect(versionRead).toBeGreaterThan(locks[0].i);
    expect(insertIdx).toBeGreaterThan(versionRead);
    expect(txCommit).toBeGreaterThan(insertIdx);
    // The precondition read itself is a locking read (current data).
    expect((ops[versionRead] as Op).lock).toBe("update");
  });

  it("importItineraryDraft: tour lock is the FIRST statement in the tx; every precondition read follows it under FOR UPDATE", async () => {
    freshImportDb();
    await importItineraryDraft({ tourId: 42, createdBy: 7 });
    const txStart = ops.findIndex((o) => o.kind === "txStart");
    const locks = lockSelects(ops);
    expect(locks).toHaveLength(1);
    // First DB statement inside the tx is the tour lock.
    const firstInTx = ops.slice(txStart + 1).findIndex((o) => o.kind === "select");
    expect(txStart + 1 + firstInTx).toBe(locks[0].i);
    // Draft-productVersion + existing-draft reads are locking reads after it.
    for (const { o, i } of ops
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.kind === "select" && (o.table === productVersions || o.table === itineraryVersions))) {
      expect(i).toBeGreaterThan(locks[0].i);
      expect(o.lock).toBe("update");
    }
  });

  it("createFeeContractDraft: same convention — lock, then preconditions, then writes, one tx", async () => {
    feeDb();
    await createFeeContractDraft(validContractInput);
    const txStart = ops.findIndex((o) => o.kind === "txStart");
    const locks = lockSelects(ops);
    expect(locks).toHaveLength(1);
    expect(locks[0].i).toBeGreaterThan(txStart);
    for (const { o, i } of ops
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.kind === "select" && (o.table === productVersions || o.table === feeContracts))) {
      expect(i).toBeGreaterThan(locks[0].i);
      expect(o.lock).toBe("update");
    }
    const firstWrite = ops.findIndex((o) => o.kind === "insert");
    expect(firstWrite).toBeGreaterThan(locks[0].i);
  });

  it("REGRESSION publish/import interleaving: an import racing a publish waits on the tour lock, then re-reads and REJECTS — no draft child can land under a published parent", async () => {
    // Shared mutable state — the second transaction sees what the first
    // committed, exactly like the real DB under the row lock.
    const state = {
      pv: { id: 10, tourId: 42, versionNumber: 1, status: "draft" },
      iv: {
        id: 55,
        productVersionId: 10,
        schemaVersion: "packgo.itinerary.v1",
        itineraryId: "26JO217BRC-T",
        versionNumber: 1,
        sourceStatus: "demo_estimate",
        originMarket: null,
        destinationJurisdictions: null,
        status: "draft",
      },
    };
    const handlers = new Map<unknown, TableOps>([
      [
        tours,
        { select: () => [{ id: 42, productCode: "26JO217BRC-T", dailyItinerary: null, itineraryDetailed: sampleItineraryJson }] },
      ],
      [
        productVersions,
        {
          select: (params) => {
            if (params.includes("published")) {
              return state.pv.status === "published" && state.pv.tourId === params[0]
                ? [{ id: state.pv.id }]
                : [];
            }
            if (params.includes("draft")) {
              return state.pv.status === "draft" && state.pv.tourId === params[0]
                ? [{ ...state.pv }]
                : [];
            }
            return params[0] === state.pv.id ? [{ ...state.pv }] : [];
          },
          update: (set, params) => {
            // parent flip: [id, 'draft']; supersede: [tourId, 'published']
            if (params.includes("draft")) {
              if (state.pv.id === params[0] && state.pv.status === "draft") {
                Object.assign(state.pv, set);
                return 1;
              }
              return 0;
            }
            if (params.includes("published")) {
              if (state.pv.tourId === params[0] && state.pv.status === "published") {
                Object.assign(state.pv, set);
                return 1;
              }
              return 0;
            }
            return 0;
          },
        },
      ],
      [
        itineraryVersions,
        {
          select: (params) => {
            if (typeof params[0] === "string") {
              return state.iv.itineraryId === params[0] ? [{ ...state.iv }] : [];
            }
            if (params.includes("draft")) {
              return state.iv.productVersionId === params[0] && state.iv.status === "draft"
                ? [{ ...state.iv }]
                : [];
            }
            return state.iv.productVersionId === params[0] ? [{ ...state.iv }] : [];
          },
          update: (set, params) => {
            if (params.includes("draft")) {
              if (state.iv.id === params[0] && state.iv.status === "draft") {
                Object.assign(state.iv, set);
                return 1;
              }
              return 0;
            }
            Object.assign(state.iv, set);
            return 1;
          },
        },
      ],
      [itineraryDays, { select: () => [] }],
      [itineraryStops, { select: () => [] }],
      [feeContracts, { select: () => [] }],
      [feeItems, { select: () => [] }],
    ]);
    let attempts = 0;
    let acquisitions = 0;
    const latch = makeLatch();
    wireLockingDb(handlers, tours, {
      onLockAttempt: () => {
        attempts++;
      },
      onLockAcquired: () => {
        acquisitions++;
        // Pause the FIRST holder (the publish) mid-transaction, lock held.
        if (acquisitions === 1) return latch.gate;
      },
    });

    // Publish starts first, takes the tour lock, and is PAUSED on the latch…
    const publishPromise = publishProductVersion({ productVersionId: 10, publishedBy: 7 });
    await waitFor(
      () => acquisitions === 1,
      "publish must take the tours FOR UPDATE lock (lock removed?)",
    );
    // …then the import races in on the SAME tour and parks on the lock.
    const importPromise = importItineraryDraft({ tourId: 42, productVersionId: 10, createdBy: 7 });
    await waitFor(() => attempts === 2, "import must attempt the tour lock while publish holds it");

    // TRUE-OVERLAP PROOF (Codex P1-1 round 3): at this moment BOTH
    // transactions are open, NOTHING has committed, and the import's lock
    // acquisition has NOT happened — it is blocked behind the paused
    // publish. Removing the stub's `await prev` blocking lets the import
    // run to completion here and turns these assertions red.
    expect(ops.filter((o) => o.kind === "txStart")).toHaveLength(2);
    expect(ops.filter((o) => o.kind === "txCommit")).toHaveLength(0);
    expect(ops.filter((o) => o.kind === "txRollback")).toHaveLength(0);
    expect(acquisitions).toBe(1);
    expect(
      ops.filter((o) => o.kind === "select" && o.table === tours && o.lock === "update"),
    ).toHaveLength(1);
    // Extra scheduler turns: the import must STAY parked while the latch
    // is closed (this is what "waiting on the row lock" means).
    for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));
    expect(acquisitions).toBe(1);
    expect(ops.filter((o) => o.kind === "txCommit")).toHaveLength(0);

    // Only now may the publish finish — releasing the lock frees the import.
    latch.release();
    const importErr = await importPromise.catch((e) => e);
    await publishPromise; // publish completes cleanly

    // The import re-read the pv AFTER the publish committed ⇒ rejected.
    expect(importErr).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(state.pv.status).toBe("published");
    expect(state.iv.status).toBe("published");
    // NOTHING was inserted — no draft child ever landed under the
    // published parent, and no unvalidated row entered the child UPDATE.
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);
    expect(ops.filter((o) => o.kind === "delete")).toHaveLength(0);
    // Serialization proof: the import's lock acquisition comes AFTER the
    // publish transaction committed.
    const commitIdx = ops.findIndex((o) => o.kind === "txCommit");
    const locks = ops
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.kind === "select" && o.table === tours && o.lock === "update");
    expect(locks).toHaveLength(2);
    expect(locks[0].i).toBeLessThan(commitIdx);
    expect(locks[1].i).toBeGreaterThan(commitIdx);
    // The import ended in rollback, not commit.
    expect(ops.filter((o) => o.kind === "txCommit")).toHaveLength(1);
    expect(ops.filter((o) => o.kind === "txRollback")).toHaveLength(1);
  });
});
