/**
 * FinanceCockpit 內部契約 —— 塊A 定,塊B/C/D 消費。
 *
 * useCockpitData() 一次把四個 tRPC 資料源接好、摺成 CockpitData;左欄(WorkColumn,
 * 塊B)、右欄(LedgerColumn,塊C)只吃這份 view model,不各自再開 query。要更多
 * 明細(逐筆待認領 / 逐團訂金)時,塊B/C 各自加自己的 query,但真相列共用的四個
 * 數字一律來自這裡,確保左欄計數 = 真相列計數 = 右欄,不打架。
 */
import type { TileState } from "./cockpitMath";

export type { TileState };

/** 真相列一格的顯示資料(數字 + 狀態)。格式化與 t() 在 TruthRow 做。 */
export interface CashTile {
  state: TileState;
  /** Operating #2174 可動用餘額;null = 尚未連結(顯示「—」)。 */
  balance: number | null;
  mask: string;
}

export interface PLTile {
  state: TileState;
  netProfit: number;
  income: number;
  margin: number;
}

export interface PendingTile {
  state: TileState;
  count: number;
  total: number;
}

export interface TrustTile {
  state: TileState;
  outstanding: number;
  unmatchedTotal: number;
  unmatchedCount: number;
  balance: number;
  enabled: boolean;
}

export interface TruthRowData {
  cash: CashTile;
  pl: PLTile;
  pending: PendingTile;
  trust: TrustTile;
}

/**
 * 整個駕駛艙的 view model。
 * - truth:真相列四格(塊A)。
 * - counts:左欄標頭「待認領 N 筆」等衍生計數(塊B 標頭用)。
 * - asOf:資料截至時間(ms epoch;最新一次成功抓取)。
 * - isLoading / isError:頁級彙總狀態(全部查詢);頁級 error 走 fail-open 空狀態。
 */
export interface CockpitData {
  truth: TruthRowData;
  counts: {
    pendingCount: number;
  };
  asOf: number | null;
  isLoading: boolean;
  isError: boolean;
}
