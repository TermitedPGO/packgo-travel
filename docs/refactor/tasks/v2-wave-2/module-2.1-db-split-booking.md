# v2 · Wave 2 · Module 2.1 — Split `server/db.ts` (booking domain extraction)

**Parent plan:** docs/refactor/v2-plan.md (Wave 2 · Module 2.1 — first sub-task in the 7-file `db.ts` split per locked decision D2)
**Audit ref:** v2-audit-2026-05-19.md §C lines 139-160 (god-files table) + §C line 186 (db.ts split plan); v2-plan.md lines 139-155
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 2.5 h AI + 15 min Jeff review
**Risk tier:** MEDIUM-HIGH — `db.ts` is imported by ~40 sub-routers; any export drift breaks the entire backend. First sub-extraction validates the shim pattern; subsequent extractions (2.2-2.7) reuse it.
**Deploy window:** Tue/Wed morning 9-11am PT — touches money-path queries (bookings, payments) via the broader split.

> **CRITICAL SEQUENCING:** This module MUST land and be committed before any Wave 2 module 2.2-2.7 starts. Each db.ts sub-extraction (2.1 → 2.7) is sequential — supervisor relay per v1 lesson 1. After this commit lands and `pnpm tsc --noEmit + pnpm test` are green, dispatch Module 2.2.

## Goal

Extract the **booking-domain query helpers** from the 3,584-LOC `server/db.ts` god-file into a new `server/db/booking.ts` module (≤500 LOC target). Establish the shim pattern: `server/db.ts` keeps every remaining inline helper AND adds `export * from "./db/booking"` so all ~40 existing `import { ... } from "../db"` call sites continue working unchanged. Add a happy-path Vitest in `server/db/booking.test.ts` covering one query.

This is **the first sub-task** in the 7-file split locked by D2. It validates the shim mechanic on a domain that has clear, contained queries (no cross-domain helpers).

## Pre-requisites

- Wave 1 complete (Sentry firing in prod so any regression caused by this split is visible in <2min; pino logger available for new file's debug statements).
- v2-progress.md exists with Wave 2 / Module 2.1 row marked IN-PROGRESS by supervisor.
- Working tree clean (`git status` empty).
- `pnpm tsc --noEmit` exit 0 at HEAD (pre-condition for any structural refactor).
- No other Wave 2 module is concurrently editing `server/db.ts` (sequential relay).

## Inputs (read these before executing)

1. **`server/db.ts` lines 839-1057** — the `// ============ Bookings ============` and `// ============ Booking Participants ============` and `// ============ Payments ============` banner blocks. Confirm exact line ranges via `grep -nE "^// =====" server/db.ts` since `db.ts` has shifted +110 LOC since v1-audit.
2. **`server/db.ts` lines 1-75** — imports + `getDb()` function. The new `booking.ts` MUST re-use `getDb()`; do NOT duplicate the pool init.
3. **`drizzle/schema.ts`** — confirm `bookings`, `bookingParticipants`, `payments` table definitions + their `Insert*` / non-insert type exports.
4. **`docs/refactor/tasks/phase-4/module-4F-composition.md`** — read the shim pattern used for routers.ts → routers/ directory; same pattern applies here.
5. **`docs/refactor/tasks/phase-5/module-5A-suppliersync.md`** — the "Option A re-export shim" pattern; same shape will be used in 2.7 (final) but for now `db.ts` keeps inline helpers + re-exports booking.ts.
6. **`server/db/`** — verify it does NOT yet exist (`ls server/db/ 2>/dev/null` should fail). Module 2.1 creates this directory.
7. **CLAUDE.md §六 · 關鍵檔案路徑** — the `db.ts` row entry will be updated incrementally as 2.1-2.7 land (final update in 2.7).

## Scope (what this module owns)

| File | Action | Target LOC |
|---|---|---|
| `server/db/booking.ts` (new) | Move all booking-domain query functions from `db.ts` here | ≤500 |
| `server/db/booking.test.ts` (new) | 1 happy-path Vitest case | ≤80 |
| `server/db.ts` (modified) | Add `export * from "./db/booking"` shim line at top; delete the moved function bodies | reduces by ~370 LOC |

### Functions to extract from `db.ts` → `server/db/booking.ts`

Confirm exact line ranges via `grep -nE "^export async function" server/db.ts` immediately before executing. Expected set (per pre-execute grep on commit d133596):

- `getUserBookings(userId)` — L846
- `getActiveBookingsByDepartureId(departureId)` — L862
- `getAllBookings(filters)` — L880
- `getBookingById(id, userId?)` — L927
- `createBooking(booking)` — L945
- `updateBooking(id, updates, tx?)` — L973
- `getBookingParticipants(bookingId)` — L997
- `createBookingParticipant(participant)` — L1011
- `replaceBookingParticipants(bookingId, participants)` — L1037
- `getBookingPayments(bookingId)` — L1064
- `createPayment(data, tx?)` — L1084
- `getPaymentByIntentId(intentId)` — L1115
- `updatePaymentStatus(id, status, tx?)` — L1138

**Total: 13 functions, approx 370 LOC including banner comments and types.**

### What this module does NOT touch

- **`tryReserveDepartureSlots` / `releaseDepartureSlots`** at L729-790 — these are TOUR-DEPARTURE concerns, belong to Module 2.2 (`db/tour.ts`).
- **Refund / voucher / packpoint queries** — belong to Module 2.4 (`db/payment.ts`). The line is: booking + booking-participant + payment-record CRUD lives in `db/booking.ts`; refund/voucher/packpoint live in `db/payment.ts`. Rationale: `createPayment` / `updatePaymentStatus` are tightly coupled to bookings (same Stripe webhook flow), so they go here; refunds + vouchers are separately-issued credits with their own state machine and go in 2.4.
- The `assertOwnsUsageLogs` helper (already moved to `_core/usageLogOwnership.ts` in v1 Phase 4F) — out of scope.

## Procedure

### Step 1 — Verification grep (sub-agent first action)

```bash
cd /Users/jeff/Desktop/網站
grep -nE "^export async function" server/db.ts > /tmp/2.1-db-exports-before.txt
grep -nE "^// =====" server/db.ts > /tmp/2.1-db-banners.txt
wc -l server/db.ts  # expect 3584
```

Confirm the 13 function names listed above match exactly what's at L846-L1138 in the working tree. If function names have drifted (e.g., `getBookingById` renamed), STOP and escalate to supervisor.

### Step 2 — Create `server/db/booking.ts`

```ts
// server/db/booking.ts — extracted from server/db.ts in v2 Wave 2 Module 2.1 (D2 locked split).
//
// Owns: booking + bookingParticipants + payments CRUD. Refunds/vouchers/packpoint live in
// db/payment.ts (Module 2.4). Departure-slot reserve/release lives in db/tour.ts (Module 2.2).
//
// Re-exported from server/db.ts via `export * from "./db/booking"` so all ~40 callers
// (sub-routers, autonomous agents, services) continue importing from "../db" unchanged.

import { eq, and, desc, sql } from "drizzle-orm";
import {
  bookings, InsertBooking, Booking,
  bookingParticipants, InsertBookingParticipant, BookingParticipant,
  payments, InsertPayment, Payment,
  // ...others discovered during extraction
} from "../../drizzle/schema";
import { getDb, type DrizzleTx } from "../db";  // re-use lazy pool from shim

// === Bookings CRUD ===
export async function getUserBookings(userId: number) { /* ...verbatim from db.ts:846 */ }
// ... (12 more functions, all verbatim from their source line ranges)
```

**Implementation rules:**
- Copy each function body **verbatim** from `db.ts`. No logic changes. No type-narrowing changes.
- Preserve every JSDoc + inline comment (Phase 2 transaction comment at db.ts:40-50 stays in `db.ts`, NOT moved; the `tx?` parameter docs on `createPayment`/`updateBooking`/`updatePaymentStatus` move with the function).
- Import `getDb` from `"../db"` (the shim) — this creates a circular-ish import but works at module load because `getDb` is lazy. Verify with `pnpm tsc --noEmit`.
- If a function references a helper currently inline in `db.ts` that hasn't been extracted yet, leave the helper in `db.ts` and import it: `import { someHelper } from "../db"`. Module 2.7 (final cleanup) decides where helpers ultimately live.

### Step 3 — Modify `server/db.ts`

1. Delete the 13 function bodies (L846-1057 range, but confirm via grep — line numbers are stale).
2. Delete the now-orphaned banner comments (`// ====== Bookings ======`, `// ====== Booking Participants ======`, `// ====== Payments ======`) for the 3 sections.
3. Add at the top of `db.ts`, immediately after the imports block (around L37), a new section:

```ts
// === v2 Wave 2 Module 2.1 — booking domain extracted ===
// See server/db/booking.ts. This shim re-exports so existing callers
// `import { createBooking } from "../db"` continue working.
export * from "./db/booking";
```

4. Verify `wc -l server/db.ts` reports ~3,210 (was 3,584; minus ~370 for extracted functions + minus ~5 banner lines).

### Step 4 — Create the smoke test

```ts
// server/db/booking.test.ts
import { describe, it, expect, vi } from "vitest";

// Mock getDb BEFORE importing from booking.ts so the import-time getDb resolution sees the mock.
vi.mock("../db", async () => {
  const actual = await vi.importActual<typeof import("../db")>("../db");
  return {
    ...actual,
    getDb: vi.fn().mockResolvedValue(null), // null = "DB not initialized" path
  };
});

import { getBookingById, createBooking } from "./booking";

describe("db/booking", () => {
  it("exports the 13 booking-domain functions", () => {
    // Smoke: key exports exist + are functions
    expect(typeof getBookingById).toBe("function");
    expect(typeof createBooking).toBe("function");
  });

  it("getBookingById returns undefined when DB not initialized", async () => {
    // Happy-path stub: the lazy DB returns null → query returns undefined cleanly.
    const result = await getBookingById(123);
    expect(result).toBeUndefined();
  });
});
```

If `getBookingById` does NOT handle a null DB gracefully (some db.ts functions throw on null DB), pick a different "happy path" — read the current body and write the test to match its existing safe path (e.g., mock `getDb` to return a fake drizzle instance with `.select().from()...` chain returning `[]`).

### Step 5 — Verify

```bash
cd /Users/jeff/Desktop/網站
NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
pnpm test server/db/booking.test.ts
pnpm test  # full regression run
```

Expected:
- tsc exit 0
- 1 new test passes
- Full test suite: same pass count as pre-Module-2.1 + 1 new test passing
- No new console warnings from circular import resolution (booking.ts → db.ts → booking.ts re-export)

### Step 6 — Smoke test in dev mode

```bash
pnpm dev  # in one terminal
# In a second terminal:
curl -s http://localhost:3000/api/health || echo "no health endpoint yet"
# Visit a booking-related admin page (e.g., admin/bookings); confirm bookings load.
```

If `pnpm dev` boots cleanly and an admin can list bookings, the shim works.

## Acceptance Criteria

- [ ] `server/db/booking.ts` exists with the 13 named exports listed in Scope above
- [ ] `server/db/booking.ts` ≤500 LOC
- [ ] `server/db/booking.test.ts` exists with at least 1 happy-path Vitest case, all passing
- [ ] `server/db.ts` contains `export * from "./db/booking"` line near top of file
- [ ] `server/db.ts` reduces by ≥350 LOC (3,584 → ≤3,234)
- [ ] All 13 extracted function bodies are DELETED from `server/db.ts` (no double-definition)
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` full suite: same pass count as pre-Module-2.1 + new tests pass
- [ ] No new circular-dependency warnings in `pnpm build` output
- [ ] At least one admin booking page renders identically pre/post in dev mode (manual smoke)

## Deliverable

- New: `server/db/booking.ts`, `server/db/booking.test.ts`
- Modified: `server/db.ts` (function bodies deleted; `export * from "./db/booking"` added)

**Single commit (sub-agent returns diff; supervisor stages + commits per relay rule):**

```
refactor(db): v2 Wave 2 Module 2.1 — extract booking domain from db.ts

First sub-task in the 7-file db.ts split locked by D2 (v2-plan.md).

- server/db/booking.ts: 13 functions (bookings + bookingParticipants + payments
  CRUD) moved verbatim from db.ts:846-1138. ~370 LOC.
- server/db/booking.test.ts: 1 happy-path smoke (getBookingById on uninitialized
  DB returns undefined).
- server/db.ts: function bodies deleted; new `export * from "./db/booking"` shim
  preserves the import surface so ~40 callers stay unchanged.
- db.ts: 3,584 → ~3,210 LOC.

Refunds/vouchers/packpoint and tour-departure slot helpers explicitly NOT
moved here; those land in 2.4 and 2.2 respectively.

Audit ref: v2-audit §C; v2-plan.md Module 2.1.
```

## Rollback

- This is a single commit. `git revert <SHA>` restores `db.ts` to its pre-2.1 monolith state. `server/db/booking.ts` becomes orphaned (re-exported by nothing) — next deploy bundles it out, no runtime harm.
- The `server/db/booking.test.ts` file becomes orphaned too — Vitest will still run it but the import resolves to the (reverted) tree.
- Module 2.2-2.7 are blocked until 2.1 succeeds OR 2.1 is reverted + re-tried.

## Manual intervention

- **Jeff:** review the commit diff before push. The shim line in db.ts is the load-bearing artifact — confirm it sits near the top of the file, NOT at the bottom (re-export resolution order matters for some bundlers).
- **Supervisor:** verify `wc -l server/db.ts` drops by ≥350. If under, sub-agent missed function bodies — re-run grep.
- **Supervisor:** before dispatching Module 2.2, confirm `pnpm test` is fully green on the merged 2.1 commit. If any non-booking test broke, the shim has a regression — diagnose before proceeding.

## Test plan

- 1 new Vitest in `server/db/booking.test.ts`:
  - Smoke: 2 named exports exist + are functions
  - Happy path: `getBookingById` returns `undefined` when DB pool is null (or equivalent for whichever extracted function has the cleanest null-DB code path)
- Full `pnpm test` regression: pass count + 1 new passing test
- Manual smoke: admin booking list page renders in dev

## Decisions needed (Jeff)

| # | Decision | Default if Jeff defers |
|---|---|---|
| D2.1-a | Should `payments` queries (createPayment, getPaymentByIntentId, updatePaymentStatus) move WITH booking (current plan) OR to db/payment.ts (Module 2.4)? Trade-off: bookings + payments are tightly Stripe-webhook-coupled (argues for booking.ts); but separate concerns argues for payment.ts. | **Move with booking** (this module's default). Rationale: keeps the Stripe-webhook code path's DB calls in one file. v2-plan.md Module 2.1 line 147 says "payments, vouchers, packpoint, refunds → db/payment.ts" — but those are *refund* payments + voucher/packpoint *issuance*, not the original `payments` table CRUD. Sub-agent: if Jeff confirms "split payments table CRUD from booking.ts to payment.ts" then re-run as 2.1.2 after 2.4. |
| D2.1-b | Should the shim line be `export * from "./db/booking"` (loose, re-exports everything) OR explicit named re-export `export { createBooking, getBookingById, ... } from "./db/booking"` (tight, but 13 names to maintain)? | **`export *`** (looser, future-proof — when 2.2-2.7 add files, all just add another `export * from` line). Risk: if booking.ts inadvertently exports a name colliding with another db/*.ts file in later modules, the re-export breaks. Mitigation: 2.2-2.7 each grep for name collisions before adding their `export *` line. |

**Must be committed before Module 2.2 starts** (per Wave 2 sequential-commit rule, v1 lesson 1).
