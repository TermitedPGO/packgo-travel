/**
 * Round 81 — Office Chats (per-agent Slack-like thread view).
 *
 * Complements OfficeInboxTab (triage queue from customer touchpoints).
 * Where Inbox is "what does Jeff need to decide today", Chats is
 * "what is each agent doing + reporting".
 *
 * Architecture:
 *   • Left rail: agent channels with unread badges (auto-refresh 30s)
 *   • Main pane: selected channel's messages reverse-chronological,
 *     with type icons, priority chips, body, and per-message actions
 *   • Reply composer: Jeff can type a response → updates jeffResponse
 *     + marks the message read. For 'proposal' messages, also marks
 *     proposalDecision adopted/rejected.
 *
 * Reads from agentMessages table via trpc.agent.listMessages /
 * unreadMessageCount / replyToMessage / adoptProposal / rejectProposal.
 *
 * Future (mobile app):
 *   • This UI maps directly to a mobile screen layout (channels list
 *     → channel detail → message thread). Same tRPC procedures power
 *     both surfaces.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import {
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Sparkles,
  FileText,
  ArrowUpRight,
  Inbox,
  Send,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Mail,
  PenLine,
  UserCog,
  Bell,
  DollarSign,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// Agent display metadata. Keep in sync with server/routers/agentRouter.ts
// AGENT_NAMES enum. Unknown agents fall back to a generic style.
const AGENT_META: Record<
  string,
  { label: string; emoji: string; description: string }
> = {
  inquiry: { label: "InquiryAgent", emoji: "📥", description: "Email / WeChat 分類路由" },
  review: { label: "ReviewAgent", emoji: "⭐", description: "客戶評論" },
  marketing: { label: "CampaignAgent", emoji: "📢", description: "海報 + Newsletter" },
  followup: { label: "FollowupAgent", emoji: "🔁", description: "報價跟進" },
  refund: { label: "RefundAgent", emoji: "💸", description: "退款處理" },
  self_retrospective: { label: "RetrospectiveAgent", emoji: "🪞", description: "週度政策提案" },
  // Future expansions — defined here so they don't crash when first message arrives
  catalog: { label: "CatalogAgent", emoji: "📚", description: "Tour 生成 pipeline" },
  calibration: { label: "CalibrationAgent", emoji: "✓", description: "QA 守門" },
  quote: { label: "QuoteAgent", emoji: "📋", description: "報價 PDF" },
  books: { label: "BooksAgent", emoji: "💰", description: "Plaid 對帳 + P&L" },
  ops: { label: "OpsAgent", emoji: "🗺️", description: "旅團查詢 + 出發提醒" },
};

const TYPE_ICON: Record<
  string,
  { Icon: any; label: string; tone: string }
> = {
  observation: { Icon: CheckCircle2, label: "已完成", tone: "text-emerald-600" },
  proposal: { Icon: ThumbsUp, label: "需審批", tone: "text-amber-600" },
  question: { Icon: HelpCircle, label: "問問題", tone: "text-blue-600" },
  alert: { Icon: AlertTriangle, label: "異常", tone: "text-orange-600" },
  escalation: { Icon: ArrowUpRight, label: "升級", tone: "text-rose-600" },
  digest: { Icon: FileText, label: "週報", tone: "text-purple-600" },
};

const PRIORITY_CHIP: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  normal: "bg-foreground/5 text-foreground/60 border-foreground/15",
  low: "bg-foreground/[0.03] text-foreground/40 border-foreground/10",
};

export default function ChatsTab() {
  const { language } = useLocale();
  const dateLocale = language === "en" ? enUS : zhTW;
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showRead, setShowRead] = useState(false);
  const [replyText, setReplyText] = useState("");

  // Channel sidebar — unread counts per agent
  const unreadCount = trpc.agent.unreadMessageCount.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  // We need to know which agents have ANY messages to populate the sidebar.
  // listMessages without filters returns everyone — group client-side.
  const allMessages = trpc.agent.listMessages.useQuery(
    { onlyUnread: false, limit: 200 },
    { refetchInterval: 30_000 }
  );

  // Per-channel messages — filter all-fetched by agentName client-side to
  // avoid 2 round trips. limit=200 is plenty for a one-person ops.
  const selectedMessages = useMemo(() => {
    if (!selectedAgent || !allMessages.data) return [];
    return allMessages.data
      .filter((m: any) => m.agentName === selectedAgent)
      .filter((m: any) => showRead || m.readByJeff === 0)
      .sort((a: any, b: any) =>
        // Reverse chronological — newest first like Slack
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }, [selectedAgent, allMessages.data, showRead]);

  // Group all messages by agent for sidebar.
  // Always include canonical channels (ops, books, etc.) even if empty,
  // so Jeff can ask OpsAgent before any agent has posted.
  const CANONICAL_CHANNELS = ["ops", "inquiry", "books", "refund", "marketing", "followup"];
  const agentChannels = useMemo(() => {
    const grouped = new Map<string, { count: number; unread: number; lastAt: Date }>();
    // Seed canonical channels
    for (const name of CANONICAL_CHANNELS) {
      grouped.set(name, { count: 0, unread: 0, lastAt: new Date(0) });
    }
    // Overlay actual messages
    for (const m of allMessages.data ?? []) {
      const cur = grouped.get(m.agentName) ?? { count: 0, unread: 0, lastAt: new Date(0) };
      cur.count += 1;
      if (m.readByJeff === 0) cur.unread += 1;
      const at = new Date(m.createdAt);
      if (at > cur.lastAt) cur.lastAt = at;
      grouped.set(m.agentName, cur);
    }
    return Array.from(grouped.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => {
        // Unread first, then by last activity, then alphabetical for empty channels
        if (a.unread !== b.unread) return b.unread - a.unread;
        if (a.lastAt.getTime() !== b.lastAt.getTime()) {
          return b.lastAt.getTime() - a.lastAt.getTime();
        }
        return a.name.localeCompare(b.name);
      });
  }, [allMessages.data]);

  // Auto-select first channel with unread
  useMemo(() => {
    if (!selectedAgent && agentChannels.length > 0) {
      const withUnread = agentChannels.find((c) => c.unread > 0);
      setSelectedAgent(withUnread?.name ?? agentChannels[0].name);
    }
  }, [agentChannels, selectedAgent]);

  const utils = trpc.useUtils();
  const replyMutation = trpc.agent.replyToMessage.useMutation({
    onSuccess: () => {
      toast.success("已回覆 + 標記已讀");
      setReplyText("");
      utils.agent.listMessages.invalidate();
      utils.agent.unreadMessageCount.invalidate();
    },
    onError: (err) => toast.error("回覆失敗: " + err.message),
  });

  // Round 81 / 2026-05-17 — OpsAgent ask flow.
  // When viewing the #ops channel, Jeff can type a NEW question (not a
  // reply to existing agent message). The mutation logs both Jeff's
  // question and OpsAgent's answer to agentMessages, so the channel
  // shows the full conversation.
  const [opsQuestion, setOpsQuestion] = useState("");
  const askOpsMutation = trpc.agent.askOps.useMutation({
    onSuccess: (result) => {
      if (result.error) {
        toast.error("OpsAgent: " + result.error);
      } else {
        toast.success("OpsAgent 已回答");
        setOpsQuestion("");
      }
      utils.agent.listMessages.invalidate();
    },
    onError: (err) => toast.error("OpsAgent 失敗: " + err.message),
  });

  // Round 81 Phase 2 (2026-05-17) — Action proposal confirmation flow.
  // Each agentMessages row may carry a suggestedActions array in its context.
  // We render them as chips below the message body. Click → confirmation
  // modal → on confirm, call executeOpsAction.
  const [pendingAction, setPendingAction] = useState<{
    actionType: string;
    label: string;
    description: string;
    args: Record<string, any>;
    sensitivity: "safe" | "normal" | "sensitive";
  } | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const executeMutation = trpc.agent.executeOpsAction.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(result.summary);
      } else {
        toast.error(result.summary);
      }
      setPendingAction(null);
      setConfirmText("");
      utils.agent.listMessages.invalidate();
    },
    onError: (err) => toast.error("執行失敗: " + err.message),
  });

  const handleActionClick = (action: any) => {
    // For safe actions, skip the modal and execute directly with toast confirm
    if (action.sensitivity === "safe") {
      const ok = window.confirm(`${action.label}?\n\n${action.description}`);
      if (ok) {
        executeMutation.mutate({
          actionType: action.actionType,
          args: action.args,
          proposalContext: action.label.slice(0, 80),
        });
      }
    } else {
      setPendingAction(action);
      setConfirmText("");
    }
  };

  const handleConfirmAction = () => {
    if (!pendingAction) return;
    if (pendingAction.sensitivity === "sensitive" && confirmText !== "CONFIRM") {
      toast.error('需要輸入 "CONFIRM" 才能執行');
      return;
    }
    executeMutation.mutate({
      actionType: pendingAction.actionType,
      args: pendingAction.args,
      proposalContext: pendingAction.label.slice(0, 80),
    });
  };

  // Map actionType → icon for chip display
  const ACTION_ICON: Record<string, any> = {
    sendCustomerEmail: Mail,
    addTourGroupNote: PenLine,
    updateInternalNote: PenLine,
    assignTourLeader: UserCog,
    scheduleReminder: Bell,
    markBookingPaid: DollarSign,
  };

  const handleReplyTo = (messageId: number) => {
    if (!replyText.trim()) {
      toast.error("請輸入回覆內容");
      return;
    }
    replyMutation.mutate({ messageId, response: replyText, markRead: true });
  };

  const handleMarkRead = (messageId: number) => {
    replyMutation.mutate({ messageId, markRead: true });
  };

  const totalUnread = unreadCount.data?.total ?? 0;

  return (
    <div className="flex h-[calc(100vh-120px)] gap-4">
      {/* ──────────── Left rail: channels ──────────── */}
      <div className="w-64 flex-shrink-0 border-r border-foreground/10 pr-4 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Inbox className="w-4 h-4" />
            Agent Chats
            {totalUnread > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 text-xs font-semibold bg-red-500 text-white rounded-full px-1.5">
                {totalUnread}
              </span>
            )}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              allMessages.refetch();
              unreadCount.refetch();
            }}
            className="h-7 w-7 p-0"
            title="重新整理"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          {agentChannels.length === 0 && !allMessages.isLoading && (
            <div className="text-sm text-foreground/40 italic px-2 py-3">
              還沒有 agent 訊息。
              <br />
              當 agent 開始工作時這裡會即時顯示。
            </div>
          )}
          {allMessages.isLoading && (
            <div className="text-sm text-foreground/40 px-2 py-3">載入中...</div>
          )}
          <div className="space-y-1">
            {agentChannels.map((ch) => {
              const meta = AGENT_META[ch.name] ?? {
                label: ch.name,
                emoji: "🤖",
                description: "",
              };
              const isActive = selectedAgent === ch.name;
              return (
                <button
                  key={ch.name}
                  onClick={() => setSelectedAgent(ch.name)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "bg-foreground/[0.06] font-medium"
                      : "hover:bg-foreground/[0.03]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0 truncate">
                      <span>{meta.emoji}</span>
                      <span className="truncate">#{meta.label}</span>
                    </span>
                    {ch.unread > 0 && (
                      <span className="text-xs font-semibold bg-red-500 text-white rounded-full px-1.5 py-0.5 flex-shrink-0">
                        {ch.unread}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-foreground/40 mt-0.5 truncate">
                    {meta.description}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>

        <div className="mt-3 pt-3 border-t border-foreground/10">
          <label className="flex items-center gap-2 text-xs text-foreground/60 cursor-pointer">
            <input
              type="checkbox"
              checked={showRead}
              onChange={(e) => setShowRead(e.target.checked)}
              className="rounded"
            />
            顯示已讀訊息
          </label>
        </div>
      </div>

      {/* ──────────── Main pane: channel thread ──────────── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {!selectedAgent ? (
          <div className="flex-1 flex items-center justify-center text-foreground/40">
            <div className="text-center">
              <Inbox className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>選擇左邊的 agent channel 開始對話</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between pb-3 border-b border-foreground/10">
              <h3 className="font-semibold text-lg">
                {AGENT_META[selectedAgent]?.emoji}{" "}
                #{AGENT_META[selectedAgent]?.label ?? selectedAgent}
              </h3>
              <span className="text-xs text-foreground/40">
                {selectedMessages.length} 則訊息
                {!showRead && " (未讀)"}
              </span>
            </div>

            {/* OpsAgent ask box — only shown in #ops channel */}
            {selectedAgent === "ops" && (
              <div className="mt-3 mb-1 p-3 bg-emerald-50/40 border border-emerald-200/60 rounded-xl">
                <div className="text-xs font-semibold text-emerald-700 mb-1.5 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  問 OpsAgent
                </div>
                <Textarea
                  placeholder="例: 李太太那團幾號出發?  /  6 月日本團還有位嗎?  /  8/22 沖繩團 leader 誰?"
                  value={opsQuestion}
                  onChange={(e) => setOpsQuestion(e.target.value)}
                  className="min-h-[44px] text-sm rounded-lg bg-white"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      if (opsQuestion.trim()) {
                        askOpsMutation.mutate({ question: opsQuestion.trim() });
                      }
                    }
                  }}
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-emerald-600/70">
                    ⌘+Enter 送出 · 答案會出現在下方 channel
                  </span>
                  <Button
                    size="sm"
                    onClick={() =>
                      askOpsMutation.mutate({ question: opsQuestion.trim() })
                    }
                    disabled={!opsQuestion.trim() || askOpsMutation.isPending}
                    className="rounded-lg gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {askOpsMutation.isPending ? (
                      <span className="animate-pulse">查詢中...</span>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        問
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            <ScrollArea className="flex-1 py-4">
              {selectedMessages.length === 0 && (
                <div className="text-sm text-foreground/40 italic px-2 py-8 text-center">
                  {showRead ? "這個 channel 沒有訊息" : "這個 channel 沒有未讀訊息"}
                </div>
              )}
              <div className="space-y-3">
                {selectedMessages.map((m: any) => {
                  const typeInfo = TYPE_ICON[m.messageType] ?? {
                    Icon: HelpCircle,
                    label: m.messageType,
                    tone: "text-foreground/50",
                  };
                  const TypeIcon = typeInfo.Icon;
                  return (
                    <div
                      key={m.id}
                      className={`rounded-xl border p-4 ${
                        m.readByJeff === 0
                          ? "bg-amber-50/30 border-amber-200/60"
                          : "bg-white border-foreground/10"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2">
                          <TypeIcon className={`w-4 h-4 ${typeInfo.tone}`} />
                          <Badge
                            variant="outline"
                            className={`text-[10px] uppercase tracking-wider ${PRIORITY_CHIP[m.priority] ?? PRIORITY_CHIP.normal}`}
                          >
                            {typeInfo.label}
                            {m.priority !== "normal" && ` · ${m.priority}`}
                          </Badge>
                          {m.proposalDecision && m.proposalDecision !== "pending" && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${
                                m.proposalDecision === "adopted"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-foreground/5 text-foreground/40 border-foreground/15"
                              }`}
                            >
                              {m.proposalDecision === "adopted" ? "已採納" : "已拒絕"}
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-foreground/40 flex-shrink-0">
                          {format(new Date(m.createdAt), "MM/dd HH:mm", { locale: dateLocale })}
                        </span>
                      </div>

                      <h4 className="font-medium text-sm mb-1.5">{m.title}</h4>
                      <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
                        {m.body}
                      </p>

                      {/* Round 81 Phase 3 (2026-05-17) — Action chips.
                          Each message's context may carry suggestedActions
                          (proposals from OpsAgent). Render as clickable chips
                          below the body. Click → safe actions execute with a
                          window.confirm; normal/sensitive open a modal. */}
                      {(() => {
                        let actions: any[] = [];
                        try {
                          const ctx = m.context ? JSON.parse(m.context) : {};
                          actions = Array.isArray(ctx.suggestedActions) ? ctx.suggestedActions : [];
                        } catch {}
                        if (actions.length === 0) return null;
                        return (
                          <div className="mt-3 pt-3 border-t border-foreground/10">
                            <div className="text-[10px] uppercase tracking-wider text-foreground/40 font-semibold mb-2">
                              💡 建議動作
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {actions.map((action: any, idx: number) => {
                                const Icon =
                                  ACTION_ICON[action.actionType] ?? Sparkles;
                                const sensitivity = action.sensitivity ?? "normal";
                                const colorClass =
                                  sensitivity === "sensitive"
                                    ? "border-rose-300 text-rose-700 hover:bg-rose-50"
                                    : sensitivity === "normal"
                                    ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                                    : "border-emerald-300 text-emerald-700 hover:bg-emerald-50";
                                return (
                                  <button
                                    key={idx}
                                    onClick={() => handleActionClick(action)}
                                    disabled={executeMutation.isPending}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${colorClass} disabled:opacity-50`}
                                  >
                                    <Icon className="w-3.5 h-3.5" />
                                    {action.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {m.context && (
                        <details className="mt-2">
                          <summary className="text-xs text-foreground/40 cursor-pointer hover:text-foreground/60">
                            上下文 (JSON)
                          </summary>
                          <pre className="mt-2 text-[11px] bg-foreground/[0.03] p-2 rounded-md overflow-x-auto">
                            {(() => {
                              try {
                                return JSON.stringify(JSON.parse(m.context), null, 2);
                              } catch {
                                return m.context;
                              }
                            })()}
                          </pre>
                        </details>
                      )}

                      {m.jeffResponse && (
                        <div className="mt-3 pl-3 border-l-2 border-[#c9a563]/50 text-sm text-foreground/70">
                          <div className="text-[10px] uppercase tracking-wider text-[#8a6f3a] font-semibold mb-1">
                            你的回覆
                          </div>
                          {m.jeffResponse}
                        </div>
                      )}

                      {/* Action row: mark read / reply input toggle */}
                      {m.readByJeff === 0 && (
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-foreground/10">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleMarkRead(m.id)}
                            className="text-xs h-7"
                            disabled={replyMutation.isPending}
                          >
                            標記已讀
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Reply composer pinned to bottom */}
            {selectedMessages.length > 0 && (
              <div className="pt-3 border-t border-foreground/10">
                <Textarea
                  placeholder={`回覆 #${AGENT_META[selectedAgent]?.label ?? selectedAgent}（會回覆最新一則未讀訊息並標記已讀）`}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  className="min-h-[60px] text-sm rounded-lg"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      const firstUnread = selectedMessages.find(
                        (m: any) => m.readByJeff === 0
                      );
                      if (firstUnread) handleReplyTo(firstUnread.id);
                    }
                  }}
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[11px] text-foreground/40">
                    ⌘+Enter 送出
                  </span>
                  <Button
                    size="sm"
                    onClick={() => {
                      const firstUnread = selectedMessages.find(
                        (m: any) => m.readByJeff === 0
                      );
                      if (!firstUnread) {
                        toast.error("此 channel 沒有未讀訊息可回");
                        return;
                      }
                      handleReplyTo(firstUnread.id);
                    }}
                    disabled={!replyText.trim() || replyMutation.isPending}
                    className="rounded-lg gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    送出
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Round 81 Phase 3 (2026-05-17) — Action confirmation modal.
          Shown when Jeff clicks a chip for normal/sensitive actions.
          Safe actions skip this and use window.confirm. */}
      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null);
            setConfirmText("");
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pendingAction?.sensitivity === "sensitive" && (
                <AlertCircle className="w-5 h-5 text-rose-600" />
              )}
              確認執行: {pendingAction?.label}
            </DialogTitle>
            <DialogDescription className="pt-2">
              {pendingAction?.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="text-xs uppercase tracking-wider text-foreground/40 font-semibold">
              動作參數
            </div>
            <pre className="text-[11px] bg-foreground/[0.03] p-3 rounded-md overflow-x-auto leading-relaxed">
              {pendingAction ? JSON.stringify(pendingAction.args, null, 2) : ""}
            </pre>

            {pendingAction?.sensitivity === "sensitive" && (
              <div>
                <label className="text-sm font-medium block mb-1.5">
                  此動作會影響金錢/客戶 — 請輸入 <code className="text-rose-600 font-mono">CONFIRM</code> 確認:
                </label>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="輸入 CONFIRM"
                  className="rounded-lg"
                  autoFocus
                />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setPendingAction(null);
                setConfirmText("");
              }}
              className="rounded-lg"
            >
              取消
            </Button>
            <Button
              onClick={handleConfirmAction}
              disabled={
                executeMutation.isPending ||
                (pendingAction?.sensitivity === "sensitive" && confirmText !== "CONFIRM")
              }
              className={`rounded-lg ${
                pendingAction?.sensitivity === "sensitive"
                  ? "bg-rose-600 hover:bg-rose-700 text-white"
                  : ""
              }`}
            >
              {executeMutation.isPending ? "執行中..." : "確認執行"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
