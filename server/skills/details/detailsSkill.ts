/**
 * DetailsSkill
 * 整合 MealAgent、HotelAgent、CostAgent、NoticeAgent 的功能
 * 
 * Agent Skills Architecture:
 * - 使用 Progressive Disclosure 載入 SKILL.md
 * - 使用 Claude 3 Haiku 進行快速提取
 * - 支援並行處理多個子技能
 */

import { getHaikuAgent, JSONSchema, STRICT_DATA_FIDELITY_RULES } from "../../agents/claudeAgent";
import { 
  loadSkillMetadata, 
  loadSkill, 
  loadSkillSections,
  SkillMetadata 
} from "../skillLoader";

// ============ Type Definitions ============

export interface MealData {
  name: string;
  type: string; // breakfast, lunch, dinner
  description: string;
  cuisine: string;
  restaurant?: string;
  image?: string;       // ⬅️ Fix 1: added
  imageAlt?: string;    // ⬅️ Fix 1: added
}

export interface HotelData {
  name: string;
  stars: string;
  description: string;
  facilities: string[];
  location: string;
  image?: string;       // ⬅️ Fix 1: added
  imageAlt?: string;    // ⬅️ Fix 1: added
}

export interface CostData {
  included: string[];
  excluded: string[];
  additionalCosts: string[];
  notes: string;
}

export interface NoticeData {
  preparation: string[];
  culturalNotes: string[];
  healthSafety: string[];
  emergency: string[];
}

export interface DetailsSkillResult {
  success: boolean;
  data?: {
    meals?: MealData[];
    hotels?: HotelData[];
    costs?: CostData;
    notices?: NoticeData;
  };
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ============ JSON Schemas ============

const MEAL_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    meals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "餐點名稱" },
          type: { type: "string", description: "餐點類型（breakfast/lunch/dinner）" },
          description: { type: "string", description: "餐點描述（100-150字）" },
          cuisine: { type: "string", description: "料理類型" },
          restaurant: { type: "string", description: "餐廳名稱" },
          image: { type: "string", description: "餐點或餐廳圖片 URL" },
          imageAlt: { type: "string", description: "圖片替代文字" },
        },
        required: ["name", "type", "description", "cuisine"],
      },
    },
  },
  required: ["meals"],
};

const HOTEL_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    hotels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "飯店名稱" },
          stars: { type: "string", description: "星級（例如：五星級）" },
          // Round 80.20: ask LLM for brand explicitly. Most chain hotels
          // are caught by the regex extractor in masterAgent, but boutique
          // / local hotels (涵碧樓 / 雲品 / 鳳凰閣) are best identified by
          // the LLM that just read the description. Empty string means
          // "no chain affiliation, independent hotel".
          brand: {
            type: "string",
            description: "飯店所屬品牌（例如：Marriott、Hyatt、文華東方、Mercure；獨立飯店請留空字串）",
          },
          description: { type: "string", description: "飯店描述（150-200字）" },
          facilities: {
            type: "array",
            items: { type: "string" },
            description: "飯店設施列表",
          },
          location: { type: "string", description: "地理位置描述" },
          image: { type: "string", description: "飯店圖片 URL" },
          imageAlt: { type: "string", description: "圖片替代文字" },
        },
        required: ["name", "stars", "description", "facilities", "location"],
      },
    },
  },
  required: ["hotels"],
};

const COST_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    included: {
      type: "array",
      description: "團費包含項目",
      items: { type: "string", maxLength: 50 },
    },
    excluded: {
      type: "array",
      description: "團費不包含項目",
      items: { type: "string", maxLength: 50 },
    },
    additionalCosts: {
      type: "array",
      description: "額外費用提醒",
      items: { type: "string", maxLength: 60 },
    },
    notes: {
      type: "string",
      description: "費用說明備註",
      maxLength: 200,
    },
  },
  required: ["included", "excluded", "additionalCosts", "notes"],
};

const NOTICE_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    preparation: {
      type: "array",
      description: "行前準備提醒",
      items: { type: "string", maxLength: 50 },
    },
    culturalNotes: {
      type: "array",
      description: "當地文化禁忌",
      items: { type: "string", maxLength: 50 },
    },
    healthSafety: {
      type: "array",
      description: "健康安全注意",
      items: { type: "string", maxLength: 50 },
    },
    emergency: {
      type: "array",
      description: "緊急應對措施",
      items: { type: "string", maxLength: 50 },
    },
  },
  required: ["preparation", "culturalNotes", "healthSafety", "emergency"],
};

// ============ Combined Schema (P1 Optimization) ============

/**
 * 合併 Schema：將 4 個子技能的輸出合併為單一 JSON Schema
 * 優化效益：4 次 LLM 呼叫 → 1 次，節省 ~63% input tokens
 */
const COMBINED_DETAILS_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    meals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "餐點名稱" },
          type: { type: "string", description: "餐點類型（breakfast/lunch/dinner）" },
          description: { type: "string", description: "餐點描述（80-120字）" },
          cuisine: { type: "string", description: "料理類型" },
          restaurant: { type: "string", description: "餐廳名稱" },
          image: { type: "string", description: "餐點或餐廳圖片 URL" },
          imageAlt: { type: "string", description: "圖片替代文字" },
        },
        required: ["name", "type", "description", "cuisine"],
      },
      description: "餐飲資訊列表",
    },
    hotels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "飯店名稱" },
          stars: { type: "string", description: "星級（例如：五星級）" },
          description: { type: "string", description: "飯店描述（120-180字）" },
          facilities: {
            type: "array",
            items: { type: "string" },
            description: "飯店設施列表",
          },
          location: { type: "string", description: "地理位置描述" },
          image: { type: "string", description: "飯店圖片 URL" },
          imageAlt: { type: "string", description: "圖片替代文字" },
        },
        required: ["name", "stars", "description", "facilities", "location"],
      },
      description: "住宿資訊列表",
    },
    costs: {
      type: "object",
      properties: {
        included: {
          type: "array",
          items: { type: "string" },
          description: "團費包含項目（5-7項）",
        },
        excluded: {
          type: "array",
          items: { type: "string" },
          description: "團費不包含項目（5-6項）",
        },
        additionalCosts: {
          type: "array",
          items: { type: "string" },
          description: "額外費用提醒（3-4項）",
        },
        notes: { type: "string", description: "費用說明備註" },
      },
      required: ["included", "excluded", "additionalCosts", "notes"],
      description: "費用說明",
    },
    notices: {
      type: "object",
      properties: {
        preparation: {
          type: "array",
          items: { type: "string" },
          description: "行前準備提醒（3-4條）",
        },
        culturalNotes: {
          type: "array",
          items: { type: "string" },
          description: "當地文化禁忌（3-4條）",
        },
        healthSafety: {
          type: "array",
          items: { type: "string" },
          description: "健康安全注意（3-4條）",
        },
        emergency: {
          type: "array",
          items: { type: "string" },
          description: "緊急應對措施（3-4條）",
        },
      },
      required: ["preparation", "culturalNotes", "healthSafety", "emergency"],
      description: "旅遊注意事項",
    },
  },
  required: ["meals", "hotels", "costs", "notices"],
};

// ============ DetailsSkill Class ============

/**
 * DetailsSkill - 整合細節提取功能的 Skill 類別
 * 
 * 支援的子技能：
 * - meals: 餐飲資訊提取
 * - hotels: 住宿資訊提取
 * - costs: 費用說明生成
 * - notices: 注意事項生成
 * 
 * P1 優化：新增 executeAllCombined() 方法，將 4 次 LLM 呼叫合併為 1 次
 */
export class DetailsSkill {
  private skillContent: string = "";
  private initialized: boolean = false;

  constructor() {
    // 使用函數式 API，不需要實例化 SkillLoader
  }

  /**
   * 初始化 Skill，載入 SKILL.md
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // 使用 Progressive Disclosure - 先載入 metadata
      const metadata = loadSkillMetadata("details");
      if (metadata) {
        console.log(`[DetailsSkill] Loaded metadata: ${metadata.name} v${metadata.version}`);
      }

      // 載入完整 SKILL 內容
      const skill = loadSkill("details");
      this.skillContent = skill?.content || this.getFallbackSkillContent();
      
      this.initialized = true;
      console.log(`[DetailsSkill] Initialized with ${this.skillContent.length} chars`);
    } catch (error) {
      console.error("[DetailsSkill] Failed to initialize:", error);
      // 使用內建的 fallback 內容
      this.skillContent = this.getFallbackSkillContent();
      this.initialized = true;
    }
  }

  /**
   * P1 優化：單一 LLM 呼叫生成所有細節
   * 將 4 次 LLM 呼叫合併為 1 次，節省 ~63% input tokens
   * 內建自動降級機制：失敗時回退到原始 4 次並行呼叫
   */
  async executeAllCombined(rawData: any): Promise<DetailsSkillResult> {
    await this.initialize();
    console.log("[DetailsSkill] Executing COMBINED single-call mode...");
    const startTime = Date.now();

    // 準備精簡的輸入資料
    let mealData = rawData?.meals || rawData?.dining || [];
    const dailyItinerary = rawData?.dailyItinerary || rawData?.itinerary || [];
    
    // 從每日行程提取餐食資訊（支援 string 和 array 格式）
    if ((!mealData || mealData.length === 0) && dailyItinerary.length > 0) {
      const extractedMeals: any[] = [];
      for (const day of dailyItinerary) {
        if (day.meals) {
          if (typeof day.meals === 'string' && day.meals.trim()) {
            // Format: "早餐、午餐"
            extractedMeals.push({ day: day.day || 0, description: day.meals.trim() });
          } else if (Array.isArray(day.meals) && day.meals.length > 0) {
            // Format: ["早餐", "午餐"] or [{name: "早餐", ...}]
            const mealStr = day.meals.map((m: any) => typeof m === 'string' ? m : (m.name || m.type || JSON.stringify(m))).join('、');
            if (mealStr.trim()) extractedMeals.push({ day: day.day || 0, description: mealStr });
          }
        }
      }
      if (extractedMeals.length > 0) mealData = extractedMeals;
    }

    let accommodationData = rawData?.accommodation || rawData?.hotels || [];
    if ((!accommodationData || accommodationData.length === 0) && dailyItinerary.length > 0) {
      const hotelNames = new Set<string>();
      for (const day of dailyItinerary) {
        if (day.accommodation && typeof day.accommodation === 'string' && day.accommodation.trim()) {
          hotelNames.add(day.accommodation.trim());
        }
      }
      if (hotelNames.size > 0) {
        accommodationData = Array.from(hotelNames).map(name => ({ name, stars: '', description: '', location: '' }));
      }
    }

    const destination = rawData?.location?.destinationCountry || "";
    const city = rawData?.location?.destinationCity || "";
    const days = rawData?.duration?.days || 0;
    const pricing = rawData?.pricing || rawData?.pricingDetails || {};

    // Fix 2 (Round 63): collect available image URLs from lionFeatureImages for hotel/meal image assignment
    const lionFIImages: any[] = (rawData as any)?.lionFeatureImages || [];
    const availableImageUrls = lionFIImages
      .filter((img: any) => img?.url && img.url.startsWith('http'))
      .slice(0, 20)
      .map((img: any, i: number) => `${i + 1}. ${img.url}${img.alt ? ' (' + img.alt + ')' : ''}`);
    const imageSection = availableImageUrls.length > 0
      ? `\n## 可用圖片 URL 列表（共 ${availableImageUrls.length} 張）\n${availableImageUrls.join('\n')}\n\n【重要】請從上方圖片列表中，為每個飯店和餐廳選擇最合適的圖片 URL 填入 image 欄位，imageAlt 填入對應描述。找不到合適圖片就留空字串。`
      : '';

    const prompt = `請根據以下旅遊行程資料，一次性生成四個部分的結構化資訊。

## 行程基本資訊
- 目的地：${city}, ${destination}
- 天數：${days} 天
- 價格：${pricing.price || "未提供"}

## 餐飲資料
${JSON.stringify(mealData.length > 0 ? mealData.slice(0, 10) : dailyItinerary.slice(0, 5), null, 2).substring(0, 2000)}

## 住宿資料
${JSON.stringify(accommodationData, null, 2).substring(0, 2000)}

## 費用資料
${JSON.stringify(pricing, null, 2).substring(0, 1000)}

## 行程概要
${JSON.stringify(dailyItinerary.slice(0, 8).map((d: any) => ({ day: d.day, title: d.title, accommodation: d.accommodation, meals: d.meals })), null, 2).substring(0, 1500)}${imageSection}

請生成：
1. meals: 餐飲介紹（根據每日行程提取，包含 name/type/description/cuisine/restaurant，若有可用圖片請填入 image/imageAlt）
2. hotels: 住宿介紹（根據住宿資料提取，包含 name/stars/description/facilities/location，若有可用圖片請填入 image/imageAlt）
3. costs: 費用說明（包含 included/excluded/additionalCosts/notes）
4. notices: 注意事項（包含 preparation/culturalNotes/healthSafety/emergency，每類 3-4 條）`;

    try {
      const claudeAgent = getHaikuAgent();
      claudeAgent.setContext('DetailsSkill', 'tour_generation');
      const response = await claudeAgent.sendStructuredMessage<{
        meals: MealData[];
        hotels: HotelData[];
        costs: CostData;
        notices: NoticeData;
      }>(prompt, COMBINED_DETAILS_SCHEMA, {
        systemPrompt: `${this.skillContent}\n\n${STRICT_DATA_FIDELITY_RULES}`,
        maxTokens: 4096,
        temperature: 0.5,
        schemaName: "combined_details_output",
        schemaDescription: "旅遊行程細節一次性結構化輸出（餐飲、住宿、費用、注意事項）",
      });

      const elapsed = Date.now() - startTime;

      if (!response.success || !response.data) {
        console.warn(`[DetailsSkill] Combined call failed (${elapsed}ms), falling back to parallel mode`);
        return this.executeAll(rawData);
      }

      console.log(`[DetailsSkill] ✅ Combined call completed in ${elapsed}ms`);
      console.log(`[DetailsSkill] Token usage - Input: ${response.usage?.inputTokens}, Output: ${response.usage?.outputTokens}`);
      console.log(`[DetailsSkill] Results - meals: ${response.data.meals?.length || 0}, hotels: ${response.data.hotels?.length || 0}`);

      return {
        success: true,
        data: {
          meals: response.data.meals || this.getDefaultMeals(rawData),
          hotels: response.data.hotels || this.getDefaultHotels(rawData),
          costs: response.data.costs || this.getDefaultCosts(days, destination, city),
          notices: response.data.notices || this.getDefaultNotices(destination || "目的地"),
        },
        usage: response.usage,
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[DetailsSkill] Combined call error after ${elapsed}ms:`, error);
      // 自動降級為原始並行模式
      console.log("[DetailsSkill] ⚠ Falling back to parallel mode...");
      return this.executeAll(rawData);
    }
  }

  /**
   * 執行所有子技能（原始並行模式，作為 executeAllCombined 的降級備援）
   */
  async executeAll(rawData: any): Promise<DetailsSkillResult> {
    await this.initialize();

    console.log("[DetailsSkill] Executing all sub-skills in parallel (fallback mode)...");

    const [mealsResult, hotelsResult, costsResult, noticesResult] = await Promise.all([
      this.extractMeals(rawData),
      this.extractHotels(rawData),
      this.generateCosts(rawData),
      this.generateNotices(rawData),
    ]);

    // 合併 token 使用量
    const totalUsage = {
      inputTokens: 
        (mealsResult.usage?.inputTokens || 0) +
        (hotelsResult.usage?.inputTokens || 0) +
        (costsResult.usage?.inputTokens || 0) +
        (noticesResult.usage?.inputTokens || 0),
      outputTokens:
        (mealsResult.usage?.outputTokens || 0) +
        (hotelsResult.usage?.outputTokens || 0) +
        (costsResult.usage?.outputTokens || 0) +
        (noticesResult.usage?.outputTokens || 0),
    };

    console.log(`[DetailsSkill] All sub-skills completed (fallback). Total tokens: ${totalUsage.inputTokens + totalUsage.outputTokens}`);

    return {
      success: true,
      data: {
        meals: mealsResult.data,
        hotels: hotelsResult.data,
        costs: costsResult.data,
        notices: noticesResult.data,
      },
      usage: totalUsage,
    };
  }

  /**
   * 執行單一子技能
   */
  async execute(
    subSkill: "meals" | "hotels" | "costs" | "notices",
    rawData: any
  ): Promise<DetailsSkillResult> {
    await this.initialize();

    switch (subSkill) {
      case "meals":
        const mealsResult = await this.extractMeals(rawData);
        return { success: true, data: { meals: mealsResult.data }, usage: mealsResult.usage };
      case "hotels":
        const hotelsResult = await this.extractHotels(rawData);
        return { success: true, data: { hotels: hotelsResult.data }, usage: hotelsResult.usage };
      case "costs":
        const costsResult = await this.generateCosts(rawData);
        return { success: true, data: { costs: costsResult.data }, usage: costsResult.usage };
      case "notices":
        const noticesResult = await this.generateNotices(rawData);
        return { success: true, data: { notices: noticesResult.data }, usage: noticesResult.usage };
      default:
        return { success: false, error: `Unknown sub-skill: ${subSkill}` };
    }
  }

  // ============ Sub-Skill: Meals ============

  private async extractMeals(rawData: any): Promise<{
    data?: MealData[];
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    console.log("[DetailsSkill:meals] Starting meal extraction...");

    let mealData = rawData?.meals || rawData?.dining || [];
    const dailyItinerary = rawData?.dailyItinerary || rawData?.itinerary || [];
    
    console.log(`[DetailsSkill:meals] mealData length: ${mealData.length}`);
    console.log(`[DetailsSkill:meals] dailyItinerary length: ${dailyItinerary.length}`);
    console.log(`[DetailsSkill:meals] rawData.meals: ${JSON.stringify(rawData?.meals)?.substring(0, 200)}`);
    
    // 如果 meals 是空的但有 dailyItinerary，從每日行程提取餐食資訊
    if ((!mealData || mealData.length === 0) && dailyItinerary.length > 0) {
      const extractedMeals: any[] = [];
      
      for (const day of dailyItinerary) {
        if (day.meals && typeof day.meals === 'string' && day.meals.trim()) {
          extractedMeals.push({
            day: day.day || 0,
            description: day.meals.trim(),
            breakfast: day.meals.includes('早') || day.meals.toLowerCase().includes('breakfast'),
            lunch: day.meals.includes('午') || day.meals.toLowerCase().includes('lunch'),
            dinner: day.meals.includes('晚') || day.meals.toLowerCase().includes('dinner'),
          });
        }
      }
      
      if (extractedMeals.length > 0) {
        mealData = extractedMeals;
        console.log(`[DetailsSkill:meals] Extracted ${mealData.length} meal records from dailyItinerary`);
      }
    }

    // 如果沒有餐飲資料，返回預設值
    if ((!mealData || mealData.length === 0) && dailyItinerary.length === 0) {
      return { data: this.getDefaultMeals(rawData) };
    }

    const prompt = `請根據以下餐飲資訊，生成專業的餐飲介紹：

餐飲資訊：
${JSON.stringify(mealData.length > 0 ? mealData : dailyItinerary, null, 2)}

請生成包含以下欄位的餐飲資訊：
- name: 餐點名稱
- type: 餐點類型（breakfast/lunch/dinner）
- description: 餐點描述（100-150字）
- cuisine: 料理類型
- restaurant: 餐廳名稱（如有）`;

    try {
      const claudeAgent = getHaikuAgent();
      claudeAgent.setContext('DetailsSkill', 'tour_generation');
      const response = await claudeAgent.sendStructuredMessage<{ meals: MealData[] }>(
        prompt,
        MEAL_SCHEMA,
        {
          systemPrompt: `${this.getMealsSection()}\n\n${STRICT_DATA_FIDELITY_RULES}`,
          maxTokens: 2048,
          temperature: 0.5,
          schemaName: "meal_output",
          schemaDescription: "餐飲資訊結構化輸出",
        }
      );

      if (!response.success || !response.data) {
        return { data: this.getDefaultMeals(rawData), usage: response.usage };
      }

      return { data: response.data.meals, usage: response.usage };
    } catch (error) {
      console.error("[DetailsSkill:meals] Error:", error);
      return { data: this.getDefaultMeals(rawData) };
    }
  }

  // ============ Sub-Skill: Hotels ============

  private async extractHotels(rawData: any): Promise<{
    data?: HotelData[];
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    console.log("[DetailsSkill:hotels] Starting hotel extraction...");

    // 嘗試從多個來源獲取住宿資料
    let accommodationData = rawData?.accommodation || rawData?.hotels || [];
    
    // 如果 accommodation 和 hotels 都是空的，嘗試從 dailyItinerary 提取
    if ((!accommodationData || accommodationData.length === 0) && rawData?.dailyItinerary) {
      const dailyItinerary = rawData.dailyItinerary || [];
      const hotelNames = new Set<string>();
      
      for (const day of dailyItinerary) {
        // 從每日行程的 accommodation 欄位提取飯店名稱
        if (day.accommodation && typeof day.accommodation === 'string' && day.accommodation.trim()) {
          hotelNames.add(day.accommodation.trim());
        }
      }
      
      if (hotelNames.size > 0) {
        accommodationData = Array.from(hotelNames).map(name => ({
          name,
          stars: '',
          description: '',
          location: '',
        }));
        console.log(`[DetailsSkill:hotels] Extracted ${accommodationData.length} hotels from dailyItinerary`);
      }
    }
    
    console.log(`[DetailsSkill:hotels] accommodationData length: ${accommodationData.length}`);
    console.log(`[DetailsSkill:hotels] rawData.accommodation: ${JSON.stringify(rawData?.accommodation)?.substring(0, 200)}`);
    console.log(`[DetailsSkill:hotels] rawData.hotels: ${JSON.stringify(rawData?.hotels)?.substring(0, 200)}`);

    if (!accommodationData || accommodationData.length === 0) {
      console.log("[DetailsSkill:hotels] No accommodation data found, using defaults");
      return { data: this.getDefaultHotels(rawData) };
    }

    const prompt = `請根據以下住宿資訊，生成專業的飯店介紹：

住宿資訊：
${JSON.stringify(accommodationData, null, 2)}

請生成包含以下欄位的飯店資訊：
- name: 飯店名稱
- stars: 星級
- description: 飯店描述（150-200字）
- facilities: 設施列表
- location: 地理位置描述`;

    try {
      const claudeAgent = getHaikuAgent();
      claudeAgent.setContext('DetailsSkill', 'tour_generation');
      const response = await claudeAgent.sendStructuredMessage<{ hotels: HotelData[] }>(
        prompt,
        HOTEL_SCHEMA,
        {
          systemPrompt: `${this.getHotelsSection()}\n\n${STRICT_DATA_FIDELITY_RULES}`,
          maxTokens: 2048,
          temperature: 0.5,
          schemaName: "hotel_output",
          schemaDescription: "飯店資訊結構化輸出",
        }
      );

      if (!response.success || !response.data) {
        return { data: this.getDefaultHotels(rawData), usage: response.usage };
      }

      return { data: response.data.hotels, usage: response.usage };
    } catch (error) {
      console.error("[DetailsSkill:hotels] Error:", error);
      return { data: this.getDefaultHotels(rawData) };
    }
  }

  // ============ Sub-Skill: Costs ============

  private async generateCosts(rawData: any): Promise<{
    data?: CostData;
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    console.log("[DetailsSkill:costs] Starting cost generation...");

    const pricingData = rawData?.pricing || rawData?.pricingDetails || {};
    const days = rawData?.duration?.days || 5;
    const destinationCountry = rawData?.location?.destinationCountry || "";
    const destinationCity = rawData?.location?.destinationCity || "";

    if (!pricingData || Object.keys(pricingData).length === 0) {
      return { data: this.getDefaultCosts(days, destinationCountry, destinationCity) };
    }

    const prompt = `請根據以下定價資訊，生成費用說明。

定價資訊：
${JSON.stringify({ ...pricingData, days, destinationCountry, destinationCity }, null, 2)}

要求：
1. 包含項目（included）：列出 5-7 項團費包含的服務
2. 不包含項目（excluded）：列出 5-6 項團費不包含的費用
3. 額外費用提醒（additionalCosts）：列出 3-4 項額外費用或建議
4. 備註（notes）：簡短說明報價基準和注意事項`;

    try {
      const claudeAgent = getHaikuAgent();
      claudeAgent.setContext('DetailsSkill', 'tour_generation');
      const response = await claudeAgent.sendStructuredMessage<CostData>(
        prompt,
        COST_SCHEMA,
        {
          systemPrompt: `${this.getCostsSection()}\n\n${STRICT_DATA_FIDELITY_RULES}`,
          maxTokens: 2048,
          temperature: 0.3,
          schemaName: "cost_output",
          schemaDescription: "費用說明結構化輸出",
        }
      );

      if (!response.success || !response.data) {
        return { data: this.getDefaultCosts(days, destinationCountry, destinationCity), usage: response.usage };
      }

      return { data: response.data, usage: response.usage };
    } catch (error) {
      console.error("[DetailsSkill:costs] Error:", error);
      return { data: this.getDefaultCosts(days, destinationCountry, destinationCity) };
    }
  }

  // ============ Sub-Skill: Notices ============

  private async generateNotices(rawData: any): Promise<{
    data?: NoticeData;
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    console.log("[DetailsSkill:notices] Starting notice generation...");

    const locationData = rawData?.location;

    if (!locationData) {
      return { data: this.getDefaultNotices("目的地") };
    }

    const prompt = `請根據以下目的地資訊，生成旅遊注意事項。

目的地資訊：
${JSON.stringify(locationData, null, 2)}

要求：
1. 每個類別提供 3-4 條實用的注意事項
2. 每條注意事項控制在 50 字以內
3. 內容必須與目的地相關且實用`;

    try {
      const claudeAgent = getHaikuAgent();
      claudeAgent.setContext('DetailsSkill', 'tour_generation');
      const response = await claudeAgent.sendStructuredMessage<NoticeData>(
        prompt,
        NOTICE_SCHEMA,
        {
          systemPrompt: `${this.getNoticesSection()}\n\n${STRICT_DATA_FIDELITY_RULES}`,
          maxTokens: 2048,
          temperature: 0.3,
          schemaName: "notice_output",
          schemaDescription: "旅遊注意事項結構化輸出",
        }
      );

      if (!response.success || !response.data) {
        return { data: this.getDefaultNotices(locationData?.destinationCountry || "目的地"), usage: response.usage };
      }

      return { data: response.data, usage: response.usage };
    } catch (error) {
      console.error("[DetailsSkill:notices] Error:", error);
      return { data: this.getDefaultNotices(locationData?.destinationCountry || "目的地") };
    }
  }

  // ============ Section Extractors ============

  private getMealsSection(): string {
    return loadSkillSections("details", ["meals"]) || 
      "你是專業的餐飲顧問，擅長生成吸引人的餐飲介紹。";
  }

  private getHotelsSection(): string {
    return loadSkillSections("details", ["hotels"]) ||
      "你是專業的住宿顧問，擅長生成詳細的飯店介紹。";
  }

  private getCostsSection(): string {
    return loadSkillSections("details", ["costs"]) ||
      "你是專業的旅遊業務顧問，擅長提供清晰的費用說明。";
  }

  private getNoticesSection(): string {
    return loadSkillSections("details", ["notices"]) ||
      "你是專業的旅遊顧問，擅長提供實用的旅遊注意事項。";
  }

  // ============ Default Data Generators ============

  private getDefaultMeals(rawData: any): MealData[] {
    const destination = rawData?.location?.destinationCity || rawData?.location?.destinationCountry || "目的地";
    return [
      {
        name: `${destination}特色早餐`,
        type: "breakfast",
        description: `在飯店享用豐盛的自助早餐，提供當地特色料理和國際美食，讓您充滿活力地開始新的一天。`,
        cuisine: "國際自助餐",
        restaurant: "飯店餐廳",
      },
      {
        name: `${destination}特色午餐`,
        type: "lunch",
        description: `品嚐當地特色料理，選用新鮮食材，由當地名廚精心烹調，讓您體驗最道地的美食文化。`,
        cuisine: "當地特色料理",
      },
      {
        name: `${destination}精緻晚餐`,
        type: "dinner",
        description: `在精心挑選的餐廳享用精緻晚餐，品嚐當地特色菜色，配以優雅的用餐環境，為一天的行程畫上完美句點。`,
        cuisine: "當地精緻料理",
      },
    ];
  }

  private getDefaultHotels(rawData: any): HotelData[] {
    const destination = rawData?.location?.destinationCity || rawData?.location?.destinationCountry || "目的地";
    return [
      {
        name: `${destination}精選飯店`,
        stars: "四星級",
        description: `位於${destination}市中心的優質飯店，提供舒適的住宿環境和完善的設施。飯店地理位置優越，鄰近主要景點和購物區，交通便利。客房寬敞明亮，配備現代化設施，讓您在旅途中享受家一般的溫馨。`,
        facilities: ["免費 WiFi", "健身房", "餐廳", "商務中心", "機場接送"],
        location: `${destination}市中心`,
      },
    ];
  }

  private getDefaultCosts(days: number, destinationCountry: string, destinationCity: string): CostData {
    const nights = days - 1;
    return {
      included: [
        "來回經濟艙機票",
        `${nights}晚精選飯店住宿（雙人房）`,
        "每日早餐及行程中標註的午晚餐",
        "行程中所列景點門票",
        "全程遊覽車交通",
        "專業中文導遊服務",
        "旅遊責任保險",
      ],
      excluded: [
        "護照及簽證費用",
        "個人旅遊平安保險（建議自行投保）",
        "導遊、司機小費（建議每人每天 USD 10）",
        "行李超重費用",
        "個人消費（飲料、紀念品、洗衣等）",
        "行程中未標註的餐食",
      ],
      additionalCosts: [
        "單人房差價：每人加收 NTD 8,000",
        "建議攜帶現金：每人約 USD 300-500",
        "建議小費：導遊每人每天 USD 5、司機每人每天 USD 5",
      ],
      notes: `以上報價以雙人房為基準，單人報名需補單人房差價。機票及飯店價格可能因淡旺季而有所調整，實際價格以報名時確認為準。`,
    };
  }

  private getDefaultNotices(country: string): NoticeData {
    return {
      preparation: [
        "請確認護照效期至少6個月以上",
        "建議提前兌換當地貨幣或準備信用卡",
        "攜帶常用藥品及個人用品",
        "確認簽證要求並提前辦理",
      ],
      culturalNotes: [
        "尊重當地文化習俗與宗教信仰",
        "進入宗教場所請著裝得體",
        "拍照前請先詢問是否允許",
        "遵守當地法律規定",
      ],
      healthSafety: [
        "建議購買旅遊保險",
        "注意飲食衛生，避免生食",
        "隨身攜帶緊急聯絡資訊",
        "保管好個人財物",
      ],
      emergency: [
        `${country}緊急電話：請查詢當地緊急服務號碼`,
        "駐外館處24小時急難救助電話：請查詢外交部網站",
        "遺失護照請立即聯絡領隊及駐外單位",
        "如遇緊急狀況請保持冷靜並尋求協助",
      ],
    };
  }

  private getFallbackSkillContent(): string {
    return `# Details Skill
    
你是專業的旅遊細節提取專家，負責從行程資料中提取餐飲、住宿、費用和注意事項。

## 核心原則
1. 資料忠實度：只使用原始資料中的資訊
2. 結構化輸出：使用 JSON Schema 確保輸出格式正確
3. 預設值處理：當資料不足時，提供合理的預設值`;
  }
}

// ============ Factory Function ============

let detailsSkillInstance: DetailsSkill | null = null;

/**
 * 獲取 DetailsSkill 單例
 */
export function getDetailsSkill(): DetailsSkill {
  if (!detailsSkillInstance) {
    detailsSkillInstance = new DetailsSkill();
  }
  return detailsSkillInstance;
}
