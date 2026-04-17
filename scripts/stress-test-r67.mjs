/**
 * Round 67 Stress Test: Generate 3 EU tours and verify hotels/meals/hotelImages image fields
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { Redis } = require('ioredis');
const jwt = require('jsonwebtoken');

dotenv.config();

const TEST_URLS = [
  'https://travel.liontravel.com/detail?NormGroupID=04551bca-bd79-4a7e-ab75-3001e00d8d9a&Platform=APP',
  'https://travel.liontravel.com/detail?NormGroupID=f7b48eee-ab26-4a42-99df-29af9baa9eae&Platform=APP',
  'https://travel.liontravel.com/detail?NormGroupID=a7614d8d-a36a-45ce-a0bf-5d9f844a10e5&Platform=APP',
];

const PROD_URL = 'https://packgo09.manus.space';

async function getAdminToken() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute("SELECT id, openId, email, role FROM users WHERE role='admin' LIMIT 1");
  await conn.end();
  if (!rows.length) throw new Error('No admin user found');
  const user = rows[0];
  const token = jwt.sign(
    { userId: user.id, openId: user.openId, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return token;
}

async function submitGeneration(url, token) {
  const body = JSON.stringify({ "0": { "json": { url, forceRegenerate: true, isPdf: false } } });
  const res = await fetch(`${PROD_URL}/api/trpc/tours.submitAsyncGeneration?batch=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `app_session_id=${token}`,
    },
    body,
  });
  const data = await res.json();
  const taskId = data?.[0]?.result?.data?.json?.taskId;
  if (!taskId) throw new Error(`No taskId returned: ${JSON.stringify(data).slice(0, 200)}`);
  return taskId;
}

async function pollStatus(taskId, token, maxWait = 300000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 8000));
    const res = await fetch(`${PROD_URL}/api/trpc/tours.getGenerationStatus?batch=1&input=${encodeURIComponent(JSON.stringify({"0":{"json":{"taskId":taskId}}}))}`, {
      headers: { 'Cookie': `app_session_id=${token}` },
    });
    const data = await res.json();
    const status = data?.[0]?.result?.data?.json;
    const step = status?.step || 'unknown';
    const progress = status?.progress || 0;
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`  [${elapsed}s] ${taskId}: ${step} (${progress}%)`);
    if (step === 'completed' || step === 'failed') return status;
  }
  throw new Error(`Timeout waiting for ${taskId}`);
}

async function verifyTour(tourId) {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute(
    'SELECT id, title, hotels, meals, hotelImages, createdAt FROM tours WHERE id = ?',
    [tourId]
  );
  await conn.end();
  if (!rows.length) return null;
  const tour = rows[0];
  let hotels = [], meals = [], hotelImages = [];
  try { hotels = JSON.parse(tour.hotels || '[]'); } catch {}
  try { meals = JSON.parse(tour.meals || '[]'); } catch {}
  try { hotelImages = JSON.parse(tour.hotelImages || '[]'); } catch {}
  return {
    id: tour.id,
    title: tour.title?.slice(0, 50),
    createdAt: tour.createdAt,
    hotels0: hotels[0] || null,
    meals0: meals[0] || null,
    hotelImages3: hotelImages.slice(0, 3),
    checks: {
      hotels0Image: hotels[0]?.image?.startsWith('http') ? '✅ PASS' : `❌ FAIL (${hotels[0]?.image || 'missing'})`,
      meals0Image: meals[0]?.image?.startsWith('http') ? '✅ PASS' : `❌ FAIL (${meals[0]?.image || 'missing'})`,
      hotelImages3: hotelImages.length >= 3 && hotelImages.slice(0, 3).every(u => u?.startsWith('http')) ? '✅ PASS' : `❌ FAIL (${hotelImages.length} items)`,
    }
  };
}

async function getLatestTourId(beforeId) {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute(
    'SELECT id FROM tours WHERE id > ? ORDER BY id DESC LIMIT 1',
    [beforeId]
  );
  await conn.end();
  return rows[0]?.id || null;
}

async function getMaxTourId() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute('SELECT MAX(id) as maxId FROM tours');
  await conn.end();
  return rows[0]?.maxId || 0;
}

async function main() {
  console.log('=== Round 67 Stress Test: 3 EU Tours ===\n');
  
  const token = await getAdminToken();
  console.log('✅ Admin token obtained\n');
  
  const results = [];
  
  for (let i = 0; i < TEST_URLS.length; i++) {
    const url = TEST_URLS[i];
    const normId = new URL(url).searchParams.get('NormGroupID');
    console.log(`\n--- Tour ${i+1}/3: ${normId} ---`);
    
    const beforeId = await getMaxTourId();
    
    try {
      const taskId = await submitGeneration(url, token);
      console.log(`  JobID: ${taskId}`);
      
      const status = await pollStatus(taskId, token);
      console.log(`  Final status: ${status.step}`);
      
      if (status.step === 'failed') {
        results.push({ url, normId, status: 'FAILED', error: status.error || 'unknown' });
        continue;
      }
      
      // Find the new tour ID
      await new Promise(r => setTimeout(r, 3000));
      const tourId = await getLatestTourId(beforeId);
      if (!tourId) {
        results.push({ url, normId, status: 'NO_TOUR_CREATED', error: 'No new tour found in DB' });
        continue;
      }
      
      const verification = await verifyTour(tourId);
      results.push({ url, normId, status: 'COMPLETED', ...verification });
      
      console.log(`  Tour ID: ${tourId}`);
      console.log(`  Title: ${verification.title}`);
      console.log(`  hotels[0].image: ${verification.checks.hotels0Image}`);
      console.log(`  meals[0].image: ${verification.checks.meals0Image}`);
      console.log(`  hotelImages[0-2]: ${verification.checks.hotelImages3}`);
      
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      results.push({ url, normId, status: 'ERROR', error: err.message });
    }
  }
  
  console.log('\n\n=== FINAL RESULTS TABLE ===');
  console.log('NormGroupID                           | Tour ID  | hotels[0].image | meals[0].image | hotelImages[0-2]');
  console.log('--------------------------------------|----------|-----------------|----------------|------------------');
  for (const r of results) {
    const id = r.id || 'N/A';
    const h = r.checks?.hotels0Image || r.status;
    const m = r.checks?.meals0Image || r.status;
    const hi = r.checks?.hotelImages3 || r.status;
    console.log(`${r.normId} | ${String(id).padEnd(8)} | ${h.padEnd(15)} | ${m.padEnd(14)} | ${hi}`);
  }
  
  const allPass = results.every(r => r.checks?.hotels0Image?.includes('PASS') && r.checks?.meals0Image?.includes('PASS') && r.checks?.hotelImages3?.includes('PASS'));
  console.log(`\n${allPass ? '✅ ALL 3 TOURS PASSED — Round 67 百分之百運行' : '❌ SOME TOURS FAILED — see details above'}`);
}

main().catch(console.error);
