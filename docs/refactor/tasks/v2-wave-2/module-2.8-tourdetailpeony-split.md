# v2 · Wave 2 · Module 2.8 — Split `client/src/pages/TourDetailPeony.tsx` (3,827 → 9 files)

**Parent plan:** docs/refactor/v2-plan.md (Wave 2 · Module 2.2)
**Audit ref:** v2-audit-2026-05-19.md §C lines 162-183 (TourDetailPeony seam analysis); v2-plan.md lines 157-173
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO (parallelize-safe after Module 2.7)
**Est. effort:** 18-22 h AI + 1 h Jeff (visual diff smoke)
**Risk tier:** **HIGH** — customer-facing page. Pixel drift possible. No db.ts dependency so can parallelize with masterAgent split.
**Deploy window:** Tue/Wed morning + Jeff available for visual smoke same-day.

> **CRITICAL SEQUENCING:** Starts ONLY after Module 2.1 (db.ts split parent) is fully complete via Module 2.7. May run in parallel with Module 2.9 (masterAgent) and Module 2.10 (agentRouter). MUST be committed before next Wave 2 module that touches client-side tour rendering.

## Goal

Split `client/src/pages/TourDetailPeony.tsx` (3,827 LOC) into 9 files under `client/src/pages/TourDetailPeony/`:

1. `index.tsx` — orchestrator (props + section refs + composition), target ≤400 LOC
2. `HeroSection.tsx` — sticky nav + hero image + price card, ~350 LOC
3. `OverviewSection.tsx` — overview content + price comparison widget, ~350 LOC
4. `RouteMapSection.tsx` — thin wrapper, ~30 LOC
5. `ItinerarySection.tsx` — daily itinerary, ~100 LOC
6. `FeaturesSection.tsx` — highlights + includes, ~120 LOC
7. `HotelsSection.tsx` — hotels list, ~50 LOC
8. `PricingSection.tsx` — departure table + price, ~150 LOC
9. `NotesSection.tsx` — policies + cancel + faq, ~350 LOC
10. `helpers.ts` — `parseDailyItinerary`, `getThemeColor`, `PriceComparisonWidget`, transport icon mapping, useMemo hooks (the 2,425 LOC of helpers above section blocks), ~600 LOC

**Total: 10 files, each ≤600 LOC. Customer-side `import TourDetailPeony from "@/pages/TourDetailPeony"` resolves to the new `index.tsx` so call sites stay unchanged.**

## Pre-requisites

- Module 2.7 committed (db.ts split done, parent Module 2.1 complete)
- Wave 1 Module 1.5 committed (Admin code-split landed; same React.lazy() pattern available for re-use)
- Working tree clean
- `pnpm tsc --noEmit` exit 0
- Wave 4 Playwright NOT yet landed (it's the verification gate for this split — schedule visual regression test in Module 4.16). For now: manual smoke is the gate.

## Inputs (read these before executing)

1. **`client/src/pages/TourDetailPeony.tsx`** — 3,827 LOC. Full read required (don't trust line numbers; file may have shifted since v2-audit).
2. **v2-audit-2026-05-19.md §C lines 164-176** — seam analysis table with section line ranges (Hero 2426-2772, Overview 2773-3127, RouteMap 3128-3140, Itinerary 3141-3222, Features 3223-3328, Hotels 3329-3356, Pricing 3357-3484, Notes 3485-3827).
3. **`client/src/components/tour-detail/`** — existing subdirectory with already-extracted helpers (TourRouteMapSvg, etc.). The new section files may reuse some.
4. **`client/src/App.tsx`** — confirm import path of `TourDetailPeony`. Likely `import TourDetailPeony from "./pages/TourDetailPeony"` which will resolve to `./pages/TourDetailPeony/index.tsx` after the split.
5. **`docs/refactor/tasks/phase-5/module-5B-admintabs.md`** — pattern reference: AutonomousAgentsTab 2078 LOC split into 73-LOC orchestrator + 11 sub-views. **The same Pass A/B/C pattern applies here.**
6. **CLAUDE.md §2.1** — rounded class requirements (every `<img>` in extracted sections must keep `rounded-xl`).
7. **CLAUDE.md §3.1** — Wouter routing (this page is hit via `/tour/:id`); confirm router config doesn't change.

## Scope (what this module owns)

### Directory structure to create

```
client/src/pages/TourDetailPeony/
├── index.tsx              ≤400 LOC  — orchestrator
├── HeroSection.tsx        ≤400 LOC
├── OverviewSection.tsx    ≤400 LOC
├── RouteMapSection.tsx    ≤50 LOC
├── ItinerarySection.tsx   ≤150 LOC
├── FeaturesSection.tsx    ≤200 LOC
├── HotelsSection.tsx      ≤100 LOC
├── PricingSection.tsx     ≤200 LOC
├── NotesSection.tsx       ≤400 LOC
└── helpers.ts             ≤600 LOC (parsing + theme + widgets)
```

### Section seams (per v2-audit §C)

| Section | Source line range (audit-snapshot) | Target file | Approx LOC |
|---|---|---|---|
| Hero / sticky nav | 2426-2772 | HeroSection.tsx | 346 |
| Overview | 2773-3127 | OverviewSection.tsx | 354 |
| RouteMap (wrapper) | 3128-3140 | RouteMapSection.tsx | 12 |
| Itinerary | 3141-3222 | ItinerarySection.tsx | 81 |
| Features | 3223-3328 | FeaturesSection.tsx | 105 |
| Hotels | 3329-3356 | HotelsSection.tsx | 27 |
| Pricing | 3357-3484 | PricingSection.tsx | 127 |
| Notes | 3485-3827 | NotesSection.tsx | 342 |

Pre-section content (lines 1-2425):
- Imports + types + props (lines 1-150)
- Helper functions: `parseDailyItinerary`, `getThemeColor`, transport icon mapping
- Sub-component: `PriceComparisonWidget`
- useState + useEffect hooks + sectionRefs setup + scroll handling

→ `helpers.ts` (pure functions + small components) + `index.tsx` (props + state + render orchestration).

### Critical preservation requirements

1. **`sectionRefs.<key>`** — sticky-nav scroll anchors. Each section receives its `ref` as a prop from the orchestrator: `<HeroSection sectionRef={sectionRefs.hero} />` etc.
2. **Theme color** — `getThemeColor(tour.destination)` result threads through every section (border accents, button color). Either:
   - Pass `themeColor` as a prop down to every section, OR
   - Use React Context (`<TourDetailContext.Provider value={{ theme, tour }}>`)
3. **i18n keys** — every `t('...')` call must work in both `zh-TW` and `en`. Confirm via `grep -nE "t\(" client/src/pages/TourDetailPeony.tsx` count matches the new section files' total.
4. **Round 80.20 comment** at the routemap section ("Round 80.20: wrapped in `<section id='routemap'>` with sectionRefs") — preserve.

### Out of scope

- **i18n leak cleanup** (the 42 leaks per audit §D line 241) — Module 3.12 owns those. This module just preserves them as-is.
- **Adding section-level code splitting** (per v2-plan.md line 170 "Code-split each section via React.lazy()") — defer to Wave 4 (Module 4.5 Lighthouse work). Initial split is import-static.
- **Visual redesign of any section** — pure file split.
- **Fixing the (tour as any) cast pattern** — preserve verbatim. v3 typing cleanup.

## Procedure

### Step 1 — Pre-extraction inventory

```bash
cd /Users/jeff/Desktop/網站
wc -l client/src/pages/TourDetailPeony.tsx
grep -nE "section ref={sectionRefs\." client/src/pages/TourDetailPeony.tsx
grep -nE "^(function|const) [A-Z]" client/src/pages/TourDetailPeony.tsx | head -30
grep -nE "useState|useEffect|useMemo|useRef" client/src/pages/TourDetailPeony.tsx | wc -l
grep -cE "t\(" client/src/pages/TourDetailPeony.tsx  # i18n key count for parity check
```

Save the t() count — must match the sum across all new files.

### Step 2 — Extract `helpers.ts` first (pass A — pure functions)

Move from `TourDetailPeony.tsx` to `client/src/pages/TourDetailPeony/helpers.ts`:

- `parseDailyItinerary(itineraryText: string): DailyItem[]` (or similar)
- `getThemeColor(destination: string): ThemeColors`
- `PriceComparisonWidget({ priceComparison })` component (if it's a sub-component, not just data)
- Transport icon mapping object (e.g., `const transportIcons = { plane: Plane, train: Train, ... }`)
- Any other pure helper currently above line 2426

Export each:
```ts
// client/src/pages/TourDetailPeony/helpers.ts
import { Plane, Train, Ship, Bus, Car, ... } from "lucide-react";

export type DailyItem = { /* ... */ };
export function parseDailyItinerary(text: string): DailyItem[] { /* ... */ }

export type ThemeColors = { primary: string; accent: string; bg: string; };
export function getThemeColor(destination: string): ThemeColors { /* ... */ }

export const transportIcons = { /* ... */ };

export function PriceComparisonWidget({ priceComparison }) { /* ... */ }
// etc.
```

### Step 3 — Extract sections (pass B)

For each of 8 sections (Hero/Overview/RouteMap/Itinerary/Features/Hotels/Pricing/Notes):

1. Create `client/src/pages/TourDetailPeony/<SectionName>.tsx`
2. Define the component:
   ```tsx
   import type { Tour, TourDeparture } from "@/types/tour"; // or wherever the type lives
   import type { ThemeColors } from "./helpers";
   import { parseDailyItinerary } from "./helpers";

   export type HeroSectionProps = {
     tour: Tour;
     theme: ThemeColors;
     sectionRef: React.RefObject<HTMLElement>;
     activeSection: string;
     onScrollTo: (key: string) => void;
   };

   export default function HeroSection({ tour, theme, sectionRef, activeSection, onScrollTo }: HeroSectionProps) {
     // ...verbatim JSX from lines 2426-2772
   }
   ```
3. **Preserve every Tailwind class verbatim** — pixel-identical render is the gate.
4. **Preserve every `t('...')` key** — i18n parity matters.

Repeat for all 8 sections. Each section's props depend on which state slices it needs (most need `tour`, `theme`, `sectionRef`; some need callbacks like `onBookClick`).

### Step 4 — Build the orchestrator (`index.tsx`)

```tsx
// client/src/pages/TourDetailPeony/index.tsx
import React, { useEffect, useState, useRef, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { recordTourView } from "@/components/HomeWelcomeBack";
import SimilarTours from "@/components/SimilarTours";
import TourDeparturesTable from "@/components/TourDeparturesTable";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { getThemeColor } from "./helpers";
import HeroSection from "./HeroSection";
import OverviewSection from "./OverviewSection";
import RouteMapSection from "./RouteMapSection";
import ItinerarySection from "./ItinerarySection";
import FeaturesSection from "./FeaturesSection";
import HotelsSection from "./HotelsSection";
import PricingSection from "./PricingSection";
import NotesSection from "./NotesSection";

export default function TourDetailPeony() {
  const [match, params] = useRoute("/tour/:id");
  // ...all useState + useEffect + useRef hooks (preserve verbatim)

  const sectionRefs = {
    hero: useRef<HTMLElement>(null),
    overview: useRef<HTMLElement>(null),
    routemap: useRef<HTMLElement>(null),
    itinerary: useRef<HTMLElement>(null),
    features: useRef<HTMLElement>(null),
    hotels: useRef<HTMLElement>(null),
    pricing: useRef<HTMLElement>(null),
    notes: useRef<HTMLElement>(null),
  };

  const theme = useMemo(() => getThemeColor(tour?.destination ?? ""), [tour?.destination]);

  return (
    <>
      <HeroSection tour={tour} theme={theme} sectionRef={sectionRefs.hero} ... />
      <OverviewSection tour={tour} theme={theme} sectionRef={sectionRefs.overview} ... />
      <RouteMapSection tour={tour} sectionRef={sectionRefs.routemap} />
      <ItinerarySection tour={tour} theme={theme} sectionRef={sectionRefs.itinerary} />
      <FeaturesSection tour={tour} theme={theme} sectionRef={sectionRefs.features} />
      <HotelsSection tour={tour} sectionRef={sectionRefs.hotels} />
      <PricingSection tour={tour} theme={theme} sectionRef={sectionRefs.pricing} />
      <NotesSection tour={tour} theme={theme} sectionRef={sectionRefs.notes} />
      <SimilarTours ... />
      <Dialog ... />
    </>
  );
}
```

Target `index.tsx` LOC ≤400.

### Step 5 — Verify imports + types

```bash
cd /Users/jeff/Desktop/網站
NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
```

Expected: exit 0. If errors, most likely:
- Missing type import in a section file (e.g., `Tour` type) → add from `@/types/tour` or wherever.
- Missing prop in orchestrator passing to section → trace from section's expected props back to orchestrator.

### Step 6 — Add Vitest for helpers

```ts
// client/src/pages/TourDetailPeony/helpers.test.ts
import { describe, it, expect } from "vitest";
import { parseDailyItinerary, getThemeColor } from "./helpers";

describe("TourDetailPeony helpers", () => {
  describe("parseDailyItinerary", () => {
    it("parses a 3-day itinerary into 3 items", () => {
      const text = "Day 1: Arrive\nDay 2: City tour\nDay 3: Depart";
      const result = parseDailyItinerary(text);
      expect(result).toHaveLength(3);
      // Adjust to actual shape — read the function's return type first.
    });

    it("returns empty array for empty input", () => {
      expect(parseDailyItinerary("")).toEqual([]);
    });

    it("handles malformed input gracefully", () => {
      expect(() => parseDailyItinerary("not a daily format")).not.toThrow();
    });
  });

  describe("getThemeColor", () => {
    it("returns theme colors for a known destination", () => {
      const theme = getThemeColor("Japan");
      expect(theme).toHaveProperty("primary");
      expect(theme).toHaveProperty("accent");
    });

    it("returns default theme for unknown destination", () => {
      const theme = getThemeColor("Atlantis");
      expect(theme).toBeDefined();
    });
  });
});
```

### Step 7 — Smoke test (Jeff or supervisor)

```bash
pnpm dev
# Open browser to /tour/<known-tour-id>
# Walk through each section, click each sticky-nav anchor
# Verify scroll lands on the right section
# Verify theme color applied uniformly
# Verify Daily Itinerary text renders + zigzag layout preserved
# Verify "Add to Favorites" works
# Verify "Book Tour" button navigates correctly
```

Take screenshots BEFORE the refactor (HEAD~1) and AFTER (HEAD) for at least 3 different tours — Japan tour (long itinerary), Caribbean cruise (short), Europe (transport-heavy). Visual diff: human-eyeball pixel-identity check. **Wave 4 Playwright snapshot covers this automated; this module relies on manual.**

## Acceptance Criteria

- [ ] `client/src/pages/TourDetailPeony/` directory exists with 10 files (8 sections + index + helpers)
- [ ] `index.tsx` ≤400 LOC
- [ ] Every section file ≤400 LOC (RouteMap ≤50, Hotels ≤100, Itinerary ≤150 — tighter caps for thin sections)
- [ ] `helpers.ts` ≤600 LOC
- [ ] `helpers.test.ts` exists with 3+ Vitest cases on `parseDailyItinerary` + `getThemeColor`
- [ ] `client/src/App.tsx` import path `import TourDetailPeony from "./pages/TourDetailPeony"` resolves to `./pages/TourDetailPeony/index.tsx` (verify by running `pnpm dev` and visiting any tour page)
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression + 3+ new helpers tests pass
- [ ] `pnpm build` succeeds; check `dist/public/assets/` — the TourDetailPeony bundle should split into multiple chunks (Vite auto-code-splits by import boundary)
- [ ] i18n key count parity: `grep -c "t\(" client/src/pages/TourDetailPeony.tsx` (pre-split) === sum of `grep -c "t\(" client/src/pages/TourDetailPeony/*.tsx` (post-split)
- [ ] **Manual visual smoke (Jeff)**: 3 different tour pages render pixel-identically pre/post

## Deliverable

- New directory: `client/src/pages/TourDetailPeony/`
- New files: 10 component files + 1 test file
- Removed file: `client/src/pages/TourDetailPeony.tsx` (3,827 LOC) — replaced by directory
- Modified: none (App.tsx import path unchanged since it resolves to the index.tsx)

**Single squash-merge commit:**

```
refactor(tour-detail): v2 Wave 2 Module 2.8 — split TourDetailPeony 3,827 → 10 files

Closes audit C-priority customer-facing god-file. Page is now 9 section
components + 1 helpers file under client/src/pages/TourDetailPeony/.

- index.tsx orchestrator (≤400 LOC) holds state + section refs
- HeroSection, OverviewSection, RouteMapSection, ItinerarySection,
  FeaturesSection, HotelsSection, PricingSection, NotesSection — each
  ≤400 LOC, render verbatim JSX from the source
- helpers.ts: parseDailyItinerary, getThemeColor, PriceComparisonWidget,
  transport icon mapping (≤600 LOC)
- helpers.test.ts: 3+ Vitest cases on parsing + theme functions

i18n key parity verified (zero leaks added/removed). Sticky-nav refs
threaded via props. App.tsx import path unchanged — resolves to
TourDetailPeony/index.tsx automatically.

DEFERRED (Wave 4):
  - React.lazy() per-section code-split (Module 4.5 Lighthouse work)
  - i18n leak cleanup (42 leaks → Module 3.12)
  - Playwright visual regression test (Module 4.16)
  - (tour as any) typing cleanup (v3 backlog)

Audit ref: v2-audit §C lines 162-183; v2-plan.md Module 2.2.
```

## Rollback

- Single squash-merge → `git revert <SHA>` restores monolith.
- All 10 new files become orphans (App.tsx import path resolves to the restored `TourDetailPeony.tsx` again, not the orphaned directory).
- **Critical regression case:** if Jeff reports any visual diff post-deploy, revert immediately + dispatch new sub-agent to investigate. The page is customer-facing, blast radius = every tour view.

## Manual intervention

- **Jeff (REQUIRED, 1h):** visual diff smoke on 3 distinct tour pages — Japan / cruise / Europe. Take screenshots pre + post; spot-check pixel-identity. Especially:
  - Sticky nav active-section indicator
  - Theme color border + button color
  - Daily itinerary zigzag layout
  - Price comparison widget render
  - All rounded corners (CLAUDE.md §2.1 rules)
- **Supervisor:** confirm i18n key count parity (pre/post grep).
- **Supervisor:** confirm `pnpm build` output — every section file should appear as its own chunk in `dist/public/assets/`.

## Test plan

- 3+ Vitest cases in `helpers.test.ts`
- Full regression run
- **Manual visual smoke (the gate)**: 3 tour pages pixel-identical pre/post
- **Wave 4 Playwright** (Module 4.16) adds automated visual regression — for now, manual is the safety net

## Decisions needed (Jeff)

| # | Decision | Default if Jeff defers |
|---|---|---|
| D2.8-a | Theme color propagation: prop-drill (current plan) vs React Context? | **Prop-drill.** 8 sections × 1 prop is fine; Context overkill for this volume. v3 can refactor. |
| D2.8-b | Should `App.tsx` rewrite the import to be explicit (`./pages/TourDetailPeony/index`) for clarity? | **No.** Module resolver finds index.tsx automatically; explicit path adds noise. |
| D2.8-c | Should the `helpers.ts` extract sit at `client/src/pages/TourDetailPeony/helpers.ts` (local) OR `client/src/components/tour-detail/helpers.ts` (alongside existing TourRouteMapSvg etc.)? | **Local.** Helpers are specific to this page's parsing/theme. If reused later, promote to `components/tour-detail/`. |

**Must be committed before any other module touches `client/src/pages/TourDetailPeony*`.** Can parallelize with Module 2.9 (masterAgent) + 2.10 (agentRouter) + 2.11 (email) + 2.13 (getRouteMap) since those are server-side or distinct client files.
