/**
 * catalogRebuild/completeness — 上架門檻(直接解「不夠完整」)。
 *
 * 重抓後,只有資料齊全的團才換上 live;半空的團留著不上、列清單回報。
 * 純函式:吃一個 tour 候選的關鍵欄 + 未來班期數,回傳「能不能上 + 缺什麼」。
 * 無 DB、無 fetch,易測。
 *
 * 硬門檻(缺任一 → 不上架,進 missing):
 *   - title / destinationCountry 有值
 *   - days > 0
 *   - 直客價 priceRetail > 0(永遠 retail;成本價不碰,見 [[guard]])
 *   - ≥ 1 個未來班期(撐「最近班期 + 有沒有位」)
 *   - 每日行程齊(itineraryDetailed 解析成非空陣列)
 *   - 有景點(attractions 解析成非空陣列)
 *
 * 軟旗標(不擋上架,只回報 — Jeff 拍板:缺圖不擋,圖之後重做高清版):
 *   - 沒有任何圖(hero / main / gallery 皆空)
 *   - 每日行程天數 < days(部分天數缺)
 *   - 景點數 < 3(偏少)
 */

export interface TourCompletenessInput {
  title?: string | null;
  destinationCountry?: string | null;
  /** tours.duration(天數)。 */
  days?: number | null;
  /** tours.price — 已是 MIN(retailPrice) 直客價。 */
  priceRetail?: number | null;
  /** tours.itineraryDetailed — JSON array string。 */
  itineraryDetailedJson?: string | null;
  /** tours.attractions — JSON array string。 */
  attractionsJson?: string | null;
  /** supplierDepartures 中 departureDate >= today 的筆數。 */
  futureDepartureCount?: number | null;
  heroImage?: string | null;
  imageUrl?: string | null;
  galleryImagesJson?: string | null;
}

export interface CompletenessResult {
  /** true = 通過硬門檻,可換上 live。 */
  ok: boolean;
  /** 硬門檻缺項(擋上架)。 */
  missing: string[];
  /** 軟旗標(不擋,回報用)。 */
  softFlags: string[];
}

/** 解析 JSON array,壞掉或非陣列 → []。 */
function parseArray(json: string | null | undefined): unknown[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function hasText(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

/** 至少一張圖(hero / main / gallery 任一)。 */
function hasAnyImage(input: TourCompletenessInput): boolean {
  if (hasText(input.heroImage) || hasText(input.imageUrl)) return true;
  return parseArray(input.galleryImagesJson).length > 0;
}

export function assessTourCompleteness(
  input: TourCompletenessInput,
): CompletenessResult {
  const missing: string[] = [];
  const softFlags: string[] = [];

  if (!hasText(input.title)) missing.push("title");
  if (!hasText(input.destinationCountry)) missing.push("destinationCountry");

  const days = input.days ?? 0;
  if (!(days > 0)) missing.push("days");

  const price = input.priceRetail ?? 0;
  if (!(price > 0)) missing.push("retailPrice");

  const futureDeps = input.futureDepartureCount ?? 0;
  if (!(futureDeps >= 1)) missing.push("futureDeparture");

  const itinDays = parseArray(input.itineraryDetailedJson);
  if (itinDays.length < 1) missing.push("dailyItinerary");

  const attractions = parseArray(input.attractionsJson);
  if (attractions.length < 1) missing.push("attractions");

  // ── soft flags (不擋) ──
  if (!hasAnyImage(input)) softFlags.push("noImage");
  if (days > 0 && itinDays.length > 0 && itinDays.length < days) {
    softFlags.push("partialItinerary");
  }
  if (attractions.length > 0 && attractions.length < 3) {
    softFlags.push("fewAttractions");
  }

  return { ok: missing.length === 0, missing, softFlags };
}
