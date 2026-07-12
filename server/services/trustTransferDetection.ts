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
 *   - 偵測是搬運不是決定:自動回填只有規則 1(單列金額到分毫全等 + 單一無歧義
 *     候選)。規則 2(run_group 加總配對)是純金額訊號、無第二佐證,巧合等額的
 *     無關轉帳會被錯誤閉環且從此靜音 —— 2026-07-10 指揮裁決(塊C 回令 #1)降級
 *     為「建議」:不寫 transferredAt,改在提醒卡帶出配對建議(群組明細+候選
 *     流水),Jeff 看卡確認後由走查用 manual_backfill 模式回填
 *     (runManualTransferBackfill,systemAudit 記 trust.transfer_backfill.manual)。
 *     錢寧漏不錯。
 *   - 金額符號地雷(T2):Plaid 慣例 正=流出、負=流入(schema.ts bankTransactions
 *     欄位註解),Trust 流出 = trust 帳戶上 amount > 0,Operating 流入 =
 *     Operating 白名單帳戶上 amount < 0。
 *   - Operating 白名單(塊C 回令 #2):流入候選限定 Operating 帳戶(accountMask
 *     白名單,env TRUST_OPERATING_ACCOUNT_MASKS,預設 "2174" = prod 帳戶 30001),
 *     不再是「任何非 trust 帳戶」—— 縮小巧合等額的誤配面。
 *   - 語境訊號(塊C 回令 #2 後半,本批只收白名單、訊號留待真資料校準):
 *     description/paymentMeta 含轉帳語境字樣(BofA 內轉常見 "Online Banking
 *     transfer" 等)未來可作規則 1 的加分訊號;prod 真轉帳 descriptor 落地後
 *     按真形狀校準,不憑空猜(與 Stripe descriptor 校準同款原則)。
 *
 * 提醒卡(認了沒轉錢):認列超過 N 天(TRUST_TRANSFER_REMINDER_DAYS,預設 7)
 * 仍未轉出 → 聚合一張 agentMessages 卡,run_group 配對建議一併帶在卡上。
 * 噪音閘(T2 地雷 #5):絕不逐筆出卡;同一批未轉列+建議(簽名相同)持續期間
 * 去重,集合或建議變化才再出卡。歷史上實際已轉但無資料可配的舊列會進第一張卡
 * (文案已註明人工核對路徑),之後被簽名去重壓住。
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
import { and, eq, gte, inArray, isNull, isNotNull } from "drizzle-orm";
import { createChildLogger } from "../_core/logger";
import { systemAudit } from "../_core/auditLog";
import { dateOnly } from "./trustOutstandingSplit";
import { isTrustTransferWriteApproved } from "./trustTransferWriteGate";

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

/**
 * Operating 帳戶 accountMask 白名單(塊C 回令 #2)。預設 "2174"(prod 帳戶
 * 30001,PACK&GO LLC operating checking)。逗號分隔可列多帳戶。
 */
export function operatingAccountMasks(): string[] {
  const raw = process.env.TRUST_OPERATING_ACCOUNT_MASKS ?? "2174";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
 *   - 流入候選只認 Operating 白名單帳戶(塊C 回令 #2,不再是任何非 trust 帳戶);
 *   - 每筆 Trust 流出,在日窗內找金額(分)全等的 Operating 流入;
 *   - 恰好一個候選 → 配對;零個或多個(歧義)→ 跳過;
 *   - 每筆流入最多被用一次(先到先得,輸入先按 日期,id 排序保證確定性)。
 */
export function pairTransfers(
  txns: TransferTxnLike[],
  trustAccountIds: ReadonlySet<number>,
  operatingAccountIds: ReadonlySet<number>,
  opts?: { dateWindowDays?: number },
): TransferPair[] {
  const windowDays = opts?.dateWindowDays ?? transferDateWindowDays();
  const byDateId = (a: TransferTxnLike, b: TransferTxnLike) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id;

  const trustOutflows = txns
    .filter((t) => trustAccountIds.has(t.linkedAccountId) && t.amount > 0)
    .sort(byDateId);
  const operatingInflows = txns
    .filter((t) => operatingAccountIds.has(t.linkedAccountId) && t.amount < 0)
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
  rule: "single";
}

/**
 * run_group 配對「建議」(塊C 回令 #1:純金額加總無第二訊號,不自動回填,
 * 提醒卡帶出、Jeff 確認後走 runManualTransferBackfill)。
 */
export interface TransferGroupSuggestion {
  recognitionRunId: string;
  deferredIds: number[];
  rowAmountsCents: number[];
  totalCents: number;
  trustOutflowId: number;
  operatingInflowId: number;
  transferDate: string;
}

export interface MatchResult {
  /** 規則 1(單列全等單一候選)—— 唯一自動回填的路。 */
  backfills: TransferBackfill[];
  /** 規則 2(run_group 加總全等)—— 建議,不自動寫。 */
  suggestions: TransferGroupSuggestion[];
}

/**
 * 把配對到的轉帳對回遞延列。兩條規則,都要求「轉帳曆日 >= 認列曆日」
 * (認列後才可轉出)且帳戶一致:
 *   1. single:恰好一列 eligible 且金額(分)全等 → 自動回填該列。
 *   2. run_group:single 零命中時,恰好一組同 recognitionRunId 的 eligible 列
 *      加總全等 → 產出「建議」(不寫,塊C 回令 #1 裁決:巧合等額會錯誤閉環
 *      且靜音;對應每日認列後一次轉總額的操作流,由 Jeff 看卡確認)。
 * 任何歧義(多列/多組命中)→ 跳過留給人。每列最多出現一次(回填與建議互斥)。
 */
export function matchPairsToDeferrals(
  pairs: TransferPair[],
  rows: DeferralRowLike[],
): MatchResult {
  const usedRows = new Set<number>();
  const backfills: TransferBackfill[] = [];
  const suggestions: TransferGroupSuggestion[] = [];

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

    // 規則 1:單列全等(唯一自動回填)
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

    // 規則 2:同 recognitionRunId 群組加總全等 → 建議(不寫)
    const groups = new Map<string, DeferralRowLike[]>();
    for (const r of eligible) {
      if (!r.recognitionRunId) continue;
      const g = groups.get(r.recognitionRunId) ?? [];
      g.push(r);
      groups.set(r.recognitionRunId, g);
    }
    const matchingGroups: Array<{ runId: string; rows: DeferralRowLike[] }> = [];
    for (const [runId, g] of groups.entries()) {
      const sum = g.reduce((s, r) => s + toCents(r.amount), 0);
      if (sum === pair.amountCents && g.length > 1) matchingGroups.push({ runId, rows: g });
    }
    if (matchingGroups.length !== 1) continue; // 零組或多組歧義 → 人工
    const grp = matchingGroups[0];
    for (const r of grp.rows) usedRows.add(r.id); // 已入建議的列不再被後續 pair 配
    suggestions.push({
      recognitionRunId: grp.runId,
      deferredIds: grp.rows.map((r) => r.id),
      rowAmountsCents: grp.rows.map((r) => toCents(r.amount)),
      totalCents: pair.amountCents,
      trustOutflowId: pair.trustOutflowId,
      operatingInflowId: pair.operatingInflowId,
      transferDate: pair.date,
    });
  }
  return { backfills, suggestions };
}

// ─── IO:偵測 + 回填 + 提醒卡 ───────────────────────────────────────────────

export interface TransferDetectionReport {
  eligibleRows: number;
  scannedTxns: number;
  pairsFound: number;
  backfills: TransferBackfill[];
  /** run_group 配對建議(不自動寫;提醒卡帶出,Jeff 確認後 manual_backfill)。 */
  suggestions: TransferGroupSuggestion[];
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
  suggestions: [],
  backfilled: 0,
  overdueCount: 0,
  overdueTotal: 0,
  reminderPosted: false,
};

/** 提醒卡去重簽名的 Redis key(同一批未轉列+建議持續期間只出一張卡)。 */
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
  // B1.1 機械閘(Codex 6.5 P0.1):矩陣未核准前,無論呼叫端傳 dryRun:false,一律
  // 強制 dry-run —— 不回填 transferredAt、不出催轉卡、不動 Redis。翻閘見
  // trustTransferWriteGate.isTrustTransferWriteApproved(現硬回 false)。
  const dryRun = isTrustTransferWriteApproved() ? (opts?.dryRun ?? false) : true;
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

    // 2. 帳戶集合:trust(含 inactive,涵蓋歷史交易歸屬)+ Operating 白名單
    //    (塊C 回令 #2:mask 白名單,預設 2174;排除 trust 帳戶防設定錯誤)。
    const accounts = await db
      .select({
        id: linkedBankAccounts.id,
        accountMask: linkedBankAccounts.accountMask,
        isTrustAccount: linkedBankAccounts.isTrustAccount,
      })
      .from(linkedBankAccounts);
    const trustIds = new Set(accounts.filter((a) => a.isTrustAccount === 1).map((a) => a.id));
    const masks = new Set(operatingAccountMasks());
    const operatingIds = new Set(
      accounts
        .filter((a) => a.isTrustAccount !== 1 && a.accountMask && masks.has(String(a.accountMask)))
        .map((a) => a.id),
    );
    if (trustIds.size === 0 || operatingIds.size === 0) {
      return { ...EMPTY_REPORT, eligibleRows: eligibleRows.length };
    }

    // 3. 掃描窗內的 bankTransactions(全帳戶;配對函式按 trust/Operating 白名單分邊)。
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

    // 4. 配對 + 對回遞延列(純函式)。規則 1 自動;規則 2 只出建議。
    const pairs = pairTransfers(txns, trustIds, operatingIds);
    const { backfills, suggestions } = matchPairsToDeferrals(pairs, eligibleRows);

    // 5. confirm:回填(僅規則 1)+ systemAudit(每筆;fire-and-forget + .catch 雙保險)。
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
    //    自動回填的列不算;建議中的列「仍算」overdue —— 它們還沒被寫,卡上
    //    同時帶出建議讓 Jeff 一眼看到出路。
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
      reminderPosted = await postOverdueReminder(db, overdue, overdueTotal, suggestions);
    }

    const report: TransferDetectionReport = {
      eligibleRows: eligibleRows.length,
      scannedTxns: txns.length,
      pairsFound: pairs.length,
      backfills,
      suggestions,
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
 * 聚合一張「認了沒轉錢」提醒卡,run_group 建議一併帶出。噪音閘:同一批未轉列
 * +同一批建議(簽名相同)持續期間只出一張;集合或建議變化才再出。
 * Redis 讀失敗 → 照出卡(合規提醒寧可偏吵;週期是每日,最壞情況一天一張)。
 */
async function postOverdueReminder(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  overdue: DeferralRowLike[],
  overdueTotal: number,
  suggestions: TransferGroupSuggestion[],
): Promise<boolean> {
  const suggestionSig = suggestions
    .map((s) => `${s.recognitionRunId}:${s.trustOutflowId}:${s.deferredIds.join("+")}`)
    .sort()
    .join(";");
  const signature = `${overdue
    .map((r) => r.id)
    .sort((a, b) => a - b)
    .join(",")}|${Math.round(overdueTotal * 100)}|${suggestionSig}`;
  try {
    const { redis } = await import("../redis");
    const last = await redis.get(TRANSFER_REMINDER_SIGNATURE_KEY).catch(() => null);
    if (last === signature) return false; // 同一批,已提醒過 → 靜默

    const suggestionSection =
      suggestions.length > 0
        ? `\n\n配對建議(同批認列加總 = 單筆轉帳,需你確認,系統不自動寫):\n` +
          suggestions
            .map(
              (s) =>
                `- 轉帳流水 #${s.trustOutflowId}(${s.transferDate},$${(s.totalCents / 100).toFixed(2)})` +
                ` ↔ 遞延列 ${s.deferredIds.map((id) => `#${id}`).join(" + ")}` +
                `(${s.rowAmountsCents.map((c) => `$${(c / 100).toFixed(2)}`).join(" + ")},認列批 ${s.recognitionRunId})`,
            )
            .join("\n") +
          `\n確認無誤後由走查執行 manual_backfill(POST /api/admin/trust-transfer-detect,` +
          `mode:"manual_backfill" + deferredIds + bankTransactionId)。`
        : "";

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
        suggestionSection +
        `\n\n這是歷史已認列列的轉出「觀察」(僅供對帳),系統不催轉、不自動轉。` +
        `這些 recognizedAt 屬 legacy_unverified —— 可能來自舊出發日規則,未經 CPA 認列矩陣` +
        `與律師提領矩陣覆核前,不作為可提領/可轉出的依據。是否轉出由你在矩陣核准後親自裁定。` +
        `\n(同一批未轉列+建議只提醒一次,集合變化才會再出卡。)`,
      priority: "high" as const,
    });
    await redis.set(TRANSFER_REMINDER_SIGNATURE_KEY, signature).catch(() => null);
    return true;
  } catch (err) {
    log.error({ err }, "[trustTransferDetection] reminder card post failed");
    return false;
  }
}

// ─── 人工回填(塊C 回令 #1:Jeff 確認後的 run_group 建議落地路)──────────────

export interface ManualBackfillResult {
  ok: boolean;
  backfilled: number;
  error?: string;
}

/**
 * Jeff 看卡確認後的人工回填:把明確指定的遞延列組標記為「由指定轉帳流水轉出」。
 * 全部驗證通過才寫(fail-closed,錢的操作不做部分成功):
 *   - 流水存在、屬 trust 帳戶、是流出(amount > 0);
 *   - 每列 eligible(已認列/未撤銷/未轉出)、帳戶與流水一致、認列曆日 <= 轉帳曆日;
 *   - 列金額加總(分)=== 流水金額(分)—— 建議卡上就是這個等式,Jeff 確認的
 *     就是這個等式,不吻合即拒絕。
 * 每列寫入後 systemAudit 記 trust.transfer_backfill.manual(actor 是系統執行,
 * 但 detail 註明 Jeff-confirmed;router/walkthrough 層的人為觸發另有其軌)。
 */
export async function runManualTransferBackfill(input: {
  deferredIds: number[];
  bankTransactionId: number;
}): Promise<ManualBackfillResult> {
  // B1.1 機械閘(Codex 6.5 P0.1):矩陣未核准前,人工回填路徑直接拒絕零寫入。
  // 翻閘見 trustTransferWriteGate.isTrustTransferWriteApproved(現硬回 false)。
  if (!isTrustTransferWriteApproved()) {
    return {
      ok: false,
      backfilled: 0,
      error: "blocked: trust withdrawal/recognition matrices not approved",
    };
  }
  try {
    const db = await getDb();
    if (!db) return { ok: false, backfilled: 0, error: "DB unavailable" };
    if (!input.deferredIds.length) return { ok: false, backfilled: 0, error: "deferredIds empty" };

    const [txn] = await db
      .select({
        id: bankTransactions.id,
        linkedAccountId: bankTransactions.linkedAccountId,
        amount: bankTransactions.amount,
        date: bankTransactions.date,
      })
      .from(bankTransactions)
      .where(eq(bankTransactions.id, input.bankTransactionId))
      .limit(1);
    if (!txn) return { ok: false, backfilled: 0, error: "bankTransaction not found" };
    const txnAmount = parseFloat(String(txn.amount)) || 0;
    if (txnAmount <= 0) {
      return { ok: false, backfilled: 0, error: "bankTransaction is not a trust outflow (amount <= 0)" };
    }
    const [acct] = await db
      .select({ isTrustAccount: linkedBankAccounts.isTrustAccount })
      .from(linkedBankAccounts)
      .where(eq(linkedBankAccounts.id, txn.linkedAccountId))
      .limit(1);
    if (!acct || acct.isTrustAccount !== 1) {
      return { ok: false, backfilled: 0, error: "bankTransaction is not on a trust account" };
    }
    const transferDate = dateOnly(txn.date as any) ?? "";

    const rows = (await db
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
      .where(inArray(trustDeferredIncome.id, input.deferredIds))) as DeferralRowLike[];
    if (rows.length !== input.deferredIds.length) {
      return { ok: false, backfilled: 0, error: "some deferredIds not found" };
    }
    for (const r of rows) {
      if (!isTransferBackfillEligible(r)) {
        return { ok: false, backfilled: 0, error: `deferred #${r.id} not eligible (unrecognized/reversed/already transferred)` };
      }
      if (r.linkedAccountId !== txn.linkedAccountId) {
        return { ok: false, backfilled: 0, error: `deferred #${r.id} is on a different trust account than the transaction` };
      }
      const recDay = r.recognizedAt ? dateOnly(r.recognizedAt as any) : null;
      if (recDay === null || recDay > transferDate) {
        return { ok: false, backfilled: 0, error: `deferred #${r.id} recognized after the transfer date (認列後才可轉出)` };
      }
    }
    const sumCents = rows.reduce((s, r) => s + toCents(r.amount), 0);
    if (sumCents !== toCents(txnAmount)) {
      return {
        ok: false,
        backfilled: 0,
        error: `sum of deferred amounts (${(sumCents / 100).toFixed(2)}) != transaction amount (${txnAmount.toFixed(2)})`,
      };
    }

    // 全數驗證通過 → 寫(冪等守門同自動路)+ 每列 systemAudit。
    const transferredAt = new Date(`${transferDate}T00:00:00Z`);
    let backfilled = 0;
    for (const r of rows) {
      const res: any = await db
        .update(trustDeferredIncome)
        .set({ transferredAt, transferBankTransactionId: txn.id })
        .where(and(eq(trustDeferredIncome.id, r.id), isNull(trustDeferredIncome.transferredAt)));
      const affected = Number(res?.[0]?.affectedRows ?? 0);
      if (affected > 0) {
        backfilled++;
        void systemAudit("system:trustTransfer", "trust.transfer_backfill.manual", r.id, {
          amount: (toCents(r.amount) / 100).toFixed(2),
          transferBankTransactionId: txn.id,
          transferDate,
          rule: "manual",
          groupDeferredIds: input.deferredIds,
          confirmedBy: "jeff-via-walkthrough",
        }).catch(() => {});
      }
    }
    return { ok: true, backfilled };
  } catch (err) {
    log.error({ err }, "[trustTransferDetection] manual backfill failed");
    return { ok: false, backfilled: 0, error: (err as Error).message };
  }
}
