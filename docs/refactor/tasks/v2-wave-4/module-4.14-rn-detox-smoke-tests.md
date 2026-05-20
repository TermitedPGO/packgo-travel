# v2 · Wave 4 · Module 4.14 — Detox smoke tests (3 critical-path E2E)

> ⏸️ **DEFERRED to v3** — Apple Developer Program $99/yr + Google Play $25 not committed. Task content preserved for v3 re-activation; no execution in v2.

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L2 — Admin RN Expo, §Module 4.14)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain) + §I (testing — 0 E2E for mobile)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** DEFERRED-V3 (Jeff decision 2026-05-19 — focus v2 on web + PWA; revisit RN admin app in v3 after mobile traffic + customer demand data lands)
**Est. effort:** 8 h AI + 15 min Jeff review (first CI run + baseline confirm)
**Deploy window:** any time — CI-only; no runtime impact

## Goal

Wire up Detox E2E test framework against the EAS-built dev client and ship 3 critical-path smoke tests that must pass before any mobile module merges:

1. **`login.test.ts`** — open app → "Sign in with Manus" → simulate OAuth callback → app lands on inbox tab.
2. **`inbox.test.ts`** — auth shim → open inbox → list renders → tap a row → inquiry detail loads.
3. **`send-reply.test.ts`** — open inquiry detail → type "smoke test reply" → tap Send → message visible in thread.

Tests run in CI on Detox cloud (or EAS Build's Detox integration) on every PR touching `packages/mobile/`. The same suite runs locally via `pnpm mobile:detox`.

## Pre-requisites

- **Module 4.9 (OAuth)** resolved — login test depends on it.
- **Module 4.10 (Inbox)** merged — inbox + tap-detail flow exists.
- **Module 4.11 (Agent Chat / Inquiry Detail)** merged — send-reply flow exists.
- EAS development build already running (Module 4.8 `eas build --profile development` complete).
- Maestro alternative considered: Detox is the planned framework per v2-plan §Module 4.14; Maestro could be a fallback if Detox setup is fragile.

## Inputs (read these before executing)

- `packages/mobile/app/login.tsx` (Module 4.9) — verify `testID` props on key buttons.
- `packages/mobile/app/(tabs)/inbox.tsx` (Module 4.10) — verify `testID` on list, rows.
- `packages/mobile/app/inquiry/[id].tsx` (Module 4.11) — verify `testID` on send button + text input.
- `packages/mobile/app.json` — Detox needs a dev-client build with detox-helper.
- Detox docs: https://wix.github.io/Detox/docs/introduction/getting-started

## Scope (what this module owns)

- ✅ `packages/mobile/package.json` — add `detox` + `jest` (Detox uses jest as runner; mobile uses Vitest for component tests — these coexist).
- ✅ `packages/mobile/.detoxrc.js` — Detox config (iOS Simulator + Android Emulator targets).
- ✅ `packages/mobile/e2e/jest.config.js` — Detox jest setup.
- ✅ `packages/mobile/e2e/login.test.ts`, `inbox.test.ts`, `send-reply.test.ts` — 3 specs.
- ✅ Add `testID` props throughout key screens (Modules 4.9-4.11 may not have set them — this module adds them where missing, with minimal touch).
- ✅ `.github/workflows/mobile-e2e.yml` — Detox CI workflow.
- ✅ `packages/mobile/e2e/helpers/auth.ts` — mock-auth helper for tests (skips real OAuth via test-mode env).
- ❌ NOT in scope: any new screen content, push test (Module 4.13's push needs a separate fixture flow — defer).

## Procedure

1. **Read screens**, inventory missing `testID` props. Add `testID="login-button"`, `testID="inbox-row-{id}"`, `testID="send-button"`, `testID="reply-input"` etc. Minimal touch — only on widgets the test targets.

2. **Install Detox:**
   ```bash
   cd packages/mobile
   pnpm add -D detox jest @types/jest ts-jest detox-expo-helpers
   ```

3. **`packages/mobile/.detoxrc.js`:**
   ```js
   /** @type {Detox.DetoxConfig} */
   module.exports = {
     testRunner: { args: { $0: 'jest', config: 'e2e/jest.config.js' } },
     apps: {
       'ios.debug': {
         type: 'ios.app',
         binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/PACKGOAdmin.app',
         build: 'xcodebuild -workspace ios/PACKGOAdmin.xcworkspace -scheme PACKGOAdmin -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
       },
       'android.debug': {
         type: 'android.apk',
         binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
         build: 'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug && cd ..',
       },
     },
     devices: {
       'simulator': { type: 'ios.simulator', device: { type: 'iPhone 15' } },
       'emulator': { type: 'android.emulator', device: { avdName: 'Pixel_7_API_34' } },
     },
     configurations: {
       'ios.sim.debug': { device: 'simulator', app: 'ios.debug' },
       'android.emu.debug': { device: 'emulator', app: 'android.debug' },
     },
   };
   ```

4. **`packages/mobile/e2e/jest.config.js`:**
   ```js
   module.exports = {
     rootDir: '..',
     testMatch: ['<rootDir>/e2e/**/*.test.ts'],
     testTimeout: 120000,
     maxWorkers: 1,
     globalSetup: 'detox/runners/jest/globalSetup',
     globalTeardown: 'detox/runners/jest/globalTeardown',
     reporters: ['detox/runners/jest/reporter'],
     testEnvironment: 'detox/runners/jest/testEnvironment',
     verbose: true,
     transform: { '^.+\\.tsx?$': 'ts-jest' },
   };
   ```

5. **`packages/mobile/e2e/helpers/auth.ts`** — bypass OAuth for tests:
   ```ts
   import * as SecureStore from 'expo-secure-store';
   /**
    * For E2E tests, we inject a fake token directly into SecureStore
    * via a debug-only deep link the app honors when E2E_BYPASS_OAUTH=true.
    *
    * The app reads process.env.EXPO_PUBLIC_E2E_BYPASS_OAUTH at boot;
    * when true, app/_layout.tsx skips the OAuth flow and uses a test token.
    */
   export const TEST_TOKEN = 'detox-e2e-fake-token';
   export const TEST_USER_EMAIL = 'detox-e2e@packgo.test';
   ```

   **In `packages/mobile/app/_layout.tsx`**: add boot-time check:
   ```ts
   if (process.env.EXPO_PUBLIC_E2E_BYPASS_OAUTH === 'true') {
     SecureStore.setItemAsync('manus_access_token', 'detox-e2e-fake-token');
   }
   ```

   **Server side:** add a guard `if (token === 'detox-e2e-fake-token' && process.env.NODE_ENV !== 'production')` that accepts the token + maps to a seeded test user. Add in `server/_core/auth.ts` or trpc middleware.

6. **`packages/mobile/e2e/login.test.ts`:**
   ```ts
   import { device, element, by, expect } from 'detox';

   describe('Login flow', () => {
     beforeAll(async () => { await device.launchApp({ newInstance: true, permissions: { notifications: 'YES' } }); });
     afterEach(async () => { await device.reloadReactNative(); });

     it('shows login screen when unauthenticated', async () => {
       // device boots fresh; no token in SecureStore
       await expect(element(by.id('login-button'))).toBeVisible();
     });

     it('navigates to inbox after successful sign-in', async () => {
       await element(by.id('login-button')).tap();
       // The OAuth flow is mocked via E2E_BYPASS_OAUTH=true; app should
       // self-authenticate and route to /inbox
       await waitFor(element(by.id('inbox-tab'))).toBeVisible().withTimeout(10000);
     });
   });
   ```

7. **`packages/mobile/e2e/inbox.test.ts`:**
   ```ts
   import { device, element, by, expect, waitFor } from 'detox';

   describe('Inbox', () => {
     beforeAll(async () => {
       await device.launchApp({ newInstance: true, launchArgs: { e2eBypassOauth: 'true' } });
     });

     it('renders the inquiry list', async () => {
       await waitFor(element(by.id('inbox-list'))).toBeVisible().withTimeout(8000);
       // Assume seeded test user has at least 1 inquiry
       await expect(element(by.id('inquiry-row-0'))).toBeVisible();
     });

     it('opens inquiry detail on tap', async () => {
       await element(by.id('inquiry-row-0')).tap();
       await waitFor(element(by.id('inquiry-detail-header'))).toBeVisible().withTimeout(5000);
     });
   });
   ```

8. **`packages/mobile/e2e/send-reply.test.ts`:**
   ```ts
   describe('Send reply', () => {
     beforeAll(async () => {
       await device.launchApp({ newInstance: true, launchArgs: { e2eBypassOauth: 'true' } });
     });

     it('sends a message and shows it in the thread', async () => {
       await waitFor(element(by.id('inbox-list'))).toBeVisible().withTimeout(8000);
       await element(by.id('inquiry-row-0')).tap();
       await waitFor(element(by.id('reply-input'))).toBeVisible().withTimeout(5000);
       await element(by.id('reply-input')).typeText('smoke test reply');
       await element(by.id('send-button')).tap();
       await waitFor(element(by.text('smoke test reply'))).toBeVisible().withTimeout(5000);
     });
   });
   ```

9. **Seed test data:**
   The 3 specs assume a seeded test user with ≥1 inquiry. Add `packages/mobile/e2e/seed-data.ts` invoked from a one-time setup OR rely on staging data being persistent. **Decision:** persistent staging data (Jeff seeds once via web admin), tests assume `customerEmail = detox-seed@packgo.test` with an inquiry. Document in `packages/mobile/README.md`.

10. **`.github/workflows/mobile-e2e.yml`:**
    ```yaml
    name: Mobile E2E (Detox)
    on:
      pull_request:
        paths: ['packages/mobile/**']
        branches: [main]
      workflow_dispatch:
    jobs:
      ios-e2e:
        runs-on: macos-14
        timeout-minutes: 30
        steps:
          - uses: actions/checkout@v4
          - uses: pnpm/action-setup@v2
            with: { version: 9 }
          - uses: actions/setup-node@v4
            with: { node-version: 20, cache: 'pnpm' }
          - run: pnpm install --frozen-lockfile
          - run: brew tap wix/brew && brew install applesimutils
          - run: cd packages/mobile && pnpm exec expo prebuild --platform ios
          - run: cd packages/mobile && pnpm exec detox build --configuration ios.sim.debug
          - run: cd packages/mobile && pnpm exec detox test --configuration ios.sim.debug --headless
            env:
              EXPO_PUBLIC_E2E_BYPASS_OAUTH: 'true'
              EXPO_PUBLIC_API_URL: 'https://packgo-staging.fly.dev'
    ```

11. **`packages/mobile/package.json` scripts:**
    ```json
    "scripts": {
      "detox:build:ios": "expo prebuild --platform ios && detox build --configuration ios.sim.debug",
      "detox:test:ios": "detox test --configuration ios.sim.debug",
      "detox:build:android": "expo prebuild --platform android && detox build --configuration android.emu.debug",
      "detox:test:android": "detox test --configuration android.emu.debug"
    }
    ```

12. **Local smoke (Jeff or supervisor):**
    ```bash
    cd packages/mobile
    pnpm detox:build:ios
    pnpm detox:test:ios
    ```
    All 3 specs should pass.

## Acceptance Criteria

- [ ] `packages/mobile/.detoxrc.js` exists with iOS + Android configs.
- [ ] `packages/mobile/e2e/` exists with 3 .test.ts files + jest.config + helpers.
- [ ] `testID` props added in Modules 4.9-4.11 screens (login-button, inbox-tab, inbox-list, inquiry-row-{i}, inquiry-detail-header, reply-input, send-button).
- [ ] `EXPO_PUBLIC_E2E_BYPASS_OAUTH` flag wired in app/_layout.tsx + server-side accept of `detox-e2e-fake-token`.
- [ ] `.github/workflows/mobile-e2e.yml` runs on PRs touching `packages/mobile/`.
- [ ] First local Detox run on iOS: all 3 specs pass.
- [ ] First CI run on this module's PR: green.
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] **Manual smoke:** triple-check that the `EXPO_PUBLIC_E2E_BYPASS_OAUTH=true` flag does NOT activate in production builds. Add a `if (process.env.NODE_ENV === 'production') { ignore }` guard. Verify by `eas build --profile production` and confirm flag has no effect.
- [ ] No regression in `pnpm test`.

## Deliverable

- New: `packages/mobile/.detoxrc.js`, `packages/mobile/e2e/jest.config.js`, `packages/mobile/e2e/helpers/auth.ts`, `packages/mobile/e2e/login.test.ts`, `packages/mobile/e2e/inbox.test.ts`, `packages/mobile/e2e/send-reply.test.ts`, `.github/workflows/mobile-e2e.yml`
- Modified: `packages/mobile/package.json` (scripts + Detox deps), `packages/mobile/app/_layout.tsx` (E2E bypass guard), `packages/mobile/app/login.tsx` + `inbox.tsx` + screens (testID props), `server/_core/auth.ts` or trpc middleware (E2E token accept gated by NODE_ENV)

**Commit message:**

```
test(mobile-e2e): Wave 4 module 4.14 — Detox + 3 smoke tests

- detox + jest installed in packages/mobile; CI workflow on PR
- 3 specs: login.test.ts, inbox.test.ts, send-reply.test.ts
- testID props added on login-button, inbox-list, inbox-row, reply-input,
  send-button, inquiry-detail-header
- EXPO_PUBLIC_E2E_BYPASS_OAUTH skips real OAuth via injected fake token;
  server-side token accept gated by NODE_ENV !== 'production'
- iOS simulator runs in CI on macos-14; Android in follow-up
- 3 E2E suites are Wave 4 BLOCKING gate for mobile merges

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.14, CLAUDE.md §九 (E2E
required for behavioral change per Vibe Coding red lines)
```

## Rollback

- Single revert removes Detox config + tests + workflow + testID props.
- E2E bypass code in `app/_layout.tsx` is gated by env var; if not set in prod, no effect. Safe to leave applied even if revert deferred.
- No DB / migration.

## Manual intervention

- **Jeff (~30 min, one-time):** seed a persistent staging test user `detox-seed@packgo.test` with 3 inquiries (1 with skill draft, 1 unread, 1 archived) — via web admin. The 3 Detox specs assume these exist.
- **Jeff (~10 min):** verify the production bundle has E2E bypass disabled — `eas build --profile production` → install on Jeff's iPhone → confirm NO auto-login.
- **Jeff (~5 min):** approve EAS Build minute usage — Detox builds ~10 min each + run ~5 min, so each PR run is ~15 min macOS CI. Free tier (30 min/mo macOS) may cap. Recommend monitor; consider upgrading EAS plan if needed.

## Test plan

**No Vitest needed** — Detox tests ARE the test plan for this module.

**Detox suite:** 3 specs as written above. Each spec asserts:

- `login.test.ts`: login button visible → tap → inbox tab visible within 10s.
- `inbox.test.ts`: inbox list visible → row 0 visible → tap → detail header visible.
- `send-reply.test.ts`: type "smoke test reply" → Send → text visible in thread.

**Regression anchor:** Vitest count unchanged.

**Manual smoke:**
- Local: `pnpm detox:test:ios` exit 0.
- CI: GitHub Actions Mobile E2E badge green on this module's PR.

## Decisions needed (Jeff)

1. **Detox vs Maestro** — Detox plan-locked. If setup proves fragile after 4h of work, recommend pivot to Maestro (simpler YAML-based). Lock at Procedure step 2.
2. **iOS-only vs iOS+Android CI** — current workflow runs iOS only. Android needs Linux runner + emulator setup (~30 min more CI time per PR). Recommend iOS-only for v2, Android in v3.
3. **Test data seed strategy** — persistent staging seed (current plan) vs fresh-per-test (slower but isolated). Recommend persistent + audit-log cleanup script.
4. **EAS Build minute budget** — Wave 4 + ongoing PRs likely exceed free tier 30 min/mo macOS. Confirm Jeff OK paying $99/mo for EAS Production if needed (defer to budget conversation).
5. **Push notification E2E** — Module 4.13 push tests deferred to v3 (Detox needs special permission handling). Confirm.
