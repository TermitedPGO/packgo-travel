# v2 · Wave 1 · Module 1.8 — Passport encryption + migration 0078

**Parent plan:** docs/refactor/v2-plan.md (Wave 1 · Module 1.8)
**Audit ref:** v2-audit-2026-05-19.md §G "PII inventory" (lines 411-422) — "Passport numbers stored plaintext" + §G "Red-team round 1-7 deferred items" (line 437) "❌ Passport number encryption"
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 6h AI + 15min Jeff (review SQL + APP_ENCRYPTION_KEY confirmation)

## Goal
Encrypt-at-rest the `passportNumber` plaintext values in `bookingParticipants` (line 728 of schema.ts) and `chinaVisaApplications` (line 1858). Reuse the existing `server/_core/tokenCrypto.ts` AES-256-GCM envelope (already used for Gmail + Plaid tokens). No schema change required — column type stays `VARCHAR(50)` since `enc:v1:...` ciphertext fits. Add transparent legacy-plaintext fallback so old rows keep working until a one-shot backfill SQL re-encrypts them in 100-row batches. After this module, a hypothetical DB dump no longer exposes 50+ customer passports.

## Pre-requisites
- Working tree clean.
- **Module 1.1 (Sentry) preferable** — backfill should report progress; if it errors mid-run, Sentry captures.
- `APP_ENCRYPTION_KEY` env var is **already set in production** (Gmail/Plaid currently use it). Confirm — without this, all writes/reads break. Jeff verifies before deploy.
- v1 db.ts split is NOT a prerequisite — this module touches `db.ts` (or its post-split successor `db/visa.ts` / `db/booking.ts`) but at present (pre-Wave 2) db.ts is still monolithic.

## Inputs (read these before executing)
- `server/_core/tokenCrypto.ts` (full ~110 LOC) — read the entire file. Note:
  - `encryptToken(plain: string): string` — returns `"enc:v1:" + base64(iv|tag|ciphertext)`.
  - `decryptToken(stored: string): string` — looks for `enc:v1:` prefix; if absent, **returns input as-is** (legacy plaintext path). This is exactly the migration strategy we need.
  - Keys: `APP_ENCRYPTION_KEY` (preferred), `PLAID_ENCRYPTION_KEY` (fallback). Same key used here.
- `drizzle/schema.ts` line 728 — `bookingParticipants.passportNumber: varchar("passportNumber", { length: 50 })`. Confirm length: ciphertext is ~96 chars (base64 of IV+tag+ciphertext). **VARCHAR(50) is too short.** Migration must widen to **VARCHAR(255)** at minimum.
- `drizzle/schema.ts` line 1858 — `chinaVisaApplications.passportNumber: varchar("passportNumber", { length: 50 }).notNull()`. Same widening.
- `server/db.ts` (3,584 LOC) — locate functions that **read** or **write** `passportNumber`:
  - `grep -n "passportNumber" server/db.ts` to find all touch points. **Pre-Wave 2 split, db.ts is monolithic.** Possible functions: `createBooking`, `updateBookingParticipant`, `getBookingParticipants`, `getBookingById`, `createChinaVisaApplication`, `getChinaVisaApplicationById`, etc.
- `server/routers/visa.ts` line 92 — `passportNumber: input.passportNumber` (write site). Currently plaintext.
- `server/routers/bookings.ts` — locate participant creation/update; verify it goes through `server/db.ts`.
- `server/services/visaEmailService.ts` — locate any `passportNumber` reads (e.g., for email content) — must decrypt.
- `server/_core/stripeWebhook.visa.test.ts` + `server/_core/stripeWebhook.ts` — verify webhook payloads handling visa applications don't break.
- Audit ref `v2-audit-2026-05-19.md` lines 411-447 (full §G).

## Scope (what this module owns)
1. **New file: `drizzle/0078_passport_encryption.sql`** — widens both columns:
   ```sql
   ALTER TABLE bookingParticipants MODIFY COLUMN passportNumber VARCHAR(255);
   ALTER TABLE chinaVisaApplications MODIFY COLUMN passportNumber VARCHAR(255) NOT NULL;
   ```
   No data manipulation here; backfill SQL is a separate idempotent script (see #5).
2. **New file: `drizzle/0078_passport_encryption.down.sql`** — narrows back. **DESTRUCTIVE if any ciphertext rows exist** (they'd truncate). Document this caveat in the file's header comment.
3. **Modified: `drizzle/schema.ts`** — change both `passportNumber` columns from `{ length: 50 }` to `{ length: 255 }`.
4. **Modified: `server/db.ts`** — wrap every `passportNumber` write site with `encryptToken(value)`; every read site with `decryptToken(value)`. Specifically:
   - **Write sites:** `createBooking` or whichever function inserts into `bookingParticipants`; `createChinaVisaApplication` (or equivalent). Audit via `grep -n "passportNumber" server/db.ts`.
   - **Read sites:** any `SELECT ... passportNumber ...` that maps to a returned object — wrap the result.
   - **DO NOT** wrap at the database driver level (too risky — easy to miss a path).
5. **New file: `server/scripts/backfill-passport-encryption.ts`** — one-shot batched migration:
   ```ts
   // For each table (bookingParticipants, chinaVisaApplications):
   //   SELECT id, passportNumber WHERE passportNumber NOT LIKE 'enc:v1:%' LIMIT 100
   //   FOR EACH row: encrypted = encryptToken(plaintext); UPDATE ... SET passportNumber = encrypted
   //   REPEAT until 0 rows
   ```
   Run via `pnpm tsx server/scripts/backfill-passport-encryption.ts` (manual one-shot post-deploy). **Idempotent** — re-running is safe; only rows without the prefix get processed.
6. **NO change to read-path fallback** — `decryptToken` already returns plaintext when `enc:v1:` prefix absent. This means legacy rows still work until backfill runs.
7. **CLAUDE.md §六** — add `server/scripts/backfill-passport-encryption.ts` row + note that `passportNumber` is encrypted at rest.
8. **CLAUDE.md §四 禁止事項** — add a forbidden pattern:
   ```
   // ❌ 禁止：直接讀寫 passportNumber 未加密
   //   應在 db.ts 層用 encryptToken/decryptToken 包覆
   ```
9. **Vitest:** round-trip encrypt/decrypt; legacy plaintext still readable; post-backfill row matches plaintext.

## Procedure
1. **Read** all input files. Inventory all `passportNumber` read/write sites in `server/db.ts`:
   ```bash
   grep -n "passportNumber" server/db.ts
   ```
   Expect ~5-10 sites. Make a list before editing.
2. **Read `server/_core/tokenCrypto.ts`** end-to-end to confirm API.
3. **Edit `drizzle/schema.ts`** — widen both columns to `VARCHAR(255)`.
4. **Generate migration:**
   ```bash
   pnpm drizzle-kit generate
   ```
   Verify it produces `ALTER TABLE ... MODIFY COLUMN passportNumber VARCHAR(255)` for both tables. Rename file to `0078_passport_encryption.sql` if drizzle's auto-name differs.
5. **Create `.down.sql`** with warning header about ciphertext truncation.
6. **Edit `server/db.ts`:**
   - Top import: `import { encryptToken, decryptToken } from "./_core/tokenCrypto";`
   - For each WRITE site (insert/update of `passportNumber`): `encryptToken(input.passportNumber)`.
   - For each READ site (select that maps to a returned object): apply `decryptToken` to the returned field. Easiest pattern — wrap the returning helper, e.g.:
     ```ts
     function decryptParticipant(p: BookingParticipant): BookingParticipant {
       return { ...p, passportNumber: p.passportNumber ? decryptToken(p.passportNumber) : null };
     }
     ```
     Apply to every list/get function returning participants or visa applications.
7. **Run** `pnpm tsc --noEmit` after each batch of edits.
8. **Create `server/scripts/backfill-passport-encryption.ts`:**
   - Iterate the two tables.
   - Use `LIMIT 100` per batch.
   - Sleep 100ms between batches (don't slam DB).
   - Log progress to console (or `logger` once Module 1.2 lands).
   - Idempotent: `WHERE passportNumber NOT LIKE 'enc:v1:%'`.
   - Exit code: 0 on success, 1 if any row fails.
9. **Update CLAUDE.md** §四 + §六.
10. **Write Vitest** (see Test plan).
11. **Verify:**
    ```bash
    NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
    pnpm test passport
    pnpm test bookings
    pnpm test visa
    ```

## Acceptance Criteria
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` all green (+ new Vitest)
- [ ] **Per CLAUDE.md §九:** new Vitest at `server/_core/passportEncryption.test.ts` (or equivalent integration test):
  1. Write → DB row contains `enc:v1:...`; read → returns plaintext.
  2. Pre-existing plaintext row (mocked DB state) → read returns plaintext (legacy fallback).
  3. Backfill script processes plaintext row → row now starts with `enc:v1:`; reading still returns original plaintext.
- [ ] All read sites for `passportNumber` go through `decryptToken`.
- [ ] All write sites for `passportNumber` go through `encryptToken`.
- [ ] `drizzle/0078_passport_encryption.sql` exists; widens both columns to `VARCHAR(255)`.
- [ ] `drizzle/0078_passport_encryption.down.sql` exists with the destructive-rollback warning.
- [ ] `server/scripts/backfill-passport-encryption.ts` is idempotent (re-running on partial-completed state continues from where it left off).
- [ ] Post-deploy verification (Jeff manual):
  - `SELECT passportNumber FROM bookingParticipants LIMIT 5;` — values start with `enc:v1:` post-backfill.
  - Reading via admin UI displays correct decrypted values.
- [ ] CLAUDE.md §四 + §六 updated.

## Deliverable
- **New files:**
  - `drizzle/0078_passport_encryption.sql`
  - `drizzle/0078_passport_encryption.down.sql`
  - `server/scripts/backfill-passport-encryption.ts`
  - `server/_core/passportEncryption.test.ts` (or co-located with existing db.ts tests)
- **Modified files:**
  - `drizzle/schema.ts`
  - `drizzle/meta/_journal.json`
  - `server/db.ts` (read + write sites wrapped)
  - `CLAUDE.md`
- **Expected commit message:**
  ```
  feat(security): passport-at-rest encryption via tokenCrypto + migration 0078

  - migration 0078: widen passportNumber VARCHAR(50)→VARCHAR(255) on
    bookingParticipants + chinaVisaApplications (ciphertext is ~96
    chars; old column too narrow)
  - db.ts: all passportNumber writes via encryptToken; reads via
    decryptToken. AES-256-GCM (shared substrate with Gmail + Plaid
    tokens). Legacy plaintext rows still readable via decryptToken's
    "no enc:v1: prefix → return as-is" fallback path
  - server/scripts/backfill-passport-encryption.ts: idempotent batched
    re-encryption (100 rows/batch, 100ms pause); WHERE passportNumber
    NOT LIKE 'enc:v1:%' so safe to re-run
  - CLAUDE.md §四: new forbidden pattern (raw passport read/write);
    §六: file map updated

  Resolves audit §G "Passport numbers stored plaintext" + red-team
  round 1-7 deferred item (line 437).

  Refs: docs/refactor/v2-plan.md Wave 1 · Module 1.8
  ```

## Rollback
- **Code revert:** `git revert <SHA>`. Read sites still work (decryptToken's plaintext fallback) IF rows are still plaintext. **If backfill ran, the revert leaves encrypted rows in DB readable only by re-applying decryptToken — manual SQL UPDATE required to plaintext, but plaintext is dangerous, so DO NOT do that.**
- **DB revert:** `drizzle/0078_passport_encryption.down.sql` — **DESTRUCTIVE if backfill has run** (truncates ciphertext to 50 chars). Only safe pre-backfill.
- **Safe rollback order:** code revert first; leave migration in place; if forced, run a one-shot decrypt-all-and-shrink SQL (script not included in this module — escalate to supervisor if needed).

## Manual intervention
1. **Jeff verifies `APP_ENCRYPTION_KEY` is set in Fly secrets.** If absent, encrypting writes will throw at runtime. ~1min.
2. **Jeff reviews `0078_passport_encryption.sql`** + the .down warning (~5min). Approves.
3. **Deploy** (Wave 1 deploy window per plan calendar).
4. **Run backfill manually** (~5min for ~50-200 rows):
   ```bash
   fly ssh console -C "pnpm tsx server/scripts/backfill-passport-encryption.ts"
   ```
   Logs printed; verify completion.
5. **Verify in prod** (1min):
   - `SELECT passportNumber FROM bookingParticipants WHERE passportNumber NOT LIKE 'enc:v1:%';` — expect 0 rows.

## Test plan
- **`server/_core/passportEncryption.test.ts`** (NEW):
  - Case 1 (round-trip): `encryptToken("X12345")` → starts with `enc:v1:`; `decryptToken(that)` → `"X12345"`.
  - Case 2 (legacy fallback): `decryptToken("X12345")` (no prefix) → `"X12345"`.
  - Case 3 (db layer write+read): mock the DB; call `createChinaVisaApplication({...passportNumber: "X12345"...})`; assert stored value starts with `enc:v1:`; call get → returns `passportNumber: "X12345"`.
- **`server/scripts/backfill-passport-encryption.test.ts`** (NEW, optional):
  - Case: mock DB with mix of plaintext + encrypted rows; run script; assert all rows end with `enc:v1:` prefix; assert script is idempotent on second run.
- **Regression anchor:** existing `server/_core/stripeWebhook.visa.test.ts` must still pass — webhook reads visa data; encrypted decrypts transparently.

## Decisions needed (Jeff)
1. **Backfill timing — immediate one-shot (default per plan §1.8) vs lazy-on-read (decrypt-on-read + re-encrypt-on-write).** Default: one-shot batched right after deploy. ~50-200 rows total based on visa applications volume; should complete in <1min.
2. **`PLAID_ENCRYPTION_KEY` fallback.** tokenCrypto checks `APP_ENCRYPTION_KEY` first, then `PLAID_ENCRYPTION_KEY`. If Jeff has only one of these set in prod, this module works. Confirm which is set.
3. **Column widen 50→255 or 50→128?** Ciphertext is ~96 chars base64; 128 would suffice. 255 is safer for any future version-prefix bump. Default: 255.
4. **Backfill SSH-run vs admin-endpoint button.** Default: SSH script (one-time). If Jeff wants a button in admin UI for future migrations, that's a v3 enhancement.
5. **Audit-log the backfill run?** Default: yes, log to `auditLog` table that backfill ran with row count. Confirm.
