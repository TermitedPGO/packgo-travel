/**
 * TourDetailPeony / actionArea.helpers.ts
 *
 * Pure, framework-free helpers for the redesigned "decision + action" area
 * (feature: tour-page-redesign, Stage 1 + 2). No React / i18n imports here so
 * every function is trivially unit-testable (see actionArea.helpers.test.ts).
 *
 * Display strings are injected by the caller (the components own i18n); these
 * helpers only do data derivation + payload shaping.
 */

// ─── Wizard answer vocabulary ──────────────────────────────────────────────
// Stored as language-neutral keys so the JSON column stays filterable
// regardless of the UI language the customer browsed in.

export type WizardPeople = "1-2" | "3-5" | "6+";
export type WizardTimeframe = "soon" | "school_break" | "discuss";
export type WizardBudget = "economy" | "comfort" | "luxury";

export interface WizardAnswers {
  people?: WizardPeople;
  timeframe?: WizardTimeframe;
  budget?: WizardBudget;
}

export type InquiryMode = "quote" | "custom";

// ─── Minimal structural input shapes ───────────────────────────────────────
// The page passes `any` tour/departure objects; we narrow to just the fields
// these helpers read.

export interface DepartureLike {
  id?: number;
  departureDate: string | number | Date;
  adultPrice?: number | null;
  status?: string | null;
  totalSlots?: number | null;
  bookedSlots?: number | null;
  currency?: string | null;
}

export interface TourLike {
  id: number;
  title?: string | null;
  price?: number | null;
  priceCurrency?: string | null;
  duration?: number | null;
  nights?: number | null;
  departureCity?: string | null;
  departureCountry?: string | null;
  maxParticipants?: number | null;
  costExplanation?: unknown; // string JSON or { included?: string[]; excluded?: string[] }
}

// Approximate TWD -> USD rate. Kept in sync with helpers.tsx `TWD_PER_USD`
// (formatDualPrice). Duplicated locally so this module stays React-free for
// lightweight unit tests; update both together when a dynamic rate lands.
export const TWD_PER_USD = 32;

// ─── Next departure ────────────────────────────────────────────────────────

export interface NextDepartureResult {
  departure: DepartureLike;
  isConfirmed: boolean;
}

/**
 * Earliest non-cancelled departure strictly in the future.
 * Returns null when none qualify (caller shows an "ask us" fallback).
 */
export function deriveNextDeparture(
  departures: DepartureLike[] | null | undefined,
  now: Date = new Date(),
): NextDepartureResult | null {
  if (!departures || departures.length === 0) return null;
  const nowMs = now.getTime();
  const upcoming = departures
    .filter((d) => {
      if ((d.status ?? "").toLowerCase() === "cancelled") return false;
      const t = new Date(d.departureDate).getTime();
      return Number.isFinite(t) && t > nowMs;
    })
    .sort(
      (a, b) =>
        new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime(),
    );
  const next = upcoming[0];
  if (!next) return null;
  return {
    departure: next,
    isConfirmed: (next.status ?? "").toLowerCase() === "confirmed",
  };
}

// ─── Flight inclusion ──────────────────────────────────────────────────────

// Matches "機票"/"機位"/"airfare"/"flight(s)". Deliberately NOT just "機" so
// "機場接送" (airport transfer) does not false-positive as airfare.
const FLIGHT_RE = /機票|機位|air\s?fare|flights?/i;

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Decide whether the tour price includes flights, read ONLY from
 * costExplanation (the one honest source). Mere presence of flight metadata
 * does not prove inclusion, so anything ambiguous returns "unknown" and the
 * caller omits the chip rather than overclaiming.
 *
 * Conservative ordering: we check `excluded` BEFORE `included`. For Asia tours
 * sold to US customers, flights are almost never bundled, and over-claiming
 * "含機票" is the dangerous error (it sets a wrong, costly expectation). So when
 * the supplier data tags flights in BOTH arrays (the dirty-data case behind the
 * "標題不含機票 / 快速資訊含機票" contradiction), we under-promise: "excluded".
 * The catalog re-scrape will clean the source; until then this stays honest.
 */
export function deriveFlightInclusion(
  tour: Pick<TourLike, "costExplanation">,
): "included" | "excluded" | "unknown" {
  let ce: any = tour?.costExplanation;
  if (typeof ce === "string") {
    try {
      ce = JSON.parse(ce);
    } catch {
      ce = null;
    }
  }
  if (!ce || typeof ce !== "object") return "unknown";
  if (asStringArray(ce.excluded).some((s) => FLIGHT_RE.test(s))) return "excluded";
  if (asStringArray(ce.included).some((s) => FLIGHT_RE.test(s))) return "included";
  return "unknown";
}

// ─── Starting price in USD ─────────────────────────────────────────────────

function toUsd(
  price: number | null | undefined,
  currency: string | null | undefined,
): { usd: number; approx: boolean } | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  const cur = (currency ?? "TWD").toUpperCase();
  if (cur === "USD") return { usd: price, approx: false };
  if (cur === "TWD") return { usd: price / TWD_PER_USD, approx: true };
  return null; // unknown currency: do not fabricate a conversion
}

export interface StartingPriceResult {
  usd: number; // rounded
  approx: boolean; // true when the chosen minimum came from a TWD conversion
}

/**
 * Lowest "from" price across the tour base price and all non-cancelled
 * departures, normalised to USD. approx flags that the winning value was
 * converted from TWD (caller renders a "≈"). Returns null when nothing is
 * convertible.
 */
export function deriveStartingUsd(
  tour: Pick<TourLike, "price" | "priceCurrency">,
  departures?: DepartureLike[] | null,
): StartingPriceResult | null {
  const candidates: { usd: number; approx: boolean }[] = [];
  const fromTour = toUsd(tour?.price ?? null, tour?.priceCurrency ?? null);
  if (fromTour) candidates.push(fromTour);
  for (const d of departures ?? []) {
    if ((d.status ?? "").toLowerCase() === "cancelled") continue;
    const u = toUsd(d.adultPrice ?? null, d.currency ?? null);
    if (u) candidates.push(u);
  }
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const c of candidates) if (c.usd < best.usd) best = c;
  return { usd: Math.round(best.usd), approx: best.approx };
}

// ─── Group size ────────────────────────────────────────────────────────────

/**
 * Small-group cap: tour.maxParticipants wins, else the next departure's
 * totalSlots, else null (omit chip).
 */
export function deriveGroupSize(
  tour: Pick<TourLike, "maxParticipants">,
  nextDeparture?: DepartureLike | null,
): number | null {
  const mp = tour?.maxParticipants;
  if (typeof mp === "number" && mp > 0) return mp;
  const ts = nextDeparture?.totalSlots;
  if (typeof ts === "number" && ts > 0) return ts;
  return null;
}

// ─── Availability bucket ─────────────────────────────────────────────────────
// Red line #2: the customer only ever sees 有位 / 名額有限 / 已滿 — never an exact
// seat count. The threshold below picks the bucket; the NUMBER never leaves this
// module. When we wire live supplier availability (catalog rebuild chunk 2) it
// feeds the same DepartureLike shape, so this bucket stays the single seam.

export type AvailabilityBucket = "available" | "limited" | "soldout" | "unknown";

// Remaining seats at or below this read as 名額有限. Internal only — never shown.
const LIMITED_SEATS_THRESHOLD = 4;

/** Bucket a single departure. Returns a bucket string only, never a count.
 * Only needs the availability fields (not departureDate), so callers can pass
 * a synthetic {status,totalSlots,bookedSlots} (e.g. TourDeparturesTable). */
export function deriveAvailabilityBucket(
  departure:
    | Pick<DepartureLike, "status" | "totalSlots" | "bookedSlots">
    | null
    | undefined,
): AvailabilityBucket {
  if (!departure) return "unknown";
  const status = (departure.status ?? "").toLowerCase();
  if (status === "cancelled") return "unknown";
  if (status === "full") return "soldout";
  if (status === "waitlist") return "limited";
  const total = departure.totalSlots;
  const booked = departure.bookedSlots;
  if (
    typeof total === "number" && total > 0 &&
    typeof booked === "number" && booked >= 0
  ) {
    const remaining = total - booked;
    if (remaining <= 0) return "soldout";
    if (remaining <= LIMITED_SEATS_THRESHOLD) return "limited";
    return "available";
  }
  // No slot data: an open / confirmed status still means bookable.
  if (status === "open" || status === "confirmed") return "available";
  return "unknown";
}

export interface AvailabilitySummary {
  next: DepartureLike | null;
  isConfirmed: boolean;
  bucket: AvailabilityBucket;
}

/**
 * One call for the card + rail: the soonest upcoming departure and its
 * availability bucket, kept consistent (the headlined date is the one we bucket).
 */
export function deriveAvailability(
  departures: DepartureLike[] | null | undefined,
  now: Date = new Date(),
): AvailabilitySummary {
  const nd = deriveNextDeparture(departures, now);
  if (!nd) return { next: null, isConfirmed: false, bucket: "unknown" };
  return {
    next: nd.departure,
    isConfirmed: nd.isConfirmed,
    bucket: deriveAvailabilityBucket(nd.departure),
  };
}

// ─── Inquiry payload ───────────────────────────────────────────────────────

export interface InquiryFormFields {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  note?: string;
}

/** Localised label strings injected by the component (keeps this module pure). */
export interface InquirySummaryLabels {
  subjectQuote: string; // e.g. "[報價]"
  subjectCustom: string; // e.g. "[客製]"
  intro: string; // e.g. "行程詢問"
  peopleLabel: string;
  timeLabel: string;
  budgetLabel: string;
  people: Record<WizardPeople, string>;
  timeframe: Record<WizardTimeframe, string>;
  budget: Record<WizardBudget, string>;
  fromTourPage: string; // e.g. "(由行程頁小精靈帶入)"
}

/** Shape sent to trpc.inquiries.create (Stage 3 wires the actual mutation). */
export interface InquiryCreateInput {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  subject: string;
  message: string;
  inquiryType: "general" | "custom_tour";
  relatedTourId: number;
  wizardAnswers?: WizardAnswers;
}

/**
 * Map wizard answers + form fields into the inquiry create payload.
 * - Structured: relatedTourId + wizardAnswers (JSON) for the command center.
 * - Readable: a plain-text summary folded into `message` so InquiryAgent and
 *   Jeff see the choices without joining tables.
 * The summary uses colons / parentheses only — never an em dash (house rule).
 */
export function buildInquiryInput(
  tour: Pick<TourLike, "id" | "title">,
  wizard: WizardAnswers | null | undefined,
  mode: InquiryMode,
  form: InquiryFormFields,
  labels: InquirySummaryLabels,
): InquiryCreateInput {
  const w = wizard ?? {};
  const title = (tour.title ?? "").trim();
  const prefix = mode === "custom" ? labels.subjectCustom : labels.subjectQuote;
  const subject = `${prefix} ${title}`.trim().slice(0, 200);

  const lines: string[] = [`${labels.intro}: ${title} (Tour #${tour.id})`, ""];
  if (w.people) lines.push(`${labels.peopleLabel}: ${labels.people[w.people]}`);
  if (w.timeframe) lines.push(`${labels.timeLabel}: ${labels.timeframe[w.timeframe]}`);
  if (w.budget) lines.push(`${labels.budgetLabel}: ${labels.budget[w.budget]}`);
  const note = (form.note ?? "").trim();
  if (note) lines.push("", note);
  lines.push("", labels.fromTourPage);
  const message = lines.join("\n").slice(0, 5000);

  const wizardAnswers: WizardAnswers = {};
  if (w.people) wizardAnswers.people = w.people;
  if (w.timeframe) wizardAnswers.timeframe = w.timeframe;
  if (w.budget) wizardAnswers.budget = w.budget;

  const out: InquiryCreateInput = {
    customerName: form.customerName.trim(),
    customerEmail: form.customerEmail.trim(),
    subject,
    message,
    inquiryType: mode === "custom" ? "custom_tour" : "general",
    relatedTourId: tour.id,
  };
  const phone = (form.customerPhone ?? "").trim();
  if (phone) out.customerPhone = phone;
  if (Object.keys(wizardAnswers).length > 0) out.wizardAnswers = wizardAnswers;
  return out;
}
