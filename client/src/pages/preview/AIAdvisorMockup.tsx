/**
 * AI Advisor — Pricing UX Mockup
 *
 * Static visual mockup of the 4 paywall states for Jeff to review pricing
 * decisions before implementation. NOT wired to LLM, NOT production code.
 *
 * Spec: docs/ai-advisor-pricing.md
 *
 * Route: /preview/ai-advisor-mockup (admin / preview only)
 *
 * The 4 states stacked vertically so Jeff can compare at a glance:
 *   1. Free / new visitor (welcome state, fresh)
 *   2. Free / 3 of 5 used (mid-flow with subtle counter)
 *   3. Free / 5 of 5 hit limit (paywall card + disabled input)
 *   4. Plus member / unlimited (badge, no counter, premium markdown)
 */
import { Bot, User, Send, Sparkles, Lock, Check, ArrowRight } from "lucide-react";
import { Link } from "wouter";

type Message = {
  role: "user" | "assistant";
  content: string;
  isMarkdown?: boolean;
};

// ────────────────────────────────────────────────────────────────────────────
// Reusable chat panel (states differ only by props)
// ────────────────────────────────────────────────────────────────────────────

function ChatPanel({
  label,
  description,
  messages,
  usage,
  showPaywall,
  isPremium,
  inputDisabled,
  inputPlaceholder = "輸入您的旅遊需求...",
}: {
  label: string;
  description: string;
  messages: Message[];
  usage?: { used: number; cap: number } | null;
  showPaywall?: boolean;
  isPremium?: boolean;
  inputDisabled?: boolean;
  inputPlaceholder?: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Mockup label strip */}
      <div className="bg-foreground text-white px-4 py-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-[0.2em] font-semibold">{label}</span>
        <span className="text-xs text-white/60 font-mono">{description}</span>
      </div>

      {/* Chat header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-foreground text-white flex items-center justify-center">
          <Bot className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">PACK&GO AI 旅遊顧問</h3>
            {isPremium ? (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-[#8a6f3a] bg-[#c9a563]/15 border border-[#c9a563]/30 px-2 py-0.5 rounded-full">
                <Sparkles className="w-3 h-3" />
                Plus
              </span>
            ) : (
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">免費版</span>
            )}
          </div>
          <p className="text-xs text-gray-500">24 小時為您服務</p>
        </div>
      </div>

      {/* Messages area */}
      <div className="bg-gray-50 px-4 py-4 space-y-3 max-h-[400px] overflow-y-auto">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                msg.role === "user"
                  ? "bg-gray-200 text-gray-600"
                  : "bg-foreground text-white"
              }`}
            >
              {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            <div
              className={`max-w-[78%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-foreground text-white"
                  : "bg-white border border-gray-100 text-gray-800"
              }`}
            >
              {msg.isMarkdown ? (
                <div className="prose prose-sm max-w-none">
                  {/* Markdown rendering simulation — only for premium */}
                  <p className="m-0 mb-2 font-semibold text-foreground">日本秋楓 7 日精華行程</p>
                  <ul className="list-disc list-inside space-y-1 text-xs text-gray-700 m-0">
                    <li>Day 1-2: 東京 — 上野公園、明治神宮外苑</li>
                    <li>Day 3-4: 京都 — 嵐山小火車、東福寺紅葉</li>
                    <li>Day 5: 大阪 — 大阪城公園賞楓</li>
                    <li>Day 6-7: 奈良、神戶</li>
                  </ul>
                  <p className="text-xs text-gray-600 mt-2 mb-0">
                    建議 11 月中旬出發,賞楓最佳時機。預算約 NT$ 65,000-85,000/人。
                  </p>
                </div>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {/* Paywall card — appears inline in chat at 5/5 */}
        {showPaywall && (
          <div className="mt-4 bg-gradient-to-br from-foreground to-foreground/85 text-white rounded-xl p-5 border border-[#c9a563]/30">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-[#c9a563]/20 flex items-center justify-center flex-shrink-0">
                <Lock className="w-5 h-5 text-[#c9a563]" />
              </div>
              <div>
                <p className="font-semibold text-white text-sm">本月免費額度已用完</p>
                <p className="text-xs text-white/70 mt-1">升級 PACK&GO Plus 享無限 AI 顧問</p>
              </div>
            </div>
            <ul className="space-y-1.5 mb-4 ml-1">
              <li className="flex items-start gap-2 text-xs text-white/85">
                <Check className="w-3.5 h-3.5 text-[#c9a563] flex-shrink-0 mt-0.5" />
                <span>無限 AI 對話 + 完整 markdown 行程</span>
              </li>
              <li className="flex items-start gap-2 text-xs text-white/85">
                <Check className="w-3.5 h-3.5 text-[#c9a563] flex-shrink-0 mt-0.5" />
                <span>所有訂單 5% 折扣 (年省約 $200+)</span>
              </li>
              <li className="flex items-start gap-2 text-xs text-white/85">
                <Check className="w-3.5 h-3.5 text-[#c9a563] flex-shrink-0 mt-0.5" />
                <span>出發前 60 天免費改期</span>
              </li>
            </ul>
            <Link
              href="/membership"
              className="inline-flex items-center gap-2 bg-[#c9a563] text-foreground hover:bg-[#d4b478] transition-colors text-xs font-semibold px-4 py-2 rounded-lg"
            >
              看會員方案 ($99/年)
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </div>

      {/* Usage counter — appears when used >= 3 (gentle nudge) */}
      {usage && !isPremium && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs">
          <span className="text-gray-500">
            本月剩 <span className="font-semibold text-foreground">{usage.cap - usage.used}</span> / {usage.cap} 則免費對話
          </span>
          {usage.used >= 3 && usage.used < usage.cap && (
            <Link
              href="/membership"
              className="text-[#8a6f3a] hover:text-[#c9a563] font-medium"
            >
              升級無限
            </Link>
          )}
        </div>
      )}

      {/* Input area */}
      <div className="px-4 py-3 bg-white border-t border-gray-100">
        <div className="flex gap-2">
          <input
            type="text"
            disabled={inputDisabled}
            placeholder={inputPlaceholder}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-foreground/30 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
          />
          <button
            disabled={inputDisabled}
            className="px-4 py-2 bg-foreground text-white rounded-lg hover:bg-foreground/85 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────

export default function AIAdvisorMockup() {
  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <p className="text-xs uppercase tracking-[0.3em] text-foreground/50 mb-2">Internal preview</p>
          <h1 className="text-3xl font-serif tracking-tight text-foreground mb-3">
            AI Advisor — Pricing UX Mockup
          </h1>
          <p className="text-sm text-gray-600 max-w-2xl">
            4 個狀態並列展示。spec 在 <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">docs/ai-advisor-pricing.md</code>。
            這是 visual mockup 不接 LLM,僅供 UX 決策。
          </p>
        </div>

        {/* Decision summary */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-10">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
            Pricing 摘要
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
              <p className="text-xs text-gray-500 mb-1">🆓 Free / 訪客</p>
              <p className="font-semibold text-foreground">5 則 / 30 天</p>
              <p className="text-xs text-gray-500 mt-1">Haiku · 純文字 · ≤250 字</p>
            </div>
            <div className="p-3 bg-[#c9a563]/8 rounded-lg border border-[#c9a563]/30">
              <p className="text-xs text-[#8a6f3a] mb-1">💎 Plus 會員 ($99/yr)</p>
              <p className="font-semibold text-foreground">無限對話</p>
              <p className="text-xs text-gray-600 mt-1">Sonnet · markdown · 跨會話記憶</p>
            </div>
            <div className="p-3 bg-foreground text-white rounded-lg">
              <p className="text-xs text-white/60 mb-1">💎 Concierge ($399/yr)</p>
              <p className="font-semibold">無限 + Jeff 4h 跟進</p>
              <p className="text-xs text-white/60 mt-1">Sonnet · markdown · 真人 + AI 雙軌</p>
            </div>
          </div>
        </div>

        {/* 4 states grid */}
        <div className="space-y-8">
          {/* State 1: Free / new visitor */}
          <ChatPanel
            label="State 1 — Free / 新訪客"
            description="0/5 used · 沒有 counter · 完全沒障礙"
            messages={[
              {
                role: "assistant",
                content: "您好!我是 PACK&GO AI 旅遊顧問。請告訴我您想去哪裡、什麼季節,我為您推薦合適的行程!",
              },
            ]}
          />

          {/* State 2: Free / 3 of 5 used */}
          <ChatPanel
            label="State 2 — Free / 3 of 5"
            description="counter 出現 · 升級 link 出現 · 還能繼續用"
            messages={[
              {
                role: "assistant",
                content: "您好!我是 PACK&GO AI 旅遊顧問。請告訴我您想去哪裡、什麼季節,我為您推薦合適的行程!",
              },
              {
                role: "user",
                content: "我想 11 月去日本看楓葉,7 天行程",
              },
              {
                role: "assistant",
                content: "11 月中旬日本紅葉最美。建議東京 → 京都 → 大阪路線,可以走精華 7 日。我們有現成行程符合您需求,要看詳細嗎?",
              },
              {
                role: "user",
                content: "可以",
              },
              {
                role: "assistant",
                content: "推薦「日本秋楓精華 7 日」NT$ 68,000/人,東京進大阪出。您想看完整行程嗎?",
              },
            ]}
            usage={{ used: 3, cap: 5 }}
          />

          {/* State 3: Free / hit paywall */}
          <ChatPanel
            label="State 3 — Free / 5 of 5 (Paywall)"
            description="input 鎖定 · paywall card 顯示 · 升級 CTA 突出"
            messages={[
              {
                role: "assistant",
                content: "您好!我是 PACK&GO AI 旅遊顧問。請告訴我您想去哪裡、什麼季節,我為您推薦合適的行程!",
              },
              {
                role: "user",
                content: "我想 11 月去日本看楓葉,7 天行程",
              },
              {
                role: "assistant",
                content: "推薦「日本秋楓精華 7 日」NT$ 68,000/人,東京進大阪出。您想看完整行程嗎?",
              },
              {
                role: "user",
                content: "想看更深入規劃",
              },
              {
                role: "assistant",
                content: "深入的客製化行程涉及偏好、預算、日數細部安排,需要更多互動。免費版到此為止,Plus 會員可解鎖完整客製。",
              },
            ]}
            showPaywall
            usage={{ used: 5, cap: 5 }}
            inputDisabled
            inputPlaceholder="本月免費額度已用完 — 升級會員繼續"
          />

          {/* State 4: Plus member / unlimited */}
          <ChatPanel
            label="State 4 — Plus 會員 / 無限"
            description="💎 badge · 沒 counter · markdown 渲染"
            messages={[
              {
                role: "user",
                content: "11 月去日本看楓葉,7 天精華行程,我跟太太兩人,預算 15 萬",
              },
              {
                role: "assistant",
                content: "" /* unused when isMarkdown */,
                isMarkdown: true,
              },
            ]}
            isPremium
          />
        </div>

        {/* Open questions */}
        <div className="mt-12 bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">
            Jeff 要決定的事
          </h2>
          <ol className="space-y-3 text-sm text-gray-700">
            <li className="flex gap-3">
              <span className="font-mono text-xs text-foreground/40 mt-0.5">01</span>
              <div>
                <strong className="text-foreground">5 則免費額度合理嗎?</strong>{" "}
                <span className="text-gray-500">3 / 5 / 7 都可選 — 5 是 sweet spot 我的判斷,但你可調</span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-xs text-foreground/40 mt-0.5">02</span>
              <div>
                <strong className="text-foreground">paywall 的 CTA 直接連 /membership 還是先過註冊?</strong>{" "}
                <span className="text-gray-500">目前 mockup 直連會員頁,但匿名用戶其實沒帳號</span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-xs text-foreground/40 mt-0.5">03</span>
              <div>
                <strong className="text-foreground">使用 counter 應該在 3/5 才出現,還是一開始就顯示?</strong>{" "}
                <span className="text-gray-500">越早顯示越誠實但可能勸退新訪客</span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-xs text-foreground/40 mt-0.5">04</span>
              <div>
                <strong className="text-foreground">Concierge 額外的「Jeff 4h 跟進」是否寫入 Plus 也夠?</strong>{" "}
                <span className="text-gray-500">如果 Plus 不夠誘人,Concierge 拉差異;如果 Plus 已經夠,Concierge 邊際效益低</span>
              </div>
            </li>
          </ol>
        </div>

        <p className="text-xs text-gray-400 mt-8 text-center">
          Round 80.9 · PACK&GO Internal · 2026-05-01
        </p>
      </div>
    </main>
  );
}
