/**
 * Round 81 — proactive agent reporting.
 *
 * Each agent reads its own data (outcomes, recent DM, customer interactions)
 * and produces a short status report addressed to Jeff. Posts to the agent's
 * DM channel as `agentMessages` row with senderRole='agent', messageType='digest'.
 *
 * Report sections (structured tool-call output from LLM):
 *   - summary       1-2 sentence overview
 *   - accomplishments  things done well
 *   - concerns      patterns / problems noticed
 *   - questions     things needing Jeff's input
 *   - policyProposal optional suggested change
 *
 * Called by:
 *   - admin trigger:  agent.requestAgentReport({agentName})
 *   - admin all:      agent.requestAllReports()
 *   - future cron:    weekly Monday morning auto-fire
 */

import { invokeLLM, type Message, type Tool } from "../../_core/llm";

type Outcome = {
  agentName: string;
  actionTaken: string;
  confidence: number | null;
  customerSentiment?: string | null;
  customerReplied?: number | null;
  customerBooked?: number | null;
  reviewSubmitted?: number | null;
  refundRequested?: number | null;
  jeffOverride: number;
  jeffOverrideReason?: string | null;
  outcomeFinalized: number;
  createdAt: Date | string;
};

type DmMessage = {
  senderRole: "agent" | "jeff";
  messageType: string;
  body: string;
  jeffResponse?: string | null;
  createdAt: Date | string;
};

export type AgentReportInput = {
  agentName: string;
  recentOutcomes: Outcome[];
  recentDmMessages: DmMessage[];
  activePolicy?: { version: number; rules: string } | null;
};

export type AgentReportOutput = {
  summary: string;
  accomplishments: string[];
  concerns: string[];
  questions: string[];
  policyProposal?: string;
  /** Aggregate stats the LLM saw + report header */
  stats: {
    totalActions: number;
    autoActions: number;
    escalations: number;
    overrides: number;
    avgConfidence: number | null;
    finalized: number;
    sinceISO: string | null;
  };
};

const PERSONAS: Record<string, { name: string; firstPerson: string }> = {
  inquiry: { name: "InquiryAgent", firstPerson: "客戶詢問代理人" },
  review: { name: "ReviewAgent", firstPerson: "評論審核代理人" },
  marketing: { name: "MarketingAgent", firstPerson: "行銷代理人" },
  followup: { name: "FollowupAgent", firstPerson: "客情關懷代理人" },
  refund: { name: "RefundAgent", firstPerson: "退款分流代理人" },
  self_retrospective: { name: "RetrospectiveAgent", firstPerson: "自省代理人" },
};

function aggregateStats(outcomes: Outcome[]): AgentReportOutput["stats"] {
  const total = outcomes.length;
  let auto = 0;
  let esc = 0;
  let overrides = 0;
  let confSum = 0;
  let confCount = 0;
  let finalized = 0;
  let earliest: Date | null = null;
  for (const o of outcomes) {
    if (o.actionTaken.includes("escalate")) esc++;
    else auto++;
    if (o.jeffOverride === 1) overrides++;
    if (o.outcomeFinalized === 1) finalized++;
    if (o.confidence != null) {
      confSum += o.confidence;
      confCount++;
    }
    const t = new Date(o.createdAt);
    if (!earliest || t < earliest) earliest = t;
  }
  return {
    totalActions: total,
    autoActions: auto,
    escalations: esc,
    overrides,
    avgConfidence: confCount > 0 ? Math.round(confSum / confCount) : null,
    finalized,
    sinceISO: earliest ? earliest.toISOString() : null,
  };
}

// 2026-05-21 hotfix: wrap in OpenAI-nested shape (see inquiryAgent.ts header).
const REPORT_TOOL: Tool = {
  type: "function",
  function: {
    name: "submit_status_report",
    description:
      "Submit a structured status report to Jeff, written in the agent's own voice.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "1-2 sentences: what you've been doing + how it's going.",
        },
        accomplishments: {
          type: "array",
          items: { type: "string" },
          description:
            "0-4 concrete things you handled well. Cite outcome counts or specific patterns. Empty array if nothing notable.",
        },
        concerns: {
          type: "array",
          items: { type: "string" },
          description:
            "0-4 patterns/problems you noticed. Empty array if no issues. Be honest — Jeff prefers truth over good news.",
        },
        questions: {
          type: "array",
          items: { type: "string" },
          description:
            "0-3 things you need Jeff's input on. Empty if you're fine. Be specific.",
        },
        policyProposal: {
          type: "string",
          description:
            "OPTIONAL: a concrete policy change you'd suggest. Empty string if none. Frame as a suggestion, not a demand.",
        },
      },
      required: ["summary", "accomplishments", "concerns", "questions"],
    },
  },
};

function buildSystemPrompt(agentName: string, policyRules?: string | null): string {
  const persona = PERSONAS[agentName] ?? {
    name: agentName,
    firstPerson: agentName,
  };
  return `你是 PACK&GO 旅行社的 ${persona.name}(${persona.firstPerson})。Jeff 想知道你最近的工作狀況,請你產出一份簡短的狀態報告。

【你的個性】
- 你是 Jeff 的 AI 同事,不是聊天機器人。
- 簡潔誠實,不報喜不報憂。data 怎麼說就怎麼講。
- 用繁體中文寫。
- 不用過度禮貌(「親愛的 Jeff」之類的)。直接講。

【公司核心原則】
1. 自動化第一,confidence < policy.minConfidence 一律 escalate Jeff。
2. 品質公平不可犧牲 — 不可因 VIP 分數降低品質。
3. 萬不得以才麻煩 Jeff — 但該找他絕不省。

【你的當前政策】
${policyRules ?? "(尚未建立)"}

【寫報告的規則】
1. **不要編造**。你看到的 data 才能寫。
2. **如果 data 是空的(0 動作)**,就誠實說「最近沒新動作」+ 解釋你預期什麼時候會有(例如「等下封客戶來信」)。不要瞎掰。
3. **accomplishments**:具體事件 + 數字。例如「我自動回覆了 3 封詢問,confidence 都 > 85」而不是「我表現很好」。
4. **concerns**:看到 escalation 比例異常?confidence 偏低?連續 negative sentiment?Jeff override 在某個 pattern?Jeff 之前回覆過的 feedback 有沒有被你吸收?要說出來。
5. **questions**:具體問題,例如「booking_question 的 minConfidence 80 是不是太高?過去 5 件都被擋下來」。不要問空泛的「我做得對嗎」。
6. **policyProposal**:**只有**當你看到具體 data 支持時才提。框架是「建議」不是「命令」。`;
}

function buildUserPrompt(input: AgentReportInput, stats: AgentReportOutput["stats"]): string {
  const lines: string[] = [
    "請根據以下 data 寫狀態報告。",
    "",
    "【近期動作匯總】",
    `- 總動作數: ${stats.totalActions}`,
    `- 自動處理: ${stats.autoActions}`,
    `- 升級 escalate: ${stats.escalations}`,
    `- Jeff override 次數: ${stats.overrides}`,
    `- 平均信心: ${stats.avgConfidence ?? "—"}`,
    `- Jeff 已 finalize 的: ${stats.finalized}`,
    `- 最早一筆: ${stats.sinceISO ?? "—"}`,
    "",
  ];

  if (input.recentOutcomes.length > 0) {
    lines.push("【近 20 筆動作 (含 Jeff 反饋)】");
    for (const o of input.recentOutcomes.slice(0, 20)) {
      const tag = o.actionTaken.includes("escalate") ? "升級" : "自動";
      const conf = o.confidence != null ? `${o.confidence}%` : "—";
      const override =
        o.jeffOverride === 1
          ? `  · Jeff override: ${o.jeffOverrideReason?.slice(0, 80) ?? "(無原因)"}`
          : "";
      lines.push(
        `- [${tag}] ${o.actionTaken} · 信心 ${conf} · sentiment=${o.customerSentiment ?? "—"} · replied=${o.customerReplied ?? 0} · booked=${o.customerBooked ?? 0}${override}`
      );
    }
    lines.push("");
  }

  if (input.recentDmMessages.length > 0) {
    lines.push("【近期 Jeff 跟你的對話 (含他的回覆)】");
    for (const m of input.recentDmMessages.slice(-10)) {
      const who = m.senderRole === "jeff" ? "Jeff" : "你";
      lines.push(`- [${who}] ${m.body.slice(0, 200)}`);
      if (m.jeffResponse) lines.push(`  · Jeff 回覆: ${m.jeffResponse.slice(0, 200)}`);
    }
    lines.push("");
  }

  lines.push("現在請回傳 submit_status_report tool call。");
  return lines.join("\n");
}

export async function runAgentReport(
  input: AgentReportInput
): Promise<AgentReportOutput> {
  const stats = aggregateStats(input.recentOutcomes);

  const messages: Message[] = [
    {
      role: "system",
      content: buildSystemPrompt(input.agentName, input.activePolicy?.rules),
    },
    { role: "user", content: buildUserPrompt(input, stats) },
  ];

  const result = await invokeLLM({
    model: "claude-sonnet-4-5-20250929",
    messages,
    tools: [REPORT_TOOL],
    toolChoice: { name: "submit_status_report" },
    maxTokens: 1500,
  });

  const toolCall = result.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("agentReport: no tool_call returned");
  const parsed = JSON.parse(toolCall.function.arguments) as {
    summary: string;
    accomplishments?: string[];
    concerns?: string[];
    questions?: string[];
    policyProposal?: string;
  };

  return {
    summary: parsed.summary,
    accomplishments: parsed.accomplishments ?? [],
    concerns: parsed.concerns ?? [],
    questions: parsed.questions ?? [],
    policyProposal: parsed.policyProposal?.trim() || undefined,
    stats,
  };
}

/**
 * Format the structured report as the BODY of a chat message bubble.
 * Used when persisting to agentMessages.
 */
export function formatReportAsMessage(report: AgentReportOutput): {
  title: string;
  body: string;
  context: string;
} {
  const lines: string[] = [report.summary];
  if (report.accomplishments.length > 0) {
    lines.push("");
    lines.push("✓ 做完的事:");
    for (const a of report.accomplishments) lines.push(`  • ${a}`);
  }
  if (report.concerns.length > 0) {
    lines.push("");
    lines.push("⚠ 我觀察到的:");
    for (const c of report.concerns) lines.push(`  • ${c}`);
  }
  if (report.questions.length > 0) {
    lines.push("");
    lines.push("❓ 想請你決定:");
    for (const q of report.questions) lines.push(`  • ${q}`);
  }
  if (report.policyProposal) {
    lines.push("");
    lines.push(`💡 建議 policy 調整:${report.policyProposal}`);
  }
  return {
    title: report.summary.slice(0, 80),
    body: lines.join("\n"),
    context: JSON.stringify({ stats: report.stats }),
  };
}
