/**
 * stripePayoutDeclassifyBackfill — F1 對帳引擎 塊C 雙計防護存量回填 (2026-07-08).
 *
 * preClassify() 的 stripe_payout 規則(accountingKnowledge.ts)只保護「以後
 * 進來的」新交易。歷史積壓的 Stripe 撥款早在這條規則存在前就被 agent/Jeff
 * 分類成 income_booking 了 —— 這些舊資料仍在雙計。這支先探針(dry_run,只算
 * 不寫)回報現存有多少筆疑似雙計,confirm 才真的改標(dispatch-f1.md 塊C
 * 「先探針後動手」)。
 *
 * 判定範圍:effective category(jeffOverrideCategory 優先,否則 agentCategory)
 * = income_booking,且入帳(amount<0),且未被 Jeff 排除(excludeFromAccounting
 * != 1 —— 已排除的不影響 P&L,不算雙計風險),且 descriptor 符合
 * isStripePayoutInflow(與塊A/preClassify 同一來源,不重造規則;haystack 組法
 * 比照 accountingAgentService.ts 的 candidateCounterparty 邏輯,把
 * paymentMeta.payee/payer 併進去,不只 merchantName/description/
 * originalDescription 三欄 —— 2026-07-08 對抗審查 3/3 路一致抓到:漏了
 * paymentMeta 會讓 dry_run 數字系統性低估)。
 *
 * **人工覆寫保護(2026-07-08 對抗審查 P1 修復)**:掃描範圍分兩桶——
 * `autoEligible`(agentCategory=income_booking 且 Jeff 從未動過 override)
 * 與 `humanOverridden`(jeffOverrideCategory 已被 Jeff 手動設成
 * income_booking)。confirm **只改標 autoEligible 桶**,絕不覆寫人工決定;
 * humanOverridden 桶只回報數字給 Jeff 看,若 Jeff 確認那些真的是誤判,
 * 由 Jeff 自己在 UI 上改(既有 transactionUpdate mutation),不由這支腳本
 * 代勞。
 *
 * 改標寫法比照既有 bulkCategorize(plaidRouter.ts)慣例:只寫
 * jeffOverrideCategory + jeffOverrideReason(agentCategory 保留原始 AI 判斷
 * 當歷史紀錄,不覆寫)。jeffOverrideReason 就是這裡的留痕(iron rule 5 audit
 * trail)—— 不呼叫 _core/auditLog.ts 的 audit(),因為那支函式硬性要求
 * ctx.user(admin 已登入),LOCAL_SCRIPT_TOKEN 腳本沒有這個 context,呼叫了
 * 只會靜默 no-op(見 audit() 內 `if (!ctx.user) { log.warn(...); return; }`)。
 * 比照塊A backfill 的既有precedent:結構化 logger.info,不進 adminAuditLog 表。
 *
 * **操作面已知限制(2026-07-08 對抗審查發現,無法用程式碼修完)**:塊A 的
 * `bankTransactionLinkBackfill`(寫 `bankTransactionLinks` 表)跟這支(寫
 * `bankTransactions.jeffOverrideCategory`)是兩支獨立回填端點。`bankPLService`
 * (真正決定 P&L/報稅數字的地方)只讀後者,不讀前者——只跑塊A 的 confirm
 * 不會修正雙計,兩支都要各自 confirm 過才算真的解決(T6 會明確提醒)。
 */

import { getDb } from "../db";
import { bankTransactions } from "../../drizzle/schema";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { isStripePayoutInflow, norm } from "../agents/autonomous/accountingKnowledge";
import { createChildLogger } from "../_core/logger";

const log = createChildLogger({ module: "stripePayoutDeclassifyBackfill" });

/** 一次掃描最多處理幾筆,避免單一 LOCAL_SCRIPT_TOKEN 請求無界跑到逾時。 */
const SCAN_MAX_TXNS = 5000;
/** HTTP 回應內完整列出的樣本上限;數字本身(totalMisclassified)不受此限。 */
const SAMPLE_ITEMS_CAP = 200;

const OVERRIDE_REASON =
  "F1 塊C 存量回填(2026-07-08)— Stripe 撥款落地誤判 income_booking,雙計防護改標 stripe_payout";

export interface MisclassifiedStripePayoutRow {
  bankTransactionId: number;
  date: string;
  amount: number;
  merchantName: string | null;
  description: string | null;
  /** true = Jeff 已手動 override 成 income_booking——confirm 不會動這筆。 */
  isHumanOverridden: boolean;
}

export interface StripePayoutDeclassifyReport {
  /** 全部疑似雙計候選(兩桶合計)。 */
  totalMisclassified: number;
  totalAmount: number;
  /** AI 判斷、Jeff 從未動過 override 的子集——confirm 會改標這些。 */
  autoEligibleCount: number;
  autoEligibleAmount: number;
  /** Jeff 已手動 override 成 income_booking 的子集——confirm 絕不覆寫,
   *  只回報數字讓 Jeff 自己決定要不要在 UI 上改。 */
  humanOverriddenCount: number;
  humanOverriddenAmount: number;
  items: MisclassifiedStripePayoutRow[];
  /** true 代表 items 被截斷(totalMisclassified > items.length),數字仍是完整的。 */
  truncated: boolean;
}

/** 純函式(可單測,無 DB)。把逐筆候選摺成一份彙總報表,分桶但保留合計。 */
export function buildStripePayoutDeclassifyReport(
  rows: MisclassifiedStripePayoutRow[],
): StripePayoutDeclassifyReport {
  let autoEligibleCount = 0;
  let autoEligibleAmount = 0;
  let humanOverriddenCount = 0;
  let humanOverriddenAmount = 0;
  let totalAmount = 0;

  for (const r of rows) {
    totalAmount += r.amount;
    if (r.isHumanOverridden) {
      humanOverriddenCount++;
      humanOverriddenAmount += r.amount;
    } else {
      autoEligibleCount++;
      autoEligibleAmount += r.amount;
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    totalMisclassified: rows.length,
    totalAmount: round2(totalAmount),
    autoEligibleCount,
    autoEligibleAmount: round2(autoEligibleAmount),
    humanOverriddenCount,
    humanOverriddenAmount: round2(humanOverriddenAmount),
    items: rows.slice(0, SAMPLE_ITEMS_CAP),
    truncated: rows.length > SAMPLE_ITEMS_CAP,
  };
}

/**
 * 掃描 effective category = income_booking 的入帳,在 JS 層用
 * isStripePayoutInflow 篩出疑似 Stripe 撥款(SQL 只做得到 category/amount/
 * exclude 篩選,descriptor 單字邊界比對留給既有的 hasWord 實作,不重造)。
 * haystack 比照 accountingAgentService.ts 的組法併入 paymentMeta.payee/payer。
 */
async function scanMisclassified(limit?: number): Promise<MisclassifiedStripePayoutRow[]> {
  const db = await getDb();
  if (!db) return [];

  const effectiveCategoryIsIncomeBooking = sql`
    CASE
      WHEN ${bankTransactions.jeffOverrideCategory} IS NOT NULL
        AND ${bankTransactions.jeffOverrideCategory} != ''
      THEN ${bankTransactions.jeffOverrideCategory}
      ELSE ${bankTransactions.agentCategory}
    END = 'income_booking'
  `;

  const candidates = await db
    .select({
      id: bankTransactions.id,
      date: bankTransactions.date,
      amount: bankTransactions.amount,
      merchantName: bankTransactions.merchantName,
      description: bankTransactions.description,
      originalDescription: bankTransactions.originalDescription,
      paymentMeta: bankTransactions.paymentMeta,
      jeffOverrideCategory: bankTransactions.jeffOverrideCategory,
    })
    .from(bankTransactions)
    .where(
      and(
        sql`${bankTransactions.amount} < 0`,
        eq(bankTransactions.excludeFromAccounting, 0),
        effectiveCategoryIsIncomeBooking,
      ),
    )
    .orderBy(desc(bankTransactions.date))
    .limit(limit ?? SCAN_MAX_TXNS);

  const out: MisclassifiedStripePayoutRow[] = [];
  for (const c of candidates) {
    const pm = c.paymentMeta as { payee?: string | null; payer?: string | null } | null | undefined;
    const counterparty = (pm?.payee || pm?.payer || "").toString().trim() || null;
    const haystack = [c.merchantName, c.description, c.originalDescription, counterparty]
      .map(norm)
      .filter(Boolean)
      .join(" | ");
    if (!isStripePayoutInflow(haystack)) continue;
    const isHumanOverridden = !!c.jeffOverrideCategory && c.jeffOverrideCategory !== "";
    out.push({
      bankTransactionId: c.id,
      date: String(c.date),
      amount: Number(c.amount),
      merchantName: c.merchantName,
      description: c.description,
      isHumanOverridden,
    });
  }
  return out;
}

/** dry_run:只算不寫。confirm 前先看這份數字進 T6。 */
export async function runStripePayoutProbeDryRun(opts?: {
  limit?: number;
}): Promise<StripePayoutDeclassifyReport> {
  const rows = await scanMisclassified(opts?.limit);
  return buildStripePayoutDeclassifyReport(rows);
}

/**
 * confirm:把 autoEligible 桶(AI 判斷、Jeff 從未 override 過)的
 * jeffOverrideCategory 改標成 stripe_payout。humanOverridden 桶(Jeff 自己
 * override 成 income_booking 的)絕不覆寫——只在報表裡讓 Jeff 看到數字。
 */
export async function runStripePayoutProbeConfirm(opts?: {
  limit?: number;
}): Promise<StripePayoutDeclassifyReport & { updatedCount: number }> {
  const rows = await scanMisclassified(opts?.limit);
  const report = buildStripePayoutDeclassifyReport(rows);

  const autoEligibleIds = rows.filter((r) => !r.isHumanOverridden).map((r) => r.bankTransactionId);
  if (autoEligibleIds.length === 0) {
    return { ...report, updatedCount: 0 };
  }

  const db = await getDb();
  if (!db) return { ...report, updatedCount: 0 };

  await db
    .update(bankTransactions)
    .set({
      jeffOverrideCategory: "stripe_payout",
      jeffOverrideReason: OVERRIDE_REASON,
      updatedAt: new Date(),
    })
    .where(inArray(bankTransactions.id, autoEligibleIds));

  log.info(
    {
      updatedCount: autoEligibleIds.length,
      skippedHumanOverridden: report.humanOverriddenCount,
      totalAmount: report.autoEligibleAmount,
    },
    "[stripePayoutDeclassifyBackfill] confirm — relabeled misclassified Stripe payouts to stripe_payout (human overrides untouched)",
  );

  return { ...report, updatedCount: autoEligibleIds.length };
}
