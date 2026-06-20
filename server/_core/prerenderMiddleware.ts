/**
 * Bot-UA dynamic rendering middleware.
 *
 * For crawler / AI-bot requests only, serve a prerendered (fully hydrated) copy
 * of the page so its title + meta + JSON-LD schema are visible in raw HTML.
 * Real users fall straight through to the normal SPA shell — their path is
 * untouched and cheap (a single UA substring scan).
 *
 * Mounted in server/_core/index.ts before the SPA fallback (setupVite /
 * serveStatic). Render failures degrade gracefully to the static shell — a
 * crawler is never served a 500. See docs/features/bot-prerender/.
 */

import type { Request, Response, NextFunction } from "express";
import redis from "../redis";
import { createChildLogger } from "./logger";
import { renderForBot } from "./prerender";

const log = createChildLogger({ module: "prerender-mw" });

const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h

// Search crawlers + AI answer engines (the AEO targets — they don't run JS) +
// social link-preview fetchers. Matched as case-insensitive substrings.
const BOT_UA = [
  // Search engines
  "googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider",
  "yandexbot", "sogou", "exabot", "applebot", "ia_archiver",
  // AI answer engines / training crawlers
  "gptbot", "oai-searchbot", "chatgpt-user", "perplexitybot",
  "claudebot", "anthropic-ai", "claude-web", "google-extended",
  "ccbot", "cohere-ai", "bytespider", "amazonbot", "youbot",
  // Social / messaging link previews (OG + Twitter cards)
  "facebookexternalhit", "twitterbot", "linkedinbot", "slackbot",
  "telegrambot", "whatsapp", "discordbot", "pinterest",
];

/** True if the User-Agent looks like a crawler / bot we want to prerender for. */
export function isBot(ua: string | undefined): boolean {
  if (!ua) return false;
  const l = ua.toLowerCase();
  return BOT_UA.some((b) => l.includes(b));
}

/**
 * True only for paths that are real, SEO-relevant HTML pages. Skips the API,
 * static assets (anything with a file extension), SEO/health endpoints, and
 * private/no-index areas (admin, account, booking, payment) — rendering those
 * wastes a pool slot and could leak member data into a cache.
 */
export function shouldPrerender(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/__manus__")) return false;
  if (["/sitemap.xml", "/robots.txt", "/healthz", "/health"].includes(pathname)) {
    return false;
  }
  if (/\.[a-z0-9]+$/i.test(pathname)) return false; // has a file extension → asset
  if (
    /^\/(admin|ops|workspace|profile|bookings?|book|payment|reset-password|forgot-password)\b/.test(
      pathname,
    )
  ) {
    return false;
  }
  return true;
}

/** Versioned cache key. Bumping the deploy version naturally expires old HTML. */
export function cacheKey(pathname: string): string {
  const version = process.env.FLY_MACHINE_VERSION || "v1";
  return `prerender:${version}:${pathname}`;
}

/**
 * Enabled by default in production, off in dev. Override explicitly with
 * PRERENDER_ENABLED=1 / 0 (e.g. `fly secrets set PRERENDER_ENABLED=0` to kill
 * it instantly without a code change). Read at call time so it's test-friendly.
 */
function isPrerenderEnabled(): boolean {
  const flag = process.env.PRERENDER_ENABLED;
  if (flag === undefined || flag === "") {
    return process.env.NODE_ENV === "production";
  }
  return flag === "1" || flag.toLowerCase() === "true";
}

/** Redis read — any failure (Redis down, timeout) is swallowed and treated as a miss. */
async function cacheGet(key: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch (err) {
    log.warn({ err, key }, "cache get failed — treating as miss");
    return null;
  }
}

/** Redis write — best-effort; a failure only forgoes the cache, never the response. */
async function cacheSet(key: string, html: string): Promise<void> {
  try {
    await redis.set(key, html, "EX", CACHE_TTL_SECONDS);
  } catch (err) {
    log.warn({ err, key }, "cache set failed — response still served");
  }
}

export async function prerenderMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!isPrerenderEnabled()) return next();
  if (req.method !== "GET") return next();
  if (!isBot(req.headers["user-agent"])) return next();

  const pathname = req.path;
  if (!shouldPrerender(pathname)) return next();

  const nocache = req.query.nocache === "1";
  const key = cacheKey(pathname);

  try {
    if (!nocache) {
      const cached = await cacheGet(key);
      if (cached) {
        res.set("X-Prerender", "hit");
        res.set("Content-Type", "text/html; charset=utf-8");
        res.send(cached);
        return;
      }
    }

    const html = await renderForBot(pathname);
    if (!html) {
      // Render failed — fall through to the static shell. Never 500 a crawler.
      return next();
    }

    await cacheSet(key, html);
    res.set("X-Prerender", "miss");
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    log.error({ err, pathname }, "prerender middleware error — falling back");
    next();
  }
}
