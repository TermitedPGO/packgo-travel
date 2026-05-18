# Round 80.17 — AI Generate Dialog UI/UX Polish

**Date:** 2026-05-02
**Scope:** `ToursTabAiGenerateDialog.tsx` + `GenerationProgress.tsx`
**Goal:** B&W + Gold (`#c9a563` / `#8a6f3a` / `#FAF8F2`) baseline; clear three-mode segment toggle; polished progress; prominent submit button.

## Changes

### `client/src/components/admin/tours/ToursTabAiGenerateDialog.tsx`

- **Mode segment toggle** — all three modes now share `text-foreground` active state (was `text-[#8a6f3a]` for `pdf_url`). `pdf_url` `<Sparkles>` icon keeps gold tint. Inactive hover: `hover:text-foreground` (was `hover:text-gray-800`).
- **Mode hint card** — unified to `bg-[#FAF8F2] border border-[#c9a563]/30 text-foreground/70` for all three modes (was split: gray for `pdf`/`url`, gold tint for `pdf_url`).
- **PDF dropzone** — upgraded `rounded-lg p-6` → `rounded-xl p-8` per spec; selected state simplified to `bg-[#c9a563]/5` (was `bg-[#c9a563]/10`).
- **URL inputs** — both URL inputs now use the same focus ring `focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40` (was inconsistent: foreground vs `#c9a563`).
- **Submit button** — added `h-10 px-5 disabled:opacity-60`; `<Sparkles>` icon now tinted `text-[#c9a563]` for cohesion with header sparkle.

### `client/src/components/admin/GenerationProgress.tsx`

- **Removed unused `Progress` import** (replaced with inline div-based bar so the fill can use `bg-[#c9a563]`). Also dropped unused `Button` import.
- **Top status row** — running spinner & completed icon both `text-foreground` (was `text-primary` and `text-green-500`); percent label `text-foreground` (was `text-primary`); time muted to `text-foreground/60`.
- **Progress bar** — replaced `<Progress>` with `bg-foreground/10` track + `bg-[#c9a563]` fill.
- **Compact phase chips** — running uses `bg-[#c9a563]/10 text-foreground border border-[#c9a563]/40`; completed uses neutral `bg-foreground/5 border border-foreground/15`; pending `text-foreground/30`. Pulsing dot for running phase: `bg-[#c9a563]`. Failed state retained as red.
- **Skill notification** — `text-amber-*` and `bg-amber-*` swapped for `text-[#c9a563]`, `text-[#8a6f3a]`, `bg-[#FAF8F2] border-[#c9a563]/40`.
- **Expanded phase rows** — removed `bg-primary/*` and green-50 backgrounds; running: `bg-[#c9a563]/5 border border-[#c9a563]/30`; completed: `bg-foreground/[0.03] border border-foreground/10`. Icon containers use foreground/gold tints. Status icons (CheckCircle2) now `text-foreground` for completed (was `text-green-500`); pending `text-foreground/25`.
- **Live preview card** — replaced `bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-100` with `bg-[#FAF8F2] rounded-lg border border-[#c9a563]/30`; `<Package>` icon `text-[#8a6f3a]` (was `text-blue-500`).
- **Expand/collapse footer** — `bg-foreground/[0.04]` (was `bg-gray-100`).

## Behavior Untouched

- Mode switching logic
- PDF upload tRPC flow
- Polling / generation status logic
- Force-regenerate logic

## Verification

- Color violation grep: `text-purple|bg-purple|text-blue-[1-9]|bg-blue-[1-9]|text-amber|bg-amber|text-orange|text-pink|from-blue|to-blue|from-purple|to-purple` — clean on both files.
- Remaining `text-red-*`/`bg-red-*` usage is restricted to error/failure states (per spec).
- Remaining `text-green-*`/`bg-green-*` was removed from chip backgrounds; failure rows keep red.
- `pnpm check` — see CI output.

## Not Done

- No deploy.
- No backend changes.
