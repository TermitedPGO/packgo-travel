import { invokeLLM } from "./_core/llm";
import { applyProperNounDictionary, applyDictionaryToJson, buildProperNounSystemPrompt } from "./translation-dictionary";
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
export type Language = 'zh-TW' | 'en';

// 語言名稱對應
const languageFullNames: Record<Language, string> = {
  'zh-TW': 'Traditional Chinese (Taiwan)',
  'en': 'English',
};

// 語言原生名稱
const languageNativeNames: Record<Language, string> = {
  'zh-TW': '繁體中文',
  'en': 'English',
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

    // Round 80.20 — strengthened anti-CJK-leakage rules:
    // Jeff reported English output strings like "Hokkaido的季節限定美學",
    // "長榮直飛Paris...品味France文化深度" — i.e. proper nouns translated
    // but Chinese particles/connectors (的, 與, 從, 到) stayed Chinese.
    // The cause: the LLM treated mixed-input as "already partially
    // translated" and only filled the gaps. New rules below force-translate
    // EVERY Chinese character including particles.
    const isTargetEnglish = targetLanguage === 'en';
    const cjkLeakRule = isTargetEnglish
      ? `\n\nZERO-TOLERANCE CJK RULE — CRITICAL FOR ENGLISH OUTPUT:
- The output MUST contain ZERO Chinese, Japanese, or Korean characters.
- This includes ALL CJK content: connectors (的, 與, 和, 或, 從, 到, 於, 之), verbs (品味, 探索, 體驗, 漫步), adjectives (美麗, 精緻), nouns (美學, 文化, 季節, 風景).
- If the source contains both Chinese and English in one string (e.g. "Hokkaido的季節限定美學" or "長榮直飛Paris品味France文化"), TRANSLATE THE CHINESE PORTIONS to English. Do NOT preserve them as-is.
  ✓ "Hokkaido的季節限定美學" → "Hokkaido's seasonal aesthetic"
  ✓ "長榮直飛Paris品味France文化" → "EVA direct flight to Paris to savor French culture"
  ✓ "從蘇黎世到Bern" → "From Zürich to Bern"
  ✗ NEVER output: "Hokkaido的seasonal beauty" (Chinese particle 的 leaked)
  ✗ NEVER output: "Visit Paris品味the city" (verb 品味 leaked)
- Even rare Chinese characters (eg 之/於/處) MUST be translated.
- Dictionary check: if your output contains any of [的, 與, 和, 或, 之, 於, 從, 到, 一, 是, 有, 在, 我, 你, 他, 她, 它, 們, 這, 那, 個, 等] — your translation is incomplete. Rewrite it.`
      : '';

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

BILINGUAL CONTENT HANDLING (very important):
- Source text frequently contains BOTH Chinese AND English in the SAME string,
  e.g. "台北Taipei / 慕尼黑Munich" or "聖加侖大教堂 Kathedrale St. Gallen" or "馬特宏峰Matterhorn"
- When translating to ${languageFullNames[targetLanguage]}: output ONLY the target-language form,
  NOT the bilingual form. Example: "台北Taipei / 慕尼黑Munich" → "Taipei / Munich"
- Drop the Chinese characters from bilingual phrases — never preserve both
- For Chinese-only place names (e.g. "蘇黎世", "瓦萊州小鎮"), translate to English equivalent
  (e.g. "Zürich", "Valais village"). Use Wikipedia-style English transliteration.
- For star ratings like "四星級", "五星級" — translate to "4-star", "5-star"
- For times like "待確認" — translate to "To be confirmed"
- For meal types "早餐/午餐/晚餐" — translate to "Breakfast/Lunch/Dinner"
${cjkLeakRule}

OUTPUT: Output ONLY the JSON, no explanation, no markdown code blocks, no preamble.

${buildProperNounSystemPrompt()}`;
      userContent = trimmed;
    } else {
      // 普通文字模式
      systemPrompt = `You are a professional translator specializing in travel and tourism content.
Your task is to translate text from ${languageFullNames[sourceLanguage]} to ${languageFullNames[targetLanguage]}.

CRITICAL OUTPUT RULES — ABSOLUTELY NON-NEGOTIABLE:
- Output ONLY the translated text. NOTHING else.
- DO NOT explain your reasoning. DO NOT say "I need to translate" or "Based on the dictionary". DO NOT add notes, parentheticals, or commentary.
- DO NOT preserve the source text alongside the translation.
- DO NOT use markdown code blocks.
- If the input is a single short phrase (under 50 chars), respond with a single short phrase.
- If the input contains BOTH source-language AND target-language text already (bilingual), output ONLY the target-language form.

Style guidelines:
- Maintain the original meaning and tone
- Use natural, fluent expressions
- Keep proper nouns appropriately translated or transliterated
- Use industry-standard travel terminology
- Preserve formatting (line breaks, punctuation)
${cjkLeakRule}

${buildProperNounSystemPrompt()}`;
      userContent = text;
    }

    // v67: Haiku is plenty for translation and 5x cheaper than Sonnet.
    // v78p: maxTokens was 2048 — way too small for large JSON like itineraryDetailed
    // (10-day tour ≈ 4-8K chars source, 6-12K output tokens). Output truncation made
    // JSON.parse fail and fall back to original ZH text — root cause of "translator
    // didn't translate the itinerary" bug. Bumped to 16K to comfortably fit all current
    // tour fields. Haiku 4.5 supports 64K output max.
    const estimatedTokens = Math.min(16384, Math.max(2048, Math.ceil(userContent.length * 2.5)));
    const response = await invokeLLM({
      model: "claude-haiku-4-5-20251001",
      maxTokens: estimatedTokens,
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
        const parsedOutput = JSON.parse(translatedText);
        // Post-processing: apply proper noun dictionary to all string values in JSON
        const corrected = applyDictionaryToJson(parsedOutput);
        translatedText = JSON.stringify(corrected);
      } catch {
        // AI 輸出不是有效 JSON，回退到原始値
        console.warn('[Translation Agent] JSON translation output invalid, falling back to original');
        return text;
      }
    } else {
      // v78p: Detect LLM "thinking out loud" outputs (e.g. for short hotel names
      // the LLM sometimes responds with "I need to translate X. Based on the
      // dictionary, ..." instead of just the translated string). Reject + fallback.
      const looksLikeExplanation =
        translatedText.length > Math.max(150, text.length * 4) ||
        /^I need to translate|^Based on the (proper )?noun dictionary|^Looking at|^Since|^Let me|^The translation is|^Note:|^\(This /i.test(translatedText) ||
        /\n\n\(This /i.test(translatedText);
      if (looksLikeExplanation) {
        console.warn(
          `[Translation Agent] Rejected likely-explanation output for input "${text.slice(0, 40)}…" → output started with "${translatedText.slice(0, 80)}"`
        );
        // Fallback: return source unchanged so dictionary can fix obvious bits
        return applyProperNounDictionary(text);
      }
      // Post-processing for plain text: apply proper noun dictionary
      translatedText = applyProperNounDictionary(translatedText);
    }

    // Round 80.20 — CJK leakage retry:
    // If target is English and the output STILL contains CJK characters
    // (Chinese particles like 的/與/從/到/品味/文化 leaking through), retry
    // ONCE with an explicit complaint listing the leaked characters. The
    // LLM is much more likely to fully translate when shown its mistake.
    if (targetLanguage === 'en') {
      const cjkRegex = /[一-鿿぀-ヿ가-힯]/g;
      const leakedChars = translatedText.match(cjkRegex);
      if (leakedChars && leakedChars.length > 0) {
        const uniqueLeaks = Array.from(new Set(leakedChars)).slice(0, 30).join('');
        console.warn(
          `[Translation Agent] CJK leak detected in EN output. Leaked chars: "${uniqueLeaks}". Input: "${text.slice(0, 60)}…". Retrying with stricter prompt.`
        );
        try {
          const retrySystem = `You are a professional translator. Your previous translation incorrectly preserved Chinese characters: [${uniqueLeaks}].
Translate the source text to PURE English with ZERO Chinese characters. Translate ALL particles (的, 與, 從, 到), verbs, and nouns into their English equivalents.
Output ONLY the corrected English translation — no explanation, no markdown, no preamble.

${buildProperNounSystemPrompt()}`;
          const retryRes = await invokeLLM({
            model: 'claude-haiku-4-5-20251001',
            maxTokens: estimatedTokens,
            messages: [
              { role: 'system', content: retrySystem },
              {
                role: 'user',
                content: parsedJson !== null ? trimmed : text,
              },
            ],
          });
          const retryContent = retryRes.choices[0]?.message?.content;
          let retryText = typeof retryContent === 'string' ? retryContent.trim() : '';
          if (parsedJson !== null) {
            retryText = retryText
              .replace(/^```json\s*/i, '')
              .replace(/^```\s*/i, '')
              .replace(/\s*```$/i, '')
              .trim();
            try {
              const reparsed = JSON.parse(retryText);
              retryText = JSON.stringify(applyDictionaryToJson(reparsed));
            } catch {
              retryText = ''; // invalid JSON → keep original
            }
          } else {
            retryText = applyProperNounDictionary(retryText);
          }
          // Only accept retry if it has FEWER CJK chars than the first attempt
          const retryLeaks = retryText.match(cjkRegex)?.length ?? Infinity;
          if (retryText && retryLeaks < leakedChars.length) {
            console.log(
              `[Translation Agent] CJK retry improved from ${leakedChars.length} to ${retryLeaks} CJK chars`
            );
            translatedText = retryText;
          }
          if (retryRes.usage) {
            logLlmUsage({
              agentName: 'TranslationAgent',
              taskType: 'translation_cjk_retry',
              model: retryRes.model || 'claude-haiku-4-5',
              inputTokens: retryRes.usage.prompt_tokens,
              outputTokens: retryRes.usage.completion_tokens,
            }).catch(() => {});
          }
        } catch (retryErr) {
          console.warn('[Translation Agent] CJK retry failed:', retryErr);
        }
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
      // 交通資訊欄位
      { name: 'flights', value: (tour as any).flights },
      // 詩意標題欄位
      { name: 'poeticTitle', value: (tour as any).poeticTitle },
      { name: 'poeticSubtitle', value: (tour as any).poeticSubtitle },
      { name: 'poeticContent', value: (tour as any).poeticContent },
    ];

    for (const targetLang of targetLanguages) {
      if (targetLang === sourceLanguage) continue;

      try {
        // v78p Sprint 8 #2: Pre-fetch existing translations for this tour+lang
        // so we can skip LLM calls when content hasn't changed. Saves cost on
        // re-runs (e.g. admin saves a tour that only changed price — title,
        // description, etc. don't need re-translation).
        const existingRows = await db
          .select()
          .from(translations)
          .where(
            and(
              eq(translations.entityType, 'tour'),
              eq(translations.entityId, tourId),
              eq(translations.targetLanguage, targetLang)
            )
          );
        const existingByField = new Map<string, { originalText: string | null; translatedText: string | null }>();
        for (const r of existingRows as any[]) {
          existingByField.set(r.fieldName, {
            originalText: r.originalText,
            translatedText: r.translatedText,
          });
        }

        let skipped = 0;
        let translated = 0;
        for (const field of fieldsToTranslate) {
          if (!field.value) continue;

          // Skip if the source text is unchanged AND we have a non-empty translation
          const existing = existingByField.get(field.name);
          if (
            existing &&
            existing.originalText === field.value &&
            existing.translatedText &&
            existing.translatedText.length > 0
          ) {
            skipped++;
            continue;
          }

          const translatedText = await translateText(
            field.value,
            targetLang,
            sourceLanguage
          );
          translated++;

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
        if (skipped > 0 || translated > 0) {
          console.log(`[TranslationAgent] tour #${tourId} → ${targetLang}: ${translated} translated, ${skipped} skipped (unchanged)`);
        }

        // 翻譯每日行程（如果有）
        if (tour.dailyItinerary) {
          const dailyItinerary = typeof tour.dailyItinerary === 'string' 
            ? JSON.parse(tour.dailyItinerary) 
            : tour.dailyItinerary;

          if (Array.isArray(dailyItinerary)) {
            const sourceJson = JSON.stringify(dailyItinerary);
            // Skip whole-block translation if source unchanged
            const existingDI = existingByField.get('dailyItinerary');
            if (existingDI && existingDI.originalText === sourceJson && existingDI.translatedText) {
              // already up-to-date, skip
            } else {
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
                originalText: sourceJson,
                translatedText: JSON.stringify(translatedItinerary),
                translatedBy: `user:${userId}`,
              });
            }
          }
        }

        // 翻譯飯店資訊（hotels JSON）
        if ((tour as any).hotels) {
          try {
            const hotels = typeof (tour as any).hotels === 'string'
              ? JSON.parse((tour as any).hotels)
              : (tour as any).hotels;
            if (Array.isArray(hotels)) {
              const sourceJson = JSON.stringify(hotels);
              const existingH = existingByField.get('hotels');
              if (existingH && existingH.originalText === sourceJson && existingH.translatedText) {
                // up-to-date, skip
              } else {
                const translatedHotels = await Promise.all(
                  hotels.map(async (hotel: any) => ({
                    ...hotel,
                    name: hotel.name ? await translateText(hotel.name, targetLang, sourceLanguage) : hotel.name,
                    description: hotel.description ? await translateText(hotel.description, targetLang, sourceLanguage) : hotel.description,
                  }))
                );
                await saveTranslation({
                  entityType: 'tour',
                  entityId: tourId,
                  fieldName: 'hotels',
                  sourceLanguage,
                  targetLanguage: targetLang,
                  originalText: sourceJson,
                  translatedText: JSON.stringify(translatedHotels),
                  translatedBy: `user:${userId}`,
                });
              }
            }
          } catch (e) {
            console.warn(`[Translation Agent] Failed to translate hotels for tour ${tourId}:`, e);
          }
        }

        // 翻譯餐食資訊（meals JSON）
        if ((tour as any).meals) {
          try {
            const meals = typeof (tour as any).meals === 'string'
              ? JSON.parse((tour as any).meals)
              : (tour as any).meals;
            if (Array.isArray(meals)) {
              const sourceJson = JSON.stringify(meals);
              const existingM = existingByField.get('meals');
              if (existingM && existingM.originalText === sourceJson && existingM.translatedText) {
                // up-to-date, skip
              } else {
                const translatedMeals = await Promise.all(
                  meals.map(async (meal: any) => ({
                    ...meal,
                    name: meal.name ? await translateText(meal.name, targetLang, sourceLanguage) : meal.name,
                    description: meal.description ? await translateText(meal.description, targetLang, sourceLanguage) : meal.description,
                  }))
                );
                await saveTranslation({
                  entityType: 'tour',
                  entityId: tourId,
                  fieldName: 'meals',
                  sourceLanguage,
                  targetLanguage: targetLang,
                  originalText: sourceJson,
                  translatedText: JSON.stringify(translatedMeals),
                  translatedBy: `user:${userId}`,
                });
              }
            }
          } catch (e) {
            console.warn(`[Translation Agent] Failed to translate meals for tour ${tourId}:`, e);
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
 * v78q Sprint 9 #1: Generic registry-driven translation.
 *
 * Reads the entity row by (entityType, entityId), looks up the registry to
 * decide which scalar + JSON fields to translate, then iterates with the same
 * skip-if-unchanged + dictionary-aware machinery as translateTour.
 *
 * Adding a new entity type now means registering it in TRANSLATABLE_ENTITIES
 * — no changes here.
 */
export async function translateEntity(
  entityType: string,
  entityId: number,
  targetLanguages: Language[],
  sourceLanguage: Language = "zh-TW",
  userId: number
): Promise<{ success: boolean; translatedLanguages: Language[]; errors: string[] }> {
  const { TRANSLATABLE_ENTITIES, applyToJsonPath } = await import("./translationRegistry");
  const entityDef = (TRANSLATABLE_ENTITIES as any)[entityType];
  if (!entityDef) {
    return { success: false, translatedLanguages: [], errors: [`Entity type "${entityType}" not registered`] };
  }

  const db = await getDb();
  if (!db) return { success: false, translatedLanguages: [], errors: ["Database not available"] };

  // Dynamically import the table from drizzle schema by name
  const schema = await import("../drizzle/schema");
  const table = (schema as any)[entityDef.tableName];
  if (!table) {
    return { success: false, translatedLanguages: [], errors: [`Table "${entityDef.tableName}" not in schema`] };
  }

  const [row] = await db.select().from(table).where(eq(table[entityDef.idColumn], entityId));
  if (!row) {
    return { success: false, translatedLanguages: [], errors: [`${entityType} #${entityId} not found`] };
  }

  const errors: string[] = [];
  const translatedLanguages: Language[] = [];

  for (const targetLang of targetLanguages) {
    if (targetLang === sourceLanguage) continue;

    try {
      // Pre-fetch existing translations for skip-if-unchanged
      const existingRows = await db
        .select()
        .from(translations)
        .where(
          and(
            eq(translations.entityType, entityType as any),
            eq(translations.entityId, entityId),
            eq(translations.targetLanguage, targetLang)
          )
        );
      const existingByField = new Map<string, { originalText: string | null; translatedText: string | null }>();
      for (const r of existingRows as any[]) {
        existingByField.set(r.fieldName, {
          originalText: r.originalText,
          translatedText: r.translatedText,
        });
      }

      let skipped = 0;
      let translated = 0;

      // 1. Scalar fields
      for (const fieldName of entityDef.scalarFields) {
        const value = (row as any)[fieldName];
        if (!value || typeof value !== "string") continue;

        const existing = existingByField.get(fieldName);
        if (existing && existing.originalText === value && existing.translatedText) {
          skipped++;
          continue;
        }

        const translatedText = await translateText(value, targetLang, sourceLanguage);
        translated++;
        await saveTranslation({
          entityType: entityType as any,
          entityId,
          fieldName,
          sourceLanguage,
          targetLanguage: targetLang,
          originalText: value,
          translatedText,
          translatedBy: `user:${userId}`,
        });
      }

      // 2. JSON fields with nested-path rules (registry-driven)
      for (const jf of entityDef.jsonFields) {
        const raw = (row as any)[jf.name];
        if (!raw) continue;
        const sourceJson = typeof raw === "string" ? raw : JSON.stringify(raw);

        const existing = existingByField.get(jf.name);
        if (existing && existing.originalText === sourceJson && existing.translatedText) {
          skipped++;
          continue;
        }

        let parsed: any;
        try {
          parsed = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw));
        } catch (e) {
          console.warn(`[translateEntity] ${entityType}#${entityId}.${jf.name} invalid JSON, skipping`);
          continue;
        }

        // Apply each rule via applyToJsonPath, transforming string fields via translateText
        await applyToJsonPath(parsed, jf.rules, async (s) => {
          if (typeof s !== "string" || !s.trim()) return s;
          return await translateText(s, targetLang, sourceLanguage);
        });
        translated++;

        await saveTranslation({
          entityType: entityType as any,
          entityId,
          fieldName: jf.name,
          sourceLanguage,
          targetLanguage: targetLang,
          originalText: sourceJson,
          translatedText: JSON.stringify(parsed),
          translatedBy: `user:${userId}`,
        });
      }

      if (skipped > 0 || translated > 0) {
        console.log(
          `[translateEntity] ${entityType}#${entityId} → ${targetLang}: ${translated} translated, ${skipped} skipped`
        );
      }
      translatedLanguages.push(targetLang);
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[translateEntity] ${entityType}#${entityId} → ${targetLang} failed:`, msg);
      errors.push(`${targetLang}: ${msg}`);
    }
  }

  return { success: errors.length === 0, translatedLanguages, errors };
}

/**
 * Translate one customer inquiry via the registry. Convenience wrapper —
 * same one-liner as `translateEntity('inquiry', ...)` but discoverable in
 * editor autocomplete.
 */
export async function translateInquiry(
  inquiryId: number,
  targetLanguages: Language[] = ["en"],
  sourceLanguage: Language = "zh-TW",
  userId: number = 1
) {
  return translateEntity("inquiry", inquiryId, targetLanguages, sourceLanguage, userId);
}

/**
 * 儲存翻譯到資料庫
 */
async function saveTranslation(data: {
  entityType: 'tour' | 'tour_departure' | 'page' | 'ui_element' | 'notification' | 'inquiry' | 'destination' | 'homepage_content';
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
 * 回傳每個行程的翻譯狀態（是否有 EN 翻譯及欄位數量）
 */
export async function getAllTranslationsSummary(): Promise<Array<{
  tourId: number;
  hasEn: boolean;
  enFieldCount: number;
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
    const summaryMap = new Map<number, { enCount: number }>();
    for (const row of results) {
      const tourId = row.entityId;
      if (!summaryMap.has(tourId)) {
        summaryMap.set(tourId, { enCount: 0 });
      }
      const entry = summaryMap.get(tourId)!;
      if (row.targetLanguage === 'en') entry.enCount++;
    }
    
    return Array.from(summaryMap.entries()).map(([tourId, counts]) => ({
      tourId,
      hasEn: counts.enCount > 0,
      enFieldCount: counts.enCount,
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
