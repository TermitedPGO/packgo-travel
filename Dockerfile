# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for PACK&GO (Vite + Node/tRPC + Puppeteer)

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: Build
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

# Build tools for native deps (sharp, bcrypt, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Enable Corepack-managed pnpm (version pinned from package.json packageManager field)
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

# Copy manifests first for better layer caching
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# Install ALL deps (including devDeps — needed for vite build + esbuild)
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN pnpm install --frozen-lockfile --config.confirmModulesPurge=false

# Copy source and build
COPY . .
RUN pnpm build

# NOTE: we intentionally do NOT run `pnpm prune --prod` here.
# server/_core/vite.ts statically imports vite + vite.config, which pulls
# vite/@vitejs/plugin-react/@tailwindcss/vite/jsx-loc into the runtime graph.
# Pruning removes them and the server fails with ERR_MODULE_NOT_FOUND.
# Keeping devDeps adds ~100MB to the image — acceptable trade-off until we
# refactor vite.ts to dynamic-import its dev-only pieces.

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: Runtime
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

# Chromium for Puppeteer + CJK fonts for rendered screenshots
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    ca-certificates \
    dumb-init \
 && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the system Chromium instead of downloading its own
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROMIUM_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=8080

WORKDIR /app

# Copy built artefacts + pruned node_modules from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/drizzle ./drizzle
# Migration runner invoked by Fly's release_command before new machines receive traffic
COPY --from=builder /app/scripts ./scripts

# Non-root user for runtime
RUN useradd -m -u 1001 packgo && chown -R packgo:packgo /app
USER packgo

EXPOSE 8080

# dumb-init handles PID 1 signal forwarding so Fly's `fly apps restart` works cleanly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
