/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI 員工辦公室 v2
 * 每個 Agent 像員工一樣彙報：做了什麼、輸入是什麼、輸出結果
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, CheckCircle2, AlertCircle, Clock, Zap,
  Crown, Search, FileText, Layers, Wrench,
  Pen, Plane, Hotel, UtensilsCrossed,
  DollarSign, AlertTriangle, Image, BookOpen, Palette,
  MessageCircle, ChevronDown, ChevronRight, Activity,
  Coffee, Briefcase, Timer, TrendingUp, User,
  Wifi, WifiOff
} from "lucide-react";

// ── Agent visual meta (non-localized) ─────────────────────────────────────────
type DepartmentKey = "management" | "intelligence" | "product" | "transport" | "accommodation" | "service" | "marketing" | "finance" | "rnd" | "other";
interface AgentVisual {
  name: string;
  icon: any;
  color: string;
  bg: string;
  border: string;
  emoji: string;
  departmentKey: DepartmentKey;
}
const AGENT_VISUALS: Record<string, AgentVisual> = {
  MasterAgent:           { name: "MASTER",     icon: Crown,           color: "text-yellow-700",  bg: "bg-yellow-50",   border: "border-yellow-200",  emoji: "👑", departmentKey: "management" },
  ContentAnalyzerAgent:  { name: "ANALYZER",   icon: Search,          color: "text-purple-700",  bg: "bg-purple-50",   border: "border-purple-200",  emoji: "🔍", departmentKey: "intelligence" },
  ItineraryUnifiedAgent: { name: "PLANNER",    icon: Layers,          color: "text-cyan-700",    bg: "bg-cyan-50",     border: "border-cyan-200",    emoji: "🗓️", departmentKey: "product" },
  PdfParserAgent:        { name: "DOCREADER",  icon: FileText,        color: "text-slate-700",   bg: "bg-slate-50",    border: "border-slate-200",   emoji: "📄", departmentKey: "intelligence" },
  TransportationAgent:   { name: "SKYDESK",    icon: Plane,           color: "text-sky-700",     bg: "bg-sky-50",      border: "border-sky-200",     emoji: "✈️", departmentKey: "transport" },
  HotelAgent:            { name: "STAYDESK",   icon: Hotel,           color: "text-violet-700",  bg: "bg-violet-50",   border: "border-violet-200",  emoji: "🏨", departmentKey: "accommodation" },
  MealAgent:             { name: "FOODDESK",   icon: UtensilsCrossed, color: "text-red-700",     bg: "bg-red-50",      border: "border-red-200",     emoji: "🍽️", departmentKey: "service" },
  CostAgent:             { name: "FINDESK",    icon: DollarSign,      color: "text-green-700",   bg: "bg-green-50",    border: "border-green-200",   emoji: "💰", departmentKey: "finance" },
  NoticeAgent:           { name: "SAFEDESK",   icon: AlertTriangle,   color: "text-yellow-700",  bg: "bg-yellow-50",   border: "border-yellow-200",  emoji: "⚠️", departmentKey: "service" },
  DetailsSkill:          { name: "WRITER",     icon: Pen,             color: "text-indigo-700",  bg: "bg-indigo-50",   border: "border-indigo-200",  emoji: "📝", departmentKey: "product" },
  ImageGenerationAgent:  { name: "PIXELDESK",  icon: Image,           color: "text-fuchsia-700", bg: "bg-fuchsia-50",  border: "border-fuchsia-200", emoji: "🎨", departmentKey: "marketing" },
  PromptAgent:           { name: "PROMPTDESK", icon: Wrench,          color: "text-orange-700",  bg: "bg-orange-50",   border: "border-orange-200",  emoji: "🛠️", departmentKey: "marketing" },
  ColorThemeAgent:       { name: "COLORDESK",  icon: Palette,         color: "text-pink-700",    bg: "bg-pink-50",     border: "border-pink-200",    emoji: "🎨", departmentKey: "marketing" },
  LearningAgent:         { name: "LEARNBOT",   icon: BookOpen,        color: "text-teal-700",    bg: "bg-teal-50",     border: "border-teal-200",    emoji: "📚", departmentKey: "rnd" },
  SkillLearnerAgent:     { name: "SKILLBOT",   icon: BookOpen,        color: "text-teal-700",    bg: "bg-teal-50",     border: "border-teal-200",    emoji: "🧠", departmentKey: "rnd" },
  TranslationAgent:      { name: "TRANSLATOR", icon: MessageCircle,   color: "text-blue-700",    bg: "bg-blue-50",     border: "border-blue-200",    emoji: "🌐", departmentKey: "service" },
  ClaudeAgent:           { name: "CLAUDE",     icon: Zap,             color: "text-indigo-700",  bg: "bg-indigo-50",   border: "border-indigo-200",  emoji: "⚡", departmentKey: "service" },
  // agentKey-based fallback aliases
  analyzer:              { name: "ANALYZER",   icon: Search,          color: "text-purple-700",  bg: "bg-purple-50",   border: "border-purple-200",  emoji: "🔍", departmentKey: "intelligence" },
  planner:               { name: "PLANNER",    icon: Layers,          color: "text-cyan-700",    bg: "bg-cyan-50",     border: "border-cyan-200",    emoji: "🗓️", departmentKey: "product" },
  skydesk:               { name: "SKYDESK",    icon: Plane,           color: "text-sky-700",     bg: "bg-sky-50",      border: "border-sky-200",     emoji: "✈️", departmentKey: "transport" },
  writer:                { name: "WRITER",     icon: Pen,             color: "text-indigo-700",  bg: "bg-indigo-50",   border: "border-indigo-200",  emoji: "📝", departmentKey: "product" },
  colordesk:             { name: "COLORDESK",  icon: Palette,         color: "text-pink-700",    bg: "bg-pink-50",     border: "border-pink-200",    emoji: "🎨", departmentKey: "marketing" },
  translator:            { name: "TRANSLATOR", icon: MessageCircle,   color: "text-blue-700",    bg: "bg-blue-50",     border: "border-blue-200",    emoji: "🌐", departmentKey: "service" },
};

function getAgentVisual(agentName: string): AgentVisual {
  return AGENT_VISUALS[agentName] ?? {
    name: agentName.replace(/Agent$|Skill$/i, "").toUpperCase().slice(0, 10),
    icon: Briefcase,
    color: "text-gray-600",
    bg: "bg-gray-50",
    border: "border-gray-200",
    emoji: "🤖",
    departmentKey: "other",
  };
}

// ── Department ordering (for sorting) ─────────────────────────────────────────
const DEPT_ORDER: DepartmentKey[] = [
  "management", "product", "intelligence", "service",
  "transport", "accommodation", "finance", "marketing", "rnd", "other",
];

// ── Hook: agent resolver with i18n ────────────────────────────────────────────
function useAgentDef() {
  const { t } = useLocale();
  return useCallback((agentName: string) => {
    const visual = getAgentVisual(agentName);
    const titleKey = `admin.aiOffice.agents.${agentName}.title`;
    const resolvedTitle = t(titleKey);
    const title = resolvedTitle === titleKey ? agentName : resolvedTitle;
    const dept =
      visual.departmentKey === "other"
        ? t("admin.aiOffice.deptOther")
        : t(`admin.aiTeamRoster.depts.${visual.departmentKey}`);
    return { ...visual, title, dept };
  }, [t]);
}

// ── 詳細活動時間軸項目 ─────────────────────────────────────────────────────────
function ActivityTimelineItem({
  log,
  isLast,
}: {
  log: any;
  isLast: boolean;
}) {
  const { t, language } = useLocale();
  const getAgentDef = useAgentDef();
  const [showDetail, setShowDetail] = useState(false);
  const isOk = log.status === "completed";
  const isFail = log.status === "failed";
  const isRunning = log.status === "started";
  const def = getAgentDef(log.agentName);
  const locale = language === "en" ? "en-US" : "zh-TW";

  const formatTime = (date: Date | string | null): string => {
    if (!date) return "—";
    return new Date(date).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  const timeAgo = (date: Date | string | null): string => {
    if (!date) return "—";
    const d = new Date(date);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return t("admin.aiOffice.justNow");
    if (diff < 3_600_000) return t("admin.aiOffice.timeAgoMins", { m: String(Math.floor(diff / 60_000)) });
    if (diff < 86_400_000) return t("admin.aiOffice.timeAgoHrs", { h: String(Math.floor(diff / 3_600_000)) });
    return d.toLocaleDateString(locale);
  };
  const formatMs = (ms: number | null): string => {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };
  const resolveTaskLabel = (taskType: string) => {
    const key = `admin.aiOffice.tasks.${taskType}`;
    const label = t(key);
    return label === key ? taskType : label;
  };

  return (
    <div className="relative flex gap-3">
      {/* 時間軸線 */}
      {!isLast && (
        <div className="absolute left-[15px] top-8 bottom-0 w-px bg-gray-200" />
      )}

      {/* 狀態圖示 */}
      <div className="shrink-0 mt-1">
        {isRunning && (
          <div className="w-8 h-8 rounded-full bg-blue-100 border-2 border-blue-400 flex items-center justify-center">
            <Clock className="h-3.5 w-3.5 text-blue-600 animate-pulse" />
          </div>
        )}
        {isOk && (
          <div className="w-8 h-8 rounded-full bg-green-100 border-2 border-green-400 flex items-center justify-center">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          </div>
        )}
        {isFail && (
          <div className="w-8 h-8 rounded-full bg-red-100 border-2 border-red-400 flex items-center justify-center">
            <AlertCircle className="h-3.5 w-3.5 text-red-600" />
          </div>
        )}
      </div>

      {/* 內容 */}
      <div className="flex-1 min-w-0 pb-4">
        {/* 標題列 */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-gray-800">
              {def.emoji} {log.taskTitle || log.taskType || t("admin.aiOffice.executeTask")}
            </span>
            {log.taskType && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 rounded-md">
                {resolveTaskLabel(log.taskType)}
              </Badge>
            )}
            {isRunning && (
              <Badge className="text-[10px] px-1.5 py-0 h-4 bg-blue-100 text-blue-700 border-0 rounded-md">
                {t("admin.aiOffice.nowRunning")}
              </Badge>
            )}
          </div>
          <span className="text-[10px] text-gray-400 shrink-0">{formatTime(log.startedAt)}</span>
        </div>

        {/* 結果摘要 — 核心彙報 */}
        {log.resultSummary && (
          <div className={`mt-1.5 text-xs rounded-lg px-3 py-2 ${
            isOk ? "bg-green-50 text-green-800 border border-green-100" :
            isFail ? "bg-red-50 text-red-800 border border-red-100" :
            "bg-blue-50 text-blue-800 border border-blue-100"
          }`}>
            {log.resultSummary}
          </div>
        )}

        {/* 錯誤訊息 */}
        {log.errorMessage && (
          <div className="mt-1.5 text-xs bg-red-50 text-red-700 border border-red-100 rounded-lg px-3 py-2">
            ❌ {log.errorMessage}
          </div>
        )}

        {/* 次要資訊列 */}
        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-400">
          {log.processingTimeMs && (
            <span className="flex items-center gap-0.5">
              <Timer className="h-3 w-3" />
              {formatMs(log.processingTimeMs)}
            </span>
          )}
          {log.taskId && (
            <button
              onClick={() => setShowDetail(v => !v)}
              className="flex items-center gap-0.5 hover:text-gray-600 transition-colors"
            >
              {showDetail ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {t("admin.aiOffice.taskIdLabel", { id: String(log.taskId) })}
            </button>
          )}
          <span>{timeAgo(log.startedAt)}</span>
        </div>

        {/* 展開的任務詳情 */}
        {showDetail && log.taskId && (
          <div className="mt-2 text-[10px] text-gray-500 bg-gray-50 rounded-md px-2 py-1.5 border border-gray-100">
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              <span className="text-gray-400">{t("admin.aiOffice.detailTaskId")}</span>
              <span className="font-mono">{log.taskId}</span>
              <span className="text-gray-400">{t("admin.aiOffice.detailStartedAt")}</span>
              <span>{new Date(log.startedAt).toLocaleString(locale)}</span>
              {log.completedAt && (
                <>
                  <span className="text-gray-400">{t("admin.aiOffice.detailCompletedAt")}</span>
                  <span>{new Date(log.completedAt).toLocaleString(locale)}</span>
                </>
              )}
              {log.processingTimeMs && (
                <>
                  <span className="text-gray-400">{t("admin.aiOffice.detailProcessingTime")}</span>
                  <span>{formatMs(log.processingTimeMs)}</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 員工辦公桌卡片 ────────────────────────────────────────────────────────────────────
function DeskCard({
  agentName,
  stats,
  activities,
  liveStatus,
}: {
  agentName: string;
  stats?: { calls: number; totalTokens: number; lastActive: string | null };
  activities: any[];
  liveStatus?: 'idle' | 'working' | 'failed';
}) {
  const { t, language } = useLocale();
  const getAgentDef = useAgentDef();
  const [expanded, setExpanded] = useState(false);
  const def = getAgentDef(agentName);
  const Icon = def.icon;
  const locale = language === "en" ? "en-US" : "zh-TW";

  const formatTime = (date: Date | string | null): string => {
    if (!date) return "—";
    return new Date(date).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  const timeAgo = (date: Date | string | null): string => {
    if (!date) return "—";
    const d = new Date(date);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return t("admin.aiOffice.justNow");
    if (diff < 3_600_000) return t("admin.aiOffice.timeAgoMins", { m: String(Math.floor(diff / 60_000)) });
    if (diff < 86_400_000) return t("admin.aiOffice.timeAgoHrs", { h: String(Math.floor(diff / 3_600_000)) });
    return d.toLocaleDateString(locale);
  };

  // 判斷目前狀態（SSE 即時狀態優先）
  const recentActivity = activities[0];
  const isRunning = liveStatus === 'working' || (
    liveStatus !== 'failed' && liveStatus !== 'idle' &&
    recentActivity?.status === "started" &&
    (Date.now() - new Date(recentActivity.startedAt).getTime()) < 5 * 60 * 1000
  );
  const justDone = liveStatus !== 'working' && liveStatus !== 'failed' && recentActivity?.status === "completed" &&
    (Date.now() - new Date(recentActivity.completedAt ?? recentActivity.startedAt).getTime()) < 10 * 60 * 1000;
  const hasFailed = liveStatus === 'failed' || (
    liveStatus !== 'working' && liveStatus !== 'idle' &&
    recentActivity?.status === "failed" &&
    (Date.now() - new Date(recentActivity.startedAt).getTime()) < 30 * 60 * 1000
  );

  const statusBadge = isRunning
    ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-100 px-2.5 py-1 rounded-full border border-blue-200">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />{t("admin.aiOffice.statusWorking")}
      </span>
    : hasFailed
    ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-2.5 py-1 rounded-full border border-red-200">
        <AlertCircle className="h-3 w-3" />{t("admin.aiOffice.statusFailed")}
      </span>
    : justDone
    ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2.5 py-1 rounded-full border border-green-200">
        <CheckCircle2 className="h-3 w-3" />{t("admin.aiOffice.statusJustDone")}
      </span>
    : stats?.calls
    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full border border-gray-200">
        <Coffee className="h-3 w-3" />{t("admin.aiOffice.statusHasWork")}
      </span>
    : <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 bg-gray-50 px-2.5 py-1 rounded-full border border-gray-100">
        <Coffee className="h-3 w-3" />{t("admin.aiOffice.statusIdle")}
      </span>;

  // 最近一筆已完成的任務摘要
  const latestDone = activities.find(a => a.status === "completed");
  const latestRunning = activities.find(a => a.status === "started");

  return (
    <div className={`border ${def.border} rounded-xl overflow-hidden ${def.bg} shadow-sm`}>
      {/* 辦公桌頭部 */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl bg-white border ${def.border} shadow-sm`}>
              <Icon className={`h-5 w-5 ${def.color}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900">{def.name}</span>
                <span className="text-xs text-gray-400 bg-white/70 px-1.5 py-0.5 rounded-md">{def.dept}</span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{def.title}</p>
            </div>
          </div>
          {statusBadge}
        </div>

        {/* 正在執行的任務 */}
        {latestRunning && (
          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs text-blue-700 font-medium">
              <Clock className="h-3.5 w-3.5 animate-pulse" />
              {t("admin.aiOffice.nowExecuting", {
                task: latestRunning.taskTitle || latestRunning.taskType || t("admin.aiOffice.taskRunningFallback"),
              })}
            </div>
            <div className="text-[10px] text-blue-500 mt-0.5">
              {t("admin.aiOffice.startedFrom", { time: formatTime(latestRunning.startedAt) })}
            </div>
          </div>
        )}

        {/* 最近完成任務的摘要 */}
        {!latestRunning && latestDone?.resultSummary && (
          <div className="mt-3 bg-white/70 border border-white rounded-lg px-3 py-2">
            <div className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              {t("admin.aiOffice.justCompletedLine", {
                time: timeAgo(latestDone.completedAt ?? latestDone.startedAt),
              })}
            </div>
            <p className="text-xs text-gray-700 line-clamp-2">{latestDone.resultSummary}</p>
          </div>
        )}

        {/* 今日統計 */}
        {stats?.calls ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="bg-white/80 rounded-lg px-2 py-2 text-center border border-white">
              <div className="text-base font-bold text-gray-900">{stats.calls}</div>
              <div className="text-[10px] text-gray-500">{t("admin.aiOffice.recentTasks")}</div>
            </div>
            <div className="bg-white/80 rounded-lg px-2 py-2 text-center border border-white">
              <div className="text-base font-bold text-gray-900">{(stats.totalTokens / 1000).toFixed(1)}k</div>
              <div className="text-[10px] text-gray-500">{t("admin.aiOffice.tokenUsage")}</div>
            </div>
            <div className="bg-white/80 rounded-lg px-2 py-2 text-center border border-white">
              <div className="text-base font-bold text-gray-900">
                {stats.lastActive ? timeAgo(stats.lastActive) : "—"}
              </div>
              <div className="text-[10px] text-gray-500">{t("admin.aiOffice.lastActive")}</div>
            </div>
          </div>
        ) : (
            <div className="text-[10px] text-gray-400 text-center py-2 bg-white/40 rounded-lg border border-white">
              {t("admin.aiOffice.no7dWorkLog")}
            </div>
        )}
      </div>

      {/* 工作日誌展開 */}
      {activities.length > 0 && (
        <div className="border-t border-white/60">
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-600 hover:bg-white/50 transition-colors"
          >
            <span className="font-semibold flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              {t("admin.aiOffice.workLogHeader", { n: String(activities.length) })}
            </span>
            {expanded
              ? <ChevronDown className="h-3.5 w-3.5" />
              : <ChevronRight className="h-3.5 w-3.5" />
            }
          </button>
          {expanded && (
            <div className="px-4 pb-4 bg-white/30 max-h-96 overflow-y-auto">
              <div className="pt-2">
                {activities.slice(0, 15).map((log: any, i: number) => (
                  <ActivityTimelineItem
                    key={log.id}
                    log={log}
                    isLast={i === Math.min(activities.length, 15) - 1}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 正在執行的任務橫幅 ────────────────────────────────────────────────────────
function ActiveTasksBanner({ tasks }: { tasks: any[] }) {
  const { t, language } = useLocale();
  const getAgentDef = useAgentDef();
  const locale = language === "en" ? "en-US" : "zh-TW";
  const formatTime = (date: Date | string | null) =>
    date ? new Date(date).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  if (!tasks.length) return null;
  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl px-5 py-4 mb-6 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        <span className="text-sm font-bold text-blue-800">
          {t("admin.aiOffice.activeBannerHeader", { n: String(tasks.length) })}
        </span>
      </div>
      <div className="space-y-2">
        {tasks.map((task: any) => {
          const def = getAgentDef(task.agentName);
          const Icon = def.icon;
          return (
            <div key={task.id} className="flex items-center gap-3 bg-white/70 rounded-lg px-3 py-2 border border-blue-100">
              <div className={`p-1.5 rounded-lg ${def.bg} border ${def.border}`}>
                <Icon className={`h-3.5 w-3.5 ${def.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">{def.name}</span>
                  <span className="text-xs text-gray-400">{def.title}</span>
                </div>
                <p className="text-xs text-gray-600 truncate">
                  {task.taskTitle || task.taskType || t("admin.aiOffice.executing")}
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] text-blue-500 font-medium">{t("admin.aiOffice.startedAt")}</div>
                <div className="text-xs text-blue-700">{formatTime(task.startedAt)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 今日工作摘要統計列 ─────────────────────────────────────────────────────────
function RecentSummaryBar({ stats }: { stats: any[] }) {
  const { t } = useLocale();
  if (!stats.length) return null;
  const totalTasks = stats.reduce((s, a) => s + (a.calls || 0), 0);
  const totalTokens = stats.reduce((s, a) => s + (a.totalTokens || 0), 0);
  const activeAgents = stats.length;

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      {[
        { icon: User, label: t("admin.aiOffice.summary7dAgents"), value: t("admin.aiOffice.countPeople", { n: String(activeAgents) }), color: "text-blue-600" },
        { icon: Activity, label: t("admin.aiOffice.summary7dTasks"), value: t("admin.aiOffice.countRecords", { n: String(totalTasks) }), color: "text-green-600" },
        { icon: TrendingUp, label: t("admin.aiOffice.summary7dTokens"), value: `${(totalTokens / 1000).toFixed(1)}k`, color: "text-purple-600" },
      ].map(({ icon: Icon, label, value, color }) => (
        <div key={label} className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Icon className={`h-4 w-4 ${color}`} />
            <span className="text-xs text-gray-500">{label}</span>
          </div>
          <div className={`text-xl font-bold ${color}`}>{value}</div>
        </div>
      ))}
    </div>
  );
}

// ── 主元件 ────────────────────────────────────────────────────────────────────
export default function AiOffice() {
  const { t, language } = useLocale();
  const getAgentDef = useAgentDef();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  // Live status map: agentName -> 'working' | 'idle' | 'failed'
  const [liveStatuses, setLiveStatuses] = useState<Record<string, 'idle' | 'working' | 'failed'>>({});
  const sseRef = useRef<EventSource | null>(null);

  const { data, isLoading, refetch, dataUpdatedAt } = (trpc as any).admin.getAgentOfficeStatus.useQuery(undefined, {
    refetchInterval: autoRefresh ? 20_000 : false,
  });

  // SSE connection for real-time updates
  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource('/api/progress/office');
    sseRef.current = es;
    es.onopen = () => setSseConnected(true);
    es.onerror = () => {
      setSseConnected(false);
      setTimeout(connectSSE, 5000);
    };
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'agent_started' && event.agentName) {
          setLiveStatuses(prev => ({ ...prev, [event.agentName]: 'working' }));
          refetch();
        } else if (event.type === 'agent_completed' && event.agentName) {
          setLiveStatuses(prev => ({ ...prev, [event.agentName]: 'idle' }));
          refetch();
        } else if (event.type === 'agent_failed' && event.agentName) {
          setLiveStatuses(prev => ({ ...prev, [event.agentName]: 'failed' }));
          refetch();
        }
      } catch { /* ignore */ }
    };
  }, [refetch]);

  useEffect(() => {
    connectSSE();
    return () => { sseRef.current?.close(); };
  }, [connectSSE]);

  // Sync active tasks from API data into live statuses
  useEffect(() => {
    if (!data) return;
    const activeAgentNames = new Set<string>();
    const updates: Record<string, 'idle' | 'working' | 'failed'> = {};
    (data.activeTasks ?? []).forEach((task: any) => {
      if (task.status === 'started') {
        updates[task.agentName] = 'working';
        activeAgentNames.add(task.agentName);
      } else if (task.status === 'failed') {
        updates[task.agentName] = 'failed';
        activeAgentNames.add(task.agentName);
      }
    });
    // Reset agents that were previously 'working' but are no longer in activeTasks
    setLiveStatuses(prev => {
      const next = { ...prev };
      for (const [agentName, status] of Object.entries(next)) {
        if (status === 'working' && !activeAgentNames.has(agentName)) {
          next[agentName] = 'idle';
        }
      }
      return { ...next, ...updates };
    });
  }, [data]);

  // 把 todayActivities 按 agentName 分組（最新的在前）
  const activitiesByAgent: Record<string, any[]> = {};
  (data?.todayActivities ?? []).forEach((a: any) => {
    if (!activitiesByAgent[a.agentName]) activitiesByAgent[a.agentName] = [];
    activitiesByAgent[a.agentName].push(a);
  });

  // 把 agentTodayStats 轉成 map
  const statsMap: Record<string, any> = {};
  (data?.agentTodayStats ?? []).forEach((s: any) => {
    statsMap[s.agentName] = s;
  });

  // 所有出現過的 Agent（包含正在執行的）
  const allAgentNames = Array.from(new Set([
    ...Object.keys(statsMap),
    ...Object.keys(activitiesByAgent),
    ...Object.keys(liveStatuses).filter(k => liveStatuses[k] === 'working'),
  ]));

  // 按部門分組，管理層優先
  const { sortedDeptKeys, byDeptKey } = useMemo(() => {
    const byDeptKey: Record<DepartmentKey, string[]> = {} as any;
    allAgentNames.forEach(name => {
      const def = getAgentDef(name);
      const key = def.departmentKey;
      if (!byDeptKey[key]) byDeptKey[key] = [];
      byDeptKey[key].push(name);
    });
    const sortedDeptKeys = Object.keys(byDeptKey).sort(
      (a, b) => (DEPT_ORDER.indexOf(a as DepartmentKey) + 1 || 99) - (DEPT_ORDER.indexOf(b as DepartmentKey) + 1 || 99)
    ) as DepartmentKey[];
    return { sortedDeptKeys, byDeptKey };
  }, [allAgentNames, getAgentDef]);

  const locale = language === "en" ? "en-US" : "zh-TW";
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString(locale) : "—";
  const deptDisplay = (key: DepartmentKey) =>
    key === "other" ? t("admin.aiOffice.deptOther") : t(`admin.aiTeamRoster.depts.${key}`);

  return (
    <div>
      {/* 頁面標題列 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-bold text-gray-900">{t("admin.aiOffice.pageTitle")}</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {t("admin.aiOffice.pageDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* SSE 連線狀態 */}
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${sseConnected ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {sseConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {sseConnected ? t("admin.aiOffice.sseConnected") : t("admin.aiOffice.sseReconnecting")}
          </div>
          <span className="text-xs text-gray-400">
            {t("admin.aiOffice.lastUpdated", { time: lastUpdated })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="gap-1.5 rounded-lg"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            {t("admin.aiOffice.refreshButton")}
          </Button>
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(v => !v)}
            className="gap-1.5 text-xs rounded-lg"
          >
            <Activity className="h-3.5 w-3.5" />
            {autoRefresh ? t("admin.aiOffice.autoRefreshOn") : t("admin.aiOffice.autoRefreshOff")}
          </Button>
        </div>
      </div>

      {/* 今日摘要統計 */}
      <RecentSummaryBar stats={data?.agentTodayStats ?? []} />

      {/* 正在執行的任務橫幅 */}
      <ActiveTasksBanner tasks={data?.activeTasks ?? []} />

      {/* 近 7 天無任何活動 */}
      {!isLoading && allAgentNames.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <Coffee className="h-14 w-14 mx-auto mb-4 opacity-20" />
          <p className="text-base font-medium">{t("admin.aiOffice.noActivity7d")}</p>
          <p className="text-sm mt-1 opacity-70">{t("admin.aiOffice.noActivity7dSub")}</p>
        </div>
      )}

      {/* 按部門分組顯示辦公桌 */}
      {sortedDeptKeys.map(deptKey => (
        <div key={deptKey} className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <h4 className="text-sm font-bold text-gray-700 tracking-wide">{deptDisplay(deptKey)}</h4>
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              {t("admin.aiOffice.deptEmployeeCount", { n: String(byDeptKey[deptKey].length) })}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {byDeptKey[deptKey].map(name => (
              <DeskCard
                key={name}
                agentName={name}
                stats={statsMap[name]}
                activities={activitiesByAgent[name] ?? []}
                liveStatus={liveStatuses[name] ?? 'idle'}
              />
            ))}
          </div>
        </div>
      ))}

      {/* 載入中骨架 */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border rounded-xl bg-gray-50 h-48 animate-pulse" />
          ))}
        </div>
      )}
    </div>
  );
}
