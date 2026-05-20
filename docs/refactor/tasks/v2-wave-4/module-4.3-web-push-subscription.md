# v2 · Wave 4 · Module 4.3 — Web Push subscription + VAPID + `pushSubscriptions` table

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L1 — Customer PWA, §Module 4.3)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain) + risk register #1 (iOS Safari PWA push reliability)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 14 h AI + 30 min Jeff review (VAPID key gen + Stage 3 entry decision lock)
**Deploy window:** Tuesday/Wednesday 9-11am PT — first deploy of `pushSubscriptions` table requires migration with no app downtime

## Goal

Lay the **subscription side** of Web Push: VAPID keys, server endpoint for subscribe/unsubscribe, Drizzle `pushSubscriptions` table (migration 0080), and a client hook + permission-request flow. The **firing side** (server-side push events on booking/payment/itinerary) lives in Module 4.4.

This module is the largest L1 module. It also surfaces the **iOS Safari limitation** (only installed PWAs can receive push) — flagged as **Risk #1** in v2-plan risk register. The mitigation lives here too: a gating check that disables the subscribe prompt for non-standalone iOS Safari.

## Pre-requisites

- **Module 4.1 (manifest) + Module 4.2 (SW) merged.** Web Push requires both: manifest for the standalone-mode check, SW for receiving push events.
- Wave 1 complete — Sentry catches push-endpoint server errors; pino logs subscription/unsubscribe events.
- Migration 0078 (Wave 1 passport encryption) deployed — confirms migration pipeline working.
- `server/_core/tokenCrypto.ts` exists (reused for encrypting refresh-token-equivalents if needed for VAPID; not strictly required but available).

## Inputs (read these before executing)

- `drizzle/schema.ts` — current schema, find a good insertion point near `users` table for the new `pushSubscriptions` table (likely near `customerProfiles` line ~2428).
- `server/routers.ts` (post-Wave-1 / post-v1-refactor — currently ~283 LOC composition shell) — confirm registration pattern for new sub-router.
- `server/routers/` — pick a parallel module to mirror style. `server/routers/membership.ts` is a good fit (publicProcedure + protectedProcedure mix).
- `server/_core/index.ts` — env var validation; will need `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_CONTACT_EMAIL` added.
- Web Push docs: https://github.com/web-push-libs/web-push (the `web-push` npm package — used by Module 4.4, but install it here to keep the surface in one place).
- iOS Safari PWA push docs: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ (iOS 16.4+, only for standalone PWAs).
- `client/src/_core/hooks/useAuth.ts` — confirm hook pattern for the new `usePushSubscription` hook.

## Scope (what this module owns)

- ✅ `package.json` — add `web-push` (server) + dev type `@types/web-push`.
- ✅ `.env.example` — add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL` (mailto fallback for push provider abuse contact).
- ✅ `drizzle/0080_push_subscriptions.sql` — migration.
- ✅ `drizzle/schema.ts` — add `pushSubscriptions` table definition.
- ✅ `server/_core/webPush.ts` — VAPID-keyed `web-push` initialization (read keys from env once).
- ✅ `server/routers/push.ts` — NEW sub-router with `subscribe` / `unsubscribe` / `listMyDevices` procedures.
- ✅ `server/routers.ts` — composition-shell: register the new sub-router under namespace `push.*`.
- ✅ `client/src/_core/hooks/usePushSubscription.ts` — NEW hook that handles permission request + tRPC subscribe call.
- ✅ Vitest covering server subscribe/unsubscribe logic.
- ❌ NOT in scope: actually sending push messages (Module 4.4), install-prompt UX (Module 4.5), 3rd-tour-view trigger (Module 4.5 too), mobile RN push (Module 4.13).

## Procedure

1. **Read all input files.** Identify exact line in `drizzle/schema.ts` for table insertion. Identify exact tRPC sub-router registration pattern in `server/routers.ts`.

2. **Generate VAPID keys (Jeff-side, one-shot):**
   ```bash
   npx web-push generate-vapid-keys --json
   ```
   Jeff saves output `publicKey` + `privateKey` to:
   - Local `.env` for dev
   - Fly secrets for prod: `fly secrets set VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." VAPID_CONTACT_EMAIL="mailto:jeff@packgo.com"`

   **Add to `.env.example`** with placeholder + comment "Generated once via `npx web-push generate-vapid-keys`. NEVER regenerate after prod is live — existing subscriptions will all silently fail."

3. **Drizzle migration `drizzle/0080_push_subscriptions.sql`:**

   ```sql
   CREATE TABLE pushSubscriptions (
     id INT AUTO_INCREMENT PRIMARY KEY,
     userId INT NULL,           -- nullable: anonymous browsers can subscribe pre-login
     anonymousId VARCHAR(255) NULL,  -- PostHog-style anonymous ID
     endpoint TEXT NOT NULL,    -- Push provider endpoint URL (FCM / APNs-bridge / Mozilla)
     p256dh VARCHAR(255) NOT NULL,
     auth VARCHAR(255) NOT NULL,
     platform ENUM('web', 'ios-pwa', 'android-pwa') NOT NULL DEFAULT 'web',
     userAgent TEXT NULL,        -- debug
     createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     lastSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     revokedAt DATETIME NULL,    -- soft-delete (unsubscribe sets this)
     UNIQUE KEY uniq_endpoint (endpoint(255)),
     KEY idx_user (userId),
     KEY idx_anon (anonymousId),
     KEY idx_last_seen (lastSeenAt),
     CONSTRAINT fk_push_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
   );
   ```

   **Design notes:**
   - Endpoint is long (up to ~500 chars FCM) — `TEXT` is safer than `VARCHAR(500)`.
   - `userId` nullable so anonymous browse-mode users can subscribe; alias on login (similar to PostHog pattern).
   - `revokedAt` soft-delete preserves debug history; cron in Module 4.4 will hard-delete after 90d.
   - `platform` enum lets Module 4.13 reuse this table for native APNs/FCM tokens.

4. **`drizzle/schema.ts` — add table definition mirroring SQL:**

   ```ts
   export const pushSubscriptions = mysqlTable("pushSubscriptions", {
     id: int("id").autoincrement().primaryKey(),
     userId: int("userId"),
     anonymousId: varchar("anonymousId", { length: 255 }),
     endpoint: text("endpoint").notNull(),
     p256dh: varchar("p256dh", { length: 255 }).notNull(),
     auth: varchar("auth", { length: 255 }).notNull(),
     platform: mysqlEnum("platform", ["web", "ios-pwa", "android-pwa"]).notNull().default("web"),
     userAgent: text("userAgent"),
     createdAt: datetime("createdAt", { mode: "date" }).notNull().default(sql`CURRENT_TIMESTAMP`),
     lastSeenAt: datetime("lastSeenAt", { mode: "date" }).notNull().default(sql`CURRENT_TIMESTAMP`),
     revokedAt: datetime("revokedAt", { mode: "date" }),
   }, (t) => ({
     uniqEndpoint: uniqueIndex("uniq_endpoint").on(t.endpoint),
     idxUser: index("idx_user").on(t.userId),
     idxAnon: index("idx_anon").on(t.anonymousId),
   }));
   ```

5. **`server/_core/webPush.ts`:**

   ```ts
   import webpush from 'web-push';
   import { logger } from './logger';

   const publicKey = process.env.VAPID_PUBLIC_KEY;
   const privateKey = process.env.VAPID_PRIVATE_KEY;
   const contact = process.env.VAPID_CONTACT_EMAIL ?? 'mailto:jeff@packgo.com';

   if (publicKey && privateKey) {
     webpush.setVapidDetails(contact, publicKey, privateKey);
   } else {
     logger.warn('VAPID keys not set — push notifications disabled');
   }

   export { webpush };
   export const VAPID_PUBLIC_KEY = publicKey ?? null;
   ```

   Exporting `VAPID_PUBLIC_KEY` so the client can fetch it via `push.getPublicKey` query (or hardcode in env-baked vars — see decision below).

6. **`server/routers/push.ts`:**

   ```ts
   import { z } from 'zod';
   import { router, publicProcedure, protectedProcedure } from '../trpc';
   import { db } from '../db';
   import { pushSubscriptions } from '../../drizzle/schema';
   import { VAPID_PUBLIC_KEY } from '../_core/webPush';
   import { eq, and } from 'drizzle-orm';

   const SubscriptionInputSchema = z.object({
     endpoint: z.string().url(),
     keys: z.object({
       p256dh: z.string(),
       auth: z.string(),
     }),
     platform: z.enum(['web', 'ios-pwa', 'android-pwa']).default('web'),
     anonymousId: z.string().optional(),
     userAgent: z.string().optional(),
   });

   export const pushRouter = router({
     getPublicKey: publicProcedure.query(() => ({ key: VAPID_PUBLIC_KEY })),

     subscribe: publicProcedure
       .input(SubscriptionInputSchema)
       .mutation(async ({ input, ctx }) => {
         const userId = ctx.user?.id ?? null;
         await db.insert(pushSubscriptions).values({
           userId,
           anonymousId: input.anonymousId ?? null,
           endpoint: input.endpoint,
           p256dh: input.keys.p256dh,
           auth: input.keys.auth,
           platform: input.platform,
           userAgent: input.userAgent ?? null,
         }).onDuplicateKeyUpdate({
           set: {
             userId,
             lastSeenAt: new Date(),
             revokedAt: null, // re-subscribe clears soft-delete
           },
         });
         return { ok: true };
       }),

     unsubscribe: publicProcedure
       .input(z.object({ endpoint: z.string().url() }))
       .mutation(async ({ input }) => {
         await db.update(pushSubscriptions)
           .set({ revokedAt: new Date() })
           .where(eq(pushSubscriptions.endpoint, input.endpoint));
         return { ok: true };
       }),

     listMyDevices: protectedProcedure.query(async ({ ctx }) => {
       return db.select().from(pushSubscriptions)
         .where(and(eq(pushSubscriptions.userId, ctx.user.id), eq(pushSubscriptions.revokedAt, null)));
     }),
   });
   ```

7. **Register in `server/routers.ts`:**
   ```ts
   import { pushRouter } from './routers/push';
   // ...
   export const appRouter = router({
     // ... existing
     push: pushRouter,
   });
   ```

8. **`client/src/_core/hooks/usePushSubscription.ts`:**

   ```tsx
   import { useEffect, useState } from 'react';
   import { trpc } from '@/lib/trpc';

   /**
    * iOS Safari ONLY supports Web Push in standalone-mode (Home Screen) PWAs.
    * For regular tabs on iOS, this hook detects and returns `supported: false`.
    */
   export function usePushSubscription() {
     const [supported, setSupported] = useState(false);
     const [permission, setPermission] = useState<NotificationPermission>('default');
     const [isStandalone, setIsStandalone] = useState(false);
     const { data: publicKeyData } = trpc.push.getPublicKey.useQuery();
     const subscribeMutation = trpc.push.subscribe.useMutation();
     const unsubscribeMutation = trpc.push.unsubscribe.useMutation();

     useEffect(() => {
       const standalone =
         (window.navigator as any).standalone === true ||
         window.matchMedia('(display-mode: standalone)').matches;
       setIsStandalone(standalone);

       // iOS: must be standalone for Web Push
       const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
       const usable = 'serviceWorker' in navigator && 'PushManager' in window && (!isIOS || standalone);
       setSupported(usable);
       setPermission(usable ? Notification.permission : 'denied');
     }, []);

     const subscribe = async () => {
       if (!supported || !publicKeyData?.key) return null;
       const perm = await Notification.requestPermission();
       setPermission(perm);
       if (perm !== 'granted') return null;

       const reg = await navigator.serviceWorker.ready;
       const sub = await reg.pushManager.subscribe({
         userVisibleOnly: true,
         applicationServerKey: urlBase64ToUint8Array(publicKeyData.key),
       });
       const json = sub.toJSON();
       const platform = (navigator.userAgent.includes('Android')) ? 'android-pwa' :
                        (/iPad|iPhone|iPod/.test(navigator.userAgent) ? 'ios-pwa' : 'web');
       await subscribeMutation.mutateAsync({
         endpoint: json.endpoint!,
         keys: json.keys as { p256dh: string; auth: string },
         platform,
         userAgent: navigator.userAgent,
       });
       return sub;
     };

     const unsubscribe = async () => {
       const reg = await navigator.serviceWorker.ready;
       const sub = await reg.pushManager.getSubscription();
       if (!sub) return;
       await sub.unsubscribe();
       await unsubscribeMutation.mutateAsync({ endpoint: sub.endpoint });
     };

     return { supported, permission, isStandalone, subscribe, unsubscribe };
   }

   function urlBase64ToUint8Array(base64String: string): Uint8Array {
     const padding = '='.repeat((4 - base64String.length % 4) % 4);
     const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
     const rawData = window.atob(base64);
     return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
   }
   ```

9. **Apply migration on staging FIRST:**
   ```bash
   pnpm drizzle-kit push:mysql --config drizzle/staging.config.ts
   # OR if production migrations are file-based: fly ssh console -a packgo-staging --command 'pnpm db:migrate'
   ```

10. **Smoke test on staging:**
    - Set Fly secrets: `fly secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... -a packgo-staging`
    - Deploy.
    - Open staging in Chrome on Android (or desktop) → DevTools console:
      ```js
      const sub = await (await navigator.serviceWorker.ready).pushManager.subscribe({...})
      ```
    - Verify row appears in `pushSubscriptions` table.
    - Call `push.unsubscribe` from trpc devtools → verify `revokedAt` set.

11. **Prod deploy:**
    - Apply migration via release_command (already configured in `fly.toml`).
    - Set prod Fly secrets.
    - Deploy.

## Acceptance Criteria

- [ ] `drizzle/0080_push_subscriptions.sql` exists and applied on staging + prod.
- [ ] `drizzle/schema.ts` has `pushSubscriptions` export matching the migration.
- [ ] `pnpm drizzle-kit check` passes (no schema drift between migration and schema.ts).
- [ ] `server/_core/webPush.ts` exists; `server/routers/push.ts` exists with 4 procedures (`getPublicKey`, `subscribe`, `unsubscribe`, `listMyDevices`).
- [ ] `server/routers.ts` registers the new sub-router as `push.*`.
- [ ] `client/src/_core/hooks/usePushSubscription.ts` exists, exports `{ supported, permission, isStandalone, subscribe, unsubscribe }`.
- [ ] `.env.example` updated with 3 new VAPID vars.
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] **Tests:** `server/routers/push.test.ts` — 4 cases: (a) subscribe creates row, (b) duplicate endpoint upserts (no constraint error), (c) unsubscribe sets `revokedAt`, (d) listMyDevices excludes revoked. **Required per CLAUDE.md §九.**
- [ ] **Tests:** `client/src/_core/hooks/usePushSubscription.test.ts` — 3 cases: (a) iOS non-standalone → `supported: false`, (b) Chrome → `supported: true`, (c) `subscribe()` calls `Notification.requestPermission` + tRPC mutation. **Required.**
- [ ] Manual smoke: staging Chrome → DevTools → manual subscribe via console → row appears in DB.
- [ ] Manual smoke: staging iOS Safari (regular tab, not installed) → hook returns `supported: false`.
- [ ] No regression in existing `pnpm test` count.

## Deliverable

- New: `server/_core/webPush.ts`, `server/routers/push.ts`, `server/routers/push.test.ts`, `client/src/_core/hooks/usePushSubscription.ts`, `client/src/_core/hooks/usePushSubscription.test.ts`, `drizzle/0080_push_subscriptions.sql`
- Modified: `package.json`, `pnpm-lock.yaml`, `drizzle/schema.ts`, `server/routers.ts`, `.env.example`

**Commit message:**

```
feat(push): Wave 4 module 4.3 — Web Push subscription endpoint + VAPID

- pushSubscriptions Drizzle table (migration 0080) with platform enum
  (web/ios-pwa/android-pwa) — Module 4.13 will reuse for native tokens
- VAPID keys init via server/_core/webPush.ts
- 4 tRPC procedures: getPublicKey / subscribe / unsubscribe / listMyDevices
- usePushSubscription hook handles iOS standalone-mode gating
  (Risk #1 mitigation per v2-plan risk register)
- Anonymous subscribers allowed (userId nullable); aliased on auth
- Vitest covers subscribe/unsubscribe/listing (4 server + 3 client cases)

Subscriptions LANDED but NOT YET FIRING — Module 4.4 wires the events
that actually call webpush.sendNotification().

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.3
```

## Rollback

- Code revert is safe; the `pushSubscriptions` table remains (no data loss). New code path unreachable.
- Migration 0080 is forward-only (no `.down.sql`). To fully roll back, manually `DROP TABLE pushSubscriptions` post-deploy — but generally leave the table; an unused table is cheaper than the rollback cost.
- VAPID secrets stay in Fly secrets — no security concern (without server code reading them, they're dormant).

## Manual intervention

- **Jeff:** generate VAPID keys via `npx web-push generate-vapid-keys --json` — **save the privateKey somewhere safe (1Password)**; if lost, all subscribers must re-subscribe — 5 min.
- **Jeff:** set Fly secrets on staging + prod — `fly secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_CONTACT_EMAIL=...` — 5 min.
- **Jeff:** post-staging-deploy, verify migration applied — `fly ssh console -a packgo-staging --command 'mysql -e "DESCRIBE pushSubscriptions;"'` — 2 min.
- **Jeff:** review the iOS standalone-mode messaging — Stage 3 entry decision #6 ("Install to home screen to enable push" tooltip) — 5 min. This module ships the `isStandalone` flag; the **UI copy** for the iOS-only banner is decided here per Stage 3 entry decisions.

## Test plan

**Server Vitest:** `server/routers/push.test.ts` — 4 cases (mocked Drizzle):

1. **subscribe inserts row** — input valid sub payload → `db.insert` called with expected values → returns `{ok: true}`.
2. **subscribe upserts on duplicate endpoint** — second call same endpoint → no error → `onDuplicateKeyUpdate` triggered with `lastSeenAt` set.
3. **unsubscribe soft-deletes** — call unsubscribe → `db.update` sets `revokedAt` to current time → endpoint row not hard-deleted.
4. **listMyDevices filters revoked** — fixture: 2 active + 1 revoked → returns 2.

**Client Vitest:** `client/src/_core/hooks/usePushSubscription.test.ts` — 3 cases (mocked `navigator`, `Notification`, tRPC):

1. **iOS non-standalone:** mock UA = iPhone, mock `navigator.standalone = false` → hook returns `supported: false`.
2. **Chrome standalone-friendly:** mock UA = Chrome desktop → hook returns `supported: true`.
3. **subscribe flow:** mock granted permission → call `subscribe()` → assert tRPC `push.subscribe.mutate` called with endpoint + keys.

**Regression anchor:** existing `pnpm test` pass count unchanged.

## Decisions needed (Jeff)

1. **VAPID contact email** — `mailto:jeff@packgo.com` vs `mailto:support@packgo.com`. Abuse notifications go here. Lock before Procedure step 5.
2. **Anonymous subscriptions** — currently allowed (`userId nullable`). Browse-mode user subscribes pre-login → on login, we alias the anonymousId → userId. Keep or restrict to authenticated only? Recommend keep (matches PostHog identity flow).
3. **iOS standalone tooltip copy** — per Stage 3 entry decision #6, recommend: 「將 PACK&GO 加入主畫面以接收即時行程通知」 / "Add PACK&GO to your Home Screen to enable push notifications". Module 4.5 owns the actual tooltip UI; this module just defines the copy.
4. **`getPublicKey` access** — currently `publicProcedure`. Alternative: bake into `index.html` as `<meta name="vapid-public-key">` so first-paint already has the key. Recommend keep query-based (cleaner; trivial overhead with React Query caching).
