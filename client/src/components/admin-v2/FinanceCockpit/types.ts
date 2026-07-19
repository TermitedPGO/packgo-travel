/**
 * FinanceCockpit 內部契約 —— 塊A 定,塊B/C/D 消費。
 *
 * useCockpitData() 一次把四個 tRPC 資料源接好、摺成 CockpitData;左欄(WorkColumn,
 * 塊B)、右欄(LedgerColumn,塊C)只吃這份 view model,不各自再開 query。要更多
 * 明細(逐筆待認領 / 逐團訂金)時,塊B/C 各自加自己的 query,但真相列共用的四個
 * 數字一律來自這裡,確保左欄計數 = 真相列計數 = 右欄,不打架。
 */

/**
 * client query 顯示狀態的唯一 union(1A0a,plan v4.3 §6.1)。
 * server 端 envelope 無 loading(那是 transport 狀態);"transport-error" =
 * 連線/查詢失敗且無任何快取值。唯一定義處 —— 禁止第二處重宣告。
 */
export type QueryDisplayState = "loading" | "transport-error" | "stale" | "ready";

/** @deprecated 過渡 alias(TileState → QueryDisplayState 遷移,1A1 前清光引用後刪)。 */
export type TileState = QueryDisplayState;

/** 真相列一格的顯示資料(數字 + 狀態)。格式化與 t() 在 TruthRow 做。 */
export interface CashTile {
  state: QueryDisplayState;
  /** Operating #2174 可動用餘額;null = 尚未連結或無法核實(依 state 顯示)。 */
  balance: number | null;
  mask: string;
  /** 該源最近一次成功抓取(ms epoch);null = 從未成功。 */
  asOf: number | null;
}

export interface PLTile {
  state: QueryDisplayState;
  /** null = 無法核實(state 非 ready/stale 時必為 null,不得折 0)。 */
  netProfit: number | null;
  income: number | null;
  margin: number | null;
  asOf: number | null;
}

export interface PendingTile {
  state: QueryDisplayState;
  count: number | null;
  total: number | null;
  asOf: number | null;
}

export interface TrustTile {
  state: QueryDisplayState;
  /** 主數字:已對應且未出發(B-final 38,600 口徑;F3 回爐 P1)。null = 無法核實。 */
  matchedNotDeparted: number | null;
  /** 全部未認列(三段之和)—— 勾稽 / 塊C 等式用。 */
  outstanding: number | null;
  departedPending: number | null;
  departedPendingCount: number | null;
  unmatchedTotal: number | null;
  unmatchedCount: number | null;
  balance: number | null;
  enabled: boolean;
  /** 第一個 trust 帳戶 mask(客人訂金卡標題);null = 無 trust 帳戶。 */
  accountMask: string | null;
  asOf: number | null;
}

export interface TruthRowData {
  cash: CashTile;
  pl: PLTile;
  pending: PendingTile;
  trust: TrustTile;
}

/** 工作區單源狀態(plan v4.3 §7.3):state==="ready" 蘊含 fresh。 */
export interface WorkSourceState {
  state: QueryDisplayState;
  count: number | null;
}

/**
 * 整個駕駛艙的 view model。
 * - truth:真相列四格(塊A),逐格帶 state + asOf(廢頁級單一時間戳)。
 * - work:左欄 allClear 判定的兩源(pendingSummary / trustReconciliation)。
 * - isLoading:任一查詢首載中(骨架用)。
 * - anySourceError:任一查詢失敗(頁級警示 badge;主態仍由逐格 state 呈現)。
 */
export interface CockpitData {
  truth: TruthRowData;
  work: { pending: WorkSourceState; recog: WorkSourceState };
  isLoading: boolean;
  anySourceError: boolean;
}
