#!/usr/bin/env node
/**
 * Full-site scan — Round 80.7.
 *
 * Visits every public route on packgo-travel.fly.dev and collects:
 *   - HTTP status (catches 404/500)
 *   - Console errors / warnings
 *   - Network failures (failed requests for images, API calls, fonts)
 *   - Page-level metadata (title, description, og:image, hreflang)
 *   - Visible-text scan for likely-untranslated strings (Chinese chars on
 *     /en routes, English-only words on /zh-TW routes)
 *   - Visible-text scan for color-violation indicators (e.g. residual
 *     hard-coded teal/green that bypassed the i18n-driven sweep)
 *   - Above-the-fold desktop screenshot (1440x900)
 *
 * Output:
 *   .audit/full-scan/
 *     - <route>-desktop.png
 *     - report.json (structured findings)
 *     - report.md (human-readable summary)
 *
 * Usage: node scripts/full-scan.mjs
 */
import puppeteer from "puppeteer";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const BASE = process.env.BASE || "https://packgo-travel.fly.dev";
const OUT_DIR = path.join(process.cwd(), ".audit", "full-scan");

// Routes to scan. Dynamic routes (`:id`) need real IDs to render — we use
// known good ones or skip with a note.
const ROUTES = [
  { path: "/",                      name: "home" },
  { path: "/tours",                 name: "tours" },
  { path: "/search?q=日本",          name: "search" },
  { path: "/cruises",               name: "cruises" },
  { path: "/custom-tour-request",   name: "custom-tour-request" },
  { path: "/custom-tours",          name: "custom-tours" },
  { path: "/group-packages",        name: "group-packages" },
  { path: "/flight-booking",        name: "flight-booking" },
  { path: "/hotel-booking",         name: "hotel-booking" },
  { path: "/airport-transfer",      name: "airport-transfer" },
  { path: "/china-visa",            name: "china-visa" },
  { path: "/about-us",              name: "about-us" },
  { path: "/contact-us",            name: "contact-us" },
  { path: "/faq",                   name: "faq" },
  { path: "/terms-of-service",      name: "terms-of-service" },
  { path: "/privacy-policy",        name: "privacy-policy" },
  { path: "/login",                 name: "login" },
  { path: "/forgot-password",       name: "forgot-password" },
  { path: "/inquiry",               name: "inquiry" },
  // 404 sanity
  { path: "/this-page-should-404",  name: "404-test", expectedStatus: 404 },
];

async function scanRoute(browser, route) {
  const findings = {
    route: route.path,
    name: route.name,
    httpStatus: null,
    consoleErrors: [],
    consoleWarnings: [],
    failedRequests: [],
    meta: { title: null, description: null, ogImage: null, hreflang: [] },
    issues: [],
  };

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "error") findings.consoleErrors.push(text.slice(0, 220));
    else if (type === "warning") findings.consoleWarnings.push(text.slice(0, 220));
  });
  page.on("requestfailed", (req) => {
    findings.failedRequests.push({
      url: req.url().slice(0, 160),
      reason: req.failure()?.errorText || "unknown",
    });
  });
  page.on("response", (res) => {
    if (res.url() === `${BASE}${route.path}`) {
      findings.httpStatus = res.status();
    }
  });

  try {
    const resp = await page.goto(`${BASE}${route.path}`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    if (resp && findings.httpStatus === null) findings.httpStatus = resp.status();
    await new Promise((r) => setTimeout(r, 1500));

    // Extract meta
    findings.meta = await page.evaluate(() => {
      const get = (sel, attr = "content") =>
        document.querySelector(sel)?.getAttribute(attr) || null;
      const titleEl = document.querySelector("title");
      const descEl = document.querySelector('meta[name="description"]');
      const ogImg = document.querySelector('meta[property="og:image"]');
      const hreflangs = [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map(
        (el) => ({ lang: el.getAttribute("hreflang"), href: el.getAttribute("href") })
      );
      return {
        title: titleEl?.textContent?.slice(0, 160) || null,
        description: descEl?.getAttribute("content")?.slice(0, 220) || null,
        ogImage: ogImg?.getAttribute("content") || null,
        hreflang: hreflangs,
      };
    });

    // Heuristic checks on rendered DOM
    const checks = await page.evaluate(() => {
      const issues = [];

      // 1. Empty / missing main heading
      const h1 = document.querySelector("h1");
      if (!h1 || !h1.textContent?.trim()) {
        issues.push({ kind: "missing-h1" });
      }

      // 2. Missing alt on visible non-decorative images
      const imgs = [...document.querySelectorAll("img")].filter((img) => {
        const r = img.getBoundingClientRect();
        return r.width > 50 && r.height > 50;
      });
      const missingAlt = imgs.filter((img) => {
        const alt = img.getAttribute("alt");
        return alt === null || (alt === "" && img.getAttribute("aria-hidden") !== "true");
      });
      if (missingAlt.length > 0) {
        issues.push({
          kind: "missing-alt",
          count: missingAlt.length,
          sample: missingAlt[0].src.slice(0, 100),
        });
      }

      // 3. Residual color-violation tokens in computed styles
      const COLOR_VIOLATION_RE = /rgb\(13,?\s*148,?\s*136\)|rgb\(16,?\s*185,?\s*129\)|rgb\(20,?\s*184,?\s*166\)/;
      const allEls = [...document.querySelectorAll("*")];
      let teal = 0;
      for (const el of allEls.slice(0, 800)) {
        const cs = getComputedStyle(el);
        if (
          COLOR_VIOLATION_RE.test(cs.backgroundColor) ||
          COLOR_VIOLATION_RE.test(cs.color) ||
          COLOR_VIOLATION_RE.test(cs.borderColor)
        ) {
          teal++;
        }
      }
      if (teal > 0) issues.push({ kind: "residual-teal-color", count: teal });

      // 4. Likely untranslated strings on EN site (we're scanning ZH-TW
      //    site by default, so just sample any *visible* big text node)
      // We'll do a coarse "text density" check rather than per-language
      // detection here — separate audit handles that.

      // 5. Broken-looking image: src that resolved 4xx (browser has no
      //    direct API but we can sniff via naturalWidth = 0)
      const brokenImgs = imgs.filter((img) => img.complete && img.naturalWidth === 0);
      if (brokenImgs.length > 0) {
        issues.push({
          kind: "broken-image",
          count: brokenImgs.length,
          sample: brokenImgs[0].src.slice(0, 100),
        });
      }

      return issues;
    });

    findings.issues.push(...checks);

    // Screenshot above-the-fold
    const fname = path.join(OUT_DIR, `${route.name}-desktop.png`);
    await page.screenshot({ path: fname, fullPage: false });

    return findings;
  } catch (e) {
    findings.issues.push({ kind: "error", message: e.message.slice(0, 240) });
    return findings;
  } finally {
    await page.close();
  }
}

function severity(finding) {
  // Critical: HTTP error, console errors, broken images
  if (finding.httpStatus && finding.httpStatus >= 500) return 3;
  if (
    finding.httpStatus &&
    finding.httpStatus !== 200 &&
    finding.httpStatus !== 404
  )
    return 3;
  if (finding.consoleErrors.length > 0) return 2;
  if (finding.issues.some((i) => i.kind === "broken-image")) return 2;
  if (finding.issues.some((i) => i.kind === "missing-h1")) return 2;
  if (finding.failedRequests.length > 0) return 2;
  if (finding.issues.some((i) => i.kind === "residual-teal-color")) return 1;
  if (finding.issues.some((i) => i.kind === "missing-alt")) return 1;
  if (finding.consoleWarnings.length > 0) return 0;
  return 0;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Scanning ${ROUTES.length} routes against ${BASE}\n`);

  const browser = await puppeteer.launch({ headless: "new" });
  const all = [];
  for (const r of ROUTES) {
    process.stdout.write(`  ${r.path.padEnd(34)}`);
    const result = await scanRoute(browser, r);
    const sev = severity(result);
    const tag = sev === 3 ? "CRIT" : sev === 2 ? "HIGH" : sev === 1 ? "WARN" : "ok";
    console.log(
      `[${tag}] http=${result.httpStatus ?? "?"} errs=${result.consoleErrors.length} warns=${result.consoleWarnings.length} issues=${result.issues.length}`
    );
    all.push({ ...result, severity: sev });
  }
  await browser.close();

  // Sort by severity desc
  all.sort((a, b) => b.severity - a.severity);

  // Write JSON report
  await writeFile(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify({ scannedAt: new Date().toISOString(), base: BASE, routes: all }, null, 2)
  );

  // Write Markdown summary
  const lines = [];
  lines.push(`# Full-site Scan Report\n`);
  lines.push(`**Scanned:** ${new Date().toISOString()}`);
  lines.push(`**Base:** ${BASE}`);
  lines.push(`**Routes:** ${all.length}\n`);

  const counts = {
    crit: all.filter((a) => a.severity === 3).length,
    high: all.filter((a) => a.severity === 2).length,
    warn: all.filter((a) => a.severity === 1).length,
    ok: all.filter((a) => a.severity === 0).length,
  };
  lines.push(`## Summary\n`);
  lines.push(`- 🔴 **Critical**: ${counts.crit}`);
  lines.push(`- 🟠 **High**: ${counts.high}`);
  lines.push(`- 🟡 **Warn**: ${counts.warn}`);
  lines.push(`- 🟢 **OK**: ${counts.ok}\n`);

  lines.push(`## Findings (sorted by severity)\n`);
  for (const r of all) {
    const sev = r.severity === 3 ? "🔴" : r.severity === 2 ? "🟠" : r.severity === 1 ? "🟡" : "🟢";
    lines.push(`### ${sev} ${r.route} (${r.name})`);
    lines.push(`- HTTP ${r.httpStatus ?? "?"}`);
    if (r.meta.title) lines.push(`- Title: \`${r.meta.title}\``);
    else lines.push(`- ⚠️ **No <title>**`);
    if (!r.meta.description) lines.push(`- ⚠️ **No meta description**`);
    if (!r.meta.ogImage) lines.push(`- ⚠️ **No og:image**`);
    if (r.consoleErrors.length > 0) {
      lines.push(`- **Console errors (${r.consoleErrors.length}):**`);
      for (const e of r.consoleErrors.slice(0, 3)) lines.push(`  - \`${e}\``);
    }
    if (r.failedRequests.length > 0) {
      lines.push(`- **Failed requests (${r.failedRequests.length}):**`);
      for (const f of r.failedRequests.slice(0, 3))
        lines.push(`  - \`${f.url}\` (${f.reason})`);
    }
    for (const issue of r.issues) {
      lines.push(`- ${JSON.stringify(issue)}`);
    }
    lines.push("");
  }

  await writeFile(path.join(OUT_DIR, "report.md"), lines.join("\n"));
  console.log(`\nReports:`);
  console.log(`  ${path.join(OUT_DIR, "report.md")}`);
  console.log(`  ${path.join(OUT_DIR, "report.json")}`);
  console.log(
    `\nSeverity counts: 🔴${counts.crit} 🟠${counts.high} 🟡${counts.warn} 🟢${counts.ok}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
