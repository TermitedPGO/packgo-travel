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
 * 列表「最後往來」口徑 (customer-cockpit Phase6 A2)。
 *
 * 之前的 bug:客人列表(registered)拿 users.lastSignedIn(最後登入,不是最後
 * 聯絡)當日期欄,一位客人若只登入過一次、之後全靠 email/inquiry 往來,列表
 * 就永遠停在當初登入那天(0909 案例:顯示 5/13,實際今天還有往來)。
 *
 * 正解 = 這個 profile 的 inbound 與 outbound 兩根指針取較新者:
 *   - lastInboundAt:customerUnread 既有指針(inbound customerInteraction)。
 *   - lastOutboundAt:呼叫端從 customerInteractions 查 direction='outbound'
 *     的 MAX(createdAt)(escalationBox 回信、inquiry 回覆等)。
 * 兩者都空(從沒往來過,只註冊)→ fallback(一律 createdAt/registeredAt,
 * 絕不用 updatedAt — updatedAt 被夜間摘要 cron 的 UPDATE 蓋成當晚時間,拿它
 * 當「最後往來」= 歸檔時間冒充事件時間),讓剛註冊、還沒任何互動的客人至少
 * 有個日期可顯示,不是空白。
 *
 * 純函式、與 isUnreadInbound 同款(取兩指針中較新者,不猜、不查 DB)。
 *
 * 型別韌性 (v787 P0 回爐):lastOutboundAt 由呼叫端的 raw `sql<Date>` correlated
 * subquery 餵進來 — drizzle 只解碼「已知欄位」,raw sql fragment 不解碼,所以
 * mysql2/TiDB 把 DATETIME 原封不動當「字串」丟回來。舊版直接 `.getTime()`,遇到
 * 字串就 throw,把整個 customerList 的 rows.map() 打死 → 註冊會員全消失。
 * 因此這裡把每個 candidate 一律 coerce 成 Date、parse 不出來就丟掉:一根壞掉的
 * 日期指針永遠不准弄空整張列表。已是 Date 的照原樣回傳(保持參考相等)。
 */
type ContactInput = Date | string | number | null | undefined;

function toValidDate(v: ContactInput): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    const dt = new Date(v);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  let s = String(v).trim();
  if (!s) return null;
  // mysql2/TiDB 把 DATETIME 當 naive「YYYY-MM-DD HH:MM:SS」字串丟回(無時區)。
  // drizzle 的 timestamp decoder 對這種字串是 `new Date(value + "+0000")` = 視為
  // UTC。這裡的 raw-sql 值(lastOutboundAt)必須用同一個基準,否則同一筆記錄裡
  // decoded 欄位(UTC)與 raw 值(誤當本機)會差一個 server offset,GREATEST 挑錯、
  // 顯示錯一天。有 'T'/'Z'/明確 offset 的 ISO 字串則照原樣 parse。
  const naiveDatetime =
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s) &&
    !/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  if (naiveDatetime) s = s.replace(" ", "T") + "Z";
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function computeLastContactAt(
  lastInboundAt: ContactInput,
  lastOutboundAt: ContactInput,
  fallback: ContactInput = null,
): Date | null {
  const candidates = [toValidDate(lastInboundAt), toValidDate(lastOutboundAt)].filter(
    (d): d is Date => d != null,
  );
  if (candidates.length === 0) return toValidDate(fallback);
  return candidates.reduce((latest, d) =>
    d.getTime() > latest.getTime() ? d : latest,
  );
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
