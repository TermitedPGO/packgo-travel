/**
 * 智能標籤生成器
 * 根據行程資料自動生成正確的標籤
 */

import { TourType } from "../agents/itineraryTypes";

// 標籤類型定義
export interface GeneratedTag {
  label: string;
  category: "type" | "transportation" | "feature" | "price" | "duration";
}

/**
 * 根據行程資料生成智能標籤
 * @param tourData 行程資料
 * @param tourType 行程類型（從 ItineraryExtractAgent 識別）
 * @returns 標籤陣列
 */
export function generateSmartTags(
  tourData: {
    days?: number;
    nights?: number;
    price?: number;
    title?: string;
    description?: string;
    destinationCountry?: string;
    destinationCity?: string;
    highlights?: string[];
    outboundAirline?: string;
    transportation?: string;
    category?: string;
  },
  tourType: TourType = "GENERAL"
): string[] {
  const tags: string[] = [];
  const addedLabels = new Set<string>();

  const addTag = (label: string) => {
    if (!addedLabels.has(label)) {
      tags.push(label);
      addedLabels.add(label);
    }
  };

  const days = tourData.days || 0;
  const price = tourData.price || 0;
  const title = (tourData.title || "").toLowerCase();
  const description = (tourData.description || "").toLowerCase();
  const highlights = (tourData.highlights || []).join(" ").toLowerCase();
  const combinedText = `${title} ${description} ${highlights}`;

  // 1. 根據天數判斷行程類型
  if (days >= 10) {
    addTag("深度旅遊");
  } else if (days >= 7) {
    addTag("經典行程");
  } else if (days <= 4 && days > 0) {
    addTag("輕旅行");
  }

  // 2. 根據價格判斷行程等級
  if (price >= 80000) {
    addTag("精緻行程");
  } else if (price > 0 && price < 30000) {
    addTag("超值優惠");
  }

  // 3. 根據交通方式判斷（優先使用 tourType）
  switch (tourType) {
    case "MINGRI_TRAIN":
      addTag("鐵道");
      addTag("觀光列車");
      break;
    case "TRAIN":
      addTag("鐵道");
      break;
    case "CRUISE":
      addTag("郵輪");
      break;
    case "SELF_DRIVE":
      addTag("自駕");
      break;
    case "FLIGHT":
      addTag("航空");
      break;
    default:
      // 從文字內容判斷交通方式
      if (combinedText.includes("郵輪") || combinedText.includes("遊輪")) {
        addTag("郵輪");
      }
      if (
        combinedText.includes("航空") ||
        combinedText.includes("飛機") ||
        tourData.outboundAirline
      ) {
        addTag("航空");
      }
      if (
        combinedText.includes("高鐵") ||
        combinedText.includes("火車") ||
        combinedText.includes("列車") ||
        combinedText.includes("鐵道")
      ) {
        addTag("鐵道");
      }
      if (combinedText.includes("巴士") || combinedText.includes("遊覽車")) {
        addTag("巴士");
      }
  }

  // 4. 根據特色活動判斷
  if (
    combinedText.includes("美食") ||
    combinedText.includes("料理") ||
    combinedText.includes("餐廳") ||
    combinedText.includes("米其林")
  ) {
    addTag("美食之旅");
  }

  if (
    combinedText.includes("攝影") ||
    combinedText.includes("拍照") ||
    combinedText.includes("打卡")
  ) {
    addTag("攝影之旅");
  }

  if (
    combinedText.includes("溫泉") ||
    combinedText.includes("泡湯") ||
    combinedText.includes("spa")
  ) {
    addTag("溫泉");
  }

  if (combinedText.includes("健行") || combinedText.includes("登山")) {
    addTag("健行");
  }

  if (combinedText.includes("冰河") || combinedText.includes("冰川")) {
    addTag("冰河探險");
  }

  if (
    combinedText.includes("永續") ||
    combinedText.includes("esg") ||
    combinedText.includes("環保")
  ) {
    addTag("永續旅遊");
  }

  if (combinedText.includes("文化") || combinedText.includes("遺產")) {
    addTag("文化之旅");
  }

  // 5. 根據行程類型判斷
  const category = (tourData.category || "").toLowerCase();
  if (category === "group" || combinedText.includes("團體")) {
    addTag("團體旅遊");
  }

  // 6. 根據目的地判斷特殊標籤
  const destination = (
    (tourData.destinationCountry || "") +
    " " +
    (tourData.destinationCity || "")
  ).toLowerCase();

  if (
    destination.includes("紐西蘭") ||
    destination.includes("new zealand") ||
    destination.includes("澳洲") ||
    destination.includes("australia")
  ) {
    if (combinedText.includes("冰河") || combinedText.includes("峽灣")) {
      addTag("自然奇觀");
    }
  }

  if (
    destination.includes("日本") ||
    destination.includes("japan") ||
    destination.includes("京都") ||
    destination.includes("東京")
  ) {
    if (combinedText.includes("櫻花") || combinedText.includes("賞櫻")) {
      addTag("賞櫻");
    }
    if (combinedText.includes("楓葉") || combinedText.includes("賞楓")) {
      addTag("賞楓");
    }
  }

  if (
    destination.includes("歐洲") ||
    destination.includes("巴爾幹") ||
    destination.includes("奧地利") ||
    destination.includes("捷克")
  ) {
    addTag("歐洲");
  }

  // 限制最多 6 個標籤
  return tags.slice(0, 6);
}

/**
 * 合併現有標籤和生成的標籤
 */
export function mergeWithExistingTags(
  existingTags: string[] | string | null | undefined,
  generatedTags: string[]
): string[] {
  let existing: string[] = [];

  if (existingTags) {
    if (typeof existingTags === "string") {
      try {
        existing = JSON.parse(existingTags);
      } catch {
        existing = [];
      }
    } else if (Array.isArray(existingTags)) {
      existing = existingTags;
    }
  }

  // 合併並去重
  const merged = new Set([...existing, ...generatedTags]);
  return Array.from(merged).slice(0, 8); // 最多 8 個標籤
}
