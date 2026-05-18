/**
 * Round 81 — PACK&GO 辦公群 (Slack-style chatroom)
 *
 * Layout:
 *   ┌─ Top bar: office stats ──────────────────────────────────┐
 *   │ Sidebar             │ Selected channel: bubbles + compose │
 *   │   #全體辦公群       │                                       │
 *   │   ── DMs ──         │                                       │
 *   │   InquiryAgent  [3] │                                       │
 *   │   ReviewAgent       │                                       │
 *   │   ...               │                                       │
 *   │   ── Settings ──    │                                       │
 *   │   📧 Gmail          │                                       │
 *   │   🏢 部門           │                                       │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Departments + Gmail panel live as collapsible sections in the sidebar
 * footer so the chat experience stays clean.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Building2,
  Users,
  Megaphone,
  Plane,
  Binoculars,
  ShieldCheck,
  Brain,
  Check,
  Mail,
  RefreshCw,
  LinkIcon,
  Unplug,
  AlertCircle,
  Send,
  Loader2,
  Hash,
  Bot,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  TrendingUp,
} from "lucide-react";

// ────────────────────────────────────────────────────────────────────────
// Agent metadata
// ────────────────────────────────────────────────────────────────────────

const AGENTS: {
  id: "inquiry" | "review" | "marketing" | "followup" | "refund";
  label: string;
  persona: string;
  color: "emerald" | "blue" | "purple" | "amber" | "rose";
  icon: React.ElementType;
}[] = [
  { id: "inquiry", label: "InquiryAgent", persona: "客戶詢問代理人", color: "emerald", icon: Bot },
  { id: "review", label: "ReviewAgent", persona: "評論審核代理人", color: "blue", icon: CheckCircle2 },
  { id: "marketing", label: "MarketingAgent", persona: "行銷代理人", color: "purple", icon: TrendingUp },
  { id: "followup", label: "FollowupAgent", persona: "客情關懷代理人", color: "amber", icon: Clock },
  { id: "refund", label: "RefundAgent", persona: "退款分流代理人", color: "rose", icon: ShieldCheck },
];

const COLOR: Record<
  string,
  { bg: string; bgHover: string; border: string; text: string; bubble: string }
> = {
  emerald: {
    bg: "bg-emerald-50",
    bgHover: "hover:bg-emerald-100",
    border: "border-emerald-200",
    text: "text-emerald-700",
    bubble: "bg-emerald-50 text-emerald-900 border-emerald-200",
  },
  blue: {
    bg: "bg-blue-50",
    bgHover: "hover:bg-blue-100",
    border: "border-blue-200",
    text: "text-blue-700",
    bubble: "bg-blue-50 text-blue-900 border-blue-200",
  },
  purple: {
    bg: "bg-purple-50",
    bgHover: "hover:bg-purple-100",
    border: "border-purple-200",
    text: "text-purple-700",
    bubble: "bg-purple-50 text-purple-900 border-purple-200",
  },
  amber: {
    bg: "bg-amber-50",
    bgHover: "hover:bg-amber-100",
    border: "border-amber-200",
    text: "text-amber-700",
    bubble: "bg-amber-50 text-amber-900 border-amber-200",
  },
  rose: {
    bg: "bg-rose-50",
    bgHover: "hover:bg-rose-100",
    border: "border-rose-200",
    text: "text-rose-700",
    bubble: "bg-rose-50 text-rose-900 border-rose-200",
  },
  gray: {
    bg: "bg-gray-50",
    bgHover: "hover:bg-gray-100",
    border: "border-gray-200",
    text: "text-gray-700",
    bubble: "bg-gray-50 text-gray-900 border-gray-200",
  },
};

type ChannelKey =
  | { type: "general" }
  | { type: "agent"; agentId: (typeof AGENTS)[number]["id"] };

// ────────────────────────────────────────────────────────────────────────
// Top-level component
// ────────────────────────────────────────────────────────────────────────

export default function OfficeOverviewTab({
  onNavigate,
}: {
  onNavigate: (tab: string) => void;
}) {
  const [active, setActive] = useState<ChannelKey>({ type: "general" });

  // Aggregate stats for header
  const overview = trpc.agent.officeOverview.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const summary = overview.data?.summary;

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] min-h-[600px] gap-3">
      {/* Top bar */}
      <TopBar
        summary={summary}
        departments={overview.data?.departments ?? []}
        onAgentClick={onNavigate}
      />

      {/* Main split layout */}
      <div className="flex-1 flex gap-3 min-h-0">
        <Sidebar
          active={active}
          onSelect={setActive}
          onNavigate={onNavigate}
        />
        <main className="flex-1 min-w-0">
          {active.type === "general" ? (
            <GeneralChannel />
          ) : (
            <AgentDMChannel agentId={active.agentId} />
          )}
        </main>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Top bar — office stats + brief principle line
// ────────────────────────────────────────────────────────────────────────

function TopBar({
  summary,
  departments,
  onAgentClick,
}: {
  summary?: {
    totalAgents: number;
    liveCount: number;
    onlineCount: number;
    totalToday: number;
    totalPending: number;
  };
  departments: any[];
  onAgentClick: (tab: string) => void;
}) {
  return (
    <Card className="rounded-xl border-gray-200 bg-gradient-to-br from-gray-50 to-white">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-black p-2">
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">
                PACK&GO 辦公群
              </h1>
              <p className="text-[10px] text-gray-500 mt-0.5">
                自動化第一 · 萬不得以才人力 · 品質公平不可犧牲
              </p>
            </div>
          </div>
          {summary && (
            <div className="flex items-center gap-5 text-xs">
              <Stat
                label="員工"
                value={`${summary.liveCount}/${summary.totalAgents}`}
              />
              <Stat label="今日" value={summary.totalToday} />
              <Stat
                label="等你看"
                value={summary.totalPending}
                tone={summary.totalPending > 0 ? "warn" : "ok"}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "warn";
}) {
  const color =
    tone === "warn" && Number(value) > 0 ? "text-rose-600" : "text-gray-900";
  return (
    <div className="text-right">
      <div className={`text-xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">
        {label}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sidebar — channels + DMs + settings
// ────────────────────────────────────────────────────────────────────────

function Sidebar({
  active,
  onSelect,
  onNavigate,
}: {
  active: ChannelKey;
  onSelect: (key: ChannelKey) => void;
  onNavigate: (tab: string) => void;
}) {
  const dmUnread = trpc.agent.unreadPerAgent.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const generalUnread = trpc.agent.generalChannelUnread.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const isActive = (key: ChannelKey) => {
    if (key.type !== active.type) return false;
    if (key.type === "agent" && active.type === "agent") {
      return key.agentId === active.agentId;
    }
    return true;
  };

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col gap-2 overflow-y-auto">
      {/* Channels */}
      <SidebarSection title="頻道">
        <SidebarItem
          icon={<Hash className="h-3.5 w-3.5" />}
          label="全體辦公群"
          unread={generalUnread.data ?? 0}
          active={isActive({ type: "general" })}
          onClick={() => onSelect({ type: "general" })}
        />
      </SidebarSection>

      {/* DMs */}
      <SidebarSection title="直接訊息">
        {AGENTS.map((a) => {
          const Icon = a.icon;
          const colors = COLOR[a.color];
          return (
            <SidebarItem
              key={a.id}
              icon={<Icon className={`h-3.5 w-3.5 ${colors.text}`} />}
              label={a.label}
              sublabel={a.persona}
              unread={dmUnread.data?.[a.id] ?? 0}
              active={isActive({ type: "agent", agentId: a.id })}
              onClick={() => onSelect({ type: "agent", agentId: a.id })}
            />
          );
        })}
      </SidebarSection>

      {/* Settings */}
      <SidebarSection title="設定" collapsible defaultCollapsed>
        <GmailMiniPanel />
        <button
          onClick={() => onNavigate("autonomous-agents")}
          className="w-full text-left px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-md flex items-center gap-2"
        >
          <Bot className="h-3.5 w-3.5" />
          Agent 詳細頁(政策 / Demo)
        </button>
      </SidebarSection>

      {/* Departments overview */}
      <SidebarSection title="所有部門" collapsible defaultCollapsed>
        <DepartmentsMini onAgentClick={onNavigate} />
      </SidebarSection>
    </aside>
  );
}

function SidebarSection({
  title,
  children,
  collapsible = false,
  defaultCollapsed = false,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-2">
      <button
        onClick={() => collapsible && setCollapsed((v) => !v)}
        disabled={!collapsible}
        className={`w-full flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 ${
          collapsible ? "hover:text-gray-700 cursor-pointer" : "cursor-default"
        }`}
      >
        {collapsible &&
          (collapsed ? (
            <ChevronRight className="h-2.5 w-2.5" />
          ) : (
            <ChevronDown className="h-2.5 w-2.5" />
          ))}
        <span>{title}</span>
      </button>
      {!collapsed && <div className="mt-1 space-y-0.5">{children}</div>}
    </div>
  );
}

function SidebarItem({
  icon,
  label,
  sublabel,
  unread,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  unread: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-2 py-1.5 rounded-md flex items-center gap-2 transition text-left ${
        active
          ? "bg-gray-900 text-white"
          : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      <span className="flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div
          className={`text-xs font-semibold truncate ${active ? "" : ""}`}
        >
          {label}
        </div>
        {sublabel && (
          <div
            className={`text-[10px] truncate ${
              active ? "opacity-70" : "text-gray-400"
            }`}
          >
            {sublabel}
          </div>
        )}
      </div>
      {unread > 0 && (
        <span
          className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full flex-shrink-0 ${
            active ? "bg-white text-gray-900" : "bg-rose-600 text-white"
          }`}
        >
          {unread}
        </span>
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// #全體辦公群 — group channel (broadcast only, no auto-reply)
// ────────────────────────────────────────────────────────────────────────

function GeneralChannel() {
  const [draft, setDraft] = useState("");
  const utils = trpc.useUtils();
  const messages = trpc.agent.listGeneralChannel.useQuery(
    { limit: 80 },
    { refetchInterval: 30_000 }
  );
  const post = trpc.agent.postToGeneralChannel.useMutation({
    onSuccess: () => {
      setDraft("");
      messages.refetch();
      utils.agent.generalChannelUnread.invalidate();
    },
  });
  const markRead = trpc.agent.markGeneralChannelRead.useMutation({
    onSuccess: () => {
      utils.agent.generalChannelUnread.invalidate();
    },
  });
  const requestAll = trpc.agent.requestAllAgentReports.useMutation({
    onSuccess: () => {
      utils.agent.listConversation.invalidate();
      utils.agent.unreadPerAgent.invalidate();
      utils.agent.unreadMessageCount.invalidate();
    },
  });

  // Auto mark-as-read when channel opens
  useEffect(() => {
    markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSend = () => {
    if (!draft.trim() || post.isPending) return;
    post.mutate({ body: draft.trim() });
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <ChannelShell
      header={
        <ChannelHeader
          icon={<Hash className="h-4 w-4 text-gray-700" />}
          title="全體辦公群"
          subtitle="所有 agent 廣播觀察 / 週報 · 你可以問問題,辦公室助理會根據當前資料回答 · 或點右邊請所有人現在回報"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => requestAll.mutate()}
              disabled={requestAll.isPending}
              className="h-7 rounded-lg gap-1 text-xs"
            >
              {requestAll.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  全員思考中…
                </>
              ) : (
                <>📋 請所有人現在報告</>
              )}
            </Button>
          }
        />
      }
      messages={
        <MessageList
          messages={messages.data ?? []}
          emptyText="還沒人發言。你可以發第一則公告，或等 agents 主動回報。"
          renderBubble={(msg) => <GeneralBubble msg={msg} />}
        />
      }
      composer={
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={onSend}
          onKey={onKey}
          placeholder="問辦公室助理問題或發公告…(Cmd+Enter 送出)"
          loading={post.isPending}
          error={post.error?.message}
        />
      }
    />
  );
}

function GeneralBubble({ msg }: { msg: any }) {
  const fromJeff = msg.senderRole === "jeff";
  // Identify office assistant posts (context.source === "office_assistant")
  let isOfficeAssistant = false;
  let agentColor = "gray";
  if (msg.context) {
    try {
      const ctx = JSON.parse(msg.context);
      if (ctx.source === "office_assistant") isOfficeAssistant = true;
      if (ctx.agent || ctx.source) {
        const agent = AGENTS.find((x) => x.id === (ctx.agent || ctx.source));
        if (agent) agentColor = agent.color;
      }
    } catch {
      // ignore
    }
  }
  const colors = COLOR[agentColor] ?? COLOR.gray;

  const senderLabel = fromJeff
    ? "你 · 公告"
    : isOfficeAssistant
    ? "🏢 辦公室助理"
    : msg.title
    ? `${msg.title.slice(0, 30)} · 廣播`
    : "agent · 廣播";

  return (
    <div className={`flex ${fromJeff ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 ${
          fromJeff
            ? "bg-gray-900 text-white rounded-br-sm"
            : `border ${colors.bubble} rounded-bl-sm`
        }`}
      >
        <div className="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-70">
          {senderLabel}
          {" · "}
          {new Date(msg.createdAt).toLocaleString("zh-TW", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
        <div className="text-sm whitespace-pre-wrap leading-relaxed">
          {msg.body}
        </div>
      </div>
    </div>
  );
}

function safeParseContextAgentColor(ctx: string): string {
  try {
    const obj = JSON.parse(ctx);
    const a = obj.agent || obj.source;
    const agent = AGENTS.find((x) => x.id === a);
    return agent?.color ?? "gray";
  } catch {
    return "gray";
  }
}

// ────────────────────────────────────────────────────────────────────────
// Per-agent DM channel
// ────────────────────────────────────────────────────────────────────────

function AgentDMChannel({
  agentId,
}: {
  agentId: (typeof AGENTS)[number]["id"];
}) {
  const agent = AGENTS.find((a) => a.id === agentId)!;
  const colors = COLOR[agent.color];
  const [draft, setDraft] = useState("");
  const utils = trpc.useUtils();
  const messages = trpc.agent.listConversation.useQuery(
    { agentName: agentId, limit: 80 },
    { refetchInterval: 60_000 }
  );
  const send = trpc.agent.sendToAgent.useMutation({
    onSuccess: () => {
      setDraft("");
      messages.refetch();
      utils.agent.unreadPerAgent.invalidate();
    },
  });
  const markRead = trpc.agent.markAgentChannelRead.useMutation({
    onSuccess: () => {
      utils.agent.unreadPerAgent.invalidate();
    },
  });
  const requestReport = trpc.agent.requestAgentReport.useMutation({
    onSuccess: () => {
      messages.refetch();
      utils.agent.unreadPerAgent.invalidate();
    },
  });

  // Auto mark-as-read when channel opens
  useEffect(() => {
    markRead.mutate({ agentName: agentId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

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

  const Icon = agent.icon;

  return (
    <ChannelShell
      header={
        <ChannelHeader
          icon={<Icon className={`h-4 w-4 ${colors.text}`} />}
          title={agent.label}
          subtitle={agent.persona}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => requestReport.mutate({ agentName: agentId })}
              disabled={requestReport.isPending}
              className="h-7 rounded-lg gap-1 text-xs"
            >
              {requestReport.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  思考中…
                </>
              ) : (
                <>📋 請他報告</>
              )}
            </Button>
          }
        />
      }
      messages={
        <MessageList
          messages={messages.data ?? []}
          emptyText={`還沒對話過 — 試試:「最近怎麼樣?」「你最常 escalate 的是什麼類型?」`}
          renderBubble={(msg) => (
            <AgentBubble msg={msg} agentColor={agent.color} />
          )}
          loadingBubble={
            send.isPending ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 italic px-3 py-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                {agent.label} 思考中…
              </div>
            ) : null
          }
        />
      }
      composer={
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={onSend}
          onKey={onKey}
          placeholder={`私訊 ${agent.label}…(Cmd+Enter 送出)`}
          loading={send.isPending}
          error={send.error?.message}
        />
      }
    />
  );
}

function AgentBubble({
  msg,
  agentColor,
}: {
  msg: any;
  agentColor: string;
}) {
  const fromJeff = msg.senderRole === "jeff";
  const colors = COLOR[agentColor] ?? COLOR.gray;
  const priorityBadge =
    msg.priority === "critical"
      ? "bg-rose-100 text-rose-700"
      : msg.priority === "high"
      ? "bg-amber-100 text-amber-700"
      : null;

  return (
    <div className={`flex ${fromJeff ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 ${
          fromJeff
            ? "bg-gray-900 text-white rounded-br-sm"
            : `border ${colors.bubble} rounded-bl-sm`
        }`}
      >
        <div className="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-70 flex items-center gap-1.5">
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
        {msg.title && msg.title !== msg.body.slice(0, msg.title.length) && (
          <div className="text-sm font-bold mb-1">{msg.title}</div>
        )}
        <div className="text-sm whitespace-pre-wrap leading-relaxed">
          {msg.body}
        </div>
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
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Shared shell + helpers
// ────────────────────────────────────────────────────────────────────────

function ChannelShell({
  header,
  messages,
  composer,
}: {
  header: React.ReactNode;
  messages: React.ReactNode;
  composer: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex-shrink-0">{header}</div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">{messages}</div>
      <div className="flex-shrink-0 border-t border-gray-100 p-3 bg-gray-50/40">
        {composer}
      </div>
    </div>
  );
}

function ChannelHeader({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 bg-white">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-gray-900">{title}</div>
        {subtitle && <div className="text-xs text-gray-500">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

function MessageList({
  messages,
  emptyText,
  renderBubble,
  loadingBubble,
}: {
  messages: any[];
  emptyText: string;
  renderBubble: (msg: any) => React.ReactNode;
  loadingBubble?: React.ReactNode;
}) {
  if (messages.length === 0 && !loadingBubble) {
    return (
      <div className="text-center text-xs text-gray-400 italic py-16">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {messages.map((m) => (
        <div key={m.id}>{renderBubble(m)}</div>
      ))}
      {loadingBubble}
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  onKey,
  placeholder,
  loading,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  loading: boolean;
  error?: string;
}) {
  return (
    <div>
      <div className="flex items-end gap-2">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          className="rounded-lg text-sm min-h-[44px] max-h-[160px] flex-1 resize-none"
          disabled={loading}
        />
        <Button
          onClick={onSend}
          disabled={!value.trim() || loading}
          className="rounded-lg gap-2 self-stretch px-4"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Gmail mini panel — lives in sidebar
// ────────────────────────────────────────────────────────────────────────

function GmailMiniPanel() {
  const status = trpc.agent.gmailStatus.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const authUrl = trpc.agent.gmailGetAuthUrl.useQuery();
  const flash = useGmailFlash();

  const integrations = status.data?.integrations ?? [];
  const active = integrations.find((i: any) => i.isActive === 1);

  return (
    <div className="px-2 py-2 space-y-2">
      {flash}
      {active ? (
        <ActiveGmailRow integration={active} />
      ) : (
        <div className="text-[10px] text-gray-500 space-y-1">
          {authUrl.data && "url" in authUrl.data ? (
            <a
              href={authUrl.data.url}
              className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 text-white px-2 py-1 text-[11px] font-semibold hover:bg-gray-800"
            >
              <LinkIcon className="h-3 w-3" />
              連接 Gmail
            </a>
          ) : authUrl.data && "error" in authUrl.data ? (
            <div className="text-rose-600">{authUrl.data.error}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ActiveGmailRow({ integration }: { integration: any }) {
  const utils = trpc.useUtils();
  const runNow = trpc.agent.gmailRunNow.useMutation({
    onSuccess: () => {
      utils.agent.gmailStatus.invalidate();
      utils.agent.officeOverview.invalidate();
      utils.agent.unreadPerAgent.invalidate();
      utils.agent.generalChannelUnread.invalidate();
      utils.agent.listConversation.invalidate();
    },
  });
  const disconnect = trpc.agent.gmailDisconnect.useMutation({
    onSuccess: () => utils.agent.gmailStatus.invalidate(),
  });
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[11px]">
        <Mail className="h-3 w-3 text-emerald-600" />
        <span className="font-semibold text-gray-900 truncate flex-1">
          {integration.emailAddress}
        </span>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </div>
      <div className="text-[10px] text-gray-500">
        {integration.lastPollAt
          ? `最近 ${formatRelative(new Date(integration.lastPollAt))}`
          : "尚未輪詢"}
        {" · "}已處理 {integration.messagesProcessed} 件
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => runNow.mutate({ integrationId: integration.id })}
          disabled={runNow.isPending}
          className="text-[10px] text-blue-700 hover:underline disabled:opacity-50 inline-flex items-center gap-1"
        >
          <RefreshCw
            className={`h-2.5 w-2.5 ${runNow.isPending ? "animate-spin" : ""}`}
          />
          立刻檢查
        </button>
        <span className="text-gray-300">·</span>
        <button
          onClick={() => {
            if (confirm(`確定要中斷 ${integration.emailAddress}?`))
              disconnect.mutate({ integrationId: integration.id });
          }}
          disabled={disconnect.isPending}
          className="text-[10px] text-rose-600 hover:underline disabled:opacity-50 inline-flex items-center gap-1"
        >
          <Unplug className="h-2.5 w-2.5" />
          中斷
        </button>
      </div>
      {runNow.data && (
        <div className="text-[10px] text-gray-600 mt-1 bg-emerald-50 rounded p-1.5">
          抓 {runNow.data.totalFetched} · 處理{" "}
          <span className="font-bold text-emerald-700">
            {runNow.data.totalProcessed}
          </span>
          {runNow.data.totalEscalated > 0 && (
            <>
              {" · "}升級{" "}
              <span className="font-bold text-rose-700">
                {runNow.data.totalEscalated}
              </span>
            </>
          )}
        </div>
      )}
      {runNow.error && (
        <div className="text-[10px] text-rose-700 mt-1">{runNow.error.message}</div>
      )}
    </div>
  );
}

function useGmailFlash() {
  const [show, setShow] = useState<
    { kind: "ok" | "err"; message: string } | null
  >(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const ok = url.searchParams.get("gmailConnected");
    const err = url.searchParams.get("gmailError");
    if (ok) {
      setShow({ kind: "ok", message: `已連線 ${ok}` });
      url.searchParams.delete("gmailConnected");
      window.history.replaceState({}, "", url.toString());
    } else if (err) {
      setShow({ kind: "err", message: decodeURIComponent(err) });
      url.searchParams.delete("gmailError");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);
  if (!show) return null;
  return (
    <div
      className={`rounded-md border p-2 text-[10px] flex items-start gap-1 ${
        show.kind === "ok"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-rose-200 bg-rose-50 text-rose-800"
      }`}
    >
      {show.kind === "ok" ? (
        <Check className="h-3 w-3 flex-shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
      )}
      <span>{show.message}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Departments mini view
// ────────────────────────────────────────────────────────────────────────

const DEPT_ICONS: Record<string, React.ElementType> = {
  users: Users,
  megaphone: Megaphone,
  plane: Plane,
  binoculars: Binoculars,
  shield: ShieldCheck,
  brain: Brain,
};

function DepartmentsMini({
  onAgentClick,
}: {
  onAgentClick: (tab: string) => void;
}) {
  const overview = trpc.agent.officeOverview.useQuery();
  if (!overview.data) return null;
  return (
    <div className="space-y-1">
      {overview.data.departments.map((d: any) => {
        const Icon = DEPT_ICONS[d.icon] ?? Building2;
        const pending = d.agents.reduce(
          (s: number, a: any) => s + a.pending,
          0
        );
        return (
          <button
            key={d.name}
            onClick={() => onAgentClick(d.agents[0]?.deepLink ?? "dashboard")}
            className="w-full px-2 py-1 text-left rounded-md hover:bg-gray-100 flex items-center gap-2 text-[11px]"
          >
            <Icon className="h-3 w-3 text-gray-500" />
            <span className="flex-1 truncate">{d.name}</span>
            <span className="text-[10px] text-gray-400">
              {d.agents.length}
            </span>
            {pending > 0 && (
              <span className="text-[9px] font-bold text-rose-700 bg-rose-100 px-1 rounded">
                {pending}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "剛剛";
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小時前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
}
