/**
 * Ground-truth cases use only UNAMBIGUOUS geography (San Francisco is in the
 * US; 黃山 is in China; 沖繩 is in Japan) — these are facts, not guesses. The
 * load-bearing assertions: (1) the 台灣-bucket mislabels resolve to their real
 * country, (2) the departure city 台北 never wins, (3) conflicting/empty
 * signals ABSTAIN instead of guessing.
 */
import { describe, it, expect } from "vitest";
import { deriveLocation } from "./lionLocation";

describe("deriveLocation — real 台灣-bucket mislabels resolve correctly", () => {
  it("美西 + San Francisco itinerary -> 美國 (not 台灣)", () => {
    const r = deriveLocation({
      title: "聯營出團》美西旅遊｜玩美加族、環球影城、羚羊峽谷、雙國家公園９日",
      dayTitles: ["台北 → 舊金山：金門灣觀光"],
      locations: ["Golden Gate Bridge, San Francisco", "Twin Peaks", "San Francisco"],
    });
    expect(r.country).toBe("美國");
    expect(r.confidence).toBe("high");
    expect(r.city).toBe("舊金山");
  });

  it("黃山旅遊 + 杭州/歙縣 itinerary -> 中國", () => {
    const r = deriveLocation({
      title: "黃山旅遊|黃山雲海雙泊・宏村水墨古村・千島湖慢遊8日",
      dayTitles: ["台北 → 杭州"],
      locations: ["杭州", "歙縣", "屯溪"],
    });
    expect(r.country).toBe("中國");
    expect(r.city).toBe("杭州");
  });

  it("重慶旅遊 + 重慶市/武隆 -> 中國/重慶", () => {
    const r = deriveLocation({
      title: "重慶旅遊│升等三排座車.武隆天坑三橋‧恩施大峽谷8日",
      dayTitles: ["台北 → 重慶：山城初印象"],
      locations: ["重慶市", "武隆縣", "武隆仙女山國家森林公園"],
    });
    expect(r.country).toBe("中國");
    expect(r.city).toBe("重慶");
  });

  it("九寨溝 + 成都 -> 中國/成都", () => {
    const r = deriveLocation({
      title: "超值｜九寨溝.牟尼溝.樂山大佛.熊貓基地8日",
      dayTitles: ["台北 → 成都：天府之城初探"],
      locations: ["成都", "疊溪海子", "松潘古城"],
    });
    expect(r.country).toBe("中國");
    expect(r.city).toBe("成都");
  });
});

describe("deriveLocation — correctly-bucketed tours stay correct + gain a real city", () => {
  it("沖繩 (Okinawa) -> 日本, city upgraded from 日本 to 那霸", () => {
    const r = deriveLocation({
      title: "客製沖繩包棟海景VILLA.美麗海水族館迷你小團四日",
      dayTitles: ["台北 → 那霸"],
      locations: ["那霸市", "沖繩本島北部", "古宇利島", "美麗海水族館"],
    });
    expect(r.country).toBe("日本");
    expect(r.city).toBe("那霸");
  });
});

describe("deriveLocation — NO GUESSING: abstain instead", () => {
  it("departure 台北 never wins the country", () => {
    const r = deriveLocation({
      title: "神秘行程",
      dayTitles: ["台北 出發"],
      locations: ["台北", "台北桃園機場"],
    });
    expect(r.country).toBeNull();
    expect(r.confidence).toBe("abstain");
  });

  it("conflicting signals abstain (title US, itinerary China)", () => {
    const r = deriveLocation({
      title: "美西旅遊",
      dayTitles: ["台北 → 上海"],
      locations: ["上海", "杭州"],
    });
    expect(r.country).toBeNull();
    expect(r.reason).toMatch(/conflict/);
  });

  it("itinerary spanning two countries abstains", () => {
    const r = deriveLocation({
      title: "雙城記",
      dayTitles: [],
      locations: ["大阪", "舊金山"],
    });
    expect(r.country).toBeNull();
  });

  it("unknown place (not in gazetteer) abstains, does not guess", () => {
    const r = deriveLocation({
      title: "某個沒聽過的地方深度遊",
      dayTitles: ["台北 → 某地"],
      locations: ["某景點", "另一個景點"],
    });
    expect(r.country).toBeNull();
  });
});

describe("deriveLocation — Taiwan domestic (county title, no foreign tokens)", () => {
  it("宜蘭 domestic tour -> 台灣/宜蘭", () => {
    const r = deriveLocation({
      title: "宜蘭旅遊│深度太平山~翠峰湖觀景台",
      dayTitles: ["台北車站 → 太平山"],
      locations: ["太平山", "翠峰湖", "見晴懷古步道"],
    });
    expect(r.country).toBe("台灣");
    expect(r.city).toBe("宜蘭");
  });

  it("花蓮 + 太魯閣/清水斷崖 -> 台灣/花蓮", () => {
    const r = deriveLocation({
      title: "花蓮旅遊｜立榮飛行花蓮日記2日",
      dayTitles: ["花蓮火車站集合"],
      locations: ["太魯閣國家公園", "清水斷崖", "祥德寺"],
    });
    expect(r.country).toBe("台灣");
  });

  it("messy itinerary with a Taiwan county title still resolves (no foreign)", () => {
    const r = deriveLocation({
      title: "嘉義旅遊｜阿里山森林遊樂園區",
      dayTitles: ["09:00飯店出發 10:30阿里山迷糊步道 12:30奮起湖老街"],
      locations: ["09:00飯店出發 10:30阿里山迷糊步道 12:30奮起湖老街便當"],
    });
    expect(r.country).toBe("台灣");
    expect(r.city).toBe("嘉義");
  });
});

describe("deriveLocation — Taiwan/China collisions must NOT mislabel (regression)", () => {
  it("新北三峽 day tour stays Taiwan, never 中國", () => {
    const r = deriveLocation({
      title: "新北旅遊｜三峽百年山中茶園.行天宮",
      dayTitles: ["台北車站集合"],
      locations: ["三峽老街", "行天宮"],
    });
    expect(r.country).toBe("台灣");
    expect(r.country).not.toBe("中國");
  });

  it("石碇千島湖 stays Taiwan, never 中國", () => {
    const r = deriveLocation({
      title: "新北旅遊｜絕美石碇千島湖.八卦茶園一日",
      dayTitles: ["台北 → 石碇"],
      locations: ["石碇千島湖", "八卦茶園"],
    });
    expect(r.country).toBe("台灣");
  });

  it("Taiwan county title + a foreign token in itinerary = conflict -> abstain", () => {
    const r = deriveLocation({
      title: "宜蘭旅遊",
      dayTitles: [],
      locations: ["大阪城"],
    });
    expect(r.country).toBeNull();
  });
});

describe("deriveLocation — outbound tour with Taiwan expo prefix must NOT become 台灣", () => {
  it("台中旅展．澳門自由行 -> NOT 台灣 (Macau, or abstain)", () => {
    const r = deriveLocation({
      title: "台中旅展限定．澳門自由行|★澳門安達仕酒店★",
      dayTitles: [],
      locations: ["澳門威尼斯人", "氹仔"],
    });
    expect(r.country).not.toBe("台灣");
  });

  it("旅展折$300‧香港自由行 -> NOT 台灣", () => {
    const r = deriveLocation({
      title: "旅展折$300‧香港自由行|★九龍精品酒店",
      dayTitles: [],
      locations: ["尖沙咀", "九龍"],
    });
    expect(r.country).not.toBe("台灣");
  });
});
