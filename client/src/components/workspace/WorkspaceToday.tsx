/**
 * WorkspaceToday — 今日待辦 roll-up board (faithful to mockup
 * admin-inbox-integrated.html / admin-full-pages.html PAGE 1).
 *
 *   serif「下午好,Jeff」greeting + date/counts line
 *   3 buckets: 需要你決定 / 處理中·等外部 / 看一下就好 + 疑似垃圾匣
 *   each item = ws-ui WorkspaceCard with 未處理 / 處理好了 toggle
 *
 * Data is REAL: commandCenter.list (approval tasks) queried PER STATUS so the
 * 需要你決定 bucket can never silently drop an old pending task off a shared
 * limit window, MERGED (批1 m3b) with commandCenter.escalationList — agent
 * escalations (客訴/退款/低信心) that previously lived only in the agent chat.
 * Escalation 處理好了 = readByJeff (same state as the chat unread badge); the
 * card dims in place (undoable) instead of vanishing. 看一下就好 is a bounded
 * recent window (newest 20 approved + 20 failed), not a full history dump.
 * Task 處理好了 persisted via workspace.setDisposition.
 *
 * Card renderers live in TodayTaskCard / TodayEscalationCard; the 疑似垃圾匣
 * is TodaySpamBox (file split per §9.6 300-line rule).
 */
import { lazy, Suspense, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { RefreshCw } from "lucide-react";
import { Greeting, GroupHeader } from "./ws-ui";
import TodayTaskCard from "./TodayTaskCard";
import TodayEscalationCard, {
  type EscalationShape,
} from "./TodayEscalationCard";
import TodaySpamBox from "./TodaySpamBox";

// Shared review flow (same dialog the 指揮中心 ApprovalInbox uses): full
// payload preview + hard_gate confirm + honest outcome toast. Lazy so the
// dialog chunk only loads when Jeff actually reviews something.
const ReviewTaskDialog = lazy(
  () => import("@/components/admin-v2/CommandCenter/ReviewTaskDialog"),
);

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
  // escalations (m3b) — unread all + recent read (dimmed, undoable)
  const escQ = trpc.commandCenter.escalationList.useQuery();
  const utils = trpc.useUtils();

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

  // 處理好了 on an escalation = readByJeff. Update the row in place (dim +
  // sink, reversible) instead of refetching it away; the agent-chat unread
  // badge + sidebar count read the same state, so refresh those.
  const escAck = trpc.commandCenter.escalationAck.useMutation({
    onSuccess: (res) => {
      utils.commandCenter.escalationList.setData(undefined, (old) =>
        old?.map((r) => (r.id === res.id ? { ...r, read: res.read } : r)),
      );
      utils.commandCenter.stats.invalidate();
      utils.agent.unreadMessageCount.invalidate();
      utils.agent.listMessages.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const handled = useMemo(() => new Set(dispQ.data ?? []), [dispQ.data]);

  const decide = decideQ.data ?? [];
  const escalations = escQ.data ?? [];
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

  // 需要你決定 = pending approval tasks + escalations, one timeline. Unhandled
  // first, then newest first (read escalations sink like handled tasks do).
  type DecideItem =
    | { kind: "task"; handled: boolean; at: number; task: Task }
    | { kind: "esc"; handled: boolean; at: number; esc: EscalationShape };
  const decideItems = useMemo<DecideItem[]>(() => {
    const taskItems: DecideItem[] = decide.map((task) => ({
      kind: "task",
      handled: handled.has(`task:${task.id}`),
      at: new Date(task.createdAt).getTime(),
      task,
    }));
    const escItems: DecideItem[] = escalations.map((esc) => ({
      kind: "esc",
      handled: esc.read,
      at: new Date(esc.createdAt).getTime(),
      esc,
    }));
    return [...taskItems, ...escItems].sort(
      (a, b) => Number(a.handled) - Number(b.handled) || b.at - a.at,
    );
  }, [decide, escalations, handled]);

  const unreadEsc = escalations.filter((e) => !e.read).length;
  const pendingCount =
    (statsQ.data?.totalPending ?? decide.length) + unreadEsc;
  const line = t("workspace.todayLine", {
    decide: pendingCount,
    inflight: inflight.length,
  });

  const toggle = (id: number, currentlyHandled: boolean) =>
    setDisposition.mutate({ kind: "task", id, handled: !currentlyHandled });

  const renderTask = (task: Task, baseState: "decide" | "wait" | "none", waitLabel?: string) => {
    const isHandled = handled.has(`task:${task.id}`);
    return (
      <TodayTaskCard
        key={`task:${task.id}`}
        task={task}
        baseState={baseState}
        waitLabel={waitLabel}
        handled={isHandled}
        onToggle={() => toggle(task.id, isHandled)}
        toggleBusy={
          setDisposition.isPending && setDisposition.variables?.id === task.id
        }
        onReview={setReviewing}
        onJumpToCustomer={onJumpToCustomer}
      />
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
              utils.commandCenter.escalationList.invalidate();
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
        <GroupHeader
          title={t("workspace.todayPending")}
          count={decide.length + unreadEsc}
        />
        {decideItems.length === 0 ? (
          <div className="text-[12px] text-gray-400 py-2">
            {t("workspace.todayEmptyDecide")}
          </div>
        ) : (
          <div className="space-y-2.5">
            {decideItems.map((item) =>
              item.kind === "task" ? (
                renderTask(item.task, "decide")
              ) : (
                <TodayEscalationCard
                  key={`esc:${item.esc.id}`}
                  esc={item.esc}
                  onAck={(esc, h) =>
                    escAck.mutate({ messageId: esc.id, handled: h })
                  }
                  acking={
                    escAck.isPending &&
                    escAck.variables?.messageId === item.esc.id
                  }
                  onJumpToCustomer={onJumpToCustomer}
                />
              ),
            )}
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
              .map((task) => renderTask(task, "wait", t("workspace.waitSent")))}
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
            {[...fyi].sort(sortHandled).map((task) => renderTask(task, "none"))}
          </div>
        )}
      </div>

      {/* 疑似垃圾匣 (m3a) — spam 永不靜默丟,確認垃圾淡化保留,救回走正常路 */}
      <TodaySpamBox />

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
