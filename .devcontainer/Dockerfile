FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    chromium \
    fonts-liberation fonts-noto-cjk fonts-noto-color-emoji \
    ca-certificates git curl \
 && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROMIUM_PATH=/usr/bin/chromium

RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
