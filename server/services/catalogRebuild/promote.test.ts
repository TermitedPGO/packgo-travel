/**
 * promote.test — 原子換批 + 快照回滾的單元測。
 *
 * 用 in-memory mock tx(不碰真 DB)驗:
 *   - promote 的操作「順序」:每團一定「先快照舊列 → 再就地覆蓋」(原子前提)。
 *   - promote 寫進 tours 的 payload(新值 + active + batchId + lastBatchAt)。
 *   - 退役團(供應商下架)先快照、再 inactive。
 *   - 批狀態翻轉:這批 live、上一批 archived(史上第一批則不翻上一批)。
 *   - 紅線:fields 帶 agentPrice → promoteBatch throw(覆蓋前就擋下)。
 *   - revert 把快照寫回、翻回上一批 live;壞快照跳過不掛。
 *   - buildRestorePayload 只還原「重抓管的欄」、coerce lastBatchAt、丟掉 id。
 */

import { describe, it, expect } from "vitest";
import {
  promoteBatch,
  revertBatch,
  buildRestorePayload,
  RESTORABLE_TOUR_COLUMNS,
} from "./promote";
import { CostLeakGuardError } from "./guard";
import {
  tours as toursTable,
  catalogBatches as batchesTable,
  toursCatalogArchive as archiveTable,
} from "../../../drizzle/schema";

const NOW = new Date("2026-06-16T12:00:00.000Z");

type Op = { kind: "insert" | "update"; table: unknown; payload: unknown };

/**
 * Minimal chainable Drizzle-tx stub. Selects resolve from seeded queues (by
 * table); insert/update record their payloads into `ops` (ordered) so tests
 * assert the exact sequence promote/revert performs.
 */
function makeMockTx(seed: {
  toursSelectQueue?: unknown[][];
  archiveSelectRows?: unknown[];
  batchSelectRows?: unknown[];
}) {
  const ops: Op[] = [];
  let toursIdx = 0;

  function resolveSelect(table: unknown): unknown[] {
    if (table === toursTable) return seed.toursSelectQueue?.[toursIdx++] ?? [];
    if (table === archiveTable) return seed.archiveSelectRows ?? [];
    if (table === batchesTable) return seed.batchSelectRows ?? [];
    return [];
  }

  const tx = {
    select(_projection?: unknown) {
      let table: unknown;
      const builder: any = {
        from(t: unknown) {
          table = t;
          return builder;
        },
        where(_cond: unknown) {
          return builder;
        },
        limit(_n: number) {
          return resolveSelect(table);
        },
        // thenable so `await builder` (no .limit()) works for the archive read
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
          return Promise.resolve(resolveSelect(table)).then(res, rej);
        },
      };
      return builder;
    },
    insert(table: unknown) {
      return {
        values(payload: unknown) {
          ops.push({ kind: "insert", table, payload });
          return Promise.resolve([{ insertId: 0 }]);
        },
      };
    },
    update(table: unknown) {
      return {
        set(payload: unknown) {
          return {
            where(_cond: unknown) {
              ops.push({ kind: "update", table, payload });
              return Promise.resolve([{}]);
            },
          };
        },
      };
    },
  };

  return { tx, ops };
}

describe("promoteBatch", () => {
  it("snapshots the old row BEFORE overwriting, for every promoted + retired tour", async () => {
    const oldRetired = { id: 20, title: "舊退役團", status: "active", batchId: 5 };
    const oldPromoted = { id: 10, title: "舊版", price: 500, status: "active", batchId: 5 };
    const { tx, ops } = makeMockTx({
      toursSelectQueue: [[oldRetired], [oldPromoted]],
    });

    const res = await promoteBatch(
      tx as any,
      {
        batchId: 7,
        promotable: [
          {
            tourId: 10,
            productCode: "P1",
            fields: { title: "新版", price: 998, dailyItinerary: "[{}]" },
          },
        ],
        retiredTourIds: [20],
        replacedBatchId: 5,
      },
      NOW,
    );

    expect(res).toEqual({ batchId: 7, promoted: 1, retired: 1, snapshotted: 2 });

    // ── ordering: retired (snapshot→inactive), then promoted (snapshot→active),
    //    then batch flips. ──
    const archiveInserts = ops.filter(
      (o) => o.kind === "insert" && o.table === archiveTable,
    );
    expect(archiveInserts).toHaveLength(2);
    expect(archiveInserts[0].payload).toEqual({
      batchId: 7,
      tourId: 20,
      snapshotJson: JSON.stringify(oldRetired),
    });
    expect(archiveInserts[1].payload).toEqual({
      batchId: 7,
      tourId: 10,
      snapshotJson: JSON.stringify(oldPromoted),
    });

    // retired tour set inactive
    const tourUpdates = ops.filter(
      (o) => o.kind === "update" && o.table === toursTable,
    );
    expect(tourUpdates[0].payload).toEqual({ status: "inactive" });
    // promoted tour gets new fields + active + batch markers
    expect(tourUpdates[1].payload).toEqual({
      title: "新版",
      price: 998,
      dailyItinerary: "[{}]",
      status: "active",
      batchId: 7,
      lastBatchAt: NOW,
    });

    // snapshot strictly precedes the overwrite for the promoted tour
    const snapIdx = ops.findIndex(
      (o) =>
        o.kind === "insert" &&
        o.table === archiveTable &&
        (o.payload as any).tourId === 10,
    );
    const updIdx = ops.findIndex(
      (o) =>
        o.kind === "update" &&
        o.table === toursTable &&
        (o.payload as any).status === "active",
    );
    expect(snapIdx).toBeGreaterThanOrEqual(0);
    expect(updIdx).toBeGreaterThan(snapIdx);
  });

  it("flips this batch to live and the replaced batch to archived", async () => {
    const { tx, ops } = makeMockTx({ toursSelectQueue: [[{ id: 10 }]] });
    await promoteBatch(
      tx as any,
      {
        batchId: 7,
        promotable: [{ tourId: 10, productCode: "P1", fields: { title: "x" } }],
        retiredTourIds: [],
        replacedBatchId: 5,
      },
      NOW,
    );
    const batchUpdates = ops.filter(
      (o) => o.kind === "update" && o.table === batchesTable,
    );
    expect(batchUpdates).toHaveLength(2);
    expect(batchUpdates[0].payload).toEqual({
      status: "live",
      replacedBatchId: 5,
      toursPromoted: 1,
      promotedAt: NOW,
    });
    expect(batchUpdates[1].payload).toEqual({
      status: "archived",
      archivedAt: NOW,
    });
  });

  it("first batch ever (replacedBatchId null): does not archive a prior batch", async () => {
    const { tx, ops } = makeMockTx({ toursSelectQueue: [[{ id: 10 }]] });
    await promoteBatch(
      tx as any,
      {
        batchId: 1,
        promotable: [{ tourId: 10, productCode: "P1", fields: { title: "x" } }],
        retiredTourIds: [],
        replacedBatchId: null,
      },
      NOW,
    );
    const batchUpdates = ops.filter(
      (o) => o.kind === "update" && o.table === batchesTable,
    );
    expect(batchUpdates).toHaveLength(1);
    expect((batchUpdates[0].payload as any).replacedBatchId).toBeNull();
  });

  it("RED LINE: throws if a promotable's fields carry a cost/agentPrice key", async () => {
    const { tx } = makeMockTx({ toursSelectQueue: [[{ id: 10 }]] });
    await expect(
      promoteBatch(
        tx as any,
        {
          batchId: 7,
          promotable: [
            {
              tourId: 10,
              productCode: "P1",
              fields: { title: "ok", agentPrice: 44900 },
            },
          ],
          retiredTourIds: [],
          replacedBatchId: null,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(CostLeakGuardError);
  });

  it("missing tour row (snapshot read empty) does not count as snapshotted but still updates", async () => {
    const { tx, ops } = makeMockTx({ toursSelectQueue: [[]] }); // tour 99 not found
    const res = await promoteBatch(
      tx as any,
      {
        batchId: 7,
        promotable: [{ tourId: 99, productCode: "P1", fields: { title: "x" } }],
        retiredTourIds: [],
        replacedBatchId: null,
      },
      NOW,
    );
    expect(res.snapshotted).toBe(0);
    expect(res.promoted).toBe(1);
    const archiveInserts = ops.filter((o) => o.table === archiveTable);
    expect(archiveInserts).toHaveLength(0);
  });
});

describe("revertBatch", () => {
  it("restores each snapshot into tours and flips the replaced batch back to live", async () => {
    const snapshot = {
      id: 10,
      title: "回滾前的舊值",
      price: 500,
      status: "active",
      batchId: 5,
      lastBatchAt: "2026-06-01T00:00:00.000Z",
      startDate: "2026-09-01T00:00:00.000Z", // must NOT be restored
    };
    const { tx, ops } = makeMockTx({
      archiveSelectRows: [{ tourId: 10, snapshotJson: JSON.stringify(snapshot) }],
      batchSelectRows: [{ replacedBatchId: 5 }],
    });

    const res = await revertBatch(tx as any, 7, NOW);
    expect(res).toEqual({ batchId: 7, restored: 1, restoredLiveBatchId: 5 });

    const tourUpdate = ops.find(
      (o) => o.kind === "update" && o.table === toursTable,
    );
    const payload = tourUpdate!.payload as Record<string, unknown>;
    expect(payload.title).toBe("回滾前的舊值");
    expect(payload.price).toBe(500);
    expect(payload.status).toBe("active");
    expect(payload.batchId).toBe(5);
    expect(payload.lastBatchAt).toBeInstanceOf(Date);
    // never restore the primary key or untouched columns
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("startDate");

    const batchUpdates = ops.filter(
      (o) => o.kind === "update" && o.table === batchesTable,
    );
    expect(batchUpdates[0].payload).toEqual({ status: "archived", archivedAt: NOW });
    expect(batchUpdates[1].payload).toEqual({ status: "live", archivedAt: null });
  });

  it("first batch revert (replacedBatchId null): restores tours, no prior batch to relive", async () => {
    const { tx, ops } = makeMockTx({
      archiveSelectRows: [
        { tourId: 10, snapshotJson: JSON.stringify({ id: 10, status: "draft" }) },
      ],
      batchSelectRows: [{ replacedBatchId: null }],
    });
    const res = await revertBatch(tx as any, 1, NOW);
    expect(res.restoredLiveBatchId).toBeNull();
    const batchUpdates = ops.filter(
      (o) => o.kind === "update" && o.table === batchesTable,
    );
    expect(batchUpdates).toHaveLength(1); // only the archived flip; nothing to relive
  });

  it("skips a corrupt snapshot without throwing", async () => {
    const { tx, ops } = makeMockTx({
      archiveSelectRows: [
        { tourId: 10, snapshotJson: "{not valid json" },
        { tourId: 11, snapshotJson: JSON.stringify({ id: 11, status: "active" }) },
      ],
      batchSelectRows: [{ replacedBatchId: null }],
    });
    const res = await revertBatch(tx as any, 7, NOW);
    expect(res.restored).toBe(1); // only the valid one
    const tourUpdates = ops.filter(
      (o) => o.kind === "update" && o.table === toursTable,
    );
    expect(tourUpdates).toHaveLength(1);
  });
});

describe("buildRestorePayload", () => {
  it("keeps only rebuild-managed columns, drops id + untouched columns", () => {
    const out = buildRestorePayload({
      id: 10,
      title: "T",
      price: 999,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      startDate: "2026-09-01T00:00:00.000Z",
      maxParticipants: 20,
    });
    expect(out.title).toBe("T");
    expect(out.price).toBe(999);
    expect(out.status).toBe("active");
    expect(out).not.toHaveProperty("id");
    expect(out).not.toHaveProperty("createdAt");
    expect(out).not.toHaveProperty("startDate");
    expect(out).not.toHaveProperty("maxParticipants");
  });

  it("coerces lastBatchAt string → Date, keeps null as null", () => {
    const withDate = buildRestorePayload({
      lastBatchAt: "2026-06-01T00:00:00.000Z",
    });
    expect(withDate.lastBatchAt).toBeInstanceOf(Date);

    const withNull = buildRestorePayload({ lastBatchAt: null });
    expect(withNull.lastBatchAt).toBeNull();
  });

  it("omits columns absent from the snapshot (no undefined writes)", () => {
    const out = buildRestorePayload({ title: "only title" });
    expect(Object.keys(out)).toEqual(["title"]);
  });

  it("RESTORABLE_TOUR_COLUMNS covers the rebuild-managed fields", () => {
    for (const col of [
      "title",
      "price",
      "status",
      "batchId",
      "lastBatchAt",
      "itineraryDetailed",
      "attractions",
      "dailyItinerary",
      "heroImageCredit", // 0115 — stock-photo attribution written by attachStockHeroImages
    ]) {
      expect(RESTORABLE_TOUR_COLUMNS).toContain(col);
    }
  });
});
