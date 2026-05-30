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
// Ceiling for the readiness poll below, not a fixed wait. With polling:100 the
// signal fires the instant the schema is in, so warm renders return in <2s and a
// cold first-render (Chromium just launched) well under this. The ceiling only
// bites for routes that never inject schema — they wait it out, then we serialize
// whatever DOM exists. 15s gives the cold path comfortable headroom.
const READY_TIMEOUT_MS = 15_000;

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

    // `domcontentloaded`, NOT `networkidle2`: the live SPA polls (React Query
    // refetchInterval) and auto-advances carousels (HomeHero / TestimonialsCarousel
    // swap images on a setInterval), so the network NEVER goes idle — networkidle2
    // would burn the full NAV_TIMEOUT and throw, killing every prerender. ES module
    // scripts are deferred, so domcontentloaded already fires after the entry bundle
    // executes (React mounted). The waitForFunction below is the real readiness gate
    // (#root populated + schema injected), so we don't need to wait on the network.
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    // Wait until React has mounted (#root populated) AND the SEO schema has
    // actually been injected by react-helmet — that's the real readiness gate.
    // polling:100 (NOT the default 'raf'): headless Chromium throttles/pauses
    // requestAnimationFrame when nothing paints, so rAF polling misses the
    // condition and times out even though the schema is already in the DOM
    // (observed on prod — cold renders logged a ready-signal timeout yet served
    // full schema, because page.content() reads the real DOM regardless). A 100ms
    // interval poll isn't tied to paint, so it detects the schema immediately.
    // Tolerate a genuine timeout (routes with no schema): return the current DOM.
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
        { timeout: READY_TIMEOUT_MS, polling: 100 },
      )
      .catch(() => {
        log.warn({ pathname }, "ready-signal timeout — returning current DOM");
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
 *
 * Also de-duplicates `<title>`: client/index.html ships a static
 * `<title>PACK&GO 旅行社</title>` as a human flash-of-loading fallback, and
 * react-helmet-async injects its own page-specific `<title>` ahead of it at
 * runtime. Both survive into the serialized DOM, so a crawler sees TWO title
 * tags (the correct page title first, the generic static one second). That's
 * invalid HTML and trips SEO audits / confuses AI answer engines that grab the
 * last title. We keep the FIRST title (the react-helmet page-specific one, per
 * the HTML spec that the first title element wins) and drop the rest. The
 * static fallback stays in index.html untouched so humans still get a title
 * during the pre-hydration flash.
 */
function stripDevArtifacts(html: string): string {
  let seenTitle = false;
  return html
    .replace(/<script[^>]*__manus__[^>]*><\/script>/g, "")
    .replace(/(src="\/src\/main\.tsx)\?v=[^"]*(")/g, "$1$2")
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, (match) => {
      if (seenTitle) return "";
      seenTitle = true;
      return match;
    });
}
