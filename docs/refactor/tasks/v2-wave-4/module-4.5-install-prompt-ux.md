# v2 · Wave 4 · Module 4.5 — PWA install prompt UX (3-tour-view trigger)

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L1 — Customer PWA, §Module 4.4)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 6 h AI + 15 min Jeff review (visual + copy approval)
**Deploy window:** any weekday — additive customer-facing UI; toggle by feature flag for first 24h if desired

## Goal

Build the customer-facing "Install PACK&GO" prompt that appears after a user views 3 tour-detail pages in one session, with platform-specific behavior:

- **Chrome/Edge/Android Chrome:** uses `beforeinstallprompt` event → shows custom branded prompt → on accept, calls `event.prompt()`.
- **iOS Safari:** detects iOS, shows instruction card "點擊分享按鈕 → 加入主畫面" / "Share → Add to Home Screen" (since iOS doesn't expose `beforeinstallprompt`).
- **Dismissal persistence:** localStorage flag so dismissed users don't see it again for 30 days.

## Pre-requisites

- **Module 4.1 (manifest) + 4.2 (SW) merged** — install prompt only meaningful with valid PWA setup.
- **Module 4.3 + 4.4 (push) ideally merged** — they share the post-install "now enable notifications" CTA.
- **Wave 1 Module 1.4 (PostHog) merged** — install acceptance/dismissal events go to PostHog for funnel analysis.
- No active work in `client/src/components/` from sibling modules during dispatch.

## Inputs (read these before executing)

- `client/src/pages/TourDetailPeony.tsx` (or `client/src/pages/TourDetailPeony/index.tsx` post-Wave-2-split) — the page that counts toward 3-view trigger. Need a hook into the route mount.
- `client/src/_core/analytics.ts` (created in Wave 1 Module 1.4) — PostHog wrapper. We log `pwa_install_prompt_shown` / `pwa_install_accepted` / `pwa_install_dismissed`.
- `client/src/i18n/zh-TW.ts` + `en.ts` — need ~8 install-prompt strings.
- `CLAUDE.md` §2.1 (rounded corners) + §2.2 (teal `#0D9488`) — prompt visual styling.
- Optional: `client/src/_core/hooks/usePushSubscription.ts` (Module 4.3) — chain `isStandalone` detection: if already installed, skip prompt entirely.

## Scope (what this module owns)

- ✅ `client/src/_core/hooks/useInstallPrompt.ts` — NEW hook capturing `beforeinstallprompt` event + tracking view count via localStorage + PostHog instrumentation.
- ✅ `client/src/components/PWAInstallPrompt.tsx` — NEW prompt UI: 2 variants (Android: branded button; iOS: instruction card). Mount from `client/src/main.tsx` (or `App.tsx` route layout).
- ✅ Tour-detail page tracking: bump the `pwaTourViewCount` localStorage counter on each `TourDetailPeony` mount.
- ✅ i18n keys (8 strings) for prompt UI.
- ✅ Vitest covering hook behavior.
- ❌ NOT in scope: any change to the SW itself, push subscription flow (chained via 4.3), iOS-specific manifest tweaks (handled in 4.1).

## Procedure

1. **Read all inputs** (TourDetailPeony entry post-Wave-2 split, analytics.ts, hooks dir for patterns).

2. **`client/src/_core/hooks/useInstallPrompt.ts`:**
   ```ts
   import { useEffect, useState } from 'react';
   import { trackEvent } from '../analytics';

   const STORAGE_KEY = {
     viewCount: 'pwaTourViewCount',
     dismissedAt: 'pwaInstallPromptDismissedAt',
   };
   const VIEW_THRESHOLD = 3;
   const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d

   interface BeforeInstallPromptEvent extends Event {
     prompt: () => Promise<void>;
     userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
   }

   export function useInstallPrompt() {
     const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
     const [shouldShow, setShouldShow] = useState(false);
     const [platform, setPlatform] = useState<'ios' | 'android' | 'other'>('other');

     useEffect(() => {
       const ua = navigator.userAgent;
       const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
       const isStandalone =
         (window.navigator as any).standalone === true ||
         window.matchMedia('(display-mode: standalone)').matches;

       if (isStandalone) {
         setShouldShow(false);
         return;
       }

       setPlatform(isIOS ? 'ios' : /Android/.test(ua) ? 'android' : 'other');

       // Dismissal TTL check
       const dismissedAt = Number(localStorage.getItem(STORAGE_KEY.dismissedAt) ?? '0');
       if (Date.now() - dismissedAt < DISMISS_TTL_MS) {
         setShouldShow(false);
         return;
       }

       const viewCount = Number(localStorage.getItem(STORAGE_KEY.viewCount) ?? '0');
       if (viewCount < VIEW_THRESHOLD) return;

       // Android/Chrome — wait for beforeinstallprompt
       if (!isIOS) {
         const handler = (e: Event) => {
           e.preventDefault();
           setDeferredPrompt(e as BeforeInstallPromptEvent);
           setShouldShow(true);
           trackEvent('pwa_install_prompt_shown', { platform: 'android' });
         };
         window.addEventListener('beforeinstallprompt', handler);
         return () => window.removeEventListener('beforeinstallprompt', handler);
       }

       // iOS — no event; just show our instruction card
       setShouldShow(true);
       trackEvent('pwa_install_prompt_shown', { platform: 'ios' });
     }, []);

     const accept = async () => {
       if (deferredPrompt) {
         await deferredPrompt.prompt();
         const { outcome } = await deferredPrompt.userChoice;
         trackEvent(outcome === 'accepted' ? 'pwa_install_accepted' : 'pwa_install_dismissed', { platform });
         setDeferredPrompt(null);
         setShouldShow(false);
       } else if (platform === 'ios') {
         // iOS has no programmatic accept — user follows Share menu manually.
         // We just dismiss the card and trust the user.
         dismiss(false); // false = not "no thanks"; treat as acknowledged
         trackEvent('pwa_install_ios_dismissed', { platform: 'ios' });
       }
     };

     const dismiss = (recordTtl = true) => {
       if (recordTtl) localStorage.setItem(STORAGE_KEY.dismissedAt, String(Date.now()));
       setShouldShow(false);
       trackEvent('pwa_install_dismissed', { platform });
     };

     return { shouldShow, platform, accept, dismiss };
   }

   /** Call from TourDetailPeony mount. Idempotent per mount. */
   export function recordTourView() {
     const current = Number(localStorage.getItem(STORAGE_KEY.viewCount) ?? '0');
     localStorage.setItem(STORAGE_KEY.viewCount, String(current + 1));
   }
   ```

3. **Wire `recordTourView()` into TourDetailPeony:**
   In `client/src/pages/TourDetailPeony/index.tsx` (post-Wave-2 split), inside the component's first `useEffect`:
   ```ts
   import { recordTourView } from '@/_core/hooks/useInstallPrompt';
   // ...
   useEffect(() => { recordTourView(); }, [tour?.id]);
   ```
   Trigger key on `tour?.id` so navigation between tours counts each view.

4. **`client/src/components/PWAInstallPrompt.tsx`:**
   ```tsx
   import { useInstallPrompt } from '@/_core/hooks/useInstallPrompt';
   import { useTranslation } from '@/_core/hooks/useTranslation';
   import { Button } from '@/components/ui/button';
   import { X, Share, Plus } from 'lucide-react';

   export function PWAInstallPrompt() {
     const { t } = useTranslation();
     const { shouldShow, platform, accept, dismiss } = useInstallPrompt();
     if (!shouldShow) return null;

     return (
       <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md rounded-xl bg-white shadow-xl border border-gray-200 p-4">
         <button onClick={() => dismiss(true)} className="absolute top-2 right-2 p-1 rounded-md hover:bg-gray-100" aria-label="close">
           <X className="w-4 h-4 text-gray-500" />
         </button>
         <div className="flex items-start gap-3">
           <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center text-white font-bold flex-shrink-0">P</div>
           <div className="flex-1">
             <p className="font-semibold text-sm mb-1">{t('pwa.install.title')}</p>
             {platform === 'ios' ? (
               <p className="text-sm text-gray-600">
                 {t('pwa.install.iosStep1')} <Share className="inline w-4 h-4 mx-0.5" /> {t('pwa.install.iosStep2')} <Plus className="inline w-4 h-4 mx-0.5" />
               </p>
             ) : (
               <p className="text-sm text-gray-600">{t('pwa.install.androidBody')}</p>
             )}
             <div className="flex gap-2 mt-3">
               <Button onClick={accept} className="rounded-lg" size="sm">
                 {platform === 'ios' ? t('pwa.install.gotIt') : t('pwa.install.installNow')}
               </Button>
               <Button variant="ghost" onClick={() => dismiss(true)} className="rounded-lg" size="sm">
                 {t('pwa.install.notNow')}
               </Button>
             </div>
           </div>
         </div>
       </div>
     );
   }
   ```

   **CLAUDE.md §2.1 compliance:**
   - `rounded-xl` on the outer card ✅
   - `rounded-xl` on the logo box ✅
   - `rounded-lg` on buttons ✅
   - `rounded-md` on close-button hover area ✅
   - Teal `bg-teal-600` per §2.2 ✅

5. **Mount in `client/src/main.tsx`:**
   ```tsx
   import { PWAInstallPrompt } from './components/PWAInstallPrompt';
   // ... inside React root:
   <App />
   <PWAUpdatePrompt /> {/* from Module 4.2 */}
   <PWAInstallPrompt /> {/* new */}
   ```

6. **Add i18n keys (8 strings × 2 languages):**
   - `pwa.install.title`: 「將 PACK&GO 加入主畫面」 / "Install PACK&GO"
   - `pwa.install.iosStep1`: 「點擊」 / "Tap"
   - `pwa.install.iosStep2`: 「選擇「加入主畫面」」 / "then 'Add to Home Screen'"
   - `pwa.install.androidBody`: 「離線瀏覽 + 即時行程通知 + 一鍵開啟」 / "Browse offline, get push alerts, one-tap launch"
   - `pwa.install.installNow`: 「立即安裝」 / "Install now"
   - `pwa.install.gotIt`: 「知道了」 / "Got it"
   - `pwa.install.notNow`: 「稍後再說」 / "Not now"
   - `pwa.install.dismissed`: (analytics-only string for PostHog event label, not displayed)

7. **Smoke (Jeff-side, post-deploy staging):**
   - Open staging on Android Chrome → view 3 different tour pages → install prompt should appear within 1s of the 3rd view.
   - Open on iPhone Safari → view 3 tours → iOS instruction card appears.
   - Click "Not now" → reopen page → prompt does NOT reappear (30-day suppression).
   - Clear localStorage → repeat → prompt should reappear after 3rd view.

## Acceptance Criteria

- [ ] `client/src/_core/hooks/useInstallPrompt.ts` exports `useInstallPrompt()` + `recordTourView()`.
- [ ] `client/src/components/PWAInstallPrompt.tsx` mounts globally from `main.tsx`.
- [ ] `recordTourView()` called from `TourDetailPeony/index.tsx` (post-Wave-2 split target).
- [ ] All UI classes pass CLAUDE.md §2.1 rounded-corner audit (`rounded-xl` card, `rounded-lg` buttons, `rounded-md` close).
- [ ] 8 i18n keys added in `zh-TW.ts` + `en.ts`.
- [ ] PostHog events fire: `pwa_install_prompt_shown`, `pwa_install_accepted`, `pwa_install_dismissed`, `pwa_install_ios_dismissed`.
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] **Tests:** `client/src/_core/hooks/useInstallPrompt.test.ts` — 4 cases per CLAUDE.md §九:
  - (a) view count < 3 → `shouldShow: false`.
  - (b) standalone mode (already installed) → `shouldShow: false`.
  - (c) Android + 3 views + `beforeinstallprompt` event → `shouldShow: true`, `platform: 'android'`.
  - (d) iOS + 3 views → `shouldShow: true`, `platform: 'ios'`.
- [ ] Manual smoke: 3-view trigger on staging Android Chrome.
- [ ] Manual smoke: 3-view trigger on staging iOS Safari.
- [ ] Manual: dismiss → reopen → no re-show within 30 days.
- [ ] No regression in existing `pnpm test` pass count.

## Deliverable

- New: `client/src/_core/hooks/useInstallPrompt.ts`, `client/src/_core/hooks/useInstallPrompt.test.ts`, `client/src/components/PWAInstallPrompt.tsx`
- Modified: `client/src/main.tsx`, `client/src/pages/TourDetailPeony/index.tsx` (post-Wave-2), `client/src/i18n/zh-TW.ts`, `client/src/i18n/en.ts`

**Commit message:**

```
feat(pwa): Wave 4 module 4.5 — install prompt after 3 tour views

- useInstallPrompt hook: localStorage view counter, beforeinstallprompt
  capture (Android/Chrome), iOS instruction-card branch
- PWAInstallPrompt component: branded card, dismiss-TTL 30d
- recordTourView() wired in TourDetailPeony mount
- 8 i18n keys; PostHog events for install funnel
- 4 Vitest cases on hook (threshold, standalone, Android happy, iOS happy)
- CLAUDE.md §2.1 rounded-corner compliance verified

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.5
```

## Rollback

- Single revert removes hook + component + TourDetailPeony wiring + i18n keys.
- localStorage keys (`pwaTourViewCount`, `pwaInstallPromptDismissedAt`) remain on user devices but are harmless orphans.
- No DB / network / migration touched.

## Manual intervention

- **Jeff:** approve final copy in `pwa.install.*` keys (8 strings) — 5 min. Especially the marketing line "離線瀏覽 + 即時行程通知 + 一鍵開啟" — does it convince Jeff's audience?
- **Jeff:** post-deploy 3-view smoke on his iPhone Safari + an Android device (or simulator) — 10 min.
- **Jeff:** verify PostHog dashboard receives `pwa_install_prompt_shown` events the day after deploy — 2 min.

## Test plan

**Vitest:** `client/src/_core/hooks/useInstallPrompt.test.ts` — 4 cases (mock `localStorage`, `window.matchMedia`, `navigator.userAgent`, `trackEvent`):

1. **Below threshold:** `localStorage.viewCount = '2'` → render hook → `shouldShow: false`.
2. **Already installed (standalone):** mock `display-mode: standalone` matches → `shouldShow: false`.
3. **Android + 3 views + beforeinstallprompt:** mock UA = Android, viewCount=3, dispatch `beforeinstallprompt` event → `shouldShow: true`, `platform: 'android'`.
4. **iOS + 3 views:** mock UA = iPhone, viewCount=3 → `shouldShow: true`, `platform: 'ios'`.

Optional 5th case: dismiss within TTL window → reload → `shouldShow: false`.

**Regression anchor:** existing `pnpm test` count unchanged + 4 new cases.

**Manual smoke (Jeff-side, staging):**
- Chrome Android: 3 tours → prompt → click "Install" → Android system prompt → confirm → app installs.
- iPhone Safari: 3 tours → iOS card → manually do Share → Add to Home Screen → app launches standalone.
- Dismiss flow: click X → re-visit → no re-show.

## Decisions needed (Jeff)

1. **View threshold (3)** — recommended per v2-plan. Could go higher (5) for less aggressiveness or lower (1) for max conversion. Lock before Procedure step 2.
2. **Dismiss TTL (30 days)** — vs 7 days (Jeff's audience revisits weekly) vs forever (one-and-done). Lock.
3. **Bottom-center vs bottom-right placement** — current is bottom-center (mobile-friendly thumb zone). If competing with the Module 4.2 update prompt (bottom-right), consider visual hierarchy — recommend install at bottom-center, update at bottom-right; they should never coexist (update prompt is rare).
4. **Post-install push CTA** — after the user installs, optionally chain a "now enable notifications" subscribe prompt (Module 4.3 hook). Recommend defer to v3; Module 4.4 push events still work for users who manually subscribe via account settings.
