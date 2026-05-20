# v2 · Wave 4 · Module 4.19 — `loading="lazy"` sweep + font preload

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Polish, §Module 4.22)
**Audit ref:** v2-audit-2026-05-19.md §H (perf — 14/94 images use lazy loading; no font preload)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 4 h AI + 15 min Jeff review
**Deploy window:** any time — additive HTML attributes; no behavior change beyond load timing

## Goal

Add `loading="lazy"` to all 80 customer-facing `<img>` tags that don't already have it (90% of 94 total per audit §H line 463). Add `<link rel="preload" as="font">` for Noto Serif TC + Inter in `client/index.html` and `font-display: swap` in CSS. Goal: drop tour-detail page LCP by ~300-500ms and reduce font FOIT/FOUT.

## Pre-requisites

- Wave 2 Module 2.2 (TourDetailPeony split) merged — `<img>` tags inside section files are easier to edit.
- Module 4.17 (i18n restructure) merged — keeps file diffs clean.

## Inputs (read these before executing)

- `client/index.html` (100 LOC) — current head.
- `client/src/index.css` — global font CSS; check existing `font-display` declarations.
- Audit script (or grep): `grep -rn '<img' client/src --include="*.tsx" | grep -v "loading=" | wc -l` should show ~80.

## Scope (what this module owns)

- ✅ All `<img>` tags missing `loading="lazy"` get it (except above-the-fold hero images on customer pages — leave eager).
- ✅ `client/index.html` — `<link rel="preload" as="font">` for Noto Serif TC + Inter (the 2 brand fonts).
- ✅ `client/src/index.css` (or wherever fonts are declared) — `font-display: swap`.
- ❌ NOT in scope: image optimization itself (resizing, webp conversion — v3); CDN switch (audit §H mentions R2 absent — v3).

## Procedure

1. **Find all `<img>` tags missing lazy:**
   ```bash
   grep -rn '<img' client/src --include="*.tsx" | grep -v "loading=" > /tmp/imgs.txt
   wc -l /tmp/imgs.txt
   ```
   Expected ~80.

2. **Categorize:**
   - **Above-the-fold hero images** — e.g., `client/src/components/Hero.tsx`, `client/src/pages/Home.tsx` Hero section, TourDetailPeony's HeroSection.tsx. Leave `loading="eager"` (or omit attribute, defaults to eager). Identify ~5-10 candidates.
   - **Everything else** — add `loading="lazy"`.

3. **Edit each file:**
   For each `<img src=... className=...>` add `loading="lazy"` attribute. **Bonus:** ensure all `<img>` ALSO have `decoding="async"` for further perf and `alt=""` for accessibility.

4. **`client/index.html`** — add inside `<head>`:
   ```html
   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap">
   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap">
   ```

   **NOTE:** `display=swap` query param drops FOIT (font fallback shows immediately, swaps when web font loads).

5. **If fonts are self-hosted** (check `client/public/fonts/`):
   ```html
   <link rel="preload" href="/fonts/NotoSerifTC-Bold.woff2" as="font" type="font/woff2" crossorigin>
   <link rel="preload" href="/fonts/Inter-Variable.woff2" as="font" type="font/woff2" crossorigin>
   ```
   And in CSS:
   ```css
   @font-face {
     font-family: 'Noto Serif TC';
     src: url('/fonts/NotoSerifTC-Bold.woff2') format('woff2');
     font-display: swap;
   }
   ```

6. **Verify build output:**
   ```bash
   pnpm build
   grep "loading=\"lazy\"" dist/public/assets/*.js | wc -l
   ```
   Expected: substantially up from baseline.

7. **Lighthouse smoke (will be enforced by Module 4.6 gate):**
   ```bash
   pnpm lighthouse:local
   ```
   Performance score should improve.

## Acceptance Criteria

- [ ] `grep -rn '<img' client/src --include="*.tsx" | grep -v 'loading=' | wc -l` returns ≤10 (hero/AOTF exceptions).
- [ ] All non-hero `<img>` tags have `loading="lazy"` and ideally `decoding="async"`.
- [ ] `client/index.html` has font preload + preconnect tags (or self-hosted `font-preload`).
- [ ] CSS has `font-display: swap` on the 2 brand fonts.
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] `pnpm build` succeeds; bundle size unchanged (-0 to -5 KB; HTML attribute additions don't change JS size meaningfully).
- [ ] Manual: Lighthouse perf score on staging improves by ≥3 points vs pre-module baseline.
- [ ] No regression in `pnpm test`.
- [ ] **Vitest unchanged:** this is pure HTML attribute additions; behavior identical. No new tests needed per CLAUDE.md §九 (no behavioral change).

## Deliverable

- Modified: ~50-70 client files (tsx + index.html + index.css). High file count, low per-file diff.

**Commit message:**

```
perf: Wave 4 module 4.19 — loading="lazy" + font preload sweep

- 80+ <img> tags gain loading="lazy" decoding="async" (hero/AOTF kept eager)
- Font preload + preconnect for Noto Serif TC + Inter
- font-display: swap eliminates FOIT
- Expected: Lighthouse perf +3-5 pts, LCP -300-500ms on tour detail

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.19, audit §H
```

## Rollback

- Single revert removes attributes; reverts to pre-module behavior. No data risk.

## Manual intervention

- **Jeff (~10 min):** post-deploy smoke — open a tour-detail page on a slow connection (Chrome DevTools throttle "Slow 3G") → confirm images don't load all at once, scrollable area progressively loads.
- **Jeff (~3 min):** confirm font rendering: page renders text immediately in fallback font, swaps to Noto Serif TC for headings + Inter for body within ~200ms.

## Test plan

**No new Vitest** — HTML-attribute-only change, no behavior.

**Lighthouse smoke** (Module 4.6 gate enforces post-merge).

**Manual perf check:** Chrome DevTools Network throttle + waterfall — verify images below fold delay until scroll.

## Decisions needed (Jeff)

1. **Hero image exceptions** — which images stay eager? Recommend: home hero, search hero, TourDetailPeony hero. Lock list at Procedure step 2.
2. **Self-hosted vs Google fonts** — currently Google. Self-hosting saves ~80-100ms but adds ~200KB to bundle/CDN bill. Recommend keep Google for v2; revisit v3.
3. **decoding="async" on every image** — recommend yes (no downside on modern browsers). Lock.
