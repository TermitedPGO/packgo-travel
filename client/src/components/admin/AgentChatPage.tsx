/**
 * Round 81 / 2026-05-18 — AgentChatPage.
 *
 * Full-page Claude-Code-style chat with OpsAgent. Replaces the slide-out
 * Sheet (FloatingOpsAgent) per Jeff's feedback: "我更prefer agents 的聊天窗
 * 跟我現在用的一樣" — i.e. full-screen, document-style messages, not
 * cramped bubbles in a side panel.
 *
 * Layout principles (matching Claude Code feel):
 *   - max-w-3xl centered content area (not full bleed; matches reading width)
 *   - Document-style messages: role label on top, content below, no bubbles
 *   - Wide markdown rendering (prose-base) with proper code blocks / lists
 *   - Composer sticks to bottom of main area
 *   - Visible token streaming with cursor
 *   - Action chips as buttons under agent responses
 *
 * Entry points: Sidebar Office domain primary tab → `agent-chat` PageId.
 * ⌘+K still goes to the existing CommandPalette (unchanged).
 */
import { useEffect, useRef, useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Streamdown } from "streamdown";
import {
  Sparkles,
  Send,
  Mail,
  PenLine,
  UserCog,
  Bell,
  DollarSign,
  XCircle,
  Undo2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { toast } from "sonner";

const ACTION_ICON: Record<string, any> = {
  sendCustomerEmail: Mail,
  addTourGroupNote: PenLine,
  updateInternalNote: PenLine,
  assignTourLeader: UserCog,
  scheduleReminder: Bell,
  markBookingPaid: DollarSign,
  cancelBooking: XCircle,
  triggerRefund: Undo2,
};

export default function AgentChatPage() {
  const [question, setQuestion] = useState("");
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [streamingActions, setStreamingActions] = useState<any[] | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const utils = trpc.useUtils();
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Load conversation history — auto-refresh while idle
  const messages = trpc.agent.listMessages.useQuery(
    { agentName: "ops" as any, limit: 50 },
    { refetchInterval: isStreaming ? false : 15_000 },
  );

  // Sensitive-action confirmation
  const [pendingAction, setPendingAction] = useState<any | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const executeMutation = trpc.agent.executeOpsAction.useMutation({
    onSuccess: (result) => {
      if (result.ok) toast.success(result.summary);
      else toast.error(result.summary);
      setPendingAction(null);
      setConfirmText("");
      utils.agent.listMessages.invalidate();
    },
    onError: (err) => toast.error("執行失敗: " + err.message),
  });

  // Chronological (oldest top → newest bottom — like Claude Code, not most chat apps)
  const conversation = useMemo(() => {
    return [...(messages.data ?? [])].sort(
      (a: any, b: any) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [messages.data]);

  // Auto-scroll to bottom when:
  //   - new message arrives
  //   - streaming token appended
  //   - page opens with existing history
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [conversation.length, streamingText]);

  // Focus composer on mount
  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  const sendQuestion = async () => {
    if (!question.trim() || isStreaming) return;
    setIsStreaming(true);
    setStreamingText("");
    setStreamingActions(null);
    const url = `/api/agent/ask-ops-stream?q=${encodeURIComponent(question.trim())}`;
    try {
      const resp = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Accept: "text/event-stream",
        },
      });
      if (!resp.ok) {
        const errBody = await resp.text();
        toast.error(`OpsAgent ${resp.status}: ${errBody.slice(0, 100)}`);
        setIsStreaming(false);
        setStreamingText(null);
        return;
      }
      if (!resp.body) throw new Error("No response body");
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const chunk of lines) {
          const dataLine = chunk
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(6));
            if (event.type === "token") {
              setStreamingText((prev) => (prev ?? "") + (event.text ?? ""));
            } else if (event.type === "done") {
              if (event.finalAnswer) {
                setStreamingText(event.finalAnswer);
                setStreamingActions(event.suggestedActions ?? null);
              }
              setQuestion("");
              setTimeout(() => {
                utils.agent.listMessages.invalidate();
                setIsStreaming(false);
                setTimeout(() => {
                  setStreamingText(null);
                  setStreamingActions(null);
                }, 600);
              }, 400);
            } else if (event.type === "error") {
              toast.error("OpsAgent: " + (event.error ?? "unknown"));
              setIsStreaming(false);
              setStreamingText(null);
            }
          } catch {}
        }
      }
    } catch (err: any) {
      toast.error("Stream 失敗: " + (err?.message ?? "unknown"));
      setIsStreaming(false);
      setStreamingText(null);
    }
  };

  const handleActionClick = (action: any) => {
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
    if (
      pendingAction.sensitivity === "sensitive" &&
      confirmText !== "CONFIRM"
    ) {
      toast.error('需要輸入 "CONFIRM" 才能執行');
      return;
    }
    executeMutation.mutate({
      actionType: pendingAction.actionType,
      args: pendingAction.args,
      proposalContext: pendingAction.label.slice(0, 80),
    });
  };

  return (
    <div className="h-full flex flex-col">
      {/* ── Slim header ── */}
      <header className="border-b border-foreground/[0.08] px-6 py-3 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-600" />
          <span className="font-semibold text-sm">OpsAgent</span>
          <span className="text-xs text-foreground/40">· 你的副手</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              utils.agent.listMessages.invalidate();
              toast.success("已重新載入");
            }}
            className="text-xs gap-1.5 rounded-lg"
            title="重新載入對話歷史"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </header>

      {/* ── Conversation scroll area ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-foreground/[0.015]"
      >
        <div className="max-w-3xl mx-auto px-4 lg:px-8 py-6">
          {messages.isLoading && conversation.length === 0 && (
            <div className="text-center text-sm text-foreground/40 py-12">
              載入對話歷史⋯
            </div>
          )}
          {!messages.isLoading && conversation.length === 0 && !streamingText && (
            <div className="text-center py-16">
              <Sparkles className="w-10 h-10 text-emerald-600/40 mx-auto mb-3" />
              <p className="text-base text-foreground/55 mb-1">
                還沒有對話。在下面開始問。
              </p>
              <p className="text-xs text-foreground/35">
                例：「李太太那團幾號出發？」「6 月日本團還有位嗎？」
              </p>
            </div>
          )}

          {conversation.map((m: any, idx: number) => {
            const isJeff = m.senderRole === "jeff";
            const prevSenderRole = idx > 0 ? conversation[idx - 1].senderRole : null;
            const showSeparator =
              idx > 0 && prevSenderRole !== m.senderRole;

            return (
              <div
                key={m.id}
                className={
                  showSeparator
                    ? "pt-6 mt-6 border-t border-foreground/[0.06]"
                    : idx === 0
                      ? ""
                      : "mt-6"
                }
              >
                {/* Role label */}
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`text-[11px] uppercase tracking-wider font-semibold ${
                      isJeff ? "text-foreground/55" : "text-emerald-700"
                    }`}
                  >
                    {isJeff ? "你" : "OpsAgent"}
                  </span>
                  <span className="text-[10px] text-foreground/35">
                    {format(new Date(m.createdAt), "MM/dd HH:mm", {
                      locale: zhTW,
                    })}
                  </span>
                </div>

                {/* Content */}
                <div className="prose prose-sm max-w-none text-foreground/90 prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-strong:text-foreground prose-code:bg-foreground/[0.05] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-foreground prose-code:font-mono prose-code:text-[0.85em] prose-pre:bg-foreground/[0.04] prose-pre:border prose-pre:border-foreground/10 prose-pre:rounded-lg prose-pre:p-3 prose-pre:text-[0.9em] prose-table:my-3 prose-th:bg-foreground/[0.04] prose-th:px-3 prose-th:py-2 prose-th:text-left prose-td:px-3 prose-td:py-1.5 prose-headings:mt-3 prose-headings:mb-1 prose-h1:text-base prose-h2:text-base prose-h3:text-sm">
                  <Streamdown>{m.body || ""}</Streamdown>
                </div>

                {/* Action chips (agent only) */}
                {!isJeff &&
                  (() => {
                    let actions: any[] = [];
                    try {
                      const ctx = m.context ? JSON.parse(m.context) : {};
                      actions = Array.isArray(ctx.suggestedActions)
                        ? ctx.suggestedActions
                        : [];
                    } catch {}
                    if (actions.length === 0) return null;
                    return (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {actions.map((action: any, i: number) => {
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
                              key={i}
                              onClick={() => handleActionClick(action)}
                              disabled={executeMutation.isPending}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-white transition-colors ${colorClass} disabled:opacity-50`}
                            >
                              <Icon className="w-3.5 h-3.5" />
                              {action.label}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
              </div>
            );
          })}

          {/* Streaming bubble — same document style, with cursor */}
          {streamingText !== null && (
            <div
              className={
                conversation.length > 0
                  ? "pt-6 mt-6 border-t border-foreground/[0.06]"
                  : ""
              }
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">
                  OpsAgent
                </span>
                <span className="flex gap-0.5">
                  <span
                    className={`w-1 h-1 rounded-full bg-emerald-500 ${isStreaming ? "animate-pulse" : ""}`}
                  />
                  <span
                    className={`w-1 h-1 rounded-full bg-emerald-500 ${isStreaming ? "animate-pulse" : ""}`}
                    style={{ animationDelay: "0.15s" }}
                  />
                  <span
                    className={`w-1 h-1 rounded-full bg-emerald-500 ${isStreaming ? "animate-pulse" : ""}`}
                    style={{ animationDelay: "0.3s" }}
                  />
                </span>
              </div>
              <div className="prose prose-sm max-w-none text-foreground/90 prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-strong:text-foreground prose-code:bg-foreground/[0.05] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-foreground prose-code:font-mono prose-code:text-[0.85em] prose-pre:bg-foreground/[0.04] prose-pre:border prose-pre:border-foreground/10 prose-pre:rounded-lg prose-pre:p-3 prose-headings:mt-3 prose-headings:mb-1">
                {streamingText ? (
                  <Streamdown>{streamingText}</Streamdown>
                ) : (
                  <span className="text-foreground/30">思考中⋯</span>
                )}
                {isStreaming && (
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-emerald-500 align-text-bottom animate-pulse" />
                )}
              </div>
              {streamingActions && streamingActions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {streamingActions.map((action: any, i: number) => {
                    const Icon = ACTION_ICON[action.actionType] ?? Sparkles;
                    const sensitivity = action.sensitivity ?? "normal";
                    const colorClass =
                      sensitivity === "sensitive"
                        ? "border-rose-300 text-rose-700 hover:bg-rose-50"
                        : sensitivity === "normal"
                          ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                          : "border-emerald-300 text-emerald-700 hover:bg-emerald-50";
                    return (
                      <button
                        key={i}
                        onClick={() => handleActionClick(action)}
                        disabled={executeMutation.isPending}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-white transition-colors ${colorClass} disabled:opacity-50`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Composer pinned to bottom ── */}
      <div className="border-t border-foreground/[0.08] bg-white">
        <div className="max-w-3xl mx-auto px-4 lg:px-8 py-4">
          <Textarea
            ref={composerRef}
            placeholder="例: 李太太那團幾號出發?  /  6 月日本團還有位嗎?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="min-h-[72px] text-sm rounded-xl resize-none focus-visible:ring-emerald-500/50"
            disabled={isStreaming}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendQuestion();
              }
            }}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] text-foreground/40">
              ⌘+Enter 送出
            </span>
            <Button
              size="sm"
              onClick={sendQuestion}
              disabled={!question.trim() || isStreaming}
              className="rounded-lg gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Send className="w-3.5 h-3.5" />
              送出
            </Button>
          </div>
        </div>
      </div>

      {/* ── Sensitive-action confirmation dialog ── */}
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
                  此動作會影響金錢/客戶 — 請輸入{" "}
                  <code className="text-rose-600 font-mono">CONFIRM</code>{" "}
                  確認:
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
                (pendingAction?.sensitivity === "sensitive" &&
                  confirmText !== "CONFIRM")
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
