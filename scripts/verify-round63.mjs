/**
 * Round 63 End-to-End DB Verification Script
 * Checks real DB values for all 5 fixed fields
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const DB_URL = process.env.DATABASE_URL;

async function main() {
  const conn = await mysql.createConnection(DB_URL);
  
  console.log('\n=== Round 63 DB Verification ===\n');
  
  // Get the 10 most recently updated tours
  const [tours] = await conn.execute(
    `SELECT id, title, heroImage, featureImages, hotels, meals, hotelImages, galleryImages, attractions, updatedAt
     FROM tours
     ORDER BY updatedAt DESC
     LIMIT 10`
  );
  
  console.log(`Checking last ${tours.length} tours (most recent first):\n`);
  
  let stats = {
    total: tours.length,
    heroImage: { ok: 0, missing: 0 },
    featureImages: { objects: 0, urlStrings: 0, empty: 0 },
    hotels: { withImage: 0, withoutImage: 0, total: 0 },
    meals: { withImage: 0, withoutImage: 0, total: 0 },
    hotelImages: { ok: 0, empty: 0 },
  };
  
  for (const tour of tours) {
    const t = tour;
    console.log(`--- Tour #${t.id}: ${t.title?.substring(0, 40) || 'N/A'} (updated: ${t.updatedAt}) ---`);
    
    // heroImage
    if (t.heroImage && t.heroImage.startsWith('http')) {
      console.log(`  heroImage: ✅ ${t.heroImage.substring(0, 60)}...`);
      stats.heroImage.ok++;
    } else {
      console.log(`  heroImage: ❌ MISSING (value: "${t.heroImage?.substring(0, 30) || ''}")`);
      stats.heroImage.missing++;
    }
    
    // featureImages
    try {
      const fi = JSON.parse(t.featureImages || '[]');
      if (fi.length === 0) {
        console.log(`  featureImages: ❌ EMPTY`);
        stats.featureImages.empty++;
      } else if (typeof fi[0] === 'string') {
        console.log(`  featureImages: ⚠️  OLD FORMAT (URL strings) — ${fi.length} items`);
        stats.featureImages.urlStrings++;
      } else if (typeof fi[0] === 'object' && fi[0].url) {
        console.log(`  featureImages: ✅ OBJECTS — ${fi.length} items, first: {url: "${fi[0].url.substring(0, 40)}...", caption: "${fi[0].caption || ''}"}`);
        stats.featureImages.objects++;
      } else {
        console.log(`  featureImages: ❓ UNKNOWN FORMAT — ${JSON.stringify(fi[0]).substring(0, 50)}`);
        stats.featureImages.empty++;
      }
    } catch { console.log(`  featureImages: ❌ PARSE ERROR`); stats.featureImages.empty++; }
    
    // hotels[].image
    try {
      const hotels = JSON.parse(t.hotels || '[]');
      const withImg = hotels.filter(h => h.image && h.image.startsWith('http')).length;
      const total = hotels.length;
      stats.hotels.total += total;
      stats.hotels.withImage += withImg;
      stats.hotels.withoutImage += (total - withImg);
      if (total === 0) {
        console.log(`  hotels: ⚠️  EMPTY ARRAY`);
      } else if (withImg === total) {
        console.log(`  hotels: ✅ ${withImg}/${total} have image`);
      } else {
        console.log(`  hotels: ⚠️  ${withImg}/${total} have image (${total - withImg} missing)`);
      }
    } catch { console.log(`  hotels: ❌ PARSE ERROR`); }
    
    // meals[].image
    try {
      const meals = JSON.parse(t.meals || '[]');
      const withImg = meals.filter(m => m.image && m.image.startsWith('http')).length;
      const total = meals.length;
      stats.meals.total += total;
      stats.meals.withImage += withImg;
      stats.meals.withoutImage += (total - withImg);
      if (total === 0) {
        console.log(`  meals: ⚠️  EMPTY ARRAY`);
      } else if (withImg === total) {
        console.log(`  meals: ✅ ${withImg}/${total} have image`);
      } else {
        console.log(`  meals: ⚠️  ${withImg}/${total} have image (${total - withImg} missing)`);
      }
    } catch { console.log(`  meals: ❌ PARSE ERROR`); }
    
    // hotelImages
    try {
      const hi = JSON.parse(t.hotelImages || '[]');
      if (hi.length > 0) {
        console.log(`  hotelImages: ✅ ${hi.length} URLs`);
        stats.hotelImages.ok++;
      } else {
        console.log(`  hotelImages: ❌ EMPTY`);
        stats.hotelImages.empty++;
      }
    } catch { console.log(`  hotelImages: ❌ PARSE ERROR`); stats.hotelImages.empty++; }
    
    console.log('');
  }
  
  console.log('\n=== SUMMARY ===');
  console.log(`heroImage:    ✅ ${stats.heroImage.ok}/${stats.total}  ❌ ${stats.heroImage.missing}/${stats.total}`);
  console.log(`featureImages: ✅ objects=${stats.featureImages.objects}  ⚠️ urlStrings=${stats.featureImages.urlStrings}  ❌ empty=${stats.featureImages.empty}`);
  console.log(`hotels[].image: ✅ ${stats.hotels.withImage}/${stats.hotels.total}  ❌ ${stats.hotels.withoutImage}/${stats.hotels.total}`);
  console.log(`meals[].image:  ✅ ${stats.meals.withImage}/${stats.meals.total}  ❌ ${stats.meals.withoutImage}/${stats.meals.total}`);
  console.log(`hotelImages:   ✅ ${stats.hotelImages.ok}/${stats.total}  ❌ ${stats.hotelImages.empty}/${stats.total}`);
  
  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
