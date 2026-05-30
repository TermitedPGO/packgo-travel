/**
 * Tests for uvDetail parsers — exercised against a REAL captured
 * getProductTravelDetail response (P00002255 / YG7 美西黃石 7-day), plus a few
 * synthetic edge cases. The fixture is the actual Ctrip SOA2 shape, so these
 * tests catch shape drift the old hand-written fixtures masked.
 */

import { describe, expect, it } from "vitest";
import {
  parseUvItinerary,
  parseUvNotices,
  parseUvOptional,
  parseUvPriceTerms,
} from "./uvDetail";
import uvTravelDetail from "./__fixtures__/uv-travel-detail.json";

const real = uvTravelDetail as any;

describe("parseUvItinerary (real fixture)", () => {
  it("returns null when productTravel missing", () => {
    expect(parseUvItinerary({} as any, null)).toBeNull();
  });

  it("extracts all 7 days, sorted by dayNumber", () => {
    const result = parseUvItinerary(real, null);
    expect(result).not.toBeNull();
    // raw dayList order is [1,3,4,6,2,5,7] — parser must sort
    expect(result!.days.map((d) => d.dayNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // totalDays from productTravel.productDay when main is null
    expect(result!.totalDays).toBe(7);
  });

  it("derives day title from relatedName, stripping the 【code】 prefix", () => {
    const result = parseUvItinerary(real, null)!;
    expect(result.days[0].title).toBe("舊金山 - 薩克拉門托 - 州府大廈 - 艾可市");
  });

  it("splits the route into per-day attraction stops", () => {
    const result = parseUvItinerary(real, null)!;
    expect(result.days[0].attractions.map((a) => a.name)).toEqual([
      "舊金山",
      "薩克拉門托",
      "州府大廈",
      "艾可市",
    ]);
  });

  it("extracts hotels from the base64 content block, with 同級 marker", () => {
    const result = parseUvItinerary(real, null)!;
    const names = result.days[0].hotels.map((h) => h.name);
    expect(names).toContain("Ramada by Wyndham Elko Hotel");
    expect(names).toContain("SureStay By Best Western Wells");
    // "similar" → 同級旅館 (or-equivalent marker), not a real hotel name
    expect(names).toContain("同級旅館");
    expect(names).not.toContain("similar");
  });

  it("leaves meals unspecified (UV has no per-day meals)", () => {
    const result = parseUvItinerary(real, null)!;
    expect(result.days[0].meals).toEqual({
      breakfast: "",
      lunch: "",
      dinner: "",
    });
  });

  it("prefers main.tripDay for totalDays when provided", () => {
    const result = parseUvItinerary(real, { tripDay: 9 } as any);
    expect(result!.totalDays).toBe(9);
  });
});

describe("parseUvItinerary (synthetic edge cases)", () => {
  it("sorts an out-of-order dayList and falls back to section title", () => {
    const travel = {
      productTravel: {
        productTravelInfoList: [
          {
            isSource: 0,
            dayList: [
              { dayNumber: 2, section: "Osaka|||1+++Kyoto", content: [] },
              { dayNumber: 1, section: "Tokyo|||1+++Hakone", content: [] },
            ],
          },
        ],
      },
    } as any;
    const result = parseUvItinerary(travel, null)!;
    expect(result.days.map((d) => d.dayNumber)).toEqual([1, 2]);
    expect(result.days[0].title).toBe("Tokyo - Hakone");
  });

  it("maps a lone 'similar' to nothing (no real hotel to anchor it)", () => {
    const travel = {
      productTravel: {
        productTravelInfoList: [
          {
            dayList: [
              {
                dayNumber: 1,
                section: "X",
                content: [
                  {
                    contentType: 8,
                    jsonContent: Buffer.from(
                      JSON.stringify({ content: [{ hotelName: "similar" }] })
                    ).toString("base64"),
                  },
                ],
              },
            ],
          },
        ],
      },
    } as any;
    const result = parseUvItinerary(travel, null)!;
    expect(result.days[0].hotels).toEqual([]);
  });
});

describe("parseUvOptional (real fixture)", () => {
  it("returns null when productCost missing", () => {
    expect(parseUvOptional({} as any)).toBeNull();
  });

  it("extracts all 12 cost items with USD prices", () => {
    const result = parseUvOptional(real)!;
    expect(result.items).toHaveLength(12);
    const fee = result.items.find((i) => i.name === "YG Mandatory Fee")!;
    expect(fee.price).toBe(215);
    expect(fee.currency).toBe("USD");
  });

  it("picks the adult/everyone tier when multiple price tiers exist", () => {
    const result = parseUvOptional(real)!;
    const antelope = result.items.find(
      (i) => i.name === "Lower Antelope Canyon"
    )!;
    // tiers: Adult (4+) $105 / Child (0-3) $20 → pick adult
    expect(antelope.price).toBe(105);
  });

  it("strips HTML from the description", () => {
    const result = parseUvOptional(real)!;
    const fee = result.items.find((i) => i.name === "YG Mandatory Fee")!;
    expect(fee.description).not.toContain("<");
    expect(fee.description).toContain("Including");
  });
});

describe("parseUvOptional (synthetic)", () => {
  it("detects TWD from an NT$ price string", () => {
    const result = parseUvOptional({
      productCost: {
        list: [
          {
            expIExpandName: "夜遊",
            expIExpandDesc: "",
            priceInfo: [{ expPriceName: "Adult", expPriceMoney: "NT$2,000" }],
          },
        ],
      },
    } as any)!;
    expect(result.items[0].price).toBe(2000);
    expect(result.items[0].currency).toBe("TWD");
  });
});

describe("parseUvPriceTerms (real fixture)", () => {
  it("extracts inclusions from noticeType-0 notices", () => {
    const result = parseUvPriceTerms(real)!;
    expect(result.included).toHaveLength(2);
    expect(result.included.join("\n")).toContain("Transportation");
    expect(result.included.join("\n")).toContain("Lunch");
    expect(result.excluded).toEqual([]);
    expect(result.cancellationPolicy).toEqual([]);
  });

  it("returns null when no inclusion notice exists", () => {
    expect(
      parseUvPriceTerms({
        productNotice: { noticeInfo: [{ noticeType: 3, matterName: "退改" }] },
      } as any)
    ).toBeNull();
  });
});

describe("parseUvNotices (real fixture)", () => {
  it("buckets refund/booking/tip notices and skips inclusions", () => {
    const result = parseUvNotices(real)!;
    const all = [
      result.visa,
      result.insurance,
      result.baggage,
      result.general,
    ].join("\n");
    expect(all).toContain("退改政策");
    expect(all).toContain("出行提示");
    expect(all).toContain("預定須知");
    // noticeType 0 (含…) must NOT appear here — it belongs to priceTerms
    expect(all).not.toContain("含行程所列早餐");
  });

  it("returns null when productNotice missing", () => {
    expect(parseUvNotices({} as any)).toBeNull();
  });

  it("routes a visa-keyworded notice to the visa bucket", () => {
    const result = parseUvNotices({
      productNotice: {
        noticeInfo: [
          { noticeType: 1, matterName: "簽證須知", vluesTip1: "<p>免簽 90 天</p>" },
        ],
      },
    } as any)!;
    expect(result.visa).toContain("免簽");
    expect(result.general).toBe("");
  });
});
