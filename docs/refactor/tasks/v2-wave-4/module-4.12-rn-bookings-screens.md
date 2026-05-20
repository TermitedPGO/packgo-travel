# v2 · Wave 4 · Module 4.12 — RN Bookings list + detail screens

> ⏸️ **DEFERRED to v3** — Apple Developer Program $99/yr + Google Play $25 not committed. Task content preserved for v3 re-activation; no execution in v2.

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L2 — Admin RN Expo, §Module 4.12)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** DEFERRED-V3 (Jeff decision 2026-05-19 — focus v2 on web + PWA; revisit RN admin app in v3 after mobile traffic + customer demand data lands)
**Est. effort:** 14 h AI + 30 min Jeff review (visual parity + action smoke)
**Deploy window:** any time — mobile-only

## Goal

Ship the third admin-side tab: Bookings (`packages/mobile/app/(tabs)/bookings.tsx`) + detail screen (`packages/mobile/app/bookings/[id].tsx`). List is filterable by status + date range; detail shows participants, payment, voucher, packpoint, and a one-tap "Send reminder email" action.

Per Jeff's solo-founder mandate: tapping a booking on the phone should let him reschedule / cancel / refund / send-reminder without opening a laptop. This module ships read + one action (reminder); full mutation parity (cancel/refund) stays web-only for v2 risk reasons.

## Pre-requisites

- **Module 4.9 (OAuth) resolved.**
- Modules 4.10 + 4.11 merged — tab layout shell and components (StatusBadge, etc.) ready to reuse.
- Wave 2 Module 2.1 (db.ts split) complete — `server/db/booking.ts` is canonical.
- Existing `server/routers/bookings*.ts` post-v1 split — has `listForAdmin` and `getById` (verify by reading).

## Inputs (read these before executing)

- `client/src/components/admin/BookingsTab.tsx` (or wherever the web admin bookings table lives) — visual parity reference.
- `server/routers/bookings.ts` (post-v1 split) — `listForAdmin`, `getById`, `sendReminder` (verify exists; if not, add).
- `packages/shared/db.ts` (Module 4.7) — `BookingRow` type.
- `packages/mobile/components/StatusBadge.tsx` (Module 4.10).
- `packages/mobile/_core/theme.ts` (Module 4.8).
- `CLAUDE.md` §2.1 + §2.2 for card/button design.

## Scope (what this module owns)

- ✅ `packages/mobile/app/(tabs)/bookings.tsx` — filterable list.
- ✅ `packages/mobile/app/bookings/[id].tsx` — booking detail.
- ✅ `packages/mobile/components/BookingRow.tsx` — list row.
- ✅ `packages/mobile/components/BookingFilters.tsx` — status pills + date range chip.
- ✅ `packages/mobile/components/ParticipantsList.tsx` — shows traveler list with passport info redacted (`*****1234` style).
- ✅ `packages/mobile/components/PaymentSummary.tsx` — total / paid / voucher / packpoint breakdown.
- ✅ `packages/mobile/components/SendReminderAction.tsx` — button + confirmation modal.
- ✅ i18n keys.
- ✅ Vitest covering screens.
- ❌ NOT in scope: cancel / refund / reschedule mutations (stay web-only for v2), participant CRUD (read-only here), payment recording (kept off-mobile).

## Procedure

1. **Read web reference** (BookingsTab) for filter set + status colors + detail sections.

2. **`packages/mobile/components/BookingRow.tsx`:**
   ```tsx
   import { View, Text, TouchableOpacity } from 'react-native';
   import { router } from 'expo-router';
   import type { BookingRow as BookingRowType } from '@packgo/shared';
   import { theme } from '@/_core/theme';
   import { StatusBadge } from './StatusBadge';

   const statusVariant: Record<string, 'success' | 'warning' | 'danger' | 'default' | 'info'> = {
     confirmed: 'success',
     pending: 'warning',
     cancelled: 'danger',
     completed: 'info',
     no_show: 'default',
   };

   export function BookingRow({ booking }: { booking: BookingRowType & { tourName?: string } }) {
     return (
       <TouchableOpacity onPress={() => router.push(`/bookings/${booking.id}` as any)}
         style={{
           backgroundColor: '#fff',
           padding: 16, marginHorizontal: 12, marginVertical: 4,
           borderRadius: theme.borderRadius.xl, // 12 — CLAUDE.md §2.1
           borderWidth: 1, borderColor: theme.colors.border,
         }}>
         <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
           <Text style={{ fontWeight: '600', flex: 1 }} numberOfLines={1}>{booking.customerName}</Text>
           <StatusBadge label={booking.bookingStatus} variant={statusVariant[booking.bookingStatus] ?? 'default'} />
         </View>
         <Text style={{ color: theme.colors.muted, fontSize: 13 }} numberOfLines={1}>
           {booking.tourName ?? `Tour #${booking.tourId}`} · {booking.numberOfAdults} adult{booking.numberOfAdults > 1 ? 's' : ''}
         </Text>
         <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
           {new Date(booking.createdAt).toLocaleDateString('zh-TW')} · ${(Number(booking.totalAmount) || 0).toFixed(2)}
         </Text>
       </TouchableOpacity>
     );
   }
   ```

3. **`packages/mobile/components/BookingFilters.tsx`:**
   ```tsx
   import { ScrollView, TouchableOpacity, Text } from 'react-native';
   import { theme } from '@/_core/theme';
   import { BOOKING_STATUSES } from '@packgo/shared';

   export type StatusFilter = 'all' | typeof BOOKING_STATUSES[number];

   export function BookingFilters({ active, onChange }: { active: StatusFilter; onChange: (s: StatusFilter) => void }) {
     const opts: StatusFilter[] = ['all', ...BOOKING_STATUSES];
     return (
       <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 12 }}>
         {opts.map((s) => (
           <TouchableOpacity key={s} onPress={() => onChange(s)} style={{
             paddingHorizontal: 14, paddingVertical: 6,
             borderRadius: theme.borderRadius.lg,
             backgroundColor: active === s ? theme.colors.primary : theme.colors.card,
           }}>
             <Text style={{ color: active === s ? '#fff' : theme.colors.foreground, fontSize: 13, fontWeight: '500' }}>
               {s}
             </Text>
           </TouchableOpacity>
         ))}
       </ScrollView>
     );
   }
   ```

4. **`packages/mobile/app/(tabs)/bookings.tsx`:**
   ```tsx
   import { FlatList, RefreshControl, View, Text } from 'react-native';
   import { useState } from 'react';
   import { trpc } from '@/_core/trpc';
   import { useAuth } from '@/_core/auth';
   import { router } from 'expo-router';
   import { BookingRow } from '@/components/BookingRow';
   import { BookingFilters, type StatusFilter } from '@/components/BookingFilters';
   import { theme } from '@/_core/theme';

   export default function BookingsScreen() {
     const { token } = useAuth();
     if (!token) { router.replace('/login'); return null; }

     const [filter, setFilter] = useState<StatusFilter>('all');
     const { data, refetch, isRefetching, isLoading } = trpc.bookings.listForAdmin.useQuery({
       statusFilter: filter === 'all' ? undefined : filter,
     });

     return (
       <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
         <BookingFilters active={filter} onChange={setFilter} />
         <FlatList
           data={data ?? []}
           keyExtractor={(item) => String(item.id)}
           renderItem={({ item }) => <BookingRow booking={item} />}
           refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
           ListEmptyComponent={
             <View style={{ padding: 32, alignItems: 'center' }}>
               <Text style={{ color: theme.colors.muted }}>{isLoading ? 'Loading…' : 'No bookings.'}</Text>
             </View>
           }
           contentContainerStyle={{ paddingBottom: 32 }}
         />
       </View>
     );
   }
   ```

5. **`packages/mobile/components/ParticipantsList.tsx`** — passport-redacting:
   ```tsx
   import { View, Text } from 'react-native';
   import { theme } from '@/_core/theme';

   function redactPassport(num?: string | null): string {
     if (!num || num.length < 4) return '—';
     return `*****${num.slice(-4)}`;
   }

   export function ParticipantsList({ participants }: { participants: Array<any> }) {
     return (
       <View style={{ padding: 16, backgroundColor: theme.colors.card, marginHorizontal: 12, marginVertical: 8, borderRadius: theme.borderRadius.xl }}>
         <Text style={{ fontWeight: '600', marginBottom: 8 }}>Travelers ({participants.length})</Text>
         {participants.map((p) => (
           <View key={p.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
             <Text style={{ fontSize: 14 }}>{p.firstName} {p.lastName}</Text>
             <Text style={{ fontSize: 12, color: theme.colors.muted }}>
               Passport: {redactPassport(p.passportNumber)} · DOB: {p.dateOfBirth ?? '—'}
             </Text>
           </View>
         ))}
       </View>
     );
   }
   ```

   **Privacy note:** Wave 1 Module 1.8 encrypts passport numbers at-rest, BUT the API returns plaintext for admin views. The redaction here is an additional defense — mobile screens shouldn't show full passport numbers casually. **If Jeff needs full numbers**, add a long-press reveal action (out of scope for this module).

6. **`packages/mobile/components/PaymentSummary.tsx`:**
   ```tsx
   import { View, Text } from 'react-native';
   import { theme } from '@/_core/theme';

   export function PaymentSummary({ booking }: { booking: any }) {
     return (
       <View style={{ padding: 16, backgroundColor: theme.colors.card, marginHorizontal: 12, marginVertical: 8, borderRadius: theme.borderRadius.xl }}>
         <Text style={{ fontWeight: '600', marginBottom: 8 }}>Payment</Text>
         <Row label="Total" value={`$${Number(booking.totalAmount).toFixed(2)}`} />
         <Row label="Paid" value={`$${Number(booking.amountPaid ?? 0).toFixed(2)}`} />
         {booking.voucherCode && <Row label="Voucher" value={`-$${Number(booking.voucherDiscount ?? 0).toFixed(2)} (${booking.voucherCode})`} />}
         {booking.packpointAmount > 0 && <Row label="PackPoint" value={`-$${Number(booking.packpointAmount).toFixed(2)}`} />}
         <Row label="Balance" value={`$${(Number(booking.totalAmount) - Number(booking.amountPaid ?? 0)).toFixed(2)}`} isBalance />
       </View>
     );
   }

   function Row({ label, value, isBalance = false }: { label: string; value: string; isBalance?: boolean }) {
     return (
       <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
         <Text style={{ color: theme.colors.muted }}>{label}</Text>
         <Text style={{ fontWeight: isBalance ? '700' : '500', color: isBalance ? theme.colors.primary : theme.colors.foreground }}>
           {value}
         </Text>
       </View>
     );
   }
   ```

7. **`packages/mobile/components/SendReminderAction.tsx`:**
   ```tsx
   import { useState } from 'react';
   import { TouchableOpacity, Text, View, Alert } from 'react-native';
   import { trpc } from '@/_core/trpc';
   import { theme } from '@/_core/theme';

   export function SendReminderAction({ bookingId }: { bookingId: number }) {
     const [sending, setSending] = useState(false);
     const sendMutation = trpc.bookings.sendReminder.useMutation();

     const onPress = () => {
       Alert.alert('Send Reminder?', 'A payment-reminder email will be sent to the customer.', [
         { text: 'Cancel', style: 'cancel' },
         { text: 'Send', onPress: async () => {
           setSending(true);
           try {
             await sendMutation.mutateAsync({ bookingId });
             Alert.alert('Reminder sent.');
           } catch (e: any) {
             Alert.alert('Failed', e.message ?? 'Try again later.');
           } finally {
             setSending(false);
           }
         }},
       ]);
     };

     return (
       <TouchableOpacity onPress={onPress} disabled={sending}
         style={{
           backgroundColor: theme.colors.primary, padding: 14, marginHorizontal: 12, marginVertical: 8,
           borderRadius: theme.borderRadius.lg, // 8 — button
           alignItems: 'center', opacity: sending ? 0.5 : 1,
         }}>
         <Text style={{ color: '#fff', fontWeight: '600' }}>{sending ? 'Sending…' : 'Send Payment Reminder'}</Text>
       </TouchableOpacity>
     );
   }
   ```

8. **`packages/mobile/app/bookings/[id].tsx`:**
   ```tsx
   import { useLocalSearchParams, Stack } from 'expo-router';
   import { ScrollView, View, Text } from 'react-native';
   import { trpc } from '@/_core/trpc';
   import { theme } from '@/_core/theme';
   import { StatusBadge } from '@/components/StatusBadge';
   import { ParticipantsList } from '@/components/ParticipantsList';
   import { PaymentSummary } from '@/components/PaymentSummary';
   import { SendReminderAction } from '@/components/SendReminderAction';

   export default function BookingDetailScreen() {
     const { id } = useLocalSearchParams<{ id: string }>();
     const bookingId = Number(id);
     const { data: booking } = trpc.bookings.getById.useQuery({ id: bookingId });
     if (!booking) return <View />;

     return (
       <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }}>
         <Stack.Screen options={{ title: `Booking #${booking.id}` }} />
         <View style={{ padding: 16, backgroundColor: theme.colors.card, marginHorizontal: 12, marginVertical: 12, borderRadius: theme.borderRadius.xl }}>
           <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
             <Text style={{ fontWeight: '600', fontSize: 16 }}>{booking.customerName}</Text>
             <StatusBadge label={booking.bookingStatus} variant="default" />
           </View>
           <Text style={{ marginTop: 4, color: theme.colors.muted }}>{booking.customerEmail}</Text>
           {booking.tourName && <Text style={{ marginTop: 8 }}>{booking.tourName}</Text>}
         </View>
         <PaymentSummary booking={booking} />
         <ParticipantsList participants={booking.participants ?? []} />
         {booking.bookingStatus !== 'cancelled' && booking.bookingStatus !== 'completed' && (
           <SendReminderAction bookingId={booking.id} />
         )}
       </ScrollView>
     );
   }
   ```

9. **Verify / add server procedures:**
   - `trpc.bookings.listForAdmin({ statusFilter? })` — verify; if `statusFilter` input not supported, add.
   - `trpc.bookings.getById({ id })` — verify returns participants + payment + voucher.
   - `trpc.bookings.sendReminder({ bookingId })` — **likely exists**, but verify it triggers the email template + emits audit log.

10. **Smoke test on dev build:**
    - Bookings tab → list renders, filter pills toggle.
    - Tap a booking → detail loads → participants, payment breakdown visible → passport numbers redacted.
    - Tap "Send Payment Reminder" → confirmation alert → confirm → server sends email (verify in web admin's email log).

## Acceptance Criteria

- [ ] `packages/mobile/app/(tabs)/bookings.tsx` and `packages/mobile/app/bookings/[id].tsx` render correctly.
- [ ] All cards `borderRadius.xl` (12), buttons `borderRadius.lg` (8), badges `borderRadius.md` (6) per CLAUDE.md §2.1.
- [ ] Passport numbers redacted to `*****1234` format.
- [ ] Filter by status works (server query receives `statusFilter`).
- [ ] Pull-to-refresh works.
- [ ] "Send Payment Reminder" triggers `trpc.bookings.sendReminder` after Alert confirmation.
- [ ] `trpc.bookings.sendReminder` writes `auditLog` row (verify via server).
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] **Tests:** `packages/mobile/app/(tabs)/bookings.test.tsx` — 2 cases (list renders, filter triggers refetch).
- [ ] **Tests:** `packages/mobile/app/bookings/[id].test.tsx` — 3 cases (renders detail, redacts passport, send-reminder calls mutation).
- [ ] Manual smoke: dev build round-trip with web admin observing.

## Deliverable

- New: `packages/mobile/app/(tabs)/bookings.tsx`, `packages/mobile/app/bookings/[id].tsx`, `packages/mobile/components/BookingRow.tsx`, `packages/mobile/components/BookingFilters.tsx`, `packages/mobile/components/ParticipantsList.tsx`, `packages/mobile/components/PaymentSummary.tsx`, `packages/mobile/components/SendReminderAction.tsx`, plus test files (3 new).
- Possibly modified: `server/routers/bookings.ts` (add `statusFilter` input + `sendReminder` if absent).

**Commit message:**

```
feat(mobile): Wave 4 module 4.12 — RN Bookings list + detail

- (tabs)/bookings — filterable list (5 status pills) + pull-to-refresh
- bookings/[id] — detail with payment summary, participants (passport redacted),
  Send Payment Reminder action with Alert confirmation
- BookingRow + BookingFilters + ParticipantsList + PaymentSummary +
  SendReminderAction components
- Passport redaction: *****1234 format on display (full numbers stay server-side)
- CLAUDE.md §2.1: cards xl=12, buttons lg=8, badges md=6 — verified
- 5 Vitest cases
- Server: trpc.bookings.sendReminder writes auditLog row (Module 4.21 ready)

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.12
```

## Rollback

- Single revert removes mobile screens; web bookings tab unaffected.
- Server-side additions (`statusFilter` input, audit log entries) are additive.

## Manual intervention

- **Jeff (~15 min):** dev build → Bookings tab → filter through statuses → tap a booking → verify payment breakdown matches web → send reminder → check email landed in customer inbox + audit log row created.

## Test plan

**Vitest:** `packages/mobile/app/(tabs)/bookings.test.tsx` — 2 cases.
**Vitest:** `packages/mobile/app/bookings/[id].test.tsx` — 3 cases (mock trpc + expo-router).
**Vitest:** `packages/mobile/components/ParticipantsList.test.tsx` — 1 case verifying redactPassport correctness.

**Regression anchor:** root `pnpm test` count unchanged + 6 new cases.

**Manual smoke:** dev build, full flow with audit log verification.

## Decisions needed (Jeff)

1. **Passport reveal action** — currently fully redacted on mobile. Add long-press to reveal? Recommend: defer to v3; if needed, surface in web admin only.
2. **Send Reminder template** — uses existing email template. Confirm subject/body fits the mobile-initiated send case (vs cron-initiated reminder). Recommend reuse.
3. **Cancel / refund on mobile** — explicitly out of scope. Confirm Jeff is OK with read+reminder-only on mobile for v2; cancel/refund stay web-only.
4. **Date range filter** — list filter currently status-only. Date range pill (last 30d / last 90d / custom) is nice-to-have; recommend defer to v3.
