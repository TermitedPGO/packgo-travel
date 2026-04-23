/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import {
  Crown, Search, FileSearch, Pen, Layers, Plane, Train, Car, Hotel,
  UtensilsCrossed, DollarSign, AlertTriangle, Image, Palette, FileText,
  BookOpen, Zap, Star, Shield, X, Clock,
  TrendingUp, RefreshCw, ScrollText, Wrench, Swords
} from "lucide-react";
import HealthBar from "@/components/ui/8bit/health-bar";
import XpBar from "@/components/ui/8bit/xp-bar";

// ── Types ─────────────────────────────────────────────────────────────────────
type DepartmentKey = "management" | "intelligence" | "product" | "transport" | "accommodation" | "service" | "marketing" | "finance" | "rnd";
type Rarity = "legendary" | "epic" | "rare" | "uncommon" | "common";

interface AgentMeta {
  id: string;
  agentKey: string;
  departmentKey: DepartmentKey;
  icon: React.ElementType;
  rarity: Rarity;
  baseLevel: number;
  emoji: string;
  bgColor: string;
  textColor: string;
}

interface AgentDef extends AgentMeta {
  name: string;
  title: string;
  department: string;
  role: string;
  description: string;
  skills: string[];
}

// ── Agent Meta (non-localized) ────────────────────────────────────────────────
const AGENT_META: (AgentMeta & { name: string })[] = [
  { id: "master", agentKey: "MasterAgent", name: "MASTER", departmentKey: "management", icon: Crown, rarity: "legendary", emoji: "👑", bgColor: "bg-yellow-950", textColor: "text-yellow-300", baseLevel: 40 },
  { id: "content-analyzer", agentKey: "ContentAnalyzerAgent", name: "ANALYZER", departmentKey: "intelligence", icon: Search, rarity: "epic", emoji: "🔍", bgColor: "bg-purple-950", textColor: "text-purple-300", baseLevel: 35 },
  { id: "itinerary-extract", agentKey: "ItineraryExtractAgent", name: "EXTRACTOR", departmentKey: "intelligence", icon: FileSearch, rarity: "rare", emoji: "🗂️", bgColor: "bg-blue-950", textColor: "text-blue-300", baseLevel: 30 },
  { id: "pdf-parser", agentKey: "PdfParserAgent", name: "DOCREADER", departmentKey: "intelligence", icon: FileText, rarity: "uncommon", emoji: "📄", bgColor: "bg-slate-800", textColor: "text-slate-300", baseLevel: 20 },
  { id: "itinerary", agentKey: "ItineraryAgent", name: "PLANNER", departmentKey: "product", icon: Layers, rarity: "epic", emoji: "🗺️", bgColor: "bg-emerald-950", textColor: "text-emerald-300", baseLevel: 38 },
  { id: "itinerary-unified", agentKey: "ItineraryUnifiedAgent", name: "INTEGRATOR", departmentKey: "product", icon: Wrench, rarity: "rare", emoji: "⚡", bgColor: "bg-cyan-950", textColor: "text-cyan-300", baseLevel: 32 },
  { id: "itinerary-polish", agentKey: "ItineraryPolishAgent", name: "WRITER", departmentKey: "marketing", icon: Pen, rarity: "rare", emoji: "✍️", bgColor: "bg-pink-950", textColor: "text-pink-300", baseLevel: 28 },
  { id: "flight", agentKey: "FlightAgent", name: "SKYDESK", departmentKey: "transport", icon: Plane, rarity: "uncommon", emoji: "✈️", bgColor: "bg-sky-950", textColor: "text-sky-300", baseLevel: 25 },
  { id: "train", agentKey: "TrainAgent", name: "RAILDESK", departmentKey: "transport", icon: Train, rarity: "uncommon", emoji: "🚄", bgColor: "bg-orange-950", textColor: "text-orange-300", baseLevel: 22 },
  { id: "transportation", agentKey: "TransportationAgent", name: "MOVEDESK", departmentKey: "transport", icon: Car, rarity: "uncommon", emoji: "🚌", bgColor: "bg-amber-950", textColor: "text-amber-300", baseLevel: 24 },
  { id: "hotel", agentKey: "HotelAgent", name: "STAYDESK", departmentKey: "accommodation", icon: Hotel, rarity: "rare", emoji: "🏨", bgColor: "bg-violet-950", textColor: "text-violet-300", baseLevel: 30 },
  { id: "meal", agentKey: "MealAgent", name: "FOODDESK", departmentKey: "service", icon: UtensilsCrossed, rarity: "uncommon", emoji: "🍜", bgColor: "bg-red-950", textColor: "text-red-300", baseLevel: 26 },
  { id: "cost", agentKey: "CostAgent", name: "FINDESK", departmentKey: "finance", icon: DollarSign, rarity: "rare", emoji: "💰", bgColor: "bg-green-950", textColor: "text-green-300", baseLevel: 32 },
  { id: "notice", agentKey: "NoticeAgent", name: "SAFEDESK", departmentKey: "service", icon: AlertTriangle, rarity: "uncommon", emoji: "⚠️", bgColor: "bg-yellow-900", textColor: "text-yellow-300", baseLevel: 28 },
  { id: "image-generation", agentKey: "ImageGenerationAgent", name: "PIXELDESK", departmentKey: "marketing", icon: Image, rarity: "rare", emoji: "🎨", bgColor: "bg-fuchsia-950", textColor: "text-fuchsia-300", baseLevel: 22 },
  { id: "image-prompt", agentKey: "ImagePromptAgent", name: "PROMPTDESK", departmentKey: "marketing", icon: Zap, rarity: "uncommon", emoji: "🖌️", bgColor: "bg-rose-950", textColor: "text-rose-300", baseLevel: 20 },
  { id: "color-theme", agentKey: "ColorThemeAgent", name: "COLORDESK", departmentKey: "marketing", icon: Palette, rarity: "uncommon", emoji: "🌈", bgColor: "bg-indigo-950", textColor: "text-indigo-300", baseLevel: 25 },
  { id: "skill-learner", agentKey: "SkillLearnerAgent", name: "LEARNBOT", departmentKey: "rnd", icon: BookOpen, rarity: "epic", emoji: "📚", bgColor: "bg-teal-950", textColor: "text-teal-300", baseLevel: 15 },
];

// ── Rarity Config ─────────────────────────────────────────────────────────────
const RARITY: Record<Rarity, { label: string; color: string; bg: string; border: string; glow: string; bar: string; pixelBorder: string }> = {
  legendary: { label: "★ LEGEND", color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-500", glow: "shadow-yellow-500/30", bar: "bg-yellow-400", pixelBorder: "border-yellow-500" },
  epic:      { label: "◆ EPIC",   color: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-500", glow: "shadow-purple-500/30", bar: "bg-purple-400", pixelBorder: "border-purple-500" },
  rare:      { label: "▲ RARE",   color: "text-blue-400",   bg: "bg-blue-400/10",   border: "border-blue-500",   glow: "shadow-blue-500/30",   bar: "bg-blue-400",   pixelBorder: "border-blue-500" },
  uncommon:  { label: "● GOOD",   color: "text-green-400",  bg: "bg-green-400/10",  border: "border-green-600",  glow: "shadow-green-500/20",  bar: "bg-green-400",  pixelBorder: "border-green-600" },
  common:    { label: "○ NORM",   color: "text-gray-400",   bg: "bg-gray-400/10",   border: "border-gray-600",   glow: "shadow-gray-500/10",   bar: "bg-gray-400",   pixelBorder: "border-gray-600" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function calcLevel(base: number, calls: number) { return Math.min(99, base + Math.floor(Math.sqrt(calls) * 0.8)); }
function calcExp(calls: number) { return Math.min(100, (calls % 20) * 5); }
function calcHp(rarity: Rarity, totalCalls: number) {
  const base = rarity === "legendary" ? 97 : rarity === "epic" ? 93 : rarity === "rare" ? 89 : 85;
  return Math.min(100, base + Math.min(3, Math.floor(totalCalls / 100)));
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AiTeamRoster() {
  const { t, tArray } = useLocale();
  const [selected, setSelected] = useState<AgentDef | null>(null);
  const [dept, setDept] = useState<string>("all");
  const [rarityFilter, setRarityFilter] = useState("all");

  const { data, isLoading, refetch } = (trpc as any).admin.getAgentDailyLogs.useQuery(undefined, {
    refetchInterval: 30000,
  });

  // Build localized agent list
  const AGENTS: AgentDef[] = useMemo(
    () =>
      AGENT_META.map((a) => ({
        ...a,
        title: t(`admin.aiTeamRoster.agents.${a.agentKey}.title`),
        department: t(`admin.aiTeamRoster.depts.${a.departmentKey}`),
        role: t(`admin.aiTeamRoster.agents.${a.agentKey}.role`),
        description: t(`admin.aiTeamRoster.agents.${a.agentKey}.description`),
        skills: tArray(`admin.aiTeamRoster.agents.${a.agentKey}.skills`),
      })),
    [t, tArray]
  );

  const deptKeys: string[] = useMemo(
    () => ["all", ...Array.from(new Set(AGENT_META.map((a) => a.departmentKey as string)))],
    []
  );
  const rarities = ["all", "legendary", "epic", "rare", "uncommon"];

  const deptLabel = (key: string) =>
    key === "all" ? t("admin.aiTeamRoster.filterAll") : t(`admin.aiTeamRoster.depts.${key}`);

  const filtered = AGENTS.filter((a) => {
    if (dept !== "all" && a.departmentKey !== dept) return false;
    if (rarityFilter !== "all" && a.rarity !== rarityFilter) return false;
    return true;
  });

  function taskLabel(taskType: string): string {
    const key = `admin.aiTeamRoster.tasks.${taskType}`;
    const label = t(key);
    // If not found (fallthrough), fallback to raw type
    return label === key ? taskType : label;
  }

  function taskEmoji(taskType: string) {
    const m: Record<string, string> = {
      tour_generation: "🗺️",
      ai_chat: "💬",
      translation: "🌐",
      image_generation: "🎨",
      pdf_parse: "📄",
      skill_learning: "📚",
      unknown: "⚙️",
    };
    return m[taskType] || "⚙️";
  }

  function timeAgo(d: string | Date) {
    const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (diff < 60) return t("admin.aiTeamRoster.timeAgoSecs", { s: String(diff) });
    if (diff < 3600) return t("admin.aiTeamRoster.timeAgoMins", { m: String(Math.floor(diff / 60)) });
    return t("admin.aiTeamRoster.timeAgoHrs", { h: String(Math.floor(diff / 3600)) });
  }

  function stats(a: AgentDef) {
    const all = data?.allTimeStats?.find((s: any) => s.agentName === a.agentKey);
    const today = data?.todayStats?.find((s: any) => s.agentName === a.agentKey);
    const totalCalls = Number(all?.totalCalls ?? 0);
    return {
      level: calcLevel(a.baseLevel, totalCalls),
      exp: calcExp(totalCalls),
      hp: calcHp(a.rarity, totalCalls),
      todayCalls: Number(today?.calls ?? 0),
      totalCalls,
      today,
    };
  }

  function activity(a: AgentDef) {
    return (data?.recentActivity ?? []).filter((x: any) => x.agentName === a.agentKey).slice(0, 8);
  }

  const totalToday = (data?.todayStats ?? []).reduce((s: number, x: any) => s + Number(x.calls), 0);
  const activeCount = (data?.todayStats ?? []).length;

  return (
    <div
      className="min-h-screen bg-gray-950 text-white"
      style={{ fontFamily: "'Press Start 2P', monospace", imageRendering: "pixelated" }}
    >
      {/* ── HEADER ── */}
      <div className="sticky top-0 z-10 bg-gray-950 border-b-4 border-yellow-500 px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* Title */}
          <div className="flex items-center gap-3">
            <Swords className="w-5 h-5 text-yellow-400" />
            <div>
              <h1 className="text-[11px] text-yellow-400 tracking-widest">
                {t("admin.aiTeamRoster.headerTitle")}
              </h1>
              <p className="text-[8px] text-gray-600 mt-0.5">
                {t("admin.aiTeamRoster.headerSubtitle")}
              </p>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4">
            {[
              { label: t("admin.aiTeamRoster.statAgents"), value: AGENT_META.length, color: "text-yellow-400" },
              { label: t("admin.aiTeamRoster.statActive"), value: isLoading ? "..." : activeCount, color: "text-green-400" },
              { label: t("admin.aiTeamRoster.statTasks"), value: isLoading ? "..." : totalToday, color: "text-blue-400" },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[7px] text-gray-600 mt-0.5">{s.label}</div>
              </div>
            ))}
            <button
              onClick={() => refetch()}
              className="p-1.5 border-2 border-gray-700 hover:border-yellow-500 hover:bg-yellow-500/10 transition-colors rounded-md"
              title={t("admin.aiTeamRoster.refreshTitle")}
            >
              <RefreshCw className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>
        </div>

        {/* ── FILTERS ── */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {/* Department filter */}
          <div className="flex gap-1 flex-wrap">
            {deptKeys.map(d => (
              <button
                key={d}
                onClick={() => setDept(d)}
                className={`text-[7px] px-2 py-1 border-2 transition-colors tracking-wider rounded-md ${
                  dept === d
                    ? "border-yellow-500 bg-yellow-500/20 text-yellow-400"
                    : "border-gray-700 text-gray-600 hover:border-gray-500 hover:text-gray-400"
                }`}
              >
                {deptLabel(d)}
              </button>
            ))}
          </div>
          <div className="w-px h-4 bg-gray-700" />
          {/* Rarity filter */}
          <div className="flex gap-1 flex-wrap">
            {rarities.map(r => {
              const cfg = r === "all" ? null : RARITY[r as Rarity];
              return (
                <button
                  key={r}
                  onClick={() => setRarityFilter(r)}
                  className={`text-[7px] px-2 py-1 border-2 transition-colors tracking-wider rounded-md ${
                    rarityFilter === r
                      ? `border-current ${cfg?.color ?? "text-white"} ${cfg?.bg ?? "bg-white/10"}`
                      : "border-gray-700 text-gray-600 hover:border-gray-500"
                  }`}
                >
                  {r === "all" ? "ALL" : RARITY[r as Rarity].label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── AGENT GRID ── */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {filtered.map(agent => {
          const { level, exp, hp, todayCalls } = stats(agent);
          const r = RARITY[agent.rarity];
          const isActive = todayCalls > 0;

          return (
            <button
              key={agent.id}
              onClick={() => setSelected(agent)}
              className={`
                relative text-left border-2 ${r.border} bg-gray-900 rounded-md
                hover:bg-gray-800 transition-all duration-150
                shadow-lg ${r.glow} hover:shadow-xl
                p-3 flex flex-col gap-2 group
                ${isActive ? "ring-1 ring-green-500/40" : ""}
              `}
            >
              {/* Rarity badge */}
              <div className={`text-[7px] font-bold ${r.color} tracking-widest`}>{r.label}</div>

              {/* Active indicator */}
              {isActive && (
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-green-400 animate-pulse" />
                </div>
              )}

              {/* Avatar */}
              <div className={`
                w-14 h-14 ${agent.bgColor} border-2 ${r.border} rounded-md
                flex items-center justify-center text-2xl mx-auto
                ${isActive ? "animate-[bounce_2s_ease-in-out_infinite]" : ""}
              `}>
                {agent.emoji}
              </div>

              {/* Name & Title */}
              <div className="text-center">
                <div className={`text-[9px] font-bold ${agent.textColor} tracking-wide`}>{agent.name}</div>
                <div className="text-[7px] text-gray-500 mt-0.5 leading-relaxed">{agent.title}</div>
              </div>

              {/* Level */}
              <div className="flex items-center justify-between">
                <span className="text-[7px] text-gray-600">LV</span>
                <span className={`text-sm font-bold ${r.color}`}>{level}</span>
              </div>

              {/* HP Bar */}
              <div>
                <div className="flex justify-between text-[6px] text-gray-600 mb-1">
                  <span>HP</span>
                  <span className="text-red-400">{hp}%</span>
                </div>
                <HealthBar value={hp} variant="retro" className="h-2" />
              </div>

              {/* EXP Bar */}
              <div>
                <div className="flex justify-between text-[6px] text-gray-600 mb-1">
                  <span>EXP</span>
                  <span className="text-yellow-400">{exp}%</span>
                </div>
                <XpBar value={exp} variant="retro" className="h-2" />
              </div>

              {/* Today tasks */}
              <div className="flex justify-between text-[7px] border-t-2 border-gray-800 pt-1.5">
                <span className="text-gray-600">{t("admin.aiTeamRoster.todayLabel")}</span>
                <span className={isActive ? "text-green-400 font-bold" : "text-gray-700"}>
                  {isActive ? `${todayCalls}x` : t("admin.aiTeamRoster.idleLabel")}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── DETAIL MODAL ── */}
      {selected && (
        <AgentModal
          agent={selected}
          stats={stats(selected)}
          activity={activity(selected)}
          onClose={() => setSelected(null)}
          taskLabel={taskLabel}
          taskEmoji={taskEmoji}
          timeAgo={timeAgo}
        />
      )}
    </div>
  );
}

// ── Agent Detail Modal ────────────────────────────────────────────────────────
function AgentModal({
  agent,
  stats,
  activity,
  onClose,
  taskLabel,
  taskEmoji,
  timeAgo,
}: {
  agent: AgentDef;
  stats: { level: number; exp: number; hp: number; todayCalls: number; totalCalls: number; today: any };
  activity: any[];
  onClose: () => void;
  taskLabel: (taskType: string) => string;
  taskEmoji: (taskType: string) => string;
  timeAgo: (d: string | Date) => string;
}) {
  const { t, language } = useLocale();
  const r = RARITY[agent.rarity];
  const { level, exp, hp, todayCalls, totalCalls, today } = stats;
  const mp = Math.min(100, 40 + level);
  const locale = language === "en" ? "en-US" : "zh-TW";

  const perfFlavor =
    todayCalls >= 10
      ? ` 🔥${t("admin.aiTeamRoster.excellentMsg")}`
      : todayCalls >= 5
      ? ` ✅${t("admin.aiTeamRoster.goodWorkMsg")}`
      : ` 📋${t("admin.aiTeamRoster.lightDayMsg")}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
      onClick={onClose}
      style={{ fontFamily: "'Press Start 2P', monospace" }}
    >
      <div
        className={`relative w-full max-w-2xl bg-gray-900 border-4 ${r.border} shadow-2xl max-h-[90vh] overflow-y-auto rounded-md`}
        onClick={e => e.stopPropagation()}
        style={{ boxShadow: `0 0 40px rgba(0,0,0,0.8), inset 0 0 0 2px rgba(255,255,255,0.05)` }}
      >
        {/* ── MODAL HEADER ── */}
        <div className={`${agent.bgColor} border-b-4 ${r.border} p-4 flex items-start gap-4`}>
          {/* Avatar */}
          <div className={`w-16 h-16 bg-gray-900/60 border-4 ${r.border} flex items-center justify-center text-3xl flex-shrink-0 rounded-md`}>
            {agent.emoji}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h2 className={`text-sm font-bold ${agent.textColor} tracking-widest`}>{agent.name}</h2>
              <span className={`text-[7px] font-bold px-2 py-0.5 border-2 ${r.border} ${r.color} ${r.bg} rounded-md`}>
                {r.label}
              </span>
              {todayCalls > 0 && (
                <span className="text-[7px] font-bold px-2 py-0.5 border-2 border-green-500 text-green-400 bg-green-400/10 flex items-center gap-1 rounded-md">
                  <span className="w-1.5 h-1.5 bg-green-400 animate-pulse inline-block" />
                  {t("admin.aiTeamRoster.onlineLabel")}
                </span>
              )}
            </div>
            <div className="text-[8px] text-gray-400 mb-1">{agent.title} · {agent.department}</div>
            <div className="text-[7px] text-gray-500 leading-relaxed">{agent.description}</div>
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors flex-shrink-0 border-2 border-gray-700 hover:border-red-500 p-1 rounded-md"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ── MODAL BODY ── */}
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ── LEFT: STATS ── */}
          <div className="space-y-3">
            {/* Level & EXP */}
            <div className="border-2 border-gray-700 bg-gray-800/40 p-3 rounded-md">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[7px] text-gray-600 tracking-widest">LEVEL</span>
                <span className={`text-2xl font-bold ${r.color}`}>LV {level}</span>
              </div>
              <div className="flex justify-between text-[7px] text-gray-600 mb-1.5">
                <span>EXP</span>
                <span className="text-yellow-400">{exp}%</span>
              </div>
              <XpBar value={exp} variant="retro" className="h-3" />
            </div>

            {/* HP / MP */}
            <div className="border-2 border-gray-700 bg-gray-800/40 p-3 space-y-3 rounded-md">
              <div>
                <div className="flex justify-between text-[7px] mb-1.5">
                  <span className="text-red-400 flex items-center gap-1">
                    <Shield className="w-2.5 h-2.5" /> {t("admin.aiTeamRoster.hpSuccessLabel")}
                  </span>
                  <span className="text-red-400">{hp}%</span>
                </div>
                <HealthBar value={hp} variant="retro" className="h-3" />
              </div>
              <div>
                <div className="flex justify-between text-[7px] mb-1.5">
                  <span className="text-blue-400 flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5" /> {t("admin.aiTeamRoster.mpCacheLabel")}
                  </span>
                  <span className="text-blue-400">{mp}%</span>
                </div>
                {/* Custom blue progress bar */}
                <div className="relative w-full h-3">
                  <div className="w-full h-full bg-blue-500/20 overflow-hidden flex">
                    {Array.from({ length: 20 }).map((_, i) => {
                      const filled = Math.round((mp / 100) * 20);
                      return (
                        <div
                          key={i}
                          className={`flex-1 h-full mx-[1px] ${i < filled ? "bg-blue-500" : "bg-transparent"}`}
                        />
                      );
                    })}
                  </div>
                  <div className="absolute inset-0 border-y-4 -my-1 border-gray-300 pointer-events-none" aria-hidden="true" />
                  <div className="absolute inset-0 border-x-4 -mx-1 border-gray-300 pointer-events-none" aria-hidden="true" />
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: t("admin.aiTeamRoster.statTotalTasks"), value: totalCalls.toLocaleString(locale), emoji: "⚔️" },
                { label: t("admin.aiTeamRoster.statTodayShort"), value: todayCalls.toString(), emoji: "📅" },
                { label: t("admin.aiTeamRoster.statAvgTime"), value: today?.avgMs ? `${today.avgMs}ms` : "---", emoji: "⏱️" },
                { label: t("admin.aiTeamRoster.statTokens"), value: today?.totalTokens ? `${(today.totalTokens / 1000).toFixed(1)}K` : "---", emoji: "🔋" },
              ].map(s => (
                <div key={s.label} className="border-2 border-gray-700 bg-gray-800/40 p-2 text-center rounded-md">
                  <div className="text-base mb-1">{s.emoji}</div>
                  <div className={`text-xs font-bold ${r.color}`}>{s.value}</div>
                  <div className="text-[6px] text-gray-600 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Skills */}
            <div className="border-2 border-gray-700 bg-gray-800/40 p-3 rounded-md">
              <div className="text-[7px] text-gray-500 tracking-widest mb-2 flex items-center gap-1">
                <Star className="w-2.5 h-2.5" /> {t("admin.aiTeamRoster.skillsLabel")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {agent.skills.map(s => (
                  <span
                    key={s}
                    className={`text-[7px] px-2 py-0.5 border-2 ${r.border} ${r.bg} ${r.color} tracking-wide rounded-md`}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ── RIGHT: DAILY LOG ── */}
          <div className="space-y-3">
            <div className="border-2 border-gray-700 bg-gray-800/40 p-3 rounded-md">
              <div className="text-[7px] text-gray-500 tracking-widest mb-3 flex items-center gap-1">
                <ScrollText className="w-2.5 h-2.5" /> {t("admin.aiTeamRoster.todayWorkLog")}
              </div>

              {activity.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-3xl mb-3">😴</div>
                  <div className="text-[8px] text-gray-600">{t("admin.aiTeamRoster.noTasksToday")}</div>
                  <div className="text-[7px] text-gray-700 mt-1">{t("admin.aiTeamRoster.standbyMsg")}</div>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {activity.map((log: any, i: number) => (
                    <div key={i} className="border-2 border-gray-700 bg-gray-900 p-2 rounded-md">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[8px] font-bold ${r.color}`}>
                          {taskEmoji(log.taskType)} {taskLabel(log.taskType)}
                        </span>
                        <span className="text-[7px] text-gray-700">
                          {log.createdAt ? timeAgo(log.createdAt) : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[7px] text-gray-600">
                        {log.totalTokens && (
                          <span className="flex items-center gap-0.5">
                            <Zap className="w-2 h-2" /> {log.totalTokens.toLocaleString(locale)} {t("admin.aiTeamRoster.tokensSuffix")}
                          </span>
                        )}
                        {log.processingTimeMs && (
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-2 h-2" /> {log.processingTimeMs}ms
                          </span>
                        )}
                        {log.wasFromCache && (
                          <span className="text-blue-400">⚡ {t("admin.aiTeamRoster.cacheLabel")}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Today Summary */}
            {todayCalls > 0 && (
              <div className={`border-2 ${r.border} ${r.bg} p-3 rounded-md`}>
                <div className={`text-[7px] ${r.color} tracking-widest mb-2 flex items-center gap-1`}>
                  <TrendingUp className="w-2.5 h-2.5" /> {t("admin.aiTeamRoster.todayPerformance")}
                </div>
                <p className="text-[7px] text-gray-300 leading-loose">
                  {t("admin.aiTeamRoster.completedMsg", {
                    name: agent.name,
                    count: String(todayCalls),
                    tokens: (today?.totalTokens ?? 0).toLocaleString(locale),
                    ms: String(today?.avgMs ?? 0),
                  })}
                  {perfFlavor}
                </p>
              </div>
            )}

            {/* Role badge */}
            <div className="border-2 border-gray-700 bg-gray-800/40 p-3 flex items-center justify-between rounded-md">
              <div>
                <div className="text-[7px] text-gray-600 mb-1">{t("admin.aiTeamRoster.roleLabel")}</div>
                <div className={`text-[9px] font-bold ${r.color}`}>{agent.role}</div>
              </div>
              <div>
                <div className="text-[7px] text-gray-600 mb-1">{t("admin.aiTeamRoster.deptLabel")}</div>
                <div className="text-[9px] font-bold text-gray-300">{agent.department}</div>
              </div>
              <div className={`text-3xl w-12 h-12 ${agent.bgColor} border-2 ${r.border} flex items-center justify-center rounded-md`}>
                {agent.emoji}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
