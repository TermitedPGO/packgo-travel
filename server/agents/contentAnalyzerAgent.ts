/**
 * Content Analyzer Agent
 * Responsible for analyzing content and copyright cleansing
 * Now using Claude API for better performance and cost-effectiveness
 * 
 * Phase 2 優化（2026-02-01）：
 * - 合併多個 LLM 調用為單一調用
 * - 使用 Haiku 進行快速生成
 * - 減少總體處理時間
 */

import { getHaikuAgent, getSonnetAgent, ClaudeAgent, JSONSchema } from './claudeAgent';
import { COPYWRITER_SKILL } from "./skillLibrary";
import { getKeyInstructions, extractJsonSchema } from "./skillLoader";
import { applyLearnedSkills } from "./learningAgent";

/**
 * 根據目的地回傳對應的文案風格指引
 * PACK&GO 品牌：美國精品華語旅行社，行程涵蓋全球
 */
function getDestinationStyle(country: string, city: string): string {
  const c = (country || '').trim();
  const combined = `${c} ${city || ''}`.trim();

  if (['日本'].includes(c) || /東京|大阪|京都|北海道|沖繩|箱根|奈良|名古屋|福岡|鹿兒島/.test(combined)) {
    return '日本行程：強調四季美學、職人精神、和式細膩。善用「季節限定」「匠心」「旬味」等詞彙。注意區分關東/關西/北海道的風情差異。';
  }
  if (['韓國'].includes(c) || /首爾|釜山|濟州/.test(combined)) {
    return '韓國行程：強調潮流與傳統並存、韓式美食體驗、都會與自然的對比。';
  }
  if (['泰國','越南','新加坡','馬來西亞','印尼','菲律賓','柬埔寨','緬甸','寮國'].includes(c)) {
    return '東南亞行程：強調熱帶風情、在地文化深度、自然生態奇觀。用詞輕鬆活潑但不廉價。';
  }
  if (['帛琉','馬爾地夫','斐濟','大溪地','關島','塞班'].includes(c) || /島/.test(combined)) {
    return '海島行程：強調海洋生態、水上活動、純淨放鬆、度假氛圍。用詞清爽明亮。';
  }
  if (['台灣'].includes(c) || /台北|台中|台南|高雄|花蓮|台東|墾丁|阿里山|日月潭|宜蘭|南投/.test(combined)) {
    return '台灣行程：強調在地深度、鐵道風情、小鎮文化、美食。走「重新認識台灣」的深度路線，避免觀光客視角。';
  }
  if (['英國','法國','義大利','德國','西班牙','希臘','土耳其','瑞士','奧地利','荷蘭','葡萄牙','捷克','克羅埃西亞','冰島','挪威','瑞典','丹麥','芬蘭','愛爾蘭','比利時','匈牙利','波蘭','羅馬尼亞'].includes(c) || /歐洲|北歐|東歐|南歐/.test(combined)) {
    return '歐洲行程：強調歷史縱深、建築美學、藝術人文、美食美酒文化。用詞可稍偏優雅古典。根據具體國家調整風情差異。';
  }
  if (['澳洲','紐西蘭'].includes(c)) {
    return '紐澳行程：強調壯闊自然、戶外探索、農莊體驗、純淨空氣。';
  }
  if (['美國','加拿大','秘魯','阿根廷','巴西','墨西哥','智利','古巴','哥倫比亞'].includes(c)) {
    return '美洲行程：強調多元文化、壯麗地景、公路精神、冒險體驗。';
  }
  if (['埃及','摩洛哥','南非','肯亞','杜拜','約旦','以色列'].includes(c) || /中東|非洲/.test(combined)) {
    return '中東/非洲行程：強調文明遺跡、沙漠奇景、野生動物、異域風情。';
  }
  if (['中國','香港','澳門'].includes(c)) {
    return '中國/港澳行程：強調千年文化、美食文化、現代與傳統交融。';
  }

  return `本行程目的地為${c || '海外'}，請根據該地區的文化特色和旅遊亮點，選擇最適合的描述風格。`;
}

export interface ContentAnalyzerResult {
  success: boolean;
  data?: {
    poeticTitle: string; // 詩意化標題 (Sipincollection 風格)
    title: string;
    description: string;
    heroSubtitle: string;
    highlights: any[];
    keyFeatures: any[];
    poeticContent: any;
    poeticSubtitle: string; // 詩意副標題
    attractions: any[]; // 景點詳細介紹
    hotels: any[]; // 飯店詳細介紹
    meals: any[]; // 餐食介紹
    flights: any; // 航班資訊
    originalityScore: number; // 0-100
    // 新增：智能標籤系統
    smartTags?: {
      labels: string[];           // 生成的標籤
      appliedSkills: number[];    // 應用的技能 ID
      featureClassification?: string[];  // 特色分類
      transportationType?: string[];     // 交通類型
      highlightActivities?: string[];    // 亮點活動
      accommodationType?: string[];      // 住宿類型
    };
  };
  error?: string;
}

// Phase 2 優化：合併輸出的 JSON Schema
const COMBINED_OUTPUT_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    poeticTitle: { 
      type: "string", 
      description: "詩意化的行程標題，15-25 個中文字" 
    },
    title: { 
      type: "string", 
      description: "行銷標題，20-30 個中文字" 
    },
    description: { 
      type: "string", 
      description: "行程介紹，100-120 個中文字" 
    },
    heroSubtitle: { 
      type: "string", 
      description: "Hero 副標題，30-40 個中文字" 
    },
    highlights: {
      type: "array",
      items: { type: "string" },
      description: "6-10 個行程亮點，每個 10-30 個中文字"
    },
  },
  required: ["poeticTitle", "title", "description", "heroSubtitle", "highlights"],
};

/**
 * Content Analyzer Agent
 * Analyzes and rewrites content to ensure originality
 * 
 * Phase 2 優化：合併多個 LLM 調用為單一調用
 */
export class ContentAnalyzerAgent {
  private skillInstructions: string;
  private jsonSchema: any;
  private claudeAgent: ClaudeAgent;

  constructor() {
    // Load SKILL.md instructions (only key sections for token optimization)
    this.skillInstructions = getKeyInstructions('ContentAnalyzerAgent');
    this.jsonSchema = extractJsonSchema('ContentAnalyzerAgent');
    // Phase 2 優化：使用 Haiku 加速處理
    this.claudeAgent = getHaikuAgent();
    this.claudeAgent.setContext('ContentAnalyzerAgent', 'content_analysis');
    console.log('[ContentAnalyzerAgent] SKILL loaded:', this.skillInstructions.length, 'chars');
    console.log('[ContentAnalyzerAgent] Using Claude 3 Haiku for fast content generation');
  }

  /**
   * Execute content analysis and copyright cleansing
   * Phase 2 優化：合併多個步驟為單一 LLM 調用
   */
  async execute(rawData: any): Promise<ContentAnalyzerResult> {
    const startTime = Date.now();
    console.log("[ContentAnalyzerAgent] Starting optimized content analysis...");
    
    try {
      // Phase 2 優化：單一 LLM 調用生成所有內容
      const combinedResult = await this.generateAllContent(rawData);
      
      // Step 5: Generate key features (不需要 LLM)
      const keyFeatures = this.generateKeyFeatures(rawData);
      
      // Step 6: Generate poetic content (不需要 LLM)
      const poeticContent = this.generatePoeticContent(rawData);
      
      // Step 7: Verify originality (簡單計算)
      const originalityScore = this.verifyOriginality({
        title: combinedResult.title,
        description: combinedResult.description,
        heroSubtitle: combinedResult.heroSubtitle,
      });
      
      // Phase 3: 應用技能系統生成智能標籤
      const smartTags = await this.applySkillsForSmartTags(rawData, combinedResult);
      
      const elapsed = Date.now() - startTime;
      console.log(`[ContentAnalyzerAgent] Content analysis completed in ${elapsed}ms`);
      console.log("[ContentAnalyzerAgent] Originality score:", originalityScore);
      console.log(`[ContentAnalyzerAgent] Smart tags generated: ${smartTags.labels.length} labels from ${smartTags.appliedSkills.length} skills`);
      
      return {
        success: true,
        data: {
          poeticTitle: combinedResult.poeticTitle,
          title: combinedResult.title,
          description: combinedResult.description,
          heroSubtitle: combinedResult.heroSubtitle,
          highlights: combinedResult.highlights.map((h: string, i: number) => ({
            id: i + 1,
            image: "",
            imageAlt: h,
            title: h,
            subtitle: i === 0 ? "STAY" : "EXPLORE",
            description: h,
            labelColor: "#F39C12",
            labelPosition: "bottom-right",
          })),
          keyFeatures,
          poeticContent,
          poeticSubtitle: "",
          attractions: [],
          hotels: [],
          meals: [],
          flights: {},
          originalityScore,
          smartTags,
        },
      };
    } catch (error) {
      console.error("[ContentAnalyzerAgent] Error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Phase 2 優化：單一 LLM 調用生成所有內容
   */
  private async generateAllContent(rawData: any): Promise<{
    poeticTitle: string;
    title: string;
    description: string;
    heroSubtitle: string;
    highlights: string[];
  }> {
    const destinationCountry = rawData.location?.destinationCountry || "";
    const destinationCity = rawData.location?.destinationCity || "";
    const days = rawData.duration?.days || "";
    const nights = rawData.duration?.nights || "";
    const originalTitle = rawData.basicInfo?.title || "";
    const originalDescription = rawData.basicInfo?.description || "";
    const highlights = rawData.highlights || [];
    const hotelGrade = rawData.accommodation?.hotelGrade || "";
    const specialExperiences = rawData.specialExperiences || [];
    
    // PACK&GO 品牌核心 + 目的地自適應風格
    const destinationStyle = getDestinationStyle(destinationCountry, destinationCity);

    const systemPrompt = `你是 PACK&GO 旅行社的資深文案總監。

品牌定位：美國精品華語旅行社，服務追求品質的華語旅客，行程涵蓋全球。
品牌調性：雅奢但不浮誇、有溫度但不煽情、專業但不生硬。

語言規則：
- 所有輸出必須使用繁體中文
- 地名、景點名稱保留原文並加中文（例：科托爾灣 Kotor Bay、箱根 Hakone）
- 即使輸入資料是英文或其他語言，也必須翻譯為繁體中文

風格要點：
1. 使用精煉的形容詞，動詞帶動感（尋蹤、漫遊、品味、探索）
2. 每段描述至少包含一個感官細節（視覺、聽覺、嗅覺、味覺、觸覺）
3. 內容必須基於原始資料，禁止捏造景點或體驗
4. 保持簡潔專業

本次目的地風格指引：${destinationStyle}

禁用詞彙：靈魂、洗滌、光影、呢喃、心靈、深度對話、完美融合、一生必去`;

    // P1-Self-Repair: inject selfRepairHint if provided by MasterAgent
    const selfRepairHint = rawData.selfRepairHint || '';
    const selfRepairSection = selfRepairHint
      ? `\n\n【自我修復指令 — 請針對以下問題改善，這是第 ${rawData.selfRepairRound || 1} 次重試】：\n${selfRepairHint}\n請特別注意上述問題，確保輸出質量高於上次。`
      : '';
    const userPrompt = `請根據以下資訊生成旅遊文案（所有內容必須為繁體中文）：

目的地：${destinationCity}, ${destinationCountry}
天數：${days}天${nights}夜
原標題：${originalTitle}
原描述：${originalDescription}
行程亮點：${highlights.slice(0, 5).join("、")}
飯店等級：${hotelGrade}
特色體驗：${specialExperiences.join("、")}${selfRepairSection}

請生成（全部用繁體中文）：
1. poeticTitle: 詩意化標題（15-25字）
2. title: 行銷標題（20-30字）
3. description: 行程介紹（100-120字）
4. heroSubtitle: Hero副標題（30-40字）
5. highlights: 6-10個行程亮點（每個10-30字，必須為繁體中文，英文景點名請翻譯）`;

    try {
      const response = await this.claudeAgent.sendStructuredMessage<{
        poeticTitle: string;
        title: string;
        description: string;
        heroSubtitle: string;
        highlights: string[];
      }>(
        userPrompt,
        COMBINED_OUTPUT_SCHEMA,
        {
          systemPrompt,
          maxTokens: 2000,
          temperature: 0.7,
          schemaName: 'content_analysis_output',
          schemaDescription: '旅遊文案生成輸出',
        }
      );

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to generate content');
      }

      console.log(`[ContentAnalyzerAgent] Generated poetic title: ${response.data.poeticTitle}`);
      console.log(`[ContentAnalyzerAgent] Generated ${response.data.highlights?.length || 0} highlights`);

      return {
        poeticTitle: response.data.poeticTitle || `${destinationCity}${days}日精選之旅`,
        title: response.data.title || originalTitle || "精選行程",
        description: response.data.description || originalDescription || "探索精彩行程，體驗難忘旅程。",
        heroSubtitle: response.data.heroSubtitle || `${destinationCity}深度遊．${days}天${nights}夜`,
        highlights: response.data.highlights || highlights.slice(0, 6),
      };
    } catch (error) {
      console.error("[ContentAnalyzerAgent] Combined generation failed:", error);
      
      // Fallback
      return {
        poeticTitle: `${destinationCity}${days}日精選之旅`,
        title: originalTitle || "精選行程",
        description: originalDescription || "探索精彩行程，體驗難忘旅程。",
        heroSubtitle: `${destinationCity}深度遊．${days}天${nights}夜`,
        highlights: highlights.slice(0, 6),
      };
    }
  }
  
  /**
   * Generate key features (vertical text layout)
   * 不需要 LLM，直接生成
   */
  private generateKeyFeatures(rawData: any): any[] {
    const accommodation = rawData.accommodation || {};
    const destination = rawData.location?.destinationCity || rawData.location?.destinationCountry || "";
    
    return [
      {
        id: 1,
        keyword: "雅奢旅宿",
        keywordStyle: "vertical",
        image: "",
        imageAlt: `${destination}雅奢旅宿`,
        phrases: [
          "覽秘境無邊風月",
          "品其國美饌名湯",
          "享星鑰洞迴匠心",
        ],
        description: accommodation.hotelDescription || "現代設計與傳統美學的完美融合，打造極致奢華的住宿體驗。",
      },
      {
        id: 2,
        keyword: "遊",
        keywordStyle: "vertical",
        image: null,
        phrases: [
          "理想星鏡",
          "極致歡待",
        ],
        description: `深度探索${destination}的自然美景與人文風情。`,
      },
      {
        id: 3,
        keyword: "特別安排",
        keywordStyle: "vertical",
        image: null,
        phrases: [
          "秘境尋蹤",
          "深度漫遊",
        ],
        description: `獨家安排的特色行程，帶您體驗不一樣的${destination}。`,
      },
    ];
  }
  
  /**
   * Generate poetic content
   * 不需要 LLM，直接生成
   */
  private generatePoeticContent(rawData: any): any {
    const destination = rawData.location?.destinationCity || rawData.location?.destinationCountry || "";
    const accommodation = rawData.accommodation || {};
    
    return {
      intro: `在${destination}的世界中，尋找心靈的寧靜與感動`,
      accommodation: accommodation.hotelName 
        ? `入住${accommodation.hotelName}，感受極致奢華與美學的完美融合`
        : `入住精選酒店，享受舒適與便利`,
      dining: `品嚐${destination}的山珍海味，每一口都是大自然的恩賜`,
      experience: `深度探索${destination}的秘境，讓旅程成為一生難忘的回憶`,
      closing: "這不僅是一趟旅行，更是一場心靈的洗禮",
    };
  }
  
  /**
   * Verify originality (simple check)
   * 不需要 LLM，直接計算
   */
  private verifyOriginality(content: {
    title: string;
    description: string;
    heroSubtitle: string;
  }): number {
    const totalLength = content.title.length + content.description.length + content.heroSubtitle.length;
    
    // Basic score: longer content = higher originality
    let score = Math.min(100, totalLength / 3);
    
    // Check for common phrases (reduce score if found)
    const commonPhrases = ["行程", "旅遊", "精選", "特色", "深度"];
    let commonCount = 0;
    commonPhrases.forEach(phrase => {
      if (content.description.includes(phrase)) commonCount++;
    });
    
    score -= commonCount * 5;
    
    return Math.max(60, Math.min(100, score));
  }

  /**
   * Phase 3: 應用技能系統生成智能標籤
   * 整合 Superpowers 風格的技能系統
   */
  private async applySkillsForSmartTags(
    rawData: any,
    combinedResult: {
      poeticTitle: string;
      title: string;
      description: string;
      heroSubtitle: string;
      highlights: string[];
    }
  ): Promise<{
    labels: string[];
    appliedSkills: number[];
    featureClassification: string[];
    transportationType: string[];
    highlightActivities: string[];
    accommodationType: string[];
  }> {
    const startTime = Date.now();
    console.log("[ContentAnalyzerAgent] Applying skills for smart tags...");

    try {
      // 組合所有內容用於技能匹配
      const contentForMatching = [
        rawData.basicInfo?.title || "",
        rawData.basicInfo?.description || "",
        combinedResult.title,
        combinedResult.description,
        combinedResult.poeticTitle,
        combinedResult.heroSubtitle,
        ...(combinedResult.highlights || []),
        ...(rawData.highlights || []),
        ...(rawData.specialExperiences || []),
        rawData.accommodation?.hotelName || "",
        rawData.accommodation?.hotelDescription || "",
        rawData.location?.destinationCountry || "",
        rawData.location?.destinationCity || "",
      ].filter(Boolean).join(" ");

      // 組合 metadata 用於規則匹配
      const metadata = {
        duration: rawData.duration?.days || 0,
        price: rawData.pricing?.basePrice || 0,
        country: rawData.location?.destinationCountry || "",
        city: rawData.location?.destinationCity || "",
        hotelGrade: rawData.accommodation?.hotelGrade || "",
      };

      // 調用技能系統
      const { labels, appliedSkills } = await applyLearnedSkills(contentForMatching, metadata);

      // 分類標籤
      const featureClassification: string[] = [];
      const transportationType: string[] = [];
      const highlightActivities: string[] = [];
      const accommodationType: string[] = [];

      // 根據標籤內容進行分類
      for (const label of labels) {
        // 特色分類
        if (
          label.includes("ESG") ||
          label.includes("永續") ||
          label.includes("美食") ||
          label.includes("文化") ||
          label.includes("自然") ||
          label.includes("生態")
        ) {
          featureClassification.push(label);
        }
        // 交通類型
        else if (
          label.includes("鐵道") ||
          label.includes("郵輪") ||
          label.includes("火車") ||
          label.includes("遊輪")
        ) {
          transportationType.push(label);
        }
        // 亮點活動
        else if (
          label.includes("特別") ||
          label.includes("獨家") ||
          label.includes("升級") ||
          label.includes("體驗")
        ) {
          highlightActivities.push(label);
        }
        // 住宿類型
        else if (
          label.includes("溫泉") ||
          label.includes("旅館") ||
          label.includes("酒店") ||
          label.includes("度假村")
        ) {
          accommodationType.push(label);
        }
        // 其他標籤歸類到特色分類
        else {
          featureClassification.push(label);
        }
      }

      const elapsed = Date.now() - startTime;
      console.log(`[ContentAnalyzerAgent] Skills applied in ${elapsed}ms`);
      console.log(`[ContentAnalyzerAgent] Generated labels: ${labels.join(", ")}`);

      return {
        labels,
        appliedSkills,
        featureClassification,
        transportationType,
        highlightActivities,
        accommodationType,
      };
    } catch (error) {
      console.error("[ContentAnalyzerAgent] Failed to apply skills:", error);
      return {
        labels: [],
        appliedSkills: [],
        featureClassification: [],
        transportationType: [],
        highlightActivities: [],
        accommodationType: [],
      };
    }
  }
}
