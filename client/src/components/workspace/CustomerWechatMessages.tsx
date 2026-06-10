/**
 * CustomerWechatMessages — 微信 section of the per-customer inbox (批2 m5).
 *
 * Shows this customer's wechat thread (歸戶 via fromOpenId ↔
 * customerProfiles.wechatId, or manual assign). ready_review cards carry the
 * AI draft and open the review dialog; THE SYSTEM NEVER SENDS — Jeff copies
 * the reply, pastes it in WeChat himself, then records it here (wechat
 * approve = bookkeeping, same as before). Decided rows stay dimmed 留底.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { formatRelTime } from "./relTime";
import { BtnO, Src, WorkspaceCard } from "./ws-ui";
import WechatApproveDialog from "./WechatApproveDialog";

export default function CustomerWechatMessages({ userId }: { userId: number }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const listQ = trpc.wechatAssist.listForCustomer.useQuery({ userId });
  const [reviewing, setReviewing] = useState<
    { id: number; draft: string } | null
  >(null);

  const skip = trpc.wechatAssist.skip.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.wechatStSkipped"));
      utils.wechatAssist.listForCustomer.invalidate({ userId });
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = listQ.data ?? [];
  if (rows.length === 0) return null;

  const pending = rows.filter((m) => m.status === "ready_review").length;

  const statusKey = (s: string) =>
    s === "sent"
      ? "workspace.wechatStSent"
      : s === "approved"
        ? "workspace.wechatStApproved"
        : s === "skipped"
          ? "workspace.wechatStSkipped"
          : "";

  return (
    <>
      <div className="text-[11px] font-semibold text-gray-400 mb-2 mt-5">
        {t("workspace.wechatSection")} ({pending})
      </div>
      <Src>{t("workspace.wechatNote")}</Src>
      <div className="space-y-2.5 mt-2">
        {rows.map((m) => {
          const decided = m.status !== "ready_review";
          return (
            <WorkspaceCard
              key={m.id}
              type={t("workspace.wechatSection")}
              who={m.fromDisplayName ?? undefined}
              time={formatRelTime(m.receivedAt, t)}
              state={decided ? "done" : "decide"}
            >
              <div className="text-[12px] text-gray-500 line-clamp-2">
                {m.inboundText}
              </div>
              {!decided && m.aiDraftText && (
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-2 mt-2 text-[12px] text-gray-700 line-clamp-3">
                  {m.aiDraftText}
                </div>
              )}
              {decided && (
                <div className="text-[11px] text-gray-500 mt-1">
                  {statusKey(m.status) ? t(statusKey(m.status)) : m.status}
                  {m.finalText ? ` · ${m.finalText.slice(0, 60)}` : ""}
                </div>
              )}
              {!decided && (
                <div className="flex gap-2 mt-2">
                  <BtnO
                    onClick={() =>
                      setReviewing({
                        id: m.id,
                        draft: m.finalText || m.aiDraftText || "",
                      })
                    }
                  >
                    {t("workspace.wechatReview")}
                  </BtnO>
                  <BtnO
                    disabled={skip.isPending}
                    onClick={() => skip.mutate({ messageId: m.id })}
                  >
                    {t("workspace.wechatSkip")}
                  </BtnO>
                </div>
              )}
            </WorkspaceCard>
          );
        })}
      </div>

      <WechatApproveDialog
        target={reviewing}
        onClose={() => setReviewing(null)}
        onDone={() => utils.wechatAssist.listForCustomer.invalidate({ userId })}
      />
    </>
  );
}
