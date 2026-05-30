/**
 * Unit tests for the bot-UA prerender middleware (server/_core/prerenderMiddleware.ts).
 * Pure helpers + the request decision tree. renderForBot and Redis are mocked
 * so no Chrome / Redis is touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// Mock Redis BEFORE importing the middleware — the real module opens a
// connection on import (lazyConnect: false).
vi.mock("./redis", () => ({
  default: { get: vi.fn(), set: vi.fn() },
  redis: { get: vi.fn(), set: vi.fn() },
  redisBullMQ: {},
}));
vi.mock("./_core/prerender", () => ({ renderForBot: vi.fn() }));
vi.mock("./_core/logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { Request, Response, NextFunction } from "express";
import redis from "./redis";
import { renderForBot } from "./_core/prerender";
import {
  isBot,
  shouldPrerender,
  cacheKey,
  prerenderMiddleware,
} from "./_core/prerenderMiddleware";

const mockGet = redis.get as unknown as Mock;
const mockSet = redis.set as unknown as Mock;
const mockRender = renderForBot as unknown as Mock;

const GOOGLEBOT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const HUMAN =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function makeReq(over: Partial<Request> = {}): Request {
  return {
    method: "GET",
    headers: { "user-agent": GOOGLEBOT },
    path: "/about-us",
    query: {},
    ...over,
  } as unknown as Request;
}

function makeRes(): Response & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    _headers: headers,
    set: vi.fn((k: string, v: string) => {
      headers[k] = v;
      return res;
    }),
    send: vi.fn(() => res),
  };
  return res as unknown as Response & { _headers: Record<string, string> };
}

describe("isBot", () => {
  it("matches search + AI + social bots (case-insensitive)", () => {
    for (const ua of [
      GOOGLEBOT,
      "PerplexityBot/1.0",
      "GPTBot",
      "Mozilla/5.0 (compatible; ClaudeBot/1.0)",
      "facebookexternalhit/1.1",
      "Twitterbot/1.0",
      "Bytespider",
    ]) {
      expect(isBot(ua)).toBe(true);
    }
  });

  it("does not match real browsers or empty UA", () => {
    expect(isBot(HUMAN)).toBe(false);
    expect(isBot(undefined)).toBe(false);
    expect(isBot("")).toBe(false);
  });
});

describe("shouldPrerender", () => {
  it("allows real SEO pages", () => {
    for (const p of ["/", "/about-us", "/faq", "/tours", "/tours/abc123", "/visa-services"]) {
      expect(shouldPrerender(p)).toBe(true);
    }
  });

  it("skips API, assets, SEO/health endpoints, and private areas", () => {
    for (const p of [
      "/api/trpc/x",
      "/__manus__/logs",
      "/sitemap.xml",
      "/robots.txt",
      "/healthz",
      "/app.js",
      "/assets/index-abc.css",
      "/images/logo.png",
      "/admin",
      "/admin/tours",
      "/profile",
      "/bookings/5",
      "/book/5",
      "/payment/success",
    ]) {
      expect(shouldPrerender(p)).toBe(false);
    }
  });
});

describe("cacheKey", () => {
  it("is versioned and path-scoped", () => {
    expect(cacheKey("/faq")).toContain("/faq");
    expect(cacheKey("/faq")).toMatch(/^prerender:/);
    expect(cacheKey("/a")).not.toBe(cacheKey("/b"));
  });
});

describe("prerenderMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PRERENDER_ENABLED = "1";
  });
  afterEach(() => {
    delete process.env.PRERENDER_ENABLED;
  });

  it("passes through when disabled", async () => {
    process.env.PRERENDER_ENABLED = "0";
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await prerenderMiddleware(makeReq(), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("passes through non-GET requests", async () => {
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await prerenderMiddleware(makeReq({ method: "POST" }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("passes through real browser UAs", async () => {
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await prerenderMiddleware(
      makeReq({ headers: { "user-agent": HUMAN } }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("passes through bot requests for assets", async () => {
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await prerenderMiddleware(makeReq({ path: "/app.js" }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("serves cached HTML on a hit without rendering", async () => {
    mockGet.mockResolvedValue("<html>cached</html>");
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await prerenderMiddleware(makeReq(), res, next);
    expect(res.send).toHaveBeenCalledWith("<html>cached</html>");
    expect(res._headers["X-Prerender"]).toBe("hit");
    expect(mockRender).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("renders, caches, and serves on a miss", async () => {
    mockGet.mockResolvedValue(null);
    mockRender.mockResolvedValue("<html>fresh ld+json</html>");
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await prerenderMiddleware(makeReq(), res, next);
    expect(mockRender).toHaveBeenCalledWith("/about-us");
    expect(mockSet).toHaveBeenCalledOnce();
    expect(res.send).toHaveBeenCalledWith("<html>fresh ld+json</html>");
    expect(res._headers["X-Prerender"]).toBe("miss");
    expect(next).not.toHaveBeenCalled();
  });

  it("falls back to next() when render returns null", async () => {
    mockGet.mockResolvedValue(null);
    mockRender.mockResolvedValue(null);
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await prerenderMiddleware(makeReq(), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.send).not.toHaveBeenCalled();
  });

  it("never throws — render rejection falls back to next()", async () => {
    mockGet.mockResolvedValue(null);
    mockRender.mockRejectedValue(new Error("boom"));
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await expect(
      prerenderMiddleware(makeReq(), res, next),
    ).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("treats a Redis read failure as a miss (no 500)", async () => {
    mockGet.mockRejectedValue(new Error("redis down"));
    mockRender.mockResolvedValue("<html>fresh</html>");
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await prerenderMiddleware(makeReq(), res, next);
    expect(mockRender).toHaveBeenCalledOnce();
    expect(res.send).toHaveBeenCalledWith("<html>fresh</html>");
  });

  it("bypasses the cache with ?nocache=1", async () => {
    mockGet.mockResolvedValue("<html>stale</html>");
    mockRender.mockResolvedValue("<html>fresh</html>");
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await prerenderMiddleware(makeReq({ query: { nocache: "1" } }), res, next);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockRender).toHaveBeenCalledOnce();
    expect(res.send).toHaveBeenCalledWith("<html>fresh</html>");
  });
});
