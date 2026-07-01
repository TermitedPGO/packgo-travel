/**
 * customOrderWatchdog — 客戶頁駕駛艙 Step 5 看門狗:純 deterministic 規則(零 LLM,
 * 規則不是判斷,所以準)。絕不自動改、絕不自動送、絕不上客人文件(admin-only)。
 *
 * 規則一(漏價):對每張 customOrders 算 margin = (售價 − 成本) / 售價,把賠錢
 * (David 那種)/ 毛利過薄的單攔下來,只把兩個數字攤給 Jeff。
 *
 * 規則二/三(v2,答應了還沒寄):說好的報價超過 7 天沒寄、訂金收了超過 3 天
 * 確認書沒寄。全部從訂單自己的時間戳算(quoteSentAt / depositPaidAt / confirmedAt
 * 是 sendQuote / sendConfirmation / recordPayment 寫的真時間),寧可漏報不可誤報
 * (requirements.md §四.3)。
 *
 * 誠實邊界(plan.md §五 Step 5 / docs/features/customer-cockpit/step5-watchdog.md):
 *   - supplierCost 是手動估值不是真 invoice → 只在「售價 + 成本都有」時叫,缺一個就停。
 *   - 漏價規則跳過 draft(數字還在喬)、cancelled(不相關)。
 *   - totalPrice <= 0 → 停(防除以零 / 壞資料)。
 *   - 同一張單售價跟成本共用 currency 欄,沒有跨幣別問題(若日後拆,照 supplierMargin
 *     的 currencyMismatch:不換匯不假算)。
 *   - 承諾規則:日期缺就不叫;狀態被手動推進(= 事情已在系統外處理)就不叫。
 *
 * 算法 + 門檻沿用 server/services/supplierMargin.ts。
 */

/** 看門狗門檻:毛利低於此(15%)= 黃燈。沿用 supplierMargin 稽核。 */
export const WATCHDOG_MARGIN_THRESHOLD = 0.15;

/** 說好的報價(needsQuote)超過幾天沒寄 = 黃燈。以 createdAt 起算,LA 曆日。 */
export const WATCHDOG_QUOTE_PROMISE_DAYS = 7;

/** 訂金收了超過幾天確認書沒寄 = 黃燈。以 depositPaidAt 起算,LA 曆日。 */
export const WATCHDOG_CONFIRMATION_PROMISE_DAYS = 3;

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
  /** 判別欄:漏價類 finding(front-end 靠這個跟 promise 類分流)。 */
  kind: "margin";
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
    kind: "margin",
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

// ── v2:答應了還沒寄(promise 規則)────────────────────────────────────────────

export type OrderPromiseReason = "quoteUnsent" | "confirmationUnsent";

export type OrderPromiseFinding = {
  /** 判別欄:承諾類 finding。 */
  kind: "promise";
  orderId: number;
  orderNumber: string;
  title: string;
  status: string;
  /** 承諾類一律黃燈(提醒,不是財務紅線)。 */
  level: "yellow";
  reason: OrderPromiseReason;
  /** 從承諾起算日(createdAt / depositPaidAt)到現在的 LA 曆日差。 */
  daysWaiting: number;
};

/** 看門狗 findings 聯集(watchdogForCustomer 回傳的元素型別)。 */
export type WatchdogFinding = OrderMarginFinding | OrderPromiseFinding;

export type OrderPromiseInput = {
  id: number;
  orderNumber: string;
  title: string;
  status: string;
  /** DB 是 int 0/1;list 投影是 boolean。兩種都吃。 */
  needsQuote: number | boolean | null;
  quoteSentAt: Date | string | null;
  depositPaidAt: Date | string | null;
  confirmedAt: Date | string | null;
  createdAt: Date | string | null;
};

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 把時間點落到 America/Los_Angeles 的曆日(YYYY-MM-DD)。給 Jeff 看的日期一律 LA。 */
function laDay(d: Date): string {
  // en-CA 產 ISO 形 YYYY-MM-DD;timeZone 做偏移(照 client adapters.ts laToday)。
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

const DAY_MS = 86_400_000;

/** 兩個時間點的 LA 曆日差(to − from,單位:天)。 */
function laDayDiff(from: Date, to: Date): number {
  // 兩邊都是 YYYY-MM-DD → Date.parse 一律當 UTC 午夜,相減即曆日差。
  return Math.round((Date.parse(laDay(to)) - Date.parse(laDay(from))) / DAY_MS);
}

/**
 * 單張單的承諾規則(答應了還沒寄)。回傳 finding 或 null(不適用 / 沒過期 /
 * 資料缺 → 誠實不叫)。兩條規則的適用狀態互斥,所以最多回一條。
 *
 * 規則二(說好的報價還沒寄):needsQuote 且從未 sendQuote(quoteSentAt 空),
 * 單齡超過 7 天。只看 draft —— 一旦狀態被推進(quoted/arranged/...),表示報價
 * 已在系統外處理或不再需要(手動 updateStatus 不寫 quoteSentAt),叫了就是誤報。
 *
 * 規則三(訂金收了確認書還沒寄):depositPaidAt 有(recordPayment 寫的錢的真相)、
 * confirmedAt 空(sendConfirmation 從沒跑過),超過 3 天。只看 deposit_paid / paid ——
 * confirmed+ 表示確認已處理(手動推進不寫 confirmedAt);departed/completed 出發後
 * 確認書已無意義,叫了只是噪音。
 */
export function evaluateOrderPromise(
  order: OrderPromiseInput,
  now: Date = new Date(),
): OrderPromiseFinding | null {
  const base = {
    kind: "promise" as const,
    orderId: order.id,
    orderNumber: order.orderNumber,
    title: order.title,
    status: order.status,
    level: "yellow" as const,
  };

  if (order.status === "draft") {
    const needsQuote = order.needsQuote === 1 || order.needsQuote === true;
    if (!needsQuote || order.quoteSentAt != null) return null;
    const created = toDate(order.createdAt);
    if (created == null) return null; // 日期缺就不叫
    const days = laDayDiff(created, now);
    if (days <= WATCHDOG_QUOTE_PROMISE_DAYS) return null;
    return { ...base, reason: "quoteUnsent", daysWaiting: days };
  }

  if (order.status === "deposit_paid" || order.status === "paid") {
    if (order.confirmedAt != null) return null;
    const paid = toDate(order.depositPaidAt);
    if (paid == null) return null; // 沒收過訂金 / 日期缺 → 不適用
    const days = laDayDiff(paid, now);
    if (days <= WATCHDOG_CONFIRMATION_PROMISE_DAYS) return null;
    return { ...base, reason: "confirmationUnsent", daysWaiting: days };
  }

  return null; // 其餘狀態(含 cancelled)不適用
}

/**
 * 一個客人所有訂製單的承諾 findings。等最久的在前。
 */
export function findOrderPromiseIssues(
  orders: OrderPromiseInput[],
  now: Date = new Date(),
): OrderPromiseFinding[] {
  return orders
    .map((o) => evaluateOrderPromise(o, now))
    .filter((f): f is OrderPromiseFinding => f !== null)
    .sort((a, b) => b.daysWaiting - a.daysWaiting);
}
