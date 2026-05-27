/**
 * Round 81 / 2026-05-17 — Customers domain landing page.
 *
 * At-a-glance: who are PACK&GO's customers right now.
 *   • Total registered users + breakdown by tier
 *   • Newsletter subscribers
 *   • Active membership trials (10-day countdown)
 *   • Recent reviews (positive/negative split)
 *   • Recent customer interactions (#inquiry channel)
 */
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Users,
  Star,
  Mail,
  Crown,
  HeartHandshake,
  MessageCircle,
  Globe,
  FileText,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import { KpiCard, SectionCard, LandingGreeting } from "./landingPrimitives";

export default function CustomersLanding({
  onNavigate,
}: {
  onNavigate: (pageId: string) => void;
}) {
  const stats = trpc.admin.getStats.useQuery(undefined, { refetchInterval: 60_000 });
  const inquiryMessages = trpc.agent.listMessages.useQuery(
    { agentName: "inquiry" as any, limit: 6 },
    { refetchInterval: 30_000 }
  );

  const totalUsers = stats.data?.totalUsers ?? 0;
  const subscribers = stats.data?.totalSubscribers ?? 0;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <LandingGreeting
        title="👥 客戶"
        subtitle={`${totalUsers} 個會員 · ${subscribers} 個 newsletter subscribers · CRM 已啟動`}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          icon={Users}
          label="會員總數"
          primary={totalUsers}
          secondary="Free + Plus + Concierge"
          accent="violet"
          onClick={() => onNavigate("packpoint")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={Mail}
          label="Newsletter Subs"
          primary={subscribers}
          secondary="Email 訂閱者"
          accent="sky"
          loading={stats.isLoading}
        />
        <KpiCard
          icon={Star}
          label="評論"
          primary={stats.data?.totalReviews ?? 0}
          secondary={`${stats.data?.pendingReviews ?? 0} 待審核`}
          accent="emerald"
          onClick={() => onNavigate("reviews")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={Crown}
          label="訂單"
          primary={stats.data?.totalBookings ?? 0}
          secondary={`本日 ${stats.data?.todayBookings ?? 0}`}
          accent="amber"
          onClick={() => onNavigate("bookings")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={HeartHandshake}
          label="詢問中"
          primary={stats.data?.pendingInquiries ?? 0}
          secondary="待處理 inquiries"
          accent="rose"
          onClick={() => onNavigate("inquiries")}
          loading={stats.isLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
        <SectionCard
          title="#inquiry 最近訊息"
          icon={MessageCircle}
          iconTone="text-emerald-600"
          action={{ label: "看 #inquiry channel", onClick: () => onNavigate("agent-chat") }}
        >
          {inquiryMessages.isLoading ? (
            <div className="text-xs text-foreground/40 py-3">載入中⋯</div>
          ) : (inquiryMessages.data ?? []).length === 0 ? (
            <div className="text-xs text-foreground/40 py-6 text-center">
              還沒有客戶來信。Gmail polling 每 10 分鐘跑一次。
            </div>
          ) : (
            <div className="space-y-1.5">
              {(inquiryMessages.data ?? []).slice(0, 6).map((m: any) => {
                const ago = formatDistanceToNow(new Date(m.createdAt), {
                  addSuffix: false,
                  locale: zhTW,
                });
                return (
                  <button
                    key={m.id}
                    onClick={() => onNavigate("agent-chat")}
                    className="w-full text-left flex items-start gap-2 px-1.5 py-1 rounded-md hover:bg-foreground/[0.03] transition-colors"
                  >
                    <span
                      className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        m.priority === "critical"
                          ? "bg-rose-500"
                          : m.priority === "high"
                            ? "bg-orange-500"
                            : m.readByJeff === 0
                              ? "bg-amber-500"
                              : "bg-foreground/15"
                      }`}
                    />
                    <span className="flex-1 min-w-0 text-xs text-foreground/80">
                      {(m.title ?? m.body ?? "").slice(0, 80)}
                    </span>
                    <span className="text-[10px] text-foreground/40 flex-shrink-0">{ago}</span>
                  </button>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard title="快速動作" icon={Users} iconTone="text-violet-600">
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("ai-quotes")}
            >
              <FileText className="w-4 h-4 mr-2" />
              AI 報價單列表
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("tool-quote")}
            >
              <FileText className="w-4 h-4 mr-2" />
              手動建立報價單
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("wechat-assist")}
            >
              <Globe className="w-4 h-4 mr-2" />
              WeChat 客戶服務
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("packpoint")}
            >
              <Star className="w-4 h-4 mr-2" />
              Packpoint 管理
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
