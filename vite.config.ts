import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type PluginOption, type ViteDevServer } from "vite";

// vite-plugin-manus-runtime was removed during Fly.io migration.
// If you ever need the Manus dev bridge back, re-add the package and
// reference it here via a dynamic import() — do NOT reintroduce
// `createRequire` because this file is also bundled into the server
// build and would collide with esbuild's ESM banner.

// =============================================================================
// Manus Debug Collector - Vite Plugin
// Writes browser logs directly to files, trimmed when exceeding size limit
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6); // Trim to 60% to avoid constant re-trimming

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    // Keep newest lines (from end) that fit within 60% of maxSize
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore trim errors */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;

  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);

  // Format entries with timestamps
  const lines = entries.map((entry) => {
    const ts = new Date().toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });

  // Append to log file
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");

  // Trim if exceeds max size
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

/**
 * Vite plugin to collect browser debug logs
 * - POST /__manus__/logs: Browser sends logs, written directly to files
 * - Files: browserConsole.log, networkRequests.log, sessionReplay.log
 * - Auto-trimmed when exceeding 1MB (keeps newest entries)
 */
function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",

    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true,
            },
            injectTo: "head",
          },
        ],
      };
    },

    configureServer(server: ViteDevServer) {
      // POST /__manus__/logs: Browser sends logs (written directly to files)
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        const handlePayload = (payload: any) => {
          // Write logs directly to files
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };

        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    },
  };
}

const plugins: PluginOption[] = [
  react(),
  tailwindcss(),
  // Builder.io click-to-source: injects data-loc="file:line" on every JSX
  // element. That's a DEV-ONLY editor affordance — in a prod build it leaks
  // source paths into the shipped HTML and bloats every element. `apply:
  // "serve"` scopes it to the Vite dev server so prod + the bot-prerender
  // output stay clean. (jsxLocPlugin() returns a plain Plugin object, so the
  // spread preserves its transform hook; we can't use NODE_ENV here because
  // the plugins array is evaluated before Vite sets the build mode.)
  { ...jsxLocPlugin(), apply: "serve" },
  vitePluginManusDebugCollector(),
];

// v2 Wave 1 Module 1.1 — Sentry sourcemap upload (production builds only).
// Gated on SENTRY_AUTH_TOKEN so dev/CI without the token still builds.
// Returns Plugin[] from sentryVitePlugin; spread into plugins array.
if (process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT) {
  plugins.push(
    ...sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      sourcemaps: {
        // The Vite build emits sourcemaps when build.sourcemap=true. We
        // pass the glob explicitly so the plugin uploads only the production
        // chunk maps, not any leftover dev artifacts.
        assets: "./dist/public/assets/**",
        // Delete the .map files from disk after upload so they're never
        // served from the static dir (avoids leaking source to the
        // public internet — Sentry resolves them server-side).
        filesToDeleteAfterUpload: "./dist/public/assets/**/*.map",
      },
      release: {
        name: process.env.FLY_MACHINE_VERSION ?? process.env.GIT_COMMIT,
      },
    }),
  );
}

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // v2 Wave 1 Module 1.1 — emit sourcemaps so @sentry/vite-plugin has
    // something to upload. Sourcemaps go to dist/public/assets/*.map and
    // are uploaded to Sentry only when SENTRY_AUTH_TOKEN is set (see
    // plugin gate above). They are NOT served alongside the JS bundles
    // in production because the static file middleware would expose them
    // — Sentry resolves them server-side via the upload.
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split large vendor libs into their own chunks so they can be cached
        // independently of app code and don't bloat the main entry.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          // v80.24 PROD CRASH FIX: was 4 separate chunks (vendor-react,
          // vendor-radix, vendor-trpc, vendor-router). Production bundle
          // had circular imports between vendor-react ↔ vendor-radix because
          // Radix internals + react-jsx-runtime CJS interop created cross-
          // chunk references. ESM evaluation order then yielded
          // `React.forwardRef === undefined` and the entire app failed to
          // mount with a blank white screen.
          //
          // Consolidating into ONE vendor chunk eliminates the cycle. We
          // lose a tiny bit of cache granularity (changing tRPC busts the
          // whole vendor cache) but gain "the app actually loads".
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/") ||
            id.includes("/node_modules/@radix-ui/") ||
            id.includes("/node_modules/@trpc/") ||
            id.includes("/node_modules/@tanstack/react-query") ||
            id.includes("/node_modules/superjson/") ||
            id.includes("/node_modules/wouter/")
          ) {
            return "vendor-react";
          }

          // Recharts (admin analytics only).
          if (
            id.includes("/node_modules/recharts/") ||
            id.includes("/node_modules/d3-")
          ) {
            return "vendor-recharts";
          }

          // NOTE: do NOT bundle shiki / @shikijs / mermaid into a single
          // vendor chunk. Their per-language grammar/diagram files are
          // already code-split by Vite as separate dynamic-import chunks
          // (e.g. `cpp.js`, `mermaid.core.js`) and only loaded when the AI
          // output actually needs them. Forcing them into one chunk would
          // pull a 12MB blob the first time the AI dialog opens.

          // Heavy date / image libs that aren't on the home critical path.
          if (
            id.includes("/node_modules/react-day-picker/") ||
            id.includes("/node_modules/date-fns/")
          ) {
            return "vendor-date";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
