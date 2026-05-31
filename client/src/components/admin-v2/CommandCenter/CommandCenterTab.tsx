/**
 * CommandCenterTab — 指揮中心 shell (S-4).
 *
 * Three blocks per design.md §2: 狀態 (status strip) / 審核箱 (approval inbox)
 * / 班表 (schedule). v1 focuses on the 審核箱; status is a thin pending-count
 * strip and 班表 is a placeholder until a later phase.
 *
 * The 審核箱 reuses one generic <ApprovalInbox> for every lane — the lane
 * chips just swap the `lane` prop. Lanes cs/quote/marketing/finance fill in
 * their payload previews + executors in P1-P4 (server/_core/approvalTasks.ts).
 */
import { useState, lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { PageHeader, KPIStrip, type KPI } from "@/components/admin/primitives";
import { CalendarClock } from "lucide-react";
import ApprovalInbox from "./ApprovalInbox";

const MarketingComposer = lazy(() => import("./MarketingComposer"));
const FinanceDashboard = lazy(() => import("./FinanceDashboard"));

type LaneFilter = "all" | "cs" | "quote" | "marketing" | "finance";

const LANES: LaneFilter[] = ["all", "cs", "quote", "marketing", "finance"];

const LANE_I18N: Record<LaneFilter, string> = {
  all: "admin.commandCenter.laneAll",
  cs: "admin.commandCenter.laneCs",
  quote: "admin.commandCenter.laneQuote",
  marketing: "admin.commandCenter.laneMarketing",
  finance: "admin.commandCenter.laneFinance",
};

export default function CommandCenterTab() {
  const { t } = useLocale();
  const [lane, setLane] = useState<LaneFilter>("all");

  const { data: stats } = trpc.commandCenter.stats.useQuery();

  const kpis: KPI[] = [
    {
      label: t("admin.commandCenter.kpiTotalPending"),
      value: stats?.totalPending ?? 0,
      tone: (stats?.totalPending ?? 0) > 0 ? "warn" : "muted",
    },
    {
      label: t("admin.commandCenter.laneCs"),
      value: stats?.pendingByLane.cs ?? 0,
    },
    {
      label: t("admin.commandCenter.laneQuote"),
      value: stats?.pendingByLane.quote ?? 0,
    },
    {
      label: t("admin.commandCenter.laneMarketing"),
      value: stats?.pendingByLane.marketing ?? 0,
    },
    {
      label: t("admin.commandCenter.laneFinance"),
      value: stats?.pendingByLane.finance ?? 0,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.commandCenter.title")}
        caption={t("admin.commandCenter.caption")}
      />

      {/* ── 狀態 block ───────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">
          {t("admin.commandCenter.statusBlock")}
        </h2>
        <KPIStrip items={kpis} />
      </section>

      {/* ── 審核箱 block ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">
            {t("admin.commandCenter.inboxBlock")}
          </h2>
          <div className="flex items-center gap-1.5 flex-wrap">
            {LANES.map((l) => {
              const count =
                l === "all"
                  ? stats?.totalPending ?? 0
                  : stats?.pendingByLane[l] ?? 0;
              const active = lane === l;
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLane(l)}
                  className={`h-7 px-2.5 rounded-md text-xs font-medium border transition-colors inline-flex items-center gap-1.5 ${
                    active
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                  }`}
                >
                  <span>{t(LANE_I18N[l])}</span>
                  <span
                    className={`tabular-nums ${
                      active ? "text-white/70" : "text-gray-400"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {lane === "marketing" && (
          <Suspense fallback={null}>
            <MarketingComposer />
          </Suspense>
        )}
        {/* Finance dashboard — shown above the inbox when finance lane is active */}
        {lane === "finance" && (
          <Suspense fallback={null}>
            <FinanceDashboard />
          </Suspense>
        )}
        <ApprovalInbox lane={lane === "all" ? undefined : lane} />
      </section>

      {/* ── 班表 block (v1 placeholder) ─────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">
          {t("admin.commandCenter.scheduleBlock")}
        </h2>
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 p-6 text-center">
          <div className="mb-2 flex justify-center text-gray-400">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div className="text-sm text-gray-500">
            {t("admin.commandCenter.scheduleComingSoon")}
          </div>
        </div>
      </section>
    </div>
  );
}
