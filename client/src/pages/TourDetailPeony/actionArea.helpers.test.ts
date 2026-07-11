/**
 * Unit tests for actionArea.helpers (feature: tour-page-redesign, Stage 1 + 2).
 * Pure functions only — no React / DOM needed.
 */
import { describe, it, expect } from "vitest";
import {
  deriveNextDeparture,
  deriveFlightInclusion,
  deriveStartingUsd,
  deriveGroupSize,
  deriveAvailabilityBucket,
  deriveAvailability,
  deriveItineraryCities,
  buildInquiryInput,
  type DepartureLike,
  type InquirySummaryLabels,
} from "./actionArea.helpers";

const NOW = new Date("2026-06-07T00:00:00Z");

function dep(over: Partial<DepartureLike>): DepartureLike {
  return {
    id: 1,
    departureDate: "2026-09-01T00:00:00Z",
    adultPrice: 64000,
    status: "open",
    totalSlots: 16,
    currency: "TWD",
    ...over,
  };
}

describe("deriveNextDeparture", () => {
  it("returns null for empty / nullish input", () => {
    expect(deriveNextDeparture([], NOW)).toBeNull();
    expect(deriveNextDeparture(null, NOW)).toBeNull();
    expect(deriveNextDeparture(undefined, NOW)).toBeNull();
  });

  it("ignores past departures", () => {
    const past = dep({ departureDate: "2026-01-01T00:00:00Z" });
    expect(deriveNextDeparture([past], NOW)).toBeNull();
  });

  it("ignores cancelled departures even if future", () => {
    const cancelled = dep({ departureDate: "2026-08-01T00:00:00Z", status: "cancelled" });
    expect(deriveNextDeparture([cancelled], NOW)).toBeNull();
  });

  it("picks the earliest future departure", () => {
    const a = dep({ id: 10, departureDate: "2026-10-01T00:00:00Z" });
    const b = dep({ id: 11, departureDate: "2026-07-15T00:00:00Z" });
    const c = dep({ id: 12, departureDate: "2026-12-01T00:00:00Z" });
    const res = deriveNextDeparture([a, b, c], NOW);
    expect(res?.departure.id).toBe(11);
  });

  it("flags confirmed status", () => {
    const confirmed = dep({ departureDate: "2026-07-01T00:00:00Z", status: "confirmed" });
    const res = deriveNextDeparture([confirmed], NOW);
    expect(res?.isConfirmed).toBe(true);
  });

  it("does not flag a non-confirmed pick as confirmed", () => {
    const res = deriveNextDeparture([dep({ departureDate: "2026-07-01T00:00:00Z", status: "open" })], NOW);
    expect(res?.isConfirmed).toBe(false);
  });
});

describe("deriveFlightInclusion", () => {
  it("reads included airfare (object form)", () => {
    expect(deriveFlightInclusion({ costExplanation: { included: ["國際機票", "酒店"] } })).toBe("included");
  });

  it("reads excluded airfare", () => {
    expect(deriveFlightInclusion({ costExplanation: { excluded: ["機票", "小費"] } })).toBe("excluded");
  });

  it("parses a JSON string", () => {
    expect(
      deriveFlightInclusion({ costExplanation: JSON.stringify({ included: ["round-trip flights"] }) }),
    ).toBe("included");
  });

  it("matches English airfare / flights wording", () => {
    expect(deriveFlightInclusion({ costExplanation: { excluded: ["Air fare"] } })).toBe("excluded");
    expect(deriveFlightInclusion({ costExplanation: { included: ["Flight"] } })).toBe("included");
  });

  it("does NOT false-positive on 機場接送 (airport transfer)", () => {
    expect(deriveFlightInclusion({ costExplanation: { included: ["機場接送"] } })).toBe("unknown");
  });

  it("under-promises when supplier data tags flights in BOTH arrays (contradiction)", () => {
    // The 1290075 case: dirty source listed 機票 in both. Conservative => excluded.
    expect(
      deriveFlightInclusion({ costExplanation: { included: ["機票"], excluded: ["國際機票"] } }),
    ).toBe("excluded");
  });

  it("returns unknown for missing / garbage data", () => {
    expect(deriveFlightInclusion({ costExplanation: null })).toBe("unknown");
    expect(deriveFlightInclusion({ costExplanation: "not json" })).toBe("unknown");
    expect(deriveFlightInclusion({ costExplanation: { included: [], excluded: [] } })).toBe("unknown");
  });
});

describe("deriveStartingUsd", () => {
  it("shows USD price directly without approximation", () => {
    const res = deriveStartingUsd({ price: 1500, priceCurrency: "USD" }, []);
    expect(res).toEqual({ usd: 1500, approx: false });
  });

  it("converts a TWD base price and flags approx", () => {
    const res = deriveStartingUsd({ price: 64000, priceCurrency: "TWD" }, []);
    expect(res).toEqual({ usd: 2000, approx: true });
  });

  it("takes the lowest across departures", () => {
    const res = deriveStartingUsd(
      { price: 96000, priceCurrency: "TWD" },
      [dep({ adultPrice: 64000 }), dep({ adultPrice: 80000 })],
    );
    expect(res).toEqual({ usd: 2000, approx: true });
  });

  it("skips cancelled departures", () => {
    const res = deriveStartingUsd({ price: null, priceCurrency: "TWD" }, [
      dep({ adultPrice: 32000, status: "cancelled" }),
      dep({ adultPrice: 64000, status: "open" }),
    ]);
    expect(res).toEqual({ usd: 2000, approx: true });
  });

  it("ignores unknown currencies and unparseable prices", () => {
    expect(deriveStartingUsd({ price: 100, priceCurrency: "EUR" }, [])).toBeNull();
    expect(deriveStartingUsd({ price: 0, priceCurrency: "TWD" }, [])).toBeNull();
    expect(deriveStartingUsd({ price: null, priceCurrency: "TWD" }, [])).toBeNull();
  });

  it("prefers an exact USD departure over a converted TWD base", () => {
    const res = deriveStartingUsd(
      { price: 64000, priceCurrency: "TWD" }, // ≈ 2000 USD (approx)
      [dep({ adultPrice: 1800, currency: "USD" })], // exact 1800 USD
    );
    expect(res).toEqual({ usd: 1800, approx: false });
  });
});

describe("deriveAvailabilityBucket", () => {
  it("returns unknown for nullish / cancelled", () => {
    expect(deriveAvailabilityBucket(null)).toBe("unknown");
    expect(deriveAvailabilityBucket(undefined)).toBe("unknown");
    expect(deriveAvailabilityBucket(dep({ status: "cancelled" }))).toBe("unknown");
  });

  it("maps full -> soldout and waitlist -> limited by status alone", () => {
    expect(deriveAvailabilityBucket(dep({ status: "full" }))).toBe("soldout");
    expect(deriveAvailabilityBucket(dep({ status: "waitlist" }))).toBe("limited");
  });

  it("refines open departures by remaining slots", () => {
    expect(deriveAvailabilityBucket(dep({ status: "open", totalSlots: 20, bookedSlots: 2 }))).toBe("available");
    expect(deriveAvailabilityBucket(dep({ status: "open", totalSlots: 20, bookedSlots: 17 }))).toBe("limited");
    expect(deriveAvailabilityBucket(dep({ status: "open", totalSlots: 20, bookedSlots: 20 }))).toBe("soldout");
  });

  it("treats an open departure with no slot data as available", () => {
    expect(deriveAvailabilityBucket(dep({ status: "open", totalSlots: null, bookedSlots: null }))).toBe("available");
  });

  it("never leaks a number (always one of the four buckets)", () => {
    const buckets = new Set(["available", "limited", "soldout", "unknown"]);
    for (const booked of [0, 1, 5, 16, 19, 20, 99]) {
      expect(buckets.has(deriveAvailabilityBucket(dep({ totalSlots: 20, bookedSlots: booked })))).toBe(true);
    }
  });
});

describe("deriveAvailability", () => {
  it("returns unknown bucket with null next when nothing upcoming", () => {
    expect(deriveAvailability([], NOW)).toEqual({ next: null, isConfirmed: false, bucket: "unknown" });
  });

  it("buckets the soonest upcoming departure (consistent date + availability)", () => {
    const soon = dep({ id: 1, departureDate: "2026-07-15T00:00:00Z", status: "open", totalSlots: 20, bookedSlots: 18 });
    const later = dep({ id: 2, departureDate: "2026-09-01T00:00:00Z", status: "open", totalSlots: 20, bookedSlots: 0 });
    const res = deriveAvailability([later, soon], NOW);
    expect(res.next?.id).toBe(1);
    expect(res.bucket).toBe("limited");
  });
});

describe("deriveGroupSize", () => {
  it("uses maxParticipants when present", () => {
    expect(deriveGroupSize({ maxParticipants: 16 })).toBe(16);
  });

  // Wave 1 data-truth fix: totalSlots is per-departure seat INVENTORY (e.g. 50),
  // not the small-group cap — the old fallback rendered「小團 50 人」. No
  // structured maxParticipants → null (caller omits the chip, no guessing).
  it("does NOT fall back to departure totalSlots (inventory ≠ group cap)", () => {
    expect(deriveGroupSize({ maxParticipants: null })).toBeNull();
  });

  it("returns null when maxParticipants is missing or non-positive", () => {
    expect(deriveGroupSize({ maxParticipants: 0 })).toBeNull();
    expect(deriveGroupSize({ maxParticipants: null })).toBeNull();
  });
});

describe("deriveItineraryCities", () => {
  // Anchored on prod tour id 2 (2026-07-11 real-data hand-check): route-chain
  // day titles split on "-" and dedupe across days, first-seen order.
  it("splits route-chain titles and dedupes across days (prod tour 2)", () => {
    const itin = [
      { day: 1, title: "馬德里 - 阿維拉 - 薩拉曼卡" },
      { day: 2, title: "薩拉曼卡 - 巴利亞多利德 - 佈爾戈斯" },
      { day: 3, title: "佈爾戈斯 - 畢爾巴鄂 - 佈爾戈斯" },
      { day: 4, title: "佈爾戈斯 - 塞戈維亞 - 昆卡" },
      { day: 5, title: "昆卡 - 孔蘇埃格拉 - 托萊多 - 馬德里" },
    ];
    expect(deriveItineraryCities(itin)).toEqual([
      "馬德里", "阿維拉", "薩拉曼卡", "巴利亞多利德", "佈爾戈斯",
      "畢爾巴鄂", "塞戈維亞", "昆卡", "孔蘇埃格拉", "托萊多",
    ]);
  });

  // Prod tours 7 / 9: descriptive one-day titles. The tour-type suffix is
  // stripped so the overview destination card shows the PLACE, never a tour
  // name like「西峽谷一日遊」.
  it("strips tour-type suffixes from descriptive day titles (prod tours 7/9)", () => {
    expect(deriveItineraryCities([{ day: 1, title: "西峽谷一日遊" }])).toEqual(["西峽谷"]);
    expect(deriveItineraryCities([{ day: 1, title: "尼亞加拉瀑布 1日遊" }])).toEqual(["尼亞加拉瀑布"]);
    expect(deriveItineraryCities([{ day: 1, title: "Niagara Falls 1-Day Tour" }])).toEqual(["Niagara Falls"]);
  });

  it("prefers location/city fields over the title", () => {
    expect(
      deriveItineraryCities([{ day: 1, title: "西峽谷一日遊", location: "拉斯維加斯" }]),
    ).toEqual(["拉斯維加斯"]);
  });

  it("drops placeholders and suffix-only labels; empty itinerary → []", () => {
    expect(deriveItineraryCities([{ day: 1, title: "Day 1" }, { day: 2, title: "景點 2" }])).toEqual([]);
    expect(deriveItineraryCities([{ day: 1, title: "一日遊" }])).toEqual([]);
    expect(deriveItineraryCities([])).toEqual([]);
    expect(deriveItineraryCities(null)).toEqual([]);
  });
});

describe("buildInquiryInput", () => {
  const labels: InquirySummaryLabels = {
    subjectQuote: "[報價]",
    subjectCustom: "[客製]",
    subjectReserve: "[訂位]",
    intro: "行程詢問",
    peopleLabel: "人數",
    timeLabel: "出發時間",
    budgetLabel: "預算等級",
    people: { "1-2": "1-2 人", "3-5": "3-5 人", "6+": "6 人以上" },
    timeframe: { soon: "近期", school_break: "寒暑假", discuss: "再討論" },
    budget: { economy: "經濟", comfort: "舒適", luxury: "奢華" },
    fromTourPage: "(由行程頁小精靈帶入)",
  };
  const tour = { id: 1234, title: "北海道親子賞雪 5 日" };
  const form = { customerName: " 王小明 ", customerEmail: " a@b.com " };

  it("maps quote mode to general inquiryType + subject prefix", () => {
    const out = buildInquiryInput(tour, { people: "3-5" }, "quote", form, labels);
    expect(out.inquiryType).toBe("general");
    expect(out.subject).toBe("[報價] 北海道親子賞雪 5 日");
  });

  it("maps custom mode to custom_tour inquiryType + subject prefix", () => {
    const out = buildInquiryInput(tour, {}, "custom", form, labels);
    expect(out.inquiryType).toBe("custom_tour");
    expect(out.subject).toBe("[客製] 北海道親子賞雪 5 日");
  });

  // 臨時停止線 (2026-07-10): 「提交訂位需求」按鈕走 reserve mode。訂位意圖歸
  // general inquiry(不是 custom_tour),subject 帶 [訂位] 前綴讓 Jeff 分辨
  // 「想訂」與「想問價」。
  it("maps reserve mode to general inquiryType + [訂位] subject prefix", () => {
    const out = buildInquiryInput(tour, { people: "1-2" }, "reserve", form, labels);
    expect(out.inquiryType).toBe("general");
    expect(out.subject).toBe("[訂位] 北海道親子賞雪 5 日");
    expect(out.relatedTourId).toBe(1234);
  });

  it("carries relatedTourId and trims contact fields", () => {
    const out = buildInquiryInput(tour, {}, "quote", form, labels);
    expect(out.relatedTourId).toBe(1234);
    expect(out.customerName).toBe("王小明");
    expect(out.customerEmail).toBe("a@b.com");
  });

  it("includes only the wizard keys that were answered", () => {
    const out = buildInquiryInput(tour, { people: "6+", budget: "luxury" }, "quote", form, labels);
    expect(out.wizardAnswers).toEqual({ people: "6+", budget: "luxury" });
    expect(out.message).toContain("人數: 6 人以上");
    expect(out.message).toContain("預算等級: 奢華");
    expect(out.message).not.toContain("出發時間");
  });

  it("omits wizardAnswers entirely when nothing was chosen", () => {
    const out = buildInquiryInput(tour, {}, "quote", form, labels);
    expect(out.wizardAnswers).toBeUndefined();
  });

  it("omits phone when blank, keeps it when provided", () => {
    expect(buildInquiryInput(tour, {}, "quote", { ...form, customerPhone: "  " }, labels).customerPhone).toBeUndefined();
    expect(
      buildInquiryInput(tour, {}, "quote", { ...form, customerPhone: "510-555-0101" }, labels).customerPhone,
    ).toBe("510-555-0101");
  });

  it("appends the customer note when present", () => {
    const out = buildInquiryInput(tour, {}, "quote", { ...form, note: "想含一晚溫泉" }, labels);
    expect(out.message).toContain("想含一晚溫泉");
  });

  it("never emits an em dash in the composed message (house rule)", () => {
    const out = buildInquiryInput(tour, { people: "1-2", timeframe: "soon", budget: "economy" }, "quote", form, labels);
    expect(out.message).not.toContain("—"); // em dash
    expect(out.message).not.toContain("--");
  });

  it("caps subject and message length to the create() limits", () => {
    const longTitle = "和".repeat(500);
    const out = buildInquiryInput({ id: 9, title: longTitle }, {}, "quote", form, labels);
    expect(out.subject.length).toBeLessThanOrEqual(200);
    expect(out.message.length).toBeLessThanOrEqual(5000);
  });
});
