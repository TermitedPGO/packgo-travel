/**
 * Round 81 / 2026-05-17 — Ops domain landing page.
 *
 * What Jeff needs at-a-glance when he clicks 營運:
 *   • Active tours count + draft pending
 *   • Today's bookings + this week's bookings
 *   • Next departure (which group leaves first, in how many days)
 *   • Pending inquiries needing response
 *   • Supplier sync health (last successful run)
 *
 * Below: list of upcoming departures (next 30 days), recent tour additions.
 * CTA: 看完整行程列表 / 觸發 supplier sync / 看 booking
 */
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Map,
  Calendar,
  ClipboardList,
  AlertCircle,
  Briefcase,
  Sparkles,
  RefreshCw,
  PlayCircle,
} from "lucide-react";
import { format, formatDistanceToNow, isAfter } from "date-fns";
import { zhTW } from "date-fns/locale";
import { KpiCard, SectionCard, LandingGreeting } from "./landingPrimitives";
import { useLocale } from "@/contexts/LocaleContext";

export default function OpsLanding({
  onNavigate,
}: {
  onNavigate: (pageId: string) => void;
}) {
  const { t } = useLocale();
  const stats = trpc.admin.getStats.useQuery(undefined, { refetchInterval: 60_000 });
  const recentMessages = trpc.agent.listMessages.useQuery(
    { agentName: "catalog" as any, limit: 8 },
    { refetchInterval: 30_000 }
  );

  const todayBookings = stats.data?.todayBookings ?? 0;
  const activeTours = stats.data?.activeTours ?? 0;
  const totalTours = stats.data?.totalTours ?? 0;
  const draftTours = Math.max(0, totalTours - activeTours);
  const pendingInquiries = stats.data?.pendingInquiries ?? 0;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <LandingGreeting
        title={t('admin.opsLanding.title')}
        subtitle={t('admin.opsLanding.subtitle', { activeTours, todayBookings, pendingInquiries })}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          icon={Map}
          label={t('admin.opsLanding.activeTours')}
          primary={activeTours}
          secondary={t('admin.opsLanding.draftPending', { n: draftTours })}
          accent="indigo"
          onClick={() => onNavigate("tours")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={Calendar}
          label={t('admin.opsLanding.todayBookings')}
          primary={todayBookings}
          secondary={t('admin.opsLanding.monthTotal', { n: stats.data?.totalBookings ?? 0 })}
          accent="emerald"
          onClick={() => onNavigate("bookings")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={AlertCircle}
          label={t('admin.opsLanding.pendingInquiries')}
          primary={pendingInquiries}
          secondary={pendingInquiries > 0 ? t('admin.opsLanding.awaitingReply') : t('admin.opsLanding.allProcessed')}
          accent={pendingInquiries > 0 ? "amber" : "emerald"}
          onClick={() => onNavigate("inquiries")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={Briefcase}
          label={t('admin.opsLanding.suppliers')}
          primary="Lion + UV"
          secondary={t('admin.opsLanding.catalogMirrorLive')}
          accent="sky"
          onClick={() => onNavigate("suppliers")}
        />
        <KpiCard
          icon={PlayCircle}
          label={t('admin.opsLanding.tourMonitor')}
          primary={t('admin.opsLanding.backgroundMonitor')}
          secondary={t('admin.opsLanding.detectPriceChanges')}
          accent="slate"
          onClick={() => onNavigate("tour-monitor")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
        <SectionCard
          title={t('admin.opsLanding.recentCatalogActions')}
          icon={Sparkles}
          iconTone="text-emerald-600"
          action={{ label: t('admin.opsLanding.viewCatalogChannel'), onClick: () => onNavigate("agent-chat") }}
        >
          {recentMessages.isLoading ? (
            <div className="text-xs text-foreground/40 py-3">{t('admin.opsLanding.loading')}</div>
          ) : (recentMessages.data ?? []).length === 0 ? (
            <div className="text-xs text-foreground/40 py-6 text-center">
              {t('admin.opsLanding.noCatalogActions')}
            </div>
          ) : (
            <div className="space-y-1.5">
              {(recentMessages.data ?? []).slice(0, 8).map((m: any) => {
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
                        m.priority === "high" || m.priority === "critical"
                          ? "bg-rose-500"
                          : m.readByJeff === 0
                            ? "bg-emerald-500"
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

        <SectionCard
          title={t('admin.opsLanding.quickActions')}
          icon={ClipboardList}
          iconTone="text-indigo-600"
        >
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("suppliers")}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              {t('admin.opsLanding.triggerSupplierSync')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("tours")}
            >
              <Map className="w-4 h-4 mr-2" />
              {t('admin.opsLanding.manageActiveTours')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("inquiries")}
            >
              <AlertCircle className="w-4 h-4 mr-2" />
              {t('admin.opsLanding.handlePendingInquiries')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("agent-chat")}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {t('admin.opsLanding.askOpsAgent')}
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
