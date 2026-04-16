/**
 * Round 63 Trigger + Verify Script
 * 1. Triggers a new tour generation via the API
 * 2. Waits for it to complete
 * 3. Verifies all 5 fixed fields
 */
import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';
import { config } from 'dotenv';
config();

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjYzMDAwMSwiZW1haWwiOiJqZWZmQHBhY2tnby5jb20iLCJuYW1lIjoiSmVmZiBIc2llaCIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc3NjM3NzQ1NiwiZXhwIjoxNzc2Mzg0NjU2fQ.yX2q8yxZn1i7XaW0jHCD_EiEojHbg3p6EHmQPwODktU';
const BASE = 'http://localhost:3000';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  
  // Get the most recent Bangkok tour URL to regenerate
  const [tours] = await conn.execute(
    `SELECT id, title, sourceUrl FROM tours WHERE sourceUrl IS NOT NULL AND sourceUrl != '' ORDER BY updatedAt DESC LIMIT 1`
  );
  
  if (!tours.length) {
    console.log('No tours with sourceUrl found. Using a test Lion URL...');
  }
  
  const sourceUrl = tours[0]?.sourceUrl || 'https://travel.liontravel.com/detail?prdno=TGBKK5D001';
  console.log(`\n=== Round 63 Trigger Test ===`);
  console.log(`Using source URL: ${sourceUrl}`);
  
  // Trigger tour generation using submitAsyncGeneration (isPdf: false = URL mode)
  console.log('\n[1/4] Triggering tour generation...');
  const genResp = await fetch(`${BASE}/api/trpc/tours.submitAsyncGeneration`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `app_session_id=${TOKEN}`,
    },
    body: JSON.stringify({ json: { url: sourceUrl, isPdf: false, forceRegenerate: true } }),
  });
  
  if (!genResp.ok) {
    const text = await genResp.text();
    console.error(`Generation request failed: ${genResp.status} ${text.substring(0, 200)}`);
    await conn.end();
    return;
  }
  
  const genData = await genResp.json();
  const jobId = genData?.result?.data?.json?.jobId;
  const requestId = genData?.result?.data?.json?.requestId;
  console.log(`Job ID: ${jobId}, Request ID: ${requestId}`);
  
  if (!jobId) {
    console.error('No jobId returned. Response:', JSON.stringify(genData).substring(0, 300));
    await conn.end();
    return;
  }
  
  // Poll for completion using getGenerationStatus
  console.log('\n[2/4] Polling for completion (max 5 minutes)...');
  let tourId = null;
  let attempts = 0;
  while (attempts < 60) {
    await sleep(5000);
    attempts++;
    
    const statusResp = await fetch(`${BASE}/api/trpc/tours.getGenerationStatus?input=${encodeURIComponent(JSON.stringify({ json: { jobId } }))}`, {
      headers: { 'Cookie': `session=${TOKEN}` },
    });
    
    if (statusResp.ok) {
      const statusData = await statusResp.json();
      const status = statusData?.result?.data?.json?.status;
      const progress = statusData?.result?.data?.json?.progress;
      const result = statusData?.result?.data?.json?.result;
      console.log(`  [${attempts * 5}s] Status: ${status}, Progress: ${JSON.stringify(progress).substring(0, 80)}`);
      
      if (status === 'completed') {
        tourId = result?.tourId;
        console.log(`  ✅ Completed! Tour ID: ${tourId}`);
        break;
      } else if (status === 'failed') {
        console.error(`  ❌ Generation failed: ${JSON.stringify(statusData?.result?.data?.json?.failedReason || '').substring(0, 200)}`);
        break;
      }
    } else {
      console.log(`  [${attempts * 5}s] Status check failed: ${statusResp.status}`);
    }
  }
  
  if (!tourId) {
    console.log('\nCould not get tourId from task. Checking latest DB entry...');
    const [latest] = await conn.execute(
      `SELECT id FROM tours ORDER BY createdAt DESC LIMIT 1`
    );
    tourId = latest[0]?.id;
    console.log(`Using latest tour ID: ${tourId}`);
  }
  
  // Verify the generated tour
  console.log(`\n[3/4] Verifying Tour #${tourId}...`);
  const [rows] = await conn.execute(
    `SELECT id, title, heroImage, featureImages, hotels, meals, hotelImages, galleryImages, attractions FROM tours WHERE id = ?`,
    [tourId]
  );
  
  if (!rows.length) {
    console.error(`Tour #${tourId} not found in DB`);
    await conn.end();
    return;
  }
  
  const t = rows[0];
  console.log(`\nTour: ${t.title}`);
  
  // heroImage
  const heroOk = t.heroImage && t.heroImage.startsWith('http');
  console.log(`\nheroImage: ${heroOk ? '✅' : '❌'} ${t.heroImage?.substring(0, 80) || 'MISSING'}`);
  
  // featureImages
  let fiResult = '❌ EMPTY';
  try {
    const fi = JSON.parse(t.featureImages || '[]');
    if (fi.length === 0) fiResult = '❌ EMPTY';
    else if (typeof fi[0] === 'string') fiResult = `⚠️  OLD FORMAT (${fi.length} URL strings)`;
    else if (typeof fi[0] === 'object' && fi[0].url) fiResult = `✅ OBJECTS (${fi.length} items, first caption: "${fi[0].caption || fi[0].alt || ''}")`;
    else fiResult = `❓ UNKNOWN FORMAT`;
  } catch { fiResult = '❌ PARSE ERROR'; }
  console.log(`featureImages: ${fiResult}`);
  
  // hotels[].image
  try {
    const hotels = JSON.parse(t.hotels || '[]');
    const withImg = hotels.filter(h => h.image && h.image.startsWith('http')).length;
    console.log(`hotels[].image: ${withImg === hotels.length && hotels.length > 0 ? '✅' : '⚠️'} ${withImg}/${hotels.length} have image`);
    if (hotels.length > 0) console.log(`  First hotel: ${JSON.stringify(hotels[0]).substring(0, 120)}`);
  } catch { console.log(`hotels[].image: ❌ PARSE ERROR`); }
  
  // meals[].image
  try {
    const meals = JSON.parse(t.meals || '[]');
    const withImg = meals.filter(m => m.image && m.image.startsWith('http')).length;
    console.log(`meals[].image: ${withImg === meals.length && meals.length > 0 ? '✅' : '⚠️'} ${withImg}/${meals.length} have image`);
    if (meals.length > 0) console.log(`  First meal: ${JSON.stringify(meals[0]).substring(0, 120)}`);
  } catch { console.log(`meals[].image: ❌ PARSE ERROR`); }
  
  // hotelImages
  try {
    const hi = JSON.parse(t.hotelImages || '[]');
    console.log(`hotelImages: ${hi.length > 0 ? '✅' : '❌'} ${hi.length} URLs`);
    if (hi.length > 0) console.log(`  First: ${hi[0].substring(0, 80)}`);
  } catch { console.log(`hotelImages: ❌ PARSE ERROR`); }
  
  // galleryImages
  try {
    const gi = JSON.parse(t.galleryImages || '[]');
    console.log(`galleryImages: ${gi.length > 0 ? '✅' : '❌'} ${gi.length} items`);
  } catch { console.log(`galleryImages: ❌ PARSE ERROR`); }
  
  // attractions
  try {
    const att = JSON.parse(t.attractions || '[]');
    console.log(`attractions: ${att.length > 0 ? '✅' : '❌'} ${att.length} items`);
    if (att.length > 0) console.log(`  First: ${JSON.stringify(att[0]).substring(0, 120)}`);
  } catch { console.log(`attractions: ❌ PARSE ERROR`); }
  
  console.log('\n[4/4] Done.');
  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
