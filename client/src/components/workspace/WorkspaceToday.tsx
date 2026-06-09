/**
 * WorkspaceToday — 今日待辦 roll-up board (faithful to mockup
 * admin-inbox-integrated.html / admin-full-pages.html PAGE 1).
 *
 *   serif「下午好,Jeff」greeting + date/counts line
 *   3 buckets: 需要你決定 / 處理中·等外部 / 看一下就好
 *   each item = ws-ui WorkspaceCard with 未處理 / 處理好了 toggle
 *
 * Data is REAL: commandCenter.list (approval tasks) queried PER STATUS so the
 * 需要你決定 bucket can never silently drop an old pending task off a shared
 * limit window (limit applies after the status filter, not before). 看一下就好
 * is a bounded recent window (newest 20 approved + 20 failed), not a full
 * history dump. 處理好了 persisted via workspace.setDisposition. The mockup's
 * customer-item buckets that have no clean data source yet render an honest
 * empty line rather than fabricated demo cards.
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { RefreshCw } from "lucide-react";
import { formatRelTime } from "./relTime";
import {
  Greeting,
  GroupHeader,
  WorkspaceCard,
  type CardState,
} from "./ws-ui";

type Lane = "cs" | "quote" | "marketing" | "finance";

const LANE_BADGE_KEY: Record<Lane, string> = {
  cs: "workspace.laneCs",
  quote: "workspace.laneQuote",
  marketing: "workspace.laneMarketing",
  finance: "workspace.laneFinance",
};

/** finance / marketing tasks are company-wide; cs / quote belong to a customer. */
function laneIsCompany(lane: string): boolean {
  return lane === "finance" || lane === "marketing";
}

/** Keep the jump chip short — long labels (emails) get an ellipsis. */
function shortLabel(label: string, max = 12): string {
  return label.length > max ? `${label.slice(0, max)}…` : label;
}

export default function WorkspaceToday({
  onJumpToCustomer,
}: {
  /** open that customer's inbox (sidebar view switch, wired by Workspace). */
  onJumpToCustomer?: (userId: number) => void;
} = {}) {
  const { t } = useLocale();
  const { user } = useAuth();
  const decideQ = trpc.commandCenter.list.useQuery({
    status: "pending",
    limit: 200,
  });
  const inflightQ = trpc.commandCenter.list.useQuery({
    status: "sent",
    limit: 200,
  });
  const approvedQ = trpc.commandCenter.list.useQuery({
    status: "approved",
    limit: 20,
  });
  const failedQ = trpc.commandCenter.list.useQuery({
    status: "failed",
    limit: 20,
  });
  const statsQ = trpc.commandCenter.stats.useQuery();
  const dispQ = trpc.workspace.listDispositions.useQuery();
  const utils = trpc.useUtils();

  type Task = NonNullable<typeof decideQ.data>[number];

  const setDisposition = trpc.workspace.setDisposition.useMutation({
    onSuccess: () => {
      utils.workspace.listDispositions.invalidate();
      // per-customer inboxes render the same tasks — keep them in sync
      utils.admin.customerOpenItems.invalidate();
    },
  });

  const handled = useMemo(
    () => new Set(dispQ.data ?? []),
    [dispQ.data],
  );

  const decide = decideQ.data ?? [];
  const inflight = inflightQ.data ?? [];
  const fyi = useMemo(
    () =>
      [...(approvedQ.data ?? []), ...(failedQ.data ?? [])]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .slice(0, 30),
    [approvedQ.data, failedQ.data],
  );

  const pendingCount = statsQ.data?.totalPending ?? decide.length;
  const line = t("workspace.todayLine", {
    decide: pendingCount,
    inflight: inflight.length,
  });

  const toggle = (id: number, currentlyHandled: boolean) =>
    setDisposition.mutate({ kind: "task", id, handled: !currentlyHandled });

  const renderCard = (task: Task, baseState: CardState, waitLabel?: string) => {
    const isHandled = handled.has(`task:${task.id}`);
    const lane = task.lane;
    const canJump = task.who?.userId != null && onJumpToCustomer != null;
    return (
      <WorkspaceCard
        key={task.id}
        type={
          LANE_BADGE_KEY[lane as Lane] ? t(LANE_BADGE_KEY[lane as Lane]) : lane
        }
        emphasize={task.riskLevel === "hard_gate"}
        lock={task.riskLevel === "hard_gate"}
        who={task.who?.label}
        whoCompany={laneIsCompany(lane)}
        time={formatRelTime(task.createdAt, t)}
        state={
          isHandled ? "done" : task.status === "failed" ? "err" : baseState
        }
        waitLabel={waitLabel}
        jumpLabel={
          canJump
            ? t("workspace.jumpTo", { name: shortLabel(task.who!.label) })
            : undefined
        }
        onJump={
          canJump ? () => onJumpToCustomer!(task.who!.userId!) : undefined
        }
        handled={isHandled}
        onToggle={() => toggle(task.id, isHandled)}
        toggleBusy={
          setDisposition.isPending && setDisposition.variables?.id === task.id
        }
      >
        <div className="font-medium">{task.title}</div>
        {task.summary && (
          <div className="text-gray-500 mt-0.5 text-[12px]">
            {task.summary}
          </div>
        )}
      </WorkspaceCard>
    );
  };

  // unhandled first within each bucket
  const sortHandled = (a: Task, b: Task) => {
    const ah = handled.has(`task:${a.id}`) ? 1 : 0;
    const bh = handled.has(`task:${b.id}`) ? 1 : 0;
    return ah - bh;
  };

  const loading = decideQ.isLoading || dispQ.isLoading;

  return (
    <div className="space-y-5">
      <Greeting
        name={user?.name || user?.email || ""}
        line={loading ? t("workspace.loading") : line}
        right={
          <button
            onClick={() => {
              utils.commandCenter.list.invalidate();
              statsQ.refetch();
              dispQ.refetch();
            }}
            className="text-xs text-gray-500 flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t("workspace.refresh")}
          </button>
        }
      />

      <div>
        <GroupHeader title={t("workspace.todayPending")} count={decide.length} />
        {decide.length === 0 ? (
          <div className="text-[12px] text-gray-400 py-2">
            {t("workspace.todayEmptyDecide")}
          </div>
        ) : (
          <div className="space-y-2.5">
            {[...decide]
              .sort(sortHandled)
              .map((task) => renderCard(task, "decide"))}
          </div>
        )}
      </div>

      <div>
        <GroupHeader
          title={t("workspace.todayInflight")}
          count={inflight.length}
        />
        {inflight.length === 0 ? (
          <div className="text-[12px] text-gray-400 py-2">
            {t("workspace.todayEmptyBucket")}
          </div>
        ) : (
          <div className="space-y-2.5">
            {[...inflight]
              .sort(sortHandled)
              .map((task) => renderCard(task, "wait", t("workspace.waitSent")))}
          </div>
        )}
      </div>

      <div>
        <GroupHeader title={t("workspace.todayFyi")} count={fyi.length} />
        {fyi.length === 0 ? (
          <div className="text-[12px] text-gray-400 py-2">
            {t("workspace.todayEmptyBucket")}
          </div>
        ) : (
          <div className="space-y-2.5">
            {[...fyi]
              .sort(sortHandled)
              .map((task) => renderCard(task, "none"))}
          </div>
        )}
      </div>
    </div>
  );
}
