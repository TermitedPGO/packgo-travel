# v2 · Wave 3 · Module 3.7 — Server-side port of `packgo-tour-confirmation` skill

**Parent plan:** docs/refactor/v2-plan.md (Wave 3 — supports auto-confirmation post-payment per audit §B line 129)
**Audit ref:** v2-audit-2026-05-19.md §B line 110, 129 ("packgo-tour-confirmation — confirmation letter for booked tours")
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 8h AI + 0min Jeff

## Goal

Port `packgo-tour-confirmation` from Jeff's Claude Code side to the server so it can fire **autonomously** after Stripe payment-confirmed events. Per audit §B: "auto-send post-payment-confirmed". Per draft-first lock: v2 ships as draft (Jeff reviews), NOT auto-send.

The skill produces a tour confirmation letter PDF: booking summary, itinerary recap, total paid, balance owed, key dates (departure, balance due, final document deadlines), emergency contact info, bilingual.

This module ports the skill into the registry but does NOT wire it to a Stripe payment-confirmed webhook (deferred — out of scope, would be its own Wave 3+ module if Jeff prioritizes). For v2 Wave 3, the skill is callable via:
1. Admin manual trigger (an admin tRPC `tools.generateTourConfirmation` endpoint — optional, can defer)
2. Future autonomous trigger (post-Wave-3 phase, deferred)

**Key value v2 ships:** the renderer + orchestrator exists, so as soon as the autonomous trigger lands, it just works.

## Pre-requisites

- **Module 3.3** (SkillOrchestrator interface) — landed
- **Module 3.2** (registry) — landed (this module does NOT add a new registry entry because there's no inbound-classifier intent for "confirmation"; confirmation is triggered by payment success not by customer email. Optional: add a new intent `confirmation_needed` for completeness, but defer to v3.)
- (Optional) `chinaVisaApplications`-style table for `bookings` — already exists.

## Inputs (read these before executing)

1. **Mac plugin SKILL.md** at `~/.claude/skills/packgo-tour-confirmation/SKILL.md` (supervisor provides inline if sub-agent lacks shell access).
2. `server/services/skills/quoteTemplate.ts` — canonical style.
3. `drizzle/schema.ts` — `bookings`, `tours`, `departures`, `payments` tables (the confirmation skill reads from these).
4. `server/email/templates/bookingConfirmation.ts` (post-Wave 2.5; if not yet split, read `server/email.ts`) — the email template, NOT the PDF. The new tour-confirmation skill is **the PDF version**. Confirmation EMAIL stays as-is; confirmation PDF is new.

## Scope (what this module owns)

- New file: `server/services/skills/tourConfirmationTemplate.ts` (~280 LOC; pure renderer)
- New file: `server/agents/skills/tourConfirmation.ts` (~120 LOC; orchestrator)
- Modified: `server/agents/skills/registry.ts` — extend `SkillId` to include `packgo-tour-confirmation`; NO new intent mapping (called by future trigger, not by classifier)
- Vitest: `server/services/skills/tourConfirmationTemplate.test.ts`
- Vitest: `server/agents/skills/tourConfirmation.test.ts`

Does NOT:
- Add a payment-confirmed webhook (deferred)
- Add an admin tRPC endpoint to manually trigger (Jeff may prefer; can be a follow-up if asked)
- Touch the existing `sendBookingConfirmation` email path

## Procedure

1. **Read SKILL.md** to enumerate the confirmation PDF sections:
   - Header: PACK&GO logo + 「行程確認單 / Tour Confirmation」
   - Booking summary (booking ID, customer name, contact, departure date, # of pax)
   - Itinerary recap (day-by-day, condensed from tour.daysJson)
   - Hotels (date + name + 或同級)
   - Inclusions / Exclusions
   - Payment summary (total, deposit paid, balance owed, balance due date)
   - Critical dates (final documents deadline, deposit refund cutoffs)
   - Emergency contact / pre-trip checklist
   - Footer with PACK&GO contact + brand colors

2. **Create `server/services/skills/tourConfirmationTemplate.ts`** mirroring `quoteTemplate.ts`:
   ```ts
   import { escapeHtml, fmtNum, LOGO_NAVY_B64, LOGO_WHITE_B64 } from "./skillPdfService";

   export type TourConfirmationHotel = {
     date: string;
     name: string;
     location?: string;
   };

   export type TourConfirmationDay = {
     day: number;
     date?: string;
     title: string;
     description: string;
     meals?: string;       // e.g., "早:飯店 / 午:風味餐 / 晚:當地特色"
   };

   export type TourConfirmationInput = {
     bookingId: number;
     customerName: string;
     customerEmail: string;
     departureDate: string;
     returnDate: string;
     numberOfPax: number;
     tourName: string;
     // Itinerary
     days: TourConfirmationDay[];
     hotels: TourConfirmationHotel[];
     // Pricing
     totalUSD: number;
     depositPaidUSD: number;
     balanceOwedUSD: number;
     balanceDueDate?: string;
     // Important dates
     finalDocumentsDeadline?: string;
     // Lists
     includes: string[];
     excludes: string[];
     // Meta
     issuedDate?: string;
     language?: "zh-TW" | "en";   // default zh-TW
     emergencyContact?: string;    // default Jeff's office phone
   };

   export function renderTourConfirmationHtml(input: TourConfirmationInput): string {
     // 3-page PDF: page 1 booking + payment, page 2 itinerary, page 3 hotels + lists
     // ...
   }
   ```

3. **Create `server/agents/skills/tourConfirmation.ts`** orchestrator:
   ```ts
   import { renderTourConfirmationHtml, type TourConfirmationInput } from "../../services/skills/tourConfirmationTemplate";
   import { renderHtmlToPdf } from "../../services/skills/skillPdfService";
   import type { SkillContext, SkillOrchestrator, SkillResult } from "./orchestrator";
   import { getDb } from "../../db";

   export const tourConfirmationOrchestrator: SkillOrchestrator = {
     id: "packgo-tour-confirmation",
     async run(ctx: SkillContext): Promise<SkillResult> {
       // ctx.inquiry won't have a booking ID embedded. For autonomous triggers,
       // a custom dispatcher (future) will pass bookingId in ctx.meta.
       // For v2, this orchestrator expects `ctx.inquiry.meta.bookingId` OR
       // returns escalation if none is present.
       const bookingId = (ctx as any).bookingId ??
         (ctx.inquiry as any).meta?.bookingId;
       if (!bookingId || typeof bookingId !== "number") {
         return {
           ok: false,
           reason: "No bookingId in context — cannot render confirmation",
           needsJeff: true,
         };
       }
       try {
         const db = await getDb();
         const booking = await db!.getBookingById(bookingId);
         if (!booking) {
           return { ok: false, reason: `Booking ${bookingId} not found`, needsJeff: true };
         }
         const tour = await db!.getTourById((booking as any).tourId);
         const input: TourConfirmationInput = buildInputFromBookingRow(booking, tour, ctx.language);
         const html = renderTourConfirmationHtml(input);
         const pdf = await renderHtmlToPdf(html);
         return {
           ok: true,
           pdf,
           draftBody: buildConfirmationDraftBody(input, ctx.language),
           meta: { bookingId, language: input.language },
         };
       } catch (err) {
         return { ok: false, reason: err instanceof Error ? err.message : String(err), needsJeff: true };
       }
     },
   };
   ```
   `buildInputFromBookingRow` and `buildConfirmationDraftBody` are private helpers.

4. **Update `server/agents/skills/registry.ts`**:
   - Add `"packgo-tour-confirmation"` to `SkillId` union.
   - Do NOT add an entry to the `skillRegistry` Map (no inbound classifier intent maps to it).
   - Optional: export an additional `directOrchestrators` map for non-intent-driven dispatch:
     ```ts
     export const directOrchestrators: Record<SkillId, SkillOrchestrator | null> = {
       "packgo-tour-confirmation": tourConfirmationOrchestrator,
       // … others null until ported
     };
     ```
   This lets a future Stripe-payment-succeeded webhook call `directOrchestrators["packgo-tour-confirmation"].run({...})`.

5. **Write `tourConfirmationTemplate.test.ts`** — 2 snapshot cases (full + minimal-input).
6. **Write `tourConfirmation.test.ts`** — 3 orchestrator cases:
   - Happy: `getBookingById` + `getTourById` mocked → returns PDF
   - Booking not found → `{ok: false}` with reason
   - No bookingId in context → `{ok: false, needsJeff: true}`

## Acceptance Criteria

- [ ] `server/services/skills/tourConfirmationTemplate.ts` exists with `renderTourConfirmationHtml`
- [ ] `server/agents/skills/tourConfirmation.ts` exports `tourConfirmationOrchestrator` matching `SkillOrchestrator`
- [ ] Registry's `SkillId` union extended; `directOrchestrators` (or equivalent) exposes the orchestrator
- [ ] Template handles missing optional fields (`balanceDueDate`, `finalDocumentsDeadline`) gracefully
- [ ] PDF output > 50 KB (3-page layout, denser than visa)
- [ ] Bilingual support: default zh-TW; renders en when `language: "en"`
- [ ] 2 renderer tests + 3 orchestrator tests passing — **§九 hard requirement**
- [ ] `pnpm tsc --noEmit` exits 0
- [ ] `pnpm test tourConfirmation` passes
- [ ] No existing `sendBookingConfirmation` email path touched

## Deliverable

- New: `server/services/skills/tourConfirmationTemplate.ts` (~280 LOC)
- New: `server/agents/skills/tourConfirmation.ts` (~120 LOC)
- New: `server/services/skills/tourConfirmationTemplate.test.ts` (~100 LOC, 2 cases)
- New: `server/agents/skills/tourConfirmation.test.ts` (~120 LOC, 3 cases)
- Modified: `server/agents/skills/registry.ts` (extend SkillId + add directOrchestrators map)

Commit message:
```
feat(agents): Wave 3 Module 3.7 — port packgo-tour-confirmation skill to server

Mirrors quoteTemplate.ts. 3-page confirmation PDF: booking summary +
payment ledger + condensed itinerary + hotels + critical dates +
emergency contact. Bilingual (default zh-TW).

Orchestrator reads booking from DB (getBookingById + getTourById) given
ctx.bookingId; useful for future autonomous trigger on Stripe
payment_intent.succeeded (deferred — not in this module's scope).

Registry SkillId union extended; new directOrchestrators map exposes
the orchestrator for non-intent-driven dispatch (e.g., webhook).
No skillRegistry intent mapping (no inbound classifier intent for
"confirmation").

5 Vitest cases per CLAUDE.md §九.

Refs: docs/refactor/tasks/v2-wave-3/module-3.7-port-packgo-tour-confirmation.md
```

## Rollback

- Single revert. No DB changes. Existing booking confirmation email path untouched.

## Manual intervention

- **None** if SKILL.md is provided.
- **YES escalate** if SKILL.md format is unclear about pricing display rules — supervisor pulls Jeff's existing confirmation PDF to mirror.

## Test plan

- 5 Vitest cases (2 renderer + 3 orchestrator).
- Wave 3 gate: manually invoke `tourConfirmationOrchestrator.run({ bookingId: <staging-booking> })` via a one-shot script; eyeball PDF. Gate-level.

## Decisions needed (Jeff)

1. **Trigger source for autonomy** — module 3.7 only PORTS the skill; does NOT wire a trigger. Should Wave 3 add a payment-succeeded-webhook → tourConfirmation orchestrator dispatch? Default: **defer to v3** (audit didn't flag it P0; Jeff currently uses `sendBookingConfirmation` email which is good-enough). Confirm or override.
2. **Admin tRPC manual-trigger endpoint** — `tools.generateTourConfirmation({ bookingId })` for Jeff's "regenerate this confirmation PDF" use case. Default: skip in this module; if Jeff wants it, separate 1h follow-up module.
3. **PDF storage** — when generated via the future autonomous trigger, where does the PDF go? S3 path `confirmations/<bookingId>/<timestamp>.pdf` proposed. Default: S3.

(Module proceeds with proposed defaults if Jeff defers; #1 is the key one — without a trigger, this is pure code shelf-stock until v3.)
