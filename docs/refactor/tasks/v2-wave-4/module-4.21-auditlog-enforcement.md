# v2 · Wave 4 · Module 4.21 — Enforce `auditLog` on all admin mutations

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Polish, §Module 4.24)
**Audit ref:** v2-audit-2026-05-19.md §G (security — 33 of 37 admin routers missing audit log; only ~10 of 33 routers currently write auditLog rows per line 418)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 8 h AI + 30 min Jeff review
**Deploy window:** Tuesday/Wednesday morning — modifies `adminProcedure` middleware; touch is wide

## Goal

Refactor `server/trpc.ts` `adminProcedure` definition so every admin **mutation** auto-writes a row to `auditLog` (input snapshot, user ID, timestamp, route path) — and remove now-duplicate ad-hoc `auditLog.insert(...)` calls in the ~10 routers that did it manually. Read-only `query` procedures DO NOT write to auditLog (noise).

## Pre-requisites

- Wave 1 Module 1.7 (admin rate-limit middleware) merged — same `adminProcedure` middleware seam.
- Wave 1 Module 1.2 (pino) merged — failures log structured.
- Wave 2 Module 2.1 (db.ts split) merged — `auditLog` writes go through `server/db/log.ts` (post-split).

## Inputs (read these before executing)

- `server/trpc.ts` — `adminProcedure` definition; existing middleware chain.
- `drizzle/schema.ts` — `auditLog` table shape (likely has `userId`, `action`, `targetType`, `targetId`, `metadata` JSON, `createdAt`).
- All 33 admin router files (`grep -l adminProcedure server/routers/*.ts`).
- The ~10 routers currently writing auditLog (audit §G line 418 lists 10 of 33).

## Scope (what this module owns)

- ✅ `server/trpc.ts` — extend `adminProcedure` mutation middleware to auto-write `auditLog`.
- ✅ Identify and remove duplicate audit calls in the ~10 routers that did it manually.
- ✅ Redact known PII keys from logged input (passport, token, password, etc.).
- ✅ Vitest covering the middleware behavior.
- ❌ NOT in scope: changing `auditLog` schema; adding query-side audit (out of scope intentionally — too noisy).

## Procedure

1. **Read `server/trpc.ts`** — locate `adminProcedure` definition and middleware chain.

2. **Read `drizzle/schema.ts` `auditLog`** — verify columns. Likely:
   ```ts
   auditLog: {
     id: int, userId: int, action: varchar(255), targetType: varchar(64),
     targetId: int, metadata: json, createdAt: datetime
   }
   ```

3. **Extend `adminProcedure`:**
   ```ts
   import { auditLog } from '../drizzle/schema';
   import { db } from './db';
   import { logger } from './_core/logger';

   const REDACT_KEYS = new Set(['passportNumber', 'password', 'accessToken', 'refreshToken', 'apiKey', 'secret']);
   function redact(input: any): any {
     if (!input || typeof input !== 'object') return input;
     const result: any = Array.isArray(input) ? [] : {};
     for (const k in input) {
       if (REDACT_KEYS.has(k)) result[k] = '[REDACTED]';
       else if (typeof input[k] === 'object') result[k] = redact(input[k]);
       else result[k] = input[k];
     }
     return result;
   }

   export const adminProcedure = t.procedure
     .use(adminAuthMiddleware)
     .use(adminRateLimitMiddleware) // Wave 1 Module 1.7
     .use(async ({ ctx, type, path, input, next }) => {
       const result = await next();
       // Only log mutations on success
       if (type === 'mutation' && result.ok) {
         try {
           await db.insert(auditLog).values({
             userId: ctx.user.id,
             action: path,
             targetType: 'trpc.mutation',
             metadata: { input: redact(input) },
           });
         } catch (err) {
           logger.warn({ err, path }, 'auditLog write failed');
           // Do NOT throw — audit failure should not block business logic
         }
       }
       return result;
     });
   ```

4. **Find and remove duplicate ad-hoc audit calls:**
   ```bash
   grep -rn "auditLog" server/routers/ | grep -v test
   ```
   For each manual `db.insert(auditLog).values(...)` call inside an `adminProcedure.mutation`, **delete the manual call** (the middleware now handles it). For audit calls that need richer metadata than `{input}`, **keep the manual call** but the middleware row is now redundant — consider adding a sentinel marker to skip middleware for that procedure (`opts.meta?.skipAutoAudit = true`).

5. **Schema sanity check:** `auditLog.metadata` should be JSON / TEXT. If it's `VARCHAR(255)`, large inputs truncate — flag for follow-up migration.

6. **Edge cases:**
   - Mutations that return early (e.g., `if (notAllowed) throw`) — `next()` throws; result.ok false; we skip audit (good).
   - Mutations that succeed but indicate failure in payload — e.g., `return { ok: false }`. Decision: log anyway (the mutation ran). Recommend: log if `type === 'mutation'` regardless of payload "ok" field; rely on procedure-level `throw` for failure-skip.

7. **Test:**
   ```ts
   it('auditLog row written for admin mutation', async () => {
     const insertSpy = vi.spyOn(db, 'insert');
     await trpc.someAdminMutation.mutate({...});
     expect(insertSpy).toHaveBeenCalledWith(auditLog);
   });
   it('auditLog NOT written for admin query', async () => {
     const insertSpy = vi.spyOn(db, 'insert');
     await trpc.someAdminQuery.query();
     expect(insertSpy).not.toHaveBeenCalledWith(auditLog);
   });
   it('PII redacted in metadata', async () => {
     const insertSpy = vi.spyOn(db, 'insert');
     await trpc.updateCustomerPassport.mutate({ passportNumber: 'P12345678' });
     const arg = insertSpy.mock.calls[0][1];
     expect(arg.metadata.input.passportNumber).toBe('[REDACTED]');
   });
   ```

8. **Smoke test on staging:**
   - Trigger an admin mutation (e.g., archive an inquiry from Module 4.10's mobile call) → verify `auditLog` row in DB.
   - Trigger an admin query (e.g., list bookings) → verify NO auditLog row.
   - Trigger a mutation with passport in input → verify metadata's passportNumber field is `[REDACTED]`.

## Acceptance Criteria

- [ ] `server/trpc.ts` `adminProcedure` middleware writes auditLog row on every successful mutation.
- [ ] PII redaction (passportNumber, password, accessToken, refreshToken, apiKey, secret) verified in metadata field.
- [ ] Read-only queries DO NOT write to auditLog.
- [ ] Duplicate manual audit calls in the ~10 routers removed (verify via grep returning fewer matches than baseline).
- [ ] Audit failure does NOT block the mutation — middleware catches and logs warning via pino.
- [ ] **Tests:** `server/trpc.test.ts` (new or extend) — 3 cases (mutation logs, query doesn't, redaction works). **Required per CLAUDE.md §九.**
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] `pnpm test` green.
- [ ] Smoke: staging audit log row appears for a representative mutation.

## Deliverable

- Modified: `server/trpc.ts`, ~10 router files (remove duplicate audit calls), `server/trpc.test.ts` (or new file).

**Commit message:**

```
feat(audit): Wave 4 module 4.21 — auto-write auditLog from adminProcedure

- adminProcedure middleware writes auditLog row on every successful mutation
- PII redaction (passportNumber, password, accessToken, refreshToken,
  apiKey, secret) inside metadata.input
- Audit failure is logged-warn only, NEVER blocks business logic
- Removed 10 duplicate manual auditLog.insert() calls in routers
- 3 Vitest cases: mutation-logs, query-doesn't, redaction

Audit §G impact: 10 of 33 → 33 of 33 admin routers now write auditLog.

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.21, audit §G
```

## Rollback

- Single revert restores middleware. Existing auditLog rows remain in DB.
- If middleware crashes a mutation despite try/catch (shouldn't), emergency revert restores per-router pattern.

## Manual intervention

- **Jeff (~10 min):** post-deploy, run an admin mutation on staging (e.g., create a tour) → query `auditLog WHERE userId = jeffId ORDER BY createdAt DESC LIMIT 5` → confirm row appears.
- **Jeff (~5 min):** spot-check redaction — trigger a mutation with `passportNumber` in input → confirm metadata.input.passportNumber === `'[REDACTED]'`.

## Test plan

**Vitest:** `server/trpc.test.ts` (new file or extend existing) — 3 cases (mock `db.insert`):

1. **Mutation logs:** call a fixture admin mutation → assert `db.insert(auditLog)` called with right shape.
2. **Query doesn't log:** call a fixture admin query → assert `db.insert(auditLog)` NOT called.
3. **PII redaction:** call mutation with passport in input → assert metadata.input.passportNumber === `'[REDACTED]'`.

**Regression anchor:** `pnpm test` count unchanged + 3 new cases.

**Manual smoke:** staging — verify auditLog row count grows when admin actions taken.

## Decisions needed (Jeff)

1. **Per-procedure opt-out** — current design: middleware runs on every adminProcedure mutation. If Jeff wants to exempt specific procedures (e.g., bulk imports that produce thousands of rows), add `meta: { skipAutoAudit: true }` marker. Recommend defer; revisit if any procedure causes audit row spam.
2. **REDACT_KEYS list** — current 6 keys. Add more if PII surface grows. Lock for v2.
3. **Audit failure handling** — current is warn-and-continue. Alternative: strict mode where audit failure blocks the mutation. Recommend warn (current) — audit is logging, not gatekeeping; gatekeep elsewhere.
4. **Metadata size cap** — if `input` is large (e.g., a 50KB JSON tour body), the audit row gets big. Recommend cap input snapshot at 10KB; truncate with marker. Defer to follow-up if seen in practice.
