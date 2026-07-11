/**
 * Tests for uvDetail parsers — exercised against a REAL captured
 * getProductTravelDetail response (P00002255 / YG7 美西黃石 7-day), plus a few
 * synthetic edge cases. The fixture is the actual Ctrip SOA2 shape, so these
 * tests catch shape drift the old hand-written fixtures masked.
 */

import { describe, expect, it } from "vitest";
import {
  isUvMandatoryCostItem,
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

  it("extracts the 11 OPTIONAL cost items — the mandatory fee is NOT 自費 (R4)", () => {
    const result = parseUvOptional(real)!;
    // fixture has 12 cost items; "YG Mandatory Fee" is 必付 → excluded from optional
    expect(result.items).toHaveLength(11);
    expect(result.items.find((i) => i.name === "YG Mandatory Fee")).toBeUndefined();
    const canyon = result.items.find((i) => i.name === "Lower Antelope Canyon")!;
    expect(canyon.price).toBe(105);
    expect(canyon.currency).toBe("USD");
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
    const kayak = result.items.find((i) => i.name === "Lake Powell Kayaking")!;
    expect(kayak.description).not.toContain("<");
    expect(kayak.description).toContain("Fee included");
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
    expect(result.cancellationPolicy).toEqual([]);
  });

  it("carries the mandatory fee into excluded with 必付 label + amount (R4)", () => {
    const result = parseUvPriceTerms(real)!;
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]).toContain("必付");
    expect(result.excluded[0]).toContain("YG Mandatory Fee");
    expect(result.excluded[0]).toContain("$215.00");
  });

  it("returns null when no inclusion notice AND no mandatory fee exist", () => {
    expect(
      parseUvPriceTerms({
        productNotice: { noticeInfo: [{ noticeType: 3, matterName: "退改" }] },
      } as any)
    ).toBeNull();
    // fail-open on empty/absent productCost too
    expect(
      parseUvPriceTerms({
        productNotice: { noticeInfo: [] },
        productCost: { list: [] },
      } as any)
    ).toBeNull();
  });
});

// ── R4 必付/自費分流 — 對「2026-07-10 live 探真」的真實回傳形狀(P00008352,
//    progress.md R4 附錄)紅綠。UV cost item 無結構性 flag(必付/自費同構),
//    唯一訊號是名稱;分類錯 = 低報總價(必付被當自費)。
describe("R4 必付/自費分流(probe 真實形狀)", () => {
  // P00008352 的真實 productCost item(探針原文照抄,僅節錄 desc)
  const P00008352_COST = {
    list: [
      {
        id: 90847,
        editType: 1,
        expenseCode: "EM00002379",
        costDay: "",
        expIExpandName: "JP-NTF3 Mandatory fee",
        expIExpandDesc:
          "<p>Include Niagara Falls Hotel Resort Fee, Niagara Power Plant.</p>",
        resourceType: 0,
        sortNo: 1,
        priceInfo: [{ expPriceName: "Everyone", expPriceMoney: "$80.00", sortNo: 1 }],
      },
      {
        id: 90848,
        editType: 1,
        expenseCode: "EM00002380",
        costDay: "",
        expIExpandName: "Thousand Islands Cruise (US Side)",
        expIExpandDesc: "",
        resourceType: 0,
        sortNo: 2,
        priceInfo: [
          { expPriceName: "Adult", expPriceMoney: "$31.54", sortNo: 1 },
          { expPriceName: "Child (5-12)", expPriceMoney: "$20.94", sortNo: 2 },
        ],
      },
    ],
  };

  it("isUvMandatoryCostItem:名稱式判別(必付命中、自費不命中)", () => {
    expect(isUvMandatoryCostItem("JP-NTF3 Mandatory fee")).toBe(true);
    expect(isUvMandatoryCostItem("YG Mandatory Fee")).toBe(true);
    expect(isUvMandatoryCostItem("司導服務費")).toBe(true);
    expect(isUvMandatoryCostItem("Thousand Islands Cruise (US Side)")).toBe(false);
    expect(isUvMandatoryCostItem("Lower Antelope Canyon")).toBe(false); // desc 有 service fee,名稱沒有 → 自費
    expect(isUvMandatoryCostItem("")).toBe(false);
    expect(isUvMandatoryCostItem(null)).toBe(false);
  });

  it("必付 $80 進 priceTerms.excluded(帶價階),自費遊船不進", () => {
    const pt = parseUvPriceTerms({
      productNotice: { noticeInfo: [] },
      productCost: P00008352_COST,
    } as any)!;
    expect(pt.excluded).toHaveLength(1);
    expect(pt.excluded[0]).toBe("必付:JP-NTF3 Mandatory fee — Everyone $80.00");
    // included 可以空(該團 noticeType-0 另存)— 有必付就不回 null
    expect(pt.included).toEqual([]);
  });

  it("自費清單只剩遊船,必付項絕不混入自費", () => {
    const opt = parseUvOptional({ productCost: P00008352_COST } as any)!;
    expect(opt.items).toHaveLength(1);
    expect(opt.items[0].name).toBe("Thousand Islands Cruise (US Side)");
    expect(opt.items[0].price).toBe(31.54);
  });

  it("純自費團(P00004442 形狀):excluded 空、自費完整保留", () => {
    const onlyOptional = {
      list: [
        {
          expIExpandName: "Maras+Moray+Chinchero One Day Tour",
          expIExpandDesc: "",
          priceInfo: [{ expPriceName: "Everyone", expPriceMoney: "$200.00" }],
        },
      ],
    };
    expect(
      parseUvPriceTerms({ productNotice: { noticeInfo: [] }, productCost: onlyOptional } as any),
    ).toBeNull(); // 無含蓋、無必付 → null(不造假)
    const opt = parseUvOptional({ productCost: onlyOptional } as any)!;
    expect(opt.items).toHaveLength(1);
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
