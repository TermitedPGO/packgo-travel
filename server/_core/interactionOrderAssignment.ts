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
 * 規則優先序:
 *   ① 同一 gmailThreadId 的前一封信已經掛了 customOrderId → 直接繼承(no LLM,
 *      甚至不看候選清單——B4 回填也吃這條,純 code)。
 *   ② 候選清單(客人的「進行中」訂單,呼叫端已排除 completed/cancelled)恰好
 *      只有一張 → 自動掛這張。
 *   ③ 候選清單有兩張以上(或此函式被要求跳過③,見下)→ 需要呼叫端另外問過
 *      LLM,把 llmPick 傳進來;這裡只做「验证 llmPick 合法且信心足够」的裁決,
 *      不在這支函式裡打 LLM(保持這支函式對 DB/網路零依賴,單元測試不用 mock
 *      任何外部服務)。
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
   * Only used when candidates.length > 1. Omit entirely (e.g. B4's
   * deterministic-only backfill, which must never invoke an LLM) to skip
   * straight to NULL for the ambiguous case.
   */
  llmPick?: LlmOrderPick;
}

export type AssignInteractionOrderReason =
  | "thread_inherited"
  | "single_in_progress_order"
  | "llm_confident_pick"
  | "no_candidates"
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

  // ② exactly one in-progress order → auto-assign.
  if (candidates.length === 1) {
    return { customOrderId: candidates[0].id, reason: "single_in_progress_order" };
  }

  // Zero in-progress orders → nothing to attach to.
  if (candidates.length === 0) {
    return { customOrderId: null, reason: "no_candidates" };
  }

  // ③ multiple candidates — only an explicit, confident LLM pick that names
  // one of the actual candidates can resolve this. Anything less → NULL.
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
