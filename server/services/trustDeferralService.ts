/**
 * Trust Account Deferral Service (Phase 4).
 *
 * Implements CST §17550 income recognition: customer prepayments sit in a
 * trust account until departure, then are recognized as income.
 *
 * Feature-flagged via PLAID_TRUST_DEFERRAL_ENABLED env. When off, this
 * service short-circuits — all behavior reverts to immediate recognition
 * (Phase 3 behavior).
 *
 * Configuration (defaults reflect strictest legal reading; Jeff can flip
 * via env vars after reviewing PHASE_4_TRUST_DEFERRAL_DESIGN.md Q1-Q7):
 *
 *   PLAID_TRUST_DEFERRAL_ENABLED       — 'true' to enable (default off)
 *   PLAID_TRUST_RECOGNITION_OFFSET_DAYS — days after departure to recognize
 *                                         (default 0 = same day as departure)
 *   PLAID_TRUST_AUTOMATCH_MIN_CONFIDENCE — auto-link txn→booking threshold
 *                                          (default 80; below = needs Jeff)
 *   PLAID_TRUST_AUTOMATCH_AMOUNT_WINDOW_USD — same-day match tolerance
 *                                              (default 1.00)
 *   PLAID_TRUST_AUTOMATCH_DATE_WINDOW_DAYS — bookings paid ±N days back
 *                                            (default 2)
 *
 * Public API:
 *   processTrustInflow(bankTransactionId)
 *     — Called by AccountingAgent service when a transaction is classified
 *       as income_booking on a trust account. Creates a trustDeferredIncome
 *       row, attempts auto-match to a booking.
 *
 *   recognizeReadyDepartures(runId?)
 *     — Called by the daily cron. Recognizes all rows where
 *       expectedRecognitionDate <= today, recognizedAt IS NULL, reversedAt
 *       IS NULL. Returns counts.
 *
 *   linkInflowToBooking(deferredId, bookingId, userId)
 *     — Admin override. Manually associate a deferred row with a booking.
 *       Recomputes expectedRecognitionDate from booking.departureDate.
 *
 *   reverseDeferral(deferredId, reason, userId)
 *     — Admin override. Marks the deferral as reversed (e.g., customer
 *       cancelled and was refunded). Subtracts from trust-account balance
 *       reconciliation. Never recognizes.
 *
 *   computeOutstandingTrust(linkedAccountId)
 *     — Sum of recognized=NULL AND reversed=NULL rows. Used for CST
 *       reconciliation: should equal current trust account balance.
 */

import { getDb, type DrizzleTx } from "../db";
import {
  trustDeferredIncome,
  linkedBankAccounts,
  bankTransactions,
  bookings,
  tourDepartures,
  payments,
} from "../../drizzle/schema";
import { and, eq, isNull, isNotNull, lte, gte, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
// SECURITY_AUDIT_2026_05_14 P3-3: feature flag reads come from the typed
// featureFlags module so a typo in env-var names becomes a compile error.
import * as featureFlags from "../_core/featureFlags";
import { reportFunnelError } from "../_core/errorFunnel";
import { systemAudit } from "../_core/auditLog";

// ─── Feature flag + config ─────────────────────────────────────────────────

export function isTrustDeferralEnabled(): boolean {
  return featureFlags.trustDeferralEnabled();
}

/**
 * F1 塊B (2026-07-08) 對抗審查 P1 修復:PLAID_TRUST_DEFERRAL_ENABLED(Plaid
 * 銀行同步遞延)與 STRIPE_TRUST_DEFERRAL_ENABLED(Stripe checkout 直接遞延)
 * 是兩個獨立、可分別切換的 flag。**建立**遞延列的路徑(processTrustInflow
 * 只認 PLAID flag、deferStripeBookingIncome 的呼叫端只認 STRIPE flag)本來
 * 就該分開——這是設計上刻意的,兩條路徑的資料來源不同。但**認列/查詢**
 * 遞延列的路徑(recognizeReadyDepartures/totalDeferredForUser/
 * trustRecognizeNow)如果只認 PLAID flag,會出現「Jeff 只開 STRIPE flag、
 * PLAID flag 維持預設 off」這個最可能發生的裁示組合下,Stripe-direct 遞延
 * 列永遠不會被認列、永遠不會被算進報表——3 路獨立對抗審查(含 1 路 opus)
 * 全數命中同一個 P1。這支函式只給「認列/查詢」路徑用,不給「建立」路徑用
 * ——建立路徑的兩個 flag 保持各自獨立判斷,不要在這裡混用。
 */
export function isAnyTrustDeferralEnabled(): boolean {
  return featureFlags.trustDeferralEnabled() || featureFlags.stripeTrustDeferralEnabled();
}

const RECOGNITION_OFFSET_DAYS = featureFlags.trustRecognitionOffsetDays();
const AUTOMATCH_MIN_CONFIDENCE = featureFlags.trustAutomatchMinConfidence();
// F1 塊B (2026-07-08): these three used to be bare process.env reads here
// (SECURITY_AUDIT_2026_05_14 P3-3 flagged this as a typo-risk gap — a
// misspelled env var name would silently evaluate to the fallback with no
// compile error). Centralized into featureFlags.ts alongside the two above.
const AUTOMATCH_AMOUNT_WINDOW = featureFlags.trustAutomatchAmountWindowUsd();
const AUTOMATCH_DATE_WINDOW_DAYS = featureFlags.trustAutomatchDateWindowDays();
// Q7: when departure is within this many days of the deposit, recognize
// income on the deposit date instead of deferring to departure. Per Jeff's
// 2026-05-13 answer (option B), this is 30 days — short-lead bookings
// crossing year boundaries get attributed to the deposit year, not the
// departure year. Set to 0 to disable early recognition entirely (strict
// departure-date attribution).
const EARLY_RECOGNITION_WINDOW_DAYS = featureFlags.trustEarlyRecognitionWindowDays();

// ─── Heuristic matching ────────────────────────────────────────────────────
//
// Phase 4 default: auto-match attempts pairs of (bank txn) ↔ (payment row)
// based on amount + date window. Joins through bookings → tourDepartures
// to get the departure date.
//
// This is intentionally a "weak" heuristic — it'll catch the obvious cases
// (Stripe deposit hits the same day, matches the booking.depositAmount
// exactly) and leave ambiguous ones for Jeff to manually link via the
// admin UI. Q3 of PHASE_4_TRUST_DEFERRAL_DESIGN.md asks Jeff to confirm
// his preferred matching strategy; until he answers, we default to
// "auto-link high-confidence, queue ambiguous".

/**
 * Look up the most-likely booking + its departure date for a trust
 * inflow. Returns null if no payment in the date window matches the
 * amount within tolerance.
 */
async function findBookingMatch(txn: {
  id: number;
  amount: number;
  date: string;
  description: string | null;
}): Promise<{
  bookingId: number;
  confidence: number;
  departureDate: string | null;
} | null> {
  const db = await getDb();
  if (!db) return null;

  const txnAmt = Math.abs(txn.amount);
  const txnDate = new Date(txn.date);
  const since = new Date(
    txnDate.getTime() - AUTOMATCH_DATE_WINDOW_DAYS * 86_400_000
  );
  const until = new Date(
    txnDate.getTime() + AUTOMATCH_DATE_WINDOW_DAYS * 86_400_000
  );

  // Pull recent payments + their booking + booking's departure date
  const candidates = await db
    .select({
      paymentId: payments.id,
      paidAt: payments.paidAt,
      amount: payments.amount,
      paymentType: payments.paymentType,
      bookingId: bookings.id,
      depositAmount: bookings.depositAmount,
      totalPrice: bookings.totalPrice,
      stripePaymentIntentId: payments.stripePaymentIntentId,
      departureDate: tourDepartures.departureDate,
    })
    .from(payments)
    .leftJoin(bookings, eq(payments.bookingId, bookings.id))
    .leftJoin(tourDepartures, eq(bookings.departureId, tourDepartures.id))
    .where(
      and(
        gte(payments.paidAt, since),
        lte(payments.paidAt, until)
      )
    )
    .limit(50);

  let best:
    | { bookingId: number; confidence: number; departureDate: string | null }
    | null = null;

  for (const c of candidates) {
    if (!c.bookingId) continue;
    const pmAmt = parseFloat(String(c.amount ?? 0));
    const dep = parseFloat(String(c.depositAmount ?? 0));
    const tot = parseFloat(String(c.totalPrice ?? 0));
    const targets = [pmAmt, dep, tot].filter((v) => v > 0);
    const amountDelta = Math.min(...targets.map((t) => Math.abs(t - txnAmt)));
    if (amountDelta > AUTOMATCH_AMOUNT_WINDOW) continue;

    // Score components (Phase 4 E2E test 2026-05-13 calibration):
    //   Exact amount + same calendar day on its own = strong signal even
    //   without a pi_* hint in the description. Weighting:
    //     exact amount (50) + same day (30) = 80 → just crosses threshold
    //     exact amount (50) + same day (30) + pi_* (20) = 100 → ceiling
    //     close amount (30-40) + same day (30) = 60-70 → below threshold,
    //                                                    surfaces for Jeff
    //   This reflects PACK&GO's actual transaction density (1-5 payments/
    //   day, mostly unique amounts) — false-positive rate of same-day
    //   exact-amount is very low.
    let score = 0;
    if (amountDelta === 0) score += 50;
    else if (amountDelta < 0.5) score += 40;
    else score += 25;

    // Time proximity. Compare by CALENDAR DATE (UTC), not raw millisecond
    // diff — a deposit hit 2026-05-13 00:00 (a Plaid DATE field gets parsed
    // as midnight) and a payment.paidAt 2026-05-13 20:42 are the SAME day
    // but their ms-diff is 0.86 days, which would have triggered the
    // `days <= 1` branch (score 20) instead of the same-day branch (score
    // 30). Without the +30 same-day boost, generic Stripe descriptors
    // without pi_* IDs land at score 60 — below the 80 auto-match
    // threshold — and the row stays unmatched even when the payment is
    // obviously the right one. Fix: bucket by ISO date string.
    if (c.paidAt) {
      const txnYmd = txnDate.toISOString().slice(0, 10);
      const paidYmd = new Date(c.paidAt).toISOString().slice(0, 10);
      if (txnYmd === paidYmd) {
        score += 30;
      } else {
        const days =
          Math.abs(txnDate.getTime() - new Date(c.paidAt).getTime()) /
          86_400_000;
        if (days <= 1) score += 20;
        else score += 10;
      }
    }

    // Stripe PaymentIntent ID match (Stripe transfer descriptors include pi_*).
    // Reduced from +30 to +20 after the 2026-05-13 calibration — exact
    // amount + same day no longer needs this boost to clear 80, so pi_*
    // becomes "icing" rather than required.
    const desc = (txn.description ?? "").toLowerCase();
    if (
      c.stripePaymentIntentId &&
      desc.includes(c.stripePaymentIntentId.toLowerCase())
    ) {
      score += 20;
    }

    score = Math.min(100, score);

    if (!best || score > best.confidence) {
      const depStr = c.departureDate
        ? new Date(c.departureDate as any).toISOString().slice(0, 10)
        : null;
      best = {
        bookingId: c.bookingId,
        confidence: score,
        departureDate: depStr,
      };
    }
  }

  if (best && best.confidence >= AUTOMATCH_MIN_CONFIDENCE) {
    return best;
  }
  return null;
}

/**
 * Pure — the "expected recognition date" calculation, extracted (F1 塊B,
 * 2026-07-08) out of processTrustInflow/linkInflowToBooking so
 * deferStripeBookingIncome (Stripe-direct path, bookingId already known,
 * no heuristic matching needed) can reuse the exact same rule instead of
 * re-deriving it. Behavior unchanged from the two inline call sites this
 * replaces.
 *
 * Q7 early-recognition: short-lead bookings recognize on the deposit date
 * instead of departure date (keeps year-end attribution simple — a 12/30
 * deposit for a 1/5 departure is this year's income, not next year's).
 * Disabled by setting the window to 0 (strict departure-date attribution).
 */
export function computeExpectedRecognitionDate(
  departureDateStr: string,
  depositDateStr: string,
): string {
  const dep = new Date(departureDateStr);
  const deposit = new Date(depositDateStr);
  const daysToDeparture = Math.ceil((dep.getTime() - deposit.getTime()) / 86_400_000);

  if (EARLY_RECOGNITION_WINDOW_DAYS > 0 && daysToDeparture <= EARLY_RECOGNITION_WINDOW_DAYS) {
    return deposit.toISOString().slice(0, 10);
  }
  dep.setDate(dep.getDate() + RECOGNITION_OFFSET_DAYS);
  return dep.toISOString().slice(0, 10);
}

/**
 * §17550 認列時點 —— 單一判定函式(F2 塊B,2026-07-10)。
 *
 * 「什麼時候可以認列」整個 codebase 只有這一條規則:認列日(expectedRecognition-
 * Date,由 computeExpectedRecognitionDate 從出發日+訂金日算出)已到(<= 今天)。
 * 出發前(認列日在未來)絕不可認列 —— 這是 CST §17550 的紅線,紅綠測試釘死。
 *
 * CPA 答覆(Jeff 佇列中)回來若調整認列時點,只動 computeExpectedRecognitionDate
 * 的參數(RECOGNITION_OFFSET_DAYS / EARLY_RECOGNITION_WINDOW_DAYS)或本函式的
 * 比較式,不動呼叫端結構 —— recognizeReadyDepartures 的兩處比較都走這裡。
 *
 * 兩端皆為 'YYYY-MM-DD' 曆日字串,字典序即日期序。expectedRecognitionDate 為
 * null(還算不出認列日,如缺出發日)一律不可認列。
 */
export function isRecognitionDue(
  expectedRecognitionDate: string | null | undefined,
  todayStr: string,
): boolean {
  if (!expectedRecognitionDate) return false;
  return String(expectedRecognitionDate) <= todayStr;
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface ProcessTrustInflowResult {
  deferredId: number | null;
  matched: boolean;
  bookingId: number | null;
  confidence: number;
  expectedRecognitionDate: string | null;
  reason: string;
}

/**
 * Called by AccountingAgent flow when a transaction is classified
 * income_booking AND its account isTrustAccount=1.
 *
 * Creates a trustDeferredIncome row, attempts auto-match. Idempotent on
 * bankTransactionId (unique key).
 */
export async function processTrustInflow(
  bankTransactionId: number
): Promise<ProcessTrustInflowResult> {
  if (!isTrustDeferralEnabled()) {
    return {
      deferredId: null,
      matched: false,
      bookingId: null,
      confidence: 0,
      expectedRecognitionDate: null,
      reason: "trust deferral disabled by env flag",
    };
  }

  const db = await getDb();
  if (!db) {
    return {
      deferredId: null,
      matched: false,
      bookingId: null,
      confidence: 0,
      expectedRecognitionDate: null,
      reason: "db unavailable",
    };
  }

  // Fetch the bank transaction + verify it's on a trust account
  const [row] = await db
    .select({
      txn: bankTransactions,
      acct: linkedBankAccounts,
    })
    .from(bankTransactions)
    .leftJoin(
      linkedBankAccounts,
      eq(bankTransactions.linkedAccountId, linkedBankAccounts.id)
    )
    .where(eq(bankTransactions.id, bankTransactionId))
    .limit(1);

  if (!row?.txn) {
    return {
      deferredId: null,
      matched: false,
      bookingId: null,
      confidence: 0,
      expectedRecognitionDate: null,
      reason: "transaction not found",
    };
  }
  if (row.acct?.isTrustAccount !== 1) {
    return {
      deferredId: null,
      matched: false,
      bookingId: null,
      confidence: 0,
      expectedRecognitionDate: null,
      reason: "not a trust account",
    };
  }

  const amount = parseFloat(row.txn.amount as any) || 0;
  // Plaid sign convention: negative = inflow (income). Trust deferral
  // only applies to INflows (customer paying us).
  if (amount >= 0) {
    return {
      deferredId: null,
      matched: false,
      bookingId: null,
      confidence: 0,
      expectedRecognitionDate: null,
      reason: "not an inflow (amount >= 0)",
    };
  }

  // Try to match to a booking (joins payments → bookings → tourDepartures)
  const match = await findBookingMatch({
    id: row.txn.id,
    amount,
    date: String(row.txn.date),
    description: row.txn.description,
  });

  let expectedRecognitionDate: string | null = null;
  if (match?.departureDate) {
    expectedRecognitionDate = computeExpectedRecognitionDate(
      match.departureDate,
      String(row.txn.date),
    );
  }

  // Insert (idempotent on bankTransactionId)
  try {
    const ins: any = await db.insert(trustDeferredIncome).values({
      bankTransactionId: row.txn.id,
      linkedAccountId: row.txn.linkedAccountId,
      bookingId: match?.bookingId ?? null,
      matchConfidence: match?.confidence ?? 0,
      matchMethod: match ? "auto" : "unmatched",
      amount: String(Math.abs(amount)),
      isoCurrencyCode: row.txn.isoCurrencyCode ?? "USD",
      depositDate: row.txn.date as any,
      expectedRecognitionDate: expectedRecognitionDate as any,
    });
    const deferredId = Number(ins?.[0]?.insertId ?? 0) || null;
    return {
      deferredId,
      matched: Boolean(match),
      bookingId: match?.bookingId ?? null,
      confidence: match?.confidence ?? 0,
      expectedRecognitionDate,
      reason: match ? "auto-matched" : "unmatched — awaits Jeff",
    };
  } catch (err) {
    const e = err as any;
    if (String(e?.code ?? "").includes("DUP")) {
      // Already deferred — fetch existing
      const [existing] = await db
        .select()
        .from(trustDeferredIncome)
        .where(eq(trustDeferredIncome.bankTransactionId, row.txn.id))
        .limit(1);
      return {
        deferredId: existing?.id ?? null,
        matched: Boolean(existing?.bookingId),
        bookingId: existing?.bookingId ?? null,
        confidence: existing?.matchConfidence ?? 0,
        expectedRecognitionDate:
          existing?.expectedRecognitionDate
            ? String(existing.expectedRecognitionDate)
            : null,
        reason: "already deferred (idempotent skip)",
      };
    }
    reportFunnelError({ source: "fail-open:trustDeferralService:insert", err, context: { bankTransactionId: row.txn.id } }).catch(() => {});
    return {
      deferredId: null,
      matched: false,
      bookingId: null,
      confidence: 0,
      expectedRecognitionDate: null,
      reason: `insert failed: ${e?.message ?? "unknown"}`,
    };
  }
}

// ─── F1 塊B (2026-07-08): Stripe tour-checkout 直接遞延 ─────────────────────
//
// Feature-flagged via featureFlags.stripeTrustDeferralEnabled()
// (STRIPE_TRUST_DEFERRAL_ENABLED,預設 off)。呼叫端(stripeWebhook.ts)只在
// flag 開啟時才呼叫這支——flag 關閉時的行為由呼叫端自己保持 byte-identical,
// 這支函式本身不重複檢查 flag。
//
// 與 processTrustInflow(Plaid 銀行同步偵測到 Trust 帳戶存款)的差異:
// Stripe checkout 當下 bookingId 是 webhook metadata 直接給的,100% 確定,
// 不需要 findBookingMatch 的金額+日期heuristic 去猜——本函式跳過整個配對
// 演算法,直接建立已配對(matchConfidence=100)的遞延列。
//
// Schema 限制(本批零 migration,bankTransactionLinks 是 F1 唯一授權的一張):
//   - trustDeferredIncome.bankTransactionId 是 NOT NULL + UNIQUE,設計上綁定
//     一筆 Plaid bankTransactions.id。Stripe checkout 付款當下還沒有對應的
//     Plaid 銀行交易(Stripe 撥款落地是之後的事;落地時會被 F1 塊A 的
//     stripe_payout 規則正確識別成「轉撥非收入」,不會再走這條、也不會跟
//     這裡的遞延列衝突)。用 `-payments.id` 當 sentinel 值頂住 NOT
//     NULL/UNIQUE 約束——Plaid 的 bankTransactions.id 是 autoincrement 正
//     整數,負值保證零碰撞,且天然可追溯回是哪筆 Stripe payment,UNIQUE
//     約束天然提供「同一筆 payment 重複呼叫(webhook 重放)不會建立第二筆」
//     的冪等保護。
//   - matchMethod 只能是既有 enum('auto'|'manual'|'unmatched')三選一(同一
//     原因,不能新增 dispatch 原文提到的 'stripe_direct' 這個 enum 值)。
//     bookingId 是系統自動決定(非 Jeff 手動 link),語意上最貼近 'auto';
//     來源記在 notes 欄位供追溯。
//   - linkedAccountId 填 0(佔位,不對應真正的 linkedBankAccounts 列)——按
//     帳戶分帳的既有查詢(如 computeOutstandingTrust)本來就不會撈到假 ID,
//     不影響既有 Plaid 側報表;若未來要讓 year-end export 等其他消費者也
//     涵蓋 Stripe-direct 列需另外處理,本批不做(T6 已知限制)。
//
// 這些是 dispatch 沒有點名怎麼處理 schema 衝突時,執行者的實作決策,標記
// 供 Fable 驗收時特別留意(T6 偏離申報)。

export interface DeferStripeBookingIncomeResult {
  deferredId: number | null;
  expectedRecognitionDate: string | null;
  reason: string;
}

/**
 * 建立(或冪等取得既有)一筆 Stripe tour-checkout 的遞延收入列。呼叫端
 * (stripeWebhook.ts)必須傳入自己開的 tx,讓這筆寫入跟 payments/bookings
 * 的原子交易綁在一起——任一步失敗全部 rollback,跟現行 createAccountingEntry
 * 的原子性保證一致。
 */
export async function deferStripeBookingIncome(
  opts: {
    paymentId: number;
    bookingId: number;
    /** USD,正數。 */
    amount: number;
    isoCurrencyCode: string;
    depositDate: Date;
    /** tourDepartures.departureDate;理論上 booking 流程保證有,缺值則不算
     *  expectedRecognitionDate(交給每日認列掃描的 skippedNoDepartureDate
     *  分支處理,同 Plaid 路徑的既有行為)。 */
    departureDate: string | null;
  },
  tx: DrizzleTx,
): Promise<DeferStripeBookingIncomeResult> {
  const sentinelBankTransactionId = -opts.paymentId;
  // F1 塊B 對抗審查 P2 修復:用 America/Los_Angeles 曆日,不是 UTC 曆日。
  // PACK&GO 是加州公司,客人多半太平洋時區結帳;Plaid 路徑的 depositDate
  // 直接來自 bankTransactions.date(Plaid 本來就是純日期型別,無時區轉換
  // 問題),但 Stripe-direct 這裡是拿 webhook 收到當下的 wall-clock Date
  // 物件轉曆日——若不校正時區,美西深夜結帳(UTC 已跨到隔天)會被錯記成
  // UTC 曆日的隔天,可能讓早鳥認列窗口(30 天)在年度交界附近誤判年度歸屬。
  const depositDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(opts.depositDate);
  const expectedRecognitionDate = opts.departureDate
    ? computeExpectedRecognitionDate(opts.departureDate, depositDateStr)
    : null;

  try {
    const ins: any = await tx.insert(trustDeferredIncome).values({
      bankTransactionId: sentinelBankTransactionId,
      linkedAccountId: 0,
      bookingId: opts.bookingId,
      matchConfidence: 100,
      matchMethod: "auto",
      amount: String(opts.amount.toFixed(2)),
      isoCurrencyCode: opts.isoCurrencyCode,
      depositDate: depositDateStr as any,
      expectedRecognitionDate: expectedRecognitionDate as any,
      notes: "stripe_direct — Stripe tour checkout,bookingId 直接來自 webhook metadata,非 Plaid 銀行同步猜測配對",
    });
    const deferredId = Number(ins?.[0]?.insertId ?? 0) || null;
    // F2 塊A:webhook 驅動的財務寫入必留系統稽核軌(無 ctx.user)。fire-and-forget
    // + .catch 雙保險,絕不影響 Stripe webhook 主交易流程(systemAudit 走獨立連線,
    //  不參與傳入的 tx;tx 若 rollback 也不回滾此列——記錄「曾建立遞延」對合規有利)。
    void systemAudit("system:trustDeferral", "trust.defer", opts.bookingId, {
      deferredId,
      paymentId: opts.paymentId,
      amount: opts.amount,
      isoCurrencyCode: opts.isoCurrencyCode,
      expectedRecognitionDate,
      source: "stripe_direct",
    }).catch(() => {});
    return { deferredId, expectedRecognitionDate, reason: "deferred" };
  } catch (err) {
    const e = err as any;
    if (String(e?.code ?? "").includes("DUP")) {
      const [existing] = await tx
        .select()
        .from(trustDeferredIncome)
        .where(eq(trustDeferredIncome.bankTransactionId, sentinelBankTransactionId))
        .limit(1);
      return {
        deferredId: existing?.id ?? null,
        expectedRecognitionDate: existing?.expectedRecognitionDate
          ? String(existing.expectedRecognitionDate)
          : null,
        reason: "already deferred (idempotent skip)",
      };
    }
    // 讓呼叫端的 tx 照既有 createAccountingEntry 慣例 rollback整筆(webhook
    // idempotency 表會讓 Stripe 重試),不在這裡吞錯誤。
    throw err;
  }
}

/**
 * 用 sentinel bankTransactionId(-paymentId)找到某筆 Stripe payment 對應的
 * 遞延列(若有)。塊B 退款邊界用:charge.refunded 時若找得到未認列的遞延列,
 * 標記 reversed,不認列。
 */
export async function findStripeDeferredByPaymentId(
  paymentId: number,
): Promise<{ id: number; amount: string; recognizedAt: Date | null; reversedAt: Date | null } | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      id: trustDeferredIncome.id,
      amount: trustDeferredIncome.amount,
      recognizedAt: trustDeferredIncome.recognizedAt,
      reversedAt: trustDeferredIncome.reversedAt,
    })
    .from(trustDeferredIncome)
    .where(eq(trustDeferredIncome.bankTransactionId, -paymentId))
    .limit(1);
  return row ?? null;
}

export interface RecognizeReadyResult {
  runId: string;
  scanned: number;
  recognized: number;
  totalRecognizedAmount: number;
  skippedNoDepartureDate: number;
  skippedNotMatched: number;
  /** F1 塊B (2026-07-08) 對抗審查 P1 修復:booking 已 cancelled(退款流程
   *  轉態)但遞延列還沒被 reverseDeferral 標記(例如 post-commit 沖銷失敗
   *  留下的殘留態)——這裡當最後一道防線擋下,不認列已取消訂單的收入。 */
  skippedCancelledBooking: number;
}

/**
 * Daily cron: scan trustDeferredIncome for rows whose expectedRecognitionDate
 * has arrived. Mark them recognized.
 *
 * After recognition, the bankPLService treats these as income on the
 * recognition date (not the deposit date).
 */
export async function recognizeReadyDepartures(
  opts?: { runId?: string; today?: string }
): Promise<RecognizeReadyResult> {
  const runId = opts?.runId ?? `trust-recog-${nanoid(10)}`;
  const today =
    opts?.today ?? new Date().toISOString().slice(0, 10);

  const empty: RecognizeReadyResult = {
    runId,
    scanned: 0,
    recognized: 0,
    totalRecognizedAmount: 0,
    skippedNoDepartureDate: 0,
    skippedNotMatched: 0,
    skippedCancelledBooking: 0,
  };

  // F1 塊B (2026-07-08) 對抗審查 P1 修復:改用 isAnyTrustDeferralEnabled
  // (PLAID flag OR STRIPE flag)——只認 PLAID flag 會讓「只開 STRIPE flag」
  // (CPA 對 Stripe 適用範圍的裁示,跟 Jeff 有沒有啟用既有 Plaid 遞延系統是
  // 兩件獨立的事)這個最可能發生的組合下,Stripe-direct 遞延列永遠不被認列。
  if (!isAnyTrustDeferralEnabled()) return empty;

  const db = await getDb();
  if (!db) return empty;

  // Candidates: not yet recognized, not reversed
  const candidates = await db
    .select()
    .from(trustDeferredIncome)
    .where(
      and(
        isNull(trustDeferredIncome.recognizedAt),
        isNull(trustDeferredIncome.reversedAt)
      )
    );

  let recognized = 0;
  let totalAmt = 0;
  let skipNoDate = 0;
  let skipNoMatch = 0;
  let skipCancelled = 0;

  // F1 塊B 對抗審查 P1 修復:最後一道防線——booking 已 cancelled(退款流程
  // 轉態)但遞延列還沒被 reverseDeferral 標記 reversed(例如 post-commit 沖銷
  // 失敗、或還沒收到 webhook)的殘留態,認列前先擋下,不把已退款的錢當收入。
  // 批次撈,不逐列查(N+1)。
  const readyBookingIds = candidates
    .filter((r) => r.bookingId && isRecognitionDue(r.expectedRecognitionDate ? String(r.expectedRecognitionDate) : null, today))
    .map((r) => r.bookingId as number);
  const cancelledBookingIds = new Set<number>();
  if (readyBookingIds.length > 0) {
    const bookingRows = await db
      .select({ id: bookings.id, bookingStatus: bookings.bookingStatus })
      .from(bookings)
      .where(inArray(bookings.id, readyBookingIds));
    for (const b of bookingRows) {
      if (b.bookingStatus === "cancelled") cancelledBookingIds.add(b.id);
    }
  }

  for (const r of candidates) {
    if (!r.expectedRecognitionDate) {
      skipNoDate++;
      continue;
    }
    if (!r.bookingId) {
      // Without a matched booking we can't know the departure date for sure.
      // Leave for Jeff to manually link.
      skipNoMatch++;
      continue;
    }
    // §17550 認列時點單一函式(isRecognitionDue):出發前不可認列。
    if (!isRecognitionDue(String(r.expectedRecognitionDate), today)) continue; // not yet
    if (cancelledBookingIds.has(r.bookingId)) {
      skipCancelled++;
      continue;
    }
    await db
      .update(trustDeferredIncome)
      .set({
        recognizedAt: new Date(),
        recognitionRunId: runId,
      })
      .where(eq(trustDeferredIncome.id, r.id));
    recognized++;
    totalAmt += parseFloat(r.amount as any) || 0;
  }

  console.log(
    `[trust-deferral] run=${runId} scanned=${candidates.length} recognized=${recognized} skippedNoDate=${skipNoDate} skippedNoMatch=${skipNoMatch} skippedCancelled=${skipCancelled} totalAmt=${totalAmt.toFixed(2)}`
  );

  return {
    runId,
    scanned: candidates.length,
    recognized,
    totalRecognizedAmount: totalAmt,
    skippedNoDepartureDate: skipNoDate,
    skippedNotMatched: skipNoMatch,
    skippedCancelledBooking: skipCancelled,
  };
}

/**
 * Admin override: manually link an unmatched deferred row to a booking.
 * Recomputes expectedRecognitionDate from booking.departureDate.
 */
export async function linkInflowToBooking(opts: {
  deferredId: number;
  bookingId: number;
}): Promise<{ success: boolean; expectedRecognitionDate: string | null }> {
  const db = await getDb();
  if (!db) return { success: false, expectedRecognitionDate: null };

  // Get departureDate via bookings → tourDepartures join + the deferred
  // row's depositDate for early-recognition check
  const [booking] = await db
    .select({ departureDate: tourDepartures.departureDate })
    .from(bookings)
    .leftJoin(tourDepartures, eq(bookings.departureId, tourDepartures.id))
    .where(eq(bookings.id, opts.bookingId))
    .limit(1);

  const [deferred] = await db
    .select({ depositDate: trustDeferredIncome.depositDate })
    .from(trustDeferredIncome)
    .where(eq(trustDeferredIncome.id, opts.deferredId))
    .limit(1);

  let expectedRecognitionDate: string | null = null;
  if (booking?.departureDate && deferred?.depositDate) {
    expectedRecognitionDate = computeExpectedRecognitionDate(
      String(booking.departureDate),
      String(deferred.depositDate),
    );
  }

  await db
    .update(trustDeferredIncome)
    .set({
      bookingId: opts.bookingId,
      matchMethod: "manual",
      matchConfidence: 100,
      expectedRecognitionDate: expectedRecognitionDate as any,
    })
    .where(eq(trustDeferredIncome.id, opts.deferredId));

  return { success: true, expectedRecognitionDate };
}

/**
 * Admin override: mark a deferred row as reversed (booking cancelled,
 * refund processed). Never recognized. Subtracts from trust reconciliation.
 */
export async function reverseDeferral(opts: {
  deferredId: number;
  reason: string;
}): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) return { success: false };
  // F2 塊A(P3 修正:塊B 回令 #1):UPDATE 前先 SELECT 快照供稽核 —— 順序調換
  // 零成本,且防未來有人在 reverse 時順手動 amount 欄造成稽核值失真。快照失敗
  // 不擋主流程(稽核明細降級為 null)。
  let snapshot: { amount: string | null; bookingId: number | null } = {
    amount: null,
    bookingId: null,
  };
  try {
    const [row] = await db
      .select({ amount: trustDeferredIncome.amount, bookingId: trustDeferredIncome.bookingId })
      .from(trustDeferredIncome)
      .where(eq(trustDeferredIncome.id, opts.deferredId))
      .limit(1);
    if (row) snapshot = { amount: row.amount, bookingId: row.bookingId };
  } catch {
    // 快照僅供稽核明細;讀失敗照樣 reverse,不因稽核前置查詢擋財務主流程。
  }

  await db
    .update(trustDeferredIncome)
    .set({
      reversedAt: new Date(),
      reversedReason: opts.reason.slice(0, 256),
    })
    .where(eq(trustDeferredIncome.id, opts.deferredId));

  // F2 塊A:撤銷遞延(取消/退款)是財務動作,留系統稽核軌。fire-and-forget
  // + .catch 雙保險,絕不影響 reverseDeferral 呼叫端。
  void systemAudit("system:trustDeferral", "trust.reverse", opts.deferredId, {
    amount: snapshot.amount,
    bookingId: snapshot.bookingId,
    reason: opts.reason,
  }).catch(() => {});

  return { success: true };
}

// ─── Manual-override deferral sync (2026-05-29) ──────────────────────────────
//
// The AGENT path calls processTrustInflow when it classifies a trust inflow as
// income_booking. The MANUAL override path (plaidRouter.transactionUpdate) used
// to write jeffOverrideCategory WITHOUT touching the deferral ledger — so a
// hand-marked trust deposit never created a deferred row and got counted as
// income immediately, violating CST §17550 for long-lead bookings. These
// helpers let the override path keep the ledger in step.
//
// Single source of truth for "should a deferred row exist?": the txn's
// EFFECTIVE category is income_booking AND it is not excluded from accounting.

/**
 * Effective accounting category = Jeff's manual override when set, else the
 * agent's category. An empty-string / null override falls back to the agent.
 */
export function effectiveCategory(
  jeffOverride: string | null | undefined,
  agentCategory: string | null | undefined
): string | null {
  if (jeffOverride && jeffOverride !== "") return jeffOverride;
  return agentCategory ?? null;
}

/**
 * A trust deferred-income row should exist for a bank txn iff its effective
 * category is income_booking and it is not excluded from accounting. Pure.
 */
export function shouldHaveDeferral(opts: {
  effectiveCategory: string | null;
  excluded: boolean;
}): boolean {
  return !opts.excluded && opts.effectiveCategory === "income_booking";
}

export type DeferralSyncAction = "create" | "reverse" | "noop";

/**
 * Decide whether a manual override needs to create, reverse, or leave alone the
 * deferred row, by comparing the "should-defer" predicate before vs after the
 * edit. Pure — no DB, no env reads beyond the `enabled` flag passed in.
 *
 * Note: this decides INTENT from category/exclude only. The trust-account +
 * inflow guard lives in processTrustInflow (the create side) and the
 * row-existence check lives in reverseDeferralForTransaction (the reverse
 * side), so a "create"/"reverse" on a non-trust or non-inflow txn is a safe
 * no-op at the DB layer. The important invariant is that this never returns
 * "noop" when the booking-ness of the effective category actually flipped.
 */
export function decideDeferralSync(opts: {
  enabled: boolean;
  before: { effectiveCategory: string | null; excluded: boolean };
  after: { effectiveCategory: string | null; excluded: boolean };
}): { action: DeferralSyncAction; reason: string } {
  if (!opts.enabled) {
    return { action: "noop", reason: "trust deferral disabled" };
  }
  const had = shouldHaveDeferral(opts.before);
  const wants = shouldHaveDeferral(opts.after);
  if (wants && !had) {
    return { action: "create", reason: "now income_booking (non-excluded)" };
  }
  if (had && !wants) {
    return {
      action: "reverse",
      reason: "no longer income_booking (changed away or excluded)",
    };
  }
  return { action: "noop", reason: "deferral state unchanged" };
}

/**
 * Reverse the active (unrecognized, unreversed) deferred row for a bank
 * transaction, if one exists. Used when a manual override moves a trust inflow
 * AWAY from income_booking (or excludes it). Idempotent: a second call finds no
 * active row and no-ops. Recognized rows are left untouched — the income is
 * already booked and reversing here would not un-recognize it.
 */
export async function reverseDeferralForTransaction(opts: {
  bankTransactionId: number;
  reason: string;
}): Promise<{ reversed: boolean; deferredId: number | null; reason: string }> {
  const db = await getDb();
  if (!db) return { reversed: false, deferredId: null, reason: "db unavailable" };
  const [existing] = await db
    .select({ id: trustDeferredIncome.id })
    .from(trustDeferredIncome)
    .where(
      and(
        eq(trustDeferredIncome.bankTransactionId, opts.bankTransactionId),
        isNull(trustDeferredIncome.recognizedAt),
        isNull(trustDeferredIncome.reversedAt)
      )
    )
    .limit(1);
  if (!existing) {
    return { reversed: false, deferredId: null, reason: "no active deferred row" };
  }
  await reverseDeferral({ deferredId: existing.id, reason: opts.reason });
  return { reversed: true, deferredId: existing.id, reason: "reversed" };
}

/**
 * Orchestrate the deferral ledger update for a manual category/exclude override.
 * Called by plaidRouter.transactionUpdate AFTER the bank-transaction row is
 * written. Best-effort: callers should not let a deferral-sync failure roll
 * back the (already committed) category change.
 */
export async function syncDeferralForManualOverride(input: {
  bankTransactionId: number;
  before: { effectiveCategory: string | null; excluded: boolean };
  after: { effectiveCategory: string | null; excluded: boolean };
  reason?: string;
}): Promise<{ action: DeferralSyncAction; reason: string; deferredId: number | null }> {
  const decision = decideDeferralSync({
    enabled: isTrustDeferralEnabled(),
    before: input.before,
    after: input.after,
  });
  if (decision.action === "create") {
    const r = await processTrustInflow(input.bankTransactionId);
    return { action: "create", reason: r.reason, deferredId: r.deferredId };
  }
  if (decision.action === "reverse") {
    const r = await reverseDeferralForTransaction({
      bankTransactionId: input.bankTransactionId,
      reason:
        input.reason ?? "manual override moved txn out of income_booking",
    });
    return { action: "reverse", reason: r.reason, deferredId: r.deferredId };
  }
  return { action: "noop", reason: decision.reason, deferredId: null };
}

/**
 * Compute outstanding (unrecognized, unreversed) trust amount for a
 * given linked account. Used for CST §17550 reconciliation:
 *
 *   linkedBankAccounts.currentBalance SHOULD equal
 *   sum(trustDeferredIncome.amount WHERE recognizedAt IS NULL AND reversedAt IS NULL)
 *
 * If they diverge, something's wrong — un-matched deposits, manual
 * trust withdrawals not yet recorded, etc.
 */
export interface OutstandingTrustSummary {
  totalOutstanding: number;
  rowCount: number;
  unmatchedCount: number;
  unmatchedTotal: number;
}

/** Minimal row shape foldOutstandingTrust reads. */
export interface TrustDeferredRowLike {
  amount: string | number | null;
  bookingId?: number | null;
}

/**
 * Pure summation over already-fetched (unrecognized, non-reversed) deferred
 * rows. Split out from computeOutstandingTrust (M5, 2026-05-28) so the
 * outstanding / unmatched math is unit-testable without a DB — same pattern
 * as bankPLService.foldBankPLRows. Caller is responsible for filtering rows
 * to recognizedAt IS NULL AND reversedAt IS NULL before passing them in.
 */
export function foldOutstandingTrust(
  rows: TrustDeferredRowLike[]
): OutstandingTrustSummary {
  let total = 0;
  let unmatchedTotal = 0;
  let unmatchedCount = 0;
  for (const r of rows) {
    const a = parseFloat(r.amount as any) || 0;
    total += a;
    if (!r.bookingId) {
      unmatchedTotal += a;
      unmatchedCount++;
    }
  }
  return {
    totalOutstanding: total,
    rowCount: rows.length,
    unmatchedCount,
    unmatchedTotal,
  };
}

export async function computeOutstandingTrust(
  linkedAccountId: number
): Promise<OutstandingTrustSummary> {
  const db = await getDb();
  if (!db) {
    return { totalOutstanding: 0, rowCount: 0, unmatchedCount: 0, unmatchedTotal: 0 };
  }
  const rows = await db
    .select()
    .from(trustDeferredIncome)
    .where(
      and(
        eq(trustDeferredIncome.linkedAccountId, linkedAccountId),
        isNull(trustDeferredIncome.recognizedAt),
        isNull(trustDeferredIncome.reversedAt)
      )
    );
  return foldOutstandingTrust(rows);
}

/**
 * Total amount currently deferred (not yet recognized) — used by
 * bankPLService to subtract from monthly income when trust deferral is on.
 *
 * 2026-05-22 — userId now optional. Single-tenant PACK&GO aggregates across
 * every active linked trust account. Jeff: 「放在trust account 是客人訂金
 * 不能算我的, 除非真的跑到我的checking」.
 *
 * 2026-05-23 — added `depositSince` to scope the subtraction to a SPECIFIC
 * period. Without it, the cumulative deferred amount (e.g. $8,908) was
 * being subtracted from each month's gross income — incorrectly turning
 * "本月賺" negative because prior months' deferrals got re-counted.
 *
 * Correct semantics:
 *   - Per-month P&L → pass `depositSince = startDate` so we only subtract
 *     this month's NEW trust deposits (matches the income_booking we just
 *     summed for the period).
 *   - YTD report → pass `depositSince = jan-1` for the same reason.
 *   - "what's currently locked in trust" tile → omit depositSince to get
 *     the full unrecognized cumulative balance.
 */
export async function totalDeferredForUser(opts: {
  userId?: number;
  asOfDate: string;     // YYYY-MM-DD — include deposits up to (and including) this date
  depositSince?: string; // optional YYYY-MM-DD — only deposits ON/AFTER this date
  /** F2 塊D(2026-07-10)P&L 接線:true = 連「後來已認列」的列也算(存入當下
   *  就不是收入 —— 存入期減項要穩定,不因日後認列而讓歷史月收入漂回)。
   *  預設 false 保持既有呼叫端(financeAlertProducer 等「目前未認列餘額」
   *  口徑)byte-identical。 */
  includeRecognized?: boolean;
}): Promise<number> {
  // F1 塊B 對抗審查 P1 修復:同 recognizeReadyDepartures,認列/查詢路徑要看
  // 「任一」遞延機制的 flag,不能只看 PLAID flag(否則 STRIPE-only 開啟時,
  // 這支函式對 Stripe-direct 列永遠回 0,即使 flag 已經開了)。
  //
  // ⚠ 已知限制(docs/features/finance-dept/progress.md「重大已知限制」段):
  // 下面的 eq(linkedBankAccounts.isActive,1) 是 INNER JOIN 語意的過濾條件,
  // Stripe-direct 列的 linkedAccountId=0(sentinel,無對應真實帳戶)join 不到
  // 任何 linkedBankAccounts 列,仍然會被這個條件排除——這是另一個獨立問題
  // (sentinel ID 對不上真實帳戶,不是 flag 判斷錯誤),F1 不修,留 F2。
  if (!isAnyTrustDeferralEnabled()) return 0;
  const db = await getDb();
  if (!db) return 0;
  // Deferred = deposited within [depositSince, asOfDate], not yet recognized, not reversed
  const filters: any[] = [
    eq(linkedBankAccounts.isActive, 1),
    lte(trustDeferredIncome.depositDate, opts.asOfDate as any),
    isNull(trustDeferredIncome.reversedAt),
  ];
  if (!opts.includeRecognized) {
    filters.push(isNull(trustDeferredIncome.recognizedAt));
  }
  if (opts.depositSince) {
    filters.push(gte(trustDeferredIncome.depositDate, opts.depositSince as any));
  }
  if (opts.userId !== undefined) {
    filters.push(eq(linkedBankAccounts.userId, opts.userId));
  }
  const rows = await db
    .select({
      amount: trustDeferredIncome.amount,
      ownerUserId: linkedBankAccounts.userId,
    })
    .from(trustDeferredIncome)
    .leftJoin(
      linkedBankAccounts,
      eq(trustDeferredIncome.linkedAccountId, linkedBankAccounts.id)
    )
    .where(and(...filters));
  let total = 0;
  for (const r of rows) {
    total += parseFloat(r.amount as any) || 0;
  }
  return total;
}

// ─── F2 塊D(2026-07-10):認列期收入(flag-ON P&L 接線)─────────────────────

/** 任意時點 → America/Los_Angeles 曆日字串(T2 地雷 #2:月界歸屬的比較兩端
 *  都用 LA 曆日;recognizedAt 是 UTC TIMESTAMP,美西傍晚認列若用 UTC 切日
 *  會系統性歸到隔月)。 */
export function laDayOf(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export interface RecognizedRowLike {
  amount: string | number;
  recognizedAt: Date | string | null;
  linkedAccountId: number;
  /** left join linkedBankAccounts 的結果;哨兵列(linkedAccountId=0)join 不到
   *  → 兩者皆 null。 */
  ownerUserId: number | null;
  accountIsActive: number | null;
}

/**
 * 純函式:本期(LA 曆日 [startDate, endDate])認列的遞延收入加總。
 * 收列規則:
 *   - recognizedAt 的 LA 曆日落在期間內;
 *   - 哨兵列(linkedAccountId=0,Stripe-direct)一律計入 —— 這批收入沒有
 *     銀行入帳列,認列加回是它進 P&L 的唯一入口(「不再依賴 checkout 當下
 *     的次帳」);userId scope 對哨兵列不適用(單一公司,無 per-user 歸屬);
 *   - 真實帳戶列要求帳戶 isActive=1,且 userId 有給時要相符(與
 *     totalDeferredForUser 的 join 語意一致)。
 * caller 合約:傳入的列已過濾 recognizedAt IS NOT NULL AND reversedAt IS NULL。
 */
export function sumRecognizedInPeriodLA(
  rows: RecognizedRowLike[],
  startDate: string,
  endDate: string,
  userId?: number,
): number {
  let total = 0;
  for (const r of rows) {
    if (!r.recognizedAt) continue;
    const day = laDayOf(new Date(r.recognizedAt as any));
    if (day < startDate || day > endDate) continue;
    if (r.linkedAccountId !== 0) {
      if (r.accountIsActive !== 1) continue;
      if (userId !== undefined && r.ownerUserId !== userId) continue;
    }
    total += parseFloat(r.amount as any) || 0;
  }
  return total;
}

/**
 * 本期認列的遞延收入(IO 殼)。generateBankPL 在認列期把它加回 income
 * (存入期已由 totalDeferredForUser(includeRecognized:true) 減去)。
 * gate:isAnyTrustDeferralEnabled —— STRIPE-only 開啟時 Stripe-direct 認列
 * 列也要進 P&L,不能只看 PLAID flag(F1 塊B P1 同款教訓)。flag 全 OFF 回 0,
 * P&L 輸出 byte-identical。
 * 取數:撈全部已認列未撤銷列(一人公司量級,認列列數小),LA 曆日過濾在
 * 純函式做(避免 raw SQL DATE() 進 sqlRehearsal 登記面;也避開 UTC 切日的
 * 月界歸屬錯)。
 */
export async function recognizedTrustIncomeInPeriod(opts: {
  userId?: number;
  startDate: string;
  endDate: string;
}): Promise<number> {
  if (!isAnyTrustDeferralEnabled()) return 0;
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({
      amount: trustDeferredIncome.amount,
      recognizedAt: trustDeferredIncome.recognizedAt,
      linkedAccountId: trustDeferredIncome.linkedAccountId,
      ownerUserId: linkedBankAccounts.userId,
      accountIsActive: linkedBankAccounts.isActive,
    })
    .from(trustDeferredIncome)
    .leftJoin(
      linkedBankAccounts,
      eq(trustDeferredIncome.linkedAccountId, linkedBankAccounts.id)
    )
    .where(
      and(
        isNotNull(trustDeferredIncome.recognizedAt),
        isNull(trustDeferredIncome.reversedAt)
      )
    );
  return sumRecognizedInPeriodLA(
    rows as RecognizedRowLike[],
    opts.startDate,
    opts.endDate,
    opts.userId,
  );
}
