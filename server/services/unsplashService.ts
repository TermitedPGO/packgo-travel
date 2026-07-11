import { ENV } from "../_core/env";

/**
 * Unsplash API Service
 * 用於從 Unsplash 搜尋和下載旅遊相關圖片
 *
 * NOTE: Unsplash returns 410 Gone for queries containing Chinese characters.
 * We sanitize queries to English before sending.
 */

interface UnsplashPhoto {
  id: string;
  urls: {
    raw: string;
    full: string;
    regular: string;
    small: string;
    thumb: string;
  };
  alt_description: string | null;
  description: string | null;
  user: {
    name: string;
    username: string;
    links?: {
      html?: string;
    };
  };
  links?: {
    download_location?: string;
  };
}

/**
 * One search hit with the attribution data the Unsplash API Terms require us
 * to keep alongside the image (photographer name + profile link) and the
 * download_location endpoint we must hit when the photo is actually used.
 */
export interface UnsplashPhotoResult {
  url: string;
  credit: {
    name: string;
    username: string;
    profileUrl: string;
  } | null;
  downloadLocation: string | null;
}

interface UnsplashSearchResponse {
  total: number;
  total_pages: number;
  results: UnsplashPhoto[];
}

// ── Chinese → English keyword map ────────────────────────────────────────────
// Common travel destinations and terms that appear in itinerary queries.
// Entries are matched as substrings (longest match wins).
const CJK_TO_EN: [string, string][] = [
  // Japan regions / cities
  ["四國", "Shikoku Japan"],
  ["北海道", "Hokkaido Japan"],
  ["沖繩", "Okinawa Japan"],
  ["京都", "Kyoto Japan"],
  ["大阪", "Osaka Japan"],
  ["東京", "Tokyo Japan"],
  ["奈良", "Nara Japan"],
  ["箱根", "Hakone Japan"],
  ["富士山", "Mount Fuji Japan"],
  ["鎌倉", "Kamakura Japan"],
  ["廣島", "Hiroshima Japan"],
  ["福岡", "Fukuoka Japan"],
  ["長崎", "Nagasaki Japan"],
  ["金澤", "Kanazawa Japan"],
  ["松山", "Matsuyama Japan"],
  ["高松", "Takamatsu Japan"],
  ["德島", "Tokushima Japan"],
  ["高知", "Kochi Japan"],
  ["祖谷", "Iya Valley Japan"],
  ["大步危", "Oboke Gorge Japan"],
  ["別府", "Beppu Japan"],
  ["由布院", "Yufuin Japan"],
  ["日光", "Nikko Japan"],
  ["仙台", "Sendai Japan"],
  ["札幌", "Sapporo Japan"],
  ["關西空港", "Kansai Airport Japan"],
  ["成田", "Narita Japan"],
  ["羽田", "Haneda Japan"],
  ["新幹線", "Shinkansen Japan"],
  ["大塚國際美術館", "Otsuka Art Museum Japan"],
  ["道後溫泉", "Dogo Onsen Japan"],
  ["伊予灘", "Iyo Nada Japan"],
  ["吉野川", "Yoshino River Japan"],
  ["多度津", "Tadotsu Japan"],
  ["中土佐", "Nakatosa Japan"],
  ["阿波池田", "Awa Ikeda Japan"],
  // Korea
  ["首爾", "Seoul Korea"],
  ["清州", "Cheongju Korea"],
  ["釜山", "Busan Korea"],
  ["濟州", "Jeju Korea"],
  // Europe
  ["巴黎", "Paris France"],
  ["法國", "France countryside"],
  ["倫敦", "London UK"],
  ["英國", "England UK"],
  ["羅馬", "Rome Italy"],
  ["米蘭", "Milan Italy"],
  ["佛羅倫斯", "Florence Italy"],
  ["威尼斯", "Venice Italy"],
  ["義大利", "Italy landscape"],
  ["阿姆斯特丹", "Amsterdam Netherlands"],
  ["布拉格", "Prague Czech Republic"],
  ["捷克", "Czech Republic Prague"],
  ["維也納", "Vienna Austria"],
  ["奧地利", "Austria Alps"],
  ["蘇黎世", "Zurich Switzerland"],
  ["伯恩", "Bern Switzerland"],
  ["盧森", "Lucerne Switzerland"],
  ["瑞士", "Switzerland Alps"],
  ["柏林", "Berlin Germany"],
  ["慕尼黑", "Munich Germany"],
  ["德國", "Germany landscape"],
  ["德瑞", "Germany Switzerland Alps"],
  ["奧捷", "Austria Czech Republic Europe"],
  ["雷克雅維克", "Reykjavik Iceland"],
  ["冰島", "Iceland landscape northern lights"],
  ["北歐", "Northern Europe Scandinavia"],
  ["東歐", "Eastern Europe"],
  ["南歐", "Southern Europe Mediterranean"],
  ["西歐", "Western Europe"],
  ["希臘", "Greece Athens Santorini"],
  ["土耳其", "Istanbul Turkey"],
  ["巴爾干", "Balkan Peninsula"],
  // Cambodia / Indochina
  ["呀哥窟", "Angkor Wat Cambodia"],
  ["柬埔寨", "Cambodia Phnom Penh"],
  ["暹粒", "Siem Reap Cambodia"],
  ["越南", "Vietnam landscape"],
  ["下龍灣", "Ha Long Bay Vietnam"],
  ["陸龍灣", "Ninh Binh Vietnam"],
  // Southeast Asia
  ["曼谷", "Bangkok Thailand"],
  ["清邁", "Chiang Mai Thailand"],
  ["普吉", "Phuket Thailand"],
  ["峇里", "Bali Indonesia"],
  ["新加坡", "Singapore"],
  ["吉隆坡", "Kuala Lumpur Malaysia"],
  ["胡志明", "Ho Chi Minh City Vietnam"],
  ["河內", "Hanoi Vietnam"],
  ["峴港", "Da Nang Vietnam"],
  // Taiwan
  ["台北", "Taipei Taiwan"],
  ["台中", "Taichung Taiwan"],
  ["台南", "Tainan Taiwan"],
  ["高雄", "Kaohsiung Taiwan"],
  ["花蓮", "Hualien Taiwan"],
  ["墾丁", "Kenting Taiwan"],
  ["阿里山", "Alishan Taiwan"],
  ["日月潭", "Sun Moon Lake Taiwan"],
  ["桃園機場", "Taoyuan Airport Taiwan"],
  // Generic travel terms
  ["溫泉", "hot spring onsen"],
  ["海灘", "beach"],
  ["山", "mountain"],
  ["城堡", "castle"],
  ["博物館", "museum"],
  ["公園", "park"],
  ["市場", "market"],
  ["神社", "shrine"],
  ["寺廟", "temple"],
  ["瀑布", "waterfall"],
  ["湖", "lake"],
  ["島", "island"],
  ["鐵道", "railway train"],
  ["火車", "train"],
  ["郵輪", "cruise ship"],
  ["遊輪", "cruise ship"],
  ["航程", "cruise voyage"],
];

/**
 * Detect if a string contains CJK (Chinese/Japanese/Korean) characters.
 */
function hasCJK(str: string): boolean {
  return /[\u3000-\u9fff\uf900-\ufaff]/.test(str);
}

/**
 * Convert a query that may contain Chinese characters to an English-safe query.
 * Uses a keyword map for common destinations; strips remaining CJK characters.
 */
function sanitizeQueryForUnsplash(query: string): string {
  if (!hasCJK(query)) return query;

  let result = query;

  // Apply longest-match substitutions
  for (const [zh, en] of CJK_TO_EN) {
    if (result.includes(zh)) {
      result = result.replace(new RegExp(zh, "g"), en);
    }
  }

  // Strip any remaining CJK characters (keep ASCII, spaces, punctuation)
  result = result.replace(/[\u3000-\u9fff\uf900-\ufaff\u3400-\u4dbf]/g, " ");

  // Collapse multiple spaces
  result = result.replace(/\s+/g, " ").trim();

  // Fallback: if nothing useful remains, use "travel destination"
  if (result.replace(/\s/g, "").length < 3) {
    result = "travel destination";
  }

  return result;
}

/**
 * Search photos from Unsplash — detailed variant. Returns url + photographer
 * credit + download_location per hit so callers can satisfy the Unsplash API
 * attribution + download-tracking requirements. Fail-open: any error → [].
 */
export async function searchUnsplashPhotosDetailed(
  query: string,
  count: number = 6
): Promise<UnsplashPhotoResult[]> {
  try {
    const accessKey = ENV.unsplashAccessKey;

    if (!accessKey) {
      console.error("[UnsplashService] Access key not configured");
      return [];
    }

    // Sanitize query: Unsplash returns 410 Gone for CJK characters
    const safeQuery = sanitizeQueryForUnsplash(query);

    // Build search query
    const searchQuery = `${safeQuery} travel landscape`;
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(searchQuery)}&per_page=${count}&orientation=landscape`;

    if (hasCJK(query)) {
      console.log(`[UnsplashService] CJK query sanitized: "${query.substring(0, 30)}" → "${safeQuery}"`);
    }
    console.log(`[UnsplashService] Searching photos: "${searchQuery.substring(0, 80)}"`);

    const response = await fetch(url, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
      },
    });

    if (!response.ok) {
      console.error(`[UnsplashService] API error: ${response.status} ${response.statusText} (query: "${safeQuery.substring(0, 40)}")`);
      return [];
    }

    const data: UnsplashSearchResponse = await response.json();

    if (!data.results || data.results.length === 0) {
      console.warn(`[UnsplashService] No photos found for query: "${searchQuery.substring(0, 60)}"`);
      return [];
    }

    const results: UnsplashPhotoResult[] = data.results.map((photo) => ({
      url: photo.urls.regular,
      credit:
        photo.user?.name && photo.user?.username
          ? {
              name: photo.user.name,
              username: photo.user.username,
              profileUrl:
                photo.user.links?.html ||
                `https://unsplash.com/@${photo.user.username}`,
            }
          : null,
      downloadLocation: photo.links?.download_location ?? null,
    }));

    console.log(`[UnsplashService] Found ${results.length} photos`);

    return results;
  } catch (error) {
    console.error("[UnsplashService] Error searching photos:", error);
    return [];
  }
}

/**
 * Search photos from Unsplash (URL-only, legacy shape). Existing callers that
 * only place images in internal/LLM contexts keep this; anything that shows a
 * photo on a public page should use `searchUnsplashPhotosDetailed` + credit.
 */
export async function searchUnsplashPhotos(
  query: string,
  count: number = 6
): Promise<string[]> {
  return (await searchUnsplashPhotosDetailed(query, count)).map((p) => p.url);
}

/**
 * Hit a photo's `download_location` endpoint once when the photo is actually
 * used (Unsplash API guideline — this is how photographers get view credit).
 * Fail-open by design: any failure is logged and swallowed, never blocks the
 * image from shipping.
 */
export async function triggerUnsplashDownload(
  downloadLocation: string | null | undefined
): Promise<void> {
  try {
    const accessKey = ENV.unsplashAccessKey;
    if (!accessKey || !downloadLocation) return;
    const response = await fetch(downloadLocation, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
      },
    });
    if (!response.ok) {
      console.warn(
        `[UnsplashService] download_location ping failed: ${response.status} (non-blocking)`
      );
    }
  } catch (error) {
    console.warn("[UnsplashService] download_location ping error (non-blocking):", error);
  }
}

/**
 * Supplement images if count is less than minimum
 */
export async function supplementImages(
  existingImages: string[],
  destination: string,
  minCount: number = 6
): Promise<string[]> {
  const currentCount = existingImages.length;
  
  if (currentCount >= minCount) {
    console.log(`[UnsplashService] Sufficient images (${currentCount}/${minCount}), no supplement needed`);
    return existingImages;
  }
  
  const neededCount = minCount - currentCount;
  console.log(`[UnsplashService] Need ${neededCount} more images (current: ${currentCount}, target: ${minCount})`);
  
  const newImages = await searchUnsplashPhotos(destination, neededCount);
  
  if (newImages.length === 0) {
    console.warn("[UnsplashService] Failed to fetch supplementary images");
    return existingImages;
  }
  
  const supplementedImages = [...existingImages, ...newImages];
  console.log(`[UnsplashService] Supplemented images: ${currentCount} + ${newImages.length} = ${supplementedImages.length}`);
  
  return supplementedImages;
}
