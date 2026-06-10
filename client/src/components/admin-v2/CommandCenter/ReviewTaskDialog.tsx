/**
 * ReviewTaskDialog — the ONE approval review flow, shared by the 指揮中心
 * ApprovalInbox table and the workspace 今日待辦 cards (批1 m2).
 *
 * Extracted verbatim from ApprovalInbox so both surfaces enforce identical
 * rules — there is exactly one way a task gets approved in the UI:
 *   - the full lane payload is shown (cs lane editable draft) BEFORE any
 *     send — 永不靜默送客人, the admin reads what goes out;
 *   - hard_gate (money / irreversible / customer-visible) forces an explicit
 *     confirm toggle before 通過 unlocks — always per-item;
 *   - outcomes are reported honestly via approveToastFor (sent vs recorded
 *     vs failed-with-detail).
 *
 * The dialog owns the approve/reject mutations; callers pass `onDecided` to
 * invalidate their own queries after a decision lands.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { StatusDot, type StatusTone } from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { CheckCircle2, Send, ShieldAlert, Undo2 } from "lucide-react";
import type { ApprovalTaskRow, RiskLevel, ApprovalLane } from "./types";
import { LanePayloadBody, laneHasEditor } from "./lanes";
import { approveToastFor } from "./approveToast";

const RISK_TONE: Record<RiskLevel, StatusTone> = {
  auto: "muted",
  review: "info",
  hard_gate: "danger",
};

const RISK_I18N: Record<RiskLevel, string> = {
  auto: "admin.commandCenter.riskAuto",
  review: "admin.commandCenter.riskReview",
  hard_gate: "admin.commandCenter.riskHardGate",
};

const LANE_I18N: Record<ApprovalLane, string> = {
  cs: "admin.commandCenter.laneCs",
  quote: "admin.commandCenter.laneQuote",
  marketing: "admin.commandCenter.laneMarketing",
  finance: "admin.commandCenter.laneFinance",
};

export default function ReviewTaskDialog({
  task,
  onClose,
  onDecided,
}: {
  /** the pending task under review; null = closed. */
  task: ApprovalTaskRow | null;
  onClose: () => void;
  /** called after an approve/reject lands (invalidate caller queries). */
  onDecided?: () => void;
}) {
  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {task && (
          // key resets the per-task state (edit buffer / confirm / reason)
          // whenever a different task is opened.
          <ReviewBody
            key={task.id}
            task={task}
            onClose={onClose}
            onDecided={onDecided}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewBody({
  task,
  onClose,
  onDecided,
}: {
  task: ApprovalTaskRow;
  onClose: () => void;
  onDecided?: () => void;
}) {
  const { t } = useLocale();
  const [rejectReason, setRejectReason] = useState("");
  const [hardGateConfirmed, setHardGateConfirmed] = useState(false);
  // Editable payload — lanes with an editor (cs) let the admin tweak the
  // draft before sending; other lanes carry the original payload untouched.
  const [editedPayload, setEditedPayload] = useState<string>(task.payload);

  const approve = trpc.commandCenter.approve.useMutation();
  const reject = trpc.commandCenter.reject.useMutation();
  const busy = approve.isPending || reject.isPending;

  const isHardGate = task.riskLevel === "hard_gate";

  async function handleApprove() {
    try {
      // Send editedPayload only for editable lanes whose buffer actually
      // changed — otherwise the stored payload is used as-is server-side.
      const changed = laneHasEditor(task.lane) && editedPayload !== task.payload;
      const res = await approve.mutateAsync(
        changed ? { id: task.id, editedPayload } : { id: task.id },
      );
      const spec = approveToastFor(task.lane, res);
      const text = spec.detail
        ? `${t(spec.i18nKey)}: ${spec.detail}`
        : t(spec.i18nKey);
      if (spec.kind === "success") toast.success(text);
      else toast.error(text);
      onClose();
      onDecided?.();
    } catch {
      toast.error(t("admin.commandCenter.toastError"));
    }
  }

  async function handleReject() {
    try {
      await reject.mutateAsync({
        id: task.id,
        reason: rejectReason.trim() || undefined,
      });
      toast.success(t("admin.commandCenter.toastRejected"));
      onClose();
      onDecided?.();
    } catch {
      toast.error(t("admin.commandCenter.toastError"));
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-8">{task.title}</DialogTitle>
        <div className="flex items-center gap-2 pt-1">
          <StatusDot
            tone={RISK_TONE[task.riskLevel]}
            label={t(RISK_I18N[task.riskLevel])}
          />
          <span className="text-xs text-gray-300">·</span>
          <span className="text-xs text-gray-500">{t(LANE_I18N[task.lane])}</span>
          <span className="text-xs text-gray-300">·</span>
          <span className="text-xs text-gray-500">{task.createdBy}</span>
        </div>
      </DialogHeader>

      <div className="max-h-[50vh] overflow-y-auto">
        {/* Lane body seam: editable (cs) where a lane provides an editor,
            else read-only. The dialog itself stays lane-agnostic. */}
        <LanePayloadBody
          lane={task.lane}
          summary={task.summary}
          payload={editedPayload}
          onChange={setEditedPayload}
        />
      </div>

      {/* hard_gate: money / irreversible → force explicit confirm */}
      {isHardGate && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-2">
          <div className="flex items-start gap-2 text-rose-700">
            <ShieldAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p className="text-xs">{t("admin.commandCenter.dialogHardGateWarn")}</p>
          </div>
          <Button
            type="button"
            variant={hardGateConfirmed ? "default" : "outline"}
            size="sm"
            onClick={() => setHardGateConfirmed((v) => !v)}
            className="h-7 rounded-lg gap-1.5 text-xs"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("admin.commandCenter.dialogHardGateConfirm")}
          </Button>
        </div>
      )}

      <Input
        value={rejectReason}
        onChange={(e) => setRejectReason(e.target.value)}
        placeholder={t("admin.commandCenter.dialogRejectReason")}
        className="h-8 rounded-lg text-xs"
      />

      <DialogFooter>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReject}
          disabled={busy}
          className="rounded-lg gap-1.5"
        >
          <Undo2 className="h-3.5 w-3.5" />
          {t("admin.commandCenter.dialogReject")}
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={handleApprove}
          disabled={busy || (isHardGate && !hardGateConfirmed)}
          className="rounded-lg gap-1.5"
        >
          <Send className="h-3.5 w-3.5" />
          {t("admin.commandCenter.dialogApprove")}
        </Button>
      </DialogFooter>
    </>
  );
}
