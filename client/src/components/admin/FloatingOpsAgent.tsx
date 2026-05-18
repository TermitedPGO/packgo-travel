/**
 * Round 81 / 2026-05-17 — FloatingOpsAgent.
 *
 * Persistent bottom-right button + slide-out chat panel for OpsAgent.
 * Accessible from EVERY admin page — Jeff can ask "李太太那團幾號" while
 * editing a customer profile, viewing inbox, or anywhere else, without
 * losing his current page context.
 *
 * Why this matters:
 *   Before: Jeff had to navigate Office → Chats → #ops to ask anything.
 *           4 clicks deep, lost wherever he was.
 *   After: ⌘+K (or click floating button) → chat slides in from right →
 *          ask question → close → back to whatever you were doing.
 *
 * Built on:
 *   - shadcn Sheet (right-side slide-out)
 *   - SSE streaming via /api/agent/ask-ops-stream (round 1 patch already
 *     CSRF-protected via X-Requested-With header)
 *   - 10-turn conversation memory from agentMessages (existing)
 *
 * Action chips work the same as in ChatsTab (executeOpsAction tRPC).
 */
import { useEffect, useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
  MessageSquare,
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

export default function FloatingOpsAgent() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [streamingActions, setStreamingActions] = useState<any[] | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const utils = trpc.useUtils();

  // History — load when panel opens
  const messages = trpc.agent.listMessages.useQuery(
    { agentName: "ops" as any, limit: 30 },
    { enabled: open, refetchInterval: open ? 15_000 : false }
  );

  // Pending action confirmation
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

  // Keyboard shortcut: Cmd+K / Ctrl+K opens the panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        // Don't intercept browser cmd+K if focus is in a form input (let
        // existing search palette handle it). Only intercept if no input
        // is focused.
        const active = document.activeElement;
        const inForm =
          active &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            (active as HTMLElement).isContentEditable);
        if (!inForm) {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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
        headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/event-stream" },
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
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
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
                }, 800);
              }, 500);
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

  // Chronological conversation (oldest top, newest bottom)
  const conversation = useMemo(() => {
    return [...(messages.data ?? [])].sort(
      (a: any, b: any) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [messages.data]);

  return (
    <>
      {/* Floating launcher button — bottom-right, always visible.
          - safe-area-inset-bottom keeps it above iOS Safari URL bar /
            home indicator.
          - z-40 sits above main content but below Dialog/Sheet (z-50),
            so confirmation modals can still cover it.
          - md:bottom-5 / pinned to bottom-[max(env)+1.25rem] on small. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="問 OpsAgent"
          title="問 OpsAgent (⌘+K)"
          className="fixed right-4 sm:right-5 z-40 w-12 h-12 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
        >
          <MessageSquare className="w-5 h-5" />
        </button>
      )}

      {/* Slide-out chat panel */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-lg flex flex-col p-0 gap-0">
          <SheetHeader className="px-4 py-3 border-b border-foreground/10 shrink-0">
            <SheetTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              OpsAgent · 你的副手
            </SheetTitle>
            <SheetDescription className="text-[11px]">
              問運營問題 · ⌘+Enter 送出 · ⌘+K 開關
            </SheetDescription>
          </SheetHeader>

          {/* Conversation history (scrollable, oldest top) */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 bg-foreground/[0.015]">
            {conversation.length === 0 && !messages.isLoading && (
              <div className="text-center text-xs text-foreground/40 py-8">
                還沒有對話。下面輸入問題開始。
              </div>
            )}
            {messages.isLoading && conversation.length === 0 && (
              <div className="text-center text-xs text-foreground/40 py-6">載入中⋯</div>
            )}
            {conversation.map((m: any) => {
              const isJeff = m.senderRole === "jeff";
              return (
                <div
                  key={m.id}
                  className={`rounded-lg p-2.5 max-w-[88%] ${
                    isJeff
                      ? "ml-auto bg-emerald-50 border border-emerald-100"
                      : "mr-auto bg-white border border-foreground/10"
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1 flex items-center justify-between gap-2">
                    <span>{isJeff ? "你" : "OpsAgent"}</span>
                    <span>{format(new Date(m.createdAt), "HH:mm", { locale: zhTW })}</span>
                  </div>
                  <div className="text-[13px] text-foreground/85 leading-relaxed prose prose-sm max-w-none prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0 prose-strong:text-foreground">
                    <Streamdown>{m.body || ""}</Streamdown>
                  </div>
                  {/* Action chips on agent messages with suggestedActions */}
                  {!isJeff &&
                    (() => {
                      let actions: any[] = [];
                      try {
                        const ctx = m.context ? JSON.parse(m.context) : {};
                        actions = Array.isArray(ctx.suggestedActions) ? ctx.suggestedActions : [];
                      } catch {}
                      if (actions.length === 0) return null;
                      return (
                        <div className="mt-2 pt-2 border-t border-foreground/[0.06] flex flex-wrap gap-1.5">
                          {actions.map((action: any, idx: number) => {
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
                                key={idx}
                                onClick={() => handleActionClick(action)}
                                disabled={executeMutation.isPending}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border bg-white transition-colors ${colorClass} disabled:opacity-50`}
                              >
                                <Icon className="w-3 h-3" />
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
            {/* Live streaming bubble */}
            {streamingText !== null && (
              <div className="mr-auto bg-white border border-emerald-200 rounded-lg p-2.5 max-w-[88%]">
                <div className="text-[10px] uppercase tracking-wider text-emerald-700 mb-1 flex items-center gap-1.5">
                  <span className="flex gap-0.5">
                    <span className={`w-1 h-1 rounded-full bg-emerald-500 ${isStreaming ? "animate-pulse" : ""}`} />
                    <span className={`w-1 h-1 rounded-full bg-emerald-500 ${isStreaming ? "animate-pulse" : ""}`} style={{ animationDelay: "0.15s" }} />
                    <span className={`w-1 h-1 rounded-full bg-emerald-500 ${isStreaming ? "animate-pulse" : ""}`} style={{ animationDelay: "0.3s" }} />
                  </span>
                  <span>{isStreaming ? "正在回答" : "完成"}</span>
                </div>
                <div className="text-[13px] text-foreground/85 leading-relaxed prose prose-sm max-w-none">
                  {streamingText ? (
                    <Streamdown>{streamingText}</Streamdown>
                  ) : (
                    <span className="text-foreground/30">思考中⋯</span>
                  )}
                  {isStreaming && (
                    <span className="inline-block w-1 h-3 ml-0.5 bg-emerald-500 align-text-bottom animate-pulse" />
                  )}
                </div>
                {streamingActions && streamingActions.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-emerald-100 flex flex-wrap gap-1.5">
                    {streamingActions.map((action: any, idx: number) => {
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
                          key={idx}
                          onClick={() => handleActionClick(action)}
                          disabled={executeMutation.isPending}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border bg-white ${colorClass} disabled:opacity-50`}
                        >
                          <Icon className="w-3 h-3" />
                          {action.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Composer pinned to bottom */}
          <div className="border-t border-foreground/10 p-3 shrink-0 bg-white">
            <Textarea
              placeholder="例: 李太太那團幾號出發?  /  6 月日本團還有位嗎?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="min-h-[44px] text-sm rounded-lg resize-none"
              disabled={isStreaming}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  sendQuestion();
                }
              }}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-foreground/40">⌘+Enter 送出</span>
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
        </SheetContent>
      </Sheet>

      {/* Sensitive-action confirmation modal */}
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
                  <code className="text-rose-600 font-mono">CONFIRM</code> 確認:
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
    </>
  );
}
