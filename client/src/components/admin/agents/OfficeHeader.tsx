/**
 * Office status bar — top of the autonomous-agents tab (Phase 5 module 5B).
 */
import { Building2 } from "lucide-react";

export function OfficeHeader({
  pendingCount,
  todayCount,
  weekCount,
}: {
  pendingCount: number;
  todayCount: number;
  weekCount: number;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-black p-2.5">
          <Building2 className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-gray-900">你的 AI 辦公室</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            原則:自動化第一 · 萬不得以才人力 · 品質公平不可犧牲
          </p>
        </div>
        <div className="flex items-center gap-6 text-right">
          <HeaderStat
            label="等你看"
            value={pendingCount}
            tone={pendingCount > 0 ? "warn" : "ok"}
          />
          <HeaderStat label="今日動作" value={todayCount} />
          <HeaderStat label="48 小時內" value={weekCount} />
        </div>
      </div>
    </div>
  );
}

function HeaderStat({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  return (
    <div>
      <div
        className={`text-2xl font-bold tabular-nums ${
          tone === "warn" && value > 0 ? "text-rose-600" : "text-gray-900"
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
