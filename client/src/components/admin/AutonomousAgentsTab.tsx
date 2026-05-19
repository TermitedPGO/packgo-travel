/**
 * Round 81 — 你的 AI 辦公室
 *
 * Office metaphor: 5 agents are colleagues. Each has a desk you can click
 * into. Top of the page shows the "office floor" — pending items waiting
 * for Jeff, plus a today/week activity timeline.
 *
 * Layout:
 *   1. Office status bar (aggregate)
 *   2. Pending — 等你看的(escalations + low-confidence drafts)
 *   3. Agent desks (5 cards in a row)
 *   4. Selected desk detail (inline expansion)
 *   5. Customer memory lookup
 *
 * Phase 5B (Module 5B): sub-views extracted into ./agents/. This file is
 * now a thin orchestrator that wires queries → sub-view props. Per-view
 * implementation lives in:
 *   - agents/agentDefs.ts          AGENT_DEFS, COLOR_MAP, AgentId
 *   - agents/OfficeHeader.tsx      top status bar
 *   - agents/PendingInbox.tsx      "等你看" inbox
 *   - agents/AgentDesks.tsx        5-card grid
 *   - agents/AgentDeskDetail.tsx   selected-desk view (chat + work log)
 *   - agents/CustomerProfileLookup.tsx
 *   - agents/InquiryAgentDemo.tsx  )
 *   - agents/ReviewAgentDemo.tsx   ) per-agent practice panels
 *   - agents/MarketingAgentDemo.tsx) (Marketing hidden — kept for v2 flag)
 *   - agents/FollowupAgentDemo.tsx )
 *   - agents/RefundAgentDemo.tsx   )
 *   - agents/sharedPrimitives.tsx  Section, Timeline, ErrorBox, ReasoningCard, isToday
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { AGENT_DEFS, type AgentId } from "./agents/agentDefs";
import { OfficeHeader } from "./agents/OfficeHeader";
import { PendingInbox } from "./agents/PendingInbox";
import { AgentDesks } from "./agents/AgentDesks";
import { AgentDeskDetail } from "./agents/AgentDeskDetail";
import { CustomerProfileLookup } from "./agents/CustomerProfileLookup";
import { isToday } from "./agents/sharedPrimitives";

export default function AutonomousAgentsTab() {
  const [activeAgent, setActiveAgent] = useState<AgentId>("inquiry");
  const [profileSearch, setProfileSearch] = useState("");

  const pending = trpc.agent.pendingForJeff.useQuery();
  const recent = trpc.agent.recentActivity.useQuery();

  return (
    <div className="space-y-6">
      <OfficeHeader
        pendingCount={pending.data?.length ?? 0}
        todayCount={
          recent.data?.filter((r) => isToday(new Date(r.createdAt))).length ?? 0
        }
        weekCount={recent.data?.length ?? 0}
      />

      <PendingInbox items={pending.data ?? []} />

      <AgentDesks active={activeAgent} onSelect={setActiveAgent} />

      <AgentDeskDetail
        agent={AGENT_DEFS.find((a) => a.id === activeAgent)!}
      />

      <CustomerProfileLookup
        search={profileSearch}
        setSearch={setProfileSearch}
      />
    </div>
  );
}
