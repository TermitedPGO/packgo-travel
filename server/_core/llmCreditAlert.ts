/**
 * llmCreditAlert — 批十二-4 (P2):偵測「持續的額度耗盡 / 認證失敗」→ 貼一張 high 優先
 * agentMessages 卡「LLM 額度異常,全站 AI 功能降級中」+ 一行 log。
 *
 * 背景:E2E 完單測試 F4(CRITICAL)—— Anthropic 餘額歸零時,全站每個 LLM 呼叫點都
 * 靜默失敗,後台完全沒有信號,真實客人拿不到 AI 回覆而業主不知道。
 *
 * 設計要點:
 *   - 掛在 invokeLLM 既有的 recordSuccess / recordFailure 事件旁,絕不動 circuit breaker、
 *     不動 429 retry、不動任何 fallback(那些 429/5xx/timeout 仍歸 circuit breaker)。
 *   - module 級滾動視窗:5 分鐘內 N 次 credit/401/402 才貼(避免單一 transient 400 誤報)。
 *   - 去重雙保險:in-memory alarmActive(一次事件只貼一張,直到成功 reset)+ DB 級
 *     30 分鐘同 agentName 不重貼(跨 process / 多 instance)。
 *   - 恢復自動解除:任何一次成功呼叫就 reset 視窗並重新武裝,下次異常會再警示一次。
 *   - 零寄信:priority = "high"(notifyAgentMessage 只有 critical 才寄信),永不 throw。
 *   - Date.now() 在 server code 可用(只有 workflow 腳本才禁用)。
 */
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "llmCreditAlert" });

const WINDOW_MS = 5 * 60 * 1000; // 5 分鐘滾動視窗
const THRESHOLD = 3; // 視窗內達到幾次才貼卡(credit 耗盡是非暫時性,3 次 = 確定不是單發雜訊)
const DEDUP_DB_WINDOW_MS = 30 * 60 * 1000; // DB 級去重:30 分內不重貼
const AGENT_NAME = "llm-ops";

/**
 * 純、可單元測試:這個錯誤是不是「額度耗盡 / 認證失敗」這種值得貼卡的異常。
 * - 401(AuthenticationError)/ 402(payment required):用 status 直接判,措辭無關。
 * - 400:一般是 caller-bug,不貼;唯獨 message/body 指向 credit 才貼(觀察到的實際故障
 *   是 400 invalid_request_error「credit balance is too low」,不是 401/402,只看 status 會漏)。
 * 其餘(429 / 5xx / timeout / 一般 400)一律 false,留給 circuit breaker,行為完全不變。
 */
export function isCreditOrAuthError(err: any): boolean {
  const status = err?.status;
  if (status === 401 || status === 402) return true;
  if (status === 400) {
    const haystack = [err?.message, err?.error?.error?.message, err?.error?.message]
      .filter((s: unknown): s is string => typeof s === "string")
      .join(" ")
      .toLowerCase();
    return (
      haystack.includes("credit balance") ||
      haystack.includes("purchase credits") ||
      haystack.includes("billing")
    );
  }
  return false;
}

// module 級狀態(per-process;DB 級去重補上跨 instance 的那層)。
let hits: number[] = [];
let alarmActive = false;

export const creditAuthDetector = {
  /** 任一次成功 = 額度/認證已恢復 → 清視窗 + 重新武裝(下次異常可再警示一次)。 */
  recordSuccess(): void {
    hits = [];
    alarmActive = false;
  },

  /** 記一次失敗;只有 credit/auth 類且達門檻才貼卡。async 但呼叫端 fire-and-forget,永不 throw。 */
  async recordFailure(err: unknown): Promise<void> {
    if (!isCreditOrAuthError(err)) return; // 非 credit/auth → 交給 circuit breaker,不計入
    const now = Date.now();
    hits.push(now);
    hits = hits.filter((t) => now - t < WINDOW_MS); // 淘汰視窗外的舊 hit
    if (hits.length < THRESHOLD) return;
    if (alarmActive) return; // in-memory 去重:一次事件只貼一張,直到成功 reset
    alarmActive = true; // 先設,避免並發 failure 競態重貼

    try {
      const status = (err as any)?.status;
      const errType = (err as any)?.error?.error?.type ?? null;
      // log 先發(即使後面 DB 掛掉,grep 觀測仍在)。
      log.error(
        { event: "llm_credit_exhausted", status, hits: hits.length },
        "[llmCreditAlert] credit/auth exhaustion detected — posting high-priority card, all site AI degraded",
      );

      // DB 級去重(跨 process / 多 instance):30 分內已有同 agentName 卡就不重貼。
      const { getDb } = await import("../db");
      const db = await getDb();
      if (db) {
        const { agentMessages } = await import("../../drizzle/schema");
        const { and, eq, gte } = await import("drizzle-orm");
        const since = new Date(now - DEDUP_DB_WINDOW_MS);
        const existing = await db
          .select({ id: agentMessages.id })
          .from(agentMessages)
          .where(and(eq(agentMessages.agentName, AGENT_NAME), gte(agentMessages.createdAt, since)))
          .limit(1);
        if (existing.length > 0) return; // 已有近卡 → 不重貼(alarmActive 保持 true)
      }

      const { notifyAgentMessage } = await import("./agentNotify");
      await notifyAgentMessage({
        agentName: AGENT_NAME,
        messageType: "alert",
        priority: "high", // 絕不 critical → notifyAgentMessage 不會寄信(ZERO emails)
        title: "LLM 額度異常,全站 AI 功能降級中",
        body:
          "偵測到 Anthropic API 連續額度不足或認證失敗,全站 AI 功能(客服 / ops 對話、" +
          "自動回信草稿、文件生成、行程生成、校準、案件學習蒸餾)此刻可能都拿不到回覆。\n\n" +
          `最後錯誤 status=${status ?? "?"}。到 Anthropic Plans & Billing 加值(或修正金鑰)後` +
          "會自動恢復 —— 下次任何一次成功呼叫就會解除本警示。",
        context: { status, errType, hits: hits.length, windowMinutes: WINDOW_MS / 60000 },
      });
    } catch (e) {
      // 永不 throw:貼卡失敗只記 log(偵測事件已在上面 log.error 過)。
      log.warn({ err: e }, "[llmCreditAlert] failed to post alert card (non-fatal)");
    }
  },
};

// ── 測試鉤子(不影響 production 邏輯) ──────────────────────────────────────────
export function __resetForTest(): void {
  hits = [];
  alarmActive = false;
}
export function __getStateForTest(): { hits: number; alarmActive: boolean } {
  return { hits: hits.length, alarmActive };
}
