/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  DollarSign, Zap, Clock, TrendingUp, Database,
  RefreshCw, ChevronDown, Activity
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
    <div className={`border p-5 ${highlight ? 'border-black bg-black text-white' : 'border-gray-200 bg-white'}`}>
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
  const { t } = useLocale();

  const { data, isLoading, refetch } = trpc.admin.getLlmStats.useQuery({ days }, {
    staleTime: 1000 * 60 * 5,
  });

  const dailyChartData = useMemo(() => {
    if (!data?.dailyCosts) return [];
    return data.dailyCosts.map((d: any) => ({
      date: d.date?.slice(5) ?? '', // MM-DD
      費用: parseFloat(d.costUsd),
      呼叫次數: d.calls,
    }));
  }, [data]);

  const agentPieData = useMemo(() => {
    if (!data?.agentCosts) return [];
    return data.agentCosts.slice(0, 6).map((a: any) => ({
      name: a.agentName.replace('Agent', '').replace('agent', ''),
      value: parseFloat(a.costUsd),
      calls: a.calls,
    }));
  }, [data]);

  const taskBarData = useMemo(() => {
    if (!data?.taskTypeCosts) return [];
    return data.taskTypeCosts.slice(0, 8).map((t: any) => ({
      name: t.taskType === 'tour_generation' ? '行程生成'
        : t.taskType === 'ai_chat' ? 'AI 諮詢'
        : t.taskType === 'customer_service' ? 'AI 諮詢'
        : t.taskType === 'skill_learning' ? '技能學習'
        : t.taskType === 'translation' ? '翻譯'
        : t.taskType === 'pdf_parsing' ? 'PDF 解析'
        : t.taskType === 'content_analysis' ? '內容分析'
        : t.taskType === 'image_generation' ? '圖片生成'
        : t.taskType === 'notice_generation' ? '注意事項'
        : t.taskType === 'meal_planning' ? '餐飲規劃'
        : t.taskType === 'hotel_search' ? '飯店搜尋'
        : t.taskType === 'flight_search' ? '機票搜尋'
        : t.taskType === 'train_search' ? '火車搜尋'
        : t.taskType === 'unknown' ? '其他'
        : (t.taskType ?? '其他'),
      費用: parseFloat(t.costUsd),
      Token: t.tokens,
    }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400 mr-2" />
        <span className="text-gray-500">載入中...</span>
      </div>
    );
  }

  const totals = data?.totals;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">AI 成本分析</h2>
          <p className="text-sm text-gray-500 mt-0.5">監控 AI 模型的 token 用量與費用</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Days selector */}
          <div className="flex border border-gray-200">
            {[7, 14, 30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  days === d ? 'bg-black text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {d}天
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
          title="總費用 (USD)"
          value={`$${totals?.totalCostUsd ?? '0.0000'}`}
          sub={`近 ${days} 天`}
          icon={DollarSign}
          highlight
        />
        <StatCard
          title="API 呼叫次數"
          value={totals?.totalCalls?.toLocaleString() ?? '0'}
          sub="次"
          icon={Activity}
        />
        <StatCard
          title="總 Token 用量"
          value={totals?.totalTokens ? (totals.totalTokens / 1000).toFixed(1) + 'K' : '0'}
          sub="tokens"
          icon={Zap}
        />
        <StatCard
          title="快取命中率"
          value={`${totals?.cacheHitRate ?? '0.0'}%`}
          sub={`${totals?.cachedCalls ?? 0} 次快取`}
          icon={Database}
        />
        <StatCard
          title="平均回應時間"
          value={totals?.avgProcessingMs ? `${(totals.avgProcessingMs / 1000).toFixed(1)}s` : '0s'}
          sub="每次呼叫"
          icon={Clock}
        />
        <StatCard
          title="平均每次費用"
          value={totals?.totalCalls && totals?.totalCostUsd
            ? `$${(parseFloat(totals.totalCostUsd) / totals.totalCalls).toFixed(5)}`
            : '$0.00000'}
          sub="USD/次"
          icon={TrendingUp}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Daily Cost Trend */}
        <div className="lg:col-span-2 border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">每日費用趨勢 (USD)</h3>
          {dailyChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                <Tooltip formatter={(v: any) => [`$${v}`, '費用']} />
                <Line type="monotone" dataKey="費用" stroke="#1a1a1a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
              近 {days} 天無資料
            </div>
          )}
        </div>

        {/* Agent Cost Pie */}
        <div className="border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">各 Agent 費用佔比</h3>
          {agentPieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={agentPieData} cx="50%" cy="50%" outerRadius={70} dataKey="value">
                    {agentPieData.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`$${v}`, '費用']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2">
                {agentPieData.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-gray-600 truncate max-w-[100px]">{item.name}</span>
                    </div>
                    <span className="text-gray-800 font-medium">${item.value.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
              無資料
            </div>
          )}
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">各任務類型費用分佈</h3>
        {taskBarData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={taskBarData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
              <Tooltip formatter={(v: any, name: string) => [name === '費用' ? `$${v}` : v.toLocaleString(), name]} />
              <Bar dataKey="費用" fill="#1a1a1a" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">
            無資料
          </div>
        )}
      </div>

      {/* Recent Logs Table */}
      <div className="border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">最近 50 筆 API 呼叫記錄</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">時間</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Agent</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">任務類型</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">模型</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Input</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Output</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">費用</th>
                <th className="text-center px-4 py-2 text-xs font-medium text-gray-500 uppercase">快取</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">耗時</th>
              </tr>
            </thead>
            <tbody>
              {data?.recentLogs?.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-gray-400">無記錄</td>
                </tr>
              ) : (
                data?.recentLogs?.map((log: any) => (
                  <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap text-xs">
                      {new Date(log.createdAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2 text-gray-700 max-w-[120px] truncate">
                      {log.agentName.replace('Agent', '').replace('agent', '')}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className="rounded-lg text-xs font-normal">
                        {log.taskType ?? '-'}
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
                        <Badge className="rounded-lg bg-green-100 text-green-700 text-xs">快取</Badge>
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
