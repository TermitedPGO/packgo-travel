/**
 * Round 81 Phase 3 — Self-Retrospective Agent.
 *
 * Reads the past 7 days of every Round 81 agent's outcomes + Jeff override
 * patterns, then proposes a concrete policy diff:
 *   - Which agent
 *   - Which rule to change (e.g. raise/lower a classification's minConfidence,
 *     add a new alwaysEscalate category, adjust auto-send threshold)
 *   - Why (citing specific override patterns)
 *
 * Result is posted as a `policy_proposal` agentMessage to #全體 channel
 * AND surfaces in the Inbox as an actionable item. Jeff approves → policy
 * version bumped to v(n+1) and rolled out.
 *
 * Called manually for now via agent.runRetrospective. Phase 3.5 will add
 * a weekly cron.
 */

import { invokeLLM, type Message, type Tool } from "../../_core/llm";

type Outcome = {
  agentName: string;
  actionTaken: string;
  confidence: number | null;
  customerSentiment?: string | null;
  customerBooked?: number | null;
  refundRequested?: number | null;
  jeffOverride: number;
  jeffOverrideReason?: string | null;
  outcomeFinalized: number;
  createdAt: Date | string;
};

type AgentPolicySnap = {
  agentName: string;
  version: number;
  rules: string;
};

/**
 * Past Jeff decision on a prior retrospective proposal. Used as
 * context so we stop re-suggesting things Jeff already evaluated.
 */
export type PastDecision = {
  /** Snapshot of the proposal text Jeff saw */
  proposalSummary: string;
  /** Agent the proposal targeted */
  agentName: string;
  /** What Jeff decided */
  decision: "adopted" | "rejected";
  /** When the decision was logged */
  decidedAt: Date | string;
  /** Jeff's optional note */
  note?: string | null;
};

export type RetrospectiveInput = {
  outcomes: Outcome[];
  policies: AgentPolicySnap[];
  windowDays: number;
  /** QA audit 2026-05-11 Phase 1 fix: past proposal decisions to
   *  avoid re-suggesting. Empty array = first run / no history. */
  pastDecisions?: PastDecision[];
};

export type PolicyProposal = {
  agentName: string;
  proposedRulesDiff: string; // human-readable diff/summary
  proposedFullRules: string; // full JSON to write if approved
  reasoning: string;
  evidence: string[]; // bullet-list of supporting outcome patterns
  /** 0-100 confidence that this is a good change */
  confidence: number;
};

export type RetrospectiveOutput = {
  summary: string;
  perAgentObservations: {
    agentName: string;
    totalActions: number;
    overrides: number;
    overrideRate: number;
    notableThemes: string[];
  }[];
  proposals: PolicyProposal[];
};

// 2026-05-21 hotfix: wrap in OpenAI-nested shape (see inquiryAgent.ts header).
const PROPOSAL_TOOL: Tool = {
  type: "function",
  function: {
    name: "submit_retrospective",
    description:
      "Submit a structured retrospective analysis with optional policy change proposals.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "2-3 sentence executive summary of the week. Cite real numbers.",
        },
        perAgentObservations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              agentName: { type: "string" },
              totalActions: { type: "integer" },
              overrides: { type: "integer" },
              overrideRate: { type: "number" },
              notableThemes: {
                type: "array",
                items: { type: "string" },
                description:
                  "0-3 patterns you noticed (e.g. 'refund_request often misclassified as complaint')",
              },
            },
            required: [
              "agentName",
              "totalActions",
              "overrides",
              "overrideRate",
              "notableThemes",
            ],
          },
        },
        proposals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              agentName: { type: "string" },
              proposedRulesDiff: {
                type: "string",
                description:
                  "Human-readable summary: e.g. 'lower booking_question.minConfidence from 80 to 75'",
              },
              proposedFullRules: {
                type: "string",
                description:
                  "Full proposed policy as JSON string. Must be valid JSON parseable as object.",
              },
              reasoning: {
                type: "string",
                description: "2-4 sentence rationale citing specific data.",
              },
              evidence: {
                type: "array",
                items: { type: "string" },
                description: "Bullets pointing to specific outcomes / patterns.",
              },
              confidence: {
                type: "integer",
                minimum: 0,
                maximum: 100,
                description:
                  "How confident the proposal is right. Be conservative.",
              },
            },
            required: [
              "agentName",
              "proposedRulesDiff",
              "proposedFullRules",
              "reasoning",
              "evidence",
              "confidence",
            ],
          },
          description:
            "0-3 policy change proposals. Empty array if data doesn't support any change. Be conservative — better to propose nothing than propose churn.",
        },
      },
      required: ["summary", "perAgentObservations", "proposals"],
    },
  },
};

function buildSystemPrompt(): string {
  return `你是 PACK&GO 旅行社的 Self-Retrospective Agent。每週負責讀過去一週所有 agent 的 outcomes + Jeff override 紀錄,提出 policy 改進方案。

【你的角色】
- 不是專家 agent — 你是「教練 / 政策分析師」
- 工作對象:Jeff(老闆)+ 5 個專家 agent(Inquiry / Review / Marketing / Followup / Refund)
- 工作頻率:每週(現在是手動觸發)

【公司核心原則(永遠遵守)】
1. 自動化第一,但 confidence < policy.minConfidence 一律 escalate Jeff
2. 品質公平不可犧牲 — VIP 分數不可影響回覆品質
3. 萬不得以才麻煩 Jeff,但該找他的絕不省

【分析原則】
1. **保守**:沒 data 支持就不要提改變。Empty proposals 是合理的。
2. **具體**:每個 proposal 要 cite 具體 outcome IDs 或 pattern 數字
3. **小步**:一次最多 3 個 proposals,每個改一個小東西。不要重設整套 policy。
4. **可逆**:每個 proposal 都應該是 Jeff 看了 30 秒能決定 approve / reject 的程度
5. **fairness check**:不可提「對 VIP 客戶寬鬆一點」之類違反公平原則的 proposal

【輸出 schema】
- summary:2-3 句執行摘要
- perAgentObservations:每個 agent 一筆 — totalActions / overrides / overrideRate / 0-3 條 themes
- proposals:0-3 個 policy 改進案,每個含 agentName / diff 描述 / 完整新 rules JSON / reasoning / evidence / confidence

【特別禁忌】
- 不要 markdown bullets in summary(就是普通句子)
- 不要編造 outcome — 只 cite 真的在 data 裡的
- proposals 為 0 是 OK 的,如果 data 不夠或沒明顯 pattern`;
}

function buildUserPrompt(input: RetrospectiveInput): string {
  const lines: string[] = [
    `請分析過去 ${input.windowDays} 天的 outcomes,給出 retrospective 報告。`,
    "",
  ];

  // Per-agent aggregation
  const byAgent = new Map<string, Outcome[]>();
  for (const o of input.outcomes) {
    if (!byAgent.has(o.agentName)) byAgent.set(o.agentName, []);
    byAgent.get(o.agentName)!.push(o);
  }

  lines.push(`【總共 outcomes】${input.outcomes.length} 筆`);
  lines.push("");

  for (const [agentName, outcomes] of byAgent.entries()) {
    const overrides = outcomes.filter((o) => o.jeffOverride === 1);
    const avgConf =
      outcomes.length > 0
        ? Math.round(
            outcomes.reduce((s, o) => s + (o.confidence ?? 0), 0) / outcomes.length
          )
        : 0;
    lines.push(`【${agentName} - ${outcomes.length} 筆】`);
    lines.push(`  平均信心: ${avgConf}, override ${overrides.length} 次`);
    for (const o of outcomes.slice(0, 10)) {
      const isEsc = o.actionTaken.includes("escalate");
      const tag = isEsc ? "升級" : o.actionTaken === "would_auto_send" ? "AutoSend" : "自動";
      const ov =
        o.jeffOverride === 1
          ? ` · JEFF OVERRIDE: ${o.jeffOverrideReason?.slice(0, 100) ?? "(無原因)"}`
          : "";
      lines.push(
        `  - [${tag}] action=${o.actionTaken} conf=${o.confidence ?? "—"} sentiment=${o.customerSentiment ?? "—"}${ov}`
      );
    }
    if (outcomes.length > 10) {
      lines.push(`  ... (還有 ${outcomes.length - 10} 筆未列出)`);
    }
    lines.push("");
  }

  lines.push("【目前各 agent 的政策】");
  for (const p of input.policies) {
    lines.push(`- ${p.agentName} v${p.version}:`);
    const lines2 = p.rules.split("\n").map((l) => `    ${l}`);
    lines.push(...lines2.slice(0, 20));
    if (lines2.length > 20) lines.push(`    ... (truncated)`);
    lines.push("");
  }

  // QA audit Phase 1 fix: surface Jeff's past adopt/reject decisions
  // so we don't pitch him the same thing twice. Adopted = "he already
  // did this, build on it"; rejected = "he saw this idea and said no,
  // don't propose it again unless evidence is materially different".
  if (input.pastDecisions && input.pastDecisions.length > 0) {
    const adopted = input.pastDecisions.filter((d) => d.decision === "adopted");
    const rejected = input.pastDecisions.filter((d) => d.decision === "rejected");
    lines.push("【Jeff 過去對提案的決定】");
    if (rejected.length > 0) {
      lines.push("❌ 過去已拒絕(請不要再提同類提案,除非有顯著新證據):");
      for (const d of rejected.slice(0, 15)) {
        const when = new Date(d.decidedAt).toLocaleDateString("zh-TW");
        lines.push(`  - [${when}] ${d.agentName}: ${d.proposalSummary.slice(0, 200)}`);
        if (d.note) lines.push(`      Jeff 註記: ${d.note.slice(0, 200)}`);
      }
    }
    if (adopted.length > 0) {
      lines.push("");
      lines.push("✓ 過去已採納(這些已套用到 policy 裡了,不要重複建議):");
      for (const d of adopted.slice(0, 15)) {
        const when = new Date(d.decidedAt).toLocaleDateString("zh-TW");
        lines.push(`  - [${when}] ${d.agentName}: ${d.proposalSummary.slice(0, 200)}`);
      }
    }
    lines.push("");
  }

  lines.push("現在請呼叫 submit_retrospective tool。");
  return lines.join("\n");
}

export async function runSelfRetrospective(
  input: RetrospectiveInput
): Promise<RetrospectiveOutput> {
  const messages: Message[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildUserPrompt(input) },
  ];

  const result = await invokeLLM({
    model: "claude-sonnet-4-5-20250929",
    messages,
    tools: [PROPOSAL_TOOL],
    toolChoice: { name: "submit_retrospective" },
    maxTokens: 3000,
  });

  const toolCall = result.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("Retrospective: no tool_call returned");
  const parsed = JSON.parse(toolCall.function.arguments);

  return {
    summary: parsed.summary ?? "",
    perAgentObservations: parsed.perAgentObservations ?? [],
    proposals: parsed.proposals ?? [],
  };
}

/**
 * Format the retrospective output for posting as an agentMessages row.
 */
export function formatRetrospectiveAsMessage(
  retro: RetrospectiveOutput,
  windowDays: number
): { title: string; body: string; context: string } {
  const lines: string[] = [retro.summary, ""];

  if (retro.perAgentObservations.length > 0) {
    lines.push("【各 agent 表現】");
    for (const o of retro.perAgentObservations) {
      const rate = Math.round(o.overrideRate * 100) / 100;
      lines.push(
        `  ${o.agentName}: ${o.totalActions} 筆 · override ${o.overrides} (${rate}%)`
      );
      for (const t of o.notableThemes.slice(0, 3)) {
        lines.push(`    · ${t}`);
      }
    }
    lines.push("");
  }

  if (retro.proposals.length === 0) {
    lines.push("【政策建議】無 — 過去一週沒有明顯 pattern 需要調整,維持現有 policy。");
  } else {
    lines.push(`【政策建議 · ${retro.proposals.length} 條】`);
    for (let i = 0; i < retro.proposals.length; i++) {
      const p = retro.proposals[i];
      lines.push(`  ${i + 1}. ${p.agentName}: ${p.proposedRulesDiff}`);
      lines.push(`     理由:${p.reasoning}`);
      lines.push(`     信心: ${p.confidence}%`);
    }
  }

  return {
    title: `Retrospective · ${windowDays} 天 · ${retro.proposals.length} 個 proposal`,
    body: lines.join("\n"),
    context: JSON.stringify({
      source: "self_retrospective",
      proposals: retro.proposals,
      windowDays,
      generatedAt: new Date().toISOString(),
    }),
  };
}
