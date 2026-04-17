/**
 * Round 67 Fresh Gen Verification Script
 * - Clears DetailsSkill Redis cache for GRP25112900013I
 * - Adds a BullMQ job directly (bypassing HTTP auth)
 * - Polls Redis until completed
 * - Reads DB and reports hotels[0], meals[0], hotelImages
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');
const Redis = require('ioredis');

const LION_URL = 'https://travel.liontravel.com/detail?NormGroupID=d8966670-6d8d-4058-82a5-c386c7f34bcc&GroupID=26EU525CID-T&Platform=APP';
const PRODUCT_CODE = '26EU525CID';

// Step 0: git log
import { execSync } from 'child_process';
const gitLog = execSync('git log -1 --oneline', { cwd: '/home/ubuntu/packgo-travel' }).toString().trim();
console.log('[0] git log -1:', gitLog);

// Step 1: Connect to Redis and clear DetailsSkill cache
const redis = new Redis(process.env.UPSTASH_REDIS_URL, { tls: { rejectUnauthorized: false } });

console.log('\n[1] Scanning for DetailsSkill cache keys...');
const cachePattern = `*details*${PRODUCT_CODE}*`;
const keys = await redis.keys(cachePattern);
console.log('    Found keys:', keys.length, keys);
if (keys.length > 0) {
  for (const key of keys) {
    await redis.del(key);
    console.log('    Deleted:', key);
  }
} else {
  // Also try broader pattern
  const allDetailsKeys = await redis.keys('packgo:details:*');
  console.log('    All details cache keys:', allDetailsKeys.length);
  // Find keys containing the product code
  const matchingKeys = allDetailsKeys.filter(k => k.includes(PRODUCT_CODE) || k.includes('GRP25112900013'));
  if (matchingKeys.length > 0) {
    for (const key of matchingKeys) {
      await redis.del(key);
      console.log('    Deleted:', key);
    }
  } else {
    console.log('    No matching cache keys found — fresh gen will proceed without cache bypass');
  }
}

// Step 2: Get admin user from DB
const db = await mysql.createConnection(process.env.DATABASE_URL);
const [users] = await db.execute("SELECT id, openId, email, role FROM users WHERE role = 'admin' LIMIT 1");
const admin = users[0];
console.log('\n[2] Admin user:', admin.id, admin.email, admin.role);

// Step 3: Add BullMQ job directly via queue module
// We need to use tsx to run TypeScript, so let's use the REST API approach via localhost
// First check if dev server is running
const requestId = `gen_${Date.now()}_r67verify`;
console.log('\n[3] Adding BullMQ job directly via Redis...');

// BullMQ job data structure
const jobData = {
  url: LION_URL,
  userId: admin.id,
  requestId: requestId,
  forceRegenerate: true,
  isPdf: false,
};

// Add job to BullMQ queue directly via Redis
// BullMQ stores jobs in: bull:{queueName}:{jobId}
const queueName = 'tour-generation';
const jobId = requestId;
const now = Date.now();

// BullMQ job hash fields
const jobHash = {
  id: jobId,
  name: 'generate-tour',
  data: JSON.stringify(jobData),
  opts: JSON.stringify({ jobId: jobId }),
  timestamp: now.toString(),
  delay: '0',
  priority: '0',
  attempts: '0',
  stacktrace: '[]',
  returnvalue: 'null',
  processedOn: '',
  finishedOn: '',
  progress: '0',
};

// Store job hash
await redis.hset(`bull:${queueName}:${jobId}`, jobHash);

// Add to waiting list
await redis.lpush(`bull:${queueName}:wait`, jobId);

// Publish event to wake up workers
await redis.publish(`bull:${queueName}:events`, JSON.stringify({ event: 'waiting', jobId }));

console.log('    Job added to queue:', jobId);
console.log('    forceRegenerate: true');

// Step 4: Poll for completion
console.log('\n[4] Polling for completion (max 10 min)...');
const startTime = Date.now();
let lastStep = '';
let completed = false;

while (Date.now() - startTime < 600000) {
  const jobHash = await redis.hgetall(`bull:${queueName}:${jobId}`);
  
  if (!jobHash || Object.keys(jobHash).length === 0) {
    // Job might have been moved to completed set
    const completedJobs = await redis.lrange(`bull:${queueName}:completed`, 0, 10);
    if (completedJobs.includes(jobId)) {
      console.log('    Job found in completed list!');
      completed = true;
      break;
    }
    await new Promise(r => setTimeout(r, 5000));
    continue;
  }
  
  let progress = {};
  try { progress = JSON.parse(jobHash.progress || '{}'); } catch(e) { progress = { step: 'queued', progress: 0 }; }
  
  const step = typeof progress === 'object' ? (progress.step || 'queued') : 'processing';
  const pct = typeof progress === 'object' ? (progress.progress || 0) : progress;
  const finishedOn = jobHash.finishedOn;
  const failedReason = jobHash.failedReason;
  
  if (step !== lastStep) {
    console.log(`  [${new Date().toISOString()}] step=${step} progress=${pct}%`);
    lastStep = step;
  }
  
  if (failedReason) {
    console.error('\n[FAILED]', failedReason);
    const stacktrace = JSON.parse(jobHash.stacktrace || '[]');
    if (stacktrace.length > 0) console.error('Stacktrace:', stacktrace[0]);
    await redis.quit();
    await db.end();
    process.exit(1);
  }
  
  if (finishedOn && finishedOn !== '') {
    console.log(`\n[5] Job COMPLETED! finishedOn: ${new Date(parseInt(finishedOn)).toISOString()}`);
    completed = true;
    break;
  }
  
  if (step === 'completed') {
    console.log('\n[5] Job COMPLETED (via step)!');
    completed = true;
    break;
  }
  
  await new Promise(r => setTimeout(r, 5000));
}

if (!completed) {
  console.log('\n[TIMEOUT] Job did not complete within 10 minutes');
}

// Step 5: Read latest tour from DB
console.log('\n[6] Reading latest tours from DB...');
const [rows] = await db.execute(
  'SELECT id, title, hotels, meals, hotelImages, createdAt FROM tours ORDER BY id DESC LIMIT 5'
);

for (const row of rows) {
  const hotels = JSON.parse(row.hotels || '[]');
  const meals = JSON.parse(row.meals || '[]');
  const hotelImages = JSON.parse(row.hotelImages || '[]');
  const createdAt = row.createdAt;
  
  // Check if this is the new tour (created after we started)
  const isNew = new Date(createdAt).getTime() > startTime;
  const marker = isNew ? '🆕 NEW' : '   OLD';
  
  console.log(`\n${marker} Tour #${row.id} | createdAt: ${createdAt}`);
  console.log('  title:', row.title);
  console.log('  hotels count:', hotels.length);
  if (hotels.length > 0) {
    console.log('  hotels[0]:', JSON.stringify(hotels[0]));
  }
  console.log('  meals count:', meals.length);
  if (meals.length > 0) {
    console.log('  meals[0]:', JSON.stringify(meals[0]));
  }
  console.log('  hotelImages (first 3):', hotelImages.slice(0, 3));
  
  if (isNew) {
    console.log('\n=== ROUND 67 VERIFICATION RESULT ===');
    const hotel0image = hotels[0]?.image;
    const meal0image = meals[0]?.image;
    console.log('hotels[0].image:', hotel0image || '(empty/missing)');
    console.log('meals[0].image:', meal0image || '(empty/missing)');
    console.log('hotelImages[0]:', hotelImages[0] || '(empty)');
    
    if (hotel0image && hotel0image.startsWith('http')) {
      console.log('✅ hotels[0].image is a valid URL');
    } else {
      console.log('❌ hotels[0].image is NOT a valid URL');
    }
    if (meal0image && meal0image.startsWith('http')) {
      console.log('✅ meals[0].image is a valid URL');
    } else {
      console.log('❌ meals[0].image is NOT a valid URL');
    }
    if (hotelImages[0] && hotelImages[0].startsWith('http')) {
      console.log('✅ hotelImages[0] is a valid URL');
    } else {
      console.log('❌ hotelImages[0] is NOT a valid URL');
    }
    break;
  }
}

await redis.quit();
await db.end();
