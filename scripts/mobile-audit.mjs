#!/usr/bin/env node
/**
 * Round 80.6: Mobile + tablet rendering audit.
 *
 * Captures screenshots of the deployed site at common breakpoints to spot:
 *  - Layout breaks (overflow, broken grids)
 *  - Search bar wrapping
 *  - Hero compression
 *  - Card stacking
 *  - CTA visibility
 *
 * Usage: node scripts/mobile-audit.mjs
 * Output: /Users/jeff/Desktop/網站/.audit/mobile/<viewport>-<page>.png
 */
import puppeteer from "puppeteer";
import { mkdir } from "fs/promises";
import path from "path";

const BASE = "https://packgo-travel.fly.dev";
const OUT_DIR = path.join(process.cwd(), ".audit", "mobile");

const VIEWPORTS = [
  { name: "iphone-se", w: 375, h: 667, scale: 2 },
  { name: "iphone-14", w: 390, h: 844, scale: 3 },
  { name: "pixel-7", w: 412, h: 915, scale: 2.625 },
  { name: "ipad-mini", w: 768, h: 1024, scale: 2 },
];

const PAGES = [
  { slug: "home", path: "/" },
  { slug: "tours", path: "/tours" },
  { slug: "custom", path: "/custom-tour-request" },
  { slug: "contact", path: "/contact-us" },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: "new" });
  const issues = [];

  for (const vp of VIEWPORTS) {
    for (const p of PAGES) {
      const page = await browser.newPage();
      await page.setViewport({
        width: vp.w,
        height: vp.h,
        deviceScaleFactor: vp.scale,
        isMobile: vp.w < 768,
        hasTouch: vp.w < 768,
      });
      try {
        await page.goto(`${BASE}${p.path}`, {
          waitUntil: "networkidle2",
          timeout: 60000,
        });
        await new Promise((r) => setTimeout(r, 1500)); // allow lazy-load
        const fname = path.join(OUT_DIR, `${vp.name}-${p.slug}.png`);
        await page.screenshot({ path: fname, fullPage: true });

        // Detect horizontal overflow (the #1 mobile breakage signal)
        const hasOverflow = await page.evaluate(() => {
          const html = document.documentElement;
          return html.scrollWidth > html.clientWidth + 2;
        });
        if (hasOverflow) {
          const overflowEls = await page.evaluate(() => {
            const out = [];
            const all = document.querySelectorAll("*");
            for (const el of all) {
              const r = el.getBoundingClientRect();
              if (r.right > window.innerWidth + 1) {
                out.push({
                  tag: el.tagName.toLowerCase(),
                  cls: (el.className || "").toString().slice(0, 80),
                  right: Math.round(r.right),
                  vw: window.innerWidth,
                });
                if (out.length >= 5) break;
              }
            }
            return out;
          });
          issues.push({
            viewport: vp.name,
            page: p.slug,
            type: "horizontal-overflow",
            details: overflowEls,
          });
        }
        console.log(`✓ ${vp.name} ${p.slug}${hasOverflow ? " (OVERFLOW)" : ""}`);
      } catch (e) {
        issues.push({
          viewport: vp.name,
          page: p.slug,
          type: "error",
          details: e.message,
        });
        console.error(`✗ ${vp.name} ${p.slug}: ${e.message}`);
      } finally {
        await page.close();
      }
    }
  }

  await browser.close();
  console.log("\n=== AUDIT REPORT ===");
  if (issues.length === 0) {
    console.log("No layout issues detected.");
  } else {
    for (const issue of issues) {
      console.log(`\n${issue.viewport} · ${issue.page} · ${issue.type}`);
      if (issue.type === "horizontal-overflow") {
        for (const el of issue.details) {
          console.log(
            `  ${el.tag}.${el.cls.slice(0, 50)} extends to ${el.right}px (vw=${el.vw})`
          );
        }
      } else {
        console.log(`  ${issue.details}`);
      }
    }
  }
  console.log(`\nScreenshots: ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
