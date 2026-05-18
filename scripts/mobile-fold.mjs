#!/usr/bin/env node
/**
 * Capture above-the-fold (single viewport height) screenshots so each
 * image is actually readable at thumbnail scale. Round 80.6 follow-up to
 * mobile-audit.mjs which produced too-tall full-page captures.
 */
import puppeteer from "puppeteer";
import { mkdir } from "fs/promises";
import path from "path";

const BASE = "https://packgo-travel.fly.dev";
const OUT_DIR = path.join(process.cwd(), ".audit", "mobile-fold");

const VP = { name: "iphone-se", w: 375, h: 667, scale: 2 };

const PAGES = [
  { slug: "home", path: "/" },
  { slug: "tours", path: "/tours" },
  { slug: "custom", path: "/custom-tour-request" },
  { slug: "contact", path: "/contact-us" },
];

// Also capture sections by scrolling to specific positions
const SCROLL_POSITIONS = [
  { label: "fold-1", y: 0 },
  { label: "fold-2", y: 667 },
  { label: "fold-3", y: 1334 },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: "new" });

  for (const p of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({
      width: VP.w,
      height: VP.h,
      deviceScaleFactor: VP.scale,
      isMobile: true,
      hasTouch: true,
    });
    await page.goto(`${BASE}${p.path}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await new Promise((r) => setTimeout(r, 2000));

    for (const scroll of SCROLL_POSITIONS) {
      await page.evaluate((y) => window.scrollTo(0, y), scroll.y);
      await new Promise((r) => setTimeout(r, 500));
      const fname = path.join(OUT_DIR, `${p.slug}-${scroll.label}.png`);
      await page.screenshot({ path: fname, fullPage: false });
      console.log(`✓ ${p.slug} ${scroll.label}`);
    }
    await page.close();
  }

  await browser.close();
  console.log(`\nOutput: ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
