# v2 · Wave 4 · Module 4.8 — Expo project setup + EAS Build config

> ⏸️ **DEFERRED to v3** — Apple Developer Program $99/yr + Google Play $25 not committed. Task content preserved for v3 re-activation; no execution in v2.

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L2 — Admin RN Expo, §Module 4.8)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** DEFERRED-V3 (Jeff decision 2026-05-19 — focus v2 on web + PWA; revisit RN admin app in v3 after mobile traffic + customer demand data lands)
**Est. effort:** 8 h AI + 30 min Jeff review (bundle ID confirm + first EAS build sign-in)
**Deploy window:** any time — new directory only, no impact on existing apps

## Goal

Bootstrap `packages/mobile/` as an Expo SDK 51+ project with `expo-router`, NativeWind (Tailwind for RN), tRPC client, `expo-notifications` + `expo-secure-store`, and configure EAS Build profiles for dev/preview/production. **No screens yet** — that's Module 4.10+. This module ships the runnable scaffold ready to consume `@packgo/shared` (Module 4.7) and the OAuth flow (Module 4.9).

Per **Stage 3 entry decision #7 (locked default)**: bundle ID `com.packgo.admin`.

## Pre-requisites

- **Module 4.7 merged** (monorepo workspace + `@packgo/shared` ready to import).
- Wave 1 complete (observability — Sentry React Native sibling will be added in Module 4.13 / sentry-expo).
- Jeff has an Apple Developer account ($99/yr) OR will sign up — flag at Decision section.
- Jeff has a Google Play Console account ($25 one-time) OR will sign up.
- Jeff has an Expo account (free) — flagged in Stage 3 entry checklist.

## Inputs (read these before executing)

- `packages/shared/index.ts` (from Module 4.7) — what the Expo app will import.
- `server/routers.ts` — `AppRouter` type the tRPC client will consume.
- `client/src/lib/trpc.ts` — current tRPC config pattern (HttpBatchLink, headers); we'll mirror for mobile.
- `CLAUDE.md` §2.1 — rounded corners (RN uses numeric `borderRadius`, e.g., `borderRadius: 12` instead of `rounded-xl`).
- `CLAUDE.md` §2.2 — brand colors (used in NativeWind theme).
- Expo SDK 51 docs: https://docs.expo.dev/versions/v51.0.0/
- EAS Build docs: https://docs.expo.dev/build/setup/
- v2-plan §Module 4.8.

## Scope (what this module owns)

- ✅ `packages/mobile/` — NEW directory with full Expo project structure.
- ✅ `packages/mobile/package.json` — Expo SDK 51, `expo-router`, `expo-secure-store`, `expo-notifications`, `@trpc/react-query`, `@tanstack/react-query`, `nativewind`, `react-native-reanimated`, etc.
- ✅ `packages/mobile/app.json` — Expo config (bundle ID, icons, splash, plugins).
- ✅ `packages/mobile/eas.json` — EAS Build profiles (development/preview/production).
- ✅ `packages/mobile/tsconfig.json` — extends root, references `@packgo/shared`.
- ✅ `packages/mobile/tailwind.config.js` — NativeWind config mirroring `client/tailwind.config.ts` colors (brand teal, rounded values).
- ✅ `packages/mobile/babel.config.js` — NativeWind babel plugin.
- ✅ `packages/mobile/metro.config.js` — Metro bundler with monorepo support (resolveSymlinks).
- ✅ `packages/mobile/app/_layout.tsx` — root layout with TRPC provider + QueryClient + theme.
- ✅ `packages/mobile/app/index.tsx` — placeholder home screen showing "PACK&GO Admin (Module 4.10+ ships screens)".
- ✅ `packages/mobile/_core/trpc.ts` — tRPC client setup using `AppRouter` from `@packgo/shared/trpc`.
- ✅ `packages/mobile/_core/theme.ts` — design tokens (CLAUDE.md §2.2 colors + §2.1 borderRadius mapping).
- ✅ README in `packages/mobile/README.md` — local-dev quickstart (Expo Go vs dev-client).
- ❌ NOT in scope: OAuth (Module 4.9), real screens (Modules 4.10-4.12), push subscription on device (Module 4.13), Detox tests (Module 4.14), App Store submission (Module 4.15).

## Procedure

1. **Read all inputs** (especially `client/src/lib/trpc.ts` to mirror config and `tailwind.config.ts` for colors).

2. **Bootstrap Expo skeleton:**
   ```bash
   cd packages/
   pnpm create expo-app mobile --template tabs@51
   cd mobile
   pnpm add expo-router expo-secure-store expo-notifications expo-auth-session expo-crypto
   pnpm add @trpc/client @trpc/react-query @tanstack/react-query superjson zod
   pnpm add nativewind react-native-reanimated react-native-svg
   pnpm add -D tailwindcss@3 @types/react @types/react-native
   pnpm add @packgo/shared@workspace:*
   ```

3. **Configure `packages/mobile/app.json`:**
   ```json
   {
     "expo": {
       "name": "PACK&GO Admin",
       "slug": "packgo-admin",
       "version": "0.1.0",
       "orientation": "portrait",
       "icon": "./assets/icon.png",
       "scheme": "packgo",
       "userInterfaceStyle": "automatic",
       "splash": {
         "image": "./assets/splash.png",
         "resizeMode": "contain",
         "backgroundColor": "#0D9488"
       },
       "ios": {
         "bundleIdentifier": "com.packgo.admin",
         "supportsTablet": false,
         "buildNumber": "1",
         "associatedDomains": ["applinks:packgo09.manus.space"],
         "infoPlist": {
           "NSCameraUsageDescription": "PACK&GO Admin may need camera access for receipt scanning.",
           "ITSAppUsesNonExemptEncryption": false
         }
       },
       "android": {
         "package": "com.packgo.admin",
         "versionCode": 1,
         "adaptiveIcon": {
           "foregroundImage": "./assets/adaptive-icon.png",
           "backgroundColor": "#0D9488"
         },
         "intentFilters": [
           {
             "action": "VIEW",
             "data": [{ "scheme": "https", "host": "packgo09.manus.space", "pathPrefix": "/auth/mobile" }],
             "category": ["BROWSABLE", "DEFAULT"],
             "autoVerify": true
           }
         ]
       },
       "plugins": [
         "expo-router",
         "expo-secure-store",
         "expo-notifications"
       ],
       "experiments": { "typedRoutes": true },
       "extra": {
         "router": { "origin": false },
         "eas": { "projectId": "FILL_AFTER_FIRST_EAS_BUILD" }
       }
     }
   }
   ```

   **Note:** `associatedDomains` (iOS) and `intentFilters` (Android) prep for Module 4.9 OAuth Universal Links. The actual `/.well-known/apple-app-site-association` on `packgo09.manus.space` is set up in Module 4.9.

4. **`packages/mobile/eas.json`:**
   ```json
   {
     "cli": { "version": ">= 5.0.0" },
     "build": {
       "development": {
         "developmentClient": true,
         "distribution": "internal",
         "ios": { "resourceClass": "m-medium" },
         "android": { "gradleCommand": ":app:assembleDebug" }
       },
       "preview": {
         "distribution": "internal",
         "channel": "preview",
         "ios": { "resourceClass": "m-medium" },
         "android": { "buildType": "apk" }
       },
       "production": {
         "channel": "production",
         "autoIncrement": true,
         "ios": { "resourceClass": "m-medium" },
         "android": { "buildType": "app-bundle" }
       }
     },
     "submit": {
       "production": {
         "ios": {
           "appleId": "FILL_JEFF_APPLE_ID",
           "ascAppId": "FILL_AFTER_ASC_LISTING"
         },
         "android": {
           "serviceAccountKeyPath": "./google-play-service-account.json",
           "track": "internal"
         }
       }
     }
   }
   ```

5. **`packages/mobile/tsconfig.json`:**
   ```json
   {
     "extends": "expo/tsconfig.base",
     "compilerOptions": {
       "strict": true,
       "paths": {
         "@/*": ["./*"]
       }
     },
     "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
   }
   ```

6. **`packages/mobile/tailwind.config.js`:**
   ```js
   module.exports = {
     content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
     presets: [require('nativewind/preset')],
     theme: {
       extend: {
         colors: {
           primary: '#0D9488', // teal-600 per CLAUDE.md §2.2
           foreground: '#111827',
           card: '#F9FAFB',
         },
         borderRadius: {
           // Mirror CLAUDE.md §2.1 — but in RN these are numeric in component style
           lg: 8,
           xl: 12,
           '3xl': 24,
         },
       },
     },
     plugins: [],
   };
   ```

7. **`packages/mobile/babel.config.js`:**
   ```js
   module.exports = function (api) {
     api.cache(true);
     return {
       presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
       plugins: ['react-native-reanimated/plugin'],
     };
   };
   ```

8. **`packages/mobile/metro.config.js` (monorepo-aware):**
   ```js
   const { getDefaultConfig } = require('expo/metro-config');
   const path = require('path');

   const projectRoot = __dirname;
   const workspaceRoot = path.resolve(projectRoot, '../..');

   const config = getDefaultConfig(projectRoot);
   config.watchFolders = [workspaceRoot];
   config.resolver.nodeModulesPaths = [
     path.resolve(projectRoot, 'node_modules'),
     path.resolve(workspaceRoot, 'node_modules'),
   ];
   config.resolver.disableHierarchicalLookup = true;

   module.exports = config;
   ```

9. **`packages/mobile/_core/trpc.ts`:**
   ```ts
   import { createTRPCReact } from '@trpc/react-query';
   import type { AppRouter } from '@packgo/shared/trpc';

   export const trpc = createTRPCReact<AppRouter>();
   ```

10. **`packages/mobile/_core/theme.ts`:**
    ```ts
    /**
     * Mirror CLAUDE.md §2 design tokens for use in RN style objects.
     * borderRadius is numeric here (RN doesn't speak Tailwind classes
     * directly outside NativeWind className).
     */
    export const theme = {
      colors: {
        primary: '#0D9488',
        foreground: '#111827',
        background: '#FFFFFF',
        card: '#F9FAFB',
        muted: '#6B7280',
        border: '#E5E7EB',
      },
      borderRadius: {
        sm: 6,
        md: 6,
        lg: 8,
        xl: 12,
        '2xl': 16,
        '3xl': 24,
        full: 9999,
      },
      spacing: {
        '1': 4,
        '2': 8,
        '3': 12,
        '4': 16,
        '6': 24,
        '8': 32,
      },
    } as const;
    ```

11. **`packages/mobile/app/_layout.tsx`:**
    ```tsx
    import { Stack } from 'expo-router';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { httpBatchLink } from '@trpc/client';
    import { useState } from 'react';
    import superjson from 'superjson';
    import { trpc } from '../_core/trpc';
    import { theme } from '../_core/theme';

    const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://packgo09.manus.space';

    export default function RootLayout() {
      const [queryClient] = useState(() => new QueryClient());
      const [trpcClient] = useState(() =>
        trpc.createClient({
          links: [httpBatchLink({ url: `${API_URL}/api/trpc`, transformer: superjson })],
        }),
      );

      return (
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <Stack screenOptions={{ headerStyle: { backgroundColor: theme.colors.primary }, headerTintColor: '#fff' }} />
          </QueryClientProvider>
        </trpc.Provider>
      );
    }
    ```

12. **`packages/mobile/app/index.tsx` — placeholder:**
    ```tsx
    import { Text, View } from 'react-native';
    import { theme } from '../_core/theme';

    /**
     * Placeholder home. Module 4.9 adds login redirect; Modules 4.10-4.12
     * add real screens (inbox, agent chat, bookings).
     *
     * CLAUDE.md §2.1: rounded corners use numeric borderRadius in RN.
     */
    export default function Home() {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <View style={{
            borderRadius: theme.borderRadius.xl, // 12 — matches rounded-xl on web
            backgroundColor: theme.colors.card,
            padding: 24,
            shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
          }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: theme.colors.foreground }}>
              PACK&GO Admin
            </Text>
            <Text style={{ marginTop: 8, color: theme.colors.muted }}>
              Module 4.8 scaffold. Login + screens ship in 4.9–4.12.
            </Text>
          </View>
        </View>
      );
    }
    ```

13. **`packages/mobile/README.md`:**
    ```markdown
    # PACK&GO Admin (Mobile)

    Expo SDK 51 admin app. Customer site lives at `client/` — this is admin-only.

    ## Local dev
    cd packages/mobile && pnpm install (from repo root)
    pnpm start  # opens Expo Dev Tools
    Use Expo Go on iPhone or Android Studio emulator initially. Later modules require dev-client (Module 4.13 push).

    ## EAS Build
    eas login
    eas build --profile development --platform ios

    Module 4.15 covers App Store / Play Store submission flow.

    See docs/refactor/v2-plan.md §Wave 4 for module sequence.
    ```

14. **First-time EAS init (Jeff-side):**
    ```bash
    cd packages/mobile
    eas init  # creates an EAS project, fills the projectId in app.json
    eas build --profile development --platform ios --non-interactive --no-wait
    ```
    Result: a first build URL in EAS dashboard. Doesn't have to complete for this module to merge; build status is checked separately.

15. **Verify locally:**
    ```bash
    cd packages/mobile
    pnpm start
    # Press 'i' for iOS simulator (requires Xcode) or 'a' for Android emulator
    # Or scan QR with Expo Go on a real device
    ```
    Placeholder home screen should render with the brand-teal card.

## Acceptance Criteria

- [ ] `packages/mobile/` exists with full Expo SDK 51 layout.
- [ ] `packages/mobile/package.json` lists Expo + expo-router + expo-secure-store + expo-notifications + @trpc/* + @packgo/shared workspace dep.
- [ ] `packages/mobile/app.json` has bundle ID `com.packgo.admin` (iOS + Android), scheme `packgo`, associatedDomains + intentFilters for OAuth Universal/App Links.
- [ ] `packages/mobile/eas.json` has 3 profiles (development/preview/production) + submit config skeleton.
- [ ] `packages/mobile/tailwind.config.js` mirrors `CLAUDE.md` §2.2 colors (primary `#0D9488`) and §2.1 borderRadius (lg=8, xl=12, 3xl=24).
- [ ] `packages/mobile/_core/theme.ts` exports numeric `borderRadius` map for RN style objects.
- [ ] `packages/mobile/app/_layout.tsx` wires TRPC provider + QueryClient against `EXPO_PUBLIC_API_URL` (defaults to prod).
- [ ] `packages/mobile/app/index.tsx` placeholder renders a `borderRadius: 12` card (CLAUDE.md §2.1 compliance for RN).
- [ ] `pnpm install` at repo root succeeds with the new workspace package.
- [ ] `pnpm tsc --noEmit` exit 0 (root) AND `cd packages/mobile && pnpm tsc --noEmit` exit 0.
- [ ] `pnpm start` in `packages/mobile` boots Expo Dev Tools.
- [ ] Placeholder home renders in iOS simulator + Android emulator (or Expo Go).
- [ ] **Test:** `packages/mobile/_core/theme.test.ts` — 2 cases: (a) primary color matches CLAUDE.md `#0D9488`, (b) `borderRadius.xl === 12` (matches `rounded-xl` web equivalent). **Required per CLAUDE.md §九.**
- [ ] `eas init` complete (Jeff-side) + projectId populated in app.json.
- [ ] First `eas build --profile development --platform ios` triggers (don't need to wait for completion in this module).

## Deliverable

- New directory: `packages/mobile/` with ~15 files as outlined above.
- Modified: root `pnpm-lock.yaml`.

**Commit message:**

```
feat(mobile): Wave 4 module 4.8 — Expo SDK 51 scaffold + EAS config

- packages/mobile/ — admin RN app, bundle id com.packgo.admin (both platforms)
- Expo Router 3.x typed routes; NativeWind for Tailwind-in-RN parity
- tRPC client wired against AppRouter from @packgo/shared
- Numeric borderRadius theme tokens mirror CLAUDE.md §2.1 web rounded-* classes
- EAS profiles: development (dev-client), preview (internal APK), production
- Universal Links / App Links wired in app.json for Module 4.9 OAuth flow
- Placeholder home renders a brand-teal card; Module 4.10+ ships real screens
- Vitest validates theme tokens match CLAUDE.md §2

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.8
```

## Rollback

- Single revert removes `packages/mobile/` directory + root lockfile change.
- No effect on `client/`, `server/`, `packages/shared/` (the latter is consumed but not modified).
- EAS account state remains (project still exists in EAS dashboard); harmless if unused.

## Manual intervention

- **Jeff (required, ~15 min):**
  - Sign in to Expo account: `eas login` from `packages/mobile/`.
  - Run `eas init` — generates project ID; the supervisor pastes it into `app.json` after.
- **Jeff (required, before Module 4.15):**
  - **Apple Developer Program** — $99/yr. Sign up at https://developer.apple.com/programs/ if not enrolled. ~$99 + ID verification time (~24-48h).
  - **Google Play Console** — $25 one-time. Sign up at https://play.google.com/console/.
  - These are not blocking for Module 4.8 itself (dev builds via EAS work on free Apple ID + Expo Go works without Play Console), but are blocking for Module 4.15 submission.
- **Jeff (recommended, ~5 min):**
  - Verify bundle ID `com.packgo.admin` is acceptable (vs `com.packandgo.admin` or other). Bundle ID is **immutable once published** — Lock before merging this module to be safe.
  - Open `packages/mobile` in Expo Go on Jeff's iPhone via QR scan — confirm placeholder renders.

## Test plan

**Vitest:** `packages/mobile/_core/theme.test.ts` — 2 cases:

1. **Brand color parity:** `expect(theme.colors.primary).toBe('#0D9488')` (matches CLAUDE.md §2.2 `--primary`).
2. **borderRadius parity with web:** `expect(theme.borderRadius.xl).toBe(12)`, `theme.borderRadius.lg === 8`, `theme.borderRadius['3xl'] === 24` (mirrors web's `rounded-xl/lg/3xl` semantic values).

**Regression anchor:** root `pnpm test` count unchanged + 2 new cases.

**Manual smoke (Jeff-side):**
- `pnpm start` boots — no metro/babel errors.
- Press `i` → simulator opens → placeholder renders.
- iOS Expo Go on real device via QR → renders.
- Android emulator (if available) → renders.

## Decisions needed (Jeff)

1. **Bundle ID** — `com.packgo.admin` plan-locked. **CRITICAL: immutable post-publish.** Confirm spelling before merge.
2. **EAS Build cost** — EAS free tier: 30 build/mo macOS, 1 build concurrency. For Wave 4 (~20 builds expected during dev), this is enough. Beyond v2 may need EAS Production plan ($99/mo). Flag if budget concerns.
3. **Apple Developer Program enrollment** — $99/yr required for App Store submission (Module 4.15). Confirm Jeff already has it OR plans to enroll. ID verification adds 24-48h.
4. **Google Play Console** — $25 one-time. Confirm Jeff enrolls OR if admin-app-on-Android-only is via internal-testing track (no public listing).
5. **Default API URL** — `EXPO_PUBLIC_API_URL` defaults to `https://packgo09.manus.space`. For dev, Jeff likely overrides to staging or local LAN. Document in `packages/mobile/.env.example`.
6. **iOS associatedDomains host** — currently `packgo09.manus.space`. If Jeff uses a custom domain (e.g., `app.packgo.com`), update before Module 4.9 OAuth spike — the host must match where `/.well-known/apple-app-site-association` is served.
