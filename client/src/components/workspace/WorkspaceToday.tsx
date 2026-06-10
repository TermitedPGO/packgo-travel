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
import { lazy, Suspense, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { RefreshCw } from "lucide-react";
import { formatRelTime } from "./relTime";
import {
  BtnB,
  BtnO,
  Greeting,
  GroupHeader,
  Src,
  WorkspaceCard,
  type CardState,
} from "./ws-ui";

// Shared review flow (same dialog the 指揮中心 ApprovalInbox uses): full
// payload preview + hard_gate confirm + honest outcome toast. Lazy so the
// dialog chunk only loads when Jeff actually reviews something.
const ReviewTaskDialog = lazy(
  () => import("@/components/admin-v2/CommandCenter/ReviewTaskDialog"),
);

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
  // 疑似垃圾匣 (m3a) — spam rows including decided ones (muted, never gone)
  const spamQ = trpc.commandCenter.spamList.useQuery({ limit: 30 });
  const utils = trpc.useUtils();

  const spamRescue = trpc.commandCenter.spamRescue.useMutation({
    onSuccess: (res) => {
      if (res.agentError) {
        // honest: the inquiry exists, the AI draft does not
        toast.error(`${t("workspace.spamRescueAgentFail")}: ${res.agentError}`);
      } else {
        toast.success(t("workspace.spamRescued"));
      }
      utils.commandCenter.spamList.invalidate();
      utils.commandCenter.list.invalidate();
      utils.commandCenter.stats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const spamConfirm = trpc.commandCenter.spamConfirm.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.spamConfirmed"));
      utils.commandCenter.spamList.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  type Task = NonNullable<typeof decideQ.data>[number];

  // 批1 m2 — the task whose review dialog is open (null = closed). The card
  // button opens the SAME shared flow the 指揮中心 uses: full payload preview,
  // hard_gate per-item confirm, honest outcome toast.
  const [reviewing, setReviewing] = useState<Task | null>(null);

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
        {/* failed executor → show the reason honestly (bold black, not red) */}
        {task.status === "failed" && task.errorMessage && (
          <div className="text-[11px] font-medium mt-1">
            {task.errorMessage}
          </div>
        )}
        {/* 等你決定 → open the shared review flow right on the card */}
        {task.status === "pending" && !isHandled && (
          <div className="flex gap-2 mt-2">
            <BtnB onClick={() => setReviewing(task)}>
              {t("workspace.review")}
            </BtnB>
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

      {/* 疑似垃圾匣 (m3a) — design.md §2 rule 4: spam 永不靜默丟,
          確認垃圾也保留(淡化),救回走正常 inbound 草稿路 */}
      <div>
        <GroupHeader
          title={t("workspace.spamBox")}
          count={(spamQ.data ?? []).filter((s) => !s.verdict).length}
        />
        <Src>{t("workspace.spamNote")}</Src>
        {(spamQ.data ?? []).length === 0 ? (
          <div className="text-[12px] text-gray-400 py-2">
            {t("workspace.spamEmpty")}
          </div>
        ) : (
          <div className="space-y-2.5 mt-2">
            {(spamQ.data ?? []).map((s) => (
              <WorkspaceCard
                key={s.id}
                type={t("workspace.spamBadge")}
                who={s.email ?? t("workspace.spamUnknownSender")}
                time={formatRelTime(s.createdAt, t)}
                state={s.verdict ? "done" : "none"}
              >
                <div>{s.summary ?? ""}</div>
                {s.verdict === "rescued" && (
                  <div className="text-[11px] text-gray-500 mt-1">
                    {t("workspace.spamRescued")}
                  </div>
                )}
                {s.verdict === "confirmed_spam" && (
                  <div className="text-[11px] text-gray-500 mt-1">
                    {t("workspace.spamConfirmed")}
                  </div>
                )}
                {!s.verdict && (
                  <div className="flex gap-2 mt-2">
                    <BtnO
                      disabled={spamRescue.isPending || spamConfirm.isPending}
                      onClick={() =>
                        spamRescue.mutate({ interactionId: s.id })
                      }
                    >
                      {t("workspace.spamRescue")}
                    </BtnO>
                    <BtnO
                      disabled={spamRescue.isPending || spamConfirm.isPending}
                      onClick={() =>
                        spamConfirm.mutate({ interactionId: s.id })
                      }
                    >
                      {t("workspace.spamConfirm")}
                    </BtnO>
                  </div>
                )}
              </WorkspaceCard>
            ))}
          </div>
        )}
      </div>

      {/* 批1 m2 — shared review flow (same dialog as 指揮中心 ApprovalInbox) */}
      <Suspense fallback={null}>
        {reviewing && (
          <ReviewTaskDialog
            task={reviewing}
            onClose={() => setReviewing(null)}
            onDecided={() => {
              utils.commandCenter.list.invalidate();
              utils.commandCenter.stats.invalidate();
            }}
          />
        )}
      </Suspense>
    </div>
  );
}
