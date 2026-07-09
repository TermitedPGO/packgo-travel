/**
 * bankTransactionLinkAlerts — F1 對帳引擎 塊A「待認領卡」噪音閘 (2026-07-08).
 *
 * 把 bankTransactionLinkEngine 掃出來的「待認領」入帳,轉成 Jeff 指揮中心
 * 財務頁看得到的卡片。重用既有 financeAlertProducer 的「approval task, finance
 * lane, acknowledge-only executor」機制,不新造通知管道。
 *
 * 噪音閘(硬規格,見 dispatch-f1.md 塊A):
 *   - 出卡條件:入帳 且 未 auto-link 且 |金額| >= 門檻(pendingClaimMinUsd())。
 *   - 每日(America/Los_Angeles 曆日)出卡上限 DAILY_PENDING_CLAIM_CARD_CAP(10)。
 *     超過的部分收斂成一張聚合卡,不逐筆出卡。
 *   - 同一筆入帳只出一張卡:呼叫前先查該 bankTransactionId 是否已有
 *     status='pending' 的卡,有就跳過(避免每天重掃同一筆沒人理的入帳就洗版)。
 *   - 存量(歷史積壓)絕不逐筆出卡——那是回填端點(bankTransactionLinkBackfill.ts)
 *     的職責,本模組只服務「日常掃描」這條路徑。
 *
 * 已知限制(誠實列在這裡,T6 §4 也會提):approvalTasks 沒有 update API,
 * 聚合卡採「當天已有 pending 聚合卡就不重複建」策略,不會動態更新卡片內的
 * 數字——若第一張聚合卡建立後又新增溢出項目,今天不會再多開一張,細節數字
 * 以卡片建立當下那次掃描為準。
 */

import { createApprovalTask, type ApprovalAuditCtx } from "../../_core/approvalTasks";
import { classifyFinanceAlertRisk } from "./financeAlertClassifier";
import { FINANCE_ALERT_TASK_TYPE } from "./financeExecutor";
import { getDb } from "../../db";
import { approvalTasks } from "../../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { createChildLogger } from "../../_core/logger";
import { reportFunnelError } from "../../_core/errorFunnel";
import {
  scanUnlinkedInflows,
  processInboundTransaction,
  pendingClaimMinUsd,
} from "../../services/bankTransactionLinkEngine";

const log = createChildLogger({ module: "bankTransactionLinkAlerts" });

export const PENDING_CLAIM_RELATED_TYPE = "bank_txn_pending_claim";
export const PENDING_CLAIM_AGGREGATE_RELATED_TYPE = "bank_txn_pending_claim_aggregate";

/** 每日個別出卡上限。超過收斂成一張聚合卡。 */
export const DAILY_PENDING_CLAIM_CARD_CAP = 10;

/** 單次日常掃描最多處理幾筆(存量回填不走這支,見 bankTransactionLinkBackfill.ts)。 */
const DAILY_SCAN_MAX_TXNS = 50;

/** 落到 America/Los_Angeles 曆日(YYYY-MM-DD)。跟 customOrderWatchdog.laDay 同慣例。 */
export function laDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * 純函式(可單測,無 DB):把「今天還可以出幾張個別卡」的噪音閘決策從
 * scanAndAlertPendingClaims 的 DB 迴圈中抽出來。給定「今天已經出了幾張」+
 * 上限,依序把 items 分成 individual(可以個別出卡)與 overflow(收斂進聚合卡)
 * 兩堆。cardsAlreadyToday >= cap 時,items 全部進 overflow(one-shot 呼叫已經
 * 額滿的情境)。
 */
export function allocateCardSlots<T>(
  items: T[],
  cardsAlreadyToday: number,
  cap: number = DAILY_PENDING_CLAIM_CARD_CAP,
): { individual: T[]; overflow: T[] } {
  const individual: T[] = [];
  const overflow: T[] = [];
  let used = cardsAlreadyToday;
  for (const item of items) {
    if (used < cap) {
      individual.push(item);
      used++;
    } else {
      overflow.push(item);
    }
  }
  return { individual, overflow };
}

/** 今天(LA 曆日)已經開了幾張個別待認領卡(不含聚合卡)。 */
async function countTodaysIndividualCards(todayStr: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  // 抓最近的候選列在應用層依 LA 曆日過濾——避免在 SQL 端算 UTC↔LA 邊界,
  // 跟本檔其餘部分一致優先選最簡單安全的形狀。approvalTasks 量體對一人公司
  // 而言遠小到不用擔心 limit 100 撈不完當天列。
  const rows = await db
    .select({ createdAt: approvalTasks.createdAt })
    .from(approvalTasks)
    .where(eq(approvalTasks.relatedType, PENDING_CLAIM_RELATED_TYPE))
    .orderBy(desc(approvalTasks.id))
    .limit(200);
  return rows.filter((r) => laDay(new Date(r.createdAt)) === todayStr).length;
}

/** exported so bankTransactionLinkBackfill.ts can dedupe its own aggregate card
 *  type without re-implementing the same "already has a pending card" query. */
export async function hasOpenCardFor(relatedType: string, relatedId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db
    .select({ id: approvalTasks.id })
    .from(approvalTasks)
    .where(
      and(
        eq(approvalTasks.relatedType, relatedType),
        eq(approvalTasks.relatedId, relatedId),
        eq(approvalTasks.status, "pending"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export interface PendingClaimScanResult {
  scanned: number;
  linked: number;
  cardsCreated: number;
  aggregatedCount: number;
  aggregatedAmount: number;
}

/**
 * 日常掃描入口(掛在 plaidSyncWorker 同步完成後呼叫)。對每筆還沒有 link 的
 * 入帳先試自動規則(processInboundTransaction),沒中的才考慮出卡,並套用
 * 每日上限 + 聚合閘。
 */
export async function scanAndAlertPendingClaims(
  ctx?: ApprovalAuditCtx,
): Promise<PendingClaimScanResult> {
  const result: PendingClaimScanResult = {
    scanned: 0,
    linked: 0,
    cardsCreated: 0,
    aggregatedCount: 0,
    aggregatedAmount: 0,
  };

  const unlinked = await scanUnlinkedInflows({ limit: DAILY_SCAN_MAX_TXNS });
  if (unlinked.length === 0) return result;

  const todayStr = laDay(new Date());

  // 第一輪:試自動規則,把「真的需要出卡」的候選收集起來(不在這輪決定
  // individual/overflow——分配是一次性的純函式,見 allocateCardSlots)。
  type PendingItem = { id: number; amount: number; date: string; candidateNote: string; candidates: unknown };
  const needsCard: PendingItem[] = [];

  for (const u of unlinked) {
    result.scanned++;
    let outcome;
    try {
      outcome = await processInboundTransaction(u.id);
    } catch (err) {
      reportFunnelError({ source: "fail-open:bankTransactionLinkAlerts:process", err, context: { bankTransactionId: u.id } }).catch(() => {});
      continue;
    }

    if (outcome.status === "linked") {
      result.linked++;
      continue;
    }
    if (outcome.status !== "pending_claim") continue; // already_handled / skipped

    // remainingAmount(非原始交易金額)——部分認領後卡片要顯示還沒分配的餘額。
    const amountAbs = u.remainingAmount;
    if (amountAbs < pendingClaimMinUsd()) continue; // 理論上 engine 已擋,雙重保險

    const relatedId = String(u.id);
    if (await hasOpenCardFor(PENDING_CLAIM_RELATED_TYPE, relatedId)) continue; // 已有卡,不洗版

    needsCard.push({
      id: u.id,
      amount: amountAbs,
      date: u.date,
      candidateNote:
        outcome.candidates.length > 0
          ? `疑似候選訂單:${outcome.candidates.map((c) => c.orderNumber).join("、")}(系統不確定,Jeff 判斷)`
          : "沒有金額吻合的候選訂單",
      candidates: outcome.candidates,
    });
  }

  // 第二輪:純函式一次性分配(今天已有幾張 + 上限),不是逐筆邊算邊決定。
  const cardsAlreadyToday = await countTodaysIndividualCards(todayStr);
  const { individual, overflow: overflowItems } = allocateCardSlots(needsCard, cardsAlreadyToday);

  for (const item of individual) {
    const { riskLevel } = classifyFinanceAlertRisk();
    try {
      const { id } = await createApprovalTask(
        {
          lane: "finance",
          taskType: FINANCE_ALERT_TASK_TYPE,
          riskLevel,
          title: `💰 待認領入帳 $${item.amount.toFixed(2)}(${item.date}）`,
          summary: `bankTransaction #${item.id}:$${item.amount.toFixed(2)},${item.date}。${item.candidateNote}。前往財務頁「待認領」認領。`,
          payload: JSON.stringify({ bankTransactionId: item.id, amount: item.amount, date: item.date, candidates: item.candidates }),
          relatedType: PENDING_CLAIM_RELATED_TYPE,
          relatedId: String(item.id),
          createdBy: "bankTransactionLinkAlerts",
        },
        ctx,
      );
      result.cardsCreated++;
      log.info({ id, bankTransactionId: item.id, amount: item.amount }, "[bankTransactionLinkAlerts] pending-claim card created");
    } catch (err) {
      reportFunnelError({ source: "fail-open:bankTransactionLinkAlerts:createCard", err, context: { bankTransactionId: item.id } }).catch(() => {});
    }
  }

  const overflow = overflowItems.map((o) => ({ id: o.id, amount: o.amount }));
  if (overflow.length > 0) {
    result.aggregatedCount = overflow.length;
    result.aggregatedAmount = overflow.reduce((s, o) => s + o.amount, 0);
    const aggregateRelatedId = todayStr;
    if (!(await hasOpenCardFor(PENDING_CLAIM_AGGREGATE_RELATED_TYPE, aggregateRelatedId))) {
      const { riskLevel } = classifyFinanceAlertRisk();
      try {
        const { id } = await createApprovalTask(
          {
            lane: "finance",
            taskType: FINANCE_ALERT_TASK_TYPE,
            riskLevel,
            title: `💰 待認領入帳(聚合)${overflow.length} 筆,共 $${result.aggregatedAmount.toFixed(2)}`,
            summary: `今日已達每日 ${DAILY_PENDING_CLAIM_CARD_CAP} 張個別卡上限,還有 ${overflow.length} 筆入帳待認領(共 $${result.aggregatedAmount.toFixed(2)}),請到財務頁「待認領」批次處理。`,
            payload: JSON.stringify({ ids: overflow.map((o) => o.id), totalAmount: result.aggregatedAmount, date: todayStr }),
            relatedType: PENDING_CLAIM_AGGREGATE_RELATED_TYPE,
            relatedId: aggregateRelatedId,
            createdBy: "bankTransactionLinkAlerts",
          },
          ctx,
        );
        log.info({ id, count: overflow.length, total: result.aggregatedAmount }, "[bankTransactionLinkAlerts] aggregate card created");
      } catch (err) {
        reportFunnelError({ source: "fail-open:bankTransactionLinkAlerts:createAggregateCard", err, context: { count: overflow.length } }).catch(() => {});
      }
    }
  }

  return result;
}
