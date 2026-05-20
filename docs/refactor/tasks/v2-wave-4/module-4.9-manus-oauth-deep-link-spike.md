# v2 · Wave 4 · Module 4.9 — Manus OAuth deep-link / Universal Link SPIKE (WAVE-4 BLOCKER)

> ⏸️ **DEFERRED to v3** — Apple Developer Program $99/yr + Google Play $25 not committed. Task content preserved for v3 re-activation; no execution in v2.

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L2 — Admin RN Expo, §Module 4.9) + risk register #3
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** DEFERRED-V3 (Jeff decision 2026-05-19 — focus v2 on web + PWA; revisit RN admin app in v3 after mobile traffic + customer demand data lands)
**Est. effort:** 12 h AI + 1 h Jeff review (Manus OAuth redirect URI registration + sign off)
**Deploy window:** any time — backend changes are additive (`/auth/mobile` callback page); mobile changes are inside `packages/mobile/` only.

## Goal

**This is a design spike, not a feature**. Prove out a working Manus OAuth flow from inside the Expo RN admin app before Modules 4.10-4.12 invest in screens that assume authentication works. The spike resolves the **highest-risk unknown in Wave 4**:

- **Path A (preferred):** Manus OAuth accepts custom redirect URI `packgo://auth/callback` → use `expo-auth-session` PKCE flow → tokens stored in `expo-secure-store`.
- **Path B (fallback):** Manus only accepts https redirect URIs → use Universal Links (iOS) + App Links (Android) on `https://packgo09.manus.space/auth/mobile` → app intercepts → exchanges code for token.
- **Path C (escape hatch):** Both deep-link approaches fail → use in-app WebView with cookie bridge (degraded session lifespan; ship admin app with caveat).

The spike must conclude with a working "login → home" round-trip on a dev build of the Expo app, OR a documented blocker escalated to Jeff for vendor-side resolution.

## Pre-requisites

- **Modules 4.7 + 4.8 merged.** Expo app scaffold + monorepo workspace required.
- Manus OAuth provider documentation accessible (Jeff to provide redirect URI config UI / docs).
- A registered Manus OAuth client for the mobile app (might be the same as the web client OR a new one — Jeff confirms during spike).
- Read access to `server/manusOAuth.ts` (or wherever the web OAuth flow lives — search via `grep -r "manus" server/_core/ server/`).
- Wave 1 Sentry available — capture spike-phase errors verbosely.

## Inputs (read these before executing)

- `server/manusOAuth.ts` (or equivalent) — current web OAuth implementation; tells us the token shape + scope strings + token-endpoint URL.
- `client/src/_core/hooks/useAuth.ts` — web's auth state hook; we'll mirror this for mobile.
- `server/_core/index.ts` — env vars for Manus OAuth client ID/secret.
- Manus provider config UI (Jeff-side login to Manus admin panel) — to add the mobile app's redirect URI(s).
- `packages/mobile/app.json` (Module 4.8) — already has `scheme: "packgo"` + iOS `associatedDomains` + Android `intentFilters` declared in anticipation.
- Expo AuthSession docs: https://docs.expo.dev/guides/authentication/#redirect-uri-patterns
- Apple's `apple-app-site-association` spec: https://developer.apple.com/documentation/xcode/supporting-associated-domains
- Android App Links: https://developer.android.com/training/app-links

## Scope (what this module owns)

**Spike-mode scope** — proven path lands as code; other paths get DEFERRED comments.

- ✅ `server/routes/authMobile.ts` (or wherever Hono routes are wired) — NEW route `GET /auth/mobile` that:
  - If `?code=...&state=...` query present: serves an HTML page with JS that opens `packgo://auth/callback?code=...&state=...` (works as Universal Link fallback).
  - Otherwise: serves an HTML "open the app to continue" landing.
- ✅ `client/public/.well-known/apple-app-site-association` — NEW (no extension!) JSON file declaring iOS Universal Link association. Served from `https://packgo09.manus.space/.well-known/apple-app-site-association` with `Content-Type: application/json`.
- ✅ `client/public/.well-known/assetlinks.json` — NEW Android App Links association file.
- ✅ `packages/mobile/app/login.tsx` — login screen with "Sign in with Manus" button.
- ✅ `packages/mobile/_core/auth.ts` — auth state context: `useAuth()` hook + `signIn()` / `signOut()` actions using `expo-auth-session` + `expo-secure-store`.
- ✅ `packages/mobile/app/_layout.tsx` — wrap with `<AuthProvider>` + protected route guard (redirect unauthed users to `/login`).
- ✅ Spike report appended to this task file's `## Spike findings` section (filled by executing agent).
- ❌ NOT in scope: any screen content beyond login (Modules 4.10-4.12), push subscription on device (Module 4.13), Detox tests (Module 4.14).

## Procedure

### Phase 1 — Discovery (~2h)

1. **Jeff-side: gather Manus OAuth specs.** Specifically need to know:
   - Authorize URL (likely `https://auth.manus.space/oauth/authorize` or similar)
   - Token URL
   - Required scopes (web likely uses `email profile`; mobile probably same)
   - Whether mobile needs a separate client ID or can reuse web's
   - **Redirect URI policy:** does Manus accept `packgo://...` custom schemes? Or only `https://...`? — this is the spike's pivotal question.
2. **Read `server/manusOAuth.ts`** — extract URLs, scope strings, token shape.
3. **Decide path A vs B based on Manus policy.** Document the decision in the `## Spike findings` section at the bottom of this file.

### Phase 2A — IF custom scheme works (Path A) (~4h)

4a. **Register `packgo://auth/callback` as a redirect URI in Manus OAuth admin** — Jeff does this in Manus UI; 10 min.
5a. **`packages/mobile/_core/auth.ts`:**
   ```ts
   import * as AuthSession from 'expo-auth-session';
   import * as SecureStore from 'expo-secure-store';
   import * as WebBrowser from 'expo-web-browser';
   import { createContext, useContext, useEffect, useState } from 'react';

   WebBrowser.maybeCompleteAuthSession();

   const MANUS_CLIENT_ID = process.env.EXPO_PUBLIC_MANUS_MOBILE_CLIENT_ID!;
   const MANUS_AUTHORIZE_URL = 'https://auth.manus.space/oauth/authorize'; // FILL after Phase 1
   const MANUS_TOKEN_URL = 'https://auth.manus.space/oauth/token';

   const discovery = {
     authorizationEndpoint: MANUS_AUTHORIZE_URL,
     tokenEndpoint: MANUS_TOKEN_URL,
   };

   type AuthCtx = { token: string | null; signIn: () => Promise<void>; signOut: () => Promise<void> };
   const Ctx = createContext<AuthCtx>({ token: null, signIn: async () => {}, signOut: async () => {} });

   export function AuthProvider({ children }: { children: React.ReactNode }) {
     const [token, setToken] = useState<string | null>(null);
     const redirectUri = AuthSession.makeRedirectUri({ scheme: 'packgo', path: 'auth/callback' });

     const [request, response, promptAsync] = AuthSession.useAuthRequest({
       clientId: MANUS_CLIENT_ID,
       scopes: ['email', 'profile'],
       redirectUri,
       responseType: 'code',
       usePKCE: true,
     }, discovery);

     useEffect(() => {
       SecureStore.getItemAsync('manus_access_token').then(setToken);
     }, []);

     useEffect(() => {
       if (response?.type === 'success' && request?.codeVerifier) {
         AuthSession.exchangeCodeAsync({
           clientId: MANUS_CLIENT_ID,
           code: response.params.code,
           redirectUri,
           extraParams: { code_verifier: request.codeVerifier },
         }, discovery).then(async ({ accessToken }) => {
           await SecureStore.setItemAsync('manus_access_token', accessToken);
           setToken(accessToken);
         });
       }
     }, [response]);

     const signIn = async () => { await promptAsync(); };
     const signOut = async () => {
       await SecureStore.deleteItemAsync('manus_access_token');
       setToken(null);
     };

     return <Ctx.Provider value={{ token, signIn, signOut }}>{children}</Ctx.Provider>;
   }

   export const useAuth = () => useContext(Ctx);
   ```

6a. Wire `<AuthProvider>` in `app/_layout.tsx`; gate routes — redirect unauthed to `/login`.

### Phase 2B — IF custom scheme rejected (Path B Universal Links) (~6h)

4b. **Register `https://packgo09.manus.space/auth/mobile` as the redirect URI in Manus admin.**
5b. **Serve Apple App Site Association file** at `https://packgo09.manus.space/.well-known/apple-app-site-association`:
   ```json
   {
     "applinks": {
       "details": [
         {
           "appIDs": ["TEAMID.com.packgo.admin"],
           "components": [{ "/": "/auth/mobile*" }]
         }
       ]
     }
   }
   ```
   **CRITICAL:** Content-Type must be `application/json`, file extension is none, NOT signed (modern iOS doesn't require signing).
   Configure Hono to serve this file with the right MIME type.

6b. **Serve Android assetlinks.json** at `https://packgo09.manus.space/.well-known/assetlinks.json`:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": { "namespace": "android_app", "package_name": "com.packgo.admin",
                 "sha256_cert_fingerprints": ["FILL_FROM_EAS_BUILD"] }
   }]
   ```
   `sha256_cert_fingerprints` comes from `eas credentials` for the production keystore.

7b. **`server/routes/authMobile.ts`** — Hono handler at `/auth/mobile`:
   ```ts
   app.get('/auth/mobile', (c) => {
     const code = c.req.query('code');
     const state = c.req.query('state');
     // If iOS Universal Link works, we never see this server-side at all
     // (the app intercepts directly). This page is the fallback for users
     // who don't yet have the app installed.
     if (code) {
       return c.html(`
         <!DOCTYPE html><html><head><meta charset="utf-8"><title>PACK&GO Admin</title></head>
         <body>
           <p>正在開啟 PACK&GO Admin... / Opening PACK&GO Admin...</p>
           <script>
             window.location = 'packgo://auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state ?? '')}';
             setTimeout(() => {
               document.body.innerHTML += '<p>App not installed? <a href="https://apps.apple.com/...">Download for iOS</a> | <a href="https://play.google.com/...">Android</a></p>';
             }, 2000);
           </script>
         </body></html>
       `);
     }
     return c.html('<p>Open the PACK&GO Admin app to continue.</p>');
   });
   ```
8b. **`auth.ts`** in the app uses same `expo-auth-session` flow but `redirectUri = 'https://packgo09.manus.space/auth/mobile'`.

### Phase 2C — Escape hatch (Path C WebView fallback) (~6h)

If neither A nor B works: implement in-app WebView wrapping the web OAuth flow with cookie persistence via `expo-web-browser` `openAuthSessionAsync`. **Document degraded session lifespan** (cookies expire on app force-close on some iOS versions).

### Phase 3 — Verification (~2h)

9. **`packages/mobile/app/login.tsx`** — minimal login screen with brand-styled "Sign in with Manus" button.
10. **`packages/mobile/app/_layout.tsx`** — wrap with `<AuthProvider>`; if `useAuth().token === null`, redirect to `/login`.
11. **Smoke test on iOS dev build:**
    - `eas build --profile development --platform ios`
    - Install on Jeff's iPhone via TestFlight or direct.
    - Launch → redirected to /login → tap "Sign in" → Manus OAuth page opens → sign in → returns to app, token stored, lands on placeholder home.
12. **Smoke test on Android Expo Go (or dev build):**
    - Same flow.
13. **Document path** taken (A / B / C) in `## Spike findings` section at the bottom of this file. Append URLs, gotchas, screenshots if useful.

## Acceptance Criteria

- [ ] **Spike conclusion documented** in `## Spike findings` section (which path A/B/C taken + why).
- [ ] Working login → token → home round-trip on iOS dev build.
- [ ] Working login → token → home round-trip on Android (Expo Go OR dev build).
- [ ] Tokens stored via `expo-secure-store` (keychain on iOS, Keystore on Android). NOT AsyncStorage. NOT plaintext.
- [ ] Token persists across app restart.
- [ ] `signOut()` clears the token; navigating to a protected route redirects back to `/login`.
- [ ] `packages/mobile/_core/auth.ts` exports `<AuthProvider>` + `useAuth()` hook with `{ token, signIn, signOut }`.
- [ ] (If Path B taken) `client/public/.well-known/apple-app-site-association` and `assetlinks.json` are served with correct MIME types — verified via `curl -I https://packgo09.manus.space/.well-known/apple-app-site-association`.
- [ ] (If Path B taken) `server/routes/authMobile.ts` GET `/auth/mobile` handles the redirect from Manus.
- [ ] `pnpm tsc --noEmit` exit 0 both at root and in `packages/mobile/`.
- [ ] **Test:** `packages/mobile/_core/auth.test.ts` — 3 cases:
  - (a) Initial state: `token === null` when SecureStore empty.
  - (b) After successful `signIn()` (mocked `exchangeCodeAsync` returns token): token in state + SecureStore.setItem called.
  - (c) `signOut()` clears state + SecureStore.deleteItem called.
  - **Required per CLAUDE.md §九.**
- [ ] No regression in existing `pnpm test` count.
- [ ] If escalation to Path C (WebView): **documented session-lifespan caveat in this file's findings section AND in `packages/mobile/README.md`.**

## Deliverable

- New (always): `packages/mobile/_core/auth.ts`, `packages/mobile/_core/auth.test.ts`, `packages/mobile/app/login.tsx`
- New (Path B only): `client/public/.well-known/apple-app-site-association`, `client/public/.well-known/assetlinks.json`, `server/routes/authMobile.ts` (or addition to existing routes file)
- Modified: `packages/mobile/app/_layout.tsx`, `.env.example` (add `EXPO_PUBLIC_MANUS_MOBILE_CLIENT_ID`)
- Spike findings appended to **this file's bottom section**.

**Commit message:**

```
feat(mobile-auth): Wave 4 module 4.9 — Manus OAuth spike resolved (Path X)

[FILL Path A custom scheme / Path B Universal Links / Path C WebView]

Resolution summary:
- Manus OAuth redirect URI policy: [accepts custom / https-only / etc.]
- Token exchange via expo-auth-session PKCE flow
- Tokens persisted in expo-secure-store (keychain/keystore)
- Auto-redirect unauthed users to /login via _layout.tsx guard

[Path B additions]:
- /.well-known/apple-app-site-association served from Hono with
  application/json MIME type
- /.well-known/assetlinks.json with SHA256 from EAS prod keystore
- server/routes/authMobile.ts intercepts ?code= and bridges to packgo://

UNBLOCKS: Modules 4.10 (inbox), 4.11 (agent chat), 4.12 (bookings),
4.13 (push registration on device), 4.14 (Detox login.test.ts).

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.9, risk register #3
```

## Rollback

- Path A revert: removes auth.ts + login screen; placeholder home (Module 4.8) still works.
- Path B revert: ALSO removes the `.well-known/` files and `/auth/mobile` route — server-side change additional. Web admin login unaffected (separate route).
- No DB / migration touched.
- If a bad apple-app-site-association deploys to prod, iOS caches it for up to 24h — emergency fix would require Apple Support, so **deploy only to staging first**, verify, then prod.

## Manual intervention

- **Jeff (CRITICAL, ~30 min):**
  - Sign in to Manus OAuth admin panel.
  - Register a redirect URI for the mobile app. Try `packgo://auth/callback` first; if rejected, register `https://packgo09.manus.space/auth/mobile`.
  - Document which path was accepted in the spike findings.
  - Provide the supervisor with the mobile client ID (could reuse web's if Manus allows).
- **Jeff (Path B only, ~15 min):**
  - Run `eas credentials` to extract Android SHA-256 fingerprint; provide to supervisor for `assetlinks.json`.
- **Jeff (~10 min):**
  - Test the OAuth flow on Jeff's iPhone with the dev build — verify "Sign in with Manus" round-trip works.
- **Jeff (escalation path):**
  - If Path C is taken, decide whether to ship admin app with the cookie-WebView caveat OR delay Wave 4 mobile to v3 pending Manus vendor changes.

## Test plan

**Vitest:** `packages/mobile/_core/auth.test.ts` — 3 cases (mock `expo-auth-session`, `expo-secure-store`):

1. **Initial empty state:** mock SecureStore empty → render `useAuth()` → `token === null`.
2. **Successful signIn:** mock `useAuthRequest` returns success response → mock `exchangeCodeAsync` returns `{accessToken: 'abc'}` → assert `SecureStore.setItemAsync('manus_access_token', 'abc')` called → `token === 'abc'` in hook state.
3. **signOut clears state:** initial token in SecureStore → call `signOut()` → assert `SecureStore.deleteItemAsync` called → hook state `token === null`.

**Regression anchor:** existing `pnpm test` count unchanged + 3 new cases.

**Manual smoke (Jeff-side, REQUIRED):**

- iOS device: dev build → tap "Sign in with Manus" → OAuth screen → grant → returns to app → home screen rendered.
- Force-quit + relaunch → still authenticated.
- Sign out → redirected to /login.
- Android: same flow.

## Spike findings (filled by executing agent at end)

**Path taken:** [A / B / C — fill]
**Reason:** [Manus OAuth accepts custom scheme YES/NO — fill after Phase 1]
**Token endpoint:** [URL]
**Scopes:** [list]
**Mobile client ID:** [separate from web YES/NO]
**Gotchas:**
- [fill: e.g., "iOS associatedDomains required app rebuild before recognizing the assoc file"]
- [fill: e.g., "expo-auth-session 5.x required maybeCompleteAuthSession() at module top"]
**Time spent vs estimate:** [fill: e.g., "10h actual vs 12h estimate — Path A worked first try"]
**Recommendations for follow-up modules (4.10+):**
- [fill]

## Decisions needed (Jeff)

1. **Manus OAuth client strategy** — reuse web client ID OR register new mobile client ID? Recommend: **separate client ID** for mobile if Manus allows, so revoking mobile doesn't affect web sessions. Lock during Phase 1.
2. **Token refresh strategy** — Manus probably issues short-lived access + long-lived refresh tokens. Where does refresh live? Recommend: store both in SecureStore; auto-refresh on 401 from tRPC client. This module's scope **ships access-token-only**; refresh flow is a follow-up if Manus tokens expire in <24h.
3. **Path C acceptability** — if both A and B fail, is WebView-with-cookie-bridge acceptable for admin app launch? Trade-off: works today vs degraded session (cookies clear on force-quit on iOS 17+). Recommend ship with caveat; fix in v3 when Manus catches up.
4. **Sentry RN integration timing** — Sentry catches OAuth flow errors. Wire `sentry-expo` here OR defer to Module 4.13? Recommend defer; Wave 1 Sentry server-side already catches the token-exchange errors.
5. **Production redirect URI** — currently uses prod URL `packgo09.manus.space`. For dev, override via `EXPO_PUBLIC_*` env. Confirm dev/staging URLs.
