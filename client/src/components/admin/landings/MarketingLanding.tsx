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
import { useLocale } from "@/contexts/LocaleContext";

export default function MarketingLanding({
  onNavigate,
}: {
  onNavigate: (pageId: string) => void;
}) {
  const { t } = useLocale();
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
        title={t('admin.marketingLanding.title')}
        subtitle={t('admin.marketingLanding.subtitle', { subscribers: stats.data?.totalSubscribers ?? 0, alerts: competitorUnread.data ?? 0 })}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          icon={ImageIcon}
          label={t('admin.marketingLanding.posterLabel')}
          primary={stats.data?.postersThisMonth ?? 0}
          secondary={t('admin.marketingLanding.generatedThisMonth')}
          accent="sky"
          onClick={() => onNavigate("posters")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={Mail}
          label={t('admin.marketingLanding.newsletterSubs')}
          primary={stats.data?.totalSubscribers ?? 0}
          secondary={t('admin.marketingLanding.pendingSegment')}
          accent="indigo"
          loading={stats.isLoading}
        />
        <KpiCard
          icon={TrendingUp}
          label={t('admin.marketingLanding.competitorAlerts')}
          primary={competitorUnread.data ?? 0}
          secondary={(competitorUnread.data ?? 0) > 0 ? t('admin.marketingLanding.unread') : t('admin.marketingLanding.allRead')}
          accent={(competitorUnread.data ?? 0) > 0 ? "amber" : "emerald"}
          onClick={() => onNavigate("competitor-monitor")}
          loading={competitorUnread.isLoading}
        />
        <KpiCard
          icon={ExternalLink}
          label={t('admin.marketingLanding.tripcomAff')}
          primary={stats.data?.totalAffiliateClicks ?? 0}
          secondary="clicks"
          accent="violet"
          onClick={() => onNavigate("affiliate")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={Eye}
          label={t('admin.marketingLanding.trafficAnalytics')}
          primary="GA4"
          secondary={t('admin.marketingLanding.independentReport')}
          accent="slate"
          onClick={() => onNavigate("analytics")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
        <SectionCard
          title={t('admin.marketingLanding.recentMarketingActions')}
          icon={Sparkles}
          iconTone="text-violet-600"
          action={{ label: t('admin.marketingLanding.viewMarketingChannel'), onClick: () => onNavigate("agent-chat") }}
        >
          {marketingMessages.isLoading ? (
            <div className="text-xs text-foreground/40 py-3">{t('admin.marketingLanding.loading')}</div>
          ) : (marketingMessages.data ?? []).length === 0 ? (
            <div className="text-xs text-foreground/40 py-6 text-center">
              {t('admin.marketingLanding.noMarketingActions')}
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
                    onClick={() => onNavigate("agent-chat")}
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

        <SectionCard title={t('admin.marketingLanding.quickActions')} icon={Megaphone} iconTone="text-sky-600">
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("posters")}
            >
              <ImageIcon className="w-4 h-4 mr-2" />
              {t('admin.marketingLanding.generatePoster')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("marketing-content")}
            >
              <PenTool className="w-4 h-4 mr-2" />
              {t('admin.marketingLanding.aiCopywriting')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("marketing")}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {t('admin.marketingLanding.automatedCampaign')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("competitor-monitor")}
            >
              <Eye className="w-4 h-4 mr-2" />
              {t('admin.marketingLanding.competitorPriceMonitor')}
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
