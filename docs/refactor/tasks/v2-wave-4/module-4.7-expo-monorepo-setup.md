# v2 · Wave 4 · Module 4.7 — Monorepo: `packages/shared/` types only (minimum disruption)

> ⏸️ **DEFERRED to v3** — Apple Developer Program $99/yr + Google Play $25 not committed. Task content preserved for v3 re-activation; no execution in v2.

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L2 — Admin RN Expo, §Module 4.7)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain) + risk register #8 (monorepo breaking v1 stable)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** DEFERRED-V3 (Jeff decision 2026-05-19 — focus v2 on web + PWA; revisit RN admin app in v3 after mobile traffic + customer demand data lands)
**Est. effort:** 8 h AI + 1 h Jeff review (monorepo boundary decision + import-path smoke)
**Deploy window:** any weekday morning — no runtime change; tsconfig + workspace changes only

## Goal

Per **Stage 3 entry decision #5 (locked default in v2-plan)**: add **`packages/shared/` ONLY**, NOT a full monorepo conversion. The package holds TypeScript types extracted from `drizzle/schema.ts` + the tRPC `AppRouter` type + i18n keys, so the Expo app in Module 4.8 can `import type { AppRouter } from '@packgo/shared'` instead of reaching into `server/`.

**Crucially:** `client/` and `server/` stay at the root; their import paths remain unchanged so v1's stable code is undisturbed. The monorepo gain is a single new top-level `packages/` dir + a pnpm workspace + TypeScript project references.

This is **risk #8** in the v2-plan risk register — handle with care.

## Pre-requisites

- All prior Wave 4 modules merged (4.1-4.6) — they don't touch tsconfig or workspace structure.
- Wave 2 complete — db.ts split landed; the split files inform what types need exporting from shared (the same domain breakdown can carry over: booking, tour, user, payment, log, search, accounting types).
- `git status` clean before starting; this module rewires the workspace.

## Inputs (read these before executing)

- `package.json` (root) — current single-package layout; we add `workspaces` field but keep all current scripts pointed at `client/` and `server/` directories.
- `tsconfig.json` (root) — current single tsconfig; we'll add `references` to a new `packages/shared/tsconfig.json`.
- `pnpm-workspace.yaml` — confirm doesn't exist (audit said no monorepo at v1).
- `drizzle/schema.ts` — types we'll re-export from `packages/shared/db/`.
- `server/routers.ts` post-Wave-1/v1 split (~283 LOC composition shell) — exports `AppRouter`. We'll re-export from `packages/shared/`.
- `client/src/i18n/zh-TW.ts` + `en.ts` — key shape definitions to expose as types.
- v2-plan §Module 4.7 (line 432-440) — the "minimum disruption" mandate.

## Scope (what this module owns)

- ✅ `pnpm-workspace.yaml` — NEW file declaring `packages/*` as workspaces (does NOT add `client/` or `server/` — they stay un-workspaced for v2).
- ✅ `packages/shared/` — NEW directory with `package.json`, `tsconfig.json`, `index.ts`, and 4 sub-files:
  - `packages/shared/db.ts` — re-exports the inferred row types from `drizzle/schema.ts`.
  - `packages/shared/trpc.ts` — re-exports `AppRouter` type from `server/routers`.
  - `packages/shared/i18n.ts` — exports `I18nKey` union type derived from zh-TW.ts.
  - `packages/shared/constants.ts` — shared enums (BookingStatus, InquiryType, NotificationEvent etc.).
- ✅ Root `tsconfig.json` — add `references: [{ "path": "./packages/shared" }]`.
- ✅ Root `package.json` — add `workspaces` field; depend on `@packgo/shared` via workspace protocol.
- ✅ `client/src/types/shared.ts` — NEW SHIM that re-exports `@packgo/shared` so existing client code can be migrated incrementally without breaking imports.
- ✅ Vitest covering `@packgo/shared` exports import cleanly + types compile.
- ❌ NOT in scope: moving `client/` or `server/` into `packages/`; renaming any existing import path; touching `client/src/lib/trpc.ts` (the actual tRPC client config — that stays put); any RN code (Module 4.8).

## Procedure

1. **Read all inputs.** Inventory which types are most-imported across the codebase (use `grep -r "import type" server/` and `client/` to find candidate exports for `@packgo/shared`).

2. **Create `pnpm-workspace.yaml` at repo root:**
   ```yaml
   packages:
     - 'packages/*'
   # NOTE: client/ and server/ NOT in workspaces — they remain root-level
   # for v2. Full monorepo conversion is a v3 decision per v2-plan risk #8.
   ```

3. **Create `packages/shared/package.json`:**
   ```json
   {
     "name": "@packgo/shared",
     "version": "0.0.1",
     "private": true,
     "type": "module",
     "main": "./index.ts",
     "types": "./index.ts",
     "exports": {
       ".": "./index.ts",
       "./db": "./db.ts",
       "./trpc": "./trpc.ts",
       "./i18n": "./i18n.ts",
       "./constants": "./constants.ts"
     },
     "scripts": {
       "typecheck": "tsc --noEmit"
     }
   }
   ```
   **No deps** in `packages/shared/package.json` — it only ships types. tRPC + Drizzle deps live where they're already declared (root).

4. **`packages/shared/tsconfig.json`:**
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "moduleResolution": "Bundler",
       "strict": true,
       "noEmit": true,
       "composite": true,
       "declaration": true,
       "skipLibCheck": true,
       "isolatedModules": true,
       "esModuleInterop": true,
       "resolveJsonModule": true,
       "paths": {
         "@packgo/server/*": ["../../server/*"],
         "@packgo/drizzle/*": ["../../drizzle/*"]
       }
     },
     "include": ["./**/*.ts"],
     "exclude": ["**/*.test.ts"]
   }
   ```

5. **`packages/shared/index.ts`:**
   ```ts
   export * from './db';
   export * from './trpc';
   export * from './i18n';
   export * from './constants';
   ```

6. **`packages/shared/db.ts`:**
   ```ts
   /**
    * Re-export inferred row types from drizzle/schema.ts so the mobile app
    * can `import type { BookingRow } from '@packgo/shared'` without reaching
    * into server/.
    *
    * IMPORTANT: this file is TYPE-ONLY. No runtime imports from drizzle —
    * the mobile app must not bundle Drizzle.
    */
   import type {
     bookings, tours, users, payments, inquiries,
     customTourRequests, agents, customerProfiles,
     pushSubscriptions, // Module 4.3
   } from '../../drizzle/schema';
   import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

   export type BookingRow = InferSelectModel<typeof bookings>;
   export type BookingInsert = InferInsertModel<typeof bookings>;
   export type TourRow = InferSelectModel<typeof tours>;
   export type TourInsert = InferInsertModel<typeof tours>;
   export type UserRow = InferSelectModel<typeof users>;
   export type PaymentRow = InferSelectModel<typeof payments>;
   export type InquiryRow = InferSelectModel<typeof inquiries>;
   export type CustomTourRequestRow = InferSelectModel<typeof customTourRequests>;
   export type AgentRow = InferSelectModel<typeof agents>;
   export type CustomerProfileRow = InferSelectModel<typeof customerProfiles>;
   export type PushSubscriptionRow = InferSelectModel<typeof pushSubscriptions>;
   ```

7. **`packages/shared/trpc.ts`:**
   ```ts
   /**
    * Re-export AppRouter type from server/routers so mobile/web both
    * can `import type { AppRouter } from '@packgo/shared/trpc'`.
    */
   export type { AppRouter } from '../../server/routers';
   ```

8. **`packages/shared/i18n.ts`:**
   ```ts
   import type zhTW from '../../client/src/i18n/zh-TW';

   /** Union of all i18n key paths, e.g. "pwa.install.title" | "admin.tours.statusActive" */
   export type I18nKey = NestedKeyOf<typeof zhTW>;

   type NestedKeyOf<T> = T extends Record<string, any>
     ? { [K in keyof T]: K extends string
         ? T[K] extends Record<string, any>
           ? `${K}.${NestedKeyOf<T[K]>}`
           : K
         : never }[keyof T]
     : never;
   ```

9. **`packages/shared/constants.ts`:**
   ```ts
   export const BOOKING_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'] as const;
   export type BookingStatus = typeof BOOKING_STATUSES[number];

   export const INQUIRY_TYPES = ['general', 'custom_tour', 'visa', 'group_booking', 'complaint', 'emergency', 'other'] as const;
   export type InquiryType = typeof INQUIRY_TYPES[number];

   export const PUSH_EVENT_TYPES = ['booking_confirmed', 'payment_succeeded', 'itinerary_ready'] as const;
   export type PushEventType = typeof PUSH_EVENT_TYPES[number];

   // Mirror Wave 3 module 3.1's sub-intents
   export const INTENT_VALUES = [
     'new_inquiry', 'follow_up', 'refund_request', 'complaint',
     'quote_request', 'flight_inquiry', 'tour_comparison_request',
     'visa_inquiry', 'deposit_inquiry',
   ] as const;
   export type Intent = typeof INTENT_VALUES[number];
   ```

10. **Update root `package.json`:**
    Add `workspaces` field:
    ```json
    "workspaces": ["packages/*"],
    "pnpm": {
      "overrides": {}
    },
    "dependencies": {
      // ... existing
      "@packgo/shared": "workspace:*"
    }
    ```
    **CAUTION:** ensure the existing `dependencies` block is preserved verbatim except for the new entry. The supervisor must `Read` first then `Edit` precisely.

11. **Update root `tsconfig.json`:**
    Add `references` to enable project-ref builds:
    ```json
    {
      "compilerOptions": { /* existing */ },
      "references": [
        { "path": "./packages/shared" }
      ],
      "include": ["client", "server", "drizzle"]
    }
    ```

12. **Create shim `client/src/types/shared.ts`:**
    ```ts
    /**
     * Shim — re-exports from @packgo/shared so client code that previously
     * pulled types from server/ or drizzle/ can migrate to this import path
     * over time without breaking compiles.
     *
     * Migration target: `import type { BookingRow } from '@/types/shared'`
     */
    export type * from '@packgo/shared';
    ```

13. **Install + verify:**
    ```bash
    pnpm install
    pnpm tsc --noEmit
    cd packages/shared && pnpm typecheck && cd -
    pnpm test
    pnpm build
    ```
    All must pass with zero new errors.

14. **Smoke-test the import path from `client/`:**
    Pick one client file (e.g., `client/src/components/admin/ToursTab.tsx`) and replace ONE import — `import type { Tour } from '@/lib/trpc'` (or wherever) with `import type { TourRow } from '@/types/shared'`. Confirm tsc + tests still pass. Then revert that single change (this module ships the shim infrastructure; actual migration is a v3 cleanup).

## Acceptance Criteria

- [ ] `pnpm-workspace.yaml` exists at repo root listing only `packages/*`.
- [ ] `packages/shared/` exists with 4 files (`db.ts`, `trpc.ts`, `i18n.ts`, `constants.ts`) + `index.ts` + `package.json` + `tsconfig.json`.
- [ ] Root `package.json` has `workspaces: ["packages/*"]` and `@packgo/shared: workspace:*` in dependencies.
- [ ] Root `tsconfig.json` has `references: [{ path: "./packages/shared" }]`.
- [ ] `client/src/types/shared.ts` shim exists and re-exports `@packgo/shared`.
- [ ] `pnpm install` succeeds without warnings about workspace resolution.
- [ ] `pnpm tsc --noEmit` exit 0 (entire repo).
- [ ] `cd packages/shared && pnpm typecheck` exit 0.
- [ ] `pnpm test` passes — no regression.
- [ ] `pnpm build` succeeds — verify `dist/` is unchanged (the shared package is type-only and is tree-shaken; the build output should look identical to pre-module).
- [ ] **Test:** new Vitest `packages/shared/index.test.ts` — 4 cases:
  - (a) Import `BookingRow` type compiles without `any`.
  - (b) Import `AppRouter` type and inspect a procedure path — type-only.
  - (c) `BOOKING_STATUSES` const exported correctly.
  - (d) `I18nKey` type includes a known key like `'pwa.install.title'` (added in Module 4.5). **Required per CLAUDE.md §九.**
- [ ] Manual: open VS Code → import `@packgo/shared` from a client file → autocomplete works → click "Go to Definition" → lands in `packages/shared/`.
- [ ] No imports in `client/` or `server/` have been changed (besides the shim file).

## Deliverable

- New: `pnpm-workspace.yaml`, `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/index.ts`, `packages/shared/db.ts`, `packages/shared/trpc.ts`, `packages/shared/i18n.ts`, `packages/shared/constants.ts`, `packages/shared/index.test.ts`, `client/src/types/shared.ts`
- Modified: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`

**Commit message:**

```
feat(monorepo): Wave 4 module 4.7 — packages/shared/ types-only

- pnpm workspace declares packages/* only; client/ and server/ stay at
  root (v2-plan risk #8: minimum disruption per Stage 3 decision #5)
- @packgo/shared exports: drizzle row types, AppRouter, I18nKey union,
  constants (BookingStatus, InquiryType, Intent, PushEventType)
- Root tsconfig adds project reference to packages/shared
- Shim at client/src/types/shared.ts re-exports @packgo/shared for
  future incremental migration of client/ imports (not done in this commit)
- Module 4.8 (Expo app) will consume @packgo/shared/trpc + /constants
- Vitest validates type exports + i18n key generation (4 cases)

NO runtime change. NO existing import paths altered. NO behavior change.

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.7
```

## Rollback

- Single revert removes all new files + reverts tsconfig + package.json changes.
- `pnpm install` after revert restores the pre-module lockfile.
- **Risk:** if any client/server file did get migrated to `@packgo/shared` imports DURING this module's PR review, the revert breaks those imports. Mitigation: this module explicitly does NOT migrate any existing imports (only ships the shim).
- Drizzle migrations untouched; DB safe.

## Manual intervention

- **Jeff:** approve monorepo boundary — `packages/shared/` only vs include `packages/web/` and `packages/server/` too. Recommend stay narrow per v2-plan; if Jeff wants full conversion, defer to v3 — 10 min decision.
- **Jeff:** post-merge verification — `pnpm install` runs cleanly on Jeff's machine — 2 min.
- **Jeff:** open VS Code → confirm IDE picks up the new workspace and autocomplete on `import { ... } from '@packgo/shared'` works — 5 min.
- **Supervisor:** if any sibling module fails tsc after this lands (Module 4.8 onwards consume `@packgo/shared`), the supervisor coordinates the imports; Jeff doesn't get pinged for routine import wiring.

## Test plan

**Vitest:** `packages/shared/index.test.ts` — 4 cases (type-only; uses `expectTypeOf` from `vitest`):

1. **`BookingRow` is non-empty object type:** `expectTypeOf<BookingRow>().toHaveProperty('id')`.
2. **`AppRouter` type compiles:** import + dummy `createTRPCReact<AppRouter>()` typeline — must compile.
3. **`BOOKING_STATUSES` const is readonly tuple:** `expectTypeOf(BOOKING_STATUSES).items.toEqualTypeOf<BookingStatus>()`.
4. **`I18nKey` includes a known key:** `const _: I18nKey = 'pwa.install.title';` — must compile (after Module 4.5 added that key).

**Regression anchor:** `pnpm test` count unchanged + 4 new cases.

**Manual smoke:**
- `pnpm install` fresh — no errors.
- `pnpm tsc --noEmit` — 0 errors.
- VS Code → autocomplete on `@packgo/shared`.
- Random `client/` file: change 1 import to `@/types/shared` → tsc still passes → revert.

## Decisions needed (Jeff)

1. **Monorepo scope** — Stage 3 entry decision #5 already defaulted to "shared/ only". Confirm or escalate to full monorepo.
2. **Package name** — `@packgo/shared` recommended. Jeff may prefer `@packandgo/shared` or `pack-go-shared` for npm-publish parity (though private workspace package, the name only matters internally).
3. **`I18nKey` type strictness** — current implementation derives from `zh-TW.ts`. If en.ts diverges (some keys only in en), we get a key not in zh-TW errors. Decision: derive from zh-TW (canonical, recommend) vs intersection of both. Recommend canonical zh-TW.
4. **Migration plan post-merge** — should we open a v3 task to incrementally migrate `client/` imports to `@/types/shared`, or leave the shim dormant and only consume `@packgo/shared` from the new mobile app? Recommend leave dormant; cheap to migrate later.
