/**
 * toTourCardData — pure mapping from a lean catalog row + the batched soonest
 * departure into the shared TourCard's data shape.
 *
 * Self-contained on purpose: the only thing imported from actionArea.helpers is
 * `deriveStartingUsd` (HEAD-stable USD conversion). The availability bucket,
 * the soonest-departure pick, and the flight-inclusion read are kept LOCAL so
 * this design system ships independently of in-flight changes to that file.
 *
 * Red lines enforced here: the output carries only retail USD (never
 * agentPrice) and an availability BUCKET (never a seat count). Flight inclusion
 * checks `excluded` BEFORE `included` so the dirty-data "含/不含機票" case
 * under-promises ("excluded") instead of over-claiming "含機票".
 */
import { deriveStartingUsd } from "@/pages/TourDetailPeony/actionArea.helpers";
import type { TourCardData, AvailabilityBucket, LeanDeparture } from "./types";

/** Retail-safe fields a catalog card projection provides (no agentPrice). */
export interface LeanTourCardRow {
  id: number;
  title: string;
  destinationCountry?: string | null;
  destinationCity?: string | null;
  departureCity?: string | null;
  duration?: number | null;
  nights?: number | null;
  heroImage?: string | null;
  featured?: boolean;
  status?: string | null;
  price?: number | null;
  priceCurrency?: string | null;
  costExplanation?: unknown;
}

// Remaining seats at or below this read as 名額有限. Internal only — never shown.
const LIMITED_SEATS_THRESHOLD = 4;

/** Bucket a single departure. Returns a bucket string only, never a count. */
export function deriveBucket(
  d: LeanDeparture | null | undefined,
): AvailabilityBucket {
  if (!d) return "unknown";
  const status = (d.status ?? "").toLowerCase();
  if (status === "cancelled") return "unknown";
  if (status === "full") return "soldout";
  if (status === "waitlist") return "limited";
  const total = d.totalSlots;
  const booked = d.bookedSlots;
  if (
    typeof total === "number" && total > 0 &&
    typeof booked === "number" && booked >= 0
  ) {
    const remaining = total - booked;
    if (remaining <= 0) return "soldout";
    if (remaining <= LIMITED_SEATS_THRESHOLD) return "limited";
    return "available";
  }
  if (status === "open" || status === "confirmed") return "available";
  return "unknown";
}

const FLIGHT_RE = /機票|機位|air\s?fare|flights?/i;
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Flight inclusion from costExplanation; excluded checked first (under-promise). */
export function deriveCardFlight(
  costExplanation: unknown,
): "included" | "excluded" | "unknown" {
  let ce: unknown = costExplanation;
  if (typeof ce === "string") {
    try {
      ce = JSON.parse(ce);
    } catch {
      ce = null;
    }
  }
  if (!ce || typeof ce !== "object") return "unknown";
  const obj = ce as { included?: unknown; excluded?: unknown };
  if (asStringArray(obj.excluded).some((s) => FLIGHT_RE.test(s))) return "excluded";
  if (asStringArray(obj.included).some((s) => FLIGHT_RE.test(s))) return "included";
  return "unknown";
}

/** Soonest non-cancelled departure strictly in the future, else null. */
function pickSoonest(
  deps: LeanDeparture[],
  nowMs: number,
): LeanDeparture | null {
  const upcoming = deps
    .filter((d) => {
      if ((d.status ?? "").toLowerCase() === "cancelled") return false;
      const t = new Date(d.departureDate).getTime();
      return Number.isFinite(t) && t > nowMs;
    })
    .sort(
      (a, b) =>
        new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime(),
    );
  return upcoming[0] ?? null;
}

export function toTourCardData(
  row: LeanTourCardRow,
  soonest?: LeanDeparture | null,
  now: Date = new Date(),
): TourCardData {
  const deps = soonest ? [soonest] : [];
  const nextDep = pickSoonest(deps, now.getTime());
  const start = deriveStartingUsd(
    { price: row.price ?? null, priceCurrency: row.priceCurrency ?? null },
    deps,
  );
  return {
    id: row.id,
    title: row.title,
    destinationCountry: row.destinationCountry ?? null,
    destinationCity: row.destinationCity ?? null,
    departureCity: row.departureCity ?? null,
    duration: row.duration ?? null,
    nights: row.nights ?? null,
    heroImage: row.heroImage ?? null,
    featured: row.featured ?? false,
    status: row.status ?? null,
    // soldout on the tour record wins over a stale "available" departure.
    availabilityBucket: row.status === "soldout" ? "soldout" : deriveBucket(nextDep),
    soonestDepartureDate: nextDep?.departureDate
      ? new Date(nextDep.departureDate).toISOString()
      : null,
    startingUsd: start?.usd ?? null,
    startingApprox: start?.approx ?? false,
    flightInclusion: deriveCardFlight(row.costExplanation),
  };
}
