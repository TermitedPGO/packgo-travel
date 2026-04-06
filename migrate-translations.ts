/**
 * One-time migration script: Re-translate all active tours with expanded field coverage
 * Covers new fields added in FIX-1: poeticTitle, poeticSubtitle, poeticContent, hotels, meals
 * 
 * Run: npx tsx migrate-translations.ts
 * Delete after use.
 */
import 'dotenv/config';
import { translateTour } from './server/translation';
import * as db from './server/db';

async function main() {
  console.log('[Migration] Starting translation migration for all active tours...');
  
  // Get all active tours
  const allTours = await db.getAllTours();
  const activeTours = allTours.filter((t: any) => t.status === 'active');
  
  console.log(`[Migration] Found ${activeTours.length} active tours to re-translate`);
  
  let successCount = 0;
  let failCount = 0;
  
  // Use owner user ID (1) for the migration
  const MIGRATION_USER_ID = 1;
  
  for (const tour of activeTours) {
    console.log(`[Migration] Translating tour ${tour.id}: ${tour.title?.slice(0, 40)}...`);
    
    try {
      const result = await translateTour(
        tour.id,
        ['en', 'es'],
        'zh-TW',
        MIGRATION_USER_ID
      );
      
      if (result.success) {
        console.log(`[Migration] ✅ Tour ${tour.id} - translated to: ${result.translatedLanguages.join(', ')}`);
        successCount++;
      } else {
        console.warn(`[Migration] ⚠️ Tour ${tour.id} - errors: ${result.errors.join(', ')}`);
        failCount++;
      }
    } catch (err: any) {
      console.error(`[Migration] ❌ Error translating tour ${tour.id}:`, err.message);
      failCount++;
    }
    
    // Small delay between tours to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`\n[Migration] Complete!`);
  console.log(`[Migration] Success: ${successCount}, Failed: ${failCount}`);
  
  process.exit(0);
}

main().catch(err => {
  console.error('[Migration] Fatal error:', err);
  process.exit(1);
});
