/**
 * catalogRebuild/stockPhotoResolver — 對客 hero 圖來源(指揮裁決:供應商圖不上客人頁)。
 *
 * 背景(rebuild-plan §3.3 / design.md 紅線 #3):供應商 imageUrl 是他們的行銷照,
 * 不可直接放客人頁(版權 + 品牌)。重建管線在 staging 出口已把供應商 URL 攔在對客
 * 欄位之外(見 staging.ts)。這支負責「另找一張商用授權照」當 hero:按目的地
 * (城市/景點/國家)去 Unsplash 拿一張商用授權圖。
 *
 * Unsplash API 條款合規(2026-07-10 指揮回令 P2):
 *   - 回傳物件帶 credit(攝影師名/username/profile 連結),持久化到
 *     tours.heroImageCredit,對客頁 hero 角落顯示 "Photo by {name} on Unsplash"。
 *   - 取用時打一次 download_location 觸發端點(攝影師 view credit)— fail-open,
 *     打不通不擋圖。
 *
 * fail-open:沒有 API key、查無結果、API 出錯 → 一律回 null = 無圖上架。這是刻意的:
 * completeness 的 noImage 只是軟旗標(不擋上架),所以「拿不到圖」不該擋住賣場開張。
 * AI 生圖是之後另案,不在這支。
 *
 * 純邏輯(query 組裝)可測;取圖 / 觸發走注入的 fn(預設 unsplashService),測試用假
 * 的即可覆蓋命中 / 未命中 / 無 key 三態(含 credit),不碰真 API。
 */

import {
  searchUnsplashPhotosDetailed,
  triggerUnsplashDownload,
  type UnsplashPhotoResult,
} from "../unsplashService";
import { createChildLogger } from "../../_core/logger";

const log = createChildLogger({ module: "stockPhotoResolver" });

export interface StockPhotoQuery {
  destinationCountry?: string | null;
  destinationCity?: string | null;
  /** 招牌景點名(最具體,優先)。 */
  attractionName?: string | null;
}

/** Unsplash 條款要求保存的署名資料(對客頁渲染 + 落庫)。 */
export interface StockPhotoCredit {
  name: string;
  username: string;
  profileUrl: string;
}

/** 解析結果:對客 hero URL + 署名 + download 觸發端點(可能缺,缺就缺)。 */
export interface ResolvedStockPhoto {
  url: string;
  credit: StockPhotoCredit | null;
  downloadLocation: string | null;
}

/** 取圖函式介面(可注入假的來測)。回一組帶 credit 的搜圖結果(可空)。 */
export type PhotoSearchFn = (
  query: string,
  count: number,
) => Promise<UnsplashPhotoResult[]>;

/** download_location 觸發函式介面(可注入假的來測)。 */
export type DownloadTriggerFn = (
  downloadLocation: string | null | undefined,
) => Promise<void>;

function clean(s: string | null | undefined): string {
  return (s ?? "").trim();
}

/**
 * 從目的地訊號組一段搜圖 query。優先序:景點名 > 城市 > 國家(越具體越好);
 * 有更具體的 token 時再附上國家消歧(例「杜拜 阿聯」)。全空 → null(不打 API)。
 * 純函式。
 */
export function buildStockPhotoQuery(q: StockPhotoQuery): string | null {
  const country = clean(q.destinationCountry);
  const city = clean(q.destinationCity);
  const attraction = clean(q.attractionName);

  const specific = attraction || city;
  if (specific) {
    // 附國家消歧(景點/城市與國家不同字時才加,避免「阿聯 阿聯」)。
    return country && country !== specific ? `${specific} ${country}` : specific;
  }
  if (country) return country;
  return null;
}

/**
 * 解析一張對客 hero 圖(URL + 署名 + download 端點)。拿不到 → null(fail-open,
 * 無圖上架)。命中時打一次 download_location(fail-open,失敗不擋圖)。
 *
 * @param q       目的地訊號
 * @param search  取圖函式(預設 Unsplash detailed;測試注入假的)
 * @param trigger download 觸發函式(預設 unsplashService;測試注入假的)
 */
export async function resolveStockPhoto(
  q: StockPhotoQuery,
  search: PhotoSearchFn = searchUnsplashPhotosDetailed,
  trigger: DownloadTriggerFn = triggerUnsplashDownload,
): Promise<ResolvedStockPhoto | null> {
  const query = buildStockPhotoQuery(q);
  if (!query) return null; // 無可用目的地訊號 → 不打 API
  try {
    const results = await search(query, 1);
    const first = results.find(
      (r) => typeof r?.url === "string" && r.url.trim().length > 0,
    );
    if (!first) return null;
    // 取用即觸發 download_location(Unsplash 條款)。fail-open:失敗不擋圖。
    if (first.downloadLocation) {
      await trigger(first.downloadLocation).catch(() => {});
    }
    return {
      url: first.url,
      credit: first.credit ?? null,
      downloadLocation: first.downloadLocation ?? null,
    };
  } catch (err) {
    // fail-open:任何錯誤都不擋上架,回 null = 無圖。
    log.warn(
      { query, err: err instanceof Error ? err.message : String(err) },
      "stock photo lookup failed (fail-open, tour ships imageless)",
    );
    return null;
  }
}
