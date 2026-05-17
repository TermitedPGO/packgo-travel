/**
 * Round 81 / 2026-05-17 — Today Overview
 *
 * Single-screen "pulse" landing page. Jeff opens admin → instantly sees:
 *   • Each of the 5 domain's current state (KPIs)
 *   • Pending items needing his decision (top 3)
 *   • Recent activity ticker (last 8 agent messages, mixed channels)
 *   • One-click into any channel or sub-page
 *
 * Replaces the legacy "office-inbox" as the primary landing. Old Inbox tab
 * still accessible (advanced section); this page is the at-a-glance UX
 * Jeff asked for.
 *
 * Layout (desktop):
 *   ┌─────────────────────────────────────────────┐
 *   │  Today's pulse (greeting + date)            │
 *   ├──────┬──────┬──────┬──────┬──────────────┐  │
 *   │ 📥   │ 🗺   │ 👥   │ 📢   │ 💰           │
 *   │ Off  │ Ops  │ Cust │ Mktg │ Finance      │
 *   ├──────┴──────┴──────┴──────┴──────────────┘  │
 *   │  Triage queue (top 3 pending)               │
 *   │  Recent activity (last 8)                   │
 *   │  Quick CTAs                                 │
 *   └─────────────────────────────────────────────┘
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Inbox,
  ClipboardList,
  Users,
  Megaphone,
  Wallet,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  ArrowRight,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";
import { useLocale } from "@/contexts/LocaleContext";

export default function TodayOverview({
  onNavigate,
}: {
  onNavigate: (pageId: string) => void;
}) {
  const { language } = useLocale();
  const dateLocale = language === "en" ? enUS : zhTW;
  const stats = trpc.admin.getStats.useQuery(undefined, { refetchInterval: 60_000 });
  const unreadAgents = trpc.agent.unreadMessageCount.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const pendingForJeff = trpc.agent.pendingForJeff.useQuery(
    { limit: 3 },
    { refetchInterval: 30_000 }
  );
  const recentMessages = trpc.agent.listMessages.useQuery(
    { limit: 8 },
    { refetchInterval: 30_000 }
  );

  const now = new Date();
  const greeting = useMemo(() => {
    const h = now.getHours();
    if (language === "en") return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    return h < 12 ? "早安" : h < 18 ? "下午好" : "晚上好";
  }, [language]);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Greeting */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">
            {greeting}, Jeff
          </h1>
          <p className="text-sm text-foreground/50">
            {format(now, language === "en" ? "EEEE, MMMM d" : "M 月 d 日 EEEE", { locale: dateLocale })}
            {unreadAgents.data && unreadAgents.data.total > 0 && (
              <span className="ml-3 text-amber-700 font-medium">
                · 你有 {unreadAgents.data.total} 則未讀 agent 訊息
              </span>
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            stats.refetch();
            unreadAgents.refetch();
            pendingForJeff.refetch();
            recentMessages.refetch();
          }}
          className="text-xs gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          重新整理
        </Button>
      </div>

      {/* 5 Domain KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Office */}
        <KpiCard
          icon={Inbox}
          label="辦公室"
          primary={`${unreadAgents.data?.total ?? 0} 未讀`}
          secondary={
            unreadAgents.data?.critical
              ? `${unreadAgents.data.critical} 緊急`
              : pendingForJeff.data?.length
                ? `${pendingForJeff.data.length} 待審批`
                : "全部處理完"
          }
          accent={
            (unreadAgents.data?.critical ?? 0) > 0
              ? "rose"
              : (unreadAgents.data?.total ?? 0) > 0
                ? "amber"
                : "emerald"
          }
          onClick={() => onNavigate("office-chat")}
          loading={unreadAgents.isLoading}
        />

        {/* Ops */}
        <KpiCard
          icon={ClipboardList}
          label="營運"
          primary={`${stats.data?.activeTours ?? 0} 個 active tour`}
          secondary={
            (stats.data?.todayBookings ?? 0) > 0
              ? `今日 ${stats.data?.todayBookings} 個新訂單`
              : `${stats.data?.pendingInquiries ?? 0} 個待回覆`
          }
          accent="indigo"
          onClick={() => onNavigate("tours")}
          loading={stats.isLoading}
        />

        {/* Customers */}
        <KpiCard
          icon={Users}
          label="客戶"
          primary={`${stats.data?.totalUsers ?? 0} 個會員`}
          secondary={`${stats.data?.totalSubscribers ?? 0} newsletter`}
          accent="violet"
          onClick={() => onNavigate("reviews")}
          loading={stats.isLoading}
        />

        {/* Marketing */}
        <KpiCard
          icon={Megaphone}
          label="行銷"
          primary={`${stats.data?.totalSubscribers ?? 0} subscribers`}
          secondary="點開看 campaign"
          accent="sky"
          onClick={() => onNavigate("posters")}
          loading={stats.isLoading}
        />

        {/* Finance */}
        <KpiCard
          icon={Wallet}
          label="財務"
          primary={`$${Number(stats.data?.thisMonthRevenue ?? 0).toLocaleString()}`}
          secondary={
            (stats.data?.revenueGrowth ?? 0) > 0
              ? `本月 +${stats.data?.revenueGrowth}% vs 上月`
              : `本月 ${stats.data?.revenueGrowth ?? 0}% vs 上月`
          }
          accent="emerald"
          trend={(stats.data?.revenueGrowth ?? 0) >= 0 ? "up" : "down"}
          onClick={() => onNavigate("finance")}
          loading={stats.isLoading}
        />
      </div>

      {/* 2-column: Triage + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
        {/* Triage queue */}
        <Card className="rounded-xl">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                需要你決定 (Triage)
              </h2>
              <button
                onClick={() => onNavigate("office-inbox")}
                className="text-[11px] text-foreground/50 hover:text-foreground/80"
              >
                看全部 →
              </button>
            </div>
            {pendingForJeff.isLoading ? (
              <div className="text-xs text-foreground/40 py-3">載入中⋯</div>
            ) : (pendingForJeff.data ?? []).length === 0 ? (
              <div className="text-xs text-foreground/40 py-6 text-center flex flex-col items-center gap-1">
                <CheckCircle2 className="w-6 h-6 text-emerald-500/50" />
                <span>全部已處理 🎉</span>
              </div>
            ) : (
              <div className="space-y-2">
                {(pendingForJeff.data ?? []).slice(0, 3).map((item: any) => (
                  <button
                    key={item.outcomeId}
                    onClick={() => onNavigate("office-inbox")}
                    className="w-full text-left p-2.5 rounded-lg border border-amber-200/60 bg-amber-50/30 hover:bg-amber-50/60 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                        {item.agentName ?? "agent"}
                      </span>
                      <span className="text-[10px] text-foreground/40">
                        conf {item.confidence}
                      </span>
                    </div>
                    <div className="text-xs text-foreground/85 line-clamp-2">
                      {item.contentSummary || item.content?.slice(0, 100) || "(無摘要)"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card className="rounded-xl">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                Agent 最近動作
              </h2>
              <button
                onClick={() => onNavigate("office-chat")}
                className="text-[11px] text-foreground/50 hover:text-foreground/80"
              >
                打開 chats →
              </button>
            </div>
            {recentMessages.isLoading ? (
              <div className="text-xs text-foreground/40 py-3">載入中⋯</div>
            ) : (recentMessages.data ?? []).length === 0 ? (
              <div className="text-xs text-foreground/40 py-6 text-center">
                還沒有 agent 動作
              </div>
            ) : (
              <div className="space-y-1.5">
                {(recentMessages.data ?? []).slice(0, 8).map((m: any) => {
                  const ago = formatDistanceToNow(new Date(m.createdAt), {
                    addSuffix: false,
                    locale: dateLocale,
                  });
                  const isUnread = m.readByJeff === 0;
                  return (
                    <button
                      key={m.id}
                      onClick={() => onNavigate("office-chat")}
                      className="w-full text-left flex items-start gap-2 px-1.5 py-1 rounded-md hover:bg-foreground/[0.03] transition-colors"
                    >
                      <span
                        className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          isUnread
                            ? m.priority === "critical"
                              ? "bg-rose-500"
                              : m.priority === "high"
                                ? "bg-orange-500"
                                : "bg-amber-500"
                            : "bg-foreground/15"
                        }`}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="text-[11px] text-foreground/40 mr-1.5">
                          #{m.agentName}
                        </span>
                        <span
                          className={`text-xs ${isUnread ? "text-foreground/85 font-medium" : "text-foreground/60"}`}
                        >
                          {(m.title ?? m.body ?? "").slice(0, 80)}
                        </span>
                      </span>
                      <span className="text-[10px] text-foreground/40 flex-shrink-0">{ago}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick CTAs */}
      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          onClick={() => onNavigate("office-chat")}
          className="rounded-lg gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          size="sm"
        >
          <Sparkles className="w-4 h-4" />
          問 OpsAgent
        </Button>
        <Button
          variant="outline"
          onClick={() => onNavigate("office-inbox")}
          className="rounded-lg gap-2"
          size="sm"
        >
          <Inbox className="w-4 h-4" />
          看待辦
        </Button>
        <Button
          variant="outline"
          onClick={() => onNavigate("tours")}
          className="rounded-lg gap-2"
          size="sm"
        >
          <ClipboardList className="w-4 h-4" />
          管理行程
        </Button>
        <Button
          variant="outline"
          onClick={() => onNavigate("accounting")}
          className="rounded-lg gap-2"
          size="sm"
        >
          <Wallet className="w-4 h-4" />
          對帳
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// KPI card sub-component
// ────────────────────────────────────────────────────────────────────────
type Accent = "rose" | "amber" | "emerald" | "indigo" | "violet" | "sky";
const ACCENT_BG: Record<Accent, string> = {
  rose: "from-rose-50 to-white border-rose-100",
  amber: "from-amber-50 to-white border-amber-100",
  emerald: "from-emerald-50 to-white border-emerald-100",
  indigo: "from-indigo-50 to-white border-indigo-100",
  violet: "from-violet-50 to-white border-violet-100",
  sky: "from-sky-50 to-white border-sky-100",
};
const ACCENT_ICON: Record<Accent, string> = {
  rose: "text-rose-600 bg-rose-100",
  amber: "text-amber-600 bg-amber-100",
  emerald: "text-emerald-600 bg-emerald-100",
  indigo: "text-indigo-600 bg-indigo-100",
  violet: "text-violet-600 bg-violet-100",
  sky: "text-sky-600 bg-sky-100",
};

function KpiCard({
  icon: Icon,
  label,
  primary,
  secondary,
  accent,
  trend,
  onClick,
  loading,
}: {
  icon: any;
  label: string;
  primary: string;
  secondary: string;
  accent: Accent;
  trend?: "up" | "down";
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative text-left rounded-xl border bg-gradient-to-b ${ACCENT_BG[accent]} p-3.5 hover:shadow-md transition-shadow`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={`w-8 h-8 rounded-lg ${ACCENT_ICON[accent]} flex items-center justify-center`}>
          <Icon className="w-4 h-4" />
        </div>
        <ArrowRight className="w-3.5 h-3.5 text-foreground/30 group-hover:text-foreground/60 transition-colors" />
      </div>
      <div className="text-[11px] uppercase tracking-wider font-semibold text-foreground/50 mb-0.5">
        {label}
      </div>
      <div className="text-base font-bold text-foreground tabular-nums flex items-center gap-1">
        {loading ? <span className="text-foreground/30">⋯</span> : primary}
        {trend === "up" && <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />}
        {trend === "down" && <TrendingDown className="w-3.5 h-3.5 text-rose-500" />}
      </div>
      <div className="text-[11px] text-foreground/55 mt-0.5 line-clamp-1">
        {loading ? "" : secondary}
      </div>
    </button>
  );
}
