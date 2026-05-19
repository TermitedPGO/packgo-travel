/**
 * Agent definitions + colour palette shared across the autonomous-agents
 * sub-views (Phase 5 module 5B).
 *
 * Kept tiny / churn-free — the MarketingAgent entry stays commented-out
 * here (and is hidden in the desk grid) per the line-comment that was in
 * the original entry file. Backend code still exists.
 */
import {
  Bot,
  CheckCircle2,
  Clock,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export const AGENT_DEFS = [
  {
    id: "inquiry" as const,
    name: "InquiryAgent",
    label: "客戶詢問",
    persona: "我負責看每一封新客戶來信,分類、評估、起草回覆 — 不確定時找你。",
    color: "emerald",
    icon: Bot,
  },
  {
    id: "review" as const,
    name: "ReviewAgent",
    label: "評論審核",
    persona: "我審核並回覆每一條客戶評論,批評稱讚一視同仁。",
    color: "blue",
    icon: CheckCircle2,
  },
  // MarketingAgent desk card hidden — backend code retained, but UI lives
  // in the Marketing domain (海報 / 自動化 / 競品), not here.
  {
    id: "followup" as const,
    name: "FollowupAgent",
    label: "客情關懷",
    persona: "出發前 / 旅途中 / 回國後,我做三段式關懷。生日週年也記得。",
    color: "amber",
    icon: Clock,
  },
  {
    id: "refund" as const,
    name: "RefundAgent",
    label: "退款分流",
    persona: "退款訴求我只做 triage,最終 escalate Jeff 親自決定。",
    color: "rose",
    icon: ShieldCheck,
  },
] as const;

export type AgentId = (typeof AGENT_DEFS)[number]["id"];

export type AgentDef = (typeof AGENT_DEFS)[number];

export interface AgentColors {
  bg: string;
  border: string;
  text: string;
  ring: string;
}

export const COLOR_MAP: Record<string, AgentColors> = {
  emerald: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
    ring: "ring-emerald-300",
  },
  blue: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
    ring: "ring-blue-300",
  },
  purple: {
    bg: "bg-purple-50",
    border: "border-purple-200",
    text: "text-purple-700",
    ring: "ring-purple-300",
  },
  amber: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    ring: "ring-amber-300",
  },
  rose: {
    bg: "bg-rose-50",
    border: "border-rose-200",
    text: "text-rose-700",
    ring: "ring-rose-300",
  },
};

// Re-export the Lucide icon type so consumers can type icon props without
// adding their own Lucide import.
export type { LucideIcon };
