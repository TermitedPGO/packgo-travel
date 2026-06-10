/**
 * TodayEscalationCard — one agent escalation in the 需要你決定 bucket (批1 m3b).
 *
 * Escalations are agentMessages the agents refuse to decide alone (客訴 /
 * 退款 / low-confidence inquiries; B1 already writes title/body in plain
 * Chinese). The card shows the title + the agent's one-line reason, with the
 * full body (incl. the suggested reply that was NEVER sent) behind a 看全文
 * toggle. There is deliberately NO send/approve action here — acting on an
 * escalation stays in Gmail / agent chat; the only mutation is the 處理好了
 * ack, which writes the same readByJeff state the agent-chat badge reads.
 *
 * Badge mapping: refund (by classification or the refund agent) → 退款 +
 * lock (money), complaint → 客訴, spam → existing 疑似垃圾 label, anything
 * else → the cs lane label (詢問). Title/body stay as-is (DB content).
 */
import { useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { formatRelTime } from "./relTime";
import { shortLabel } from "./TodayTaskCard";
import { BtnO, WorkspaceCard } from "./ws-ui";

/** Structural minimum this card reads off a commandCenter.escalationList row. */
export type EscalationShape = {
  id: number;
  agentName: string;
  title: string;
  body: string;
  classification: string | null;
  priority: "low" | "normal" | "high" | "critical";
  read: boolean;
  createdAt: Date | string;
  who: { label: string; userId: number | null } | null;
};

function isRefund(esc: EscalationShape): boolean {
  return esc.agentName === "refund" || esc.classification === "refund_request";
}

function badgeKey(esc: EscalationShape): string {
  if (isRefund(esc)) return "workspace.escClsRefund";
  if (esc.classification === "complaint") return "workspace.escClsComplaint";
  if (esc.classification === "spam") return "workspace.spamBadge";
  return "workspace.laneCs";
}

export default function TodayEscalationCard({
  esc,
  onAck,
  acking,
  onJumpToCustomer,
}: {
  esc: EscalationShape;
  /** 處理好了 toggle → readByJeff (shared with the agent-chat unread badge). */
  onAck: (esc: EscalationShape, handled: boolean) => void;
  acking: boolean;
  onJumpToCustomer?: (userId: number) => void;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);

  const refund = isRefund(esc);
  const canJump = esc.who?.userId != null && onJumpToCustomer != null;
  // body line 1 is the agent's plain-language reason (B1 contract); the rest
  // (customer intent + unsent suggested reply) lives behind 看全文.
  const reason = esc.body.split("\n")[0] ?? "";
  const hasMore = esc.body.trim().length > reason.trim().length;

  return (
    <WorkspaceCard
      type={t(badgeKey(esc))}
      emphasize={refund || esc.priority === "critical" || esc.priority === "high"}
      lock={refund}
      who={esc.who?.label}
      time={formatRelTime(esc.createdAt, t)}
      state={esc.read ? "done" : "decide"}
      jumpLabel={
        canJump
          ? t("workspace.jumpTo", { name: shortLabel(esc.who!.label) })
          : undefined
      }
      onJump={canJump ? () => onJumpToCustomer!(esc.who!.userId!) : undefined}
      handled={esc.read}
      onToggle={() => onAck(esc, !esc.read)}
      toggleBusy={acking}
    >
      <div className="font-medium">{esc.title}</div>
      {expanded ? (
        <div className="text-gray-600 mt-0.5 text-[12px] whitespace-pre-wrap">
          {esc.body}
        </div>
      ) : (
        reason && (
          <div className="text-gray-500 mt-0.5 text-[12px]">{reason}</div>
        )
      )}
      {hasMore && (
        <div className="flex gap-2 mt-2">
          <BtnO onClick={() => setExpanded((v) => !v)}>
            {expanded ? t("workspace.escCollapse") : t("workspace.escExpand")}
          </BtnO>
        </div>
      )}
    </WorkspaceCard>
  );
}
