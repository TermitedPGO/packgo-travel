/**
 * WechatApproveDialog — review + record a wechat reply (批2 m5).
 *
 * Honest mechanics, visible in the UI: the system never sends to WeChat.
 * Jeff edits the reply → 複製 → pastes it in WeChat HIMSELF → comes back and
 * 記錄 (wechatAssist.approve = bookkeeping: finalText + sent status, audited).
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function WechatApproveDialog({
  target,
  onClose,
  onDone,
}: {
  /** message under review + its seed draft; null = closed. */
  target: { id: number; draft: string } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [text, setText] = useState("");

  // reseed the editor whenever a different message opens
  useEffect(() => {
    if (target) setText(target.draft);
  }, [target]);

  const approve = trpc.wechatAssist.approve.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.wechatApproved"));
      onClose();
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("workspace.wechatCopied"));
    } catch {
      toast.error(t("workspace.wechatCopyFail"));
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg rounded-xl">
        <DialogHeader>
          <DialogTitle>{t("workspace.wechatReview")}</DialogTitle>
          <DialogDescription>{t("workspace.wechatNote")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <label className="text-xs font-medium text-gray-600 block">
            {t("workspace.wechatFinalLabel")}
          </label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            className="rounded-lg text-sm leading-relaxed"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-lg" onClick={onClose}>
            {t("admin.agentChat.cancel")}
          </Button>
          <Button variant="outline" className="rounded-lg" onClick={copy}>
            {t("workspace.wechatCopy")}
          </Button>
          <Button
            className="rounded-lg"
            disabled={approve.isPending || !text.trim() || target === null}
            onClick={() =>
              target !== null &&
              approve.mutate({
                messageId: target.id,
                finalText: text.trim(),
                markAsSent: true,
              })
            }
          >
            {t("workspace.wechatMarkSent")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
