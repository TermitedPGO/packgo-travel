/**
 * PACK&GO PWA service worker — Mobile Phase 0
 *
 * Strategy:
 *   - SHELL (HTML / JS / CSS / fonts): cache-first → network fallback.
 *     Lets Jeff open /admin/v2 with zero network and see the last-cached
 *     UI shell, then live data hydrates when 4G reconnects.
 *   - tRPC + REST API: network-first, NO cache. We don't want stale
 *     bank balances or stale customer phone numbers. Falls through to
 *     network failure cleanly.
 *   - Images (R2, /images/*): stale-while-revalidate so tour photos
 *     and PACK&GO logo load instantly from cache while a fresh fetch
 *     runs in the background.
 *   - Service-worker.js itself: not cached (browser handles).
 *
 * Lifecycle:
 *   - On install, precache the shell + manifest + 2 PWA icons.
 *   - On activate, delete old caches (versioned by CACHE_VERSION).
 *   - On message {type: SKIP_WAITING}, hot-swap to new SW (used by
 *     the in-app "new version available" toast — Phase 6).
 *
 * Versioning: bump CACHE_VERSION on every meaningful SW change so
 * old caches get pruned cleanly.
 *
 * NOT cached (deliberate):
 *   - /api/* — needs fresh data, especially Plaid balance & inquiries
 *   - /__webpack_hmr — dev-only
 *   - Sentry, PostHog beacons — must reach origin or be dropped
 */

const CACHE_VERSION = "packgo-v1-2026-05-22";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

// Files that constitute the offline-loadable app shell.
// Index.html is the entry; Vite hashes JS/CSS bundles so we can't list
// them up-front — they're added to the cache opportunistically on first
// request via the cache-first handler.
const SHELL_FILES = [
  "/",
  "/manifest.json",
  "/images/pwa/icon-192.png",
  "/images/pwa/icon-512.png",
  "/images/logo-bag-black-v3.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      // Don't fail the whole install if one icon 404s — best-effort.
      return Promise.all(
        SHELL_FILES.map((url) =>
          cache.add(url).catch((err) => {
            console.warn("[sw] precache miss", url, err.message);
          }),
        ),
      );
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(CACHE_VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Network-first for API: never serve stale data for tRPC.
function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

// Image / asset detection.
function isImageRequest(url, request) {
  if (request.destination === "image") return true;
  if (url.pathname.startsWith("/images/")) return true;
  if (url.pathname.startsWith("/r2-cdn/")) return true;
  return false;
}

// HTML shell detection (so we serve the cached index for SPA routes when offline).
function isShellRequest(request) {
  return request.mode === "navigate" || request.destination === "document";
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip cross-origin entirely — we never want to cache Stripe, Plaid,
  // Anthropic API, Sentry / PostHog beacons, etc.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Skip non-GET — caches.match only handles GET cleanly.
  if (event.request.method !== "GET") {
    return;
  }

  // API: network only. If offline, let the browser error naturally so
  // tRPC sees a network failure and shows the right UI state.
  if (isApiRequest(url)) {
    return;
  }

  // Shell: cache-first with network fallback. Cache hit = instant load
  // offline. Miss = fetch + cache for next time.
  if (isShellRequest(event.request)) {
    event.respondWith(
      caches.match("/").then((cached) => {
        const networkFetch = fetch(event.request)
          .then((res) => {
            if (res && res.status === 200) {
              const cloned = res.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put("/", cloned));
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      }),
    );
    return;
  }

  // Images: stale-while-revalidate.
  if (isImageRequest(url, event.request)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((res) => {
            if (res && res.status === 200) {
              const cloned = res.clone();
              caches.open(IMAGE_CACHE).then((cache) => cache.put(event.request, cloned));
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      }),
    );
    return;
  }

  // Hashed JS/CSS bundles: cache-first (content-hashed, safe forever).
  if (/\.(?:js|css|woff2|woff|ttf|otf)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res && res.status === 200) {
            const cloned = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, cloned));
          }
          return res;
        });
      }),
    );
    return;
  }

  // Default: pass through (network only).
});
