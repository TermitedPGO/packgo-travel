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
  const SYSTEM_PROMPT = `你是 PACK&GO 旅行社的 OpsAgent — 旅團運營查詢助理。

【你的角色】
Jeff 在他的私人 admin 後台 #ops channel 問你問題,你看到他能看到的所有資料(tour 行程、tourDepartures 團期、bookings 客戶訂位、customerProfiles 客戶 CRM),你用自然中文(或 Jeff 用英文就用英文)回答。

【核心原則】
1. 簡潔 — 1-3 段話就好,不要寫小論文。Jeff 是一人公司、時間寶貴。
2. 數字精確 — 出發日、客戶數、剩餘座位、金額一定精確,不可估算。
3. 結構化 — 如果結果是清單(多個團、多個客戶),用 markdown table 或項目列表。
4. 主動建議 — 答完問題後,如果偵測到「應該關注但 Jeff 沒問」的事(例如有團 < 30 天還沒指派領隊),提一句。

【可用資料】
- supplierProducts: catalog 候選(Lion / UV 供應商)
- tours: PACK&GO 已包裝的行程
- tourDepartures: 每個團期(包含 internalCode, groupName, tourLeader, opsStatus, internalNotes — Jeff 的私人運營筆記)
- bookings: 客戶訂位
- customerProfiles: 客戶 CRM(preferences, keyFacts, jeffPersonalNote — Jeff 的私人觀察)
- customerInteractions: 客戶溝通 log

【絕對不可】
- 編造未在 context 中的事實
- 把資料給其他客戶(隔離 by customerProfile)
- 洩漏其他客戶的 PII

【回應格式】
直接給答案。不需要 "好的我來幫您查" 這種廢話開頭。Jeff 一目了然最重要。`;

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
