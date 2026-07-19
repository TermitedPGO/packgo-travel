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
  accountMask?: string | null;
  outstandingTotal?: number | null;
  unmatchedCount?: number | null;
  unmatchedTotal?: number | null;
  balance?: number | null;
  /** 三段拆分(server trustOutstandingSplit;outstanding = 三段之和)。 */
  matchedNotDeparted?: number | null;
  departedPending?: number | null;
  departedPendingCount?: number | null;
}

/** decimal 字串 / number / null → number|null(NaN 視為 null;禁 `parseFloat||0` 流水線)。 */
export function toNum(v: string | number | null | undefined): number | null {
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
  /** 第一個 trust 帳戶的 mask(客人訂金卡標題「Trust #5442」);無帳戶 null。 */
  accountMask: string | null;
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
    accountMask: null,
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
    if (acc.accountMask === null && r.accountMask) acc.accountMask = r.accountMask;
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

/** trustDeferredList 一列(待認列卡 / 客人訂金卡用到的欄位;塊C join 名稱)。 */
export interface DeferredRowLike {
  id: number;
  bookingId: number | null;
  amount: string | number;
  depositDate: string | Date | null;
  expectedRecognitionDate: string | Date | null;
  recognizedAt?: string | Date | null;
  reversedAt?: string | Date | null;
  /** 塊C:trustDeferredList 唯讀 join bookings/tours 補的名稱(可 null)。 */
  bookingCustomerName?: string | null;
  bookingTourTitle?: string | null;
}

export interface DepartedPendingItem {
  id: number;
  bookingId: number;
  amount: number;
  depositDate: string | null;
  recognitionDate: string | null;
  customerName: string | null;
  tourTitle: string | null;
}

/**
 * 待認列確認卡的摺疊:未認列未沖銷、已對應 booking、認列日 <= 今天(LA)。
 * 與 server trustOutstandingSplit 的 departedPending 同一套判定 —— 卡上筆數 /
 * 金額和真相列 departedPendingCount 同源同口徑。
 */
export function foldDepartedPending(
  rows: DeferredRowLike[] | undefined | null,
  todayStr: string,
): { items: DepartedPendingItem[]; total: number; count: number; invalidCount: number } {
  const items: DepartedPendingItem[] = [];
  let total = 0;
  let invalidCount = 0;
  if (!rows) return { items, total, count: 0, invalidCount };
  for (const r of rows) {
    if (r.recognizedAt || r.reversedAt) continue;
    if (!r.bookingId) continue;
    const rec = dateOnlyClient(r.expectedRecognitionDate);
    if (rec === null || rec > todayStr) continue;
    const a = toNum(r.amount);
    if (a === null) { invalidCount++; continue; } // 爛值不折 0,顯性排除(1A0a U8)
    total += a;
    items.push({
      id: r.id,
      bookingId: r.bookingId,
      amount: a,
      depositDate: dateOnlyClient(r.depositDate),
      recognitionDate: rec,
      customerName: r.bookingCustomerName ?? null,
      tourTitle: r.bookingTourTitle ?? null,
    });
  }
  return { items, total, count: items.length, invalidCount };
}

/** 客人訂金卡「已對應未出發」逐團列(塊C)。 */
export interface MatchedTrustItem {
  id: number;
  bookingId: number;
  amount: number;
  /** 預計認列日(≈出發日);null = 尚未排。 */
  recognitionDate: string | null;
  /** 距認列日天數(今天起算);null = 未排。 */
  daysUntil: number | null;
  /** 近出發(<= 30 天)→ amber dot。 */
  soon: boolean;
  customerName: string | null;
  tourTitle: string | null;
}

const TRUST_SOON_DAYS = 30;

/**
 * 客人訂金卡逐團列表的摺疊:已對應且未出發(與 server matchedNotDeparted 同
 * 口徑),按認列日近→遠排序(null 排最後),列前 maxRows 筆,其餘聚合成
 * 「其他 N 筆訂金 $X」(B-final .trow 聚合列)。
 */
export function foldMatchedNotDeparted(
  rows: DeferredRowLike[] | undefined | null,
  todayStr: string,
  maxRows = 4,
): {
  listed: MatchedTrustItem[];
  othersCount: number;
  othersTotal: number;
  total: number;
  count: number;
} {
  const all: MatchedTrustItem[] = [];
  let total = 0;
  if (rows) {
    for (const r of rows) {
      if (r.recognizedAt || r.reversedAt) continue;
      if (!r.bookingId) continue;
      const rec = dateOnlyClient(r.expectedRecognitionDate);
      if (rec !== null && rec <= todayStr) continue; // 已出發 → 待認列卡的事
      const a = toNum(r.amount);
      if (a === null) continue; // 爛值不折 0(1A0a U8;逐團列表面,總額不摻假值)
      total += a;
      const daysUntil = rec !== null ? agingDays(todayStr, rec) : null;
      all.push({
        id: r.id,
        bookingId: r.bookingId,
        amount: a,
        recognitionDate: rec,
        daysUntil,
        soon: daysUntil !== null && daysUntil <= TRUST_SOON_DAYS,
        customerName: r.bookingCustomerName ?? null,
        tourTitle: r.bookingTourTitle ?? null,
      });
    }
  }
  all.sort((a, b) => {
    if (a.recognitionDate === null) return b.recognitionDate === null ? 0 : 1;
    if (b.recognitionDate === null) return -1;
    return a.recognitionDate < b.recognitionDate ? -1 : a.recognitionDate > b.recognitionDate ? 1 : 0;
  });
  const listed = all.slice(0, maxRows);
  const others = all.slice(maxRows);
  return {
    listed,
    othersCount: others.length,
    othersTotal: others.reduce((s, x) => s + x.amount, 0),
    total,
    count: all.length,
  };
}

/** 損益成分條一段(B-final .compbar)。pct 為佔營收百分比(0-100,一位小數)。 */
export interface CompBarSegment {
  key: string;
  pct: number;
}

/**
 * 成分條寬度計算:各成本段 + 淨利段,寬度 = 佔營收比例,最後一段吃殘差使
 * 加總恰為 100(浮點不漂移)。income <= 0(不除零)或淨利為負(段寬無法
 * 表達虧損)→ 回空陣列,UI 藏條只列行。
 */
export function compBarSegments(
  costs: { key: string; value: number }[],
  income: number,
  netProfit: number,
): CompBarSegment[] {
  if (!Number.isFinite(income) || income <= 0 || netProfit < 0) return [];
  const items = [
    ...costs.filter((c) => c.value > 0),
    { key: "net", value: netProfit },
  ];
  const segs: CompBarSegment[] = [];
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    if (i === items.length - 1) {
      segs.push({ key: items[i].key, pct: Math.max(0, Math.round((100 - acc) * 10) / 10) });
    } else {
      const pct = Math.round((items[i].value / income) * 1000) / 10;
      acc += pct;
      segs.push({ key: items[i].key, pct });
    }
  }
  return segs;
}

/**
 * 利潤率 %(income<=0 回 0,對齊 bankPLService.profitMargin 語義)。四捨五入到 0.1。
 */
export function profitMargin(income: number, netProfit: number): number {
  if (!Number.isFinite(income) || income <= 0) return 0;
  return Math.round((netProfit / income) * 1000) / 10;
}

import type { QueryDisplayState, WorkSourceState } from "./types";

/** @deprecated 過渡 alias(canonical 定義在 types.ts QueryDisplayState;1A1 前清光引用後刪)。 */
export type TileState = QueryDisplayState;

/**
 * 單格真相狀態:讀取失敗 / 載入中 / 舊值降級 / 就緒。
 * 首載就失敗(沒任何資料)= "transport-error"(連線失敗且無快取值,1A0a 更名,
 * 原 "error");refetch 失敗但 react-query 還保留上次好值時降級成 stale
 * (顯示上次值 + 淡標記),不整格翻臉(F3 回爐 #7)。
 */
export function resolveTileState(q: {
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
}): QueryDisplayState {
  if (q.isError) return q.hasData ? "stale" : "transport-error";
  if (q.isLoading || !q.hasData) return "loading";
  return "ready";
}

/* ── 工作區 allClear 兩源狀態(plan v4.3 §7.3)────────────────────────── */

/**
 * freshness 門檻 = 2 × 現行輪詢間隔(useCockpitData PENDING_POLL_MS=300s /
 * KPI_POLL_MS=120s)。契約:age <= 門檻 → 仍 fresh;超齡即 stale。
 */
export const FRESH_MAX_AGE_MS = {
  pendingSummary: 600_000,
  trustReconciliation: 240_000,
} as const;

/** deriveWorkState 的輸入(自 react-query 摺出,純資料無 hook)。 */
export interface WorkQueryLike {
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
  /** 最近一次成功抓取(ms epoch);0 = 從未成功。 */
  dataUpdatedAt: number;
  /** 由 data 導出的計數;無 data = null(絕不折 0)。 */
  count: number | null;
}

function deriveWorkSourceState(
  q: WorkQueryLike,
  maxAgeMs: number,
  nowMs: number,
): WorkSourceState {
  if (!q.hasData) {
    if (q.isError) return { state: "transport-error", count: null };
    return { state: "loading", count: null };
  }
  const age = nowMs - q.dataUpdatedAt;
  const stale = q.isError || age > maxAgeMs; // age <= 門檻 → fresh
  return { state: stale ? "stale" : "ready", count: q.count };
}

/** 兩源各自折 WorkSourceState;state==="ready" 蘊含 fresh。 */
export function deriveWorkState(
  pending: WorkQueryLike,
  recog: WorkQueryLike,
  nowMs: number,
): { pending: WorkSourceState; recog: WorkSourceState } {
  return {
    pending: deriveWorkSourceState(pending, FRESH_MAX_AGE_MS.pendingSummary, nowMs),
    recog: deriveWorkSourceState(recog, FRESH_MAX_AGE_MS.trustReconciliation, nowMs),
  };
}

/**
 * allClear 公式(plan v4.3 §7.3):兩源皆 ready(蘊含 fresh)且計數皆真零。
 * 任一 loading/transport-error/stale/count>0/count===null → false。
 */
export function isAllClear(w: {
  pending: WorkSourceState;
  recog: WorkSourceState;
}): boolean {
  return (
    w.pending.state === "ready" &&
    w.recog.state === "ready" &&
    w.pending.count === 0 &&
    w.recog.count === 0
  );
}

/** $12,300(整數、千分位)。真相列所有金額走這支,tabular-nums 對齊。 */
export const fmtMoney = (n: number): string =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/** +$3,550 / −$1,200(帶正負號,用真正的負號 U+2212 不用 hyphen)。 */
export const fmtSignedMoney = (n: number): string =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
