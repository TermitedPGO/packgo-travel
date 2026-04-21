import { FlightAgent, FlightAgentResult } from "./flightAgent";
import { TrainAgent, TrainAgentResult } from "./trainAgent";

// 統一的交通資訊類型
export type TransportationType = 'FLIGHT' | 'TRAIN' | 'CAR' | 'CRUISE' | 'BUS' | 'UNKNOWN';

// 統一的交通資訊輸出格式
export interface TransportationInfo {
  type: TransportationType;
  typeName: string; // 中文名稱：飛機、火車、自駕、郵輪等
  
  // 通用欄位
  outbound: {
    vehicleNo: string; // 航班號/車次/船班
    departureTime: string;
    arrivalTime: string;
    duration: string;
    departurePoint: string; // 機場/車站/港口
    arrivalPoint: string;
  };
  inbound: {
    vehicleNo: string;
    departureTime: string;
    arrivalTime: string;
    duration: string;
    departurePoint: string;
    arrivalPoint: string;
  };
  
  description: string;
  features: string[];
  
  // 特定類型的額外資訊
  extra?: {
    // 火車專用
    trainType?: string;
    trainName?: string;
    route?: string[];
    
    // 飛機專用
    airline?: string;
    
    // 郵輪專用
    cruiseLine?: string;
    shipName?: string;
    
    // 自駕專用
    carType?: string;
    rentalCompany?: string;
  };
}

export interface TransportationAgentResult {
  success: boolean;
  data?: TransportationInfo;
  error?: string;
}

export class TransportationAgent {
  private flightAgent: FlightAgent;
  private trainAgent: TrainAgent;

  constructor() {
    this.flightAgent = new FlightAgent();
    this.trainAgent = new TrainAgent();
    console.log('[TransportationAgent] Initialized with sub-agents: Flight, Train');
  }

  /**
   * 根據行程類型執行對應的交通 Agent
   */
  async execute(rawData: any, tourType?: string): Promise<TransportationAgentResult> {
    try {
      console.log("[TransportationAgent] Starting transportation processing...");
      console.log("[TransportationAgent] Tour type:", tourType);

      // 識別交通類型
      const transportationType = this.identifyTransportationType(rawData, tourType);
      console.log("[TransportationAgent] Identified transportation type:", transportationType);

      // 根據類型調用對應的 Agent
      switch (transportationType) {
        case 'TRAIN':
          return await this.handleTrain(rawData, tourType);
        
        case 'CRUISE':
          return await this.handleCruise(rawData);
        
        case 'CAR':
          return await this.handleCar(rawData);
        
        case 'BUS':
          return await this.handleBus(rawData);
        
        case 'FLIGHT':
        default:
          return await this.handleFlight(rawData);
      }
    } catch (error) {
      console.error("[TransportationAgent] Error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 識別交通類型
   */
  private identifyTransportationType(rawData: any, tourType?: string): TransportationType {
    // 優先使用傳入的 tourType
    if (tourType) {
      if (tourType === 'MINGRI_TRAIN' || tourType === 'TRAIN') {
        return 'TRAIN';
      }
      if (tourType === 'CRUISE') {
        return 'CRUISE';
      }
      if (tourType === 'SELF_DRIVE' || tourType === 'CAR') {
        return 'CAR';
      }
      if (tourType === 'BUS') {
        return 'BUS';
      }
    }

    // 從原始資料中識別
    const searchText = JSON.stringify(rawData).toLowerCase();

    // International flight signals take priority over in-country train keywords.
    // Example: Italy 10-day tour titled "羅馬、威尼斯雙火車深度之旅" starts with 台北✈羅馬 —
    // the flight is the primary transport, the trains are an in-country feature.
    const flightSignals = [
      '✈', '機場', '航空', '航班', 'airline', 'airport',
      '桃園國際', '成田', '關西', '仁川', '樟宜', '浦東', '首都',
      '羅馬菲烏米奇諾', '戴高樂', '希斯洛', '法蘭克福',
    ];
    const hasFlightSignal = flightSignals.some(s => searchText.includes(s.toLowerCase()));

    // 火車關鍵字 — only classify as TRAIN if we DON'T also see a flight signal.
    // Taiwan-domestic train tours (鳴日 etc.) naturally lack international flight signals.
    const trainKeywords = ['鳴日', 'mingri', '火車', '列車', '台鐵', '高鐵', '普悠瑪', '太魯閣', '自強號', '車站', '南港站', '台北車站'];
    if (!hasFlightSignal) {
      for (const keyword of trainKeywords) {
        if (searchText.includes(keyword.toLowerCase())) {
          console.log(`[TransportationAgent] Found train keyword: ${keyword}`);
          return 'TRAIN';
        }
      }
    } else {
      console.log('[TransportationAgent] Flight signal present — skipping train-keyword match (international tour)');
    }

    // 郵輪關鍵字
    const cruiseKeywords = ['郵輪', '遊輪', 'cruise', '船', '港口', '航線'];
    for (const keyword of cruiseKeywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        return 'CRUISE';
      }
    }

    // 自駕關鍵字
    const carKeywords = ['自駕', '租車', 'self-drive', 'car rental', '開車'];
    for (const keyword of carKeywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        return 'CAR';
      }
    }

    // 巴士關鍵字
    const busKeywords = ['遊覽車', '巴士', 'bus', '專車'];
    for (const keyword of busKeywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        return 'BUS';
      }
    }

    // 預設為飛機
    return 'FLIGHT';
  }

  /**
   * 處理火車行程
   */
  private async handleTrain(rawData: any, tourType?: string): Promise<TransportationAgentResult> {
    console.log("[TransportationAgent] Delegating to TrainAgent...");
    
    const result = await this.trainAgent.execute(rawData, tourType);
    
    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error || 'TrainAgent failed',
      };
    }

    // 轉換為統一格式
    const trainData = result.data;
    return {
      success: true,
      data: {
        type: 'TRAIN',
        typeName: trainData.trainType || '火車',
        outbound: {
          vehicleNo: trainData.outbound.trainNo,
          departureTime: trainData.outbound.departureTime,
          arrivalTime: trainData.outbound.arrivalTime,
          duration: trainData.outbound.duration,
          departurePoint: trainData.outbound.departureStation,
          arrivalPoint: trainData.outbound.arrivalStation,
        },
        inbound: {
          vehicleNo: trainData.inbound.trainNo,
          departureTime: trainData.inbound.departureTime,
          arrivalTime: trainData.inbound.arrivalTime,
          duration: trainData.inbound.duration,
          departurePoint: trainData.inbound.departureStation,
          arrivalPoint: trainData.inbound.arrivalStation,
        },
        description: trainData.description,
        features: trainData.features,
        extra: {
          trainType: trainData.trainType,
          trainName: trainData.trainName,
          route: trainData.route,
        },
      },
    };
  }

  /**
   * 處理飛機行程
   */
  private async handleFlight(rawData: any): Promise<TransportationAgentResult> {
    console.log("[TransportationAgent] Delegating to FlightAgent...");
    
    const result = await this.flightAgent.execute(rawData);
    
    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error || 'FlightAgent failed',
      };
    }

    // 轉換為統一格式
    const flightData = result.data;
    return {
      success: true,
      data: {
        type: 'FLIGHT',
        typeName: '飛機',
        outbound: {
          vehicleNo: flightData.outbound.flightNo,
          departureTime: flightData.outbound.departureTime,
          arrivalTime: flightData.outbound.arrivalTime,
          duration: flightData.outbound.duration,
          departurePoint: flightData.outbound.departureAirport,
          arrivalPoint: flightData.outbound.arrivalAirport,
        },
        inbound: {
          vehicleNo: flightData.inbound.flightNo,
          departureTime: flightData.inbound.departureTime,
          arrivalTime: flightData.inbound.arrivalTime,
          duration: flightData.inbound.duration,
          departurePoint: flightData.inbound.departureAirport,
          arrivalPoint: flightData.inbound.arrivalAirport,
        },
        description: flightData.description,
        features: flightData.features,
        extra: {
          airline: flightData.airline,
        },
      },
    };
  }

  /**
   * 處理郵輪行程（暫時使用預設值）
   */
  private async handleCruise(rawData: any): Promise<TransportationAgentResult> {
    console.log("[TransportationAgent] Generating default cruise info...");
    
    const destination = rawData?.location?.destinationCity || '目的地';
    
    return {
      success: true,
      data: {
        type: 'CRUISE',
        typeName: '郵輪',
        outbound: {
          vehicleNo: 'TBA',
          departureTime: '請依實際訂位為準',
          arrivalTime: '請依實際訂位為準',
          duration: '請依航程為準',
          departurePoint: '基隆港',
          arrivalPoint: `${destination}港`,
        },
        inbound: {
          vehicleNo: 'TBA',
          departureTime: '請依實際訂位為準',
          arrivalTime: '請依實際訂位為準',
          duration: '請依航程為準',
          departurePoint: `${destination}港`,
          arrivalPoint: '基隆港',
        },
        description: `搭乘豪華郵輪前往${destination}，在海上享受頂級的住宿和餐飲服務。郵輪上設有多種娛樂設施，讓您在航程中也能盡情享受假期。`,
        features: ['豪華郵輪', '海上住宿', '多元娛樂', '精緻餐飲'],
        extra: {
          cruiseLine: '請依實際訂位為準',
          shipName: '請依實際訂位為準',
        },
      },
    };
  }

  /**
   * 處理自駕行程（暫時使用預設值）
   */
  private async handleCar(rawData: any): Promise<TransportationAgentResult> {
    console.log("[TransportationAgent] Generating default car rental info...");
    
    const destination = rawData?.location?.destinationCity || '目的地';
    
    return {
      success: true,
      data: {
        type: 'CAR',
        typeName: '自駕',
        outbound: {
          vehicleNo: '租車',
          departureTime: '自由安排',
          arrivalTime: '自由安排',
          duration: '自由安排',
          departurePoint: '租車點',
          arrivalPoint: destination,
        },
        inbound: {
          vehicleNo: '租車',
          departureTime: '自由安排',
          arrivalTime: '自由安排',
          duration: '自由安排',
          departurePoint: destination,
          arrivalPoint: '還車點',
        },
        description: `自駕遊覽${destination}，享受自由自在的旅行體驗。您可以按照自己的節奏探索當地風光，隨時停留欣賞沿途美景。`,
        features: ['自由行程', '彈性安排', '深度探索', '沿途風光'],
        extra: {
          carType: '請依實際訂位為準',
          rentalCompany: '請依實際訂位為準',
        },
      },
    };
  }

  /**
   * 處理巴士行程（暫時使用預設值）
   */
  private async handleBus(rawData: any): Promise<TransportationAgentResult> {
    console.log("[TransportationAgent] Generating default bus info...");
    
    const destination = rawData?.location?.destinationCity || '目的地';
    
    return {
      success: true,
      data: {
        type: 'BUS',
        typeName: '遊覽車',
        outbound: {
          vehicleNo: '專車',
          departureTime: '請依行程表為準',
          arrivalTime: '請依行程表為準',
          duration: '請依行程為準',
          departurePoint: '集合地點',
          arrivalPoint: destination,
        },
        inbound: {
          vehicleNo: '專車',
          departureTime: '請依行程表為準',
          arrivalTime: '請依行程表為準',
          duration: '請依行程為準',
          departurePoint: destination,
          arrivalPoint: '解散地點',
        },
        description: `搭乘舒適的遊覽車前往${destination}，全程由專業司機駕駛，讓您輕鬆享受旅程。車上配備空調和舒適座椅，確保您的旅途舒適愉快。`,
        features: ['專車接送', '舒適座椅', '專業司機', '空調車廂'],
      },
    };
  }
}
