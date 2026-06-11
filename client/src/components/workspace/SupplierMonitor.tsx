/**
 * SupplierMonitor — 批5 m2 行程監控 sub-view.
 *
 * Mockup 後台_07 PAGE 2 (c)(d): source price-change cards (碰錢 → 更新我的
 * 售價 walks the existing tours.update mutation behind a 🔒 gated confirm),
 * newly-soldout cards, generic change cards, and honest error cards.
 * 「維持原價」= workspaceDispositions(monitor_log) — dims the card, never
 * deletes the log.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { PlayCircle } from "lucide-react";
import { BtnO } from "./ws-ui";
import { monitorCardKind } from "./workspaceSuppliers.helpers";
import {
  MonitorLogCard,
  UpdatePriceDialog,
  type MonitorLog,
} from "./SupplierMonitorCards";

export default function SupplierMonitor() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [priceLog, setPriceLog] = useState<MonitorLog | null>(null);

  const statsQ = trpc.tourMonitor.getStats.useQuery();
  const logsQ = trpc.tourMonitor.getRecentLogs.useQuery({ limit: 50 });
  const dispQ = trpc.workspace.listDispositions.useQuery();

  const triggerMut = trpc.tourMonitor.triggerRun.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.supMonRunQueued"));
      utils.tourMonitor.getRecentLogs.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const setDispMut = trpc.workspace.setDisposition.useMutation({
    onSuccess: () => utils.workspace.listDispositions.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const handledSet = useMemo(
    () => new Set(dispQ.data ?? []),
    [dispQ.data],
  );

  const logs = (logsQ.data ?? []) as MonitorLog[];
  // Only actionable cards — ok rows would bury the signal under noise.
  const cards = logs.filter((l) => monitorCardKind(l) !== "ok");

  const stats = statsQ.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-500">{t("workspace.supMonSub")}</p>
        <BtnO
          onClick={() => triggerMut.mutate()}
          disabled={triggerMut.isPending}
        >
          <span className="inline-flex items-center gap-1.5">
            <PlayCircle className="w-3.5 h-3.5" />
            {triggerMut.isPending
              ? t("workspace.supMonRunning")
              : t("workspace.supMonRunNow")}
          </span>
        </BtnO>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <StatBox label={t("workspace.supMonTotal")} value={stats.total} />
          <StatBox label={t("workspace.supMonOk")} value={stats.ok} />
          <StatBox
            label={t("workspace.supMonChanged")}
            value={stats.changed}
            strong={stats.changed > 0}
          />
          <StatBox
            label={t("workspace.supMonError")}
            value={stats.error}
            strong={stats.error > 0}
          />
          <StatBox
            label={t("workspace.supMonUnmonitored")}
            value={stats.unmonitored}
          />
        </div>
      )}

      {logsQ.isLoading && (
        <p className="text-xs text-gray-400 py-4">{t("workspace.loading")}</p>
      )}
      {!logsQ.isLoading && cards.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-400">
          {t("workspace.supMonEmpty")}
        </div>
      )}

      <div className="space-y-2.5">
        {cards.map((log) => (
          <MonitorLogCard
            key={log.id}
            log={log}
            handled={handledSet.has(`monitor_log:${log.id}`)}
            onToggle={(handled) =>
              setDispMut.mutate({ kind: "monitor_log", id: log.id, handled })
            }
            toggleBusy={setDispMut.isPending}
            onUpdatePrice={() => setPriceLog(log)}
          />
        ))}
      </div>

      {priceLog && (
        <UpdatePriceDialog log={priceLog} onClose={() => setPriceLog(null)} />
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      className={`rounded-lg p-2 text-center min-w-0 ${
        strong ? "border-2 border-black" : "border border-gray-200"
      }`}
    >
      <div className="text-base font-bold truncate">{value}</div>
      <div
        className={`text-[10px] truncate ${strong ? "text-gray-500" : "text-gray-400"}`}
      >
        {label}
      </div>
    </div>
  );
}
