/**
 * Round 81 — Office Inbox (Phase 1 of "C: Learning System" workflow).
 *
 * This replaces the chat-centric office overview as the default landing
 * page. Jeff's daily flow:
 *   1. Open admin → land here
 *   2. See N items needing decision (inline approve / override)
 *   3. Spot-check today's auto-completed (collapsed)
 *   4. Glance at weekly trend + policy proposals
 *   5. Close — usually < 5 min/day
 *
 * Chat / agent DMs live in a separate sub-page now (not the primary view).
 *
 * Design system codified in:
 *   ~/.claude/projects/-Users-jeff-Desktop---/memory/feedback_office_workflow.md
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Inbox,
} from "lucide-react";

const AGENT_LABEL: Record<string, { label: string; color: string }> = {
  inquiry: { label: "InquiryAgent", color: "emerald" },
  review: { label: "ReviewAgent", color: "blue" },
  marketing: { label: "MarketingAgent", color: "purple" },
  followup: { label: "FollowupAgent", color: "amber" },
  refund: { label: "RefundAgent", color: "rose" },
  self_retrospective: { label: "RetrospectiveAgent", color: "slate" },
};

const TONE: Record<
  string,
  { bg: string; border: string; text: string; chip: string }
> = {
  emerald: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", chip: "bg-emerald-100 text-emerald-700" },
  blue: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", chip: "bg-blue-100 text-blue-700" },
  purple: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700", chip: "bg-purple-100 text-purple-700" },
  amber: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", chip: "bg-amber-100 text-amber-700" },
  rose: { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700", chip: "bg-rose-100 text-rose-700" },
  slate: { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-700", chip: "bg-slate-100 text-slate-700" },
};

export default function OfficeInboxTab({
  onNavigate,
}: {
  onNavigate: (tab: string) => void;
}) {
  const pending = trpc.agent.pendingForJeff.useQuery(
    { limit: 50 },
    { refetchInterval: 30_000 }
  );
  const overview = trpc.agent.officeOverview.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const recent = trpc.agent.recentActivity.useQuery(
    { hours: 24 },
    { refetchInterval: 60_000 }
  );

  const pendingItems = pending.data ?? [];
  const summary = overview.data?.summary;
  const todayDone = (recent.data ?? []).filter(
    (r: any) => !r.actionTaken.includes("escalate") && r.outcomeFinalized === 0
  );

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <Header summary={summary} pendingCount={pendingItems.length} />

      <PendingSection
        items={pendingItems}
        loading={pending.isLoading}
        onOpenDeep={(agentName) => onNavigate("autonomous-agents")}
      />

      <CollapsibleSection
        title="今日自動完成"
        subtitle={`${todayDone.length} 件 — 不需要你動作,點開可抽查`}
        icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
        defaultOpen={false}
      >
        {todayDone.length === 0 ? (
          <p className="text-xs text-gray-400 italic">今天還沒有自動完成的動作。</p>
        ) : (
          <ActivityList items={todayDone.slice(0, 30)} />
        )}
      </CollapsibleSection>

      <WeeklyTrend summary={summary} pendingCount={pendingItems.length} />

      <AutoSendSettings />

      <PolicyProposalsPlaceholder />

      <div className="flex items-center justify-between pt-4 border-t border-gray-200 text-xs text-gray-500">
        <span>想跟 agent 聊天 / 看詳細 timeline?</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate("office-chat")}
          className="rounded-lg gap-1.5 h-7"
        >
          進階:辦公群 + DM
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Header — greeting + summary stats
// ────────────────────────────────────────────────────────────────────────

function Header({
  summary,
  pendingCount,
}: {
  summary?: { totalAgents: number; liveCount: number; totalToday: number; totalPending: number };
  pendingCount: number;
}) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 6 ? "深夜了" : hour < 12 ? "早安" : hour < 18 ? "午安" : "晚上好";

  return (
    <Card className="rounded-xl border-gray-200 bg-gradient-to-br from-gray-50 to-white">
      <CardContent className="p-5">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1
              className="text-2xl font-semibold text-gray-900 leading-tight"
              style={{ fontFamily: "'Noto Serif TC', serif" }}
            >
              {greeting},Jeff
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              自動化第一 · 萬不得以才人力 · 品質公平不可犧牲
            </p>
          </div>
          <div className="flex items-center gap-6 text-right">
            <Stat
              label="等你看"
              value={pendingCount}
              tone={pendingCount > 0 ? "warn" : "ok"}
            />
            <Stat label="今日自動完成" value={summary?.totalToday ?? 0} />
            <Stat
              label="員工在線"
              value={summary ? `${summary.liveCount}/${summary.totalAgents}` : "—"}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "warn";
}) {
  const isWarn = tone === "warn" && Number(value) > 0;
  return (
    <div>
      <div
        className={`text-2xl font-bold tabular-nums ${
          isWarn ? "text-rose-600" : "text-gray-900"
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
        {label}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Pending — items requiring Jeff's decision
// ────────────────────────────────────────────────────────────────────────

function PendingSection({
  items,
  loading,
  onOpenDeep,
}: {
  items: any[];
  loading: boolean;
  onOpenDeep: (agentName: string) => void;
}) {
  if (loading) {
    return (
      <Card className="rounded-xl border-gray-200">
        <CardContent className="p-6 text-center text-xs text-gray-400">
          載入中…
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="rounded-xl border-emerald-200 bg-emerald-50/30">
        <CardContent className="p-6 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
          <div>
            <div className="text-sm font-semibold text-gray-900">
              辦公室一片祥和 — 沒有等你看的事
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Agents 自動處理中。有新事務會出現在這裡。
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border-rose-200 bg-gradient-to-br from-rose-50/40 to-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-rose-700">
          <AlertTriangle className="h-4 w-4" />
          待你看 · {items.length} 件
          <span className="text-xs font-normal text-gray-500 ml-2">
            點開後可一鍵 approve / override / 深入
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <PendingRow key={item.outcomeId} item={item} onOpenDeep={onOpenDeep} />
        ))}
      </CardContent>
    </Card>
  );
}

function PendingRow({
  item,
  onOpenDeep,
}: {
  item: any;
  onOpenDeep: (agentName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();
  const ack = trpc.agent.acknowledge.useMutation({
    onSuccess: () => {
      utils.agent.pendingForJeff.invalidate();
      utils.agent.recentActivity.invalidate();
      utils.agent.officeOverview.invalidate();
    },
  });

  const meta = AGENT_LABEL[item.agentName] ?? { label: item.agentName, color: "slate" };
  const tone = TONE[meta.color];
  const isEsc = item.actionTaken.includes("escalate");
  const lowConf = item.confidence != null && item.confidence < 70;
  const summary =
    item.contentSummary ?? (item.content ? item.content.slice(0, 140) : "(無摘要)");

  return (
    <div
      className={`rounded-lg border bg-white p-3 ${
        expanded ? "shadow-sm border-gray-300" : "border-gray-200"
      }`}
    >
      <div
        className="flex items-start gap-3 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
            isEsc
              ? "bg-rose-100 text-rose-700"
              : lowConf
              ? "bg-amber-100 text-amber-700"
              : tone.chip
          } flex-shrink-0 mt-0.5`}
        >
          {isEsc ? "升級" : lowConf ? "低信心" : "需審"}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-0.5">
            <span className={`font-semibold ${tone.text}`}>{meta.label}</span>
            <span>·</span>
            <span>{item.channel ?? "—"}</span>
            <span>·</span>
            <span>
              {new Date(item.createdAt).toLocaleString("zh-TW", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {item.customerEmail && (
              <>
                <span>·</span>
                <span className="font-mono text-[11px]">{item.customerEmail}</span>
              </>
            )}
          </div>
          <p className="text-sm text-gray-900 line-clamp-2">{summary}</p>
        </div>
        <div className="text-right flex-shrink-0">
          {item.confidence != null && (
            <div
              className={`text-sm font-bold tabular-nums ${
                lowConf ? "text-amber-700" : "text-gray-700"
              }`}
            >
              {item.confidence}%
            </div>
          )}
          <ChevronRight
            className={`h-4 w-4 text-gray-400 mt-1 ml-auto transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
          {item.content && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
                客戶原文
              </p>
              <pre className="text-xs whitespace-pre-wrap font-sans bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto leading-relaxed">
                {item.content}
              </pre>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Meta label="分類" value={item.classification ?? "—"} />
            <Meta label="情感" value={item.sentiment ?? "—"} />
            <Meta label="緊急" value={String(item.urgency ?? "—")} />
            <Meta label="動作" value={item.actionTaken} />
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
              你的回覆(可選 — agent 會學)
            </p>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例:這種情況以後可以直接 escalate / 其實這封可以自動回 / 客人想要的不是這個…"
              className="rounded-lg text-xs min-h-[56px]"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenDeep(item.agentName)}
              className="rounded-lg gap-1.5 h-7 text-xs"
            >
              <ExternalLink className="h-3 w-3" />
              到 agent 頁深入
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                ack.mutate({
                  outcomeId: item.outcomeId,
                  verdict: "approved",
                  reason: reason || undefined,
                })
              }
              disabled={ack.isPending}
              className="rounded-lg gap-1.5 h-7 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
            >
              <ThumbsUp className="h-3 w-3" />
              判斷正確
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                ack.mutate({
                  outcomeId: item.outcomeId,
                  verdict: "override",
                  reason: reason || undefined,
                })
              }
              disabled={ack.isPending || !reason.trim()}
              className="rounded-lg gap-1.5 h-7 text-xs text-rose-700 border-rose-300 hover:bg-rose-50"
              title={!reason.trim() ? "請填原因 agent 才能學" : ""}
            >
              <ThumbsDown className="h-3 w-3" />
              我有不同意見
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
        {label}
      </div>
      <div className="text-xs font-semibold text-gray-700 mt-0.5">
        <code className="text-[11px]">{value}</code>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Collapsible section helper
// ────────────────────────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  subtitle,
  icon,
  defaultOpen,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Card className="rounded-xl border-gray-200">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50/60 transition"
      >
        <div className="flex items-center gap-2.5">
          {icon}
          <div className="text-left">
            <div className="text-sm font-bold text-gray-900">{title}</div>
            {subtitle && (
              <div className="text-[11px] text-gray-500">{subtitle}</div>
            )}
          </div>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400" />
        )}
      </button>
      {open && <div className="px-5 pb-4 border-t border-gray-100 pt-3">{children}</div>}
    </Card>
  );
}

function ActivityList({ items }: { items: any[] }) {
  return (
    <div className="space-y-1">
      {items.map((i) => {
        const meta = AGENT_LABEL[i.agentName] ?? { label: i.agentName, color: "slate" };
        const tone = TONE[meta.color];
        return (
          <div
            key={i.outcomeId}
            className="flex items-center gap-3 text-xs py-1.5 border-b border-gray-100 last:border-0"
          >
            <span className="text-gray-400 font-mono text-[10px] w-12 flex-shrink-0">
              {new Date(i.createdAt).toLocaleString("zh-TW", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${tone.chip} flex-shrink-0`}
            >
              {meta.label.replace("Agent", "")}
            </span>
            <div className="flex-1 min-w-0 text-gray-700 truncate">
              {i.contentSummary ?? i.classification ?? i.actionTaken}
            </div>
            <span className="text-[10px] text-gray-400 tabular-nums w-10 text-right">
              {i.confidence != null ? `${i.confidence}%` : "—"}
            </span>
            {i.customerEmail && (
              <span className="text-[10px] text-gray-400 font-mono truncate max-w-[140px]">
                {i.customerEmail}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Weekly trend (lightweight — uses overview summary for now)
// ────────────────────────────────────────────────────────────────────────

function WeeklyTrend({
  summary,
  pendingCount,
}: {
  summary?: {
    totalAgents: number;
    liveCount: number;
    totalToday: number;
    totalPending: number;
  };
  pendingCount: number;
}) {
  // The summary.totalPending mixes Round 81 escalations with tooling-agent
  // failures (e.g. failed Lion bulk imports). For the Inbox we use the
  // actual Round 81 pending count (same source as the top "等你看" stat)
  // so the two numbers always agree. Tooling failures show as a separate
  // stat below.
  const toolingFailures = summary
    ? Math.max(0, summary.totalPending - pendingCount)
    : 0;
  return (
    <Card className="rounded-xl border-gray-200">
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-gray-700" />
          本週數據
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {!summary ? (
          <p className="text-xs text-gray-400 italic">載入中…</p>
        ) : summary.totalToday === 0 && pendingCount === 0 && toolingFailures === 0 ? (
          <p className="text-xs text-gray-400 italic">
            還沒累積到一週的 data — 等 agents 開始接 traffic 就有趨勢可看。
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <TrendStat label="今日動作" value={summary.totalToday} />
            <TrendStat
              label="等你看"
              value={pendingCount}
              tone={pendingCount > 0 ? "warn" : "ok"}
            />
            <TrendStat
              label="工具失敗"
              value={toolingFailures}
              hint={toolingFailures > 0 ? "tooling agent error 累積" : undefined}
              tone={toolingFailures > 0 ? "warn" : "ok"}
            />
            <TrendStat
              label="員工在線"
              value={`${summary.liveCount}/${summary.totalAgents}`}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TrendStat({
  label,
  value,
  hint,
  tone = "ok",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "ok" | "warn";
}) {
  const isWarn = tone === "warn" && Number(value) > 0;
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
        {label}
      </div>
      <div
        className={`text-xl font-bold tabular-nums mt-0.5 ${
          isWarn ? "text-rose-700" : "text-gray-900"
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Policy proposals placeholder (will fill in once retrospective agent runs)
// ────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────
// Auto-send settings — Phase 2 of C workflow
// ────────────────────────────────────────────────────────────────────────

function AutoSendSettings() {
  return (
    <CollapsibleSection
      title="Auto-send 設定 · 每個 agent 的信心門檻"
      subtitle="決定什麼狀況下 agent 直接寄出、什麼狀況進收件匣等你看"
      defaultOpen={false}
    >
      <div className="space-y-3">
        <AutoSendAgentRow agentName="inquiry" label="InquiryAgent" />
        <AutoSendAgentRow agentName="review" label="ReviewAgent" />
        <AutoSendAgentRow agentName="marketing" label="MarketingAgent" />
        <AutoSendAgentRow agentName="followup" label="FollowupAgent" />
        <AutoSendAgentRow
          agentName="refund"
          label="RefundAgent"
          disabledReason="永遠 escalate — 不可開啟"
        />
        <p className="text-[10px] text-gray-400 italic mt-2">
          目前為 Phase 2 — 設定後 agent 會把高 confidence 的 outcomes 標記為「would_auto_send」,
          但<span className="font-semibold">尚未真正寄出</span>。Phase 2.5 會接 Gmail send API。
        </p>
      </div>
    </CollapsibleSection>
  );
}

function AutoSendAgentRow({
  agentName,
  label,
  disabledReason,
}: {
  agentName: "inquiry" | "review" | "marketing" | "followup" | "refund";
  label: string;
  disabledReason?: string;
}) {
  const settings = trpc.agent.getAutoSendSettings.useQuery({ agentName });
  const utils = trpc.useUtils();
  const save = trpc.agent.setAutoSendSettings.useMutation({
    onSuccess: () => settings.refetch(),
  });

  const enabled = settings.data?.enabled ?? false;
  const threshold = settings.data?.minConfidence ?? 85;
  const [localThreshold, setLocalThreshold] = useState<number | null>(null);
  const displayThreshold = localThreshold ?? threshold;

  const toggle = () => {
    if (disabledReason) return;
    save.mutate({ agentName, enabled: !enabled, minConfidence: displayThreshold });
  };
  const commitThreshold = () => {
    if (disabledReason) return;
    if (localThreshold !== null && localThreshold !== threshold) {
      save.mutate({ agentName, enabled, minConfidence: localThreshold });
      setLocalThreshold(null);
    }
  };

  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
      <div className="flex-shrink-0 w-32">
        <div className="text-xs font-bold text-gray-900">{label}</div>
        {disabledReason && (
          <div className="text-[10px] text-rose-600">{disabledReason}</div>
        )}
      </div>
      <button
        onClick={toggle}
        disabled={!!disabledReason || save.isPending}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition flex-shrink-0 ${
          disabledReason
            ? "bg-gray-200 cursor-not-allowed"
            : enabled
            ? "bg-emerald-600"
            : "bg-gray-300"
        }`}
        title={disabledReason ?? (enabled ? "目前開啟" : "目前關閉")}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition ${
            enabled ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </button>
      <div className="flex-1 flex items-center gap-3 min-w-0">
        <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider flex-shrink-0">
          信心 ≥
        </label>
        <input
          type="range"
          min="50"
          max="95"
          step="5"
          value={displayThreshold}
          onChange={(e) => setLocalThreshold(Number(e.target.value))}
          onMouseUp={commitThreshold}
          onTouchEnd={commitThreshold}
          disabled={!!disabledReason || save.isPending}
          className="flex-1 max-w-xs"
        />
        <span className="text-sm font-bold tabular-nums text-gray-900 w-10 text-right">
          {displayThreshold}%
        </span>
      </div>
      <div className="text-[10px] text-gray-400 w-20 text-right">
        {disabledReason ? "—" : enabled ? "已啟用" : "demo only"}
      </div>
    </div>
  );
}

function PolicyProposalsPlaceholder() {
  const proposals = trpc.agent.listPolicyProposals.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const utils = trpc.useUtils();
  const run = trpc.agent.runRetrospective.useMutation({
    onSuccess: () => {
      utils.agent.listPolicyProposals.invalidate();
      utils.agent.unreadMessageCount.invalidate();
    },
  });

  const items = proposals.data ?? [];
  const recent = items[0]; // newest

  return (
    <Card className="rounded-xl border-gray-200">
      <CardHeader className="py-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-gray-700" />
            政策提案 · Self-Retrospective
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run.mutate({ windowDays: 7 })}
            disabled={run.isPending}
            className="rounded-lg gap-1.5 h-7 text-xs"
          >
            {run.isPending ? "分析中…(20-40 秒)" : "📋 請現在分析"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="text-[11px] text-gray-500 italic">
            還沒有 retrospective 報告。點上面按鈕讓 agent 現在分析過去 7 天,或等 Phase 3.5 weekly cron 自動跑。
          </p>
        ) : (
          <ProposalCard msg={recent} />
        )}
        {run.error && (
          <p className="mt-2 text-xs text-rose-700">{run.error.message}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ProposalCard({ msg }: { msg: any }) {
  const [expanded, setExpanded] = useState(true);
  const utils = trpc.useUtils();
  const apply = trpc.agent.applyRetrospectiveProposal.useMutation({
    onSuccess: () => {
      utils.agent.listPolicyProposals.invalidate();
      utils.agent.getActivePolicy.invalidate();
    },
  });
  // QA audit Phase 1 fix: per-message adopted/rejected flag so next
  // retrospective stops re-suggesting the same things.
  const mark = trpc.agent.markProposal.useMutation({
    onSuccess: () => utils.agent.listPolicyProposals.invalidate(),
  });
  const decision: "pending" | "adopted" | "rejected" =
    msg.proposalDecision ?? "pending";

  // Parse the context to extract proposals
  let proposals: any[] = [];
  try {
    const ctx = JSON.parse(msg.context ?? "{}");
    proposals = ctx.proposals ?? [];
  } catch {
    // ignore
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-3">
      <div
        className="flex items-start justify-between gap-2 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0">
          <div className="text-xs font-bold text-gray-900">{msg.title}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            {new Date(msg.createdAt).toLocaleString("zh-TW", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {decision === "adopted" && (
              <span className="ml-2 text-emerald-700 font-semibold">
                ✓ 已採納
              </span>
            )}
            {decision === "rejected" && (
              <span className="ml-2 text-gray-500 font-semibold">
                ✗ 已拒絕
              </span>
            )}
          </div>
        </div>
        <ChevronRight
          className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-200/50 space-y-3">
          <pre className="text-xs whitespace-pre-wrap font-sans text-gray-800 leading-relaxed">
            {msg.body}
          </pre>

          {proposals.length > 0 && decision === "pending" && (
            <div className="space-y-2 pt-2 border-t border-gray-200/50">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                一鍵套用
              </p>
              {proposals.map((p: any, i: number) => (
                <div
                  key={i}
                  className="rounded-md bg-white border border-gray-200 p-2.5 flex items-start justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gray-900">
                      {p.agentName}:{p.proposedRulesDiff}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      信心 {p.confidence}% · {p.reasoning?.slice(0, 100)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() =>
                      apply.mutate({
                        agentName: p.agentName,
                        proposedRules: p.proposedFullRules,
                        reasonNote: `Retrospective approved: ${p.proposedRulesDiff}`,
                        sourceMessageId: msg.id,
                      })
                    }
                    disabled={apply.isPending}
                    className="rounded-lg h-7 text-xs"
                  >
                    {apply.isPending ? "套用中…" : "套用"}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* QA audit Phase 1 fix: per-message decision buttons. Adopted = "I've
              actioned this set", Rejected = "don't bring it up again". Both
              feed proposalDecision so the next Self-Retrospective has context. */}
          {decision === "pending" && (
            <div className="flex items-center gap-2 pt-2 border-t border-gray-200/50">
              <span className="text-[10px] text-gray-500">本組提案總結:</span>
              <Button
                size="sm"
                variant="outline"
                disabled={mark.isPending}
                onClick={() =>
                  mark.mutate({ messageId: msg.id, decision: "adopted" })
                }
                className="rounded-lg h-7 text-xs"
              >
                {mark.isPending ? "標記中…" : "✓ 都採納"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={mark.isPending}
                onClick={() =>
                  mark.mutate({ messageId: msg.id, decision: "rejected" })
                }
                className="rounded-lg h-7 text-xs text-gray-600"
              >
                {mark.isPending ? "標記中…" : "✗ 都不採納"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
