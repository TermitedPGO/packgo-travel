import { trpc } from "@/lib/trpc";
import { Plane, ShoppingCart, MessageSquare, DollarSign, ArrowRight, AlertCircle, CheckCircle2, Clock, TrendingUp } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import DailyBriefingCard from "./DailyBriefingCard";
import BookingRiskCard from "./BookingRiskCard";

interface DashboardTabProps {
  onNavigate?: (tab: string) => void;
}

export default function DashboardTab({ onNavigate }: DashboardTabProps = {}) {
  const { data: statsData, isLoading } = trpc.admin.getStats.useQuery();
  const { t, language } = useLocale();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(language === 'en' ? 'en-US' : 'zh-TW', {
      style: 'currency',
      currency: 'TWD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const revenueGrowth = statsData?.revenueGrowth ?? 0;
  const revenueSign = revenueGrowth >= 0 ? '+' : '';

  // v78z-z3 Sprint 9: 6 stat cards → 1 monthly summary card per UX audit.
  // The 6 stats Jeff cannot act on (totalUsers / newsletterSubs / etc.) were
  // vanity metrics. Daily Briefing already shows actionable items.
  // The single card surfaces the 3 numbers that drive his daily decisions:
  // today's bookings, this month's revenue + growth, active tours.
  const newInquiries = statsData?.pendingInquiries || 0;
  const activeTours = statsData?.activeTours || 0;

  return (
    <div className="space-y-8">
      {/* v78i: Daily Briefing — actionable items at top, replaces empty stats first impression */}
      {onNavigate && <DailyBriefingCard onNavigate={onNavigate} />}

      {/* v78z-z3 Sprint 10 (C4): Booking Risk Card — surfaces 3 warning signals.
          Renders nothing if zero risks (saves visual noise). */}
      {onNavigate && <BookingRiskCard onNavigate={onNavigate} />}

      {/* Page Title */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{t('admin.dashboardTab.title')}</h2>
        <p className="text-sm text-gray-500 mt-1">{t('admin.dashboardTab.welcomeSubtitle')}</p>
      </div>

      {/* v78z-z3 Sprint 9: single monthly summary card replaces 6 vanity stat cards.
          Surfaces 3 actionable metrics: today's bookings · this month's revenue · active tours. */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 md:p-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 divide-y md:divide-y-0 md:divide-x divide-gray-100">
          <div className="md:pr-6">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              <ShoppingCart className="h-3.5 w-3.5" />
              {t('admin.dashboardTab.todayBookings')}
            </div>
            <p className="text-4xl font-bold text-gray-900 tabular-nums">
              {isLoading ? "—" : (statsData?.todayBookings ?? 0)}
            </p>
            <p className="text-xs text-gray-500 mt-1">{t('admin.dashboardTab.todayBookingsSub')}</p>
          </div>
          <div className="md:px-6 pt-6 md:pt-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              <DollarSign className="h-3.5 w-3.5" />
              {t('admin.dashboardTab.monthlyRevenue')}
            </div>
            <p className="text-4xl font-bold text-gray-900 tabular-nums">
              {isLoading ? "—" : formatCurrency(statsData?.thisMonthRevenue || 0)}
            </p>
            <p className={`text-xs mt-1 font-medium ${revenueGrowth >= 0 ? "text-green-600" : "text-red-600"}`}>
              {isLoading ? "" : t('admin.dashboardTab.monthlyRevenueSub', { sign: revenueSign, pct: revenueGrowth.toFixed(1) })}
            </p>
          </div>
          <div className="md:pl-6 pt-6 md:pt-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              <Plane className="h-3.5 w-3.5" />
              {t('admin.dashboardTab.activeTours')}
            </div>
            <p className="text-4xl font-bold text-gray-900 tabular-nums">
              {isLoading ? "—" : (statsData?.activeTours ?? 0)}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {isLoading ? "" : t('admin.dashboardTab.activeToursSub', { n: String(statsData?.totalTours || 0) })}
            </p>
          </div>
        </div>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Actions */}
        <div className="bg-white border border-gray-200 p-6 rounded-xl">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">{t('admin.dashboardTab.todoTitle')}</h3>
          <div className="space-y-3">
            {newInquiries > 0 ? (
              <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-900">{t('admin.dashboardTab.inquiriesPending', { n: String(newInquiries) })}</p>
                  <p className="text-xs text-amber-700">{t('admin.dashboardTab.inquiriesPendingHint')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-amber-600 flex-shrink-0" />
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                <p className="text-sm font-medium text-green-900">{t('admin.dashboardTab.inquiriesCleared')}</p>
              </div>
            )}
            <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <Clock className="h-5 w-5 text-gray-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{t('admin.dashboardTab.toursLiveStat', { active: String(activeTours) })}</p>
                <p className="text-xs text-gray-500">{t('admin.dashboardTab.toursTotal', { total: String(statsData?.totalTours || 0) })}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions — Round 80.9: tabs were dead, now wired through onNavigate */}
        <div className="bg-white border border-gray-200 p-6 rounded-xl">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">{t('admin.dashboardTab.quickActionsTitle')}</h3>
          <div className="space-y-2">
            {[
              { icon: Plane, label: t('admin.dashboardTab.quickAddTour'), desc: t('admin.dashboardTab.quickAddTourDesc'), tab: 'tours' },
              { icon: MessageSquare, label: t('admin.dashboardTab.quickViewInquiries'), desc: t('admin.dashboardTab.quickViewInquiriesDesc'), tab: 'inbox' },
              { icon: TrendingUp, label: t('admin.dashboardTab.quickViewReports'), desc: t('admin.dashboardTab.quickViewReportsDesc'), tab: 'analytics' },
            ].map((action, i) => {
              const Icon = action.icon;
              return (
                <button
                  key={i}
                  onClick={() => onNavigate?.(action.tab)}
                  disabled={!onNavigate}
                  className="w-full flex items-center gap-4 p-4 bg-white border border-gray-200 hover:border-foreground hover:bg-gray-50 transition-all text-left group rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Icon className="h-5 w-5 text-gray-400 group-hover:text-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{action.label}</p>
                    <p className="text-xs text-gray-500">{action.desc}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-foreground flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
