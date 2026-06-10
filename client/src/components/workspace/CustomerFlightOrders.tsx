/**
 * CustomerFlightOrders — 代客訂機票 section of the per-customer inbox
 * (批2 m4, sales mockup p3). Minimal state machine UI:
 *
 *   備訂 (prepared) → 待你刷卡 (awaiting_payment) → TICKETED 黑卡
 *
 * HARD LINE made visible: the un-dismissable black lock bar whenever an
 * active order exists —「我來刷卡」only OPENS the Trip.com page in a new
 * tab; no card field exists anywhere on this surface. Ticketing is a
 * RECORD-ONLY form (PNR / e-ticket / order ref) after Jeff paid himself.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { Lock } from "lucide-react";
import { formatRelTime } from "./relTime";
import { BtnO, WorkspaceCard } from "./ws-ui";
import FlightOrderDialogs from "./FlightOrderDialogs";

export default function CustomerFlightOrders({ userId }: { userId: number }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const listQ = trpc.flightOrders.list.useQuery({ userId });
  const [createOpen, setCreateOpen] = useState(false);
  const [ticketFor, setTicketFor] = useState<number | null>(null);
  const [urlDraft, setUrlDraft] = useState<Record<number, string>>({});

  const invalidate = () => utils.flightOrders.list.invalidate({ userId });
  const markAwait = trpc.flightOrders.markAwaitingPayment.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.flightUpdated"));
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancel = trpc.flightOrders.cancel.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.flightUpdated"));
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const orders = listQ.data ?? [];
  const hasActive = orders.some(
    (o) => o.status === "prepared" || o.status === "awaiting_payment",
  );

  const priceLine = (o: (typeof orders)[number]) =>
    o.pricePerPerson != null
      ? `${o.currency} ${o.pricePerPerson.toLocaleString()} ${t("workspace.flightPerPerson", { n: o.passengerCount })}`
      : "";

  return (
    <>
      <div className="flex items-center gap-2 mb-2 mt-5">
        <span className="text-[11px] font-semibold text-gray-400">
          {t("workspace.flightSection")} ({orders.length})
        </span>
        <BtnO onClick={() => setCreateOpen(true)}>
          {t("workspace.flightAdd")}
        </BtnO>
      </div>

      {/* un-dismissable hard-line bar (mockup p3) — shown while any active */}
      {hasActive && (
        <div className="rounded-xl bg-black text-white px-4 py-2 mb-2.5 flex items-center gap-2 text-[12px]">
          <Lock className="w-4 h-4 flex-shrink-0" />
          <span className="font-medium">{t("workspace.flightLockBar")}</span>
        </div>
      )}

      {orders.length > 0 && (
        <div className="space-y-2.5">
          {orders.map((o) =>
            o.status === "ticketed" ? (
              /* TICKETED 黑卡 (mockup p3 confirmation block) */
              <div key={o.id} className="rounded-xl bg-black text-white p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white text-black">
                    {t("workspace.flightStTicketed")}
                  </span>
                  <span className="text-[11px] text-gray-300">
                    {formatRelTime(o.updatedAt, t)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                  <Field k={t("workspace.flightSummaryLabel")} v={`${o.airline} ${o.flightSummary}`} />
                  <Field k={t("workspace.flightNames")} v={o.passengerNames ?? ""} />
                  <Field k="PNR" v={o.pnr ?? ""} />
                  <Field k={t("workspace.flightEticket")} v={o.eticketNumbers ?? ""} />
                  <Field k={t("workspace.flightOrderRef")} v={o.orderRef ?? ""} />
                  <Field k={t("workspace.flightPaid")} v={priceLine(o)} />
                </div>
              </div>
            ) : (
              <WorkspaceCard
                key={o.id}
                type={t("workspace.flightSection")}
                lock={o.status !== "cancelled"}
                time={formatRelTime(o.createdAt, t)}
                state={
                  o.status === "cancelled"
                    ? "done"
                    : o.status === "awaiting_payment"
                      ? "wait"
                      : "none"
                }
                waitLabel={t("workspace.flightStAwait")}
              >
                <div className="font-medium">
                  {o.airline} · {o.flightSummary}
                </div>
                <div className="text-gray-500 mt-0.5 text-[12px]">
                  {priceLine(o)}
                  {o.passengerNames ? ` · ${o.passengerNames}` : ""}
                </div>
                {o.status === "awaiting_payment" && (
                  <>
                    <div className="rounded-lg bg-black text-white p-2 text-[11px] mt-2 flex items-start gap-1.5">
                      <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                      <span>{t("workspace.flightPayNote")}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {o.bookingUrl && (
                        <a
                          href={o.bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 rounded-lg bg-black text-white text-[11px] font-medium inline-block"
                        >
                          {t("workspace.flightPay")}
                        </a>
                      )}
                      <BtnO onClick={() => setTicketFor(o.id)}>
                        {t("workspace.flightFillTicket")}
                      </BtnO>
                      <BtnO
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate({ id: o.id })}
                      >
                        {t("workspace.flightCancel")}
                      </BtnO>
                    </div>
                  </>
                )}
                {o.status === "prepared" && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <input
                      value={urlDraft[o.id] ?? ""}
                      onChange={(e) =>
                        setUrlDraft((d) => ({ ...d, [o.id]: e.target.value }))
                      }
                      placeholder={t("workspace.flightUrl")}
                      className="flex-1 min-w-[180px] px-2.5 py-1 rounded-lg border border-gray-300 text-[11px] outline-none"
                    />
                    <BtnO
                      disabled={markAwait.isPending || !(urlDraft[o.id] ?? "").trim()}
                      onClick={() =>
                        markAwait.mutate({
                          id: o.id,
                          bookingUrl: (urlDraft[o.id] ?? "").trim(),
                        })
                      }
                    >
                      {t("workspace.flightToAwait")}
                    </BtnO>
                    <BtnO onClick={() => setTicketFor(o.id)}>
                      {t("workspace.flightFillTicket")}
                    </BtnO>
                    <BtnO
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate({ id: o.id })}
                    >
                      {t("workspace.flightCancel")}
                    </BtnO>
                  </div>
                )}
              </WorkspaceCard>
            ),
          )}
        </div>
      )}

      <FlightOrderDialogs
        userId={userId}
        createOpen={createOpen}
        onCreateClose={() => setCreateOpen(false)}
        ticketFor={ticketFor}
        onTicketClose={() => setTicketFor(null)}
        onChanged={invalidate}
      />
    </>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-400">{k}</div>
      <div className="font-semibold break-words">{v || "—"}</div>
    </div>
  );
}
