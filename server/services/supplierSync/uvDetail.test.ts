/**
 * Tests for uvDetail parsers.
 */

import { describe, expect, it } from "vitest";
import {
  parseUvItinerary,
  parseUvNotices,
  parseUvOptional,
  parseUvPriceTerms,
} from "./uvDetail";

describe("parseUvItinerary", () => {
  it("returns null when productTravel missing and main is null", () => {
    expect(parseUvItinerary({} as any, null)).toBeNull();
  });

  it("parses day-list shape with attractions + hotels + meals", () => {
    const travel = {
      productTravel: [
        {
          dayNo: 1,
          dayTitle: "桃園 → 東京",
          attractions: [{ name: "成田機場接機" }],
          hotels: [{ name: "東京希爾頓", city: "Tokyo", rating: 5 }],
          meals: { breakfast: false, lunch: false, dinner: "機上餐" },
          transportation: "華航",
        },
      ],
    } as any;
    const main = { tripDay: 5 } as any;
    const result = parseUvItinerary(travel, main);
    expect(result).not.toBeNull();
    expect(result!.totalDays).toBe(5);
    expect(result!.days).toHaveLength(1);
    expect(result!.days[0].title).toBe("桃園 → 東京");
    expect(result!.days[0].hotels[0].type).toBe("5星");
    expect(result!.days[0].meals.dinner).toBe("機上餐");
    expect(result!.days[0].transportation).toBe("華航");
  });

  it("falls back to days.length when main.tripDay is 0", () => {
    const travel = {
      productTravel: [
        { dayNo: 1, dayTitle: "D1" },
        { dayNo: 2, dayTitle: "D2" },
      ],
    } as any;
    const result = parseUvItinerary(travel, null);
    expect(result!.totalDays).toBe(2);
  });

  it("handles dayList nested shape", () => {
    const travel = {
      productTravel: {
        dayList: [{ dayNo: 1, dayTitle: "Day One" }],
      },
    } as any;
    const result = parseUvItinerary(travel, { tripDay: 1 } as any);
    expect(result!.days).toHaveLength(1);
    expect(result!.days[0].title).toBe("Day One");
  });

  it("classifies hotel type from string", () => {
    const travel = {
      productTravel: [
        {
          dayNo: 1,
          hotels: [
            { name: "A", type: "4 star" },
            { name: "B", type: "民宿" },
            { name: "C" },
          ],
        },
      ],
    } as any;
    const result = parseUvItinerary(travel, { tripDay: 1 } as any);
    expect(result!.days[0].hotels[0].type).toBe("4星");
    expect(result!.days[0].hotels[1].type).toBe("民宿");
    expect(result!.days[0].hotels[2].type).toBe("未指定");
  });
});

describe("parseUvPriceTerms", () => {
  it("returns null when productCost missing", () => {
    expect(parseUvPriceTerms({} as any)).toBeNull();
  });

  it("returns null when all fields empty", () => {
    expect(
      parseUvPriceTerms({ productCost: { includedList: [], excludedList: [] } } as any)
    ).toBeNull();
  });

  it("parses includedList + excludedList from strings", () => {
    const result = parseUvPriceTerms({
      productCost: {
        includedList: ["機票", "住宿"],
        excludedList: ["小費"],
      },
    } as any);
    expect(result!.included).toEqual(["機票", "住宿"]);
    expect(result!.excluded).toEqual(["小費"]);
  });

  it("parses includedList from objects with name field", () => {
    const result = parseUvPriceTerms({
      productCost: {
        includedList: [{ name: "機票" }, { description: "住宿" }],
        excludedList: [],
      },
    } as any);
    expect(result!.included).toContain("機票");
    expect(result!.included).toContain("住宿");
  });

  it("sorts cancellationPolicy by days desc", () => {
    const result = parseUvPriceTerms({
      productCost: {
        includedList: ["x"],
        cancellationPolicy: [
          { daysBeforeDeparture: 7, refundPercent: 50 },
          { daysBeforeDeparture: 30, refundPercent: 90 },
          { daysBeforeDeparture: 14, refundPercent: 70 },
        ],
      },
    } as any);
    expect(result!.cancellationPolicy.map((p) => p.daysBeforeDeparture)).toEqual([30, 14, 7]);
  });
});

describe("parseUvNotices", () => {
  it("returns null when productNotice missing", () => {
    expect(parseUvNotices({} as any)).toBeNull();
  });

  it("buckets notes by title keyword", () => {
    const result = parseUvNotices({
      productNotice: [
        { title: "簽證須知", content: "免簽 90 天" },
        { title: "行李規定", content: "20 kg" },
        { title: "保險", content: "200 萬" },
        { title: "其他事項", content: "請守時" },
      ],
    } as any);
    expect(result!.visa).toContain("免簽");
    expect(result!.baggage).toContain("20 kg");
    expect(result!.insurance).toContain("200 萬");
    expect(result!.general).toContain("守時");
  });

  it("handles nested list shape", () => {
    const result = parseUvNotices({
      productNotice: { list: [{ title: "簽證", content: "需簽證" }] },
    } as any);
    expect(result!.visa).toContain("需簽證");
  });
});

describe("parseUvOptional", () => {
  it("returns empty items when no shop or optional list", () => {
    const result = parseUvOptional({} as any);
    expect(result).toEqual({ items: [] });
  });

  it("parses shopping stops as free items", () => {
    const result = parseUvOptional({
      productShop: [{ shopName: "免稅店", description: "1 小時" }],
    } as any);
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0].name).toBe("免稅店");
    expect(result!.items[0].price).toBe(0);
  });

  it("parses optionalList with prices", () => {
    const result = parseUvOptional({
      optionalList: [
        { name: "夜遊", price: 2000, currency: "TWD" },
        { name: "溫泉", price: 500 },
      ],
    } as any);
    expect(result!.items).toHaveLength(2);
    expect(result!.items[0].price).toBe(2000);
    expect(result!.items[1].currency).toBe("TWD"); // default
  });

  it("merges shop + optionalList", () => {
    const result = parseUvOptional({
      productShop: [{ shopName: "A" }],
      optionalList: [{ name: "B", price: 100 }],
    } as any);
    expect(result!.items).toHaveLength(2);
  });
});
