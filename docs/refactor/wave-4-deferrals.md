# v2 Wave 4 — Pino Logger Sweep Deferrals

**Created:** 2026-05-20 (Wave 1 Module 1.2 close-out)
**Owner:** Wave 4 Module 4.24 — Pino full sweep

## What this tracks

Module 1.2 migrated the **critical-path subset** of `console.*` calls to pino:
- `server/_core/*.ts` — all calls migrated (target: 0)
- `server/agents/autonomous/*.ts` — all calls migrated (target: 0)

This file inventories the **remaining sites** that Module 4.24 must finish.

## Remaining sites (run grep on Wave 4 entry to confirm counts)

| Location | Approx count | Notes |
|---|---|---|
| `server/routers/*` | ~700 | 40 sub-routers; each likely has 10-30 logs. Highest volume. |
| `server/services/*` | ~500 | Services + supplierSync + skills subtree |
| `server/agents/*` (non-autonomous) | ~50 | MasterAgent + content/cost/image/itinerary/etc. agents |
| `server/*.ts` (root) | ~50 | `db.ts`, `queue.ts`, `worker.ts` partial (some workers in worker.ts NOT yet migrated), `routers.ts`, etc. |
| `scripts/*.mjs` | ~150 | One-shot scripts; lower priority, can stay `console.*` if they're never going to prod. Decision in Wave 4 Module 4.23 (scripts purge). |
| **Total estimate** | **~1,250** | Confirm with grep before starting Module 4.24. |

## How to run the sweep (Module 4.24)

1. Re-run the grep:
   ```bash
   grep -rn "console\." server/ scripts/ \
     | grep -v "\.test\.ts" \
     | grep -v "node_modules" \
     | wc -l
   ```
2. Migrate file-by-file with the same patterns Module 1.2 used:
   - `console.log("msg", obj)` → `logger.info(obj, "msg")` or `logger.info({event:"...", ...fields}, "msg")`
   - `console.error("msg", err)` → `logger.error({err}, "msg")`
   - `console.warn` / `console.debug` → `logger.warn` / `logger.debug`
3. After every batch of ~10 files, run `pnpm tsc --noEmit`.
4. Final gate: grep above returns 0 (or only `scripts/` if Jeff opts to keep one-shots as-is).
5. Update CLAUDE.md §四 4.2: remove the "剩餘 ~1,250 sites" parenthetical note once 0.

## Decision deferred to Wave 4

- **`scripts/*.mjs`**: keep `console.*` (one-shot debug, not prod-loaded) or migrate for consistency? Default: keep `console.*` in `scripts/_archive/` after Module 4.23 purge; migrate only scripts that still ship.

## Related modules

- Wave 1 Module 1.2 — landed the critical-path subset (this file's parent)
- Wave 4 Module 4.23 — scripts/ purge (decides which scripts survive into Module 4.24's sweep scope)
- Wave 4 Module 4.24 — the full sweep itself

---

# Passport Backfill Deferral

**Created:** 2026-05-20 (Wave 1 Module 1.8 post-deploy)
**Owner:** Next deploy after Wave 2 (or Wave 4 cleanup module)

## Status

`server/scripts/backfill-passport-encryption.ts` exists in repo but cannot be invoked in production:

- The Fly container's `/app/server/` directory contains only `assets/` (static files); source `.ts` files are NOT shipped (Dockerfile builds via esbuild bundle → single `dist/index.js`).
- The compiled `dist/index.js` is the whole-server bundle; cannot extract + invoke `backfillPassportEncryption()` directly.
- `pnpm` is not on the container PATH, so `pnpm tsx server/scripts/...` fails too.

## Why this is OK to defer

1. **New writes** (post-v503 deploy 2026-05-20) automatically encrypt via `encryptPassport` in db.ts touch sites — verified.
2. **Legacy plaintext rows** remain readable via `decryptToken`'s no-`enc:v1:` prefix fallback (returns input as-is).
3. **TiDB at-rest encryption** + access scoped to Fly-internal credentials provides baseline protection.
4. **Volume is small** (~<50 passport rows total estimated based on visa app + booking volume).

## Fix in next deploy

**Option A (recommended):** Add a pure `.mjs` version at `scripts/backfill-passport-encryption.mjs` (no TypeScript, inline AES-256-GCM logic mirroring `tokenCrypto.ts`). Dockerfile already copies `scripts/*` (per `/app/scripts/migrate.mjs` precedent). After next deploy:

```bash
fly ssh console -a packgo-travel -C "node scripts/backfill-passport-encryption.mjs"
```

**Option B (cleaner long-term):** Modify Dockerfile to also copy `server/scripts/` directory + ship `tsx` as runtime dep (not just devDep). Then original `.ts` script runs as-is via:

```bash
fly ssh console -a packgo-travel -C "/app/node_modules/.bin/tsx server/scripts/backfill-passport-encryption.ts"
```

## Verification post-backfill

```sql
-- Should return 0 rows for fully-backfilled state
SELECT COUNT(*) FROM bookingParticipants
  WHERE passportNumber IS NOT NULL
  AND passportNumber NOT LIKE 'enc:v1:%';
SELECT COUNT(*) FROM visaApplications
  WHERE passportNumber NOT LIKE 'enc:v1:%';
```

Both backfill paths write an `adminAuditLog` row with action `passport_backfill_run` + `{rowCount, durationMs, table}` metadata.
