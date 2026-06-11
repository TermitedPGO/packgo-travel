/**
 * SupplierSync — 批5 m1 同步狀態 sub-view (split out of WorkspaceSuppliers
 * to keep files under the 300-line rule).
 *
 * Per-supplier mirror cards (counts + latest run KPI), recent run list with
 * honest failure rows, and the 立即同步 dialog → suppliers.triggerSync.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { RefreshCw, Building2 } from "lucide-react";
import { BtnB, BtnO, Kv, Pill, StateChip, Badge } from "./ws-ui";
import { formatRelTime } from "./relTime";
import {
  runStateOf,
  latestRunBySupplier,
  fmtDuration,
} from "./workspaceSuppliers.helpers";

export default function SupplierSync() {
  const { t } = useLocale();
  const [showSync, setShowSync] = useState(false);

  const overviewQ = trpc.suppliers.overview.useQuery();
  const runsQ = trpc.suppliers.recentRuns.useQuery({ limit: 20 });

  const runs = runsQ.data ?? [];
  const latest = latestRunBySupplier(
    runs.map((r) => ({ ...r, supplierCode: r.supplierCode ?? "" })),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-500">{t("workspace.supSyncSub")}</p>
        <BtnO onClick={() => setShowSync(true)}>
          <span className="inline-flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            {t("workspace.supSyncNow")}
          </span>
        </BtnO>
      </div>

      {overviewQ.isLoading && (
        <p className="text-xs text-gray-400 py-4">{t("workspace.loading")}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(overviewQ.data ?? []).map((s) => {
          const run = latest[s.code];
          return (
            <div
              key={s.id}
              className="rounded-xl border border-gray-200 bg-white overflow-hidden min-w-0"
            >
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold flex items-center gap-1.5 min-w-0">
                  <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{s.displayName}</span>
                  <Badge>{s.code}</Badge>
                </span>
                <span className="text-[10px] text-gray-400 flex-shrink-0">
                  {s.lastFullSyncAt
                    ? `${t("workspace.supLastFull")} ${formatRelTime(s.lastFullSyncAt, t)}`
                    : t("workspace.supNeverSynced")}
                </span>
              </div>
              <div className="p-3 space-y-2.5">
                <div className="grid grid-cols-3 gap-2">
                  <KpiBox label={t("workspace.supActive")} value={s.counts.active ?? 0} />
                  <KpiBox label={t("workspace.supHidden")} value={s.counts.hidden ?? 0} />
                  <KpiBox label={t("workspace.supProducts")} value={s.counts.total ?? 0} />
                </div>
                {run ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-gray-500">
                        {t("workspace.supLatestRun")}
                      </span>
                      <Pill>{t(`workspace.supRunKind_${run.kind}`)}</Pill>
                      <StateChip state={runStateOf(run.status)} />
                      <span className="text-[10px] text-gray-400">
                        {formatRelTime(run.startedAt, t)}
                      </span>
                    </div>
                    <Kv k={t("workspace.supScanned")} v={run.productsScanned ?? 0} />
                    <Kv k={t("workspace.supAdded")} v={run.productsAdded ?? 0} />
                    <Kv
                      k={t("workspace.supDuration")}
                      v={fmtDuration(run.durationMs)}
                      muted
                    />
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400">
                    {t("workspace.supNoRuns")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <RecentRunsList runs={runs} />

      {showSync && <SyncDialog onClose={() => setShowSync(false)} t={t} />}
    </div>
  );
}

function KpiBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 p-2 text-center min-w-0">
      <div className="text-base font-bold truncate">
        {Number(value).toLocaleString()}
      </div>
      <div className="text-[10px] text-gray-400 truncate">{label}</div>
    </div>
  );
}

function RecentRunsList({
  runs,
}: {
  runs: {
    id: number;
    supplierName: string | null;
    kind: string;
    status: string;
    startedAt: Date | string;
    productsScanned: number | null;
    productsAdded: number | null;
    errorMessage: string | null;
    durationMs: number | null;
  }[];
}) {
  const { t } = useLocale();
  if (runs.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100">
        <span className="text-[12px] font-semibold">
          {t("workspace.supRecentRuns")}
        </span>
      </div>
      <div className="divide-y divide-gray-100">
        {runs.map((r) => {
          const failed = r.status === "failed" || r.status === "partial";
          return (
            <div
              key={r.id}
              className={`px-3 py-2 flex items-start gap-2.5 min-w-0 ${
                failed ? "border-l-4 border-l-black" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-medium">
                    {r.supplierName}
                  </span>
                  <Pill>{t(`workspace.supRunKind_${r.kind}`)}</Pill>
                  <StateChip state={runStateOf(r.status)} />
                  <span className="text-[10px] text-gray-400">
                    {formatRelTime(r.startedAt, t)}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {t("workspace.supScanned")} {r.productsScanned ?? 0} ·{" "}
                  {t("workspace.supAdded")} {r.productsAdded ?? 0}
                  {r.durationMs != null && ` · ${fmtDuration(r.durationMs)}`}
                </div>
                {failed && r.errorMessage && (
                  <div className="text-[11px] font-medium mt-1 break-words">
                    {r.errorMessage}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── 立即同步 dialog ───────────────────────── */

function SyncDialog({
  onClose,
  t,
}: {
  onClose: () => void;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  const utils = trpc.useUtils();
  const [kind, setKind] = useState<"full" | "lion-only" | "uv-only">("full");

  const syncMut = trpc.suppliers.triggerSync.useMutation({
    onSuccess: (res) => {
      utils.suppliers.recentRuns.invalidate();
      toast.success(t("workspace.supSyncQueued", { id: res.jobId ?? "" }));
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-md shadow-lg">
        <h3 className="text-sm font-semibold mb-1">
          {t("workspace.supSyncNow")}
        </h3>
        <p className="text-[11px] text-gray-500 mb-4">
          {t("workspace.supSyncHint")}
        </p>

        <label className="text-[11px] text-gray-500 mb-1 block">
          {t("workspace.supSyncKind")}
        </label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-base sm:text-sm"
        >
          <option value="full">{t("workspace.supSyncFull")}</option>
          <option value="lion-only">{t("workspace.supSyncLion")}</option>
          <option value="uv-only">{t("workspace.supSyncUv")}</option>
        </select>

        <div className="flex justify-end gap-2 mt-5">
          <BtnO onClick={onClose}>{t("workspace.supCancel")}</BtnO>
          <BtnB
            onClick={() => syncMut.mutate({ kind })}
            disabled={syncMut.isPending}
          >
            {syncMut.isPending
              ? t("workspace.supSyncQueueing")
              : t("workspace.supSyncGo")}
          </BtnB>
        </div>
      </div>
    </div>
  );
}
