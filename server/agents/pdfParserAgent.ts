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
// v80.24: shared parseLlmJson util — strips markdown fences before JSON.parse.
import { parseLlmJson } from "../_core/parseLlmJson";

type ProgressCallback = (progress: { current: number; total: number; message: string; percentage?: number }) => Promise<void>;

export interface PdfParseResult {
  title: string;
  subtitle: string;
  productCode: string;
  departureDate: string;
  returnDate: string;
  allDepartureDates: string[];
  duration: number;
  price: number;
  adultPrice: number;
  childPrice: number;
  childPriceNoBed: number;
  infantPrice: number;
  singleSupplement: number;
  currency: string;
  totalSlots: number;
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
      // v80.24: was using default 8192 maxTokens which truncated long itineraries
      model: "claude-haiku-4-5-20251001",
      maxTokens: 32768,
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
    return parseLlmJson(content);
  } catch (error) {
    // v80.24: preserve cause for production debuggability (see analyzePdfWithLLM above)
    const err = error as Error & { status?: number };
    const cause = err?.message || String(error);
    const status = err?.status ? ` [HTTP ${err.status}]` : '';
    console.error(`[PdfParserAgent] Text-based LLM analysis failed${status}: ${cause}`, error);
    throw new Error(`Failed to analyze PDF text with LLM${status}: ${cause}`);
  }
}

// v80.24: parseLlmJson moved to shared util at server/_core/parseLlmJson.ts.

/**
 * 建立 JSON schema 指示（共用）
 *
 * v80.24 重大升級 — Jeff 反映之前生成「只有地名沒介紹、飯店少星級、被擠壓」。
 * 三個關鍵改進：
 * 1. activities[].description 強制至少 60 字，必含景點背景/特色/Why visit
 * 2. hotelInfo[] 加上 stars / brand / location / highlights / amenities
 * 3. 加 titleEnglish / poeticTitle 雙語標題（讓後續翻譯 pass 有起點）
 */
function buildJsonSchema(): string {
  return `
請以 JSON 格式回傳以下資訊（只回傳 JSON，不要有其他文字，所有內容必須為繁體中文）：
{
  "title": "行程標題（20-35 個繁體中文字，重新撰寫，禁止照抄供應商促銷話術）— v80.24 規則：(1) 禁止保留「兒童最高省X萬」「春遊折X千」「兒童最高省」「無購物」「指定團」「優惠團」「升等住X晚」「特選」「特推」「促銷」「破盤」等供應商促銷詞 (2) 禁止保留供應商標籤如「★保證入住」「★中餐特別安排」這種促銷標記 (3) 必須有 PACK&GO 自己風格的「賣點」感（路線特色、稀有體驗、季節氛圍）。範例：原「兒童最高省1萬｜親子樂園｜環球影城.樂高.水族館」→ ✓「關西親子假期：環球影城・樂高樂園・恐龍王國六日」",
  "titleEnglish": "Title in English (5-10 words, evocative, e.g. 'Switzerland Alpine Discovery: Glaciers & Heritage Rail')",
  "poeticTitle": "詩意化副標題（15-25 個繁體中文字，文學感、有畫面，例：「越山尋夢，踏野拾光」「多瑙河畔的時光漫步」）",
  "subtitle": "行程副標題（一句話總結賣點）",
  "productCode": "產品代碼",
  "departureDate": "最早的出發日期，必須為 YYYY-MM-DD 格式（如 2026-05-15）。若無法確定精確日期，填空字串。",
  "returnDate": "回程日期，YYYY-MM-DD 格式。若無明確回程日，根據天數推算。",
  "allDepartureDates": "所有出發日期陣列，每個必須 YYYY-MM-DD 格式。如 [\"2026-05-01\", \"2026-05-08\"]。有多個梯次全部列出。若只有一個日期，也用陣列格式。",
  "adultPrice": "成人價格（純數字，去掉貨幣符號和逗號，如 NT$18,000 → 18000）",
  "childPrice": "兒童價格（有床）純數字。若無此資訊填 0。",
  "childPriceNoBed": "兒童不佔床價格，純數字。若無填 0。",
  "infantPrice": "嬰兒價格，純數字。若無填 0。",
  "singleSupplement": "單人房差價，純數字。若無填 0。",
  "currency": "價格幣值：TWD / USD / JPY / EUR / KRW / THB / VND / SGD / AUD / GBP / CHF。根據 PDF 內容判斷，無法確定預設 TWD。",
  "totalSlots": "團位人數上限，純數字。若無填 20。",
  "duration": 天數（數字）,
  "price": 成人價格（數字，如 NT$18,000 → 18000，與 adultPrice 相同）,
  "priceNote": "價格備註",
  "destinations": ["目的地1（繁中）", "目的地2"],
  "destinationsEnglish": ["English city name 1", "English city name 2"],
  "country": "國家（繁中）",
  "countryEnglish": "Country name in English",
  "highlights": ["6-10 個行程亮點，每個 15-40 個繁體中文字，必須具體（含景點/體驗/特殊安排），避免空泛形容詞如「精彩」「難忘」"],
  "dailyItinerary": [{
    "day": 1,
    "title": "第 X 天：城市A → 城市B（30 字內，含主要城市移動）",
    "description": "當天行程總覽（80-120 個繁體中文字，描述本日主軸與情緒重點）",
    "activities": [{
      "time": "08:00",
      "title": "景點/活動名稱（中英對照，例：羅浮宮 Louvre Museum）",
      "description": "至少 60 個繁體中文字。必須包含：(1) 景點背景或歷史 (2) 為什麼值得去（特色/獨特性）(3) 旅客現場會看到/體驗到什麼。禁止只寫「參觀 X」「遊覽 Y」這種空話。",
      "location": "詳細地點（區域/街道，如「巴黎第一區，塞納河右岸」）",
      "transportation": "交通方式（步行/巴士/地鐵/纜車等）",
      "duration": "建議停留時間（如「2 小時」「半天」）",
      "openingHours": "開放時間（若有）",
      "ticketPrice": "門票/體驗費用（若有）"
    }],
    "meals": { "breakfast": "早餐（飯店或特色餐）", "lunch": "午餐（餐廳名稱+特色菜）", "dinner": "晚餐（餐廳名稱+特色菜）" },
    "hotel": "當晚住宿飯店全名（中英對照）"
  }],
  "costIncluded": ["費用包含項目（具體列出，如「五星級飯店住宿」「全程豪華遊覽車」「英文/中文導遊」）"],
  "costExcluded": ["費用不包含項目（具體，如「個人旅遊保險」「自費活動」「司機導遊小費（每日 USD 8）」）"],
  "notices": ["注意事項（簽證、護照效期、氣候、衣著、特殊提醒等，每條獨立完整）"],
  "hotelInfo": [{
    "name": "飯店名稱（中英對照，例：「東京文華東方酒店 Mandarin Oriental Tokyo」）",
    "stars": 5,
    "starsLabel": "五星級豪華",
    "brand": "飯店品牌（如 Mandarin Oriental / Marriott / 自營）",
    "city": "所在城市",
    "location": "具體位置描述（如「銀座中心，距東京站步行 5 分鐘」）",
    "highlights": ["3-5 個飯店亮點，每個 10-25 字（如「米其林三星餐廳駐店」「23 樓無邊際泳池」「設計師 Tony Chi 操刀」）"],
    "roomType": "代表房型（如「都會景觀客房 32 平米」）",
    "description": "飯店介紹（80-150 字，含設計理念、特色服務、為何選擇此飯店）",
    "nights": 1
  }]
}
重要規則：
1. 只回傳 JSON，不要有其他文字
2. 價格轉換為純數字（NT$18,000 → 18000）
3. 每日行程是最重要的部分。activities 必須詳實，每個 description 至少 60 字含景點背景介紹
4. 飯店資料必須完整：星級、品牌、位置、亮點都要抓，沒寫的根據常識推估（例如「四季酒店」必為五星）
5. 若某欄位真的無資料，使用空字串、空陣列或 0
6. 翻譯：地名同時提供中英文（titleEnglish、destinationsEnglish、countryEnglish）方便後續翻譯 pass`;
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
    // v80.24: was timing out at 120s on 2MB+ PDFs with Sonnet 4.5. Switched
    // to Haiku 4.5 — 3-5× faster, sufficient for structured extraction
    // with response_format=json_object (which forces schema adherence).
    // Also bumped maxTokens to 16K for long itineraries (30+ days).
    const response = await invokeLLM({
      model: "claude-haiku-4-5-20251001",
      // v80.24: bumped 16384 → 32768 — Taiwan 7-day 鳴日 itinerary truncated
      // at 22K. Long+multi-departure PDFs need more headroom.
      maxTokens: 32768,
      messages: [
        // v80.24 quality bump — brand-voice system prompt
        {
          role: "system" as any,
          content: `你是 PACK&GO 旅行社的資深文案總監兼行程編輯。
品牌定位：美國精品華語旅行社，服務追求品質的華語旅客。
品牌調性：雅奢但不浮誇、有溫度但不煽情、專業但不生硬。

從 PDF 提取資料時，請遵守：
1. 所有輸出必須使用繁體中文（台灣用語：飯店≠酒店、計程車≠出租車）
2. 景點/飯店名稱中英對照（例：羅浮宮 Louvre）
3. activity description 必須超過 60 字含背景/特色/體驗，禁止只寫「參觀某某」這種空話
4. 飯店一定要抓星級、品牌、位置、亮點 — 沒寫的根據常識推估（四季/麗思卡爾頓/文華東方一律算五星）
5. 標題要有「賣點」感，避免「精選之旅」這種泛用詞，用具體誘惑（路線/體驗/季節）
6. highlights 必須具體（含景點/體驗/特殊安排），不接受「精彩」「難忘」這種空形容詞`,
        },
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
    return parseLlmJson(content);
  } catch (error) {
    // v80.24: preserve original cause + message — old code threw a generic
    // "Failed to analyze PDF with LLM" which lost the actual reason (timeout?
    // 529 overloaded? bad JSON?) making production debugging impossible.
    const err = error as Error & { status?: number };
    const cause = err?.message || String(error);
    const status = err?.status ? ` [HTTP ${err.status}]` : '';
    console.error(`[PdfParserAgent] Direct PDF LLM analysis failed${status}: ${cause}`, error);
    throw new Error(`Failed to analyze PDF with LLM${status}: ${cause}`);
  }
}
export async function parsePdf(
  pdfUrl: string,
  onProgress?: ProgressCallback
): Promise<PdfParseResult> {
  console.log(`[PdfParserAgent] Starting PDF parsing: ${pdfUrl}`);
  const startTime = Date.now();

  // v80.24: hard 30s timeout. Without it, a slow/hung PDF host could lock
  // the BullMQ worker for the full lockDuration (40 min) before stalled-
  // recovery, then BullMQ retries × 3 = 2 hours of wasted resource on a
  // single bad URL.
  let pdfBuffer: Buffer | null = null;
  try {
    const pdfResp = await fetch(pdfUrl, { signal: AbortSignal.timeout(30_000) });
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

    // 日期驗證函數
    const isValidDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
    // 過濾有效出發日期
    const rawAllDates: string[] = Array.isArray(analysisResult.allDepartureDates)
      ? analysisResult.allDepartureDates.filter(isValidDate)
      : [];
    // departureDate 驗證與 fallback
    let departureDate = isValidDate(analysisResult.departureDate || '') ? analysisResult.departureDate : '';
    if (!departureDate && rawAllDates.length > 0) departureDate = rawAllDates[0];
    // returnDate 推算
    let returnDate = isValidDate(analysisResult.returnDate || '') ? analysisResult.returnDate : '';
    if (!returnDate && departureDate) {
      const d = new Date(departureDate);
      d.setDate(d.getDate() + (analysisResult.duration || 1) - 1);
      returnDate = d.toISOString().split('T')[0];
    }
    // v80.24: defensive Number coercion. Old code's `Number("NT$83,900")`
    // returns NaN → MySQL silently stores it as 0. Now we strip non-digit
    // chars first so currency-prefixed and comma-separated values parse.
    const toNumber = (raw: any): number => {
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
      if (raw == null) return 0;
      const cleaned = String(raw).replace(/[^\d.\-]/g, '');
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const adultPrice = Math.max(0, toNumber(analysisResult.adultPrice ?? analysisResult.price));
    const childPrice = Math.max(0, toNumber(analysisResult.childPrice));
    const childPriceNoBed = Math.max(0, toNumber(analysisResult.childPriceNoBed));
    const infantPrice = Math.max(0, toNumber(analysisResult.infantPrice));
    const singleSupplement = Math.max(0, toNumber(analysisResult.singleSupplement));
    const currency = analysisResult.currency || 'TWD';
    const totalSlots = Math.max(1, toNumber(analysisResult.totalSlots) || 20);

    // 構建結果
    const result: PdfParseResult = {
      title: analysisResult.title || "未命名行程",
      subtitle: analysisResult.subtitle || "",
      productCode: analysisResult.productCode || "",
      departureDate,
      returnDate,
      allDepartureDates: rawAllDates,
      adultPrice,
      childPrice,
      childPriceNoBed,
      infantPrice,
      singleSupplement,
      currency,
      totalSlots,
      duration: analysisResult.duration || 1,
      price: adultPrice || analysisResult.price || 0,
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
