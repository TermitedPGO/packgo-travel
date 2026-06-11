/**
 * DepartureDetailSheet — batch 6 m2: departure detail with readiness chips,
 * cross-booking roster, CSV export, and group notes.
 */
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { LoadingPage } from "@/components/ui/spinner";
import { Badge, BadgeK, Vault, Kv } from "./ws-ui";
import { BtnO } from "./ws-ui";
import { deriveReadiness, exportCsv } from "./departureDetail.helpers";
import PreDepartureNotices from "./PreDepartureNotices";

type Props = {
  departureId: number;
  open: boolean;
  onClose: () => void;
};

export default function DepartureDetailSheet({
  departureId,
  open,
  onClose,
}: Props) {
  const { t } = useLocale();
  const q = trpc.admin.departureDetail.useQuery(
    { departureId },
    { enabled: open },
  );

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

  const { departure, tourTitle, bookings, participants, notes } = q.data;
  const pdnQ = trpc.preDepartureNotifications.list.useQuery({ departureId });
  const pdnItems = pdnQ.data ?? [];
  const noticeStatus: "done" | "pending" | "not_impl" =
    pdnItems.length === 0
      ? "pending"
      : pdnItems.every((n) => n.status === "sent" || n.status === "skipped")
        ? "done"
        : "pending";
  const readiness = deriveReadiness(departure, participants, bookings, noticeStatus);
  const missing = readiness.filter((r) => r.status === "pending").length;

  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent className="w-full xl:max-w-2xl xl:rounded-l-xl overflow-y-auto">
        <SheetHeader className="border-b">
          <SheetTitle>{tourTitle ?? t("workspace.depDetail")}</SheetTitle>
          <SheetDescription>
            {t("workspace.depDate")}{" "}
            {new Date(departure.departureDate).toLocaleDateString()}
            {departure.returnDate &&
              ` · ${t("workspace.depReturn")} ${new Date(departure.returnDate).toLocaleDateString()}`}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-4">
          {/* Basic info */}
          <div className="space-y-1">
            <Kv
              k={t("workspace.depSlots").replace("{booked}/{total}", "").trim() || "Pax"}
              v={t("workspace.depSlots")
                .replace("{booked}", String(departure.bookedSlots ?? 0))
                .replace("{total}", String(departure.totalSlots ?? 0))}
            />
            <Kv
              k={t("workspace.depLeader")}
              v={departure.tourLeader || t("workspace.depNoLeader")}
            />
          </div>

          {/* Readiness chips */}
          <section>
            <h3 className="text-sm font-bold mb-2">
              {t("workspace.depReadiness")}
            </h3>
            <div className="flex flex-wrap gap-2">
              {readiness.map((r) =>
                r.status === "done" ? (
                  <Badge key={r.key}>
                    {t(r.labelKey)} · {t("workspace.depReadinessDone")}
                  </Badge>
                ) : r.status === "not_impl" ? (
                  <span
                    key={r.key}
                    className="text-[10px] px-1.5 py-0.5 rounded-md border border-dashed border-gray-300 text-gray-400"
                  >
                    {t(r.labelKey)} · {t("workspace.depReadinessNotImpl")}
                  </span>
                ) : (
                  <BadgeK key={r.key}>
                    {t(r.labelKey)} · {t("workspace.depReadinessPending")}
                  </BadgeK>
                ),
              )}
            </div>
            {missing > 0 && (
              <div className="rounded-lg bg-black text-white text-xs px-3 py-2.5 font-medium mt-2">
                {t("workspace.depMissing").replace("{n}", String(missing))}
              </div>
            )}
          </section>

          {/* Roster */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold">
                {t("workspace.depRoster")}
              </h3>
              <BtnO onClick={() => exportCsv(participants, tourTitle)}>
                {t("workspace.depExportCsv")}
              </BtnO>
            </div>
            <Vault>{t("workspace.bookingPassportVault")}</Vault>

            {/* Desktop table */}
            <div className="hidden sm:block mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="py-1.5 pr-3 font-medium">
                      {t("workspace.bookingName")}
                    </th>
                    <th className="py-1.5 pr-3 font-medium">
                      {t("workspace.bookingGender")}
                    </th>
                    <th className="py-1.5 pr-3 font-medium">
                      {t("workspace.bookingDob")}
                    </th>
                    <th className="py-1.5 font-medium">
                      {t("workspace.bookingPassport")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p) => (
                    <tr key={p.id} className="border-b border-gray-100">
                      <td className="py-1.5 pr-3">
                        {p.lastName} {p.firstName}
                      </td>
                      <td className="py-1.5 pr-3">
                        {p.gender === "male"
                          ? t("workspace.bookingMale")
                          : t("workspace.bookingFemale")}
                      </td>
                      <td className="py-1.5 pr-3">
                        {p.dateOfBirth
                          ? new Date(p.dateOfBirth).toLocaleDateString()
                          : "-"}
                      </td>
                      <td className="py-1.5 font-mono">
                        {p.passportNumber ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden mt-2 space-y-2">
              {participants.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-gray-200 p-3 text-xs"
                >
                  <div className="font-medium">
                    {p.lastName} {p.firstName}
                  </div>
                  <div className="text-gray-500 mt-0.5">
                    {p.gender === "male"
                      ? t("workspace.bookingMale")
                      : t("workspace.bookingFemale")}
                    {" · "}
                    {p.dateOfBirth
                      ? new Date(p.dateOfBirth).toLocaleDateString()
                      : "-"}
                  </div>
                  <div className="font-mono mt-0.5">
                    {p.passportNumber ?? "-"}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Pre-departure notifications (m3) */}
          <PreDepartureNotices departureId={departureId} />

          {/* Group notes */}
          <section>
            <h3 className="text-sm font-bold mb-2">{t("workspace.depNotes")}</h3>
            {notes.length === 0 ? (
              <p className="text-xs text-gray-400">
                {t("workspace.depNoNotes")}
              </p>
            ) : (
              <div className="space-y-2">
                {notes.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-lg border border-gray-200 p-3 text-xs"
                  >
                    <div className="flex justify-between text-gray-500 mb-1">
                      <span className="font-medium">{n.author}</span>
                      <span>
                        {new Date(n.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap">{n.body}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
