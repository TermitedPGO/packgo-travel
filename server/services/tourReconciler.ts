/**
 * tourReconciler — 把「供應商目前可賣什麼」對到「站上 live 團是什麼」,
 * 算出每個產品該採取的動作。純函式、無 DB、無 LLM,可窮舉單測。
 *
 * 起因(2026-06-13):UV 匯入沒有持續對帳 — 供應商鏡像(supplierProducts /
 * supplierDepartures)每天同步且準確,但 tours(客人看到的)是一批批手動匯入後
 * 就漂移。結果是「可賣卻沒上架」「不可賣卻還掛著」「該補圖/補內容」散落各處。
 * 這支把對帳邏輯抽成純函式;之後 UV + Lion 共用,接 cron(shadow→apply 信任階梯)。
 *
 * 鐵律(由 docs/features/uv-to-live-tours/proposal.md §7 帶下來):
 *   - 只標「該不該上架 + 缺什麼」,本檔不做任何 mutation、不報價、不碰 LLM。
 *   - active 唯一可賣狀態;翻 active 仍須走既有 build→calibration QA,不在這裡硬翻。
 *   - 隱藏(isHiddenByAdmin)與非旅遊服務一律 HOLD,尊重人工決定,不自動復活。
 */

export type ReconcileAction =
  /** 已上架且健康(可賣 + 有未來出發日)。 */
  | "OK_LIVE"
  /** 內容齊、價對、有未來出發日,只差翻 active(走 approveTour,不在此硬翻)。 */
  | "READY_TO_ACTIVATE"
  /** 有 tour 但缺 description / itinerary → 要 LLM rewrite。 */
  | "NEEDS_BUILD"
  /** 內容齊但缺圖 → 要補圖(hero 會開天窗,不可帶圖空上架)。 */
  | "NEEDS_IMAGE"
  /** 內容齊但 price<=0 → 要補真價(getProductGroup priceType=4)。 */
  | "NEEDS_PRICE"
  /** 供應商有未來出發日,但 tour 端行事曆空 → 要把 departures 刷進來。 */
  | "NEEDS_DEPARTURE_REFRESH"
  /** 供應商可賣但站上根本沒這團 → 要匯入。 */
  | "NEEDS_IMPORT"
  /** 已 active 但供應商端已無未來可賣出發日 → 該下架(避免賣不出的團掛著)。 */
  | "SHOULD_DEACTIVATE"
  /** 供應商目前無未來出發日(季節性休眠),且站上未上架 → 正確擱置,不動。 */
  | "DORMANT"
  /** 來源被 admin 隱藏 → 尊重人工決定,不自動處理。 */
  | "HOLD_HIDDEN"
  /** 非旅遊商品(機票/公證/門票/留學服務等)→ 不當團處理。 */
  | "HOLD_JUNK";

export interface TourReconcileFacts {
  status: string;
  hasDescription: boolean;
  hasItinerary: boolean;
  hasImage: boolean;
  price: number;
  /** 未來、未取消、有成人價的出發日數(tour 端)。 */
  futureDepartures: number;
}

export interface ProductReconcileInput {
  /** 供應商產品代碼(externalProductCode),純標識用。 */
  code: string;
  /** supplierProducts.isHiddenByAdmin。 */
  hidden: boolean;
  /** 標題看起來像非旅遊服務(由 caller 用 looksLikeNonTourService 判斷後傳入)。 */
  isJunkService: boolean;
  /** 供應商端「未來、available/limited、價>0」的出發日數。0 = 目前不可賣。 */
  sellableFutureDepartures: number;
  /** 對到的 tour(取最完整的一筆);null = 站上沒這團。 */
  tour: TourReconcileFacts | null;
}

/**
 * 單一產品分流。優先序很重要:junk/hidden 先擋(尊重人工),
 * 再看「供應商可不可賣」,最後才看 tour 缺什麼。
 */
export function classifyReconcile(p: ProductReconcileInput): ReconcileAction {
  if (p.isJunkService) return "HOLD_JUNK";
  if (p.hidden) return "HOLD_HIDDEN";

  // 供應商端目前不可賣
  if (p.sellableFutureDepartures <= 0) {
    if (p.tour && p.tour.status === "active") return "SHOULD_DEACTIVATE";
    return "DORMANT";
  }

  // 供應商端可賣
  if (!p.tour) return "NEEDS_IMPORT";

  if (p.tour.status === "active") {
    // 已上架:唯一要修的是「賣得出但行事曆空」
    return p.tour.futureDepartures <= 0 ? "NEEDS_DEPARTURE_REFRESH" : "OK_LIVE";
  }

  // 有 tour 但未上架 — 看缺什麼(依「上架前硬門檻」proposal §5.1 的順序)
  if (!p.tour.hasDescription || !p.tour.hasItinerary) return "NEEDS_BUILD";
  if (!p.tour.hasImage) return "NEEDS_IMAGE";
  if (p.tour.price <= 0) return "NEEDS_PRICE";
  if (p.tour.futureDepartures <= 0) return "NEEDS_DEPARTURE_REFRESH";
  return "READY_TO_ACTIVATE";
}

export type ReconcileSummary = Record<ReconcileAction, number>;

export function summarizeReconcile(
  inputs: ProductReconcileInput[],
): ReconcileSummary {
  const blank: ReconcileSummary = {
    OK_LIVE: 0,
    READY_TO_ACTIVATE: 0,
    NEEDS_BUILD: 0,
    NEEDS_IMAGE: 0,
    NEEDS_PRICE: 0,
    NEEDS_DEPARTURE_REFRESH: 0,
    NEEDS_IMPORT: 0,
    SHOULD_DEACTIVATE: 0,
    DORMANT: 0,
    HOLD_HIDDEN: 0,
    HOLD_JUNK: 0,
  };
  for (const p of inputs) blank[classifyReconcile(p)]++;
  return blank;
}

/**
 * 非旅遊服務標題啟發式(UV 途風會賣機票/公證/門票/留學服務等周邊)。
 * 寧可保守(寧漏不殺),抓到的只是「候選」,最終排除仍須人工確認。
 * 與 escalation/cleanup 用同一組 pattern,集中一處好維護。
 */
const NON_TOUR_PATTERNS: RegExp[] = [
  /留學生/, /套餐/, /認證/, /委託書/, /聲明書/, /公證/, /Notary/i,
  /Air\s*Ticket/i, /機票代/, /簽證代/, /代辦/, /行程資訊缺失/,
];

export function looksLikeNonTourService(title: string): boolean {
  if (!title) return false;
  return NON_TOUR_PATTERNS.some((re) => re.test(title));
}
