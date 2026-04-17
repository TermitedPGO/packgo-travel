import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';

const LION_URL = 'https://travel.liontravel.com/package/detail/GRP25112900013I';
const PROD_URL = 'https://packgo09.manus.space';

// Step 1: Get admin user from DB
const db = await mysql.createConnection(process.env.DATABASE_URL);
const [users] = await db.execute("SELECT id, openId, email, role FROM users WHERE role = 'admin' LIMIT 1");
const admin = users[0];
console.log('[1] Admin user:', admin.id, admin.email, admin.role);

// Step 2: Generate JWT
const token = jwt.sign(
  { userId: admin.id, openId: admin.openId, email: admin.email, role: admin.role },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

// Step 3: Trigger generation
console.log('[2] Triggering generation on packgo09.manus.space...');
const triggerRes = await fetch(`${PROD_URL}/api/trpc/tours.submitAsyncGeneration?batch=1`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': `app_session_id=${token}`
  },
  body: JSON.stringify({ "0": { "json": { "url": LION_URL, "forceRegenerate": true } } })
});
const triggerData = await triggerRes.json();
const jobId = triggerData[0]?.result?.data?.json?.jobId;
console.log('[3] jobId:', jobId);

if (!jobId) {
  console.error('ERROR: No jobId returned. Response:', JSON.stringify(triggerData));
  await db.end();
  process.exit(1);
}

// Step 4: Poll Redis for completion
const redis = new Redis(process.env.UPSTASH_REDIS_URL, { tls: { rejectUnauthorized: false } });
console.log('[4] Polling for completion (max 10 min)...');
const startTime = Date.now();
let lastStep = '';
while (Date.now() - startTime < 600000) {
  const jobData = await redis.hgetall('bull:tour-generation:' + jobId);
  const progress = JSON.parse(jobData?.progress || '{}');
  const step = progress.step || 'unknown';
  const pct = progress.progress || 0;
  const finishedOn = jobData?.finishedOn;
  const failedReason = jobData?.failedReason;
  
  if (step !== lastStep) {
    console.log(`  [${new Date().toISOString()}] step=${step} progress=${pct}%`);
    lastStep = step;
  }
  
  if (failedReason) {
    console.error('[FAILED]', failedReason);
    await redis.quit();
    await db.end();
    process.exit(1);
  }
  
  if (finishedOn || step === 'completed') {
    console.log('[5] Job COMPLETED! finishedOn:', finishedOn ? new Date(parseInt(finishedOn)).toISOString() : 'N/A');
    break;
  }
  
  await new Promise(r => setTimeout(r, 5000));
}

// Step 5: Get tour from DB
const [tours] = await db.execute(
  "SELECT id, slug, title, hotels, meals, hotel_images, gallery_images, attractions FROM tours ORDER BY id DESC LIMIT 3"
);
console.log('\n[6] Latest 3 tours:');
for (const tour of tours) {
  const hotels = JSON.parse(tour.hotels || '[]');
  const meals = JSON.parse(tour.meals || '[]');
  const hotelImages = JSON.parse(tour.hotel_images || '[]');
  
  console.log(`\n  Tour #${tour.id} | slug: ${tour.slug}`);
  console.log(`  title: ${tour.title}`);
  console.log(`  hotels count: ${hotels.length}`);
  console.log(`  hotels[0]:`, JSON.stringify(hotels[0] || null));
  console.log(`  meals count: ${meals.length}`);
  console.log(`  meals[0]:`, JSON.stringify(meals[0] || null));
  console.log(`  hotelImages[0]:`, hotelImages[0] || null);
}

await redis.quit();
await db.end();
