import { describe, it, expect } from "vitest";
import {
  classifyReconcile,
  summarizeReconcile,
  looksLikeNonTourService,
  type ProductReconcileInput,
  type TourReconcileFacts,
} from "./tourReconciler";

const completeTour = (over: Partial<TourReconcileFacts> = {}): TourReconcileFacts => ({
  status: "inactive",
  hasDescription: true,
  hasItinerary: true,
  hasImage: true,
  price: 599,
  futureDepartures: 50,
  ...over,
});

const p = (over: Partial<ProductReconcileInput>): ProductReconcileInput => ({
  code: "P0000TEST",
  hidden: false,
  isJunkService: false,
  sellableFutureDepartures: 50,
  tour: null,
  ...over,
});

describe("classifyReconcile", () => {
  it("junk service → HOLD_JUNK(最高優先,連 hidden 之前)", () => {
    expect(classifyReconcile(p({ isJunkService: true, hidden: false, tour: completeTour({ status: "active" }) }))).toBe("HOLD_JUNK");
  });

  it("hidden → HOLD_HIDDEN(尊重人工,不自動復活)", () => {
    expect(classifyReconcile(p({ hidden: true, sellableFutureDepartures: 80 }))).toBe("HOLD_HIDDEN");
  });

  it("供應商無未來出發日 + 站上沒上架 → DORMANT(正確擱置)", () => {
    expect(classifyReconcile(p({ sellableFutureDepartures: 0, tour: null }))).toBe("DORMANT");
    expect(classifyReconcile(p({ sellableFutureDepartures: 0, tour: completeTour({ status: "inactive" }) }))).toBe("DORMANT");
  });

  it("active 但供應商已無未來出發日 → SHOULD_DEACTIVATE", () => {
    expect(classifyReconcile(p({ sellableFutureDepartures: 0, tour: completeTour({ status: "active" }) }))).toBe("SHOULD_DEACTIVATE");
  });

  it("可賣但站上沒這團 → NEEDS_IMPORT", () => {
    expect(classifyReconcile(p({ sellableFutureDepartures: 30, tour: null }))).toBe("NEEDS_IMPORT");
  });

  it("已 active 且有未來出發日 → OK_LIVE", () => {
    expect(classifyReconcile(p({ sellableFutureDepartures: 30, tour: completeTour({ status: "active", futureDepartures: 20 }) }))).toBe("OK_LIVE");
  });

  it("active 但 tour 端行事曆空 → NEEDS_DEPARTURE_REFRESH", () => {
    expect(classifyReconcile(p({ sellableFutureDepartures: 30, tour: completeTour({ status: "active", futureDepartures: 0 }) }))).toBe("NEEDS_DEPARTURE_REFRESH");
  });

  it("可賣、未上架、缺內容 → NEEDS_BUILD", () => {
    expect(classifyReconcile(p({ tour: completeTour({ hasDescription: false }) }))).toBe("NEEDS_BUILD");
    expect(classifyReconcile(p({ tour: completeTour({ hasItinerary: false }) }))).toBe("NEEDS_BUILD");
  });

  it("可賣、未上架、內容齊但缺圖 → NEEDS_IMAGE", () => {
    expect(classifyReconcile(p({ tour: completeTour({ hasImage: false }) }))).toBe("NEEDS_IMAGE");
  });

  it("可賣、未上架、內容齊有圖但 price<=0 → NEEDS_PRICE", () => {
    expect(classifyReconcile(p({ tour: completeTour({ price: 0 }) }))).toBe("NEEDS_PRICE");
  });

  it("可賣、未上架、內容齊有圖有價但 tour 端無出發日 → NEEDS_DEPARTURE_REFRESH", () => {
    expect(classifyReconcile(p({ tour: completeTour({ futureDepartures: 0 }) }))).toBe("NEEDS_DEPARTURE_REFRESH");
  });

  it("可賣、未上架、全齊 → READY_TO_ACTIVATE(仍走 approveTour,不在此硬翻)", () => {
    expect(classifyReconcile(p({ tour: completeTour() }))).toBe("READY_TO_ACTIVATE");
  });
});

describe("summarizeReconcile", () => {
  it("彙總每種動作的數量", () => {
    const s = summarizeReconcile([
      p({ tour: completeTour({ status: "active", futureDepartures: 5 }) }), // OK_LIVE
      p({ tour: completeTour() }), // READY_TO_ACTIVATE
      p({ tour: null }), // NEEDS_IMPORT
      p({ hidden: true }), // HOLD_HIDDEN
      p({ isJunkService: true }), // HOLD_JUNK
      p({ sellableFutureDepartures: 0 }), // DORMANT
    ]);
    expect(s.OK_LIVE).toBe(1);
    expect(s.READY_TO_ACTIVATE).toBe(1);
    expect(s.NEEDS_IMPORT).toBe(1);
    expect(s.HOLD_HIDDEN).toBe(1);
    expect(s.HOLD_JUNK).toBe(1);
    expect(s.DORMANT).toBe(1);
  });
});

describe("looksLikeNonTourService", () => {
  it("抓到非旅遊服務", () => {
    for (const t of [
      "【留學生服務】落地生根套餐",
      "委託書、聲明書的三級認證【Notary Public】",
      "Air Ticketing",
      "行程資訊缺失，無法生成文案",
    ]) expect(looksLikeNonTourService(t)).toBe(true);
  });
  it("不誤殺真團(門票/接機在正常團名裡)", () => {
    for (const t of [
      "奧蘭多樂園五日遊：自選主題樂園、含門票",
      "武當山三日遊：道教古剎(十堰接機)",
      "經典美西黃石｜五大國家公園 12 日",
    ]) expect(looksLikeNonTourService(t)).toBe(false);
  });
});
