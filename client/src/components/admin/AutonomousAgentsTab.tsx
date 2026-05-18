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
 * The principle banner is now compressed into the top status bar to save
 * vertical space — the rule lives in the hover tooltip / dashboard
 * itself rather than as a constant header.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  AlertTriangle,
  CheckCircle2,
  Search,
  Users,
  Clock,
  ShieldCheck,
  Send,
  Loader2,
  Building2,
  ArrowRight,
  ThumbsUp,
  ThumbsDown,
  MessageCircle,
} from "lucide-react";

const AGENT_DEFS = [
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

type AgentId = (typeof AGENT_DEFS)[number]["id"];

// Color tokens per agent
const COLOR_MAP: Record<
  string,
  { bg: string; border: string; text: string; ring: string }
> = {
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

// ────────────────────────────────────────────────────────────────────────
// Office Header — top status bar with aggregate counters
// ────────────────────────────────────────────────────────────────────────

function OfficeHeader({
  pendingCount,
  todayCount,
  weekCount,
}: {
  pendingCount: number;
  todayCount: number;
  weekCount: number;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-black p-2.5">
          <Building2 className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-gray-900">你的 AI 辦公室</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            原則:自動化第一 · 萬不得以才人力 · 品質公平不可犧牲
          </p>
        </div>
        <div className="flex items-center gap-6 text-right">
          <HeaderStat
            label="等你看"
            value={pendingCount}
            tone={pendingCount > 0 ? "warn" : "ok"}
          />
          <HeaderStat label="今日動作" value={todayCount} />
          <HeaderStat label="48 小時內" value={weekCount} />
        </div>
      </div>
    </div>
  );
}

function HeaderStat({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  return (
    <div>
      <div
        className={`text-2xl font-bold tabular-nums ${
          tone === "warn" && value > 0 ? "text-rose-600" : "text-gray-900"
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
        {label}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Pending Inbox — escalations + low-confidence drafts waiting on Jeff
// ────────────────────────────────────────────────────────────────────────

type PendingItem = {
  outcomeId: number;
  agentName: string;
  actionTaken: string;
  confidence: number | null;
  createdAt: Date | string;
  // Phase 1 Cluster C: align with agent.pendingForJeff tRPC return shape.
  // The query left-joins customerInteractions + customerProfiles so all
  // joined-table columns are nullable; interactionId is part of the row.
  interactionId: number | null;
  channel: string | null;
  content: string | null;
  contentSummary: string | null;
  classification: string | null;
  sentiment: string | null;
  // urgency is nullable in the DB column → treat null as "no urgency rating".
  urgency: number | null;
  customerProfileId: number | null;
  customerEmail: string | null;
};

function PendingInbox({ items }: { items: PendingItem[] }) {
  if (items.length === 0) {
    return (
      <Card className="rounded-xl border-gray-200">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 text-gray-500">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <p className="text-sm">辦公室一片祥和 — 沒有等你看的事。</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border-rose-200 bg-gradient-to-br from-rose-50/50 to-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-rose-700">
          <AlertTriangle className="h-4 w-4" />
          等你看 · {items.length} 件
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <PendingRow key={item.outcomeId} item={item} />
        ))}
      </CardContent>
    </Card>
  );
}

function PendingRow({ item }: { item: PendingItem }) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();
  const ack = trpc.agent.acknowledge.useMutation({
    onSuccess: () => {
      utils.agent.pendingForJeff.invalidate();
      utils.agent.recentActivity.invalidate();
      utils.agent.snapshot.invalidate();
      utils.agent.agentOffice.invalidate();
    },
  });

  const isEscalation = item.actionTaken.includes("escalate");
  const lowConfidence = item.confidence != null && item.confidence < 70;
  const agentDef = AGENT_DEFS.find((a) => a.id === item.agentName);
  const summary =
    item.contentSummary ??
    (item.content ? item.content.slice(0, 120) : "(無內容)");

  return (
    <div
      className={`rounded-lg border bg-white p-3 transition-shadow ${
        expanded ? "shadow-sm border-gray-300" : "border-gray-200"
      }`}
    >
      <div
        className="flex items-start gap-3 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-shrink-0 mt-0.5">
          {isEscalation ? (
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-100 px-2 py-0.5 rounded">
              升級
            </span>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
              低信心
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-0.5">
            <span className="font-semibold text-gray-700">
              {agentDef?.label ?? item.agentName}
            </span>
            <span>·</span>
            <span>{item.channel ?? "—"}</span>
            <span>·</span>
            <span>
              {new Date(item.createdAt).toLocaleString("zh-TW", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {item.customerEmail && (
              <>
                <span>·</span>
                <span className="font-mono text-[11px]">
                  {item.customerEmail}
                </span>
              </>
            )}
          </div>
          <p className="text-sm text-gray-800 line-clamp-2">{summary}</p>
        </div>
        <div className="text-right flex-shrink-0">
          {item.confidence != null && (
            <div
              className={`text-sm font-bold tabular-nums ${
                lowConfidence ? "text-amber-700" : "text-gray-700"
              }`}
            >
              {item.confidence}%
            </div>
          )}
          <ArrowRight
            className={`h-4 w-4 text-gray-400 transition-transform inline-block ${
              expanded ? "rotate-90" : ""
            }`}
          />
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
          {item.content && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
                客戶原文
              </p>
              <pre className="text-xs whitespace-pre-wrap font-sans bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto">
                {item.content}
              </pre>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Meta label="分類" value={item.classification ?? "—"} />
            <Meta label="情感" value={item.sentiment ?? "—"} />
            <Meta label="緊急" value={String(item.urgency ?? "—")} />
            <Meta label="動作" value={item.actionTaken} />
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
              你的回覆 (給 agent,他會學習)
            </p>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如:這種情況以後可以直接 escalate / 其實這封 confidence 抓太低,可以自動回 / 客人想要的不是這個,實際是…"
              className="rounded-lg text-xs min-h-[60px]"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                ack.mutate({
                  outcomeId: item.outcomeId,
                  verdict: "approved",
                  reason: reason || undefined,
                })
              }
              disabled={ack.isPending}
              className="rounded-lg gap-1.5"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              這次判斷正確
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                ack.mutate({
                  outcomeId: item.outcomeId,
                  verdict: "override",
                  reason: reason || undefined,
                })
              }
              disabled={ack.isPending || !reason.trim()}
              className="rounded-lg gap-1.5 text-rose-700 border-rose-300 hover:bg-rose-50"
              title={!reason.trim() ? "請先填寫原因" : ""}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              我有不同意見
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
        {label}
      </div>
      <div className="text-xs font-semibold text-gray-700 mt-0.5">
        <code className="text-[11px]">{value}</code>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Agent Desks — 5 cards in a row, click to switch focus
// ────────────────────────────────────────────────────────────────────────

function AgentDesks({
  active,
  onSelect,
}: {
  active: AgentId;
  onSelect: (id: AgentId) => void;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {AGENT_DEFS.map((a) => (
        <AgentDeskCard
          key={a.id}
          agent={a}
          isActive={active === a.id}
          onClick={() => onSelect(a.id)}
        />
      ))}
    </div>
  );
}

function AgentDeskCard({
  agent,
  isActive,
  onClick,
}: {
  agent: (typeof AGENT_DEFS)[number];
  isActive: boolean;
  onClick: () => void;
}) {
  const office = trpc.agent.agentOffice.useQuery({ agentName: agent.id });
  const colors = COLOR_MAP[agent.color];
  const Icon = agent.icon;
  const data = office.data;
  const status = data?.status ?? "off";

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition-all ${
        isActive
          ? `${colors.bg} ${colors.border} ring-2 ${colors.ring}`
          : "bg-white border-gray-200 hover:border-gray-300"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div
          className={`rounded-md p-1.5 ${
            isActive ? "bg-white" : colors.bg
          }`}
        >
          <Icon
            className={`h-3.5 w-3.5 ${isActive ? colors.text : colors.text}`}
          />
        </div>
        <StatusDot status={status} />
      </div>
      <div className="text-sm font-bold text-gray-900 mb-0.5">{agent.label}</div>
      <div className="text-[10px] text-gray-500 mb-2">{agent.name}</div>
      <div className="flex items-center justify-between text-xs">
        <div className="text-gray-500">
          今日 <span className="font-bold text-gray-900 tabular-nums">{data?.todayCount ?? 0}</span>
        </div>
        {(data?.pendingCount ?? 0) > 0 ? (
          <div className="text-rose-600 font-bold tabular-nums">
            ⚠ {data?.pendingCount}
          </div>
        ) : (
          <div className="text-gray-400">—</div>
        )}
      </div>
    </button>
  );
}

function StatusDot({ status }: { status: "active" | "demo" | "off" }) {
  const map = {
    active: { dot: "bg-emerald-500", label: "ON" },
    demo: { dot: "bg-amber-400", label: "DEMO" },
    off: { dot: "bg-gray-300", label: "OFF" },
  } as const;
  const m = map[status];
  return (
    <div className="flex items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
        {m.label}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Agent Desk Detail — the "open" desk view for the selected agent
// ────────────────────────────────────────────────────────────────────────

function AgentDeskDetail({
  agent,
}: {
  agent: (typeof AGENT_DEFS)[number];
}) {
  const colors = COLOR_MAP[agent.color];
  const office = trpc.agent.agentOffice.useQuery({ agentName: agent.id });
  const activity = trpc.agent.recentActivity.useQuery({
    agentName: agent.id,
    hours: 48,
  });
  const policy = trpc.agent.getActivePolicy.useQuery({ agentName: agent.id });
  const [showWorkLog, setShowWorkLog] = useState(false);

  const today = (activity.data ?? []).filter((r) =>
    isToday(new Date(r.createdAt))
  );
  const yesterday = (activity.data ?? []).filter(
    (r) => !isToday(new Date(r.createdAt))
  );

  return (
    <Card className={`rounded-xl border-2 ${colors.border} ${colors.bg}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <agent.icon className={`h-5 w-5 ${colors.text}`} />
              {agent.name} 的辦公桌
              <StatusDot status={office.data?.status ?? "off"} />
            </CardTitle>
            <p className="text-sm text-gray-700 mt-1 italic">
              「{agent.persona}」
            </p>
          </div>
          <div className="text-right text-xs">
            <div className="text-gray-500">policy</div>
            <div className="font-bold text-gray-900">
              v{office.data?.policyVersion ?? "—"}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 bg-white rounded-b-xl">
        {/* PRIMARY: Chat with this agent */}
        <AgentChatPanel agentId={agent.id} agentLabel={agent.label} colors={colors} />

        {/* Work log toggle (collapsed by default) */}
        <button
          onClick={() => setShowWorkLog((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 rounded-lg transition"
        >
          <span className="uppercase tracking-wider">
            工作日誌 · 今日 {today.length} 件 · 昨日 {yesterday.length} 件
          </span>
          <ArrowRight className={`h-3.5 w-3.5 transition-transform ${showWorkLog ? "rotate-90" : ""}`} />
        </button>
        {showWorkLog && (
          <div className="space-y-3 px-1">
            {today.length > 0 && (
              <Section title={`今天 · ${today.length} 件`}>
                <Timeline items={today} />
              </Section>
            )}
            {yesterday.length > 0 && (
              <Section title={`昨天 · ${yesterday.length} 件`}>
                <Timeline items={yesterday.slice(0, 10)} compact />
              </Section>
            )}
            {today.length === 0 && yesterday.length === 0 && (
              <p className="text-xs text-gray-400 italic px-2">
                還沒有自動執行的紀錄 — {office.data?.status === "off" ? "我尚未上線" : "等客戶觸發"}。
              </p>
            )}
            <Section title={`政策 v${policy.data?.version ?? "—"}`}>
              {policy.data ? (
                <pre className="text-[11px] bg-gray-50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-48 leading-relaxed">
                  {policy.data.rules}
                </pre>
              ) : (
                <p className="text-xs text-gray-400 italic">
                  第一次跑時會自動寫入 v1 政策。
                </p>
              )}
            </Section>
          </div>
        )}

        {/* Per-agent demo panel */}
        {agent.id === "inquiry" && <InquiryAgentDemo />}
        {agent.id === "review" && <ReviewAgentDemo />}
        {agent.id === "followup" && <FollowupAgentDemo />}
        {agent.id === "refund" && <RefundAgentDemo />}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────
// AgentChatPanel — 1-on-1 chat with a specific agent
// ────────────────────────────────────────────────────────────────────────

function AgentChatPanel({
  agentId,
  agentLabel,
  colors,
}: {
  agentId: AgentId;
  agentLabel: string;
  colors: { bg: string; border: string; text: string; ring: string };
}) {
  const [draft, setDraft] = useState("");
  const utils = trpc.useUtils();
  const conv = trpc.agent.listConversation.useQuery(
    { agentName: agentId, limit: 80 },
    { refetchInterval: 60_000 }
  );
  const send = trpc.agent.sendToAgent.useMutation({
    onSuccess: () => {
      setDraft("");
      conv.refetch();
      utils.agent.unreadPerAgent.invalidate();
      utils.agent.unreadMessageCount.invalidate();
      utils.agent.listMessages.invalidate();
    },
  });
  const onSend = () => {
    if (!draft.trim() || send.isPending) return;
    send.mutate({ agentName: agentId, body: draft.trim() });
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    }
  };

  const messages = conv.data ?? [];

  return (
    <div className={`rounded-xl border-2 ${colors.border} ${colors.bg} p-3`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
          💬 跟 {agentLabel} 直接對話
        </span>
        <span className="text-[10px] text-gray-500">
          {messages.length} 則訊息
        </span>
      </div>

      {/* Message list */}
      <div className="bg-white rounded-lg border border-gray-200 min-h-[200px] max-h-[420px] overflow-y-auto p-3 space-y-2.5">
        {messages.length === 0 ? (
          <div className="text-center text-xs text-gray-400 italic py-12">
            還沒對話 — 你可以問問他「最近怎麼樣?」「有什麼建議?」「上次客人投訴你是怎麼想的?」
          </div>
        ) : (
          messages.map((m: any) => <ChatBubble key={m.id} msg={m} agentColors={colors} />)
        )}
        {send.isPending && (
          <div className="flex items-center gap-2 text-xs text-gray-400 italic px-2 py-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{agentLabel} 思考中…</span>
          </div>
        )}
      </div>

      {/* Compose box */}
      <div className="mt-2 flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="跟他說一句話…(Cmd+Enter 送出)"
          className="rounded-lg text-sm min-h-[60px] flex-1"
          disabled={send.isPending}
        />
        <Button
          onClick={onSend}
          disabled={!draft.trim() || send.isPending}
          className="rounded-lg gap-2 self-stretch px-4"
        >
          {send.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
      {send.error && (
        <p className="mt-2 text-xs text-rose-700">{send.error.message}</p>
      )}
    </div>
  );
}

function ChatBubble({
  msg,
  agentColors,
}: {
  msg: any;
  agentColors: { bg: string; border: string; text: string; ring: string };
}) {
  const fromJeff = msg.senderRole === "jeff";
  const priorityBadge =
    msg.priority === "critical"
      ? "bg-rose-100 text-rose-700"
      : msg.priority === "high"
      ? "bg-amber-100 text-amber-700"
      : null;

  return (
    <div
      className={`flex ${fromJeff ? "justify-end" : "justify-start"} group`}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 ${
          fromJeff
            ? "bg-gray-900 text-white rounded-br-sm"
            : `${agentColors.bg} ${agentColors.text} border ${agentColors.border} rounded-bl-sm`
        }`}
      >
        {/* Header line — type + priority + time */}
        <div
          className={`text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5 ${
            fromJeff ? "opacity-70" : "opacity-80"
          }`}
        >
          <span>
            {fromJeff
              ? "你"
              : msg.messageType === "escalation"
              ? "🚨 升級"
              : msg.messageType === "alert"
              ? "⚠ 警報"
              : msg.messageType === "digest"
              ? "📋 週報"
              : msg.messageType === "proposal"
              ? "💡 建議"
              : msg.messageType === "question"
              ? "❓ 問題"
              : "💬"}
          </span>
          {priorityBadge && (
            <span className={`${priorityBadge} text-[9px] font-bold px-1 py-0.5 rounded`}>
              {msg.priority}
            </span>
          )}
          <span className="opacity-70">·</span>
          <span className="opacity-70">
            {new Date(msg.createdAt).toLocaleString("zh-TW", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>

        {/* Title if differs from body's first line */}
        {msg.title && msg.title !== msg.body.slice(0, msg.title.length) && (
          <div className={`text-sm font-bold mb-1 ${fromJeff ? "" : ""}`}>
            {msg.title}
          </div>
        )}

        {/* Body */}
        <div className="text-sm whitespace-pre-wrap leading-relaxed">
          {msg.body}
        </div>

        {/* Context (escalations) — collapsible */}
        {msg.context && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] opacity-70 hover:opacity-100">
              context
            </summary>
            <pre className="mt-1 text-[10px] bg-black/10 rounded p-2 overflow-x-auto">
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(msg.context), null, 2);
                } catch {
                  return msg.context;
                }
              })()}
            </pre>
          </details>
        )}

        {/* Existing Jeff response (from old escalation flow) */}
        {msg.jeffResponse && !fromJeff && (
          <div className="mt-2 pt-2 border-t border-current/20 text-[11px] italic opacity-90">
            你早先回覆: {msg.jeffResponse}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}

type TimelineItem = {
  outcomeId: number;
  actionTaken: string;
  confidence: number | null;
  outcomeFinalized: number;
  jeffOverride: number;
  createdAt: Date | string;
  channel: string | null;
  contentSummary: string | null;
  classification: string | null;
  customerEmail: string | null;
};

function Timeline({
  items,
  compact = false,
}: {
  items: TimelineItem[];
  compact?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((i) => {
        const isEsc = i.actionTaken.includes("escalate");
        const lowConf = i.confidence != null && i.confidence < 70;
        const final = i.outcomeFinalized === 1;
        return (
          <div
            key={i.outcomeId}
            className="flex items-start gap-3 text-xs py-1.5 border-b border-gray-100 last:border-0"
          >
            <span className="text-gray-400 font-mono text-[10px] w-12 flex-shrink-0 pt-0.5">
              {new Date(i.createdAt).toLocaleString("zh-TW", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 ${
                isEsc
                  ? "bg-rose-100 text-rose-700"
                  : lowConf
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {isEsc ? "升級" : lowConf ? "低信心" : "自動"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-gray-800 truncate">
                {i.contentSummary ??
                  i.classification ??
                  i.actionTaken}
              </div>
              {!compact && i.customerEmail && (
                <div className="text-[10px] text-gray-400 font-mono">
                  {i.customerEmail} · {i.channel}
                </div>
              )}
            </div>
            <span
              className={`text-[11px] font-bold tabular-nums w-10 text-right ${
                lowConf ? "text-amber-700" : "text-gray-500"
              }`}
            >
              {i.confidence != null ? `${i.confidence}%` : "—"}
            </span>
            <span className="flex-shrink-0 w-12 text-right text-[10px]">
              {final ? (
                i.jeffOverride === 1 ? (
                  <span className="text-rose-600 font-bold">override</span>
                ) : (
                  <span className="text-emerald-600 font-bold">✓ ack</span>
                )
              ) : (
                <span className="text-gray-400">未看</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// InquiryAgentDemo — paste a real email, see what the agent would do.
// Lives inside Inquiry's desk now.
// ────────────────────────────────────────────────────────────────────────

function InquiryAgentDemo() {
  const [rawMessage, setRawMessage] = useState("");
  const [channel, setChannel] = useState<
    "email" | "web_form" | "whatsapp" | "wechat" | "line" | "sms"
  >("email");
  const [result, setResult] = useState<any>(null);

  const utils = trpc.useUtils();
  const demo = trpc.agent.demoInquiry.useMutation({
    onSuccess: (data) => {
      setResult(data);
      utils.agent.snapshot.invalidate();
      utils.agent.recentOutcomes.invalidate();
      utils.agent.recentActivity.invalidate();
      utils.agent.agentOffice.invalidate();
      utils.agent.pendingForJeff.invalidate();
    },
  });

  const run = () => {
    setResult(null);
    demo.mutate({ rawMessage, channel });
  };

  const charCount = rawMessage.length;
  const canRun = charCount >= 10 && !demo.isPending;

  return (
    <Section title="練習場 — 貼一封信看我會怎麼做(不會寄出)">
      <Card className="rounded-xl border-gray-200">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-700">
              頻道:
            </label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as any)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
            >
              <option value="email">email</option>
              <option value="web_form">web_form</option>
              <option value="whatsapp">whatsapp</option>
              <option value="wechat">wechat</option>
              <option value="line">line</option>
              <option value="sms">sms</option>
            </select>
          </div>

          <Textarea
            value={rawMessage}
            onChange={(e) => setRawMessage(e.target.value)}
            placeholder={`貼上完整的客戶來信(包括 from / subject / body)。例如:\n\nFrom: lisa.chen@example.com\nSubject: 八月去黃石公園\n\n您好,我們一家四口想八月底去黃石,有 10 天時間。預算約 USD 12000。小孩 6 歲和 11 歲,想知道有沒有適合家庭的團體行程?`}
            className="min-h-[160px] rounded-lg text-xs font-mono"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-400">
              {charCount}/50000 字元
            </span>
            <Button
              onClick={run}
              disabled={!canRun}
              className="rounded-lg gap-2"
            >
              {demo.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  思考中…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  跑 InquiryAgent
                </>
              )}
            </Button>
          </div>

          {demo.error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <p className="font-semibold mb-1">錯誤:</p>
              <p>{demo.error.message}</p>
            </div>
          )}

          {result && <InquiryAgentResult result={result} />}
        </CardContent>
      </Card>
    </Section>
  );
}

function InquiryAgentResult({ result }: { result: any }) {
  const d = result.decision;
  const isEscalated = d.shouldEscalate;
  return (
    <div className="space-y-4 mt-2">
      <div
        className={`rounded-xl border-2 p-4 ${
          isEscalated
            ? "border-rose-200 bg-rose-50"
            : "border-emerald-200 bg-emerald-50"
        }`}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              我的決定
            </div>
            <div
              className={`text-lg font-bold ${
                isEscalated ? "text-rose-700" : "text-emerald-700"
              }`}
            >
              {isEscalated ? "⚠ Escalate Jeff" : "✓ 自動回覆(草稿已備)"}
            </div>
            {d.escalationReason && (
              <p className="text-xs text-rose-700 mt-1 italic">
                原因:{d.escalationReason}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              信心
            </div>
            <div
              className={`text-2xl font-bold tabular-nums ${
                d.confidence >= 80
                  ? "text-emerald-700"
                  : d.confidence >= 60
                  ? "text-amber-600"
                  : "text-rose-700"
              }`}
            >
              {d.confidence}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <ResultField label="分類" value={d.classification} />
          <ResultField label="緊急度" value={d.urgency} />
          <ResultField label="情感" value={d.sentiment} />
          <ResultField label="回覆語言" value={d.draftLanguage} />
        </div>
      </div>

      <Card className="rounded-xl border-gray-200">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <MessageCircle className="h-3.5 w-3.5" />
            我對客戶意圖的理解
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-gray-700">{d.intent}</p>
          {d.extractedCustomer &&
            (d.extractedCustomer.senderEmail ||
              d.extractedCustomer.senderName) && (
              <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600">
                <span className="font-semibold">寄件人:</span>{" "}
                {d.extractedCustomer.senderName && (
                  <span>{d.extractedCustomer.senderName}</span>
                )}
                {d.extractedCustomer.senderEmail && (
                  <span className="ml-2 text-gray-500">
                    &lt;{d.extractedCustomer.senderEmail}&gt;
                  </span>
                )}
              </div>
            )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border-gray-200">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold flex items-center justify-between">
            <span>我會這樣回({d.draftLanguage})</span>
            <Badge variant="outline" className="rounded-md text-[10px]">
              {isEscalated ? "草稿僅供你參考" : "可審後送出"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <pre className="text-sm whitespace-pre-wrap font-sans text-gray-800 bg-gray-50 rounded-lg p-4 leading-relaxed">
            {d.draftReply}
          </pre>
        </CardContent>
      </Card>

      <Card className="rounded-xl border-gray-200">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold">我為什麼這樣決定</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-gray-600 italic leading-relaxed">
            {d.reasoning}
          </p>
          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] text-gray-500">
            <div>
              <span className="font-semibold">policy v</span>{" "}
              {result.policyVersion ?? "—"}
            </div>
            <div>
              <span className="font-semibold">profile #</span>{" "}
              {result.profileId ?? "未建立"}
            </div>
            <div>
              <span className="font-semibold">interaction #</span>{" "}
              {result.interactionId ?? "未記錄"}
            </div>
            <div>
              <span className="font-semibold">outcome #</span>{" "}
              {result.outcomeId ?? "未記錄"}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ResultField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {label}
      </div>
      <div className="text-sm font-bold text-gray-900 mt-0.5">
        <code className="text-xs bg-white/60 px-1.5 py-0.5 rounded">{value}</code>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Customer Profile lookup
// ────────────────────────────────────────────────────────────────────────

function CustomerProfileLookup({
  search,
  setSearch,
}: {
  search: string;
  setSearch: (v: string) => void;
}) {
  const trimmed = search.trim();
  const isEmail = trimmed.includes("@");
  const isPhone = /^\+?[\d\s\-]{6,}$/.test(trimmed);
  const findArgs =
    !trimmed || trimmed.length < 3
      ? null
      : isEmail
      ? { email: trimmed }
      : isPhone
      ? { phone: trimmed.replace(/\s+/g, "") }
      : { wechatId: trimmed };

  const found = trpc.agent.findProfile.useQuery(findArgs ?? {}, {
    enabled: !!findArgs,
  });

  const profileId = found.data?.id;
  const ctx = trpc.agent.getProfileWithContext.useQuery(
    { profileId: profileId ?? 0 },
    { enabled: !!profileId }
  );

  return (
    <Card className="rounded-xl">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <Users className="h-4 w-4" />
          客戶記憶查詢
        </CardTitle>
        <p className="text-xs text-gray-500 mt-1">
          支援 email / 電話 / wechatId — 跨頻道身份合併後的完整記憶。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="cs@example.com 或 +1 510..."
            className="pl-9 rounded-lg"
          />
        </div>

        {!findArgs && (
          <p className="text-xs text-gray-400 italic">
            請輸入至少 3 個字符。
          </p>
        )}

        {findArgs && found.data === null && !found.isLoading && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>查無 profile — 第一次互動時 agent 會自動建立。</span>
          </div>
        )}

        {found.data && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="VIP 分數" value={found.data.vipScore} />
              <Stat
                label="總消費"
                value={`$${(found.data.totalSpend / 100).toFixed(0)}`}
              />
              <Stat label="預訂次數" value={found.data.bookingCount} />
              <Stat label="狀態" value={found.data.status} />
            </div>

            {found.data.aiNotes && (
              <Card className="rounded-lg bg-gray-50 border-gray-200">
                <CardContent className="p-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 font-bold">
                    AI 觀察筆記
                  </p>
                  <p className="text-xs text-gray-700 whitespace-pre-wrap">
                    {found.data.aiNotes}
                  </p>
                </CardContent>
              </Card>
            )}

            {ctx.data && ctx.data.recentInteractions.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-gray-600 mb-2 uppercase tracking-wider">
                  最近 20 次互動
                </h4>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <Th>時間</Th>
                        <Th>頻道</Th>
                        <Th>方向</Th>
                        <Th>來源</Th>
                        <Th>情感</Th>
                        <Th>分類</Th>
                        <Th>內容摘要</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {ctx.data.recentInteractions.map((i: any) => (
                        <tr key={i.id}>
                          <Td>
                            {new Date(i.createdAt).toLocaleString("zh-TW", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </Td>
                          <Td>{i.channel}</Td>
                          <Td>
                            {i.direction === "inbound" ? "← 客戶" : "→ AI"}
                          </Td>
                          <Td>{i.generatedBy ?? "—"}</Td>
                          <Td>{i.sentiment ?? "—"}</Td>
                          <Td>{i.classification ?? "—"}</Td>
                          <Td className="max-w-xs truncate">
                            {i.contentSummary ?? i.content.slice(0, 60)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">
      {children}
    </th>
  );
}
function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
        {label}
      </div>
      <div className="text-xl font-bold text-gray-900 tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function isToday(d: Date): boolean {
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

// ────────────────────────────────────────────────────────────────────────
// ReviewAgent demo
// ────────────────────────────────────────────────────────────────────────

function ReviewAgentDemo() {
  const [reviewText, setReviewText] = useState("");
  const [rating, setRating] = useState(5);
  const [senderEmail, setSenderEmail] = useState("");
  const [result, setResult] = useState<any>(null);
  const utils = trpc.useUtils();
  const demo = trpc.agent.demoReview.useMutation({
    onSuccess: (data) => {
      setResult(data);
      utils.agent.snapshot.invalidate();
      utils.agent.recentActivity.invalidate();
      utils.agent.agentOffice.invalidate();
      utils.agent.officeOverview.invalidate();
    },
  });
  const run = () => {
    setResult(null);
    demo.mutate({
      reviewText,
      rating,
      senderEmail: senderEmail.trim() || undefined,
    });
  };
  return (
    <Section title="練習場 — 貼一條評論看我會怎麼回(不會公開發布)">
      <Card className="rounded-xl border-gray-200">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-4">
            <label className="text-xs font-semibold text-gray-700">評分:</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  className={`text-xl transition-transform ${
                    n <= rating ? "text-amber-500" : "text-gray-300"
                  }`}
                >
                  ★
                </button>
              ))}
              <span className="ml-2 text-xs text-gray-500 self-center">
                {rating}/5
              </span>
            </div>
            <label className="text-xs font-semibold text-gray-700 ml-4">
              客人 email (可選):
            </label>
            <Input
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              placeholder="lisa@example.com"
              className="rounded-lg text-xs max-w-xs"
            />
          </div>
          <Textarea
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            placeholder="貼上客戶評論原文,例如:&#10;&#10;這次黃石之旅整體不錯,行程安排很豐富。不過第二天的飯店有點老舊,熱水不太穩定..."
            className="min-h-[140px] rounded-lg text-xs"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-400">
              {reviewText.length}/10000 字元
            </span>
            <Button
              onClick={run}
              disabled={reviewText.length < 5 || demo.isPending}
              className="rounded-lg gap-2"
            >
              {demo.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  思考中…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  跑 ReviewAgent
                </>
              )}
            </Button>
          </div>
          {demo.error && (
            <ErrorBox message={demo.error.message} />
          )}
          {result && <ReviewResult result={result} />}
        </CardContent>
      </Card>
    </Section>
  );
}

function ReviewResult({ result }: { result: any }) {
  const d = result.decision;
  return (
    <div className="space-y-3 mt-2">
      <div
        className={`rounded-xl border-2 p-4 ${
          d.shouldEscalate
            ? "border-rose-200 bg-rose-50"
            : "border-emerald-200 bg-emerald-50"
        }`}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
              我的決定
            </div>
            <div
              className={`text-lg font-bold ${
                d.shouldEscalate ? "text-rose-700" : "text-emerald-700"
              }`}
            >
              {d.shouldEscalate ? "⚠ Escalate Jeff" : "✓ 自動公開回覆"}
            </div>
            {d.escalationReason && (
              <p className="text-xs text-rose-700 mt-1 italic">
                {d.escalationReason}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
              信心
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {d.confidence}
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-2 flex-wrap">
          <Badge variant="secondary" className="rounded-md text-[10px]">
            {d.classification}
          </Badge>
          <Badge variant="secondary" className="rounded-md text-[10px]">
            {d.sentiment}
          </Badge>
          {d.themes.map((t: string) => (
            <Badge key={t} variant="outline" className="rounded-md text-[10px]">
              {t}
            </Badge>
          ))}
        </div>
      </div>
      <Card className="rounded-xl border-gray-200">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold">
            我會這樣公開回({d.draftLanguage})
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <pre className="text-sm whitespace-pre-wrap font-sans bg-gray-50 rounded-lg p-4 leading-relaxed">
            {d.draftReply}
          </pre>
        </CardContent>
      </Card>
      <ReasoningCard reasoning={d.reasoning} meta={result} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// MarketingAgent demo
// ────────────────────────────────────────────────────────────────────────

function MarketingAgentDemo() {
  const [segment, setSegment] = useState("");
  const [topic, setTopic] = useState("");
  const [language, setLanguage] = useState<"zh-TW" | "zh-CN" | "en">("zh-TW");
  const [additionalContext, setAdditionalContext] = useState("");
  const [result, setResult] = useState<any>(null);
  const utils = trpc.useUtils();
  const demo = trpc.agent.demoMarketing.useMutation({
    onSuccess: (data) => {
      setResult(data);
      utils.agent.recentActivity.invalidate();
      utils.agent.agentOffice.invalidate();
      utils.agent.officeOverview.invalidate();
    },
  });
  const run = () => {
    setResult(null);
    demo.mutate({
      segment,
      topic,
      language,
      additionalContext: additionalContext || undefined,
    });
  };
  return (
    <Section title="練習場 — 給 segment + 主題,我寫一封 EDM">
      <Card className="rounded-xl border-gray-200">
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                目標 segment
              </label>
              <Input
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                placeholder="例:首次詢問未下訂、去年來過西雅圖的客戶"
                className="rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                推廣主題
              </label>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="例:黃石公園夏季團、感恩節長週末紐約"
                className="rounded-lg text-xs"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold text-gray-700">語言:</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as any)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
            >
              <option value="zh-TW">繁體中文</option>
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </div>
          <Textarea
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            placeholder="(可選)補充資訊 — 例如客戶痛點、特殊優惠、行程亮點"
            className="min-h-[80px] rounded-lg text-xs"
          />
          <div className="flex items-center justify-end">
            <Button
              onClick={run}
              disabled={!segment || !topic || demo.isPending}
              className="rounded-lg gap-2"
            >
              {demo.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  寫信中…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  寫 EDM
                </>
              )}
            </Button>
          </div>
          {demo.error && <ErrorBox message={demo.error.message} />}
          {result && <MarketingResult result={result} />}
        </CardContent>
      </Card>
    </Section>
  );
}

function MarketingResult({ result }: { result: any }) {
  const d = result.decision;
  return (
    <div className="space-y-3 mt-2">
      <Card className="rounded-xl border-purple-200 bg-purple-50/30">
        <CardContent className="p-4 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
              主旨
            </div>
            <div className="font-bold text-gray-900">{d.subject}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
              Preheader (gmail 預覽文字)
            </div>
            <div className="text-sm text-gray-700 italic">{d.preheader}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
              內文
            </div>
            <pre className="text-sm whitespace-pre-wrap font-sans bg-white rounded-lg p-4 leading-relaxed border border-purple-100">
              {d.body}
            </pre>
          </div>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <Badge variant="secondary" className="rounded-md">
              CTA: {d.callToAction}
            </Badge>
            <Badge variant="outline" className="rounded-md">
              閱讀時間: {d.estimatedReadingTime}
            </Badge>
            <Badge
              variant="outline"
              className="rounded-md ml-auto tabular-nums"
            >
              信心 {d.confidence}
            </Badge>
          </div>
        </CardContent>
      </Card>
      <Card className="rounded-xl border-gray-200">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold">
            我的公平自我檢查
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-xs text-gray-700 italic">
          {d.fairnessCheck}
        </CardContent>
      </Card>
      <ReasoningCard reasoning={d.reasoning} meta={result} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// FollowupAgent demo
// ────────────────────────────────────────────────────────────────────────

function FollowupAgentDemo() {
  const [stage, setStage] = useState<"pre_departure" | "mid_trip" | "post_trip">(
    "pre_departure"
  );
  const [daysFromStart, setDaysFromStart] = useState(-3);
  const [customerName, setCustomerName] = useState("");
  const [destinationSummary, setDestinationSummary] = useState("");
  const [bookingNotes, setBookingNotes] = useState("");
  const [language, setLanguage] = useState<"zh-TW" | "zh-CN" | "en">("zh-TW");
  const [result, setResult] = useState<any>(null);
  const utils = trpc.useUtils();
  const demo = trpc.agent.demoFollowup.useMutation({
    onSuccess: (data) => {
      setResult(data);
      utils.agent.recentActivity.invalidate();
      utils.agent.agentOffice.invalidate();
      utils.agent.officeOverview.invalidate();
    },
  });
  const run = () => {
    setResult(null);
    demo.mutate({
      stage,
      daysFromStart,
      customerName: customerName.trim() || undefined,
      destinationSummary,
      bookingNotes: bookingNotes.trim() || undefined,
      language,
      isFirstFollowup: true,
    });
  };
  return (
    <Section title="練習場 — 給情境,我寫一則關懷訊息">
      <Card className="rounded-xl border-gray-200">
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                階段
              </label>
              <select
                value={stage}
                onChange={(e) => {
                  setStage(e.target.value as any);
                  setDaysFromStart(
                    e.target.value === "pre_departure"
                      ? -3
                      : e.target.value === "mid_trip"
                      ? 3
                      : 7
                  );
                }}
                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="pre_departure">出發前</option>
                <option value="mid_trip">旅途中</option>
                <option value="post_trip">回國後</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                距出發 {daysFromStart < 0 ? "天前" : "天後"}
              </label>
              <Input
                type="number"
                value={daysFromStart}
                onChange={(e) => setDaysFromStart(Number(e.target.value))}
                className="rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                語言
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as any)}
                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="zh-TW">繁體中文</option>
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                客人姓名 (可選)
              </label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="王太太"
                className="rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                目的地摘要
              </label>
              <Input
                value={destinationSummary}
                onChange={(e) => setDestinationSummary(e.target.value)}
                placeholder="黃石公園 10 日 / 紐約 7 日"
                className="rounded-lg text-xs"
              />
            </div>
          </div>
          <Textarea
            value={bookingNotes}
            onChange={(e) => setBookingNotes(e.target.value)}
            placeholder="(可選)訂單備註 — 例如小孩年齡、特殊飲食、紀念日"
            className="min-h-[60px] rounded-lg text-xs"
          />
          <div className="flex items-center justify-end">
            <Button
              onClick={run}
              disabled={!destinationSummary || demo.isPending}
              className="rounded-lg gap-2"
            >
              {demo.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  寫中…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  寫關懷訊息
                </>
              )}
            </Button>
          </div>
          {demo.error && <ErrorBox message={demo.error.message} />}
          {result && <FollowupResult result={result} />}
        </CardContent>
      </Card>
    </Section>
  );
}

function FollowupResult({ result }: { result: any }) {
  const d = result.decision;
  return (
    <div className="space-y-3 mt-2">
      <Card className="rounded-xl border-amber-200 bg-amber-50/30">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge className="rounded-md">{d.channel}</Badge>
            {d.subject && (
              <span className="text-sm font-bold text-gray-900">
                主旨:{d.subject}
              </span>
            )}
            <Badge variant="outline" className="rounded-md ml-auto tabular-nums">
              信心 {d.confidence}
            </Badge>
          </div>
          <pre className="text-sm whitespace-pre-wrap font-sans bg-white rounded-lg p-4 leading-relaxed border border-amber-100">
            {d.body}
          </pre>
        </CardContent>
      </Card>
      <ReasoningCard reasoning={d.reasoning} meta={result} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// RefundAgent demo — always escalates
// ────────────────────────────────────────────────────────────────────────

function RefundAgentDemo() {
  const [rawMessage, setRawMessage] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [result, setResult] = useState<any>(null);
  const utils = trpc.useUtils();
  const demo = trpc.agent.demoRefund.useMutation({
    onSuccess: (data) => {
      setResult(data);
      utils.agent.recentActivity.invalidate();
      utils.agent.agentOffice.invalidate();
      utils.agent.officeOverview.invalidate();
      utils.agent.unreadMessageCount.invalidate();
      utils.agent.listMessages.invalidate();
    },
  });
  const run = () => {
    setResult(null);
    demo.mutate({ rawMessage, senderEmail: senderEmail.trim() || undefined });
  };
  return (
    <Section title="練習場 — 貼一封退款請求,我做 triage 並寫內部 briefing 給你">
      <Card className="rounded-xl border-rose-200 bg-rose-50/20">
        <CardContent className="space-y-3 p-4">
          <div className="rounded-lg bg-rose-100 border border-rose-200 p-2 text-[11px] text-rose-800">
            ⚠ 重要規則:我永遠 NEVER 直接回客戶,永遠 escalate 你。輸出 ONLY 給你看。
          </div>
          <Input
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            placeholder="客人 email (可選)"
            className="rounded-lg text-xs"
          />
          <Textarea
            value={rawMessage}
            onChange={(e) => setRawMessage(e.target.value)}
            placeholder="貼上客戶退款請求原文..."
            className="min-h-[160px] rounded-lg text-xs font-mono"
          />
          <div className="flex items-center justify-end">
            <Button
              onClick={run}
              disabled={rawMessage.length < 10 || demo.isPending}
              className="rounded-lg gap-2"
            >
              {demo.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Triage 中…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  跑 RefundAgent
                </>
              )}
            </Button>
          </div>
          {demo.error && <ErrorBox message={demo.error.message} />}
          {result && <RefundResult result={result} />}
        </CardContent>
      </Card>
    </Section>
  );
}

function RefundResult({ result }: { result: any }) {
  const d = result.decision;
  const SEV_COLORS = {
    critical: "border-rose-300 bg-rose-50 text-rose-700",
    high: "border-amber-300 bg-amber-50 text-amber-700",
    medium: "border-amber-200 bg-amber-50/50 text-amber-700",
    low: "border-gray-200 bg-gray-50 text-gray-700",
  } as const;
  // Phase 1 Cluster C: d.severity comes through `any` (result is typed `any`).
  // Cast to the SEV_COLORS key set; fall back to "low" if absent / unknown.
  const sevKey = (d.severity as keyof typeof SEV_COLORS) in SEV_COLORS
    ? (d.severity as keyof typeof SEV_COLORS)
    : "low";
  const sevColor = SEV_COLORS[sevKey];

  return (
    <div className="space-y-3 mt-2">
      <div className={`rounded-xl border-2 p-4 ${sevColor}`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider opacity-70 font-bold">
              嚴重程度
            </div>
            <div className="text-xl font-bold">{d.severity.toUpperCase()}</div>
            <div className="text-xs mt-1">原因類別:{d.reasonCategory}</div>
            <div className="text-xs mt-0.5">客人情緒:{d.customerEmotionalState}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider opacity-70 font-bold">
              信心
            </div>
            <div className="text-2xl font-bold tabular-nums">{d.confidence}</div>
          </div>
        </div>
      </div>

      <Card className="rounded-xl border-gray-300 bg-gradient-to-br from-gray-50 to-white">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold">📋 給你的內部 briefing</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <p className="text-sm text-gray-800 leading-relaxed">
            {d.jeffInternalBriefing}
          </p>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
              抽取的事實
            </p>
            <div className="space-y-1 text-xs">
              {d.extractedFacts.bookingIdMentioned && (
                <div>訂單編號: <code>{d.extractedFacts.bookingIdMentioned}</code></div>
              )}
              {d.extractedFacts.amountMentioned && (
                <div>金額提及: <code>{d.extractedFacts.amountMentioned}</code></div>
              )}
              {d.extractedFacts.dateRangeMentioned && (
                <div>日期: <code>{d.extractedFacts.dateRangeMentioned}</code></div>
              )}
              {d.extractedFacts.specificIncidents.length > 0 && (
                <div>
                  具體事件:
                  <ul className="list-disc list-inside ml-2 mt-1">
                    {d.extractedFacts.specificIncidents.map(
                      (s: string, i: number) => (
                        <li key={i}>{s}</li>
                      )
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
              下一步建議
            </p>
            <ul className="list-disc list-inside text-xs space-y-0.5">
              {d.suggestedJeffActions.map((s: string, i: number) => (
                <li key={i} className="text-gray-700">{s}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
        💬 此 triage 已自動寫入「Agent 對話框」(critical 等級立刻通知)。
      </div>

      <ReasoningCard reasoning={d.reasoning} meta={result} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Shared mini components
// ────────────────────────────────────────────────────────────────────────

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
      <p className="font-semibold mb-1">錯誤:</p>
      <p>{message}</p>
    </div>
  );
}

function ReasoningCard({
  reasoning,
  meta,
}: {
  reasoning: string;
  meta: {
    policyVersion?: number;
    profileId?: number;
    interactionId?: number;
    outcomeId?: number;
  };
}) {
  return (
    <Card className="rounded-xl border-gray-200">
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-bold">我為什麼這樣決定</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-gray-600 italic leading-relaxed">{reasoning}</p>
        <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] text-gray-500">
          <div>
            <span className="font-semibold">policy v</span> {meta.policyVersion ?? "—"}
          </div>
          <div>
            <span className="font-semibold">profile #</span> {meta.profileId ?? "—"}
          </div>
          <div>
            <span className="font-semibold">interaction #</span> {meta.interactionId ?? "—"}
          </div>
          <div>
            <span className="font-semibold">outcome #</span> {meta.outcomeId ?? "—"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
