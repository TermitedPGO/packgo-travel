import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Bot,
  ListChecks,
  AlertTriangle,
  Timer,
  RefreshCw,
  Filter,
  ChevronRight as ExpandIcon,
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

type StatusType = "started" | "completed" | "failed" | "idle";

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export default function TaskHistoryContent() {
  const [page, setPage] = useState(1);
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { t, language } = useLocale();

  const STATUS_CONFIG = useMemo<Record<StatusType, { label: string; color: string; icon: React.ReactNode }>>(() => ({
    completed: {
      label: t('admin.taskHistory.statusCompleted'),
      color: "bg-green-100 text-green-700 border-green-200",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
    failed: {
      label: t('admin.taskHistory.statusFailed'),
      color: "bg-red-100 text-red-700 border-red-200",
      icon: <XCircle className="h-3.5 w-3.5" />,
    },
    started: {
      label: t('admin.taskHistory.statusStarted'),
      color: "bg-blue-100 text-blue-700 border-blue-200",
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    },
    idle: {
      label: t('admin.taskHistory.statusIdle'),
      color: "bg-gray-100 text-gray-600 border-gray-200",
      icon: <Clock className="h-3.5 w-3.5" />,
    },
  }), [t]);

  const AGENT_NAME_MAP = useMemo<Record<string, string>>(() => ({
    MasterAgent: t('admin.taskHistory.agentMaster'),
    ItineraryAgent: t('admin.taskHistory.agentItinerary'),
    ContentAnalyzerAgent: t('admin.taskHistory.agentContentAnalyzer'),
    ImageSearchAgent: t('admin.taskHistory.agentImageSearch'),
    TranslationAgent: t('admin.taskHistory.agentTranslation'),
    SkillLearnerAgent: t('admin.taskHistory.agentSkillLearner'),
    ClaudeAgent: t('admin.taskHistory.agentClaude'),
    ExchangeRateAgent: t('admin.taskHistory.agentExchangeRate'),
  }), [t]);

  const formatDateTime = (date: Date | string | null | undefined): string => {
    if (!date) return "—";
    return new Date(date).toLocaleString(language === 'en' ? 'en-US' : 'zh-TW', {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getAgentDisplayName = (name: string): string => {
    return AGENT_NAME_MAP[name] || name;
  };

  const { data, isLoading, refetch, isFetching } = (trpc as any).admin.getTaskHistory.useQuery(
    {
      page,
      limit: 30,
      agentName: agentFilter || undefined,
      status: (statusFilter as StatusType) || undefined,
    },
    { refetchInterval: 30000 }
  );

  const handleFilterChange = () => {
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            {t('admin.taskHistory.title')}
          </h2>
          <p className="text-gray-500 mt-0.5 text-sm">{t('admin.taskHistory.subtitle')}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-lg"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          {t('admin.taskHistory.refreshButton')}
        </Button>
      </div>

      {/* Summary Stats */}
      {data?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-50 rounded-xl p-3 sm:p-4 border border-gray-100">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <Bot className="h-3.5 w-3.5" />
              {t('admin.taskHistory.statTotalTasks')}
            </div>
            <div className="text-xl sm:text-2xl font-bold text-gray-900">
              {data.summary.totalTasks.toLocaleString()}
            </div>
          </div>
          <div className="bg-green-50 rounded-xl p-3 sm:p-4 border border-green-100">
            <div className="flex items-center gap-2 text-green-600 text-xs mb-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('admin.taskHistory.statCompleted')}
            </div>
            <div className="text-xl sm:text-2xl font-bold text-green-700">
              {data.summary.completedTasks.toLocaleString()}
            </div>
          </div>
          <div className="bg-red-50 rounded-xl p-3 sm:p-4 border border-red-100">
            <div className="flex items-center gap-2 text-red-600 text-xs mb-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('admin.taskHistory.statFailed')}
            </div>
            <div className="text-xl sm:text-2xl font-bold text-red-700">
              {data.summary.failedTasks.toLocaleString()}
            </div>
          </div>
          <div className="bg-blue-50 rounded-xl p-3 sm:p-4 border border-blue-100">
            <div className="flex items-center gap-2 text-blue-600 text-xs mb-1">
              <Timer className="h-3.5 w-3.5" />
              {t('admin.taskHistory.statAvgTime')}
            </div>
            <div className="text-xl sm:text-2xl font-bold text-blue-700">
              {formatDuration(data.summary.avgProcessingMs)}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Filter className="h-4 w-4" />
          {t('admin.taskHistory.filterLabel')}
        </div>
        <Select
          value={statusFilter || "all"}
          onValueChange={(v) => { setStatusFilter(v === "all" ? "" : v); handleFilterChange(); }}
        >
          <SelectTrigger className="w-full sm:w-36 h-9 text-sm rounded-lg">
            <SelectValue placeholder={t('admin.taskHistory.filterAllStatus')} />
          </SelectTrigger>
          <SelectContent className="rounded-lg">
            <SelectItem value="all">{t('admin.taskHistory.filterAllStatus')}</SelectItem>
            <SelectItem value="completed">{t('admin.taskHistory.statusCompleted')}</SelectItem>
            <SelectItem value="failed">{t('admin.taskHistory.statusFailed')}</SelectItem>
            <SelectItem value="started">{t('admin.taskHistory.statusStarted')}</SelectItem>
            <SelectItem value="idle">{t('admin.taskHistory.statusIdle')}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={agentFilter || "all"}
          onValueChange={(v) => { setAgentFilter(v === "all" ? "" : v); handleFilterChange(); }}
        >
          <SelectTrigger className="w-full sm:w-48 h-9 text-sm rounded-lg">
            <SelectValue placeholder={t('admin.taskHistory.filterAllAgents')} />
          </SelectTrigger>
          <SelectContent className="rounded-lg">
            <SelectItem value="all">{t('admin.taskHistory.filterAllAgents')}</SelectItem>
            {Object.entries(AGENT_NAME_MAP).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(statusFilter || agentFilter) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setStatusFilter(""); setAgentFilter(""); setPage(1); }}
            className="text-gray-500 h-9 rounded-lg"
          >
            {t('admin.taskHistory.clearFilters')}
          </Button>
        )}
      </div>

      {/* Task List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !data?.logs?.length ? (
        <div className="text-center py-20 text-gray-400">
          <Bot className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg">{t('admin.taskHistory.emptyTitle')}</p>
          <p className="text-sm mt-1">{t('admin.taskHistory.emptyDesc')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(data.logs as any[]).map((log: any) => {
            const statusCfg = STATUS_CONFIG[log.status as StatusType] ?? STATUS_CONFIG.idle;
            const isExpanded = expandedId === log.id;

            return (
              <div
                key={log.id}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden"
              >
                {/* Row */}
                <button
                  className="w-full text-left px-4 sm:px-5 py-3.5 hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
                >
                  <div className="flex items-start gap-3">
                    {/* Status Icon */}
                    <div className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${statusCfg.color}`}>
                      {statusCfg.icon}
                    </div>

                    {/* Main Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900 text-sm truncate max-w-xs sm:max-w-none">
                          {log.taskTitle || log.taskType || t('admin.taskHistory.rowUnnamedTask')}
                        </span>
                        <Badge variant="outline" className={`text-xs px-2 py-0 border rounded-md ${statusCfg.color}`}>
                          {statusCfg.label}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Bot className="h-3 w-3" />
                          {getAgentDisplayName(log.agentName)}
                        </span>
                        {log.taskType && (
                          <span className="text-gray-400">{log.taskType}</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(log.startedAt)}
                        </span>
                        {log.processingTimeMs && (
                          <span className="flex items-center gap-1">
                            <Timer className="h-3 w-3" />
                            {formatDuration(log.processingTimeMs)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expand Arrow */}
                    <ExpandIcon
                      className={`h-4 w-4 text-gray-400 flex-shrink-0 mt-1 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </div>
                </button>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="px-4 sm:px-5 pb-4 border-t border-gray-100 bg-gray-50">
                    <div className="pt-4 space-y-3 text-sm">
                      {log.taskId && (
                        <div>
                          <span className="text-gray-500 font-medium">{t('admin.taskHistory.detailTaskId')}</span>
                          <span className="text-gray-700 font-mono text-xs">{log.taskId}</span>
                        </div>
                      )}
                      {log.completedAt && (
                        <div>
                          <span className="text-gray-500 font-medium">{t('admin.taskHistory.detailCompletedAt')}</span>
                          <span className="text-gray-700">{formatDateTime(log.completedAt)}</span>
                        </div>
                      )}
                      {log.resultSummary && (
                        <div>
                          <span className="text-gray-500 font-medium block mb-1">{t('admin.taskHistory.detailResultSummary')}</span>
                          <p className="text-gray-700 bg-white rounded-lg border border-gray-200 p-3 leading-relaxed">
                            {log.resultSummary}
                          </p>
                        </div>
                      )}
                      {log.errorMessage && (
                        <div>
                          <span className="text-red-600 font-medium block mb-1">{t('admin.taskHistory.detailErrorMessage')}</span>
                          <p className="text-red-700 bg-red-50 rounded-lg border border-red-200 p-3 font-mono text-xs leading-relaxed">
                            {log.errorMessage}
                          </p>
                        </div>
                      )}
                      {!log.resultSummary && !log.errorMessage && (
                        <p className="text-gray-400 italic">{t('admin.taskHistory.detailNoDetails')}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
          <p className="text-sm text-gray-500">
            {t('admin.taskHistory.paginationSummary', {
              n: data.pagination.total.toLocaleString(),
              page: String(page),
              totalPages: String(data.pagination.totalPages),
            })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg"
            >
              <ChevronLeft className="h-4 w-4" />
              {t('admin.taskHistory.paginationPrev')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
              disabled={page >= data.pagination.totalPages}
              className="rounded-lg"
            >
              {t('admin.taskHistory.paginationNext')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
