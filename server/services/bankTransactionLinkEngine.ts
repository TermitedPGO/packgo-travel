/**
 * bankTransactionLinkEngine — F1 對帳引擎 塊A (2026-07-08).
 *
 * 每筆入帳(inflow,bankTransactions.amount < 0)要嘛對到一張真實單據
 * (custom_order/invoice/booking),要嘛對到一個內部分類(category:
 * stripe_payout/small_inflow),要嘛出一張「待認領」卡等 Jeff 決定 —— 不存在
 * 第四態(見 docs/features/finance-dept/dispatch-f1.md 塊A 完成判準)。
 *
 * 範圍:本批只做入帳。出帳面沿用既有 accountingKnowledge.preClassify,F3/F4
 * 再管。
 *
 * 設計鐵律(對應藍圖六條):
 *   1. AI 只看只算只建議,永遠不動錢 —— 本檔的「auto」規則寫的是 code 決定性
 *      規則(descriptor/金額吻合),不是 LLM 猜測;claimedBy 恆為 'system'。
 *      真人手動認領(claimedBy='jeff')永遠是另一條路徑(見 tRPC router)。
 *   2. 絕不自動歸信心不足的款:exact_amount 規則遇到多候選(模糊)一律不 auto,
 *      回傳候選清單讓 Jeff 選。
 *   3. 每條 auto 規則的 matchMethod 都寫 'auto:<rule-name>',可解釋可追溯。
 *   4. Plaid 符號頭號地雷:amount 正=支出、負=入帳(schema.ts:3109-3110)。
 *      本檔每一處讀 amount 都先判斷方向再取絕對值,測試釘死方向守門。
 *
 * 4 條自動規則(依優先序,任一命中即停):
 *   trust_sync   — trustDeferredIncome 既有配對成果(processTrustInflow +
 *                  findBookingMatch,trustDeferralService.ts:159-239)同步寫
 *                  link,不重造配對演算法,見 syncTrustLink。只認未撤銷
 *                  (reversedAt IS NULL)的配對。
 *   stripe_payout — Stripe 轉撥 descriptor(accountingKnowledge.isStripePayoutInflow,
 *                  與塊C preClassify 雙計防護同源)→ category link,絕不 income。
 *   order_ref    — 描述/memo 含 ORD-YYYY-NNNN 且金額與該單「還欠哪一段」吻合
 *                  才直接 link;文字對上但金額對不上則降級為候選,不 auto。
 *   exact_amount — 金額吻合單一未收款 customOrder(全額或訂金比例枚舉,沿用
 *                  customOrderWatchdog.matchPaymentsToOrders/resolveUnpaidLeg,
 *                  批8 演算,公司層級判斷唯一/模糊,不因時間窗預篩選而漏判
 *                  模糊)+ 唯一候選且落在時間窗 ±7 天內才 auto;否則出候選卡。
 *
 * 時間窗設計決策(dispatch 未點名比對哪個訂單欄位,執行者決定,見 T6 偏離申報):
 *   用 customOrders.collectionSentAt(催款寄出時間,語意上「預期收到錢」的錨點)
 *   為主,缺值時退回 createdAt。
 *
 * 2026-07-08 對抗審查修復(3 路 fresh,P0/P1 逐條修):
 *   - scanUnlinkedInflows 改成「先撈全部候選 → 差集 → 依新到舊排序取 limit」,
 *     不再「先 LIMIT 再差集」(原寫法會讓已處理的舊資料把新資料擠出候選視窗,
 *     新錢可能永遠掃不到)。
 *   - 差集判斷從「存在任一 link 即排除」改成「SUM(amountAllocated) < |amount|
 *     才算未處理完」——部分認領的餘額不再永久消失。
 *   - createBankTransactionLink 的「SUM+新增<=|amount|」檢查改在 Redis 鎖 +
 *     DB transaction 內完成,不再是無鎖的「先讀後寫」兩步(TOCTOU 競態)。
 *   - 自動 link 到 custom_order 後,若分配金額吻合該單「還欠的那一段」,同步
 *     寫回 depositPaidAt/balancePaidAt(否則同一張單會被不同流水重複誤判成
 *     唯一候選、重複自動認領)。
 *   - order_ref 規則加金額核對:文字對上訂單編號但金額對不上該單欠款,降級
 *     為候選卡,不再無條件 100 分直接 link。
 *   - trust_sync 加 reversedAt IS NULL 過濾;判斷邏輯抽成純函式
 *     decideTrustSyncLink 可單測。
 *   - exact_amount 的唯一/模糊判斷改成公司層級(不先按時間窗篩選訂單池),
 *     時間窗只用來決定「唯一候選是否可以 auto」,不再影響「算不算唯一」。
 *   - stripe_payout 判斷改用單字邊界比對(hasWord),不再用裸子字串 includes。
 *   - order_ref/exact_amount 跑之前先排除已知供應商退款 descriptor
 *     (accountingKnowledge.KNOWN_INFLOW_REFUND_VENDORS),避免供應商退款被
 *     誤配成客人訂單付款。
 *   - 低於門檻(small_inflow)的檢查提前到 exact_amount 之前,金額夠小一律
 *     自動歸類,不會因為恰好命中模糊候選而卡進待認領。
 */

import { getDb } from "../db";
import {
  bankTransactions,
  bankTransactionLinks,
  customOrders,
  trustDeferredIncome,
} from "../../drizzle/schema";
import { and, eq, ne, isNull, sql } from "drizzle-orm";
import {
  isStripePayoutInflow,
  norm,
  hasWord,
  KNOWN_INFLOW_REFUND_VENDORS,
} from "../agents/autonomous/accountingKnowledge";
import {
  matchPaymentsToOrders,
  resolveUnpaidLeg,
  type OrderPaymentMatchInput,
  type OrderPaymentMatchFinding,
  type OrderPaymentMatchLegKind,
  type BankTransactionInput,
} from "./customOrderWatchdog";
import { statusAfterPayment } from "../routers/customOrderStateMachine";
import { createChildLogger } from "../_core/logger";
import { reportFunnelError } from "../_core/errorFunnel";
import { redis } from "../redis";

const log = createChildLogger({ module: "bankTransactionLinkEngine" });

// ─── Config ──────────────────────────────────────────────────────────────

/** 待認領門檻(USD)。低於此金額的入帳自動歸 small_inflow,不出待認領卡。 */
export function pendingClaimMinUsd(): number {
  const v = parseFloat(process.env.BANK_TXN_PENDING_CLAIM_MIN_USD ?? "100");
  return Number.isFinite(v) && v >= 0 ? v : 100;
}

/** exact_amount 規則的時間窗(天)。唯一候選要落在交易日 ±此天數內才能 auto。 */
export const EXACT_AMOUNT_DATE_WINDOW_DAYS = 7;

/** 拒收超額分配 / 金額吻合比對的容差(小數點誤差)。 */
const ALLOCATION_EPSILON = 0.01;

// ─── Types ───────────────────────────────────────────────────────────────

export type LinkTargetType = "custom_order" | "invoice" | "booking" | "category";

export interface LinkableBankTxn {
  id: number;
  amount: string | number;
  date: string;
  merchantName: string | null;
  description: string | null;
  originalDescription: string | null;
  /** Plaid payment_meta.reason 落點(schema.ts:3120-3124,BofA Zelle memo)。 */
  paymentMetaReason: string | null;
  accountMask: string | null;
}

export type AutoLinkRule = "trust_sync" | "stripe_payout" | "order_ref" | "exact_amount" | "small_inflow";

export interface AutoLinkResult {
  targetType: LinkTargetType;
  targetId: number | null;
  categoryCode: string | null;
  amountAllocated: number;
  matchMethod: `auto:${AutoLinkRule}`;
  matchConfidence: number;
}

export type ProcessOutcome =
  | { status: "linked"; rule: AutoLinkRule; link: AutoLinkResult; linkId: number }
  | { status: "pending_claim"; candidates: OrderPaymentMatchFinding[] }
  | { status: "already_handled"; existingAllocated: number }
  | { status: "skipped"; reason: string };

// ─── Pure rule: order_ref ───────────────────────────────────────────────

/** ORD-YYYY-NNNN(4 位年 + 1 位以上流水號,漏打前導零也吃),大小寫不拘。
 *  真實 orderNumber 一律 4 碼(generateOrderNumber 產出),但人手打的 Zelle
 *  memo 常省略前導零(如「ORD-2026-42」代指「ORD-2026-0042」),抓到後一律
 *  padStart 補齊 4 碼再拿去查表。 */
const ORDER_REF_PATTERN = /ORD-(\d{4})-(\d{1,})/i;

/** 從描述/memo 抽訂單編號。找不到回 null(誠實不猜)。 */
export function extractOrderRef(txn: {
  description: string | null;
  originalDescription: string | null;
  paymentMetaReason: string | null;
}): string | null {
  const haystacks = [txn.originalDescription, txn.paymentMetaReason, txn.description];
  for (const h of haystacks) {
    if (!h) continue;
    const m = ORDER_REF_PATTERN.exec(h);
    if (m) return `ORD-${m[1]}-${m[2].padStart(4, "0")}`;
  }
  return null;
}

// ─── Pure rule: exact_amount(公司層級唯一/模糊判斷,不先按時間窗篩選)───────

export type ExactAmountOrderCandidate = OrderPaymentMatchInput & {
  collectionSentAt: Date | string | null;
  createdAt: Date | string | null;
};

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

/**
 * 公司層級 exact_amount 候選:對「全部」未收款訂單(不預先按時間窗篩選)找
 * 金額吻合 + 模糊候選(沿用既有 matchPaymentsToOrders,批8 演算,零修改重用)。
 *
 * 刻意不先用時間窗篩選訂單池 —— 對抗審查 P1:若先篩窗,一張窗外但仍未收款、
 * 金額一樣吻合的訂單會在丟進比對前就被排除,讓本該模糊的情況被誤判成「唯一
 * 候選」。是否可以 auto,由呼叫端另外疊加 isCandidateInWindow 檢查唯一候選
 * 是否落在窗內,不影響「唯一 vs 模糊」本身的判斷範圍。
 */
export function findExactAmountCandidates(
  txn: BankTransactionInput,
  companyOrders: ExactAmountOrderCandidate[],
): OrderPaymentMatchFinding[] {
  return matchPaymentsToOrders(companyOrders, [txn]);
}

/** 唯一候選是否落在交易日 ±windowDays 天的時間窗內(比對 collectionSentAt,
 *  缺則 createdAt)。找不到訂單或日期壞掉 → false(誠實不猜)。 */
export function isCandidateInWindow(
  orderId: number,
  companyOrders: ExactAmountOrderCandidate[],
  txnDateStr: string,
  windowDays: number = EXACT_AMOUNT_DATE_WINDOW_DAYS,
): boolean {
  const txnDate = new Date(txnDateStr);
  if (Number.isNaN(txnDate.getTime())) return false;
  const order = companyOrders.find((o) => o.id === orderId);
  if (!order) return false;
  const anchorRaw = order.collectionSentAt ?? order.createdAt;
  if (!anchorRaw) return false;
  const anchor = anchorRaw instanceof Date ? anchorRaw : new Date(anchorRaw);
  if (Number.isNaN(anchor.getTime())) return false;
  return daysBetween(txnDate, anchor) <= windowDays;
}

// ─── Pure rule: trust_sync ──────────────────────────────────────────────

/** syncTrustLink 讀到的 trustDeferredIncome 最小欄位集。 */
export interface TrustDeferredRowForSync {
  bookingId: number | null;
  reversedAt: Date | string | null;
  amount: string | number;
  matchConfidence: number;
}

/**
 * 純函式(可單測,無 DB):給定一筆 trustDeferredIncome 列(或 null = 查無),
 * 決定要不要同步成一筆 bankTransactionLinks。已撤銷(reversedAt 非 null)的
 * 配對不算數 —— reverseDeferral 撤銷時不會清空 bookingId,若不擋 reversedAt,
 * 已作廢的配對仍會被拿去建立正式 link(對抗審查 P1)。
 */
export function decideTrustSyncLink(row: TrustDeferredRowForSync | null): AutoLinkResult | null {
  if (!row || !row.bookingId || row.reversedAt != null) return null;
  return {
    targetType: "booking",
    targetId: row.bookingId,
    categoryCode: null,
    amountAllocated: parseFloat(row.amount as any) || 0,
    matchMethod: "auto:trust_sync",
    matchConfidence: row.matchConfidence,
  };
}

// ─── Pure guard: 已知供應商退款 descriptor(避免跟客人訂單比對池混在一起)──

/** haystack 含任一已知旅遊 vendor 的退款 descriptor(見 accountingKnowledge.
 *  KNOWN_INFLOW_REFUND_VENDORS)。用 hasWord 單字邊界比對,跟 accountingKnowledge
 *  自己 vendorHit 的 contains/phrase 模式一致精神,避免短 token 誤中。 */
export function isKnownRefundVendorInflow(haystack: string): boolean {
  const h = norm(haystack);
  return KNOWN_INFLOW_REFUND_VENDORS.some((v) => v.match.some((m) => h.includes(norm(m))));
}

// ─── DB-touching orchestration ────────────────────────────────────────────

/** 這筆 bankTransactionId 目前已分配的總金額(SUM amountAllocated)。 */
export async function sumLinkedAmount(bankTransactionId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ amountAllocated: bankTransactionLinks.amountAllocated })
    .from(bankTransactionLinks)
    .where(eq(bankTransactionLinks.bankTransactionId, bankTransactionId));
  let total = 0;
  for (const r of rows) {
    total += parseFloat(r.amountAllocated as any) || 0;
  }
  return total;
}

export class AllocationExceededError extends Error {
  constructor(bankTransactionId: number, existing: number, incoming: number, cap: number) {
    super(
      `bankTransactionId ${bankTransactionId}: existing $${existing.toFixed(2)} + new $${incoming.toFixed(2)} exceeds transaction amount $${cap.toFixed(2)}`,
    );
    this.name = "AllocationExceededError";
  }
}

export interface CreateLinkInput {
  bankTransactionId: number;
  targetType: LinkTargetType;
  targetId: number | null;
  categoryCode: string | null;
  amountAllocated: number;
  matchMethod: string;
  matchConfidence: number | null;
  claimedBy: "jeff" | "system";
  note?: string | null;
}

// ─── Redis 鎖(對抗審查 P1:防止同一筆 bankTransactionId 被兩個並發呼叫
// 各自通過 SUM<=|amount| 檢查後都寫入,合計超額)。────────────────────────
//
// 語意仿 server/db/customerProfile.ts 的 withCustomerIntakeLock,但故意
// FAIL-CLOSED(重試幾次仍拿不到鎖就丟錯,讓呼叫端重試/該筆這輪略過)——這裡
// 是錢的分配上限檢查,寧可讓一次呼叫失敗重試,也不要在真的撞上併發時放行
// 超額寫入。Redis 本身連不上(基礎設施掛了,非鎖被佔用)才 fail-open,理由
// 同 withCustomerIntakeLock:那種情況代表更大的系統性問題,不該讓所有認領
// 動作都卡死;而且本系統排程並發本來就窄(BullMQ worker concurrency:1、
// 單一 admin)。

const LOCK_TTL_SECONDS = 10;
const LOCK_RETRY_MS = 100;
const LOCK_MAX_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withBankTransactionLock<T>(
  bankTransactionId: number,
  fn: () => Promise<T>,
): Promise<T> {
  const lockKey = `bank-txn-link-lock:${bankTransactionId}`;
  const lockVal = Math.random().toString(36).slice(2);
  let acquired = false;
  let redisAvailable = true;

  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS && !acquired; attempt++) {
    try {
      const ok = await redis.set(lockKey, lockVal, "EX", LOCK_TTL_SECONDS, "NX");
      acquired = ok === "OK";
    } catch {
      redisAvailable = false;
      break;
    }
    if (!acquired) await sleep(LOCK_RETRY_MS);
  }

  if (!acquired && !redisAvailable) {
    // Redis 本身連不上 — fail-open(同 withCustomerIntakeLock 慣例)。
    acquired = false;
  } else if (!acquired) {
    // Redis 正常但鎖被佔用 — fail-closed,拒收讓呼叫端重試。
    throw new Error(
      `bankTransactionId ${bankTransactionId}: could not acquire allocation lock after ${LOCK_MAX_ATTEMPTS} attempts (contended)`,
    );
  }

  try {
    return await fn();
  } finally {
    if (acquired) {
      const lua = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
      try {
        await (redis as any).eval(lua, 1, lockKey, lockVal);
      } catch {
        // best-effort release; TTL will reclaim it regardless.
      }
    }
  }
}

/**
 * 認領成功後,若目標是 custom_order 且分配金額吻合該單「還欠的那一段」
 * (±容差),同步寫回 depositPaidAt/balancePaidAt(+對應 *PaidAmount 欄位 +
 * 狀態機只進不退推進),讓 resolveUnpaidLeg 之後正確回報「已收」——否則同一
 * 張單會被不同、不相關的銀行流水重複判定為唯一候選並重複自動認領(對抗審查
 * P1)。分配金額低於該段目標(部分認領)則不寫回,誠實地不假裝那一段已結清。
 * 必須在呼叫端已開的 transaction 內執行,確保 link 寫入與這裡的狀態同步是
 * 同一個原子操作。
 */
async function syncCustomOrderPaymentAfterLink(
  tx: any,
  orderId: number,
  amountAllocated: number,
): Promise<void> {
  const [order] = await tx
    .select({
      id: customOrders.id,
      orderNumber: customOrders.orderNumber,
      title: customOrders.title,
      status: customOrders.status,
      currency: customOrders.currency,
      totalPrice: customOrders.totalPrice,
      depositAmount: customOrders.depositAmount,
      balanceAmount: customOrders.balanceAmount,
      depositPaidAt: customOrders.depositPaidAt,
      balancePaidAt: customOrders.balancePaidAt,
    })
    .from(customOrders)
    .where(eq(customOrders.id, orderId))
    .limit(1);
  if (!order) return;

  const leg = resolveUnpaidLeg(order as OrderPaymentMatchInput);
  if (!leg) return; // 這張單已經沒有可對的欠款欄位(理論上不該發生,防禦性略過)
  if (amountAllocated + ALLOCATION_EPSILON < leg.targetAmount) return; // 部分認領,這段還沒結清,不寫回

  const now = new Date();
  const patch: Record<string, unknown> = { updatedAt: now };
  let paymentKind: "deposit" | "balance";
  if (leg.legKind === "deposit") {
    paymentKind = "deposit";
    patch.depositPaidAt = now;
    patch.depositPaidAmount = amountAllocated.toFixed(2);
  } else if (leg.legKind === "balance") {
    paymentKind = "balance";
    patch.balancePaidAt = now;
    patch.balancePaidAmount = amountAllocated.toFixed(2);
  } else {
    // legKind === "total":沒有分期欄位可用,一次付清 — 兩個時間戳一起標,
    // 狀態比照「尾款/全額」(balance → 終態 paid)。
    paymentKind = "balance";
    patch.depositPaidAt = now;
    patch.balancePaidAt = now;
    patch.balancePaidAmount = amountAllocated.toFixed(2);
  }
  patch.status = statusAfterPayment(order.status as any, paymentKind);

  await tx.update(customOrders).set(patch).where(eq(customOrders.id, orderId));
}

/**
 * 唯一寫入路徑(手動認領與 auto 規則都經這支)。code 層驗:SUM(既有) + 新增
 * <= |bankTransactions.amount|,超額拒收(AllocationExceededError)。
 *
 * 併發安全:Redis 鎖(per bankTransactionId)+ DB transaction 包住「讀 SUM →
 * 檢查 → 寫入 → (custom_order 目標則同步付款狀態)」,不再是無鎖兩步(對抗
 * 審查 P1 TOCTOU)。
 */
export async function createBankTransactionLink(
  input: CreateLinkInput,
): Promise<{ id: number }> {
  return withBankTransactionLock(input.bankTransactionId, async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    return await db.transaction(async (tx: any) => {
      const [txn] = await tx
        .select({ amount: bankTransactions.amount })
        .from(bankTransactions)
        .where(eq(bankTransactions.id, input.bankTransactionId))
        .limit(1);
      if (!txn) throw new Error(`bankTransaction ${input.bankTransactionId} not found`);

      const cap = Math.abs(parseFloat(txn.amount as any) || 0);
      const existingRows = await tx
        .select({ amountAllocated: bankTransactionLinks.amountAllocated })
        .from(bankTransactionLinks)
        .where(eq(bankTransactionLinks.bankTransactionId, input.bankTransactionId));
      let existing = 0;
      for (const r of existingRows) existing += parseFloat(r.amountAllocated as any) || 0;

      if (existing + input.amountAllocated > cap + ALLOCATION_EPSILON) {
        throw new AllocationExceededError(input.bankTransactionId, existing, input.amountAllocated, cap);
      }

      const result: any = await tx.insert(bankTransactionLinks).values({
        bankTransactionId: input.bankTransactionId,
        targetType: input.targetType,
        targetId: input.targetId,
        categoryCode: input.categoryCode,
        amountAllocated: String(input.amountAllocated.toFixed(2)),
        matchMethod: input.matchMethod,
        matchConfidence: input.matchConfidence,
        claimedBy: input.claimedBy,
        note: input.note ?? null,
      });
      const id = Number(result?.[0]?.insertId ?? 0);

      if (input.targetType === "custom_order" && input.targetId != null) {
        await syncCustomOrderPaymentAfterLink(tx, input.targetId, input.amountAllocated);
      }

      return { id };
    });
  });
}

/** trust_sync:trustDeferredIncome 已有配對成果就同步寫一筆 link,不重跑配對。
 *  只讀,決策邏輯在 decideTrustSyncLink(純函式,可單測)。 */
async function syncTrustLink(bankTransactionId: number): Promise<AutoLinkResult | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      bookingId: trustDeferredIncome.bookingId,
      reversedAt: trustDeferredIncome.reversedAt,
      amount: trustDeferredIncome.amount,
      matchConfidence: trustDeferredIncome.matchConfidence,
    })
    .from(trustDeferredIncome)
    .where(eq(trustDeferredIncome.bankTransactionId, bankTransactionId))
    .limit(1);
  return decideTrustSyncLink(row ?? null);
}

/** 公司層級撈「還沒收完」的 customOrders(排除 draft/cancelled,同 watchdog 慣例）。 */
async function loadCompanyOutstandingOrders(): Promise<ExactAmountOrderCandidate[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: customOrders.id,
      orderNumber: customOrders.orderNumber,
      title: customOrders.title,
      status: customOrders.status,
      currency: customOrders.currency,
      totalPrice: customOrders.totalPrice,
      depositAmount: customOrders.depositAmount,
      balanceAmount: customOrders.balanceAmount,
      depositPaidAt: customOrders.depositPaidAt,
      balancePaidAt: customOrders.balancePaidAt,
      collectionSentAt: customOrders.collectionSentAt,
      createdAt: customOrders.createdAt,
    })
    .from(customOrders)
    .where(
      and(
        ne(customOrders.status, "draft"),
        ne(customOrders.status, "cancelled"),
      ),
    );
  return rows;
}

async function findByOrderRef(orderNumber: string): Promise<ExactAmountOrderCandidate | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      id: customOrders.id,
      orderNumber: customOrders.orderNumber,
      title: customOrders.title,
      status: customOrders.status,
      currency: customOrders.currency,
      totalPrice: customOrders.totalPrice,
      depositAmount: customOrders.depositAmount,
      balanceAmount: customOrders.balanceAmount,
      depositPaidAt: customOrders.depositPaidAt,
      balancePaidAt: customOrders.balancePaidAt,
      collectionSentAt: customOrders.collectionSentAt,
      createdAt: customOrders.createdAt,
    })
    .from(customOrders)
    .where(eq(customOrders.orderNumber, orderNumber))
    .limit(1);
  if (!row) return null;
  if (row.status === "draft" || row.status === "cancelled") return null;
  return row;
}

function buildHaystack(txn: LinkableBankTxn): string {
  return [txn.merchantName, txn.description, txn.originalDescription]
    .map(norm)
    .filter(Boolean)
    .join(" | ");
}

function candidateFromOrder(
  order: ExactAmountOrderCandidate,
  leg: { legKind: OrderPaymentMatchLegKind; targetAmount: number },
  txn: LinkableBankTxn,
  amountAbs: number,
): OrderPaymentMatchFinding {
  return {
    kind: "paymentMatch",
    orderId: order.id,
    orderNumber: order.orderNumber,
    title: order.title,
    status: order.status,
    level: "yellow",
    legKind: leg.legKind,
    matchedAmount: amountAbs,
    transactionDate: txn.date,
    accountMask: txn.accountMask,
    candidateOrderIds: [order.id],
  };
}

/**
 * 主入口:處理一筆入帳,依序試 4 條規則,回傳最終狀態。呼叫端(daily 掃描 /
 * 回填端點)負責決定「pending_claim」狀態要不要出卡(噪音閘見
 * bankTransactionLinkAlerts.ts)。
 *
 * 冪等:已「完全」分配(SUM >= |amount| - 容差)回 already_handled,不重跑
 * 規則。只「部分」分配(0 < SUM < |amount|)回 pending_claim(不重跑 auto
 * 規則搶剩餘的錢,交 Jeff 在待認領頁補完)——舊版把「有任何 link」一律當
 * 「處理完畢」,部分認領後剩餘金額會從所有清單永久消失(對抗審查 P1)。
 *
 * opts.dryRun:回填端點(存量掃描)先跑 dry_run 產報表用 —— 規則判斷邏輯
 * 完全相同,只是最後不寫 bankTransactionLinks(linkId 回 -1 佔位)。
 */
export async function processInboundTransaction(
  bankTransactionId: number,
  opts?: { dryRun?: boolean },
): Promise<ProcessOutcome> {
  const dryRun = opts?.dryRun ?? false;
  const write = async (input: CreateLinkInput): Promise<{ id: number }> =>
    dryRun ? { id: -1 } : createBankTransactionLink(input);

  const db = await getDb();
  if (!db) return { status: "skipped", reason: "db unavailable" };

  const [row] = await db
    .select({
      id: bankTransactions.id,
      amount: bankTransactions.amount,
      date: bankTransactions.date,
      merchantName: bankTransactions.merchantName,
      description: bankTransactions.description,
      originalDescription: bankTransactions.originalDescription,
      paymentMeta: bankTransactions.paymentMeta,
      accountOwner: bankTransactions.accountOwner,
    })
    .from(bankTransactions)
    .where(eq(bankTransactions.id, bankTransactionId))
    .limit(1);

  if (!row) return { status: "skipped", reason: "transaction not found" };

  const amount = parseFloat(row.amount as any) || 0;
  // Plaid 符號頭號地雷:正=支出、負=入帳。本引擎只做入帳,出帳一律 skip。
  if (amount >= 0) return { status: "skipped", reason: "not an inflow (amount >= 0)" };

  const amountAbs = Math.abs(amount);
  const existing = await sumLinkedAmount(bankTransactionId);
  if (existing + ALLOCATION_EPSILON >= amountAbs) {
    return { status: "already_handled", existingAllocated: existing };
  }
  if (existing > 0) {
    // 部分認領:交 Jeff 在待認領頁補完剩餘金額,不重跑 auto 規則搶餘額。
    return { status: "pending_claim", candidates: [] };
  }

  const paymentMetaReason =
    row.paymentMeta && typeof row.paymentMeta === "object"
      ? ((row.paymentMeta as any).reason ?? null)
      : null;

  const txn: LinkableBankTxn = {
    id: row.id,
    amount: row.amount as any,
    date: String(row.date),
    merchantName: row.merchantName,
    description: row.description,
    originalDescription: row.originalDescription,
    paymentMetaReason,
    accountMask: null,
  };

  // 1) trust_sync — 既有 Trust 遞延配對成果同步(只認未撤銷的配對)。
  try {
    const trustLink = await syncTrustLink(bankTransactionId);
    if (trustLink) {
      const { id } = await write({
        bankTransactionId,
        targetType: trustLink.targetType,
        targetId: trustLink.targetId,
        categoryCode: trustLink.categoryCode,
        amountAllocated: trustLink.amountAllocated,
        matchMethod: trustLink.matchMethod,
        matchConfidence: trustLink.matchConfidence,
        claimedBy: "system",
        note: "trustDeferredIncome 既有配對同步",
      });
      log.info({ bankTransactionId, rule: "trust_sync", linkId: id }, "[bankTxnLinkEngine] auto-linked");
      return { status: "linked", rule: "trust_sync", link: trustLink, linkId: id };
    }
  } catch (err) {
    reportFunnelError({ source: "fail-open:bankTransactionLinkEngine:trust_sync", err, context: { bankTransactionId } }).catch(() => {});
  }

  const haystack = buildHaystack(txn);

  // 2) stripe_payout — 與塊C preClassify 共用同一份 descriptor 判斷(單字邊界)。
  if (isStripePayoutInflow(haystack)) {
    const link: AutoLinkResult = {
      targetType: "category",
      targetId: null,
      categoryCode: "stripe_payout",
      amountAllocated: amountAbs,
      matchMethod: "auto:stripe_payout",
      matchConfidence: 90,
    };
    const { id } = await write({
      bankTransactionId,
      ...link,
      claimedBy: "system",
      note: "Stripe 轉撥 — 該筆收入已於 Stripe webhook 結帳當下認列,此為撥款落地非二次收入",
    });
    log.info({ bankTransactionId, rule: "stripe_payout", linkId: id }, "[bankTxnLinkEngine] auto-linked");
    return { status: "linked", rule: "stripe_payout", link, linkId: id };
  }

  // 3) 已知供應商退款 descriptor(如 Lion Travel/Jupiter Legend/United Airlines
  //    退款進帳)—— 不是客人付款,不該進 order_ref/exact_amount 比對池。
  //    直接出待認領卡(無候選),交 Jeff 自己判斷歸類。
  if (isKnownRefundVendorInflow(haystack)) {
    return { status: "pending_claim", candidates: [] };
  }

  // 4) order_ref — memo 裡明寫訂單編號,文字 + 金額都吻合才直接 link;
  //    文字對上但金額對不上該單欠款,降級為候選卡,不 auto。
  const orderRef = extractOrderRef(txn);
  let orderRefCandidate: OrderPaymentMatchFinding | null = null;
  if (orderRef) {
    const order = await findByOrderRef(orderRef);
    if (order) {
      const leg = resolveUnpaidLeg(order);
      if (leg && Math.abs(leg.targetAmount - amountAbs) < ALLOCATION_EPSILON) {
        const link: AutoLinkResult = {
          targetType: "custom_order",
          targetId: order.id,
          categoryCode: null,
          amountAllocated: amountAbs,
          matchMethod: "auto:order_ref",
          matchConfidence: 100,
        };
        const { id } = await write({
          bankTransactionId,
          ...link,
          claimedBy: "system",
          note: `memo 含訂單編號 ${orderRef},金額吻合該單 ${leg.legKind}`,
        });
        log.info({ bankTransactionId, rule: "order_ref", orderRef, linkId: id }, "[bankTxnLinkEngine] auto-linked");
        return { status: "linked", rule: "order_ref", link, linkId: id };
      }
      if (leg) {
        // 文字對上、金額對不上:留一個候選給 Jeff 判斷,不 auto。
        orderRefCandidate = candidateFromOrder(order, leg, txn, amountAbs);
      }
    }
  }

  // 5) 低於門檻 → small_inflow 自動歸類,不出卡。提前到 exact_amount 之前:
  //    小額不該因為恰好命中模糊候選就卡進待認領(對抗審查 P2)。
  if (amountAbs < pendingClaimMinUsd()) {
    const link: AutoLinkResult = {
      targetType: "category",
      targetId: null,
      categoryCode: "small_inflow",
      amountAllocated: amountAbs,
      matchMethod: "auto:small_inflow",
      matchConfidence: 100,
    };
    const { id } = await write({
      bankTransactionId,
      ...link,
      claimedBy: "system",
      note: `低於待認領門檻 $${pendingClaimMinUsd()}`,
    });
    log.info({ bankTransactionId, rule: "small_inflow", linkId: id }, "[bankTxnLinkEngine] auto-linked");
    return { status: "linked", rule: "small_inflow", link, linkId: id };
  }

  // 6) exact_amount — 公司層級唯一候選 + 落在時間窗內才 auto;否則出候選卡
  //    (含 order_ref 文字命中但金額不符的軟候選,一併附上供 Jeff 參考)。
  const companyOrders = await loadCompanyOutstandingOrders();
  const bankTxnInput: BankTransactionInput = {
    id: txn.id,
    amount: txn.amount,
    date: txn.date,
    accountMask: txn.accountMask,
  };
  const findings = findExactAmountCandidates(bankTxnInput, companyOrders);
  if (
    findings.length === 1 &&
    findings[0].candidateOrderIds.length === 1 &&
    isCandidateInWindow(findings[0].orderId, companyOrders, txn.date)
  ) {
    const f = findings[0];
    const link: AutoLinkResult = {
      targetType: "custom_order",
      targetId: f.orderId,
      categoryCode: null,
      amountAllocated: f.matchedAmount,
      matchMethod: "auto:exact_amount",
      matchConfidence: 100,
    };
    const { id } = await write({
      bankTransactionId,
      ...link,
      claimedBy: "system",
      note: `金額吻合訂單 ${f.orderNumber}(${f.legKind})+ 時間窗 ${EXACT_AMOUNT_DATE_WINDOW_DAYS} 天內唯一候選`,
    });
    log.info({ bankTransactionId, rule: "exact_amount", orderId: f.orderId, linkId: id }, "[bankTxnLinkEngine] auto-linked");
    return { status: "linked", rule: "exact_amount", link, linkId: id };
  }

  const candidates = orderRefCandidate ? [orderRefCandidate, ...findings] : findings;
  return { status: "pending_claim", candidates };
}

// ─── Scan: 找出還沒分配完的入帳(未 link 或部分 link)───────────────────────

export interface UnlinkedInflow {
  /** bankTransactions.id */
  id: number;
  /** 原始交易金額(Plaid 帶正負號的字串)。 */
  amount: string;
  date: string;
  /** 這筆入帳還沒被任何 link 分配掉的餘額(|amount| − 既有 SUM)。 */
  remainingAmount: number;
}

/**
 * 撈「還沒分配完」的入帳(amount<0,排除 isPending/excludeFromAccounting/
 * archived,同既有 watchdog 慣例)。
 *
 * 2026-07-08 對抗審查修復(P0):先撈「全部」符合條件的候選(不先 LIMIT),
 * 差集扣掉已分配部分後,依交易日「新到舊」排序才取 limit —— 舊寫法是「先
 * LIMIT 再差集」,一旦已處理的舊資料筆數超過 limit,今天剛同步進來的新錢會
 * 被舊資料擠出候選視窗,永遠掃不到。新到舊排序確保 daily 掃描optimizes 「今天
 * 的新錢一定會被看到」,積壓的舊 pending_claim 靠回填端點(limit 更大)或
 * Jeff 直接清理,不會讓新錢陪著一起被餓死。
 *
 * 差集判斷用「SUM(amountAllocated) < |amount|」而非「存在任一 link」——部分
 * 認領的餘額要繼續出現在候選清單,直到分配滿額(P1:舊寫法會讓部分認領的
 * 餘額永久消失)。
 *
 * 效能取捨:用兩段查詢(候選集合 − 已連結集合)取代 NOT EXISTS/GROUP BY HAVING
 * 關聯查詢 —— TiDB + Drizzle 對複雜關聯查詢曾經炸過(docs/agent/30-templates.md
 * T2 地雷四),同一警戒下優先選最簡單安全的形狀。不先 LIMIT 代表這裡是抓
 * 「全部」符合 WHERE 條件的候選,PACK&GO 一人公司的 Plaid 交易總量遠低於
 * 需要分頁的規模(見 T6 已知限制:若交易量成長到需要分頁,這裡要重新設計)。
 */
export async function scanUnlinkedInflows(opts?: { limit?: number }): Promise<UnlinkedInflow[]> {
  const db = await getDb();
  if (!db) return [];
  const limit = opts?.limit ?? 500;

  const candidates = await db
    .select({ id: bankTransactions.id, amount: bankTransactions.amount, date: bankTransactions.date })
    .from(bankTransactions)
    .where(
      and(
        sql`${bankTransactions.amount} < 0`,
        eq(bankTransactions.isPending, 0),
        eq(bankTransactions.excludeFromAccounting, 0),
        eq(bankTransactions.archived, 0),
      ),
    );

  if (candidates.length === 0) return [];

  const linkRows = await db
    .select({
      bankTransactionId: bankTransactionLinks.bankTransactionId,
      amountAllocated: bankTransactionLinks.amountAllocated,
    })
    .from(bankTransactionLinks);
  const allocatedById = new Map<number, number>();
  for (const r of linkRows) {
    allocatedById.set(
      r.bankTransactionId,
      (allocatedById.get(r.bankTransactionId) ?? 0) + (parseFloat(r.amountAllocated as any) || 0),
    );
  }

  return candidates
    .map((c) => {
      const cap = Math.abs(parseFloat(c.amount as any) || 0);
      const allocated = allocatedById.get(c.id) ?? 0;
      return { id: c.id, amount: String(c.amount), date: String(c.date), remainingAmount: cap - allocated };
    })
    .filter((c) => c.remainingAmount > ALLOCATION_EPSILON)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) // 新到舊
    .slice(0, limit);
}
