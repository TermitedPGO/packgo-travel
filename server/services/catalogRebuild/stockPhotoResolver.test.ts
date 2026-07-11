/**
 * stockPhotoResolver.test — 對客 hero 圖來源純函式 + 三態測(含署名合規)。
 *
 * 三態(指揮要求):命中 / 未命中 / 無 key,全部走注入的假 search + trigger,
 * 不碰真 API。命中帶 credit + downloadLocation 且觸發一次 download;未命中 /
 * 無 key 回 null 且不觸發。另加:無目的地訊號 → 不打 API(回 null)。
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildStockPhotoQuery,
  resolveStockPhoto,
  type PhotoSearchFn,
  type DownloadTriggerFn,
} from "./stockPhotoResolver";

const CREDIT = {
  name: "Jane Doe",
  username: "janedoe",
  profileUrl: "https://unsplash.com/@janedoe",
};

const hit = (over: Record<string, unknown> = {}) => ({
  url: "https://images.unsplash.com/photo-1.jpg",
  credit: CREDIT,
  downloadLocation: "https://api.unsplash.com/photos/abc/download",
  ...over,
});

const noopTrigger: DownloadTriggerFn = async () => {};

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

describe("resolveStockPhoto — 三態(含 credit)", () => {
  it("HIT: returns url + credit + downloadLocation, and pings download_location ONCE", async () => {
    const search: PhotoSearchFn = vi.fn(async () => [hit(), hit({ url: "https://images.unsplash.com/photo-2.jpg" })]);
    const trigger: DownloadTriggerFn = vi.fn(async () => {});
    const r = await resolveStockPhoto({ destinationCountry: "阿聯", destinationCity: "杜拜" }, search, trigger);
    expect(r).not.toBeNull();
    expect(r!.url).toBe("https://images.unsplash.com/photo-1.jpg");
    expect(r!.credit).toEqual(CREDIT);
    expect(r!.downloadLocation).toBe("https://api.unsplash.com/photos/abc/download");
    expect(search).toHaveBeenCalledWith("杜拜 阿聯", 10);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith("https://api.unsplash.com/photos/abc/download");
  });

  it("HIT without credit: still returns the url, credit is null (UI then skips the attribution line)", async () => {
    const search: PhotoSearchFn = vi.fn(async () => [hit({ credit: null, downloadLocation: null })]);
    const trigger: DownloadTriggerFn = vi.fn(async () => {});
    const r = await resolveStockPhoto({ destinationCountry: "日本" }, search, trigger);
    expect(r!.url).toBe("https://images.unsplash.com/photo-1.jpg");
    expect(r!.credit).toBeNull();
    // no downloadLocation → no ping
    expect(trigger).not.toHaveBeenCalled();
  });

  it("HIT with failing download ping: fail-open — photo still ships", async () => {
    const search: PhotoSearchFn = vi.fn(async () => [hit()]);
    const trigger: DownloadTriggerFn = vi.fn(async () => {
      throw new Error("429 rate limited");
    });
    const r = await resolveStockPhoto({ destinationCountry: "泰國" }, search, trigger);
    expect(r).not.toBeNull();
    expect(r!.url).toBe("https://images.unsplash.com/photo-1.jpg");
  });

  it("MISS: returns null (and never pings) when the search yields no results", async () => {
    const search: PhotoSearchFn = vi.fn(async () => []);
    const trigger: DownloadTriggerFn = vi.fn(async () => {});
    expect(await resolveStockPhoto({ destinationCountry: "日本" }, search, trigger)).toBeNull();
    expect(trigger).not.toHaveBeenCalled();
  });

  it("NO KEY / error: fail-open to null (never throws, tour ships imageless)", async () => {
    // unsplashService returns [] with no key; simulate the harsher case (throw)
    // to prove fail-open even on an API/network error.
    const search: PhotoSearchFn = vi.fn(async () => {
      throw new Error("no access key / 403");
    });
    expect(
      await resolveStockPhoto({ destinationCountry: "美國", destinationCity: "New York" }, search, noopTrigger),
    ).toBeNull();
  });

  it("no destination signal → returns null WITHOUT calling the search API", async () => {
    const search: PhotoSearchFn = vi.fn(async () => [hit()]);
    expect(await resolveStockPhoto({}, search, noopTrigger)).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it("ignores blank/whitespace URLs the search may return", async () => {
    const search: PhotoSearchFn = vi.fn(async () => [
      hit({ url: "" }),
      hit({ url: "   " }),
      hit({ url: "https://ok.jpg" }),
    ]);
    const r = await resolveStockPhoto({ destinationCountry: "泰國" }, search, noopTrigger);
    expect(r!.url).toBe("https://ok.jpg");
  });
});

describe("resolveStockPhoto — 批次去重(usedUrls,Block B)", () => {
  it("skips a candidate already in usedUrls, picks the next unused one", async () => {
    const search: PhotoSearchFn = vi.fn(async () => [
      hit({ url: "https://images.unsplash.com/photo-1.jpg" }),
      hit({ url: "https://images.unsplash.com/photo-2.jpg" }),
    ]);
    const trigger: DownloadTriggerFn = vi.fn(async () => {});
    const used = new Set<string>(["https://images.unsplash.com/photo-1.jpg"]);
    const r = await resolveStockPhoto({ destinationCountry: "泰國" }, search, trigger, used);
    expect(r).not.toBeNull();
    expect(r!.url).toBe("https://images.unsplash.com/photo-2.jpg");
    // 選中的候選被加進共用集合,供下一個呼叫端(下一團)避開。
    expect(used.has("https://images.unsplash.com/photo-2.jpg")).toBe(true);
  });

  it("all candidates already used → returns null (fail-open, tour ships imageless)", async () => {
    const search: PhotoSearchFn = vi.fn(async () => [
      hit({ url: "https://images.unsplash.com/photo-1.jpg" }),
      hit({ url: "https://images.unsplash.com/photo-2.jpg" }),
    ]);
    const used = new Set<string>([
      "https://images.unsplash.com/photo-1.jpg",
      "https://images.unsplash.com/photo-2.jpg",
    ]);
    const r = await resolveStockPhoto({ destinationCountry: "泰國" }, search, noopTrigger, used);
    expect(r).toBeNull();
  });

  it("without usedUrls (undefined) behaves as before — first valid candidate wins", async () => {
    const search: PhotoSearchFn = vi.fn(async () => [hit()]);
    const r = await resolveStockPhoto({ destinationCountry: "泰國" }, search, noopTrigger);
    expect(r!.url).toBe("https://images.unsplash.com/photo-1.jpg");
  });
});
