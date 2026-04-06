import { invokeLLM } from "./_core/llm";
import { logLlmUsage } from "./llmUsageService";
import { logAgentStart, logAgentComplete } from "./agentActivityService";
import { getDb } from "./db";
import { translations, translationJobs } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { redis } from "./redis";

// 翻譯快取：Redis（持久化）+ 記憶體（fallback）
// Redis key 格式：translate:{source}:{target}:{hash}
// TTL：7 天（604800 秒）
const TRANSLATION_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const TRANSLATION_CACHE_PREFIX = 'translate:';
const translationMemCache = new Map<string, string>(); // 記憶體 fallback
let redisAvailableForTranslation = true;

// 測試 Redis 連線
redis.ping().catch(() => {
  console.warn('[Translation Cache] Redis unavailable, using memory cache only');
  redisAvailableForTranslation = false;
});

async function getCachedTranslation(cacheKey: string): Promise<string | null> {
  const redisKey = `${TRANSLATION_CACHE_PREFIX}${cacheKey}`;
  // 先查 Redis
  if (redisAvailableForTranslation) {
    try {
      const cached = await redis.get(redisKey);
      if (cached) {
        // 同步到記憶體快取
        translationMemCache.set(cacheKey, cached);
        return cached;
      }
    } catch {
      redisAvailableForTranslation = false;
    }
  }
  // Fallback 到記憶體
  return translationMemCache.get(cacheKey) ?? null;
}

async function setCachedTranslation(cacheKey: string, value: string): Promise<void> {
  const redisKey = `${TRANSLATION_CACHE_PREFIX}${cacheKey}`;
  // 寫入記憶體
  translationMemCache.set(cacheKey, value);
  // 限制記憶體快取大小（最多 2000 筆）
  if (translationMemCache.size > 2000) {
    const firstKey = translationMemCache.keys().next().value;
    if (firstKey) translationMemCache.delete(firstKey);
  }
  // 寫入 Redis
  if (redisAvailableForTranslation) {
    try {
      await redis.setex(redisKey, TRANSLATION_CACHE_TTL, value);
    } catch {
      redisAvailableForTranslation = false;
    }
  }
}

// 支援的語言
export type Language = 'zh-TW' | 'en' | 'es' | 'ja' | 'ko';

// 語言名稱對應
const languageFullNames: Record<Language, string> = {
  'zh-TW': 'Traditional Chinese (Taiwan)',
  'en': 'English',
  'es': 'Spanish',
  'ja': 'Japanese',
  'ko': 'Korean',
};

// 語言原生名稱
const languageNativeNames: Record<Language, string> = {
  'zh-TW': '繁體中文',
  'en': 'English',
  'es': 'Español',
  'ja': '日本語',
  'ko': '한국어',
};

/**
 * Translation Agent - 使用 Claude API 進行高品質翻譯
 * 專為旅遊內容優化，支援多語言翻譯
 */
export async function translateText(
  text: string,
  targetLanguage: Language,
  sourceLanguage: Language = 'zh-TW'
): Promise<string> {
  // 如果目標語言和來源語言相同，直接返回
  if (targetLanguage === sourceLanguage) {
    return text;
  }

  // 空字串或純空白直接返回
  if (!text || !text.trim()) {
    return text;
  }

  // 檢查快取（Redis 優先，記憶體 fallback）
  const cacheKey = getCacheKey(text, sourceLanguage, targetLanguage);
  const cached = await getCachedTranslation(cacheKey);
  if (cached) {
    console.log('[Translation Agent] Cache hit');
    return cached;
  }

  // 偵測是否為 JSON 格式（陣列或物件）
  const trimmed = text.trim();
  const isJsonContent = (trimmed.startsWith('[') || trimmed.startsWith('{'));
  let parsedJson: any = null;
  if (isJsonContent) {
    try {
      parsedJson = JSON.parse(trimmed);
    } catch {
      // 不是有效 JSON，當作普通文字處理
    }
  }

  try {
    let systemPrompt: string;
    let userContent: string;

    if (parsedJson !== null) {
      // JSON 模式：要求 AI 保留結構，只翻譯文字值
      systemPrompt = `You are a professional translator specializing in travel and tourism content.
Your task is to translate text values inside a JSON structure from ${languageFullNames[sourceLanguage]} to ${languageFullNames[targetLanguage]}.

CRITICAL RULES:
- Return ONLY valid JSON with the EXACT same structure as the input
- Translate ONLY string values that contain natural language text
- DO NOT translate: JSON keys, numeric values, null, boolean, URLs, image paths, color codes, IDs
- DO NOT translate: single characters, short codes (e.g. "STAY", "EXPLORE"), style keywords
- Preserve all non-text fields (id, image, imageAlt, keywordStyle, labelColor, labelPosition, etc.) UNCHANGED
- For arrays of strings, translate each string element
- Output ONLY the JSON, no explanation, no markdown code blocks

TAIWAN PROPER NOUNS (MUST use official English names, never self-translate):
- 鳴日號 / 鳴日列車 → "The Future" or "NARU"
- 鳴日廚房 → "The Moving Kitchen"
- 太魯閣號 → "Taroko Express"
- 普悠瑪號 → "Puyuma Express"
- 自強號 → "Tzu-Chiang Limited Express"
- 莒光號 → "Chu-Kuang Express"
- 阿里山 → "Alishan"
- 日月潭 → "Sun Moon Lake"
- 九份 → "Jiufen"
- 君品酒店 → "Palais de Chine Hotel" (keep French brand name)
- 晶華酒店 → "Regent Taipei"
- 台灣高鐵 → "Taiwan High Speed Rail (THSR)"
- 台灣鐵路 / 台鐵 → "Taiwan Railways (TRA)"
If unsure of the official English name, keep the Chinese name and append "(Chinese name)"`;
      userContent = trimmed;
    } else {
      // 普通文字模式
      systemPrompt = `You are a professional translator specializing in travel and tourism content. 
Your task is to translate text from ${languageFullNames[sourceLanguage]} to ${languageFullNames[targetLanguage]}.

Guidelines:
- Maintain the original meaning and tone
- Use natural, fluent expressions in the target language
- Keep proper nouns (place names, brand names) appropriately translated or transliterated
- For travel-related terms, use industry-standard terminology
- Preserve any formatting (line breaks, punctuation)
- Only output the translated text, nothing else

TAIWAN PROPER NOUNS (MUST use official English names, never self-translate):
- 鳴日號 / 鳴日列車 → "The Future" or "NARU"
- 鳴日廚房 → "The Moving Kitchen"
- 太魯閣號 → "Taroko Express"
- 普悠瑪號 → "Puyuma Express"
- 自強號 → "Tzu-Chiang Limited Express"
- 莒光號 → "Chu-Kuang Express"
- 阿里山 → "Alishan"
- 日月潭 → "Sun Moon Lake"
- 九份 → "Jiufen"
- 君品酒店 → "Palais de Chine Hotel" (keep French brand name)
- 晶華酒店 → "Regent Taipei"
- 台灣高鐵 → "Taiwan High Speed Rail (THSR)"
- 台灣鐵路 / 台鐵 → "Taiwan Railways (TRA)"
If unsure of the official English name, keep the Chinese name and append "(Chinese name)"`;
      userContent = text;
    }

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userContent
        }
      ],
    });

    // 記錄 LLM 用量
    if (response.usage) {
      logLlmUsage({
        agentName: 'TranslationAgent',
        taskType: 'translation',
        model: response.model || 'gemini-2.5-flash',
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      }).catch(() => { /* silent */ });
    }
    const content = response.choices[0]?.message?.content;
    let translatedText = typeof content === 'string' ? content.trim() : text;
    
    // 如果輸入是 JSON，驗證輸出也是有效 JSON
    if (parsedJson !== null) {
      // 移除 AI 可能加的 markdown code block 標記
      translatedText = translatedText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      try {
        JSON.parse(translatedText); // 驗證 JSON 有效性
      } catch {
        // AI 輸出不是有效 JSON，回退到原始値
        console.warn('[Translation Agent] JSON translation output invalid, falling back to original');
        return text;
      }
    }
    
    // 儲存到快取（Redis 持久化 + 記憶體）
    await setCachedTranslation(cacheKey, translatedText);
    
    return translatedText;
  } catch (error) {
    console.error('[Translation Agent] Error:', error);
    // 翻譯失敗時返回原文
    return text;
  }
}

/**
 * 批量翻譯多個文字
 */
export async function translateBatch(
  texts: string[],
  targetLanguage: Language,
  sourceLanguage: Language = 'zh-TW'
): Promise<string[]> {
  if (texts.length === 0) return [];
  
  const results = await Promise.all(
    texts.map(text => translateText(text, targetLanguage, sourceLanguage))
  );
  return results;
}

/**
 * 翻譯物件中的指定欄位
 */
export async function translateObject<T extends Record<string, any>>(
  obj: T,
  fields: (keyof T)[],
  targetLanguage: Language,
  sourceLanguage: Language = 'zh-TW'
): Promise<T> {
  const result = { ...obj };
  
  for (const field of fields) {
    const value = obj[field];
    if (typeof value === 'string') {
      (result as any)[field] = await translateText(value, targetLanguage, sourceLanguage);
    }
  }
  
  return result;
}

/**
 * 翻譯行程內容
 * 將行程的標題、描述、每日行程等內容翻譯到指定語言
 */
export async function translateTour(
  tourId: number,
  targetLanguages: Language[],
  sourceLanguage: Language = 'zh-TW',
  userId: number
): Promise<{
  success: boolean;
  translatedLanguages: Language[];
  errors: string[];
}> {
  const db = await getDb();
  if (!db) {
    return { success: false, translatedLanguages: [], errors: ['Database not available'] };
  }

  const errors: string[] = [];
  const translatedLanguages: Language[] = [];
  const startTime = Date.now();
  let activityCompleted = false; // P0-5: Track if logAgentComplete was called

  // 記錄翻譯開始
  const activityId = await logAgentStart({
    agentName: 'TranslationAgent',
    agentKey: 'translator',
    taskType: 'translation',
    taskId: String(tourId),
    taskTitle: `翻譯行程 #${tourId} → ${targetLanguages.join(', ')}`,
    userId,
  });

  // P0-5: Ensure logAgentComplete is ALWAYS called via finally block
  // This prevents zombie tasks even if an unexpected error occurs
  const safeComplete = async (params: Parameters<typeof logAgentComplete>[1]) => {
    if (activityId && !activityCompleted) {
      activityCompleted = true;
      await logAgentComplete(activityId, params).catch((e) =>
        console.error('[TranslationAgent] Failed to log completion:', e)
      );
    }
  };

  try {
    // 獲取行程資料
    const { tours } = await import('../drizzle/schema');
    const [tour] = await db.select().from(tours).where(eq(tours.id, tourId));
    
    if (!tour) {
      await safeComplete({ status: 'failed', errorMessage: 'Tour not found' });
      return { success: false, translatedLanguages: [], errors: ['Tour not found'] };
    }

    // 需要翻譯的欄位（一般行程 + AI 生成行程）
    const fieldsToTranslate = [
      { name: 'title', value: tour.title },
      { name: 'description', value: tour.description },
      { name: 'highlights', value: tour.highlights },
      { name: 'includes', value: tour.includes },
      { name: 'excludes', value: tour.excludes },
      { name: 'notes', value: tour.notes },
      // AI 生成行程欄位
      { name: 'heroSubtitle', value: (tour as any).heroSubtitle },
      { name: 'keyFeatures', value: (tour as any).keyFeatures },
      { name: 'itineraryDetailed', value: (tour as any).itineraryDetailed },
      { name: 'costExplanation', value: (tour as any).costExplanation },
      { name: 'noticeDetailed', value: (tour as any).noticeDetailed },
    ];

    for (const targetLang of targetLanguages) {
      if (targetLang === sourceLanguage) continue;

      try {
        for (const field of fieldsToTranslate) {
          if (!field.value) continue;

          const translatedText = await translateText(
            field.value,
            targetLang,
            sourceLanguage
          );

          // 儲存翻譯到資料庫
          await saveTranslation({
            entityType: 'tour',
            entityId: tourId,
            fieldName: field.name,
            sourceLanguage,
            targetLanguage: targetLang,
            originalText: field.value,
            translatedText,
            translatedBy: `user:${userId}`,
          });
        }

        // 翻譯每日行程（如果有）
        if (tour.dailyItinerary) {
          const dailyItinerary = typeof tour.dailyItinerary === 'string' 
            ? JSON.parse(tour.dailyItinerary) 
            : tour.dailyItinerary;

          if (Array.isArray(dailyItinerary)) {
            const translatedItinerary = await Promise.all(
              dailyItinerary.map(async (day: any) => ({
                ...day,
                title: day.title ? await translateText(day.title, targetLang, sourceLanguage) : day.title,
                description: day.description ? await translateText(day.description, targetLang, sourceLanguage) : day.description,
                activities: day.activities ? await Promise.all(
                  day.activities.map(async (activity: any) => ({
                    ...activity,
                    name: activity.name ? await translateText(activity.name, targetLang, sourceLanguage) : activity.name,
                    description: activity.description ? await translateText(activity.description, targetLang, sourceLanguage) : activity.description,
                  }))
                ) : day.activities,
              }))
            );

            await saveTranslation({
              entityType: 'tour',
              entityId: tourId,
              fieldName: 'dailyItinerary',
              sourceLanguage,
              targetLanguage: targetLang,
              originalText: JSON.stringify(dailyItinerary),
              translatedText: JSON.stringify(translatedItinerary),
              translatedBy: `user:${userId}`,
            });
          }
        }

        translatedLanguages.push(targetLang);
        console.log(`[Translation Agent] Tour ${tourId} translated to ${targetLang}`);
      } catch (langError) {
        const errorMsg = `Failed to translate to ${targetLang}: ${langError}`;
        errors.push(errorMsg);
        console.error(`[Translation Agent] ${errorMsg}`);
      }
    }

    const processingTimeMs = Date.now() - startTime;
    await safeComplete({
      status: errors.length === 0 ? 'completed' : 'failed',
      processingTimeMs,
      resultSummary: errors.length === 0
        ? `🌐 行程「${tour.title || `#${tourId}`}」已翻譯成 ${translatedLanguages.join('、')}，共 ${fieldsToTranslate.filter(f => f.value).length} 個欄位，耗時 ${(processingTimeMs / 1000).toFixed(1)} 秒`
        : `⚠️ 翻譯部分失敗：${errors.slice(0, 2).join('; ')}`,
      errorMessage: errors.length > 0 ? errors.slice(0, 2).join('; ') : undefined,
    });
    return {
      success: errors.length === 0,
      translatedLanguages,
      errors,
    };
  } catch (error) {
    const errorMsg = `Translation failed: ${error}`;
    errors.push(errorMsg);
    console.error(`[Translation Agent] ${errorMsg}`);
    await safeComplete({ status: 'failed', errorMessage: errorMsg.slice(0, 500) });
    return { success: false, translatedLanguages, errors };
  } finally {
    // P0-5: Last-resort safety net - if somehow safeComplete was never called, complete now
    if (activityId && !activityCompleted) {
      activityCompleted = true;
      logAgentComplete(activityId, { 
        status: 'failed', 
        errorMessage: 'Translation ended unexpectedly (finally block)' 
      }).catch(() => {});
    }
  }
}

/**
 * 儲存翻譯到資料庫
 */
async function saveTranslation(data: {
  entityType: 'tour' | 'tour_departure' | 'page' | 'ui_element' | 'notification';
  entityId: number;
  fieldName: string;
  sourceLanguage: string;
  targetLanguage: string;
  originalText: string;
  translatedText: string;
  translatedBy?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error('[Translation Agent] Database not available');
    return;
  }

  try {
    // 檢查是否已存在
    const existing = await db.select().from(translations).where(
      and(
        eq(translations.entityType, data.entityType),
        eq(translations.entityId, data.entityId),
        eq(translations.fieldName, data.fieldName),
        eq(translations.targetLanguage, data.targetLanguage)
      )
    );

    if (existing.length > 0) {
      // 更新現有翻譯
      await db.update(translations).set({
        translatedText: data.translatedText,
        translatedBy: data.translatedBy,
        updatedAt: new Date(),
      }).where(eq(translations.id, existing[0].id));
    } else {
      // 插入新翻譯
      await db.insert(translations).values({
        entityType: data.entityType,
        entityId: data.entityId,
        fieldName: data.fieldName,
        sourceLanguage: data.sourceLanguage,
        targetLanguage: data.targetLanguage,
        originalText: data.originalText,
        translatedText: data.translatedText,
        translatedBy: data.translatedBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  } catch (error) {
    console.error('[Translation Agent] Failed to save translation:', error);
  }
}

/**
 * 批次獲取多筆行程的翻譯內容（避免 N+1 問題）
 */
export async function getBatchTourTranslations(
  tourIds: number[],
  targetLanguage: Language
): Promise<Record<number, Record<string, string>>> {
  if (tourIds.length === 0) return {};
  const db = await getDb();
  if (!db) return {};

  try {
    const { inArray } = await import('drizzle-orm');
    const results = await db.select().from(translations).where(
      and(
        eq(translations.entityType, 'tour'),
        inArray(translations.entityId, tourIds),
        eq(translations.targetLanguage, targetLanguage)
      )
    );

    const batchMap: Record<number, Record<string, string>> = {};
    for (const row of results) {
      if (!batchMap[row.entityId]) batchMap[row.entityId] = {};
      batchMap[row.entityId][row.fieldName] = row.translatedText;
    }
    return batchMap;
  } catch (error) {
    console.error('[Translation Agent] Failed to get batch tour translations:', error);
    return {};
  }
}

/**
 * 獲取行程的翻譯內容
 */
export async function getTourTranslations(
  tourId: number,
  targetLanguage: Language
): Promise<Record<string, string>> {
  const db = await getDb();
  if (!db) return {};

  try {
    const results = await db.select().from(translations).where(
      and(
        eq(translations.entityType, 'tour'),
        eq(translations.entityId, tourId),
        eq(translations.targetLanguage, targetLanguage)
      )
    );

    const translationMap: Record<string, string> = {};
    for (const row of results) {
      translationMap[row.fieldName] = row.translatedText;
    }
    return translationMap;
  } catch (error) {
    console.error('[Translation Agent] Failed to get tour translations:', error);
    return {};
  }
}

/**
 * 獲取行程的所有語言翻譯
 */
export async function getAllTourTranslations(
  tourId: number
): Promise<Record<Language, Record<string, string>>> {
  const db = await getDb();
  if (!db) return {} as Record<Language, Record<string, string>>;

  try {
    const results = await db.select().from(translations).where(
      and(
        eq(translations.entityType, 'tour'),
        eq(translations.entityId, tourId)
      )
    );

    const translationsByLang: Record<Language, Record<string, string>> = {} as any;
    for (const row of results) {
      const lang = row.targetLanguage as Language;
      if (!translationsByLang[lang]) {
        translationsByLang[lang] = {};
      }
      translationsByLang[lang][row.fieldName] = row.translatedText;
    }
    return translationsByLang;
  } catch (error) {
    console.error('[Translation Agent] Failed to get all tour translations:', error);
    return {} as Record<Language, Record<string, string>>;
  }
}

/**
 * 創建翻譯任務
 */
export async function createTranslationJob(data: {
  jobType: 'tour_full' | 'tour_update' | 'batch_tours' | 'ui_elements' | 'custom';
  entityType?: string;
  entityIds?: number[];
  targetLanguages: Language[];
  createdBy: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const [result] = await db.insert(translationJobs).values({
    jobType: data.jobType,
    entityType: data.entityType,
    entityIds: data.entityIds ? JSON.stringify(data.entityIds) : null,
    targetLanguages: JSON.stringify(data.targetLanguages),
    totalItems: data.entityIds?.length || 1,
    status: 'pending',
    createdBy: data.createdBy,
    createdAt: new Date(),
  });

  return result.insertId;
}

/**
 * 更新翻譯任務狀態
 */
export async function updateTranslationJobStatus(
  jobId: number,
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial',
  updates?: {
    completedItems?: number;
    failedItems?: number;
    results?: any;
    errors?: string[];
    processingTimeMs?: number;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const updateData: any = { status };
  
  if (status === 'processing' && !updates?.completedItems) {
    updateData.startedAt = new Date();
  }
  
  if (status === 'completed' || status === 'failed' || status === 'partial') {
    updateData.completedAt = new Date();
  }

  if (updates) {
    if (updates.completedItems !== undefined) updateData.completedItems = updates.completedItems;
    if (updates.failedItems !== undefined) updateData.failedItems = updates.failedItems;
    if (updates.results !== undefined) updateData.results = JSON.stringify(updates.results);
    if (updates.errors !== undefined) updateData.errors = JSON.stringify(updates.errors);
    if (updates.processingTimeMs !== undefined) updateData.processingTimeMs = updates.processingTimeMs;
  }

  await db.update(translationJobs).set(updateData).where(eq(translationJobs.id, jobId));
}

/**
 * 批量翻譯多個行程
 */
export async function translateMultipleTours(
  tourIds: number[],
  targetLanguages: Language[],
  userId: number
): Promise<{
  jobId: number;
  success: boolean;
  results: Array<{ tourId: number; success: boolean; languages: Language[]; errors: string[] }>;
}> {
  // 創建翻譯任務
  const jobId = await createTranslationJob({
    jobType: 'batch_tours',
    entityType: 'tour',
    entityIds: tourIds,
    targetLanguages,
    createdBy: userId,
  });

  const startTime = Date.now();
  await updateTranslationJobStatus(jobId, 'processing');

  const results: Array<{ tourId: number; success: boolean; languages: Language[]; errors: string[] }> = [];
  let completedCount = 0;
  let failedCount = 0;

  for (const tourId of tourIds) {
    const result = await translateTour(tourId, targetLanguages, 'zh-TW', userId);
    results.push({
      tourId,
      success: result.success,
      languages: result.translatedLanguages,
      errors: result.errors,
    });

    if (result.success) {
      completedCount++;
    } else {
      failedCount++;
    }

    // 更新進度
    await updateTranslationJobStatus(jobId, 'processing', {
      completedItems: completedCount,
      failedItems: failedCount,
    });
  }

  const processingTimeMs = Date.now() - startTime;
  const allErrors = results.flatMap(r => r.errors);

  await updateTranslationJobStatus(
    jobId,
    failedCount === 0 ? 'completed' : failedCount === tourIds.length ? 'failed' : 'partial',
    {
      completedItems: completedCount,
      failedItems: failedCount,
      results,
      errors: allErrors,
      processingTimeMs,
    }
  );

  return {
    jobId,
    success: failedCount === 0,
    results,
  };
}

/**
 * 獲取翻譯任務列表
 */
export async function getTranslationJobs(limit: number = 20): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];

  const jobs = await db.select().from(translationJobs).orderBy(desc(translationJobs.createdAt)).limit(limit);
  return jobs;
}

/**
 * 獲取支援的語言列表
 */

/**
 * 取得所有行程的翻譯摘要（批次查詢，用於管理後台）
 * 回傳每個行程的翻譯狀態（是否有 EN/ES 翻譯及欄位數量）
 */
export async function getAllTranslationsSummary(): Promise<Array<{
  tourId: number;
  hasEn: boolean;
  hasEs: boolean;
  enFieldCount: number;
  esFieldCount: number;
  totalFields: number;
}>> {
  const db = await getDb();
  if (!db) return [];
  try {
    // 取得所有行程的可翻譯欄位資料
    const { tours } = await import('../drizzle/schema');
    const allTours = await db.select({
      id: tours.id,
      title: tours.title,
      description: tours.description,
      highlights: tours.highlights,
      includes: tours.includes,
      excludes: tours.excludes,
      notes: tours.notes,
      heroSubtitle: (tours as any).heroSubtitle,
      keyFeatures: (tours as any).keyFeatures,
      itineraryDetailed: (tours as any).itineraryDetailed,
      costExplanation: (tours as any).costExplanation,
      noticeDetailed: (tours as any).noticeDetailed,
    }).from(tours);

    // 計算每筆行程的可翻譯欄位數
    const tourFieldsMap = new Map<number, number>();
    for (const tour of allTours) {
      const fieldValues = [
        tour.title, tour.description, tour.highlights, tour.includes,
        tour.excludes, tour.notes, tour.heroSubtitle, tour.keyFeatures,
        tour.itineraryDetailed, tour.costExplanation, tour.noticeDetailed,
      ];
      const count = fieldValues.filter(v => v && String(v).trim()).length;
      tourFieldsMap.set(tour.id, count);
    }

    // 取得翻譯結果
    const results = await db.select({
      entityId: translations.entityId,
      targetLanguage: translations.targetLanguage,
    }).from(translations).where(
      eq(translations.entityType, 'tour')
    );
    
    // 按行程 ID 和語言分組統計
    const summaryMap = new Map<number, { enCount: number; esCount: number }>();
    for (const row of results) {
      const tourId = row.entityId;
      if (!summaryMap.has(tourId)) {
        summaryMap.set(tourId, { enCount: 0, esCount: 0 });
      }
      const entry = summaryMap.get(tourId)!;
      if (row.targetLanguage === 'en') entry.enCount++;
      else if (row.targetLanguage === 'es') entry.esCount++;
    }
    
    return Array.from(summaryMap.entries()).map(([tourId, counts]) => ({
      tourId,
      hasEn: counts.enCount > 0,
      hasEs: counts.esCount > 0,
      enFieldCount: counts.enCount,
      esFieldCount: counts.esCount,
      totalFields: tourFieldsMap.get(tourId) ?? 0,
    }));
  } catch (error) {
    console.error('[Translation Agent] Failed to get translations summary:', error);
    return [];
  }
}

export function getSupportedLanguages(): Array<{ code: Language; name: string; nativeName: string }> {
  return Object.entries(languageFullNames).map(([code, name]) => ({
    code: code as Language,
    name,
    nativeName: languageNativeNames[code as Language],
  }));
}

/**
 * 生成快取 key
 */
function getCacheKey(text: string, source: string, target: string): string {
  // 對長文字使用 hash
  const textKey = text.length > 100 ? `${text.substring(0, 100)}_${hashCode(text)}` : text;
  return `${source}:${target}:${textKey}`;
}

/**
 * 簡單的 hash 函數
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * 清除翻譯快取
 */
export function clearTranslationCache(): void {
  translationMemCache.clear();
  // Redis 快取不在此清除（使用 TTL 自然過期）
}

/**
 * 獲取快取統計
 */
export function getTranslationCacheStats(): { size: number; keys: string[] } {
  return {
    size: translationMemCache.size,
    keys: Array.from(translationMemCache.keys()),
  };
}
