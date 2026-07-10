/**
 * processorPayoutMapping — F2 塊C(2026-07-10):處理商撥款 ↔ 銷售對映
 * (人工確認式 v1,Square 先行、結構同時涵蓋 Stripe)。
 *
 * 原理:撥款金額 = 銷售金額 − 手續費。手續費率有已知帶(Square 卡面對面
 * 2.6%+10¢、線上 2.9%+30¢;Stripe 同量級),故「銷售 − 撥款」的隱含費率落在
 * 合理帶內 + 日期臨近 = 一個值得 Jeff 看的候選。
 *
 * 人工確認式(dispatch 塊C #3;自動對映留待真資料量夠):
 *   - 本模組只「找候選」,絕不寫任何東西 —— 撥款入帳走既有待認領流程
 *     (bankTransactionLinkEngine → pending_claim 卡),卡上帶出這裡算的
 *     費率帶候選,Jeff 在待認領頁用既有 ClaimDialog 把撥款 claim 給
 *     custom_order(bankTransactionLinks 多對多 + amountAllocated 就是對映
 *     結構本體,零新表零 migration);手續費差額由 Jeff 認領時在 note 註記
 *     或另掛 cogs_other。
 *   - 防雙計原則同 Stripe:一筆撥款 claim 給訂單後,SUM(amountAllocated)
 *     守恆(linkEngine 既有不變式)擋重複認領;銷售側(customOrders
 *     recordPayment)是訂單真相不是 P&L,不構成雙計。
 *
 * 探真(2026-07-10,prod):Square 銷售紀錄極稀(customOrders square 2 筆),
 * 候選常為空 —— 空候選是誠實狀態,卡片照出、Jeff 照判,資料紀律成熟後
 * 候選命中率自然上來,到量再開自動對映。
 *
 * LLM usage: ZERO。
 */

import { getDb } from "../db";
import { customOrders } from "../../drizzle/schema";
import { createChildLogger } from "../_core/logger";
import { dateOnly } from "./trustOutstandingSplit";

const log = createChildLogger({ module: "processorPayoutMapping" });

// ─── env 旋鈕 ────────────────────────────────────────────────────────────────

/** 隱含費率下限(預設 1%:低於此更像「本來就同額」而非扣費撥款)。 */
export function payoutFeeMinPct(): number {
  const n = Number(process.env.PAYOUT_FEE_MIN_PCT);
  return Number.isFinite(n) && n >= 0 ? n : 0.01;
}

/** 隱含費率上限(預設 5%:高於此不像正常處理商費率)。 */
export function payoutFeeMaxPct(): number {
  const n = Number(process.env.PAYOUT_FEE_MAX_PCT);
  return Number.isFinite(n) && n > 0 ? n : 0.05;
}

/** 銷售收款日到撥款落地日的允許天數(Square 標準 1-2 個工作天,寬留 7)。 */
export function payoutDateWindowDays(): number {
  const n = Number(process.env.PAYOUT_DATE_WINDOW_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

// ─── 純函式:費率帶候選 ─────────────────────────────────────────────────────

/** 一筆已收款的銷售腿(customOrders 的 deposit 或 balance)。 */
export interface SaleLegLike {
  orderId: number;
  orderNumber: string;
  legKind: "deposit" | "balance";
  amountCents: number;
  /** 'YYYY-MM-DD' 收款曆日。 */
  paidDate: string;
}

export interface PayoutSaleCandidate {
  processor: "square" | "stripe";
  rule: "single" | "day_group";
  orderIds: number[];
  orderNumbers: string[];
  legKinds: string[];
  saleTotalCents: number;
  impliedFeeCents: number;
  /** 隱含費率(0-1)。 */
  impliedFeePct: number;
  paidDate: string;
}

/** 標準線上費率(2.9%),候選按 |隱含費率 − 標準| 排序,最像的排最前。 */
const TYPICAL_FEE_PCT = 0.029;

function feeOk(saleCents: number, payoutCents: number, minPct: number, maxPct: number): boolean {
  if (saleCents <= payoutCents) return false; // 撥款必須小於銷售(扣了費)
  const fee = saleCents - payoutCents;
  const pct = fee / saleCents;
  return pct >= minPct && pct <= maxPct;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * 費率帶候選(純函式)。兩條規則:
 *   1. single:單腿銷售 − 撥款 的隱含費率落帶內,收款日在撥款日前 N 天內。
 *   2. day_group:同收款曆日的多腿加總(Square 按日批次撥款的慣例)費率落帶。
 * 只回候選、不做決定;按 |隱含費率 − 2.9%| 升冪排序。
 */
export function findPayoutSaleCandidates(
  payout: { amountCents: number; date: string; processor: "square" | "stripe" },
  sales: SaleLegLike[],
  opts?: { feeMinPct?: number; feeMaxPct?: number; dateWindowDays?: number },
): PayoutSaleCandidate[] {
  const minPct = opts?.feeMinPct ?? payoutFeeMinPct();
  const maxPct = opts?.feeMaxPct ?? payoutFeeMaxPct();
  const windowDays = opts?.dateWindowDays ?? payoutDateWindowDays();

  const inWindow = sales.filter(
    (s) =>
      s.paidDate <= payout.date && // 先收款後撥款
      daysBetween(s.paidDate, payout.date) <= windowDays &&
      s.amountCents > 0,
  );

  const candidates: PayoutSaleCandidate[] = [];

  // 規則 1:單腿
  for (const s of inWindow) {
    if (!feeOk(s.amountCents, payout.amountCents, minPct, maxPct)) continue;
    const fee = s.amountCents - payout.amountCents;
    candidates.push({
      processor: payout.processor,
      rule: "single",
      orderIds: [s.orderId],
      orderNumbers: [s.orderNumber],
      legKinds: [s.legKind],
      saleTotalCents: s.amountCents,
      impliedFeeCents: fee,
      impliedFeePct: fee / s.amountCents,
      paidDate: s.paidDate,
    });
  }

  // 規則 2:同收款曆日加總(>1 腿才有意義,單腿已在規則 1)
  const byDay = new Map<string, SaleLegLike[]>();
  for (const s of inWindow) {
    const g = byDay.get(s.paidDate) ?? [];
    g.push(s);
    byDay.set(s.paidDate, g);
  }
  for (const [day, legs] of byDay.entries()) {
    if (legs.length < 2) continue;
    const total = legs.reduce((t, s) => t + s.amountCents, 0);
    if (!feeOk(total, payout.amountCents, minPct, maxPct)) continue;
    const fee = total - payout.amountCents;
    candidates.push({
      processor: payout.processor,
      rule: "day_group",
      orderIds: legs.map((s) => s.orderId),
      orderNumbers: legs.map((s) => s.orderNumber),
      legKinds: legs.map((s) => s.legKind),
      saleTotalCents: total,
      impliedFeeCents: fee,
      impliedFeePct: fee / total,
      paidDate: day,
    });
  }

  return candidates.sort(
    (a, b) => Math.abs(a.impliedFeePct - TYPICAL_FEE_PCT) - Math.abs(b.impliedFeePct - TYPICAL_FEE_PCT),
  );
}

// ─── IO:撥款候選(Square)─────────────────────────────────────────────────

/**
 * 給一筆疑似 Square 撥款的入帳找費率帶候選銷售。讀 customOrders 中
 * paymentMethod 含 square、近窗內有已收款腿的訂單。絕不 throw(降級空陣列,
 * 待認領卡照出、只是沒有候選)。
 */
export async function findSquarePayoutSaleCandidates(payout: {
  amountCents: number;
  date: string;
}): Promise<PayoutSaleCandidate[]> {
  try {
    const db = await getDb();
    if (!db) return [];
    // 小表全撈近期列(customOrders 一人公司量級),過濾在 JS 層做 ——
    // paymentMethod 自由文字('square'/'Square'),LIKE 語義在應用層更透明。
    const rows = await db
      .select({
        id: customOrders.id,
        orderNumber: customOrders.orderNumber,
        paymentMethod: customOrders.paymentMethod,
        depositPaidAt: customOrders.depositPaidAt,
        depositPaidAmount: customOrders.depositPaidAmount,
        balancePaidAt: customOrders.balancePaidAt,
        balancePaidAmount: customOrders.balancePaidAmount,
      })
      .from(customOrders);

    const legs: SaleLegLike[] = [];
    for (const r of rows) {
      if (!String(r.paymentMethod ?? "").toLowerCase().includes("square")) continue;
      if (r.depositPaidAt && r.depositPaidAmount) {
        legs.push({
          orderId: r.id,
          orderNumber: r.orderNumber,
          legKind: "deposit",
          amountCents: Math.round((parseFloat(String(r.depositPaidAmount)) || 0) * 100),
          paidDate: dateOnly(r.depositPaidAt as any) ?? "",
        });
      }
      if (r.balancePaidAt && r.balancePaidAmount) {
        legs.push({
          orderId: r.id,
          orderNumber: r.orderNumber,
          legKind: "balance",
          amountCents: Math.round((parseFloat(String(r.balancePaidAmount)) || 0) * 100),
          paidDate: dateOnly(r.balancePaidAt as any) ?? "",
        });
      }
    }
    return findPayoutSaleCandidates({ ...payout, processor: "square" }, legs);
  } catch (err) {
    log.error({ err }, "[processorPayoutMapping] candidate lookup failed (degraded to [])");
    return [];
  }
}
