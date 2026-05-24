/**
 * MonitorDashboardV2 — Trip.com-style supplier sync monitor (Round 81 v2).
 *
 * The v1 dashboard mixed:
 *   - colored stat cards (total / ok / changed / error / unmonitored)
 *   - expandable log rows with status badge fills
 *
 * V2 reuses the unified primitives:
 *   - KPIStrip across the top for the 5 stat tiles
 *   - 36px DataTable rows + StatusDot for status
 *   - Sheet drawer for error details + raw payload + "view tour" link
 *
 * StatusDot tone mapping (per spec):
 *   - ok      → success
 *   - changed → warn
 *   - error   → danger
 *   - other   → muted
 *
 * Backend wire: trpc.tourMonitor.{getStats,getRecentLogs,getLatestRun,
 * triggerRun} — no changes.
 *
 * Simplification vs v1: dropped the inline 50 / 100 / 200 toggle for limit;
 * V2 always loads the default 100 rows and the table itself is sortable.
 * Keeps the toolbar dense and matches the other V2 tabs' pattern.
 *
 * Phase E tab #7.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import {
  DataTable,
  StatusDot,
  EmptyState,
  KPIStrip,
  type Column,
  type StatusTone,
  type KPI,
} from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import {
  Activity,
  RefreshCw,
  Search,
  X,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Play,
} from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

type MonitorStatus = "ok" | "changed" | "error" | "unmonitored";

type MonitorLog = {
  id: number;
  tourId: number;
  tourTitle: string | null;
  checkType: string;
  status: string;
  changeDetected: boolean | null;
  changeSummary: string | null;
  priceChange: string | null;
  seatsChange: string | null;
  rawResponse: string | null;
  monitoredAt?: string | Date | null;
  createdAt?: string | Date | null;
  runId: string | null;
};

type MonitorStats = {
  total: number;
  ok: number;
  changed: number;
  error: number;
  unmonitored: number;
};

const STATUS_TONE: Record<string, StatusTone> = {
  ok: "success",
  changed: "warn",
  error: "danger",
  unmonitored: "muted",
};

function statusLabel(s: string, t: (k: string) => string): string {
  if (s === "ok") return t("admin.monitorDashboard.statusOk");
  if (s === "changed") return t("admin.monitorDashboard.statusChanged");
  if (s === "error") return t("admin.monitorDashboard.statusError");
  return s || "—";
}

// Tab pill toggle — same shape as BookingsTabV2.StatusToggle.
function StatusToggle({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: StatusTone;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={`h-7 px-2.5 rounded-md text-xs font-medium border transition-colors inline-flex items-center gap-1.5 ${
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
      }`}
    >
      {tone && !active && <StatusDot tone={tone} size="xs" />}
      <span>{label}</span>
      <span
        className={`tabular-nums ${active ? "text-white/70" : "text-gray-400"}`}
      >
        {count}
      </span>
    </button>
  );
}

export default function MonitorDashboardV2() {
  const { t, language } = useLocale();
  const [statusFilter, setStatusFilter] = useState<"all" | MonitorStatus>(
    "all",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: stats, refetch: refetchStats } =
    trpcAny.tourMonitor.getStats.useQuery();
  const {
    data: logs,
    isLoading: logsLoading,
    refetch: refetchLogs,
  } = trpcAny.tourMonitor.getRecentLogs.useQuery({ limit: 100 });
  const { data: latestRun, refetch: refetchLatestRun } =
    trpcAny.tourMonitor.getLatestRun.useQuery();

  const triggerRun = trpcAny.tourMonitor.triggerRun.useMutation({
    onSuccess: (data: { message: string }) => {
      toast.success(data.message);
      setTimeout(() => {
        refetchStats();
        refetchLogs();
        refetchLatestRun();
      }, 3000);
    },
    onError: (err: { message: string }) => {
      toast.error(
        t("admin.monitorDashboard.toastTriggerFailed", { err: err.message }),
      );
    },
  });

  const handleRefresh = () => {
    refetchStats();
    refetchLogs();
    refetchLatestRun();
    toast.success(t("admin.monitorDashboard.toastRefreshed"));
  };

  const statsData: MonitorStats = (stats as MonitorStats | undefined) ?? {
    total: 0,
    ok: 0,
    changed: 0,
    error: 0,
    unmonitored: 0,
  };

  // Tab counts driven by recent logs (not the static tours table) so the
  // filter chips reflect the visible time-window.
  const logCounts = useMemo(() => {
    const list = (logs ?? []) as MonitorLog[];
    return {
      all: list.length,
      ok: list.filter((l) => l.status === "ok").length,
      changed: list.filter((l) => l.status === "changed").length,
      error: list.filter((l) => l.status === "error").length,
      unmonitored: list.filter(
        (l) => l.status !== "ok" && l.status !== "changed" && l.status !== "error",
      ).length,
    };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    let out = (logs ?? []) as MonitorLog[];
    if (statusFilter !== "all") {
      if (statusFilter === "unmonitored") {
        out = out.filter(
          (l) =>
            l.status !== "ok" && l.status !== "changed" && l.status !== "error",
        );
      } else {
        out = out.filter((l) => l.status === statusFilter);
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      out = out.filter(
        (l) =>
          String(l.id).includes(q) ||
          String(l.tourId).includes(q) ||
          (l.tourTitle ?? "").toLowerCase().includes(q) ||
          (l.changeSummary ?? "").toLowerCase().includes(q),
      );
    }
    return out;
  }, [logs, statusFilter, searchQuery]);

  const selected = useMemo(
    () =>
      selectedId !== null
        ? ((logs ?? []) as MonitorLog[]).find((l) => l.id === selectedId)
        : null,
    [selectedId, logs],
  );

  const dateLocale = language === "en" ? "en-US" : "zh-TW";
  const formatTime = (d: string | Date | null | undefined) => {
    if (!d) return "—";
    return new Date(d).toLocaleString(dateLocale, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const kpis: KPI[] = [
    {
      label: t("admin.monitorDashboard.statTotal"),
      value: statsData.total,
    },
    {
      label: t("admin.monitorDashboard.statOk"),
      value: statsData.ok,
      tone: "success",
    },
    {
      label: t("admin.monitorDashboard.statChanged"),
      value: statsData.changed,
      tone: statsData.changed > 0 ? "warn" : undefined,
    },
    {
      label: t("admin.monitorDashboard.statError"),
      value: statsData.error,
      tone: statsData.error > 0 ? "danger" : undefined,
    },
    {
      label: t("admin.monitorDashboard.statUnmonitored"),
      value: statsData.unmonitored,
    },
  ];

  const columns: Column<MonitorLog & { id: number }>[] = [
    {
      key: "time",
      header: t("admin.monitorDashboard.detailCheckType").replace(":", ""),
      width: "w-32",
      sortable: true,
      sortValue: (l) => {
        const ts = l.monitoredAt || l.createdAt;
        return ts ? new Date(ts).getTime() : 0;
      },
      render: (l) => (
        <span className="text-xs text-gray-500 tabular-nums">
          {formatTime(l.monitoredAt || l.createdAt)}
        </span>
      ),
    },
    {
      key: "tour",
      header: t("admin.monitorDashboard.detailTourId").replace(":", ""),
      sortable: true,
      sortValue: (l) => l.tourTitle ?? String(l.tourId),
      render: (l) => (
        <div className="min-w-0 flex items-center gap-1.5">
          {l.changeDetected && (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          )}
          <span className="text-gray-900 truncate font-medium">
            {l.tourTitle ||
              t("admin.monitorDashboard.rowFallbackTitle", {
                id: String(l.tourId),
              })}
          </span>
        </div>
      ),
    },
    {
      key: "checkType",
      header: t("admin.monitorDashboard.detailCheckType").replace(":", ""),
      width: "w-24",
      render: (l) => (
        <span className="text-xs text-gray-700">{l.checkType || "—"}</span>
      ),
    },
    {
      key: "summary",
      header: t("admin.monitorDashboard.detailPriceChange").replace(":", ""),
      render: (l) => (
        <span className="text-xs text-gray-600 truncate block">
          {l.changeSummary || "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: t("admin.bookingsTab.columnStatus"),
      width: "w-24",
      sortable: true,
      sortValue: (l) => l.status,
      render: (l) => (
        <StatusDot
          tone={STATUS_TONE[l.status] ?? "muted"}
          label={statusLabel(l.status, t)}
        />
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* Header row: filter chips + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusToggle
            label={t("admin.bookingsTab.statAll")}
            count={logCounts.all}
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
          <StatusToggle
            label={t("admin.monitorDashboard.statusOk")}
            count={logCounts.ok}
            active={statusFilter === "ok"}
            tone="success"
            onClick={() => setStatusFilter("ok")}
          />
          <StatusToggle
            label={t("admin.monitorDashboard.statusChanged")}
            count={logCounts.changed}
            active={statusFilter === "changed"}
            tone="warn"
            onClick={() => setStatusFilter("changed")}
          />
          <StatusToggle
            label={t("admin.monitorDashboard.statusError")}
            count={logCounts.error}
            active={statusFilter === "error"}
            tone="danger"
            onClick={() => setStatusFilter("error")}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("admin.bookingsTab.searchPlaceholder")}
              className="h-8 rounded-lg pl-8 text-xs w-56"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                aria-label={t("common.clear")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="h-8 rounded-lg gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("common.refresh")}
          </Button>
          <Button
            size="sm"
            onClick={() => triggerRun.mutate()}
            disabled={triggerRun.isPending}
            className="h-8 rounded-lg gap-1.5"
          >
            {triggerRun.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {t("admin.monitorDashboard.triggerButton")}
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <KPIStrip items={kpis} />

      {/* Latest run banner */}
      {latestRun ? (
        <div className="text-xs text-gray-500 px-1">
          {t("admin.monitorDashboard.lastRunPrefix")}{" "}
          <span className="text-gray-700 tabular-nums">
            {formatTime(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (latestRun as any).monitoredAt ||
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (latestRun as any).createdAt ||
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (latestRun as any).checkedAt,
            )}
          </span>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {(latestRun as any).runId && (
            <span className="ml-2 font-mono text-[10px] text-gray-400">
              #{
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (latestRun as any).runId?.slice(-8)
              }
            </span>
          )}
        </div>
      ) : null}

      {/* Table */}
      {!logsLoading && filteredLogs.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" />}
          title={t("admin.monitorDashboard.emptyTitle")}
          description={t("admin.monitorDashboard.emptyDesc")}
        />
      ) : (
        <DataTable
          data={filteredLogs}
          columns={columns}
          loading={logsLoading}
          onRowClick={(l) => {
            setSelectedId(l.id);
            setDrawerOpen(true);
          }}
          selectedId={selectedId ?? undefined}
        />
      )}

      {/* Detail drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full xl:max-w-5xl xl:rounded-l-xl overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-gray-100">
            <SheetTitle className="text-base flex items-center gap-2">
              <span className="text-gray-500 tabular-nums font-normal">
                #{selected?.id ?? ""}
              </span>
              <span>
                {selected?.tourTitle ||
                  (selected
                    ? t("admin.monitorDashboard.rowFallbackTitle", {
                        id: String(selected.tourId),
                      })
                    : "")}
              </span>
            </SheetTitle>
            <SheetDescription className="sr-only">
              {selected?.changeSummary ?? ""}
            </SheetDescription>
          </SheetHeader>

          {selected && (
            <div className="space-y-5 py-4">
              {/* Status + retry */}
              <div className="flex items-center justify-between gap-2">
                <StatusDot
                  tone={STATUS_TONE[selected.status] ?? "muted"}
                  label={statusLabel(selected.status, t)}
                />
                {selected.status === "error" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => triggerRun.mutate()}
                    disabled={triggerRun.isPending}
                    className="h-7 rounded-lg text-xs gap-1.5"
                  >
                    {triggerRun.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    {t("admin.monitorDashboard.triggerButton")}
                  </Button>
                )}
              </div>

              {/* Core info */}
              <div className="space-y-2">
                <SectionTitle>
                  {t("admin.monitorDashboard.sectionRecent")}
                </SectionTitle>
                <Field label={t("admin.monitorDashboard.detailTourId").replace(":", "")}>
                  {selected.tourId}
                </Field>
                <Field
                  label={t("admin.monitorDashboard.detailCheckType").replace(":", "")}
                >
                  {selected.checkType || "—"}
                </Field>
                <Field label={t("admin.bookingsTab.createdAt", { date: "" }).replace("{date}", "").trim() || t("admin.monitorDashboard.lastRunPrefix")}>
                  {formatTime(selected.monitoredAt || selected.createdAt)}
                </Field>
                {selected.runId && (
                  <Field
                    label={t("admin.monitorDashboard.detailRunId").replace(":", "")}
                  >
                    <span className="font-mono text-[10px]">
                      {selected.runId}
                    </span>
                  </Field>
                )}
              </div>

              {/* Changes */}
              {(selected.priceChange || selected.seatsChange || selected.changeSummary) && (
                <div className="space-y-2">
                  <SectionTitle>
                    {t("admin.monitorDashboard.detailPriceChange").replace(":", "")}
                  </SectionTitle>
                  {selected.changeSummary && (
                    <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-lg p-3">
                      {selected.changeSummary}
                    </p>
                  )}
                  {selected.priceChange && (
                    <Field
                      label={t("admin.monitorDashboard.detailPriceChange").replace(":", "")}
                    >
                      <span className="text-amber-700 font-medium">
                        {selected.priceChange}
                      </span>
                    </Field>
                  )}
                  {selected.seatsChange && (
                    <Field
                      label={t("admin.monitorDashboard.detailSeatsChange").replace(":", "")}
                    >
                      <span className="text-blue-700 font-medium">
                        {selected.seatsChange}
                      </span>
                    </Field>
                  )}
                </div>
              )}

              {/* Raw payload */}
              {selected.rawResponse && (
                <div className="space-y-1.5">
                  <SectionTitle>
                    {t("admin.monitorDashboard.detailViewRaw")}
                  </SectionTitle>
                  <pre className="text-[10px] text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-auto max-h-48">
                    {selected.rawResponse}
                  </pre>
                </div>
              )}

              {/* Footer actions */}
              <div className="pt-3 border-t border-gray-100 flex items-center gap-2">
                <a
                  href={`/tours/${selected.tourId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t("admin.monitorDashboard.detailViewTour")}
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDrawerOpen(false)}
                  className="ml-auto h-8 rounded-lg gap-1"
                >
                  <X className="h-3.5 w-3.5" />
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400 font-semibold">
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className="text-xs text-gray-900 text-right break-words">
        {children}
      </span>
    </div>
  );
}
