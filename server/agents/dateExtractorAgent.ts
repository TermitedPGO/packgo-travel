/**
 * DateExtractorAgent
 * 使用 Claude Vision 分析網頁截圖，抽取出發日期、人數上限、分級價格
 *
 * Round 39 P0 升級：
 * - P0-Context: rawText 8K → 15K（讓 AI 看到頁面下方的價格）
 * - P0-Prompt: 強制搜尋策略 + Chain-of-Thought + 提高放棄門檻（不接受 price=0）
 * - P0-Harness: 5 策略 fallback chain + 結構化驗證（price≥1000 才接受）
 */

import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODELS } from './claudeAgent';
import { logLlmUsage } from '../llmUsageService';

export interface ExtractedTourMeta {
  departureDates: Array<{
    date: string;              // "2026-05-15"
    status: 'available' | 'almost_full' | 'sold_out';
    price?: number;            // 該日期的價格（如果不同日期不同價）
  }>;
  capacity: {
    maxParticipants: number;   // 每團人數上限（例如 32）
    minParticipants?: number;  // 成團最低人數（例如 16）
  };
  pricing: {
    adultPrice: number;
    childWithBedPrice?: number;
    childNoBedPrice?: number;
    infantPrice?: number;
    currency: 'TWD' | 'USD' | 'EUR' | 'JPY' | 'KRW' | 'THB' | 'AUD' | 'GBP' | 'CAD' | 'VND';
    priceNote?: string;        // "含稅"、"小費另計" 等
  };
  productCode?: string;        // 行程代碼
}

// priceHints 型別（來自 DynamicScrapeResult）
export interface PriceHints {
  adultPrice?: number;
  childWithBedPrice?: number;
  childNoBedPrice?: number;
  infantPrice?: number;
  rawPriceTexts: string[];
}

// 最大圖片大小（bytes），超過則壓縮
const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB

/**
 * 將 Buffer 轉成 base64 字串
 */
function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64');
}

/**
 * 壓縮圖片（如果超過大小限制，截取前半部分）
 */
function compressImage(buffer: Buffer): Buffer {
  if (buffer.length <= MAX_IMAGE_SIZE) return buffer;
  // 簡單截取前 4MB（JPEG 格式可以安全截取）
  console.warn(`[DateExtractor] Image too large (${buffer.length} bytes), truncating to ${MAX_IMAGE_SIZE} bytes`);
  return buffer.slice(0, MAX_IMAGE_SIZE);
}

/**
 * 從 rawText 用正則表達式嘗試抽取日期（fallback）
 */
function extractDatesFromText(rawText: string): ExtractedTourMeta['departureDates'] {
  const dates: ExtractedTourMeta['departureDates'] = [];
  
  // 匹配常見日期格式：2026/05/15, 2026-05-15, 2026.05.15
  const datePatterns = [
    /20\d{2}[\/\-\.](0[1-9]|1[0-2])[\/\-\.](0[1-9]|[12]\d|3[01])/g,
    /(0[1-9]|1[0-2])[\/\-\.](0[1-9]|[12]\d|3[01])[\/\-\.]20\d{2}/g,
  ];
  
  const foundDates = new Set<string>();
  
  for (const pattern of datePatterns) {
    const matches = rawText.match(pattern) || [];
    for (const match of matches) {
      // 標準化日期格式
      const parts = match.split(/[\/\-\.]/);
      if (parts.length === 3) {
        let year: string, month: string, day: string;
        if (parts[0].length === 4) {
          [year, month, day] = parts;
        } else {
          [month, day, year] = parts;
        }
        const normalized = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        foundDates.add(normalized);
      }
    }
  }
  
  // 只保留未來的日期
  const now = new Date();
  for (const dateStr of Array.from(foundDates)) {
    const date = new Date(dateStr);
    if (date > now) {
      dates.push({ date: dateStr, status: 'available' });
    }
  }
  
  return dates.slice(0, 20); // 最多 20 個日期
}

// ============================================================
// P0-Harness: 5 策略 Fallback Chain（價格抽取）
// ============================================================

/**
 * 策略 1: 帶前綴的精確匹配（成人/大人/Adult + 數字）
 */
function strategy1_prefixMatch(rawText: string): number | undefined {
  const patterns = [
    /(?:成人|大人|Adult)\s*[：:＄$NT]*\s*([\d,]+)/i,
    /NT\$?\s*([\d,]+)\s*(?:\/人|\/位|起)/i,
    /(?:定價|售價|原價|特價)\s*[：:＄$NT]*\s*([\d,]+)/i,
    /\$\s*([\d,]+)\s*(?:TWD|元|起)/i,
    // 多幣別
    /(?:USD|US\$)\s*([\d,]+)/i,
    /(?:EUR|€)\s*([\d,]+)/i,
    /(?:JPY|¥|･)\s*([\d,]+)/i,
    /(?:GBP|£)\s*([\d,]+)/i,
    /([\d,]+)\s*円/i,
  ];
  for (const p of patterns) {
    const m = rawText.match(p);
    if (m) {
      const price = parseInt(m[1].replace(/,/g, ''));
      if (price >= 100 && price <= 9999999) return price;
    }
  }
  return undefined;
}

/**
 * 策略 2: 純數字 + 單位（5-6 位數 + 元/TWD）
 */
function strategy2_numberUnit(rawText: string): number | undefined {
  const patterns = [
    /([\d,]{5,7})\s*元/g,
    /NT\$?\s*([\d,]{5,7})/g,
    /([\d,]{5,7})\s*TWD/gi,
    // 多幣別
    /(?:USD|US\$)\s*([\d,]{3,10})/gi,
    /(?:EUR|€)\s*([\d,]{3,10})/gi,
    /(?:JPY|¥|･)\s*([\d,]{4,10})/gi,
    /([\d,]{4,10})\s*円/gi,
    /(?:GBP|£)\s*([\d,]{3,10})/gi,
  ];
  const candidates: number[] = [];
  for (const p of patterns) {
    let m: RegExpExecArray | null;
    const re = new RegExp(p.source, p.flags);
    while ((m = re.exec(rawText)) !== null) {
      const price = parseInt(m[1].replace(/,/g, ''));
      if (price >= 100 && price <= 9999999) candidates.push(price);
    }
  }
  if (candidates.length === 0) return undefined;
  // 取最高值（成人票通常最貴）
  return Math.max(...candidates);
}

/**
 * 策略 3: 上下文窗口掃描（取包含 "元" 或 "TWD" 的行，找最大數字）
 */
function strategy3_contextWindow(rawText: string): number | undefined {
  const lines = rawText.split('\n');
  const candidates: number[] = [];
  for (const line of lines) {
    if (/元|TWD|NT\$|USD|US\$|EUR|€|JPY|¥|円|GBP|£|KRW|₩|\$/.test(line)) {
      const nums = line.match(/[\d,]{4,7}/g) || [];
      for (const n of nums) {
        const price = parseInt(n.replace(/,/g, ''));
        if (price >= 100 && price <= 9999999) candidates.push(price);
      }
    }
  }
  if (candidates.length === 0) return undefined;
  return Math.max(...candidates);
}

/**
 * 策略 4: 寬鬆數字掃描（任何 5 位數以上的數字，取中位數）
 */
function strategy4_looseScan(rawText: string): number | undefined {
  const nums = rawText.match(/\b([\d,]{5,7})\b/g) || [];
  const candidates: number[] = [];
  for (const n of nums) {
    const price = parseInt(n.replace(/,/g, ''));
    if (price >= 100 && price <= 9999999) candidates.push(price);
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => a - b);
  // 取中位數（避免極端值）
  return candidates[Math.floor(candidates.length / 2)];
}

/**
 * 策略 5: priceHints 直接使用（來自 JS DOM 擷取）
 */
function strategy5_priceHints(priceHints?: PriceHints): number | undefined {
  return priceHints?.adultPrice;
}

/**
 * P0-Harness: 5 策略 fallback chain 主函式
 * 依序嘗試 5 種策略，第一個成功的結果即返回
 * 如果全部失敗，返回 undefined（不填 0！）
 */
function extractPriceWithFallbackChain(rawText: string, priceHints?: PriceHints): {
  adultPrice: number | undefined;
  strategyUsed: string;
} {
  // 策略 5 優先（JS DOM 擷取最可靠）
  const s5 = strategy5_priceHints(priceHints);
  if (s5 !== undefined) {
    console.log(`[DateExtractor] ✓ Price strategy 5 (priceHints): ${s5}`);
    return { adultPrice: s5, strategyUsed: 'priceHints' };
  }

  const s1 = strategy1_prefixMatch(rawText);
  if (s1 !== undefined) {
    console.log(`[DateExtractor] ✓ Price strategy 1 (prefix match): ${s1}`);
    return { adultPrice: s1, strategyUsed: 'prefix_match' };
  }

  const s2 = strategy2_numberUnit(rawText);
  if (s2 !== undefined) {
    console.log(`[DateExtractor] ✓ Price strategy 2 (number+unit): ${s2}`);
    return { adultPrice: s2, strategyUsed: 'number_unit' };
  }

  const s3 = strategy3_contextWindow(rawText);
  if (s3 !== undefined) {
    console.log(`[DateExtractor] ✓ Price strategy 3 (context window): ${s3}`);
    return { adultPrice: s3, strategyUsed: 'context_window' };
  }

  const s4 = strategy4_looseScan(rawText);
  if (s4 !== undefined) {
    console.log(`[DateExtractor] ✓ Price strategy 4 (loose scan): ${s4}`);
    return { adultPrice: s4, strategyUsed: 'loose_scan' };
  }

  console.warn(`[DateExtractor] ⚠ All 5 price strategies failed — marking as pending manual input`);
  return { adultPrice: undefined, strategyUsed: 'none' };
}

/**
 * P0-Harness: 結構化驗證（不接受 price=0 或 price<1000）
 */
function validatePrice(price: number | undefined): number {
  if (price === undefined || price === null) return 0;
  if (price < 1000) {
    console.warn(`[DateExtractor] ⚠ Price ${price} rejected (< 1000 TWD), setting to 0`);
    return 0;
  }
  return price;
}

/**
 * 從 rawText 用正則表達式抽取價格（增強版 fallback，整合 5 策略 chain）
 * 支援多種格式：NT$45,800、45800元、成人 45,800、大人 45800 等
 */
export function extractPriceFromText(rawText: string, priceHints?: PriceHints): Partial<ExtractedTourMeta['pricing']> {
  // 偵測幣別
  let detectedCurrency: ExtractedTourMeta['pricing']['currency'] = 'TWD'; // 預設
  if (/USD|US\$/.test(rawText)) detectedCurrency = 'USD';
  else if (/EUR|€/.test(rawText)) detectedCurrency = 'EUR';
  else if (/JPY|¥|円/.test(rawText)) detectedCurrency = 'JPY';
  else if (/GBP|£/.test(rawText)) detectedCurrency = 'GBP';
  else if (/KRW|₩|원/.test(rawText)) detectedCurrency = 'KRW';
  else if (/THB|฿/.test(rawText)) detectedCurrency = 'THB';
  else if (/AUD|A\$/.test(rawText)) detectedCurrency = 'AUD';
  else if (/VND/.test(rawText)) detectedCurrency = 'VND';

  const result: Partial<ExtractedTourMeta['pricing']> = { currency: detectedCurrency };

  // 使用 5 策略 fallback chain 抽取成人價格
  const { adultPrice } = extractPriceWithFallbackChain(rawText, priceHints);
  result.adultPrice = validatePrice(adultPrice);

  // 小孩佔床
  const childBedPatterns = [
    /(?:小孩佔床|孩童佔床|兒童佔床|Child with bed)\s*[：:＄$NT]*\s*([\d,]+)/i,
    /佔床\s*[：:＄$NT]*\s*([\d,]+)/i,
  ];
  for (const pattern of childBedPatterns) {
    const match = rawText.match(pattern);
    if (match) {
      const price = parseInt(match[1].replace(/,/g, ''));
      if (price >= 500 && price <= 500000) {
        result.childWithBedPrice = price;
        break;
      }
    }
  }
  
  // 小孩不佔床
  const childNoBedPatterns = [
    /(?:小孩不佔床|孩童不佔床|兒童不佔床|Child no bed)\s*[：:＄$NT]*\s*([\d,]+)/i,
    /不佔床\s*[：:＄$NT]*\s*([\d,]+)/i,
  ];
  for (const pattern of childNoBedPatterns) {
    const match = rawText.match(pattern);
    if (match) {
      const price = parseInt(match[1].replace(/,/g, ''));
      if (price >= 500 && price <= 500000) {
        result.childNoBedPrice = price;
        break;
      }
    }
  }
  
  // 嬰兒
  const infantPatterns = [
    /(?:嬰兒|Infant)\s*[：:＄$NT]*\s*([\d,]+)/i,
  ];
  for (const pattern of infantPatterns) {
    const match = rawText.match(pattern);
    if (match) {
      const price = parseInt(match[1].replace(/,/g, ''));
      if (price >= 0 && price <= 100000) {
        result.infantPrice = price;
        break;
      }
    }
  }
  
  // 價格備註
  const notePatterns = [
    /(?:含稅|含稅費|含服務費|不含稅|小費另計|小費自理)/,
  ];
  for (const pattern of notePatterns) {
    const match = rawText.match(pattern);
    if (match) {
      result.priceNote = match[0];
      break;
    }
  }
  
  console.log(`[DateExtractor] extractPriceFromText: adultPrice=${result.adultPrice}, childWithBed=${result.childWithBedPrice}, childNoBed=${result.childNoBedPrice}`);
  return result;
}

/**
 * 使用 Claude Vision 分析截圖，抽取行程元數據
 * @param priceHints - 來自 DynamicScraper 的 JS 價格擷取結果（可選）
 *
 * Round 39 P0-Prompt 升級：
 * - 強制搜尋策略：禁止直接回傳 0，必須窮盡所有候選數字
 * - Chain-of-Thought：要求 AI 先列出所有候選數字再選最佳
 * - 提高放棄門檻：只有真的找不到才標記 null
 */
export async function extractTourMeta(
  screenshots: { fullPage: Buffer; dateSection?: Buffer; priceSection?: Buffer },
  rawText: string,
  sourceUrl: string,
  priceHints?: PriceHints
): Promise<ExtractedTourMeta> {
  console.log(`[DateExtractor] Starting extraction for: ${sourceUrl}`);
  if (priceHints?.rawPriceTexts?.length) {
    console.log(`[DateExtractor] priceHints available: ${priceHints.rawPriceTexts.length} texts, adultPrice hint: ${priceHints.adultPrice}`);
  }
  
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  
  const client = new Anthropic({ apiKey });
  
  // 準備圖片內容
  const imageContents: any[] = [];
  
  // 優先使用局部截圖（準確度更高）
  if (screenshots.dateSection && screenshots.dateSection.length > 0) {
    const compressed = compressImage(screenshots.dateSection);
    imageContents.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: bufferToBase64(compressed),
      },
    });
    imageContents.push({
      type: 'text',
      text: '（以上是日期區塊截圖）',
    });
  }
  
  if (screenshots.priceSection && screenshots.priceSection.length > 0) {
    const compressed = compressImage(screenshots.priceSection);
    imageContents.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: bufferToBase64(compressed),
      },
    });
    imageContents.push({
      type: 'text',
      text: '（以上是價格區塊截圖）',
    });
  }
  
  // 如果沒有局部截圖，使用全頁截圖
  if (imageContents.length === 0 && screenshots.fullPage && screenshots.fullPage.length > 0) {
    const compressed = compressImage(screenshots.fullPage);
    imageContents.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: bufferToBase64(compressed),
      },
    });
    imageContents.push({
      type: 'text',
      text: '（以上是整頁截圖）',
    });
  }
  
  // P0-Context: rawText 8K → 15K（讓 AI 看到頁面下方的價格）
  const textSample = rawText.slice(0, 15000); // Round 39: 從 8000 擴展到 15000
  imageContents.push({
    type: 'text',
    text: `\n以下是頁面純文字（補充參考，請仔細搜尋其中的價格資訊）：\n${textSample}`,
  });
  
  // 加入 priceHints 作為額外參考（P0: 擴展到 10 筆，原本 5 筆）
  if (priceHints?.rawPriceTexts?.length) {
    const priceHintText = [
      `\n【JS DOM 直接擷取的價格線索（高可信度，請優先參考）】`,
      priceHints.adultPrice ? `JS 估算成人價格：${priceHints.adultPrice} TWD` : '',
      priceHints.childWithBedPrice ? `JS 估算小孩佔床：${priceHints.childWithBedPrice} TWD` : '',
      `JS 原始價格文字（前 10 筆）：\n${priceHints.rawPriceTexts.slice(0, 10).join('\n')}`,
    ].filter(Boolean).join('\n');
    imageContents.push({ type: 'text', text: priceHintText });
  }
  
  // 如果沒有任何截圖，只用文字
  const hasImages = imageContents.some(c => c.type === 'image');
  
  if (!hasImages) {
    console.warn('[DateExtractor] No screenshots available, using text-only fallback');
    // 直接從文字抽取日期和價格（使用 5 策略 chain）
    const textDates = extractDatesFromText(rawText);
    const textPricing = extractPriceFromText(rawText, priceHints);
    return {
      departureDates: textDates,
      capacity: { maxParticipants: 0 },
      pricing: {
        adultPrice: textPricing.adultPrice || 0,
        childWithBedPrice: textPricing.childWithBedPrice,
        childNoBedPrice: textPricing.childNoBedPrice,
        infantPrice: textPricing.infantPrice,
        currency: 'TWD',
        priceNote: textPricing.priceNote,
      },
    };
  }

  // ============================================================
  // P0-Prompt: 強制搜尋策略 + Chain-of-Thought 提示詞
  // ============================================================
  const prompt = `你是一個旅遊網站資料抽取專家。請分析這個旅遊行程網頁截圖和文字，抽取以下資訊：

1. 所有可選的出發日期（格式 YYYY-MM-DD）及各日期的狀態
2. 每團人數限制
3. 價格分級（成人、小孩佔床、小孩不佔床、嬰兒）
4. 行程代碼（如果有）

【強制搜尋規則 — 請嚴格遵守】：
- 你必須在截圖和文字中窮盡搜尋所有數字，不得輕易放棄
- 價格通常出現在頁面下方的「費用說明」、「團費」、「報名費」區塊
- 如果截圖中看不清楚，請從純文字中搜尋包含「元」、「TWD」、「NT$」、「成人」、「大人」的行
- 台灣旅遊行程的成人票價通常在 NT$20,000 ~ NT$200,000 之間
- 禁止直接回傳 adultPrice=0，除非你已確認整個頁面完全沒有任何價格資訊

【Chain-of-Thought 思考步驟】：
步驟 1: 先列出截圖和文字中所有看到的數字（4位數以上）
步驟 2: 判斷哪些數字是價格（有「元」「TWD」「NT$」「成人」「大人」等關鍵字）
步驟 3: 從候選價格中選出成人票價（通常是最高的那個）
步驟 4: 填入 JSON

【幣別辨識規則】：
- 看到 TWD / NT$ / NTD / 元 → currency: "TWD"
- 看到 USD / US$ → currency: "USD"
- 看到 EUR / € → currency: "EUR"
- 看到 JPY / ¥ / 円 → currency: "JPY"
- 看到 GBP / £ → currency: "GBP"
- 看到 KRW / ₩ / 원 → currency: "KRW"
- 看到 THB / ฿ → currency: "THB"
- 看到 AUD / A$ → currency: "AUD"
- 看到 VND → currency: "VND"
- 如果無法確定，根據網站語言和 URL 推測最可能的幣別

【日期格式規則】：
- 格式必須是 YYYY-MM-DD（例如 2026-05-15）
- 只回傳未來的日期（今天之後）

【輸出規則】：
- 以 JSON 格式回傳，不要有任何前言或解釋
- 如果某項資訊真的找不到，才回傳 null 或 0

JSON 格式：
{
  "departureDates": [
    {"date": "2026-05-15", "status": "available", "price": null},
    {"date": "2026-06-20", "status": "almost_full", "price": 45800}
  ],
  "capacity": {
    "maxParticipants": 32,
    "minParticipants": 16
  },
  "pricing": {
    "adultPrice": 45800,
    "childWithBedPrice": 42000,
    "childNoBedPrice": 38000,
    "infantPrice": 5000,
    "currency": "TWD",
    "priceNote": "含稅費"
  },
  "productCode": "ABC123"
}`;

  try {
    console.log(`[DateExtractor] Calling Claude Vision API with ${imageContents.length} content blocks...`);
    
    const response = await client.messages.create({
      model: CLAUDE_MODELS.SONNET_45, // 使用 Sonnet 以獲得更好的 Vision 能力
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContents,
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    });
    
    // 記錄 LLM 使用量
    logLlmUsage({
      agentName: 'DateExtractorAgent',
      taskType: 'tour_generation',
      model: CLAUDE_MODELS.SONNET_45,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }).catch(() => {});
    
    const content = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');
    
    console.log(`[DateExtractor] Claude response: ${content.slice(0, 200)}...`);
    
    // 解析 JSON 回應
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Claude response');
    }
    
    const extracted = JSON.parse(jsonMatch[0]) as ExtractedTourMeta;
    
    // ============================================================
    // P0-Harness: 結構化驗證 + 5 策略 fallback chain
    // ============================================================
    const claudeAdultPrice = extracted.pricing?.adultPrice || 0;

    // 如果 Claude 回傳 0 或無效價格，啟動 5 策略 fallback chain
    let finalAdultPrice = claudeAdultPrice;
    let priceSource = 'claude';
    if (claudeAdultPrice < 1000) {
      console.warn(`[DateExtractor] Claude returned invalid adultPrice=${claudeAdultPrice}, triggering 5-strategy fallback chain...`);
      const { adultPrice: fallbackPrice, strategyUsed } = extractPriceWithFallbackChain(rawText, priceHints);
      if (fallbackPrice !== undefined && fallbackPrice >= 1000) {
        finalAdultPrice = fallbackPrice;
        priceSource = `fallback:${strategyUsed}`;
        console.log(`[DateExtractor] ✓ Fallback price found: ${finalAdultPrice} (strategy: ${strategyUsed})`);
      } else {
        finalAdultPrice = 0;
        priceSource = 'none';
        console.warn(`[DateExtractor] ⚠ No valid price found after all 5 strategies — adultPrice=0, needs manual input`);
      }
    }

    const result: ExtractedTourMeta = {
      departureDates: (extracted.departureDates || []).filter(d => d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date)),
      capacity: {
        maxParticipants: extracted.capacity?.maxParticipants || 0,
        minParticipants: extracted.capacity?.minParticipants,
      },
      pricing: {
        adultPrice: validatePrice(finalAdultPrice),
        // 子女/嬰兒價格：Claude 優先，fallback 到 priceHints 或 regex
        childWithBedPrice: extracted.pricing?.childWithBedPrice
          || priceHints?.childWithBedPrice
          || extractPriceFromText(rawText).childWithBedPrice,
        childNoBedPrice: extracted.pricing?.childNoBedPrice
          || extractPriceFromText(rawText).childNoBedPrice,
        infantPrice: extracted.pricing?.infantPrice
          || priceHints?.infantPrice
          || extractPriceFromText(rawText).infantPrice,
        currency: extracted.pricing?.currency || 'TWD',
        priceNote: extracted.pricing?.priceNote || extractPriceFromText(rawText).priceNote,
      },
      productCode: extracted.productCode,
    };
    
    console.log(`[DateExtractor] ✓ Extracted ${result.departureDates.length} dates, maxParticipants: ${result.capacity.maxParticipants}, adultPrice: ${result.pricing.adultPrice} (source: ${priceSource}, claude: ${claudeAdultPrice})`);
    
    return result;
  } catch (err: any) {
    console.error('[DateExtractor] Claude Vision failed:', err.message);
    
    // Fallback：從純文字抽取日期和價格（使用 5 策略 chain）
    console.log('[DateExtractor] Falling back to text-based extraction with 5-strategy chain...');
    const textDates = extractDatesFromText(rawText);
    const { adultPrice: fallbackAdultPrice, strategyUsed } = extractPriceWithFallbackChain(rawText, priceHints);
    const textPricing = extractPriceFromText(rawText);
    
    console.log(`[DateExtractor] Text fallback: adultPrice=${fallbackAdultPrice} (strategy: ${strategyUsed})`);
    
    return {
      departureDates: textDates,
      capacity: { maxParticipants: 0 },
      pricing: {
        adultPrice: validatePrice(fallbackAdultPrice),
        childWithBedPrice: textPricing.childWithBedPrice,
        childNoBedPrice: textPricing.childNoBedPrice,
        infantPrice: textPricing.infantPrice,
        currency: 'TWD',
        priceNote: textPricing.priceNote,
      },
    };
  }
}
