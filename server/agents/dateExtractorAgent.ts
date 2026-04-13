/**
 * DateExtractorAgent
 * 使用 Claude Vision 分析網頁截圖，抽取出發日期、人數上限、分級價格
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
    currency: 'TWD' | 'USD';
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

/**
 * 從 rawText 用正則表達式抽取價格（增強版 fallback）
 * 支援多種格式：NT$45,800、45800元、成人 45,800、大人 45800 等
 */
export function extractPriceFromText(rawText: string): Partial<ExtractedTourMeta['pricing']> {
  const result: Partial<ExtractedTourMeta['pricing']> = { currency: 'TWD' };
  
  // 成人價格：多種前綴
  const adultPatterns = [
    /(?:成人|大人|Adult)\s*[：:＄$NT]*\s*([\d,]+)/i,
    /NT\$?\s*([\d,]+)\s*(?:\/人|\/位|起)/i,
    /(?:定價|售價|原價|特價)\s*[：:＄$NT]*\s*([\d,]+)/i,
    /\$\s*([\d,]+)\s*(?:TWD|元|起)/i,
    // 純數字 + 元（台幣常見格式）
    /([\d,]{5,6})\s*元/g,
  ];
  
  for (const pattern of adultPatterns) {
    const match = rawText.match(pattern);
    if (match) {
      const price = parseInt(match[1].replace(/,/g, ''));
      if (price >= 1000 && price <= 500000) {
        result.adultPrice = price;
        break;
      }
    }
  }
  
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
  
  // 加入純文字作為補充
  const textSample = rawText.slice(0, 8000); // 限制文字長度
  imageContents.push({
    type: 'text',
    text: `\n以下是頁面純文字（補充參考）：\n${textSample}`,
  });
  
  // 加入 priceHints 作為額外參考
  if (priceHints?.rawPriceTexts?.length) {
    const priceHintText = [
      `\n【JS 價格擷取結果（請優先參考）】`,
      priceHints.adultPrice ? `估算成人價格：${priceHints.adultPrice} TWD` : '',
      priceHints.childWithBedPrice ? `估算小孩佔床：${priceHints.childWithBedPrice} TWD` : '',
      `原始價格文字：\n${priceHints.rawPriceTexts.slice(0, 5).join('\n')}`,
    ].filter(Boolean).join('\n');
    imageContents.push({ type: 'text', text: priceHintText });
  }
  
  // 如果沒有任何截圖，只用文字
  const hasImages = imageContents.some(c => c.type === 'image');
  
  if (!hasImages) {
    console.warn('[DateExtractor] No screenshots available, using text-only fallback');
    // 直接從文字抽取日期和價格
    const textDates = extractDatesFromText(rawText);
    const textPricing = extractPriceFromText(rawText);
    // 優先使用 priceHints
    const adultPrice = priceHints?.adultPrice || textPricing.adultPrice || 0;
    return {
      departureDates: textDates,
      capacity: { maxParticipants: 0 },
      pricing: {
        adultPrice,
        childWithBedPrice: priceHints?.childWithBedPrice || textPricing.childWithBedPrice,
        childNoBedPrice: textPricing.childNoBedPrice,
        infantPrice: priceHints?.infantPrice || textPricing.infantPrice,
        currency: 'TWD',
        priceNote: textPricing.priceNote,
      },
    };
  }
  
  const prompt = `你是一個旅遊網站資料抽取專家。請分析這個旅遊行程網頁截圖，抽取以下資訊：

1. 所有可選的出發日期（格式 YYYY-MM-DD）及各日期的狀態（可報名/即將額滿/已售完）
2. 每團人數限制（上限和最低成團人數）
3. 價格分級（成人、小孩佔床、小孩不佔床、嬰兒）
4. 行程代碼（如果有）

重要規則：
- 如果某項資訊在截圖中找不到，回傳 null 或 0
- 日期格式必須是 YYYY-MM-DD（例如 2026-05-15）
- 只回傳未來的日期（今天之後）
- 價格單位為台幣（TWD）
- 以 JSON 格式回傳，不要有任何前言或解釋

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
    
    // 驗證和清理數據
    // 如果 Claude 沒有抽取到價格，使用 priceHints 或 regex fallback 補充
    const regexPricing = extractPriceFromText(rawText);
    const claudeAdultPrice = extracted.pricing?.adultPrice || 0;
    const fallbackAdultPrice = priceHints?.adultPrice || regexPricing.adultPrice || 0;
    
    const result: ExtractedTourMeta = {
      departureDates: (extracted.departureDates || []).filter(d => d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date)),
      capacity: {
        maxParticipants: extracted.capacity?.maxParticipants || 0,
        minParticipants: extracted.capacity?.minParticipants,
      },
      pricing: {
        // 優先使用 Claude 的結果，fallback 到 priceHints 或 regex
        adultPrice: claudeAdultPrice > 0 ? claudeAdultPrice : fallbackAdultPrice,
        childWithBedPrice: extracted.pricing?.childWithBedPrice || priceHints?.childWithBedPrice || regexPricing.childWithBedPrice,
        childNoBedPrice: extracted.pricing?.childNoBedPrice || regexPricing.childNoBedPrice,
        infantPrice: extracted.pricing?.infantPrice || priceHints?.infantPrice || regexPricing.infantPrice,
        currency: extracted.pricing?.currency || 'TWD',
        priceNote: extracted.pricing?.priceNote || regexPricing.priceNote,
      },
      productCode: extracted.productCode,
    };
    
    console.log(`[DateExtractor] Extracted ${result.departureDates.length} dates, maxParticipants: ${result.capacity.maxParticipants}, adultPrice: ${result.pricing.adultPrice} (claude: ${claudeAdultPrice}, fallback: ${fallbackAdultPrice})`);
    
    return result;
  } catch (err: any) {
    console.error('[DateExtractor] Claude Vision failed:', err.message);
    
    // Fallback：從純文字抽取日期和價格
    console.log('[DateExtractor] Falling back to text-based extraction...');
    const textDates = extractDatesFromText(rawText);
    const textPricing = extractPriceFromText(rawText);
    
    // 優先使用 priceHints，其次使用 regex 結果
    const adultPrice = priceHints?.adultPrice || textPricing.adultPrice || 0;
    
    return {
      departureDates: textDates,
      capacity: { maxParticipants: 0 },
      pricing: {
        adultPrice,
        childWithBedPrice: priceHints?.childWithBedPrice || textPricing.childWithBedPrice,
        childNoBedPrice: textPricing.childNoBedPrice,
        infantPrice: priceHints?.infantPrice || textPricing.infantPrice,
        currency: 'TWD',
        priceNote: textPricing.priceNote,
      },
    };
  }
}
