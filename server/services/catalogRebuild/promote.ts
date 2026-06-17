/**
 * catalogRebuild/promote — 原子換批 + 快照回滾(C+C1,見 chunk-1 §3/§5)。
 *
 * 換批機制 = 就地更新 `tours`(id / URL / FK / SEO 全穩)+ 快照回滾(可退、不空窗)。
 * 重抓先只動供應商鏡像(supplierProducts/Departures/Details),tours 完全不碰;
 * 等 orchestrator 把每團的新值算好、過完整度門檻、過 retail-only guard 後,才呼叫
 * 這支在「單一 transaction」內把上架那批換掉:
 *
 *   promoteBatch(tx, …):
 *     1. 每個要上架的團:先把「舊整列」快照進 toursCatalogArchive(batchId 標記)
 *        → 再就地 update 新值 + status='active' + batchId + lastBatchAt。
 *     2. 這批沒對到、且上一批 active 的團:同樣先快照,再 status='inactive'
 *        (供應商已下架)。快照進去 → 回滾才還得回來。
 *     3. catalogBatches:這批 status='live'、上一 live 批 status='archived'。
 *   一個 txn 內完成,中途失敗整批 rollback,客人永遠看到一致狀態(無空窗)。
 *
 *   revertBatch(tx, batchId):
 *     把該批所有快照寫回 tours(就地)→ 該批翻回 'archived'、它換掉的上一批翻回
 *     'live'。一個指令、可稽核。
 *
 * 紅線:這支只寫 retail 內容,`agentPrice` / 成本永不進 tours。每個 promotable 的
 * `fields` 進來前已過 orchestrator 的 assertRetailOnly,這裡在 DB 邊界再過一次
 * (defense in depth,[[guard]] / [[feedback_no_cost_on_customer_docs]])。
 *
 * 純 DB-邏輯,吃外部注入的 tx(DrizzleTx)→ 用 mock tx 即可單元測 promote / revert
 * 的原子順序與還原正確性,不碰真 DB。
 */

import { eq } from "drizzle-orm";
import {
  tours as toursTable,
  catalogBatches as batchesTable,
  toursCatalogArchive as archiveTable,
} from "../../../drizzle/schema";
import type { DrizzleTx } from "../../db";
import { assertRetailOnly } from "./guard";

/**
 * 一個準備上架的團。`tourId` 一定有值 — orchestrator 對「全新供應商產品」會先
 * 建一筆 draft tours 列拿到 id 再丟進來,所以 promote 一律走「快照舊列 → 就地
 * 更新」的同一條路徑(全新團的舊列 = 剛建的 draft,回滾就把它退回 draft、隱形)。
 */
export interface PromotableTour {
  /** 既有 tours.id(就地更新,id/URL/FK 不變)。 */
  tourId: number;
  /** 供應商產品碼(log / 對照用)。 */
  productCode: string;
  /**
   * 要寫進 tours 的「對客新值」(已 hydrate、已是 retail-only)。
   * 絕不可含 agentPrice / 成本欄 — 進來會再過一次 assertRetailOnly。
   */
  fields: Record<string, unknown>;
}

export interface PromoteBatchInput {
  /** 這次重抓開的 catalogBatches.id(staging 狀態)。 */
  batchId: number;
  /** 通過完整度門檻、要換上 live 的團。 */
  promotable: PromotableTour[];
  /** 這批沒對到、且上一批是 active 的 tour id → 設 inactive(供應商已下架)。 */
  retiredTourIds: number[];
  /** 這批換掉的上一個 live 批(回滾要把它翻回 live)。null = 史上第一批。 */
  replacedBatchId: number | null;
}

export interface PromoteBatchResult {
  batchId: number;
  promoted: number;
  retired: number;
  snapshotted: number;
}

export interface RevertBatchResult {
  batchId: number;
  restored: number;
  restoredLiveBatchId: number | null;
}

/**
 * 回滾時會還原的 tours 欄位 = 重抓 pipeline 唯一會改動的欄位集合。
 *
 * 刻意「只還原這些、不還原整列」:這些全是 string / number / enum(安全),只有
 * `lastBatchAt` 是 timestamp(還原時 coerce 成 Date)。重抓從不碰 startDate /
 * createdAt 等其他 timestamp 欄,所以不還原它們既正確又免去 JSON 字串↔Date 的
 * 時區坑。orchestrator 寫進 tours 的 key 必須 ⊆ 這個集合(有測試把關),否則會
 * 改了卻退不回來。
 */
export const RESTORABLE_TOUR_COLUMNS = [
  "title",
  "description",
  "price",
  "priceCurrency",
  "duration",
  "nights",
  "destinationCountry",
  "destinationCity",
  "departureCity",
  "heroImage",
  "imageUrl",
  "dailyItinerary",
  "itineraryDetailed",
  "hotels",
  "meals",
  "flights",
  "highlights",
  "attractions",
  "optionalTours",
  "costExplanation",
  "noticeDetailed",
  "keyFeatures",
  "specialReminders",
  "extractedDepartures",
  "status",
  "batchId",
  "lastBatchAt",
] as const;

/** 從一份快照(整列 JSON 解出的物件)組出「只含可還原欄」的 update payload。 */
export function buildRestorePayload(
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of RESTORABLE_TOUR_COLUMNS) {
    if (!(col in snapshot)) continue;
    const v = snapshot[col];
    out[col] = col === "lastBatchAt" && v != null ? new Date(v as string) : v;
  }
  return out;
}

/** 讀一筆 tours 整列(快照來源)。找不到回 null。 */
async function readTourRow(
  tx: DrizzleTx,
  tourId: number,
): Promise<Record<string, unknown> | null> {
  const rows = await tx
    .select()
    .from(toursTable)
    .where(eq(toursTable.id, tourId))
    .limit(1);
  return rows[0] ?? null;
}

/** 把一筆 tours 整列快照進 toursCatalogArchive(覆蓋前呼叫)。 */
async function snapshotTour(
  tx: DrizzleTx,
  batchId: number,
  tourId: number,
): Promise<boolean> {
  const row = await readTourRow(tx, tourId);
  if (!row) return false;
  await tx.insert(archiveTable).values({
    batchId,
    tourId,
    snapshotJson: JSON.stringify(row),
  });
  return true;
}

/**
 * 原子換批。在「呼叫端開的單一 transaction」內:快照 → 就地更新 → 退役 → 翻批狀態。
 * 任一步丟錯 → 整個 txn rollback,客人看舊批(無空窗)。
 */
export async function promoteBatch(
  tx: DrizzleTx,
  input: PromoteBatchInput,
  now: Date = new Date(),
): Promise<PromoteBatchResult> {
  const { batchId, promotable, retiredTourIds, replacedBatchId } = input;
  let promoted = 0;
  let retired = 0;
  let snapshotted = 0;

  // 1. 退役供應商已下架的團(先快照、再 inactive)。先做退役:即便某團同時出現在
  //    promotable(不會,但保險)也以 promote 的 active 為準。
  for (const tourId of retiredTourIds) {
    if (await snapshotTour(tx, batchId, tourId)) snapshotted++;
    await tx
      .update(toursTable)
      .set({ status: "inactive" })
      .where(eq(toursTable.id, tourId));
    retired++;
  }

  // 2. 上架通過驗收的團(先快照舊列、再就地寫新值 + active + 批次標記)。
  for (const p of promotable) {
    // DB 邊界最後一道紅線:對客 fields 不得帶任何成本 / agentPrice key。
    assertRetailOnly(p.fields);
    if (await snapshotTour(tx, batchId, p.tourId)) snapshotted++;
    await tx
      .update(toursTable)
      .set({
        ...p.fields,
        status: "active",
        batchId,
        lastBatchAt: now,
      })
      .where(eq(toursTable.id, p.tourId));
    promoted++;
  }

  // 3. 翻批狀態:這批 → live;它換掉的上一批 → archived。
  await tx
    .update(batchesTable)
    .set({
      status: "live",
      replacedBatchId: replacedBatchId ?? null,
      toursPromoted: promoted,
      promotedAt: now,
    })
    .where(eq(batchesTable.id, batchId));

  if (replacedBatchId != null) {
    await tx
      .update(batchesTable)
      .set({ status: "archived", archivedAt: now })
      .where(eq(batchesTable.id, replacedBatchId));
  }

  return { batchId, promoted, retired, snapshotted };
}

/**
 * 回滾一批:把該批所有快照寫回 tours(就地)→ 該批翻 'archived'、它換掉的上一批
 * 翻回 'live'。一個 txn 內完成。
 *
 * 注意:回滾「不」把當前值再快照成新批(刻意從簡 — 供應商鏡像還在,要重來再跑一次
 * rebuildCatalog 即可重建這批的值)。回滾的用途是「這批出事、馬上退回上一批」,不是
 * 反覆 redo。
 */
export async function revertBatch(
  tx: DrizzleTx,
  batchId: number,
  now: Date = new Date(),
): Promise<RevertBatchResult> {
  const snapshots = await tx
    .select()
    .from(archiveTable)
    .where(eq(archiveTable.batchId, batchId));

  let restored = 0;
  for (const snap of snapshots as Array<{ tourId: number; snapshotJson: string }>) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(snap.snapshotJson);
    } catch {
      continue; // 壞快照跳過,不讓整批回滾掛掉
    }
    await tx
      .update(toursTable)
      .set(buildRestorePayload(parsed))
      .where(eq(toursTable.id, snap.tourId));
    restored++;
  }

  // 找出這批換掉的上一批,翻回 live。
  const batchRows = await tx
    .select({ replacedBatchId: batchesTable.replacedBatchId })
    .from(batchesTable)
    .where(eq(batchesTable.id, batchId))
    .limit(1);
  const restoredLiveBatchId =
    (batchRows[0]?.replacedBatchId as number | null | undefined) ?? null;

  await tx
    .update(batchesTable)
    .set({ status: "archived", archivedAt: now })
    .where(eq(batchesTable.id, batchId));

  if (restoredLiveBatchId != null) {
    await tx
      .update(batchesTable)
      .set({ status: "live", archivedAt: null })
      .where(eq(batchesTable.id, restoredLiveBatchId));
  }

  return { batchId, restored, restoredLiveBatchId };
}
