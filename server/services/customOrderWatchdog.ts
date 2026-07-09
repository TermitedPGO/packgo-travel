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
 *   - 承諾規則:日期缺就不叫;狀態被手動推進(= 事情已在系統外處理)就不叫;
 *     visa 單確認書規則豁免(沒有確認單交付物,見 WATCHDOG_CONFIRMATION_EXEMPT_CATEGORIES)。
 *
 * 算法 + 門檻沿用 server/services/supplierMargin.ts。
 */

/** 看門狗門檻:毛利低於此(15%)= 黃燈。沿用 supplierMargin 稽核。 */
export const WATCHDOG_MARGIN_THRESHOLD = 0.15;

/** 說好的報價(needsQuote)超過幾天沒寄 = 黃燈。以 createdAt 起算,LA 曆日。 */
export const WATCHDOG_QUOTE_PROMISE_DAYS = 7;

/** 訂金收了超過幾天確認書沒寄 = 黃燈。以 depositPaidAt 起算,LA 曆日。 */
export const WATCHDOG_CONFIRMATION_PROMISE_DAYS = 3;

/**
 * 確認書規則(規則三)的 category 豁免(2026-07-02 加,起因 ORD-2026-0004
 * Jeff Green 中國旅遊簽證誤報):
 *   - visa:簽證單「沒有確認單這種交付物」— 交付物是簽證/護照本身,進度在系統外
 *     手動追。deposit_paid 之後 confirmedAt 永遠不會被寫,叫了就是永遠誤報
 *     (違反本檔第一原則「寧可漏報不可誤報」)。→ 豁免。
 *   - flight 不豁免:機票有出票憑證(確認書即 e-ticket/出票確認),規則照跑。
 *   - quote 不豁免:報價行程單收了訂金本來就該寄確認書。
 *   - general 不豁免(刻意決定,fail-visible):general = 一般諮詢是雜項桶,
 *     一張 general 單真的收到訂金,代表背後有真交付物,確認承諾大概率適用;
 *     豁免它會讓沒分類好的真單永遠沉默。schema(drizzle/schema.ts customOrders.
 *     category)也說 category 是可擴充 varchar、NULL = 未標 — 未標/未知一律照跑,
 *     寧可 Jeff 看一眼手動判定,也不要整桶盲掉。
 *   - category 是 varchar 不是 enum(值由 opsTools CUSTOM_ORDER_CATEGORIES 白名單:
 *     flight/visa/quote/general),未來新 category 預設不豁免,要豁免得回來這裡加。
 * 只影響 confirmationUnsent;quoteUnsent(規則二)不看 category — 簽證單答應了
 * 報價一樣要寄。
 */
export const WATCHDOG_CONFIRMATION_EXEMPT_CATEGORIES: ReadonlySet<string> = new Set([
  "visa",
]);

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

export type OrderPromiseInput = {
  id: number;
  orderNumber: string;
  title: string;
  status: string;
  /** flight/visa/quote/general(opsTools 白名單)或 NULL = 未標。確認書規則的
   *  category 豁免看這欄;必填(不是 optional)— 逼 caller 把欄位餵進來,
   *  漏餵就 compile error,而不是默默退回未豁免行為。 */
  category: string | null;
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
 * 確認書已無意義,叫了只是噪音。category 在豁免名單(visa)→ 不叫:簽證單沒有
 * 確認單交付物,叫了是永遠誤報(見 WATCHDOG_CONFIRMATION_EXEMPT_CATEGORIES)。
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
    // category 豁免:visa 沒有確認單交付物(交付物 = 簽證/護照本身,手動追),
    // confirmedAt 永遠不會寫 → 不豁免就是永遠誤報。NULL/未知 category 照跑
    // (fail-visible,見 WATCHDOG_CONFIRMATION_EXEMPT_CATEGORIES 的完整決策)。
    if (order.category != null && WATCHDOG_CONFIRMATION_EXEMPT_CATEGORIES.has(order.category)) {
      return null;
    }
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

// ── 2a:訂單金額對 invoice 看門狗(docs/features/customer-cockpit/design-phase2.md §2a)──
//
// 真實案例(scorecard 首考):劉偉國訂單系統顯示 $6,635,真實 invoice 只收了
// $6,621.40,差 $13.60,系統原本完全看不出來。這條規則把「訂單掛的發票/確認單
// 文件裡的總額」跟 customOrders.totalPrice 對起來,對不上跳黃卡。
//
// 零 LLM、零外部呼叫:純字串掃描抓錨點詞旁的金額。找不到、或找到多個不同數值的
// 候選 → 誠實不叫(寧可漏掉真的對不上的案例,也不要在看不準的時候亂猜一個數字
// 出來誤報)。只比對 USD——NT$/¥/€/HK$ 等非美金幣別符號的候選直接排除,不然會把
// 供應商幣別的金額誤跟系統的美金售價比大小。

/** 中英錨點詞:total 系列金額出現在這些詞之後才算候選。 */
const INVOICE_TOTAL_ANCHORS = [
  "grand total",
  "amount due",
  "total",
  "合計",
  "總金額",
  "應付總額",
  "總計",
];

// 金額 token:可選 $ 前綴,千分位逗號可選,可選小數。「有千分位逗號」的分支放
// 前面試,但即使沒有逗號、位數超過 3 位(如 6635)也要整段吃下來,不能只吃前 3
// 位就停 —— 用 `\d+(?:,\d{3})*` 讓逗號變成可選的重複段,首段位數不限。
const AMOUNT_TOKEN_RE = /(\$)?(\d+(?:,\d{3})*(?:\.\d{1,2})?)/;

// 非 USD 幣別符號:錨點詞後第一個非空白 token 若以這些開頭,代表候選金額是別的
// 幣別,直接跳過整個候選(不能拿 NT$172,600 跟系統的美金售價比大小)。
const NON_USD_PREFIX_RE = /^(NT\$|NTD|HK\$|HKD|JPY|¥|€|EUR|£|GBP|CN¥|RMB|CNY)/i;

// 明確標了 USD 的 token(US$ 或後面接 USD 字樣),用來在「錨點後第一個 token 是
// 別的幣別」時,於同一個 40 字元窗口內繼續找有沒有補記的美金金額 —— 常見雙幣別
// 寫法「Grand Total: NT$172,600 (approx US$5,393)」,第一個 token 是 NT$,但窗口
// 裡稍後就補了明確的 US$ 金額,不該整個候選放棄。
const USD_MARKED_AMOUNT_RE = /US\$\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/i;

/**
 * 純函式、零 LLM、零外部呼叫。在 docText 裡用錨點詞(中英皆有:total / grand
 * total / amount due / 合計 / 總金額 / 應付總額 / 總計)往後找最近的金額。只認
 * USD(`$` 前綴或無幣別符號的純數字);錨點詞後第一個 token 若明確標了非 USD
 * 幣別符號(NT$/¥/€/HK$ 等),優先改抓同一窗口裡有沒有明確標 US$ 的補記金額
 * (雙幣別文件常見寫法),抓不到才整個候選跳過不採計。
 *
 * 「total」是最寬鬆的錨點詞,裸數字風險最高(容易撞到「total number of
 * travelers: 4」這種非金額語境)—— 這個錨點詞要求候選金額必須帶 `$` 前綴或千分位
 * 逗號或小數,單純的裸小整數不算數;其餘語意明確的錨點詞(grand total / amount
 * due / 合計 / 總金額 / 應付總額 / 總計)維持原本寬鬆規則,裸數字也算候選。
 *
 * 同一份文字找到 0 個候選、或找到 ≥2 個「數值不同」的候選 → null(找到多個但
 * 數值相同 — 例如同一總額出現在小計行跟頁尾各一次 — 視為同一個候選,不算模糊)。
 * 寧可漏掉真的對不上的案例,也不要在看不準的時候亂猜一個數字出來誤報。
 */
export function extractInvoiceTotal(docText: string): number | null {
  if (!docText) return null;
  const candidates = new Set<number>();

  for (const anchor of INVOICE_TOTAL_ANCHORS) {
    // 逐一找這個錨點詞在文字裡的每個出現位置(不分大小寫),往後最多看 40 字元
    // (涵蓋「合計:」「Total: $1,234.56」這類緊接在後的金額,不吃到下一行的無關數字)。
    // 英數錨點詞前加 \b(word boundary),避免「Subtotal」裡的「total」被誤判成
    // 獨立的 total 錨點。中文字元不是 ASCII \w,\b 在中文錨點詞前完全不會 match
    // (Node/ICU regex 的 \b 只認 ASCII word boundary),所以中文錨點詞不加 \b,
    // 只對純 ASCII 字母的錨點詞加這個前綴守門。
    const isAsciiWord = /^[a-z]+$/i.test(anchor.replace(/\s+/g, ""));
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const anchorRe = new RegExp(isAsciiWord ? `\\b${escaped}` : escaped, "gi");
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(docText)) !== null) {
      const after = docText.slice(m.index + m[0].length, m.index + m[0].length + 40);
      // 幣別守門:錨點詞後(跳過冒號/空白等分隔符)第一個非空白 token 若明確標了
      // 非 USD 幣別符號,先試著在同一窗口裡找明確標 US$ 的補記金額(雙幣別常見
      // 寫法),找不到才整個候選跳過。
      const trimmed = after.replace(/^[\s:：\-–—]+/, "");
      if (NON_USD_PREFIX_RE.test(trimmed)) {
        const usdMatch = USD_MARKED_AMOUNT_RE.exec(after);
        if (!usdMatch) continue;
        const n = Number(usdMatch[1].replace(/,/g, ""));
        if (Number.isFinite(n)) candidates.add(Math.round(n * 100) / 100);
        continue;
      }

      const amountMatch = AMOUNT_TOKEN_RE.exec(after);
      if (!amountMatch) continue;
      // 「total」錨點詞語意最模糊,容易撞到「total number of travelers: 4」這種
      // 計數語境 —— 要求帶 $ 前綴或千分位逗號或小數,才算合法金額候選;裸小整數
      // 不算。其餘錨點詞(grand total / amount due / 中文詞)語意已經明確是金額,
      // 維持原本寬鬆規則。
      if (anchor === "total") {
        const looksLikeMoney = amountMatch[1] === "$" || /[,.]/.test(amountMatch[2]);
        if (!looksLikeMoney) continue;
      }
      const numStr = amountMatch[2].replace(/,/g, "");
      const n = Number(numStr);
      if (Number.isFinite(n)) candidates.add(Math.round(n * 100) / 100);
    }
  }

  if (candidates.size !== 1) return null; // 0 個或多個不同數值 → 誠實不猜
  return [...candidates][0];
}

export type OrderInvoiceMismatchFinding = {
  /** 判別欄:發票對不上類 finding。 */
  kind: "invoiceMismatch";
  orderId: number;
  orderNumber: string;
  title: string;
  status: string;
  /** 目前只有黃燈:提醒 Jeff 核對,不是財務紅線(算法規則本身不知道誰對誰錯)。 */
  level: "yellow";
  /** customOrders.totalPrice,已轉 number。 */
  systemAmount: number;
  /** 文件裡抽到的唯一候選金額。 */
  documentAmount: number;
  currency: string;
};

/** 發票金額比對的容差(四捨五入誤差),小於此差距視為同一個數字,不叫。 */
const INVOICE_MISMATCH_TOLERANCE = 1;

export type OrderInvoiceMismatchInput = {
  id: number;
  orderNumber: string;
  title: string;
  status: string;
  totalPrice: string | number | null;
  currency: string;
};

/**
 * 單張單的規則。`invoiceTotals` 是呼叫端已經對這張單底下每份文件跑過
 * `extractInvoiceTotal`、過濾掉 null、對數值去重之後的陣列 —— 這支不重複做這件事。
 * 長度不是剛好 1(0 個沒有可信文件金額;多個不同數值代表模糊)→ null。currency
 * 非 USD → null(不比對非美金訂單)。totalPrice 轉不出數字 → null。唯一候選與
 * totalPrice 差距 < 1(容差)→ null。draft/cancelled 跳過(同 SKIP_STATUSES)。
 */
export function evaluateInvoiceMismatch(
  order: OrderInvoiceMismatchInput,
  invoiceTotals: number[],
): OrderInvoiceMismatchFinding | null {
  if (SKIP_STATUSES.has(order.status)) return null;
  if (order.currency !== "USD") return null;

  const total = toNum(order.totalPrice);
  if (total == null) return null;

  if (invoiceTotals.length !== 1) return null; // 0 個或多個不同候選 → 模糊,不叫
  const documentAmount = invoiceTotals[0];

  if (Math.abs(total - documentAmount) < INVOICE_MISMATCH_TOLERANCE) return null;

  return {
    kind: "invoiceMismatch",
    orderId: order.id,
    orderNumber: order.orderNumber,
    title: order.title,
    status: order.status,
    level: "yellow",
    systemAmount: total,
    documentAmount,
    currency: order.currency,
  };
}

/**
 * 一個客人所有訂製單的發票對不上 findings。`docTotalsByOrderId` 是呼叫端已經
 * 對每張單底下所有文件跑過 extractInvoiceTotal + 過濾 null + 去重的結果
 * (orderId → 候選金額陣列)。排序:落差最大的排最前面(跟 margin 類「最差的
 * 最上面」同一個直覺 —— 落差越大越該優先看)。
 */
export function findInvoiceMismatchIssues(
  orders: OrderInvoiceMismatchInput[],
  docTotalsByOrderId: Map<number, number[]>,
): OrderInvoiceMismatchFinding[] {
  const findings = orders
    .map((o) => evaluateInvoiceMismatch(o, docTotalsByOrderId.get(o.id) ?? []))
    .filter((f): f is OrderInvoiceMismatchFinding => f !== null);

  return findings.sort(
    (a, b) => Math.abs(b.systemAmount - b.documentAmount) - Math.abs(a.systemAmount - a.documentAmount),
  );
}

// ── 2c:Plaid 收款建議(docs/features/customer-cockpit/design-phase2.md §2c)─────
//
// 用既有的銀行流水(bankTransactions,記帳功能已在用)比對訂單應收金額。近期
// 入帳金額吻合某張未收款訂單 → 黃卡建議「疑似這張單收款了」。零 LLM、零 IO——
// 呼叫端已經查好資料餵進來,這支只做純數字比對。AI 絕不自動標記付款狀態:這支
// 只產生 finding,標記收款永遠是 Jeff 在訂單頁自己點 recordPayment。
//
// 頭號地雷(務必記住):bankTransactions.amount 正 = 支出、負 = 入帳(schema 自己
// 的註解證實)。收款要找的是「錢流進來」,所以只認 amount < 0 的交易,
// Math.abs() 取金額比對——絕對不能把方向搞反,不然會把「付錢給供應商」誤判成
// 「客人付錢給我們」。

export type OrderPaymentMatchLegKind = "deposit" | "balance" | "total";

export type OrderPaymentMatchFinding = {
  /** 判別欄:Plaid 收款建議類 finding。 */
  kind: "paymentMatch";
  orderId: number;
  orderNumber: string;
  title: string;
  status: string;
  /** 一律黃燈:是建議不是財務事實,Jeff 自己核對後才點「標記已收款」。 */
  level: "yellow";
  /** 這筆入帳被拿去比對訂單的哪一段欠款(訂金/尾款/全額)。 */
  legKind: OrderPaymentMatchLegKind;
  /** 吻合的交易金額(已轉正數)。 */
  matchedAmount: number;
  /** 交易發生日(YYYY-MM-DD,Plaid date 欄位原樣帶出)。 */
  transactionDate: string;
  /** 帳戶末四碼(顯示用,查無則 null)。 */
  accountMask: string | null;
  /** 這筆交易金額同時吻合的所有 orderId(含自己)。>1 代表模糊,Jeff 要自己判斷
   *  是哪一張單,系統不猜。 */
  candidateOrderIds: number[];
};

/** 收款金額比對容差(四捨五入誤差)。 */
const PAYMENT_MATCH_TOLERANCE = 0.01;

export type OrderPaymentMatchInput = {
  id: number;
  orderNumber: string;
  title: string;
  status: string;
  currency: string;
  totalPrice: string | number | null;
  depositAmount: string | number | null;
  balanceAmount: string | number | null;
  depositPaidAt: Date | string | null;
  balancePaidAt: Date | string | null;
};

/** 呼叫端已經篩好的交易資料:只信任輸入已經乾淨(近 30 天、isPending=0、
 *  excludeFromAccounting=0、archived=0 已經在呼叫端篩掉),這支不重複做這些過濾。 */
export type BankTransactionInput = {
  id: number;
  amount: string | number;
  date: string;
  accountMask: string | null;
};

/**
 * 決定一張單「還欠哪一段錢」。回傳 null = 這張單不適用(不參與比對,不算模糊)。
 *
 * 判斷依據(依序,互斥):
 *   1. depositPaidAt 空且 depositAmount 有值 → 訂金還沒收,目標是 depositAmount。
 *   2. 承上一條不成立(訂金已收 or 沒填訂金金額),balancePaidAt 空且 balanceAmount
 *      有值 → 尾款還沒收,目標是 balanceAmount。
 *   3. 上面兩條都不適用(這張單沒有分期欄位,depositAmount/balanceAmount 都沒填)
 *      —— 用 depositPaidAt 跟 balancePaidAt 是否都空,當作「這張單財務上還沒收
 *      完」的判斷依據(而非用 status,因為 status 可能因為出發/完團等其他理由
 *      推進,不代表錢真的收了;两个 paidAt 都空最貼近「真的還沒收到任何錢」的
 *      事實)—— totalPrice 有值就拿它當目標,legKind:"total"。
 *   4. 都不適用(depositPaidAt/balancePaidAt 任一有值,但沒有可用的 totalPrice/
 *      depositAmount/balanceAmount 组合)→ null,這張單不參與比對。
 */
/**
 * Exported (2026-07-08, F1 對帳引擎 塊A) so bankTransactionLinkEngine's
 * `exact_amount` rule can reuse this exact "還欠哪一段錢" algorithm company-wide
 * instead of re-deriving it — see dispatch-f1.md 塊A「沿用批8演算」。Behavior
 * and signature unchanged; this file's own matchPaymentsToOrders still calls it
 * the same way it always did.
 */
export function resolveUnpaidLeg(
  order: OrderPaymentMatchInput,
): { legKind: OrderPaymentMatchLegKind; targetAmount: number } | null {
  const deposit = toNum(order.depositAmount);
  const balance = toNum(order.balanceAmount);
  const total = toNum(order.totalPrice);

  if (order.depositPaidAt == null && deposit != null && deposit > 0) {
    return { legKind: "deposit", targetAmount: deposit };
  }
  if (order.balancePaidAt == null && balance != null && balance > 0) {
    return { legKind: "balance", targetAmount: balance };
  }
  // 沒有分期欄位可用:兩個 paidAt 都空 = 財務上還沒收到任何一筆錢,拿 totalPrice
  // 當整單的目標金額。任一 paidAt 有值,代表這張單已經在用分期路徑收款
  // (deposit/balance 走過 recordPayment),不該回頭拿 totalPrice 誤配。
  if (order.depositPaidAt == null && order.balancePaidAt == null && total != null && total > 0) {
    return { legKind: "total", targetAmount: total };
  }
  return null;
}

/**
 * 純函式、零 LLM、零 IO。輸入已經是呼叫端篩好的資料(orders 已排除 draft/
 * cancelled 以外?—— 不,這支自己再擋一次 SKIP_STATUSES,跟其他規則一致,防呼叫端
 * 漏篩;transactions 已排除 isPending/excludeFromAccounting/archived/非近 30 天)。
 *
 * 對每張單決定目標金額(見 resolveUnpaidLeg);非 USD 訂單跳過(比對的是美金銀行
 * 流水,幣別不同不能比)。對每筆交易只認 amount < 0(入帳);amount >= 0(支出或
 * 0)一律跳過,不比對——這是本規則最容易踩的地雷,測試要鎖死。
 *
 * 一筆交易可能同時吻合這個客人底下多張訂單(同額且同一段欠款)——對每一張都各出
 * 一條 finding,candidateOrderIds 列出所有「同金額+同 legKind」候選的 orderId,
 * 讓 Jeff 自己判斷是哪一張單。分組刻意把 legKind 併進去:金額只是巧合相同、但
 * 一張欠 deposit 一張欠 total 的兩張單,不算真正模糊,不該互相牽連進候選清單。
 *
 * 一張訂單如果被多筆交易命中(理論上異常——同一張單同一段錢被兩筆不同交易對上),
 * 只取日期最新的那筆交易產生 finding。選「最新」不是精準判斷,是為了避免噪音的
 * 取捨:同一張單重複跳兩張幾乎一樣的黃卡沒有增量資訊,而越近期的入帳跟訂單狀態
 * 變化的時間關聯性通常越高,所以留最新一筆、丟棄其餘。
 */
export function matchPaymentsToOrders(
  orders: OrderPaymentMatchInput[],
  transactions: BankTransactionInput[],
): OrderPaymentMatchFinding[] {
  // 只認入帳(amount < 0)。amount >= 0(支出或零)或轉不出數字一律跳過,絕不能
  // 拿來比對收款——這是本規則的方向守門,務必先判斷再轉正數,不能顛倒順序。
  const inflows: (BankTransactionInput & { amountAbs: number })[] = [];
  for (const t of transactions) {
    const raw = toNum(t.amount);
    if (raw == null || raw >= 0) continue;
    inflows.push({ ...t, amountAbs: -raw });
  }

  type Applicable = { order: OrderPaymentMatchInput; legKind: OrderPaymentMatchLegKind; targetAmount: number };
  const applicable: Applicable[] = [];
  for (const order of orders) {
    if (SKIP_STATUSES.has(order.status)) continue;
    if (order.currency !== "USD") continue;
    const leg = resolveUnpaidLeg(order);
    if (leg == null) continue;
    applicable.push({ order, legKind: leg.legKind, targetAmount: leg.targetAmount });
  }

  // orderId → 每筆吻合的交易(可能多筆,理論上異常)
  const hitsByOrderId = new Map<number, { txn: (typeof inflows)[number]; legKind: OrderPaymentMatchLegKind }[]>();
  // amount+legKind 當 key → 命中這個「金額+欠款段別」組合的所有 orderId,判斷「同額
  // 多單」用。務必把 legKind 併進 key:兩張完全無關的單,一張欠 deposit $1000、
  // 另一張欠 total $1000 純屬巧合同額,不該被併成同一組候選(那樣會誤導 Jeff 以為
  // 這兩張單彼此相關要挑一張)——只有「同一段欠款、同一金額」才算真的模糊。
  const orderIdsByAmountKey = new Map<string, Set<number>>();

  for (const { order, legKind, targetAmount } of applicable) {
    for (const txn of inflows) {
      if (Math.abs(txn.amountAbs - targetAmount) >= PAYMENT_MATCH_TOLERANCE) continue;
      const list = hitsByOrderId.get(order.id) ?? [];
      list.push({ txn, legKind });
      hitsByOrderId.set(order.id, list);

      const amountKey = `${legKind}:${targetAmount.toFixed(2)}`;
      const set = orderIdsByAmountKey.get(amountKey) ?? new Set<number>();
      set.add(order.id);
      orderIdsByAmountKey.set(amountKey, set);
    }
  }

  const findings: OrderPaymentMatchFinding[] = [];
  for (const { order, legKind, targetAmount } of applicable) {
    const hits = hitsByOrderId.get(order.id);
    if (!hits || hits.length === 0) continue;

    // 多筆交易命中同一張單同一段錢 → 只取日期最新那筆(見上方函式註解的取捨理由)。
    const latest = hits.reduce((a, b) => (a.txn.date >= b.txn.date ? a : b));

    const amountKey = `${legKind}:${targetAmount.toFixed(2)}`;
    const candidateOrderIds = [...(orderIdsByAmountKey.get(amountKey) ?? new Set<number>([order.id]))];

    findings.push({
      kind: "paymentMatch",
      orderId: order.id,
      orderNumber: order.orderNumber,
      title: order.title,
      status: order.status,
      level: "yellow",
      legKind,
      matchedAmount: Math.round(latest.txn.amountAbs * 100) / 100,
      transactionDate: latest.txn.date,
      accountMask: latest.txn.accountMask,
      candidateOrderIds,
    });
  }

  return findings;
}

// ── 3a:承諾追蹤(docs/features/customer-cockpit/design-phase3-4.md 3a)──────────
//
// Jeff 寄信裡常答應客人一件具體的事(「週五可取件」「明天發報價」),系統從來
// 不記得這些承諾,過期沒兌現全靠 Jeff 自己記住。這條規則是客人層級,不是訂單
// 層級 —— 承諾不一定掛在某張訂製單上,customOrderId 可為 null。
//
// 誠實邊界:dueDate 抽不出來(customerPromises.dueDate 為 null,代表
// server/_core/promiseExtraction.ts 的 resolveEventDate 解不出日期原文)就永遠
// 不叫 —— 抓不到日期就沒有「過期」這個判斷基準,寧可漏報不可誤報,跟本檔一貫
// 原則一致。fulfilledAt/dismissedAt 任一有值(Jeff 在聊天裡明確表達兌現/撤銷,
// 見 opsTools.mark_promise)也永遠不叫 —— AI 絕不自動標記這兩欄,只有這條看門狗
// 規則讀取它們的結果。

export type CustomerPromiseFinding = {
  /** 判別欄:承諾追蹤類 finding —— 客人層級,故意不含 orderId/orderNumber/title
   *  (承諾不一定掛在某張訂製單上),前端渲染要照 kind 分流,不要硬塞假的 orderId。 */
  kind: "commitment";
  promiseId: number;
  customerProfileId: number;
  customOrderId: number | null;
  promiseText: string;
  /** YYYY-MM-DD,resolveEventDate 算出來的到期日(這裡永遠非 null —— 呼叫端已經
   *  篩過 dueDate is not null 才餵進 evaluateCommitment/findCommitmentIssues)。 */
  dueDate: string;
  sourceInteractionId: number;
  /** 承諾類一律黃燈(提醒,不是財務紅線)。 */
  level: "yellow";
  /** 正整數:今天(LA 曆日)超過 dueDate 幾天。剛好今天到期(todayLA === dueDate)
   *  還不算過期(daysOverdue 至少要是 1),見 evaluateCommitment 的邊界註解。 */
  daysOverdue: number;
};

/** 看門狗 findings 聯集(watchdogForCustomer 回傳的元素型別)—— 五型聯集。 */
export type WatchdogFinding =
  | OrderMarginFinding
  | OrderPromiseFinding
  | OrderInvoiceMismatchFinding
  | OrderPaymentMatchFinding
  | CustomerPromiseFinding;

export type CommitmentInput = {
  id: number;
  customerProfileId: number;
  customOrderId: number | null;
  promiseText: string;
  dueDate: string | null;
  fulfilledAt: Date | string | null;
  dismissedAt: Date | string | null;
  sourceInteractionId: number;
};

/** dueDate(YYYY-MM-DD)跟 todayLA(YYYY-MM-DD)的曆日差(today − due,單位:天)。
 *  兩邊都是純日期字串,Date.parse 一律當 UTC 午夜,相減即曆日差 —— 跟 laDayDiff
 *  同一個「兩邊都已經是 YYYY-MM-DD 就直接字串/數值比較」精神,但這支吃兩個字串
 *  (laDayDiff 現有簽名吃兩個 Date),不共用同一支函式簽名不符。 */
function laDayDiffFromDateStrings(dueDateStr: string, todayLAStr: string): number {
  return Math.round((Date.parse(todayLAStr) - Date.parse(dueDateStr)) / DAY_MS);
}

/**
 * 單一承諾的規則。回傳 finding 或 null(已兌現 / 已撤銷 / 日期缺 / 還沒到期 →
 * 誠實不叫)。純函式。
 *
 * 邊界判斷(務必鎖住):dueDate 剛好等於 todayLA(今天就是到期日當天)—— 這裡
 * 判定為「還沒過期」,回 null。理由:「週五可取件」這種承諾,到了週五當天,
 * Jeff 可能還在處理中,還沒到「逾期」的地步;要等到週五都過完、隔天(週六)
 * 還沒兌現,才是真正的「過期」。所以 daysOverdue 必須 >= 1 才回 finding
 * (todayLA 嚴格晚於 dueDate),等於或早於 dueDate 一律 null。
 */
export function evaluateCommitment(
  promise: CommitmentInput,
  todayLA: string,
): CustomerPromiseFinding | null {
  if (promise.fulfilledAt != null || promise.dismissedAt != null) return null;
  if (!promise.dueDate) return null;

  const daysOverdue = laDayDiffFromDateStrings(promise.dueDate, todayLA);
  if (daysOverdue <= 0) return null; // 還沒到期,或剛好今天到期(見上方邊界註解)

  return {
    kind: "commitment",
    promiseId: promise.id,
    customerProfileId: promise.customerProfileId,
    customOrderId: promise.customOrderId,
    promiseText: promise.promiseText,
    dueDate: promise.dueDate,
    sourceInteractionId: promise.sourceInteractionId,
    level: "yellow",
    daysOverdue,
  };
}

/**
 * 一個客人所有承諾的 findings。過期最久的排最前面(跟 findOrderPromiseIssues
 * 「等最久在前」同一個直覺)。
 */
export function findCommitmentIssues(
  promises: CommitmentInput[],
  todayLA: string,
): CustomerPromiseFinding[] {
  return promises
    .map((p) => evaluateCommitment(p, todayLA))
    .filter((f): f is CustomerPromiseFinding => f !== null)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}
