/**
 * LLM Response Cache Service
 * 
 * Caches LLM responses to avoid redundant API calls using Redis
 * Falls back to in-memory cache if Redis is unavailable
 * 
 * Cache Key Format: llm:cache:{prompt_hash}:{model}
 * TTL: 24 hours (86400 seconds)
 */

import { createHash } from "crypto";
import type { InvokeParams, InvokeResult } from "./llm";
import { redis } from "../redis";
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "llmCache" });

// Simple in-memory cache as fallback (when Redis is not available)
const memoryCache = new Map<string, { result: InvokeResult; expireAt: number }>();
let redisAvailable = true;

// Test Redis connection on startup
redis.ping().catch(() => {
  log.warn("[LLMCache] Redis unavailable, using memory cache fallback");
  redisAvailable = false;
});

/**
 * Generate cache key from LLM invocation parameters
 */
function generateCacheKey(params: InvokeParams): string {
  // Create a stable string representation of the request
  const cacheInput = {
    messages: params.messages,
    tools: params.tools,
    toolChoice: params.toolChoice || params.tool_choice,
    outputSchema: params.outputSchema || params.output_schema,
    responseFormat: params.responseFormat || params.response_format,
  };
  
  const jsonString = JSON.stringify(cacheInput);
  const hash = createHash("sha256").update(jsonString).digest("hex");

  // v67 FIX: include the actual model in cache key so Haiku/Sonnet/Opus
  // results don't collide. Previously hardcoded to "gemini-2.5-flash" which
  // meant every model shared a cache slot — guaranteed cross-model cache
  // poisoning, and effectively defeated the 24h cache for new model migrations.
  const model = (params as any).model || "claude-sonnet-4-5-20250929";
  return `llm:cache:${hash}:${model}`;
}

/**
 * Get cached LLM response
 */
export async function getCachedResponse(params: InvokeParams): Promise<InvokeResult | null> {
  const cacheKey = generateCacheKey(params);
  
  // Try Redis first (if available)
  if (redisAvailable) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        log.debug({ cacheKey: cacheKey.substring(0, 32) }, "[LLMCache] Redis cache HIT");
        return JSON.parse(cached) as InvokeResult;
      }
    } catch (error) {
      log.warn({ err: error }, "[LLMCache] Redis error, falling back to memory cache");
      redisAvailable = false;
    }
  }

  // Fallback to memory cache
  const memoryEntry = memoryCache.get(cacheKey);
  if (memoryEntry && memoryEntry.expireAt > Date.now()) {
    log.debug({ cacheKey: cacheKey.substring(0, 32) }, "[LLMCache] Memory cache HIT");
    return memoryEntry.result;
  }

  // Clean up expired memory cache entries
  if (memoryEntry && memoryEntry.expireAt <= Date.now()) {
    memoryCache.delete(cacheKey);
  }

  log.debug({ cacheKey: cacheKey.substring(0, 32) }, "[LLMCache] Cache MISS");
  return null;
}

/**
 * Cache LLM response
 * TTL: 24 hours (86400 seconds)
 */
export async function setCachedResponse(params: InvokeParams, result: InvokeResult): Promise<void> {
  const cacheKey = generateCacheKey(params);
  const ttl = 24 * 60 * 60; // 24 hours in seconds (for Redis SETEX)
  const expireAt = Date.now() + (ttl * 1000);
  
  // Store in Redis first (if available)
  if (redisAvailable) {
    try {
      await redis.setex(cacheKey, ttl, JSON.stringify(result));
      log.debug({ cacheKey: cacheKey.substring(0, 32), ttl }, "[LLMCache] Cached to Redis");
    } catch (error) {
      log.warn({ err: error }, "[LLMCache] Redis error, falling back to memory cache");
      redisAvailable = false;
    }
  }
  
  // Also store in memory cache as fallback
  memoryCache.set(cacheKey, { result, expireAt });
  
  // Clean up old entries (keep only last 1000 entries)
  if (memoryCache.size > 1000) {
    const sortedEntries = Array.from(memoryCache.entries())
      .sort((a, b) => b[1].expireAt - a[1].expireAt);
    
    // Keep only the 1000 most recent entries
    memoryCache.clear();
    sortedEntries.slice(0, 1000).forEach(([key, value]) => {
      memoryCache.set(key, value);
    });
    
    log.debug({ size: memoryCache.size }, "[LLMCache] Cleaned up memory cache");
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats() {
  const now = Date.now();
  const validEntries = Array.from(memoryCache.values()).filter(
    entry => entry.expireAt > now
  );
  
  let redisKeys = 0;
  if (redisAvailable) {
    try {
      const keys = await redis.keys("llm:cache:*");
      redisKeys = keys.length;
    } catch (error) {
      log.warn({ err: error }, "[LLMCache] Failed to get Redis stats");
    }
  }
  
  return {
    redis: {
      available: redisAvailable,
      keys: redisKeys,
    },
    memory: {
      totalEntries: memoryCache.size,
      validEntries: validEntries.length,
      expiredEntries: memoryCache.size - validEntries.length,
    },
  };
}

/**
 * Clear all cached responses
 */
export async function clearCache(): Promise<void> {
  // Clear Redis cache
  if (redisAvailable) {
    try {
      const keys = await redis.keys("llm:cache:*");
      if (keys.length > 0) {
        await redis.del(...keys);
        log.info({ count: keys.length }, "[LLMCache] Cleared Redis cache entries");
      }
    } catch (error) {
      log.warn({ err: error }, "[LLMCache] Failed to clear Redis cache");
    }
  }

  // Clear memory cache
  memoryCache.clear();
  log.info("[LLMCache] Memory cache cleared");
}
