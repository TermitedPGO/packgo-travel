/**
 * Round 81 / 2026-05-17 — UnifiedInbox.
 *
 * Single-pane-of-glass landing for /admin. Replaces three competing entry
 * points (TodayOverview, OfficeInboxTab, ChatsTab) with one vertical
 * scroll containing:
 *
 *   [1] 需要你決定 (top)  — top 5 pending items needing Jeff's decision,
 *                          each with inline action chips
 *   [2] Pulse  (middle)   — 5-domain KPI inline strip
 *   [3] Activity feed     — last 8 agentMessages across all channels
 *
 * Clicking any pending item opens a right-side Sheet drawer with full
 * context + action buttons — NO page navigation, NO loss of inbox state.
 *
 * OpsAgent is NOT here — it lives in the dedicated AgentChatPage
 * (Office primary tab "agent-chat"). The previous FloatingOpsAgent
 * slide-out was retired 2026-05-18 (P1-7 dead code purge).
 *
 * Design constraints:
 *   - Daily flow target: open admin → see 3 things → 2 clicks → done
 *   - Density: every line earns its row, no decorative whitespace
 *   - Mobile: drawer fullscreen, KPI strip wraps to 2 cols
 *   - Sub-30s page load including all data
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  CheckCircle2,
  Inbox,
  ClipboardList,
  Users,
  Megaphone,
  Wallet,
  HelpCircle,
  Sparkles,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  ThumbsUp,
  X,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

const TYPE_ICON: Record<
  string,
  { Icon: any; label: string; tone: string; bg: string }
> = {
  proposal: {
    Icon: ThumbsUp,
    label: "需審批",
    tone: "text-amber-700",
    bg: "border-amber-200/60 bg-amber-50/40",
  },
  question: {
    Icon: HelpCircle,
    label: "需回答",
    tone: "text-blue-700",
    bg: "border-blue-200/60 bg-blue-50/40",
  },
  alert: {
    Icon: AlertTriangle,
    label: "異常",
    tone: "text-orange-700",
    bg: "border-orange-200/60 bg-orange-50/40",
  },
  escalation: {
    Icon: AlertCircle,
    label: "升級",
    tone: "text-rose-700",
    bg: "border-rose-200/60 bg-rose-50/40",
  },
};

const AGENT_LABEL: Record<string, string> = {
  inquiry: "InquiryAgent",
  review: "ReviewAgent",
  marketing: "CampaignAgent",
  followup: "FollowupAgent",
  refund: "RefundAgent",
  self_retrospective: "RetrospectiveAgent",
  ops: "OpsAgent",
  catalog: "CatalogAgent",
  books: "BooksAgent",
};

export default function UnifiedInbox({
  onNavigate,
}: {
  onNavigate: (pageId: string) => void;
}) {
  const { language } = useLocale();
  const dateLocale = language === "en" ? enUS : zhTW;

  // ─── Data fetches (parallel, auto-refresh) ───
  const stats = trpc.admin.getStats.useQuery(undefined, { refetchInterval: 60_000 });
  const unreadAgents = trpc.agent.unreadMessageCount.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  // Pending agentMessages — proposal / question / alert / escalation that
  // Jeff hasn't read yet (or hasn't decided on, for proposals).
  const pendingMessages = trpc.agent.listMessages.useQuery(
    { onlyUnread: true, limit: 50 },
    { refetchInterval: 30_000 }
  );
  // Activity feed — all recent (read + unread)
  const recentMessages = trpc.agent.listMessages.useQuery(
    { onlyUnread: false, limit: 12 },
    { refetchInterval: 30_000 }
  );

  // ─── Selected item for drawer ───
  const [selectedMessage, setSelectedMessage] = useState<any | null>(null);

  // Filter pending messages → only actionable types
  const actionable = useMemo(() => {
    const data = pendingMessages.data ?? [];
    return data
      .filter((m: any) =>
        ["proposal", "question", "alert", "escalation"].includes(m.messageType)
      )
      .slice(0, 5);
  }, [pendingMessages.data]);

  const now = new Date();
  const greeting = useMemo(() => {
    const h = now.getHours();
    if (language === "en") return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    return h < 12 ? "早安" : h < 18 ? "下午好" : "晚上好";
  }, [language]);

  const utils = trpc.useUtils();
  const markReadMutation = trpc.agent.replyToMessage.useMutation({
    onSuccess: () => {
      utils.agent.listMessages.invalidate();
      utils.agent.unreadMessageCount.invalidate();
    },
  });

  const handleQuickMarkRead = (messageId: number) => {
    markReadMutation.mutate({ messageId, markRead: true });
    if (selectedMessage?.id === messageId) setSelectedMessage(null);
  };

  // Open drawer on item click
  const openDetail = (m: any) => setSelectedMessage(m);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-0">
      {/* ─── Greeting ─── */}
      <div className="flex items-end justify-between mb-4 pt-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">
            {greeting}, Jeff
          </h1>
          <p className="text-sm text-foreground/55 mt-0.5">
            {format(now, language === "en" ? "EEEE, MMMM d" : "M 月 d 日 EEEE", { locale: dateLocale })}
            <span className="hidden sm:inline">
              {" · "}
              {actionable.length > 0
                ? `你有 ${actionable.length} 件待辦`
                : "所有事項都處理完了 🎉"}
            </span>
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            stats.refetch();
            unreadAgents.refetch();
            pendingMessages.refetch();
            recentMessages.refetch();
          }}
          className="text-xs gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">重新整理</span>
        </Button>
      </div>

      {/* ─── SECTION 1: NEEDS YOUR DECISION ─── */}
      <section className="mb-6">
        <h2 className="text-xs uppercase tracking-wider font-semibold text-foreground/50 mb-2 flex items-center gap-1.5 px-1">
          <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
          需要你決定
          {actionable.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold bg-amber-500 text-white rounded-full px-1">
              {actionable.length}
            </span>
          )}
        </h2>

        {pendingMessages.isLoading ? (
          <div className="rounded-xl border border-foreground/10 bg-white p-6 text-center text-sm text-foreground/40">
            載入中⋯
          </div>
        ) : actionable.length === 0 ? (
          <div className="rounded-xl border border-emerald-200/50 bg-emerald-50/30 p-5 flex items-center justify-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4" />
            全部處理完
          </div>
        ) : (
          <div className="space-y-2">
            {actionable.map((m: any) => {
              const typeInfo = TYPE_ICON[m.messageType] ?? TYPE_ICON.question;
              const TypeIcon = typeInfo.Icon;
              const ago = formatDistanceToNow(new Date(m.createdAt), {
                addSuffix: false,
                locale: dateLocale,
              });
              return (
                <button
                  key={m.id}
                  onClick={() => openDetail(m)}
                  className={`w-full text-left rounded-xl border p-3.5 hover:shadow-sm transition-shadow ${typeInfo.bg}`}
                >
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TypeIcon className={`w-4 h-4 ${typeInfo.tone}`} />
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase tracking-wider border-0 ${typeInfo.tone}`}
                      >
                        {typeInfo.label}
                      </Badge>
                      <span className="text-[11px] text-foreground/50">
                        #{AGENT_LABEL[m.agentName] ?? m.agentName}
                      </span>
                      {m.priority === "critical" && (
                        <Badge variant="outline" className="text-[10px] bg-rose-100 text-rose-700 border-rose-200">
                          CRITICAL
                        </Badge>
                      )}
                      {m.priority === "high" && (
                        <Badge variant="outline" className="text-[10px] bg-orange-100 text-orange-700 border-orange-200">
                          HIGH
                        </Badge>
                      )}
                    </div>
                    <span className="text-[10px] text-foreground/40 flex-shrink-0">
                      {ago}
                    </span>
                  </div>
                  <h3 className="font-medium text-sm text-foreground mb-1 line-clamp-1">
                    {m.title}
                  </h3>
                  <p className="text-[13px] text-foreground/65 line-clamp-2">
                    {m.body?.slice(0, 200)}
                  </p>

                  <div className="mt-2.5 pt-2 border-t border-foreground/[0.06] flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] text-foreground/60 font-medium">
                      點開查看 <ArrowRight className="w-3 h-3" />
                    </span>
                    <span className="flex-1" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleQuickMarkRead(m.id);
                      }}
                      className="text-[11px] text-foreground/40 hover:text-foreground/70"
                    >
                      標記已讀
                    </button>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── SECTION 2: Pulse ─── */}
      <section className="mb-6">
        <h2 className="text-xs uppercase tracking-wider font-semibold text-foreground/50 mb-2 px-1">
          Domain Pulse
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <PulseCard
            icon={Inbox}
            label="辦公室"
            value={`${unreadAgents.data?.total ?? 0} 未讀`}
            sub={
              (unreadAgents.data?.critical ?? 0) > 0
                ? `${unreadAgents.data?.critical} 緊急`
                : "agent 訊息"
            }
            accent={unreadAgents.data?.critical ? "rose" : unreadAgents.data?.total ? "amber" : "emerald"}
            loading={unreadAgents.isLoading}
          />
          <PulseCard
            icon={ClipboardList}
            label="行程"
            value={`${stats.data?.activeTours ?? 0} active`}
            sub={`${stats.data?.todayBookings ?? 0} 今日訂單`}
            accent="indigo"
            onClick={() => onNavigate("tours")}
            loading={stats.isLoading}
          />
          <PulseCard
            icon={Users}
            label="客戶"
            value={`${stats.data?.totalUsers ?? 0} 會員`}
            sub={`${stats.data?.totalSubscribers ?? 0} subs`}
            accent="violet"
            onClick={() => onNavigate("customers-landing")}
            loading={stats.isLoading}
          />
          <PulseCard
            icon={Wallet}
            label="帳目"
            value={`$${Number(stats.data?.thisMonthRevenue ?? 0).toLocaleString()}`}
            sub={
              (stats.data?.revenueGrowth ?? 0) > 0
                ? `+${stats.data?.revenueGrowth}%`
                : `${stats.data?.revenueGrowth ?? 0}%`
            }
            accent="emerald"
            onClick={() => onNavigate("finance-landing")}
            loading={stats.isLoading}
          />
          <PulseCard
            icon={Megaphone}
            label="行銷"
            value={`${stats.data?.totalSubscribers ?? 0} subs`}
            sub="see campaigns"
            accent="sky"
            onClick={() => onNavigate("marketing-landing")}
            loading={stats.isLoading}
          />
        </div>
      </section>

      {/* ─── SECTION 3: Activity feed ─── */}
      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-wider font-semibold text-foreground/50 mb-2 flex items-center gap-1.5 px-1">
          <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
          Agent Activity (24h)
        </h2>
        <div className="rounded-xl border border-foreground/10 bg-white">
          {recentMessages.isLoading ? (
            <div className="p-6 text-center text-sm text-foreground/40">載入中⋯</div>
          ) : (recentMessages.data ?? []).length === 0 ? (
            <div className="p-6 text-center text-sm text-foreground/40">
              還沒有 agent 動作
            </div>
          ) : (
            <div className="divide-y divide-foreground/[0.06]">
              {(recentMessages.data ?? []).slice(0, 12).map((m: any) => {
                const ago = formatDistanceToNow(new Date(m.createdAt), {
                  addSuffix: false,
                  locale: dateLocale,
                });
                const isUnread = m.readByJeff === 0;
                return (
                  <button
                    key={m.id}
                    onClick={() => openDetail(m)}
                    className="w-full flex items-start gap-3 px-3.5 py-2.5 hover:bg-foreground/[0.02] transition-colors text-left"
                  >
                    <span
                      className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
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
                      <span className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[11px] font-medium text-foreground/50 truncate">
                          #{AGENT_LABEL[m.agentName] ?? m.agentName}
                        </span>
                        <span className="text-[10px] text-foreground/35">·</span>
                        <span className="text-[10px] text-foreground/35">{ago}</span>
                      </span>
                      <span
                        className={`text-[13px] line-clamp-1 ${
                          isUnread ? "text-foreground/85" : "text-foreground/55"
                        }`}
                      >
                        {m.title ?? m.body?.slice(0, 100)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ─── Detail drawer (Sheet from right) ─── */}
      <Sheet
        open={selectedMessage !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedMessage(null);
        }}
      >
        <SheetContent className="w-full xl:max-w-5xl xl:rounded-l-xl overflow-y-auto">
          {selectedMessage && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base flex items-center gap-2 pr-8">
                  {(() => {
                    const typeInfo = TYPE_ICON[selectedMessage.messageType] ?? TYPE_ICON.question;
                    const Icon = typeInfo.Icon;
                    return <Icon className={`w-4 h-4 ${typeInfo.tone}`} />;
                  })()}
                  <span className="truncate">{selectedMessage.title}</span>
                </SheetTitle>
                <SheetDescription className="flex items-center gap-1.5 text-xs">
                  <span>#{AGENT_LABEL[selectedMessage.agentName] ?? selectedMessage.agentName}</span>
                  <span className="text-foreground/35">·</span>
                  <span>{format(new Date(selectedMessage.createdAt), "MM/dd HH:mm")}</span>
                  <span className="text-foreground/35">·</span>
                  <span className="capitalize">{selectedMessage.priority}</span>
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                {/* Body */}
                <div className="text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed">
                  {selectedMessage.body}
                </div>

                {/* Context JSON if present */}
                {selectedMessage.context && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-foreground/40 hover:text-foreground/70">
                      上下文資料
                    </summary>
                    <pre className="mt-2 bg-foreground/[0.03] p-2.5 rounded-md overflow-x-auto text-[11px]">
                      {(() => {
                        try {
                          return JSON.stringify(JSON.parse(selectedMessage.context), null, 2);
                        } catch {
                          return selectedMessage.context;
                        }
                      })()}
                    </pre>
                  </details>
                )}

                {/* Action buttons */}
                <div className="pt-3 border-t border-foreground/10 flex gap-2 flex-wrap">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleQuickMarkRead(selectedMessage.id)}
                    disabled={markReadMutation.isPending}
                    className="rounded-lg"
                  >
                    {selectedMessage.readByJeff === 0 ? "標記已讀" : "已讀"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Navigate to the agent's full channel for context history
                      onNavigate("office-chat");
                      setSelectedMessage(null);
                    }}
                    className="rounded-lg"
                  >
                    打開完整 #{selectedMessage.agentName} channel
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedMessage(null)}
                    className="rounded-lg ml-auto"
                  >
                    <X className="w-3.5 h-3.5 mr-1" />
                    關閉
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// PulseCard — compact KPI tile for Domain Pulse row
// ────────────────────────────────────────────────────────────────────────
type Accent = "rose" | "amber" | "emerald" | "indigo" | "violet" | "sky";
const ACCENT_BG: Record<Accent, string> = {
  rose: "bg-rose-50 border-rose-100",
  amber: "bg-amber-50 border-amber-100",
  emerald: "bg-emerald-50 border-emerald-100",
  indigo: "bg-indigo-50 border-indigo-100",
  violet: "bg-violet-50 border-violet-100",
  sky: "bg-sky-50 border-sky-100",
};
const ACCENT_ICON: Record<Accent, string> = {
  rose: "text-rose-600",
  amber: "text-amber-600",
  emerald: "text-emerald-600",
  indigo: "text-indigo-600",
  violet: "text-violet-600",
  sky: "text-sky-600",
};

function PulseCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  onClick,
  loading,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  accent: Accent;
  onClick?: () => void;
  loading?: boolean;
}) {
  const Cmp = onClick ? "button" : "div";
  return (
    <Cmp
      onClick={onClick}
      className={`text-left rounded-lg border p-2.5 ${ACCENT_BG[accent]} ${onClick ? "hover:shadow-sm cursor-pointer" : ""} transition-shadow`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${ACCENT_ICON[accent]}`} />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground/55">
          {label}
        </span>
      </div>
      <div className="text-sm font-bold text-foreground tabular-nums truncate">
        {loading ? <span className="text-foreground/30">⋯</span> : value}
      </div>
      {sub && (
        <div className="text-[10px] text-foreground/50 truncate mt-0.5">
          {loading ? "" : sub}
        </div>
      )}
    </Cmp>
  );
}
