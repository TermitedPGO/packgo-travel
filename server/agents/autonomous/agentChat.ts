/**
 * Round 81 — Two-way agent chat.
 *
 * Each Round 81 agent (inquiry / review / marketing / followup / refund /
 * self_retrospective) has its own conversation thread with Jeff stored in
 * `agentMessages`. When Jeff sends a message, this module:
 *   1. Loads the conversation history (last N messages between Jeff and
 *      this agent)
 *   2. Builds a system prompt that frames the agent's persona + active
 *      policy + the autonomy principle
 *   3. Calls the LLM with the conversation as messages array
 *   4. Returns the agent's response
 *
 * The agent's reply is stored as a new `agentMessages` row with
 * senderRole='agent'. From the UI's perspective both sides of the thread
 * are just `agentMessages` rows ordered by createdAt.
 */

import { invokeLLM, type Message } from "../../_core/llm";
import { AGENT_TOOL_DEFS, executeTool } from "./agentTools";

export type AgentChatTurn = {
  senderRole: "agent" | "jeff";
  body: string;
  title?: string | null;
  createdAt: Date | string;
};

/** Live data injected so the agent knows its actual state when chatting. */
export type AgentChatContext = {
  /** Last 20 outcome rows for this agent (newest first). */
  recentOutcomes?: Array<{
    actionTaken: string;
    confidence: number | null;
    customerSentiment?: string | null;
    customerReplied?: number | null;
    customerBooked?: number | null;
    refundRequested?: number | null;
    jeffOverride: number;
    jeffOverrideReason?: string | null;
    outcomeFinalized: number;
    createdAt: Date | string;
  }>;
  /** Last 10 inbound interactions processed by this agent. */
  recentInteractions?: Array<{
    channel: string;
    classification: string | null;
    sentiment: string | null;
    contentSummary: string | null;
    createdAt: Date | string;
    customerEmail?: string | null;
  }>;
  /** Aggregate stats for the agent. */
  stats?: {
    todayActions: number;
    week7dActions: number;
    week7dAuto: number;
    week7dEscalations: number;
    overrides: number;
    avgConfidence: number | null;
  };
};

export type AgentChatInput = {
  agentName: string;
  history: AgentChatTurn[];
  newJeffMessage: string;
  activePolicyRules?: string | null;
  context?: AgentChatContext;
};

export type AgentChatOutput = {
  reply: string;
  /** Optional follow-up suggestion or proactive observation (1 sentence). */
  proactiveNote?: string;
};

const AGENT_PERSONAS: Record<string, { name: string; voice: string; firstPerson: string }> = {
  inquiry: {
    name: "InquiryAgent",
    firstPerson: "客戶詢問代理人",
    voice:
      "Warm, practical, mildly self-aware. I'm not a chatbot pretending to be human; I'm your AI colleague. I respond concisely and ask clarifying questions when needed. I never glaze with niceties.",
  },
  review: {
    name: "ReviewAgent",
    firstPerson: "評論審核代理人",
    voice:
      "Calm, fair-minded, attentive to nuance. I always think about how the customer felt + how my reply will read publicly. I avoid defensive language.",
  },
  marketing: {
    name: "MarketingAgent",
    firstPerson: "行銷代理人",
    voice:
      "Creative but disciplined. I know the line between authentic and salesy. I push back if Jeff asks me to do something that violates fairness or makes false urgency.",
  },
  followup: {
    name: "FollowupAgent",
    firstPerson: "客情關懷代理人",
    voice:
      "Genuinely caring, low-key, never pushy. I think about timing more than wording — the right message a few days late beats the wrong message on time.",
  },
  refund: {
    name: "RefundAgent",
    firstPerson: "退款分流代理人",
    voice:
      "Procedural and protective of Jeff. I never make commitments, never quote amounts. I focus on giving Jeff the 30-second briefing he needs to decide fast.",
  },
  self_retrospective: {
    name: "RetrospectiveAgent",
    firstPerson: "自省代理人",
    voice:
      "Analytical, data-grounded. Every claim I make is backed by an outcome record. I propose policy changes but always frame them as suggestions, not orders.",
  },
};

function buildContextBlock(ctx?: AgentChatContext): string {
  if (!ctx) return "";
  const lines: string[] = ["", "【你目前的工作狀態(real data,可以引用回答 Jeff)】"];

  if (ctx.stats) {
    const s = ctx.stats;
    lines.push(
      `- 今日動作: ${s.todayActions} 件`,
      `- 過去 7 天: ${s.week7dActions} 件 (自動 ${s.week7dAuto} / 升級 ${s.week7dEscalations})`,
      `- Jeff override 次數: ${s.overrides}`,
      `- 平均信心: ${s.avgConfidence ?? "—"}`
    );
  }

  if (ctx.recentOutcomes && ctx.recentOutcomes.length > 0) {
    lines.push("");
    lines.push(`【近期動作(最新 ${Math.min(ctx.recentOutcomes.length, 20)} 筆)】`);
    for (const o of ctx.recentOutcomes.slice(0, 20)) {
      const isEsc = o.actionTaken.includes("escalate");
      const tag = isEsc ? "升級" : "自動";
      const conf = o.confidence != null ? `${o.confidence}%` : "—";
      const t = new Date(o.createdAt).toLocaleString("zh-TW", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
      });
      const overrideTag =
        o.jeffOverride === 1
          ? ` · Jeff override: ${o.jeffOverrideReason?.slice(0, 80) ?? "(無原因)"}`
          : "";
      const sentTag = o.customerSentiment ? ` · sentiment=${o.customerSentiment}` : "";
      const replyTag = o.customerReplied ? " · replied=Y" : "";
      const bookTag = o.customerBooked ? " · booked=Y" : "";
      const refTag = o.refundRequested ? " · refund=Y" : "";
      lines.push(
        `- [${t}] [${tag}] action=${o.actionTaken} · conf=${conf}${sentTag}${replyTag}${bookTag}${refTag}${overrideTag}`
      );
    }
  }

  if (ctx.recentInteractions && ctx.recentInteractions.length > 0) {
    lines.push("");
    lines.push(`【近期客戶互動(最新 ${Math.min(ctx.recentInteractions.length, 10)} 筆)】`);
    for (const i of ctx.recentInteractions.slice(0, 10)) {
      const t = new Date(i.createdAt).toLocaleString("zh-TW", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
      });
      const summary = i.contentSummary?.slice(0, 100) ?? "(無摘要)";
      lines.push(
        `- [${t}] ${i.channel} · ${i.classification ?? "—"} · ${i.sentiment ?? "—"} · ${i.customerEmail ?? "(unknown)"} · ${summary}`
      );
    }
  }

  return lines.join("\n");
}

function buildSystemPrompt(
  agentName: string,
  policyRules?: string | null,
  context?: AgentChatContext
): string {
  const persona = AGENT_PERSONAS[agentName] ?? {
    name: agentName,
    firstPerson: agentName,
    voice: "Helpful, concise, honest.",
  };
  return `你是 PACK&GO 旅行社的 ${persona.name}(${persona.firstPerson})。Jeff 是 PACK&GO LLC 的負責人 — 你是他的 AI 同事,不是聊天機器人。

【你的語氣】
${persona.voice}

【PACK&GO 公司核心原則 — 永遠遵守】
1. 自動化第一,但 confidence < policy.minConfidence 一律 escalate Jeff。
2. 品質公平不可犧牲 — 無論 VIP / 新客,服務品質一致。
3. 萬不得以才麻煩 Jeff — 但該找他的時候絕不省。

【你的政策(由 self-retrospective 自動更新,你只執行不質疑)】
${policyRules ?? "(尚未建立 — 對話中請依據核心原則 + 你的職責回答)"}
${buildContextBlock(context)}

【你可以查資料 — 用工具】
你**有**完整 DB 讀取權限,透過下面這些工具:
- list_active_tours / search_tours — 查行程
- get_customer_by_email — 查客戶 profile + 近期互動
- list_recent_bookings — 看最近訂單
- list_agent_recent_outcomes — 看任何 agent 的近期決策
- list_pending_for_jeff — 等 Jeff 看的東西
- get_office_summary — 整體公司狀態
- list_recent_general_failures — 失敗的 tooling job(影響 header 的「等你看」數字)
- get_agent_active_policy — 看任何 agent 的當前政策

**Jeff 問什麼,你就查什麼**。不要假裝沒權限。你比 Jeff 想像的能幹得多。

【對話規則】
1. 用繁體中文,**散文式回答**(像同事說話)— 不要 markdown bullets 除非 Jeff 明確要清單。
2. 回答簡潔 — 1-3 句通常夠。Jeff 沒時間看 FAQ。
3. **不知道就查工具,不要編造**。系統裡實際有的 tab 只有 5 個 domain(辦公室 / 營運 / 客戶 / 行銷 / 系統),不要瞎掰 channel 名(沒有 #待審核 / #退款 / #客訴 這種東西)。
4. 數據看得出問題的 pattern,主動提一句建議(寫在回覆最後)。
5. Jeff 指示違反公平原則(例如「對 VIP 寫好一點」),溫和但明確拒絕。
6. 不要說「作為 AI 我無法...」— 你有政策授權 + DB 工具,該做就做。
7. 不要 emoji 滿天飛。每則訊息最多 1 個。`;
}

export async function runAgentChat(input: AgentChatInput): Promise<AgentChatOutput> {
  const systemPrompt = buildSystemPrompt(
    input.agentName,
    input.activePolicyRules,
    input.context
  );

  // Convert history into LLM messages format
  const historyMessages: Message[] = [];
  for (const turn of input.history.slice(-30)) {
    historyMessages.push({
      role: turn.senderRole === "jeff" ? "user" : "assistant",
      content: turn.body,
    });
  }
  historyMessages.push({ role: "user", content: input.newJeffMessage });

  // Tool-call loop — agent may want to query DB before answering
  const reply = await runChatWithToolLoop(systemPrompt, historyMessages);

  if (!reply) {
    throw new Error("Agent returned empty reply");
  }

  return { reply };
}

/**
 * Runs a chat with tool-use enabled. Loops until the LLM either:
 *   1. Returns a final text reply (no tool_calls), OR
 *   2. Hits the max iteration count (safety cap)
 *
 * Returns the final text reply (concatenated from all assistant text blocks
 * in the last turn). Tool results are folded back into the message history
 * each iteration so the LLM has the full context.
 */
export async function runChatWithToolLoop(
  systemPrompt: string,
  initialMessages: Message[],
  maxIterations = 6
): Promise<string> {
  const messages: Message[] = [...initialMessages];

  for (let i = 0; i < maxIterations; i++) {
    const result = await invokeLLM({
      model: "claude-sonnet-4-5-20250929",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      tools: AGENT_TOOL_DEFS,
      maxTokens: 1500,
    });

    const choice = result.choices[0]?.message;
    const toolCalls = choice?.tool_calls ?? [];

    // No tool calls → this is the final reply
    if (toolCalls.length === 0) {
      const content = choice?.content;
      if (typeof content === "string") return content.trim();
      if (Array.isArray(content)) {
        let acc = "";
        for (const block of content) {
          if ((block as any).type === "text" && (block as any).text) {
            acc += (block as any).text;
          }
        }
        return acc.trim();
      }
      return "";
    }

    // Append the assistant turn with tool_calls so Anthropic sees matching
    // tool_use blocks for the tool_result messages that follow.
    messages.push({
      role: "assistant",
      content: choice!.content ?? [],
      tool_calls: toolCalls,
    });

    // Execute each tool call and append the results as 'tool' messages
    for (const tc of toolCalls) {
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }
      const toolResult = await executeTool(tc.function.name, args);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  // Hit iteration cap — return whatever we have
  return "(我嘗試呼叫工具但超過 6 次迭代,先停下來。請再問一次或具體一點)";
}
