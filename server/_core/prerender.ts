/**
 * Bot prerender — render a route with the shared headless Chromium so its
 * fully-hydrated HTML (title + meta + JSON-LD schema + body) can be served to
 * crawlers and JS-less AI answer engines (Perplexity / GPTBot / ClaudeBot …).
 *
 * The site is a client-side-only Vite SPA: raw HTML is an empty shell with no
 * schema. react-helmet-async injects everything at runtime in the browser, so
 * crawlers that don't run JS see nothing. This renders the page against the
 * LIVE local server (real DB data) once and the middleware caches the result.
 *
 * Reuses server/_core/puppeteerPool.ts (shared browser, concurrency-capped at
 * 2 for the 1GB VM, auto-restart, SIGTERM-wired) — does NOT launch its own
 * browser. See docs/features/bot-prerender/.
 */

import type { Page } from "puppeteer-core";
import { acquirePage, releasePage } from "./puppeteerPool";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "prerender" });

// Hard caps so a slow/stuck page can never hold a pool slot for long. Bots
// tolerate latency; we'd rather time out and return partial HTML than block.
const NAV_TIMEOUT_MS = 12_000;
const READY_TIMEOUT_MS = 8_000;

// UA for the internal render request. MUST NOT match any bot pattern in
// prerenderMiddleware — otherwise the headless request would be intercepted by
// the middleware again and loop. A neutral UA makes it look like a normal
// browser, so it runs the SPA + tRPC + helmet exactly like a real user.
const RENDER_UA = "PackgoPrerender/1.0 (+https://packgoplay.com headless-internal)";

/**
 * Render `pathname` (no query string) against the local server and return the
 * serialized HTML, or `null` on any failure. Never throws — the caller falls
 * back to the static shell so a crawler is never served a 500.
 */
export async function renderForBot(pathname: string): Promise<string | null> {
  const port = process.env.PORT || "8080";
  const target = `http://127.0.0.1:${port}${pathname}`;
  let page: Page | null = null;

  try {
    page = await acquirePage();
    await page.setUserAgent(RENDER_UA);
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(target, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });

    // Wait until React has mounted (#root populated) AND the SEO schema has
    // actually been injected by react-helmet — that's the whole point. Tolerate
    // timeout: if a page never injects schema we still return the networkidle
    // HTML rather than nothing.
    await page
      .waitForFunction(
        () => {
          const root = document.getElementById("root");
          const hasContent = !!root && root.children.length > 0;
          const hasSchema = !!document.querySelector(
            'script[type="application/ld+json"]',
          );
          return hasContent && hasSchema;
        },
        { timeout: READY_TIMEOUT_MS },
      )
      .catch(() => {
        log.warn({ pathname }, "ready-signal timeout — returning networkidle HTML");
      });

    const html = stripDevArtifacts(await page.content());
    return html;
  } catch (err) {
    log.error({ err, pathname }, "renderForBot failed");
    return null;
  } finally {
    if (page) await releasePage(page);
  }
}

/**
 * Remove dev-only injections that may appear in the serialized DOM. In a
 * production build these are usually absent (the Manus debug collector is
 * dev-gated and the `?v=` cache-bust is added only by setupVite), but strip
 * them defensively so cached HTML never references dev endpoints.
 */
function stripDevArtifacts(html: string): string {
  return html
    .replace(/<script[^>]*__manus__[^>]*><\/script>/g, "")
    .replace(/(src="\/src\/main\.tsx)\?v=[^"]*(")/g, "$1$2");
}
