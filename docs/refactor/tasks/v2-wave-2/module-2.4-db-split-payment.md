# v2 · Wave 2 · Module 2.4 — Split `server/db.ts` (payment domain extraction)

**Parent plan:** docs/refactor/v2-plan.md (Wave 2 · Module 2.1 D2 split, 4th of 7)
**Audit ref:** v2-audit-2026-05-19.md §C lines 139-160; v2-plan.md line 147 ("payments, vouchers, packpoint, refunds")
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO (blocked on Module 2.3 commit)
**Est. effort:** 2 h AI + 15 min Jeff review
**Risk tier:** **MEDIUM-HIGH (money path)** — vouchers + packpoint + refunds touched. Wrong export → silent voucher loss or refund double-issue.
**Deploy window:** Tue/Wed/Thu 9-11am PT only (money-path rule from v1).

> **CRITICAL SEQUENCING:** Starts ONLY after Module 2.3 committed AND green. v1's `stripeWebhookIdempotency` table protects against double-write at the webhook layer, but this refactor changes the DB-helper import path — careful.

## Goal

Extract **payment/voucher/packpoint/refund query helpers** from `server/db.ts` (~2,290 LOC post-2.3) into `server/db/payment.ts` (≤400 LOC). Shim. Vitest smoke covering at least the refund + voucher critical paths.

**Note on payments:** the core `payments` table CRUD (`createPayment`, `getPaymentByIntentId`, `updatePaymentStatus`) was extracted to `db/booking.ts` in Module 2.1 per cohesion (Stripe webhook writes both bookings + payments atomically). Module 2.4 owns **vouchers, packpoint, refund records** — separate ledgers from the payments table itself. If Jeff decides at D2.1-a to split payments out of booking.ts after the fact, that's a follow-up commit not this module's scope.

## Pre-requisites

- Modules 2.1 + 2.2 + 2.3 committed, all tests green
- `server/db/{booking,tour,user}.ts` exist
- `server/db.ts` shim block has 3 `export *` lines

## Inputs (read these before executing)

1. **Post-2.3 `server/db.ts`** — grep for current line ranges.
2. **`drizzle/schema.ts`** — `vouchers`, `voucherUsages` (if separate), `packpointBalance`, `packpointTransactions`, `refunds` (if separate from payments). Confirm tables.
3. **`server/_core/stripeWebhook.ts`** — read for callers of voucher/packpoint/refund helpers to understand atomicity expectations.
4. **`server/db/booking.ts`** + previous extractions for pattern.

## Scope (what this module owns)

| File | Action | Target LOC |
|---|---|---|
| `server/db/payment.ts` (new) | Voucher + packpoint + refund-record CRUD | ≤400 |
| `server/db/payment.test.ts` (new) | 2+ Vitest cases (voucher + packpoint critical paths) | ≤120 |
| `server/db.ts` (modified) | Delete moved bodies; add 4th shim line | reduces ~250 LOC |

### Functions to extract — to be confirmed by sub-agent grep

The exact set depends on what helpers currently live in `db.ts` post-Modules 2.1-2.3. Expected (re-confirm):

- Voucher CRUD: `createVoucher`, `issueVoucher`, `getVoucherByCode`, `redeemVoucher`, `expireVoucher`, `getVoucherUsages` (if exists)
- Packpoint: `creditPackpoint`, `debitPackpoint`, `getPackpointBalance`, `getPackpointTransactions`
- Refunds: any refund-record CRUD distinct from `payments` table updates

Sub-agent: `grep -nE "voucher|packpoint|refund" server/db.ts | grep "^[0-9]*:export"` to enumerate.

**If no separate voucher/packpoint/refund helpers exist in db.ts** (they may all live in dedicated services like `server/services/voucherService.ts`), then this module's scope shrinks to just the `payments` table CRUD that wasn't moved in 2.1. Sub-agent must report what they actually find and supervisor decides.

### Out of scope

- **Accounting entries** (`createAccountingEntry`, `getAccountingEntries` at L3351+) — move to `db/accounting.ts` (Module 2.7).
- **Invoices** (`createInvoice`, `getInvoices` etc.) — `db/accounting.ts`.
- **Recurring expenses** — `db/accounting.ts`.
- **AI quotes** — `db/accounting.ts` if customer-financial; else leave residual.

## Procedure

### Step 1 — Verification grep

```bash
grep -nE "^export async function" server/db.ts | grep -iE "voucher|packpoint|refund|payment"
wc -l server/db.ts  # expect ~2,290
```

If grep returns <5 functions, sub-agent reports "thin scope" to supervisor and asks whether to merge this module with `accounting` (2.7) since voucher/packpoint may already live outside db.ts.

### Step 2 — Create `server/db/payment.ts`

```ts
// server/db/payment.ts — extracted from server/db.ts in v2 Wave 2 Module 2.4.
//
// Owns: vouchers + packpoint ledger + refund records. The core `payments`
// table CRUD lives in db/booking.ts (Module 2.1) per Stripe-webhook cohesion.
//
// **Money-path warning:** functions here ALL accept `tx?: DrizzleTx` for
// atomic multi-write sequences via db.transaction(). Preserve.

import { eq, and, desc, sql } from "drizzle-orm";
import { /* ...schema imports... */ } from "../../drizzle/schema";
import { getDb, type DrizzleTx } from "../db";

// === Vouchers ===
// ...verbatim function bodies
```

### Step 3 — Modify `server/db.ts`

1. Delete moved bodies (confirm count + LOC).
2. Add 4th shim line:

```ts
export * from "./db/booking";
export * from "./db/tour";
export * from "./db/user";
export * from "./db/payment";
```

3. Verify `wc -l server/db.ts` ≤2,040.

### Step 4 — Smoke test (extra coverage for money path)

```ts
// server/db/payment.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", async () => {
  const actual = await vi.importActual<typeof import("../db")>("../db");
  return { ...actual, getDb: vi.fn().mockResolvedValue(null) };
});

import { /* the extracted exports */ } from "./payment";

describe("db/payment", () => {
  it("exports voucher + packpoint + refund functions", () => {
    // Verify exports based on what was actually extracted
  });

  it("voucher lookup returns undefined when DB not init", async () => {
    // happy null-DB path on a voucher getter
  });

  it("packpoint balance returns 0 when DB not init", async () => {
    // happy null-DB path on packpoint getter (or null/undefined depending on actual impl)
  });
});
```

### Step 5 — Verify

```bash
pnpm tsc --noEmit
pnpm test server/db/payment.test.ts
pnpm test  # full regression
```

### Step 6 — Smoke

- Boot `pnpm dev`
- Trigger a voucher-issuance flow (admin issues voucher → check DB write)
- Trigger a packpoint credit (test booking completes → check balance)
- Refund flow on staging (Stripe webhook → refund record)

## Acceptance Criteria

- [ ] `server/db/payment.ts` exists with the discovered voucher/packpoint/refund exports
- [ ] `server/db/payment.ts` ≤400 LOC
- [ ] `server/db/payment.test.ts` exists with 2+ Vitest cases
- [ ] `server/db.ts` has 4 `export * from` lines
- [ ] `server/db.ts` reduces ≥200 LOC (or thin-scope acceptance documented if discovery shrunk)
- [ ] All extracted functions retain `tx?: DrizzleTx` parameter (atomicity preservation)
- [ ] No export collisions across all 4 `db/*.ts` files
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` green
- [ ] Manual: voucher + packpoint + refund flows verified on staging

## Deliverable

- New: `server/db/payment.ts`, `server/db/payment.test.ts`
- Modified: `server/db.ts`

**Commit:**
```
refactor(db): v2 Wave 2 Module 2.4 — extract payment domain from db.ts

Fourth sub-task in the D2-locked 7-file db.ts split.

- server/db/payment.ts: voucher + packpoint + refund-record CRUD verbatim.
  `tx?` parameter preserved for stripeWebhook atomicity.
- server/db/payment.test.ts: 2+ smoke cases covering voucher + packpoint
  null-DB happy paths.
- server/db.ts: ~2,290 → ~2,040 LOC; 4 shim lines.

NOTE: core payments-table CRUD lives in db/booking.ts (Module 2.1)
per Stripe-webhook cohesion; this module covers voucher/packpoint/refund
ledgers only.

Audit ref: v2-audit §C; v2-plan.md Module 2.1 line 147.
```

## Rollback

`git revert <SHA>`. **Higher-risk than 2.1-2.3** because money path. If revert needed: Jeff confirms via staging refund flow that pre-2.4 state still works correctly. No DB schema change occurred → no data migration to undo.

## Manual intervention

- **Jeff (REQUIRED):** review the commit diff carefully; spot-check `tx?` parameter present on every multi-write function.
- **Jeff:** smoke a refund on Stripe-staging post-deploy.
- **Supervisor:** if "thin scope" reported by sub-agent, decide: merge with Module 2.7 OR proceed with smaller payment.ts file.

## Test plan

- 2+ Vitest in payment.test.ts
- Full regression
- **Money-path manual smoke (Jeff)**: voucher issue + packpoint credit + Stripe refund on staging

## Decisions needed (Jeff)

| # | Decision | Default if Jeff defers |
|---|---|---|
| D2.4-a | If voucher/packpoint/refund helpers don't exist in db.ts (already moved to services/), should this module be a no-op? | **No-op + skip.** Document in 2.7 final. Move to Module 2.5 directly. |
| D2.4-b | Move `payments` table CRUD out of booking.ts into payment.ts now (so payment.ts is the canonical payments file)? | **No — keep in booking.ts** for atomicity cohesion. v3 can revisit. |

**Must be committed before Module 2.5 starts** (OR explicitly skipped + documented if no-op).
