/**
 * bookingDetail.helpers — sub-components for BookingDetailSheet.
 * CancelDialog (gated confirm) + VoucherSection (縮編 redeem-in-place).
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { BtnB } from "./ws-ui";

/* ---------- Cancel confirm dialog ---------- */

export function CancelDialog({
  bookingId,
  currency,
  depositAmount,
  open,
  onClose,
  onDone,
}: {
  bookingId: number;
  currency: string;
  depositAmount: number;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(String(depositAmount));
  const refund = trpc.bookings.adminRefund.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.bookingStCancelled"));
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle>{t("workspace.bookingCancelTitle")}</DialogTitle>
          <DialogDescription>
            {t("workspace.bookingCancelWarn")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-xs font-medium block mb-1">
              {t("workspace.bookingCancelAmount")} ({currency})
            </label>
            <input
              type="number"
              min={0}
              max={depositAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">
              {t("workspace.bookingCancelReason")}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
            />
          </div>
          <BtnB
            disabled={refund.isPending || !reason.trim()}
            onClick={() =>
              refund.mutate({
                bookingId,
                amount: Number(amount) || undefined,
                reason: reason.trim(),
              })
            }
          >
            {t("workspace.bookingCancelConfirm")}
          </BtnB>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Voucher section ---------- */

export function VoucherSection({
  vouchers,
  bookingId,
  locked,
  onRedeemed,
}: {
  vouchers: Array<{
    id: number;
    type: string;
    code: string;
    amountUsd: number;
    status: string;
    expiresAt: Date | string | null;
  }>;
  bookingId: number;
  locked: boolean;
  onRedeemed: () => void;
}) {
  const { t } = useLocale();
  const redeem = trpc.vouchers.adminMarkRedeemed.useMutation({
    onSuccess: () => {
      toast.success("OK");
      onRedeemed();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <section>
      <h3 className="text-sm font-bold mb-2">
        {t("workspace.bookingVoucherSection")}
      </h3>
      <div className="space-y-1.5">
        {vouchers.map((v) => (
          <div
            key={v.id}
            className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-xs"
          >
            <div>
              <span className="font-mono">{v.code}</span>
              <span className="text-gray-500 ml-2">
                ${v.amountUsd} · {v.type}
              </span>
            </div>
            {!locked && (
              <button
                disabled={redeem.isPending}
                onClick={() =>
                  redeem.mutate({ voucherId: v.id, bookingId })
                }
                className="rounded-md bg-black text-white px-2 py-1 text-[11px] font-medium disabled:opacity-50"
              >
                {t("workspace.bookingVoucherApply")}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
