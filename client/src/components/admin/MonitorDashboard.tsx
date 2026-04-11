import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

// ── Types ────────────────────────────────────────────────────
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
  checkedAt: Date;
  runId: string | null;
};

type MonitorStats = {
  total: number;
  ok: number;
  changed: number;
  error: number;
  unmonitored: number;
};

// ── Stat Card ────────────────────────────────────────────────
function StatCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ElementType;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  );
}

// ── Log Row ──────────────────────────────────────────────────
function LogRow({ log }: { log: MonitorLog }) {
  const [expanded, setExpanded] = useState(false);

  const statusColor =
    log.status === "ok"
      ? "bg-green-100 text-green-700"
      : log.status === "changed"
        ? "bg-yellow-100 text-yellow-700"
        : log.status === "error"
          ? "bg-red-100 text-red-700"
          : "bg-gray-100 text-gray-600";

  const checkedAt = new Date(log.checkedAt).toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 bg-white cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status */}
        <Badge className={`text-xs px-2 py-0.5 ${statusColor} border-0 min-w-[56px] justify-center`}>
          {log.status === "ok" ? "正常" : log.status === "changed" ? "變動" : log.status === "error" ? "錯誤" : log.status}
        </Badge>

        {/* Change indicator */}
        {log.changeDetected && (
          <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
        )}

        {/* Tour title */}
        <span className="text-sm font-medium text-gray-800 flex-1 truncate">
          {log.tourTitle || `行程 #${log.tourId}`}
        </span>

        {/* Change summary */}
        {log.changeSummary && (
          <span className="text-xs text-gray-500 truncate max-w-[200px]">{log.changeSummary}</span>
        )}

        {/* Time */}
        <span className="text-xs text-gray-400 flex-shrink-0">{checkedAt}</span>

        {/* Expand */}
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-3 bg-gray-50 border-t border-gray-100 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-500">行程 ID：</span>
              <span className="text-gray-800 font-mono">{log.tourId}</span>
            </div>
            <div>
              <span className="text-gray-500">檢查類型：</span>
              <span className="text-gray-800">{log.checkType}</span>
            </div>
            {log.priceChange && (
              <div className="col-span-2">
                <span className="text-gray-500">價格變動：</span>
                <span className="text-yellow-700 font-medium">{log.priceChange}</span>
              </div>
            )}
            {log.seatsChange && (
              <div className="col-span-2">
                <span className="text-gray-500">座位變動：</span>
                <span className="text-blue-700 font-medium">{log.seatsChange}</span>
              </div>
            )}
            {log.runId && (
              <div className="col-span-2">
                <span className="text-gray-500">Run ID：</span>
                <span className="text-gray-600 font-mono text-[10px]">{log.runId}</span>
              </div>
            )}
          </div>
          {log.rawResponse && (
            <details className="text-xs">
              <summary className="text-gray-500 cursor-pointer hover:text-gray-700">查看原始回應</summary>
              <pre className="mt-1 p-2 bg-white border border-gray-200 rounded text-[10px] overflow-auto max-h-32 text-gray-700">
                {log.rawResponse}
              </pre>
            </details>
          )}
          <a
            href={`/tours/${log.tourId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            查看行程頁面
          </a>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────
export default function MonitorDashboard() {
  const [logLimit, setLogLimit] = useState(50);

  // tRPC queries
  const { data: stats, refetch: refetchStats } = trpcAny.tourMonitor.getStats.useQuery();
  const {
    data: logs,
    isLoading: logsLoading,
    refetch: refetchLogs,
  } = trpcAny.tourMonitor.getRecentLogs.useQuery({ limit: logLimit });
  const { data: latestRun, refetch: refetchLatestRun } = trpcAny.tourMonitor.getLatestRun.useQuery();

  // Trigger manual run
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
      toast.error(`觸發失敗：${err.message}`);
    },
  });

  const handleRefresh = () => {
    refetchStats();
    refetchLogs();
    refetchLatestRun();
    toast.success("已重新整理");
  };

  const statsData: MonitorStats = stats ?? { total: 0, ok: 0, changed: 0, error: 0, unmonitored: 0 };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">供應商監控儀表板</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            每日凌晨 3:00 自動檢查行程出發日期、座位、價格變動
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-1.5" />
            重新整理
          </Button>
          <Button
            size="sm"
            onClick={() => triggerRun.mutate()}
            disabled={triggerRun.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {triggerRun.isPending ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Activity className="w-4 h-4 mr-1.5" />
            )}
            手動觸發監控
          </Button>
        </div>
      </div>

      {/* Latest Run Info */}
      {latestRun && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center gap-3 text-sm">
          <Clock className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <span className="text-blue-700">
            上次監控：
            <span className="font-medium ml-1">
              {new Date((latestRun as any).checkedAt || Date.now()).toLocaleString("zh-TW")}
            </span>
            {(latestRun as any).runId && (
              <span className="text-blue-500 ml-2 font-mono text-xs">#{(latestRun as any).runId?.slice(-8)}</span>
            )}
          </span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="總行程數" value={statsData.total} color="bg-gray-500" icon={Activity} />
        <StatCard label="正常" value={statsData.ok} color="bg-green-500" icon={CheckCircle2} />
        <StatCard label="有變動" value={statsData.changed} color="bg-yellow-500" icon={AlertTriangle} />
        <StatCard label="錯誤" value={statsData.error} color="bg-red-500" icon={XCircle} />
        <StatCard label="未監控" value={statsData.unmonitored} color="bg-gray-400" icon={Clock} />
      </div>

      {/* Recent Logs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">最近監控記錄</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">顯示</span>
            {[50, 100, 200].map((n) => (
              <button
                key={n}
                onClick={() => setLogLimit(n)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  logLimit === n
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                }`}
              >
                {n}
              </button>
            ))}
            <span className="text-xs text-gray-500">筆</span>
          </div>
        </div>

        {logsLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <span className="text-sm">載入中...</span>
          </div>
        ) : !logs || logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Activity className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">尚無監控記錄</p>
            <p className="text-xs mt-1">點擊「手動觸發監控」開始第一次檢查</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(logs as unknown as MonitorLog[]).map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
