# Round 80.16 — Admin TourEditDialog Brand Baseline Fix

**Date:** 2026-05-02
**File:** `client/src/components/admin/TourEditDialog.tsx` (1829 lines)
**Scope:** Visual / i18n only — no form logic, parsing, or serialization changed.

---

## Background

Jeff's screenshot showed the admin tour-edit dialog (`TourEditDialog`) violating
the PACK&GO brand baseline. The dialog is shown when an admin opens the gear
icon on a tour card in `/admin` and edits AI-generated tour data before
publish.

**Specific violations:**

1. **Title icon purple** (`text-purple-600` on `<Edit />` lucide icon).
2. **"Basic Information" section purple** (`bg-purple-50` + `text-purple-900`).
3. **"Location Information" section blue** (`bg-blue-50` + `text-blue-900`).
4. **"Confirm Save" CTA purple** (`bg-purple-600 hover:bg-purple-700`).
5. **Tab strip flat** — tabs unstyled, no active indicator, no rounding.
6. **Supplier section emerald** + 4 hardcoded Chinese labels (no `t()`).
7. **Daily Itinerary cards green-50**; cost sections orange/red/yellow;
   notice sections blue/purple/green/red; transport sky-50; hero amber-50.
8. **CTA buttons rounded-full** instead of `rounded-lg` per CLAUDE.md.
9. Drag-drop area used `border-blue-400 bg-blue-50` for active state.

The dialog otherwise already used `useLocale()` / `t()` correctly for almost
every label — most i18n keys existed in `zh-TW.ts` / `en.ts`. The only
hardcoded strings were in the supplier section (added in v78l Sprint 4A).

---

## Changes

### 1. Color violations replaced

All non-brand colors swapped for the B&W + Gold palette
(`#c9a563` / `#8a6f3a` / `#FAF8F2` per CLAUDE.md §2.2):

| Before                                   | After                                                                |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `text-purple-600` (title icon)           | `text-[#c9a563]`                                                     |
| `bg-purple-50` / `text-purple-900` (Basic Info)         | `bg-gray-50 border border-gray-200` + neutral section header        |
| `bg-blue-50` / `text-blue-900` (Location Info)          | `bg-gray-50 border border-gray-200` + neutral section header        |
| `bg-emerald-50` (Supplier — highlight)   | `bg-[#c9a563]/8 border border-[#c9a563]/20`                          |
| `bg-amber-50` (Hero — highlight)         | `bg-[#FAF8F2] border border-[#c9a563]/20`                            |
| `bg-green-50` (Daily Itinerary cards)    | `bg-gray-50 border border-gray-200`                                  |
| `bg-orange-50` / `bg-red-50` / `bg-yellow-50` (Cost sections) | `bg-gray-50 border border-gray-200`                              |
| `bg-blue-50` / `bg-purple-50` / `bg-green-50` / `bg-red-50` (Notice sections) | `bg-gray-50 border border-gray-200`             |
| `bg-sky-50` / `text-sky-900` (Transport) | `bg-gray-50 border border-gray-200` + neutral section header        |
| `border-sky-200` / `text-sky-800` (transport sub-cards) | `border-gray-200` + neutral section header                  |
| `border-blue-400 bg-blue-50` (drag active) | `border-[#c9a563] bg-[#FAF8F2]`                                    |
| `bg-purple-600 hover:bg-purple-700` (Confirm CTA) | `bg-foreground text-white hover:bg-foreground/85`            |

`text-red-500` markers on required-field asterisks and `text-red-600` on
trash/delete icons are kept — these are semantic UI signals (required /
destructive) and conform to common UX patterns.

### 2. Section headers refined

All section headers (`<h3>`) refactored from
`font-semibold text-{color}-900` into the brand baseline section-label style:

```tsx
className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 pb-2 border-b border-foreground/5"
```

For gold-highlighted sections (Supplier, Hero), the same template uses
`text-[#8a6f3a]` and `border-[#c9a563]/20`.

### 3. Tab strip styling

`TabsList` upgraded from raw grid to:

- Container: `rounded-lg bg-foreground/5 p-1`
- Each `TabsTrigger`: `rounded-lg data-[state=active]:bg-white
  data-[state=active]:text-foreground data-[state=active]:shadow-sm
  data-[state=active]:border-b-2 data-[state=active]:border-[#c9a563]
  focus-visible:ring-2 focus-visible:ring-foreground/20`

Active tab now has white pill + gold underline; focused tabs use brand ring.

### 4. CTAs / buttons

- All `rounded-full` on Add / outline buttons → `rounded-lg`
- Cancel: `rounded-lg border-gray-300 text-foreground hover:bg-gray-50`
- Confirm Save: `bg-foreground text-white hover:bg-foreground/85 rounded-lg`
- Both have `focus-visible:ring-2 focus-visible:ring-foreground/20`

### 5. Dialog container

- Added `shadow-2xl` (already had `rounded-xl`).
- `DialogDescription` color tightened to `text-foreground/60`.

### 6. Photo cards / drag-drop / hero amber

- Photo cards: `rounded-xl border border-gray-200` (was missing rounding).
- Drag-drop area: `rounded-xl` + brand active state.
- Photo replace overlay: `rounded-lg` chip with foreground text.
- Hero image card: `bg-[#FAF8F2] border border-[#c9a563]/20 rounded-xl`.

### 7. i18n — supplier section

Replaced 4 hardcoded Chinese labels in the supplier section with `t()` calls.
Added 9 new keys to both `client/src/i18n/zh-TW.ts` and
`client/src/i18n/en.ts` under the `tourEditDialog` namespace:

- `supplierSection`
- `supplierSectionHint`
- `supplierName` / `supplierNamePlaceholder`
- `supplierEmail` / `supplierEmailPlaceholder`
- `supplierPhone` / `supplierPhonePlaceholder`
- `supplierNotes` / `supplierNotesPlaceholder`

All other field/tab/section labels were already wired through `t()` and
their keys already existed in both locale files (no new keys required).

---

## Verification

```bash
grep -nE "text-purple|bg-purple|text-blue-[3-9]|bg-blue-[3-9]|text-indigo|text-pink" \
  client/src/components/admin/TourEditDialog.tsx
# → 0 matches
```

`pnpm check` — TypeScript 0 errors (compilation clean).

---

## Files touched

- `client/src/components/admin/TourEditDialog.tsx` — all visual changes
- `client/src/i18n/zh-TW.ts` — added 9 supplier keys
- `client/src/i18n/en.ts` — added 9 supplier keys
- `docs/round-80.16-tour-edit-dialog-fix.md` — this file

No backend / schema / form-logic changes. No fields removed.
No deploy in this round — Jeff will deploy and verify visually from
admin → ToursTab → edit gear icon.
