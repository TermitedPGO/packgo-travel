/**
 * Test for tour generation system (Phase 1 & 2)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { tourGenerationQueue } from "./queue";
import { tourGenerationWorker } from "./worker";

describe("Tour Generation System", () => {
  beforeAll(async () => {
    // Wait for worker to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
  });
  
  it("should have queue and worker initialized", async () => {
    expect(tourGenerationQueue).toBeDefined();
    expect(tourGenerationWorker).toBeDefined();
    
    // Check if worker is running
    const isRunning = await tourGenerationWorker.isRunning();
    expect(isRunning).toBe(true);
  });
  
  it("should be able to add a job to the queue", async () => {
    const testUrl = "https://www.liontravel.com/webpd/webpdsh00.aspx?sKind=1&sProd=24JO217BRC-T";
    const testUserId = 1;
    
    const job = await tourGenerationQueue.add("generate-tour", {
      url: testUrl,
      userId: testUserId,
      requestId: `test-${Date.now()}`,
    });
    
    expect(job).toBeDefined();
    expect(job.id).toBeDefined();
    expect(job.data.url).toBe(testUrl);
    expect(job.data.userId).toBe(testUserId);
    
    // Clean up: use force:true to remove even if locked by a worker
    try {
      await job.remove({ force: true });
    } catch {
      // If removal fails, it's not critical for the test assertion
    }
  }, 15000); // BullMQ job operations may take time with Upstash Redis
  
  it("should be able to get job status", async () => {
    const testUrl = "https://www.liontravel.com/webpd/webpdsh00.aspx?sKind=1&sProd=24JO217BRC-T";
    const testUserId = 1;
    
    const job = await tourGenerationQueue.add("generate-tour", {
      url: testUrl,
      userId: testUserId,
      requestId: `test-${Date.now()}`,
    });
    
    // Get job state
    const state = await job.getState();
    expect(state).toBeDefined();
    expect(["waiting", "active", "completed", "failed"]).toContain(state);
    
    // Clean up: use force:true to remove even if locked by a worker
    try {
      await job.remove({ force: true });
    } catch {
      // If removal fails, it's not critical for the test assertion
    }
  });
  
  it("should have correct queue configuration", async () => {
    // Check queue name
    expect(tourGenerationQueue.name).toBe("tour-generation");
    
    // Check if queue is ready
    const client = await tourGenerationQueue.client;
    expect(client).toBeDefined();
    
    // Check Redis connection
    const ping = await client.ping();
    expect(ping).toBe("PONG");
  });
  
  it("should have correct worker configuration", async () => {
    // Check worker name
    expect(tourGenerationWorker.name).toBe("tour-generation");
    
    // Check concurrency. 2026-05-26: lowered 4 → 2. The prior math sized for
    // request count, but translation calls are token-heavy: 4 concurrent tours
    // hit Anthropic's 450k input-token/min cap (429 storm). 2 gives ~240k/min
    // peak — comfortable headroom. See server/worker.ts concurrency comment.
    const opts = tourGenerationWorker.opts;
    expect(opts.concurrency).toBe(2);
    
    // Check rate limiter (should be 10 jobs per minute)
    expect(opts.limiter).toBeDefined();
    expect(opts.limiter?.max).toBe(10);
    expect(opts.limiter?.duration).toBe(60000); // 60 seconds
  });
});
