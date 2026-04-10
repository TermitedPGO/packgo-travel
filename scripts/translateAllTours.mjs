#!/usr/bin/env node
/**
 * 批量翻譯所有行程腳本
 * 使用 Translation Agent (Claude API) 將所有行程翻譯到英文和西班牙文
 */

import 'dotenv/config';
import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

// 解析 DATABASE_URL
function parseDbUrl(url) {
  const match = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!match) throw new Error('Invalid DATABASE_URL format');
  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: parseInt(match[4]),
    database: match[5].split('?')[0],
  };
}

// 翻譯函數 - 使用 LLM API
async function translateText(text, targetLanguage, sourceLanguage = 'zh-TW') {
  if (!text || !text.trim() || targetLanguage === sourceLanguage) {
    return text;
  }

  const languageNames = {
    'zh-TW': 'Traditional Chinese (Taiwan)',
    'en': 'English',
    'ja': 'Japanese',
    'ko': 'Korean',
  };

  const apiUrl = process.env.BUILT_IN_FORGE_API_URL;
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY;

  if (!apiUrl || !apiKey) {
    console.error('BUILT_IN_FORGE_API_URL or BUILT_IN_FORGE_API_KEY is not set');
    return text;
  }

  try {
    const response = await fetch(`${apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: `You are a professional translator specializing in travel and tourism content. 
Your task is to translate text from ${languageNames[sourceLanguage]} to ${languageNames[targetLanguage]}.

Guidelines:
- Maintain the original meaning and tone
- Use natural, fluent expressions in the target language
- Keep proper nouns (place names, brand names) appropriately translated or transliterated
- For travel-related terms, use industry-standard terminology
- Preserve any formatting (line breaks, punctuation)
- Only output the translated text, nothing else`
          },
          {
            role: 'user',
            content: text
          }
        ],
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : text;
  } catch (error) {
    console.error(`Translation error: ${error.message}`);
    return text;
  }
}

// 儲存翻譯到資料庫
async function saveTranslation(connection, data) {
  const { entityType, entityId, fieldName, sourceLanguage, targetLanguage, originalText, translatedText, translatedBy } = data;

  // 檢查是否已存在
  const [existing] = await connection.execute(
    `SELECT id FROM translations WHERE entityType = ? AND entityId = ? AND fieldName = ? AND targetLanguage = ?`,
    [entityType, entityId, fieldName, targetLanguage]
  );

  if (existing.length > 0) {
    // 更新現有翻譯
    await connection.execute(
      `UPDATE translations SET translatedText = ?, translatedBy = ?, updatedAt = NOW() WHERE id = ?`,
      [translatedText, translatedBy, existing[0].id]
    );
  } else {
    // 插入新翻譯
    await connection.execute(
      `INSERT INTO translations (entityType, entityId, fieldName, sourceLanguage, targetLanguage, originalText, translatedText, translatedBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [entityType, entityId, fieldName, sourceLanguage, targetLanguage, originalText, translatedText, translatedBy]
    );
  }
}

// 翻譯單個行程
async function translateTour(connection, tour, targetLanguages) {
  const fieldsToTranslate = [
    { name: 'title', value: tour.title },
    { name: 'description', value: tour.description },
    { name: 'highlights', value: tour.highlights },
    { name: 'includes', value: tour.includes },
    { name: 'excludes', value: tour.excludes },
    { name: 'notes', value: tour.notes },
  ];

  for (const targetLang of targetLanguages) {
    if (targetLang === 'zh-TW') continue;

    console.log(`  Translating tour ${tour.id} to ${targetLang}...`);

    for (const field of fieldsToTranslate) {
      if (!field.value) continue;

      try {
        const translatedText = await translateText(field.value, targetLang, 'zh-TW');
        
        await saveTranslation(connection, {
          entityType: 'tour',
          entityId: tour.id,
          fieldName: field.name,
          sourceLanguage: 'zh-TW',
          targetLanguage: targetLang,
          originalText: field.value,
          translatedText,
          translatedBy: 'system:batch_translate',
        });

        console.log(`    ✓ ${field.name} translated`);
      } catch (error) {
        console.error(`    ✗ ${field.name} failed: ${error.message}`);
      }

      // 避免 API 限流
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 翻譯每日行程
    if (tour.daily_itinerary) {
      try {
        const dailyItinerary = typeof tour.daily_itinerary === 'string' 
          ? JSON.parse(tour.daily_itinerary) 
          : tour.daily_itinerary;

        if (Array.isArray(dailyItinerary) && dailyItinerary.length > 0) {
          const translatedItinerary = [];
          
          for (const day of dailyItinerary) {
            const translatedDay = { ...day };
            
            if (day.title) {
              translatedDay.title = await translateText(day.title, targetLang, 'zh-TW');
              await new Promise(resolve => setTimeout(resolve, 300));
            }
            
            if (day.description) {
              translatedDay.description = await translateText(day.description, targetLang, 'zh-TW');
              await new Promise(resolve => setTimeout(resolve, 300));
            }
            
            if (day.activities && Array.isArray(day.activities)) {
              translatedDay.activities = [];
              for (const activity of day.activities) {
                const translatedActivity = { ...activity };
                if (activity.name) {
                  translatedActivity.name = await translateText(activity.name, targetLang, 'zh-TW');
                  await new Promise(resolve => setTimeout(resolve, 300));
                }
                if (activity.description) {
                  translatedActivity.description = await translateText(activity.description, targetLang, 'zh-TW');
                  await new Promise(resolve => setTimeout(resolve, 300));
                }
                translatedDay.activities.push(translatedActivity);
              }
            }
            
            translatedItinerary.push(translatedDay);
          }

          await saveTranslation(connection, {
            entityType: 'tour',
            entityId: tour.id,
            fieldName: 'dailyItinerary',
            sourceLanguage: 'zh-TW',
            targetLanguage: targetLang,
            originalText: JSON.stringify(dailyItinerary),
            translatedText: JSON.stringify(translatedItinerary),
            translatedBy: 'system:batch_translate',
          });

          console.log(`    ✓ dailyItinerary translated`);
        }
      } catch (error) {
        console.error(`    ✗ dailyItinerary failed: ${error.message}`);
      }
    }
  }
}

async function main() {
  console.log('=== 批量翻譯所有行程 ===');
  console.log('目標語言: English (en), Spanish (es)');
  console.log('');

  const dbConfig = parseDbUrl(DATABASE_URL);
  const connection = await mysql.createConnection({
    ...dbConfig,
    ssl: { rejectUnauthorized: true },
  });

  try {
    // 獲取所有行程
    const [tours] = await connection.execute('SELECT * FROM tours WHERE status = "active"');
    console.log(`找到 ${tours.length} 個上架中的行程`);
    console.log('');

    const targetLanguages = ['en'];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < tours.length; i++) {
      const tour = tours[i];
      console.log(`[${i + 1}/${tours.length}] 翻譯行程: ${tour.title}`);
      
      try {
        await translateTour(connection, tour, targetLanguages);
        successCount++;
        console.log(`  ✓ 完成`);
      } catch (error) {
        failCount++;
        console.error(`  ✗ 失敗: ${error.message}`);
      }
      
      console.log('');
    }

    console.log('=== 翻譯完成 ===');
    console.log(`成功: ${successCount} 個行程`);
    console.log(`失敗: ${failCount} 個行程`);

  } finally {
    await connection.end();
  }
}

main().catch(console.error);
