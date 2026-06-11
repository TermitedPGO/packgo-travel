/**
 * SystemLogsSections — 批8 系統頁 成本 / 任務記錄 / 審計 三段
 * (split from WorkspaceSystem for the 300-line rule).
 */
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { DollarSign, List, Shield, Bot } from "lucide-react";
import { StateChip } from "./ws-ui";
import { formatRelTime } from "./relTime";
import {
  todaySpend,
  modelShares,
  taskStateOf,
  auditActorKind,
  type LlmCostDay,
} from "./workspaceSystem.helpers";

export default function SystemLogsSections() {
  return (
    <>
      <CostSection />
      <TaskSection />
      <AuditSection />
    </>
  );
}

function Head({ icon: Icon, title }: { icon: typeof List; title: string }) {
  return (
    <h3 className="text-[12px] font-semibold mb-2 flex items-center gap-1.5">
      <Icon className="w-4 h-4" />
      {title}
    </h3>
  );
}

/* ── AI 成本 ── */

function CostSection() {
  const { t } = useLocale();
  const costQ = trpc.admin.llmCostReport.useQuery({ days: 30 });
  const data = costQ.data;
  if (!data) return null;

  const days = (data.days ?? []) as LlmCostDay[];
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const today = todaySpend(days, todayStr);
  const shares = modelShares(days);

  return (
    <section>
      <Head icon={DollarSign} title={t("workspace.sysCost")} />
      <div className="grid grid-cols-3 gap-3 mb-2">
        <CostTile label={t("workspace.sysCostToday")} value={today} />
        <CostTile label={t("workspace.sysCost30d")} value={data.totalUSD} />
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-center min-w-0">
          <div className="text-lg font-bold truncate">
            {data.totalCalls.toLocaleString()}
          </div>
          <div className="text-[10px] text-gray-400">
            {t("workspace.sysCostCalls")}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">
        {shares.map((s) => `${s.model} ${s.pct}%`).join(" · ")}
        {shares.length > 0 && " · "}
        {t("workspace.sysCacheHit", {
          n: Math.round((data.cacheHitRate ?? 0) * 100),
        })}
      </p>
    </section>
  );
}

function CostTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 text-center min-w-0">
      <div className="text-lg font-bold truncate">${value.toFixed(2)}</div>
      <div className="text-[10px] text-gray-400">{label}</div>
    </div>
  );
}

/* ── 任務記錄 ── */

function TaskSection() {
  const { t } = useLocale();
  const taskQ = trpc.admin.getTaskHistory.useQuery({ limit: 10 });
  const logs = taskQ.data?.logs ?? [];
  if (taskQ.isLoading || logs.length === 0) return null;

  return (
    <section>
      <Head icon={List} title={t("workspace.sysTasks")} />
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100 text-[12px]">
        {logs.map((l) => (
          <div
            key={l.id}
            className="grid grid-cols-[0.8fr_2.2fr_0.8fr] gap-2 px-3 py-2.5 items-center min-w-0"
          >
            <div className="text-gray-500 truncate">
              {formatRelTime(l.startedAt, t)}
            </div>
            <div className="min-w-0">
              <span className="truncate block">
                {l.taskTitle}
                <span className="text-gray-400"> · {l.agentName}</span>
              </span>
              {l.status === "failed" && l.errorMessage && (
                <span className="text-[11px] font-medium break-words block mt-0.5">
                  {l.errorMessage}
                </span>
              )}
            </div>
            <div className="flex justify-end">
              <StateChip state={taskStateOf(l.status)} />
              {l.status === "completed" && (
                <span className="text-[10px] text-gray-400">
                  {l.processingTimeMs != null
                    ? `${(l.processingTimeMs / 1000).toFixed(1)}s`
                    : "ok"}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── 審計日誌 ── */

function AuditSection() {
  const { t } = useLocale();
  const auditQ = trpc.system.auditLogList.useQuery({ limit: 10 });
  const items = auditQ.data?.items ?? [];
  if (auditQ.isLoading || items.length === 0) return null;

  return (
    <section>
      <Head icon={Shield} title={t("workspace.sysAudit")} />
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100 text-[12px]">
        {items.map((a) => {
          const isAgent = auditActorKind(a) === "agent";
          return (
            <div
              key={a.id}
              className="grid grid-cols-[0.8fr_0.9fr_2.4fr] gap-2 px-3 py-2.5 items-center min-w-0"
            >
              <div className="text-gray-500 truncate">
                {formatRelTime(a.createdAt, t)}
              </div>
              <div className="min-w-0">
                {isAgent ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full border border-gray-300 text-gray-600 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-3 h-3" />
                    </span>
                    <span className="text-gray-500">agent</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-black text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                      {(a.userEmail ?? "?").charAt(0).toUpperCase()}
                    </span>
                    <span className="font-medium truncate">
                      {a.userEmail ?? "—"}
                    </span>
                  </span>
                )}
              </div>
              <div className="min-w-0 truncate">
                {a.action}
                {a.targetType && (
                  <span className="text-gray-400">
                    {" "}
                    · {a.targetType}
                    {a.targetId ? ` #${a.targetId}` : ""}
                  </span>
                )}
                {a.success === 0 && (
                  <span className="font-semibold">
                    {" "}
                    · {t("workspace.sysAuditFailed")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
