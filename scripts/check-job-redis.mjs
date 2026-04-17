import Redis from 'ioredis';

const redis = new Redis(process.env.UPSTASH_REDIS_URL, { tls: { rejectUnauthorized: false } });
const jobId = 'gen_1776384943702_cxi7ci';

// 1. Job state
const jobData = await redis.hgetall('bull:tour-generation:' + jobId);
const progress = JSON.parse(jobData.progress || '{}');
const lastUpdate = new Date(progress.timestamp);
const now = new Date();

console.log('=== JOB TIMING ===');
console.log('Job created:', new Date(parseInt(jobData.timestamp)).toISOString());
console.log('Processing started:', new Date(parseInt(jobData.processedOn)).toISOString());
console.log('Last progress update:', lastUpdate.toISOString());
console.log('Current time:', now.toISOString());
console.log('Minutes since last update:', Math.round((now - lastUpdate) / 60000));
console.log('finishedOn:', jobData.finishedOn || 'NOT FINISHED');
console.log('failedReason:', jobData.failedReason || 'NONE');
console.log('stacktrace:', jobData.stacktrace || 'NONE');

// 2. Lock
const lock = await redis.get('bull:tour-generation:' + jobId + ':lock');
console.log('\n=== LOCK ===');
console.log('Lock token:', lock || 'NO LOCK');

// 3. Active jobs
const activeJobs = await redis.lrange('bull:tour-generation:active', 0, -1);
console.log('\n=== ACTIVE JOBS ===');
console.log(activeJobs);

// 4. Italy tour cache keys
const italyKeys = await redis.keys('*26EI418CIB*');
console.log('\n=== ITALY TOUR CACHE KEYS ===');
for (const k of italyKeys) {
  const type = await redis.type(k);
  console.log(`  ${k} (${type})`);
  if (type === 'string') {
    const val = await redis.get(k);
    console.log(`    value length: ${val.length}`);
    console.log(`    preview: ${val.slice(0, 200)}`);
  }
}

// 5. Details cache
const detailsKeys = await redis.keys('*details*');
console.log('\n=== DETAILS CACHE KEYS ===');
console.log(`Total: ${detailsKeys.length}`);
for (const k of detailsKeys.slice(0, 10)) {
  console.log(`  ${k}`);
}

// 6. Check for any error/retry keys
const errorKeys = await redis.keys('*error*');
console.log('\n=== ERROR KEYS ===');
console.log(`Total: ${errorKeys.length}`);
errorKeys.forEach(k => console.log(`  ${k}`));

// 7. Full progress dump
console.log('\n=== FULL PROGRESS ===');
console.log(JSON.stringify(progress, null, 2));

await redis.quit();
