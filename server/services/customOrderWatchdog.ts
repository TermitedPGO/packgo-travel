/**
 * customOrderWatchdog — 客戶頁駕駛艙 Step 5 看門狗第一條:售價 vs 後台成本(漏價)。
 *
 * 純 deterministic 規則(零 LLM,規則不是判斷,所以準)。對每張 customOrders 算
 * margin = (售價 − 成本) / 售價,把賠錢(David 那種)/ 毛利過薄的單攔下來,只把兩個
 * 數字攤給 Jeff,絕不自動改、絕不自動送、絕不上客人文件(admin-only)。
 *
 * 誠實邊界(plan.md §五 Step 5 / docs/features/customer-cockpit/step5-watchdog.md):
 *   - supplierCost 是手動估值不是真 invoice → 只在「售價 + 成本都有」時叫,缺一個就停。
 *   - 跳過 draft(數字還在喬)、cancelled(不相關)。
 *   - totalPrice <= 0 → 停(防除以零 / 壞資料)。
 *   - 同一張單售價跟成本共用 currency 欄,沒有跨幣別問題(若日後拆,照 supplierMargin
 *     的 currencyMismatch:不換匯不假算)。
 *
 * 算法 + 門檻沿用 server/services/supplierMargin.ts。
 */

/** 看門狗門檻:毛利低於此(15%)= 黃燈。沿用 supplierMargin 稽核。 */
export const WATCHDOG_MARGIN_THRESHOLD = 0.15;

/** 不檢查的狀態:draft(數字還在喬)、cancelled(不相關)。其餘 quoted→completed 都查。 */
const SKIP_STATUSES = new Set(["draft", "cancelled"]);

/** decimal 欄位 mysql2 回傳 string;這支吃 string | number | null 都行。 */
export type OrderMarginInput = {
  id: number;
  orderNumber: string;
  title: string;
  status: string;
  totalPrice: string | number | null;
  supplierCost: string | number | null;
  currency: string;
};

export type OrderMarginLevel = "red" | "yellow";
export type OrderMarginReason = "loss" | "breakeven" | "thin";

export type OrderMarginFinding = {
  orderId: number;
  orderNumber: string;
  title: string;
  status: string;
  level: OrderMarginLevel;
  reason: OrderMarginReason;
  /** 售價(直客價),已轉 number。 */
  totalPrice: number;
  /** 後台成本(手動),已轉 number。admin-only,絕不上客人文件。 */
  supplierCost: number;
  currency: string;
  /** (售價 − 成本) / 售價,四捨五入 3 位。負 = 賠錢。 */
  marginPct: number;
};

function toNum(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * 單張單的規則。回傳 finding(紅/黃)或 null(沒事 / 不適用 / 資料不足 → 誠實不叫)。
 * threshold = 黃燈門檻(margin 低於此但 > 0)。
 */
export function evaluateOrderMargin(
  order: OrderMarginInput,
  threshold: number = WATCHDOG_MARGIN_THRESHOLD,
): OrderMarginFinding | null {
  if (SKIP_STATUSES.has(order.status)) return null;

  const total = toNum(order.totalPrice);
  const cost = toNum(order.supplierCost);
  // 兩個數字都要有才比得起來;缺一個就停(誠實,不亂猜)。
  if (total == null || cost == null) return null;
  if (cost < 0) return null; // 壞資料
  if (total <= 0) return null; // 防除以零 / 壞資料

  const marginPct = Math.round(((total - cost) / total) * 1000) / 1000;

  let level: OrderMarginLevel;
  let reason: OrderMarginReason;
  if (marginPct < 0) {
    level = "red";
    reason = "loss"; // 賠錢出團(David 那種)
  } else if (marginPct === 0) {
    level = "red";
    reason = "breakeven"; // 零毛利
  } else if (marginPct < threshold) {
    level = "yellow";
    reason = "thin"; // 毛利過薄
  } else {
    return null; // 健康,不叫
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    title: order.title,
    status: order.status,
    level,
    reason,
    totalPrice: total,
    supplierCost: cost,
    currency: order.currency,
    marginPct,
  };
}

/**
 * 一個客人所有訂製單的 findings。紅燈在前,再按 margin 由小到大(最賠錢的最上面)。
 */
export function findOrderMarginIssues(
  orders: OrderMarginInput[],
  threshold: number = WATCHDOG_MARGIN_THRESHOLD,
): OrderMarginFinding[] {
  const findings = orders
    .map((o) => evaluateOrderMargin(o, threshold))
    .filter((f): f is OrderMarginFinding => f !== null);

  return findings.sort((a, b) => {
    if (a.level !== b.level) return a.level === "red" ? -1 : 1; // 紅在前
    return a.marginPct - b.marginPct; // 最差(最小 margin)在前
  });
}
