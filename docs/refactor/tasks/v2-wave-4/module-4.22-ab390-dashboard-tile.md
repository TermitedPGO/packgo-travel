# v2 · Wave 4 · Module 4.22 — AB-390 trial→paid conversion dashboard tile

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Polish, no specific module number; addressing audit §J recommended item)
**Audit ref:** v2-audit-2026-05-19.md §J lines 587-594 (membershipTrials data exists, no admin surface)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 4 h AI + 15 min Jeff review (verify metric matches Jeff's expectations)
**Deploy window:** any time — admin-only addition

## Goal

Surface the AB-390-compliance trial→paid conversion rate on the admin overview as a single dashboard tile. Backend tRPC procedure computes the metric; frontend renders the tile inside the admin Health / Office Overview tab. The `membershipTrials` table (per migration 0075 / audit §J line 594) already has the data — this module just queries + displays.

## Pre-requisites

- Wave 1 Module 1.7 (admin rate-limit) merged.
- Wave 2 Module 2.1 (db.ts split — `server/db/payment.ts` or `server/db/user.ts` houses membershipTrials queries) merged.
- Wave 1 Module 1.4 (PostHog) merged — supplementary trial-funnel events available.

## Inputs (read these before executing)

- `drizzle/schema.ts` `membershipTrials` table definition.
- `server/_core/stripeWebhook.ts` (Phase 2) — `trial_will_end` + `subscription.updated` handlers; they populate trial-end outcomes.
- `client/src/components/admin/OfficeOverviewTab.tsx` — current overview tile structure.
- `client/src/components/admin/AccountingTab.tsx` — has similar KPI tile patterns to mirror.
- Audit §J line 594: "Conversion rate is queryable but no admin dashboard surfaces it".

## Scope (what this module owns)

- ✅ `server/routers/membership.ts` (or new sub-file) — add `getTrialConversionStats` adminProcedure query.
- ✅ `client/src/components/admin/_primitives/TrialConversionTile.tsx` — NEW tile (uses Module 4.25 Storybook primitives if available; else inline-styled).
- ✅ Mount the tile in `OfficeOverviewTab.tsx`.
- ✅ Vitest covering the query.
- ❌ NOT in scope: full membership analytics dashboard (v3); A/B test infrastructure (audit §J line 610 — defer); cart-abandonment metric (separate v3 task).

## Procedure

1. **Read `membershipTrials` schema** — likely columns: `id, userId, startedAt, endedAt, outcome ('converted'|'cancelled'|'pending')`.

2. **Add tRPC query — `server/routers/membership.ts` (or extend):**
   ```ts
   getTrialConversionStats: adminProcedure
     .input(z.object({ daysBack: z.number().min(1).max(365).default(90) }))
     .query(async ({ input }) => {
       const since = new Date(Date.now() - input.daysBack * 86400 * 1000);
       const rows = await db.select().from(membershipTrials).where(gte(membershipTrials.startedAt, since));
       const totals = {
         total: rows.length,
         converted: rows.filter((r) => r.outcome === 'converted').length,
         cancelled: rows.filter((r) => r.outcome === 'cancelled').length,
         pending: rows.filter((r) => r.outcome === 'pending').length,
       };
       const conversionRate = totals.total > 0 ? totals.converted / (totals.total - totals.pending) : 0;
       return { ...totals, conversionRate, periodDays: input.daysBack };
     }),
   ```

3. **`client/src/components/admin/_primitives/TrialConversionTile.tsx`:**
   ```tsx
   import { trpc } from '@/lib/trpc';
   import { useTranslation } from '@/_core/hooks/useTranslation';

   export function TrialConversionTile({ daysBack = 90 }: { daysBack?: number }) {
     const { t } = useTranslation();
     const { data, isLoading } = trpc.membership.getTrialConversionStats.useQuery({ daysBack });
     if (isLoading || !data) return <div className="h-24 rounded-xl bg-gray-100 animate-pulse" />;

     const pct = (data.conversionRate * 100).toFixed(1);
     return (
       <div className="rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
         <p className="text-sm text-gray-500">{t('admin.health.trialConversion.title')}</p>
         <p className="text-3xl font-bold mt-1">{pct}%</p>
         <p className="text-xs text-gray-400 mt-2">
           {t('admin.health.trialConversion.detail', {
             converted: data.converted,
             total: data.total - data.pending,
             periodDays: data.periodDays,
           })}
         </p>
         {data.pending > 0 && (
           <p className="text-xs text-amber-600 mt-1">
             {t('admin.health.trialConversion.pending', { pending: data.pending })}
           </p>
         )}
       </div>
     );
   }
   ```

   **CLAUDE.md §2.1 compliance:** `rounded-xl` on card ✅, `rounded-xl` on loading skeleton ✅.

4. **Mount in `OfficeOverviewTab.tsx`** — add to KPI strip alongside existing tiles.

5. **i18n keys** (3 keys + interpolation):
   - `admin.health.trialConversion.title`: 「Trial 轉付費率」 / "Trial Conversion"
   - `admin.health.trialConversion.detail`: `{converted}/{total} converted ({periodDays}d)`
   - `admin.health.trialConversion.pending`: `{pending} pending`

6. **Smoke:**
   - Staging → admin overview → tile renders with real number from `membershipTrials`.
   - Test with Stripe CLI: simulate `customer.subscription.deleted` (cancellation) on a fixture trial → tile updates.

## Acceptance Criteria

- [ ] `trpc.membership.getTrialConversionStats({ daysBack })` returns correctly-shaped object.
- [ ] `TrialConversionTile` renders in admin overview.
- [ ] CLAUDE.md §2.1 compliance: `rounded-xl` on card.
- [ ] 3 i18n keys added.
- [ ] **Tests:** `server/routers/membership.test.ts` — 2 cases:
  - (a) 5 trials (3 converted, 1 cancelled, 1 pending) → conversionRate = 0.75 (3/4 non-pending), total=5, converted=3, cancelled=1, pending=1.
  - (b) Zero trials → conversionRate=0, no division-by-zero error. **Required per CLAUDE.md §九.**
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] `pnpm test` green.

## Deliverable

- New: `client/src/components/admin/_primitives/TrialConversionTile.tsx`, `server/routers/membership.test.ts` (or extend).
- Modified: `server/routers/membership.ts`, `client/src/components/admin/OfficeOverviewTab.tsx`, `client/src/i18n/zh-TW/admin.ts`, `client/src/i18n/en/admin.ts`.

**Commit message:**

```
feat(admin): Wave 4 module 4.22 — AB-390 trial→paid conversion dashboard tile

- trpc.membership.getTrialConversionStats({ daysBack })
- TrialConversionTile component in admin overview KPI strip
- Default 90-day window; pending trials excluded from denominator
- Highlights pending count in amber
- 2 Vitest cases (mixed outcomes + zero-trial edge)

Closes audit §J: trial conversion rate now surfaced (was SQL-only).

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.22, audit §J line 594
```

## Rollback

- Single revert removes tile + query. No data risk.

## Manual intervention

- **Jeff (~5 min):** open admin overview → verify tile shows a sensible number (the # should match a manual SQL query against `membershipTrials`).

## Test plan

**Vitest:** 2 cases (mock `db.select`).

**Regression anchor:** `pnpm test` count + 2 new cases.

**Manual smoke:** staging admin tab.

## Decisions needed (Jeff)

1. **Default window** — 90 days plan-recommended. Could be 30/60. Lock.
2. **Pending denominator handling** — current excludes pending from denominator (more accurate "convertible converted" metric). Alternative: include pending = "convertible failed" (more conservative). Recommend current (exclude); pending is "not yet decided".
3. **Tile placement** — recommend in admin overview top row alongside bookings/revenue tiles. Confirm.
