/**
 * workspaceSuppliers.helpers — pure logic for the 批5 supplier page.
 *
 * Kept out of the component so Vitest can import the real implementation
 * (same pattern as customerInbox.helpers.ts).
 */
import type { CardState } from "./ws-ui";

/** supplierSyncRuns.status → workspace card state language. */
export function runStateOf(status: string): CardState {
  if (status === "running") return "running";
  if (status === "success") return "done";
  if (status === "failed") return "err";
  if (status === "partial") return "err";
  return "none";
}

export type SyncRunLike = {
  supplierCode: string;
  startedAt: Date | string;
};

/**
 * Pick the most recent run per supplier from a desc-sorted run list.
 * (recentRuns already returns newest-first; first hit per code wins.)
 */
export function latestRunBySupplier<T extends SyncRunLike>(
  runs: T[],
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const r of runs) {
    if (!(r.supplierCode in out)) out[r.supplierCode] = r;
  }
  return out;
}

/** Compact duration: 900 → "0.9s", 12_000 → "12s", 95_000 → "1m35s". */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s - m * 60)}s`;
}
