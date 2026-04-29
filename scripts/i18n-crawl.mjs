#!/usr/bin/env node
/**
 * i18n-crawl.mjs — v78p Sprint 8 #4: headless crawler that visits the
 * production site in EN mode and reports every visible Chinese string.
 *
 * Complements scripts/i18n-audit.mjs (which scans source code) by catching
 * runtime gaps that the static audit misses:
 *   - DB content that wasn't translated by translateTour
 *   - Third-party widgets / chat bubbles
 *   - Dynamic content from API responses
 *   - Conditionally-rendered UI not covered by static scan
 *
 * Usage:
 *   node scripts/i18n-crawl.mjs                                  # default routes, prod
 *   node scripts/i18n-crawl.mjs --base=http://localhost:3000     # local dev
 *   node scripts/i18n-crawl.mjs --routes=/tours,/about-us        # specific routes
 *   node scripts/i18n-crawl.mjs --json > /tmp/crawl-report.json  # CI
 */

import puppeteer from "puppeteer";
import { promises as fs } from "node:fs";

const args = process.argv.slice(2);
const arg = (name, def) => {
  const m = args.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split("=").slice(1).join("=") : def;
};
const FLAG_JSON = args.includes("--json");

const BASE = arg("base", "https://packgo-travel.fly.dev");
const ROUTE_LIST = arg("routes", null);

// Default route set — landing pages + a sample tour detail
const DEFAULT_ROUTES = [
  "/",
  "/tours",
  "/about-us",
  "/contact-us",
  "/custom-tour-request",
  "/china-visa",
  "/cruise",
  "/services/airport-transfer",
];

const CJK_REGEX = /[一-鿿㐀-䶿]/;

async function crawl() {
  // Build route list — if user provided, use that; else default + auto-discover one tour detail
  let routes = ROUTE_LIST ? ROUTE_LIST.split(",") : [...DEFAULT_ROUTES];

  // Auto-discover one tour detail URL by hitting the tRPC tours.list endpoint
  if (!ROUTE_LIST) {
    try {
      const r = await fetch(`${BASE}/api/trpc/tours.list?input=%7B%22json%22%3A%7B%22status%22%3A%22active%22%7D%7D`);
      const j = await r.json();
      const tours = j?.result?.data?.json || [];
      if (tours.length > 0) {
        // Pick first 2 tour IDs as samples
        routes.push(`/tours/${tours[0].id}`);
        if (tours.length > 1) routes.push(`/tours/${tours[1].id}`);
      }
    } catch (err) {
      console.warn("Could not auto-discover tour URL:", err.message);
    }
  }

  console.error(`Crawling ${routes.length} routes on ${BASE}`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const findings = [];

  for (const route of routes) {
    const url = `${BASE}${route}${route.includes("?") ? "&" : "?"}lang=en`;
    console.error(`  ${url}`);
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
      // Give React + tRPC a moment to settle
      await new Promise((r) => setTimeout(r, 1500));

      // Extract visible text + CSS path for each text node
      const cjkNodes = await page.evaluate((CJK_PATTERN) => {
        const cjk = new RegExp(CJK_PATTERN);
        const out = [];

        function visiblePath(el) {
          // Build a short CSS-like selector from the element up to body
          const segs = [];
          let cur = el;
          let depth = 0;
          while (cur && cur !== document.body && depth < 5) {
            let seg = cur.tagName?.toLowerCase() || "";
            if (cur.id) seg += `#${cur.id}`;
            else if (cur.className && typeof cur.className === "string") {
              const cls = cur.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".");
              if (cls) seg += `.${cls}`;
            }
            segs.unshift(seg);
            cur = cur.parentElement;
            depth++;
          }
          return segs.join(" > ");
        }

        function isVisible(el) {
          if (!el || !el.getBoundingClientRect) return false;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
          return true;
        }

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent.trim();
          if (!text) continue;
          if (!cjk.test(text)) continue;
          // Skip hidden elements
          const parent = node.parentElement;
          if (!parent || !isVisible(parent)) continue;
          // Skip <script>, <style>, <noscript>
          if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) continue;
          // Truncate long text
          out.push({
            text: text.length > 200 ? text.slice(0, 200) + "…" : text,
            tag: parent.tagName.toLowerCase(),
            path: visiblePath(parent),
          });
        }
        return out;
      }, CJK_REGEX.source);

      for (const node of cjkNodes) {
        findings.push({ url: route, ...node });
      }
    } catch (err) {
      console.error(`  ⚠️ ${route} failed: ${err.message}`);
    }
  }

  await browser.close();
  return findings;
}

function reportText(findings) {
  if (findings.length === 0) {
    console.log("✅ No Chinese text detected on any crawled EN-mode page.");
    return;
  }
  const byUrl = new Map();
  for (const f of findings) {
    if (!byUrl.has(f.url)) byUrl.set(f.url, []);
    byUrl.get(f.url).push(f);
  }
  console.log(`\nFound ${findings.length} Chinese text nodes on ${byUrl.size} pages:\n`);
  for (const [url, arr] of byUrl) {
    console.log(`📍 ${url}  (${arr.length} CJK nodes)`);
    // Dedupe by text within page
    const seen = new Set();
    for (const f of arr) {
      if (seen.has(f.text)) continue;
      seen.add(f.text);
      console.log(`   "${f.text}"  <${f.tag}>`);
      console.log(`     ${f.path}`);
    }
    console.log("");
  }
}

async function main() {
  const findings = await crawl();
  if (FLAG_JSON) {
    console.log(JSON.stringify(findings, null, 2));
  } else {
    reportText(findings);
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message, e.stack);
  process.exit(2);
});
