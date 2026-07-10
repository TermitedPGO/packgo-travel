/**
 * trustInvariantWatchdog — F2 塊B(2026-07-10):Trust 勾稽不變式看門狗。
 *
 * 不變式(CST §17550 的結構性檢查):
 *   Trust 帳戶餘額 ≈ 遞延帳上「還應該躺在 Trust 裡的錢」
 *                  = 未認列(recognizedAt NULL)
 *                  + 已認列未轉出(recognizedAt 非空 且 transferredAt NULL)
 *   (兩者皆排除 reversedAt 非空;合併條件 = reversedAt IS NULL AND
 *    transferredAt IS NULL,因未認列列的 transferredAt 恆 NULL。)
 *
 * 漂移 = 餘額 − 遞延帳加總。|漂移| > $1 → high 卡(agentMessages)。
 *
 * 掛載點:D1 週稽核(weeklyCorrectnessAudit)—— gather 走 observabilityCounters
 * 同款「絕不 throw」合約,任何讀取失敗降級為 kind:"error" 一行字,絕不拖垮
 * 週稽核本體。
 *
 * 已知事實(2026-07-10,F3 驗收 f3-acceptance-20260710.md):現況 drift 是真實
 * −$10,442(信託現金 $4,980 < 追蹤中訂金 $15,422),F3 駕駛艙 TrustCard 已用
 * 方向感知文案顯示「需查核」。首跑必叫 —— 卡片文案指向該事故紀錄與駕駛艙,
 * 不重複轟炸:同一 drift 值(分毫級)持續期間去重(Redis),值變化才再出卡,
 * 回到容差內清除記憶(再次漂移到同值要重新叫)。
 *
 * 範疇:遞延帳側只計 linkedAccountId ∈ 真實 trust 帳戶的列,與餘額側(同一批
 * 帳戶的 currentBalance)口徑一致 —— 也與 F3 駕駛艙 drift(plaidRouter
 * trustReconciliation)一致,首跑數字對得上 Jeff 已知的 −$10,442。Stripe-direct
 * 哨兵列(linkedAccountId=0)不在等式內,另計 sentinelCount 供行內顯示
 * (flag 開啟後那批錢的歸屬屬塊C/D 撥款對映範疇)。
 *
 * LLM usage: ZERO。
 */

import {
  trustDeferredIncome,
  linkedBankAccounts,
  agentMessages,
} from "../../drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";
import { createChildLogger } from "../_core/logger";

const log = createChildLogger({ module: "trustInvariantWatchdog" });

type Db = NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>;

/** 漂移容差(美元)。指揮令:超過 $1 出 high 卡。 */
export const TRUST_DRIFT_TOLERANCE_USD = 1;

/** 同值去重的 Redis key(存上次出卡的 drift.toFixed(2))。 */
export const TRUST_DRIFT_ALERT_KEY = "trustInvariantLastAlertedDrift";

export interface TrustInvariantReading {
  kind: "ok" | "no-trust-account" | "error";
  /** 所有 active trust 帳戶 currentBalance 加總。 */
  balance: number;
  /** 未認列(recognizedAt NULL,未 reversed)。 */
  unrecognized: number;
  /** 已認列未轉出(recognizedAt 非空,transferredAt NULL,未 reversed)。 */
  recognizedNotTransferred: number;
  /** 遞延帳加總 = unrecognized + recognizedNotTransferred。 */
  ledgerSum: number;
  /** balance − ledgerSum。負 = 信託現金低於追蹤額(錢短少方向)。 */
  drift: number;
  /** Stripe-direct 哨兵列(linkedAccountId=0)仍開放的筆數,僅顯示不入等式。 */
  sentinelCount: number;
}

const ERROR_READING: TrustInvariantReading = {
  kind: "error",
  balance: 0,
  unrecognized: 0,
  recognizedNotTransferred: 0,
  ledgerSum: 0,
  drift: 0,
  sentinelCount: 0,
};

/** 絕不 throw(observabilityCounters 合約)。 */
export async function gatherTrustInvariant(db: Db): Promise<TrustInvariantReading> {
  try {
    const trustAccounts = await db
      .select({ id: linkedBankAccounts.id, currentBalance: linkedBankAccounts.currentBalance })
      .from(linkedBankAccounts)
      .where(and(eq(linkedBankAccounts.isTrustAccount, 1), eq(linkedBankAccounts.isActive, 1)));
    if (trustAccounts.length === 0) {
      return { ...ERROR_READING, kind: "no-trust-account" };
    }
    const balance = trustAccounts.reduce(
      (s, a) => s + (parseFloat(String(a.currentBalance ?? 0)) || 0),
      0,
    );
    const trustIds = trustAccounts.map((a) => a.id);

    // 還應該躺在 Trust 裡的錢:未 reversed 且未 transferred(未認列列的
    // transferredAt 恆 NULL,故此條件同時涵蓋兩段)。
    const rows = await db
      .select({
        amount: trustDeferredIncome.amount,
        recognizedAt: trustDeferredIncome.recognizedAt,
        linkedAccountId: trustDeferredIncome.linkedAccountId,
      })
      .from(trustDeferredIncome)
      .where(
        and(
          isNull(trustDeferredIncome.reversedAt),
          isNull(trustDeferredIncome.transferredAt),
        ),
      );

    let unrecognized = 0;
    let recognizedNotTransferred = 0;
    let sentinelCount = 0;
    const inTrust = new Set(trustIds);
    for (const r of rows) {
      if (!inTrust.has(r.linkedAccountId)) {
        if (r.linkedAccountId === 0) sentinelCount++;
        continue; // 非 trust 帳戶(哨兵或其他)不入等式
      }
      const a = parseFloat(String(r.amount)) || 0;
      if (r.recognizedAt == null) unrecognized += a;
      else recognizedNotTransferred += a;
    }
    const ledgerSum = unrecognized + recognizedNotTransferred;
    return {
      kind: "ok",
      balance,
      unrecognized,
      recognizedNotTransferred,
      ledgerSum,
      drift: balance - ledgerSum,
      sentinelCount,
    };
  } catch (err) {
    log.error({ err }, "[trustInvariantWatchdog] gather failed (degraded to error reading)");
    return ERROR_READING;
  }
}

const fmt = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** D1 週稽核觀測段的一行(observabilityCounters 各 formatXLine 同款形狀)。 */
export function formatTrustInvariantLine(r: TrustInvariantReading): string {
  if (r.kind === "error") return "Trust 勾稽:讀取失敗(本週無法勾稽,不影響其他稽核項)";
  if (r.kind === "no-trust-account") return "Trust 勾稽:無 active trust 帳戶,略過";
  const sentinelNote = r.sentinelCount > 0 ? `;另有 ${r.sentinelCount} 筆 Stripe-direct 哨兵列不入等式` : "";
  const base = `Trust 勾稽:餘額 ${fmt(r.balance)} vs 遞延帳 ${fmt(r.ledgerSum)}(未認列 ${fmt(r.unrecognized)} + 已認列未轉出 ${fmt(r.recognizedNotTransferred)})→ 漂移 ${fmt(r.drift)}${sentinelNote}`;
  return Math.abs(r.drift) > TRUST_DRIFT_TOLERANCE_USD ? `⚠ ${base}(超過 $1 容差,詳見 high 卡與駕駛艙 Trust 卡)` : base;
}

/**
 * |drift| > $1 → 出一張 high 卡。同一 drift 值(分毫級)持續期間去重;
 * 回到容差內清除去重記憶。絕不 throw。
 * 回傳是否真的出了卡(週稽核 log 用)。
 */
export async function maybePostTrustDriftCard(
  db: Db,
  reading: TrustInvariantReading,
): Promise<boolean> {
  try {
    if (reading.kind !== "ok") return false;
    const { redis } = await import("../redis");
    const driftKey = reading.drift.toFixed(2);

    if (Math.abs(reading.drift) <= TRUST_DRIFT_TOLERANCE_USD) {
      // 回到容差內:清記憶,未來再漂移(即使同值)要重新叫。
      await redis.del(TRUST_DRIFT_ALERT_KEY).catch(() => null);
      return false;
    }

    // 同值去重:Jeff 已知的事實不重複轟炸(現況 −$10,442 首跑會出一張,之後
    // 值不變就安靜)。Redis 讀失敗 → 照出卡(週頻,最壞一週一張,合規寧可偏吵)。
    const last = await redis.get(TRUST_DRIFT_ALERT_KEY).catch(() => null);
    if (last === driftKey) return false;

    const direction =
      reading.drift < 0
        ? "信託帳戶現金低於遞延帳追蹤額(錢短少方向:訂金可能從未進 #5442,或曾被提前轉出)"
        : "信託帳戶現金高於遞延帳追蹤額(有存款未入遞延追蹤,孤兒訂金方向)";
    await db.insert(agentMessages).values({
      agentName: "trust-watchdog",
      senderRole: "agent" as const,
      messageType: "alert" as const,
      title: `Trust 勾稽漂移 ${fmt(reading.drift)}(超過 $1 容差)`,
      body:
        `週稽核 Trust 不變式檢查:\n` +
        `- Trust 帳戶餘額:${fmt(reading.balance)}\n` +
        `- 遞延帳應在 Trust 的錢:${fmt(reading.ledgerSum)}(未認列 ${fmt(reading.unrecognized)} + 已認列未轉出 ${fmt(reading.recognizedNotTransferred)})\n` +
        `- 漂移:${fmt(reading.drift)} —— ${direction}\n\n` +
        `這與財務駕駛艙 Trust 卡(客人訂金卡)顯示的 drift 同源(駕駛艙口徑只算未認列段;` +
        `已認列未轉出為 $0 時兩者數字相同),逐團明細與方向說明在駕駛艙上。` +
        `既知案情:2026-07-10 F3 驗收已記錄 −$10,442 真實漂移` +
        `(docs/features/finance-dept/f3-acceptance-20260710.md「Trust drift 真發現」),` +
        `若本卡數字與該案相同,即同一件事的週期性重申,查核進度不變。\n` +
        `(同一漂移值持續期間本卡只出一次,數字變化才會再出。)`,
      priority: "high" as const,
    });
    await redis.set(TRUST_DRIFT_ALERT_KEY, driftKey).catch(() => null);
    return true;
  } catch (err) {
    log.error({ err }, "[trustInvariantWatchdog] drift card post failed (audit continues)");
    return false;
  }
}
