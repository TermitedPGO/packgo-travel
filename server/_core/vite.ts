import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "vite" });

/**
 * Server-side route whitelist — mirrors client/src/App.tsx routes.
 *
 * Used to decide whether the SPA fallback should return HTTP 200 (valid route,
 * React will render the page) or HTTP 404 (unknown URL — the SPA shell is still
 * served so NotFound.tsx can render, but with a real 404 status so Google does
 * not treat every garbage URL as a soft-200).
 *
 * Keep this in sync with App.tsx <Route path="..."> entries. A prefix that ends
 * with "/" matches anything below it (nested paths). An entry without a trailing
 * slash matches only the exact path.
 */
const KNOWN_ROUTE_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/search$/,
  /^\/destinations\/[^/]+$/,              // /destinations/:region
  /^\/destinations\/[^/]+\/[^/]+$/,       // /destinations/:region/:country
  /^\/cruises$/,
  /^\/tours$/,
  /^\/tours\/[^/]+$/,                     // /tours/:id
  /^\/tours\/[^/]+\/print$/,              // /tours/:id/print
  /^\/tour\/[^/]+$/,                      // legacy /tour/:id (seen in sitemap)
  /^\/login$/,
  /^\/forgot-password$/,
  /^\/reset-password$/,
  /^\/admin(\/.*)?$/,                     // /admin (complete AdminV2) and nested admin routes
  /^\/workspace(\/.*)?$/,                 // 整合工作台 redesign preview (chat-first 後台) + 巢狀
  /^\/profile$/,
  /^\/book\/[^/]+$/,                      // /book/:id
  /^\/bookings\/[^/]+$/,                  // /bookings/:id
  /^\/payment\/(success|failure)$/,
  /^\/inquiry$/,
  /^\/custom-tour-request$/,
  /^\/custom-tours$/,
  /^\/china-visa$/,
  /^\/china-visa\/success$/,
  /^\/china-visa\/status\/[^/]+$/,
  /^\/visa-services$/,
  /^\/group-packages$/,
  /^\/flight-booking$/,
  /^\/airport-transfer$/,
  /^\/hotel-booking$/,
  /^\/about-us$/,
  /^\/terms-of-service$/,
  /^\/privacy-policy$/,
  /^\/faq$/,
  /^\/contact-us$/,
  /^\/emergency$/,                        // 2026-05-22 P23: 24h emergency intake (QA audit Phase 5)
  /^\/membership$/,                       // Round 80.19: AI Advisor Phase 1 paywall target
  /^\/membership-terms$/,                 // 2026-05-22 P23: AB 390 §17602 disclosure link
  /^\/rewards$/,                          // Round 80.22 Phase F: Packpoint redemption catalog
  /^\/preview\/[^/]+$/,                   // Round 80.9: internal preview/mockup routes
  /^\/404$/,
];

/** Strip query string + trailing slash (except for root) for pattern matching. */
function normalizeUrlForMatch(originalUrl: string): string {
  const pathOnly = originalUrl.split("?")[0] || "/";
  if (pathOnly === "/") return "/";
  return pathOnly.replace(/\/+$/, "");
}

function isKnownRoute(originalUrl: string): boolean {
  const pathOnly = normalizeUrlForMatch(originalUrl);
  return KNOWN_ROUTE_PATTERNS.some((re) => re.test(pathOnly));
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    // 跳過 API 路徑，讓 tRPC 和其他 API router 處理
    if (req.originalUrl.startsWith('/api/')) {
      return next();
    }

    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      // Return 404 status for unknown routes so Google does not collect soft-404s.
      // The SPA shell is still served so NotFound.tsx renders normally to users.
      const statusCode = isKnownRoute(url) ? 200 : 404;
      res.status(statusCode).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    log.error(
      { distPath },
      "Could not find the build directory; make sure to build the client first",
    );
  }

  // SEO audit 2026-05-09: hashed JS/CSS bundles served with Cache-Control:
  // max-age=0 was tanking repeat-visit performance. Hashed filenames are the
  // entire point of immutable caching — set 1y immutable for assets, but keep
  // index.html short-cache so deployments propagate immediately.
  app.use(
    express.static(distPath, {
      maxAge: "1y",
      immutable: true,
      setHeaders: (res, p) => {
        if (p.endsWith(".html")) {
          res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
        } else if (
          p.endsWith("service-worker.js") ||
          p.endsWith("manifest.json")
        ) {
          // ROOT CAUSE FIX (2026-06-09): the SW + manifest were served with
          // the blanket `max-age=1y, immutable`, so browsers NEVER re-fetched
          // service-worker.js → the old cache-first SW lived forever → every
          // deploy stayed invisible behind the stale cached app ("都沒改變").
          // A service worker MUST revalidate so new versions get picked up.
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );

  // fall through to index.html if the file doesn't exist
  // 跳過 API 路徑，讓 tRPC 和其他 API router 處理
  app.use("*", (req, res, next) => {
    if (req.originalUrl.startsWith('/api/')) {
      return next();
    }
    // Return 404 status for unknown routes so Google does not collect soft-404s.
    // The SPA shell is still served so NotFound.tsx renders normally to users.
    const statusCode = isKnownRoute(req.originalUrl) ? 200 : 404;
    res.status(statusCode).sendFile(path.resolve(distPath, "index.html"));
  });
}
