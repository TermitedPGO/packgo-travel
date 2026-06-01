/**
 * AgentChatPage — full-page Claude-Code-style chat with OpsAgent.
 * Compact approval strip (quote + marketing) between conversation & composer.
 * B&W theme. Entry: Sidebar Office → `agent-chat` PageId.
 */
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
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
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Paperclip,
} from "lucide-react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { LanePayloadPreview } from "@/components/admin-v2/CommandCenter/lanes";
import type { ApprovalTaskRow } from "@/components/admin-v2/CommandCenter/types";

const PROSE_CLS =
  "prose prose-sm max-w-none text-foreground/90 prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-strong:text-foreground prose-code:bg-foreground/[0.05] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-foreground prose-code:font-mono prose-code:text-[0.85em] prose-pre:bg-foreground/[0.04] prose-pre:border prose-pre:border-foreground/10 prose-pre:rounded-lg prose-pre:p-3 prose-pre:text-[0.9em] prose-table:my-3 prose-th:bg-foreground/[0.04] prose-th:px-3 prose-th:py-2 prose-th:text-left prose-td:px-3 prose-td:py-1.5 prose-headings:mt-3 prose-headings:mb-1 prose-h1:text-base prose-h2:text-base prose-h3:text-sm";
const PROSE_STREAM_CLS =
  "prose prose-sm max-w-none text-foreground/90 prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-strong:text-foreground prose-code:bg-foreground/[0.05] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-foreground prose-code:font-mono prose-code:text-[0.85em] prose-pre:bg-foreground/[0.04] prose-pre:border prose-pre:border-foreground/10 prose-pre:rounded-lg prose-pre:p-3 prose-headings:mt-3 prose-headings:mb-1";

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

// ── Compact approval strip (quote + marketing only) ──────────────────────

function ApprovalStrip() {
  const { t } = useLocale();
  const utils = trpc.useUtils();

  const quoteItems = trpc.commandCenter.list.useQuery(
    { lane: "quote", status: "pending" },
    { refetchInterval: 15_000 },
  );
  const marketingItems = trpc.commandCenter.list.useQuery(
    { lane: "marketing", status: "pending" },
    { refetchInterval: 15_000 },
  );

  const pendingItems = useMemo(() => {
    const combined = [
      ...((quoteItems.data ?? []) as ApprovalTaskRow[]),
      ...((marketingItems.data ?? []) as ApprovalTaskRow[]),
    ];
    return combined.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [quoteItems.data, marketingItems.data]);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [hardGateConfirmed, setHardGateConfirmed] = useState(false);

  const approveMutation = trpc.commandCenter.approve.useMutation({
    onSuccess: () => {
      toast.success(t("admin.agentChat.itemApproved"));
      setExpandedId(null);
      setHardGateConfirmed(false);
      utils.commandCenter.list.invalidate();
      utils.commandCenter.stats.invalidate();
    },
    onError: (err) =>
      toast.error(t("admin.agentChat.executionFailed", { msg: err.message })),
  });

  const rejectMutation = trpc.commandCenter.reject.useMutation({
    onSuccess: () => {
      toast.success(t("admin.agentChat.itemRejected"));
      setExpandedId(null);
      setHardGateConfirmed(false);
      utils.commandCenter.list.invalidate();
      utils.commandCenter.stats.invalidate();
    },
    onError: (err) =>
      toast.error(t("admin.agentChat.executionFailed", { msg: err.message })),
  });

  const toggleExpand = useCallback(
    (id: number) => {
      setExpandedId((prev) => (prev === id ? null : id));
      setHardGateConfirmed(false);
    },
    [],
  );

  if (pendingItems.length === 0) return null;

  const expanded = pendingItems.find((item) => item.id === expandedId);
  const isMutating = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div className="border-t border-gray-200 bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 lg:px-8 py-3">
        {/* Label */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-semibold text-black uppercase tracking-wider">
            {t("admin.agentChat.pendingItems", {
              n: String(pendingItems.length),
            })}
          </span>
        </div>

        {/* Scrollable card row */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {pendingItems.map((item) => {
            const isExpanded = expandedId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => toggleExpand(item.id)}
                className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-xs transition-colors ${
                  isExpanded
                    ? "border-gray-900 bg-white"
                    : "border-gray-200 bg-white hover:border-gray-400"
                }`}
              >
                {/* Risk dot */}
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    item.riskLevel === "hard_gate"
                      ? "bg-black"
                      : "bg-gray-400"
                  }`}
                />
                {/* Title (truncated) */}
                <span className="truncate max-w-[140px] text-gray-900">
                  {item.title}
                </span>
                {/* Lane badge */}
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white flex-shrink-0 ${
                    item.lane === "quote" ? "bg-black" : "bg-gray-600"
                  }`}
                >
                  {item.lane === "quote"
                    ? t("admin.agentChat.laneQuote")
                    : t("admin.agentChat.laneMarketing")}
                </span>
                {/* Expand indicator */}
                {isExpanded ? (
                  <ChevronUp className="w-3 h-3 text-gray-400 flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Expanded detail panel */}
        {expanded && (
          <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
            <LanePayloadPreview
              lane={expanded.lane}
              summary={expanded.summary}
              payload={expanded.payload}
            />

            {/* hard_gate checkbox */}
            {expanded.riskLevel === "hard_gate" && (
              <label className="flex items-center gap-2 mt-3 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hardGateConfirmed}
                  onChange={(e) => setHardGateConfirmed(e.target.checked)}
                  className="rounded"
                />
                {t("admin.agentChat.hardGateConfirm")}
              </label>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-3">
              <Button
                size="sm"
                onClick={() => approveMutation.mutate({ id: expanded.id })}
                disabled={
                  isMutating ||
                  (expanded.riskLevel === "hard_gate" && !hardGateConfirmed)
                }
                className="rounded-lg gap-1 bg-black hover:bg-gray-800 text-white text-xs"
              >
                <Check className="w-3 h-3" />
                {t("admin.agentChat.approveItem")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => rejectMutation.mutate({ id: expanded.id })}
                disabled={isMutating}
                className="rounded-lg gap-1 border-gray-300 text-xs"
              >
                <X className="w-3 h-3" />
                {t("admin.agentChat.rejectItem")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main chat page ───────────────────────────────────────────────────────

export default function AgentChatPage() {
  const { t } = useLocale();
  const [question, setQuestion] = useState("");
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [streamingActions, setStreamingActions] = useState<any[] | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const utils = trpc.useUtils();
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    onError: (err) => toast.error(t('admin.agentChat.executionFailed', { msg: err.message })),
  });

  // Chronological (oldest top → newest bottom — like Claude Code, not most chat apps)
  const conversation = useMemo(() => {
    return [...(messages.data ?? [])].sort(
      (a: any, b: any) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [messages.data]);

  // Auto-scroll on new message / streaming token / initial load
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [conversation.length, streamingText]);

  // Focus composer on mount
  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  const addImages = useCallback((files: FileList | File[]) => {
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (images.length > 0) setPendingImages((prev) => [...prev, ...images]);
  }, []);

  const removeImage = useCallback((idx: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const sendQuestion = async () => {
    if ((!question.trim() && pendingImages.length === 0) || isStreaming) return;
    setIsStreaming(true);
    setStreamingText("");
    setStreamingActions(null);

    let imageUrls: string[] = [];
    if (pendingImages.length > 0) {
      try {
        const uploads = await Promise.all(
          pendingImages.map(async (file) => {
            const fd = new FormData();
            fd.append("image", file);
            const res = await fetch("/api/upload-chat-image", {
              method: "POST",
              credentials: "include",
              body: fd,
            });
            if (!res.ok) throw new Error(`Upload ${res.status}`);
            const json = await res.json();
            return json.url as string;
          }),
        );
        imageUrls = uploads;
      } catch (err: any) {
        toast.error(t("admin.agentChat.uploadingImages"));
        setIsStreaming(false);
        setStreamingText(null);
        return;
      }
      setPendingImages([]);
    }

    const qParam = question.trim();
    const imgParam = imageUrls.length > 0 ? `&images=${encodeURIComponent(JSON.stringify(imageUrls))}` : "";
    const url = `/api/agent/ask-ops-stream?q=${encodeURIComponent(qParam)}${imgParam}`;
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
      toast.error(t('admin.agentChat.executionFailed', { msg: err?.message ?? "unknown" }));
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
      toast.error(t('admin.agentChat.needConfirmInput'));
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
      <header className="border-b border-gray-200 px-6 py-3 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-black" />
          <span className="font-semibold text-sm text-black">{t('admin.agentChat.opsAgent')}</span>
          <span className="text-xs text-foreground/40">{t('admin.agentChat.yourAssistant')}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              utils.agent.listMessages.invalidate();
              toast.success(t('admin.agentChat.reloaded'));
            }}
            className="text-xs gap-1.5 rounded-lg"
            title={t('admin.agentChat.reloadHistory')}
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
              {t('admin.agentChat.loadingHistory')}
            </div>
          )}
          {!messages.isLoading && conversation.length === 0 && !streamingText && (
            <div className="text-center py-16">
              <Sparkles className="w-10 h-10 text-black/20 mx-auto mb-3" />
              <p className="text-base text-foreground/55 mb-1">
                {t('admin.agentChat.noConversation')}
              </p>
              <p className="text-xs text-foreground/35">
                {t('admin.agentChat.exampleQueries')}
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
                      isJeff ? "text-foreground/55" : "text-black"
                    }`}
                  >
                    {isJeff ? t('admin.agentChat.you') : t('admin.agentChat.opsAgent')}
                  </span>
                  <span className="text-[10px] text-foreground/35">
                    {format(new Date(m.createdAt), "MM/dd HH:mm", {
                      locale: zhTW,
                    })}
                  </span>
                </div>

                {/* Content */}
                <div className={PROSE_CLS}>
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
                              ? "border-gray-900 text-black hover:bg-gray-50"
                              : "border-gray-300 text-gray-700 hover:bg-gray-50";
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
                <span className="text-[11px] uppercase tracking-wider font-semibold text-black">
                  {t('admin.agentChat.opsAgent')}
                </span>
                <span className="flex gap-0.5">
                  <span
                    className={`w-1 h-1 rounded-full bg-black ${isStreaming ? "animate-pulse" : ""}`}
                  />
                  <span
                    className={`w-1 h-1 rounded-full bg-black ${isStreaming ? "animate-pulse" : ""}`}
                    style={{ animationDelay: "0.15s" }}
                  />
                  <span
                    className={`w-1 h-1 rounded-full bg-black ${isStreaming ? "animate-pulse" : ""}`}
                    style={{ animationDelay: "0.3s" }}
                  />
                </span>
              </div>
              <div className={PROSE_STREAM_CLS}>
                {streamingText ? (
                  <Streamdown>{streamingText}</Streamdown>
                ) : (
                  <span className="text-foreground/30">{t('admin.agentChat.thinking')}</span>
                )}
                {isStreaming && (
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-black align-text-bottom animate-pulse" />
                )}
              </div>
              {streamingActions && streamingActions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {streamingActions.map((action: any, i: number) => {
                    const Icon = ACTION_ICON[action.actionType] ?? Sparkles;
                    const sensitivity = action.sensitivity ?? "normal";
                    const colorClass =
                      sensitivity === "sensitive"
                        ? "border-gray-900 text-black hover:bg-gray-50"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50";
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

      {/* ── Compact approval strip (quote + marketing) ── */}
      <ApprovalStrip />

      {/* ── Composer pinned to bottom ── */}
      <div className="border-t border-gray-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 lg:px-8 py-4">
          {/* Image preview strip */}
          {pendingImages.length > 0 && (
            <div className="flex gap-2 mb-3 overflow-x-auto rounded-xl bg-foreground/[0.03] p-2">
              {pendingImages.map((file, idx) => (
                <div key={`${file.name}-${idx}`} className="relative flex-shrink-0">
                  <img
                    src={URL.createObjectURL(file)}
                    alt=""
                    className="h-16 w-16 rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(idx)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black text-white flex items-center justify-center"
                    title={t("admin.agentChat.removeImage")}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Textarea
            ref={composerRef}
            placeholder={t('admin.agentChat.composerPlaceholder')}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="min-h-[56px] md:min-h-[72px] text-base md:text-sm rounded-xl resize-none focus-visible:ring-gray-400"
            disabled={isStreaming}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendQuestion();
              }
            }}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              const imageFiles: File[] = [];
              for (const item of Array.from(items)) {
                if (item.type.startsWith("image/")) {
                  const file = item.getAsFile();
                  if (file) imageFiles.push(file);
                }
              }
              if (imageFiles.length > 0) {
                e.preventDefault();
                addImages(imageFiles);
              }
            }}
            onDrop={(e) => {
              if (!e.dataTransfer?.files?.length) return;
              const images = Array.from(e.dataTransfer.files).filter((f) =>
                f.type.startsWith("image/"),
              );
              if (images.length > 0) {
                e.preventDefault();
                addImages(images);
              }
            }}
            onDragOver={(e) => {
              if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
            }}
          />
          <div className="flex items-center justify-end md:justify-between mt-2">
            <span className="hidden md:inline text-[11px] text-foreground/40">
              {t('admin.agentChat.cmdEnterSend')}
            </span>
            <div className="flex items-center gap-2">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addImages(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                className="rounded-lg text-foreground/50 hover:text-foreground h-10 px-3 md:h-8 md:px-2"
                title={t("admin.agentChat.attachImage")}
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                onClick={sendQuestion}
                disabled={(!question.trim() && pendingImages.length === 0) || isStreaming}
                className="rounded-lg gap-1.5 bg-black hover:bg-gray-800 text-white h-10 px-4 md:h-8 md:px-3"
              >
                <Send className="w-3.5 h-3.5" />
                {t('admin.agentChat.send')}
              </Button>
            </div>
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
              {t('admin.agentChat.confirmExecution', { label: pendingAction?.label ?? '' })}
            </DialogTitle>
            <DialogDescription className="pt-2">
              {pendingAction?.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="text-xs uppercase tracking-wider text-foreground/40 font-semibold">
              {t('admin.agentChat.actionParams')}
            </div>
            <pre className="text-[11px] bg-foreground/[0.03] p-3 rounded-md overflow-x-auto leading-relaxed">
              {pendingAction ? JSON.stringify(pendingAction.args, null, 2) : ""}
            </pre>
            {pendingAction?.sensitivity === "sensitive" && (
              <div>
                <label className="text-sm font-medium block mb-1.5">
                  {t('admin.agentChat.sensitiveActionWarning')}{" "}
                  <code className="text-rose-600 font-mono">CONFIRM</code>{" "}
                  {t('admin.agentChat.toConfirm')}
                </label>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={t('admin.agentChat.inputConfirm')}
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
              {t('admin.agentChat.cancel')}
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
              {executeMutation.isPending ? t('admin.agentChat.executing') : t('admin.agentChat.confirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
