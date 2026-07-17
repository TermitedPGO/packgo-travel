/**
 * Source contracts for the Trip.com clickout surface (Codex batch-4 §7.1 + P1-4).
 *
 * The repo has no React Testing Library, so the three caller components cannot be
 * render-tested; these narrow source-contract tests pin what a render test would
 * otherwise assert: every caller navigates via the shared same-origin clickout and
 * keeps the persistent leave-notice, and the admin/i18n surface never calls a
 * replayable redirect request a "click".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), "utf-8");

const CALLERS: Array<{ name: string; rel: string; source: string; notice: string }> = [
  { name: "FlightBooking", rel: "./FlightBooking.tsx", source: "flight_search", notice: "flightBooking.page.redirectNotice" },
  { name: "HotelBooking", rel: "./HotelBooking.tsx", source: "hotel_search", notice: "hotelBooking.page.redirectNotice" },
  { name: "PriceComparisonWidget", rel: "./TourDetailPeony/PriceComparisonWidget.tsx", source: "tour_flight", notice: "tourDetail.priceComparison.redirectNotice" },
];

describe("three real callers use the first-party clickout (source contract)", () => {
  it.each(CALLERS)("$name imports the shared clickout and passes its closed source", ({ rel, source }) => {
    const src = read(rel);
    expect(src).toContain('from "@/lib/tripClickout"');
    expect(src).toContain(`openTripClickout('${source}')`);
  });

  it.each(CALLERS)("$name keeps the persistent leave-notice next to the action", ({ rel, notice }) => {
    expect(read(rel)).toContain(notice);
  });

  it.each(CALLERS)("$name has no window.open and no hand-built Trip.com URL", ({ rel }) => {
    const src = read(rel);
    expect(src).not.toContain("window.open");
    expect(src).not.toContain("trip.com/");
    expect(src).not.toContain("Allianceid");
  });

  it("PriceComparisonWidget also wires the hotel source", () => {
    expect(read("./TourDetailPeony/PriceComparisonWidget.tsx")).toContain("openTripClickout('tour_hotel')");
  });
});

describe("admin redirect-request semantics (i18n guard, Codex P1-4)", () => {
  // Keys rendered by AffiliateTab.tsx. Internal key NAMES may keep the legacy
  // schema words; the VISIBLE VALUES must not present replayable redirect
  // requests as clicks or show "referrer page".
  const VISIBLE_KEYS = [
    "title", "subtitle",
    "statTotalClicks", "statFlightClicks", "statHotelClicks", "statHomepageClicks",
    "clickLogTitle", "allPlatforms", "emptyClicks",
    "colTime", "colPlatform", "colReferrer", "colTargetUrl",
    "platformFlights", "platformHomepage", "platformHotels",
    "badgeFlights", "badgeHomepage", "badgeHotels",
    "loading",
  ] as const;

  function affiliateTabSection(file: string): string {
    const src = read(path.join("../i18n", file));
    const start = src.indexOf("affiliateTab: {");
    expect(start).toBeGreaterThan(-1);
    // The section ends at the matching close of its own block — the next "    },"
    // at the same indentation level after the opening line.
    const end = src.indexOf("\n    },", start);
    return src.slice(start, end);
  }

  function valueOf(section: string, key: string): string {
    const m = section.match(new RegExp(`${key}: '([^']*)'`));
    expect(m, `key ${key} present`).not.toBeNull();
    return m![1];
  }

  it("zh-TW visible values never say 點擊 or 來源頁面", () => {
    const section = affiliateTabSection("zh-TW.ts");
    for (const key of VISIBLE_KEYS) {
      const value = valueOf(section, key);
      expect(value, `${key}='${value}'`).not.toContain("點擊");
      expect(value, `${key}='${value}'`).not.toContain("來源頁面");
    }
  });

  it("en visible values never say click or referrer", () => {
    const section = affiliateTabSection("en.ts");
    for (const key of VISIBLE_KEYS) {
      const value = valueOf(section, key);
      expect(value.toLowerCase(), `${key}='${value}'`).not.toContain("click");
      expect(value.toLowerCase(), `${key}='${value}'`).not.toContain("referrer");
    }
  });

  it("legacy flight/hotel categories are labeled historical, homepage says redirect", () => {
    const zh = affiliateTabSection("zh-TW.ts");
    expect(valueOf(zh, "statFlightClicks")).toContain("歷史");
    expect(valueOf(zh, "statHotelClicks")).toContain("歷史");
    expect(valueOf(zh, "statTotalClicks")).toContain("導流");
    expect(valueOf(zh, "clickLogTitle")).toContain("導流");
    const en = affiliateTabSection("en.ts");
    expect(valueOf(en, "statFlightClicks").toLowerCase()).toContain("historical");
    expect(valueOf(en, "statHotelClicks").toLowerCase()).toContain("historical");
    expect(valueOf(en, "statTotalClicks").toLowerCase()).toContain("redirect");
    expect(valueOf(en, "clickLogTitle").toLowerCase()).toContain("redirect");
  });
});
