/**
 * v2 Wave 2 Module 2.12 — shared primitives for TourEditDialog split.
 *
 * Extracted verbatim from the original 2,156 LOC monolith. Only contents that
 * are used by more than one tab (or by the orchestrator) live here.
 */
import { Loader2 } from "lucide-react";

/**
 * Round 80.21 — detect AI placeholder values that the agents write when
 * they couldn't extract a real value. We render those as empty in the
 * form (so the field shows its placeholder hint instead of leaking the
 * AI's "I don't know" string back to the user).
 */
export function isAiPlaceholder(value: any): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Common placeholders the agents emit. Exact match only — we don't
  // want to nuke a real city named "未知" (extremely rare but possible).
  const placeholders = new Set([
    "待確認",
    "未知",
    "不明",
    "TBD",
    "TBC",
    "N/A",
    "n/a",
    "NA",
    "Unknown",
    "unknown",
    "-",
    "—",
    "?",
    "？",
  ]);
  return placeholders.has(trimmed);
}

/**
 * Round 80.21 — SaveStatusBadge.
 *
 * Top-right pill that surfaces save state without making the user hunt
 * for it. Three states:
 *   ● 全部儲存 — gray, calm baseline (clean editedData == initial)
 *   ● 儲存中 — gold, animated spinner (mutation pending)
 *   ● 未儲存 — black + gold dot, attention-grabbing (dirty fields)
 *
 * Replaces the silent "you might have lost work" UX where Jeff could only
 * tell something was unsaved by trying to close the dialog and waiting
 * for the confirm() prompt.
 */
export function SaveStatusBadge({
  isDirty,
  isSaving,
}: {
  isDirty: boolean;
  isSaving: boolean;
}) {
  if (isSaving) {
    return (
      <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#c9a563]/15 border border-[#c9a563]/40 text-[#8a6f3a] text-xs font-semibold">
        <Loader2 className="h-3 w-3 animate-spin" />
        儲存中
      </span>
    );
  }
  if (isDirty) {
    return (
      <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-foreground/5 border border-foreground/30 text-foreground text-xs font-semibold">
        <span
          className="h-1.5 w-1.5 rounded-full bg-[#c9a563]"
          aria-hidden
        />
        未儲存
      </span>
    );
  }
  return (
    <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-gray-500 text-xs font-medium">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
      全部儲存
    </span>
  );
}
