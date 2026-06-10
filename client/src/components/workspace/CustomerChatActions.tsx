/**
 * CustomerChatActions — suggested-action chips + the gated confirm dialog
 * for the per-customer chat (批2 m3b).
 *
 * Same semantics as the 與AI對話 page: NOTHING runs on chip click — every
 * action opens the confirm dialog (args shown verbatim), sensitive ones
 * additionally require typing CONFIRM. Execution goes through the existing
 * `agent.executeOpsAction` mutation (admin-gated, audited server-side) —
 * zero new execution paths. Styling follows the workspace 黑白鐵則: the
 * sensitive warning is bold black, not red.
 */
import { useState } from "react";
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
import { Input } from "@/components/ui/input";

export interface SuggestedAction {
  actionType: string;
  label: string;
  description?: string;
  args: Record<string, unknown>;
  sensitivity?: "safe" | "normal" | "sensitive";
}

/** Chip row under an agent turn. Click → onPick (opens the confirm dialog). */
export function CustomerActionChips({
  actions,
  disabled,
  onPick,
}: {
  actions: SuggestedAction[];
  disabled?: boolean;
  onPick: (action: SuggestedAction) => void;
}) {
  if (!actions || actions.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={() => onPick(action)}
          disabled={disabled}
          className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium bg-white disabled:opacity-50 ${
            action.sensitivity === "sensitive"
              ? "border-gray-900 text-black"
              : "border-gray-300 text-gray-700"
          }`}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Gated confirm dialog — owns the executeOpsAction mutation. `action=null`
 * renders closed. onDone fires after a successful execution (caller
 * invalidates whatever lists the action may have touched).
 */
export function ActionConfirmDialog({
  action,
  onClose,
  onDone,
}: {
  action: SuggestedAction | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { t } = useLocale();
  const [confirmText, setConfirmText] = useState("");

  const executeMutation = trpc.agent.executeOpsAction.useMutation({
    onSuccess: (result: { ok: boolean; summary: string }) => {
      if (result.ok) toast.success(result.summary);
      else toast.error(result.summary);
      setConfirmText("");
      onClose();
      onDone?.();
    },
    onError: (err) =>
      toast.error(t("admin.agentChat.executionFailed", { msg: err.message })),
  });

  const sensitive = action?.sensitivity === "sensitive";

  const confirm = () => {
    if (!action) return;
    if (sensitive && confirmText !== "CONFIRM") {
      toast.error(t("admin.agentChat.needConfirmInput"));
      return;
    }
    executeMutation.mutate({
      actionType: action.actionType as any,
      args: action.args as any,
      proposalContext: action.label.slice(0, 80),
    });
  };

  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) {
          setConfirmText("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg rounded-xl">
        <DialogHeader>
          <DialogTitle>
            {t("admin.agentChat.confirmExecution", {
              label: action?.label ?? "",
            })}
          </DialogTitle>
          <DialogDescription className="pt-2">
            {action?.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
            {t("admin.agentChat.actionParams")}
          </div>
          <pre className="text-[11px] bg-gray-50 border border-gray-200 p-3 rounded-md overflow-x-auto leading-relaxed">
            {action ? JSON.stringify(action.args, null, 2) : ""}
          </pre>
          {sensitive && (
            <div>
              {/* 黑白鐵則: warning is bold black, never red */}
              <label className="text-sm font-bold block mb-1.5">
                {t("admin.agentChat.sensitiveActionWarning")}{" "}
                <code className="font-mono">CONFIRM</code>{" "}
                {t("admin.agentChat.toConfirm")}
              </label>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={t("admin.agentChat.inputConfirm")}
                className="rounded-lg"
                autoFocus
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setConfirmText("");
              onClose();
            }}
            className="rounded-lg"
          >
            {t("admin.agentChat.cancel")}
          </Button>
          <Button
            onClick={confirm}
            disabled={
              executeMutation.isPending ||
              (sensitive && confirmText !== "CONFIRM")
            }
            className="rounded-lg"
          >
            {executeMutation.isPending
              ? t("admin.agentChat.executing")
              : t("admin.agentChat.confirmAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
