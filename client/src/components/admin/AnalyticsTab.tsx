/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area
} from "recharts";
import {
  TrendingUp, ShoppingCart, DollarSign, MessageSquare,
  RefreshCw, Users, BarChart2
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

const COLORS = ['#1a1a1a', '#555555', '#888888', '#aaaaaa', '#cccccc', '#e5e5e5'];
const CATEGORY_COLORS = ['#0f172a', '#1e3a5f', '#2563eb', '#60a5fa', '#bfdbfe'];

function StatCard({ title, value, sub, icon: Icon, highlight = false }: {
  title: string;
  value: string;
  sub?: string;
  icon: any;
  highlight?: boolean;
}) {
  return (
    <div className={`border p-5 rounded-xl ${highlight ? 'border-black bg-black text-white' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start justify-between mb-3">
        <span className={`text-sm font-medium ${highlight ? 'text-gray-300' : 'text-gray-500'}`}>{title}</span>
        <Icon className={`h-4 w-4 ${highlight ? 'text-gray-400' : 'text-gray-400'}`} />
      </div>
      <div className={`text-2xl font-bold ${highlight ? 'text-white' : 'text-gray-900'}`}>{value}</div>
      {sub && <div className={`text-xs mt-1 ${highlight ? 'text-gray-400' : 'text-gray-500'}`}>{sub}</div>}
    </div>
  );
}

export default function AnalyticsTab() {
  const [days, setDays] = useState(30);
  const { t, language } = useLocale();

  const formatTWD = (amount: number) =>
    new Intl.NumberFormat(language === 'en' ? 'en-US' : 'zh-TW', { style: 'currency', currency: 'TWD', minimumFractionDigits: 0 }).format(amount);

  const { data: stats, isLoading: statsLoading } = trpc.admin.getStats.useQuery(undefined, { staleTime: 1000 * 60 * 2 });
  const { data: analytics, isLoading: analyticsLoading, refetch } = trpc.admin.getAnalytics.useQuery({ days }, { staleTime: 1000 * 60 * 5 });

  const isLoading = statsLoading || analyticsLoading;

  const bookingsLabel = t('admin.analyticsTab.legendBookings');
  const revenueLabel = t('admin.analyticsTab.legendRevenue');
  const tourCountLabel = t('admin.analyticsTab.legendTourCount');
  const inquiryCountLabel = t('admin.analyticsTab.legendInquiryCount');

  const bookingChartData = useMemo(() => {
    if (!analytics?.bookingTrend) return [];
    return analytics.bookingTrend.map((d: any) => ({
      date: d.date,
      [bookingsLabel]: d.bookings,
      [revenueLabel]: d.revenue,
    }));
  }, [analytics, bookingsLabel, revenueLabel]);

  const categoryPieData = useMemo(() => {
    if (!analytics?.tourCategoryDist) return [];
    return analytics.tourCategoryDist.filter((d: any) => d.value > 0);
  }, [analytics]);

  const inquiryPieData = useMemo(() => {
    if (!analytics?.inquiryStatusDist) return [];
    return analytics.inquiryStatusDist.filter((d: any) => d.value > 0);
  }, [analytics]);

  const topToursData = useMemo(() => {
    if (!analytics?.topTours) return [];
    return analytics.topTours.slice(0, 8).map((ts: any) => ({
      name: ts.title?.length > 16 ? ts.title.slice(0, 16) + '…' : ts.title,
      fullTitle: ts.title,
      [bookingsLabel]: ts.bookingCount,
      [revenueLabel]: ts.revenue,
    }));
  }, [analytics, bookingsLabel, revenueLabel]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400 mr-2" />
        <span className="text-gray-500">{t('admin.analyticsTab.loading')}</span>
      </div>
    );
  }

  const revenueGrowth = stats?.revenueGrowth ?? 0;
  const daysSuffix = t('admin.analyticsTab.daysSuffix');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('admin.analyticsTab.title')}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{t('admin.analyticsTab.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            {[7, 14, 30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  days === d ? 'bg-black text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {d}{daysSuffix}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="rounded-lg" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          title={t('admin.analyticsTab.statTotalBookings')}
          value={(stats?.totalBookings ?? 0).toLocaleString()}
          sub={t('admin.analyticsTab.statTotalBookingsSub', { n: String(stats?.todayBookings ?? 0) })}
          icon={ShoppingCart}
          highlight
        />
        <StatCard
          title={t('admin.analyticsTab.statMonthlyRevenue')}
          value={formatTWD(stats?.thisMonthRevenue ?? 0)}
          sub={t('admin.analyticsTab.statMonthlyRevenueSub', { sign: revenueGrowth >= 0 ? '+' : '', pct: revenueGrowth.toFixed(1) })}
          icon={DollarSign}
        />
        <StatCard
          title={t('admin.analyticsTab.statActiveTours')}
          value={(stats?.activeTours ?? 0).toString()}
          sub={t('admin.analyticsTab.statActiveToursSub', { n: String(stats?.totalTours ?? 0) })}
          icon={BarChart2}
        />
        <StatCard
          title={t('admin.analyticsTab.statPendingInquiries')}
          value={(stats?.pendingInquiries ?? 0).toString()}
          sub={t('admin.analyticsTab.statPendingInquiriesSub', { n: String(stats?.totalInquiries ?? 0) })}
          icon={MessageSquare}
        />
        <StatCard
          title={t('admin.analyticsTab.statTotalUsers')}
          value={(stats?.totalUsers ?? 0).toLocaleString()}
          sub={t('admin.analyticsTab.statTotalUsersSub')}
          icon={Users}
        />
        <StatCard
          title={t('admin.analyticsTab.statNewsletterSubs')}
          value={(stats?.totalSubscribers ?? 0).toLocaleString()}
          sub={t('admin.analyticsTab.statNewsletterSubsSub')}
          icon={TrendingUp}
        />
      </div>

      {/* Booking & Revenue Trend */}
      <div className="border border-gray-200 p-5 rounded-xl">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('admin.analyticsTab.chartBookingTrend', { days: String(days) })}</h3>
        {bookingChartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={bookingChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
              <Tooltip
                formatter={(v: any, name: string) => [
                  name === revenueLabel ? formatTWD(v) : v,
                  name
                ]}
              />
              <Legend />
              <Area yAxisId="right" type="monotone" dataKey={revenueLabel} fill="#e5e7eb" stroke="#9ca3af" strokeWidth={1.5} />
              <Bar yAxisId="left" dataKey={bookingsLabel} fill="#1a1a1a" barSize={6} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[260px] flex items-center justify-center text-gray-400 text-sm">
            {t('admin.analyticsTab.chartNoBookings', { days: String(days) })}
          </div>
        )}
      </div>

      {/* Category & Inquiry Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tour Category Distribution */}
        <div className="border border-gray-200 p-5 rounded-xl">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('admin.analyticsTab.chartCategoryDist')}</h3>
          {categoryPieData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie data={categoryPieData} cx="50%" cy="50%" outerRadius={75} dataKey="value" nameKey="name">
                    {categoryPieData.map((_: any, i: number) => (
                      <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => [v, tourCountLabel]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {categoryPieData.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-md" style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                      <span className="text-gray-700">{item.name}</span>
                    </div>
                    <span className="font-semibold text-gray-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-gray-400 text-sm">{t('admin.analyticsTab.chartNoTours')}</div>
          )}
        </div>

        {/* Inquiry Status Distribution */}
        <div className="border border-gray-200 p-5 rounded-xl">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('admin.analyticsTab.chartInquiryDist')}</h3>
          {inquiryPieData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie data={inquiryPieData} cx="50%" cy="50%" outerRadius={75} dataKey="value" nameKey="name">
                    {inquiryPieData.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => [v, inquiryCountLabel]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {inquiryPieData.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-md" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-gray-700">{item.name}</span>
                    </div>
                    <span className="font-semibold text-gray-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-gray-400 text-sm">{t('admin.analyticsTab.chartNoInquiries')}</div>
          )}
        </div>
      </div>

      {/* Top Tours by Bookings */}
      <div className="border border-gray-200 p-5 rounded-xl">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('admin.analyticsTab.chartTopTours')}</h3>
        {topToursData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={topToursData} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
              <Tooltip
                formatter={(v: any, name: string) => [
                  name === revenueLabel ? formatTWD(v) : v,
                  name
                ]}
                labelFormatter={(label: string) => {
                  const item = topToursData.find((ts: any) => ts.name === label);
                  return item?.fullTitle ?? label;
                }}
              />
              <Legend />
              <Bar dataKey={bookingsLabel} fill="#1a1a1a" barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[240px] flex items-center justify-center text-gray-400 text-sm">
            {t('admin.analyticsTab.chartNoBookingsGeneric')}
          </div>
        )}
      </div>

      {/* Top Tours Revenue Table */}
      {analytics?.topTours && analytics.topTours.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-700">{t('admin.analyticsTab.topToursTableTitle')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.analyticsTab.columnRank')}</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.analyticsTab.columnTourName')}</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.analyticsTab.columnBookings')}</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.analyticsTab.columnRevenue')}</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.analyticsTab.columnAvgPrice')}</th>
                </tr>
              </thead>
              <tbody>
                {analytics.topTours.map((tour: any, i: number) => (
                  <tr key={tour.tourId} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-500 font-medium">#{i + 1}</td>
                    <td className="px-4 py-2.5 text-gray-900 font-medium max-w-[300px] truncate">{tour.title}</td>
                    <td className="px-4 py-2.5 text-right text-gray-700">{tour.bookingCount}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{formatTWD(tour.revenue)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {tour.bookingCount > 0 ? formatTWD(Math.round(tour.revenue / tour.bookingCount)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
