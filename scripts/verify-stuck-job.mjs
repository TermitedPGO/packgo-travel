import Redis from 'ioredis';

const redis = new Redis(process.env.UPSTASH_REDIS_URL, { tls: { rejectUnauthorized: false } });
const jobId = 'gen_1776384943702_cxi7ci';

const jobData = await redis.hgetall('bull:tour-generation:' + jobId);
const progress = JSON.parse(jobData.progress || '{}');
const lock = await redis.get('bull:tour-generation:' + jobId + ':lock');
const activeJobs = await redis.lrange('bull:tour-generation:active', 0, -1);

console.log('=== STUCK JOB STATUS ===');
console.log('jobId:', jobId);
console.log('finishedOn:', jobData.finishedOn || 'NOT FINISHED');
console.log('failedReason:', jobData.failedReason || 'NONE');
console.log('step:', progress.step);
console.log('progress:', progress.progress + '%');
console.log('lock:', lock ? 'STILL HELD (' + lock + ')' : '✅ RELEASED');
console.log('in active set:', activeJobs.includes(jobId) ? 'YES (still active)' : '✅ NOT IN ACTIVE SET');
console.log('active jobs count:', activeJobs.length);
console.log('active jobs:', activeJobs);

await redis.quit();
