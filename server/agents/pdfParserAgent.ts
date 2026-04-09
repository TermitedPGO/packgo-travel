/**
 * PDF Parser Agent
 * 三層策略解析 PDF：
 * 1. pdf-parse 提取文字 → LLM 分析（最快，適合數位 PDF）
 * 2. pdftotext 提取文字 → LLM 分析（適合複雜排版）
 * 3. 直接傳 PDF URL 給 LLM（掃描版 PDF 備援）
 */

import { invokeLLM } from "../_core/llm";
import { logLlmUsage } from "../llmUsageService";
import { storagePut } from "../storage";
import { randomBytes } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { extractTextFromPdf, truncateForLLM } from "./pdfTextExtractor";
import * as os from "os";

type ProgressCallback = (progress: { current: number; total: number; message: string; percentage?: number }) => Promise<void>;

export interface PdfParseResult {
  title: string;
  subtitle: string;
  productCode: string;
  departureDate: string;
  duration: number;
  price: number;
  priceNote: string;
  destinations: string[];
  country: string;
  highlights: string[];
  dailyItinerary: DailyItinerary[];
  costDetails: CostDetails;
  notices: NoticeDetails;
  hotelInfo: HotelInfo[];
  images: ExtractedImage[];
  rawContent: string;
}

interface DailyItinerary {
  day: number;
  title: string;
  description: string;
  activities: Activity[];
  meals: { breakfast: string; lunch: string; dinner: string };
  hotel: string;
}

interface Activity {
  time: string;
  title: string;
  description: string;
  location: string;
  transportation: string;
}

interface CostDetails {
  included: string[];
  excluded: string[];
  extras: { name: string; price: string }[];
  notes: string;
}

interface NoticeDetails {
  beforeTrip: string[];
  cultural: string[];
  healthSafety: string[];
  emergency: string[];
}

interface HotelInfo {
  name: string;
  description: string;
  imageUrl?: string;
}

interface ExtractedImage {
  url: string;
  description: string;
  page: number;
  type: "hero" | "feature" | "hotel" | "activity" | "other";
}

/**
 * 建立給 LLM 的 JSON schema prompt（共用）
 */
function buildAnalysisPrompt(textContent?: string): string {
  const contextNote = textContent
    ? `以下是從 PDF 提取的文字內容，請根據此文字內容進行分析：\n\n<pdf_text>\n${textContent}\n</pdf_text>\n\n`
    : "";

  return `${contextNote}你是一位專業的旅遊行程分析師。請仔細分析這份旅遊行程 PDF 文件，並提取所有相關資訊。所有輸出必須使用繁體中文，包括標題、行程亮點、描述、景點名稱等。英文景點名請翻譯為繁體中文。`;
}

/**
 * 使用 LLM 分析 PDF（傳入文字內容，速度更快且準確）
 */
async function analyzePdfWithText(extractedText: string): Promise<any> {
  const truncatedText = truncateForLLM(extractedText, 80000);
  const prompt = `你是一位專業的旅遊行程分析師。以下是從 PDF 提取的文字內容，請根據此文字內容提取所有相關資訊。所有輸出必須使用繁體中文，英文景點名請翻譯為繁體中文。

<pdf_text>
${truncatedText}
</pdf_text>
`;

  const jsonSchema = buildJsonSchema();

  try {
    console.log(`[PdfParserAgent] Analyzing extracted text (${truncatedText.length} chars) with LLM...`);
    const response = await invokeLLM({
      messages: [
        {
          role: "user",
          content: prompt + jsonSchema,
        },
      ],
      response_format: { type: "json_object" },
    });
    // 記錄 LLM 用量
    if (response.usage) {
      logLlmUsage({
        agentName: 'PdfParserAgent',
        taskType: 'pdf_parsing',
        model: response.model || 'gemini-2.5-flash',
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      }).catch(() => { /* silent */ });
    }
    const rawContent = response.choices[0]?.message?.content || "{}";
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    console.log("[PdfParserAgent] Text-based LLM analysis completed");
    return JSON.parse(content);
  } catch (error) {
    console.error("[PdfParserAgent] Text-based LLM analysis failed:", error);
    throw new Error("Failed to analyze PDF text with LLM");
  }
}

/**
 * 建立 JSON schema 指示（共用）
 */
function buildJsonSchema(): string {
  return `
請以 JSON 格式回傳以下資訊（只回傳 JSON，不要有其他文字，所有內容必須為繁體中文）：
{
  "title": "行程標題",
  "subtitle": "行程副標題",
  "productCode": "產品代碼",
  "departureDate": "出發日期",
  "duration": 天數（數字）,
  "price": 價格（數字，如 NT$18,000 → 18000）,
  "priceNote": "價格備註",
  "destinations": ["目的地1", "目的地2"],
  "country": "國家",
  "highlights": ["行程亮點1", "行程亮點2"],
  "dailyItinerary": [{
    "day": 1,
    "title": "第一天標題",
    "description": "當天行程總覽",
    "activities": [{
      "time": "08:00",
      "title": "活動/景點名稱",
      "description": "詳細描述",
      "location": "地點",
      "transportation": "交通方式"
    }],
    "meals": { "breakfast": "早餐", "lunch": "午餐", "dinner": "晚餐" },
    "hotel": "住宿飯店名稱"
  }],
  "costIncluded": ["費用包含項目"],
  "costExcluded": ["費用不包含項目"],
  "notices": ["注意事項"],
  "hotelInfo": [{ "name": "飯店名稱", "description": "飯店描述" }]
}
重要規則：
1. 只回傳 JSON，不要有其他文字
2. 價格轉換為純數字（NT$18,000 → 18000）
3. 每日行程是最重要的部分，請完整提取每天的活動、餐食、住宿
4. 若某欄位無資料，使用空字串或空陣列`;
}

/**
 * 使用 LLM 直接分析 PDF 文件（掃描版備援）
 */
async function analyzePdfWithLLM(pdfUrl: string): Promise<any> {
  const jsonSchema = buildJsonSchema();
  const analysisPrompt = `你是一位專業的旅遊行程分析師。請仔細分析這份旅遊行程 PDF 文件，並提取所有相關資訊。所有輸出必須使用繁體中文，英文景點名請翻譯為繁體中文。
## 特別注意（雄獅旅遊 PDF 格式）：
- 價格通常在頁面右上角或標題下方，格式如：NT$ 18,000、$24,000 等
- 每日行程通常以「DAY 1」、「第一天」、「第1天」開頭
- 行程中的景點、餐廳、飯店通常有粗體標題
- 注意提取筐頭後的文字內容，這些是行程亮點
${jsonSchema}`;

  try {
    console.log(`[PdfParserAgent] Analyzing PDF URL directly with LLM (scan fallback)...`);
    const response = await invokeLLM({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file_url",
              file_url: {
                url: pdfUrl,
                mime_type: "application/pdf",
              },
            },
            {
              type: "text",
              text: analysisPrompt,
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });
    // 記錄 LLM 用量
    if (response.usage) {
      logLlmUsage({
        agentName: 'PdfParserAgent',
        taskType: 'pdf_parsing',
        model: response.model || 'gemini-2.5-flash',
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      }).catch(() => { /* silent */ });
    }
    const rawContent = response.choices[0]?.message?.content || "{}";
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    console.log("[PdfParserAgent] Direct PDF LLM analysis completed");
    return JSON.parse(content);
  } catch (error) {
    console.error("[PdfParserAgent] Direct PDF LLM analysis failed:", error);
    throw new Error("Failed to analyze PDF with LLM");
  }
}
export async function parsePdf(
  pdfUrl: string,
  onProgress?: ProgressCallback
): Promise<PdfParseResult> {
  console.log(`[PdfParserAgent] Starting PDF parsing: ${pdfUrl}`);
  const startTime = Date.now();

  // Download PDF buffer once for image extraction (non-fatal if fails)
  let pdfBuffer: Buffer | null = null;
  try {
    const pdfResp = await fetch(pdfUrl);
    if (pdfResp.ok) {
      pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
    }
  } catch (err) {
    console.warn('[PdfParserAgent] Could not download PDF buffer for image extraction:', err);
  }

  try {
    // 報告進度：開始分析
    if (onProgress) {
      await onProgress({
        current: 1,
        total: 3,
        percentage: 10,
        message: "正在讀取 PDF 文件...",
      });
    }

    // 使用 LLM 直接分析 PDF
    if (onProgress) {
      await onProgress({
        current: 2,
        total: 3,
        percentage: 30,
        message: "AI 正在分析行程內容...",
      });
    }

    const analysisResult = await analyzePdfWithLLM(pdfUrl);

    // 報告進度：整理結果
    if (onProgress) {
      await onProgress({
        current: 3,
        total: 3,
        percentage: 90,
        message: "正在整理分析結果...",
      });
    }

    // 構建結果
    const result: PdfParseResult = {
      title: analysisResult.title || "未命名行程",
      subtitle: analysisResult.subtitle || "",
      productCode: analysisResult.productCode || "",
      departureDate: analysisResult.departureDate || "",
      duration: analysisResult.duration || 1,
      price: analysisResult.price || 0,
      priceNote: analysisResult.priceNote || "",
      destinations: analysisResult.destinations || [],
      country: analysisResult.country || "台灣",
      highlights: analysisResult.highlights || [],
      dailyItinerary: (analysisResult.dailyItinerary || []).map((day: any) => ({
        day: day.day,
        title: day.title || `第 ${day.day} 天`,
        description: day.description || "",
        activities: day.activities || [],
        meals: day.meals || { breakfast: "", lunch: "", dinner: "" },
        hotel: day.hotel || "",
      })),
      costDetails: {
        included: analysisResult.costIncluded || [],
        excluded: analysisResult.costExcluded || [],
        extras: [],
        notes: "",
      },
      notices: {
        beforeTrip: analysisResult.notices || [],
        cultural: [],
        healthSafety: [],
        emergency: [],
      },
      hotelInfo: analysisResult.hotelInfo || [],
      images: await (async () => {
        if (!pdfBuffer) return [];
        try {
          const { extractImagesFromPdf } = await import('../services/pdfImageExtractor');
          const { uploadPdfImages } = await import('../services/imageIntelligenceService');
          const rawImages = await extractImagesFromPdf(pdfBuffer);
          if (rawImages.length === 0) return [];
          const uploaded = await uploadPdfImages(rawImages, analysisResult.title || 'tour');
          return uploaded.map(img => ({
            url: img.url,
            description: '',
            page: img.pageNumber,
            type: (img.type === 'hero' ? 'hero' : img.type === 'feature' ? 'feature' : 'other') as 'hero' | 'feature' | 'hotel' | 'activity' | 'other',
          }));
        } catch (imgErr) {
          console.warn('[PdfParserAgent] Image extraction failed (non-fatal):', imgErr);
          return [];
        }
        })(),
      rawContent: JSON.stringify(analysisResult, null, 2),    };

    const elapsed = Date.now() - startTime;
    console.log(`[PdfParserAgent] PDF parsing completed in ${elapsed}ms`);
    console.log(`[PdfParserAgent] Result: ${result.title}, ${result.duration} days`);

    return result;
  } catch (error) {
    console.error("[PdfParserAgent] PDF parsing failed:", error);
    throw error;
  }
}

/**
 * 從本地檔案解析 PDF
 */
export async function parsePdfFromFile(filePath: string): Promise<PdfParseResult> {
  // 讀取檔案並上傳到 S3，然後調用 parsePdf
  const buffer = await fs.readFile(filePath);
  const randomSuffix = randomBytes(8).toString("hex");
  const fileName = `temp-${Date.now()}-${randomSuffix}.pdf`;
  const fileKey = `pdf-uploads/${fileName}`;
  
  const { url } = await storagePut(fileKey, buffer, "application/pdf");
  return parsePdf(url);
}


/**
 * PdfParserAgent class - 包裝 parsePdf 函數以符合 Agent 介面
 */
export class PdfParserAgent {
  async execute(pdfUrl: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      console.log("[PdfParserAgent] Executing PDF parsing...");
      const result = await parsePdf(pdfUrl);
      
      // 將 PdfParseResult 轉換為 WebScraperAgent 相容的格式
      // 確保資料結構與 WebScraperAgent 完全一致
      const destinationCity = result.destinations?.join(', ') || '';
      const destinationCountry = result.country || '台灣';
      const days = result.duration || 1;
      const nights = days > 1 ? days - 1 : 0;
      
      const webScraperCompatibleData = {
        // basicInfo - 與 WebScraperAgent 相同的結構
        basicInfo: {
          title: result.title || '未命名行程',
          subtitle: result.subtitle || '',
          description: result.subtitle || '',
          productCode: result.productCode || '',
        },
        // location - 與 WebScraperAgent 相同的結構
        location: {
          destinationCountry,
          destinationCity,
        },
        // duration - 與 WebScraperAgent 相同的結構
        duration: {
          days,
          nights,
        },
        // pricing - 與 WebScraperAgent 相同的結構
        pricing: {
          price: result.price || 0,
          basePrice: result.price || 0,
          currency: 'TWD',
          priceNote: result.priceNote || '',
        },
        // highlights - 行程亮點
        highlights: result.highlights || [],
        // dailyItinerary - 每日行程（轉換為 WebScraperAgent 格式）
        dailyItinerary: (result.dailyItinerary || []).map((day: any) => ({
          day: day.day,
          title: day.title || `第 ${day.day} 天`,
          activities: (day.activities || []).map((act: any) => ({
            time: act.time || '',
            title: act.title || '',
            description: act.description || '',
            location: act.location || '',
            transportation: act.transportation || '',
          })),
          meals: {
            breakfast: day.meals?.breakfast || '',
            lunch: day.meals?.lunch || '',
            dinner: day.meals?.dinner || '',
          },
          accommodation: day.hotel || '',
        })),
        // includes/excludes - 費用包含/不包含
        includes: result.costDetails?.included || [],
        excludes: result.costDetails?.excluded || [],
        // accommodation - 住宿資訊
        accommodation: (result.hotelInfo || []).map((hotel: any) => hotel.name),
        // hotels - 飯店詳細資訊
        hotels: (result.hotelInfo || []).map((hotel: any) => ({
          name: hotel.name || '',
          description: hotel.description || '',
          imageUrl: hotel.imageUrl || '',
        })),
        // meals - 餐食資訊
        meals: [],
        // flights - 航班資訊
        flights: [],
        // notices - 注意事項
        notices: result.notices?.beforeTrip || [],
        // images - 提取的圖片（PDF 直接解析不提取圖片）
        images: result.images || [],
        // 原始資料
        rawContent: result.rawContent,
        // PDF 來源標記
        sourceUrl: pdfUrl,
        isPdfSource: true,
      };
      
      return {
        success: true,
        data: webScraperCompatibleData,
      };
    } catch (error) {
      console.error("[PdfParserAgent] Execution failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "PDF parsing failed",
      };
    }
  }
}
