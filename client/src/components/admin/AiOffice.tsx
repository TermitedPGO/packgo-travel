/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI 員工辦公室 v2
 * 每個 Agent 像員工一樣彙報：做了什麼、輸入是什麼、輸出結果
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, CheckCircle2, AlertCircle, Clock, Zap,
  Crown, Search, FileText, Layers, Wrench,
  Pen, Plane, Car, Hotel, UtensilsCrossed,
  DollarSign, AlertTriangle, Image, BookOpen, Palette,
  MessageCircle, ChevronDown, ChevronRight, Activity,
  Coffee, Briefcase, Timer, TrendingUp, User,
  Wifi, WifiOff
} from "lucide-react";

// ── Agent 定義 ────────────────────────────────────────────────────────────────
const AGENT_DEFS: Record<string, {
  name: string; title: string; icon: any; color: string;
  bg: string; border: string; dept: string; emoji: string;
}> = {
  MasterAgent:             { name: "MASTER",      title: "總指揮官",      icon: Crown,           color: "text-yellow-700", bg: "bg-yellow-50",   border: "border-yellow-200", dept: "管理層",  emoji: "👑" },
  ContentAnalyzerAgent:    { name: "ANALYZER",    title: "資料分析師",    icon: Search,          color: "text-purple-700", bg: "bg-purple-50",   border: "border-purple-200", dept: "情報部",  emoji: "🔍" },
  ItineraryUnifiedAgent:   { name: "PLANNER",     title: "行程規劃師",    icon: Layers,          color: "text-cyan-700",   bg: "bg-cyan-50",     border: "border-cyan-200",   dept: "產品部",  emoji: "🗓️" },
  PdfParserAgent:          { name: "DOCREADER",   title: "文件解析師",    icon: FileText,        color: "text-slate-700",  bg: "bg-slate-50",    border: "border-slate-200",  dept: "情報部",  emoji: "📄" },
  TransportationAgent:     { name: "SKYDESK",     title: "交通統籌員",    icon: Plane,           color: "text-sky-700",    bg: "bg-sky-50",      border: "border-sky-200",    dept: "交通部",  emoji: "✈️" },
  HotelAgent:              { name: "STAYDESK",    title: "住宿專員",      icon: Hotel,           color: "text-violet-700", bg: "bg-violet-50",   border: "border-violet-200", dept: "住宿部",  emoji: "🏨" },
  MealAgent:               { name: "FOODDESK",    title: "餐飲顧問",      icon: UtensilsCrossed, color: "text-red-700",    bg: "bg-red-50",      border: "border-red-200",    dept: "服務部",  emoji: "🍽️" },
  CostAgent:               { name: "FINDESK",     title: "費用計算師",    icon: DollarSign,      color: "text-green-700",  bg: "bg-green-50",    border: "border-green-200",  dept: "財務部",  emoji: "💰" },
  NoticeAgent:             { name: "SAFEDESK",    title: "注意事項編輯",  icon: AlertTriangle,   color: "text-yellow-700", bg: "bg-yellow-50",   border: "border-yellow-200", dept: "服務部",  emoji: "⚠️" },
  DetailsSkill:            { name: "WRITER",      title: "行程詳情撰寫師",icon: Pen,             color: "text-indigo-700", bg: "bg-indigo-50",   border: "border-indigo-200", dept: "產品部",  emoji: "📝" },
  ImageGenerationAgent:    { name: "PIXELDESK",   title: "視覺設計師",    icon: Image,           color: "text-fuchsia-700",bg: "bg-fuchsia-50",  border: "border-fuchsia-200",dept: "行銷部",  emoji: "🎨" },
  PromptAgent:             { name: "PROMPTDESK",  title: "提示工程師",    icon: Wrench,          color: "text-orange-700", bg: "bg-orange-50",   border: "border-orange-200", dept: "行銷部",  emoji: "🛠️" },
  ColorThemeAgent:         { name: "COLORDESK",   title: "色彩設計師",    icon: Palette,         color: "text-pink-700",   bg: "bg-pink-50",     border: "border-pink-200",   dept: "行銷部",  emoji: "🎨" },
  LearningAgent:           { name: "LEARNBOT",    title: "學習機器人",    icon: BookOpen,        color: "text-teal-700",   bg: "bg-teal-50",     border: "border-teal-200",   dept: "研發部",  emoji: "📚" },
  SkillLearnerAgent:       { name: "SKILLBOT",    title: "技能學習員",    icon: BookOpen,        color: "text-teal-700",   bg: "bg-teal-50",     border: "border-teal-200",   dept: "研發部",  emoji: "🧠" },
  TranslationAgent:        { name: "TRANSLATOR",  title: "翻譯員",        icon: MessageCircle,   color: "text-blue-700",   bg: "bg-blue-50",     border: "border-blue-200",   dept: "服務部",  emoji: "🌐" },
  ClaudeAgent:             { name: "CLAUDE",      title: "通用 AI 助理",  icon: Zap,             color: "text-indigo-700", bg: "bg-indigo-50",   border: "border-indigo-200", dept: "服務部",  emoji: "⚡" },
  // agentKey-based fallbacks
  analyzer:                { name: "ANALYZER",    title: "資料分析師",    icon: Search,          color: "text-purple-700", bg: "bg-purple-50",   border: "border-purple-200", dept: "情報部",  emoji: "🔍" },
  planner:                 { name: "PLANNER",     title: "行程規劃師",    icon: Layers,          color: "text-cyan-700",   bg: "bg-cyan-50",     border: "border-cyan-200",   dept: "產品部",  emoji: "🗓️" },
  skydesk:                 { name: "SKYDESK",     title: "交通統籌員",    icon: Plane,           color: "text-sky-700",    bg: "bg-sky-50",      border: "border-sky-200",    dept: "交通部",  emoji: "✈️" },
  writer:                  { name: "WRITER",      title: "行程詳情撰寫師",icon: Pen,             color: "text-indigo-700", bg: "bg-indigo-50",   border: "border-indigo-200", dept: "產品部",  emoji: "📝" },
  colordesk:               { name: "COLORDESK",   title: "色彩設計師",    icon: Palette,         color: "text-pink-700",   bg: "bg-pink-50",     border: "border-pink-200",   dept: "行銷部",  emoji: "🎨" },
  translator:              { name: "TRANSLATOR",  title: "翻譯員",        icon: MessageCircle,   color: "text-blue-700",   bg: "bg-blue-50",     border: "border-blue-200",   dept: "服務部",  emoji: "🌐" },
};

function getAgentDef(agentName: string) {
  return AGENT_DEFS[agentName] ?? {
    name: agentName.replace(/Agent$|Skill$/i, "").toUpperCase().slice(0, 10),
    title: agentName,
    icon: Briefcase,
    color: "text-gray-600",
    bg: "bg-gray-50",
    border: "border-gray-200",
    dept: "其他",
    emoji: "🤖",
  };
}

// ── 時間格式化 ────────────────────────────────────────────────────────────────
function timeAgo(date: Date | string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "剛剛";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  return d.toLocaleDateString("zh-TW");
}

function formatTime(date: Date | string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatMs(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

const TASK_LABELS: Record<string, string> = {
  tour_generation: "行程生成",
  ai_chat: "AI 諮詢",
  skill_learning: "技能學習",
  translation: "翻譯",
  pdf_parsing: "PDF 解析",
  customer_service: "客服",
  image_analysis: "圖片分析",
};

// ── 詳細活動時間軸項目 ─────────────────────────────────────────────────────────
function ActivityTimelineItem({ log, isLast }: { log: any; isLast: boolean }) {
  const [showDetail, setShowDetail] = useState(false);
  const isOk = log.status === "completed";
  const isFail = log.status === "failed";
  const isRunning = log.status === "started";
  const def = getAgentDef(log.agentName);

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
              {def.emoji} {log.taskTitle || log.taskType || "執行任務"}
            </span>
            {log.taskType && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                {TASK_LABELS[log.taskType] ?? log.taskType}
              </Badge>
            )}
            {isRunning && (
              <Badge className="text-[10px] px-1.5 py-0 h-4 bg-blue-100 text-blue-700 border-0">
                執行中…
              </Badge>
            )}
          </div>
          <span className="text-[10px] text-gray-400 shrink-0">{formatTime(log.startedAt)}</span>
        </div>

        {/* 結果摘要 — 核心彙報 */}
        {log.resultSummary && (
          <div className={`mt-1.5 text-xs rounded-md px-3 py-2 ${
            isOk ? "bg-green-50 text-green-800 border border-green-100" :
            isFail ? "bg-red-50 text-red-800 border border-red-100" :
            "bg-blue-50 text-blue-800 border border-blue-100"
          }`}>
            {log.resultSummary}
          </div>
        )}

        {/* 錯誤訊息 */}
        {log.errorMessage && (
          <div className="mt-1.5 text-xs bg-red-50 text-red-700 border border-red-100 rounded-md px-3 py-2">
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
              任務 #{log.taskId}
            </button>
          )}
          <span>{timeAgo(log.startedAt)}</span>
        </div>

        {/* 展開的任務詳情 */}
        {showDetail && log.taskId && (
          <div className="mt-2 text-[10px] text-gray-500 bg-gray-50 rounded px-2 py-1.5 border border-gray-100">
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              <span className="text-gray-400">任務 ID</span>
              <span className="font-mono">{log.taskId}</span>
              <span className="text-gray-400">開始時間</span>
              <span>{new Date(log.startedAt).toLocaleString("zh-TW")}</span>
              {log.completedAt && (
                <>
                  <span className="text-gray-400">完成時間</span>
                  <span>{new Date(log.completedAt).toLocaleString("zh-TW")}</span>
                </>
              )}
              {log.processingTimeMs && (
                <>
                  <span className="text-gray-400">處理時間</span>
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
  const [expanded, setExpanded] = useState(false);
  const def = getAgentDef(agentName);
  const Icon = def.icon;

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
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />工作中
      </span>
    : hasFailed
    ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-2.5 py-1 rounded-full border border-red-200">
        <AlertCircle className="h-3 w-3" />發生錯誤
      </span>
    : justDone
    ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2.5 py-1 rounded-full border border-green-200">
        <CheckCircle2 className="h-3 w-3" />剛完成
      </span>
    : stats?.calls
    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full border border-gray-200">
        <Coffee className="h-3 w-3" />今日有工作
      </span>
    : <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 bg-gray-50 px-2.5 py-1 rounded-full border border-gray-100">
        <Coffee className="h-3 w-3" />閒置
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
                <span className="text-xs text-gray-400 bg-white/70 px-1.5 py-0.5 rounded">{def.dept}</span>
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
              正在執行：{latestRunning.taskTitle || latestRunning.taskType || "任務中…"}
            </div>
            <div className="text-[10px] text-blue-500 mt-0.5">
              開始於 {formatTime(latestRunning.startedAt)}
            </div>
          </div>
        )}

        {/* 最近完成任務的摘要 */}
        {!latestRunning && latestDone?.resultSummary && (
          <div className="mt-3 bg-white/70 border border-white rounded-lg px-3 py-2">
            <div className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              最近完成 · {timeAgo(latestDone.completedAt ?? latestDone.startedAt)}
            </div>
            <p className="text-xs text-gray-700 line-clamp-2">{latestDone.resultSummary}</p>
          </div>
        )}

        {/* 今日統計 */}
        {stats?.calls ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="bg-white/80 rounded-lg px-2 py-2 text-center border border-white">
              <div className="text-base font-bold text-gray-900">{stats.calls}</div>
              <div className="text-[10px] text-gray-500">近期任務</div>
            </div>
            <div className="bg-white/80 rounded-lg px-2 py-2 text-center border border-white">
              <div className="text-base font-bold text-gray-900">{(stats.totalTokens / 1000).toFixed(1)}k</div>
              <div className="text-[10px] text-gray-500">Token 用量</div>
            </div>
            <div className="bg-white/80 rounded-lg px-2 py-2 text-center border border-white">
              <div className="text-base font-bold text-gray-900">
                {stats.lastActive ? timeAgo(stats.lastActive) : "—"}
              </div>
              <div className="text-[10px] text-gray-500">最後活動</div>
            </div>
          </div>
        ) : (
            <div className="text-[10px] text-gray-400 text-center py-2 bg-white/40 rounded-lg border border-white">
              近 7 天尚無工作記錄
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
              工作日誌 ({activities.length} 筆)
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
  if (!tasks.length) return null;
  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl px-5 py-4 mb-6 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        <span className="text-sm font-bold text-blue-800">正在執行中 ({tasks.length} 個任務)</span>
      </div>
      <div className="space-y-2">
        {tasks.map((t: any) => {
          const def = getAgentDef(t.agentName);
          const Icon = def.icon;
          return (
            <div key={t.id} className="flex items-center gap-3 bg-white/70 rounded-lg px-3 py-2 border border-blue-100">
              <div className={`p-1.5 rounded-lg ${def.bg} border ${def.border}`}>
                <Icon className={`h-3.5 w-3.5 ${def.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">{def.name}</span>
                  <span className="text-xs text-gray-400">{def.title}</span>
                </div>
                <p className="text-xs text-gray-600 truncate">{t.taskTitle || t.taskType || "執行中…"}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] text-blue-500 font-medium">開始於</div>
                <div className="text-xs text-blue-700">{formatTime(t.startedAt)}</div>
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
  if (!stats.length) return null;
  const totalTasks = stats.reduce((s, a) => s + (a.calls || 0), 0);
  const totalTokens = stats.reduce((s, a) => s + (a.totalTokens || 0), 0);
  const activeAgents = stats.length;

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      {[
        { icon: User, label: "近 7 天活躍 Agent", value: `${activeAgents} 位`, color: "text-blue-600" },
        { icon: Activity, label: "近 7 天總任務數", value: `${totalTasks} 筆`, color: "text-green-600" },
        { icon: TrendingUp, label: "近 7 天 Token 用量", value: `${(totalTokens / 1000).toFixed(1)}k`, color: "text-purple-600" },
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
    (data.activeTasks ?? []).forEach((t: any) => {
      if (t.status === 'started') {
        updates[t.agentName] = 'working';
        activeAgentNames.add(t.agentName);
      } else if (t.status === 'failed') {
        updates[t.agentName] = 'failed';
        activeAgentNames.add(t.agentName);
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
  const DEPT_ORDER = ["管理層", "產品部", "情報部", "服務部", "交通部", "住宿部", "財務部", "行銷部", "研發部", "其他"];
  const byDept: Record<string, string[]> = {};
  allAgentNames.forEach(name => {
    const dept = getAgentDef(name).dept;
    if (!byDept[dept]) byDept[dept] = [];
    byDept[dept].push(name);
  });

  const sortedDepts = Object.keys(byDept).sort(
    (a, b) => (DEPT_ORDER.indexOf(a) + 1 || 99) - (DEPT_ORDER.indexOf(b) + 1 || 99)
  );

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("zh-TW") : "—";

  return (
    <div>
      {/* 頁面標題列 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-bold text-gray-900">AI 員工辦公室</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            即時監控每位 AI 員工的工作狀態、正在執行的任務、近 7 天工作彙報
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* SSE 連線狀態 */}
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${sseConnected ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {sseConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {sseConnected ? '即時連線' : '重連中…'}
          </div>
          <span className="text-xs text-gray-400">最後更新 {lastUpdated}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            重新整理
          </Button>
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(v => !v)}
            className="gap-1.5 text-xs"
          >
            <Activity className="h-3.5 w-3.5" />
            {autoRefresh ? "自動更新中" : "自動更新"}
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
          <p className="text-base font-medium">近 7 天尚無 AI 員工工作記錄</p>
          <p className="text-sm mt-1 opacity-70">當 Agent 執行任務後，詳細工作日誌將顯示在這裡</p>
        </div>
      )}

      {/* 按部門分組顯示辦公桌 */}
      {sortedDepts.map(dept => (
        <div key={dept} className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <h4 className="text-sm font-bold text-gray-700 tracking-wide">{dept}</h4>
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              {byDept[dept].length} 位員工
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {byDept[dept].map(name => (
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
