# v2 · Wave 4 · Module 4.16 — Playwright + 5 customer flow E2E tests

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Polish, §Module 4.16)
**Audit ref:** v2-audit-2026-05-19.md §I (testing — no E2E framework + no visual regression)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 14 h AI + 30 min Jeff review (review tests + first CI baseline)
**Deploy window:** any time — CI-only

## Goal

Install Playwright and ship 5 critical-path customer E2E tests that run on every PR to main:

1. **`book-tour.spec.ts`** — search → tour detail → click "Book" → date pick → travelers → details form → Stripe test card → confirmation.
2. **`search.spec.ts`** — home search form → results page → filter → click into a tour.
3. **`signup.spec.ts`** — register a new user via Manus OAuth (mocked or test instance).
4. **`membership.spec.ts`** — sign up for the 10-day Plus trial → Stripe trial subscription created → redirected to membership perks page.
5. **`contact.spec.ts`** — submit the contact form → inquiry persisted → confirmation page rendered.

Tests run against staging in CI. Local dev: `pnpm e2e`.

## Pre-requisites

- Wave 1 complete — observability so failures are debuggable.
- Wave 2 complete — `TourDetailPeony` split (book flow goes through it).
- Wave 3 partial — Module 3.1 (sub-intents) helps `contact.spec.ts` verify auto-classification.
- Staging URL accessible from CI; Stripe test mode keys configured on staging.

## Inputs (read these before executing)

- `client/src/pages/BookTour.tsx` — 4-step booking flow (`date | travelers | details | confirm` per CLAUDE.md ref).
- `client/src/pages/Home.tsx` (or wherever search form lives) — search input names.
- `client/src/pages/Membership.tsx` (or signup flow) — trial activation.
- `client/src/pages/Contact.tsx` (or `Emergency.tsx` if inline form) — contact form.
- Manus OAuth test/dev configuration — does Manus have a "test mode" or do we mock? Likely mock via a debug login route.
- `package.json` existing scripts.

## Scope (what this module owns)

- ✅ `package.json` — add `@playwright/test`.
- ✅ `playwright.config.ts` — Playwright config (baseURL, retries, parallel).
- ✅ `e2e/` directory at repo root with 5 .spec.ts files + `e2e/fixtures/` for helpers.
- ✅ `.github/workflows/playwright.yml` — CI workflow.
- ✅ `e2e/helpers/auth.ts` — bypass Manus OAuth via cookie injection for tests.
- ✅ `e2e/helpers/stripe.ts` — fill Stripe test card (`4242 4242 4242 4242`).
- ❌ NOT in scope: visual regression (Storybook Module 4.25 covers); test data seeding for production (use existing staging fixtures); admin-side E2E (Detox handles for mobile; web admin E2E is v3).

## Procedure

1. **Install:**
   ```bash
   pnpm add -D @playwright/test
   pnpm exec playwright install --with-deps chromium
   ```

2. **`playwright.config.ts`:**
   ```ts
   import { defineConfig, devices } from '@playwright/test';
   export default defineConfig({
     testDir: './e2e',
     timeout: 60000,
     fullyParallel: true,
     retries: process.env.CI ? 2 : 0,
     workers: process.env.CI ? 2 : undefined,
     use: {
       baseURL: process.env.E2E_BASE_URL ?? 'https://packgo-staging.fly.dev',
       trace: 'on-first-retry',
       video: 'retain-on-failure',
       screenshot: 'only-on-failure',
     },
     projects: [
       { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
       { name: 'mobile-safari', use: { ...devices['iPhone 14'] } }, // run book flow on mobile too
     ],
     reporter: [['list'], ['html', { open: 'never' }]],
   });
   ```

3. **`e2e/helpers/auth.ts`:**
   ```ts
   import { Page } from '@playwright/test';
   /**
    * Inject a test session cookie. Server-side recognizes the special token
    * via `if (token === 'playwright-e2e-fake' && NODE_ENV !== 'production')`.
    */
   export async function loginAsTestUser(page: Page, role: 'customer' | 'admin' = 'customer') {
     const token = role === 'admin' ? 'playwright-e2e-admin' : 'playwright-e2e-customer';
     await page.context().addCookies([{
       name: 'manus_session', value: token, domain: new URL(page.url() || 'https://packgo-staging.fly.dev').hostname, path: '/',
     }]);
   }
   ```

4. **`e2e/helpers/stripe.ts`:**
   ```ts
   import { FrameLocator, Page } from '@playwright/test';
   export async function fillStripeTestCard(page: Page) {
     // Stripe Elements is in an iframe — locate it
     const stripeFrame: FrameLocator = page.frameLocator('iframe[name*="__privateStripeFrame"]').first();
     await stripeFrame.locator('[placeholder*="1234"]').fill('4242 4242 4242 4242');
     await stripeFrame.locator('[placeholder="MM / YY"]').fill('12/30');
     await stripeFrame.locator('[placeholder="CVC"]').fill('123');
     await stripeFrame.locator('[placeholder="12345"]').fill('94560'); // postal
   }
   ```

5. **`e2e/book-tour.spec.ts`:**
   ```ts
   import { test, expect } from '@playwright/test';
   import { fillStripeTestCard } from './helpers/stripe';

   test('full booking flow on a sample tour', async ({ page }) => {
     await page.goto('/tours/sample-tour-slug'); // staging seed slug
     await page.click('text=立即預訂'); // or t('book.cta') match
     // Step 1: date
     await page.locator('[data-testid="date-picker"]').click();
     await page.locator('button:has-text("Confirm")').click();
     // Step 2: travelers
     await page.locator('[data-testid="adults-plus"]').click();
     await page.locator('button:has-text("Next")').click();
     // Step 3: details
     await page.locator('[name="customerName"]').fill('Playwright Tester');
     await page.locator('[name="customerEmail"]').fill('playwright@packgo.test');
     await page.locator('[name="phone"]').fill('+15551234567');
     await page.locator('button:has-text("Next")').click();
     // Step 4: pay
     await fillStripeTestCard(page);
     await page.locator('button:has-text("Pay")').click();
     // Confirmation
     await expect(page.locator('text=Thank you, your booking is confirmed')).toBeVisible({ timeout: 15000 });
   });
   ```

6. **`e2e/search.spec.ts`:**
   ```ts
   import { test, expect } from '@playwright/test';
   test('home search → results → tour detail', async ({ page }) => {
     await page.goto('/');
     await page.locator('[name="searchDestination"]').fill('Japan');
     await page.locator('button:has-text("搜尋")').click();
     await expect(page).toHaveURL(/\/search/);
     await expect(page.locator('[data-testid="tour-card"]').first()).toBeVisible();
     await page.locator('[data-testid="tour-card"]').first().click();
     await expect(page.locator('h1')).toBeVisible();
   });
   ```

7. **`e2e/signup.spec.ts`:**
   ```ts
   import { test, expect } from '@playwright/test';
   test('signup via test-mode OAuth bypass', async ({ page, context }) => {
     await page.goto('/login');
     await page.locator('button:has-text("Sign in with Manus")').click();
     // The OAuth bypass cookie is added before redirect kicks in:
     await context.addCookies([{ name: 'manus_session', value: 'playwright-e2e-new-customer', domain: new URL(page.url()).hostname, path: '/' }]);
     await page.reload();
     await expect(page.locator('text=Welcome')).toBeVisible();
   });
   ```

8. **`e2e/membership.spec.ts`:**
   ```ts
   import { test, expect } from '@playwright/test';
   import { loginAsTestUser } from './helpers/auth';
   import { fillStripeTestCard } from './helpers/stripe';
   test('Plus trial signup', async ({ page }) => {
     await page.goto('/membership');
     await loginAsTestUser(page);
     await page.reload();
     await page.locator('button:has-text("Start 10-day trial")').click();
     await fillStripeTestCard(page);
     await page.locator('button:has-text("Confirm")').click();
     await expect(page.locator('text=Trial active')).toBeVisible({ timeout: 15000 });
   });
   ```

9. **`e2e/contact.spec.ts`:**
   ```ts
   import { test, expect } from '@playwright/test';
   test('contact form submit', async ({ page }) => {
     await page.goto('/contact');
     await page.locator('[name="name"]').fill('Playwright Tester');
     await page.locator('[name="email"]').fill('playwright@packgo.test');
     await page.locator('[name="message"]').fill('Test inquiry from Playwright');
     await page.locator('button:has-text("送出")').click();
     await expect(page.locator('text=訊息已送出')).toBeVisible({ timeout: 10000 });
   });
   ```

10. **Server-side E2E auth bypass:** modify `server/_core/auth.ts` (or trpc middleware):
    ```ts
    if (process.env.NODE_ENV !== 'production' && token?.startsWith('playwright-e2e-')) {
      const role = token === 'playwright-e2e-admin' ? 'admin' : 'user';
      const seededUserId = role === 'admin' ? PLAYWRIGHT_ADMIN_USER_ID : PLAYWRIGHT_CUSTOMER_USER_ID;
      return { id: seededUserId, role, email: 'playwright@packgo.test' };
    }
    ```
    Sanity-guard: NODE_ENV check + token prefix.

11. **`.github/workflows/playwright.yml`:**
    ```yaml
    name: Playwright Customer E2E
    on:
      pull_request: { branches: [main] }
      workflow_dispatch:
    jobs:
      e2e:
        runs-on: ubuntu-latest
        timeout-minutes: 30
        steps:
          - uses: actions/checkout@v4
          - uses: pnpm/action-setup@v2
            with: { version: 9 }
          - uses: actions/setup-node@v4
            with: { node-version: 20, cache: 'pnpm' }
          - run: pnpm install --frozen-lockfile
          - run: pnpm exec playwright install --with-deps chromium
          - run: pnpm exec playwright test
            env:
              E2E_BASE_URL: 'https://packgo-staging.fly.dev'
          - uses: actions/upload-artifact@v4
            if: failure()
            with: { name: playwright-report, path: playwright-report/ }
    ```

12. **`package.json` scripts:**
    ```json
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui",
    "e2e:headed": "playwright test --headed"
    ```

13. **Smoke locally:** `pnpm e2e` — verify all 5 specs pass against staging.

## Acceptance Criteria

- [ ] `playwright.config.ts` exists with chromium + mobile-safari projects.
- [ ] `e2e/` has 5 spec files + 2 helper files.
- [ ] `.github/workflows/playwright.yml` runs on PRs to main.
- [ ] Server-side E2E auth bypass gated by `NODE_ENV !== 'production'`.
- [ ] All 5 specs pass on staging.
- [ ] First CI run on this module's PR: green.
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] Existing Vitest count unchanged.

## Deliverable

- New: `playwright.config.ts`, `e2e/book-tour.spec.ts`, `search.spec.ts`, `signup.spec.ts`, `membership.spec.ts`, `contact.spec.ts`, `e2e/helpers/auth.ts`, `e2e/helpers/stripe.ts`, `.github/workflows/playwright.yml`
- Modified: `package.json`, `server/_core/auth.ts` (E2E bypass guard)

**Commit message:**

```
test(e2e): Wave 4 module 4.16 — Playwright + 5 customer flow specs

- @playwright/test installed; chromium + mobile-safari project matrix
- 5 specs: book-tour, search, signup, membership, contact
- Helpers: auth (cookie inject), stripe (fill 4242 test card)
- Server-side bypass: NODE_ENV !== production + playwright-e2e-* prefix
- CI on PR to main; failure uploads playwright-report artifact
- 2 retries on CI; trace + video on failure

Closes: v2-audit §I — first E2E framework installed
Refs: docs/refactor/v2-plan.md Wave 4 Module 4.16
```

## Rollback

- Single revert removes config + tests + workflow. No runtime impact.
- E2E bypass code is env-gated, safe.

## Manual intervention

- **Jeff (~30 min, one-time):** seed `playwright@packgo.test` customer + admin users on staging via web admin. Verify `playwright-e2e-customer` and `playwright-e2e-admin` cookies map to these users.
- **Jeff (~10 min):** approve test scope — 5 specs current; if Jeff wants 7 (add a quote-request flow + an emergency-contact flow), file follow-up tasks.

## Test plan

**Playwright suite:** 5 specs as above. Acceptance: all green on staging.

**Regression anchor:** Vitest count unchanged.

**Manual smoke:** `pnpm e2e:headed` locally — watch the browser drive each flow.

## Decisions needed (Jeff)

1. **Browser matrix** — chromium + mobile-safari current. Add firefox + webkit (Safari)? Recommend chromium-only + mobile-safari for v2 (3x CI time per browser); add Safari desktop in v3 if Apple-customer support is critical.
2. **Run frequency** — every PR currently. Recommend keep; can lighten to "main only" if PR queue clogs.
3. **Staging vs ephemeral preview** — uses staging URL. If a PR includes a breaking change to staging schema, all PRs fail until staging is healed. Consider Fly preview-deploys-per-PR in v3.
4. **Stripe test mode** — uses live Stripe test mode keys on staging (`pk_test_*`). Confirm staging configured.
