/**
 * Tests for lionDetail parsers. Each parser is exercised with happy
 * path + missing-field + malformed scenarios.
 *
 * Doesn't test `enrichLionProduct` orchestrator E2E (that's covered in
 * M5 integration test with mocked API client + DB).
 */

import { describe, expect, it } from "vitest";
import {
  parseLionItinerary,
  parseLionNotices,
  parseLionOptional,
  parseLionPriceTerms,
  parseLionTourInfo,
} from "./lionDetail";

describe("parseLionItinerary", () => {
  it("returns null when GroupInfo missing", () => {
    expect(parseLionItinerary({} as any)).toBeNull();
  });

  it("returns null when TourDays is 0", () => {
    expect(
      parseLionItinerary({
        GroupInfo: { TourDays: 0 } as any,
      } as any)
    ).toBeNull();
  });

  it("synthesizes Day 1 and Day N from flight info", () => {
    const result = parseLionItinerary({
      GoAirline: "中華航空",
      GoDepartureTime: "09:30",
      GoDepartureAirport: "TPE",
      GoArriveAirport: "NRT",
      BackAirline: "中華航空",
      BackDepartureTime: "18:00",
      BackDepartureAirport: "NRT",
      BackArriveAirport: "TPE",
      GroupInfo: {
        TourDays: 5,
        Country: "日本",
      } as any,
    } as any);
    expect(result).not.toBeNull();
    expect(result!.totalDays).toBe(5);
    expect(result!.days).toHaveLength(2);
    expect(result!.days[0].dayNumber).toBe(1);
    expect(result!.days[0].title).toContain("TPE");
    expect(result!.days[0].transportation).toContain("中華航空");
    expect(result!.days[1].dayNumber).toBe(5);
  });

  it("handles no-flight tours (domestic)", () => {
    const result = parseLionItinerary({
      IsNoFlight: true,
      GroupInfo: { TourDays: 3, Country: "台灣" } as any,
    } as any);
    expect(result).not.toBeNull();
    expect(result!.totalDays).toBe(3);
    expect(result!.days).toHaveLength(0); // no flights → no synthesized days
  });

  // 2026-05-25: tests for daytripinfojson merge
  it("merges daytripinfojson DailyList when present", () => {
    const result = parseLionItinerary(
      {
        GoAirline: "華航",
        GoDepartureTime: "09:00",
        GoDepartureAirport: "TPE",
        GoArriveAirport: "NRT",
        BackAirline: "華航",
        BackDepartureAirport: "NRT",
        BackArriveAirport: "TPE",
        GroupInfo: { TourDays: 3, Country: "日本" } as any,
      } as any,
      {
        DailyList: [
          {
            Day: 1,
            TravelPoint: "桃園 → 東京",
            Breakfast: "敬請自理",
            Lunch: "機上輕食",
            Dinner: "迎賓晚宴",
            HotelList: [{ HotelName: "東京希爾頓", Stars: 5 }],
            AttractionsList: [{ Name: "成田機場", VisitWayDesc: "接機" }],
          },
          {
            Day: 2,
            TravelPoint: "東京 → 富士山",
            Breakfast: "飯店內",
            Lunch: "壽司套餐",
            Dinner: "和牛涮涮鍋",
            HotelList: [{ HotelName: "河口湖溫泉飯店", Stars: 4 }],
            AttractionsList: [
              { Name: "富士山五合目", VisitWayDesc: "下車參觀" },
              { Name: "忍野八海", VisitWayDesc: "下車參觀" },
            ],
          },
          {
            Day: 3,
            TravelPoint: "富士山 → 桃園",
            Breakfast: "飯店內",
            Lunch: "機場餐券",
            Dinner: "機上",
            HotelList: [],
            AttractionsList: [],
          },
        ],
      } as any,
    );
    expect(result!.totalDays).toBe(3);
    expect(result!.days).toHaveLength(3);
    expect(result!.days[0].title).toBe("桃園 → 東京");
    expect(result!.days[0].meals.breakfast).toBe(false); // "敬請自理"
    expect(result!.days[0].meals.dinner).toBe("迎賓晚宴");
    expect(result!.days[0].transportation).toContain("華航");
    expect(result!.days[0].hotels[0].name).toBe("東京希爾頓");
    expect(result!.days[0].hotels[0].type).toBe("5星");
    expect(result!.days[1].attractions).toHaveLength(2);
    expect(result!.days[1].hotels[0].type).toBe("4星");
    expect(result!.days[2].transportation).toContain("華航"); // back flight on last day
  });

  it("strips HTML from Lion attraction/hotel/title fields", () => {
    const result = parseLionItinerary(
      { GroupInfo: { TourDays: 1 } as any } as any,
      {
        DailyList: [
          {
            Day: 1,
            TravelPoint: "<p>桃園 &amp; 東京</p>",
            AttractionsList: [
              { Name: "<b>東京晴空塔</b>", VisitWayDesc: "<span>登塔</span>" },
            ],
            HotelDesc: "<div>同等級飯店</div>",
            HotelList: [],
          },
        ],
      } as any,
    );
    expect(result!.days[0].title).toBe("桃園 & 東京");
    expect(result!.days[0].attractions[0].name).toBe("東京晴空塔");
    expect(result!.days[0].attractions[0].description).toBe("登塔");
    expect(result!.days[0].hotels[0].name).toBe("同等級飯店");
  });

  it("falls back to HotelDesc when HotelList empty", () => {
    const result = parseLionItinerary(
      { GroupInfo: { TourDays: 1 } as any } as any,
      {
        DailyList: [
          {
            Day: 1,
            TravelPoint: "Day 1",
            HotelList: [],
            HotelDesc: "京都希爾頓或同級",
          },
        ],
      } as any,
    );
    expect(result!.days[0].hotels).toHaveLength(1);
    expect(result!.days[0].hotels[0].name).toBe("京都希爾頓或同級");
    expect(result!.days[0].hotels[0].type).toBe("未指定");
  });

  it("falls back to flight-info synthesis when daytripinfojson empty", () => {
    const result = parseLionItinerary(
      {
        GoAirline: "華航",
        GoDepartureAirport: "TPE",
        GoArriveAirport: "NRT",
        BackAirline: "華航",
        BackDepartureAirport: "NRT",
        BackArriveAirport: "TPE",
        GroupInfo: { TourDays: 3 } as any,
      } as any,
      { DailyList: [] } as any,
    );
    expect(result!.days).toHaveLength(2);
    expect(result!.days[0].dayNumber).toBe(1);
    expect(result!.days[1].dayNumber).toBe(3);
  });

  it("treats null daytripinfojson same as missing (flight-info fallback)", () => {
    const result = parseLionItinerary(
      {
        GoAirline: "華航",
        GoDepartureAirport: "TPE",
        GoArriveAirport: "NRT",
        GroupInfo: { TourDays: 3 } as any,
      } as any,
      null,
    );
    expect(result!.days[0].dayNumber).toBe(1);
  });
});

describe("parseLionPriceTerms", () => {
  it("returns null when OrderPrice missing", () => {
    expect(parseLionPriceTerms({} as any)).toBeNull();
  });

  it("classifies free visa as included", () => {
    const result = parseLionPriceTerms({
      OrderPrice: 35000,
      VisaPrice: { CostDesc: "TWD", Cost: 0 },
      Meals: [],
    } as any);
    expect(result!.included).toContain("簽證費");
    expect(result!.excluded).not.toContain(expect.stringMatching(/簽證/));
  });

  it("classifies paid visa as excluded", () => {
    const result = parseLionPriceTerms({
      OrderPrice: 35000,
      VisaPrice: { CostDesc: "TWD", Cost: 1500 },
    } as any);
    expect(result!.excluded.some((e) => e.includes("簽證"))).toBe(true);
  });

  it("includes meal count when Meals array present", () => {
    const result = parseLionPriceTerms({
      OrderPrice: 35000,
      Meals: [{ Type: "breakfast" }, { Type: "lunch" }, { Type: "dinner" }],
    } as any);
    expect(result!.included.some((s) => s.includes("3 餐"))).toBe(true);
  });

  it("uses full-pay terms when IsFullPay", () => {
    const result = parseLionPriceTerms({
      OrderPrice: 35000,
      IsFullPay: true,
    } as any);
    expect(result!.paymentTerms).toContain("全額");
  });
});

describe("parseLionNotices", () => {
  it("returns null when no notes anywhere", () => {
    expect(parseLionNotices({} as any)).toBeNull();
    expect(parseLionNotices({ NoteList: [] } as any)).toBeNull();
  });

  it("buckets visa-related notes into visa field", () => {
    const result = parseLionNotices({
      NoteList: [
        { Title: "簽證須知", Content: "需要 6 個月效期護照" },
      ],
    } as any);
    expect(result!.visa).toContain("6 個月效期");
  });

  it("buckets baggage-related into baggage field", () => {
    const result = parseLionNotices({
      NoteList: [{ Title: "行李規定", Content: "20kg" }],
    } as any);
    expect(result!.baggage).toContain("20kg");
  });

  it("appends SafeReg to insurance", () => {
    const result = parseLionNotices({
      NoteList: [{ Title: "保險條款", Content: "200萬旅平險" }],
      SafeReg: "旅遊安全規範...",
    } as any);
    expect(result!.insurance).toContain("200萬");
    expect(result!.insurance).toContain("旅遊安全規範");
  });

  it("puts unmatched notes into general", () => {
    const result = parseLionNotices({
      NoteList: [{ Title: "其他", Content: "請穿輕便服裝" }],
    } as any);
    expect(result!.general).toContain("輕便服裝");
  });
});

describe("parseLionOptional", () => {
  it("returns null when raw is null", () => {
    expect(parseLionOptional(null as any)).toBeNull();
  });

  it("returns empty items when no optionals", () => {
    expect(parseLionOptional({} as any)).toEqual({ items: [] });
  });

  it("parses OptionalInfoList items", () => {
    const result = parseLionOptional({
      OptionalInfoList: [
        { Name: "迪士尼", Description: "1日票", Price: 3500, Currency: "TWD" },
      ],
    } as any);
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0].name).toBe("迪士尼");
    expect(result!.items[0].price).toBe(3500);
  });

  it("merges OptionalInfoList + SelfSelectedList", () => {
    const result = parseLionOptional({
      OptionalInfoList: [{ Name: "A", Price: 100 }],
      SelfSelectedList: [{ Name: "B", Price: 200 }],
    } as any);
    expect(result!.items).toHaveLength(2);
  });

  it("skips entries missing Name or with bad Price", () => {
    const result = parseLionOptional({
      OptionalInfoList: [
        { Price: 100 }, // no name
        { Name: "OK", Price: 200 },
        { Name: "BadPrice", Price: "abc" }, // becomes NaN → 0 (still valid)
      ],
    } as any);
    expect(result!.items.map((i) => i.name)).toContain("OK");
    expect(result!.items.map((i) => i.name)).not.toContain(undefined);
  });
});

describe("parseLionTourInfo", () => {
  it("returns null when raw is null", () => {
    expect(parseLionTourInfo(null as any)).toBeNull();
  });

  it("returns null when no useful data", () => {
    expect(parseLionTourInfo({} as any)).toBeNull();
  });

  it("adds date range to highlights", () => {
    const result = parseLionTourInfo({
      AllMinGoDate: "2026/06/01",
      AllMaxGoDate: "2026/12/31",
      TourIDList: [
        { TourID: "T1", MinGoDate: "2026/06/01", MaxGoDate: "2026/08/31" },
      ],
    } as any);
    expect(result!.highlights[0]).toContain("2026/06/01");
    expect(result!.highlights[0]).toContain("2026/12/31");
    expect(result!.metadata.tourIdCount).toBe("1");
  });
});
