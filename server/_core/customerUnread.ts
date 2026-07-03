/**
 * customerUnread — 來訊未讀通知的共用邏輯 (customer-cockpit, 2026-07-01)。
 *
 * Jeff:「每當客人來訊息 我還沒看到明顯得notification」。兩根指針都掛在
 * customerProfiles(migration 0108):
 *
 *   - lastInboundAt: 這個 profile 最近一封 inbound customerInteraction 的時間。
 *     每個 inbound 寫入點(gmailPipeline / threadFiling / agent logInteraction /
 *     demo)插完呼叫 touchLastInbound —— 條件式 UPDATE 只往新更新,舊時間
 *     永不倒退(backfill 舊信、亂序 poll 都安全),且 race-safe(兩條路徑同時
 *     touch,輸家的 UPDATE match 0 rows)。
 *   - jeffViewedAt: Jeff 上次打開這位客人的時間(markCustomerSeen 設 NOW)。
 *
 * unread = lastInboundAt 非空 且 (jeffViewedAt 空 或 lastInboundAt > jeffViewedAt)。
 * 純函式 isUnreadInbound 給 customerList / guestList / customerUnreadCount 共用,
 * 三處口徑永遠一致。
 *
 * touchLastInbound 刻意 best-effort:未讀紅點壞了不准把收信/歸檔主流程拖下水,
 * 失敗只 logger.warn。
 */

import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { getDb } from "../db";
import { customerProfiles } from "../../drizzle/schema";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "customerUnread" });

type DrizzleDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * 未讀判定(純函式,exhaustively unit-tested)。
 * lastInboundAt 非空 且 (jeffViewedAt 空 或 lastInboundAt > jeffViewedAt)。
 */
export function isUnreadInbound(
  lastInboundAt: Date | null | undefined,
  jeffViewedAt: Date | null | undefined,
): boolean {
  if (lastInboundAt == null) return false;
  if (jeffViewedAt == null) return true;
  return lastInboundAt.getTime() > jeffViewedAt.getTime();
}

/**
 * 插入一筆 inbound customerInteraction 後呼叫:把 profile 的 lastInboundAt
 * 推進到 ts。單一條件式 UPDATE,只有 ts 比現值新(或現值 NULL)才寫 —
 * 舊時間永不倒退,重跑/亂序 idempotent。絕不 throw(未讀指針壞了不能
 * 弄死收信主流程),失敗只 warn。
 */
export async function touchLastInbound(
  db: DrizzleDb,
  profileId: number,
  ts: Date = new Date(),
): Promise<void> {
  if (!profileId || profileId <= 0) return;
  if (!(ts instanceof Date) || Number.isNaN(ts.getTime())) return;
  try {
    await db
      .update(customerProfiles)
      .set({ lastInboundAt: ts })
      .where(
        and(
          eq(customerProfiles.id, profileId),
          or(
            isNull(customerProfiles.lastInboundAt),
            lt(customerProfiles.lastInboundAt, ts),
          ),
        ),
      );
  } catch (err) {
    log.warn(
      { err, profileId },
      "[customerUnread] touchLastInbound failed (non-fatal, red dot only)",
    );
  }
}

/**
 * Jeff 打開一位客人 → jeffViewedAt = now,該列未讀熄滅。
 * Guest path: profileId IS the customerProfiles row — 直接 update。
 * Registered path: 仿 markNotCustomer 的 upsert-by-userId(註冊會員可能
 * 還沒有 profile row → 建一列最小 profile 帶 jeffViewedAt)。
 */
export async function markCustomerSeen(
  db: DrizzleDb,
  selection: { userId: number } | { profileId: number },
  now: Date = new Date(),
): Promise<void> {
  if ("profileId" in selection) {
    await db
      .update(customerProfiles)
      .set({ jeffViewedAt: now })
      .where(eq(customerProfiles.id, selection.profileId));
    return;
  }
  const existing = await db
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, selection.userId))
    .limit(1);
  if (existing[0]) {
    await db
      .update(customerProfiles)
      .set({ jeffViewedAt: now })
      .where(eq(customerProfiles.id, existing[0].id));
  } else {
    // insertCustomerProfileSafely (2026-07-03, 任務7 對抗審查 P0) — a
    // concurrent call for the same brand-new userId could otherwise both
    // miss the `existing` SELECT above and both insert. On a recovered race,
    // re-apply jeffViewedAt so this call's intent isn't silently dropped.
    const { insertCustomerProfileSafely } = await import("../db/customerProfile");
    const insertResult = await insertCustomerProfileSafely(
      db,
      { userId: selection.userId, jeffViewedAt: now },
      "userId",
    );
    if (insertResult.recoveredFromRace) {
      await db
        .update(customerProfiles)
        .set({ jeffViewedAt: now })
        .where(eq(customerProfiles.id, insertResult.profileId));
    }
  }
}
