#!/usr/bin/env node
/**
 * Round 80.8: post-Tour-Detail-polish screenshot test.
 * Captures desktop + mobile fold-1 of a real /tours/:id page so Jeff can
 * verify the unified B&W + Gold theme replaces the old country-coloured one.
 */
import puppeteer from "puppeteer";
import { mkdir } from "fs/promises";
import path from "path";

const URL = "https://packgo-travel.fly.dev/tours/540001";
const OUT_DIR = path.join(process.cwd(), ".audit", "tour-detail");
await mkdir(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({ headless: "new" });
for (const [label, vp] of [
  ["desktop", { width: 1440, height: 900, deviceScaleFactor: 1 }],
  ["mobile",  { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
]) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));
  for (const [scrollLabel, y] of [["fold1", 0], ["fold2", vp.height], ["fold3", vp.height * 2]]) {
    await page.evaluate(yy => window.scrollTo(0, yy), y);
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({
      path: path.join(OUT_DIR, `${label}-${scrollLabel}.png`),
      fullPage: false,
    });
    console.log(`✓ ${label} ${scrollLabel}`);
  }
  await page.close();
}
await browser.close();
console.log(`\nOutput: ${OUT_DIR}`);
