# v2 · Wave 4 · Module 4.13 — Expo Notifications APNs (iOS) + FCM (Android) tokens

> ⏸️ **DEFERRED to v3** — Apple Developer Program $99/yr + Google Play $25 not committed. Task content preserved for v3 re-activation; no execution in v2.

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L2 — Admin RN Expo, §Module 4.13)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** DEFERRED-V3 (Jeff decision 2026-05-19 — focus v2 on web + PWA; revisit RN admin app in v3 after mobile traffic + customer demand data lands)
**Est. effort:** 12 h AI + 1 h Jeff review (Apple/Google credential generation + first end-to-end push test)
**Deploy window:** Tuesday/Wednesday — server-side dispatcher routing changes touch tested webhook + agent code

## Goal

Register iOS APNs + Android FCM device tokens via `expo-notifications`, store in the `pushSubscriptions` table (reusing Module 4.3's `platform="ios"|"android"`), and extend the server-side dispatcher (Module 4.4) so push events fan out to native devices alongside Web Push. The 5 events to fire:

- `email.received` — new customer email arrives (Jeff's "客人寄 email 你立刻知道" mandate).
- `booking.confirmed` (already wired in Module 4.4 — reuses dispatcher).
- `payment.received` (was `payment.succeeded` in 4.4 — same hook).
- `refund.requested` (Wave 3 Module 3.6 RefundAgent — new hook for customer refund email coming in).
- `alert.escalation` — any agent `notifyOwner()` call.

## Pre-requisites

- **Module 4.9 (OAuth) resolved** — Jeff must be authenticated before mobile push tokens are useful (server needs to know which `userId` to associate).
- **Module 4.3 + 4.4 merged** — `pushSubscriptions` table + `pushNotifier` service.
- **Wave 3 Module 3.6** merged for `refund.requested` trigger.
- Apple Developer account active (Module 4.15 explicit dep — APNs certs need it).
- EAS project initialized (Module 4.8 dep).

## Inputs (read these before executing)

- `server/_core/pushNotifier.ts` (Module 4.4) — dispatcher to extend.
- `drizzle/schema.ts` `pushSubscriptions` table — `platform` enum already includes `ios-pwa`, `android-pwa`; we extend with `ios` + `android` for native.
- `server/agents/_helpers/notifyOwner.ts` (or wherever notifyOwner lives) — wire `alert.escalation`.
- `server/services/inboundEmail*.ts` (or wherever incoming customer email persists to `inquiries`) — wire `email.received`.
- `server/_core/stripeWebhook.ts` `charge.refunded` handler (Wave 3 Module 3.6) — wire `refund.requested`.
- Expo Notifications docs: https://docs.expo.dev/versions/v51.0.0/sdk/notifications/
- EAS credentials: https://docs.expo.dev/app-signing/managed-credentials/
- v2-plan §Module 4.13.

## Scope (what this module owns)

- ✅ `packages/mobile/_core/notifications.ts` — NEW module: registers token, requests permission, subscribes server-side via `trpc.push.registerMobileDevice`.
- ✅ `packages/mobile/app/_layout.tsx` (modify) — call `registerForPushNotifications()` after auth.
- ✅ `server/routers/push.ts` (modify Module 4.3's router) — add `registerMobileDevice` mutation that:
  - Takes `{ expoPushToken, platform: 'ios'|'android' }`.
  - Stores in `pushSubscriptions` table — schema needs `platform` enum extended to include `ios` + `android` (migration 0083).
  - Uses `expoPushToken` as the `endpoint` (Expo's push service URL — `expo-server-sdk` sends to it).
- ✅ `server/_core/pushNotifier.ts` (modify) — branch by platform:
  - `web` / `ios-pwa` / `android-pwa` → `webpush.sendNotification()` (existing).
  - `ios` / `android` → `Expo.sendPushNotificationsAsync()` (new).
- ✅ `package.json` (server) — add `expo-server-sdk`.
- ✅ Wire 2 new triggers: `email.received` in inbound email handler; `alert.escalation` in `notifyOwner`.
- ✅ Drizzle migration `0083_push_native_platforms.sql`.
- ✅ Vitest covering the native dispatch path.
- ❌ NOT in scope: actually generating APNs / FCM credentials in Apple/Google consoles (Jeff manual step + EAS handles via `eas credentials`); foreground notification UX (visible in-app banner — defer).

## Procedure

1. **Read all inputs.**

2. **Install deps:**
   ```bash
   cd packages/mobile
   pnpm add expo-notifications expo-device

   cd ../..
   pnpm add expo-server-sdk -w
   ```

3. **Migration `drizzle/0083_push_native_platforms.sql`:**
   ```sql
   ALTER TABLE pushSubscriptions
     MODIFY COLUMN platform ENUM('web', 'ios-pwa', 'android-pwa', 'ios', 'android') NOT NULL DEFAULT 'web';
   ```

4. **Update `drizzle/schema.ts`** `pushSubscriptions.platform`:
   ```ts
   platform: mysqlEnum("platform", ["web", "ios-pwa", "android-pwa", "ios", "android"]).notNull().default("web"),
   ```

5. **`packages/mobile/_core/notifications.ts`:**
   ```ts
   import * as Notifications from 'expo-notifications';
   import * as Device from 'expo-device';
   import Constants from 'expo-constants';
   import { Platform } from 'react-native';
   import { trpc } from './trpc';

   Notifications.setNotificationHandler({
     handleNotification: async () => ({
       shouldShowAlert: true,
       shouldPlaySound: true,
       shouldSetBadge: true,
     }),
   });

   export async function registerForPushNotifications(): Promise<string | null> {
     if (!Device.isDevice) return null; // emulator
     const { status: existing } = await Notifications.getPermissionsAsync();
     let finalStatus = existing;
     if (existing !== 'granted') {
       const { status } = await Notifications.requestPermissionsAsync();
       finalStatus = status;
     }
     if (finalStatus !== 'granted') return null;

     const projectId = Constants.expoConfig?.extra?.eas?.projectId;
     const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId });
     const token = tokenResp.data;

     if (Platform.OS === 'android') {
       await Notifications.setNotificationChannelAsync('default', {
         name: 'default', importance: Notifications.AndroidImportance.MAX,
         vibrationPattern: [0, 250, 250, 250], lightColor: '#0D9488',
       });
     }
     return token;
   }
   ```

6. **`packages/mobile/app/_layout.tsx` — modify** to register token after auth:
   ```tsx
   // Inside RootLayout, after AuthProvider context, add a child:
   function PushTokenRegistrar() {
     const { token } = useAuth();
     const register = trpc.push.registerMobileDevice.useMutation();
     useEffect(() => {
       if (!token) return;
       registerForPushNotifications().then((expoPushToken) => {
         if (expoPushToken) {
           register.mutate({ expoPushToken, platform: Platform.OS as 'ios' | 'android' });
         }
       });
     }, [token]);
     return null;
   }
   // ... mount <PushTokenRegistrar /> inside auth provider
   ```

7. **Extend `server/routers/push.ts`:**
   ```ts
   import { z } from 'zod';
   // ... existing imports

   // Add to pushRouter:
   registerMobileDevice: protectedProcedure
     .input(z.object({
       expoPushToken: z.string().regex(/^ExponentPushToken\[.+\]$/),
       platform: z.enum(['ios', 'android']),
     }))
     .mutation(async ({ input, ctx }) => {
       // Use expoPushToken AS endpoint (Expo's push service treats it as opaque endpoint).
       await db.insert(pushSubscriptions).values({
         userId: ctx.user.id,
         endpoint: input.expoPushToken,
         p256dh: 'native', // unused for native; placeholder to satisfy NOT NULL
         auth: 'native',
         platform: input.platform,
         userAgent: ctx.headers['user-agent'] ?? null,
       }).onDuplicateKeyUpdate({
         set: { userId: ctx.user.id, lastSeenAt: new Date(), revokedAt: null },
       });
       return { ok: true };
     }),
   ```

   **Schema concern:** `p256dh` and `auth` were `NOT NULL VARCHAR(255)` for Web Push. Native tokens don't use these; we set placeholder values. **Alternative:** make those nullable via migration. **Decision (lock):** placeholder values cheaper than migration; `p256dh = 'native'` is clear in DB inspection.

8. **Extend `server/_core/pushNotifier.ts` — branch by platform:**
   ```ts
   import { Expo } from 'expo-server-sdk';
   const expo = new Expo();

   // Inside notify() function, replace the Promise.all loop with platform branching:
   await Promise.all(subs.map(async (sub) => {
     try {
       if (sub.platform === 'ios' || sub.platform === 'android') {
         // Native via Expo push service
         const tickets = await expo.sendPushNotificationsAsync([{
           to: sub.endpoint, // expoPushToken
           sound: 'default',
           title: payload.title,
           body: payload.body,
           data: { url: payload.url },
           ...(payload.tag && { categoryId: payload.tag }),
         }]);
         const ticket = tickets[0];
         if (ticket.status === 'error') {
           failed++;
           if (ticket.details?.error === 'DeviceNotRegistered') {
             await markSubscriptionDead(sub.endpoint);
           }
         } else {
           sent++;
         }
       } else {
         // Web Push (existing path)
         await webpush.sendNotification(/* ... */);
         sent++;
       }
     } catch (err: any) {
       failed++;
       logger.warn({ ... }, 'push send failed');
       if (err.statusCode === 410 || err.statusCode === 404) {
         await markSubscriptionDead(sub.endpoint);
       }
     }
   }));
   ```

9. **Wire `email.received` trigger:**
   Find the inbound-email handler (likely `server/services/inboundEmail.ts` or `server/agents/autonomous/gmailPipeline.ts`). After persisting to `inquiries`:
   ```ts
   import { notify } from '../_core/pushNotifier';
   // After inquiry insert:
   await notify(/* admin user id */ 1, 'email_received' as any, {
     title: '客人寄信來了',
     body: `${customerName ?? customerEmail}: ${subject?.slice(0, 60) ?? message?.slice(0, 60)}`,
     url: `/inquiry/${inquiry.id}`,
     tag: `inquiry_${inquiry.id}`,
   });
   ```
   **Issue:** `PushEventType` (Module 4.4) currently only has 3 events. **Extend** to include `email_received`, `refund_requested`, `alert_escalation`:
   ```ts
   export type PushEventType =
     | 'booking_confirmed'
     | 'payment_succeeded'
     | 'itinerary_ready'
     | 'email_received'
     | 'refund_requested'
     | 'alert_escalation';
   ```
   And mirror to `packages/shared/constants.ts` `PUSH_EVENT_TYPES`.

10. **Wire `refund.requested` trigger:**
    In `server/agents/autonomous/refundAgent.ts` (Wave 3 Module 3.6 wired it to Stripe webhook), at the end of `draftCustomerEmail`:
    ```ts
    await notify(adminUserId, 'refund_requested', {
      title: '客人申請退款',
      body: `${charge.amount / 100} 美金退款 — 已準備好草稿`,
      url: `/inquiry/${inquiryId}`,
      tag: `refund_${charge.id}`,
    });
    ```

11. **Wire `alert.escalation` trigger:**
    In `server/agents/_helpers/notifyOwner.ts` (or wherever the helper lives — Wave 3 Module 3.9 standardized it):
    ```ts
    export async function notifyOwner(agentName: string, error: Error, context?: any) {
      // ... existing email logic
      await notify(JEFF_ADMIN_USER_ID, 'alert_escalation', {
        title: `Agent escalation: ${agentName}`,
        body: error.message.slice(0, 100),
        url: '/admin/agents',
        tag: `escalation_${agentName}_${Date.now()}`,
      });
    }
    ```

12. **`packages/mobile/app.json` — add expo-notifications plugin config:**
    ```json
    "plugins": [
      "expo-router",
      "expo-secure-store",
      ["expo-notifications", {
        "icon": "./assets/notification-icon.png",
        "color": "#0D9488"
      }]
    ]
    ```

13. **EAS credentials (Jeff manual):**
    ```bash
    cd packages/mobile
    eas credentials  # interactive — Jeff configures APNs key (iOS) and FCM service account (Android)
    ```
    On iOS: APNs key (.p8) — Jeff downloads from Apple Developer Portal.
    On Android: FCM service account JSON — Jeff exports from Firebase Console.
    EAS uploads both to its credential server and bakes into builds.

14. **Smoke test on dev build:**
    - Build a new dev client (token registration only works in dev-client or production builds, NOT Expo Go).
    - Install on iPhone → log in → notifications permission prompt → grant.
    - Send a test push via Expo CLI: `expo push:send --to "ExponentPushToken[...]"  -t "Test"` — should appear on device.
    - Trigger real event (e.g., send test email to `customer@packgo.com` → wait 5s → `email_received` push appears).

## Acceptance Criteria

- [ ] Migration 0083 applied; `pushSubscriptions.platform` enum extended.
- [ ] `packages/mobile/_core/notifications.ts` `registerForPushNotifications()` returns a valid `ExponentPushToken[...]`.
- [ ] `trpc.push.registerMobileDevice` mutation works; row appears in `pushSubscriptions` with platform `ios` or `android`.
- [ ] `pushNotifier.notify()` branches: native subs → `expo-server-sdk`; web subs → `web-push`.
- [ ] `DeviceNotRegistered` from Expo → `markSubscriptionDead` called.
- [ ] 3 new triggers wired: `email.received`, `refund.requested`, `alert.escalation`.
- [ ] `PushEventType` union has 6 values; mirrored in `packages/shared/constants.ts`.
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] **Tests:** `server/_core/pushNotifier.test.ts` — extend with 3 new cases:
  - (a) Native iOS sub → `expo.sendPushNotificationsAsync` called with `ExponentPushToken[...]`.
  - (b) Expo returns DeviceNotRegistered ticket → `markSubscriptionDead` called.
  - (c) Mixed subs (1 web + 1 native) → both dispatchers called.
- [ ] **Test:** `packages/mobile/_core/notifications.test.ts` — 2 cases: (a) emulator returns null, (b) permission granted → token returned.
- [ ] Manual smoke (Jeff): real push on real device for each of 6 event types.
- [ ] No regression in existing `pnpm test` count.

## Deliverable

- New: `packages/mobile/_core/notifications.ts`, `packages/mobile/_core/notifications.test.ts`, `drizzle/0083_push_native_platforms.sql`
- Modified: `drizzle/schema.ts`, `server/routers/push.ts`, `server/_core/pushNotifier.ts`, `server/_core/pushNotifier.test.ts` (extend), `packages/shared/constants.ts`, `packages/mobile/app/_layout.tsx`, `packages/mobile/app.json`, plus 3 trigger sites (inbound email, refundAgent, notifyOwner)

**Commit message:**

```
feat(mobile-push): Wave 4 module 4.13 — APNs+FCM native push via Expo

- Migration 0083: pushSubscriptions.platform enum extended (ios, android)
- packages/mobile/_core/notifications.ts: register Expo push token after auth
- trpc.push.registerMobileDevice mutation persists token as endpoint
- pushNotifier branches: native → expo-server-sdk, web → web-push
- DeviceNotRegistered → soft-delete via markSubscriptionDead
- 3 new triggers wired: email.received (inbound), refund.requested
  (RefundAgent), alert.escalation (notifyOwner)
- PushEventType extended to 6 values; mirrored in @packgo/shared
- expo-notifications plugin in app.json with brand-teal #0D9488 accent
- 5 Vitest cases (3 server + 2 mobile)

Manual cert step: Jeff runs `eas credentials` for APNs .p8 + FCM JSON.

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.13
```

## Rollback

- Single revert reverts mobile + server changes. Migration 0083 enum extension is harmless to leave.
- If push fires badly (e.g., spam loop), set `EXPO_ACCESS_TOKEN=invalid` in Fly secrets to disable Expo push — web push still works.
- 3 new triggers are inside try/catch in `notify()`; push failures don't block business logic.

## Manual intervention

- **Jeff (REQUIRED, ~30 min):**
  - **APNs key (.p8):** log in to https://developer.apple.com/account/resources/authkeys → create new Apple Push Notification service key → download .p8 file. Provide to supervisor for `eas credentials` upload (or run `eas credentials` and answer prompts).
  - **FCM service account JSON:** Firebase Console → Project Settings → Service Accounts → "Generate new private key" → download JSON. Provide to `eas credentials`.
- **Jeff (~10 min):** install dev build → grant notification permission → confirm `pushSubscriptions` row appears with platform `ios` / `android`.
- **Jeff (~10 min):** trigger each of 6 event types in staging (1 booking, 1 payment, 1 tour gen, 1 inbound email, 1 refund webhook, 1 notifyOwner) → verify all 6 pushes arrive on Jeff's phone.

## Test plan

**Vitest extension:** `server/_core/pushNotifier.test.ts` — 3 new cases (mock `expo-server-sdk`, `web-push`, `db`):

1. **Native iOS dispatch:** fixture sub with `platform: 'ios'` → `notify(...)` → assert `expo.sendPushNotificationsAsync` called with the endpoint.
2. **DeviceNotRegistered handling:** mock Expo returns `{ status: 'error', details: { error: 'DeviceNotRegistered' } }` → assert `markSubscriptionDead(endpoint)` called.
3. **Mixed subs:** 1 web + 1 native sub → both dispatchers called.

**Vitest:** `packages/mobile/_core/notifications.test.ts` — 2 cases:

1. **Emulator returns null:** mock `Device.isDevice = false` → `registerForPushNotifications()` returns null.
2. **Granted path:** mock permission granted + valid projectId → returns expo push token string.

**Regression anchor:** root `pnpm test` count unchanged + 5 new cases.

**Manual smoke (REQUIRED):** Jeff's real iPhone — all 6 push events triggered end-to-end.

## Decisions needed (Jeff)

1. **EAS credentials path** — `eas credentials` interactive flow OR manual upload via EAS dashboard. Recommend `eas credentials` (cli).
2. **Notification icon** — `packages/mobile/assets/notification-icon.png` needs to be 96×96 monochrome PNG. Generate from PACK&GO logo (Module 4.1 source). 5 min Jeff approval.
3. **`email.received` fires on every inbound** — Jeff wants this per "客人寄 email 你立刻知道" mandate. Risk: if a customer triggers a 20-message conversation, Jeff gets 20 pushes. Recommend: dedupe per inquiry (only first message in a thread fires push). Lock.
4. **`alert.escalation` triggers count** — there are many `notifyOwner()` calls. Risk of push storms during incidents. Recommend: rate-limit at notifier level (max 5 escalation pushes per hour). Lock.
5. **Push admin user ID** — code uses `JEFF_ADMIN_USER_ID` constant. Confirm Jeff's user ID in `users` table; supervisor adds to `server/_core/index.ts` env config.
6. **APNs cert vs key** — recommend APNs key (.p8) over cert (.p12) — keys don't expire and work across all apps. Lock.
