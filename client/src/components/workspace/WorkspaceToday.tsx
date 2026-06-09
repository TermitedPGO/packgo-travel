/**
 * WorkspaceToday — 今日待辦 roll-up board (faithful to mockup
 * admin-inbox-integrated.html / admin-full-pages.html PAGE 1).
 *
 *   serif「下午好,Jeff」greeting + date/counts line
 *   3 buckets: 需要你決定 / 處理中·等外部 / 看一下就好
 *   each item = ws-ui WorkspaceCard with 未處理 / 處理好了 toggle
 *
 * Data is REAL: commandCenter.list (approval tasks) bucketed by status, with
 * 處理好了 persisted via workspace.setDisposition. The mockup's customer-item
 * buckets that have no clean data source yet render an honest empty line
 * rather than fabricated demo cards.
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { RefreshCw } from "lucide-react";
import {
  Greeting,
  GroupHeader,
  WorkspaceCard,
  type CardState,
} from "./ws-ui";

type Lane = "cs" | "quote" | "marketing" | "finance";

const LANE_BADGE: Record<Lane, string> = {
  cs: "詢問",
  quote: "報價",
  marketing: "行銷",
  finance: "財務",
};

/** finance / marketing tasks are company-wide; cs / quote belong to a customer. */
function laneWho(lane: string): string | undefined {
  return lane === "finance" || lane === "marketing" ? "全公司" : undefined;
}

function relTime(v: Date | string | number): string {
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const d = Math.round(hr / 24);
  return d === 1 ? "昨天" : `${d} 天前`;
}

type Task = {
  id: number;
  lane: string;
  taskType: string;
  riskLevel: string;
  title: string;
  summary: string | null;
  status: string;
  createdAt: Date | string | number;
};

export default function WorkspaceToday() {
  const listQ = trpc.commandCenter.list.useQuery({ limit: 200 });
  const statsQ = trpc.commandCenter.stats.useQuery();
  const dispQ = trpc.workspace.listDispositions.useQuery();
  const utils = trpc.useUtils();

  const setDisposition = trpc.workspace.setDisposition.useMutation({
    onSuccess: () => {
      utils.workspace.listDispositions.invalidate();
    },
  });

  const handled = useMemo(
    () => new Set(dispQ.data ?? []),
    [dispQ.data],
  );

  const tasks = (listQ.data ?? []) as Task[];

  const decide = tasks.filter((t) => t.status === "pending");
  const inflight = tasks.filter((t) => t.status === "sent");
  const fyi = tasks.filter(
    (t) => t.status === "approved" || t.status === "failed",
  );

  const pendingCount = statsQ.data?.totalPending ?? decide.length;
  const line = `${pendingCount} 件待你決定 · ${inflight.length} 件處理中`;

  const toggle = (id: number, currentlyHandled: boolean) =>
    setDisposition.mutate({ kind: "task", id, handled: !currentlyHandled });

  const renderCard = (t: Task, baseState: CardState, waitLabel?: string) => {
    const isHandled = handled.has(`task:${t.id}`);
    const lane = t.lane;
    return (
      <WorkspaceCard
        key={t.id}
        type={LANE_BADGE[lane as Lane] ?? lane}
        emphasize={t.riskLevel === "hard_gate"}
        lock={t.riskLevel === "hard_gate"}
        who={laneWho(lane)}
        time={relTime(t.createdAt)}
        state={isHandled ? "done" : t.status === "failed" ? "err" : baseState}
        waitLabel={waitLabel}
        handled={isHandled}
        onToggle={() => toggle(t.id, isHandled)}
        toggleBusy={setDisposition.isPending}
      >
        <div className="font-medium">{t.title}</div>
        {t.summary && (
          <div className="text-gray-500 mt-0.5 text-[12px]">{t.summary}</div>
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

  const loading = listQ.isLoading || dispQ.isLoading;

  return (
    <div className="space-y-5">
      <Greeting
        name="Jeff"
        line={loading ? "載入中…" : line}
        right={
          <button
            onClick={() => {
              listQ.refetch();
              statsQ.refetch();
              dispQ.refetch();
            }}
            className="text-xs text-gray-500 flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            重新整理
          </button>
        }
      />

      <div>
        <GroupHeader title="需要你決定" count={decide.length} />
        {decide.length === 0 ? (
          <div className="text-[12px] text-gray-400 py-2">
            目前沒有待你決定的事 🎉
          </div>
        ) : (
          <div className="space-y-2.5">
            {[...decide]
              .sort(sortHandled)
              .map((t) => renderCard(t, "decide"))}
          </div>
        )}
      </div>

      <div>
        <GroupHeader title="處理中 · 等外部" count={inflight.length} />
        {inflight.length === 0 ? (
          <div className="text-[12px] text-gray-400 py-2">目前沒有</div>
        ) : (
          <div className="space-y-2.5">
            {[...inflight]
              .sort(sortHandled)
              .map((t) => renderCard(t, "wait", "已送出"))}
          </div>
        )}
      </div>

      <div>
        <GroupHeader title="看一下就好" count={fyi.length} />
        {fyi.length === 0 ? (
          <div className="text-[12px] text-gray-400 py-2">目前沒有</div>
        ) : (
          <div className="space-y-2.5">
            {[...fyi].sort(sortHandled).map((t) => renderCard(t, "none"))}
          </div>
        )}
      </div>
    </div>
  );
}
