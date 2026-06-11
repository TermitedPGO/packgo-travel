/**
 * TodayReviewCard — pending tour review card on the 今日待辦 board.
 * Star rating + excerpt + tour title. "審核" opens ReviewDialog (inline,
 * not the shared ReviewTaskDialog used for approval tasks).
 */
import { useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { formatRelTime } from "./relTime";
import { BtnB, BtnO, WorkspaceCard } from "./ws-ui";

export type ReviewShape = {
  id: number;
  authorName: string | null;
  authorEmail: string | null;
  tourTitle: string | null;
  rating: number;
  title: string | null;
  content: string;
  createdAt: Date | string;
};

export default function TodayReviewCard({
  review,
  handled,
  onToggle,
  toggleBusy,
  onDecided,
}: {
  review: ReviewShape;
  handled: boolean;
  onToggle: () => void;
  toggleBusy: boolean;
  onDecided?: () => void;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [reason, setReason] = useState("");

  const approveMut = trpc.reviews.adminApprove.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.awarded
          ? t("workspace.reviewApprovedPP", { pp: res.awarded })
          : t("workspace.reviewApproved"),
      );
      setExpanded(false);
      onDecided?.();
    },
    onError: (e) => toast.error(e.message),
  });

  const rejectMut = trpc.reviews.adminReject.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.reviewRejected"));
      setExpanded(false);
      setRejectMode(false);
      onDecided?.();
    },
    onError: (e) => toast.error(e.message),
  });

  const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
  const excerpt =
    review.content.length > 80
      ? review.content.slice(0, 80) + "..."
      : review.content;

  return (
    <WorkspaceCard
      type={t("workspace.reviewType")}
      time={formatRelTime(review.createdAt, t)}
      state={handled ? "done" : "decide"}
      handled={handled}
      onToggle={onToggle}
      toggleBusy={toggleBusy}
    >
      <div className="font-medium">
        {review.tourTitle ?? t("workspace.reviewUnknownTour")}
      </div>
      <div className="text-gray-500 mt-0.5 text-[12px]">
        {stars} {review.authorName || review.authorEmail || "?"}{" "}
        {review.title ? `— ${review.title}` : ""}
      </div>
      <div className="text-gray-500 mt-0.5 text-[12px]">{excerpt}</div>

      {!handled && !expanded && (
        <div className="flex gap-2 mt-2">
          <BtnB onClick={() => setExpanded(true)}>
            {t("workspace.review")}
          </BtnB>
        </div>
      )}

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          <div className="text-[12px] whitespace-pre-wrap">{review.content}</div>

          {rejectMode ? (
            <div className="space-y-2">
              <textarea
                className="w-full rounded-lg border border-gray-300 p-2 text-xs"
                rows={2}
                placeholder={t("workspace.reviewRejectReason")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <BtnB
                  disabled={reason.trim().length < 3 || rejectMut.isPending}
                  onClick={() =>
                    rejectMut.mutate({ id: review.id, reason: reason.trim() })
                  }
                >
                  {t("workspace.reviewConfirmReject")}
                </BtnB>
                <BtnO
                  onClick={() => {
                    setRejectMode(false);
                    setReason("");
                  }}
                >
                  {t("workspace.cancel")}
                </BtnO>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <BtnB
                disabled={approveMut.isPending}
                onClick={() => approveMut.mutate({ id: review.id })}
              >
                {t("workspace.reviewApproveBtn")}
              </BtnB>
              <BtnO onClick={() => setRejectMode(true)}>
                {t("workspace.reviewRejectBtn")}
              </BtnO>
              <BtnO onClick={() => setExpanded(false)}>
                {t("workspace.cancel")}
              </BtnO>
            </div>
          )}
        </div>
      )}
    </WorkspaceCard>
  );
}
