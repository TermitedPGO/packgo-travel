import { trpc } from "@/lib/trpc";
import { Users, Plane, ShoppingCart, MessageSquare, DollarSign, TrendingUp, ArrowRight, AlertCircle, CheckCircle2, Clock, Mail } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

export default function DashboardTab() {
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

  const stats = [
    {
      title: t('admin.dashboardTab.todayBookings'),
      value: isLoading ? "—" : (statsData?.todayBookings ?? 0).toString(),
      sub: t('admin.dashboardTab.todayBookingsSub'),
      icon: ShoppingCart,
      accent: "text-gray-900",
    },
    {
      title: t('admin.dashboardTab.monthlyRevenue'),
      value: isLoading ? "—" : formatCurrency(statsData?.thisMonthRevenue || 0),
      sub: isLoading ? "" : t('admin.dashboardTab.monthlyRevenueSub', { sign: revenueSign, pct: revenueGrowth.toFixed(1) }),
      icon: DollarSign,
      accent: revenueGrowth >= 0 ? "text-green-600" : "text-red-600",
    },
    {
      title: t('admin.dashboardTab.pendingInquiries'),
      value: isLoading ? "—" : (statsData?.pendingInquiries ?? 0).toString(),
      sub: isLoading ? "" : t('admin.dashboardTab.pendingInquiriesSub', { n: String(statsData?.totalInquiries || 0) }),
      icon: MessageSquare,
      accent: (statsData?.pendingInquiries ?? 0) > 0 ? "text-amber-600" : "text-gray-500",
    },
    {
      title: t('admin.dashboardTab.activeTours'),
      value: isLoading ? "—" : (statsData?.activeTours ?? 0).toString(),
      sub: isLoading ? "" : t('admin.dashboardTab.activeToursSub', { n: String(statsData?.totalTours || 0) }),
      icon: Plane,
      accent: "text-gray-900",
    },
    {
      title: t('admin.dashboardTab.totalUsers'),
      value: isLoading ? "—" : (statsData?.totalUsers ?? 0).toLocaleString(),
      sub: t('admin.dashboardTab.totalUsersSub'),
      icon: Users,
      accent: "text-gray-900",
    },
    {
      title: t('admin.dashboardTab.newsletterSubs'),
      value: isLoading ? "—" : (statsData?.totalSubscribers ?? 0).toLocaleString(),
      sub: t('admin.dashboardTab.newsletterSubsSub'),
      icon: Mail,
      accent: "text-gray-900",
    },
  ];

  const newInquiries = statsData?.pendingInquiries || 0;
  const activeTours = statsData?.activeTours || 0;

  return (
    <div className="space-y-8">
      {/* Page Title */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{t('admin.dashboardTab.title')}</h2>
        <p className="text-sm text-gray-500 mt-1">{t('admin.dashboardTab.welcomeSubtitle')}</p>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <div
              key={index}
              className="bg-white border border-gray-200 p-6 rounded-xl"
            >
              <div className="flex items-start justify-between mb-4">
                <p className="text-sm text-gray-500 font-medium">{stat.title}</p>
                <Icon className="h-5 w-5 text-gray-300" />
              </div>
              <p className="text-3xl font-bold text-gray-900 mb-1">{stat.value}</p>
              <p className={`text-xs font-medium ${stat.accent}`}>{stat.sub}</p>
            </div>
          );
        })}
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

        {/* Quick Actions */}
        <div className="bg-white border border-gray-200 p-6 rounded-xl">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">{t('admin.dashboardTab.quickActionsTitle')}</h3>
          <div className="space-y-2">
            {[
              { icon: Plane, label: t('admin.dashboardTab.quickAddTour'), desc: t('admin.dashboardTab.quickAddTourDesc') },
              { icon: MessageSquare, label: t('admin.dashboardTab.quickViewInquiries'), desc: t('admin.dashboardTab.quickViewInquiriesDesc') },
              { icon: TrendingUp, label: t('admin.dashboardTab.quickViewReports'), desc: t('admin.dashboardTab.quickViewReportsDesc') },
            ].map((action, i) => {
              const Icon = action.icon;
              return (
                <button
                  key={i}
                  className="w-full flex items-center gap-4 p-4 bg-white border border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-all text-left group rounded-lg"
                >
                  <Icon className="h-5 w-5 text-gray-400 group-hover:text-gray-700 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{action.label}</p>
                    <p className="text-xs text-gray-500">{action.desc}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-gray-600 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
