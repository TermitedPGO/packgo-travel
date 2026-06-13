/**
 * TodayEscalationCard — one agent escalation in the 需要你決定 bucket (批1 m3b).
 *
 * Escalations are agentMessages the agents refuse to decide alone (客訴 /
 * 退款 / low-confidence inquiries; B1 already writes title/body in plain
 * Chinese). The card shows the title + the agent's one-line reason, with the
 * full body behind a 看全文 toggle.
 *
 * 批9 m1 (Jeff 拍板「全部我核准」): replyable escalations (context carries a
 * structured Gmail reply target) get a 編輯並回覆 button → 🔒 gated dialog →
 * commandCenter.escalationReply sends in the original thread. Older rows
 * stay view-only; the 處理好了 ack remains the other mutation.
 *
 * Badge mapping: refund (by classification or the refund agent) → 退款 +
 * lock (money), complaint → 客訴, spam → existing 疑似垃圾 label, anything
 * else → the cs lane label (詢問). Title/body stay as-is (DB content).
 */
import { useState, lazy, Suspense } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { formatRelTime } from "./relTime";
import { shortLabel } from "./TodayTaskCard";
import { BtnB, BtnO, WorkspaceCard } from "./ws-ui";
import { cleanDisplayText } from "./cleanText";

const EscalationReplyDialog = lazy(() => import("./EscalationReplyDialog"));

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
  suggestedReply: string | null;
  replyable: boolean;
  customerEmail: string | null;
  /** 批m3 — tours the resolver matched to the customer's email (jump to quote). */
  resolvedTours?: { id: number; title: string; status: string }[];
  /** code-shaped tokens the customer used that matched no tour (e.g. YG7). */
  unknownTourCodes?: string[];
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
  onReplied,
}: {
  esc: EscalationShape;
  /** 處理好了 toggle → readByJeff (shared with the agent-chat unread badge). */
  onAck: (esc: EscalationShape, handled: boolean) => void;
  acking: boolean;
  onJumpToCustomer?: (userId: number) => void;
  /** 批9 m1 — refresh the escalation list after a gated send. */
  onReplied?: () => void;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);

  const refund = isRefund(esc);
  const canJump = esc.who?.userId != null && onJumpToCustomer != null;
  const canReply = esc.replyable && esc.customerEmail != null && !esc.read;
  // body line 1 is the agent's plain-language reason (B1 contract); the rest
  // (customer intent + unsent suggested reply) lives behind 看全文. Strip the
  // injection wrapper + leaked markdown for display (old cards, pre-fix).
  const cleanBody = cleanDisplayText(esc.body);
  const reason = cleanBody.split("\n")[0] ?? "";
  const hasMore = cleanBody.trim().length > reason.trim().length;
  const resolvedTours = esc.resolvedTours ?? [];
  const unknownCodes = esc.unknownTourCodes ?? [];

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
          {cleanBody}
        </div>
      ) : (
        reason && (
          <div className="text-gray-500 mt-0.5 text-[12px]">{reason}</div>
        )
      )}
      {(resolvedTours.length > 0 || unknownCodes.length > 0) && (
        <div className="mt-2 flex flex-col gap-1">
          {resolvedTours.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
              <span className="text-gray-400">{t("workspace.escResolvedTours")}</span>
              {resolvedTours.map((tr) => (
                <a
                  key={tr.id}
                  href={`/tours/${tr.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-1.5 py-0.5 rounded-md border border-gray-400 hover:bg-gray-100 inline-flex items-center gap-1 max-w-[16rem] truncate"
                  title={tr.title}
                >
                  <span className="truncate">{tr.title}</span>
                  {tr.status !== "active" && (
                    <span className="text-gray-400">{t("workspace.escTourDraft")}</span>
                  )}
                </a>
              ))}
            </div>
          )}
          {unknownCodes.length > 0 && (
            <div className="text-[11px] text-gray-400">
              {t("workspace.escUnknownCodes", { codes: unknownCodes.join("、") })}
            </div>
          )}
        </div>
      )}
      {(hasMore || canReply) && (
        <div className="flex gap-2 mt-2 flex-wrap">
          {canReply && (
            <BtnB onClick={() => setReplying(true)}>
              {t("workspace.escReplyBtn")}
            </BtnB>
          )}
          {hasMore && (
            <BtnO onClick={() => setExpanded((v) => !v)}>
              {expanded ? t("workspace.escCollapse") : t("workspace.escExpand")}
            </BtnO>
          )}
        </div>
      )}
      {replying && esc.customerEmail && (
        <Suspense fallback={null}>
          <EscalationReplyDialog
            messageId={esc.id}
            customerEmail={esc.customerEmail}
            draft={esc.suggestedReply ?? ""}
            onClose={() => setReplying(false)}
            onSent={() => onReplied?.()}
          />
        </Suspense>
      )}
    </WorkspaceCard>
  );
}
