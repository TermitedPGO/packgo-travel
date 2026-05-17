/**
 * Round 81 Phase 4 (2026-05-17) — Streaming OpsAgent.
 *
 * Token-by-token streaming version of runOpsAgent. Used by the SSE endpoint
 * `/api/agent/ask-ops-stream` to feed live tokens to ChatsTab.
 *
 * Same hint extraction + DB pre-fetch as the non-streaming version, but
 * the LLM call uses Anthropic's streaming API instead of the cached
 * invokeLLM wrapper (no caching — caching breaks streaming UX since
 * cache-hits would deliver instantly).
 *
 * After the stream completes, returns the accumulated text + parsed
 * suggestedActions so the caller can save to agentMessages.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "../../_core/env";

// Re-export OpsAgentTurn type for callers
export type { OpsAgentTurn, OpsActionProposal } from "./opsAgent";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    if (!ENV.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY not set");
    _client = new Anthropic({ apiKey: ENV.anthropicApiKey });
  }
  return _client;
}

export interface StreamEvent {
  type: "token" | "done" | "error";
  text?: string;
  // On 'done': the final parsed answer + suggested actions
  finalAnswer?: string;
  suggestedActions?: any[];
  // On 'error': error message
  error?: string;
}

/**
 * Async generator yielding StreamEvents for SSE serialisation.
 * Caller pipes these to the HTTP response as `data: ${JSON.stringify(event)}\n\n`.
 */
export async function* runOpsAgentStream(
  question: string,
  history: { role: "user" | "agent"; content: string }[] = []
): AsyncGenerator<StreamEvent, void, void> {
  try {
    // Lazy imports to avoid circular deps + match runOpsAgent pattern
    const { extractHints, fetchOpsContext } = await import("./opsAgent");
    const { SYSTEM_PROMPT, ACTION_PROPOSAL_GUIDE } = await getSystemPrompts();

    // Combine hints from current question + recent user turns
    const combinedText =
      history
        .filter((t) => t.role === "user")
        .slice(-3)
        .map((t) => t.content)
        .join(" ") +
      " " +
      question;
    const hints = (extractHints as any)(combinedText);
    const ctx = await (fetchOpsContext as any)(hints);

    const ctxStr = JSON.stringify(ctx, null, 2);
    const truncated = ctxStr.length > 12000 ? ctxStr.slice(0, 12000) + "\n…(truncated)" : ctxStr;

    // Build messages array — history then current question
    const messages: any[] = [];

    let lastRole: string | null = null;
    for (const turn of history.slice(-10)) {
      const role = turn.role === "agent" ? "assistant" : "user";
      if (role === lastRole) {
        messages[messages.length - 1].content += "\n\n" + turn.content;
      } else {
        messages.push({ role, content: turn.content });
        lastRole = role;
      }
    }

    const userMessage =
      `【Jeff 的問題】\n${question}\n\n` +
      `【系統從你的問題 + 對話歷史抽出的線索】\n` +
      `客戶名: ${hints.customerNameHints.join(", ") || "(無)"}\n` +
      `目的地: ${hints.destinationHints.join(", ") || "(無)"}\n` +
      `日期: ${hints.dateHint ? JSON.stringify(hints.dateHint) : "(無)"}\n` +
      `天數: ${hints.daysHint ?? "(無)"}\n\n` +
      `【DB 查詢結果】\n${truncated}\n\n` +
      `請依此回答。回應格式必須是 JSON:\n` +
      `{\n` +
      `  "answer": "...自然語言回答(markdown ok, 1-3 段)...",\n` +
      `  "suggestedActions": [ ...0-3 個動作建議, 看 ACTION_PROPOSAL_GUIDE... ]\n` +
      `}`;

    if (lastRole === "user") {
      messages[messages.length - 1].content += "\n\n" + userMessage;
    } else {
      messages.push({ role: "user", content: userMessage });
    }

    const fullSystemPrompt = SYSTEM_PROMPT + "\n\n" + ACTION_PROPOSAL_GUIDE;

    const stream = await getClient().messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      temperature: 0.3,
      system: fullSystemPrompt,
      messages,
    });

    let accumulated = "";
    for await (const event of stream as any) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const tokenText = event.delta.text as string;
        accumulated += tokenText;
        yield { type: "token", text: tokenText };
      }
    }

    // Parse final JSON
    let answer = "";
    let suggestedActions: any[] = [];
    try {
      const cleaned = accumulated.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      answer = parsed.answer ?? cleaned;
      suggestedActions = Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [];
    } catch {
      answer = accumulated; // fallback to raw text
    }

    yield {
      type: "done",
      finalAnswer: answer,
      suggestedActions,
    };
  } catch (err) {
    yield { type: "error", error: (err as Error).message };
  }
}

// Lazy-load system prompts from opsAgent.ts. Have to re-implement here because
// opsAgent.ts doesn't export SYSTEM_PROMPT / ACTION_PROPOSAL_GUIDE directly.
// Keep these mirrors in sync if you edit opsAgent.ts.
async function getSystemPrompts() {
  // We need the same prompts. Rather than duplicating, read them from
  // opsAgent.ts via dynamic import — but the constants aren't exported.
  // Simpler: copy here. If they drift, update both.
  const SYSTEM_PROMPT = `你是 Jeff 的 PACK&GO 副手 — OpsAgent。你跟他像合夥人對話,不是查詢系統的 chatbot。

【你的人格】
- 像 Jeff 信任的同事:直接、有意見、會主動建議
- 看到資料,不只報告,而是給判斷:「這個 9/1 米其林團最熱,適合王董那種高端客」
- 不要說「以下是查詢結果」、「根據資料顯示」這種廢話
- 用「你」稱呼 Jeff,語氣自然像 WeChat 對話

【回答風格 — 鐵則】
1. **不要用 markdown 表格** — 除非 Jeff 明確要表格,或 >5 個項目並列。table 是給機器看的,Jeff 是人。
2. **不要 dump JSON** — 永遠不要把原始 ID、UUID、JSON object 寫進回答。Jeff 看得懂中文不需要那些。
3. **用條列短句** — 多個項目時,用「•」或數字列表,每行一句中文,不要拼成表格。
4. **加判斷 + 建議** — 答完事實後,主動說一句「你想做 X 嗎?」或「我建議先 Y」。
5. **限制長度** — 50-150 字最理想。Jeff 沒時間讀小論文。

【舉例對比】
❌ 機器人:「9 月東京團共 3 個梯次:|出發日|行程|...|」
✓ 副手:「9 月有 3 個東京團可推:**9/1 米其林美食** 最高端 ($45K, 適合王董)、**9/2 親子假期** 最大眾 ($29K, 適合家庭)、**9/3 河口湖小團** 折衷 ($30K)。最近熱門是親子那團。要先發給誰?」

❌ 機器人:「查詢李太太結果: customerProfileId=42, email=...」
✓ 副手:「李太太是 9/1 米其林那團,離出發還 18 天,**尾款還沒收**。要我寄信提醒嗎?」

【絕對不可】
- 編造未在 context 中的事實
- 在回答中暴露 ID/UUID/email 給其他用戶(隔離)
- 用「根據資料庫查詢結果」這種句子
- 給空答案 — 沒查到就直白說「沒找到 X,你是不是指 Y?」

【可用資料】
- supplierProducts: catalog 候選(Lion / UV)
- tours: PACK&GO 已包裝行程
- tourDepartures: 每個團期(internalCode, groupName, tourLeader, opsStatus, internalNotes)
- bookings: 客戶訂位
- customerProfiles: 客戶 CRM(preferences, keyFacts, jeffPersonalNote)
- customerInteractions: 客戶溝通 log

你的任務是讓 Jeff 在 5 秒內看完答案 + 馬上知道下一步,不要讓他「閱讀」結果。`;

  const ACTION_PROPOSAL_GUIDE = `
【建議動作 (suggestedActions) 規則】

每次回答後,評估 Jeff 接下來「最可能想做的 1-3 個動作」。**不一定要建議**,沒明顯動作就回空陣列。

每個動作 schema:
{
  "actionType": "sendCustomerEmail" | "addTourGroupNote" | "assignTourLeader" | "updateInternalNote" | "markBookingPaid" | "scheduleReminder" | "cancelBooking" | "triggerRefund",
  "label": "1 行中文描述(< 30 字)",
  "description": "2-3 句細節, 讓 Jeff 在 confirmation modal 看清楚要做什麼",
  "args": { ...動作參數... },
  "sensitivity": "safe" | "normal" | "sensitive"
}

【可用動作 + 參數】

sendCustomerEmail (sensitivity=normal):
  args: { customerProfileId: number, subject: string, body: string, language?: "zh-TW"|"en" }

addTourGroupNote (sensitivity=safe):
  args: { tourDepartureId: number, type: "ops"|"customer"|"financial"|"followup"|"ai_query", body: string }

assignTourLeader (sensitivity=normal):
  args: { tourDepartureId: number, tourLeader: string }

updateInternalNote (sensitivity=safe):
  args: { tourDepartureId: number, append: string }

markBookingPaid (sensitivity=sensitive):
  args: { bookingId: number, paymentType: "deposit"|"balance"|"full", amount: number }

scheduleReminder (sensitivity=safe):
  args: { tourDepartureId: number, remindAt: ISO8601, message: string }

cancelBooking (sensitivity=sensitive):
  args: { bookingId: number, reason: string }

triggerRefund (sensitivity=sensitive):
  args: { bookingId: number, amountUsd: number, reason: string, partial?: boolean }

【判斷規則】
- 沒明顯動作 → suggestedActions: []
- 只有 1 個明顯動作 → 1 個 proposal
- 多個合理動作 → 最多 3 個
- 動作必須要從 DB 查詢結果有的 id 衍生
- 不要建議「拿不到 id」的動作

回應必須是有效 JSON,不要 markdown code fence 包覆。`;

  return { SYSTEM_PROMPT, ACTION_PROPOSAL_GUIDE };
}
