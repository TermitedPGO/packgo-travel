# Round 80.17 — Admin Departures UI/UX Fix

**Date:** 2026-05-02
**Files:**
- `client/src/components/admin/DeparturesManagement.tsx` (~580 lines)
- `client/src/components/admin/DeparturePreview.tsx` (~410 lines)
- `client/src/i18n/zh-TW.ts` / `client/src/i18n/en.ts` (new keys)

**Scope:** Visual / copy / column layout only. tRPC mutations
(`departures.create|update|delete`, `tours.confirmExtractedDepartures`),
AI extract/import logic, and form parsing are untouched.

---

## Background

Jeff's screenshot of the admin "出發日期管理" dialog showed multiple regressions
against the B&W + Gold brand baseline established in Round 80.16:

1. The 「狀態」 column was so narrow that the chip text 「開放報名」 wrapped
   character-by-character into a vertical column.
2. 「成人價格」 in the column header broke into 「成人價」 + 「格」 — the
   header lacked `whitespace-nowrap`.
3. Currency rendered as `TWD 39,900` because we printed `departure.currency`
   verbatim. Taiwan-Dollar prices should display as `NT$ 39,900`.
4. 「0/26」 looked indistinguishable from 「26/26 — already full」 to the
   admin. There was no progress bar or "x left" call-out.
5. Column proportions were off — date columns took most of the width while
   the status chip and actions had almost none.
6. 「開放報名」 chip used `bg-green-100 text-green-800` — a violation of the
   B&W + Gold palette.
7. The AI bulk import dialog used a `<Bot>` icon and `bg-blue-50` selected-row
   highlight; the AI preview dialog used teal.

---

## What changed

### DeparturesManagement.tsx

**Currency display** — added a `formatPrice(amount, currency)` helper. TWD
becomes `NT$`; any other ISO code is shown verbatim. Used in the main table
and the AI extracted-list price preview.

**Column widths** — wrapped the table in a `<colgroup>` with explicit
percentages (出發日期 20%, 回程 16%, 成人價格 18%, 名額 22%, 狀態 14%,
操作 10%) and switched to `table-fixed`. Every header gets `whitespace-nowrap`
so the column labels can no longer wrap.

**Slot display** — replaced the bare `bookedSlots/totalSlots` cell with a
three-piece layout: `剩 N 名` (or 「已額滿」 when 0 left), a progress bar
that fills with the brand gold (`#c9a563`) under 70%, amber 70-89%, red ≥90%,
and a small `tabular-nums` tally `0/26`. New i18n keys
`departuresTab.slotsRemainingFormat`, `slotsFullLabel`, `slotsOfTotalFormat`.

**Status chip** — `getStatusConfig` now maps:
- `open` → `bg-foreground/5 text-foreground` (neutral, dominant state)
- `full` → `bg-red-50 text-red-700` (true error/warning, kept muted)
- `confirmed` → `bg-[#c9a563]/15 text-[#8a6f3a]` (brand gold, positive)
- `cancelled` → `bg-foreground/5 text-foreground/50 line-through`

All chips use `inline-flex items-center px-2 py-0.5 rounded-md text-[11px]
font-medium whitespace-nowrap` so they cannot wrap or grow vertically.

**Dialog headers** — `DialogTitle` now uses `text-foreground` (not the
default `text-purple` accent), `DialogDescription` uses `text-foreground/60`,
matching the TourEditDialog pattern.

**AI Bulk Import button** — switched icon to `<Sparkles>` (gold-tinted),
button shell stays `bg-foreground text-white hover:bg-foreground/85
rounded-lg`. Replaces the `<Bot>` icon.

**Empty state** — gold-on-cream calendar avatar circle, primary CTA with
`<Plus>` so the admin has a one-click path to add the first departure.

**Form labels & inputs** — every `border-gray-300` swapped for
`border-foreground/20`, every `text-gray-*` for `text-foreground/*`. Notes
textarea kept its `rounded-lg`.

### DeparturePreview.tsx

Same audit: every `text-teal-*`, `bg-teal-*`, `text-muted-foreground`, and
`border-border` replaced with `text-[#c9a563]`, `text-[#8a6f3a]` or
`text-foreground/N` / `border-foreground/N`. Header icon, source link, and
loading spinner use the brand gold. Confirm CTA is now
`bg-foreground hover:bg-foreground/85 text-white`. Empty state matches the
new gold-on-cream avatar circle.

### i18n

Added six keys per language under `departuresTab`:
`statusConfirmed`, `slotsRemainingFormat`, `slotsFullLabel`,
`slotsOfTotalFormat`, `emptyStateTitle`, `emptyStateHint`.

---

## Verification

- No matches for `text-purple|bg-purple|text-blue-[3-9]|bg-blue-[3-9]|bg-green|bg-yellow-50|text-pink|text-teal|bg-teal` in either file.
- No tRPC procedure or mutation handler was modified.
- AI extract / confirmExtractedDepartures payload shape unchanged.
- Table columns now sum to 100% on `table-fixed` so the status chip has
  guaranteed minimum width.

## Out of scope

- Did not deploy.
- Did not touch BulkImport tRPC logic.
- Did not change AI departure preview field semantics — only restyled.
