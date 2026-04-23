/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Clock,
  Zap, DollarSign, ChevronDown, ChevronRight, FileText, Bot
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

// Agent avatar color based on name
function agentColor(name: string | null): string {
  const colors = [
    "bg-blue-100 text-blue-700",
    "bg-purple-100 text-purple-700",
    "bg-green-100 text-green-700",
    "bg-orange-100 text-orange-700",
    "bg-pink-100 text-pink-700",
    "bg-cyan-100 text-cyan-700",
  ];
  if (!name) return colors[0];
  const idx = name.charCodeAt(0) % colors.length;
  return colors[idx];
}

function AgentCard({ group }: { group: any }) {
  const [expanded, setExpanded] = useState(false);
  const { t, language } = useLocale();

  const TASK_LABELS = useMemo<Record<string, string>>(() => ({
    tour_generation: t('admin.aiSessionReport.taskTourGeneration'),
    ai_chat: t('admin.aiSessionReport.taskAiChat'),
    skill_learning: t('admin.aiSessionReport.taskSkillLearning'),
    translation: t('admin.aiSessionReport.taskTranslation'),
    image_analysis: t('admin.aiSessionReport.taskImageAnalysis'),
    data_extraction: t('admin.aiSessionReport.taskDataExtraction'),
    cost_analysis: t('admin.aiSessionReport.taskCostAnalysis'),
    itinerary: t('admin.aiSessionReport.taskItinerary'),
    content_analysis: t('admin.aiSessionReport.taskContentAnalysis'),
  }), [t]);

  const AGENT_DISPLAY = useMemo<Record<string, string>>(() => ({
    "ClaudeAgent": t('admin.aiSessionReport.agentClaude'),
    "MasterAgent": t('admin.aiSessionReport.agentMaster'),
    "ItineraryAgent": t('admin.aiSessionReport.agentItinerary'),
    "ItineraryUnifiedAgent": t('admin.aiSessionReport.agentItineraryUnified'),
    "CostAgent": t('admin.aiSessionReport.agentCost'),
    "ContentAnalyzerAgent": t('admin.aiSessionReport.agentContentAnalyzer'),
    "TranslationAgent": t('admin.aiSessionReport.agentTranslation'),
    "TranslateAgent": t('admin.aiSessionReport.agentTranslation'),
  }), [t]);

  const agentDisplayName = (name: string | null): string => {
    if (!name) return t('admin.aiSessionReport.unknownAgent');
    return AGENT_DISPLAY[name] ?? name.replace(/Agent$/i, " Agent");
  };

  const taskLabel = (type: string | null): string | null => {
    if (!type) return null;
    return TASK_LABELS[type] ?? type;
  };

  const totalCost = group.logs?.reduce(
    (sum: number, l: any) => sum + parseFloat(l.estimatedCostUsd ?? "0"), 0
  ) ?? 0;
  const totalTokens = group.logs?.reduce(
    (sum: number, l: any) => sum + (l.inputTokens ?? 0) + (l.outputTokens ?? 0), 0
  ) ?? 0;
  const totalMs = group.logs?.reduce(
    (sum: number, l: any) => sum + (l.processingTimeMs ?? 0), 0
  ) ?? 0;

  // Get unique task types for this agent
  const taskTypes = Array.from(new Set(
    (group.logs ?? []).map((l: any) => l.taskType).filter(Boolean)
  )) as string[];

  // Most recent log time
  const latestTime = group.logs?.reduce((latest: number, l: any) => {
    const ts = new Date(l.createdAt).getTime();
    return ts > latest ? ts : latest;
  }, 0) ?? 0;

  const displayName = agentDisplayName(group.agentName);
  const colorClass = agentColor(group.agentName);
  const initials = displayName.slice(0, 2);
  const localeArg = language === 'en' ? 'en-US' : 'zh-TW';

  return (
    <div className="border border-gray-200 bg-white rounded-xl overflow-hidden">
      {/* Card Header */}
      <button
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="shrink-0">
          {expanded
            ? <ChevronDown className="h-4 w-4 text-gray-400" />
            : <ChevronRight className="h-4 w-4 text-gray-400" />
          }
        </div>

        {/* Agent avatar */}
        <div className={`shrink-0 w-9 h-9 flex items-center justify-center text-xs font-bold rounded-lg ${colorClass}`}>
          {initials}
        </div>

        {/* Agent name + task types */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm">
              {displayName}
            </span>
            <Badge variant="outline" className="text-xs font-normal rounded-md border-gray-300">
              {t('admin.aiSessionReport.callCount', { n: String(group.logs?.length ?? 0) })}
            </Badge>
            {taskTypes.slice(0, 3).map((type: string, i: number) => (
              <span key={i} className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 border border-blue-100 rounded-md">
                {taskLabel(type) ?? type}
              </span>
            ))}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {t('admin.aiSessionReport.lastActivity')}{latestTime ? new Date(latestTime).toLocaleString(localeArg, {
              month: "2-digit", day: "2-digit",
              hour: "2-digit", minute: "2-digit"
            }) : "—"}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-5 text-xs text-gray-600 shrink-0">
          <div className="flex items-center gap-1">
            <Zap className="h-3.5 w-3.5 text-gray-400" />
            {(totalTokens / 1000).toFixed(1)}K tokens
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-gray-400" />
            {(totalMs / 1000).toFixed(1)}s
          </div>
          <div className="flex items-center gap-1 font-medium text-gray-900">
            <DollarSign className="h-3.5 w-3.5 text-gray-400" />
            ${totalCost.toFixed(5)}
          </div>
        </div>
      </button>

      {/* Expanded: per-call log rows */}
      {expanded && (
        <div className="border-t border-gray-100">
          {/* Summary banner */}
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-gray-500" />
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{t('admin.aiSessionReport.summarySectionTitle')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-gray-400">{t('admin.aiSessionReport.summaryAgentName')}</div>
                <div className="font-medium text-gray-800">{displayName}</div>
              </div>
              <div>
                <div className="text-gray-400">{t('admin.aiSessionReport.summaryTaskTypes')}</div>
                <div className="font-medium text-gray-800">
                  {taskTypes.length > 0 ? taskTypes.map(ty => taskLabel(ty) ?? ty).join(language === 'en' ? ', ' : "、") : "—"}
                </div>
              </div>
              <div>
                <div className="text-gray-400">{t('admin.aiSessionReport.summaryTotalTokens')}</div>
                <div className="font-medium text-gray-800">{totalTokens.toLocaleString()} tokens</div>
              </div>
              <div>
                <div className="text-gray-400">{t('admin.aiSessionReport.summaryTotalCost')}</div>
                <div className="font-medium text-gray-800">${totalCost.toFixed(5)}</div>
              </div>
              <div>
                <div className="text-gray-400">{t('admin.aiSessionReport.summaryTotalTime')}</div>
                <div className="font-medium text-gray-800">{t('admin.aiSessionReport.summaryElapsedValue', { n: (totalMs / 1000).toFixed(1) })}</div>
              </div>
              <div>
                <div className="text-gray-400">{t('admin.aiSessionReport.summaryCallCount')}</div>
                <div className="font-medium text-gray-800">{t('admin.aiSessionReport.summaryCallCountValue', { n: String(group.logs?.length ?? 0) })}</div>
              </div>
              <div>
                <div className="text-gray-400">{t('admin.aiSessionReport.summaryCacheHits')}</div>
                <div className="font-medium text-gray-800">
                  {t('admin.aiSessionReport.summaryCacheHitsValue', { n: String(group.logs?.filter((l: any) => l.wasFromCache).length ?? 0) })}
                </div>
              </div>
              <div>
                <div className="text-gray-400">{t('admin.aiSessionReport.summarySuccessRate')}</div>
                <div className="font-medium text-gray-800">
                  {group.logs?.length
                    ? `${Math.round((group.logs.filter((l: any) => l.success !== false).length / group.logs.length) * 100)}%`
                    : "—"
                  }
                </div>
              </div>
            </div>
          </div>

          {/* Per-call detail rows - sorted newest first */}
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-white">
                <th className="text-left px-5 py-2 text-gray-400 font-medium uppercase tracking-wide">{t('admin.aiSessionReport.tableTime')}</th>
                <th className="text-left px-3 py-2 text-gray-400 font-medium uppercase tracking-wide">{t('admin.aiSessionReport.tableTaskType')}</th>
                <th className="text-left px-3 py-2 text-gray-400 font-medium uppercase tracking-wide">{t('admin.aiSessionReport.tableModel')}</th>
                <th className="text-right px-3 py-2 text-gray-400 font-medium uppercase tracking-wide">{t('admin.aiSessionReport.tableInput')}</th>
                <th className="text-right px-3 py-2 text-gray-400 font-medium uppercase tracking-wide">{t('admin.aiSessionReport.tableOutput')}</th>
                <th className="text-right px-3 py-2 text-gray-400 font-medium uppercase tracking-wide">{t('admin.aiSessionReport.tableCost')}</th>
                <th className="text-center px-3 py-2 text-gray-400 font-medium uppercase tracking-wide">{t('admin.aiSessionReport.tableCache')}</th>
                <th className="text-right px-3 py-2 text-gray-400 font-medium uppercase tracking-wide">{t('admin.aiSessionReport.tableElapsed')}</th>
              </tr>
            </thead>
            <tbody>
              {[...(group.logs ?? [])].sort(
                (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              ).map((log: any, i: number) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-2 text-gray-500">
                    {new Date(log.createdAt).toLocaleString(localeArg, {
                      month: "2-digit", day: "2-digit",
                      hour: "2-digit", minute: "2-digit"
                    })}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {taskLabel(log.taskType) ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    {log.model?.split("-").slice(-2).join("-") ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">
                    {log.inputTokens?.toLocaleString() ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">
                    {log.outputTokens?.toLocaleString() ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">
                    ${parseFloat(log.estimatedCostUsd ?? "0").toFixed(5)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {log.wasFromCache
                      ? <span className="text-green-600 font-medium">✓</span>
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500">
                    {log.processingTimeMs ? `${(log.processingTimeMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AiSessionReport() {
  const [days, setDays] = useState(7);
  const { t } = useLocale();

  const { data, isLoading, refetch } = trpc.admin.getLlmStats.useQuery({ days }, {
    staleTime: 1000 * 60 * 5,
  });

  // Group logs by Agent name, sorted by most recent activity
  const agentGroups = (() => {
    if (!data?.recentLogs?.length) return [];
    const agentMap = new Map<string, any>();
    for (const log of data.recentLogs) {
      const agentKey = (log as any).agentName ?? "unknown";
      if (!agentMap.has(agentKey)) {
        agentMap.set(agentKey, {
          agentName: agentKey,
          logs: [],
          lastTime: 0,
        });
      }
      const group = agentMap.get(agentKey)!;
      group.logs.push(log);
      const logTime = new Date((log as any).createdAt).getTime();
      if (logTime > group.lastTime) group.lastTime = logTime;
    }
    // Sort by most recent activity
    return Array.from(agentMap.values()).sort((a, b) => b.lastTime - a.lastTime);
  })();

  const daysSuffix = t('admin.aiSessionReport.daysSuffix');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-gray-900">{t('admin.aiSessionReport.title')}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {t('admin.aiSessionReport.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            {[3, 7, 14, 30].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  days === d ? "bg-black text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {d}{daysSuffix}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="rounded-lg border-gray-200" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Agent group list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" />
          {t('admin.aiSessionReport.loading')}
        </div>
      ) : agentGroups.length === 0 ? (
        <div className="border border-dashed border-gray-200 py-16 text-center rounded-xl">
          <Bot className="h-8 w-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">{t('admin.aiSessionReport.emptyTitle', { days: String(days) })}</p>
          <p className="text-xs text-gray-300 mt-1">{t('admin.aiSessionReport.emptyDesc')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {agentGroups.map((group, i) => (
            <AgentCard key={i} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}
