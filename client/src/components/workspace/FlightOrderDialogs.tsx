/**
 * FlightOrderDialogs — create-booking + record-ticketing dialogs for the
 * 代客訂機票 section (批2 m4). Record-keeping only: the create form takes
 * passport-SPELLING names (never numbers — the schema has no such column)
 * and an optional Trip.com URL (present → lands directly at 待你刷卡);
 * the ticket form just records PNR / e-ticket / order ref AFTER Jeff paid
 * by his own hand. Dialog primitive owns padding (§2.5).
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function FlightOrderDialogs({
  userId,
  createOpen,
  onCreateClose,
  ticketFor,
  onTicketClose,
  onChanged,
}: {
  userId: number;
  createOpen: boolean;
  onCreateClose: () => void;
  ticketFor: number | null;
  onTicketClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [form, setForm] = useState({
    airline: "",
    flightSummary: "",
    pricePerPerson: "",
    passengerCount: "1",
    passengerNames: "",
    bookingUrl: "",
  });
  const [ticket, setTicket] = useState({ pnr: "", eticketNumbers: "", orderRef: "" });

  const create = trpc.flightOrders.create.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.flightCreated"));
      setForm({ airline: "", flightSummary: "", pricePerPerson: "", passengerCount: "1", passengerNames: "", bookingUrl: "" });
      onCreateClose();
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const markTicketed = trpc.flightOrders.markTicketed.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.flightUpdated"));
      setTicket({ pnr: "", eticketNumbers: "", orderRef: "" });
      onTicketClose();
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const submitCreate = () => {
    if (!form.airline.trim() || !form.flightSummary.trim()) return;
    create.mutate({
      customerUserId: userId,
      airline: form.airline.trim(),
      flightSummary: form.flightSummary.trim(),
      pricePerPerson: form.pricePerPerson ? Number(form.pricePerPerson) : undefined,
      passengerCount: form.passengerCount ? Number(form.passengerCount) : undefined,
      passengerNames: form.passengerNames.trim() || undefined,
      bookingUrl: form.bookingUrl.trim() || undefined,
    });
  };

  const field = (label: string, key: keyof typeof form, props: Record<string, unknown> = {}) => (
    <div>
      <label className="text-xs font-medium text-gray-600 block mb-1">{label}</label>
      <Input
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="rounded-lg"
        {...props}
      />
    </div>
  );

  return (
    <>
      <Dialog open={createOpen} onOpenChange={(o) => !o && onCreateClose()}>
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle>{t("workspace.flightAdd")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {field(t("workspace.flightAirline"), "airline")}
            {field(t("workspace.flightSummaryLabel"), "flightSummary")}
            <div className="grid grid-cols-2 gap-3">
              {field(t("workspace.flightPrice"), "pricePerPerson", { type: "number", min: 0 })}
              {field(t("workspace.flightCount"), "passengerCount", { type: "number", min: 1 })}
            </div>
            {field(t("workspace.flightNames"), "passengerNames")}
            {field(t("workspace.flightUrl"), "bookingUrl", { placeholder: "https://…" })}
            {/* 硬線可見化 */}
            <p className="text-[11px] font-medium">{t("workspace.flightLockBar")}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-lg" onClick={onCreateClose}>
              {t("admin.agentChat.cancel")}
            </Button>
            <Button
              className="rounded-lg"
              disabled={create.isPending || !form.airline.trim() || !form.flightSummary.trim()}
              onClick={submitCreate}
            >
              {t("workspace.flightCreate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ticketFor !== null} onOpenChange={(o) => !o && onTicketClose()}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>{t("workspace.flightFillTicket")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {(["pnr", "eticketNumbers", "orderRef"] as const).map((k) => (
              <div key={k}>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  {k === "pnr"
                    ? "PNR"
                    : k === "eticketNumbers"
                      ? t("workspace.flightEticket")
                      : t("workspace.flightOrderRef")}
                </label>
                <Input
                  value={ticket[k]}
                  onChange={(e) => setTicket((s) => ({ ...s, [k]: e.target.value }))}
                  className="rounded-lg"
                />
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-lg" onClick={onTicketClose}>
              {t("admin.agentChat.cancel")}
            </Button>
            <Button
              className="rounded-lg"
              disabled={markTicketed.isPending || ticketFor === null}
              onClick={() =>
                ticketFor !== null &&
                markTicketed.mutate({
                  id: ticketFor,
                  pnr: ticket.pnr.trim() || undefined,
                  eticketNumbers: ticket.eticketNumbers.trim() || undefined,
                  orderRef: ticket.orderRef.trim() || undefined,
                })
              }
            >
              {t("workspace.flightSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
