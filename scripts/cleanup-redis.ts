/**
 * Round 36: Redis BullMQ Cleanup Script
 * Cleans up stalled/stuck jobs in the tour-generation queue
 */
import { Queue } from 'bullmq';
import { redisBullMQ } from '../server/redis';

const queue = new Queue('tour-generation', { connection: redisBullMQ });

async function main() {
  try {
    // Get counts before cleanup
    const counts = await queue.getJobCounts();
    console.log('Before cleanup:', JSON.stringify(counts));
    
    // Clean failed jobs older than 1 hour
    const cleanedFailed = await queue.clean(3600000, 100, 'failed');
    console.log(`Cleaned ${cleanedFailed.length} failed jobs`);
    
    // Clean completed jobs older than 1 hour  
    const cleanedCompleted = await queue.clean(3600000, 100, 'completed');
    console.log(`Cleaned ${cleanedCompleted.length} completed jobs`);
    
    // Check active (potentially stalled) jobs
    const activeJobs = await queue.getJobs(['active']);
    console.log(`Active jobs: ${activeJobs.length}`);
    for (const job of activeJobs) {
      const age = Date.now() - (job.timestamp || 0);
      const ageMin = Math.round(age / 60000);
      console.log(`  Job ${job.id}: age=${ageMin}min, data=${JSON.stringify(job.data).slice(0, 80)}`);
      if (age > 30 * 60 * 1000) { // older than 30 minutes
        console.log(`  → Stalled! Moving to failed...`);
        try {
          await job.moveToFailed(new Error('Manually cleaned up stalled job (>30min)'), 'cleanup');
          console.log(`  → Done`);
        } catch (e) {
          console.log(`  → Error: ${e}`);
        }
      }
    }
    
    const countsAfter = await queue.getJobCounts();
    console.log('After cleanup:', JSON.stringify(countsAfter));
    console.log('✅ Redis cleanup complete');
  } catch (err) {
    console.error('Redis cleanup error:', err);
  } finally {
    await queue.close();
    await redisBullMQ.quit().catch(() => {});
    process.exit(0);
  }
}

main();
