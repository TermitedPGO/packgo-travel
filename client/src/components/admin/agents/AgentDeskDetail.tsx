/**
 * AgentDeskDetail — the "open" desk for the selected agent
 * (Phase 5 module 5B). Mounts the per-agent demo panel matching `agent.id`.
 *
 * Largest extracted unit at ~300 LOC — intrinsically wide because it
 * composes the chat panel, work log, policy view, and the demo selector.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Loader2, Send } from "lucide-react";
import { COLOR_MAP, type AgentColors, type AgentDef } from "./agentDefs";
import { StatusDot } from "./AgentDesks";
import { Section, Timeline, isToday } from "./sharedPrimitives";
import { InquiryAgentDemo } from "./InquiryAgentDemo";
import { ReviewAgentDemo } from "./ReviewAgentDemo";
import { FollowupAgentDemo } from "./FollowupAgentDemo";
import { RefundAgentDemo } from "./RefundAgentDemo";

export function AgentDeskDetail({ agent }: { agent: AgentDef }) {
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
        <AgentChatPanel
          agentId={agent.id}
          agentLabel={agent.label}
          colors={colors}
        />

        {/* Work log toggle (collapsed by default) */}
        <button
          onClick={() => setShowWorkLog((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 rounded-lg transition"
        >
          <span className="uppercase tracking-wider">
            工作日誌 · 今日 {today.length} 件 · 昨日 {yesterday.length} 件
          </span>
          <ArrowRight
            className={`h-3.5 w-3.5 transition-transform ${
              showWorkLog ? "rotate-90" : ""
            }`}
          />
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
                還沒有自動執行的紀錄 —{" "}
                {office.data?.status === "off" ? "我尚未上線" : "等客戶觸發"}。
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

function AgentChatPanel({
  agentId,
  agentLabel,
  colors,
}: {
  agentId: AgentDef["id"];
  agentLabel: string;
  colors: AgentColors;
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
          messages.map((m: any) => (
            <ChatBubble key={m.id} msg={m} agentColors={colors} />
          ))
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
  agentColors: AgentColors;
}) {
  const fromJeff = msg.senderRole === "jeff";
  const priorityBadge =
    msg.priority === "critical"
      ? "bg-rose-100 text-rose-700"
      : msg.priority === "high"
      ? "bg-amber-100 text-amber-700"
      : null;

  return (
    <div className={`flex ${fromJeff ? "justify-end" : "justify-start"} group`}>
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
            <span
              className={`${priorityBadge} text-[9px] font-bold px-1 py-0.5 rounded`}
            >
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
