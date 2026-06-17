/**
 * catalogRebuild — 重抓總指揮(import 總指揮)。
 *
 * 一次重抓 = 開一個 batch → 刷新供應商鏡像(sync + enrich 補完整)→ 把每個產品算成
 * 待上架 tour 候選(staging,純函式)→ 過完整度門檻 → 原子換上架批(promote,快照可
 * 回滾)→ 刷新該團班期(tourDepartures)。客人 id / URL / FK / SEO 全穩(就地更新)。
 *
 * 紅線(焊死):
 *   - 只寫 retail(tours.price = 直客起價);agentPrice(成本)永不進 tours。
 *     staging 出口 + promote 出口各過一次 assertRetailOnly。
 *   - 對線上目錄的實際大寫入(promote)前一定先跟 Jeff 確認(快照可退)。所以本檔
 *     預設 **不自己跑** — 由 admin mutation 手動觸發,且支援 dryRun / limit 先小批驗。
 *
 * 供應商:UV 先(productCode 對映乾淨,量小近完整)。Lion 的 tours 對映用三個不同 ID
 * (GroupCode / tourId / NormGroupID),需先解 NormGroupID 橋接才接得上「就地更新」,
 * 故 Lion 路徑暫時 gated(見 loadExistingSupplierTours)。
 *
 * 進度回報走純資料(RebuildReport)— 監工 / Jeff 一眼看「補了多少、擋了多少、缺什麼」。
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  suppliers as suppliersTable,
  supplierProducts as productsTable,
  supplierDepartures as departuresTable,
  supplierProductDetails as detailsTable,
  tours as toursTable,
  catalogBatches as batchesTable,
} from "../../../drizzle/schema";
import { createChildLogger } from "../../_core/logger";
import { syncUvCatalog } from "../supplierSync/uv";
import { enrichUvProduct } from "../supplierSync/uvDetail";
import { upsertProductDetail } from "../supplierSync/sharedDetail";
import {
  buildDepartureFromMirrorRow,
  headlineFromBuiltDepartures,
  type BuiltMirrorDeparture,
} from "../uvBulkImportService";
import {
  createTour,
  createDeparture,
  deleteDeparture,
  getTourDepartures,
} from "../../db";
import { buildStagedTour, type MirrorProduct, type MirrorDetail } from "./staging";
import { promoteBatch, type PromotableTour } from "./promote";

const log = createChildLogger({ module: "catalogRebuild" });

export type RebuildScope = "uv" | "lion";

export interface RebuildOptions {
  /** 只處理前 N 個產品(小批驗 promote+rollback 用)。 */
  limit?: number;
  /** true = 只算 staging + 回報,完全不寫 tours / 不建 draft(安全預覽)。 */
  dryRun?: boolean;
  /** 跳過 sync + enrich(鏡像已最新時,純重建 tours)。 */
  skipSync?: boolean;
  /** 新建 draft 的 createdBy。 */
  createdBy?: number;
}

export interface RebuildReport {
  scope: RebuildScope;
  batchId: number | null;
  dryRun: boolean;
  productsScanned: number;
  complete: number;
  incomplete: number;
  promoted: number;
  retired: number;
  newDrafts: number;
  /** 完整團中對到既有 tour 的數量(就地更新,id/URL/SEO 穩)。 */
  matchedExisting: number;
  /** 完整團中對不到既有 tour、會新建列的數量(高 = 對映有問題 / 重複風險)。 */
  wouldCreateNew: number;
  /** 缺項 → 幾團缺(Jeff 一眼看重抓還差什麼)。 */
  missingBreakdown: Record<string, number>;
  /** 前幾筆不完整樣本,給人看。 */
  incompleteSamples: Array<{ productCode: string; missing: string[] }>;
}

/** UV tours 的 sourceUrl host(辨識「這團屬於 UV」)。 */
const UV_SOURCE_HOST = "uvbookings.toursbms.com";

interface ExistingTour {
  id: number;
  status: string;
}

/**
 * 純函式:既有 active 團 - 這次有抓到的 = 供應商已下架 → 該退役。
 * 可單元測,不碰 DB。
 */
export function computeRetiredTourIds(
  existingByCode: Map<string, ExistingTour>,
  seenCodes: Set<string>,
): number[] {
  const retired: number[] = [];
  for (const [code, t] of existingByCode) {
    if (t.status === "active" && !seenCodes.has(code)) retired.push(t.id);
  }
  return retired;
}

/** 累計缺項統計 + 收前 20 筆樣本。 */
function tallyMissing(
  breakdown: Record<string, number>,
  samples: Array<{ productCode: string; missing: string[] }>,
  productCode: string,
  missing: string[],
): void {
  for (const m of missing) breakdown[m] = (breakdown[m] ?? 0) + 1;
  if (samples.length < 20) samples.push({ productCode, missing });
}

/** 分批(每 500 個 id)跑 IN 查,避免超大 IN list。回所有列攤平。 */
async function bulkByProductIds<T>(
  ids: number[],
  query: (chunk: number[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    if (chunk.length) out.push(...(await query(chunk)));
  }
  return out;
}

async function resolveSupplierId(code: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select({ id: suppliersTable.id })
    .from(suppliersTable)
    .where(eq(suppliersTable.code, code))
    .limit(1);
  if (!row) throw new Error(`Supplier not found: ${code}`);
  return row.id;
}

/** 從 UV tours.sourceUrl 取出 productCode(.../product/detail/P00002255 → P00002255)。 */
export function extractUvProductCode(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;
  const m = sourceUrl.match(/\/detail\/([^/?#]+)/);
  return m ? m[1] : null;
}

/**
 * 載入這家供應商在 tours 表的既有團(by sourceUrl host)→ Map<productCode, {id,status}>。
 *
 * 對映 key 同時收 `tours.productCode` 欄與「從 sourceUrl 解出的 productCode」— 早期匯入
 * 的團可能只有其中一個有值。兩個都索引可最大化對到既有列 → 就地更新(id/URL/FK/SEO 穩),
 * 把「誤判成新團 → 建重複列 → id churn 砸 SEO」的風險壓到最低。
 *
 * UV:productCode = externalProductCode(乾淨)。Lion:三 ID 對不上(GroupCode / tourId /
 * NormGroupID),需先解 NormGroupID 橋接 → 先擋。
 */
async function loadExistingSupplierTours(
  scope: RebuildScope,
): Promise<Map<string, ExistingTour>> {
  if (scope !== "uv") {
    throw new Error(
      `[catalogRebuild] scope='${scope}' 尚未接上 tours 對映(Lion 需先解 NormGroupID 橋接)。目前只支援 'uv'。`,
    );
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({
      id: toursTable.id,
      productCode: toursTable.productCode,
      sourceUrl: toursTable.sourceUrl,
      status: toursTable.status,
    })
    .from(toursTable)
    .where(sql`${toursTable.sourceUrl} LIKE ${"%" + UV_SOURCE_HOST + "%"}`);
  const map = new Map<string, ExistingTour>();
  for (const r of rows) {
    const entry: ExistingTour = { id: r.id, status: r.status };
    const fromUrl = extractUvProductCode(r.sourceUrl);
    for (const key of [r.productCode, fromUrl]) {
      if (key && !map.has(key)) map.set(key, entry);
    }
  }
  return map;
}

/** UV：把鏡像 departures 重建成乾淨的客人班期(pt4→pt1),順帶算起價 + 未來班期數。 */
function buildUvDepartures(
  rawDepartureJsons: Array<string | null>,
  days: number,
  todayMs: number,
): { built: BuiltMirrorDeparture[]; priceRetail: number; futureCount: number } {
  const built: BuiltMirrorDeparture[] = [];
  for (const raw of rawDepartureJsons) {
    const d = buildDepartureFromMirrorRow(raw, days, todayMs);
    if (d) built.push(d);
  }
  return {
    built,
    priceRetail: headlineFromBuiltDepartures(built),
    futureCount: built.length,
  };
}

/** enrich 一批 active 產品的明細(補完整)。並發小批,rate-limit 在 enrich 內。 */
async function enrichAll(
  scope: RebuildScope,
  supplierId: number,
  products: Array<{ id: number; externalProductCode: string }>,
): Promise<void> {
  const CONCURRENCY = 5;
  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const batch = products.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (p) => {
        try {
          const enrichment =
            scope === "uv"
              ? await enrichUvProduct(p.id, p.externalProductCode)
              : null;
          if (enrichment) await upsertProductDetail(p.id, supplierId, enrichment);
        } catch (err) {
          log.warn(
            { productCode: p.externalProductCode, err: (err as Error).message },
            "enrich failed (non-fatal, will gate on completeness)",
          );
        }
      }),
    );
  }
}

/** 刷新一團的客人班期:清掉舊的未來班期 → 寫入重建的。best-effort。 */
async function refreshTourDepartures(
  tourId: number,
  built: BuiltMirrorDeparture[],
): Promise<void> {
  try {
    const existing = await getTourDepartures(tourId);
    const nowMs = Date.now();
    for (const e of existing) {
      const d = e.departureDate ? new Date(e.departureDate as unknown as string) : null;
      if (d && d.getTime() >= nowMs) await deleteDeparture(e.id);
    }
    for (const b of built) {
      await createDeparture({
        tourId,
        departureDate: b.departureDate,
        returnDate: b.returnDate,
        adultPrice: b.adultPrice,
        totalSlots: b.totalSlots,
        bookedSlots: b.bookedSlots,
        status: b.status,
        currency: "USD",
      });
    }
  } catch (err) {
    log.warn(
      { tourId, err: (err as Error).message },
      "refreshTourDepartures failed (non-fatal)",
    );
  }
}

/**
 * 重抓一家供應商,原子換上架批(快照可回滾)。
 *
 * **大寫入** — dryRun=false 會真的換掉客人正在看的目錄。跑前一定先跟 Jeff 確認。
 * 先用 `{ dryRun:true }` 或 `{ limit:N }` 小批驗 staging + promote+rollback,再全量。
 */
export async function rebuildCatalog(
  scope: RebuildScope,
  opts: RebuildOptions = {},
): Promise<RebuildReport> {
  const { limit, dryRun = false, skipSync = false, createdBy = 1 } = opts;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const supplierId = await resolveSupplierId(scope);
  const todayMs = Date.now();

  log.info({ scope, dryRun, limit, skipSync }, "rebuildCatalog start");

  // 1. 刷新鏡像(sync 產品+班期 → enrich 明細)。skipSync 時略過。
  if (!skipSync) {
    if (scope === "uv") await syncUvCatalog();
    else throw new Error(`[catalogRebuild] scope='${scope}' sync 尚未接上`);
  }

  // 2. 載入這家 active 產品(+ limit)。
  let productRows = await db
    .select({
      id: productsTable.id,
      externalProductCode: productsTable.externalProductCode,
      title: productsTable.title,
      days: productsTable.days,
      destinationCountry: productsTable.destinationCountry,
      destinationCity: productsTable.destinationCity,
      departureCity: productsTable.departureCity,
      imageUrl: productsTable.imageUrl,
      currency: productsTable.currency,
    })
    .from(productsTable)
    .where(
      and(
        eq(productsTable.supplierId, supplierId),
        eq(productsTable.status, "active"),
      ),
    );
  if (typeof limit === "number") productRows = productRows.slice(0, limit);

  if (!skipSync) {
    await enrichAll(
      scope,
      supplierId,
      productRows.map((p) => ({ id: p.id, externalProductCode: p.externalProductCode })),
    );
  }

  const existingByCode = await loadExistingSupplierTours(scope);

  // 批次預載班期 + 明細(避免 N+1:~1000 次來回 → 分批 IN 查)。
  const productIds = productRows.map((p) => p.id);
  const depRows = await bulkByProductIds(productIds, (chunk) =>
    db
      .select({
        pid: departuresTable.supplierProductId,
        raw: departuresTable.rawDepartureJson,
      })
      .from(departuresTable)
      .where(inArray(departuresTable.supplierProductId, chunk)),
  );
  const depsByProduct = new Map<number, Array<string | null>>();
  for (const d of depRows) {
    const arr = depsByProduct.get(d.pid);
    if (arr) arr.push(d.raw);
    else depsByProduct.set(d.pid, [d.raw]);
  }
  const detailRows = await bulkByProductIds(productIds, (chunk) =>
    db
      .select({
        pid: detailsTable.supplierProductId,
        itineraryParsed: detailsTable.itineraryParsed,
        priceTermsParsed: detailsTable.priceTermsParsed,
        noticesParsed: detailsTable.noticesParsed,
        optionalParsed: detailsTable.optionalParsed,
        tourInfoParsed: detailsTable.tourInfoParsed,
      })
      .from(detailsTable)
      .where(inArray(detailsTable.supplierProductId, chunk)),
  );
  const detailByProduct = new Map<number, MirrorDetail>();
  for (const d of detailRows) {
    detailByProduct.set(d.pid, {
      itineraryParsed: d.itineraryParsed,
      priceTermsParsed: d.priceTermsParsed,
      noticesParsed: d.noticesParsed,
      optionalParsed: d.optionalParsed,
      tourInfoParsed: d.tourInfoParsed,
    });
  }

  // 3. 逐產品算 staging,分流完整 / 不完整。
  const promotable: PromotableTour[] = [];
  const builtByTourId = new Map<number, BuiltMirrorDeparture[]>();
  const seenCodes = new Set<string>();
  const missingBreakdown: Record<string, number> = {};
  const incompleteSamples: Array<{ productCode: string; missing: string[] }> = [];
  let complete = 0;
  let incomplete = 0;
  let newDrafts = 0;
  let matchedExisting = 0;
  let wouldCreateNew = 0;

  for (const p of productRows) {
    seenCodes.add(p.externalProductCode);

    // 班期 + 起價(UV 從鏡像 rawDepartureJson 乾淨重建)。批次預載,非 per-product 查。
    const { built, priceRetail, futureCount } = buildUvDepartures(
      depsByProduct.get(p.id) ?? [],
      p.days,
      todayMs,
    );

    // 明細(parsed JSON)— 批次預載。
    const detailRow = detailByProduct.get(p.id) ?? null;

    const product: MirrorProduct = {
      externalProductCode: p.externalProductCode,
      title: p.title,
      days: p.days,
      destinationCountry: p.destinationCountry,
      destinationCity: p.destinationCity,
      departureCity: p.departureCity,
      imageUrl: p.imageUrl,
      currency: p.currency,
    };
    const detail: MirrorDetail | null = detailRow ?? null;

    const staged = buildStagedTour(product, detail, {
      priceRetail,
      currency: p.currency || "USD",
      futureDepartureCount: futureCount,
    });

    if (!staged.assessment.ok) {
      incomplete++;
      tallyMissing(missingBreakdown, incompleteSamples, p.externalProductCode, staged.assessment.missing);
      continue;
    }
    complete++;

    // 對映既有 tour;沒有就建 draft(dryRun 不建)。
    let tourId = existingByCode.get(p.externalProductCode)?.id ?? null;
    if (tourId != null) {
      matchedExisting++;
    } else {
      wouldCreateNew++;
      if (dryRun) continue; // 預覽不建新列、不算進 promotable
      const draft = await createTour({
        title: product.title.slice(0, 200),
        description: "",
        productCode: p.externalProductCode.slice(0, 100),
        departureCountry: "美國",
        departureCity: product.departureCity || "Los Angeles",
        destinationCountry: product.destinationCountry || "",
        destinationCity: product.destinationCity || product.destinationCountry || "",
        duration: product.days,
        nights: Math.max(0, product.days - 1),
        price: priceRetail,
        priceCurrency: product.currency || "USD",
        heroImage: product.imageUrl,
        imageUrl: product.imageUrl,
        status: "draft",
        sourceUrl: `https://${UV_SOURCE_HOST}/en/product/detail/${p.externalProductCode}`,
        createdBy,
      } as any);
      tourId = draft.id;
      newDrafts++;
    }

    promotable.push({ tourId, productCode: p.externalProductCode, fields: staged.fields });
    builtByTourId.set(tourId, built);
  }

  const retiredTourIds = computeRetiredTourIds(existingByCode, seenCodes);

  const report: RebuildReport = {
    scope,
    batchId: null,
    dryRun,
    productsScanned: productRows.length,
    complete,
    incomplete,
    promoted: 0,
    retired: 0,
    newDrafts,
    matchedExisting,
    wouldCreateNew,
    missingBreakdown,
    incompleteSamples,
  };

  if (dryRun) {
    log.info({ ...report }, "rebuildCatalog dry-run done (no writes)");
    return report;
  }

  // 4. 開 batch、原子 promote(快照可回滾)。
  const replacedBatchId = await findCurrentLiveBatchId(scope);
  const [ins] = await db
    .insert(batchesTable)
    .values({
      scope,
      status: "staging",
      toursTotal: productRows.length,
      toursComplete: complete,
      toursIncomplete: incomplete,
    });
  const batchId = Number((ins as any).insertId);
  report.batchId = batchId;

  const promoteResult = await db.transaction(async (tx) =>
    promoteBatch(tx, { batchId, promotable, retiredTourIds, replacedBatchId }),
  );
  report.promoted = promoteResult.promoted;
  report.retired = promoteResult.retired;

  // 5. 刷新已上架團的客人班期(原子換內容之外,best-effort)。
  for (const p of promotable) {
    await refreshTourDepartures(p.tourId, builtByTourId.get(p.tourId) ?? []);
  }

  // batch 缺項彙整存 notes,給人看。
  await db
    .update(batchesTable)
    .set({ notes: JSON.stringify({ missingBreakdown, newDrafts }) })
    .where(eq(batchesTable.id, batchId));

  log.info({ ...report }, "rebuildCatalog done");
  return report;
}

/** 同 scope 目前的 live 批(promote 要把它 archive、回滾要翻回它)。 */
async function findCurrentLiveBatchId(scope: RebuildScope): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: batchesTable.id })
    .from(batchesTable)
    .where(and(eq(batchesTable.scope, scope), eq(batchesTable.status, "live")))
    .orderBy(sql`${batchesTable.createdAt} DESC`)
    .limit(1);
  return row?.id ?? null;
}

export { revertBatch } from "./promote";
