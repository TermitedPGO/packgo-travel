import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Send, Loader2, User, ThumbsUp, ThumbsDown, Sparkles, X, Minimize2,
  MapPin, Globe, FileText, Plane, ChevronRight
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Streamdown } from "streamdown";
import { useLocale } from "@/contexts/LocaleContext";

// 企鵝表情圖像 URLs (CDN)
const PENGUIN_EXPRESSIONS = {
  default: "https://d2xsxph8kpxj0f.cloudfront.net/310519663159191204/D3XjbQ67JpFf2y4FWefWHw/penguin-reference_5e2553b9.png",
  thinking: "https://d2xsxph8kpxj0f.cloudfront.net/310519663159191204/D3XjbQ67JpFf2y4FWefWHw/penguin-thinking_f5ff1339.png",
  happy: "https://d2xsxph8kpxj0f.cloudfront.net/310519663159191204/D3XjbQ67JpFf2y4FWefWHw/penguin-happy_4389eb47.png",
  confused: "https://d2xsxph8kpxj0f.cloudfront.net/310519663159191204/D3XjbQ67JpFf2y4FWefWHw/penguin-confused_400fe74a.png",
  waving: "https://d2xsxph8kpxj0f.cloudfront.net/310519663159191204/D3XjbQ67JpFf2y4FWefWHw/penguin-waving_c210a046.png",
};

type PenguinExpression = keyof typeof PENGUIN_EXPRESSIONS;

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
  const [sessionId] = useState(() => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      role: "assistant",
      content: t('aiAdvisor.greeting'),
    },
  ]);

  // Update greeting when language changes (only if still showing initial greeting)
  useEffect(() => {
    setMessages(prev => {
      if (prev.length === 1 && prev[0].role === 'assistant') {
        return [{ role: 'assistant', content: t('aiAdvisor.greeting') }];
      }
      return prev;
    });
  }, [language]);
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
  const openingSuggestions = useMemo(() => [
    { icon: MapPin, label: t('aiAdvisor.findTours') },
    { icon: FileText, label: t('aiAdvisor.checkDates') },
    { icon: Globe, label: t('aiAdvisor.budgetPlanning') },
    { icon: Plane, label: t('aiAdvisor.otherQuestions') },
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
    }
  }, [sessionId, t, tArray]);

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
        const greetingMsg = { role: "assistant" as const, content: t('aiAdvisor.greeting') };
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

    feedbackMutation.mutate({
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

  const currentPenguinImage = PENGUIN_EXPRESSIONS[penguinExpression];

  // Show opening suggestions only when there's only the initial greeting
  const showOpeningSuggestions = messages.length === 1 && !isStreaming;
  // Show follow-up suggestions for the last assistant message when not streaming
  const lastAssistantIndex = messages.reduce((last, msg, i) => msg.role === "assistant" ? i : last, -1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[95vw] sm:w-full h-[85vh] sm:h-[650px] flex flex-col p-0 border-2 border-black gap-0 overflow-hidden bg-white shadow-2xl rounded-xl">
        {/* Hidden DialogTitle and Description for accessibility */}
        <VisuallyHidden>
          <DialogTitle>{t('aiAdvisor.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('aiAdvisor.dialogDescription')}</DialogDescription>
        </VisuallyHidden>
        
        {/* Header with Animated Penguin Character */}
        <div className="bg-black text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            {/* Penguin Avatar with Animation */}
            <div 
              className={`relative w-14 h-14 bg-gradient-to-br from-gray-100 to-white rounded-lg flex items-center justify-center overflow-hidden border-2 border-white shadow-lg transition-transform duration-300 ${
                isAnimating ? "scale-110" : "scale-100"
              }`}
            >
              <img
                src={currentPenguinImage}
                alt={t('aiAdvisor.title')}
                className={`w-12 h-12 object-contain transition-all duration-300 ${
                  isStreaming ? "animate-bounce" : ""
                }`}
              />
              {/* Online Status Indicator */}
              <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 rounded-lg border-2 border-white"></div>
            </div>
            <div>
              <h3 className="font-bold text-lg tracking-wide">{t('aiAdvisor.title')}</h3>
              <p className="text-sm text-gray-300 flex items-center gap-1.5">
                {isStreaming ? (
                  <>
                    <span className="inline-block w-1.5 h-1.5 bg-yellow-400 rounded-lg animate-pulse"></span>
                    {t('aiAdvisor.thinking')}
                  </>
                ) : (
                  <>
                    <span className="inline-block w-1.5 h-1.5 bg-green-400 rounded-lg"></span>
                    {t('aiAdvisor.online')} · {t('aiAdvisor.atYourService')}
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 p-0 text-white hover:bg-white/20 rounded-lg"
              onClick={() => onOpenChange(false)}
              aria-label={t('aiAdvisor.minimize')}
            >
              <Minimize2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 p-0 text-white hover:bg-white/20 rounded-lg"
              onClick={() => onOpenChange(false)}
              aria-label={t('aiAdvisor.close')}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 bg-gradient-to-b from-gray-50 to-white">
          {messages.map((message, index) => (
            <div key={index}>
              <div
                className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {message.role === "assistant" && (
                  <div className="flex-shrink-0 w-9 h-9 bg-gradient-to-br from-gray-100 to-white rounded-lg border border-gray-200 flex items-center justify-center overflow-hidden shadow-sm">
                    <img
                      src={PENGUIN_EXPRESSIONS.default}
                      alt="AI"
                      className="w-7 h-7 object-contain"
                    />
                  </div>
                )}
                <div
                  className={`max-w-[80%] px-4 py-3 shadow-sm ${
                    message.role === "user"
                      ? "bg-black text-white  rounded-br-md"
                      : "bg-white border border-gray-200 text-gray-800  rounded-bl-md"
                  }`}
                >
                  {message.role === "assistant" ? (
                    <div className="text-sm prose prose-sm max-w-none leading-relaxed">
                      <Streamdown>{message.content}</Streamdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  )}
                </div>
                {message.role === "user" && (
                  <div className="flex-shrink-0 w-9 h-9 bg-black text-white rounded-lg flex items-center justify-center shadow-sm">
                    <User className="h-5 w-5" />
                  </div>
                )}
              </div>
              
              {/* Triggered Skills & Feedback */}
              {message.role === "assistant" && index > 0 && (
                <div className="ml-12 mt-2 flex flex-wrap items-center gap-2">
                  {message.triggeredSkills && message.triggeredSkills.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-lg">
                      <Sparkles className="h-3 w-3 text-yellow-500" />
                      <span>
                        {message.triggeredSkills.map(s => s.skillName).join(", ")}
                      </span>
                    </div>
                  )}
                  
                  {message.usageLogIds && message.usageLogIds.length > 0 && (
                    <div className="flex items-center gap-1.5 ml-auto">
                      <span className="text-xs text-gray-400">{t('aiAdvisor.helpfulQuestion')}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-7 w-7 p-0 rounded-lg transition-all ${
                          message.feedbackGiven === "positive" 
                            ? "bg-green-100 text-green-600 border border-green-300" 
                            : "text-gray-400 hover:text-green-600 hover:bg-green-50"
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
                        className={`h-7 w-7 p-0 rounded-lg transition-all ${
                          message.feedbackGiven === "negative" 
                            ? "bg-red-100 text-red-600 border border-red-300" 
                            : "text-gray-400 hover:text-red-600 hover:bg-red-50"
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
                <div className="ml-12 mt-3">
                  <div className="flex flex-wrap gap-2">
                    {message.suggestedReplies.map((reply, i) => (
                      <button
                        key={i}
                        onClick={() => handleSuggestionClick(reply)}
                        className="text-xs px-3 py-1.5 border border-gray-300 rounded-full text-gray-600 hover:border-black hover:text-black hover:bg-gray-50 transition-all flex items-center gap-1 group"
                      >
                        {reply}
                        <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Opening Suggestions - shown only on initial greeting */}
          {showOpeningSuggestions && (
            <div className="mt-2">
              <p className="text-xs text-gray-400 mb-3 text-center">{t('aiAdvisor.openingPrompt')}</p>
              <div className="grid grid-cols-2 gap-2">
                {openingSuggestions.map((suggestion: { icon: typeof MapPin; label: string }, i: number) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestionClick(suggestion.label)}
                    className="flex items-center justify-center gap-2 px-3 py-3 border border-gray-200 rounded-lg text-center text-sm text-gray-700 hover:border-black hover:bg-gray-50 hover:text-black transition-all font-medium"
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Loading indicator - shown while waiting for first chunk */}
          {isStreaming && messages[messages.length - 1]?.content === "" && (
            <div className="flex gap-3 justify-start">
              <div className="flex-shrink-0 w-9 h-9 bg-gradient-to-br from-gray-100 to-white rounded-lg border border-gray-200 flex items-center justify-center overflow-hidden shadow-sm">
                <img
                  src={PENGUIN_EXPRESSIONS.thinking}
                  alt="AI"
                  className="w-7 h-7 object-contain animate-pulse"
                />
              </div>
              <div className="bg-white border border-gray-200 px-4 py-3  rounded-bl-md shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-gray-400 rounded-lg animate-bounce" style={{ animationDelay: "0ms" }}></span>
                    <span className="w-2 h-2 bg-gray-400 rounded-lg animate-bounce" style={{ animationDelay: "150ms" }}></span>
                    <span className="w-2 h-2 bg-gray-400 rounded-lg animate-bounce" style={{ animationDelay: "300ms" }}></span>
                  </div>
                  <span className="text-sm text-gray-500">{t('aiAdvisor.thinkingMessage')}</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="px-4 py-4 border-t border-gray-200 bg-white shrink-0">
          <div className="flex gap-3 items-center">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={t('aiAdvisor.inputPlaceholder')}
              className="flex-1 h-11 border border-gray-300 rounded-lg px-5 focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-0 focus-visible:border-black bg-gray-50"
              disabled={isStreaming}
              aria-label={t('aiAdvisor.inputPlaceholder')}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="h-11 w-11 bg-black hover:bg-gray-800 rounded-lg p-0 flex items-center justify-center shadow-lg transition-transform hover:scale-105"
              aria-label={t('aiAdvisor.sendMessage')}
            >
              {isStreaming ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          </div>
          <p className="text-xs text-gray-400 mt-3 text-center">
            {t('aiAdvisor.disclaimer')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
