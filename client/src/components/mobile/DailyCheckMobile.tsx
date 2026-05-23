/**
 * Mobile-tuned daily check page — Mobile Phase 2 (2026-05-22).
 *
 * Renders the "今日" landing on phones. Above-the-fold = the 4 most
 * actionable signals:
 *   1. Greeting (晚安 Jeff · 5/22 星期五)
 *   2. KpiStrip — 6 KPI horizontal scroll (本月 賺/付/淨/待 Jeff/訂金/YTD)
 *   3. 「需要你決定」block — agent escalations + uncategorized > $50
 *   4. 24h activity feed
 *
 * Below-the-fold: 2 quick action buttons (AI categorize, receipt camera).
 *
 * Wraps existing tRPC queries (no new backend): agent.listMessages,
 * plaid.transactionsList (for review-pile preview), gmail (if available).
 */

import { useMemo } from "react";
import { Sparkles, ChevronRight, Clock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import KpiStrip from "./KpiStrip";
import { toast } from "sonner";

const fmt = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

export default function DailyCheckMobile({
  onNavigate,
}: {
  onNavigate: (page: string) => void;
}) {
  // Greeting based on hour
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 5 ? "深夜" : hour < 12 ? "早安" : hour < 18 ? "下午好" : "晚安";
  const dateLabel = `${now.getMonth() + 1}/${now.getDate()} · ${
    ["週日", "週一", "週二", "週三", "週四", "週五", "週六"][now.getDay()]
  }`;

  // Activity feed — last 24h of agent messages
  const activity = trpc.agent.listMessages.useQuery(
    { agentName: undefined as any, limit: 12 },
    { refetchInterval: 60_000 },
  );

  // Review-pile preview — uncategorized + other_review with absolute amount > $50
  const txns = trpc.plaid.transactionsList.useQuery({
    limit: 200,
    includeExcluded: false,
  });

  const utils = trpc.useUtils();
  const classifyMut = trpc.plaid.classifyBatch.useMutation({
    onSuccess: (r) => {
      utils.plaid.transactionsList.invalidate();
      utils.plaid.financeKpi.invalidate();
      toast.success(`AI 跑完: ${r.succeeded} 成功 / ${r.failed} 失敗`);
    },
    onError: (e) => toast.error(`AI 分類失敗: ${e.message}`),
  });

  // High-priority items: uncategorized + |amount| > 50
  const highPriority = useMemo(() => {
    const items = txns.data?.items ?? [];
    return items
      .filter(
        (t) =>
          (!t.agentCategory || t.agentCategory === "other_review") &&
          t.excludeFromAccounting === 0 &&
          Math.abs(Number(t.amount)) > 50,
      )
      .sort((a, b) => Math.abs(Number(b.amount)) - Math.abs(Number(a.amount)))
      .slice(0, 5);
  }, [txns.data]);

  const totalReviewPile = useMemo(() => {
    const items = txns.data?.items ?? [];
    return items.filter(
      (t) =>
        (!t.agentCategory || t.agentCategory === "other_review") &&
        t.excludeFromAccounting === 0,
    ).length;
  }, [txns.data]);

  return (
    <div className="space-y-4 px-4 py-4">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{greeting}, Jeff</h1>
        <p className="text-sm text-gray-500 mt-0.5">{dateLabel}</p>
      </div>

      {/* KpiStrip */}
      <div className="-mx-4">
        <KpiStrip
          onSelectCard={(id) => {
            if (id === "needs-review" || id === "income" || id === "expenses" || id === "net" || id === "ytd")
              onNavigate("bank-ledger");
            else if (id === "trust") onNavigate("reconciliation");
          }}
        />
      </div>

      {/* 需要你決定 */}
      {totalReviewPile > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-amber-900">
              ⚠️ 需要你決定 · {totalReviewPile} 筆
            </h2>
            <button
              type="button"
              onClick={() => onNavigate("bank-ledger")}
              className="text-xs text-amber-700 font-medium flex items-center gap-1"
            >
              全部 <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <ul className="space-y-1.5">
            {highPriority.map((t) => {
              const amt = Number(t.amount);
              return (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="text-gray-700 truncate flex-1">
                    {t.merchantName || t.description || "(unknown)"}
                  </span>
                  <span
                    className={
                      amt > 0 ? "text-red-600 font-semibold tabular-nums" : "text-green-600 font-semibold tabular-nums"
                    }
                  >
                    {amt > 0 ? "-" : "+"}
                    {fmt(Math.abs(amt))}
                  </span>
                </li>
              );
            })}
          </ul>
          {totalReviewPile > 5 && (
            <p className="text-[10px] text-amber-700 mt-2">
              …還有 {totalReviewPile - 5} 筆。點「全部」進入逐筆 swipe 分類。
            </p>
          )}
        </div>
      )}

      {/* 24h activity feed */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-500" />
          最近 24 小時
        </h2>
        {activity.isLoading ? (
          <div className="text-xs text-gray-400 py-2">載入中…</div>
        ) : (activity.data ?? []).length === 0 ? (
          <div className="text-xs text-gray-400 py-2">
            沒有新動靜 — agents + Plaid + Gmail 都安靜
          </div>
        ) : (
          <ul className="space-y-2">
            {(activity.data ?? []).slice(0, 8).map((m: any) => {
              const created = new Date(m.createdAt);
              const ago = formatTimeAgo(created);
              return (
                <li
                  key={m.id}
                  className="flex items-start gap-2 text-xs leading-relaxed"
                >
                  <span className="text-gray-400 tabular-nums shrink-0 w-12">
                    {ago}
                  </span>
                  <div className="flex-1 min-w-0">
                    {m.agentName && (
                      <span className="text-teal-700 font-medium">#{m.agentName}</span>
                    )}
                    <span className="text-gray-700 ml-1 break-words">
                      {(m.message || m.text || "").slice(0, 80)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Quick action buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => {
            const u = new URL(window.location.href);
            u.searchParams.set("triage", "1");
            window.history.replaceState({}, "", u.toString());
            onNavigate("bank-ledger");
          }}
          disabled={totalReviewPile === 0}
          className="rounded-xl border border-teal-200 bg-teal-50 text-teal-700 p-4 flex flex-col items-start gap-1 text-left active:scale-95 transition-transform disabled:opacity-50"
        >
          <Sparkles className="w-5 h-5" />
          <span className="text-sm font-semibold">逐筆 swipe 分類</span>
          <span className="text-[10px] opacity-70">
            {totalReviewPile} 筆 · 滑動確認
          </span>
        </button>
        <button
          type="button"
          onClick={() => classifyMut.mutate({ limit: 50 })}
          disabled={classifyMut.isPending || totalReviewPile === 0}
          className="rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 p-4 flex flex-col items-start gap-1 text-left active:scale-95 transition-transform disabled:opacity-50"
        >
          <Sparkles className="w-5 h-5" />
          <span className="text-sm font-semibold">
            {classifyMut.isPending ? "AI 跑中…" : "AI 批次 50 筆"}
          </span>
          <span className="text-[10px] opacity-70">背景跑 ~2 分鐘</span>
        </button>
      </div>
    </div>
  );
}

function formatTimeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}
