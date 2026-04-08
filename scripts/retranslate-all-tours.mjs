#!/usr/bin/env node
/**
 * Round 8 Migration: Clear translation cache and re-translate all active tours
 * 
 * This script:
 * 1. Clears ALL Redis translation cache (translate:* keys)
 * 2. Deletes all EN translations from the database
 * 3. Re-translates all active tours using the updated TranslationAgent
 *    (with proper noun dictionary injected in system prompt + post-processing)
 * 
 * Run: npx tsx scripts/retranslate-all-tours.mjs
 */

import 'dotenv/config';

console.log('=== Round 8: Clear Cache + Re-translate All Tours ===');
console.log('Using server/translation.ts (with proper noun dictionary)');
console.log('');

// 1. Import Redis and clear translation cache
const { redis } = await import('../server/redis.ts');
await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for Redis connection

console.log('🔑 Step 1: Clearing Redis translation cache...');
let cursor = '0';
let deletedRedisCount = 0;

do {
  const result = await redis.scan(cursor, 'MATCH', 'translate:*', 'COUNT', 200);
  cursor = result[0];
  const keys = result[1];
  
  if (keys.length > 0) {
    await redis.del(...keys);
    deletedRedisCount += keys.length;
    process.stdout.write(`  Deleted ${deletedRedisCount} Redis cache entries...\r`);
  }
} while (cursor !== '0');

console.log(`\n  ✅ Cleared ${deletedRedisCount} Redis translation cache entries`);

// 2. Delete all EN translations from DB
console.log('\n🗄️  Step 2: Clearing EN translations from database...');
const { getDb } = await import('../server/db.ts');
const db = await getDb();

if (!db) {
  console.error('❌ Database not available');
  process.exit(1);
}

const { translations, tours } = await import('../drizzle/schema.ts');
const { eq } = await import('drizzle-orm');

// Delete all EN translations
const deleteResult = await db.delete(translations).where(eq(translations.targetLanguage, 'en'));
console.log(`  ✅ Deleted EN translations from database`);

// 3. Get all active tours
console.log('\n📋 Step 3: Getting all active tours...');
const activeTours = await db.select({
  id: tours.id,
  title: tours.title,
}).from(tours).where(eq(tours.status, 'active'));

console.log(`  Found ${activeTours.length} active tours:`);
activeTours.forEach((t, i) => console.log(`  ${i + 1}. #${t.id} - ${t.title}`));

// 4. Re-translate all tours
console.log('\n🌐 Step 4: Re-translating all tours with proper noun dictionary...');
const { translateTour } = await import('../server/translation.ts');

const ADMIN_USER_ID = 630001; // Jeff's admin ID
let successCount = 0;
let failCount = 0;

for (let i = 0; i < activeTours.length; i++) {
  const tour = activeTours[i];
  console.log(`\n[${i + 1}/${activeTours.length}] Translating tour #${tour.id}: ${tour.title}`);
  
  try {
    const result = await translateTour(tour.id, ['en'], 'zh-TW', ADMIN_USER_ID);
    if (result.success) {
      console.log(`  ✅ Success: translated to ${result.translatedLanguages.join(', ')}`);
      successCount++;
    } else {
      console.log(`  ❌ Failed: ${result.errors.join(', ')}`);
      failCount++;
    }
  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    failCount++;
  }
  
  // Small delay between tours to avoid rate limiting
  if (i < activeTours.length - 1) {
    console.log('  ⏳ Waiting 2s before next tour...');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

console.log('\n=== Translation Complete ===');
console.log(`✅ Success: ${successCount} tours`);
console.log(`❌ Failed: ${failCount} tours`);

redis.disconnect();
console.log('\n✅ Done!');
process.exit(0);
