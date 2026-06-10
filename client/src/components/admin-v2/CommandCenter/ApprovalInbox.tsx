/**
 * ApprovalInbox — 指揮中心 通用審核箱 (S-4).
 *
 * ONE generic inbox shared by every lane (cs / quote / marketing / finance).
 * The parent <CommandCenterTab> swaps the `lane` prop to filter; passing
 * `undefined` shows every lane mixed (the 全部 view).
 *
 * Policy (proposal §3, enforced server-side in commandCenter router):
 *   - auto      → low risk, batchable → the「一鍵全送」bulk button approves
 *                 every auto task in one shot.
 *   - review    → look per item, approve from the review dialog.
 *   - hard_gate → money / irreversible. NEVER bulk. The review dialog forces
 *                 an explicit confirm toggle before 通過 unlocks.
 *
 * The spine ships a read-only payload preview (see ./lanes). Lane-specific
 * editing (cs draft body, quote line items …) lands when P1-P4 extend
 * LanePayloadPreview — the inbox itself stays lane-agnostic.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import {
  DataTable,
  StatusDot,
  EmptyState,
  type Column,
  type StatusTone,
} from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { Inbox, RefreshCw, Send } from "lucide-react";
import type { ApprovalLane, ApprovalTaskRow, RiskLevel } from "./types";
import ReviewTaskDialog from "./ReviewTaskDialog";

const RISK_TONE: Record<RiskLevel, StatusTone> = {
  auto: "muted",
  review: "info",
  hard_gate: "danger",
};

const RISK_I18N: Record<RiskLevel, string> = {
  auto: "admin.commandCenter.riskAuto",
  review: "admin.commandCenter.riskReview",
  hard_gate: "admin.commandCenter.riskHardGate",
};

const LANE_I18N: Record<ApprovalLane, string> = {
  cs: "admin.commandCenter.laneCs",
  quote: "admin.commandCenter.laneQuote",
  marketing: "admin.commandCenter.laneMarketing",
  finance: "admin.commandCenter.laneFinance",
};

export default function ApprovalInbox({ lane }: { lane?: ApprovalLane }) {
  const { t, language } = useLocale();
  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.commandCenter.list.useQuery({
    lane,
    status: "pending",
  });
  const rows = (data ?? []) as ApprovalTaskRow[];

  const [selected, setSelected] = useState<ApprovalTaskRow | null>(null);

  const bulkApprove = trpc.commandCenter.bulkApprove.useMutation();
  const busy = bulkApprove.isPending;

  const invalidate = () => {
    utils.commandCenter.list.invalidate();
    utils.commandCenter.stats.invalidate();
  };

  // Only auto-risk tasks are eligible for one-click bulk send. review +
  // hard_gate are excluded here (server also blocks hard_gate defensively).
  const autoIds = useMemo(
    () => rows.filter((r) => r.riskLevel === "auto").map((r) => r.id),
    [rows],
  );

  function openTask(row: ApprovalTaskRow) {
    setSelected(row);
  }

  function closeTask() {
    setSelected(null);
  }

  async function handleBulk() {
    if (!autoIds.length) return;
    try {
      const res = await bulkApprove.mutateAsync({ ids: autoIds });
      toast.success(
        t("admin.commandCenter.toastBulkResult", {
          approved: String(res.approved.length),
          blocked: String(res.blocked.length),
        }),
      );
      invalidate();
    } catch {
      toast.error(t("admin.commandCenter.toastError"));
    }
  }

  const dateLocale = language === "en" ? "en-US" : "zh-TW";
  const formatDate = (d: string | Date) =>
    new Date(d).toLocaleString(dateLocale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const laneColumn: Column<ApprovalTaskRow> = {
    key: "lane",
    header: t("admin.commandCenter.colLane"),
    width: "w-24",
    sortable: true,
    sortValue: (r) => r.lane,
    render: (r) => (
      <span className="text-xs text-gray-600">{t(LANE_I18N[r.lane])}</span>
    ),
  };

  const columns: Column<ApprovalTaskRow>[] = [
    {
      key: "title",
      header: t("admin.commandCenter.colTitle"),
      render: (r) => (
        <span className="text-gray-900 font-medium truncate">{r.title}</span>
      ),
      sortable: true,
      sortValue: (r) => r.title,
    },
    // Lane column only matters in the mixed 全部 view.
    ...(lane ? [] : [laneColumn]),
    {
      key: "riskLevel",
      header: t("admin.commandCenter.colRisk"),
      width: "w-28",
      sortable: true,
      sortValue: (r) => r.riskLevel,
      render: (r) => (
        <StatusDot
          tone={RISK_TONE[r.riskLevel]}
          label={t(RISK_I18N[r.riskLevel])}
        />
      ),
    },
    {
      key: "createdBy",
      header: t("admin.commandCenter.colCreatedBy"),
      width: "w-32",
      render: (r) => (
        <span className="text-xs text-gray-500 truncate">{r.createdBy}</span>
      ),
    },
    {
      key: "createdAt",
      header: t("admin.commandCenter.colCreatedAt"),
      width: "w-32",
      align: "right",
      sortable: true,
      sortValue: (r) => new Date(r.createdAt).getTime(),
      render: (r) => (
        <span className="text-xs text-gray-500 tabular-nums">
          {formatDate(r.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* Toolbar: one-click auto send + refresh */}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={handleBulk}
          disabled={busy || autoIds.length === 0}
          className="h-8 rounded-lg gap-1.5"
        >
          <Send className="h-3.5 w-3.5" />
          {t("admin.commandCenter.bulkSend", { n: String(autoIds.length) })}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="h-8 rounded-lg gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("common.refresh")}
        </Button>
      </div>

      {/* Table or empty state */}
      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title={t("admin.commandCenter.inboxEmpty")}
          description={t("admin.commandCenter.inboxEmptyDesc")}
        />
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          loading={isLoading}
          onRowClick={openTask}
          selectedId={selected?.id}
        />
      )}

      {/* Shared review flow — same dialog the workspace 今日待辦 uses. */}
      <ReviewTaskDialog
        task={selected}
        onClose={closeTask}
        onDecided={invalidate}
      />
    </div>
  );
}
