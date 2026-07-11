/**
 * index.test — 重抓總指揮的純邏輯 + import 煙霧測。
 *
 * 純 DB glue 的 rebuildCatalog 不在這裡跑(需真 DB);這裡只測可純測的 set-difference
 * 退役邏輯,並藉「import 得起來」確認 orchestrator 的 import graph 沒打結。
 */

import { describe, it, expect, vi } from "vitest";
import {
  computeRetiredTourIds,
  extractUvProductCode,
  extractLionNormGroupId,
  shouldSkipLionForFxRate,
  attachStockHeroImages,
} from "./index";
import type { PromotableTour } from "./promote";
import {
  resolveStockPhoto,
  type PhotoSearchFn,
  type DownloadTriggerFn,
} from "./stockPhotoResolver";

describe("computeRetiredTourIds", () => {
  it("retires active tours whose product code wasn't seen this run", () => {
    const existing = new Map([
      ["P1", { id: 1, status: "active" }],
      ["P2", { id: 2, status: "active" }],
      ["P3", { id: 3, status: "active" }],
    ]);
    const seen = new Set(["P1", "P3"]); // P2 dropped by supplier
    expect(computeRetiredTourIds(existing, seen)).toEqual([2]);
  });

  it("never retires a tour that is already inactive/draft", () => {
    const existing = new Map([
      ["P1", { id: 1, status: "inactive" }],
      ["P2", { id: 2, status: "draft" }],
    ]);
    const seen = new Set<string>(); // nothing seen
    expect(computeRetiredTourIds(existing, seen)).toEqual([]);
  });

  it("retires nothing when every active tour is still present", () => {
    const existing = new Map([
      ["P1", { id: 1, status: "active" }],
      ["P2", { id: 2, status: "active" }],
    ]);
    const seen = new Set(["P1", "P2"]);
    expect(computeRetiredTourIds(existing, seen)).toEqual([]);
  });
});

describe("extractUvProductCode", () => {
  it("pulls the product code from a UV detail URL", () => {
    expect(
      extractUvProductCode("https://uvbookings.toursbms.com/en/product/detail/P00002255"),
    ).toBe("P00002255");
  });

  it("ignores query string + hash", () => {
    expect(
      extractUvProductCode("https://uvbookings.toursbms.com/en/product/detail/P123?x=1#frag"),
    ).toBe("P123");
  });

  it("returns null for null / non-matching URLs", () => {
    expect(extractUvProductCode(null)).toBeNull();
    expect(extractUvProductCode("https://example.com/other")).toBeNull();
  });
});

describe("extractLionNormGroupId", () => {
  it("pulls the NormGroupID from a Lion detail URL", () => {
    expect(
      extractLionNormGroupId("https://travel.liontravel.com/detail?NormGroupID=a15c5c18-1234"),
    ).toBe("a15c5c18-1234");
  });

  it("handles extra query params and null", () => {
    expect(
      extractLionNormGroupId("https://travel.liontravel.com/detail?x=1&NormGroupID=abc-def#frag"),
    ).toBe("abc-def");
    expect(extractLionNormGroupId(null)).toBeNull();
    expect(extractLionNormGroupId("https://travel.liontravel.com/detail")).toBeNull();
  });
});

describe("shouldSkipLionForFxRate — 匯率本地後衛(P3,fail-closed)", () => {
  it("rate=0 → the ENTIRE Lion batch is skipped", () => {
    expect(shouldSkipLionForFxRate("lion", 0)).toBe(true);
  });

  it("NaN / Infinity / negative rates also skip Lion", () => {
    expect(shouldSkipLionForFxRate("lion", NaN)).toBe(true);
    expect(shouldSkipLionForFxRate("lion", Infinity)).toBe(true);
    expect(shouldSkipLionForFxRate("lion", -0.03)).toBe(true);
  });

  it("a usable rate lets Lion proceed", () => {
    expect(shouldSkipLionForFxRate("lion", 0.0308)).toBe(false);
  });

  it("UV is unaffected even when the rate value is 0 (UV never converts)", () => {
    expect(shouldSkipLionForFxRate("uv", 0)).toBe(false);
  });
});

describe("attachStockHeroImages — 署名(credit)落庫", () => {
  const CREDIT = { name: "Jane Doe", username: "janedoe", profileUrl: "https://unsplash.com/@janedoe" };
  const makePromotable = (): PromotableTour => ({
    tourId: 1,
    productCode: "P1",
    fields: {
      destinationCountry: "阿聯",
      destinationCity: "杜拜",
      attractions: JSON.stringify([{ name: "杜拜塔", description: "", dayNumber: 1 }]),
    },
  });

  it("writes heroImage/imageUrl + heroImageCredit JSON into the promotable fields", async () => {
    const p = makePromotable();
    const resolve = vi.fn(async () => ({
      url: "https://images.unsplash.com/photo-1.jpg",
      credit: CREDIT,
      downloadLocation: "https://api.unsplash.com/photos/abc/download",
    }));
    await attachStockHeroImages([p], resolve as never);
    expect(p.fields.heroImage).toBe("https://images.unsplash.com/photo-1.jpg");
    expect(p.fields.imageUrl).toBe("https://images.unsplash.com/photo-1.jpg");
    // credit persisted as JSON in the tours-bound field (promote writes it to DB)
    expect(JSON.parse(p.fields.heroImageCredit as string)).toEqual(CREDIT);
    // resolver got the attraction-first query signals; since the Block B batch
    // dedup, attachStockHeroImages also threads the batch-shared usedUrls Set
    // through as the 4th arg (search/trigger stay default → undefined).
    expect(resolve).toHaveBeenCalledWith(
      {
        destinationCountry: "阿聯",
        destinationCity: "杜拜",
        attractionName: "杜拜塔",
      },
      undefined,
      undefined,
      expect.any(Set),
    );
  });

  it("photo without credit → heroImageCredit explicitly null (UI skips the attribution line)", async () => {
    const p = makePromotable();
    const resolve = vi.fn(async () => ({
      url: "https://images.unsplash.com/photo-2.jpg",
      credit: null,
      downloadLocation: null,
    }));
    await attachStockHeroImages([p], resolve as never);
    expect(p.fields.heroImage).toBe("https://images.unsplash.com/photo-2.jpg");
    expect(p.fields.heroImageCredit).toBeNull();
  });

  it("resolver miss (null) → fields untouched: no hero, no stale credit", async () => {
    const p = makePromotable();
    const resolve = vi.fn(async () => null);
    await attachStockHeroImages([p], resolve as never);
    expect(p.fields).not.toHaveProperty("heroImage");
    expect(p.fields).not.toHaveProperty("imageUrl");
    expect(p.fields).not.toHaveProperty("heroImageCredit");
  });
});

describe("attachStockHeroImages — 批次內同圖去重(2026-07-11 指揮回令 Block B)", () => {
  const makePromotable = (tourId: number, productCode: string): PromotableTour => ({
    tourId,
    productCode,
    fields: {
      destinationCountry: "阿聯",
      destinationCity: "杜拜",
      attractions: JSON.stringify([{ name: "杜拜塔", description: "", dayNumber: 1 }]),
    },
  });

  /** 用真的 resolveStockPhoto 包一層假 search,證明 attachStockHeroImages 真的把
   *  usedUrls 傳給 resolve、跨團共用同一個 Set(不是每團各配各的)。 */
  const wrapRealResolver = (search: PhotoSearchFn): typeof resolveStockPhoto => {
    const noopTrigger: DownloadTriggerFn = async () => {};
    return (q, _search, _trigger, usedUrls) =>
      resolveStockPhoto(q, search, noopTrigger, usedUrls);
  };

  it("two tours, search only ever returns the SAME photo + one alternate → they get different urls", async () => {
    const search: PhotoSearchFn = vi.fn(async () => [
      { url: "https://images.unsplash.com/photo-same.jpg", credit: null, downloadLocation: null },
      { url: "https://images.unsplash.com/photo-alt.jpg", credit: null, downloadLocation: null },
    ]);
    const p1 = makePromotable(1, "P1");
    const p2 = makePromotable(2, "P2");
    await attachStockHeroImages([p1, p2], wrapRealResolver(search));

    expect(p1.fields.heroImage).toBe("https://images.unsplash.com/photo-same.jpg");
    expect(p2.fields.heroImage).toBe("https://images.unsplash.com/photo-alt.jpg");
    expect(p1.fields.heroImage).not.toBe(p2.fields.heroImage);
  });

  it("candidates exhausted for the 2nd tour → it ships with no hero (fields untouched)", async () => {
    // 只有一張候選,兩團都想要;第一團拿走,第二團無可換 → resolveStockPhoto 回 null。
    const search: PhotoSearchFn = vi.fn(async () => [
      { url: "https://images.unsplash.com/photo-only.jpg", credit: null, downloadLocation: null },
    ]);
    const p1 = makePromotable(1, "P1");
    const p2 = makePromotable(2, "P2");
    await attachStockHeroImages([p1, p2], wrapRealResolver(search));

    expect(p1.fields.heroImage).toBe("https://images.unsplash.com/photo-only.jpg");
    expect(p2.fields).not.toHaveProperty("heroImage");
    expect(p2.fields).not.toHaveProperty("imageUrl");
    expect(p2.fields).not.toHaveProperty("heroImageCredit");
  });
});
