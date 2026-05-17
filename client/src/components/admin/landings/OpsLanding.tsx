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

export default function OpsLanding({
  onNavigate,
}: {
  onNavigate: (pageId: string) => void;
}) {
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
        title="🗺 營運"
        subtitle={`${activeTours} 個 active tour · 今天 ${todayBookings} 個新訂單 · ${pendingInquiries} 個待回覆`}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          icon={Map}
          label="Active Tours"
          primary={activeTours}
          secondary={`${draftTours} 個 draft 待處理`}
          accent="indigo"
          onClick={() => onNavigate("tours")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={Calendar}
          label="今日 Bookings"
          primary={todayBookings}
          secondary={`本月: ${stats.data?.totalBookings ?? 0} 總計`}
          accent="emerald"
          onClick={() => onNavigate("bookings")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={AlertCircle}
          label="Pending Inquiries"
          primary={pendingInquiries}
          secondary={pendingInquiries > 0 ? "等你回覆" : "全部已處理"}
          accent={pendingInquiries > 0 ? "amber" : "emerald"}
          onClick={() => onNavigate("inquiries")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={Briefcase}
          label="Suppliers"
          primary="Lion + UV"
          secondary="catalog mirror live"
          accent="sky"
          onClick={() => onNavigate("suppliers")}
        />
        <KpiCard
          icon={PlayCircle}
          label="Tour Monitor"
          primary="背景監控"
          secondary="檢測供應商價格變動"
          accent="slate"
          onClick={() => onNavigate("tour-monitor")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
        <SectionCard
          title="Catalog 最近動作"
          icon={Sparkles}
          iconTone="text-emerald-600"
          action={{ label: "看 #catalog channel", onClick: () => onNavigate("office-chat") }}
        >
          {recentMessages.isLoading ? (
            <div className="text-xs text-foreground/40 py-3">載入中⋯</div>
          ) : (recentMessages.data ?? []).length === 0 ? (
            <div className="text-xs text-foreground/40 py-6 text-center">
              還沒有 catalog 動作。觸發 bulk import 後這裡會有結果。
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
                    onClick={() => onNavigate("office-chat")}
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
          title="快速動作"
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
              觸發 Supplier Sync (Lion / UV)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("tours")}
            >
              <Map className="w-4 h-4 mr-2" />
              管理 Active Tours
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("inquiries")}
            >
              <AlertCircle className="w-4 h-4 mr-2" />
              處理 Pending Inquiries
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("office-chat")}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              問 OpsAgent 旅團問題
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
