/**
 * Itinerary Unified Agent
 * 合併 ItineraryExtractAgent + ItineraryPolishAgent 為單一 LLM 呼叫
 *
 * 優化目標：
 * - 減少 15-20 秒生成時間（消除兩個 Agent 之間的序列等待）
 * - 降低 ~20% Token 使用量（消除重複的 context 傳遞）
 * - 保留所有原有功能：TourType 識別、FidelityCheck、AutoRepair、Fallback
 *
 * 架構設計：
 * 1. 純邏輯層（無 LLM）：識別行程類型、提取原始資料快照
 * 2. 資料提取層（無 LLM）：從結構化 JSON 或 Markdown 提取行程
 * 3. 單一 LLM 呼叫：一次完成「提取 + 美化」（對於 Markdown 資料）
 *    或「直接美化」（對於已結構化資料）
 * 4. 品質保障層（無 LLM）：FidelityCheck + AutoRepair
 */

import { getHaikuAgent, JSONSchema } from "./claudeAgent";
import { loadReference, loadReferenceSections } from "./skillLoader";

// ─── 型別定義（向後兼容，保留原有介面）─────────────────────────────────────

export type TourType = "MINGRI_TRAIN" | "TRAIN" | "CRUISE" | "SELF_DRIVE" | "FLIGHT" | "GENERAL";

export interface ExtractedActivity {
  time: string;
  title: string;
  description: string;
  transportation: string;
  location: string;
}

export interface ExtractedItinerary {
  day: number;
  title: string;
  activities: ExtractedActivity[];
  meals: {
    breakfast: string;
    lunch: string;
    dinner: string;
  };
  accommodation: string;
}

export interface PolishedActivity {
  time: string;
  title: string;
  description: string;
  transportation: string;
  location: string;
}

export interface PolishedItinerary {
  day: number;
  title: string;
  activities: PolishedActivity[];
  meals: {
    breakfast: string;
    lunch: string;
    dinner: string;
  };
  accommodation: string;
  image?: string;
  imageAlt?: string;
}

export interface FidelityCheck {
  transportationMatch: boolean;
  hotelMatch: boolean;
  activitiesFromSource: number;
  activitiesAdded: number;
  overallScore: number;
  issues: string[];
}

export interface OriginalDataSnapshot {
  tourType: TourType;
  originalTransportation: string;
  originalHotels: string[];
  originalAttractions: string[];
}

export interface ItineraryUnifiedResult {
  success: boolean;
  data?: {
    polishedItineraries: PolishedItinerary[];
    fidelityCheck: FidelityCheck;
    extractionMethod: "structured" | "markdown" | "fallback";
    tourType: TourType;
    originalTransportation: string;
    originalHotels: string[];
    originalAttractions: string[];
    // 效能指標
    llmCallCount: number;
    totalElapsedMs: number;
  };
  error?: string;
}

// JSON Schema for the unified LLM output
const UNIFIED_ITINERARY_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    itineraries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day: { type: "integer" },
          title: { type: "string" },
          activities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                time: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                transportation: { type: "string" },
                location: { type: "string" },
              },
              required: ["time", "title", "description", "transportation", "location"],
            },
          },
          meals: {
            type: "object",
            properties: {
              breakfast: { type: "string" },
              lunch: { type: "string" },
              dinner: { type: "string" },
            },
            required: ["breakfast", "lunch", "dinner"],
          },
          accommodation: { type: "string" },
        },
        required: ["day", "title", "activities", "meals", "accommodation"],
      },
    },
  },
  required: ["itineraries"],
};

/**
 * ItineraryUnifiedAgent
 * 合併 Extract + Polish 為單一 Agent，減少 LLM 呼叫次數
 */
export class ItineraryUnifiedAgent {
  private dataFidelityRules: string = "";
  private tourTypesKnowledge: string = "";

  constructor() {
    console.log("[ItineraryUnifiedAgent] Initialized (merged Extract + Polish, single LLM call)");
    this.loadReferenceDocuments();
  }

  private loadReferenceDocuments(): void {
    try {
      this.dataFidelityRules = loadReference("Data-Fidelity-Rules");
      console.log(`[ItineraryUnifiedAgent] Loaded Data-Fidelity-Rules (${this.dataFidelityRules.length} chars)`);
    } catch (error) {
      console.warn("[ItineraryUnifiedAgent] Failed to load Data-Fidelity-Rules:", error);
    }
  }

  // ─── 純邏輯層（無 LLM）────────────────────────────────────────────────────

  private identifyTourType(rawData: any): TourType {
    // ⚠️  Use ONLY title + transportation field — NOT full JSON.stringify
    // Full stringify causes false positives (e.g. schema descriptions containing "郵輪")
    const title = rawData?.title || rawData?.basicInfo?.title || "";
    const originalTitle = rawData?.basicInfo?.originalTitle || rawData?.originalTitle || "";
    const transportation = rawData?.transportation || rawData?.basicInfo?.transportation || "";
    const searchText = (title + " " + originalTitle + " " + transportation).toLowerCase();

    // v69 GUARD — international tour from Taiwan must classify as FLIGHT regardless
    // of in-country rail mentions (e.g. "瑞士德國…雙火車體驗"). Without this guard,
    // rail keywords like 火車/列車/鐵道 in the title for tours featuring Bernina /
    // Glacier Express / Romantic Road were causing TransportationAgent to strip
    // outbound flight info and label the JSON as type=TRAIN, producing absurd
    // "搭火車從台北去德國" results (#420001/420002/420010 in v68 batch).
    const taiwanDeparture = (rawData?.departureCity || rawData?.location?.departureCity || "");
    const destinationCountry = (rawData?.destinationCountry || rawData?.location?.destinationCountry || "");
    const isInternational =
      (taiwanDeparture.includes("台北") || taiwanDeparture.includes("台灣") || taiwanDeparture.includes("桃園")) &&
      destinationCountry &&
      !["台灣", "Taiwan", ""].includes(destinationCountry.trim());
    const intlFlightSignal =
      searchText.includes("✈") ||
      searchText.includes("機場") ||
      searchText.includes("航空") ||
      searchText.includes("航班") ||
      searchText.includes("飛機") ||
      searchText.includes("機票");
    // If the tour is unambiguously international AND there's any flight signal in
    // the title/transportation field, it's FLIGHT — do NOT let in-country rail
    // keywords win. Mingri (Taiwan-only) still bypasses this guard via its own
    // earlier check below.
    if (isInternational && intlFlightSignal) {
      console.log(`[ItineraryUnifiedAgent] Tour type: FLIGHT (international: ${taiwanDeparture}→${destinationCountry}, flight signal present — overriding rail/cruise keywords)`);
      return "FLIGHT";
    }

    if (
      searchText.includes("鳴日號") ||
      searchText.includes("鳴日") ||
      (searchText.includes("觀光列車") &&
        (searchText.includes("台東") || searchText.includes("花蓮")))
    ) {
      console.log("[ItineraryUnifiedAgent] Tour type: MINGRI_TRAIN");
      try {
        this.tourTypesKnowledge = loadReferenceSections("Taiwan-Tour-Types", ["鳴日號火車行程"]);
      } catch (err) {
        // v71: was silent. If reference sections fail to load, MINGRI_TRAIN
        // detection still works but the LLM polish prompt loses its
        // domain-specific context, leading to lower-quality output.
        console.warn("[ItineraryUnifiedAgent] loadReferenceSections(Taiwan-Tour-Types) failed:", (err as Error)?.message);
      }
      return "MINGRI_TRAIN";
    }
    // 🚂 RAIL check MUST come BEFORE CRUISE to prevent false positives
    // "鐵道"/"鐵路"/"火車"/"新幹線"/"列車"/"高鐵"/"台鐵" 行程 ≠ 郵輪行程
    // v69: also gated on NOT being international (covered by guard above; this is
    // a defense-in-depth in case the guard's signals miss).
    if (
      !isInternational && (
        searchText.includes("鐵道") ||
        searchText.includes("鐵路") ||
        searchText.includes("火車") ||
        searchText.includes("新幹線") ||
        searchText.includes("列車") ||
        searchText.includes("高鐵") ||
        searchText.includes("台鐵")
      )
    ) {
      console.log("[ItineraryUnifiedAgent] Tour type: TRAIN (rail keywords in title/transport, domestic)");
      return "TRAIN";
    }
    // 🚢 CRUISE check — only if no rail keywords found
    if (searchText.includes("郵輪") || searchText.includes("遊輪") || searchText.includes("cruise")) {
      console.log("[ItineraryUnifiedAgent] Tour type: CRUISE");
      return "CRUISE";
    }
    if (searchText.includes("自駕") || searchText.includes("租車") || searchText.includes("開車")) {
      console.log("[ItineraryUnifiedAgent] Tour type: SELF_DRIVE");
      return "SELF_DRIVE";
    }
    if (
      searchText.includes("飛機") ||
      searchText.includes("航班") ||
      searchText.includes("機場") ||
      searchText.includes("機票")
    ) {
      console.log("[ItineraryUnifiedAgent] Tour type: FLIGHT");
      return "FLIGHT";
    }
    console.log("[ItineraryUnifiedAgent] Tour type: GENERAL");
    return "GENERAL";
  }

  private extractOriginalTransportation(rawData: any, tourType: TourType): string {
    const transportation = rawData?.transportation || rawData?.basicInfo?.transportation || "";
    if (transportation) return transportation;
    switch (tourType) {
      case "MINGRI_TRAIN": return "火車（鳴日號觀光列車）";
      case "TRAIN": return "火車";
      case "CRUISE": return "郵輪";
      case "SELF_DRIVE": return "自駕";
      case "FLIGHT": return "飛機";
      default: return "";
    }
  }

  private extractOriginalHotels(rawData: any): string[] {
    const hotels: string[] = [];
    const hotelData = rawData?.hotels || rawData?.accommodation?.hotels || [];
    if (Array.isArray(hotelData)) {
      for (const hotel of hotelData) {
        const name = typeof hotel === "string" ? hotel : hotel.name || hotel.hotelName || "";
        if (name) hotels.push(name);
      }
    }
    const itinerary = rawData?.itinerary || rawData?.dailyItinerary || [];
    if (Array.isArray(itinerary)) {
      for (const day of itinerary) {
        const accommodation = day.accommodation || day.hotel || "";
        if (accommodation && !hotels.includes(accommodation)) hotels.push(accommodation);
      }
    }
    const singleHotel = rawData?.accommodation?.hotelName || rawData?.hotelName || "";
    if (singleHotel && !hotels.includes(singleHotel)) hotels.push(singleHotel);
    return hotels;
  }

  private extractOriginalAttractions(rawData: any): string[] {
    const attractions: string[] = [];
    const highlights = rawData?.highlights || [];
    if (Array.isArray(highlights)) {
      for (const h of highlights) {
        const name = typeof h === "string" ? h : h.title || h.name || "";
        if (name) attractions.push(name);
      }
    }
    const attractionData = rawData?.attractions || [];
    if (Array.isArray(attractionData)) {
      for (const a of attractionData) {
        const name = typeof a === "string" ? a : a.name || a.title || "";
        if (name && !attractions.includes(name)) attractions.push(name);
      }
    }
    const itinerary = rawData?.itinerary || rawData?.dailyItinerary || [];
    if (Array.isArray(itinerary)) {
      for (const day of itinerary) {
        const activities = day.activities || day.schedule || [];
        if (Array.isArray(activities)) {
          for (const activity of activities) {
            const name = typeof activity === "string" ? activity : activity.title || activity.name || "";
            if (name && !attractions.includes(name)) attractions.push(name);
          }
        }
      }
    }
    return attractions;
  }

  // ─── 資料提取層（無 LLM）──────────────────────────────────────────────────

  private extractFromStructuredData(rawData: any): ExtractedItinerary[] {
    const itinerary = rawData?.itinerary || rawData?.dailyItinerary || [];
    if (!Array.isArray(itinerary) || itinerary.length === 0) return [];

    const result: ExtractedItinerary[] = [];
    for (const day of itinerary) {
      const dayNum = day.day || day.dayNumber || result.length + 1;
      const activities: ExtractedActivity[] = [];

      const rawActivities = day.activities || day.schedule || [];
      if (Array.isArray(rawActivities)) {
        for (const activity of rawActivities) {
          if (typeof activity === "string") {
            activities.push({ time: "", title: activity, description: activity, transportation: "", location: "" });
          } else {
            activities.push({
              time: activity.time || activity.startTime || "",
              title: activity.title || activity.name || activity.activity || "",
              description: activity.description || activity.details || activity.title || "",
              transportation: activity.transportation || activity.transport || "",
              location: activity.location || activity.place || "",
            });
          }
        }
      }

      result.push({
        day: dayNum,
        title: day.title || day.dayTitle || `Day ${dayNum}`,
        activities,
        meals: {
          breakfast: day.meals?.breakfast || day.breakfast || "",
          lunch: day.meals?.lunch || day.lunch || "",
          dinner: day.meals?.dinner || day.dinner || "",
        },
        accommodation: day.accommodation || day.hotel || "",
      });
    }
    return result;
  }

  private extractFromMarkdown(markdown: string): ExtractedItinerary[] {
    if (!markdown || markdown.length < 50) return [];

    const result: ExtractedItinerary[] = [];
    const dayPattern = /(?:第(\d+)天|Day\s*(\d+)|DAY\s*(\d+))[\s：:]*([^\n]*)/gi;
    let matches: Array<{ day: number; title: string; startIndex: number; endIndex: number }> = [];
    let match;

    while ((match = dayPattern.exec(markdown)) !== null) {
      const dayNum = parseInt(match[1] || match[2] || match[3]);
      const title = (match[4] || "").trim();
      if (!isNaN(dayNum) && dayNum > 0) {
        matches.push({ day: dayNum, title: title || `Day ${dayNum}`, startIndex: match.index, endIndex: 0 });
      }
    }

    matches.sort((a, b) => a.startIndex - b.startIndex);
    const seenDays = new Set<number>();
    matches = matches.filter((m) => {
      if (seenDays.has(m.day)) return false;
      seenDays.add(m.day);
      return true;
    });

    for (let i = 0; i < matches.length; i++) {
      matches[i].endIndex = i < matches.length - 1 ? matches[i + 1].startIndex : markdown.length;
    }

    for (const m of matches) {
      const dayContent = markdown.slice(m.startIndex, m.endIndex);
      const activities: ExtractedActivity[] = [];
      const timePattern = /(\d{1,2}[：:]\d{2})\s*[-~～]\s*(\d{1,2}[：:]\d{2})?\s*[：:]?\s*(.+)/g;
      let activityMatch;
      while ((activityMatch = timePattern.exec(dayContent)) !== null) {
        const startTime = activityMatch[1].replace("：", ":");
        const endTime = activityMatch[2]?.replace("：", ":") || "";
        const content = activityMatch[3].trim();
        activities.push({
          time: endTime ? `${startTime}-${endTime}` : startTime,
          title: content.split(/[，,。.]/)[0] || content,
          description: content,
          transportation: "",
          location: "",
        });
      }

      result.push({
        day: m.day,
        title: m.title,
        activities,
        meals: {
          breakfast: this.extractMeal(dayContent, ["早餐", "breakfast"]),
          lunch: this.extractMeal(dayContent, ["午餐", "lunch", "中餐"]),
          dinner: this.extractMeal(dayContent, ["晚餐", "dinner"]),
        },
        accommodation: this.extractAccommodation(dayContent),
      });
    }
    return result;
  }

  private extractMeal(content: string, keywords: string[]): string {
    for (const kw of keywords) {
      const m = content.match(new RegExp(`${kw}[：:]\\s*(.+?)(?:\\n|$)`, "i"));
      if (m) return m[1].trim();
    }
    return "";
  }

  private extractAccommodation(content: string): string {
    for (const kw of ["住宿", "飯店", "酒店", "hotel", "入住"]) {
      const m = content.match(new RegExp(`${kw}[：:]\\s*(.+?)(?:\\n|$)`, "i"));
      if (m) return m[1].trim();
    }
    return "";
  }

  private createFallbackItinerary(rawData: any, tourType: TourType, transportation: string): ExtractedItinerary[] {
    const days = rawData?.duration?.days || 5;
    const highlights = rawData?.highlights || [];
    const attractions = rawData?.attractions || [];
    const destinationCity = rawData?.location?.destinationCity || rawData?.destination || "";
    const hotelName = rawData?.accommodation?.hotelName || rawData?.hotelName || "";

    if (!destinationCity && highlights.length === 0 && attractions.length === 0) return [];

    const allPoints: string[] = [
      ...highlights.map((h: any) => (typeof h === "string" ? h : h.title || h.name || "")),
      ...attractions.map((a: any) => (typeof a === "string" ? a : a.name || a.title || "")),
    ].filter(Boolean);

    const pointsPerDay = Math.ceil(allPoints.length / days);
    const result: ExtractedItinerary[] = [];

    for (let i = 0; i < days; i++) {
      const dayPoints = allPoints.slice(i * pointsPerDay, (i + 1) * pointsPerDay);
      let title = `Day ${i + 1}`;
      if (i === 0) {
        title += tourType === "MINGRI_TRAIN" ? "：搭乘鳴日號出發" : tourType === "CRUISE" ? "：登船出發" : `：抵達${destinationCity}`;
      } else if (i === days - 1) {
        title += "：返程";
      } else if (dayPoints.length > 0) {
        title += `：${dayPoints[0]}`;
      }

      result.push({
        day: i + 1,
        title,
        activities: dayPoints.map((point, idx) => ({
          time: `${9 + idx * 3}:00-${12 + idx * 3}:00`,
          title: point,
          description: `探索${point}`,
          transportation,
          location: point,
        })),
        meals: { breakfast: "飯店早餐", lunch: "當地特色餐廳", dinner: "精選餐廳" },
        accommodation: hotelName || "當地精選飯店",
      });
    }
    return result;
  }

  // ─── 單一 LLM 呼叫層（核心優化）──────────────────────────────────────────

  /**
   * 單一 LLM 呼叫：一次完成美化
   * 使用 Haiku 模型，批次處理所有天數
   */
  private async polishWithSingleLLMCall(
    extractedItineraries: ExtractedItinerary[],
    destinationInfo: { country?: string; city?: string },
    originalDataSnapshot: OriginalDataSnapshot,
    rawData?: any  // P1-Self-Repair: optional rawData for selfRepairHint injection
  ): Promise<PolishedItinerary[]> {
    const { city = "", country = "" } = destinationInfo;
    const { originalTransportation, tourType } = originalDataSnapshot;

    // P1-Self-Repair: inject selfRepairHint if provided by MasterAgent
    const itinerarySelfRepairHint = rawData?.selfRepairHint || '';
    const itinerarySelfRepairSection = itinerarySelfRepairHint
      ? `\n【自我修復指令 — 第 ${rawData?.selfRepairRound || 1} 次重試，請針對以下問題改善行程描述】：\n${itinerarySelfRepairHint}`
      : '';
    // 輸出 transport 判斷說明（對 Forge/Gemini 尤為重要）
    const transportRuleNote = tourType === 'TRAIN'
      ? `注意：這是鐵道行程（${originalTransportation || '火車/新幹線/列車'}）。交通描述必須使用火車/鐵路/新幹線等鐵道相關用語，禁止出現「郵輪」「遊輪」「飛機」「航班」。`
      : tourType === 'MINGRI_TRAIN'
      ? `注意：這是鳴日號觀光列車行程，所有交通描述必須使用火車/列車，禁止出現飛機/航班/機場。`
      : tourType === 'CRUISE'
      ? `注意：這是郵輪行程，所有交通描述必須使用郵輪/遊輪，禁止出現飛機/航班。`
      : '';
    const systemPrompt = `你是 PACK&GO 旅行社的專業旅遊行程規劃師。請用繁體中文美化行程描述，保持原始資訊完全不變。
核心規則：
1. 保留所有景點名稱、時間、飯店名稱、交通方式
2. 每個活動描述 40-60 字，使用生動但簡潔的繁體中文描述
3. 禁止更改交通方式或飯店名稱
4. 禁止新增原始資料中沒有的景點或活動
5. 絕對不要使用簡體中文
6. 【v69 重要】：每一天的 activities 陣列至少要有 1 筆活動，不可為空陣列。若原始資料 day 1 或最後一天沒有具體景點（通常是搭機日），請依據前後文補一筆「出發/抵達/返程」類型的活動：
   • Day 1（首日）若無景點：補一筆「搭機前往${city}（航程約 X 小時，抵達後辦理入住休息）」
   • 最後一天若無景點：補一筆「享用早餐後整理行李，搭機返回${rawData?.departureCity || '台北'}，結束愉快旅程」
   • 中間若有空白日：用「自由活動」+前後景點脈絡填補
   絕對不允許 activities 為空陣列。
${originalTransportation ? `原始交通方式：${originalTransportation}` : ''}
${transportRuleNote}${itinerarySelfRepairSection}`;

    const userPrompt = `美化以下行程（目的地：${city}${country ? `, ${country}` : ""}）：
${JSON.stringify(extractedItineraries, null, 2)}
回傳 JSON 格式的美化行程，保持天數與原始完全一致（共 ${extractedItineraries.length} 天）。`;

    try {
      const claudeAgent = getHaikuAgent();

      claudeAgent.setContext('ItineraryUnifiedAgent', 'tour_generation');
      const response = await claudeAgent.sendStructuredMessage<{ itineraries: PolishedItinerary[] }>(
        userPrompt,
        UNIFIED_ITINERARY_SCHEMA,
        {
          systemPrompt,
          // v67: was 8192 — actual output rarely exceeds ~3K. 4096 leaves
          // headroom for long itineraries (15+ days) without burning quota.
          maxTokens: 4096,
          temperature: 0.5,
          schemaName: "unified_polished_itineraries",
          schemaDescription: "合併提取與美化的行程輸出",
        }
      );

      if (!response.success || !response.data?.itineraries) {
        throw new Error("Empty or invalid response from LLM");
      }

      const polished = response.data.itineraries;
      console.log(`[ItineraryUnifiedAgent] LLM returned ${polished.length} days (input: ${extractedItineraries.length})`);

      if (polished.length !== extractedItineraries.length) {
        console.warn(`[ItineraryUnifiedAgent] Day count mismatch! Input: ${extractedItineraries.length}, Output: ${polished.length}`);
      }

      return polished;
    } catch (error) {
      console.error("[ItineraryUnifiedAgent] LLM polish failed, using extracted data as fallback:", error);
      // Fallback: 直接使用提取的資料，轉換格式
      return extractedItineraries.map((it) => ({ ...it }));
    }
  }

  // ─── 品質保障層（無 LLM）──────────────────────────────────────────────────

  private performFidelityCheck(
    polished: PolishedItinerary[],
    original: ExtractedItinerary[],
    snapshot?: OriginalDataSnapshot
  ): FidelityCheck {
    let score = 100;
    const issues: string[] = [];
    let transportationMatch = true;
    let hotelMatch = true;

    if (snapshot?.originalTransportation) {
      const originalTransport = snapshot.originalTransportation.toLowerCase();
      for (const day of polished) {
        for (const activity of day.activities) {
          const text = `${activity.title} ${activity.description} ${activity.transportation}`.toLowerCase();
          if (
            (originalTransport.includes("火車") || originalTransport.includes("鳴日")) &&
            (text.includes("飛機") || text.includes("航班") || text.includes("機場"))
          ) {
            transportationMatch = false;
            issues.push(`Day ${day.day}: 交通方式錯誤（原始為火車，出現飛機相關內容）`);
            score -= 30;
          }
          if (
            (originalTransport.includes("郵輪") || originalTransport.includes("遊輪")) &&
            (text.includes("飛機") || text.includes("航班"))
          ) {
            transportationMatch = false;
            issues.push(`Day ${day.day}: 交通方式錯誤（原始為郵輪，出現飛機相關內容）`);
            score -= 30;
          }
        }
      }
    }

    if (snapshot?.originalHotels && snapshot.originalHotels.length > 0) {
      for (const day of polished) {
        if (day.accommodation) {
          const accLower = day.accommodation.toLowerCase();
          const matched = snapshot.originalHotels.find(
            (h) => accLower.includes(h.toLowerCase()) || h.toLowerCase().includes(accLower)
          );
          if (!matched && day.accommodation !== "敬請期待" && day.accommodation !== "待確認") {
            const isGeneric = ["飯店", "酒店", "hotel", "旅館"].some(
              (t) => accLower === t || accLower.length < 5
            );
            if (!isGeneric) {
              hotelMatch = false;
              issues.push(`Day ${day.day}: 飯店名稱可能被更改 - ${day.accommodation}`);
              score -= 10;
            }
          }
        }
      }
    }

    const originalActivitiesCount = original.reduce((s, d) => s + d.activities.length, 0);
    const polishedActivitiesCount = polished.reduce((s, d) => s + d.activities.length, 0);
    const activitiesAdded = Math.max(0, polishedActivitiesCount - originalActivitiesCount);
    // ENRICHMENT RULE: When source has 0 activities, adding geographically consistent
    // attractions is ACCEPTABLE ENRICHMENT (travel agencies are expected to enrich bare itineraries).
    // Only penalize if source has activities AND the AI added more than 20% extra.
    const isEnrichmentFromEmpty = originalActivitiesCount === 0;
    if (!isEnrichmentFromEmpty && activitiesAdded > originalActivitiesCount * 0.2) {
      issues.push(`新增了過多活動：${activitiesAdded} 個（原始 ${originalActivitiesCount} 個）`);
      score -= 20;
    }

    return {
      transportationMatch,
      hotelMatch,
      activitiesFromSource: originalActivitiesCount,
      activitiesAdded,
      overallScore: Math.max(0, score),
      issues,
    };
  }

  /**
   * v69 safety-net: ensure every day has ≥1 activity, regardless of which path
   * (LLM polish, fallback, or auto-repair) produced the polished itinerary.
   * Without this, source data with bare day-1 / last-day flight days produces
   * UI sections that look "missing" instead of "travel day".
   */
  private fillEmptyDayActivities(
    polished: PolishedItinerary[],
    city: string,
    departureCity: string
  ): PolishedItinerary[] {
    const totalDays = polished.length;
    return polished.map((d, i) => {
      const acts = Array.isArray(d.activities) ? d.activities : [];
      const hasRealActivity = acts.some(
        (a: any) =>
          a &&
          typeof a === "object" &&
          ((typeof a.title === "string" && a.title.trim().length > 0) ||
            (typeof a.description === "string" && a.description.trim().length > 0))
      );
      if (hasRealActivity) return d;

      const isFirst = i === 0;
      const isLast = i === totalDays - 1;
      let title = "自由活動";
      let description = "依當地天氣與身心狀況彈性安排，建議深入體驗目的地的日常風景。";
      if (isFirst) {
        title = `啟程前往${city || "目的地"}`;
        description = `自${departureCity}出發，搭乘航班/列車前往${city || "目的地"}，抵達後辦理入住，視時間調整作息，為接下來的旅程蓄積精神。`;
      } else if (isLast) {
        title = `啟程返回${departureCity}`;
        description = `享用早餐後整理行李，前往機場/車站搭乘交通工具返回${departureCity}，為這趟旅程畫下圓滿句點。`;
      }
      console.warn(
        `[ItineraryUnifiedAgent] v69 safety-net filled empty day ${d.day || i + 1} (${
          isFirst ? "first" : isLast ? "last" : "middle"
        })`
      );
      return {
        ...d,
        activities: [
          {
            time: "",
            title,
            description,
            transportation: "",
            location: city || "",
          },
        ] as any,
      };
    });
  }

  private autoRepairItineraries(
    polished: PolishedItinerary[],
    original: ExtractedItinerary[],
    snapshot: OriginalDataSnapshot
  ): PolishedItinerary[] {
    return polished.map((day, index) => {
      const originalDay = original[index];
      const accommodation =
        originalDay?.accommodation || snapshot.originalHotels[index] || day.accommodation;

      const activities = day.activities.map((activity) => {
        let { transportation, description, title } = activity;
        if (
          snapshot.tourType === "MINGRI_TRAIN" ||
          snapshot.tourType === "TRAIN" ||
          snapshot.originalTransportation.includes("火車")
        ) {
          if (transportation.includes("飛機") || transportation.includes("航班")) {
            transportation = "火車";
          }
          description = description.replace(/飛機/g, "火車").replace(/航班/g, "列車").replace(/機場/g, "車站");
          title = title.replace(/飛機/g, "火車").replace(/航班/g, "列車").replace(/機場/g, "車站");
        }
        return { ...activity, transportation, description, title };
      });

      return { ...day, accommodation, activities };
    });
  }

  // ─── 主要執行方法────────────────────────────────────────────────────────────

  async execute(rawData: any): Promise<ItineraryUnifiedResult> {
    const startTime = Date.now();
    let llmCallCount = 0;
    console.log("[ItineraryUnifiedAgent] Starting unified extract + polish...");

    try {
      // Step 1: 識別行程類型（純邏輯）
      const tourType = this.identifyTourType(rawData);
      const originalTransportation = this.extractOriginalTransportation(rawData, tourType);
      const originalHotels = this.extractOriginalHotels(rawData);
      const originalAttractions = this.extractOriginalAttractions(rawData);

      console.log(`[ItineraryUnifiedAgent] Snapshot: type=${tourType}, transport=${originalTransportation}, hotels=${originalHotels.length}, attractions=${originalAttractions.length}`);

      const snapshot: OriginalDataSnapshot = {
        tourType,
        originalTransportation,
        originalHotels,
        originalAttractions,
      };

      const destinationInfo = {
        country: rawData?.location?.destinationCountry,
        city: rawData?.location?.destinationCity,
      };

      // Step 2: 提取行程（純邏輯，無 LLM）
      let extractedItineraries: ExtractedItinerary[] = [];
      let extractionMethod: "structured" | "markdown" | "fallback" = "fallback";

      const structuredResult = this.extractFromStructuredData(rawData);
      if (structuredResult.length > 0) {
        extractedItineraries = structuredResult;
        extractionMethod = "structured";
        console.log(`[ItineraryUnifiedAgent] Extracted ${extractedItineraries.length} days from structured data`);
      } else {
        const markdown = rawData?.markdown || rawData?.content || rawData?.rawContent || "";
        const markdownResult = this.extractFromMarkdown(markdown);
        if (markdownResult.length > 0) {
          extractedItineraries = markdownResult;
          extractionMethod = "markdown";
          console.log(`[ItineraryUnifiedAgent] Extracted ${extractedItineraries.length} days from markdown`);
        } else {
          extractedItineraries = this.createFallbackItinerary(rawData, tourType, originalTransportation);
          extractionMethod = "fallback";
          console.log(`[ItineraryUnifiedAgent] Using fallback itinerary: ${extractedItineraries.length} days`);
        }
      }

      if (extractedItineraries.length === 0) {
        return {
          success: true,
          data: {
            polishedItineraries: [],
            fidelityCheck: {
              transportationMatch: true,
              hotelMatch: true,
              activitiesFromSource: 0,
              activitiesAdded: 0,
              overallScore: 100,
              issues: [],
            },
            extractionMethod,
            tourType,
            originalTransportation,
            originalHotels,
            originalAttractions,
            llmCallCount: 0,
            totalElapsedMs: Date.now() - startTime,
          },
        };
      }

      // Step 3: 單一 LLM 呼叫完成美化（核心優化）
      llmCallCount = 1;
      let polishedItineraries = await this.polishWithSingleLLMCall(
        extractedItineraries,
        destinationInfo,
        snapshot,
        rawData  // P1-Self-Repair: pass rawData for selfRepairHint injection
      );

      // Step 4: FidelityCheck + AutoRepair（純邏輯）
      let fidelityCheck = this.performFidelityCheck(polishedItineraries, extractedItineraries, snapshot);
      console.log(`[ItineraryUnifiedAgent] Fidelity: score=${fidelityCheck.overallScore}, transport=${fidelityCheck.transportationMatch}, hotel=${fidelityCheck.hotelMatch}`);

      if (fidelityCheck.overallScore < 80) {
        console.log(`[ItineraryUnifiedAgent] Auto-repairing (score ${fidelityCheck.overallScore} < 80)...`);
        polishedItineraries = this.autoRepairItineraries(polishedItineraries, extractedItineraries, snapshot);
        fidelityCheck = this.performFidelityCheck(polishedItineraries, extractedItineraries, snapshot);
        console.log(`[ItineraryUnifiedAgent] After repair: score=${fidelityCheck.overallScore}`);
      }

      if (fidelityCheck.issues.length > 0) {
        console.warn(`[ItineraryUnifiedAgent] Fidelity issues: ${fidelityCheck.issues.join(", ")}`);
      }

      // v69 safety-net (lifted to execute level): no matter which path produced
      // polishedItineraries — LLM success, LLM fallback, or autoRepair — every
      // day must have at least one activity. Source data sometimes has bare
      // day-1 (departure flight) and last day (return flight) with no
      // activities; render those as travel days.
      polishedItineraries = this.fillEmptyDayActivities(
        polishedItineraries,
        destinationInfo.city || destinationInfo.country || "目的地",
        rawData?.departureCity || rawData?.location?.departureCity || "台北"
      );

      const totalElapsedMs = Date.now() - startTime;
      console.log(`[ItineraryUnifiedAgent] ✓ Completed: ${polishedItineraries.length} days, ${llmCallCount} LLM call(s), ${totalElapsedMs}ms`);

      return {
        success: true,
        data: {
          polishedItineraries,
          fidelityCheck,
          extractionMethod,
          tourType,
          originalTransportation,
          originalHotels,
          originalAttractions,
          llmCallCount,
          totalElapsedMs,
        },
      };
    } catch (error) {
      console.error("[ItineraryUnifiedAgent] Error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
