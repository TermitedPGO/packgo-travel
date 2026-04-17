/**
 * Poll and verify the 3 already-submitted EU tour jobs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');

dotenv.config();

const PROD_URL = 'https://packgo09.manus.space';

// Jobs already submitted
const JOBS = [
  { jobId: 'gen_1776445886902_stj5p', normId: '04551bca-bd79-4a7e-ab75-3001e00d8d9a' },
  { jobId: 'gen_1776445887590_g4p6fp', normId: 'f7b48eee-ab26-4a42-99df-29af9baa9eae' },
  { jobId: 'gen_1776445888616_atjkn', normId: 'a7614d8d-a36a-45ce-a0bf-5d9f844a10e5' },
];

async function getAdminToken() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute("SELECT id, openId, email, role FROM users WHERE role='admin' LIMIT 1");
  await conn.end();
  if (!rows.length) throw new Error('No admin user found');
  const user = rows[0];
  return jwt.sign(
    { userId: user.id, openId: user.openId, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function pollStatus(jobId, token, maxWait = 360000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const res = await fetch(`${PROD_URL}/api/trpc/tours.getGenerationStatus?batch=1&input=${encodeURIComponent(JSON.stringify({"0":{"json":{"taskId":jobId}}}))}`, {
        headers: { 'Cookie': `app_session_id=${token}` },
      });
      const data = await res.json();
      const status = data?.[0]?.result?.data?.json;
      const step = status?.step || 'unknown';
      const progress = status?.progress || 0;
      const elapsed = Math.round((Date.now() - start) / 1000);
      process.stdout.write(`  [${elapsed}s] ${step} (${progress}%)\r`);
      if (step === 'completed' || step === 'failed') {
        console.log(`\n  Final: ${step} (${progress}%)`);
        return status;
      }
    } catch (err) {
      console.log(`  Poll error: ${err.message}`);
    }
  }
  throw new Error(`Timeout waiting for ${jobId}`);
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
    hotels0: hotels[0] || null,
    meals0: meals[0] || null,
    hotelImages3: hotelImages.slice(0, 3),
    checks: {
      hotels0Image: hotels[0]?.image?.startsWith('http') ? '✅ PASS' : `❌ FAIL (${hotels[0]?.image ?? 'missing'})`,
      meals0Image: meals[0]?.image?.startsWith('http') ? '✅ PASS' : `❌ FAIL (${meals[0]?.image ?? 'missing'})`,
      hotelImages3: hotelImages.length >= 3 && hotelImages.slice(0, 3).every(u => u?.startsWith('http')) ? '✅ PASS' : `❌ FAIL (${hotelImages.length} items)`,
    }
  };
}

async function findTourByNormId(normId) {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute(
    "SELECT id FROM tours WHERE sourceUrl LIKE ? ORDER BY id DESC LIMIT 1",
    [`%${normId}%`]
  );
  await conn.end();
  return rows[0]?.id || null;
}

async function main() {
  console.log('=== Round 67 Stress Test: Poll & Verify 3 EU Tours ===\n');
  const token = await getAdminToken();
  console.log('✅ Admin token obtained\n');

  const results = [];

  for (let i = 0; i < JOBS.length; i++) {
    const { jobId, normId } = JOBS[i];
    console.log(`\n--- Tour ${i+1}/3: ${normId} ---`);
    console.log(`  JobID: ${jobId}`);

    try {
      const status = await pollStatus(jobId, token);

      if (status.step === 'failed') {
        results.push({ normId, status: 'FAILED', error: status.error || 'unknown' });
        continue;
      }

      await new Promise(r => setTimeout(r, 3000));
      const tourId = await findTourByNormId(normId);
      if (!tourId) {
        results.push({ normId, status: 'NO_TOUR_CREATED', error: 'No tour found in DB' });
        continue;
      }

      const v = await verifyTour(tourId);
      results.push({ normId, status: 'COMPLETED', ...v });

      console.log(`  Tour ID: ${tourId}`);
      console.log(`  Title: ${v.title}`);
      console.log(`  hotels[0]: ${JSON.stringify(v.hotels0)}`);
      console.log(`  meals[0]: ${JSON.stringify(v.meals0)}`);
      console.log(`  hotelImages[0-2]: ${JSON.stringify(v.hotelImages3)}`);
      console.log(`  ✓ hotels[0].image: ${v.checks.hotels0Image}`);
      console.log(`  ✓ meals[0].image: ${v.checks.meals0Image}`);
      console.log(`  ✓ hotelImages[0-2]: ${v.checks.hotelImages3}`);

    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      results.push({ normId, status: 'ERROR', error: err.message });
    }
  }

  console.log('\n\n=== FINAL RESULTS TABLE ===');
  console.log('NormGroupID (short)   | Tour ID  | hotels[0].image | meals[0].image | hotelImages[0-2]');
  console.log('----------------------|----------|-----------------|----------------|------------------');
  for (const r of results) {
    const shortId = r.normId.slice(0, 20);
    const id = r.id || 'N/A';
    const h = r.checks?.hotels0Image || r.status;
    const m = r.checks?.meals0Image || r.status;
    const hi = r.checks?.hotelImages3 || r.status;
    console.log(`${shortId}... | ${String(id).padEnd(8)} | ${h.padEnd(15)} | ${m.padEnd(14)} | ${hi}`);
  }

  const allPass = results.every(r =>
    r.checks?.hotels0Image?.includes('PASS') &&
    r.checks?.meals0Image?.includes('PASS') &&
    r.checks?.hotelImages3?.includes('PASS')
  );
  console.log(`\n${allPass ? '✅ ALL 3 TOURS PASSED — Round 67 百分之百運行' : '❌ SOME TOURS FAILED — see details above'}`);
}

main().catch(console.error);
