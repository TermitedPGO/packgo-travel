# v2 · Wave 2 · Module 2.7 — Split `server/db.ts` (accounting + final residual cleanup)

**Parent plan:** docs/refactor/v2-plan.md (Wave 2 · Module 2.1 D2 split, 7th/final of 7)
**Audit ref:** v2-audit-2026-05-19.md §C lines 139-160; v2-plan.md line 150 ("plaid accounting, transactions, year-end export") + line 153 (NEW residual policy)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO (blocked on Module 2.6)
**Est. effort:** 2.5 h AI + 30 min Jeff review
**Risk tier:** MEDIUM — accounting is read-heavy from admin; year-end export is critical for tax filing. Plus this module finalizes the residual decision, so the supervisor must verify all 7 splits produce clean tsc.
**Deploy window:** Tue/Wed/Thu morning (final money-adjacent extraction).

> **CRITICAL SEQUENCING:** Starts ONLY after Module 2.6 committed AND green. This is the FINAL db.ts sub-extraction; after it lands, supervisor verifies the full 7-file split passes Wave 2 verification gate (v2-plan.md line 233-241).

## Goal

Two parts:

**Part A — extract `accounting` domain** from `server/db.ts` (~1,240 LOC post-2.6) into `server/db/accounting.ts` (≤400 LOC). Shim. Vitest smoke.

**Part B — document `db.ts` residual** per locked decision D2 + v2-plan.md line 153. Residual functions (visa applications, inquiries, customTourRequests, agent CRUD, newsletter subscribers, marketing campaigns, affiliate clicks, any other not-yet-extracted helpers) stay in `db.ts`. Target residual `db.ts` ≤800 LOC. Update header comment + CLAUDE.md §六 to document the 7-file structure + residual policy.

## Pre-requisites

- Modules 2.1-2.6 committed, all tests green
- `server/db/{booking,tour,user,payment,log,search}.ts` exist
- `server/db.ts` shim block has 6 `export *` lines

## Inputs (read these before executing)

1. **Post-2.6 `server/db.ts`** — should be ~1,240 LOC. Grep remaining functions.
2. **`drizzle/schema.ts`** — `accountingEntries`, `invoices`, `recurringExpenses`, `aiQuotes` tables + plaid table refs (if exist).
3. **CLAUDE.md §六 · 關鍵檔案路徑** — the row currently reads `| 資料庫查詢 | server/db.ts |`. Will be updated to `server/db.ts + server/db/<domain>.ts × 7`.
4. **v2-plan.md line 153** — "NEW domains NOT in 7-file split: visa queries, inquiries, customTourRequests, agents → leave inside db.ts for now (under 500 LOC residual is acceptable). Document residual in CLAUDE.md §六 update."
5. **`docs/refactor/tasks/phase-4/module-4F-composition.md`** — for the "final commit" closing-comment pattern in routers.ts. Module 2.7 mirrors for db.ts.

## Scope (what this module owns)

### Part A — accounting extraction

| File | Action | Target LOC |
|---|---|---|
| `server/db/accounting.ts` (new) | accountingEntries + invoices + recurringExpenses + aiQuotes + plaid helpers | ≤400 |
| `server/db/accounting.test.ts` (new) | 1+ Vitest | ≤80 |
| `server/db.ts` (modified) | Delete bodies; add 7th shim line | reduces ~330 LOC |

### Part B — residual cleanup + CLAUDE.md update

| File | Action | Target |
|---|---|---|
| `server/db.ts` | Rewrite header docstring documenting 7-file structure + residual policy; verify ≤800 LOC | ≤800 LOC |
| `CLAUDE.md` (§六) | Update the `資料庫查詢` row to reference `server/db.ts (shim + residual) + server/db/{booking,tour,user,payment,log,search,accounting}.ts` | 1 row change |
| `docs/refactor/v2-progress.md` | Mark Wave 2 Module 2.1 complete (all 7 sub-tasks done) | 1 row update |

### Functions to extract in Part A (sub-agent grep first)

Expected (based on pre-split db.ts):

- `createAccountingEntry(data, tx?)` — was L3351
- `getAccountingEntries(params)` — was L3364
- `updateAccountingEntry(id, data)` — was L3390
- `deleteAccountingEntry(id)` — was L3397
- `getAccountingStats(params)` — was L3404
- `createInvoice(data)` — was L3436
- `getInvoices(params)` — was L3445
- `getInvoiceById(id)` — was L3454
- `getInvoiceByBookingId(bookingId)` — was L3466
- `updateInvoice(id, data)` — was L3478
- `getNextInvoiceSequence(year)` — was L3485
- `getRecurringExpenses()` — was L3495
- `createRecurringExpense(data)` — was L3501
- `updateRecurringExpense(id, data)` — was L3510
- `deleteRecurringExpense(id)` — was L3517
- `getRecurringExpenseById(id)` — was L3538
- `updateInvoiceStatus(id, status)` — was L3524
- `deleteInvoice(id)` — was L3531
- `createAiQuote(data)` — was L3547
- `listAiQuotes(params)` — was L3556
- `updateAiQuote(id, data)` — was L3571
- `getAiQuoteById(id)` — was L3578
- Plus any plaid-table CRUD if exists

**Total: ~22 functions, ~330 LOC.**

### Part A: out of scope

- Marketing campaigns (`createMarketingCampaign` etc.) — STAY in residual per v2-plan.md line 153. Not accounting.
- Visa applications — STAY in residual.
- Affiliate clicks — STAY in residual.

## Procedure

### Step 1 — Verification grep + line-budget audit

```bash
grep -nE "^export async function" server/db.ts > /tmp/2.7-db-exports-before.txt
wc -l server/db.ts  # expect ~1,240
```

Confirm the ~22 accounting functions exist + line ranges.

### Step 2 — Create `server/db/accounting.ts`

```ts
// server/db/accounting.ts — extracted from server/db.ts in v2 Wave 2 Module 2.7.
//
// Owns: accountingEntries + invoices + recurringExpenses + aiQuotes +
// plaid-bound transaction helpers. Read-heavy from admin accounting tab;
// year-end export is critical for tax filing — handle migrations carefully.

import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import {
  accountingEntries, InsertAccountingEntry, AccountingEntry,
  invoices, InsertInvoice, Invoice,
  recurringExpenses, InsertRecurringExpense, RecurringExpense,
  aiQuotes, InsertAiQuote, AiQuote,
} from "../../drizzle/schema";
import { getDb, type DrizzleTx } from "../db";

// === Accounting entries ===
// ...
```

### Step 3 — Modify `server/db.ts` (Part A: extract; Part B: residual cleanup)

**Part A actions:**
1. Delete the ~22 accounting function bodies.
2. Add 7th and FINAL shim line:

```ts
// === v2 Wave 2 Module 2.1-2.7 — domain extractions (D2 locked) ===
// See server/db/<domain>.ts. db.ts retains lazy `getDb()` + residual helpers
// (visa, inquiries, customTourRequests, agents, marketing, affiliate, newsletter)
// that didn't warrant a dedicated module under the 7-file rule.
export * from "./db/booking";
export * from "./db/tour";
export * from "./db/user";
export * from "./db/payment";
export * from "./db/log";
export * from "./db/search";
export * from "./db/accounting";
```

**Part B actions:**

3. Replace `db.ts`'s legacy file header (the old docstring + ad-hoc banners) with this new header at the top of the file:

```ts
/**
 * server/db.ts — Drizzle DB access layer.
 *
 * Post v2 Wave 2 refactor (2026-05-xx): the original 3,584-LOC monolith is
 * split into 7 domain modules under `server/db/`:
 *
 *   booking.ts     — bookings + bookingParticipants + payments CRUD (Module 2.1)
 *   tour.ts        — tours + tourDepartures + calibration (Module 2.2)
 *   user.ts        — users + auth + favorites + browsing history (Module 2.3)
 *   payment.ts     — vouchers + packpoint + refunds (Module 2.4)
 *   log.ts         — audit + LLM + agent action logs (Module 2.5)
 *   search.ts      — imageLibrary + destinations + competitor + price comparisons (Module 2.6)
 *   accounting.ts  — accountingEntries + invoices + recurringExpenses + aiQuotes (Module 2.7)
 *
 * This file (`db.ts`) keeps:
 *   1. `getDb()` lazy pool factory
 *   2. `DrizzleTx` type export
 *   3. Residual helpers that don't fit the 7 domains:
 *        - newsletter subscribers
 *        - marketing campaigns / materials
 *        - visa applications + status history
 *        - inquiries + inquiry messages
 *        - affiliate clicks
 *        - agent retrospective records (if not moved to log.ts)
 *
 * To add a new query helper:
 *   - If it belongs to one of the 7 domains, add it to that domain file.
 *   - If it's a brand-new domain that doesn't fit, add it here AND open a
 *     v3 backlog ticket to evaluate whether a new domain file is warranted.
 *
 * Audit ref: v2-audit-2026-05-19.md §C; D2 lock (v2-plan.md).
 */
```

4. **Verify** `wc -l server/db.ts` ≤800. If higher, residual is too fat → escalate.

5. **Update `CLAUDE.md` §六** — change the relevant row:

```diff
- | 資料庫查詢 | `server/db.ts` |
+ | 資料庫查詢 | `server/db.ts` (shim + residual ≤800 LOC) + `server/db/{booking,tour,user,payment,log,search,accounting}.ts` (v2 Wave 2) |
```

### Step 4 — Create smoke test

```ts
// server/db/accounting.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", async () => {
  const actual = await vi.importActual<typeof import("../db")>("../db");
  return { ...actual, getDb: vi.fn().mockResolvedValue(null) };
});

import {
  createAccountingEntry,
  getAccountingEntries,
  getInvoiceById,
  createAiQuote,
} from "./accounting";

describe("db/accounting", () => {
  it("exports accounting + invoice + aiQuote functions", () => {
    expect(typeof createAccountingEntry).toBe("function");
    expect(typeof getAccountingEntries).toBe("function");
    expect(typeof getInvoiceById).toBe("function");
    expect(typeof createAiQuote).toBe("function");
  });

  it("getInvoiceById returns null when DB not init", async () => {
    expect(await getInvoiceById(1)).toBeNull();
  });
});
```

### Step 5 — Verify

```bash
NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
pnpm test server/db/accounting.test.ts
pnpm test  # full regression — Wave 2 Module 2.1's verification gate
```

### Step 6 — Wave 2 verification gate (this is the closing module)

Per v2-plan.md lines 233-241:

- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` green + 7 new files' tests pass (Module 2.1-2.7 cumulative)
- [ ] `wc -l server/db.ts` ≤800
- [ ] All 7 `db/*.ts` files exist + tested
- [ ] Manual smoke: full booking flow (creates booking + payment + voucher debit + audit log + accounting entry) end-to-end on staging — exercises 5 of 7 split files in one transaction

### Step 7 — Update v2-progress.md

Mark Wave 2 Module 2.1 (the parent) as COMPLETE in the progress tracker.

## Acceptance Criteria

**Part A:**
- [ ] `server/db/accounting.ts` exists with ~22 named exports
- [ ] `server/db/accounting.ts` ≤400 LOC
- [ ] `server/db/accounting.test.ts` exists with 1+ passing test
- [ ] `server/db.ts` has 7 `export * from` lines (final structure)
- [ ] `server/db.ts` reduces ≥300 LOC in this module

**Part B (the closing gate):**
- [ ] `server/db.ts` ≤800 LOC total (down from 3,584 — 78% reduction)
- [ ] `server/db.ts` header rewritten with the structure-documenting docstring above
- [ ] CLAUDE.md §六 updated to reference the 7-file split
- [ ] No export name collisions across all 7 `db/*.ts` files
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression-anchor pass count + 7 new smoke tests pass
- [ ] **Wave 2 verification gate**: full booking flow exercises 5 of 7 files end-to-end on staging without regression

## Deliverable

**Part A:**
- New: `server/db/accounting.ts`, `server/db/accounting.test.ts`
- Modified: `server/db.ts`

**Part B:**
- Modified: `server/db.ts` (header docstring + shim block)
- Modified: `CLAUDE.md` (§六 row)
- Modified: `docs/refactor/v2-progress.md` (Module 2.1 row marked COMPLETE)

**Two commits (one per part for clean rollback granularity):**

Commit 1:
```
refactor(db): v2 Wave 2 Module 2.7A — extract accounting domain from db.ts

Seventh and final extraction in the D2-locked 7-file db.ts split.

- server/db/accounting.ts: 22 functions (accountingEntries + invoices +
  recurringExpenses + aiQuotes) verbatim. `tx?` preserved.
- server/db/accounting.test.ts: smoke + null-DB.
- server/db.ts: ~1,240 → ~910 LOC; 7 shim lines (FINAL).

Audit ref: v2-audit §C; v2-plan.md Module 2.1 line 150.
```

Commit 2:
```
refactor(db): v2 Wave 2 Module 2.7B — db.ts residual cleanup + docs

Closes the 7-file db.ts split (Modules 2.1-2.7). server/db.ts becomes
a shim + residual helpers file (~800 LOC) with a clear docstring
documenting the 7-domain structure.

- server/db.ts: header rewritten; ~910 → ~800 LOC (after dropping legacy
  banner comments + ad-hoc helper docs)
- Residual content: newsletter + marketing + visa + inquiries +
  customTourRequests + agents + affiliate (per v2-plan.md line 153)
- CLAUDE.md §六: row updated to reference 7-file split
- docs/refactor/v2-progress.md: Module 2.1 (parent) marked COMPLETE

Wave 2 verification gate: full booking flow (booking + payment + voucher
debit + audit log + accounting entry) verified on staging.

db.ts: 3,584 → ~800 LOC (78% reduction). The 7-file split unlocks Wave 3
sub-router work (no more giant import-surface concerns).

Audit ref: v2-audit §C; v2-plan.md lines 139-155; Wave 2 closing.
```

## Rollback

- Two commits → revert in reverse order. `git revert <commit-2-SHA>` first (restores header + CLAUDE.md), then `git revert <commit-1-SHA>` (restores accounting bodies).
- All 7 `db/*.ts` files orphaned if both commits revert.
- Modules 2.2-2.6 commits stay applied — only 2.7 reverts. Wave 2 marked PARTIAL in v2-progress.md.

## Manual intervention

- **Jeff (REQUIRED):** review BOTH commits before push. Especially:
  - The header docstring on `db.ts` — confirm it accurately describes the 7-file structure.
  - The CLAUDE.md §六 row update.
- **Jeff (REQUIRED):** run the Wave 2 verification gate on staging — full booking flow + admin accounting tab + invoice generation.
- **Supervisor:** verify zero export name collisions:
  ```bash
  grep -oE "^export (async )?function ([a-zA-Z]+)" server/db/*.ts \
    | awk -F'[ (]' '{print $NF}' | sort | uniq -d
  # expect empty
  ```
- **Supervisor:** verify `wc -l server/db.ts` ≤800 (this is the entry gate for "Wave 2 Module 2.1 complete").

## Test plan

- 1 new Vitest in accounting.test.ts (2+ cases)
- Full regression run
- **Wave 2 verification gate (Jeff)**: end-to-end booking flow on staging:
  1. Create test tour + departure
  2. Customer creates booking + stripeCheckout → payment confirmed (webhook)
  3. Verify: booking row + payment row + accountingEntry row + auditLog row all created
  4. Admin issues a voucher to the customer → packpoint balance updates
  5. Open admin accounting tab → year-end export downloads without error
  6. All read paths render in <2s

## Decisions needed (Jeff)

| # | Decision | Default if Jeff defers |
|---|---|---|
| D2.7-a | Should the residual `db.ts` ever shrink further (v3) by extracting newsletter/marketing/visa/affiliate/inquiries to their own files? | **No urgency.** v2-plan.md line 153 explicitly allows them in residual. Revisit in v3 only if `db.ts` grows back past 1000 LOC. |
| D2.7-b | CLAUDE.md row format — single line ("(7-file split)") vs multi-row table? | **Single line.** Keeps §六 readable. Detail belongs in v2-plan.md and the db.ts docstring itself. |

**This module CLOSES Wave 2 Module 2.1 (parent).** After commit, supervisor dispatches Module 2.8 (TourDetailPeony) which is parallelize-safe.
