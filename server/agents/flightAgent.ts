/**
 * FlightAgent
 * Generates professional flight information for tours
 * 
 * Claude Hybrid Architecture: Uses Claude 3 Haiku for simple extraction
 */

import { getHaikuAgent, JSONSchema, STRICT_DATA_FIDELITY_RULES } from "./claudeAgent";
import { FLIGHT_SKILL } from "./skillLibrary";
import { getKeyInstructions } from "./skillLoader";

export interface FlightAgentResult {
  success: boolean;
  data?: {
    airline: string;
    outbound: {
      flightNo: string;
      departureTime: string;
      arrivalTime: string;
      duration: string;
      departureAirport: string;
      arrivalAirport: string;
    };
    inbound: {
      flightNo: string;
      departureTime: string;
      arrivalTime: string;
      duration: string;
      departureAirport: string;
      arrivalAirport: string;
    };
    description: string;
    features: string[];
  };
  error?: string;
}

export class FlightAgent {
  private skillInstructions: string;

  constructor() {
    this.skillInstructions = getKeyInstructions('FlightAgent');
    console.log('[FlightAgent] SKILL loaded:', this.skillInstructions.length, 'chars');
    console.log('[FlightAgent] Using Claude 3 Haiku with JSON Schema');
  }

  async execute(rawData: any): Promise<FlightAgentResult> {
    try {
      console.log("[FlightAgent] Starting flight information generation...");

      // Validate input data - support multiple field names
      const flightData = rawData?.flight || rawData?.flights || rawData?.flightInfo || null;
      
      if (!rawData || !flightData) {
        console.warn("[FlightAgent] No flight data provided");
        // Return default flight data instead of failing
        return {
          success: true,
          data: this.generateDefaultFlight(rawData),
        };
      }

      // Define JSON Schema for flight output
      const flightSchema: JSONSchema = {
        type: "object",
        properties: {
          airline: { type: "string", description: "航空公司名稱" },
          outbound: {
            type: "object",
            properties: {
              flightNo: { type: "string", description: "去程航班號" },
              departureTime: { type: "string", description: "去程出發時間" },
              arrivalTime: { type: "string", description: "去程抵達時間" },
              duration: { type: "string", description: "去程飛行時長" },
              departureAirport: { type: "string", description: "出發機場" },
              arrivalAirport: { type: "string", description: "抵達機場" },
            },
            required: ["flightNo", "departureTime", "arrivalTime", "duration", "departureAirport", "arrivalAirport"],
          },
          inbound: {
            type: "object",
            properties: {
              flightNo: { type: "string", description: "回程航班號" },
              departureTime: { type: "string", description: "回程出發時間" },
              arrivalTime: { type: "string", description: "回程抵達時間" },
              duration: { type: "string", description: "回程飛行時長" },
              departureAirport: { type: "string", description: "出發機場" },
              arrivalAirport: { type: "string", description: "抵達機場" },
            },
            required: ["flightNo", "departureTime", "arrivalTime", "duration", "departureAirport", "arrivalAirport"],
          },
          description: { type: "string", description: "航班描述（150-200字）" },
          features: {
            type: "array",
            items: { type: "string" },
            description: "航班特色列表",
          },
        },
        required: ["airline", "outbound", "inbound", "description", "features"],
      };

      // Build prompt
      const prompt = `
請根據以下航班資訊，生成專業的航班介紹：

航班資訊：
${JSON.stringify(rawData.flight, null, 2)}

請生成包含以下欄位的航班資訊：
- airline: 航空公司名稱
- outbound: 去程航班資訊（航班號、出發時間、抵達時間、飛行時長、出發機場、抵達機場）
- inbound: 回程航班資訊（航班號、出發時間、抵達時間、飛行時長、出發機場、抵達機場）
- description: 航班描述（150-200字，包含航空公司、航班時間、飛行時長、機上服務）
- features: 航班特色列表

**重要：如果提供的航班資訊不足，請根據目的地生成合理的預設航班資訊。**
`;

      // Call Claude with structured output
      const claudeAgent = getHaikuAgent();

      claudeAgent.setContext('FlightAgent', 'flight_search');
      const response = await claudeAgent.sendStructuredMessage<FlightAgentResult['data']>(
        prompt,
        flightSchema,
        {
          systemPrompt: `${FLIGHT_SKILL}\n\n${STRICT_DATA_FIDELITY_RULES}`,
          maxTokens: 2048,
          temperature: 0.5,
          schemaName: 'flight_output',
          schemaDescription: '航班資訊結構化輸出',
        }
      );

      if (!response.success || !response.data) {
        console.warn("[FlightAgent] Claude returned no data, using default flight");
        return {
          success: true,
          data: this.generateDefaultFlight(rawData),
        };
      }

      let parsedFlightData = response.data;

      // Regex 補強：從 Markdown 中提取 HH:MM 格式的時間
      if (flightData && typeof flightData === 'string') {
        const timeRegex = /\b([0-2]?[0-9]):([0-5][0-9])\b/g;
        const times = flightData.match(timeRegex);
        
        if (times && times.length >= 4) {
          // 假設順序：去程起飛、去程抵達、回程起飛、回程抵達
          if (!parsedFlightData.outbound.departureTime || parsedFlightData.outbound.departureTime === 'TBA') {
            parsedFlightData.outbound.departureTime = times[0];
          }
          if (!parsedFlightData.outbound.arrivalTime || parsedFlightData.outbound.arrivalTime === 'TBA') {
            parsedFlightData.outbound.arrivalTime = times[1];
          }
          if (!parsedFlightData.inbound.departureTime || parsedFlightData.inbound.departureTime === 'TBA') {
            parsedFlightData.inbound.departureTime = times[2];
          }
          if (!parsedFlightData.inbound.arrivalTime || parsedFlightData.inbound.arrivalTime === 'TBA') {
            parsedFlightData.inbound.arrivalTime = times[3];
          }
          console.log(`[FlightAgent] Regex 補強成功，提取到 ${times.length} 個時間`);
        }
      }

      // Validate word count for description
      if (parsedFlightData.description) {
        const wordCount = parsedFlightData.description.length;
        if (wordCount < 150 || wordCount > 200) {
          console.warn(
            `[FlightAgent] Flight description word count out of range: ${wordCount} (expected 150-200)`
          );
          // Truncate if too long
          if (wordCount > 200) {
            parsedFlightData.description = parsedFlightData.description.substring(0, 200) + "...";
          }
        }
      }

      console.log("[FlightAgent] Flight information generated successfully");
      return {
        success: true,
        data: parsedFlightData,
      };
    } catch (error) {
      console.error("[FlightAgent] Error:", error);
      // Return default flight data on error
      return {
        success: true,
        data: this.generateDefaultFlight(rawData),
      };
    }
  }
  
  /**
   * Generate default flight information when no data is available
   * 動態判斷出發機場和行程類型（國際 vs 國內）
   */
  private generateDefaultFlight(rawData: any): FlightAgentResult['data'] {
    const destination = rawData?.location?.destinationCity || rawData?.location?.destinationCountry || '目的地';
    const destinationCountry = rawData?.location?.destinationCountry || '';
    const sourceUrl = rawData?.sourceUrl || '';
    const rawContent = rawData?.rawContent || rawData?.renderedHtml || '';

    // ── 動態判斷出發機場 ──
    let departureAirport = '依實際訂位為準';
    const departureCity = rawData?.location?.departureCity || '';

    // 從原始內容搜尋出發地線索
    const departureMatch = rawContent.match(/(?:出發地|出發機場|集合地點|出發)[\uff1a:]+\s*(.+?)(?:\n|$)/);
    const deptHint = departureMatch?.[1]?.trim() || departureCity;

    if (/桃園|TPE|台北/.test(deptHint)) {
      departureAirport = '台北桃園國際機場 (TPE)';
    } else if (/高雄|KHH/.test(deptHint)) {
      departureAirport = '高雄國際機場 (KHH)';
    } else if (/松山|TSA/.test(deptHint)) {
      departureAirport = '台北松山機場 (TSA)';
    } else if (/San Francisco|SFO|舊金山/.test(deptHint)) {
      departureAirport = 'San Francisco International Airport (SFO)';
    } else if (/Los Angeles|LAX|洛衫磣/.test(deptHint)) {
      departureAirport = 'Los Angeles International Airport (LAX)';
    } else if (/成田|NRT/.test(deptHint)) {
      departureAirport = '成田國際機場 (NRT)';
    } else if (/關西|KIX/.test(deptHint)) {
      departureAirport = '關西國際機場 (KIX)';
    } else if (!deptHint) {
      // 沒有出發地資訊 → 根據行程來源網站推斷
      if (/liontravel|colatour|settour|eztravel|kkday|klook/.test(sourceUrl)) {
        departureAirport = '台北桃園國際機場 (TPE)';
      }
    }

    // ── 偵測台灣國內行程 ──
    const isTaiwanDomestic = ['台灣'].includes(destinationCountry) ||
      /台北|台中|台南|高雄|花蓮|台東|墓丁|阿里山|日月潭|宜蘭|南投|澎湖|金門|馬祖/.test(destination);

    if (isTaiwanDomestic) {
      return {
        airline: '國內行程（無航班）',
        outbound: {
          flightNo: 'N/A',
          departureTime: '依行程表',
          arrivalTime: '依行程表',
          duration: '依行程表',
          departureAirport: departureAirport !== '依實際訂位為準' ? departureAirport : '集合地點依行程通知',
          arrivalAirport: destination,
        },
        inbound: {
          flightNo: 'N/A',
          departureTime: '依行程表',
          arrivalTime: '依行程表',
          duration: '依行程表',
          departureAirport: destination,
          arrivalAirport: departureAirport !== '依實際訂位為準' ? departureAirport : '依行程通知',
        },
        description: `本行程為台灣國內旅遊，交通方式依行程安排。具體集合地點與交通方式將於行前通知中說明。`,
        features: ['國內行程', '專車接送', '舶適交通'],
      };
    }

    // ── 國際行程 ──
    return {
      airline: '請依實際訂位為準',
      outbound: {
        flightNo: 'TBA',
        departureTime: '請依實際訂位為準',
        arrivalTime: '請依實際訂位為準',
        duration: '依航班為準',
        departureAirport: departureAirport,
        arrivalAirport: `${destination}國際機場`,
      },
      inbound: {
        flightNo: 'TBA',
        departureTime: '請依實際訂位為準',
        arrivalTime: '請依實際訂位為準',
        duration: '依航班為準',
        departureAirport: `${destination}國際機場`,
        arrivalAirport: departureAirport,
      },
      description: departureAirport !== '依實際訂位為準'
        ? `從${departureAirport}出發，搞乘國際航班前往${destination}。具體航班資訊將於訂位確認後提供。`
        : `搞乘國際航班前往${destination}，出發機場與航班資訊將於訂位確認後提供。`,
      features: ['國際航班', '贴心服務', '舶適座位'],
    };
  }
}
