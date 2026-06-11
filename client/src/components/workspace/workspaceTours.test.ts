/**
 * Tests for workspaceTours.helpers (批7 m1+m2) — real implementations.
 */
import { describe, it, expect } from "vitest";
import {
  filterSortTours,
  filterCounts,
  pageSlice,
  parseItinerary,
  parseCost,
  upcomingDepartures,
  type WsTourLike,
} from "./workspaceTours.helpers";

const tour = (over: Partial<WsTourLike> & { id: number }): WsTourLike => ({
  title: `Tour ${over.id}`,
  status: "active",
  price: 1000,
  duration: 5,
  createdAt: "2026-06-01T00:00:00Z",
  ...over,
});

describe("filterSortTours (m1)", () => {
  const tours = [
    tour({ id: 1, status: "active", price: 300, createdAt: "2026-06-01" }),
    tour({ id: 2, status: "draft", price: 100, createdAt: "2026-06-05" }),
    tour({ id: 3, status: "pending_review", price: 200, createdAt: "2026-06-02" }),
    tour({ id: 4, status: "soldout", price: 400, createdAt: "2026-06-03" }),
  ];

  it("default sort pins pending_review first, then newest", () => {
    const out = filterSortTours(tours, "all", "", "default");
    expect(out[0].id).toBe(3);
    expect(out.slice(1).map((t) => t.id)).toEqual([2, 4, 1]);
  });

  it("explicit price sort overrides the review pin", () => {
    const out = filterSortTours(tours, "all", "", "price-asc");
    expect(out.map((t) => t.id)).toEqual([2, 3, 1, 4]);
  });

  it("unlisted = non-active except pending_review", () => {
    const out = filterSortTours(tours, "unlisted", "", "default");
    expect(out.map((t) => t.id).sort()).toEqual([2, 4]);
  });

  it("pending_review filter isolates the review queue", () => {
    const out = filterSortTours(tours, "pending_review", "", "default");
    expect(out.map((t) => t.id)).toEqual([3]);
  });

  it("search matches title and destination fields", () => {
    const named = [
      tour({ id: 1, title: "黃石公園深度 5 日", destinationCountry: "美國" }),
      tour({ id: 2, title: "京阪神 5 日", destinationCountry: "日本" }),
    ];
    expect(filterSortTours(named, "all", "黃石", "default")).toHaveLength(1);
    expect(filterSortTours(named, "all", "日本", "default")).toHaveLength(1);
    expect(filterSortTours(named, "all", "  ", "default")).toHaveLength(2);
  });
});

describe("filterCounts (m1)", () => {
  it("counts per pill", () => {
    const counts = filterCounts([
      tour({ id: 1, status: "active" }),
      tour({ id: 2, status: "draft" }),
      tour({ id: 3, status: "pending_review" }),
      tour({ id: 4, status: "inactive" }),
    ]);
    expect(counts).toEqual({
      all: 4,
      active: 1,
      unlisted: 2,
      pending_review: 1,
    });
  });
});

describe("pageSlice (m1)", () => {
  const items = Array.from({ length: 60 }, (_, i) => i);

  it("slices 1-based pages", () => {
    const p2 = pageSlice(items, 2, 25);
    expect(p2.rows[0]).toBe(25);
    expect(p2.totalPages).toBe(3);
  });

  it("clamps out-of-range page (stale page never empties the list)", () => {
    expect(pageSlice(items, 99, 25).page).toBe(3);
    expect(pageSlice(items, 0, 25).page).toBe(1);
    expect(pageSlice([], 5, 25).totalPages).toBe(1);
  });
});

describe("parseItinerary (m2)", () => {
  it("parses well-formed days with meals + accommodation", () => {
    const raw = JSON.stringify([
      {
        day: 1,
        title: "SFO → 鹽湖城",
        activities: [{ title: "搭機" }, { title: "轉黃石門戶" }],
        meals: { breakfast: "", lunch: "機上", dinner: "晚餐" },
        accommodation: "西黃石 3★",
      },
    ]);
    const [d] = parseItinerary(raw);
    expect(d.day).toBe(1);
    expect(d.title).toBe("SFO → 鹽湖城");
    expect(d.description).toBe("搭機、轉黃石門戶");
    expect(d.hotel).toBe("西黃石 3★");
    expect(d.meals).toBe("機上 · 晚餐");
  });

  it("bad JSON / non-array / junk entries degrade safely", () => {
    expect(parseItinerary("not json")).toEqual([]);
    expect(parseItinerary(JSON.stringify({ day: 1 }))).toEqual([]);
    expect(parseItinerary(null)).toEqual([]);
    const mixed = parseItinerary(JSON.stringify([null, { title: "ok" }]));
    expect(mixed).toHaveLength(1);
    expect(mixed[0].day).toBe(2); // index fallback
  });
});

describe("parseCost (m2)", () => {
  it("parses included/excluded string lists", () => {
    const out = parseCost(
      JSON.stringify({ included: ["機票", "住宿"], excluded: ["小費"] }),
    );
    expect(out.included).toEqual(["機票", "住宿"]);
    expect(out.excluded).toEqual(["小費"]);
  });

  it("drops non-string entries, bad shapes → empty", () => {
    expect(
      parseCost(JSON.stringify({ included: ["ok", 5, null] })).included,
    ).toEqual(["ok"]);
    expect(parseCost("junk")).toEqual({ included: [], excluded: [] });
    expect(parseCost(JSON.stringify([1, 2]))).toEqual({
      included: [],
      excluded: [],
    });
  });
});

describe("upcomingDepartures (m2)", () => {
  const NOW = new Date("2026-06-11T00:00:00Z").getTime();
  const dep = (date: string, over = {}) => ({
    departureDate: date,
    status: "open",
    totalSlots: 20,
    bookedSlots: 15,
    ...over,
  });

  it("hides past + cancelled, sorts ascending, computes seats", () => {
    const out = upcomingDepartures(
      [
        dep("2026-08-03"),
        dep("2026-05-01"), // past
        dep("2026-07-20"),
        dep("2026-09-01", { status: "cancelled" }),
      ],
      NOW,
    );
    expect(out.map((d) => d.departureDate)).toEqual([
      "2026-07-20",
      "2026-08-03",
    ]);
    expect(out[0].seatsLeft).toBe(5);
  });

  it("overbooked clamps to 0, null slots → null", () => {
    const [a] = upcomingDepartures(
      [dep("2026-07-20", { totalSlots: 10, bookedSlots: 12 })],
      NOW,
    );
    expect(a.seatsLeft).toBe(0);
    const [b] = upcomingDepartures(
      [dep("2026-07-20", { totalSlots: null })],
      NOW,
    );
    expect(b.seatsLeft).toBeNull();
  });
});
