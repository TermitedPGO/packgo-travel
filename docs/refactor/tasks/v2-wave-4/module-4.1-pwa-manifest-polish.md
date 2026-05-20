# v2 · Wave 4 · Module 4.1 — PWA manifest.json polish + icon set

> 📊 **Wave 4 scope update 2026-05-19:** RN admin app (Modules 4.7-4.15) deferred to v3. Wave 4 v2 scope is now **L1 PWA (6 modules) + Polish (12 modules) = 18 modules ~127h** (down from original 27 modules / 227h).

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L1 — Customer PWA, §Module 4.1)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain) + §E (UI/UX polish, accessibility coverage)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 4 h AI + 30 min Jeff review (theme-color decision + visual icon QA)
**Deploy window:** any weekday morning (customer-facing surface — verify install-to-home-screen flow post-deploy)

## Goal

Bring `client/public/manifest.json` and the iOS-specific tags in `client/index.html` to "Lighthouse PWA installable" baseline so Module 4.6 (Lighthouse gate) can pass. Specifically: reconcile the `theme_color` (currently `#111111` in manifest vs CLAUDE.md §2.2 brand-teal `#0D9488`), generate a proper PWA icon set at 192×192 / 512×512 / 180×180 (apple-touch-icon) instead of reusing the single `/images/logo-bag-black-v3.png` for every size, and verify `scope` / `start_url` / `display` already meet manifest spec.

This module is **the lightest in Wave 4** and is the entry point — it unblocks Module 4.2 (service worker) and 4.6 (Lighthouse gate).

## Pre-requisites

- Wave 1 complete (Sentry + PostHog wired so PWA install events can be tracked).
- Wave 3 ideally complete (this module is content-only, but waiting for autonomy work avoids merge churn on `client/index.html`).
- Phase 5B + earlier completed (no v1 admin tab work touching `manifest.json`).

## Inputs (read these before executing)

- `client/public/manifest.json` (57 LOC — current state) — 3 icon entries all pointing at the same source PNG, theme_color `#111111`, scope/start_url correct already.
- `client/index.html` (100 LOC) — verify existing `<link rel="apple-touch-icon">` tags + viewport meta. Round 81 added iOS Add-to-Home-Screen tags per audit note.
- `CLAUDE.md` §2.2 — brand color spec: `--primary: #0D9488` (teal-600). This is the **intended** theme_color.
- `client/public/images/` directory — confirm what logo assets already exist (the existing manifest references `/images/logo-bag-black-v3.png`).
- Sample reference: Apple's HIG for App Icons (apple-touch-icon must be square, non-transparent, 180×180 is the modern iOS size).

## Scope (what this module owns)

- ✅ `client/public/manifest.json` — edit `theme_color`, replace icon array with 3 distinct sized assets, verify `categories` + `shortcuts` accurate.
- ✅ `client/public/images/pwa/` — new directory with 5 icon files (see Procedure step 2).
- ✅ `client/index.html` — verify/add `<link rel="apple-touch-icon" sizes="180x180" href="/images/pwa/apple-touch-icon-180.png">`, `<link rel="manifest" href="/manifest.json">`, `<meta name="theme-color" content="<final color>">`. Reconcile with existing tags (don't duplicate).
- ❌ NOT in scope: service worker registration (Module 4.2), install prompt UI (Module 4.5), Lighthouse CI step (Module 4.6).

## Procedure

1. **Read `client/public/manifest.json`, `client/index.html`, and `client/public/images/` directory listing.** Identify the canonical source logo currently in use (`logo-bag-black-v3.png` per current manifest).

2. **Generate 5 icon files in `client/public/images/pwa/`:**
   - `icon-192.png` — 192×192, PWA standard small icon (Android home screen)
   - `icon-512.png` — 512×512, PWA standard large icon (Android splash + share)
   - `icon-512-maskable.png` — 512×512, with 10% safe-zone padding for Android adaptive icons (`purpose: "maskable"`)
   - `apple-touch-icon-180.png` — 180×180, non-transparent (iOS rejects transparent), no rounded corners (iOS applies its own mask)
   - `apple-touch-icon-1024.png` — 1024×1024, App Store / iOS sharing fallback

   **Generation approach:** if the source logo is SVG, use `sharp` (already a server dep) to rasterize. If only PNG exists, upscale carefully or escalate to Jeff for higher-res source.

   **CRITICAL constraint:** all 5 icons must be **square** with the brand mark centered, white or brand-teal background (NOT transparent for iOS). Per CLAUDE.md §2.1 rounded-corner rule: do **not** pre-round the icons — iOS and Android apply OS-native masking. We provide square assets only.

3. **Edit `client/public/manifest.json`:**
   - **DECISION (Jeff lock):** `theme_color` — manifest currently `#111111` (near-black), CLAUDE.md §2.2 brand is teal `#0D9488`. **Recommendation:** use teal `#0D9488` to match the splash screen and address-bar UI on Android Chrome, matching the brand identity. The black appears to be a Round 81 stop-gap, not a deliberate brand choice.
   - Replace the 3-entry `icons` array with 4 entries pointing at the new `/images/pwa/*` assets (192, 512, 512-maskable with `purpose: "maskable"`, plus reserve the existing 1024 reference if iOS needs it via apple-touch-icon).
   - Verify `start_url`, `scope`, `display`, `display_override`, `orientation`, `lang`, `categories` already correct → no change.
   - Verify `shortcuts` array still relevant — three entries already exist (Admin, OpsAgent, Search). Leave verbatim.

4. **Edit `client/index.html`:**
   - Confirm `<link rel="manifest" href="/manifest.json">` exists. If not, add inside `<head>`.
   - Verify or add: `<link rel="apple-touch-icon" sizes="180x180" href="/images/pwa/apple-touch-icon-180.png">`.
   - Verify or add: `<meta name="theme-color" content="#0D9488">` (or whatever Jeff locks). NOTE: this meta tag is read by iOS Safari (status bar color) and Android Chrome (address bar). Must match manifest value.
   - Verify or add: `<meta name="apple-mobile-web-app-capable" content="yes">` (iOS standalone mode).
   - Verify or add: `<meta name="apple-mobile-web-app-status-bar-style" content="default">` (or `black-translucent`, decide based on whether content goes under the notch — `default` is safer).
   - Verify or add: `<meta name="apple-mobile-web-app-title" content="PACK&GO">`.
   - **Do not duplicate.** Round 81 may have added some of these already — read carefully.

5. **Verify dev-server serves manifest with `Content-Type: application/manifest+json`:**
   ```bash
   pnpm dev
   curl -I http://localhost:3000/manifest.json | grep -i content-type
   ```
   Vite by default serves `.json` as `application/json`, which works but is not strictly correct. If Vite doesn't auto-correct, leave a TODO comment in this module's commit body — `vite-plugin-pwa` in Module 4.2 will handle the MIME type properly.

6. **Manual smoke (Jeff-side, post-deploy):**
   - Open staging URL on iPhone Safari → Share → Add to Home Screen → verify icon is the new 180×180, name shows "PACK&GO", launches in standalone mode (no Safari chrome).
   - Open on Android Chrome → tap menu → "Install app" → verify icon + name + launch behavior.

## Acceptance Criteria

- [ ] `client/public/manifest.json` `theme_color` reconciled (locked decision: teal `#0D9488` per recommendation, OR Jeff-overridden value).
- [ ] `client/public/images/pwa/` contains 5 icon files (192, 512, 512-maskable, 180-apple, 1024-apple).
- [ ] Manifest `icons` array has 4 entries (192, 512 any, 512 maskable, and apple-touch fallback or omitted if covered by `<link>`).
- [ ] `client/index.html` `<head>` contains: `<link rel="manifest">`, `<link rel="apple-touch-icon" sizes="180x180">`, `<meta name="theme-color">`, `<meta name="apple-mobile-web-app-capable">`, `<meta name="apple-mobile-web-app-title">`. No duplicates.
- [ ] `pnpm tsc --noEmit` exit 0 (config-only changes — should be uneventful).
- [ ] `pnpm build` succeeds; verify `dist/public/manifest.json` is a copy of the edited file and `dist/public/images/pwa/*` files are present in the build output.
- [ ] **Test:** new Vitest in `client/src/_core/manifest.test.ts` — parses `manifest.json` (via `import.meta.glob` or filesystem read), asserts: `theme_color === '#0D9488'`, `display === 'standalone'`, `start_url === '/'`, `scope === '/'`, all `icons[].src` strings begin with `/images/pwa/`. **Required per CLAUDE.md §九.**
- [ ] Manual: Jeff installs on iPhone + Android, sees new icon, verifies "feels installed" (standalone mode, branded splash).

## Deliverable

- New: `client/public/images/pwa/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon-180.png`, `apple-touch-icon-1024.png`
- New: `client/src/_core/manifest.test.ts`
- Modified: `client/public/manifest.json`, `client/index.html`

**Commit message:**

```
feat(pwa): Wave 4 module 4.1 — manifest + icon set polish

- Generate 5 distinct PWA icon assets (192/512/512-maskable/180-apple/1024)
  replacing the single all-purpose logo-bag-black-v3.png reference
- Reconcile theme_color to brand teal #0D9488 (was #111111 stop-gap)
- Add iOS-specific meta tags + apple-touch-icon link in client/index.html
- Vitest validates manifest shape for regression catch on future edits

Unblocks: Module 4.2 (service worker via vite-plugin-pwa needs valid manifest),
Module 4.6 (Lighthouse PWA gate).

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.1
```

## Rollback

- Single revert restores prior manifest + index.html (no DB / migration touched).
- Icon files are new — leaving them in place is harmless; old logo path stops being referenced after revert.
- Customer-facing risk: minor — worst case the install prompt shows wrong icon for ~1 hour until revert deploys.

## Manual intervention

- **Jeff:** approve `theme_color` decision (teal `#0D9488` recommended) — 5 min.
- **Jeff:** visual QA on the 5 generated icons before commit — confirm logo is centered, no clipping, brand-accurate at small sizes — 10 min.
- **Jeff:** post-deploy iPhone Safari + Android Chrome install test — 10 min.

## Test plan

**New Vitest:** `client/src/_core/manifest.test.ts` — 5 assertions on parsed manifest.json. Mock-free; reads the file directly.

**Regression anchor:** existing `pnpm test` pass count unchanged.

**Manual smoke (pre-deploy):**
- `pnpm dev` → open in Chrome → DevTools → Application tab → Manifest → no errors, icons render in preview pane.
- Lighthouse PWA category in DevTools → score not regressed from baseline (full ≥90 gate is Module 4.6).

## Decisions needed (Jeff)

1. **theme_color final value** — recommend `#0D9488` (brand teal per CLAUDE.md §2.2). If Jeff prefers something darker for status-bar contrast on dark wallpapers, consider `#0F766E` (teal-700). Lock before Procedure step 3.
2. **Maskable icon safe zone** — recommend 10% padding around the logo so Android's adaptive-icon mask doesn't crop the bag. If Jeff has a designer-prepared maskable version, swap in.
