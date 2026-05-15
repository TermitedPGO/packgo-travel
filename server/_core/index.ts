import "dotenv/config";
import express from "express";
import compression from "compression";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
// Manus OAuth removed - using Google OAuth + Email/Password instead
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "./stripeWebhook";
import { avatarUploadRouter } from "../avatarUpload";
import { tourImageUploadRouter } from "../tourImageUpload";
import { pdfUploadRouter } from "../pdfUpload";
import { progressRouter } from "../progressRouter";
import { aiChatStreamRouter } from "../aiChatStreamRouter";
import { generalImageUploadRouter } from "../generalImageUpload";
import { initializeGoogleAuth } from "../googleAuth";
import { initializeGmailOAuth } from "../gmailOAuth";
import "../worker"; // Initialize BullMQ worker

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  // SEO audit 2026-05-09: enable response compression. The 702KB JS bundle
  // was being served uncompressed; gzip cuts it ~70% and fixes LCP on slow
  // connections. Added before any route handlers so all responses benefit.
  app.use(compression());
  const server = createServer(app);
  
  // Enable SO_REUSEADDR to allow port reuse
  server.on('listening', () => {
    const addr = server.address();
    const port = typeof addr === 'object' ? addr?.port : addr;
    console.log(`Server running on http://localhost:${port}/`);
  });
  
  // Round 80.18 v2: redirect old fly.dev / Manus / www → canonical
  // packgoplay.com. CRITICAL exemptions:
  //   - /healthz: Fly internal probes
  //   - /api/*: tRPC + REST API calls (301 turns POST→GET, breaks mutations)
  //   - /sitemap.xml + /robots.txt: SEO crawlers
  // Use 308 (not 301) to preserve HTTP method on form submits / file uploads
  // that legitimately hit the page-side host (rare).
  app.use((req, res, next) => {
    if (
      req.path === "/healthz" ||
      req.path.startsWith("/api/") ||
      req.path === "/sitemap.xml" ||
      req.path === "/robots.txt"
    ) {
      return next();
    }
    const host = (req.headers.host || "").toLowerCase();
    const isLegacyHost =
      host === "packgo-travel.fly.dev" ||
      host === "packgo09.manus.space" ||
      host === "packgo-d3xjbq67.manus.space" ||
      host === "www.packgoplay.com";
    if (isLegacyHost) {
      return res.redirect(308, `https://packgoplay.com${req.originalUrl}`);
    }
    return next();
  });

  // P0-6: CORS whitelist - only allow known origins
  const allowedOrigins = [
    // Round 80.18: production custom domain
    "https://packgoplay.com",
    "https://www.packgoplay.com",
    // Fly.io (kept as origin alias — internal health checks + redirect source)
    "https://packgo-travel.fly.dev",
    // Legacy Manus domains (kept during migration overlap; remove once DNS cutover completes)
    "https://packgo09.manus.space",
    "https://packgo-d3xjbq67.manus.space",
    // Development
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    // Allow BASE_URL from env if set
    ...(process.env.BASE_URL ? [process.env.BASE_URL] : []),
  ];

  // Patterns for dynamic origins
  const allowedOriginPatterns = [
    // Fly.io preview deploys (future, e.g. PR builds)
    /^https:\/\/[a-z0-9-]+\.fly\.dev$/,
    // Legacy Manus preview/production (kept during migration overlap)
    /^https:\/\/[a-z0-9-]+\.manus\.space$/,
    /^https:\/\/[a-z0-9-]+\.manus\.computer$/,
    /^https:\/\/[a-z0-9-]+\.us2\.manus\.computer$/,
  ];

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g., mobile apps, curl, Stripe webhooks)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        // Check pattern-based whitelist
        if (allowedOriginPatterns.some(p => p.test(origin))) {
          return callback(null, true);
        }
        console.warn(`[CORS] Blocked request from origin: ${origin}`);
        return callback(new Error(`CORS policy: origin ${origin} not allowed`));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "stripe-signature"],
    })
  );

  // Security headers — applied to all responses before any route handler
  // Tuned for React + Stripe + Google OAuth + S3 images + GTM (no nonce — uses 'unsafe-inline' for scripts to keep build simple).
  app.use((_req, res, next) => {
    // Prevent MIME sniffing
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Only allow embedding in same origin (clickjacking defense — modern replacement is frame-ancestors in CSP, but X-Frame-Options is still honored by older browsers)
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    // Disable legacy XSS auditor (caused more issues than it fixed)
    res.setHeader("X-XSS-Protection", "0");
    // Strict referrer policy — don't leak full URLs to external sites
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // HSTS: 1 year, include subdomains, allow preload. Only emit in production (dev uses http://localhost)
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    }
    // Permissions-Policy — disable camera/mic/geolocation by default (tours don't need them)
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(self), payment=(self \"https://js.stripe.com\" \"https://checkout.stripe.com\")"
    );
    // Content-Security-Policy — balanced: allows Stripe, GTM, S3, Google OAuth, inline scripts (Vite bundles rely on them).
    // Report-only in dev, enforce in production.
    const cspDirectives = [
      "default-src 'self'",
      // Scripts: self + Stripe + GTM + Google + inline (React needs unsafe-inline for hydration; a strict nonce-based CSP would require deeper build changes)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://checkout.stripe.com https://www.googletagmanager.com https://www.google-analytics.com https://accounts.google.com https://apis.google.com",
      // Styles: self + inline (Tailwind + shadcn)
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // Images: self + data URIs + S3 + all https (tour images come from many CDNs)
      "img-src 'self' data: blob: https:",
      // Fonts: self + Google Fonts
      "font-src 'self' data: https://fonts.gstatic.com",
      // Connections: self + Stripe + Google + S3 + analytics + map tile providers.
      // Round 80.21 v14 — maplibre-gl fetches raster tiles via XHR, which
      // CSP blocks unless connect-src lists the tile CDN. Added Carto +
      // OSM Nominatim. Without this, packgoplay.com map renders white
      // and console fills with `AJAXError: Failed to fetch (0)`.
      "connect-src 'self' https://api.stripe.com https://checkout.stripe.com https://*.s3.amazonaws.com https://*.googleapis.com https://www.google-analytics.com https://accounts.google.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://nominatim.openstreetmap.org https://*.basemaps.cartocdn.com https://basemaps.cartocdn.com https://tiles.basemaps.cartocdn.com https://tiles.openfreemap.org https://*.openfreemap.org https://a.tile.opentopomap.org https://b.tile.opentopomap.org https://c.tile.opentopomap.org https://*.opentopomap.org",
      // Frames: Stripe Checkout + Google OAuth
      "frame-src 'self' https://js.stripe.com https://checkout.stripe.com https://accounts.google.com",
      // Objects and base URI: strict
      "object-src 'none'",
      "base-uri 'self'",
      // Form actions: self + Stripe
      "form-action 'self' https://checkout.stripe.com",
      // Don't allow framing from other sites
      "frame-ancestors 'self'",
      // Upgrade http→https
      ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
    ].join("; ");
    // Use report-only in dev so we can observe violations without breaking anything
    const cspHeader =
      process.env.NODE_ENV === "production"
        ? "Content-Security-Policy"
        : "Content-Security-Policy-Report-Only";
    res.setHeader(cspHeader, cspDirectives);
    next();
  });

  // Health check — registered early, no auth, no DB lookup. Fly's
  // http_service health probe hits this; also handy for Cloudflare DNS monitoring.
  app.get("/healthz", (_req, res) => {
    res.status(200).json({
      status: "ok",
      ts: new Date().toISOString(),
      commit: process.env.FLY_MACHINE_VERSION ?? process.env.GIT_COMMIT ?? "unknown",
    });
  });

  // Stripe webhook must be registered BEFORE express.json() to preserve raw body
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

  // Plaid webhook — same raw-body pattern in case we later add JWT
  // signature verification on the headers + raw body.
  app.post(
    "/api/plaid/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const { handlePlaidWebhook } = await import("./plaidWebhook");
      await handlePlaidWebhook(req, res);
    }
  );
  
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  
  // Cookie parser - MUST be before routes that need to read cookies
  app.use(cookieParser());
  
  // Google OAuth (user login)
  initializeGoogleAuth(app);

  // Gmail OAuth (Round 81 — email pipeline)
  initializeGmailOAuth(app);
  
  // Manus OAuth removed - using Google OAuth + Email/Password instead
  // Avatar upload API
  app.use("/api", avatarUploadRouter);
  
  // Tour image upload API
  app.use("/api", tourImageUploadRouter);

  // General image upload API (hero, destinations, etc.)
  app.use("/api", generalImageUploadRouter);
  
  // PDF upload API
  app.use("/api", pdfUploadRouter);

  // v80.24: Internal test endpoint for automated quality regression tests.
  // Protected by INTERNAL_TEST_TOKEN (set via fly secrets). Lets Claude /
  // CI scripts trigger tour generation programmatically without admin login.
  //
  // SECURITY_AUDIT_2026_05_14 P1-5: was a plain `===` token comparison
  // (timing-leak risk, low practical impact but free to fix), no IP
  // allowlist, no rate limit. New behavior layered via `verifyInternalToken`:
  //   - `crypto.timingSafeEqual` for the token compare
  //   - Optional IP allowlist via INTERNAL_TEST_IPS (CSV) — when set, only
  //     listed source IPs may even attempt authentication
  //   - Per-IP rate limit on generates / imports (5 per hour); status
  //     endpoint stays unlimited because it's a read.
  // POST /api/internal/test-generate
  //   Headers: Authorization: Bearer <INTERNAL_TEST_TOKEN>
  //   Body: { url: string, mode?: "URL" | "PDF", isPdf?: boolean }
  // Returns: { jobId: string }
  /**
   * Validate the bearer token + IP + (optional) rate limit on internal
   * endpoints. Returns the source-IP string on success; sends the
   * appropriate 401 / 403 / 429 / 503 response and returns null otherwise.
   */
  async function verifyInternalAuth(
    req: import("express").Request,
    res: import("express").Response,
    options: { rateLimitKey?: string; rateLimitMax?: number; windowSec?: number } = {}
  ): Promise<string | null> {
    const cryptoMod = await import("crypto");
    const ip = (
      (req.headers["fly-client-ip"] as string | undefined) ||
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "unknown"
    );

    // IP allowlist (optional; not enforced if env var unset to preserve
    // the existing dev-machine workflow until Jeff registers his CI IPs).
    const allowList = (process.env.INTERNAL_TEST_IPS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowList.length > 0 && !allowList.includes(ip)) {
      res.status(403).json({ error: "IP not allowed" });
      return null;
    }

    const expected = process.env.INTERNAL_TEST_TOKEN || "";
    if (!expected) {
      res.status(503).json({ error: "INTERNAL_TEST_TOKEN not configured" });
      return null;
    }
    const given = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    // Constant-time compare. Length mismatch → reject without invoking
    // timingSafeEqual (which errors when buffers differ in length).
    const givenBuf = Buffer.from(given);
    const expectedBuf = Buffer.from(expected);
    if (
      givenBuf.length !== expectedBuf.length ||
      !cryptoMod.timingSafeEqual(givenBuf, expectedBuf)
    ) {
      res.status(401).json({ error: "Invalid token" });
      return null;
    }

    if (options.rateLimitKey) {
      const { checkRateLimit } = await import("../rateLimit");
      const rl = await checkRateLimit({
        key: `internal:${options.rateLimitKey}:${ip}`,
        limit: options.rateLimitMax ?? 5,
        window: options.windowSec ?? 3600,
      });
      if (!rl.allowed) {
        res.status(429).json({ error: "Rate limit exceeded" });
        return null;
      }
    }
    return ip;
  }

  /**
   * SECURITY_AUDIT_2026_05_14 P3-4: was hardcoded `userId: 1`. Works
   * today (Jeff is user 1) but breaks the moment a 2nd admin exists or
   * the seed order changes. Resolve the first admin dynamically and
   * cache the result for the process lifetime.
   */
  let cachedAdminUserId: number | null = null;
  async function getOwnerAdminUserId(): Promise<number> {
    if (cachedAdminUserId !== null) return cachedAdminUserId;
    const { getDb } = await import("../db");
    const { users } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const dbInst = await getDb();
    if (!dbInst) throw new Error("DB unavailable");
    const rows = await dbInst
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "admin"))
      .limit(1);
    if (rows.length === 0) {
      throw new Error("No admin user found — seed one before using internal endpoints");
    }
    cachedAdminUserId = rows[0].id;
    return cachedAdminUserId;
  }

  app.post("/api/internal/test-generate", async (req, res) => {
    try {
      const ip = await verifyInternalAuth(req, res, {
        rateLimitKey: "test-generate",
        rateLimitMax: 5,
        windowSec: 3600,
      });
      if (!ip) return;
      const { url, mode, isPdf, force } = req.body || {};
      if (typeof url !== "string" || !url) {
        return res.status(400).json({ error: "Missing url" });
      }
      const { addTourGenerationJob } = await import("../queue");
      const requestId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const job = await addTourGenerationJob({
        url,
        userId: await getOwnerAdminUserId(),
        requestId,
        forceRegenerate: force === true || force === "true",
        isPdf: typeof isPdf === "boolean" ? isPdf : mode === "PDF",
      });
      const jobId = String(job.id || requestId);
      console.log(`[internal/test-generate] queued job=${jobId} mode=${isPdf ? "PDF" : "URL"} url=${url.slice(0, 80)}`);
      return res.json({ jobId, mode: isPdf ? "PDF" : "URL" });
    } catch (err) {
      console.error("[internal/test-generate] error:", err);
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // v80.24: Bulk import from Lion Travel — fast path that skips LLM
  // rewriting. Imports raw Lion data + real seats in ~30 seconds for 50+
  // tours. Admin can trigger background LLM rewrite later.
  // POST /api/internal/bulk-import-lion
  //   Body: { ids?: string[], categoryPath?: string, limit?: number, queueRewrite?: boolean }
  //   Returns: BulkImportBatchResult + (if queueRewrite) queued: N
  app.post("/api/internal/bulk-import-lion", async (req, res) => {
    try {
      // bulk-import = expensive per call (queues N LLM rewrites). Hard cap
      // at 2 per hour per IP — strictly slower than test-generate which
      // is 5/hr — because each call can fan out to 50+ jobs.
      const ip = await verifyInternalAuth(req, res, {
        rateLimitKey: "bulk-import-lion",
        rateLimitMax: 2,
        windowSec: 3600,
      });
      if (!ip) return;
      const { ids, categoryPath, limit, queueRewrite } = req.body || {};
      if (!ids?.length && !categoryPath) {
        return res.status(400).json({ error: "Provide either ids[] or categoryPath" });
      }
      const { bulkImportFromLion, queueRewriteForImportedTours } = await import("../services/lionBulkImportService");
      const result = await bulkImportFromLion({ ids, categoryPath, limit });
      let queued = 0;
      if (queueRewrite && result.imported > 0) {
        const tourIds = result.results.filter(r => r.success && r.tourId).map(r => r.tourId!);
        ({ queued } = await queueRewriteForImportedTours(tourIds, {
          userId: await getOwnerAdminUserId(),
        }));
      }
      return res.json({ ...result, queued });
    } catch (err) {
      console.error("[internal/bulk-import-lion] error:", err);
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Status endpoint paired with test-generate. Status is a polling read,
  // so no rate limit (CI polls every few seconds).
  app.get("/api/internal/test-status/:jobId", async (req, res) => {
    try {
      const ip = await verifyInternalAuth(req, res);
      if (!ip) return;
      const { tourGenerationQueue } = await import("../queue");
      const job = await tourGenerationQueue.getJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: "Job not found" });
      const state = await job.getState();
      const progress = job.progress;
      const result = state === "completed" ? job.returnvalue : null;
      const failedReason = state === "failed" ? job.failedReason : null;
      return res.json({ jobId: job.id, state, progress, result, failedReason });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Progress tracking SSE API
  app.use("/api", progressRouter);

  // AI Chat streaming SSE API
  app.use("/api", aiChatStreamRouter);

  // Dynamic sitemap.xml
  app.get('/sitemap.xml', async (_req, res) => {
    try {
      const { getAllTours } = await import('../db');
      const tours = await getAllTours();
      const { ENV } = await import('./env');
      const baseUrl = ENV.baseUrl;
      const now = new Date().toISOString().split('T')[0];

      // Sitemap pages — SEO audit 2026-05-09 added missing high-value pages
      // (china-visa, membership, rewards, flight/hotel/airport-transfer,
      // custom-tour-request, inquiry) and replaced /visa-services with the
      // canonical /china-visa (the former is a JS redirect).
      const staticPages = [
        { url: '/', priority: '1.0', changefreq: 'daily' },
        { url: '/tours', priority: '0.9', changefreq: 'daily' },
        { url: '/china-visa', priority: '0.9', changefreq: 'weekly' },
        { url: '/custom-tours', priority: '0.8', changefreq: 'weekly' },
        { url: '/custom-tour-request', priority: '0.8', changefreq: 'weekly' },
        { url: '/group-packages', priority: '0.8', changefreq: 'weekly' },
        { url: '/cruises', priority: '0.7', changefreq: 'weekly' },
        { url: '/flight-booking', priority: '0.7', changefreq: 'weekly' },
        { url: '/hotel-booking', priority: '0.7', changefreq: 'weekly' },
        { url: '/airport-transfer', priority: '0.7', changefreq: 'weekly' },
        { url: '/membership', priority: '0.7', changefreq: 'monthly' },
        { url: '/rewards', priority: '0.6', changefreq: 'monthly' },
        { url: '/about-us', priority: '0.7', changefreq: 'monthly' },
        { url: '/contact-us', priority: '0.7', changefreq: 'monthly' },
        { url: '/inquiry', priority: '0.6', changefreq: 'monthly' },
        { url: '/faq', priority: '0.6', changefreq: 'monthly' },
      ];

      // Include both active and soldout tours (soldout still has SEO value; inactive/draft excluded)
      const tourUrls = tours
        .filter((t: any) => t.status === 'active' || t.status === 'soldout')
        .map((t: any) => {
          const lastmod = t.updatedAt ? new Date(t.updatedAt).toISOString().split('T')[0] : now;
          return `  <url>\n    <loc>${baseUrl}/tours/${t.id}</loc>\n    <xhtml:link rel="alternate" hreflang="zh-TW" href="${baseUrl}/tours/${t.id}"/>\n    <xhtml:link rel="alternate" hreflang="en" href="${baseUrl}/tours/${t.id}?lang=en"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}/tours/${t.id}"/>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`;
        })
        .join('\n');

      const staticUrls = staticPages
        .map(p => `  <url>\n    <loc>${baseUrl}${p.url}</loc>\n    <xhtml:link rel="alternate" hreflang="zh-TW" href="${baseUrl}${p.url}"/>\n    <xhtml:link rel="alternate" hreflang="en" href="${baseUrl}${p.url}?lang=en"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}${p.url}"/>\n    <lastmod>${now}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`)
        .join('\n');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${staticUrls}\n${tourUrls}\n</urlset>`;

      res.header('Content-Type', 'application/xml');
      res.send(xml);
    } catch (err) {
      console.error('[Sitemap] Error generating sitemap:', err);
      res.status(500).send('Error generating sitemap');
    }
  });

  // v78f: AI quote inline-HTML viewer. Used when R2 isn't available
  // (or as a permanent serve-from-DB strategy). Reads aiQuotes.pdfHtml and
  // serves it as a standalone web page suitable for forwarding to customers.
  app.get("/api/aiQuotes/:id/view", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).send("Invalid quote id");
      }
      const { getAiQuoteById } = await import("../db");
      const quote = await getAiQuoteById(id);
      if (!quote) return res.status(404).send("Quote not found");
      if (!quote.pdfHtml) return res.status(404).send("Quote has no rendered HTML");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=300"); // 5 min cache OK; quote rarely changes
      return res.send(quote.pdfHtml);
    } catch (err) {
      console.error("[aiQuotes view] error:", (err as Error)?.message);
      return res.status(500).send("Internal error");
    }
  });

  // v78g: invoice inline-HTML viewer. UNLIKE quotes, invoices contain private
  // customer/payment info — auth required: invoice owner OR admin only.
  app.get("/api/invoices/:id/view", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).send("Invalid invoice id");
      }
      const { COOKIE_NAME } = await import("@shared/const");
      const { verifyToken } = await import("../jwt");
      const { getInvoiceById, getUserById, getBookingById } = await import("../db");

      const token = (req as any).cookies?.[COOKIE_NAME];
      const payload = token ? verifyToken(token) : null;
      if (!payload) return res.status(401).send("Login required");
      const user = await getUserById(payload.userId);
      if (!user) return res.status(401).send("Login required");

      const invoice = await getInvoiceById(id);
      if (!invoice) return res.status(404).send("Invoice not found");

      // Authorization: admin always allowed; otherwise must own the linked booking
      if (user.role !== "admin") {
        if (!invoice.bookingId) return res.status(403).send("Forbidden");
        const booking = await getBookingById(invoice.bookingId);
        if (!booking || booking.userId !== user.id) {
          return res.status(403).send("Forbidden");
        }
      }

      if (!invoice.pdfHtml) return res.status(404).send("Invoice has no rendered HTML");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store"); // never cache invoices
      return res.send(invoice.pdfHtml);
    } catch (err) {
      console.error("[invoices view] error:", (err as Error)?.message);
      return res.status(500).send("Internal error");
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Schedule zombie task cleanup every 10 minutes (timeout: 25 min)
  // Round 36-Fix-2: 從 5 分鐘延長到 25 分鐘，避免誤殺正在執行的任務
  // 排程間隔從 5 分鐘改為 10 分鐘，減少不必要的 DB 查詢
  try {
    const { cleanupZombieTasks } = await import('../agentActivityService');
    // Run cleanup immediately on startup
    cleanupZombieTasks(30).then(count => {
      if (count > 0) console.log(`[Startup] Cleaned up ${count} zombie task(s)`);
    }).catch(() => {});
    // Then run every 10 minutes
    setInterval(() => {
      cleanupZombieTasks(30).catch(() => {});
    }, 10 * 60 * 1000);
    console.log('[Startup] Zombie task cleanup scheduler initialized (every 10 min, timeout 30 min)');
  } catch (err) {
    console.warn('[Startup] Failed to initialize zombie cleanup:', err);
  }

  // Schedule daily tour monitor at 03:00 Taiwan time (19:00 UTC)
  try {
    const { scheduleDailyTourMonitor } = await import('../queue');
    await scheduleDailyTourMonitor();
  } catch (err) {
    console.warn('[Startup] Failed to schedule daily tour monitor:', err);
  }

  // v77: Schedule daily trip-reminder scan at 09:00 Taipei (01:00 UTC). Sends
  // 30/14/7/3/1-day departure reminders; idempotent via Redis SET dedup.
  try {
    const { scheduleDailyTripReminders } = await import('../queue');
    await scheduleDailyTripReminders();
    // Also import the worker so it starts processing the queue
    await import('../tripReminderWorker');
  } catch (err) {
    console.warn('[Startup] Failed to schedule trip reminders:', err);
  }

  // Round 81 Phase 3.5: Schedule weekly Self-Retrospective at Mon 01:00 UTC
  // (Sun 18:00 PT). Reads past 7 days of agent outcomes + policies, posts
  // a digest + policy proposals to the Inbox.
  try {
    const { scheduleWeeklyRetrospective } = await import('../queue');
    await scheduleWeeklyRetrospective();
    await import('../retrospectiveWorker');
  } catch (err) {
    console.warn('[Startup] Failed to schedule weekly retrospective:', err);
  }

  // QA audit 2026-05-11 Phase 9 P0: Gmail poll cron. Closes the
  // "customer asks at 10am, Jeff sees at 2pm" gap by polling every 10
  // minutes and running InquiryAgent pipeline on new threads. autoSend
  // gate inside the pipeline still respects per-policy autoSendEnabled.
  try {
    const { scheduleGmailPoll } = await import('../queue');
    await scheduleGmailPoll();
    await import('../gmailPollWorker');
  } catch (err) {
    console.warn('[Startup] Failed to schedule Gmail poll:', err);
  }

  // Booking followup worker — drains the queue that bookings.create
  // enqueues into. Generates deposit PDF + sends confirmation email
  // off the HTTP critical path.
  try {
    await import('../bookingFollowupWorker');
  } catch (err) {
    console.warn('[Startup] Failed to init booking followup worker:', err);
  }

  // Phase 1.5: Plaid daily sync — catch-up cron at 05:00 UTC. Webhooks
  // give sub-minute latency during normal ops, but Plaid recommends a
  // daily safety-net /transactions/sync against every item in case any
  // webhook was missed. The worker is registered even if PLAID_CLIENT_ID
  // is unset — it no-ops at runtime so dev doesn't choke on missing keys.
  try {
    const { schedulePlaidDailySync } = await import('../queue');
    await schedulePlaidDailySync();
    await import('../plaidSyncWorker');
  } catch (err) {
    console.warn('[Startup] Failed to schedule Plaid daily sync:', err);
  }

  // Phase 4: Trust account recognition cron at 06:00 UTC (1 hr after Plaid
  // sync so today's deposits are in the DB before we scan for ready-to-
  // recognize rows). Feature-flagged via PLAID_TRUST_DEFERRAL_ENABLED in
  // the service layer — worker fires but no-ops when off.
  try {
    const { scheduleDailyTrustRecognition } = await import('../queue');
    await scheduleDailyTrustRecognition();
    await import('../trustRecognitionWorker');
  } catch (err) {
    console.warn('[Startup] Failed to schedule trust recognition cron:', err);
  }

  // Round 80.22 Phase C: Packpoint daily maintenance — auto-upgrade tier,
  // 18-month inactivity expiry, birthday bonus. Runs at 02:00 UTC (10:00
  // Taipei). Idempotent on each user-level mutation.
  try {
    const {
      scheduleDailyPackpointMaintenance,
      initPackpointMaintenanceWorker,
    } = await import('../queues/packpointMaintenanceQueue');
    await scheduleDailyPackpointMaintenance();
    initPackpointMaintenanceWorker();
  } catch (err) {
    console.warn('[Startup] Failed to schedule Packpoint maintenance:', err);
  }

  // Round 80.22 Phase H2: Supplier poster processing worker — async
  // pipeline (AI Vision → gpt-image-2 → 7 platform copies). Triggered
  // by admin uploads via posters.create tRPC mutation.
  try {
    const { initPosterProcessingWorker } = await import(
      '../queues/posterProcessingQueue'
    );
    initPosterProcessingWorker();
  } catch (err) {
    console.warn('[Startup] Failed to init poster processing worker:', err);
  }

  // Phase 1D supplier-sync — daily catalog mirror for Lion + UV at
  // 03:00 UTC. See server/services/supplierSyncService.ts for the
  // orchestrator and server/queues/supplierSyncQueue.ts for the
  // BullMQ worker.
  try {
    const {
      initSupplierSyncWorker,
      ensureDailySupplierSyncScheduled,
    } = await import('../queues/supplierSyncQueue');
    initSupplierSyncWorker();
    await ensureDailySupplierSyncScheduled();
  } catch (err) {
    console.warn('[Startup] Failed to init supplier sync worker:', err);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  
  // Set SO_REUSEADDR option before listening
  server.listen({
    port: preferredPort,
    host: '0.0.0.0',
    exclusive: false,
  });
  
  // Handle port already in use error
  server.on('error', async (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${preferredPort} is busy, trying to find alternative...`);
      const port = await findAvailablePort(preferredPort + 1);
      console.log(`Using port ${port} instead`);
      server.listen({
        port,
        host: '0.0.0.0',
        exclusive: false,
      });
    } else {
      console.error('Server error:', err);
      throw err;
    }
  });
}

startServer().catch(console.error);
