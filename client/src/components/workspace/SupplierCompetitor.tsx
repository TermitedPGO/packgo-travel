/**
 * SupplierCompetitor — 批5 m4 競品每週摘要卡 sub-view.
 *
 * 拍板(2026-06-09):competitor-monitor 縮編為摘要卡,不重建 929 行 tab。
 * 摘要卡(近 7 天告警分組)+ 告警列表(severity 左黑條,mockup notif()
 * 樣式)+ 最小管理(列表/新增/手動爬/刪除)。
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { BtnO, Badge, Pill } from "./ws-ui";
import { formatRelTime } from "./relTime";
import {
  groupRecentAlerts,
  alertRuleClass,
} from "./workspaceSuppliers.helpers";
import { ManageList, AddDialog } from "./SupplierCompetitorManage";

export default function SupplierCompetitor() {
  const { t } = useLocale();
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="space-y-4">
      <WeeklySummary />
      <AlertList />
      <ManageList onAdd={() => setShowAdd(true)} />
      {showAdd && <AddDialog onClose={() => setShowAdd(false)} />}
    </div>
  );
}

/* ───────────────────── 每週摘要卡 ───────────────────── */

function WeeklySummary() {
  const { t } = useLocale();
  const alertsQ = trpc.competitor.alerts.useQuery({ page: 1, pageSize: 100 });
  const unreadQ = trpc.competitor.unreadAlertCount.useQuery();

  const grouped = useMemo(
    () => groupRecentAlerts(alertsQ.data?.alerts ?? [], 7),
    [alertsQ.data],
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold">
          {t("workspace.supCmpWeekly")}
        </span>
        <span className="text-[10px] text-gray-400">
          {t("workspace.supCmpUnread", { n: unreadQ.data ?? 0 })}
        </span>
      </div>
      <div className="p-3">
        {grouped.total === 0 ? (
          <p className="text-[11px] text-gray-400">
            {t("workspace.supCmpQuietWeek")}
          </p>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(grouped.byType).map(([type, n]) => (
              <span
                key={type}
                className="text-[11px] px-2 py-1 rounded-md border border-gray-300 font-medium"
              >
                {t(`workspace.supCmpAt_${type}`)} × {n}
              </span>
            ))}
            <span className="text-[10px] text-gray-400 ml-1">
              {t("workspace.supCmpLast7d", { n: grouped.total })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────── 告警列表 ───────────────────── */

function AlertList() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const alertsQ = trpc.competitor.alerts.useQuery({ page: 1, pageSize: 30 });

  const markMut = trpc.competitor.markAlertRead.useMutation({
    onSuccess: () => {
      utils.competitor.alerts.invalidate();
      utils.competitor.unreadAlertCount.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const markAllMut = trpc.competitor.markAllAlertsRead.useMutation({
    onSuccess: () => {
      utils.competitor.alerts.invalidate();
      utils.competitor.unreadAlertCount.invalidate();
      toast.success(t("workspace.supCmpAllRead"));
    },
    onError: (e) => toast.error(e.message),
  });

  const alerts = alertsQ.data?.alerts ?? [];
  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold">
          {t("workspace.supCmpAlerts")}
        </span>
        <BtnO
          onClick={() => markAllMut.mutate()}
          disabled={markAllMut.isPending}
        >
          {t("workspace.supCmpMarkAll")}
        </BtnO>
      </div>
      <div className="space-y-2">
        {alerts.map((a) => {
          const read = a.isRead === 1;
          const strong = a.severity === "critical" || a.severity === "warning";
          return (
            <div
              key={a.id}
              className={`bg-white rounded-xl border border-gray-200 ${alertRuleClass(a.severity)} border-l-black p-3 ${read ? "opacity-40" : ""}`}
            >
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge>{t(`workspace.supCmpAt_${a.alertType}`)}</Badge>
                    {a.severity === "critical" && (
                      <Pill>{t("workspace.supCmpCritical")}</Pill>
                    )}
                    <span className="text-[10px] text-gray-400">
                      {formatRelTime(a.createdAt, t)}
                    </span>
                  </div>
                  <div
                    className={`text-[12.5px] leading-relaxed break-words ${strong && !read ? "font-semibold" : ""}`}
                  >
                    {a.title}
                  </div>
                  {a.message && (
                    <div className="text-[11px] text-gray-500 mt-0.5 break-words">
                      {a.message}
                    </div>
                  )}
                </div>
                {!read && (
                  <button
                    onClick={() => markMut.mutate({ alertId: a.id })}
                    disabled={markMut.isPending}
                    className="flex-shrink-0 text-[11px] text-gray-400 min-h-[44px] sm:min-h-0"
                  >
                    {t("workspace.supCmpMarkRead")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
