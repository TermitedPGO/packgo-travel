/**
 * trustTransferDetection — F2 塊B(2026-07-10):Trust→Operating 轉帳偵測與
 * 遞延列轉出回填。
 *
 * CST §17550 生命週期的最後一段:收訂金(Trust)→ 出發認列(recognizedAt)→
 * Jeff 手動把錢轉到 Operating。前兩段有欄位,第三段(錢真的離開 Trust)過去
 * 無欄可記。本服務在 Plaid bankTransactions 找「Trust 流出 + Operating 流入」
 * 同額近日配對,對上已認列的遞延列後回填 transferredAt / transferBankTransactionId
 * (migration 0114)。
 *
 * 鐵律(紅綠測試釘死):
 *   - 認列後才可轉出 —— 只有 recognizedAt 非空、未 reversed、未 transferred 的
 *     列有資格被回填(isTransferBackfillEligible),且轉帳日不得早於認列曆日。
 *   - 偵測是搬運不是決定:只做「金額到分毫全等 + 單一無歧義候選」的保守配對,
 *     任何歧義(同額多候選)一律跳過留給人;回填動作走 systemAudit 留系統稽核軌。
 *   - 金額符號地雷(T2):Plaid 慣例 正=流出、負=流入(schema.ts bankTransactions
 *     欄位註解),Trust 流出 = trust 帳戶上 amount > 0,Operating 流入 = 非 trust
 *     帳戶上 amount < 0。
 *
 * 提醒卡(認了沒轉錢):認列超過 N 天(TRUST_TRANSFER_REMINDER_DAYS,預設 7)
 * 仍未轉出 → 聚合一張 agentMessages 卡。噪音閘(T2 地雷 #5):絕不逐筆出卡;
 * 同一批未轉列(簽名相同)持續期間去重,只有集合變化才再出卡。歷史上實際已轉
 * 但無資料可配的舊列會進第一張卡(文案已註明人工核對路徑),之後被簽名去重壓住。
 *
 * Stripe-direct 哨兵列(linkedAccountId=0,deferStripeBookingIncome)天然不參與
 * 配對(帳戶集合對不上真 trust 帳戶 id),flag 開啟後那批錢的轉出對映屬塊C/D
 * 的處理商撥款範疇。
 *
 * LLM usage: ZERO。純 SQL select + 確定性配對 + 回填 UPDATE。
 */

import { getDb } from "../db";
import {
  trustDeferredIncome,
  linkedBankAccounts,
  bankTransactions,
  agentMessages,
} from "../../drizzle/schema";
import { and, eq, gte, isNull, isNotNull } from "drizzle-orm";
import { createChildLogger } from "../_core/logger";
import { systemAudit } from "../_core/auditLog";
import { dateOnly } from "./trustOutstandingSplit";

const log = createChildLogger({ module: "trustTransferDetection" });

// ─── env 旋鈕(呼叫時讀,測試可覆寫)─────────────────────────────────────────

/** 流出/流入配對允許的曆日差(天)。轉帳通常同日或隔日入帳。 */
export function transferDateWindowDays(): number {
  const n = Number(process.env.TRUST_TRANSFER_DATE_WINDOW_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

/** 掃描 bankTransactions 回看幾天(涵蓋「認列很久才轉」的遲到轉帳)。 */
export function transferScanDays(): number {
  const n = Number(process.env.TRUST_TRANSFER_SCAN_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

/** 認列後超過幾天沒轉錢出提醒卡(指揮令 N=7 起,env 可調)。 */
export function transferReminderDays(): number {
  const n = Number(process.env.TRUST_TRANSFER_REMINDER_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

// ─── 純函式:配對 ────────────────────────────────────────────────────────────

export interface TransferTxnLike {
  id: number;
  linkedAccountId: number;
  /** Plaid 符號:正=流出,負=流入。 */
  amount: number;
  /** 'YYYY-MM-DD' 曆日。 */
  date: string;
}

export interface TransferPair {
  /** Trust 側流出那筆 bankTransactions.id(回填 transferBankTransactionId 用)。 */
  trustOutflowId: number;
  operatingInflowId: number;
  trustAccountId: number;
  /** 金額(分,絕對值)。 */
  amountCents: number;
  /** Trust 流出的曆日(回填 transferredAt 用)。 */
  date: string;
}

export function toCents(amount: string | number): number {
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function dayDiff(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.abs(ta - tb) / 86_400_000;
}

/**
 * 「Trust 流出 + Operating 流入」同額近日配對。保守規則:
 *   - 每筆 Trust 流出,在日窗內找金額(分)全等的 Operating 流入;
 *   - 恰好一個候選 → 配對;零個或多個(歧義)→ 跳過;
 *   - 每筆流入最多被用一次(先到先得,輸入先按 日期,id 排序保證確定性)。
 */
export function pairTransfers(
  txns: TransferTxnLike[],
  trustAccountIds: ReadonlySet<number>,
  opts?: { dateWindowDays?: number },
): TransferPair[] {
  const windowDays = opts?.dateWindowDays ?? transferDateWindowDays();
  const byDateId = (a: TransferTxnLike, b: TransferTxnLike) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id;

  const trustOutflows = txns
    .filter((t) => trustAccountIds.has(t.linkedAccountId) && t.amount > 0)
    .sort(byDateId);
  const operatingInflows = txns
    .filter((t) => !trustAccountIds.has(t.linkedAccountId) && t.amount < 0)
    .sort(byDateId);

  const usedInflows = new Set<number>();
  const pairs: TransferPair[] = [];

  for (const out of trustOutflows) {
    const cents = toCents(out.amount);
    if (cents <= 0) continue;
    const candidates = operatingInflows.filter(
      (inn) =>
        !usedInflows.has(inn.id) &&
        toCents(-inn.amount) === cents &&
        dayDiff(out.date, inn.date) <= windowDays,
    );
    if (candidates.length !== 1) continue; // 零候選或歧義 → 保守跳過
    usedInflows.add(candidates[0].id);
    pairs.push({
      trustOutflowId: out.id,
      operatingInflowId: candidates[0].id,
      trustAccountId: out.linkedAccountId,
      amountCents: cents,
      date: out.date,
    });
  }
  return pairs;
}

// ─── 純函式:配對 → 遞延列回填 ──────────────────────────────────────────────

export interface DeferralRowLike {
  id: number;
  linkedAccountId: number;
  amount: string | number;
  recognizedAt: Date | string | null;
  reversedAt: Date | string | null;
  transferredAt: Date | string | null;
  recognitionRunId: string | null;
}

/**
 * §17550 第三條紅綠:認列後才可轉出。只有「已認列、未撤銷、未轉出」的列
 * 有資格被回填 —— 未認列的列就算金額對上也絕不標 transferred。
 */
export function isTransferBackfillEligible(row: {
  recognizedAt: Date | string | null;
  reversedAt: Date | string | null;
  transferredAt: Date | string | null;
}): boolean {
  return row.recognizedAt != null && row.reversedAt == null && row.transferredAt == null;
}

export interface TransferBackfill {
  deferredId: number;
  transferBankTransactionId: number;
  /** 'YYYY-MM-DD',Trust 流出曆日。 */
  transferDate: string;
  amountCents: number;
  rule: "single" | "run_group";
}

/**
 * 把配對到的轉帳對回遞延列。兩條規則,都要求「轉帳曆日 >= 認列曆日」
 * (認列後才可轉出)且帳戶一致:
 *   1. single:恰好一列 eligible 且金額(分)全等 → 回填該列。
 *   2. run_group:single 零命中時,恰好一組同 recognitionRunId 的 eligible 列
 *      加總全等 → 整組回填(對應每日認列 cron 後 notifyOwner 叫 Jeff 一次轉
 *      當日總額的實際操作流)。
 * 任何歧義(多列/多組命中)→ 跳過留給人。每列最多被回填一次。
 */
export function matchPairsToDeferrals(
  pairs: TransferPair[],
  rows: DeferralRowLike[],
): TransferBackfill[] {
  const usedRows = new Set<number>();
  const backfills: TransferBackfill[] = [];

  const recognizedDay = (r: DeferralRowLike): string | null =>
    r.recognizedAt ? dateOnly(r.recognizedAt as any) : null;

  for (const pair of pairs) {
    const eligible = rows.filter((r) => {
      if (usedRows.has(r.id)) return false;
      if (!isTransferBackfillEligible(r)) return false;
      if (r.linkedAccountId !== pair.trustAccountId) return false;
      const recDay = recognizedDay(r);
      return recDay !== null && recDay <= pair.date; // 認列後才可轉出
    });

    // 規則 1:單列全等
    const singles = eligible.filter((r) => toCents(r.amount) === pair.amountCents);
    if (singles.length === 1) {
      usedRows.add(singles[0].id);
      backfills.push({
        deferredId: singles[0].id,
        transferBankTransactionId: pair.trustOutflowId,
        transferDate: pair.date,
        amountCents: pair.amountCents,
        rule: "single",
      });
      continue;
    }
    if (singles.length > 1) continue; // 歧義 → 人工

    // 規則 2:同 recognitionRunId 群組加總全等
    const groups = new Map<string, DeferralRowLike[]>();
    for (const r of eligible) {
      if (!r.recognitionRunId) continue;
      const g = groups.get(r.recognitionRunId) ?? [];
      g.push(r);
      groups.set(r.recognitionRunId, g);
    }
    const matchingGroups: DeferralRowLike[][] = [];
    for (const g of groups.values()) {
      const sum = g.reduce((s, r) => s + toCents(r.amount), 0);
      if (sum === pair.amountCents && g.length > 1) matchingGroups.push(g);
    }
    if (matchingGroups.length !== 1) continue; // 零組或多組歧義 → 人工
    for (const r of matchingGroups[0]) {
      usedRows.add(r.id);
      backfills.push({
        deferredId: r.id,
        transferBankTransactionId: pair.trustOutflowId,
        transferDate: pair.date,
        amountCents: toCents(r.amount),
        rule: "run_group",
      });
    }
  }
  return backfills;
}

// ─── IO:偵測 + 回填 + 提醒卡 ───────────────────────────────────────────────

export interface TransferDetectionReport {
  eligibleRows: number;
  scannedTxns: number;
  pairsFound: number;
  backfills: TransferBackfill[];
  /** confirm 模式實際寫入的列數(dry_run 恆 0)。 */
  backfilled: number;
  overdueCount: number;
  overdueTotal: number;
  reminderPosted: boolean;
}

const EMPTY_REPORT: TransferDetectionReport = {
  eligibleRows: 0,
  scannedTxns: 0,
  pairsFound: 0,
  backfills: [],
  backfilled: 0,
  overdueCount: 0,
  overdueTotal: 0,
  reminderPosted: false,
};

/** 提醒卡去重簽名的 Redis key(同一批未轉列持續期間只出一張卡)。 */
export const TRANSFER_REMINDER_SIGNATURE_KEY = "trustTransferOverdueSignature";

/**
 * 主入口。dryRun=true 只算不寫(不回填、不出卡、不動 Redis)——
 * T6 走查「轉帳配對對歷史資料 dry-run」走這裡。
 * 絕不 throw:任何內部錯誤降級為 EMPTY_REPORT + error log(掛在每日 worker 上,
 * 偵測失敗絕不影響認列主流程)。
 */
export async function runTrustTransferDetection(opts?: {
  dryRun?: boolean;
  now?: Date;
}): Promise<TransferDetectionReport> {
  const dryRun = opts?.dryRun ?? false;
  const now = opts?.now ?? new Date();
  try {
    const db = await getDb();
    if (!db) return EMPTY_REPORT;

    // 1. 有資格的遞延列(已認列、未撤銷、未轉出)。空 = 沒事做,便宜早退。
    const eligibleRows = (await db
      .select({
        id: trustDeferredIncome.id,
        linkedAccountId: trustDeferredIncome.linkedAccountId,
        amount: trustDeferredIncome.amount,
        recognizedAt: trustDeferredIncome.recognizedAt,
        reversedAt: trustDeferredIncome.reversedAt,
        transferredAt: trustDeferredIncome.transferredAt,
        recognitionRunId: trustDeferredIncome.recognitionRunId,
      })
      .from(trustDeferredIncome)
      .where(
        and(
          isNotNull(trustDeferredIncome.recognizedAt),
          isNull(trustDeferredIncome.reversedAt),
          isNull(trustDeferredIncome.transferredAt),
        ),
      )) as DeferralRowLike[];
    if (eligibleRows.length === 0) return EMPTY_REPORT;

    // 2. trust 帳戶集合(分類流出/流入用;含 inactive 以涵蓋歷史交易的歸屬)。
    const trustAccounts = await db
      .select({ id: linkedBankAccounts.id })
      .from(linkedBankAccounts)
      .where(eq(linkedBankAccounts.isTrustAccount, 1));
    const trustIds = new Set(trustAccounts.map((r) => r.id));
    if (trustIds.size === 0) return { ...EMPTY_REPORT, eligibleRows: eligibleRows.length };

    // 3. 掃描窗內的 bankTransactions(全帳戶;配對函式自己按 trust/非 trust 分邊)。
    const sinceStr = new Date(now.getTime() - transferScanDays() * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const txnRows = await db
      .select({
        id: bankTransactions.id,
        linkedAccountId: bankTransactions.linkedAccountId,
        amount: bankTransactions.amount,
        date: bankTransactions.date,
      })
      .from(bankTransactions)
      .where(gte(bankTransactions.date, sinceStr as any));
    const txns: TransferTxnLike[] = txnRows.map((t) => ({
      id: t.id,
      linkedAccountId: t.linkedAccountId,
      amount: parseFloat(String(t.amount)) || 0,
      date: dateOnly(t.date as any) ?? "",
    }));

    // 4. 配對 + 對回遞延列(純函式)。
    const pairs = pairTransfers(txns, trustIds);
    const backfills = matchPairsToDeferrals(pairs, eligibleRows);

    // 5. confirm:回填 + systemAudit(每筆;fire-and-forget + .catch 雙保險)。
    let backfilled = 0;
    if (!dryRun) {
      for (const b of backfills) {
        // 曆日粒度:transferredAt 取轉帳曆日的 UTC 午夜;精確時刻不可考
        // (Plaid date 是純日期),真實流水在 transferBankTransactionId 指向的列。
        const transferredAt = new Date(`${b.transferDate}T00:00:00Z`);
        const res: any = await db
          .update(trustDeferredIncome)
          .set({
            transferredAt,
            transferBankTransactionId: b.transferBankTransactionId,
          })
          .where(
            and(
              eq(trustDeferredIncome.id, b.deferredId),
              isNull(trustDeferredIncome.transferredAt), // 冪等:已轉出的列絕不覆寫
            ),
          );
        const affected = Number(res?.[0]?.affectedRows ?? 0);
        if (affected > 0) {
          backfilled++;
          void systemAudit("system:trustTransfer", "trust.transfer_backfill", b.deferredId, {
            amount: (b.amountCents / 100).toFixed(2),
            transferBankTransactionId: b.transferBankTransactionId,
            transferDate: b.transferDate,
            rule: b.rule,
          }).catch(() => {});
        }
      }
    }

    // 6. 認了沒轉錢提醒(認列超過 N 天仍未轉出)。剛(或將,dry_run 口徑一致)
    // 回填的列不算 —— dry_run 報表回答「confirm 之後還剩哪些沒著落」。
    const backfilledIds = new Set(backfills.map((b) => b.deferredId));
    const cutoffMs = now.getTime() - transferReminderDays() * 86_400_000;
    const overdue = eligibleRows.filter((r) => {
      if (backfilledIds.has(r.id)) return false;
      const t = r.recognizedAt ? new Date(r.recognizedAt as any).getTime() : NaN;
      return Number.isFinite(t) && t <= cutoffMs;
    });
    const overdueTotal = overdue.reduce((s, r) => s + toCents(r.amount), 0) / 100;
    let reminderPosted = false;
    if (!dryRun && overdue.length > 0) {
      reminderPosted = await postOverdueReminder(db, overdue, overdueTotal);
    }

    const report: TransferDetectionReport = {
      eligibleRows: eligibleRows.length,
      scannedTxns: txns.length,
      pairsFound: pairs.length,
      backfills,
      backfilled,
      overdueCount: overdue.length,
      overdueTotal,
      reminderPosted,
    };
    log.info(report, "[trustTransferDetection] run complete");
    return report;
  } catch (err) {
    log.error({ err }, "[trustTransferDetection] run failed (degraded to empty report)");
    return EMPTY_REPORT;
  }
}

/**
 * 聚合一張「認了沒轉錢」提醒卡。噪音閘:同一批未轉列(id 集合 + 總額簽名)
 * 持續期間只出一張;集合變化(新列加入/舊列被回填)才再出。
 * Redis 讀失敗 → 照出卡(合規提醒寧可偏吵;週期是每日,最壞情況一天一張)。
 */
async function postOverdueReminder(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  overdue: DeferralRowLike[],
  overdueTotal: number,
): Promise<boolean> {
  const signature = `${overdue
    .map((r) => r.id)
    .sort((a, b) => a - b)
    .join(",")}|${Math.round(overdueTotal * 100)}`;
  try {
    const { redis } = await import("../redis");
    const last = await redis.get(TRANSFER_REMINDER_SIGNATURE_KEY).catch(() => null);
    if (last === signature) return false; // 同一批,已提醒過 → 靜默
    await db.insert(agentMessages).values({
      agentName: "trust-transfer",
      senderRole: "agent" as const,
      messageType: "alert" as const,
      title: `Trust 轉出提醒:${overdue.length} 筆認列超過 ${transferReminderDays()} 天未轉出,共 $${overdueTotal.toFixed(2)}`,
      body:
        `以下遞延列已認列為收入超過 ${transferReminderDays()} 天,但在 bankTransactions 找不到對應的 Trust→Operating 轉帳:\n` +
        overdue
          .slice(0, 20)
          .map(
            (r) =>
              `- 遞延列 #${r.id}:$${(toCents(r.amount) / 100).toFixed(2)},認列於 ${dateOnly(r.recognizedAt as any) ?? "?"}`,
          )
          .join("\n") +
        (overdue.length > 20 ? `\n…及其餘 ${overdue.length - 20} 筆` : "") +
        `\n\n§17550:認列後的錢應從 Trust #5442 轉到 Operating #2174。若實際已轉但日期久遠/金額被合併,` +
        `偵測配對不到,請到財務頁核對後人工處理;若真的沒轉,請盡快轉出。` +
        `\n(同一批未轉列只提醒一次,集合變化才會再出卡。)`,
      priority: "high" as const,
    });
    await redis.set(TRANSFER_REMINDER_SIGNATURE_KEY, signature).catch(() => null);
    return true;
  } catch (err) {
    log.error({ err }, "[trustTransferDetection] reminder card post failed");
    return false;
  }
}
