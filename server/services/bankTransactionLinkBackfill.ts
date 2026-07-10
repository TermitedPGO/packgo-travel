/**
 * bankTransactionLinkBackfill — F1 對帳引擎 塊A 存量回填 (2026-07-08).
 *
 * 存量(歷史積壓的入帳)絕不逐筆出卡(dispatch-f1.md 塊A 硬規格)。這支跑
 * 全部還沒有 link 的入帳,dry_run 只算不寫、confirm 真的寫 link,兩者結束後
 * 都回傳同一份彙總報表(buildBackfillReport,純函式,結構上就是「一份」,
 * 呼叫端沒有機會對 pendingItems 逐一建卡)。confirm 額外建「最多一張」聚合卡
 * (dedupe:同一 LA 曆日只建一次)。
 *
 * 端點慣例(LOCAL_SCRIPT_TOKEN,見 server/_core/index.ts 對應路由):dry_run
 * 先看數字,Jeff 覺得可以才 confirm。報表就是 HTTP JSON 回應本身,沿用既有
 * import-case-documents / harvest-case-lessons 端點「回應即報表」慣例,不在
 * 伺服器端另外寫檔案。
 */

import {
  scanUnlinkedInflows,
  processInboundTransaction,
  type AutoLinkRule,
} from "./bankTransactionLinkEngine";
import { createApprovalTask } from "../_core/approvalTasks";
import { systemAudit } from "../_core/auditLog";
import { classifyFinanceAlertRisk } from "../agents/autonomous/financeAlertClassifier";
import { FINANCE_ALERT_TASK_TYPE } from "../agents/autonomous/financeExecutor";
import { hasOpenCardFor, laDay } from "../agents/autonomous/bankTransactionLinkAlerts";
import { createChildLogger } from "../_core/logger";
import { reportFunnelError } from "../_core/errorFunnel";

const log = createChildLogger({ module: "bankTransactionLinkBackfill" });

export const BACKFILL_AGGREGATE_RELATED_TYPE = "bank_txn_backfill_aggregate";

/** 一次回填掃描最多處理幾筆,避免單一 LOCAL_SCRIPT_TOKEN 請求無界跑到逾時。 */
const BACKFILL_MAX_TXNS = 5000;

export interface BackfillItemOutcome {
  bankTransactionId: number;
  amount: number;
  date: string;
  status: "linked" | "pending_claim";
  rule?: AutoLinkRule;
}

export interface BackfillReport {
  totalScanned: number;
  autoLinkedByRule: Record<string, number>;
  autoLinkedTotal: number;
  pendingCount: number;
  pendingTotalAmount: number;
  pendingItems: { bankTransactionId: number; amount: number; date: string }[];
}

/**
 * 純函式(可單測,無 DB)。把逐筆 outcome 摺成一份彙總 —— 這是「存量絕不逐筆
 * 出卡」的結構性保證:回傳型別就是一個物件,不是一組可以逐一拿去建卡的陣列
 * 迴圈起點。
 */
export function buildBackfillReport(outcomes: BackfillItemOutcome[]): BackfillReport {
  const autoLinkedByRule: Record<string, number> = {};
  const pendingItems: BackfillReport["pendingItems"] = [];
  let pendingTotalAmount = 0;
  let autoLinkedTotal = 0;

  for (const o of outcomes) {
    if (o.status === "linked") {
      const rule = o.rule ?? "unknown";
      autoLinkedByRule[rule] = (autoLinkedByRule[rule] ?? 0) + 1;
      autoLinkedTotal++;
    } else {
      pendingItems.push({ bankTransactionId: o.bankTransactionId, amount: o.amount, date: o.date });
      pendingTotalAmount += o.amount;
    }
  }

  return {
    totalScanned: outcomes.length,
    autoLinkedByRule,
    autoLinkedTotal,
    pendingCount: pendingItems.length,
    pendingTotalAmount: Math.round(pendingTotalAmount * 100) / 100,
    pendingItems,
  };
}

async function runScan(dryRun: boolean, limit?: number): Promise<BackfillReport> {
  const unlinked = await scanUnlinkedInflows({ limit: limit ?? BACKFILL_MAX_TXNS });
  const outcomes: BackfillItemOutcome[] = [];

  for (const u of unlinked) {
    // remainingAmount(非原始交易金額)——若這筆入帳已被部分認領,報表要顯示
    // 還沒分配的餘額,不是整筆原始金額(對抗審查 P1 修復同款邏輯)。
    const amount = u.remainingAmount;
    let outcome;
    try {
      outcome = await processInboundTransaction(u.id, { dryRun });
    } catch (err) {
      reportFunnelError({ source: "fail-open:bankTransactionLinkBackfill:process", err, context: { bankTransactionId: u.id, dryRun } }).catch(() => {});
      continue;
    }
    if (outcome.status === "linked") {
      outcomes.push({ bankTransactionId: u.id, amount, date: u.date, status: "linked", rule: outcome.rule });
    } else if (outcome.status === "pending_claim") {
      outcomes.push({ bankTransactionId: u.id, amount, date: u.date, status: "pending_claim" });
    }
    // already_handled / skipped 不該出現(scanUnlinkedInflows 已篩過未連結入帳),
    // 若出現(競態:回填跑到一半人工剛好認領了)就靜默略過,不計入報表。
  }

  return buildBackfillReport(outcomes);
}

/** dry_run:只算不寫。confirm 前先看這份數字。 */
export async function runBackfillDryRun(opts?: { limit?: number }): Promise<BackfillReport> {
  return runScan(true, opts?.limit);
}

/**
 * confirm:真的跑規則寫 link。若還有待認領,額外建「最多一張」聚合卡
 * (dedupe:同一 LA 曆日已有 pending 聚合卡就不重複建)。
 */
export async function runBackfillConfirm(
  opts?: { limit?: number },
): Promise<BackfillReport & { aggregateCardId: number | null }> {
  const report = await runScan(false, opts?.limit);

  let aggregateCardId: number | null = null;
  if (report.pendingCount > 0) {
    const relatedId = `backfill-${laDay(new Date())}`;
    if (!(await hasOpenCardFor(BACKFILL_AGGREGATE_RELATED_TYPE, relatedId))) {
      const { riskLevel } = classifyFinanceAlertRisk();
      try {
        // approvalTasks.payload 是 TEXT(MySQL 上限 64KB)。存量回填可能一次
        // 掃出上千筆 pendingItems,完整報表塞進去有機會超限(對抗審查 note)。
        // 卡片本身只需要摘要數字;完整 pendingItems 清單留給 HTTP 回應本身
        // (dry_run/confirm 的回傳值)——那裡沒有這個大小限制。
        const cardPayload = { ...report, pendingItems: report.pendingItems.slice(0, 50) };
        const { id } = await createApprovalTask({
          lane: "finance",
          taskType: FINANCE_ALERT_TASK_TYPE,
          riskLevel,
          title: `💰 存量回填:${report.pendingCount} 筆待認領,共 $${report.pendingTotalAmount.toFixed(2)}`,
          summary: `存量回填完成:自動 link ${report.autoLinkedTotal} 筆(${Object.entries(report.autoLinkedByRule).map(([r, n]) => `${r}×${n}`).join("、")}),還有 ${report.pendingCount} 筆待認領(共 $${report.pendingTotalAmount.toFixed(2)})。前往財務頁「待認領」批次處理。`,
          payload: JSON.stringify(cardPayload),
          relatedType: BACKFILL_AGGREGATE_RELATED_TYPE,
          relatedId,
          createdBy: "bankTransactionLinkBackfill",
        });
        aggregateCardId = id;
        log.info({ id, pendingCount: report.pendingCount }, "[bankTransactionLinkBackfill] aggregate card created");
      } catch (err) {
        reportFunnelError({ source: "fail-open:bankTransactionLinkBackfill:createAggregateCard", err, context: { pendingCount: report.pendingCount } }).catch(() => {});
      }
    }
  }

  // F2 塊A:LOCAL_SCRIPT_TOKEN confirm 端點的存量寫入(自動 link + 聚合卡)必留
  // 系統稽核軌(無 ctx.user)。fire-and-forget + .catch 雙保險,絕不影響回填主流程。
  void systemAudit(
    "system:bankLinkBackfill",
    "bank.backfill_links_confirm",
    aggregateCardId,
    {
      autoLinkedTotal: report.autoLinkedTotal,
      pendingCount: report.pendingCount,
      pendingTotalAmount: report.pendingTotalAmount,
      totalScanned: report.totalScanned,
    },
  ).catch(() => {});

  return { ...report, aggregateCardId };
}
