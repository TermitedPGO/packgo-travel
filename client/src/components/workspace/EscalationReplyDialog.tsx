/**
 * EscalationReplyDialog — 批9 m1 escalation 卡的「編輯並回覆」🔒 dialog.
 *
 * Prefills the AI draft, Jeff edits, the gated checkbox names the recipient,
 * then commandCenter.escalationReply sends in the ORIGINAL Gmail thread.
 * Honest outcomes: sent / dry-run(kill switch)/ failed all surface as-is.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { BtnB, BtnO } from "./ws-ui";

export default function EscalationReplyDialog({
  messageId,
  customerEmail,
  draft,
  onClose,
  onSent,
}: {
  messageId: number;
  customerEmail: string;
  draft: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useLocale();
  const [body, setBody] = useState(draft);
  const [confirmed, setConfirmed] = useState(false);

  const replyMut = trpc.commandCenter.escalationReply.useMutation({
    onSuccess: (res) => {
      if (res.sent) {
        toast.success(t("workspace.escReplySent", { email: customerEmail }));
        onSent();
        onClose();
      } else if (res.dryRun) {
        toast.warning(t("workspace.escReplyDryRun"));
      } else {
        toast.error(
          t("workspace.escReplyFailed", {
            msg: res.errorMessage ?? "",
          }),
        );
      }
    },
    onError: (e) =>
      toast.error(t("workspace.escReplyFailed", { msg: e.message })),
  });

  const valid = body.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-lg shadow-lg">
        <h3 className="text-sm font-semibold mb-1">
          {t("workspace.escReplyTitle")}
        </h3>
        <p className="text-[11px] text-gray-500 mb-3">
          {t("workspace.escReplyTo", { email: customerEmail })}
        </p>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[13px] leading-relaxed"
        />

        <div className="mt-3 rounded-lg bg-black text-white px-3 py-2.5 flex items-start gap-2">
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <label className="flex items-start gap-2 cursor-pointer text-[11px] leading-relaxed">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              {t("workspace.escReplyConfirm", { email: customerEmail })}
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <BtnO onClick={onClose}>{t("workspace.supCancel")}</BtnO>
          <BtnB
            onClick={() => replyMut.mutate({ messageId, body: body.trim() })}
            disabled={!valid || !confirmed || replyMut.isPending}
          >
            {replyMut.isPending
              ? t("workspace.escReplySending")
              : t("workspace.escReplyGo")}
          </BtnB>
        </div>
      </div>
    </div>
  );
}
