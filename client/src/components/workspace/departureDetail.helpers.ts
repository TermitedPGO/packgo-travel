/**
 * departureDetail.helpers — readiness derivation + CSV export for DepartureDetailSheet.
 */

export type ReadinessItem = {
  key: string;
  labelKey: string;
  status: "done" | "pending" | "not_impl";
};

export function deriveReadiness(
  departure: { tourLeader: string | null; bookedSlots: number | null; opsStatus: string | null },
  participants: Array<{ passportNumber: string | null }>,
  bookings: Array<{ supplierStatus: string }>,
  noticeStatus?: "done" | "pending" | "not_impl",
): ReadinessItem[] {
  const allPassports =
    participants.length > 0 && participants.every((p) => p.passportNumber);
  const allSupplierConfirmed =
    bookings.length > 0 &&
    bookings.every((b) => b.supplierStatus === "vendor_confirmed");
  const leaderAssigned = !!departure.tourLeader;
  const rosterVerified = (departure.bookedSlots ?? 0) > 0;

  return [
    {
      key: "passport",
      labelKey: "workspace.depReadinessPassport",
      status: allPassports ? "done" : "pending",
    },
    {
      key: "supplier",
      labelKey: "workspace.depReadinessSupplier",
      status: allSupplierConfirmed ? "done" : "pending",
    },
    {
      key: "notice",
      labelKey: "workspace.depReadinessNotice",
      status: noticeStatus ?? "not_impl",
    },
    {
      key: "leader",
      labelKey: "workspace.depReadinessLeader",
      status: leaderAssigned ? "done" : "pending",
    },
    {
      key: "roster",
      labelKey: "workspace.depReadinessRoster",
      status: rosterVerified ? "done" : "pending",
    },
  ];
}

export function exportCsv(
  participants: Array<{
    firstName: string | null;
    lastName: string | null;
    gender: string | null;
    dateOfBirth: Date | string | null;
    passportNumber: string | null;
    nationality: string | null;
  }>,
  tourTitle: string | null,
) {
  const header = "Last Name,First Name,Gender,DOB,Passport (last 4),Nationality";
  const rows = participants.map(
    (p) =>
      [
        p.lastName ?? "",
        p.firstName ?? "",
        p.gender ?? "",
        p.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString() : "",
        p.passportNumber ?? "",
        p.nationality ?? "",
      ]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(","),
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roster-${(tourTitle ?? "departure").replace(/[^a-zA-Z0-9]/g, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
