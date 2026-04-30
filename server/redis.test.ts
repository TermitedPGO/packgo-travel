import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Redis from "ioredis";

describe.skipIf(!process.env.UPSTASH_REDIS_URL)("Upstash Redis Connection", () => {
  let redis: Redis;

  beforeAll(() => {
    const upstashUrl = process.env.UPSTASH_REDIS_URL;
    
    if (!upstashUrl) {
      throw new Error("UPSTASH_REDIS_URL environment variable is not set");
    }

    redis = new Redis(upstashUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      tls: {
        rejectUnauthorized: false,
      },
    });
  });

  afterAll(async () => {
    if (redis) {
      await redis.quit();
    }
  });

  it("should connect to Upstash Redis successfully", async () => {
    const pong = await redis.ping();
    expect(pong).toBe("PONG");
  }, 15000); // Upstash may have higher latency on first connection

  it("should be able to set and get a value", async () => {
    const testKey = `test:connection:${Date.now()}`;
    const testValue = "upstash-test-value";

    // Set value
    await redis.set(testKey, testValue, "EX", 60); // Expires in 60 seconds

    // Get value
    const result = await redis.get(testKey);
    expect(result).toBe(testValue);

    // Clean up
    await redis.del(testKey);
  });

  it("should support BullMQ operations (list push/pop)", async () => {
    const testQueue = `test:queue:${Date.now()}`;
    const testJob = JSON.stringify({ id: 1, data: "test" });

    // Push to list (BullMQ uses LPUSH/RPOP)
    await redis.lpush(testQueue, testJob);

    // Pop from list
    const result = await redis.rpop(testQueue);
    expect(result).toBe(testJob);
  });
});
