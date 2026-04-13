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
    
    // 簡化的系統提示
    const systemPrompt = `你是資深旅遊雜誌主編，專門撰寫有吸引力的旅遊文案。

重要規則：
- 所有輸出必須使用繁體中文，即使輸入資料是英文或其他語言，也必須翻譯為繁體中文。
- 地名、景點名稱可保留原文並加上中文譯名（例：科托爾灣 Kotor Bay）

風格要求：
1. 使用精煉的形容詞（雅奢、秘境、極致）
2. 加入動詞增加動感（尋蹤、漫遊、探索）
3. 使用感官細節描寫
4. 保持簡潔專業

禁用詞彙：靈魂、洗滯、光影、呵喃、心靈、深度對話、完美融合`;

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
