/**
 * TrainAgent
 * Generates professional train information for tours
 * 
 * Claude Hybrid Architecture: Uses Claude 3 Haiku for simple extraction
 */

import { getHaikuAgent, JSONSchema, STRICT_DATA_FIDELITY_RULES } from "./claudeAgent";
import { getKeyInstructions, loadReference } from "./skillLoader";
import { reportFunnelError } from "../_core/errorFunnel";

export interface TrainAgentResult {
  success: boolean;
  data?: {
    trainType: string; // 火車類型：鳴日號、普悠瑪、太魯閣、自強號等
    trainName: string; // 火車名稱
    outbound: {
      trainNo: string;
      departureTime: string;
      arrivalTime: string;
      duration: string;
      departureStation: string;
      arrivalStation: string;
    };
    inbound: {
      trainNo: string;
      departureTime: string;
      arrivalTime: string;
      duration: string;
      departureStation: string;
      arrivalStation: string;
    };
    description: string;
    features: string[];
    route: string[]; // 沿途停靠站
  };
  error?: string;
}

export class TrainAgent {
  private skillInstructions: string;
  private taiwanTourTypes: string;

  constructor() {
    this.skillInstructions = getKeyInstructions('TrainAgent') || this.getDefaultSkill();
    this.taiwanTourTypes = loadReference('Taiwan-Tour-Types') || '';
    console.log('[TrainAgent] Initialized with Claude 3 Haiku');
    console.log('[TrainAgent] Loaded Taiwan-Tour-Types:', this.taiwanTourTypes.length, 'chars');
  }

  private getDefaultSkill(): string {
    return `
# TrainAgent SKILL

## 角色
你是台灣鐵路旅遊專家，專門處理火車行程的交通資訊。

## 專業知識
- 鳴日號：台鐵觀光列車，提供頂級服務，車廂設計融合台灣文化元素
- 山嵐號：花東縱谷旬味觀光列車，以「列車共鳴室」香氛體驗為特色
- 普悠瑪號：傾斜式列車，東部幹線主力
- 太魯閣號：傾斜式列車，花東線主力
- 自強號：傳統自強號列車

## 約束條件
- 必須根據原始資料提取正確的火車類型
- 不得將火車行程誤判為飛機行程
- 保留原始的車站名稱和時間資訊
`;
  }

  async execute(rawData: any, tourType?: string): Promise<TrainAgentResult> {
    try {
      console.log("[TrainAgent] Starting train information generation...");
      console.log("[TrainAgent] Tour type:", tourType);

      // 識別火車類型
      const trainType = this.identifyTrainType(rawData, tourType);
      console.log("[TrainAgent] Identified train type:", trainType);

      // 提取火車資訊
      const trainData = this.extractTrainData(rawData);

      if (!trainData) {
        console.warn("[TrainAgent] No train data found, generating default");
        return {
          success: true,
          data: this.generateDefaultTrain(rawData, trainType),
        };
      }

      // Define JSON Schema for train output
      const trainSchema: JSONSchema = {
        type: "object",
        properties: {
          trainType: { type: "string", description: "火車類型" },
          trainName: { type: "string", description: "火車名稱" },
          outbound: {
            type: "object",
            properties: {
              trainNo: { type: "string" },
              departureTime: { type: "string" },
              arrivalTime: { type: "string" },
              duration: { type: "string" },
              departureStation: { type: "string" },
              arrivalStation: { type: "string" },
            },
            required: ["trainNo", "departureTime", "arrivalTime", "duration", "departureStation", "arrivalStation"],
          },
          inbound: {
            type: "object",
            properties: {
              trainNo: { type: "string" },
              departureTime: { type: "string" },
              arrivalTime: { type: "string" },
              duration: { type: "string" },
              departureStation: { type: "string" },
              arrivalStation: { type: "string" },
            },
            required: ["trainNo", "departureTime", "arrivalTime", "duration", "departureStation", "arrivalStation"],
          },
          description: { type: "string", description: "火車旅遊描述" },
          features: { type: "array", items: { type: "string" }, description: "特色列表" },
          route: { type: "array", items: { type: "string" }, description: "停靠站列表" },
        },
        required: ["trainType", "trainName", "outbound", "inbound", "description", "features", "route"],
      };

      // Build prompt
      const prompt = `
請根據以下火車行程資訊，生成專業的火車旅遊介紹：

火車類型：${trainType}
原始資訊：
${JSON.stringify(trainData, null, 2)}

${this.taiwanTourTypes}

請生成包含以下欄位的火車資訊：
- trainType: 火車類型（鳴日號/普悠瑪/太魯閣/自強號等）
- trainName: 火車名稱（如：鳴日號觀光列車）
- outbound: 去程資訊（車次、出發時間、抵達時間、行車時長、出發車站、抵達車站）
- inbound: 回程資訊（車次、出發時間、抵達時間、行車時長、出發車站、抵達車站）
- description: 火車旅遊描述（150-200字，包含火車特色、沿途風景、車廂服務）
- features: 特色列表
- route: 停靠站列表

**重要約束**：
1. 必須根據原始資料填寫，不得創造不存在的資訊
2. 如果是鳴日號，必須強調其觀光列車特色
3. 車站名稱必須使用正式名稱（如：南港站、台東站、花蓮站）
`;

      // Call Claude with structured output
      const claudeAgent = getHaikuAgent();

      claudeAgent.setContext('TrainAgent', 'train_search');
      const response = await claudeAgent.sendStructuredMessage<TrainAgentResult['data']>(
        prompt,
        trainSchema,
        {
          systemPrompt: `${this.skillInstructions}\n\n${STRICT_DATA_FIDELITY_RULES}`,
          maxTokens: 2048,
          temperature: 0.5,
          schemaName: 'train_output',
          schemaDescription: '火車資訊結構化輸出',
        }
      );

      if (!response.success || !response.data) {
        console.warn("[TrainAgent] Claude returned no data, using default");
        return {
          success: true,
          data: this.generateDefaultTrain(rawData, trainType),
        };
      }

      console.log("[TrainAgent] Train information generated successfully");
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("[TrainAgent] Error:", error);
      reportFunnelError({ source: "fail-open:trainAgent:structuredGenFallback", err: error }).catch(() => {});
      return {
        success: true,
        data: this.generateDefaultTrain(rawData, 'TRAIN'),
      };
    }
  }

  /**
   * 識別火車類型
   */
  private identifyTrainType(rawData: any, tourType?: string): string {
    // 優先使用傳入的 tourType
    if (tourType === 'MINGRI_TRAIN') {
      return '鳴日號';
    }
    if (tourType === 'SHANLAN_TRAIN') {
      return '山嵐號';
    }

    // 從原始資料中識別
    const searchText = JSON.stringify(rawData).toLowerCase();
    
    // 山嵐號優先檢測（因為山嵐號行程可能也會提到鳴日號）
    if (searchText.includes('山嵐') || searchText.includes('shanlan') || searchText.includes('旬味觀光列車') || searchText.includes('列車共鳴室')) {
      return '山嵐號';
    }
    if (searchText.includes('鳴日') || searchText.includes('mingri')) {
      return '鳴日號';
    }
    if (searchText.includes('普悠瑪') || searchText.includes('puyuma')) {
      return '普悠瑪號';
    }
    if (searchText.includes('太魯閣') || searchText.includes('taroko')) {
      return '太魯閣號';
    }
    if (searchText.includes('自強')) {
      return '自強號';
    }

    return '火車';
  }

  /**
   * 從原始資料中提取火車資訊
   */
  private extractTrainData(rawData: any): any {
    // 嘗試從不同欄位提取火車資訊
    const trainData = rawData?.train || rawData?.transportation || rawData?.flight || null;
    
    if (trainData) {
      return trainData;
    }

    // 從行程內容中提取
    const itinerary = rawData?.itinerary || rawData?.dailyItinerary || [];
    if (Array.isArray(itinerary) && itinerary.length > 0) {
      // 從第一天和最後一天提取交通資訊
      const firstDay = itinerary[0];
      const lastDay = itinerary[itinerary.length - 1];
      
      return {
        firstDay: firstDay?.activities || firstDay?.description,
        lastDay: lastDay?.activities || lastDay?.description,
      };
    }

    return null;
  }

  /**
   * 生成預設火車資訊
   */
  private generateDefaultTrain(rawData: any, trainType: string): TrainAgentResult['data'] {
    const destination = rawData?.location?.destinationCity || '目的地';
    
    const isMingri = trainType === '鳴日號';
    const isShanlan = trainType === '山嵐號';
    
    return {
      trainType: trainType,
      trainName: isMingri ? '鳴日號觀光列車' : isShanlan ? '山嵐號觀光列車' : `台鐵${trainType}`,
      outbound: {
        trainNo: 'TBA',
        departureTime: '請依實際訂位為準',
        arrivalTime: '請依實際訂位為準',
        duration: '約 3-5 小時',
        departureStation: '南港站',
        arrivalStation: `${destination}站`,
      },
      inbound: {
        trainNo: 'TBA',
        departureTime: '請依實際訂位為準',
        arrivalTime: '請依實際訂位為準',
        duration: '約 3-5 小時',
        departureStation: `${destination}站`,
        arrivalStation: '南港站',
      },
      description: isMingri
        ? `搭乘台鐵最頂級的鳴日號觀光列車，沿著東部幹線飽覽台灣最美的山海風光。鳴日號以「移動的五星級飯店」為設計理念，車廂內部融合台灣原住民文化元素，提供頂級的乘車體驗。沿途經過壯麗的太平洋海岸線，讓您在舒適的環境中享受鐵道旅行的樂趣。`
        : isShanlan
        ? `搭乘花東縱谷旬味觀光列車「山嵐號」，穿越林木蒼翠的鐵道。車廂內設有全台首創「列車共鳴室」香氛體驗，透過精心調配的在地香氛，讓嗅覺與窗外的自然景致產生深度連結。沿途欣賞花東縱谷壯麗的山海風光，感受物換星移的魔幻氛圍。`
        : `搭乘台鐵${trainType}，沿著東部幹線前往${destination}。沿途欣賞台灣東部壯麗的山海風光，體驗鐵道旅行的獨特魅力。具體車次資訊將於訂位確認後提供。`,
      features: isMingri
        ? ['頂級觀光列車', '原住民文化車廂', '專屬餐飲服務', '沿途導覽解說']
        : isShanlan
        ? ['花東縱谷旬味觀光列車', '列車共鳴室香氛體驗', '在地青創甜點', '貼心管家服務']
        : ['舒適座位', '沿途風景', '便捷交通'],
      route: isMingri
        ? ['南港站', '石城站', '大里站', '東里站', '台東站', '花蓮站']
        : isShanlan
        ? ['南港站', '花蓮站', '台東站']
        : ['南港站', `${destination}站`],
    };
  }
}
