# v2 · Wave 4 · Module 4.18 — i18n leak sweep (1,203 hardcoded strings → `t(...)`)

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Polish, §Module 4.18)
**Audit ref:** v2-audit-2026-05-19.md §D (1,203 leaks — 640 customer-facing P0, 506 admin P2)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO — **BLOCKED by Module 4.17 (i18n restructure)**
**Est. effort:** 14 h AI + 30 min Jeff review (random-sample QA on 10-15 fixed strings)
**Deploy window:** any weekday — additive i18n keys; visual no-change in zh-TW (default) view

## Goal

Eliminate the remaining hardcoded-Chinese-string leaks across the client codebase. Wave 3 Module 3.12 covered the top-10 customer-facing offenders (~472 leaks); this module finishes:

- **Customer-facing residual:** ~170 leaks left (after Wave 3 Module 3.12 fixed the top 10).
- **Admin-side:** all 506 leaks (the audit's full admin set).

Output: ~676 new `t('key')` call sites + ~250-400 new i18n keys added under appropriate domains (post-Module-4.17 namespacing).

## Pre-requisites

- **Module 4.17 merged** — namespaced dicts make domain placement easier.
- Wave 3 Module 3.13 (i18n lint rule) merged — lint catches new leaks introduced during this module's own work.
- `scripts/i18n-audit.mjs` exists per audit §D — re-run to confirm current leak count.

## Inputs (read these before executing)

- `scripts/i18n-audit.mjs` — produces JSON leak inventory. Run before starting.
- `client/src/i18n/zh-TW/` + `en/` — Module 4.17 namespaced dicts. Add keys to the right domain file.
- `client/src/components/admin/*.tsx` — 37 admin tab files; bulk of the work.
- `client/src/pages/*.tsx` — remaining customer pages (Wave 3 Module 3.12 fixed top 10 already).
- `client/src/_core/hooks/useTranslation.ts` — `t()` function signature.

## Scope (what this module owns)

- ✅ All leaked hardcoded Chinese strings in client/src replaced with `t('domain.key')` calls.
- ✅ New i18n keys added in the appropriate `client/src/i18n/zh-TW/<domain>.ts` + `en/<domain>.ts` files.
- ✅ Admin tab files (37 files) fully de-leaked.
- ✅ Customer pages residual fully de-leaked.
- ✅ Vitest covering key-parity (continues from Module 4.17's test).
- ❌ NOT in scope: ja/ko translations of new keys (defer to v3); strings in `validationSchemas.ts` (Wave 3 Module 3.12 already covered top 10 — residual zod messages in audit §D top files); the lint rule itself (Wave 3 Module 3.13).

## Procedure

1. **Run leak audit to get fresh inventory:**
   ```bash
   node scripts/i18n-audit.mjs --json > /tmp/leaks.json
   wc -l /tmp/leaks.json
   ```
   Expected ~676 entries (1,203 - 472 fixed by Wave 3 Module 3.12 - delta from intervening work).

2. **Group leaks by file** — process by file (smaller cognitive load than by string).

3. **Per-file workflow:**
   - Read the file.
   - For each hardcoded string:
     - Pick a key path under the right domain (e.g., admin tab strings → `admin.<tabName>.<keyName>`).
     - Add to `client/src/i18n/zh-TW/admin.ts` (or relevant domain file).
     - Add English translation to `client/src/i18n/en/admin.ts`.
     - Replace JSX/string usage with `t('admin.<tabName>.<keyName>')`.
   - Save file.

4. **Priority order:**
   - **Admin tabs (37 files, 506 leaks)** — bulk; Jeff reads these daily.
   - **Customer pages residual** (~170 leaks).
   - **Reusable components** — strings inside `client/src/components/` that don't fit a single domain.

5. **English translation strategy:**
   - Use **machine translation as a first pass** (e.g., a small LLM call per batch), then **Jeff reviews ~30 critical user-facing strings** before merge.
   - For admin-only strings, machine translation is acceptable as-is (Jeff is fluent in zh-TW; en admin copy is rarely read).

6. **Examples:**
   - **Before:** `<Button>新增</Button>` → **After:** `<Button>{t('common.add')}</Button>` (already in `common.ts` likely).
   - **Before:** `<h3>客戶資訊</h3>` → **After:** `<h3>{t('admin.bookings.customerInfo')}</h3>`.
   - **Before:** `toast.success('儲存成功')` → **After:** `toast.success(t('common.savedSuccessfully'))`.

7. **Validation message gotcha:**
   Zod schemas that throw `.message: '此欄位必填'` cannot consume `t()` at definition time (modules load before i18n init). Options:
   - **Option A:** define schema with `.message: 'required'` then lookup at error-render time via `t('errors.required')`.
   - **Option B:** factory pattern — schema declared inside a hook that has `t` access.
   Most existing zod files use literal strings; switching to Option A is cleanest. Per audit §D Wave 3 Module 3.12 already addressed `validationSchemas.ts`; this module follows the established pattern.

8. **Re-run audit after batch of changes:**
   ```bash
   node scripts/i18n-audit.mjs --json | jq 'length'
   ```
   Target after completion: ≤100 (per Wave 4 verification gate). Residual ≤100 = library / build-tool strings + intentional admin-debug comments.

9. **Re-test key parity** (Module 4.17 test must still pass):
   ```bash
   pnpm test client/src/i18n/parity.test.ts
   ```

10. **Smoke:**
    - Switch language to English in dev mode.
    - Click through 5 customer pages — no Chinese visible.
    - Click through 5 admin tabs — no Chinese visible.
    - Switch back to zh-TW — all strings unchanged from pre-module.

## Acceptance Criteria

- [ ] `node scripts/i18n-audit.mjs --json | jq 'length'` returns ≤100 (down from 676 starting; 1,203 → ≤100 vs Wave 4 verification gate).
- [ ] All 37 admin tab files have zero hardcoded Chinese strings (modulo intentional comments).
- [ ] Customer pages residual leaks ≤30 (the remaining are intentional / dynamic / non-translatable strings).
- [ ] All new keys present in BOTH `zh-TW/<domain>.ts` and `en/<domain>.ts`.
- [ ] **Test:** `client/src/i18n/parity.test.ts` still passes — key parity preserved.
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] `pnpm test` green.
- [ ] `pnpm build` succeeds.
- [ ] Manual smoke: dev mode English shows English on 10 random pages (5 customer + 5 admin).
- [ ] Manual smoke: dev mode zh-TW shows identical strings to pre-module.

## Deliverable

- Modified: ~80-100 files in `client/src/` (admin tabs + customer pages + components) with `t()` replacements.
- Modified: `client/src/i18n/zh-TW/<domain>.ts` files with ~250-400 new keys added across domains.
- Same in `client/src/i18n/en/<domain>.ts`.

**Commit message:**

```
refactor(i18n): Wave 4 module 4.18 — leak sweep (676 → <100 residual)

- 506 admin-side leaks fixed across 37 admin tab files
- 170 customer-side residual leaks fixed (post-Wave-3-Module-3.12)
- ~250-400 new i18n keys added across namespaced sub-modules
- All keys mirrored in zh-TW + en; parity test holds
- Machine-translated en strings; Jeff approved ~30 critical strings
- Final residual ~80-100 strings = library code / intentional debug

Audit metric: 1,203 → <100 (gate met per Wave 4 verification)

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.18, audit §D
```

## Rollback

- Single revert restores hardcoded strings. No DB / migration touched.
- Translations are content-only; if a translation is bad, follow-up commit fixes that key — no need to revert the whole sweep.
- Risk: if a `t('key')` is malformed (e.g., wrong path), the string falls back to the key path itself, visible as `admin.tours.statusActive` in UI. Audit script catches.

## Manual intervention

- **Jeff (~30 min):** review the ~30 critical customer-facing English strings (booking flow, search results, membership pages) — confirm tone + accuracy. Machine translation is approximate; PACK&GO brand voice matters here.
- **Jeff (~10 min):** dev mode English language smoke — click through key pages, flag any awkward phrasings to follow-up task.

## Test plan

**Vitest:** `client/src/i18n/parity.test.ts` continues to pass.

**Regression anchor:** existing `pnpm test` count + 0 new cases (this module is a refactor; tests already cover the underlying behavior).

**Manual smoke:** English language pass + zh-TW unchanged.

## Decisions needed (Jeff)

1. **Machine translation tool** — recommend Anthropic Claude or OpenAI for the en strings (already integrated via `server/_core/llm.ts`). Or DeepL API. Recommend Claude (same brand voice).
2. **Critical-string review threshold** — ~30 strings to manually review. Confirm or expand to ~60 if Jeff wants more polish for the English version.
3. **Residual gate (<100)** — confirm. If tighter (≤50), need to scrub more aggressively into Wave 4.
4. **ja/ko keys** — current module does NOT add ja/ko translations for the new keys. Will cause ja/ko users to see fallback Chinese on the new strings. Recommend: file v3 task for ja/ko sweep; for v2, accept the regression (ja/ko users rare).
