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

/* ───────────────────────── m2: 行程監控卡 ───────────────────────── */

export type MonitorLogLike = {
  status: string;
  priceChanged: number | null;
  previousStatus: string | null;
  currentStatus: string | null;
  seatsChanged: number | null;
  hasChanges: number | null;
};

export type MonitorCardKind = "error" | "price" | "soldout" | "change" | "ok";

/**
 * Classify a monitor log row into its card type. Priority order matters:
 * a failed check is an error card even if it also recorded changes; a price
 * change outranks a generic change; newly-soldout outranks seats noise.
 */
export function monitorCardKind(log: MonitorLogLike): MonitorCardKind {
  if (log.status === "failed") return "error";
  if (log.priceChanged === 1) return "price";
  if (log.currentStatus === "soldout" && log.previousStatus !== "soldout")
    return "soldout";
  if (log.hasChanges === 1 || log.seatsChanged === 1) return "change";
  return "ok";
}

/** Δ% between source prices, rounded; null when not computable. */
export function priceDeltaPct(
  prev: number | null | undefined,
  curr: number | null | undefined,
): number | null {
  if (prev == null || curr == null || prev <= 0) return null;
  return Math.round(((curr - prev) / prev) * 100);
}
