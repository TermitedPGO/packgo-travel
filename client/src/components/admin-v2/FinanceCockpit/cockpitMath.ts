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

/** trustReconciliation 一列(只取真相列用到的欄位)。 */
export interface TrustReconRowLike {
  enabled?: boolean;
  outstandingTotal?: number | null;
  unmatchedCount?: number | null;
  unmatchedTotal?: number | null;
  balance?: number | null;
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
  /** 未認列 outstanding 總額(跨所有 trust 帳戶)。真相列「Trust 未認列」主值。 */
  outstanding: number;
  /** 未對應(對不到 booking)總額 —— 真相列 hint「另 $X 未對應」。 */
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
    unmatchedTotal: 0,
    unmatchedCount: 0,
    balance: 0,
    enabled: false,
    accountCount: 0,
  };
  if (!rows) return acc;
  for (const r of rows) {
    acc.outstanding += r.outstandingTotal ?? 0;
    acc.unmatchedTotal += r.unmatchedTotal ?? 0;
    acc.unmatchedCount += r.unmatchedCount ?? 0;
    acc.balance += r.balance ?? 0;
    if (r.enabled) acc.enabled = true;
    acc.accountCount++;
  }
  return acc;
}

/**
 * 利潤率 %(income<=0 回 0,對齊 bankPLService.profitMargin 語義)。四捨五入到 0.1。
 */
export function profitMargin(income: number, netProfit: number): number {
  if (!Number.isFinite(income) || income <= 0) return 0;
  return Math.round((netProfit / income) * 1000) / 10;
}

export type TileState = "loading" | "error" | "ready";

/**
 * 單格真相狀態:讀取失敗 / 載入中 / 就緒。fail-open —— 查詢出錯先在該格顯示
 * 「讀取失敗」,不讓整頁白屏(dispatch 塊C 空狀態同款要求,真相列同理)。
 */
export function resolveTileState(q: {
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
}): TileState {
  if (q.isError) return "error";
  if (q.isLoading || !q.hasData) return "loading";
  return "ready";
}

/** $12,300(整數、千分位)。真相列所有金額走這支,tabular-nums 對齊。 */
export const fmtMoney = (n: number): string =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/** +$3,550 / −$1,200(帶正負號,用真正的負號 U+2212 不用 hyphen)。 */
export const fmtSignedMoney = (n: number): string =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
