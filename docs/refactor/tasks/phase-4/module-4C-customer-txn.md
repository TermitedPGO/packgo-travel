# Phase 4C · Customer Transactional Non-Payment (Sub-PR 3 of 5)

**Parent plan:** docs/refactor/plan.md (Phase 4 · routers.ts Split)
**Audit ref:** P0-1
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 3-4 h AI + 1 h Jeff review
**Risk tier:** MEDIUM — real customer state changes (inquiries submitted, departures admin'd, bookings pre-payment created), but no money movement
**Deploy window:** Tue/Wed morning (mid-week so Jeff is alert for 30-min post-deploy watch)

## Goal
Extract the customer-facing transactional domains (`inquiries`, `bookings` non-payment slice, `departures`, `imageLibrary`, `homepage`) from `server/routers.ts`. The `bookings` domain is the hardest call in this PR: it has BOTH non-payment paths (4C scope) AND payment paths (4D scope) — this PR carves out the non-payment subset and leaves payment procedures in place; 4D extracts the rest.

## Pre-requisites
- Phases 0/1/2/3 complete
- Module 4A merged (provides `server/_core/inputSchemas.ts`)
- Module 4B merged or at least the disjoint `admin` lines (5431-6222) are settled
- Phase 2's Stripe webhook hardening + transactions are LIVE — this PR doesn't touch payment paths but creates pre-payment booking rows that downstream Stripe webhooks will operate on; the safety net must be in place
- This module lands as one squash-merge commit

## Inputs (read these before executing)

- `server/routers.ts` per-domain ranges (from grep at refactor start):
  - **`inquiries`**: L5037-5324 (288 LOC)
  - **`bookings`**: L3901-4851 (951 LOC TOTAL — only carve out 4 non-payment procedures here, see Domain Inventory)
  - **`departures`**: L4852-5036 (185 LOC)
  - **`imageLibrary`**: L6223-6290 (68 LOC)
  - **`homepage`**: L6291-6445 (155 LOC)
- `bookings` procedure-level breakdown (CRITICAL for the 4C/4D split):

| Procedure | Line range | LOC | Access | 4C or 4D? | Rationale |
|---|---|---|---|---|---|
| `bookings.create` | 3919-4264 | 346 | protected | **4C** | Creates a pre-payment booking row. Does NOT charge. Stripe checkout starts later. |
| `bookings.list` | 4265-4269 | 5 | protected | **4C** | Read-only customer's own bookings |
| `bookings.listParticipants` | 4270-4289 | 20 | protected | **4C** | Read-only participants for a booking |
| `bookings.saveParticipants` | 4290-4366 | 77 | protected | **4C** | Pre-trip participant info; no money |
| `bookings.getById` | 4367-4411 | 45 | protected | **4C** | Read-only |
| `bookings.createCheckoutSession` | 4412-4569 | 158 | protected | **4D** | **MONEY PATH** — initiates Stripe checkout |
| `bookings.cancel` | 4570-4622 | 53 | protected | **4D** | **MONEY PATH** — may trigger refund |
| `bookings.adminList` | 4623-4629 | 7 | admin | **4C** | Admin read-only |
| `bookings.adminUpdateStatus` | 4630-4710 | 81 | admin | **4D** | **MONEY PATH** — status flip can trigger refund/payout |
| `bookings.adminRefund` | 4711-4850 | 140 | admin | **4D** | **MONEY PATH** — direct refund issue |

**4C carves out 6 procedures from `bookings` (`create`, `list`, `listParticipants`, `saveParticipants`, `getById`, `adminList`) totaling ~500 LOC.**
**4D will carve out the remaining 4 (`createCheckoutSession`, `cancel`, `adminUpdateStatus`, `adminRefund`) totaling ~432 LOC.**

The `bookings.create` procedure is the largest (346 LOC) and is BORDER-LINE to the money path. Audit decision: `create` is non-payment because it ONLY inserts a `bookings` row with `paymentStatus = "pending"`; no Stripe call until `createCheckoutSession`. **However**, sub-agent extracting it MUST verify this by reading the body (L3919-4264) — if it does call `getStripeClient()` directly, escalate to supervisor and re-classify as 4D.

- Existing canonical: `server/routers/agentRouter.ts` (pattern, oversized) or 4A's `server/routers/toursRead.ts` (recent, clean shape).
- Client tRPC call inventory: covered in audit section below.

## Domain Inventory (this PR only)

| Domain | Current LOC in routers.ts | Source line range | Target file | Target LOC after split |
|---|---|---|---|---|
| inquiries | 288 | 5037-5324 | `server/routers/inquiries.ts` | ≤300 |
| bookings (non-payment slice) | ~500 of 951 | 3919-4411 + 4623-4629 | `server/routers/bookings.ts` | ≤300; if exceeds, split into `bookings/customer.ts` + `bookings/admin.ts` |
| departures | 185 | 4852-5036 | `server/routers/departures.ts` | ≤200 |
| imageLibrary | 68 | 6223-6290 | `server/routers/imageLibrary.ts` | ≤80 |
| homepage | 155 | 6291-6445 | `server/routers/homepage.ts` | ≤180 |

**bookings sub-split decision:**
The 4C bookings slice is ~500 LOC. Per CLAUDE.md §3.2 (≤300 LOC) this needs further split. Pre-emptive split:
- **`server/routers/bookings/customer.ts`** (~470 LOC, documented exception OR sub-split): `create` + `list` + `listParticipants` + `saveParticipants` + `getById`. The `create` procedure alone is 346 LOC — if it cannot be split cleanly (which is likely, since it's one mutation flow), supervisor accepts a single-file exception with header comment + v2 backlog entry.
- **`server/routers/bookings/admin.ts`** (~10 LOC for 4C): just `adminList`. Tiny; supervisor MAY skip splitting this until 4D when 3 more admin procedures join — at 4D, this becomes the natural `bookings/admin.ts`.

**Recommendation:** In 4C, keep all 6 non-payment bookings procedures in one file `server/routers/bookings/customer.ts` (or rename to `server/routers/bookings/nonPayment.ts`); leave `adminList` there alongside `list` for now. 4D will create `server/routers/bookings/payment.ts` with the 4 money procedures. Module 4F will rewire the `bookings:` composition.

**For 4C purposes, write to `server/routers/bookingsNonPayment.ts`** (flat path, no subdirectory yet) — Module 4F supervisor decides the final directory structure.

**Composition pattern in `routers.ts` after 4C:**

```ts
bookings: router({
  ...bookingsNonPaymentRouter._def.procedures,
  // 4 payment procedures still inlined until 4D
  createCheckoutSession: protectedProcedure...,  // stays
  cancel: protectedProcedure...,                  // stays
  adminUpdateStatus: adminProcedure...,           // stays
  adminRefund: adminProcedure...,                 // stays
}),
```

Client continues to call `trpc.bookings.create`, `trpc.bookings.list`, etc. — zero path change.

## Sub-Agent Strategy

**Sub-agent count for this PR: 5 (parallel).**

- **Sub-agent A — inquiries**: extract L5037-5324 → `server/routers/inquiries.ts` + `.test.ts`. ≤300 LOC.
- **Sub-agent B — bookingsNonPayment**: extract the 6 non-payment procedures listed above (verify each does NOT call Stripe; flag if any does) → `server/routers/bookingsNonPayment.ts` + `.test.ts`. ~500 LOC, documented exception.
- **Sub-agent C — departures**: extract L4852-5036 → `server/routers/departures.ts` + `.test.ts`. ≤200 LOC.
- **Sub-agent D — imageLibrary**: extract L6223-6290 → `server/routers/imageLibrary.ts` + `.test.ts`. ≤80 LOC.
- **Sub-agent E — homepage**: extract L6291-6445 → `server/routers/homepage.ts` + `.test.ts`. ≤180 LOC.

**Supervisor coordination:**
1. Sub-agent B's pre-flight check: confirm each of the 6 procedures does NOT import or call `getStripeClient()`. If any does, re-scope to 4D and inform supervisor.
2. Disjoint source-range check (the 6 bookings procedures must be contiguous-ish or carefully spliced; verify supervisor's diff doesn't double-pull or skip lines).
3. Stitch: delete extracted ranges from routers.ts, add imports, rewrite domain blocks with spread composition.
4. `pnpm tsc --noEmit` + `pnpm test` green gate.

**Sub-agent constraints:**
- Sub-agents touch ONLY their target line ranges.
- Sub-agents do NOT modify `server/db.ts`.
- Sub-agents import `shortStr`/`mediumStr`/`longStr` from `server/_core/inputSchemas.ts`.
- **Sub-agent B specifically: re-verify line-by-line that no Stripe import or call sneaks into the 4C scope. If `bookings.create` does anything more than insert-row + send-email, escalate.**
- If sub-agents discover shared booking helpers (`generateBookingNumber`, validation logic, etc.) inlined in routers.ts, flag for supervisor. Default: extract to `server/_core/bookingHelpers.ts` so 4D inherits.

## Client tRPC Call Audit

Verified by `grep -rohE "trpc\.(inquiries|bookings|departures|imageLibrary|homepage)\.[a-zA-Z]+" client/src/`. Expected procedures (sub-agents verify exhaustive):

**inquiries:**
- `trpc.inquiries.submit` — `client/src/pages/CustomTourRequest.tsx`, `client/src/pages/ContactUs.tsx`, etc.
- `trpc.inquiries.list` (admin) — admin inquiries tab
- `trpc.inquiries.getById`, `trpc.inquiries.updateStatus`, `trpc.inquiries.reply` — admin tools

**bookings (4C SCOPE — non-payment paths):**
- `trpc.bookings.create` — `client/src/pages/BookTour.tsx` (after user fills form, before Stripe checkout)
- `trpc.bookings.list` — `client/src/pages/Account/Bookings.tsx`
- `trpc.bookings.listParticipants`, `trpc.bookings.saveParticipants` — participant info form
- `trpc.bookings.getById` — `client/src/pages/BookingDetail.tsx`
- `trpc.bookings.adminList` — admin bookings tab

**bookings (4D SCOPE — DO NOT TOUCH IN 4C):**
- `trpc.bookings.createCheckoutSession` (Stripe init)
- `trpc.bookings.cancel`
- `trpc.bookings.adminUpdateStatus`
- `trpc.bookings.adminRefund`

**departures:**
- `trpc.departures.list`, `trpc.departures.upsert`, `trpc.departures.delete` — admin tour-detail departures table
- `trpc.departures.<query>` — public tour-detail departure picker

**imageLibrary:**
- `trpc.imageLibrary.list`, `trpc.imageLibrary.upload`, `trpc.imageLibrary.delete` — admin image library

**homepage:**
- `trpc.homepage.getConfig`, `trpc.homepage.updateConfig`, `trpc.homepage.<section>` — admin home customization

**ZERO-BREAK CONSTRAINT:** After 4C merges, every above `trpc.<key>.<procedure>` path resolves identically. Sub-agents EXHAUSTIVE-grep before declaring done.

## Procedure

1. **Supervisor (pre-fan-out, optional commit):** Inspect `bookings.create` (L3919-4264) for Stripe imports. Confirm none. If found, escalate to plan revision.

2. **Supervisor dispatches sub-agents A-E in parallel.** Each receives source range + target file + standard constraints.

3. **Per-sub-agent extraction recipe:** Identical to 4A/4B pattern. Sub-agent B has an extra step: verify no Stripe before completing extraction.

4. **Sub-agent B pre-flight script** (run inside sub-agent's context before extraction):
   ```bash
   sed -n '3919,4411p' server/routers.ts | grep -nE "getStripeClient|stripe\." || echo "OK: no Stripe in scope"
   sed -n '4623,4629p' server/routers.ts | grep -nE "getStripeClient|stripe\." || echo "OK: no Stripe in scope"
   ```
   If either finds a match, escalate to supervisor before extracting.

5. **Per-sub-agent Vitest recipe:**
   ```ts
   // server/routers/bookingsNonPayment.test.ts (example)
   import { describe, it, expect, vi } from "vitest";
   import { bookingsNonPaymentRouter } from "./bookingsNonPayment";
   import * as db from "../db";

   describe("bookingsNonPayment router", () => {
     it("create happy-path: inserts pending booking row", async () => {
       vi.spyOn(db, "getDb").mockResolvedValue({
         insert: () => ({ values: vi.fn().mockResolvedValue({ insertId: 42 }) }),
         select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 1, /* tour */ }]) }) }),
       } as any);
       const caller = bookingsNonPaymentRouter.createCaller({
         user: { id: 1, role: "user" },
         /* ...other ctx... */
       } as any);
       const result = await caller.create({
         tourId: 1,
         departureId: 1,
         numberOfAdults: 2,
         contactEmail: "test@example.com",
         contactName: "Test",
         /* ...other required fields... */
       });
       expect(result).toBeTruthy();
     });
   });
   ```

6. **Supervisor (post-fan-out, single commit):** apply the 5 sub-agent diffs:
   - 5 new `server/routers/<domain>.ts` files
   - 5 new `*.test.ts` files
   - `server/routers.ts` shrinks by ~1196 LOC (288 + 500 + 185 + 68 + 155)
   - Verify `pnpm tsc --noEmit` + `pnpm test` green

7. **Smoke test (Jeff or supervisor) — REQUIRED before deploy:**
   - Customer: submit a custom tour inquiry → confirm row inserted in DB
   - Customer: open BookTour page, fill form, submit (DO NOT proceed to payment yet) → confirm `bookings.create` returns booking id and the row exists with `paymentStatus = "pending"`
   - Customer: visit `/account/bookings` → list renders, click into one → detail page loads
   - Admin: open Inquiries tab → list renders, click → detail loads, reply works
   - Admin: open Bookings tab → list renders (uses `adminList`)
   - Admin: open Departures tab on a tour → table loads, add/remove a departure
   - Admin: open Image Library → thumbs render
   - Admin: open Home Customization → sections render

## Acceptance Criteria
- [ ] `server/routers/inquiries.ts` ≤300 LOC, exports `inquiriesRouter`
- [ ] `server/routers/bookingsNonPayment.ts` ≤500 LOC (documented exception); does NOT import `getStripeClient`
- [ ] `server/routers/departures.ts` ≤200 LOC
- [ ] `server/routers/imageLibrary.ts` ≤80 LOC
- [ ] `server/routers/homepage.ts` ≤180 LOC
- [ ] Five `*.test.ts` files exist, each passing
- [ ] `server/routers.ts` shrinks by ≥1190 LOC (running total: ≤6,400 after 4A+4B+4C)
- [ ] All client `trpc.{inquiries,bookings.<non-pay>,departures,imageLibrary,homepage}.*` paths resolve
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression-anchor pass count UNCHANGED + 5 new test files pass
- [ ] `pnpm build` succeeds
- [ ] Manual smoke checklist (step 7) all-pass on staging

## Deliverable
- Modified: `server/routers.ts` (~1196 LOC removed; 5 imports added; domain blocks rewritten with spread composition where bookings remains hybrid)
- New:
  - `server/routers/inquiries.ts` + `.test.ts`
  - `server/routers/bookingsNonPayment.ts` + `.test.ts`
  - `server/routers/departures.ts` + `.test.ts`
  - `server/routers/imageLibrary.ts` + `.test.ts`
  - `server/routers/homepage.ts` + `.test.ts`
- Single squash-merge commit:
  ```
  refactor(routers): Phase 4C — customer transactional non-payment

  Extracts inquiries, bookings (non-payment slice), departures, imageLibrary,
  and homepage domains from routers.ts. Bookings domain partially extracted:
  6 non-payment procedures (create/list/listParticipants/saveParticipants/getById/
  adminList) move to bookingsNonPayment.ts; 4 payment procedures (checkout,
  cancel, adminUpdateStatus, adminRefund) stay inline until Module 4D.

  Pre-flight: confirmed no Stripe imports in any 4C-scope procedure.
  Audit P0-1; risk tier MEDIUM; deployed Tue/Wed morning with 30min watch.

  - server/routers/inquiries.ts (288 LOC)
  - server/routers/bookingsNonPayment.ts (~500 LOC, exception documented)
  - server/routers/departures.ts (185 LOC)
  - server/routers/imageLibrary.ts (68 LOC)
  - server/routers/homepage.ts (155 LOC)

  5 happy-path Vitest files. routers.ts shrinks ~1196 LOC.
  Zero client trpc path breakage; customer + admin smoke verified on staging.
  ```

## Rollback
- Single squash-merge: `git revert <merge-SHA>` restores inlined blocks.
- If bookings partial-extraction creates an awkward in-between state (some procs in new file, others inline), the revert restores all inline. 4D PR will then need a fresh strategy.
- Per-deploy: weekday morning, watch error rate + inquiry submissions + booking creates for 30 minutes post-deploy. If error rate spikes >5% over baseline, revert.

## Manual intervention
- **Jeff:** review the squash-merge commit. Pay extra attention to `bookings.create` extraction since it's the heaviest non-payment procedure.
- **Jeff:** run the smoke checklist in step 7 against staging — every step must pass.
- **Jeff:** approves deploy timing (Tue/Wed morning) given customer-state-mutation risk.
- **Supervisor:** runs the Stripe-import pre-flight check in step 4 before unblocking sub-agent B.

## Test plan
- **Sub-agent A (inquiries):** Vitest covers `inquiries.submit` happy path — mocked db.insert, mocked email send, assert row created.
- **Sub-agent B (bookingsNonPayment):** Vitest covers `bookings.create` happy path — mocked db tour lookup + booking insert, assert `paymentStatus = "pending"` set.
- **Sub-agent C (departures):** Vitest covers `departures.list` happy path — mocked db returns 3 rows, assert ordering by departureDate.
- **Sub-agent D (imageLibrary):** Vitest covers `imageLibrary.list` happy path — mocked S3 listing returns 5 keys.
- **Sub-agent E (homepage):** Vitest covers `homepage.getConfig` happy path — mocked config row returned.

After all five pass, full `pnpm test` + `pnpm tsc --noEmit` + `pnpm build`.

**Post-deploy production verification (Jeff):**
- 30-min watch on error rate, inquiry-submission rate, booking-creation rate
- Replay one real-but-anonymized booking create against staging; verify success
- If any anomaly, revert immediately and reschedule.
