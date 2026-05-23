/**
 * Bank txn swipe triage — Mobile Phase 5 (2026-05-22).
 *
 * Tinder-style card stack for clearing the review-pile fast.
 *
 *   - Card view: 1 transaction full-screen
 *   - Swipe RIGHT → confirm AI category + next
 *   - Swipe LEFT  → mark personal/exclude + next
 *   - Tap pill   → override category + next
 *   - Tap card body → open full BankTxDrawerForm (desktop drawer reused)
 *   - Bottom action bar: pause (skip) / 排除個人 / 確認
 *
 * URL state ?triageIdx=N persists position so accidental close resumes.
 * Inline swipe via touch events — no extra dependency.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X, SkipForward, Sparkles, ChevronLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type TxRow = {
  id: number;
  date: string | Date;
  amount: string | number;
  isoCurrencyCode?: string | null;
  merchantName?: string | null;
  description?: string | null;
  agentCategory?: string | null;
  agentConfidence?: number | null;
  agentReasoning?: string | null;
  jeffOverrideCategory?: string | null;
  counterparty?: string | null;
  purposeNote?: string | null;
};

const QUICK_CATEGORIES: Array<{ id: string; label: string; accent: string }> = [
  { id: "cogs_tour", label: "供應商付款", accent: "bg-blue-100 text-blue-800" },
  { id: "income_booking", label: "客戶收入", accent: "bg-green-100 text-green-800" },
  { id: "expense_marketing", label: "行銷", accent: "bg-purple-100 text-purple-800" },
  { id: "expense_software", label: "軟體", accent: "bg-cyan-100 text-cyan-800" },
  { id: "expense_office", label: "辦公", accent: "bg-slate-100 text-slate-800" },
  { id: "expense_travel", label: "差旅", accent: "bg-amber-100 text-amber-800" },
  { id: "refund", label: "退款", accent: "bg-rose-100 text-rose-800" },
  { id: "transfer", label: "內轉", accent: "bg-gray-100 text-gray-800" },
];

const fmt = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

export default function BankTriagePage({ onExit }: { onExit: () => void }) {
  const [idx, setIdx] = useState<number>(() => {
    const u = new URL(window.location.href);
    const v = parseInt(u.searchParams.get("triageIdx") ?? "0", 10);
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  });

  const utils = trpc.useUtils();
  const txns = trpc.plaid.transactionsList.useQuery({
    limit: 200,
    includeExcluded: false,
  });

  const update = trpc.plaid.transactionUpdate.useMutation({
    onSuccess: () => {
      utils.plaid.transactionsList.invalidate();
      utils.plaid.financeKpi.invalidate();
    },
    onError: (e) => toast.error(`儲存失敗: ${e.message}`),
  });

  const pile = useMemo<TxRow[]>(() => {
    const items = (txns.data?.items ?? []) as any[];
    return items.filter(
      (t) =>
        !t.jeffOverrideCategory &&
        (!t.agentCategory || t.agentCategory === "other_review"),
    );
  }, [txns.data]);

  const current = pile[idx];

  // Persist position so accidental close resumes
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("triageIdx", String(idx));
    window.history.replaceState({}, "", u.toString());
  }, [idx]);

  const advance = () => setIdx((i) => i + 1);

  const confirmAI = () => {
    if (!current?.agentCategory) {
      advance();
      return;
    }
    void update.mutateAsync({
      transactionId: current.id,
      category: current.agentCategory,
    });
    advance();
  };

  const overrideCategory = (cat: string) => {
    if (!current) return;
    void update.mutateAsync({
      transactionId: current.id,
      category: cat,
    });
    advance();
  };

  const markExcluded = () => {
    if (!current) return;
    void update.mutateAsync({
      transactionId: current.id,
      exclude: true,
      reason: "標為個人 — mobile triage",
    });
    advance();
  };

  // Swipe gesture handling
  const [dragX, setDragX] = useState(0);
  const startX = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    setDragX(e.touches[0].clientX - startX.current);
  };
  const onTouchEnd = () => {
    const threshold = 100;
    if (dragX > threshold) {
      confirmAI();
    } else if (dragX < -threshold) {
      markExcluded();
    }
    setDragX(0);
    startX.current = null;
  };

  if (txns.isLoading) {
    return (
      <div className="px-4 py-12 text-center text-gray-500">載入中…</div>
    );
  }

  if (!current) {
    return (
      <div className="px-4 py-12 text-center">
        <div className="text-5xl mb-3">🎉</div>
        <h2 className="text-lg font-bold text-gray-900 mb-1">
          全部清完！
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          沒有 review-pile 了。回今日總覽看看其他事項。
        </p>
        <button
          type="button"
          onClick={onExit}
          className="px-4 h-10 rounded-lg bg-teal-600 text-white text-sm font-medium"
        >
          回今日
        </button>
      </div>
    );
  }

  const amount = Number(current.amount);
  const isOutflow = amount > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header strip */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-1 text-sm text-gray-600"
        >
          <ChevronLeft className="w-4 h-4" />
          離開
        </button>
        <div className="text-xs text-gray-500 tabular-nums">
          {idx + 1} / {pile.length}
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 px-4 py-4 flex items-center">
        <div
          className="w-full rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-transform"
          style={{
            transform: `translateX(${dragX}px) rotate(${dragX * 0.04}deg)`,
            opacity: 1 - Math.abs(dragX) / 600,
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Date + amount */}
          <div className="mb-3">
            <div className="text-xs text-gray-500">
              {new Date(current.date).toLocaleDateString("zh-TW", {
                month: "long",
                day: "numeric",
                weekday: "short",
              })}
            </div>
            <div
              className={cn(
                "text-3xl font-bold tabular-nums mt-1",
                isOutflow ? "text-red-600" : "text-green-600",
              )}
            >
              {isOutflow ? "-" : "+"}
              {fmt(Math.abs(amount))}
            </div>
          </div>

          {/* Merchant + description */}
          <div className="mb-3 space-y-1">
            <div className="text-base font-semibold text-gray-900 break-words">
              {current.merchantName || current.description || "(未知)"}
            </div>
            {current.counterparty && current.counterparty !== current.merchantName && (
              <div className="text-xs text-gray-600">
                對方: {current.counterparty}
              </div>
            )}
          </div>

          {/* AI suggestion */}
          {current.agentCategory && (
            <div className="rounded-xl bg-teal-50 border border-teal-100 p-3 mb-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-teal-600" />
                  <span className="text-xs font-semibold text-teal-800">
                    AI: {current.agentCategory}
                  </span>
                </div>
                {typeof current.agentConfidence === "number" && (
                  <span className="text-xs text-teal-700 tabular-nums">
                    {current.agentConfidence}%
                  </span>
                )}
              </div>
              {current.agentReasoning && (
                <p className="text-xs text-teal-800 leading-relaxed line-clamp-4">
                  {current.agentReasoning}
                </p>
              )}
            </div>
          )}

          {/* Purpose hint */}
          {current.purposeNote && (
            <div className="text-xs text-gray-600 italic mb-3 leading-relaxed">
              「{current.purposeNote}」
            </div>
          )}

          {/* Quick category pills */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
              改類別
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => overrideCategory(c.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-medium",
                    c.accent,
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Swipe hint */}
          {Math.abs(dragX) > 30 && (
            <div
              className={cn(
                "absolute top-1/2 -translate-y-1/2 text-2xl font-bold rounded-lg px-3 py-1",
                dragX > 0
                  ? "right-12 text-emerald-600 border-2 border-emerald-600"
                  : "left-12 text-rose-600 border-2 border-rose-600",
              )}
              style={{ opacity: Math.min(1, Math.abs(dragX) / 100) }}
            >
              {dragX > 0 ? "確認" : "排除"}
            </div>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="flex-shrink-0 grid grid-cols-3 gap-2 p-3 border-t border-gray-100 bg-white">
        <button
          type="button"
          onClick={markExcluded}
          className="h-12 rounded-xl bg-rose-50 text-rose-700 font-medium text-sm flex items-center justify-center gap-1.5 active:bg-rose-100"
        >
          <X className="w-4 h-4" /> 排除個人
        </button>
        <button
          type="button"
          onClick={advance}
          className="h-12 rounded-xl bg-gray-100 text-gray-700 font-medium text-sm flex items-center justify-center gap-1.5 active:bg-gray-200"
        >
          <SkipForward className="w-4 h-4" /> 跳過
        </button>
        <button
          type="button"
          onClick={confirmAI}
          disabled={!current.agentCategory}
          className="h-12 rounded-xl bg-emerald-600 text-white font-medium text-sm flex items-center justify-center gap-1.5 active:bg-emerald-700 disabled:opacity-50"
        >
          <Check className="w-4 h-4" /> 確認 AI
        </button>
      </div>
    </div>
  );
}
