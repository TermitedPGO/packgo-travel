# v2 · Wave 4 · Module 4.17 — i18n dictionary restructure (zh-TW + en split into domains)

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Polish, §Module 4.17)
**Audit ref:** v2-audit-2026-05-19.md §D (i18n — 12,438 LOC flat dictionaries)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 8 h AI + 30 min Jeff review (verify key-parity test post-split)
**Deploy window:** any weekday morning — additive structure; key strings unchanged

## Goal

Split `client/src/i18n/zh-TW.ts` (6,220 LOC) and `client/src/i18n/en.ts` (6,218 LOC) into per-domain sub-modules under `client/src/i18n/zh-TW/` and `client/src/i18n/en/`. Re-exporter at `index.ts` of each dir preserves the flat key API (`t('admin.tours.statusActive')` works unchanged). Targets ≤500 LOC per sub-module.

**Module 4.18 (i18n leak sweep) is blocked by this** — leak fixes get easier with namespaced keys.

## Pre-requisites

- All prior Wave 4 modules merged (4.1-4.16) — they may add small numbers of keys that this module's split must accommodate.
- Wave 3 Module 3.12 (top-10 customer-facing i18n leaks fixed) merged — those keys are already added at the root.

## Inputs (read these before executing)

- `client/src/i18n/zh-TW.ts` (6,220 LOC) — read the **whole** file to inventory domain clusters.
- `client/src/i18n/en.ts` (6,218 LOC) — same.
- `client/src/i18n/ja.ts` and `ko.ts` — note these exist but stay unchanged in this module (v3 defer).
- `client/src/i18n/index.ts` — exports the dicts. Currently likely a single `export default zhTW` per language file.
- `client/src/_core/hooks/useTranslation.ts` — confirm the `t()` resolver does NOT depend on file structure (it consumes the flat object).
- `packages/shared/i18n.ts` (Module 4.7) — derives `I18nKey` type from `zh-TW.ts`; must keep working post-split.
- `packages/mobile/i18n/zh-TW.ts` (Module 4.10) — separate mobile dict; out of scope for this module.

## Scope (what this module owns)

- ✅ `client/src/i18n/zh-TW/` directory with ~13 sub-modules + `index.ts`.
- ✅ `client/src/i18n/en/` directory with same 13 sub-modules + `index.ts`.
- ✅ `client/src/i18n/zh-TW.ts` (file) — becomes a thin re-export from `./zh-TW/index` (preserves existing import paths in other files).
- ✅ Same for `en.ts`.
- ✅ `packages/shared/i18n.ts` (Module 4.7) — update import path to point at new structure.
- ✅ Vitest covering key-parity (zh-TW keys === en keys).
- ❌ NOT in scope: fixing leak strings (Module 4.18); ja/ko split (v3); admin-side leak removal (Module 4.18); the dictionary content itself — only file structure changes.

## Procedure

1. **Inventory the existing dictionary** — read `client/src/i18n/zh-TW.ts` start to finish; identify the top-level keys. Likely shape:
   ```ts
   export default {
     common: { ... },
     home: { ... },
     tours: { ... },
     booking: { ... },
     admin: { ... },
     // ... etc
   }
   ```
   Map to recommended 13 sub-modules per v2-plan §Module 4.17:
   - `admin.ts`, `booking.ts`, `tours.ts`, `membership.ts`, `visa.ts`, `common.ts`, `errors.ts`, `validation.ts`, `marketing.ts`, `emergency.ts`, `profile.ts`, `about.ts`, `legal.ts`
   - Plus catch-all: `misc.ts` for top-level keys that don't fit a domain (e.g., `pwa.*`, `auth.*`).

2. **Create sub-modules — `client/src/i18n/zh-TW/common.ts` example:**
   ```ts
   /** Domain: common UI strings (buttons, navigation, statuses) */
   export const common = {
     loading: '載入中...',
     save: '儲存',
     cancel: '取消',
     // ... extracted from zh-TW.ts root.common
   } as const;
   ```

3. **Repeat for all 13 sub-modules** — extract each top-level key cluster into its own file.

4. **`client/src/i18n/zh-TW/index.ts`:**
   ```ts
   import { common } from './common';
   import { admin } from './admin';
   import { booking } from './booking';
   import { tours } from './tours';
   import { membership } from './membership';
   import { visa } from './visa';
   import { errors } from './errors';
   import { validation } from './validation';
   import { marketing } from './marketing';
   import { emergency } from './emergency';
   import { profile } from './profile';
   import { about } from './about';
   import { legal } from './legal';
   import { misc } from './misc';

   const dict = {
     ...misc, // top-level keys like pwa.*, auth.* go via misc spread
     common, admin, booking, tours, membership, visa, errors, validation,
     marketing, emergency, profile, about, legal,
   } as const;

   export default dict;
   export type ZhTWDict = typeof dict;
   ```

5. **Update `client/src/i18n/zh-TW.ts` (the legacy file)** — replace contents with a thin re-export:
   ```ts
   /**
    * Domain-split dictionary lives in ./zh-TW/.
    * This file kept as a re-export so legacy imports (`from '@/i18n/zh-TW'`)
    * continue to resolve. Module 4.17 — Wave 4 v2.
    */
   export { default } from './zh-TW/index';
   export type { ZhTWDict } from './zh-TW/index';
   ```

6. **Repeat for `en/` and `en.ts`** — verbatim structure, English strings.

7. **Update `packages/shared/i18n.ts`** (Module 4.7) if it imports from a specific path:
   ```ts
   import type { ZhTWDict } from '../../client/src/i18n/zh-TW';
   export type I18nKey = NestedKeyOf<ZhTWDict>;
   ```

8. **Verify total LOC budget:** `wc -l client/src/i18n/zh-TW/*.ts` — each sub-module ≤500 LOC. If `admin.ts` is >500 LOC (likely; admin has the most keys), split further: `admin.ts` (orchestration) + `admin.tours.ts` + `admin.bookings.ts` etc. Document the split rationale in this module's commit message.

9. **Smoke test:**
   ```bash
   pnpm tsc --noEmit
   pnpm test
   pnpm build
   # Manually open dev mode, click through a few pages — strings still render
   pnpm dev
   ```

10. **Verify key parity:**
    ```ts
    // tests/i18n-parity.test.ts (new or extend existing)
    import zhTW from '@/i18n/zh-TW';
    import en from '@/i18n/en';

    function flatten(obj: any, prefix = ''): string[] {
      const keys: string[] = [];
      for (const k in obj) {
        if (typeof obj[k] === 'object' && obj[k] !== null) {
          keys.push(...flatten(obj[k], prefix ? `${prefix}.${k}` : k));
        } else {
          keys.push(prefix ? `${prefix}.${k}` : k);
        }
      }
      return keys;
    }

    test('zh-TW and en have identical key sets', () => {
      const zhKeys = new Set(flatten(zhTW));
      const enKeys = new Set(flatten(en));
      const onlyZh = [...zhKeys].filter((k) => !enKeys.has(k));
      const onlyEn = [...enKeys].filter((k) => !zhKeys.has(k));
      expect(onlyZh).toEqual([]);
      expect(onlyEn).toEqual([]);
    });
    ```
    Per audit §D, this test may already exist — extend or re-locate.

## Acceptance Criteria

- [ ] `client/src/i18n/zh-TW/` exists with ~13-15 sub-module files + `index.ts`.
- [ ] `client/src/i18n/en/` exists with mirroring structure.
- [ ] `client/src/i18n/zh-TW.ts` is now a 3-line re-export.
- [ ] `client/src/i18n/en.ts` same.
- [ ] Each sub-module ≤500 LOC (with the admin split if needed).
- [ ] **Test:** `client/src/i18n/parity.test.ts` (new or extended) — `zh-TW.keys === en.keys`. **Required per audit §D.**
- [ ] **Test:** legacy import paths still resolve — `import zhTW from '@/i18n/zh-TW'` works. Spot check by grepping repo: `grep -rn "from '@/i18n/zh-TW'" client/` and verify all callers still compile.
- [ ] `packages/shared/i18n.ts` (Module 4.7) `I18nKey` type still derives correctly.
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] `pnpm test` green.
- [ ] `pnpm build` succeeds.
- [ ] Manual smoke: dev mode renders strings correctly on home, tour detail, booking, admin tabs.

## Deliverable

- New: ~13-15 files under `client/src/i18n/zh-TW/` + 13-15 under `client/src/i18n/en/` + 2 index files + 1 parity test.
- Modified: `client/src/i18n/zh-TW.ts` (now re-export), `client/src/i18n/en.ts` (re-export), `packages/shared/i18n.ts` (import path).

**Commit message:**

```
refactor(i18n): Wave 4 module 4.17 — split dicts into 13+ domain files

- client/src/i18n/zh-TW.ts (6,220 LOC) → ~13 sub-modules ≤500 LOC each
- client/src/i18n/en.ts (6,218 LOC) → same domain split
- Top-level common/admin/booking/tours/membership/visa/errors/validation/
  marketing/emergency/profile/about/legal/misc
- Legacy import path preserved via thin re-export (zh-TW.ts/en.ts)
- packages/shared/i18n.ts I18nKey type still resolves
- Parity test verifies zh-TW.keys === en.keys

UNBLOCKS Module 4.18 (1,203-leak sweep) — namespaced keys ease replacements.

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.17, audit §D
```

## Rollback

- Single revert restores monolithic files.
- No DB / migration touched.
- Risk: if a sub-module spread accidentally drops a key, the parity test catches.

## Manual intervention

- **Jeff (~10 min):** spot-check 3 pages post-deploy: home, a tour detail page, an admin tab. Confirm strings render unchanged.
- **Jeff (~5 min):** approve sub-module list (13 default vs add/remove specific domains).

## Test plan

**Vitest:** `client/src/i18n/parity.test.ts` — 1 test asserting key-set equality.

**Regression anchor:** existing `pnpm test` count unchanged + 1 new case.

**Manual smoke:** dev mode, navigate through 5 pages, verify strings.

## Decisions needed (Jeff)

1. **Sub-module count (13 vs more)** — admin might need 3-4 files (`admin.ts`, `admin.tours.ts`, `admin.accounting.ts`). Lock approach at Procedure step 1.
2. **`misc.ts` catch-all vs strict** — recommend `misc.ts` for low-frequency top-level keys (`pwa.*`, `auth.*`) to avoid 1-key files. Lock.
3. **Module 4.18 sequencing** — Module 4.18 (leak sweep) is BLOCKED by this. Recommend ship 4.17 first, then 4.18. Confirm.
4. **ja/ko languages** — currently untouched, kept monolithic. Add them to the split in v3 when they have more content.
