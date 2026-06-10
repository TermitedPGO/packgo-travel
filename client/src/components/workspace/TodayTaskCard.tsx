/**
 * TodayTaskCard — one approval-task card on the 今日待辦 board.
 *
 * Extracted from WorkspaceToday (批1 m3b file split, §9.6 300-line rule).
 * Pure presentation: the lane badge, @customer chip + 「去X」jump, honest
 * failed-executor message, and the 審核 action that opens the SHARED review
 * flow (ReviewTaskDialog) owned by the parent. Generic over the row type so
 * the tRPC-inferred task flows back out of onReview unchanged.
 */
import { useLocale } from "@/contexts/LocaleContext";
import { formatRelTime } from "./relTime";
import { parseQuoteCard } from "./quoteTask";
import QuoteTaskBody from "./QuoteTaskBody";
import { BtnB, WorkspaceCard, type CardState } from "./ws-ui";

/** Structural minimum this card reads off a commandCenter.list row. */
export type TodayTaskShape = {
  id: number;
  lane: string;
  title: string;
  summary?: string | null;
  status: string;
  riskLevel?: string | null;
  errorMessage?: string | null;
  /** lane JSON — quote cards render the price block from it (批2 m2). */
  payload?: string;
  createdAt: Date | string;
  who?: { label: string; userId: number | null } | null;
};

const LANE_BADGE_KEY: Record<string, string> = {
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
export function shortLabel(label: string, max = 12): string {
  return label.length > max ? `${label.slice(0, max)}…` : label;
}

export default function TodayTaskCard<T extends TodayTaskShape>({
  task,
  baseState,
  waitLabel,
  handled,
  onToggle,
  toggleBusy,
  onReview,
  onJumpToCustomer,
}: {
  task: T;
  baseState: CardState;
  waitLabel?: string;
  handled: boolean;
  onToggle: () => void;
  toggleBusy: boolean;
  /** open the shared review dialog (only rendered for pending unhandled). */
  onReview?: (task: T) => void;
  onJumpToCustomer?: (userId: number) => void;
}) {
  const { t } = useLocale();
  const lane = task.lane;
  const canJump = task.who?.userId != null && onJumpToCustomer != null;
  return (
    <WorkspaceCard
      type={LANE_BADGE_KEY[lane] ? t(LANE_BADGE_KEY[lane]) : lane}
      emphasize={task.riskLevel === "hard_gate"}
      lock={task.riskLevel === "hard_gate"}
      who={task.who?.label}
      whoCompany={laneIsCompany(lane)}
      time={formatRelTime(task.createdAt, t)}
      state={handled ? "done" : task.status === "failed" ? "err" : baseState}
      waitLabel={waitLabel}
      jumpLabel={
        canJump
          ? t("workspace.jumpTo", { name: shortLabel(task.who!.label) })
          : undefined
      }
      onJump={canJump ? () => onJumpToCustomer!(task.who!.userId!) : undefined}
      handled={handled}
      onToggle={onToggle}
      toggleBusy={toggleBusy}
    >
      <div className="font-medium">{task.title}</div>
      {/* quote 卡上過目層 (批2 m2): payload 解析得出來就渲染價格塊取代
          summary(producer summary 與價格塊重複),解析不出退回 summary */}
      {lane === "quote" && task.payload && parseQuoteCard(task.payload) ? (
        <QuoteTaskBody payload={task.payload} />
      ) : (
        task.summary && (
          <div className="text-gray-500 mt-0.5 text-[12px]">{task.summary}</div>
        )
      )}
      {/* failed executor → show the reason honestly (bold black, not red) */}
      {task.status === "failed" && task.errorMessage && (
        <div className="text-[11px] font-medium mt-1">{task.errorMessage}</div>
      )}
      {/* 等你決定 → open the shared review flow right on the card */}
      {task.status === "pending" && !handled && onReview && (
        <div className="flex gap-2 mt-2">
          <BtnB onClick={() => onReview(task)}>{t("workspace.review")}</BtnB>
        </div>
      )}
    </WorkspaceCard>
  );
}
