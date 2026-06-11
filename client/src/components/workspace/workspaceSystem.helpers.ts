/**
 * workspaceSystem.helpers — pure logic for 批8 系統頁.
 */
import type { CardState } from "./ws-ui";

export type LlmCostDay = {
  date: string; // YYYY-MM-DD
  totalUSD: number;
  perModel: { model: string; costUSD: number }[];
};

/** Today's spend from the daily report; 0 when today has no entry yet. */
export function todaySpend(days: LlmCostDay[], todayStr: string): number {
  return days.find((d) => d.date === todayStr)?.totalUSD ?? 0;
}

/**
 * Aggregate per-model spend across days → top-N share lines for the
 * 「Claude 71% · GPT 22%」strip. Zero-total → [] (no fake percentages).
 */
export function modelShares(
  days: LlmCostDay[],
  topN = 3,
): { model: string; pct: number }[] {
  const byModel: Record<string, number> = {};
  let total = 0;
  for (const d of days) {
    for (const m of d.perModel) {
      byModel[m.model] = (byModel[m.model] ?? 0) + m.costUSD;
      total += m.costUSD;
    }
  }
  if (total <= 0) return [];
  return Object.entries(byModel)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([model, usd]) => ({ model, pct: Math.round((usd / total) * 100) }));
}

/** agentActivityLogs.status → workspace state language. */
export function taskStateOf(status: string): CardState {
  if (status === "started") return "running";
  if (status === "completed") return "done";
  if (status === "failed") return "err";
  return "none";
}

/** Audit actor: agent rows carry role/email markers, everything else = human. */
export function auditActorKind(row: {
  userRole?: string | null;
  userEmail?: string | null;
}): "agent" | "human" {
  if (row.userRole === "agent") return "agent";
  if (row.userEmail?.includes("agent@")) return "agent";
  return "human";
}
