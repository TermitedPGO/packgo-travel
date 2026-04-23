/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import {
  DollarSign, Zap, Clock, TrendingUp, Database,
  RefreshCw, Activity
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

const COLORS = ['#1a1a1a', '#4a4a4a', '#7a7a7a', '#aaaaaa', '#cccccc', '#e5e5e5'];

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

export default function AiCostTab() {
  const [days, setDays] = useState(30);
  const { t, language } = useLocale();

  const { data, isLoading, refetch } = trpc.admin.getLlmStats.useQuery({ days }, {
    staleTime: 1000 * 60 * 5,
  });

  const costLabel = t('admin.aiCostTab.legendCost');
  const callsLabel = t('admin.aiCostTab.legendCalls');

  const dailyChartData = useMemo(() => {
    if (!data?.dailyCosts) return [];
    return data.dailyCosts.map((d: any) => ({
      date: d.date?.slice(5) ?? '', // MM-DD
      [costLabel]: parseFloat(d.costUsd),
      [callsLabel]: d.calls,
    }));
  }, [data, costLabel, callsLabel]);

  const agentPieData = useMemo(() => {
    if (!data?.agentCosts) return [];
    return data.agentCosts.slice(0, 6).map((a: any) => ({
      name: a.agentName.replace('Agent', '').replace('agent', ''),
      value: parseFloat(a.costUsd),
      calls: a.calls,
    }));
  }, [data]);

  const getTaskLabel = (taskType: string | null | undefined) => {
    const otherLabel = t('admin.aiCostTab.taskOther');
    if (!taskType) return otherLabel;
    switch (taskType) {
      case 'tour_generation': return t('admin.aiCostTab.taskTourGeneration');
      case 'ai_chat':
      case 'customer_service': return t('admin.aiCostTab.taskAiChat');
      case 'skill_learning': return t('admin.aiCostTab.taskSkillLearning');
      case 'translation': return t('admin.aiCostTab.taskTranslation');
      case 'pdf_parsing': return t('admin.aiCostTab.taskPdfParsing');
      case 'content_analysis': return t('admin.aiCostTab.taskContentAnalysis');
      case 'image_generation': return t('admin.aiCostTab.taskImageGeneration');
      case 'notice_generation': return t('admin.aiCostTab.taskNoticeGeneration');
      case 'meal_planning': return t('admin.aiCostTab.taskMealPlanning');
      case 'hotel_search': return t('admin.aiCostTab.taskHotelSearch');
      case 'flight_search': return t('admin.aiCostTab.taskFlightSearch');
      case 'train_search': return t('admin.aiCostTab.taskTrainSearch');
      case 'unknown': return otherLabel;
      default: return taskType;
    }
  };

  const taskBarData = useMemo(() => {
    if (!data?.taskTypeCosts) return [];
    return data.taskTypeCosts.slice(0, 8).map((ts: any) => ({
      name: getTaskLabel(ts.taskType),
      [costLabel]: parseFloat(ts.costUsd),
      Token: ts.tokens,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, costLabel, language]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400 mr-2" />
        <span className="text-gray-500">{t('admin.aiCostTab.loading')}</span>
      </div>
    );
  }

  const totals = data?.totals;
  const daysSuffix = t('admin.aiCostTab.daysSuffix');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('admin.aiCostTab.title')}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{t('admin.aiCostTab.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Days selector */}
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          title={t('admin.aiCostTab.statTotalCost')}
          value={`$${totals?.totalCostUsd ?? '0.0000'}`}
          sub={t('admin.aiCostTab.statTotalCostSub', { days: String(days) })}
          icon={DollarSign}
          highlight
        />
        <StatCard
          title={t('admin.aiCostTab.statTotalCalls')}
          value={totals?.totalCalls?.toLocaleString() ?? '0'}
          sub={t('admin.aiCostTab.statTotalCallsSub')}
          icon={Activity}
        />
        <StatCard
          title={t('admin.aiCostTab.statTotalTokens')}
          value={totals?.totalTokens ? (totals.totalTokens / 1000).toFixed(1) + 'K' : '0'}
          sub={t('admin.aiCostTab.statTotalTokensSub')}
          icon={Zap}
        />
        <StatCard
          title={t('admin.aiCostTab.statCacheHit')}
          value={`${totals?.cacheHitRate ?? '0.0'}%`}
          sub={t('admin.aiCostTab.statCacheHitSub', { n: String(totals?.cachedCalls ?? 0) })}
          icon={Database}
        />
        <StatCard
          title={t('admin.aiCostTab.statAvgTime')}
          value={totals?.avgProcessingMs ? `${(totals.avgProcessingMs / 1000).toFixed(1)}s` : '0s'}
          sub={t('admin.aiCostTab.statAvgTimeSub')}
          icon={Clock}
        />
        <StatCard
          title={t('admin.aiCostTab.statAvgCost')}
          value={totals?.totalCalls && totals?.totalCostUsd
            ? `$${(parseFloat(totals.totalCostUsd) / totals.totalCalls).toFixed(5)}`
            : '$0.00000'}
          sub={t('admin.aiCostTab.statAvgCostSub')}
          icon={TrendingUp}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Daily Cost Trend */}
        <div className="lg:col-span-2 border border-gray-200 p-4 rounded-xl">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('admin.aiCostTab.chartDailyCost')}</h3>
          {dailyChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                <Tooltip formatter={(v: any) => [`$${v}`, costLabel]} />
                <Line type="monotone" dataKey={costLabel} stroke="#1a1a1a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
              {t('admin.aiCostTab.chartNoDataDays', { days: String(days) })}
            </div>
          )}
        </div>

        {/* Agent Cost Pie */}
        <div className="border border-gray-200 p-4 rounded-xl">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('admin.aiCostTab.chartAgentPie')}</h3>
          {agentPieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={agentPieData} cx="50%" cy="50%" outerRadius={70} dataKey="value">
                    {agentPieData.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`$${v}`, costLabel]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2">
                {agentPieData.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-gray-600 truncate max-w-[100px]">{item.name}</span>
                    </div>
                    <span className="text-gray-800 font-medium">${item.value.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
              {t('admin.aiCostTab.chartNoData')}
            </div>
          )}
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="border border-gray-200 p-4 rounded-xl">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('admin.aiCostTab.chartTaskBar')}</h3>
        {taskBarData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={taskBarData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
              <Tooltip formatter={(v: any, name: string) => [name === costLabel ? `$${v}` : v.toLocaleString(), name]} />
              <Bar dataKey={costLabel} fill="#1a1a1a" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">
            {t('admin.aiCostTab.chartNoData')}
          </div>
        )}
      </div>

      {/* Recent Logs Table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">{t('admin.aiCostTab.recentLogsTitle')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.aiCostTab.columnTime')}</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.aiCostTab.columnAgent')}</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.aiCostTab.columnTaskType')}</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.aiCostTab.columnModel')}</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.aiCostTab.columnInput')}</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.aiCostTab.columnOutput')}</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.aiCostTab.columnCost')}</th>
                <th className="text-center px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.aiCostTab.columnCache')}</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">{t('admin.aiCostTab.columnDuration')}</th>
              </tr>
            </thead>
            <tbody>
              {data?.recentLogs?.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-gray-400">{t('admin.aiCostTab.noLogs')}</td>
                </tr>
              ) : (
                data?.recentLogs?.map((log: any) => (
                  <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap text-xs">
                      {new Date(log.createdAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2 text-gray-700 max-w-[120px] truncate">
                      {log.agentName.replace('Agent', '').replace('agent', '')}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className="rounded-lg text-xs font-normal">
                        {getTaskLabel(log.taskType) ?? '-'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{log.model?.split('-').slice(-2).join('-')}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{log.inputTokens?.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{log.outputTokens?.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-medium text-gray-900">
                      ${parseFloat(log.estimatedCostUsd ?? '0').toFixed(5)}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {log.wasFromCache ? (
                        <Badge className="rounded-lg bg-green-100 text-green-700 text-xs">{t('admin.aiCostTab.cacheLabel')}</Badge>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500 text-xs">
                      {log.processingTimeMs ? `${(log.processingTimeMs / 1000).toFixed(1)}s` : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
