# v2 · Wave 4 · Module 4.25 — Storybook + visual regression for admin primitives

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Polish, §Module 4.20)
**Audit ref:** v2-audit-2026-05-19.md §E lines 314-320 + §I lines 542-547 (no visual regression; primitives need documentation)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 10 h AI + 15 min Jeff review (Chromatic account + first baseline)
**Deploy window:** any time — additive; no runtime impact

## Goal

Install Storybook (Vite-based, matching project's bundler) + write 1 story per admin design-system primitive. Add Chromatic for visual regression — every PR diffs primitives against the baseline; CI fails on >1% pixel drift. Per audit §E line 316, the primitives are `<DataTable>`, `<KPIStrip>`, `<DomainSidebar>`, `<CommandPalette>`, `<DetailDrawer>`, `<EmptyState>`, `<StatusDot>` — these are flagged for **v3 implementation**; this module ships Storybook scaffold + at least one story for primitives that EXIST today, leaving the rest as TODO.

**Scope reality check:** the audit explicitly says "None of those primitives exist yet" (§E line 294). So this module ships:
- Storybook scaffolding ✅
- Stories for primitives that DO exist (e.g., `<Button>`, `<Card>`, `<Badge>` from shadcn/ui already integrated)
- Chromatic CI integration
- TODO stub-stories for the 7 future primitives

The actual primitive **implementations** are v3 (not v2). If Jeff wants to ship the primitives this wave, that's a separate ~16-hour task (audit §E P1 estimate).

## Pre-requisites

- All previous Wave 4 modules merged.
- Chromatic account (free tier) — Jeff signs up.

## Inputs (read these before executing)

- `client/src/components/ui/` — shadcn primitives already in the codebase.
- `vite.config.ts` (Module 4.2 modified) — Storybook needs same Vite config.
- Chromatic docs: https://www.chromatic.com/.

## Scope (what this module owns)

- ✅ `package.json` — add `@storybook/react-vite`, `@storybook/addon-essentials`, `chromatic`.
- ✅ `.storybook/main.ts` + `.storybook/preview.ts` — Storybook config.
- ✅ Stories for ~5 EXISTING shadcn primitives (`Button`, `Card`, `Input`, `Badge`, `Dialog`).
- ✅ TODO stub-stories for the 7 future admin primitives.
- ✅ `.github/workflows/chromatic.yml` — CI workflow.
- ❌ NOT in scope: implementing the 7 admin primitives themselves (v3 unless Jeff escalates).

## Procedure

1. **Install:**
   ```bash
   pnpm dlx storybook@latest init --type react
   pnpm add -D chromatic
   ```

2. **`.storybook/main.ts`:**
   ```ts
   import type { StorybookConfig } from '@storybook/react-vite';
   const config: StorybookConfig = {
     stories: ['../client/src/**/*.stories.@(ts|tsx)'],
     addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
     framework: '@storybook/react-vite',
     core: { disableTelemetry: true },
     async viteFinal(config) {
       config.resolve = config.resolve ?? {};
       config.resolve.alias = { ...config.resolve.alias, '@': '/client/src' };
       return config;
     },
   };
   export default config;
   ```

3. **`.storybook/preview.ts`:**
   ```ts
   import type { Preview } from '@storybook/react';
   import '../client/src/index.css';
   const preview: Preview = {
     parameters: {
       backgrounds: { default: 'light', values: [{ name: 'light', value: '#fff' }, { name: 'card', value: '#F9FAFB' }] },
       layout: 'centered',
     },
   };
   export default preview;
   ```

4. **Sample story — `client/src/components/ui/button.stories.tsx`:**
   ```tsx
   import type { Meta, StoryObj } from '@storybook/react';
   import { Button } from './button';

   const meta: Meta<typeof Button> = {
     title: 'UI / Button',
     component: Button,
     parameters: { layout: 'centered' },
   };
   export default meta;
   type Story = StoryObj<typeof Button>;

   export const Primary: Story = { args: { children: '立即預訂', className: 'rounded-lg bg-teal-600' } };
   export const Secondary: Story = { args: { children: 'Cancel', variant: 'outline', className: 'rounded-lg' } };
   export const Ghost: Story = { args: { children: 'Skip', variant: 'ghost', className: 'rounded-lg' } };
   ```

   Repeat for `card`, `input`, `badge`, `dialog`.

5. **TODO stub stories — `client/src/components/admin/_primitives/DataTable.stories.tsx`:**
   ```tsx
   import type { Meta, StoryObj } from '@storybook/react';
   const meta: Meta = {
     title: 'Admin / DataTable (TODO v3)',
     parameters: { docs: { description: { component: 'TODO: Implement <DataTable> primitive per audit §E line 316. v3 placeholder.' } } },
   };
   export default meta;
   export const Pending: StoryObj = { render: () => <div className="rounded-xl bg-yellow-50 p-4">TODO: implement DataTable primitive</div> };
   ```
   Repeat for 7 future primitives.

6. **`.github/workflows/chromatic.yml`:**
   ```yaml
   name: Chromatic
   on:
     pull_request: { branches: [main] }
   jobs:
     chromatic:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
           with: { fetch-depth: 0 }
         - uses: pnpm/action-setup@v2
           with: { version: 9 }
         - uses: actions/setup-node@v4
           with: { node-version: 20, cache: 'pnpm' }
         - run: pnpm install --frozen-lockfile
         - run: pnpm dlx chromatic --project-token=${{ secrets.CHROMATIC_PROJECT_TOKEN }} --exit-zero-on-changes
   ```

7. **`package.json` scripts:**
   ```json
   "storybook": "storybook dev -p 6006",
   "build-storybook": "storybook build",
   "chromatic": "chromatic"
   ```

8. **First baseline:**
   - `pnpm storybook` — open `localhost:6006` — verify 8 stories render (5 existing + ≤7 stubs).
   - Jeff signs in to chromatic.com, links GitHub repo, gets CHROMATIC_PROJECT_TOKEN.
   - First Chromatic upload sets the baseline.

## Acceptance Criteria

- [ ] Storybook scaffolded at `.storybook/`.
- [ ] At least 5 story files for existing shadcn primitives.
- [ ] TODO stub stories for the 7 future admin primitives.
- [ ] Chromatic CI workflow runs on PRs.
- [ ] `pnpm storybook` boots; stories render correctly.
- [ ] `pnpm build-storybook` succeeds (produces `storybook-static/` for deployment if Jeff wants public docs).
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] First Chromatic upload established as baseline.

## Deliverable

- New: `.storybook/main.ts`, `.storybook/preview.ts`, ~12 story files (5 real + 7 TODO stubs), `.github/workflows/chromatic.yml`
- Modified: `package.json`, `pnpm-lock.yaml`

**Commit message:**

```
chore(storybook): Wave 4 module 4.25 — Storybook + Chromatic visual regression

- Storybook 8 with @storybook/react-vite
- 5 stories for existing shadcn primitives (Button/Card/Input/Badge/Dialog)
- 7 TODO stub stories for v3 admin primitives (DataTable/KPIStrip/etc.)
- Chromatic CI uploads on every PR; --exit-zero-on-changes for v2 (won't
  block until baseline matures; flip to block in v3)

Addresses audit §I line 545 (no visual regression) + §E (primitives docs)
Refs: docs/refactor/v2-plan.md Wave 4 Module 4.25
```

## Rollback

- Single revert removes Storybook + Chromatic. No runtime impact (Storybook is dev-time only).

## Manual intervention

- **Jeff (~15 min):** sign up at chromatic.com (free) → link the repo → get the project token → add as GitHub secret `CHROMATIC_PROJECT_TOKEN`.
- **Jeff (~5 min):** review the 5 real stories for fidelity; approve first Chromatic baseline.

## Test plan

**No Vitest** — story files render at Storybook build time; bugs surface visually.

**Chromatic acceptance:** first run uploads baseline; subsequent PRs diff against it.

## Decisions needed (Jeff)

1. **Chromatic free tier limits** — 5,000 snapshots/mo on free. Each PR snapshots ~12 stories × 2 modes × 2 browsers = 48. 100 PRs/mo OK. Confirm.
2. **`--exit-zero-on-changes`** — current recommend for v2 (don't block PRs until baseline mature). Flip to block in v3.
3. **Implement primitives in v2 vs v3** — audit §E line 316 estimates 16h for 7 primitives. Recommend: defer to v3 unless Jeff is willing to spend the additional time now. Lock.
