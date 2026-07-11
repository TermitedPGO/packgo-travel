/**
 * stockPhotoResolver.test — 對客 hero 圖來源純函式 + 三態測。
 *
 * 三態(指揮要求):命中 / 未命中 / 無 key,全部走注入的假 search,不碰真 API。
 * 另加:無目的地訊號 → 不打 API(回 null)。
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildStockPhotoQuery,
  resolveStockPhoto,
  type PhotoSearchFn,
} from "./stockPhotoResolver";

describe("buildStockPhotoQuery — 目的地 → 搜圖字串", () => {
  it("prefers attraction, appends country for disambiguation", () => {
    expect(
      buildStockPhotoQuery({ destinationCountry: "阿聯", destinationCity: "杜拜", attractionName: "杜拜塔" }),
    ).toBe("杜拜塔 阿聯");
  });

  it("falls back to city when no attraction", () => {
    expect(buildStockPhotoQuery({ destinationCountry: "美國", destinationCity: "Las Vegas" })).toBe(
      "Las Vegas 美國",
    );
  });

  it("falls back to country alone when that's all we have", () => {
    expect(buildStockPhotoQuery({ destinationCountry: "日本" })).toBe("日本");
  });

  it("does not duplicate when the specific token equals the country", () => {
    expect(buildStockPhotoQuery({ destinationCountry: "馬爾地夫", destinationCity: "馬爾地夫" })).toBe(
      "馬爾地夫",
    );
  });

  it("returns null when there is no usable destination signal", () => {
    expect(buildStockPhotoQuery({})).toBeNull();
    expect(buildStockPhotoQuery({ destinationCountry: "  ", destinationCity: "" })).toBeNull();
  });
});

describe("resolveStockPhoto — 三態", () => {
  it("HIT: returns the first image URL when the search yields results", async () => {
    const search: PhotoSearchFn = vi.fn(async () => [
      "https://images.unsplash.com/photo-1.jpg",
      "https://images.unsplash.com/photo-2.jpg",
    ]);
    const url = await resolveStockPhoto({ destinationCountry: "阿聯", destinationCity: "杜拜" }, search);
    expect(url).toBe("https://images.unsplash.com/photo-1.jpg");
    expect(search).toHaveBeenCalledWith("杜拜 阿聯", 1);
  });

  it("MISS: returns null when the search yields no results", async () => {
    const search: PhotoSearchFn = vi.fn(async () => []);
    expect(await resolveStockPhoto({ destinationCountry: "日本" }, search)).toBeNull();
  });

  it("NO KEY / error: fail-open to null (never throws, tour ships imageless)", async () => {
    // unsplashService returns [] with no key; simulate the harsher case (throw)
    // to prove fail-open even on an API/network error.
    const search: PhotoSearchFn = vi.fn(async () => {
      throw new Error("no access key / 403");
    });
    expect(await resolveStockPhoto({ destinationCountry: "美國", destinationCity: "New York" }, search)).toBeNull();
  });

  it("no destination signal → returns null WITHOUT calling the search API", async () => {
    const search: PhotoSearchFn = vi.fn(async () => ["should-not-be-used"]);
    expect(await resolveStockPhoto({}, search)).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it("ignores blank/whitespace URLs the search may return", async () => {
    const search: PhotoSearchFn = vi.fn(async () => ["", "   ", "https://ok.jpg"]);
    expect(await resolveStockPhoto({ destinationCountry: "泰國" }, search)).toBe("https://ok.jpg");
  });
});
