import "dotenv/config";
import express from "express";
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
  const server = createServer(app);
  
  // Enable SO_REUSEADDR to allow port reuse
  server.on('listening', () => {
    const addr = server.address();
    const port = typeof addr === 'object' ? addr?.port : addr;
    console.log(`Server running on http://localhost:${port}/`);
  });
  
  // P0-6: CORS whitelist - only allow known origins
  const allowedOrigins = [
    // Fly.io production
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
      // Connections: self + Stripe + Google + S3 + analytics
      "connect-src 'self' https://api.stripe.com https://checkout.stripe.com https://*.s3.amazonaws.com https://*.googleapis.com https://www.google-analytics.com https://accounts.google.com",
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
  
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  
  // Cookie parser - MUST be before routes that need to read cookies
  app.use(cookieParser());
  
  // Google OAuth
  initializeGoogleAuth(app);
  
  // Manus OAuth removed - using Google OAuth + Email/Password instead
  // Avatar upload API
  app.use("/api", avatarUploadRouter);
  
  // Tour image upload API
  app.use("/api", tourImageUploadRouter);

  // General image upload API (hero, destinations, etc.)
  app.use("/api", generalImageUploadRouter);
  
  // PDF upload API
  app.use("/api", pdfUploadRouter);
  
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

      const staticPages = [
        { url: '/', priority: '1.0', changefreq: 'daily' },
        { url: '/tours', priority: '0.9', changefreq: 'daily' },
        { url: '/about-us', priority: '0.7', changefreq: 'monthly' },
        { url: '/contact-us', priority: '0.7', changefreq: 'monthly' },
        { url: '/custom-tours', priority: '0.8', changefreq: 'weekly' },
        { url: '/group-packages', priority: '0.8', changefreq: 'weekly' },
        { url: '/cruises', priority: '0.7', changefreq: 'weekly' },
        { url: '/visa-services', priority: '0.6', changefreq: 'monthly' },
        { url: '/faq', priority: '0.6', changefreq: 'monthly' },
      ];

      // Include both active and soldout tours (soldout still has SEO value; inactive/draft excluded)
      const tourUrls = tours
        .filter((t: any) => t.status === 'active' || t.status === 'soldout')
        .map((t: any) => {
          const lastmod = t.updatedAt ? new Date(t.updatedAt).toISOString().split('T')[0] : now;
          return `  <url>\n    <loc>${baseUrl}/tour/${t.id}</loc>\n    <xhtml:link rel="alternate" hreflang="zh-TW" href="${baseUrl}/tour/${t.id}"/>\n    <xhtml:link rel="alternate" hreflang="en" href="${baseUrl}/tour/${t.id}?lang=en"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}/tour/${t.id}"/>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`;
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
