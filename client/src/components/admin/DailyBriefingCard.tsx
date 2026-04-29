/**
 * DailyBriefingCard — v78i: "today's actions" panel that surfaces the items
 * Jeff actually needs to decide on, instead of empty stats cards.
 *
 * Pulls from:
 *   - wechatAssist.listPending — drafts awaiting approval
 *   - aiQuotes.adminList (status=generated) — new quotes that need follow-up
 *   - inquiries.list — new customer questions
 *   - reconciliation.runReport — discrepancies in current month
 *
 * Each row is clickable and navigates to the relevant admin tab.
 */
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { MessageSquare, Sparkles, AlertTriangle, ArrowRight, CheckCircle2, FileText } from "lucide-react";

interface Props {
  onNavigate: (tab: string) => void;
}

export default function DailyBriefingCard({ onNavigate }: Props) {
  const { language } = useLocale();
  const isEN = language === "en";

  // Pending WeChat drafts (status=ready_review)
  const { data: pendingWechat } = trpc.wechatAssist.listPending.useQuery({ limit: 50 });
  // New AI quotes (status=generated, last 7 days)
  const { data: pendingQuotes } = trpc.aiQuotes.adminList.useQuery({
    status: "generated",
    limit: 50,
    offset: 0,
  });
  // New inquiries
  const { data: inquiries } = trpc.inquiries.list.useQuery();

  const wechatCount = pendingWechat?.length ?? 0;
  const quotesCount = pendingQuotes?.length ?? 0;
  const inquiryCount = inquiries?.filter((i: any) => i.status === "new").length ?? 0;
  const totalActions = wechatCount + quotesCount + inquiryCount;

  // Friendly time-based greeting
  const hour = new Date().getHours();
  const greeting = hour < 6 ? (isEN ? "Late night" : "深夜了") :
                   hour < 12 ? (isEN ? "Good morning" : "早安") :
                   hour < 18 ? (isEN ? "Good afternoon" : "午安") :
                   (isEN ? "Good evening" : "晚上好");
  const dateStr = new Date().toLocaleDateString(isEN ? "en-US" : "zh-TW", {
    month: "short",
    day: "numeric",
    weekday: "short",
  });

  const rows = [
    wechatCount > 0 && {
      key: "wechat",
      icon: MessageSquare,
      bg: "bg-emerald-50 border-emerald-200",
      iconBg: "bg-emerald-100 text-emerald-700",
      title: isEN
        ? `${wechatCount} WeChat draft${wechatCount > 1 ? "s" : ""} ready for review`
        : `${wechatCount} 則 WeChat 草稿等您 approve`,
      sub: isEN
        ? "AI generated replies. One click to send."
        : "AI 已生成回覆，一鍵核准傳送",
      tab: "wechat-assist",
    },
    quotesCount > 0 && {
      key: "quotes",
      icon: Sparkles,
      bg: "bg-blue-50 border-blue-200",
      iconBg: "bg-blue-100 text-blue-700",
      title: isEN
        ? `${quotesCount} new quote${quotesCount > 1 ? "s" : ""} to follow up`
        : `${quotesCount} 張新報價單需要跟進`,
      sub: isEN
        ? "Customers expecting your reply within 24h."
        : "客戶等您 24 小時內回覆",
      tab: "ai-quotes",
    },
    inquiryCount > 0 && {
      key: "inquiry",
      icon: AlertTriangle,
      bg: "bg-amber-50 border-amber-200",
      iconBg: "bg-amber-100 text-amber-700",
      title: isEN
        ? `${inquiryCount} new inquir${inquiryCount > 1 ? "ies" : "y"}`
        : `${inquiryCount} 則新客戶詢問`,
      sub: isEN
        ? "Direct questions from website contact form."
        : "網站聯絡表單來信",
      tab: "inquiries",
    },
  ].filter(Boolean) as any[];

  return (
    <div className="rounded-xl bg-gradient-to-br from-gray-900 to-gray-800 text-white p-6 md:p-8 mb-2">
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs font-bold tracking-[0.2em] uppercase text-emerald-300 mb-2">
            {isEN ? "PACK&GO Daily Briefing" : "PACK&GO 早報"}
          </p>
          <h2 className="text-2xl md:text-3xl font-bold">
            {greeting}，Jeff
          </h2>
          <p className="text-sm text-gray-400 mt-1">{dateStr}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold tabular-nums">{totalActions}</p>
          <p className="text-xs text-gray-400 uppercase tracking-wide">
            {isEN ? "Actions today" : "今日待處理"}
          </p>
        </div>
      </div>

      {totalActions === 0 ? (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
          <CheckCircle2 className="h-5 w-5 text-emerald-300" />
          <p className="text-sm text-emerald-100">
            {isEN
              ? "All clear. AI is handling the rest."
              : "所有事項已處理完畢，AI 正在處理其餘的訊息。"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row: any) => {
            const Icon = row.icon;
            return (
              <button
                key={row.key}
                onClick={() => onNavigate(row.tab)}
                className={`w-full flex items-center gap-4 p-4 rounded-lg border ${row.bg} hover:scale-[1.01] transition-transform text-left text-gray-900`}
              >
                <div className={`w-10 h-10 rounded-lg ${row.iconBg} flex items-center justify-center flex-shrink-0`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{row.title}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{row.sub}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-6 pt-6 border-t border-white/10 grid grid-cols-3 gap-4 text-center">
        <button
          onClick={() => onNavigate("ai-quotes")}
          className="hover:bg-white/5 rounded-lg py-2 transition-colors"
        >
          <Sparkles className="h-4 w-4 mx-auto text-emerald-300 mb-1" />
          <p className="text-xs text-gray-400">{isEN ? "AI Quotes" : "AI 報價"}</p>
        </button>
        <button
          onClick={() => onNavigate("invoices")}
          className="hover:bg-white/5 rounded-lg py-2 transition-colors"
        >
          <FileText className="h-4 w-4 mx-auto text-emerald-300 mb-1" />
          <p className="text-xs text-gray-400">{isEN ? "Invoices" : "發票"}</p>
        </button>
        <button
          onClick={() => onNavigate("reconciliation")}
          className="hover:bg-white/5 rounded-lg py-2 transition-colors"
        >
          <CheckCircle2 className="h-4 w-4 mx-auto text-emerald-300 mb-1" />
          <p className="text-xs text-gray-400">{isEN ? "Reconciliation" : "對帳"}</p>
        </button>
      </div>
    </div>
  );
}
