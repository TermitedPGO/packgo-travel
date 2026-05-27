/**
 * Shared Puppeteer browser pool — reuses a single Chromium instance
 * across PDF renders + scraping. On a 1GB VM, max 2 concurrent pages.
 *
 * Lifecycle:
 *   - Lazy singleton: first `acquirePage()` launches the browser.
 *   - If MAX_PAGES are in use, callers queue (Promise-based FIFO).
 *   - `releasePage(page)` closes the page and unblocks the next waiter.
 *   - Auto-restart: if the browser crashes or its TTL expires, the next
 *     `acquirePage()` transparently relaunches.
 *   - `shutdownPool()` for graceful server shutdown (closes the browser).
 *
 * 2026-05-27 — extracted from per-call browser launches in pdfGenerator.ts
 * to eliminate 2-5s cold-start per PDF + reduce OOM risk under concurrency.
 */

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "puppeteer-pool" });

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const MAX_PAGES = 2; // 1GB VM safety
const BROWSER_TTL = 10 * 60 * 1000; // restart browser every 10 min to prevent memory leaks

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--font-render-hinting=none",
];

// ── Internal state ──────────────────────────────────────────────────

let browser: Browser | null = null;
let browserLaunchedAt = 0;
let activePagesCount = 0;
let launching: Promise<Browser> | null = null; // coalesce concurrent launches

/** FIFO queue of callers waiting for a page slot. */
const waitQueue: Array<() => void> = [];

// ── Helpers ─────────────────────────────────────────────────────────

/** True if the browser is alive and within TTL. */
function isBrowserHealthy(): boolean {
  if (!browser) return false;
  if (!browser.connected) return false;
  if (Date.now() - browserLaunchedAt > BROWSER_TTL) return false;
  return true;
}

/** Launch (or relaunch) the singleton Chromium process. */
async function ensureBrowser(): Promise<Browser> {
  if (isBrowserHealthy()) return browser!;

  // If another caller is already launching, piggyback on that promise.
  if (launching) return launching;

  launching = (async () => {
    // Close stale browser if it exists (TTL expired or disconnected).
    if (browser) {
      log.info("closing stale browser before relaunch");
      await browser.close().catch(() => {});
      browser = null;
    }

    log.info({ executablePath: CHROMIUM_PATH }, "launching Chromium");
    const b = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: LAUNCH_ARGS,
    });
    browserLaunchedAt = Date.now();

    // Listen for unexpected disconnect so the next acquirePage relaunches.
    b.on("disconnected", () => {
      log.warn("browser disconnected unexpectedly");
      if (browser === b) {
        browser = null;
        // Drain waiters — they'll get a fresh browser on retry inside acquirePage.
        drainWaiters();
      }
    });

    browser = b;
    launching = null;
    return b;
  })();

  return launching;
}

/** Wake all queued waiters so they can retry (used after crash). */
function drainWaiters(): void {
  while (waitQueue.length > 0) {
    const resolve = waitQueue.shift()!;
    resolve();
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Acquire a fresh Page from the shared browser. If the concurrency cap
 * is reached, the returned promise blocks until a slot opens.
 */
export async function acquirePage(): Promise<Page> {
  // Wait for a free slot if at capacity.
  while (activePagesCount >= MAX_PAGES) {
    await new Promise<void>((resolve) => {
      waitQueue.push(resolve);
    });
    // After being woken we re-check — browser may have crashed in between.
  }

  const b = await ensureBrowser();
  activePagesCount++;

  try {
    const page = await b.newPage();
    return page;
  } catch (err) {
    // newPage failed (browser may have crashed between ensureBrowser and now).
    activePagesCount--;
    drainWaiters();
    log.error({ err }, "failed to create new page — browser may have crashed");
    throw err;
  }
}

/**
 * Return a page to the pool (closes it) and unblock the next queued caller.
 * Safe to call even if the page is already closed.
 */
export async function releasePage(page: Page): Promise<void> {
  try {
    if (!page.isClosed()) {
      await page.close();
    }
  } catch {
    // Page may already be destroyed if the browser crashed — swallow.
  } finally {
    activePagesCount = Math.max(0, activePagesCount - 1);
    // Wake the next waiter, if any.
    if (waitQueue.length > 0) {
      const resolve = waitQueue.shift()!;
      resolve();
    }
  }
}

/**
 * Gracefully shut down the pool — close the browser and reject any waiters.
 * Called from the SIGTERM handler in `server/_core/index.ts`.
 */
export async function shutdownPool(): Promise<void> {
  log.info("shutting down puppeteer pool");
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  activePagesCount = 0;
  // Wake any waiters so their promises resolve (they'll get an error on
  // the next ensureBrowser call if the process is exiting).
  drainWaiters();
}
