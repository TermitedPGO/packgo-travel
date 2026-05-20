# v2 · Wave 2 · Module 2.12 — Split `client/src/components/admin/TourEditDialog.tsx` (2,156 → 7 files)

**Parent plan:** docs/refactor/v2-plan.md (Wave 2 · Module 2.6)
**Audit ref:** v2-audit-2026-05-19.md §C lines 149, 210 (TourEditDialog god-file); v2-plan.md lines 215-222
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO (parallelize-safe after Module 2.7)
**Est. effort:** 10-14 h AI + 30 min Jeff review
**Risk tier:** MEDIUM — admin-only blast radius, but core editor for every tour. Wrong tab state-passing → save flow breaks.
**Deploy window:** any morning, admin tab.

> **IMPORTANT FINDING:** The v2-plan listed 8 tabs but the actual file has **6 tabs**: basic / itinerary / cost / notice / transport / photos (verified via `grep TabsContent` at L460, L962, L1138, L1259, L1402, L1801). This module corrects the v2-plan tab count.

> **CRITICAL SEQUENCING:** Starts ONLY after Module 2.7. Parallelize-safe with 2.8, 2.9, 2.10, 2.11, 2.13.

## Goal

Split `client/src/components/admin/TourEditDialog.tsx` (2,156 LOC) into a thin orchestrator dialog + 6 tab sub-components under `client/src/components/admin/tour-edit/`. State management (the `editedData` draft + dirty flag) lifted to dialog root via context. Each tab is a self-contained form. Public import `import { TourEditDialog } from "@/components/admin/TourEditDialog"` unchanged.

## Pre-requisites

- Module 2.7 committed (db.ts split done)
- Working tree clean
- `pnpm tsc --noEmit` exit 0
- `docs/refactor/tasks/phase-5/module-5B-admintabs.md` — read for the AutonomousAgentsTab 2078→73 LOC orchestrator pattern. Same approach.

## Inputs (read these before executing)

1. **`client/src/components/admin/TourEditDialog.tsx`** — 2,156 LOC. Full read required.
2. **v2-plan.md lines 215-222** — original plan (8 tabs assumed; corrected to 6 below).
3. **Actual tab structure (verified)**:

   | Tab value | Line range | Approx LOC | Description |
   |---|---|---|---|
   | `basic` | 460-961 | 502 | Title, destination, duration, dates, status, featured |
   | `itinerary` | 962-1137 | 176 | Day-by-day itinerary editor |
   | `cost` | 1138-1258 | 121 | Pricing, currency, comparison data |
   | `notice` | 1259-1401 | 143 | Policies, cancellation, FAQ |
   | `transport` | 1402-1800 | 399 | Flight/bus/train details (largest after basic) |
   | `photos` | 1801-2123 | 323 | Image library, hero image, gallery |

4. **`docs/refactor/tasks/phase-5/module-5B-admintabs.md`** — AutonomousAgentsTab Pass A/B/C extraction pattern; this module reuses Pass A/B.
5. **`SaveStatusBadge`** at L2124 — small auxiliary component, extract to its own file or `_shared.tsx`.

## Scope (what this module owns)

### Directory structure

```
client/src/components/admin/tour-edit/
├── BasicInfoTab.tsx       ≤550 LOC (exception — biggest tab, large form)
├── ItineraryTab.tsx       ≤250 LOC
├── CostTab.tsx            ≤200 LOC
├── NoticeTab.tsx          ≤200 LOC
├── TransportTab.tsx       ≤450 LOC (exception)
├── PhotosTab.tsx          ≤400 LOC
├── _shared.tsx            ≤100 LOC — SaveStatusBadge + small helpers
└── context.tsx            ≤100 LOC — TourEditContext provider for state sharing

client/src/components/admin/TourEditDialog.tsx ≤400 LOC — orchestrator + tab shell
```

### Orchestrator contract

```tsx
// client/src/components/admin/TourEditDialog.tsx (post-split)
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

import { TourEditProvider } from "./tour-edit/context";
import { SaveStatusBadge } from "./tour-edit/_shared";
import BasicInfoTab from "./tour-edit/BasicInfoTab";
import ItineraryTab from "./tour-edit/ItineraryTab";
import CostTab from "./tour-edit/CostTab";
import NoticeTab from "./tour-edit/NoticeTab";
import TransportTab from "./tour-edit/TransportTab";
import PhotosTab from "./tour-edit/PhotosTab";

export function TourEditDialog({ tour, open, onOpenChange, onSave }: TourEditDialogProps) {
  const { t } = useTranslation();
  const [editedData, setEditedData] = useState(tour);
  const [activeTab, setActiveTab] = useState("basic");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");

  const updateMutation = trpc.tours.update.useMutation({...});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl rounded-xl">
        <DialogHeader>
          <DialogTitle>{t("tourEditDialog.title")}</DialogTitle>
          <SaveStatusBadge status={saveStatus} />
        </DialogHeader>

        <TourEditProvider value={{ editedData, setEditedData, tour }}>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="basic">{t("tourEditDialog.tabBasic")}</TabsTrigger>
              <TabsTrigger value="itinerary">{t("tourEditDialog.tabItinerary")}</TabsTrigger>
              <TabsTrigger value="cost">{t("tourEditDialog.tabCost")}</TabsTrigger>
              <TabsTrigger value="notice">{t("tourEditDialog.tabNotice")}</TabsTrigger>
              <TabsTrigger value="transport">{t("tourEditDialog.tabTransport")}</TabsTrigger>
              <TabsTrigger value="photos">{t("tourEditDialog.tabPhotos")}</TabsTrigger>
            </TabsList>

            <TabsContent value="basic"><BasicInfoTab /></TabsContent>
            <TabsContent value="itinerary"><ItineraryTab /></TabsContent>
            <TabsContent value="cost"><CostTab /></TabsContent>
            <TabsContent value="notice"><NoticeTab /></TabsContent>
            <TabsContent value="transport"><TransportTab /></TabsContent>
            <TabsContent value="photos"><PhotosTab /></TabsContent>
          </Tabs>
        </TourEditProvider>

        <DialogFooter>
          <Button onClick={() => updateMutation.mutate(editedData)}>{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Context shape

```tsx
// client/src/components/admin/tour-edit/context.tsx
import { createContext, useContext } from "react";
import type { Tour } from "@/types/tour"; // or wherever

type TourEditContextValue = {
  editedData: Tour;
  setEditedData: React.Dispatch<React.SetStateAction<Tour>>;
  tour: Tour; // original for diff/reset
};

const TourEditContext = createContext<TourEditContextValue | null>(null);

export function TourEditProvider({ value, children }: { value: TourEditContextValue; children: React.ReactNode }) {
  return <TourEditContext.Provider value={value}>{children}</TourEditContext.Provider>;
}

export function useTourEdit() {
  const ctx = useContext(TourEditContext);
  if (!ctx) throw new Error("useTourEdit must be inside TourEditProvider");
  return ctx;
}
```

### Tab component pattern

```tsx
// client/src/components/admin/tour-edit/BasicInfoTab.tsx
import { useTranslation } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// ... other imports
import { useTourEdit } from "./context";

export default function BasicInfoTab() {
  const { t } = useTranslation();
  const { editedData, setEditedData } = useTourEdit();

  return (
    <div className="mt-0 space-y-6">
      {/* Verbatim JSX from TourEditDialog.tsx L460-961 */}
    </div>
  );
}
```

### Out of scope

- New form validation (use existing patterns).
- Typing improvements on `editedData` (preserve current shape).
- Wiring per-tab autosave (current save-on-button-click flow preserved).
- Adding new tabs.

## Procedure

### Step 1 — Pre-extraction inventory

```bash
cd /Users/jeff/Desktop/網站
wc -l client/src/components/admin/TourEditDialog.tsx
grep -nE "<TabsContent value=" client/src/components/admin/TourEditDialog.tsx
grep -nE "setEditedData\(" client/src/components/admin/TourEditDialog.tsx | wc -l
grep -cE "t\(" client/src/components/admin/TourEditDialog.tsx
```

Confirm 6 tabs + count of `setEditedData` calls (these distribute across tabs).

### Step 2 — Create context first

`tour-edit/context.tsx` — implement the provider pattern above.

### Step 3 — Extract `_shared.tsx`

- Move `SaveStatusBadge` (L2124) to `_shared.tsx`.
- Move any other small auxiliary component / type used by multiple tabs.

### Step 4 — Extract 6 tabs in order

Recommended order (smallest first to validate context flow):

1. `CostTab.tsx` (L1138-1258, ~121 LOC)
2. `NoticeTab.tsx` (L1259-1401, ~143 LOC)
3. `ItineraryTab.tsx` (L962-1137, ~176 LOC)
4. `PhotosTab.tsx` (L1801-2123, ~323 LOC)
5. `TransportTab.tsx` (L1402-1800, ~399 LOC)
6. `BasicInfoTab.tsx` (L460-961, ~502 LOC)

Per tab:
- Read source range
- Create new file with verbatim JSX wrapped in default export function
- Replace `editedData` / `setEditedData` references with `useTourEdit()` hook
- Verify `pnpm tsc --noEmit` after each tab

### Step 5 — Rewrite orchestrator

Replace `TourEditDialog.tsx` content with the orchestrator template above. Target ≤400 LOC.

### Step 6 — i18n parity

```bash
grep -cE "t\(" client/src/components/admin/TourEditDialog.tsx
# pre: ~250+
# post-split: ~30 (in orchestrator)
# sum across tab files should equal pre-split count
for f in client/src/components/admin/tour-edit/*.tsx; do grep -c "t(" "$f"; done
```

Sum must equal pre-split count.

### Step 7 — Verify

```bash
NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
pnpm test  # regression
pnpm build  # confirm tabs aren't lazy-broken
```

### Step 8 — Smoke

- Boot `pnpm dev`
- Admin → Tours → edit a tour → open dialog
- Click each tab in order; edit a field on each; switch tabs (state should persist via context)
- Click Save → confirm `updateMutation` fires
- Reopen dialog with same tour → confirm saved state shown
- Visually compare each tab to a pre-split screenshot

## Acceptance Criteria

- [ ] `client/src/components/admin/tour-edit/` directory exists with 6 tabs + context + _shared
- [ ] `client/src/components/admin/TourEditDialog.tsx` ≤400 LOC (orchestrator)
- [ ] Each tab file ≤550 LOC (BasicInfo exception); most ≤300
- [ ] `TourEditDialog` import path `@/components/admin/TourEditDialog` unchanged
- [ ] Context-based state passing replaces prop drilling (all tabs use `useTourEdit()`)
- [ ] i18n key parity preserved (sum-grep check passes)
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression
- [ ] **Manual (Jeff)**: edit 1 tour through all 6 tabs, save, reload, confirm changes persisted

## Deliverable

- New: `client/src/components/admin/tour-edit/` with 6 tab files + context.tsx + _shared.tsx
- Modified: `TourEditDialog.tsx` (2,156 → ≤400 LOC)

**Single squash-merge commit:**

```
refactor(admin-tours): v2 Wave 2 Module 2.12 — split TourEditDialog 2,156 → 8 files

Closes audit C-priority admin-side god-file. Editor split per-tab.

- tour-edit/BasicInfoTab.tsx (~502 LOC exception — largest form)
- tour-edit/ItineraryTab.tsx (~176)
- tour-edit/CostTab.tsx (~121)
- tour-edit/NoticeTab.tsx (~143)
- tour-edit/TransportTab.tsx (~399 exception)
- tour-edit/PhotosTab.tsx (~323)
- tour-edit/context.tsx: TourEditContext (editedData + setEditedData)
- tour-edit/_shared.tsx: SaveStatusBadge
- TourEditDialog.tsx: orchestrator ≤400 LOC

State passing via React context (was prop drilling through `editedData` /
`setEditedData` across 2,156 LOC). i18n key parity preserved.

CORRECTION: v2-plan.md listed 8 tabs; actual file has 6 (basic, itinerary,
cost, notice, transport, photos). This module corrects the count.

Audit ref: v2-audit §C; v2-plan.md Module 2.6.
```

## Rollback

- Single squash-merge → `git revert <SHA>` restores monolith.
- Admin-only blast radius. Customer-facing unaffected.

## Manual intervention

- **Jeff (REQUIRED, 30min):** edit 1 tour through all 6 tabs on staging, save, verify persistence. Compare visual to pre-split screenshot for each tab.
- **Supervisor:** verify i18n key count parity.
- **Supervisor:** verify orchestrator LOC ≤400.

## Test plan

- No new Vitest (per Phase 5B precedent — admin-only JSX components are high-cost / low-signal for unit tests)
- Full regression run
- Manual: full tab walk + save round-trip
- **Wave 4 Playwright** (Module 4.16) will add automated regression — for now manual smoke is the gate

## Decisions needed (Jeff)

| # | Decision | Default if Jeff defers |
|---|---|---|
| D2.12-a | Tab count: 6 (verified) vs 8 (v2-plan stale). | **6 (verified).** Correct in commit message. |
| D2.12-b | State management: React Context (current plan) vs prop drilling (existing) vs Zustand/jotai store? | **Context.** Lower-tax than store; just enough indirection to escape prop drilling across 6 tabs. CLAUDE.md §3.1 says no Redux/Zustand. |
| D2.12-c | `BasicInfoTab` ~502 LOC exception — accept OR further split (e.g., `BasicInfoIdentity` + `BasicInfoStatus`)? | **Accept exception.** Single form, no natural seam. v3 can revisit. |
| D2.12-d | Should the orchestrator do per-tab autosave (save on tab switch) or keep save-on-button-click? | **Keep save-on-button.** Behavior preservation; autosave is a v3 UX upgrade. |

**Must be committed before any module touches `client/src/components/admin/TourEditDialog*` or `tour-edit/*`.** Parallelize-safe with 2.8, 2.9, 2.10, 2.11, 2.13.
