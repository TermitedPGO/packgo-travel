/**
 * TodayAutoReplyBox — 自動回覆留底 / 影子記錄 box(email-auto-reply m2)。
 *
 * Stage A:影子卡「AI 本來會自動回這封(未寄)」— 信任階梯的證據,看完
 * 「知道了」收掉。Stage B:已自動寄卡 — 留底必看,不對勁一鍵「跟進更正」
 * (重用批9 的 🔒 EscalationReplyDialog,寄回同一條 Gmail thread)。
 * Dismiss 寫 readByJeff(與 agent 對話未讀同一狀態)。
 */
import { useState, lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Badge, BadgeK, BtnO, Pill } from "./ws-ui";
import { formatRelTime } from "./relTime";

const EscalationReplyDialog = lazy(() => import("./EscalationReplyDialog"));

type Card = {
  id: number;
  kind: "sent" | "shadow";
  title: string;
  classification: string | null;
  confidence: number | null;
  customerEmail: string | null;
  subject: string | null;
  draftReply: string | null;
  read: boolean;
  createdAt: Date | string;
  replyable: boolean;
};

export default function TodayAutoReplyBox() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<Card | null>(null);

  const cardsQ = trpc.commandCenter.autoReplyCards.useQuery();
  const ackMut = trpc.agent.replyToMessage.useMutation({
    onSuccess: () => utils.commandCenter.autoReplyCards.invalidate(),
  });

  const cards = cardsQ.data ?? [];
  if (cards.length === 0) return null;

  const unread = cards.filter((c) => !c.read).length;

  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold">
          {t("workspace.arBoxTitle")}
          {unread > 0 && (
            <span className="ml-1.5 text-[10px] text-gray-400">
              {t("workspace.arBoxUnread", { n: unread })}
            </span>
          )}
        </span>
        <span className="text-[10px] text-gray-400">
          {t("workspace.arBoxSub")}
        </span>
      </div>
      <div className="divide-y divide-gray-100">
        {cards.map((c) => (
          <div
            key={c.id}
            className={`px-3 py-2 min-w-0 ${c.read ? "opacity-40" : ""}`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              {c.kind === "sent" ? (
                <BadgeK>{t("workspace.arSent")}</BadgeK>
              ) : (
                <Badge>{t("workspace.arShadow")}</Badge>
              )}
              {c.classification && <Pill>{c.classification}</Pill>}
              {c.confidence != null && (
                <span className="text-[10px] text-gray-400">
                  {t("workspace.arConfidence", { n: c.confidence })}
                </span>
              )}
              <span className="text-[10px] text-gray-400">
                {formatRelTime(c.createdAt, t)}
              </span>
            </div>
            <div className="text-[12.5px] mt-0.5 break-words">
              {c.subject || c.title}
              {c.customerEmail && (
                <span className="text-[11px] text-gray-500 ml-1.5">
                  {c.customerEmail}
                </span>
              )}
            </div>
            {expandedId === c.id && c.draftReply && (
              <div className="text-[12px] text-gray-600 mt-1.5 whitespace-pre-wrap break-words rounded-lg bg-gray-50 border border-gray-100 p-2">
                {c.draftReply}
              </div>
            )}
            <div className="flex gap-2 mt-1.5 flex-wrap">
              {c.draftReply && (
                <BtnO
                  onClick={() =>
                    setExpandedId(expandedId === c.id ? null : c.id)
                  }
                >
                  {expandedId === c.id
                    ? t("workspace.escCollapse")
                    : t("workspace.arViewContent")}
                </BtnO>
              )}
              {c.kind === "sent" && c.replyable && c.customerEmail && (
                <BtnO onClick={() => setReplyTo(c)}>
                  {t("workspace.arFollowUp")}
                </BtnO>
              )}
              {!c.read && (
                <BtnO
                  onClick={() =>
                    ackMut.mutate({ messageId: c.id, markRead: true })
                  }
                  disabled={ackMut.isPending}
                >
                  {t("workspace.arGotIt")}
                </BtnO>
              )}
            </div>
          </div>
        ))}
      </div>
      {replyTo && replyTo.customerEmail && (
        <Suspense fallback={null}>
          <EscalationReplyDialog
            messageId={replyTo.id}
            customerEmail={replyTo.customerEmail}
            draft=""
            onClose={() => setReplyTo(null)}
            onSent={() => utils.commandCenter.autoReplyCards.invalidate()}
          />
        </Suspense>
      )}
    </section>
  );
}
