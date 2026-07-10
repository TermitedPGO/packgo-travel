/**
 * FinanceCockpit 真相列的純計算層 —— 把四個 tRPC 資料源摺成真相列要顯示的數字。
 *
 * 純 TS(零 React / DOM),node 環境可單測(repo vitest env=node,只收 *.test.ts)。
 * 金額權威一律在 server(bankPLService / trustDeferralService / backfill 引擎);
 * 此處只挑欄位、加總、算比率,不重算損益。
 *
 * F3 塊A(2026-07-09)。塊B/C 的左右欄若要人性化數字,復用本檔的 fold 函式,
 * 不要各自重寫加總。
 */

/** linkedAccountsList 一列(只取真相列用到的欄位;寬鬆型別以吃真 tRPC row)。 */
export interface AccountRowLike {
  accountMask: string | null;
  isTrustAccount?: number | null;
  currentBalance: string | number | null;
  availableBalance: string | number | null;
}

/** trustReconciliation 一列(只取真相列用到的欄位;F3 回爐 P1 加三段拆分)。 */
export interface TrustReconRowLike {
  enabled?: boolean;
  outstandingTotal?: number | null;
  unmatchedCount?: number | null;
  unmatchedTotal?: number | null;
  balance?: number | null;
  /** 三段拆分(server trustOutstandingSplit;outstanding = 三段之和)。 */
  matchedNotDeparted?: number | null;
  departedPending?: number | null;
  departedPendingCount?: number | null;
}

/** decimal 字串 / number / null → number|null(NaN 視為 null)。 */
function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Operating 現金部位 = accountMask 相符(預設 #2174)、非 trust 帳戶的「可動用餘額」。
 * availableBalance 優先(B-final 標「可動用」);為 null 才退回 currentBalance。
 * 找不到帳戶回 null —— 前端顯示「尚未連結」而非 $0,避免謊報「現金 $0」。
 */
export function selectOperatingBalance(
  accounts: AccountRowLike[] | undefined | null,
  mask = "2174",
): number | null {
  if (!accounts) return null;
  const acct = accounts.find(
    (a) => a.accountMask === mask && a.isTrustAccount !== 1,
  );
  if (!acct) return null;
  const avail = toNum(acct.availableBalance);
  if (avail !== null) return avail;
  return toNum(acct.currentBalance); // 可能仍是 null
}

export interface TrustAgg {
  /** 全部未認列(= 三段之和)。口徑 note / 勾稽等式用,不是真相列主值。 */
  outstanding: number;
  /**
   * 已對應且未出發 —— 真相列「Trust 未認列」主數字(B-final 38,600 口徑)。
   * F3 回爐 P1:初版誤用 outstanding(含未對應,54,022 口徑)被指揮抓,釘死。
   */
  matchedNotDeparted: number;
  /** 已出發待認列(可認列等 Jeff 按)。 */
  departedPending: number;
  departedPendingCount: number;
  /** 未對應(對不到 booking)總額 —— 真相列 hint「另 $X 未對應(Trust)」。 */
  unmatchedTotal: number;
  unmatchedCount: number;
  /** trust 帳戶當前銀行餘額總額 —— 真相列 hint「餘額 $Y」。 */
  balance: number;
  /** 任一 trust 帳戶啟用遞延即視為啟用(關閉時真相列顯示「未啟用」而非謊報 $0)。 */
  enabled: boolean;
  accountCount: number;
}

/** 跨所有 trust 帳戶加總三段勾稽數字(對齊 TrustComplianceV2 的 agg 邏輯)。 */
export function aggregateTrust(
  rows: TrustReconRowLike[] | undefined | null,
): TrustAgg {
  const acc: TrustAgg = {
    outstanding: 0,
    matchedNotDeparted: 0,
    departedPending: 0,
    departedPendingCount: 0,
    unmatchedTotal: 0,
    unmatchedCount: 0,
    balance: 0,
    enabled: false,
    accountCount: 0,
  };
  if (!rows) return acc;
  for (const r of rows) {
    acc.outstanding += r.outstandingTotal ?? 0;
    acc.matchedNotDeparted += r.matchedNotDeparted ?? 0;
    acc.departedPending += r.departedPending ?? 0;
    acc.departedPendingCount += r.departedPendingCount ?? 0;
    acc.unmatchedTotal += r.unmatchedTotal ?? 0;
    acc.unmatchedCount += r.unmatchedCount ?? 0;
    acc.balance += r.balance ?? 0;
    if (r.enabled) acc.enabled = true;
    acc.accountCount++;
  }
  return acc;
}

/**
 * 入帳老化天數(曆日差)。>30 天列表標紅字天數(B-final .age)。
 * 兩端都是 'YYYY-MM-DD' 曆日字串(server date 欄位 + laToday 同套 LA 換算,
 * T2 地雷 #2);用 UTC 錨點相減,天數不受 DST 影響。爛輸入回 null(不顯示 chip)。
 */
export function agingDays(dateStr: string, todayStr: string): number | null {
  const d = Date.parse(`${dateStr.slice(0, 10)}T00:00:00Z`);
  const t = Date.parse(`${todayStr.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(d) || !Number.isFinite(t)) return null;
  return Math.round((t - d) / 86_400_000);
}

/** 今天的 America/Los_Angeles 曆日(前端側,與 server laToday 同一套規則)。 */
export function laTodayClient(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** DATE 值(tRPC 序列化後可能是 ISO 字串或 Date)→ 'YYYY-MM-DD' 曆日。 */
export function dateOnlyClient(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** trustDeferredList 一列(待認列卡用到的欄位)。 */
export interface DeferredRowLike {
  id: number;
  bookingId: number | null;
  amount: string | number;
  depositDate: string | Date | null;
  expectedRecognitionDate: string | Date | null;
  recognizedAt?: string | Date | null;
  reversedAt?: string | Date | null;
}

export interface DepartedPendingItem {
  id: number;
  bookingId: number;
  amount: number;
  depositDate: string | null;
  recognitionDate: string | null;
}

/**
 * 待認列確認卡的摺疊:未認列未沖銷、已對應 booking、認列日 <= 今天(LA)。
 * 與 server trustOutstandingSplit 的 departedPending 同一套判定 —— 卡上筆數 /
 * 金額和真相列 departedPendingCount 同源同口徑。
 */
export function foldDepartedPending(
  rows: DeferredRowLike[] | undefined | null,
  todayStr: string,
): { items: DepartedPendingItem[]; total: number; count: number } {
  const items: DepartedPendingItem[] = [];
  let total = 0;
  if (!rows) return { items, total, count: 0 };
  for (const r of rows) {
    if (r.recognizedAt || r.reversedAt) continue;
    if (!r.bookingId) continue;
    const rec = dateOnlyClient(r.expectedRecognitionDate);
    if (rec === null || rec > todayStr) continue;
    const a = parseFloat(String(r.amount)) || 0;
    total += a;
    items.push({
      id: r.id,
      bookingId: r.bookingId,
      amount: a,
      depositDate: dateOnlyClient(r.depositDate),
      recognitionDate: rec,
    });
  }
  return { items, total, count: items.length };
}

/**
 * 利潤率 %(income<=0 回 0,對齊 bankPLService.profitMargin 語義)。四捨五入到 0.1。
 */
export function profitMargin(income: number, netProfit: number): number {
  if (!Number.isFinite(income) || income <= 0) return 0;
  return Math.round((netProfit / income) * 1000) / 10;
}

export type TileState = "loading" | "error" | "stale" | "ready";

/**
 * 單格真相狀態:讀取失敗 / 載入中 / 舊值降級 / 就緒。fail-open ——
 * 首載就失敗(沒任何資料)才顯示「讀取失敗」;refetch 失敗但 react-query 還
 * 保留上次好值時降級成 stale(顯示上次值 + 淡標記),不整格翻臉(F3 回爐 #7)。
 */
export function resolveTileState(q: {
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
}): TileState {
  if (q.isError) return q.hasData ? "stale" : "error";
  if (q.isLoading || !q.hasData) return "loading";
  return "ready";
}

/** $12,300(整數、千分位)。真相列所有金額走這支,tabular-nums 對齊。 */
export const fmtMoney = (n: number): string =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/** +$3,550 / −$1,200(帶正負號,用真正的負號 U+2212 不用 hyphen)。 */
export const fmtSignedMoney = (n: number): string =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
