import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Send, Loader2, User, ThumbsUp, ThumbsDown, Sparkles, X, Lock, Check, ArrowRight
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Streamdown } from "streamdown";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/_core/hooks/useAuth";

// Round 80.21: replaced 5 CloudFront penguin PNGs with inline SVG that
// renders instantly (was visibly slow on cold load — Jeff flagged).
// One brand-aligned mark that subtly responds to state via CSS, not by
// swapping image src every animation tick.
type PenguinExpression = "default" | "thinking" | "happy" | "confused" | "waving";

function BrandAvatar({
  state = "default",
  size = 32,
}: {
  state?: PenguinExpression;
  size?: number;
}) {
  const isThinking = state === "thinking";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="PACK&GO advisor"
      className={isThinking ? "animate-pulse" : ""}
    >
      <defs>
        <linearGradient id="pg-bg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0A0A0A" />
          <stop offset="1" stopColor="#1A1A1A" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill="url(#pg-bg)" />
      {/* Stylised travel-bag icon — PACK&GO brand mark */}
      <path
        d="M14 14 L14 12 Q14 10 16 10 L24 10 Q26 10 26 12 L26 14 L29 14 Q30 14 30 15 L30 28 Q30 30 28 30 L12 30 Q10 30 10 28 L10 15 Q10 14 11 14 Z"
        fill="#c9a563"
      />
      <rect x="17" y="10" width="6" height="3" rx="0.5" fill="#0A0A0A" />
      <line
        x1="20"
        y1="14"
        x2="20"
        y2="30"
        stroke="#0A0A0A"
        strokeWidth="0.5"
        opacity="0.3"
      />
    </svg>
  );
}

interface Message {
  role: "user" | "assistant";
  content: string;
  triggeredSkills?: Array<{ skillId: number; skillName: string; confidence: number }>;
  usageLogIds?: number[];
  feedbackGiven?: "positive" | "negative" | null;
  suggestedReplies?: string[];
}

interface AITravelAdvisorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMessage?: string;
}

// 引導流程狀態（moved before component so type is available)

// 引導流程狀態
type GuidedFlowStep = "none" | "region" | "partySize";
type GuidedFlowData = { region?: string };

// Classify AI response content to pick a suggestion category. The caller
// resolves the category key through tArray() so suggestions always render
// in the user's active language.
type SuggestionCategory =
  | 'japan' | 'europe' | 'seAsia' | 'usa' | 'itinerary'
  | 'visa' | 'flight' | 'hotel' | 'budget' | 'generic';

function inferSuggestionCategory(content: string): SuggestionCategory {
  const lower = content.toLowerCase();

  // Destination keywords (match both Chinese and English forms)
  if (lower.includes("日本") || lower.includes("japan")) return 'japan';
  if (lower.includes("歐洲") || lower.includes("europe")) return 'europe';
  if (lower.includes("東南亞") || lower.includes("泰國") || lower.includes("thailand")) return 'seAsia';
  if (lower.includes("美國") || lower.includes("美洲") || lower.includes("usa")) return 'usa';

  // Topic keywords
  if (lower.includes("行程") || lower.includes("規劃") || lower.includes("itinerary")) return 'itinerary';
  if (lower.includes("簽證") || lower.includes("visa")) return 'visa';
  if (lower.includes("機票") || lower.includes("flight") || lower.includes("航班")) return 'flight';
  if (lower.includes("飯店") || lower.includes("hotel") || lower.includes("住宿")) return 'hotel';
  if (lower.includes("預算") || lower.includes("費用") || lower.includes("price") || lower.includes("cost")) return 'budget';

  return 'generic';
}

export default function AITravelAdvisorDialog({ open, onOpenChange, initialMessage }: AITravelAdvisorDialogProps) {
  const { t, tArray, language } = useLocale();
  const { user, isAuthenticated } = useAuth();
  const [sessionId] = useState(() => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);

  // Round 80.21: personalized greeting — anonymous users get the generic
  // welcome, members get "歡迎回來,{name}!" with optional Plus badge.
  // Falls back to first-token of email if user has no name set.
  const greetingText = useMemo(() => {
    if (!isAuthenticated || !user) {
      return t('aiAdvisor.greeting');
    }
    const displayName =
      (user.name && user.name.trim()) ||
      (user.email ? user.email.split("@")[0] : "");
    if (!displayName) return t('aiAdvisor.greeting');
    return t('aiAdvisor.greetingMember', { name: displayName });
  }, [isAuthenticated, user, t]);

  // Round 80.19: AI Advisor Phase 1 — query current quota status when dialog
  // opens so we can show the counter pill + paywall when limit hit.
  const { data: quotaData, refetch: refetchQuota } = trpc.ai.getQuota.useQuery(
    undefined,
    {
      enabled: open,
      staleTime: 30_000,
    }
  );

  const isPaidTier = quotaData?.tier === "plus" || quotaData?.tier === "concierge";
  const used = quotaData?.used ?? 0;
  const cap = quotaData?.cap ?? 5;
  const remaining = isPaidTier ? Infinity : Math.max(0, cap - used);
  const quotaExhausted = !isPaidTier && remaining <= 0;
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      role: "assistant",
      content: greetingText,
    },
  ]);

  // Update greeting when language OR auth state changes (only if still showing
  // the initial greeting message).
  useEffect(() => {
    setMessages(prev => {
      if (prev.length === 1 && prev[0].role === 'assistant') {
        return [{ role: 'assistant', content: greetingText }];
      }
      return prev;
    });
  }, [language, greetingText]);
  const [input, setInput] = useState("");
  const [penguinExpression, setPenguinExpression] = useState<PenguinExpression>("waving");
  const [isAnimating, setIsAnimating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 根據對話狀態切換企鵝表情
  const updatePenguinExpression = (newExpression: PenguinExpression) => {
    setIsAnimating(true);
    setPenguinExpression(newExpression);
    setTimeout(() => setIsAnimating(false), 300);
  };

  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  // 引導式對話流程狀態
  const [guidedFlowStep, setGuidedFlowStep] = useState<GuidedFlowStep>("none");
  const [guidedFlowData, setGuidedFlowData] = useState<GuidedFlowData>({});

  // i18n 快速回覆按鈕（元件內動態生成，支援多語言）
  // Premium quick-starts: concrete, premium-feeling trip prompts
  // (replaces generic 找行程 / 查日期 / 預算 / 其他 buttons)
  const openingSuggestions = useMemo(() => [
    t('aiAdvisor.quickStartJapan'),
    t('aiAdvisor.quickStartEuropeHoneymoon'),
    t('aiAdvisor.quickStartHawaiiFamily'),
    t('aiAdvisor.quickStartUSWestRoadTrip'),
  ], [t]);

  const regionSuggestions = useMemo(() => [
    t('aiAdvisor.regionAsia'),
    t('aiAdvisor.regionEurope'),
    t('aiAdvisor.regionAmerica'),
    t('aiAdvisor.regionMiddleEast'),
    t('aiAdvisor.regionCruise'),
  ], [t]);

  const partySizeSuggestions = useMemo(() => [
    t('aiAdvisor.party1'),
    t('aiAdvisor.party2'),
    t('aiAdvisor.party35'),
    t('aiAdvisor.party6plus'),
  ], [t]);

  const sendStreamMessage = useCallback(async (userMessage: string, history: Message[]) => {
    setIsStreaming(true);
    updatePenguinExpression("thinking");

    // Add empty assistant message placeholder for streaming
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", feedbackGiven: null },
    ]);

    abortControllerRef.current = new AbortController();
    // 30 秒超時：若 SSE 串流卡住，自動中止避免頁面凍結
    const timeoutId = setTimeout(() => abortControllerRef.current?.abort(), 30000);

    try {
      const params = new URLSearchParams({
        message: userMessage,
        history: JSON.stringify(history.map(m => ({ role: m.role, content: m.content }))),
        sessionId,
      });
      const response = await fetch(`/api/ai/chat/stream?${params}`, {
        signal: abortControllerRef.current.signal,
        credentials: "include",
      });

      if (!response.ok || !response.body) throw new Error("Stream failed");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === "chunk" && data.text) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === "assistant") {
                    updated[updated.length - 1] = { ...last, content: last.content + data.text };
                  }
                  return updated;
                });
              } else if (eventType === "done") {
                clearTimeout(timeoutId);
                updatePenguinExpression("happy");
                setTimeout(() => updatePenguinExpression("default"), 3000);
                // Add context-aware suggested replies to the last assistant message
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === "assistant" && last.content) {
                    const category = inferSuggestionCategory(last.content);
                    updated[updated.length - 1] = {
                      ...last,
                      suggestedReplies: tArray(`aiAdvisor.suggestions.${category}`),
                    };
                  }
                  return updated;
                });
              } else if (eventType === "error") {
                throw new Error(data.message);
              }
            } catch {
              // ignore JSON parse errors
            }
          }
        }
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error?.name === "AbortError") {
        // Timeout or manual abort — show friendly message
        updatePenguinExpression("confused");
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant" && last.content === "") {
            updated[updated.length - 1] = { ...last, content: t('aiAdvisor.timeoutMessage') };
          }
          return updated;
        });
        setTimeout(() => updatePenguinExpression("default"), 3000);
      } else {
        updatePenguinExpression("confused");
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant" && last.content === "") {
            updated[updated.length - 1] = { ...last, content: t('aiAdvisor.errorMessage') };
          }
          return updated;
        });
        setTimeout(() => updatePenguinExpression("default"), 3000);
      }
    } finally {
      clearTimeout(timeoutId);
      setIsStreaming(false);
      abortControllerRef.current = null;
      // Round 80.19: refresh quota after each turn so the counter pill
      // updates without dialog-reopen.
      refetchQuota();
    }
  }, [sessionId, t, tArray, refetchQuota]);

  const feedbackMutation = trpc.ai.recordFeedback.useMutation({
    onSuccess: () => {
    },
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (open) {
      updatePenguinExpression("waving");
      setTimeout(() => updatePenguinExpression("default"), 2000);
      // Auto-send initialMessage if provided
      if (initialMessage) {
        const greetingMsg = { role: "assistant" as const, content: greetingText };
        const userMsg = { role: "user" as const, content: initialMessage };
        setMessages([greetingMsg, userMsg]);
        sendStreamMessage(initialMessage, [greetingMsg]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput("");

    const updatedHistory = [
      ...messages,
      { role: "user" as const, content: userMessage },
    ];

    setMessages(updatedHistory);
    sendStreamMessage(userMessage, messages);
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (isStreaming) return;

    // 引導式對話：開場選擇「找行程推薦」 → 顯示地區選擇
    if (suggestion === t('aiAdvisor.findTours') && guidedFlowStep === "none") {
      const updatedHistory = [
        ...messages,
        { role: "user" as const, content: suggestion },
        { role: "assistant" as const, content: t('aiAdvisor.regionPrompt'), suggestedReplies: regionSuggestions },
      ];
      setMessages(updatedHistory);
      setGuidedFlowStep("region");
      return;
    }

    // 引導式對話：選擇地區 → 顯示人數選擇
    if (guidedFlowStep === "region" && regionSuggestions.includes(suggestion)) {
      const updatedHistory = [
        ...messages,
        { role: "user" as const, content: suggestion },
        { role: "assistant" as const, content: t('aiAdvisor.partySizePrompt'), suggestedReplies: partySizeSuggestions },
      ];
      setMessages(updatedHistory);
      setGuidedFlowData({ region: suggestion });
      setGuidedFlowStep("partySize");
      return;
    }

    // 引導式對話：選擇人數 → 將地區+人數組合發送給 AI
    if (guidedFlowStep === "partySize" && partySizeSuggestions.includes(suggestion)) {
      const region = guidedFlowData.region?.replace(/^[^\s]+\s/, "") || "";
      const combinedMessage = `I'm looking for tours in ${region}, traveling with ${suggestion}. Please recommend suitable tours.`;
      const updatedHistory = [
        ...messages,
        { role: "user" as const, content: suggestion },
      ];
      setMessages(updatedHistory);
      setGuidedFlowStep("none");
      setGuidedFlowData({});
      sendStreamMessage(combinedMessage, updatedHistory);
      return;
    }

    // 一般建議按鈕：直接發送給 AI
    const updatedHistory = [
      ...messages,
      { role: "user" as const, content: suggestion },
    ];
    setMessages(updatedHistory);
    setGuidedFlowStep("none");
    setGuidedFlowData({});
    sendStreamMessage(suggestion, messages);
  };

  const handleFeedback = (messageIndex: number, feedback: "positive" | "negative") => {
    const message = messages[messageIndex];
    if (!message.usageLogIds || message.usageLogIds.length === 0) return;
    if (message.feedbackGiven) return;

    if (feedback === "positive") {
      updatePenguinExpression("happy");
      setTimeout(() => updatePenguinExpression("default"), 2000);
    }

    setMessages((prev) => 
      prev.map((m, i) => 
        i === messageIndex ? { ...m, feedbackGiven: feedback } : m
      )
    );

    // SECURITY_AUDIT_2026_05_14 P2-5: server now requires sessionId or
    // authenticated user to record feedback. We have sessionId in scope
    // from useChatSession; passing it lets anonymous users keep giving
    // feedback without authentication.
    feedbackMutation.mutate({
      sessionId,
      usageLogIds: message.usageLogIds,
      feedback,
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Round 80.21: penguin removed — BrandAvatar now uses penguinExpression
  // as a state hint (only "thinking" actually changes appearance).

  // Show opening suggestions only when there's only the initial greeting
  const showOpeningSuggestions = messages.length === 1 && !isStreaming;
  // Show follow-up suggestions for the last assistant message when not streaming
  const lastAssistantIndex = messages.reduce((last, msg, i) => msg.role === "assistant" ? i : last, -1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[95vw] sm:w-full h-[85vh] sm:h-[650px] flex flex-col p-0 gap-0 overflow-hidden bg-white shadow-2xl rounded-xl border border-foreground/10">
        {/* Hidden DialogTitle and Description for accessibility */}
        <VisuallyHidden>
          <DialogTitle>{t('aiAdvisor.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('aiAdvisor.dialogDescription')}</DialogDescription>
        </VisuallyHidden>

        {/* Header — minimal black, with subtle gold accent line */}
        <div className="relative bg-foreground text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {/* Penguin Avatar — kept but smaller, no gradient/sparkle */}
            <div
              className={`relative transition-transform duration-300 ${
                isAnimating ? "scale-110" : "scale-100"
              }`}
            >
              <BrandAvatar state={penguinExpression} size={40} />
            </div>
            <div className="leading-tight">
              <h3 className="font-serif text-base font-semibold tracking-wide">
                {t('aiAdvisor.title')}
              </h3>
              <p className="text-[11px] text-white/60 flex items-center gap-1.5 mt-0.5">
                {isStreaming ? (
                  <>
                    <span className="inline-block w-1.5 h-1.5 bg-[#c9a563] rounded-full animate-pulse"></span>
                    {t('aiAdvisor.thinking')}
                  </>
                ) : (
                  <>
                    <span className="inline-block w-1.5 h-1.5 bg-[#c9a563] rounded-full"></span>
                    {t('aiAdvisor.online')} · {t('aiAdvisor.atYourService')}
                  </>
                )}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-white/70 hover:text-white hover:bg-white/10 rounded-lg"
            onClick={() => onOpenChange(false)}
            aria-label={t('aiAdvisor.close')}
          >
            <X className="h-4 w-4" />
          </Button>
          {/* Gold accent line */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#c9a563]/50 to-transparent" aria-hidden />
        </div>

        {/* Messages Area — soft warm cream background */}
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 bg-[#FAF8F2]">
          {messages.map((message, index) => (
            <div key={index}>
              <div
                className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {message.role === "assistant" && (
                  <div className="flex-shrink-0">
                    <BrandAvatar size={32} />
                  </div>
                )}
                <div
                  className={`max-w-[80%] px-4 py-3 rounded-xl shadow-sm ${
                    message.role === "user"
                      ? "bg-foreground text-white"
                      : "bg-white border border-foreground/10 text-foreground"
                  }`}
                >
                  {message.role === "assistant" ? (
                    <div className="text-sm prose prose-sm max-w-none leading-relaxed text-foreground prose-p:text-foreground prose-headings:text-foreground prose-headings:font-serif prose-strong:text-foreground prose-li:text-foreground prose-li:marker:text-foreground/60 prose-a:text-foreground prose-a:underline hover:prose-a:text-[#c9a563] prose-code:text-foreground prose-code:bg-foreground/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-normal">
                      <Streamdown>{message.content}</Streamdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  )}
                </div>
                {message.role === "user" && (
                  <div className="flex-shrink-0 w-8 h-8 bg-foreground text-white rounded-full flex items-center justify-center">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>

              {/* Triggered Skills & Feedback — minimal, edge-aligned */}
              {message.role === "assistant" && index > 0 && (
                <div className="ml-11 mt-2 flex flex-wrap items-center gap-2">
                  {message.triggeredSkills && message.triggeredSkills.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-foreground/55 bg-foreground/5 border border-foreground/10 px-2 py-0.5 rounded-md">
                      <Sparkles className="h-3 w-3 text-[#c9a563]" />
                      <span>
                        {message.triggeredSkills.map(s => s.skillName).join(", ")}
                      </span>
                    </div>
                  )}

                  {message.usageLogIds && message.usageLogIds.length > 0 && (
                    <div className="flex items-center gap-1 ml-auto">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-6 w-6 p-0 rounded-md transition-colors ${
                          message.feedbackGiven === "positive"
                            ? "text-[#c9a563]"
                            : "text-foreground/40 hover:text-[#c9a563]"
                        }`}
                        onClick={() => handleFeedback(index, "positive")}
                        disabled={!!message.feedbackGiven || feedbackMutation.isPending}
                        aria-label={t('aiAdvisor.helpful')}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-6 w-6 p-0 rounded-md transition-colors ${
                          message.feedbackGiven === "negative"
                            ? "text-foreground"
                            : "text-foreground/40 hover:text-foreground"
                        }`}
                        onClick={() => handleFeedback(index, "negative")}
                        disabled={!!message.feedbackGiven || feedbackMutation.isPending}
                        aria-label={t('aiAdvisor.notHelpful')}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Context-aware follow-up suggestions (only for last assistant message, not streaming) */}
              {message.role === "assistant" && index === lastAssistantIndex && !isStreaming && message.suggestedReplies && message.suggestedReplies.length > 0 && (
                <div className="ml-11 mt-3">
                  <div className="flex flex-wrap gap-1.5">
                    {message.suggestedReplies.map((reply, i) => (
                      <button
                        key={i}
                        onClick={() => handleSuggestionClick(reply)}
                        className="text-xs px-3 py-1.5 rounded-full bg-foreground/5 text-foreground/80 border border-foreground/10 hover:bg-[#c9a563]/15 hover:text-[#8a6f3a] hover:border-[#c9a563]/40 transition-colors"
                      >
                        {reply}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Opening / Welcome — premium quick-start chips with hint */}
          {showOpeningSuggestions && (
            <div className="mt-2">
              <p className="text-xs text-foreground/50 mb-3 text-center">
                {t('aiAdvisor.welcomeHint')}
              </p>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {openingSuggestions.map((label: string, i: number) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestionClick(label)}
                    className="text-xs px-3.5 py-2 rounded-full bg-white text-foreground/80 border border-foreground/10 hover:bg-[#c9a563]/15 hover:text-[#8a6f3a] hover:border-[#c9a563]/40 transition-colors shadow-sm"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loading indicator — three dots only, no text */}
          {isStreaming && messages[messages.length - 1]?.content === "" && (
            <div className="flex gap-3 justify-start">
              <div className="flex-shrink-0">
                <BrandAvatar state="thinking" size={32} />
              </div>
              <div className="bg-white border border-foreground/10 px-4 py-3 rounded-xl shadow-sm">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></span>
                  <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></span>
                  <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Round 80.19: Phase 1 paywall — when free quota exhausted, replace
            input area with upgrade card. Plus / Concierge bypass entirely. */}
        {quotaExhausted ? (
          <div className="px-4 py-4 border-t border-foreground/10 bg-foreground text-white shrink-0">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-[#c9a563]/20 flex items-center justify-center flex-shrink-0">
                <Lock className="w-4 h-4 text-[#c9a563]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white text-sm">{t('aiAdvisor.paywallTitle')}</p>
                <p className="text-xs text-white/70 mt-0.5">{t('aiAdvisor.paywallSubtitle')}</p>
              </div>
            </div>
            <ul className="space-y-1.5 mb-4 ml-1 text-xs text-white/85">
              <li className="flex items-start gap-2">
                <Check className="w-3 h-3 text-[#c9a563] flex-shrink-0 mt-0.5" />
                <span>{t('aiAdvisor.paywallBenefit1')}</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-3 h-3 text-[#c9a563] flex-shrink-0 mt-0.5" />
                <span>{t('aiAdvisor.paywallBenefit2')}</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-3 h-3 text-[#c9a563] flex-shrink-0 mt-0.5" />
                <span>{t('aiAdvisor.paywallBenefit3')}</span>
              </li>
            </ul>
            <Link
              href="/membership"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-2 bg-[#c9a563] text-foreground hover:bg-[#d4b478] transition-colors text-xs font-semibold px-4 py-2 rounded-lg w-full justify-center"
            >
              {t('aiAdvisor.paywallCta')}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        ) : (
          <>
            {/* Round 80.19: subtle counter pill — only shows when used >= 3
                so first-time visitors don't feel rationed. Plus members
                see no counter at all. */}
            {!isPaidTier && used >= 3 && (
              <div className="px-4 py-2 bg-foreground/[0.03] border-t border-foreground/8 flex items-center justify-between text-[11px] shrink-0">
                <span className="text-foreground/60">
                  {t('aiAdvisor.quotaRemaining', { remaining: String(remaining), cap: String(cap) })}
                </span>
                <Link
                  href="/membership"
                  onClick={() => onOpenChange(false)}
                  className="text-[#8a6f3a] hover:text-[#c9a563] font-medium"
                >
                  {t('aiAdvisor.quotaUpgrade')}
                </Link>
              </div>
            )}

            {/* Input Area — clean, no gradient, brand-aligned */}
            <div className="px-4 py-3 border-t border-foreground/10 bg-white shrink-0">
              <div className="flex gap-2 items-center">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={t('aiAdvisor.inputPlaceholder')}
                  className="flex-1 h-11 border border-foreground/15 rounded-lg px-4 focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:ring-offset-0 focus-visible:border-foreground/40 bg-white text-foreground"
                  disabled={isStreaming}
                  aria-label={t('aiAdvisor.inputPlaceholder')}
                />
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || isStreaming}
                  className="h-11 w-11 bg-foreground hover:bg-foreground/90 rounded-lg p-0 flex items-center justify-center shadow-sm disabled:opacity-40"
                  aria-label={t('aiAdvisor.sendMessage')}
                >
                  {isStreaming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-[10px] text-foreground/40 mt-2 text-center tracking-wide">
                {t('aiAdvisor.disclaimer')}
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
