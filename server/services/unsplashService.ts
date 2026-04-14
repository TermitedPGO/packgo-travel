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
  };
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
  ["釜山", "Busan Korea"],
  ["濟州", "Jeju Korea"],
  // Europe
  ["巴黎", "Paris France"],
  ["倫敦", "London UK"],
  ["羅馬", "Rome Italy"],
  ["威尼斯", "Venice Italy"],
  ["阿姆斯特丹", "Amsterdam Netherlands"],
  ["布拉格", "Prague Czech Republic"],
  ["維也納", "Vienna Austria"],
  ["蘇黎世", "Zurich Switzerland"],
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
 * Search photos from Unsplash
 */
export async function searchUnsplashPhotos(
  query: string,
  count: number = 6
): Promise<string[]> {
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
    
    // Extract regular-sized image URLs
    const imageUrls = data.results.map(photo => photo.urls.regular);
    
    console.log(`[UnsplashService] Found ${imageUrls.length} photos`);
    
    return imageUrls;
  } catch (error) {
    console.error("[UnsplashService] Error searching photos:", error);
    return [];
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
