/**
 * BookingDetailSheet — batch 6 m1: booking detail inside CustomerInbox.
 * Opens as a right-sliding sheet when clicking a booking card.
 */
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { LoadingPage } from "@/components/ui/spinner";
import { Badge, BadgeK, Vault, Kv } from "./ws-ui";
import { BtnB, BtnO } from "./ws-ui";
import { CancelDialog, VoucherSection } from "./bookingDetail.helpers";

type Props = {
  bookingId: number;
  open: boolean;
  onClose: () => void;
  onChaseBalance?: () => void;
};

export default function BookingDetailSheet({
  bookingId,
  open,
  onClose,
  onChaseBalance,
}: Props) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const q = trpc.bookings.adminGetDetail.useQuery(
    { bookingId },
    { enabled: open },
  );
  const [cancelOpen, setCancelOpen] = useState(false);

  if (!open) return null;
  if (q.isLoading) {
    return (
      <Sheet open onOpenChange={onClose}>
        <SheetContent className="w-full xl:max-w-2xl xl:rounded-l-xl overflow-y-auto">
          <LoadingPage text={t("workspace.loading")} />
        </SheetContent>
      </Sheet>
    );
  }
  if (!q.data) return null;

  const { booking, tourTitle, departure, participants, vouchers } = q.data;
  const locked =
    booking.bookingStatus === "completed" ||
    booking.bookingStatus === "cancelled";

  return (
    <>
      <Sheet open onOpenChange={onClose}>
        <SheetContent className="w-full xl:max-w-2xl xl:rounded-l-xl overflow-y-auto">
          <SheetHeader className="border-b">
            <SheetTitle>{tourTitle ?? t("workspace.bookingDetail")}</SheetTitle>
            <SheetDescription>
              {t("workspace.bookingId")} #{bookingId}
              {departure?.departureDate &&
                ` · ${t("workspace.bookingDeparture")} ${new Date(departure.departureDate).toLocaleDateString()}`}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 py-4">
            <div className="flex flex-wrap gap-2">
              <Badge>
                {t("workspace.bookingPaySt")}:{" "}
                {t(`workspace.bookingPay${cap(booking.paymentStatus)}`)}
              </Badge>
              <Badge>
                {t("workspace.bookingSupplierSt")}:{" "}
                {t(supKey(booking.supplierStatus))}
              </Badge>
              {locked && (
                <BadgeK>
                  {t(`workspace.bookingSt${cap(booking.bookingStatus)}`)}
                </BadgeK>
              )}
            </div>

            {booking.paymentStatus !== "unpaid" &&
              booking.supplierStatus !== "vendor_confirmed" && (
                <div className="rounded-lg bg-black text-white text-xs px-3 py-2.5 font-medium">
                  {t("workspace.bookingWarnNotSecured")}
                </div>
              )}

            <PaymentSection booking={booking} t={t} />

            <ParticipantSection participants={participants} t={t} />

            {vouchers.length > 0 && (
              <VoucherSection
                vouchers={vouchers}
                bookingId={bookingId}
                locked={locked}
                onRedeemed={() =>
                  utils.bookings.adminGetDetail.invalidate({ bookingId })
                }
              />
            )}

            {!locked && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200">
                <BtnO
                  onClick={() =>
                    toast.info(t("workspace.bookingRescheduleNote"))
                  }
                >
                  {t("workspace.bookingReschedule")}
                </BtnO>
                <BtnB onClick={() => setCancelOpen(true)}>
                  {t("workspace.bookingCancel")}
                </BtnB>
                {booking.paymentStatus !== "paid" && onChaseBalance && (
                  <BtnO onClick={onChaseBalance}>
                    {t("workspace.bookingChaseBalance")}
                  </BtnO>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {cancelOpen && (
        <CancelDialog
          bookingId={bookingId}
          currency={booking.currency}
          depositAmount={booking.depositAmount}
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          onDone={() => {
            setCancelOpen(false);
            utils.bookings.adminGetDetail.invalidate({ bookingId });
            onClose();
          }}
        />
      )}
    </>
  );
}

/* ---------- sub-sections ---------- */

function PaymentSection({
  booking,
  t,
}: {
  booking: {
    currency: string;
    totalPrice: number;
    depositAmount: number;
    remainingAmount: number;
  };
  t: (k: string) => string;
}) {
  return (
    <section>
      <h3 className="text-sm font-bold mb-2">{t("workspace.bookingPayment")}</h3>
      <div className="space-y-1">
        <Kv
          k={t("workspace.bookingSubtotal")}
          v={`${booking.currency} ${booking.totalPrice.toLocaleString()}`}
        />
        <Kv
          k={t("workspace.bookingDeposit")}
          v={`${booking.currency} ${booking.depositAmount.toLocaleString()}`}
        />
        <Kv
          k={t("workspace.bookingRemaining")}
          v={`${booking.currency} ${booking.remainingAmount.toLocaleString()}`}
        />
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        {t("workspace.bookingTrustLedger")}
      </p>
    </section>
  );
}

function ParticipantSection({
  participants,
  t,
}: {
  participants: Array<{
    id: number;
    firstName: string | null;
    lastName: string | null;
    gender: string | null;
    dateOfBirth: Date | string | null;
    passportNumber: string | null;
  }>;
  t: (k: string) => string;
}) {
  return (
    <section>
      <h3 className="text-sm font-bold mb-2">
        {t("workspace.bookingParticipants")}
      </h3>
      <Vault>{t("workspace.bookingPassportVault")}</Vault>

      {/* Desktop table */}
      <div className="hidden sm:block mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-1.5 pr-3 font-medium">{t("workspace.bookingName")}</th>
              <th className="py-1.5 pr-3 font-medium">{t("workspace.bookingGender")}</th>
              <th className="py-1.5 pr-3 font-medium">{t("workspace.bookingDob")}</th>
              <th className="py-1.5 font-medium">{t("workspace.bookingPassport")}</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <tr key={p.id} className="border-b border-gray-100">
                <td className="py-1.5 pr-3">{p.lastName} {p.firstName}</td>
                <td className="py-1.5 pr-3">
                  {p.gender === "male" ? t("workspace.bookingMale") : t("workspace.bookingFemale")}
                </td>
                <td className="py-1.5 pr-3">
                  {p.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString() : "-"}
                </td>
                <td className="py-1.5 font-mono">{p.passportNumber ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden mt-2 space-y-2">
        {participants.map((p) => (
          <div key={p.id} className="rounded-xl border border-gray-200 p-3 text-xs">
            <div className="font-medium">{p.lastName} {p.firstName}</div>
            <div className="text-gray-500 mt-0.5">
              {p.gender === "male" ? t("workspace.bookingMale") : t("workspace.bookingFemale")}
              {" · "}
              {p.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString() : "-"}
            </div>
            <div className="font-mono mt-0.5">{p.passportNumber ?? "-"}</div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-gray-400 mt-2">
        {t("workspace.bookingPassportNote")}
      </p>
    </section>
  );
}

/* ---------- helpers ---------- */

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SUP_KEY: Record<string, string> = {
  not_placed: "workspace.bookingSupNotPlaced",
  placed: "workspace.bookingSupPlaced",
  vendor_confirmed: "workspace.bookingSupConfirmed",
  vendor_rejected: "workspace.bookingSupRejected",
  waitlisted: "workspace.bookingSupWaitlisted",
};

function supKey(status: string) {
  return SUP_KEY[status] ?? SUP_KEY.not_placed;
}
