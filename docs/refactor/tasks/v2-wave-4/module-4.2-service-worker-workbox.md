# v2 · Wave 4 · Module 4.2 — Service worker via Workbox (vite-plugin-pwa)

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L1 — Customer PWA, §Module 4.2)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain) + §H (perf — runtime cache reduces repeat-tour-view load time)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 10 h AI + 30 min Jeff review (test the update-prompt UX on staging)
**Deploy window:** Tuesday/Wednesday 9-11am PT — service workers persist on user devices; bad SW = bricked installs until next visit + skipWaiting flush

## Goal

Install `vite-plugin-pwa` + `workbox-window`, configure Workbox strategies for an offline-capable customer PWA (offline shell, runtime-cached tour catalog, immutable asset caching), and wire a "new version available — refresh?" prompt that the user must explicitly accept (no auto-reload mid-booking). Module 4.6's Lighthouse PWA score ≥90 gate depends on a service worker being registered.

## Pre-requisites

- **Module 4.1 must be merged first** — Workbox auto-injects the manifest into the SW config; an invalid manifest breaks the SW build.
- Wave 1 complete (Sentry + pino + admin code-split landed) — SW changes are observable on regression.
- Wave 2 complete (TourDetailPeony split done, so the per-section bundles are stable code-split chunks that Workbox can fingerprint).
- No active editing of `client/index.html` or `vite.config.ts` by sibling modules during dispatch.

## Inputs (read these before executing)

- `vite.config.ts` — current Vite config (likely no PWA plugin yet — grep to confirm).
- `package.json` — confirm Vite version (Wave 4 SDKs need Vite 5+ for vite-plugin-pwa 0.20+).
- `client/index.html` — Module 4.1 added the `<link rel="manifest">`; SW registration script will be auto-injected by vite-plugin-pwa, but we may need a manual `<script>` for the update-prompt hook.
- `client/src/main.tsx` — entry; the update-prompt UI is mounted from here.
- `CLAUDE.md` §2.1 (rounded corners) + §2.2 (colors) — the update-prompt UI itself must follow design rules (`rounded-xl` for the prompt card, teal accent).
- Workbox docs: https://vite-pwa-org.netlify.app/ + https://developer.chrome.com/docs/workbox/

## Scope (what this module owns)

- ✅ `package.json` — add `vite-plugin-pwa`, `workbox-window`. (Workbox itself comes as a peer dep.)
- ✅ `vite.config.ts` — register plugin with explicit caching strategies (see Procedure step 3).
- ✅ `client/src/components/PWAUpdatePrompt.tsx` — NEW small component that subscribes to `workbox-window` register-events and shows a `<Toast>` / `<Banner>` "New version available — refresh now?" with explicit user accept. Mount from `client/src/main.tsx`.
- ✅ Vitest covering Workbox strategy mappings (2 cases per plan).
- ❌ NOT in scope: install-prompt UX (Module 4.5), push notifications (Module 4.3), Lighthouse gate config (Module 4.6).

## Procedure

1. **Read `vite.config.ts`, `client/src/main.tsx`, `package.json`.** Confirm Vite version ≥5. If Vite is 4.x, escalate to Jeff for upgrade decision (out of scope for this module).

2. **Install deps:**
   ```bash
   pnpm add -D vite-plugin-pwa@latest
   pnpm add workbox-window
   ```
   (`workbox-window` is a runtime dep — it ships to client to listen for SW lifecycle events.)

3. **Edit `vite.config.ts` — add the plugin with these strategies:**

   ```ts
   import { VitePWA } from 'vite-plugin-pwa';

   // Inside `defineConfig({ plugins: [...] })`:
   VitePWA({
     registerType: 'prompt', // Critical: NOT autoUpdate — booking flow protection
     injectRegister: 'auto',
     // Manifest content is the file at client/public/manifest.json (Module 4.1).
     // Tell Workbox NOT to overwrite it — we maintain manifest.json by hand.
     manifest: false,
     workbox: {
       globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
       runtimeCaching: [
         // 1. App shell — NetworkFirst on navigation requests (HTML)
         {
           urlPattern: ({ request }) => request.mode === 'navigate',
           handler: 'NetworkFirst',
           options: {
             cacheName: 'app-shell',
             expiration: { maxAgeSeconds: 60 * 60 * 24 }, // 24h
             networkTimeoutSeconds: 3,
           },
         },
         // 2. Hashed assets — CacheFirst (immutable, vite emits content-hash)
         {
           urlPattern: /\/assets\/.*\.(js|css|woff2|svg|png|jpg|jpeg|webp)$/,
           handler: 'CacheFirst',
           options: {
             cacheName: 'static-assets',
             expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }, // 30d
           },
         },
         // 3. tRPC tour list (read-only browse) — StaleWhileRevalidate 5min
         {
           urlPattern: /\/api\/trpc\/tours\.(list|getById|getBySlug)/,
           handler: 'StaleWhileRevalidate',
           options: {
             cacheName: 'tours-cache',
             expiration: { maxEntries: 100, maxAgeSeconds: 5 * 60 },
           },
         },
         // 4. R2 / S3 images — CacheFirst long TTL
         {
           urlPattern: /\.(?:r2\.dev|amazonaws\.com)\//,
           handler: 'CacheFirst',
           options: {
             cacheName: 'cdn-images',
             expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 60 }, // 60d
           },
         },
         // EXPLICITLY NOT CACHED (network-only — never serve stale auth/payments):
         // - /api/trpc/auth.*
         // - /api/trpc/bookings.* (write paths)
         // - /api/trpc/stripeWebhook.*
         // - /api/trpc/admin.* (admin sees stale data = bad)
       ],
       navigateFallback: '/index.html',
       navigateFallbackDenylist: [/^\/api\//, /^\/admin/],
     },
     devOptions: {
       enabled: false, // SW off in dev to avoid debug pain
     },
   }),
   ```

4. **Create `client/src/components/PWAUpdatePrompt.tsx`:**

   ```tsx
   import { useEffect, useState } from 'react';
   import { Workbox } from 'workbox-window';
   import { Button } from '@/components/ui/button';
   import { useTranslation } from '@/_core/hooks/useTranslation';

   export function PWAUpdatePrompt() {
     const { t } = useTranslation();
     const [waitingWorker, setWaitingWorker] = useState<Workbox | null>(null);
     const [showPrompt, setShowPrompt] = useState(false);

     useEffect(() => {
       if (!('serviceWorker' in navigator)) return;
       const wb = new Workbox('/sw.js');
       wb.addEventListener('waiting', () => {
         setWaitingWorker(wb);
         setShowPrompt(true);
       });
       wb.register();
     }, []);

     const handleRefresh = () => {
       if (!waitingWorker) return;
       waitingWorker.addEventListener('controlling', () => window.location.reload());
       waitingWorker.messageSkipWaiting();
     };

     if (!showPrompt) return null;
     return (
       <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl bg-white shadow-lg border border-gray-200 p-4">
         <p className="text-sm font-medium mb-3">{t('pwa.updateAvailable')}</p>
         <div className="flex gap-2">
           <Button onClick={handleRefresh} className="rounded-lg" size="sm">
             {t('pwa.refreshNow')}
           </Button>
           <Button variant="outline" onClick={() => setShowPrompt(false)} className="rounded-lg" size="sm">
             {t('pwa.later')}
           </Button>
         </div>
       </div>
     );
   }
   ```

   **CLAUDE.md §2.1 compliance:** `rounded-xl` on the prompt card, `rounded-lg` on both buttons (NOT `rounded-full`), `border-gray-200` borders are fine.

5. **Wire into `client/src/main.tsx`:**
   - Import `PWAUpdatePrompt`.
   - Mount once inside the React root, alongside `<App />`.
   - Order: `<App />` first, `<PWAUpdatePrompt />` last (z-50 floats above everything).

6. **Add i18n keys (Module 4.17 will restructure — for now, add at root of `zh-TW.ts` and `en.ts`):**
   - `pwa.updateAvailable`: "PACK&GO 有新版本可用" / "PACK&GO has a new version"
   - `pwa.refreshNow`: "立即更新" / "Refresh now"
   - `pwa.later`: "稍後" / "Later"

7. **Verify build:**
   ```bash
   pnpm build
   ls -la dist/public/sw.js dist/public/registerSW.js dist/public/workbox-*.js
   ```
   Expected: SW file at `dist/public/sw.js`, register helper, and Workbox runtime chunks.

8. **Smoke test on staging:**
   - Deploy → open in Chrome → DevTools → Application → Service Workers → confirm registered, status "activated and running".
   - DevTools → Network → throttle to "Offline" → reload page → app shell still renders, cached tour list still browseable.
   - Make a small change to a non-cached file, redeploy → reopen tab → "new version available" prompt should appear within 60s (SW poll interval).

## Acceptance Criteria

- [ ] `vite-plugin-pwa` + `workbox-window` in `package.json` `devDependencies` / `dependencies` respectively.
- [ ] `vite.config.ts` registers `VitePWA` with the 4 runtime caching strategies listed above.
- [ ] `client/src/components/PWAUpdatePrompt.tsx` exists and is mounted from `client/src/main.tsx`.
- [ ] Update prompt UI uses `rounded-xl` card + `rounded-lg` buttons (CLAUDE.md §2.1 compliance).
- [ ] Update prompt strings present in `client/src/i18n/zh-TW.ts` and `client/src/i18n/en.ts` (3 keys each).
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] `pnpm build` succeeds; `dist/public/sw.js` is generated; `dist/public/registerSW.js` is referenced from `dist/public/index.html`.
- [ ] **Test:** new Vitest `client/src/components/PWAUpdatePrompt.test.tsx` — 2 cases per plan: (a) renders nothing when `workbox.waiting` not fired; (b) shows prompt when `waiting` event fires, clicking "Refresh" calls `messageSkipWaiting`. Mock `workbox-window` with `vi.mock`. **Required per CLAUDE.md §九.**
- [ ] Manual: staging offline-mode smoke — app shell renders + 1 prior-visited tour-detail still loads.
- [ ] Manual: staging update-prompt smoke — make a no-op change, redeploy, confirm prompt appears.

## Deliverable

- New: `client/src/components/PWAUpdatePrompt.tsx`, `client/src/components/PWAUpdatePrompt.test.tsx`
- Modified: `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `client/src/main.tsx`, `client/src/i18n/zh-TW.ts`, `client/src/i18n/en.ts`

**Commit message:**

```
feat(pwa): Wave 4 module 4.2 — service worker via Workbox

- Install vite-plugin-pwa with registerType:'prompt' (no auto-reload mid-flow)
- 4 runtime caching strategies: NetworkFirst app shell, CacheFirst hashed assets,
  StaleWhileRevalidate tour list, CacheFirst CDN images
- Explicitly NOT cached: auth/bookings/admin/stripeWebhook (never serve stale)
- PWAUpdatePrompt React component for explicit user-accepted updates
- i18n keys added (pwa.updateAvailable / refreshNow / later)
- Vitest covers prompt lifecycle (2 cases)

Unblocks: Module 4.6 (Lighthouse PWA score requires SW registered).
Risk-mitigation: prompt-on-update prevents user losing booking-flow state.

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.2
```

## Rollback

- Single revert reverts plugin + component + main.tsx wiring.
- **SW poison concern:** if a bad SW reaches user devices, revert alone isn't enough — the prior SW persists until next page visit. Mitigation: include an empty `sw.js` in revert (acts as kill-switch unregister) — or rely on `clients.claim()` + `skipWaiting()` flush from a follow-up emergency deploy.
- Wave 1 Sentry will fire JS errors from the SW lifecycle, giving early warning.

## Manual intervention

- **Jeff:** Staging-side test (post-deploy, before prod): visit a tour page → close tab → re-open offline (airplane mode) → confirm app shell + last-viewed tour still load — 5 min.
- **Jeff:** Triggered update-prompt smoke: deploy a no-op change to staging → wait 60s on the page → confirm prompt appears, "Refresh now" reloads — 5 min.
- **Jeff:** Approve theme of the prompt (Toast vs Banner vs floating card). The implementation above uses a floating card (`fixed bottom-6 right-6`). If Jeff wants a top banner instead, adjust before merge — 5 min.

## Test plan

**New Vitest:** `client/src/components/PWAUpdatePrompt.test.tsx` — 2 cases:

1. **No prompt without waiting event:** mock `Workbox` constructor → render → query for prompt text → expect not in document.
2. **Prompt + refresh path:** mock `Workbox` so adding 'waiting' listener immediately invokes callback → render → expect prompt visible → click "Refresh now" button → assert `messageSkipWaiting` mock called.

**Regression anchor:** full `pnpm test` pass count unchanged.

**Manual smoke (Jeff-side, post-staging-deploy, pre-prod):**
- DevTools Application tab → Service Workers → registered + active.
- DevTools Network tab → throttle Offline → reload → shell renders.
- Trigger update event → prompt UX renders correctly with brand colors.

## Decisions needed (Jeff)

1. **Update-prompt style** — floating card (current implementation) vs top banner vs Toast notification? Recommend floating card for non-disruption (Toast can vanish before user notices). Lock before Procedure step 4.
2. **Cache TTLs** — defaults: shell 24h, assets 30d, tour list 5min, images 60d. If Jeff wants shorter image TTL for fresher tour photos, adjust before merge.
3. **`navigateFallbackDenylist` scope** — current excludes `/api/` and `/admin`. If Jeff wants `/booking` also excluded (force fresh booking-flow state always), add to the regex.
