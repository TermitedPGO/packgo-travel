/**
 * Itinerary Image Service
 * 為每日行程自動配置目的地相關圖片
 */

import { searchUnsplashPhotos } from "./unsplashService";
import { PolishedItinerary } from "../agents/itineraryPolishAgent";

/**
 * 為每日行程配置圖片
 * @param itineraries - 已美化的每日行程
 * @param destinationInfo - 目的地資訊
 * @returns 帶有圖片的每日行程
 */
export async function assignItineraryImages(
  itineraries: PolishedItinerary[],
  destinationInfo: { country?: string; city?: string }
): Promise<PolishedItinerary[]> {
  console.log(`[ItineraryImageService] Starting to assign images for ${itineraries.length} days`);
  
  if (itineraries.length === 0) {
    return itineraries;
  }
  
  try {
    // 收集所有需要搜尋的關鍵字
    const searchQueries: string[] = [];
    
    for (const day of itineraries) {
      // 優先使用活動地點作為搜尋關鍵字
      const locations = day.activities
        .map(a => a.location)
        .filter(l => l && l.length > 2);
      
      if (locations.length > 0) {
        // 使用第一個有效地點
        searchQueries.push(locations[0]);
      } else if (day.title) {
        // 從標題中提取關鍵字
        const titleKeyword = extractKeywordFromTitle(day.title);
        searchQueries.push(titleKeyword || destinationInfo.city || destinationInfo.country || "travel");
      } else {
        // 使用目的地作為備用
        searchQueries.push(destinationInfo.city || destinationInfo.country || "travel");
      }
    }
    
    console.log(`[ItineraryImageService] Search queries:`, searchQueries);
    
    // Round 71: pre-fetch a small pool of destination-fallback images so every day
    // gets an image even when the specific activity/location query returns 0 hits.
    // Without this, Italy 10-day tours were getting 8/10 coverage (two days blank).
    let fallbackPool: string[] = [];
    try {
      const fallbackKeyword = destinationInfo.country || destinationInfo.city || 'travel landscape';
      fallbackPool = await searchUnsplashPhotos(`${fallbackKeyword} travel`.trim(), 10);
    } catch (err) {
      console.warn(`[ItineraryImageService] Fallback pool fetch failed (non-fatal):`, err);
    }

    // 批次搜尋圖片（每個關鍵字搜尋 1 張）
    const imagePromises = searchQueries.map(async (query, index) => {
      try {
        // 添加目的地上下文以提高相關性
        const contextualQuery = `${query} ${destinationInfo.country || ''} travel`;
        const images = await searchUnsplashPhotos(contextualQuery.trim(), 1);
        return images[0] || null;
      } catch (error) {
        console.error(`[ItineraryImageService] Failed to search image for "${query}":`, error);
        return null;
      }
    });

    const images = await Promise.all(imagePromises);

    // 為每日行程配置圖片
    const result = itineraries.map((day, index) => {
      const image = images[index]
        // Round 71: fall back to destination-pool image when primary query found nothing.
        || (fallbackPool.length > 0 ? fallbackPool[index % fallbackPool.length] : null);
      const location = day.activities[0]?.location || day.title || `Day ${day.day}`;

      return {
        ...day,
        image: image || undefined,
        imageAlt: image ? `${location} - ${destinationInfo.country || '旅遊'}` : undefined,
      };
    });

    const assignedCount = result.filter(d => d.image).length;
    const fromFallback = result.filter((d, i) => d.image && !images[i]).length;
    console.log(`[ItineraryImageService] Successfully assigned ${assignedCount}/${itineraries.length} images (${fromFallback} from destination fallback)`);

    return result;
  } catch (error) {
    console.error("[ItineraryImageService] Error assigning images:", error);
    return itineraries;
  }
}

/**
 * 從標題中提取關鍵字
 */
function extractKeywordFromTitle(title: string): string | null {
  // 移除 "Day X：" 或 "第X天：" 前綴
  const cleaned = title
    .replace(/^Day\s*\d+[：:]\s*/i, '')
    .replace(/^第\d+天[：:]\s*/, '')
    .trim();
  
  // 如果清理後還有內容，返回第一個有意義的詞組
  if (cleaned.length > 2) {
    // 嘗試提取地名（通常在「抵達」、「前往」、「遊覽」後面）
    const locationMatch = cleaned.match(/(?:抵達|前往|遊覽|探索|參觀)\s*(.+?)(?:[，,、]|$)/);
    if (locationMatch) {
      return locationMatch[1].trim();
    }
    
    // 返回清理後的標題
    return cleaned.split(/[，,、]/)[0].trim();
  }
  
  return null;
}

/**
 * 為現有行程補充缺失的圖片
 */
export async function supplementItineraryImages(
  itineraries: PolishedItinerary[],
  destinationInfo: { country?: string; city?: string }
): Promise<PolishedItinerary[]> {
  // 找出缺少圖片的天數
  const missingImageDays = itineraries
    .map((day, index) => ({ day, index, hasImage: !!day.image }))
    .filter(item => !item.hasImage);
  
  if (missingImageDays.length === 0) {
    console.log("[ItineraryImageService] All days already have images");
    return itineraries;
  }
  
  console.log(`[ItineraryImageService] ${missingImageDays.length} days missing images`);
  
  // 只為缺少圖片的天數搜尋
  const updatedItineraries = [...itineraries];
  
  for (const { day, index } of missingImageDays) {
    const location = day.activities[0]?.location || day.title || destinationInfo.city;
    const query = `${location} ${destinationInfo.country || ''} travel`;
    
    try {
      const images = await searchUnsplashPhotos(query.trim(), 1);
      if (images[0]) {
        updatedItineraries[index] = {
          ...day,
          image: images[0],
          imageAlt: `${location} - ${destinationInfo.country || '旅遊'}`,
        };
      }
    } catch (error) {
      console.error(`[ItineraryImageService] Failed to supplement image for day ${day.day}:`, error);
    }
  }
  
  return updatedItineraries;
}
