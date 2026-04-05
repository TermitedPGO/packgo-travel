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
    // Production domains
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
  // Allow all *.manus.space (production) and *.manus.computer (sandbox preview)
  const allowedOriginPatterns = [
    /^https:\/\/[a-z0-9-]+\.manus\.space$/,       // *.manus.space (all production)
    /^https:\/\/[a-z0-9-]+\.manus\.computer$/,    // *.manus.computer (sandbox preview)
    /^https:\/\/[a-z0-9-]+\.us2\.manus\.computer$/, // *.us2.manus.computer
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

      const tourUrls = tours
        .filter((t: any) => t.status === 'published')
        .map((t: any) => `  <url>\n    <loc>${baseUrl}/tour/${t.id}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`)
        .join('\n');

      const staticUrls = staticPages
        .map(p => `  <url>\n    <loc>${baseUrl}${p.url}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`)
        .join('\n');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${staticUrls}\n${tourUrls}\n</urlset>`;

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

  // Schedule zombie task cleanup every 5 minutes (timeout: 10 min)
  try {
    const { cleanupZombieTasks } = await import('../agentActivityService');
    // Run cleanup immediately on startup
    cleanupZombieTasks(10).then(count => {
      if (count > 0) console.log(`[Startup] Cleaned up ${count} zombie task(s)`);
    }).catch(() => {});
    // Then run every 5 minutes
    setInterval(() => {
      cleanupZombieTasks(10).catch(() => {});
    }, 5 * 60 * 1000);
    console.log('[Startup] Zombie task cleanup scheduler initialized (every 5 min, timeout 10 min)');
  } catch (err) {
    console.warn('[Startup] Failed to initialize zombie cleanup:', err);
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
