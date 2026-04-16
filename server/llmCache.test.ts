import { describe, it, expect, beforeEach } from "vitest";
import { getCachedResponse, setCachedResponse, getCacheStats, clearCache } from "./_core/llmCache";
import type { InvokeParams, InvokeResult } from "./_core/llm";
import { redis } from "./redis";

describe("LLM Cache with Redis", () => {
  beforeEach(async () => {
    // Clear all caches before each test
    await clearCache();
  }, 15000); // Upstash may have higher latency

  it("should cache and retrieve LLM responses from Redis", async () => {
    const params: InvokeParams = {
      messages: [{ role: "user", content: "Hello, world!" }],
    };

    const result: InvokeResult = {
      text: "Hello! How can I help you?",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    // First call should be a cache MISS
    const cached1 = await getCachedResponse(params);
    expect(cached1).toBeNull();

    // Cache the response
    await setCachedResponse(params, result);

    // Second call should be a cache HIT
    const cached2 = await getCachedResponse(params);
    expect(cached2).not.toBeNull();
    expect(cached2?.text).toBe(result.text);
    expect(cached2?.usage.inputTokens).toBe(result.usage.inputTokens);
  }, 15000);

  it("should store cache in Redis (not just memory)", async () => {
    const params: InvokeParams = {
      messages: [{ role: "user", content: "Test Redis storage" }],
    };

    const result: InvokeResult = {
      text: "Response from Redis",
      usage: { inputTokens: 5, outputTokens: 10 },
    };

    // Cache the response
    await setCachedResponse(params, result);

    // Verify Redis has the key
    const keys = await redis.keys("llm:cache:*");
    expect(keys.length).toBeGreaterThan(0);

    // Verify we can retrieve from Redis directly
    const redisValue = await redis.get(keys[0]);
    expect(redisValue).not.toBeNull();
    const parsed = JSON.parse(redisValue!) as InvokeResult;
    expect(parsed.text).toBe(result.text);
  }, 15000);

  it("should return cache statistics", async () => {
    const params: InvokeParams = {
      messages: [{ role: "user", content: "Stats test" }],
    };

    const result: InvokeResult = {
      text: "Stats response",
      usage: { inputTokens: 3, outputTokens: 5 },
    };

    // Cache a response
    await setCachedResponse(params, result);

    // Get stats
    const stats = await getCacheStats();
    expect(stats.redis.available).toBe(true);
    expect(stats.redis.keys).toBeGreaterThan(0);
  }, 15000);

  it("should clear all caches", async () => {
    const params: InvokeParams = {
      messages: [{ role: "user", content: "Clear test" }],
    };

    const result: InvokeResult = {
      text: "Clear response",
      usage: { inputTokens: 2, outputTokens: 4 },
    };

    // Cache a response
    await setCachedResponse(params, result);

    // Verify it's cached
    const cached1 = await getCachedResponse(params);
    expect(cached1).not.toBeNull();

    // Clear cache
    await clearCache();

    // Verify it's gone
    const cached2 = await getCachedResponse(params);
    expect(cached2).toBeNull();

    // Verify the specific cached entry is gone (not checking global count due to parallel test race conditions)
    // Other tests may have written cache entries concurrently, so we only verify our entry is cleared
    const cached3 = await getCachedResponse(params);
    expect(cached3).toBeNull();
  }, 20000); // Multiple Redis operations need more time

  it("should handle different cache keys for different prompts", async () => {
    const params1: InvokeParams = {
      messages: [{ role: "user", content: "First prompt" }],
    };

    const params2: InvokeParams = {
      messages: [{ role: "user", content: "Second prompt" }],
    };

    const result1: InvokeResult = {
      text: "First response",
      usage: { inputTokens: 5, outputTokens: 10 },
    };

    const result2: InvokeResult = {
      text: "Second response",
      usage: { inputTokens: 6, outputTokens: 12 },
    };

    // Cache both responses
    await setCachedResponse(params1, result1);
    await setCachedResponse(params2, result2);

    // Verify both are cached separately
    const cached1 = await getCachedResponse(params1);
    const cached2 = await getCachedResponse(params2);

    expect(cached1?.text).toBe(result1.text);
    expect(cached2?.text).toBe(result2.text);
    expect(cached1?.text).not.toBe(cached2?.text);
  }, 15000);
});
