/**
 * Round 81 / 2026-05-17 — Marketing domain landing page.
 *
 * At-a-glance: campaign + content production rate.
 *   • Posters generated (this week / month)
 *   • Newsletter sent
 *   • Top-clicked tour
 *   • Trip.com affiliate revenue (rough)
 *   • Competitor monitor alerts (unread)
 */
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Megaphone,
  Image as ImageIcon,
  Mail,
  TrendingUp,
  Eye,
  ExternalLink,
  PenTool,
  Sparkles,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import { KpiCard, SectionCard, LandingGreeting } from "./landingPrimitives";

export default function MarketingLanding({
  onNavigate,
}: {
  onNavigate: (pageId: string) => void;
}) {
  const stats = trpc.admin.getStats.useQuery(undefined, { refetchInterval: 60_000 });
  const competitorUnread = trpc.competitor.unreadAlertCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const marketingMessages = trpc.agent.listMessages.useQuery(
    { agentName: "marketing" as any, limit: 6 },
    { refetchInterval: 30_000 }
  );

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <LandingGreeting
        title="📢 行銷"
        subtitle={`${stats.data?.totalSubscribers ?? 0} subscribers · ${(competitorUnread.data ?? 0)} 個競品 alert`}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          icon={ImageIcon}
          label="海報 / Poster"
          primary={stats.data?.postersThisMonth ?? 0}
          secondary="本月生成"
          accent="sky"
          onClick={() => onNavigate("posters")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={Mail}
          label="Newsletter Subs"
          primary={stats.data?.totalSubscribers ?? 0}
          secondary="待 segment 分眾"
          accent="indigo"
          loading={stats.isLoading}
        />
        <KpiCard
          icon={TrendingUp}
          label="競品 Alerts"
          primary={competitorUnread.data ?? 0}
          secondary={(competitorUnread.data ?? 0) > 0 ? "未讀" : "全部看過"}
          accent={(competitorUnread.data ?? 0) > 0 ? "amber" : "emerald"}
          onClick={() => onNavigate("competitor-monitor")}
          loading={competitorUnread.isLoading}
        />
        <KpiCard
          icon={ExternalLink}
          label="Trip.com Aff"
          primary={stats.data?.totalAffiliateClicks ?? 0}
          secondary="clicks"
          accent="violet"
          onClick={() => onNavigate("affiliate")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={Eye}
          label="流量分析"
          primary="GA4"
          secondary="獨立報表"
          accent="slate"
          onClick={() => onNavigate("analytics")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
        <SectionCard
          title="#marketing channel 最近動作"
          icon={Sparkles}
          iconTone="text-violet-600"
          action={{ label: "看 #marketing", onClick: () => onNavigate("office-chat") }}
        >
          {marketingMessages.isLoading ? (
            <div className="text-xs text-foreground/40 py-3">載入中⋯</div>
          ) : (marketingMessages.data ?? []).length === 0 ? (
            <div className="text-xs text-foreground/40 py-6 text-center">
              還沒有 CampaignAgent 動作。第一波 newsletter 發出後會有 log。
            </div>
          ) : (
            <div className="space-y-1.5">
              {(marketingMessages.data ?? []).slice(0, 6).map((m: any) => {
                const ago = formatDistanceToNow(new Date(m.createdAt), {
                  addSuffix: false,
                  locale: zhTW,
                });
                return (
                  <button
                    key={m.id}
                    onClick={() => onNavigate("office-chat")}
                    className="w-full text-left flex items-start gap-2 px-1.5 py-1 rounded-md hover:bg-foreground/[0.03] transition-colors"
                  >
                    <span
                      className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        m.readByJeff === 0 ? "bg-violet-500" : "bg-foreground/15"
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

        <SectionCard title="快速動作" icon={Megaphone} iconTone="text-sky-600">
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("posters")}
            >
              <ImageIcon className="w-4 h-4 mr-2" />
              生 Poster (OpenAI)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("marketing-content")}
            >
              <PenTool className="w-4 h-4 mr-2" />
              AI 文案 (小紅書 / 微信 / SEO)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("marketing")}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              自動化 Campaign
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("competitor-monitor")}
            >
              <Eye className="w-4 h-4 mr-2" />
              競品價格監控
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
