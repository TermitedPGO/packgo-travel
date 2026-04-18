/**
 * Regen tour 2340001 (春遊德荷10日) with forceRegenerate=true and verify Round 67 image fields
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');

dotenv.config();

const PROD_URL = 'https://packgo09.manus.space';
const SOURCE_URL = 'https://travel.liontravel.com/detail?NormGroupID=44edaf44-3262-44c0-8f7a-961ecd66e1bf&GroupID=26EU605CIB-T&Platform=APP&fr=cg297C0401C0201M01';

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

async function getTourImageFields(tourId) {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute(
    'SELECT id, hotels, meals, hotelImages, updatedAt FROM tours WHERE id = ?',
    [tourId]
  );
  await conn.end();
  if (!rows.length) return null;
  const t = rows[0];
  let hotels = [], meals = [], hotelImages = [];
  try { hotels = JSON.parse(t.hotels || '[]'); } catch {}
  try { meals = JSON.parse(t.meals || '[]'); } catch {}
  try { hotelImages = JSON.parse(t.hotelImages || '[]'); } catch {}
  return { hotels, meals, hotelImages, updatedAt: t.updatedAt };
}

async function main() {
  console.log('=== Regen Tour 2340001: 春遊德荷10日 ===\n');

  const token = await getAdminToken();
  console.log('✅ Admin token obtained');

  // Step 1: Submit regen
  const startTime = Date.now();
  const body = JSON.stringify({ "0": { "json": { url: SOURCE_URL, forceRegenerate: true, isPdf: false } } });
  const res = await fetch(`${PROD_URL}/api/trpc/tours.submitAsyncGeneration?batch=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `app_session_id=${token}`,
    },
    body,
  });
  const data = await res.json();
  const jobId = data?.[0]?.result?.data?.json?.jobId || data?.[0]?.result?.data?.json?.taskId;
  if (!jobId) throw new Error(`No jobId returned: ${JSON.stringify(data).slice(0, 200)}`);
  console.log(`✅ Job submitted: ${jobId}`);

  // Step 2: Poll until completed
  let finalStatus = null;
  const maxWait = 300000;
  while (Date.now() - startTime < maxWait) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const pollRes = await fetch(`${PROD_URL}/api/trpc/tours.getGenerationStatus?batch=1&input=${encodeURIComponent(JSON.stringify({"0":{"json":{"taskId":jobId}}}))}`, {
        headers: { 'Cookie': `app_session_id=${token}` },
      });
      const pollData = await pollRes.json();
      const status = pollData?.[0]?.result?.data?.json;
      const step = status?.step || 'unknown';
      const progress = status?.progress || 0;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      process.stdout.write(`  [${elapsed}s] ${step} (${progress}%)\r`);
      if (step === 'completed' || step === 'failed') {
        finalStatus = status;
        console.log(`\n✅ Job finished: ${step} in ${elapsed}s`);
        break;
      }
    } catch (err) {
      // ignore poll errors, keep trying
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  if (!finalStatus) {
    // Check Redis directly for final status
    const { Redis } = require('ioredis');
    const redis = new Redis(process.env.UPSTASH_REDIS_URL, { tls: { rejectUnauthorized: false }, maxRetriesPerRequest: 3 });
    const jobData = await redis.hgetall(`bull:tour-generation:${jobId}`);
    await redis.quit();
    const progress = JSON.parse(jobData.progress || '{}');
    console.log(`\n  Redis status: ${progress.step} (${progress.progress}%) in ${elapsed}s`);
    if (progress.step !== 'completed') {
      console.log('❌ Job did not complete within timeout');
      return;
    }
  }

  // Step 3: Wait a moment then verify
  await new Promise(r => setTimeout(r, 3000));
  const result = await getTourImageFields(2340001);
  if (!result) {
    console.log('❌ Tour 2340001 not found in DB');
    return;
  }

  const { hotels, meals, hotelImages } = result;

  console.log('\n=== VERIFICATION: Tour 2340001 After Regen ===');
  console.log(`hotels[0].image: ${hotels[0]?.image || 'MISSING'}`);
  console.log(`meals[0].image: ${meals[0]?.image || 'MISSING'}`);
  console.log(`hotelImages.length: ${hotelImages.length}`);
  console.log(`hotelImages[0]: ${hotelImages[0] || 'MISSING'}`);
  console.log(`hotelImages[1]: ${hotelImages[1] || 'MISSING'}`);
  console.log(`hotelImages[2]: ${hotelImages[2] || 'MISSING'}`);

  const h0ok = hotels[0]?.image?.startsWith('http');
  const m0ok = meals[0]?.image?.startsWith('http');
  const hiok = hotelImages.length >= 3 && hotelImages.slice(0, 3).every(u => u?.startsWith('http'));

  console.log('\n=== BEFORE vs AFTER ===');
  console.log('Field              | BEFORE          | AFTER');
  console.log('-------------------|-----------------|------------------');
  console.log(`hotels[0].image    | MISSING         | ${h0ok ? '✅ ' + hotels[0].image.slice(0, 50) + '...' : '❌ ' + (hotels[0]?.image || 'MISSING')}`);
  console.log(`meals[0].image     | MISSING         | ${m0ok ? '✅ ' + meals[0].image.slice(0, 50) + '...' : '❌ ' + (meals[0]?.image || 'MISSING')}`);
  console.log(`hotelImages.length | 8 (existed)     | ${hiok ? '✅ ' + hotelImages.length + ' items' : '❌ ' + hotelImages.length + ' items'}`);

  console.log(`\nJob elapsed: ${elapsed}s`);
  console.log(h0ok && m0ok && hiok ? '\n✅ ALL CHECKS PASSED — Tour 2340001 fully upgraded to R67 standard' : '\n❌ SOME CHECKS FAILED');
}

main().catch(console.error);
