/**
 * workspaceTours.helpers — pure logic for the 批7 行程庫 (tour library).
 *
 * Different pill semantics from admin ToursTabFilters: 未上架 groups every
 * non-customer-visible status EXCEPT pending_review, which gets its own
 * pill (calibration-review absorbed here, 批7 m4).
 */

export type WsTourStatus =
  | "active"
  | "inactive"
  | "soldout"
  | "draft"
  | "pending_review";

export type WsTourFilter = "all" | "active" | "unlisted" | "pending_review";

export type WsTourSort = "default" | "price-asc" | "price-desc" | "newest";

export type WsTourLike = {
  id: number;
  title: string;
  status: WsTourStatus;
  price: number;
  duration: number;
  destination?: string | null;
  destinationCountry?: string | null;
  destinationCity?: string | null;
  createdAt?: string | Date | null;
};

export function matchesFilter(t: WsTourLike, f: WsTourFilter): boolean {
  if (f === "all") return true;
  if (f === "active") return t.status === "active";
  if (f === "pending_review") return t.status === "pending_review";
  // unlisted: anything a customer can't see, except the review queue
  return t.status !== "active" && t.status !== "pending_review";
}

export function matchesSearch(t: WsTourLike, q: string): boolean {
  const k = q.trim().toLowerCase();
  if (!k) return true;
  return (
    t.title.toLowerCase().includes(k) ||
    (t.destination?.toLowerCase().includes(k) ?? false) ||
    (t.destinationCountry?.toLowerCase().includes(k) ?? false) ||
    (t.destinationCity?.toLowerCase().includes(k) ?? false)
  );
}

/**
 * Filter + sort. pending_review rows pin to the top under the default sort
 * (they need Jeff's decision), then newest-first; explicit sorts override
 * the pin — when Jeff asks for price order he gets price order.
 */
export function filterSortTours<T extends WsTourLike>(
  tours: T[],
  filter: WsTourFilter,
  search: string,
  sort: WsTourSort,
): T[] {
  const out = tours.filter(
    (t) => matchesFilter(t, filter) && matchesSearch(t, search),
  );
  const created = (t: WsTourLike) =>
    t.createdAt ? new Date(t.createdAt).getTime() : 0;
  return out.sort((a, b) => {
    if (sort === "price-asc") return a.price - b.price;
    if (sort === "price-desc") return b.price - a.price;
    if (sort === "newest") return created(b) - created(a);
    // default: review queue first, then newest
    const ap = a.status === "pending_review" ? 0 : 1;
    const bp = b.status === "pending_review" ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return created(b) - created(a);
  });
}

export function filterCounts(tours: WsTourLike[]): Record<WsTourFilter, number> {
  return {
    all: tours.length,
    active: tours.filter((t) => t.status === "active").length,
    unlisted: tours.filter(
      (t) => t.status !== "active" && t.status !== "pending_review",
    ).length,
    pending_review: tours.filter((t) => t.status === "pending_review").length,
  };
}

/** 1-based page slice; page clamped into range so a stale page never 404s. */
export function pageSlice<T>(
  items: T[],
  page: number,
  perPage: number,
): { rows: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const p = Math.min(Math.max(1, page), totalPages);
  return {
    rows: items.slice((p - 1) * perPage, p * perPage),
    page: p,
    totalPages,
  };
}

/* ── m2: detail 純邏輯 ── */

export type ItineraryDay = {
  day: number;
  title: string;
  description: string;
  hotel: string;
  meals: string;
};

/**
 * Parse tours.itineraryDetailed JSON into render-safe day rows. Bad JSON,
 * non-array payloads, or junk entries degrade to [] / skipped rows — the
 * detail view shows an honest "no itinerary" instead of crashing.
 */
export function parseItinerary(raw: string | null | undefined): ItineraryDay[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: ItineraryDay[] = [];
  for (let i = 0; i < v.length; i++) {
    const d = v[i] as Record<string, unknown>;
    if (d == null || typeof d !== "object") continue;
    const meals = (d.meals ?? {}) as Record<string, unknown>;
    const mealStr = ["breakfast", "lunch", "dinner"]
      .map((k) => meals[k])
      .filter((m): m is string => typeof m === "string" && m.trim() !== "")
      .join(" · ");
    const acts = Array.isArray(d.activities)
      ? (d.activities as Array<Record<string, unknown>>)
          .map((a) => (typeof a?.title === "string" ? a.title : ""))
          .filter(Boolean)
          .join("、")
      : "";
    out.push({
      day: typeof d.day === "number" ? d.day : i + 1,
      title: typeof d.title === "string" ? d.title : "",
      description:
        typeof d.description === "string" && d.description
          ? d.description
          : acts,
      hotel: typeof d.accommodation === "string" ? d.accommodation : "",
      meals: mealStr,
    });
  }
  return out;
}

export type CostExplanation = {
  included: string[];
  excluded: string[];
};

/** Parse costExplanation JSON; bad shapes degrade to empty lists. */
export function parseCost(raw: string | null | undefined): CostExplanation {
  const empty: CostExplanation = { included: [], excluded: [] };
  if (!raw) return empty;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (v == null || typeof v !== "object" || Array.isArray(v)) return empty;
  const o = v as Record<string, unknown>;
  const strList = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
  return { included: strList(o.included), excluded: strList(o.excluded) };
}

export type DepartureLike = {
  departureDate: Date | string;
  status: string;
  totalSlots: number | null;
  bookedSlots: number | null;
};

/**
 * Future, non-cancelled departures with remaining seats — the 出發日/庫存
 * pills. Past departures hidden (mockup: 過去出發日已隱藏).
 */
export function upcomingDepartures<T extends DepartureLike>(
  departures: T[],
  now: number = Date.now(),
): (T & { seatsLeft: number | null })[] {
  return departures
    .filter((d) => {
      if (d.status === "cancelled") return false;
      const ts = new Date(d.departureDate).getTime();
      return Number.isFinite(ts) && ts >= now;
    })
    .sort(
      (a, b) =>
        new Date(a.departureDate).getTime() -
        new Date(b.departureDate).getTime(),
    )
    .map((d) => ({
      ...d,
      seatsLeft:
        d.totalSlots != null
          ? Math.max(0, d.totalSlots - (d.bookedSlots ?? 0))
          : null,
    }));
}
