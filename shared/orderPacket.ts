/**
 * Phase 1.5: the supplier order packet. When PACK&GO places a booking with the
 * real operator (UV / Lion), it needs the full passenger manifest in one place
 * plus a file the supplier portal can ingest. This module holds the shared shape
 * + a pure CSV builder so the same structure is produced server-side (assembly,
 * with audit-logged passport decryption) and rendered/downloaded client-side.
 *
 * Passport numbers in this packet are PLAINTEXT (decrypted server-side for the
 * legitimate booking purpose). The proc that builds it is admin-only and
 * audit-logs every access. Do not log or transmit this packet anywhere except
 * to the authenticated admin who requested it.
 */
export interface OrderPacketPassenger {
  index: number;
  type: string; // adult / child / infant
  lastName: string;
  firstName: string;
  gender?: string | null;
  dateOfBirth?: string | null; // YYYY-MM-DD
  nationality?: string | null;
  passportNumber?: string | null;
  passportExpiry?: string | null; // YYYY-MM-DD
}

export interface OrderPacket {
  bookingId: number;
  tourTitle: string;
  departureDate?: string | null;
  supplier?: string | null; // tour.sourceVendor (lion / zongheng / house / other)
  supplierBookingRef?: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  pax: {
    adults: number;
    childrenWithBed: number;
    childrenNoBed: number;
    infants: number;
  };
  passengers: OrderPacketPassenger[];
}

/** RFC-4180-ish CSV cell: quote when it contains comma, quote, or newline. */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const PASSENGER_HEADERS = [
  "#",
  "Type",
  "Last Name",
  "First Name",
  "Gender",
  "Date of Birth",
  "Nationality",
  "Passport No.",
  "Passport Expiry",
];

/**
 * Build a CSV the supplier can open in Excel: a small meta block (booking / tour
 * / departure / supplier ref), a blank line, then the passenger manifest table.
 * Pure + dependency-free.
 */
export function orderPacketToCsv(p: OrderPacket): string {
  const lines: string[] = [];
  lines.push(["Booking", `#${p.bookingId}`].map(csvCell).join(","));
  lines.push(["Tour", p.tourTitle].map(csvCell).join(","));
  lines.push(["Departure", p.departureDate ?? ""].map(csvCell).join(","));
  lines.push(["Supplier", p.supplier ?? ""].map(csvCell).join(","));
  lines.push(["Supplier Ref", p.supplierBookingRef ?? ""].map(csvCell).join(","));
  lines.push(["Contact", p.contactName, p.contactPhone, p.contactEmail].map(csvCell).join(","));
  lines.push(""); // blank separator
  lines.push(PASSENGER_HEADERS.map(csvCell).join(","));
  for (const pax of p.passengers) {
    lines.push(
      [
        pax.index,
        pax.type,
        pax.lastName,
        pax.firstName,
        pax.gender ?? "",
        pax.dateOfBirth ?? "",
        pax.nationality ?? "",
        pax.passportNumber ?? "",
        pax.passportExpiry ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}
