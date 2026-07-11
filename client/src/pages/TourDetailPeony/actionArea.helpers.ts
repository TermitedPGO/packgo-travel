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

// "reserve" = 提交訂位需求 (booking request). Added 2026-07-10 with the tour
// instant-checkout 臨時停止線: the detail page's buy button now submits a
// booking request through the inquiry flow instead of hitting instant checkout.
// Routed as a "general" inquiry (a booking intent, not a custom-tour brief).
export type InquiryMode = "quote" | "custom" | "reserve";

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
  // Only trust CLEAN itemized entries. A flight keyword buried in a prose
  // "wall" is ambiguous (walls usually read "airfare NOT included"), so a wall
  // must never flip the chip to 含機票. Walls are dropped from the signal — when
  // the supplier only gives walls, flight inference stays unknown → no chip.
  const itemized = (v: unknown) => asStringArray(v).filter((s) => !isCostWall(s));
  if (itemized(ce.excluded).some((s) => FLIGHT_RE.test(s))) return "excluded";
  // 否定詞守門(2026-07-11 驗收回令 P2):供應商把「機票自理」塞進 included
  // 陣列時,舊碼讀成含機票 — 正好把排除句翻成最貴的過度承諾。帶否定詞的機票
  // 條目不論躺在哪個陣列,一律是排除訊號。
  const includedFlight = itemized(ce.included).filter((s) => FLIGHT_RE.test(s));
  if (includedFlight.some((s) => hasCostNegation(s))) return "excluded";
  if (includedFlight.length > 0) return "included";
  return "unknown";
}

// ─── Cost-item "wall" detection (fail-honest checkmarks) ─────────────────────
// The supplier's cost inclusions sometimes arrive as one giant prose block that
// itself lists BOTH inclusions and exclusions (airfare/visa/lunch not included).
// Rendering a ✓ next to such a "wall" falsely tells the customer everything in
// it is included. isCostWall flags these so the UI shows them as plain
// "供應商費用說明原文" text (no checkmark); only clean short line items get ✓.

/** True when a cost string is a prose wall rather than a clean line item. */
export function isCostWall(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (!t) return false;
  if (/[\r\n]/.test(t)) return true; // multi-line prose
  if (t.length > 60) return true; // long single line reads as a paragraph
  // Several clause breaks in one entry = packed prose, not a single item.
  const clauseBreaks = (t.match(/[。;；]|\.\s|,\s.*,\s/g) || []).length;
  return clauseBreaks >= 2;
}

/**
 * 費用否定詞表(2026-07-11 驗收回令 P2)。isCostWall 只擋長牆;供應商常把短的
 * 排除句直接塞進 included 陣列(「機票自理」「午餐自費」),長度守門攔不住,
 * 打了 ✓ 就是反著騙客人。條目含任一否定詞 → 絕不渲染 ✓。
 * 純字串表,補新詞直接加一行;比對時 lowercase substring。
 */
const COST_NEGATION_TERMS: readonly string[] = [
  "不含",
  "不包括",
  "不包含",
  "未含",
  "未包含",
  "除外",
  "自理",
  "自費",
  "另付",
  "另計",
  "另行",
  "恕不",
  "not included",
  "not covered",
  "excluded",
  "excludes",
  "exclusion",
  "at your own",
  "own expense",
  "optional",
];

/** True when a cost entry carries an exclusion/negation phrase. */
export function hasCostNegation(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const t = text.toLowerCase();
  return COST_NEGATION_TERMS.some((term) => t.includes(term));
}

/**
 * Split a cost list into clean line items (get a ✓/✗) and prose walls (shown as
 * raw supplier text, no mark). Preserves order within each bucket.
 *
 * `demoteNegations`(included 列表用):含否定詞的條目降去 walls(無勾號原文
 * 區),即使它又短又乾淨。選「無勾號」而不是改渲染 ✗:這類條目常是混合句
 * (「含早餐,午晚餐自理」),整行打 ✗ 會反過來否認真的有含的部分;原文區照抄
 * 供應商的話、我們不下判斷,才是誠實的那個。excluded 列表不用降 — 否定詞條目
 * 掛 ✗ 語義一致。
 */
export function splitCostEntries(
  list: unknown,
  opts?: { demoteNegations?: boolean },
): { items: string[]; walls: string[] } {
  const items: string[] = [];
  const walls: string[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== "string") continue;
    const s = raw.trim();
    if (!s) continue;
    const wall = isCostWall(s) || (opts?.demoteNegations === true && hasCostNegation(s));
    (wall ? walls : items).push(s);
  }
  return { items, walls };
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
 * Small-group cap — read from the ONE structured field (tour.maxParticipants).
 *
 * Data-truth red line (Wave 1): the old code fell back to the next departure's
 * `totalSlots` when maxParticipants was absent. But totalSlots is the supplier's
 * per-departure seat inventory (e.g. 50), NOT the small-group cap — a
 * catalog-rebuild tour whose title reads「6 人小團」would render「小團 50 人」off
 * that fallback. We now return null (caller omits the chip) rather than show a
 * guessed number. No structured group size → no chip.
 */
export function deriveGroupSize(
  tour: Pick<TourLike, "maxParticipants">,
): number | null {
  const mp = tour?.maxParticipants;
  if (typeof mp === "number" && mp > 0) return mp;
  return null;
}

// ─── Itinerary cities (single source of truth for the "places" count) ────────
// The detail page showed three disagreeing numbers: a hero「途經城市 1 座」(off
// the free-form destinationCity string — a lone country name reads as 1), a
// route-map「N 個地點」(geocoded markers), and titles implying ~10 cities. This
// helper is the ONE source all place-count displays derive from, computed from
// the itinerary itself and deduped, so the hero chip, overview card, and route
// subtitle always agree. No itinerary → empty (caller hides the chip).

export interface ItineraryDayLike {
  day?: number | string | null;
  title?: string | null;
  location?: string | null;
  city?: string | null;
}

// Placeholder day/place names the AI/templates leave when a real place can't be
// extracted. Excluded from the count so "Day 3" / "景點 2" never inflate it.
const STOP_PLACEHOLDER_RE =
  /^(?:day\s*\d+|第\s*\d+\s*[日天]|景點\s*\d+|景点\s*\d+|attraction\s*\d+|place\s*\d+)$/i;

/** Strip a leading "Day N:" / "第N日" prefix from a day label. */
function stripDayPrefix(s: string): string {
  return s
    .replace(/^\s*(?:day\s*\d+|第\s*\d+\s*[日天])\s*[:：.\-–—]?\s*/i, "")
    .trim();
}

/**
 * Strip a trailing tour-type suffix (「一日遊」「1日遊」「半日遊」「五天遊」/
 * "1-Day Tour" / "Half-day Trip") from a stop label. Real-data check
 * (2026-07-11, prod tours 7/9): descriptive single-day titles like
 * 「西峽谷一日遊」otherwise flow verbatim into the overview destination card —
 * a tour NAME shown as a place. The suffix is descriptive noise; what remains
 * (西峽谷 / 尼亞加拉瀑布) is the actual place. A label that is ONLY the suffix
 * strips to "" and is dropped by the caller's filter (no guessed place).
 */
function stripTourTypeSuffix(s: string): string {
  return s
    .replace(/\s*(?:[0-9]+|[一二兩三四五六七八九十]+|半)\s*[日天]遊$/, "")
    // 「N天M夜(遊)」收尾:東京5天4夜 → 東京(2026-07-11 驗收回令 P3 補)
    .replace(/\s*(?:[0-9]+|[一二兩三四五六七八九十]+)\s*[天日]\s*(?:[0-9]+|[一二兩三四五六七八九十]+)\s*[夜晚]遊?$/, "")
    .replace(/\s*(?:[0-9]+[\s-]*day|half[\s-]*day|full[\s-]*day)\s*(?:tour|trip)$/i, "")
    // 無 tour/trip 收尾的 Half Day 變體:Grand Canyon Half Day → Grand Canyon
    // (同回令補)。只認 half day — 裸的 "5 Day" 結尾可能是團名一部分,寧留整串。
    .replace(/\s*half[\s-]*day$/i, "")
    .trim();
}

/**
 * Distinct places visited across the itinerary, in first-seen order.
 * Mirrors the server route-map field priority (location → city → title) and
 * splits route chains ("A - B - C", "A → B", "A、B") into individual stops,
 * then dedupes case-insensitively. Placeholders and blanks are dropped.
 */
export function deriveItineraryCities(
  itinerary: ItineraryDayLike[] | null | undefined,
): string[] {
  if (!Array.isArray(itinerary) || itinerary.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of itinerary) {
    const raw =
      (typeof d?.location === "string" && d.location.trim()) ||
      (typeof d?.city === "string" && d.city.trim()) ||
      (typeof d?.title === "string" && d.title.trim()) ||
      "";
    if (!raw) continue;
    // Suffix-strip BEFORE splitting too: the chain split treats "-" as a route
    // separator, so an un-stripped "Niagara Falls 1-Day Tour" would be cut into
    // ["Niagara Falls 1", "Day Tour"]. Then strip per part for chains whose
    // last stop carries its own suffix.
    const parts = stripTourTypeSuffix(stripDayPrefix(raw))
      .split(/\s*[-－—–→›»、,／/]\s*/)
      .map((x) => stripTourTypeSuffix(x.trim()))
      .filter(Boolean);
    for (const p of parts) {
      if (STOP_PLACEHOLDER_RE.test(p)) continue;
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/** Count of distinct itinerary places. 0 → caller hides the chip (no guess). */
export function deriveItineraryCityCount(
  itinerary: ItineraryDayLike[] | null | undefined,
): number {
  return deriveItineraryCities(itinerary).length;
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
  subjectReserve: string; // e.g. "[訂位]"
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
  const prefix =
    mode === "custom"
      ? labels.subjectCustom
      : mode === "reserve"
        ? labels.subjectReserve
        : labels.subjectQuote;
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
