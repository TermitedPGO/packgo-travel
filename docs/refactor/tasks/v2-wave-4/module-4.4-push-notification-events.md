# v2 · Wave 4 · Module 4.4 — Server-side push notification events (firing side)

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L1 — Customer PWA, §Module 4.3 firing-side carve-out)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 8 h AI + 15 min Jeff review (verify notifications fire end-to-end on staging)
**Deploy window:** any weekday morning — additive, no migration

## Goal

Wire 3 server-side push triggers to `webpush.sendNotification()`, fanning out to all active subscriptions for the relevant user(s):

1. **`booking.confirmed`** — fires after `bookings.create` mutation succeeds (matches existing booking-confirmation email trigger).
2. **`payment.succeeded`** — fires in `server/_core/stripeWebhook.ts` `charge.succeeded` handler.
3. **`itinerary.ready`** — fires in `server/agents/masterAgent.ts` (or post-Wave-2 `_pipeline/assembly.ts`) when AI tour generation completes.

Also add: dead-subscription cleanup (web-push returns `410 Gone` for revoked endpoints → soft-delete in `pushSubscriptions`), and per-event opt-out support (a user can disable specific event types).

## Pre-requisites

- **Module 4.3 merged** (subscription endpoint + `pushSubscriptions` table + VAPID setup).
- **Wave 1 Module 1.2 (pino) merged** — push send/error events log via pino, not console.
- **Wave 2 Module 2.3 (masterAgent split) merged** — the `itinerary.ready` hook lives in `_pipeline/assembly.ts`; sequencing requires the split to land first.
- Stripe webhook (`server/_core/stripeWebhook.ts`) is post-Phase 2 (idempotent + tested) — Module 4.4 adds one line to a tested handler, must not break existing tests.

## Inputs (read these before executing)

- `server/_core/webPush.ts` (created in Module 4.3) — `webpush` instance + `VAPID_PUBLIC_KEY` export.
- `drizzle/schema.ts` `pushSubscriptions` table definition (from Module 4.3).
- `server/_core/stripeWebhook.ts` — find `charge.succeeded` handler.
- `server/agents/_pipeline/assembly.ts` (post Wave-2 split) — find the function returning the assembled tour (where "itinerary ready" event should fire).
- `server/routers/bookings*.ts` — find the booking create mutation that fires the confirmation email (likely `bookingsCustomer.ts` or `bookings.ts` post-v1 split).
- `server/email.ts` post-Wave-2 split — confirm template names for parity (push subject lines should mirror email subjects).
- `client/src/i18n/zh-TW.ts` + `en.ts` — push notification body strings need i18n.

## Scope (what this module owns)

- ✅ `server/_core/pushNotifier.ts` — NEW service exporting `notify(userId, eventType, payload)`. Single dispatch point.
- ✅ `server/_core/pushDeadSubscriptionCleanup.ts` — NEW helper: when `web-push` throws `WebPushError` with `statusCode: 410`, soft-delete the subscription row.
- ✅ Add `notify()` calls in 3 spots:
  - `server/routers/bookingsCustomer.ts` (or `server/routers/bookings.ts`) — after booking row insert succeeds.
  - `server/_core/stripeWebhook.ts` — inside `charge.succeeded` handler, after payment DB row update.
  - `server/agents/_pipeline/assembly.ts` — after assembly returns the final tour object.
- ✅ `drizzle/0081_user_notification_prefs.sql` — NEW migration adding `notificationPrefs` JSON column on `users` table for per-event opt-out.
- ✅ `drizzle/schema.ts` — add column.
- ✅ `client/src/i18n/zh-TW.ts` + `en.ts` — 6 keys (3 events × {title, body}).
- ✅ Vitest covering `pushNotifier.notify()`.
- ❌ NOT in scope: native APNs/FCM (Module 4.13), per-event UI for opt-out (deferred — basic prefs column ships here, UI in v3), the SW message handler that renders the push (lives in `vite-plugin-pwa`'s default — Module 4.2's plugin generates it).

## Procedure

1. **Read all inputs.** Confirm post-Wave-2 file locations for stripeWebhook + assembly + bookings.

2. **Drizzle migration `drizzle/0081_user_notification_prefs.sql`:**
   ```sql
   ALTER TABLE users ADD COLUMN notificationPrefs JSON NULL;
   -- Default null means "all events enabled" (opt-in by default).
   -- Schema: {"push":{"booking_confirmed":true,"payment_succeeded":true,"itinerary_ready":true}}
   ```

3. **Update `drizzle/schema.ts` users table** — add `notificationPrefs: json("notificationPrefs").$type<UserNotificationPrefs>()` with TS shape:
   ```ts
   export type UserNotificationPrefs = {
     push?: {
       booking_confirmed?: boolean;
       payment_succeeded?: boolean;
       itinerary_ready?: boolean;
     };
   };
   ```

4. **`server/_core/pushNotifier.ts`:**
   ```ts
   import { webpush } from './webPush';
   import { db } from '../db';
   import { pushSubscriptions, users } from '../../drizzle/schema';
   import { eq, and, isNull } from 'drizzle-orm';
   import { logger } from './logger';
   import { markSubscriptionDead } from './pushDeadSubscriptionCleanup';

   export type PushEventType = 'booking_confirmed' | 'payment_succeeded' | 'itinerary_ready';

   export interface PushPayload {
     title: string;
     body: string;
     url?: string;       // open this URL on click
     tag?: string;       // dedupe; same tag replaces prior
   }

   export async function notify(
     userId: number | null,
     eventType: PushEventType,
     payload: PushPayload,
   ): Promise<{ sent: number; failed: number }> {
     if (!userId) return { sent: 0, failed: 0 };

     // Check per-event opt-out
     const [user] = await db.select({ prefs: users.notificationPrefs })
       .from(users).where(eq(users.id, userId)).limit(1);
     if (user?.prefs?.push?.[eventType] === false) {
       logger.info({ userId, eventType }, 'push opt-out — skipping');
       return { sent: 0, failed: 0 };
     }

     // Get all active subscriptions
     const subs = await db.select().from(pushSubscriptions)
       .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.revokedAt)));

     let sent = 0, failed = 0;
     await Promise.all(subs.map(async (sub) => {
       try {
         await webpush.sendNotification(
           { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
           JSON.stringify(payload),
         );
         sent++;
       } catch (err: any) {
         failed++;
         logger.warn({ userId, eventType, endpoint: sub.endpoint, statusCode: err.statusCode }, 'push send failed');
         if (err.statusCode === 410 || err.statusCode === 404) {
           // Gone / Not Found — subscription dead
           await markSubscriptionDead(sub.endpoint);
         }
       }
     }));

     logger.info({ userId, eventType, sent, failed }, 'push fanout complete');
     return { sent, failed };
   }
   ```

5. **`server/_core/pushDeadSubscriptionCleanup.ts`:**
   ```ts
   import { db } from '../db';
   import { pushSubscriptions } from '../../drizzle/schema';
   import { eq } from 'drizzle-orm';

   export async function markSubscriptionDead(endpoint: string): Promise<void> {
     await db.update(pushSubscriptions)
       .set({ revokedAt: new Date() })
       .where(eq(pushSubscriptions.endpoint, endpoint));
   }
   ```

6. **Wire trigger #1 — booking.confirmed:**
   In `server/routers/bookingsCustomer.ts` (or wherever `bookings.create` mutation lives), AFTER booking insert returns + email send is queued:
   ```ts
   import { notify } from '../_core/pushNotifier';

   // After successful booking creation:
   await notify(userId, 'booking_confirmed', {
     title: t('push.bookingConfirmed.title'), // server-side i18n via the user's preferred locale
     body: t('push.bookingConfirmed.body', { tourName: tour.name, departureDate: formattedDate }),
     url: `/account/bookings/${bookingId}`,
     tag: `booking_${bookingId}`,
   });
   ```
   **Decision:** server-side i18n — read `user.locale` (default `zh-TW`) to pick the message. Use existing `server/_core/i18n.ts` if present, otherwise fall back to inline strings + add a `t()` helper for server (out of scope to build; for now hardcode in zh-TW with English fallback comment).

7. **Wire trigger #2 — payment.succeeded:**
   In `server/_core/stripeWebhook.ts`, inside `charge.succeeded` handler, after Phase 2's atomic DB row update:
   ```ts
   await notify(payment.userId, 'payment_succeeded', {
     title: '付款成功 / Payment Received',
     body: `PACK&GO 收到 $${(charge.amount / 100).toFixed(2)} 付款，感謝！`,
     url: `/account/payments/${payment.id}`,
     tag: `payment_${payment.id}`,
   });
   ```
   **Inside the existing `try { ... }` block** — push failure must NOT roll back the webhook (Stripe retries are expensive and pollute idempotency cache).

8. **Wire trigger #3 — itinerary.ready:**
   In `server/agents/_pipeline/assembly.ts` (post-Wave-2 split), at the end of the assembly function before returning:
   ```ts
   await notify(generationRequest.userId, 'itinerary_ready', {
     title: 'AI 行程已生成 / Your tour is ready',
     body: `${tour.name} 行程已準備好，點擊查看詳情。`,
     url: `/tours/${tour.slug}`,
     tag: `tour_${tour.id}`,
   });
   ```

9. **Add i18n keys (6 keys) — `client/src/i18n/zh-TW.ts` + `en.ts`:**
   - `push.bookingConfirmed.title` / `body`
   - `push.paymentSucceeded.title` / `body`
   - `push.itineraryReady.title` / `body`

   (Server doesn't currently read client i18n — keep server-side strings inline for now; Module 4.17 i18n restructure will introduce a shared `packages/shared/i18n` later if needed. Document this seam.)

10. **Run migration:**
    ```bash
    pnpm drizzle-kit push:mysql --config drizzle/staging.config.ts
    ```

11. **Staging smoke (end-to-end):**
    - Subscribe via Module 4.3 hook on a staging browser.
    - Trigger booking creation → push appears within 2s.
    - Trigger Stripe charge success (use Stripe CLI: `stripe trigger charge.succeeded`) → push appears.
    - Trigger AI tour generation → push appears when generation completes.
    - Manually corrupt a subscription endpoint in DB (set to bogus FCM URL) → trigger event → verify `web-push` throws 410 → row's `revokedAt` set.

## Acceptance Criteria

- [ ] `drizzle/0081_user_notification_prefs.sql` applied on staging + prod.
- [ ] `drizzle/schema.ts` `users.notificationPrefs` JSON column added with TS type `UserNotificationPrefs`.
- [ ] `server/_core/pushNotifier.ts` exists with `notify(userId, eventType, payload)` function.
- [ ] `server/_core/pushDeadSubscriptionCleanup.ts` exists with `markSubscriptionDead(endpoint)`.
- [ ] `notify()` called from booking creation, Stripe `charge.succeeded`, and `_pipeline/assembly.ts`.
- [ ] 6 i18n keys added (zh-TW + en) — server-side strings hardcoded for now with TODO comment for shared i18n.
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] **Tests:** `server/_core/pushNotifier.test.ts` — 4 cases: (a) opt-out path skips dispatch, (b) happy path calls webpush.sendNotification per active sub, (c) 410 response → `markSubscriptionDead` called, (d) no subs → returns `{sent:0, failed:0}`. Mock `webpush` + `db`. **Required per CLAUDE.md §九.**
- [ ] **Test integration:** existing `server/_core/stripeWebhook.test.ts` — confirm `charge.succeeded` still passes (push failure doesn't break webhook). Add 1 new case: push throws → webhook still returns 200.
- [ ] Manual: staging end-to-end smoke — 3 trigger types fire pushes correctly to subscribed device.
- [ ] No regression in existing `pnpm test` count.

## Deliverable

- New: `server/_core/pushNotifier.ts`, `server/_core/pushNotifier.test.ts`, `server/_core/pushDeadSubscriptionCleanup.ts`, `drizzle/0081_user_notification_prefs.sql`
- Modified: `drizzle/schema.ts`, `server/routers/bookingsCustomer.ts` (or appropriate), `server/_core/stripeWebhook.ts`, `server/agents/_pipeline/assembly.ts`, `client/src/i18n/zh-TW.ts`, `client/src/i18n/en.ts`

**Commit message:**

```
feat(push): Wave 4 module 4.4 — server-side push notification events

- pushNotifier.notify(userId, eventType, payload) — single dispatch point
- 3 triggers wired: booking_confirmed (post-create), payment_succeeded
  (Stripe webhook), itinerary_ready (AI assembly)
- Dead-subscription cleanup: 410/404 from web-push → soft-delete row
- users.notificationPrefs JSON column for per-event opt-out (migration 0081)
- Push failure does NOT roll back Stripe webhook (retry-safe)
- Vitest covers notify dispatch + opt-out + dead-sub cleanup (4 cases)
- Stripe webhook regression: 1 new case verifies push error doesn't break

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.4
```

## Rollback

- Single revert removes all 3 trigger sites + new files; `pushNotifier` becomes unreferenced and can be ignored. Table column stays (harmless null).
- If only Stripe webhook trigger is problematic, partial revert: edit only `stripeWebhook.ts` to remove the `notify()` call (push still fires for booking + itinerary). Other triggers carry on.
- No data loss path — push events are fire-and-forget; absence of push doesn't break business logic.

## Manual intervention

- **Jeff:** end-to-end staging smoke — subscribe a test browser → trigger each of the 3 events → confirm pushes received with correct title + body + clickable URL — 10 min.
- **Jeff:** verify dead-subscription cleanup — corrupt a sub endpoint in staging DB → trigger event → confirm `revokedAt` set on that row — 5 min.
- **Jeff:** decide whether to backfill `notificationPrefs = NULL` for existing users (recommend yes, leave null = all opted in) — already the default.

## Test plan

**Vitest:** `server/_core/pushNotifier.test.ts` — 4 cases (mock `webpush.sendNotification`, mock `db`):

1. **Opt-out path:** mock user with `notificationPrefs.push.booking_confirmed = false` → call `notify(userId, 'booking_confirmed', payload)` → assert `webpush.sendNotification` not called → returns `{sent: 0, failed: 0}`.
2. **Happy fanout:** mock 2 active subscriptions → call `notify(...)` → assert `sendNotification` called twice → returns `{sent: 2, failed: 0}`.
3. **Dead subscription 410:** mock `sendNotification` to throw `{ statusCode: 410 }` → assert `markSubscriptionDead` called with the endpoint → returns `{sent: 0, failed: 1}`.
4. **Empty subs:** user with zero subscriptions → returns `{sent: 0, failed: 0}` cleanly.

**Vitest:** `server/_core/stripeWebhook.test.ts` (extend existing) — 1 new case:

- **Push failure isolation:** mock `notify()` to reject → assert webhook handler still returns 200 + DB row updated.

**Regression anchor:** existing `pnpm test` pass count + new 5 cases.

**Manual staging E2E** (~10 min):
- Subscribe browser → trigger booking → push appears.
- Stripe CLI `trigger charge.succeeded` → push appears.
- Generate tour → push appears on completion.
- Corrupt sub endpoint → trigger event → verify `revokedAt` in DB.

## Decisions needed (Jeff)

1. **Server-side i18n strategy** — currently inline strings in 3 trigger sites. Long-term should pull from a shared `packages/shared/i18n` (Module 4.17 sets that up). For this module, inline is acceptable with TODO comment. Confirm.
2. **Notification prefs opt-in vs opt-out default** — currently `null = all events ON`. If Jeff wants stricter privacy default (opt-in per event), invert the check in `notify()`. Recommend keep current (matches email-marketing convention of "subscribed implies all").
3. **Tag uniqueness scope** — currently `booking_${bookingId}` etc. so repeated triggers (e.g., booking status updates) coalesce into one notification. Confirm this is desired (vs always show as new).
4. **Push for AI generation failure** — not in scope here, but Jeff may want a "your tour generation failed" push too. Recommend defer to v3 (failures are rare and notifyOwner already covers Jeff-side).
