# v2 · Wave 2 · Module 2.3 — Split `server/db.ts` (user domain extraction)

**Parent plan:** docs/refactor/v2-plan.md (Wave 2 · Module 2.1 D2 split, 3rd of 7)
**Audit ref:** v2-audit-2026-05-19.md §C lines 139-160; v2-plan.md line 146
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO (blocked on Module 2.2 commit)
**Est. effort:** 1.5 h AI + 10 min Jeff review
**Risk tier:** LOW-MEDIUM — auth-adjacent (password resets, login attempts). Wrong export breaks login.
**Deploy window:** any morning after 2.2 stable for ≥4h.

> **CRITICAL SEQUENCING:** Starts ONLY after Module 2.2 is committed AND green.

## Goal

Extract **user-domain query helpers** (users + customerProfiles + membership) from `server/db.ts` (~2,610 LOC post-2.2) into `server/db/user.ts` (≤300 LOC). Add shim line. Vitest smoke.

## Pre-requisites

- Modules 2.1 + 2.2 committed, tests green
- `server/db/booking.ts` + `server/db/tour.ts` exist
- `server/db.ts` shim block has 2 `export *` lines

## Inputs (read these before executing)

1. **Post-2.2 `server/db.ts`** — confirm line ranges via `grep -nE "^export async function" server/db.ts`. User functions cluster at the top (originally L76-L383).
2. **`drizzle/schema.ts`** — `users` table (incl. password reset cols, login attempt cols) + `customerProfiles` if exists + `userFavorites` + `userBrowsingHistory`. Verify scope.
3. **`server/db/booking.ts`** + `server/db/tour.ts` — pattern templates.

## Scope (what this module owns)

| File | Action | Target LOC |
|---|---|---|
| `server/db/user.ts` (new) | User CRUD + auth helpers + favorites + browsing history | ≤300 |
| `server/db/user.test.ts` (new) | 1 Vitest case | ≤80 |
| `server/db.ts` (modified) | Delete moved bodies; add 3rd shim line | reduces ~320 LOC |

### Functions to extract → `server/db/user.ts`

Re-grep before execution. Expected:

**Users core:**
- `upsertUser(user)` — was L76
- `getUserById(id)` — was L142
- `getUserByOpenId(openId)` — was L154
- `getUserByEmail(email)` — was L166
- `getUserByGoogleId(googleId)` — was L178
- `getUserByResetToken(token)` — was L190
- `createUserWithPassword(data)` — was L202
- `createUserWithGoogle(data)` — was L249
- `linkGoogleAccount(userId, googleId)` — was L293
- `setPasswordResetToken(userId, token, expires)` — was L306
- `updatePassword(userId, hashed)` — was L318
- `clearPasswordResetToken(userId)` — was L327
- `incrementLoginAttempts(userId, attempts)` — was L342
- `lockUserAccount(userId, lockoutUntil)` — was L356
- `resetLoginAttempts(userId)` — was L371
- `deleteUser(userId)` — was L383

**User profile updates:**
- `updateUserProfile(...)` — was L1290
- `updateUserAvatar(...)` — was L1322

**User favorites:**
- `addFavorite(userId, tourId)` — was L2062
- `removeFavorite(userId, tourId)` — was L2084
- `isFavorite(userId, tourId)` — was L2106
- `getUserFavorites(userId)` — was L2129
- `getUserFavoriteIds(userId)` — was L2162

**User browsing history:**
- `recordBrowsingHistory(userId, tourId)` — was L2181
- `getUserBrowsingHistory(userId, limit)` — was L2225
- `clearBrowsingHistory(userId)` — was L2259

**Total: ~26 functions, ~320 LOC.**

### Out of scope

- **Newsletter subscribers** (`createNewsletterSubscriber` etc.) — newsletter is its own concern, leave inline in db.ts for Module 2.7 final or extract to a new `db/newsletter.ts` if it grows. v2-plan.md doesn't allocate it to any 7-file slot; leave for 2.7 to decide.
- **Membership** — if `userMembership` table queries exist, they could go here OR in `db/payment.ts` (Module 2.4). Sub-agent: grep `grep -nE "userMembership|membership" server/db.ts`. If found, recommend placement to supervisor.

## Procedure

### Step 1 — Verification grep

```bash
grep -nE "^export async function" server/db.ts > /tmp/2.3-db-exports-before.txt
wc -l server/db.ts  # expect ~2,610
```

### Step 2 — Create `server/db/user.ts`

```ts
// server/db/user.ts — extracted from server/db.ts in v2 Wave 2 Module 2.3.
//
// Owns: users CRUD + password-reset + login-attempt tracking + Google OAuth
// linking + user profile/avatar + favorites + browsing history.
// Newsletter subscribers and membership-payment helpers explicitly NOT here
// (membership → potentially db/payment.ts; newsletter → db.ts residual).

import { eq, and, desc, sql } from "drizzle-orm";
import {
  users, InsertUser,
  userFavorites, UserFavorite, InsertUserFavorite,
  userBrowsingHistory, UserBrowsingHistory, InsertUserBrowsingHistory,
  tours, Tour,  // joined for getUserFavorites / getUserBrowsingHistory
} from "../../drizzle/schema";
import { getDb } from "../db";

// === Users CRUD + auth ===
export async function upsertUser(user: InsertUser): Promise<void> { /* verbatim */ }
// ... etc
```

### Step 3 — Modify `server/db.ts`

1. Delete 26 function bodies (grep first for current line ranges).
2. Add shim line:

```ts
export * from "./db/booking";
export * from "./db/tour";
export * from "./db/user";  // ← new in Module 2.3
```

3. Verify `wc -l server/db.ts` ≤2,290.

### Step 4 — Create smoke test

```ts
// server/db/user.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", async () => {
  const actual = await vi.importActual<typeof import("../db")>("../db");
  return { ...actual, getDb: vi.fn().mockResolvedValue(null) };
});

import { getUserById, getUserByEmail, isFavorite } from "./user";

describe("db/user", () => {
  it("exports core user functions", () => {
    expect(typeof getUserById).toBe("function");
    expect(typeof getUserByEmail).toBe("function");
    expect(typeof isFavorite).toBe("function");
  });

  it("getUserById returns undefined when DB not initialized", async () => {
    expect(await getUserById(1)).toBeUndefined();
  });
});
```

### Step 5 — Verify

```bash
pnpm tsc --noEmit
pnpm test server/db/user.test.ts
pnpm test  # regression
```

### Step 6 — Smoke

- Login flow: `pnpm dev` + try login → `getUserByEmail` hits.
- Add a favorite on a tour detail page → `addFavorite` hits.

## Acceptance Criteria

- [ ] `server/db/user.ts` exists; 26 named exports
- [ ] `server/db/user.ts` ≤300 LOC
- [ ] `server/db/user.test.ts` exists with 1+ passing test
- [ ] `server/db.ts` has 3 `export * from` lines
- [ ] `server/db.ts` reduces ≥280 LOC
- [ ] No export collisions: `db/booking.ts` + `db/tour.ts` + `db/user.ts` exported names disjoint
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` green
- [ ] Manual: login flow + add favorite both work

## Deliverable

- New: `server/db/user.ts`, `server/db/user.test.ts`
- Modified: `server/db.ts`

**Commit:**
```
refactor(db): v2 Wave 2 Module 2.3 — extract user domain from db.ts

Third sub-task in the D2-locked 7-file db.ts split.

- server/db/user.ts: 26 functions (users CRUD, auth, favorites, browsing
  history) verbatim. ~320 LOC.
- server/db/user.test.ts: smoke + null-DB.
- server/db.ts: ~2,610 → ~2,290 LOC; 3 shim lines now.

Newsletter + membership helpers explicitly NOT extracted; deferred to
2.4 (payment.ts) or 2.7 (final) per scope decisions.

Audit ref: v2-audit §C; v2-plan.md Module 2.1.
```

## Rollback

`git revert <SHA>`. Restores post-2.2 state. `db/user.ts` orphans.

## Manual intervention

- **Jeff:** spot-check login + favorite-add work post-deploy.
- **Supervisor:** name-collision grep across all 3 db/* files.

## Test plan

- 1 Vitest, 2 cases (exports + null-DB)
- Full regression
- Manual: login + favorite

## Decisions needed (Jeff)

| # | Decision | Default if Jeff defers |
|---|---|---|
| D2.3-a | `customerProfiles` table (autonomous-agent learned preferences) — extract here or own file? Grep schema first. | **In user.ts** if exists; profile is per-user data. |
| D2.3-b | Newsletter helpers — leave in db.ts residual (Module 2.7) or extract here? | **Leave in residual.** Newsletter has its own router; helpers can stay flat. |

**Must be committed before Module 2.4 starts.**
