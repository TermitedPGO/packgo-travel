/**
 * interactionOrderAssignment — customer-cockpit Phase6 B1「收信自動歸屬」。
 *
 * PURE decision function: given a candidate set of the customer's in-progress
 * orders + whether a prior interaction on the same Gmail thread already has a
 * customOrderId + (optionally) an LLM's pick, decide what customOrderId a new
 * inbound customerInteractions row should be stamped with.
 *
 * 抽出成獨立純函式的理由(dispatch-phase6.md 塊B 明確要求):B4(存量回填)要
 * 重用完全一樣的①+②規則(僅限 deterministic,不跑 LLM)。若邏輯留在
 * gmailPipeline.ts inline,兩邊各寫一份规则會drift——所以規則只在這裡定義一次,
 * gmailPipeline.ts(即時信件,可以用到規則③ LLM)和之後的B4回填端點
 * (只用①+②)都呼叫同一個函式,只是後者永遠不傳 llmPick。
 *
 * 鐵律(監工拍板,不可違反):不確定 = NULL,絕不猜。規則③只有在 LLM 回傳
 * 高信心的一個選擇時才採用;沒給 llmPick、llmPick 不在候選清單裡、或
 * llmPick.confident === false,一律 NULL。
 *
 * 規則優先序(F3 回爐後):
 *   ① 同一 gmailThreadId 的前一封信已經掛了 customOrderId → 直接繼承(no LLM,
 *      甚至不看候選清單——B4 回填也吃這條,純 code)。不變。
 *   ②③ 新 thread(無 ① 繼承)有任何候選 —— 含「唯一候選」—— 一律要呼叫端問過 LLM
 *      並傳入高信心 llmPick 才掛;這裡只驗證 llmPick 合法且信心足夠。沒 llmPick
 *      (例如 B4 純 deterministic 回填,永不帶 llmPick)、不 confident、或命中不到
 *      候選 → NULL。**絕不裸掛**(舊「唯一在辦單→自動掛」會把新主題的信混進不相干
 *      的單,見 e2e-sweep-20260705 §F3 Yosemite 混進 Napa 單的實測)。
 *   零張候選 → NULL(沒有可掛的單)。
 */

export interface OrderCandidate {
  id: number;
  orderNumber: string;
  category: string | null; // aka "caseType" in dispatch doc wording
  destination: string | null;
}

export interface LlmOrderPick {
  /** The order id the LLM chose, or null if it declined to pick one. */
  orderId: number | null;
  /** LLM must self-report confidence; anything else (undefined/false) → NULL per the cardinal rule. */
  confident: boolean;
}

export interface AssignInteractionOrderInput {
  /**
   * customOrderId already stamped on a PRIOR interaction row sharing this
   * message's gmailThreadId (undefined/null if none, or this is the first
   * message on the thread). Rule ① — always wins, no matter what else is
   * passed in.
   */
  priorThreadOrderId?: number | null;
  /**
   * The customer's in-progress orders (caller has already excluded
   * completed/cancelled — this function does not re-check status; it just
   * counts/reads whatever candidates it's given).
   */
  candidates: OrderCandidate[];
  /**
   * Used whenever there is at least one candidate and no ① thread inheritance
   * — including the single-candidate case (F3: a lone in-progress order is NOT
   * auto-assigned any more; it must be LLM-confirmed too). Omit entirely (e.g.
   * B4's deterministic-only backfill, which must never invoke an LLM) to skip
   * straight to NULL.
   */
  llmPick?: LlmOrderPick;
}

export type AssignInteractionOrderReason =
  | "thread_inherited"
  | "llm_confident_pick"
  | "no_candidates"
  // 新 thread 有候選但無 confident LLM pick(含唯一候選、B4 無 LLM 回填、
  // 多候選不確定)→ NULL,絕不裸掛(F3)。
  | "ambiguous_no_llm_or_unconfident";

export interface AssignInteractionOrderResult {
  customOrderId: number | null;
  reason: AssignInteractionOrderReason;
}

/**
 * Decide the customOrderId for a new (or backfilled) interaction row.
 * Pure — no DB, no network, no LLM call. Caller does all the fetching.
 */
export function decideInteractionOrderAssignment(
  input: AssignInteractionOrderInput,
): AssignInteractionOrderResult {
  // ① thread inheritance — short-circuits before even looking at candidates.
  if (input.priorThreadOrderId != null) {
    return { customOrderId: input.priorThreadOrderId, reason: "thread_inherited" };
  }

  const candidates = input.candidates ?? [];

  // Zero in-progress orders → nothing to attach to.
  if (candidates.length === 0) {
    return { customOrderId: null, reason: "no_candidates" };
  }

  // ② + ③ 統一(F3 回爐,E2E e2e-sweep-20260705 §F3):新 thread(無 ① 繼承)有任何
  // 候選 —— 含「唯一候選」—— 一律要 LLM 高信心確認才掛,否則 NULL。舊規則②「唯一
  // 在辦單→裸掛」太激進:客人手上只有一張 Napa 報價單時,一封全新主題的 Yosemite
  // 詢問會被裸掛進 Napa 單(prod 實測混單)。現在唯一候選與多候選走同一條路:只有
  // llmPick 明確、confident===true、且命中候選清單才採用;沒 llmPick(例如 B4 純
  // deterministic 回填,永不帶 llmPick)、不 confident、或命中不到 → NULL。絕不裸掛。
  const pick = input.llmPick;
  if (
    pick &&
    pick.confident === true &&
    pick.orderId != null &&
    candidates.some((c) => c.id === pick.orderId)
  ) {
    return { customOrderId: pick.orderId, reason: "llm_confident_pick" };
  }

  return { customOrderId: null, reason: "ambiguous_no_llm_or_unconfident" };
}
