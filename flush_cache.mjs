import * as dotenv from 'dotenv';
dotenv.config();
import Redis from 'ioredis';

const REDIS_URL = process.env.UPSTASH_REDIS_URL;

if (!REDIS_URL) {
  console.error('UPSTASH_REDIS_URL not set');
  process.exit(1);
}

console.log('Connecting to Redis...');
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  connectTimeout: 10000,
  commandTimeout: 15000,
  tls: REDIS_URL.startsWith('rediss://') ? {} : undefined,
});

redis.on('error', (err) => {
  console.error('Redis error:', err.message);
});

try {
  // Get all packgo:* keys
  const keys = await redis.keys('packgo:*');
  console.log(`Found ${keys.length} packgo:* keys`);
  
  if (keys.length > 0) {
    // Show breakdown
    const scrapeKeys = keys.filter(k => k.includes(':scrape:'));
    const llmKeys = keys.filter(k => k.includes(':llm:'));
    const fullKeys = keys.filter(k => k.includes(':full:'));
    const otherKeys = keys.filter(k => !k.includes(':scrape:') && !k.includes(':llm:') && !k.includes(':full:'));
    
    console.log(`  - scrape keys: ${scrapeKeys.length}`);
    console.log(`  - llm keys: ${llmKeys.length}`);
    console.log(`  - full result keys: ${fullKeys.length}`);
    console.log(`  - other keys: ${otherKeys.length}`);
    
    // Delete in batches of 100
    const batchSize = 100;
    let deleted = 0;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      await redis.del(...batch);
      deleted += batch.length;
    }
    
    console.log(`✅ Deleted ${deleted} cache keys`);
  } else {
    console.log('No cache keys found (already empty or different prefix)');
  }
  
  // Verify
  const remaining = await redis.keys('packgo:*');
  console.log(`Remaining packgo:* keys after flush: ${remaining.length}`);
  
} catch (err) {
  console.error('Error flushing cache:', err.message);
  process.exit(1);
} finally {
  await redis.quit();
}
