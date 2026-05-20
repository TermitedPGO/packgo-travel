# v2 · Wave 4 · Module 4.10 — RN Inbox screen (UnifiedInbox parity)

> ⏸️ **DEFERRED to v3** — Apple Developer Program $99/yr + Google Play $25 not committed. Task content preserved for v3 re-activation; no execution in v2.

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L2 — Admin RN Expo, §Module 4.10)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** DEFERRED-V3 (Jeff decision 2026-05-19 — focus v2 on web + PWA; revisit RN admin app in v3 after mobile traffic + customer demand data lands)
**Est. effort:** 14 h AI + 30 min Jeff review (visual parity check vs web `OfficeInboxTab`)
**Deploy window:** any time — additive screen in mobile app; no impact on web

## Goal

Build the mobile Inbox screen at `packages/mobile/app/(tabs)/inbox.tsx` backed by `trpc.inquiries.listForAdmin` (same query as web `OfficeInboxTab.tsx`). Feature parity with web for the **list operations** (read, archive, label, pull-to-refresh, swipe-to-archive, tap-to-detail). Reuses the Wave 3 skill-suggested drafts: each inbox row that has an attached `skillRunId` shows a "Draft ready" badge.

This is the most-used screen in the admin app (per Jeff's "客人寄 email 你立刻知道" mandate — the inbox is the primary push notification target from Module 4.13).

## Pre-requisites

- **Module 4.9 (OAuth spike) MUST be resolved.** Without auth, listForAdmin returns 401.
- Modules 4.7 + 4.8 (monorepo + Expo scaffold) merged.
- Wave 3 Module 3.3 (auto-dispatch skill on inquiry) merged — gives us `inquiry.skillRunId` to display "Draft ready" badge.
- `server/routers/inquiries.ts` `listForAdmin` procedure exists and is being consumed by `OfficeInboxTab.tsx`.

## Inputs (read these before executing)

- `client/src/components/admin/OfficeInboxTab.tsx` — current web inbox component. Read for feature parity reference: list shape, filters, archive action, label action.
- `server/routers/inquiries.ts` — `listForAdmin` input/output shape (post-Wave-3 includes `skillRunId`).
- `packages/shared/db.ts` (from Module 4.7) — `InquiryRow` type.
- `packages/shared/constants.ts` (Module 4.7) — `INQUIRY_TYPES` + `Intent` enums for filter badges.
- `packages/mobile/_core/auth.ts` (Module 4.9) — `useAuth()` hook.
- `packages/mobile/_core/trpc.ts` (Module 4.8) — TRPC client.
- `packages/mobile/_core/theme.ts` (Module 4.8) — design tokens.
- `CLAUDE.md` §2 — design rules (rounded corners, colors).

## Scope (what this module owns)

- ✅ `packages/mobile/app/(tabs)/_layout.tsx` — NEW tab layout (3 tabs: Inbox, Agent Chat, Bookings — but only Inbox screen lands in this module).
- ✅ `packages/mobile/app/(tabs)/inbox.tsx` — NEW Inbox list screen.
- ✅ `packages/mobile/components/InquiryRow.tsx` — list row (sender, snippet, timestamp, draft badge).
- ✅ `packages/mobile/components/SwipeableInquiryRow.tsx` — wraps `InquiryRow` with `react-native-gesture-handler` swipe-to-archive.
- ✅ `packages/mobile/components/InquiryFilters.tsx` — filter pills (all / unread / has-draft / by type).
- ✅ `packages/mobile/components/StatusBadge.tsx` — reusable badge primitive (e.g., "Draft ready", "Escalated", "Replied").
- ✅ i18n keys for inbox screen.
- ✅ Vitest covering inbox screen.
- ❌ NOT in scope: inquiry detail screen (just navigate to placeholder `/inquiry/[id]` — Module 4.11 ships the actual chat-style detail), label management UI (just consume existing labels; CRUD on labels stays web-only for v2), bookings/agent-chat tabs (separate modules).

## Procedure

1. **Read inputs.** Especially `OfficeInboxTab.tsx` for the canonical filter set, archive action UX, label handling.

2. **`packages/mobile/app/(tabs)/_layout.tsx`** — tab navigator skeleton:
   ```tsx
   import { Tabs } from 'expo-router';
   import { theme } from '@/_core/theme';
   import { Inbox, MessageSquare, BookOpen } from 'lucide-react-native';

   export default function TabsLayout() {
     return (
       <Tabs screenOptions={{
         tabBarActiveTintColor: theme.colors.primary,
         tabBarStyle: { borderTopColor: theme.colors.border },
       }}>
         <Tabs.Screen name="inbox" options={{ title: 'Inbox', tabBarIcon: ({ color }) => <Inbox color={color} size={20} /> }} />
         <Tabs.Screen name="agent-chat" options={{ title: 'Agent', tabBarIcon: ({ color }) => <MessageSquare color={color} size={20} /> }} />
         <Tabs.Screen name="bookings" options={{ title: 'Bookings', tabBarIcon: ({ color }) => <BookOpen color={color} size={20} /> }} />
       </Tabs>
     );
   }
   ```

3. **`packages/mobile/components/StatusBadge.tsx`:**
   ```tsx
   import { Text, View } from 'react-native';
   import { theme } from '@/_core/theme';

   type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info';

   const colors: Record<Variant, { bg: string; fg: string }> = {
     default: { bg: '#F3F4F6', fg: '#374151' },
     success: { bg: '#D1FAE5', fg: '#065F46' },
     warning: { bg: '#FEF3C7', fg: '#92400E' },
     danger: { bg: '#FEE2E2', fg: '#991B1B' },
     info: { bg: '#DBEAFE', fg: '#1E40AF' },
   };

   export function StatusBadge({ label, variant = 'default' }: { label: string; variant?: Variant }) {
     const c = colors[variant];
     return (
       <View style={{
         backgroundColor: c.bg,
         paddingHorizontal: 8, paddingVertical: 2,
         borderRadius: theme.borderRadius.md, // 6 — matches web rounded-md (CLAUDE.md §2.1 Badge spec)
       }}>
         <Text style={{ color: c.fg, fontSize: 11, fontWeight: '600' }}>{label}</Text>
       </View>
     );
   }
   ```

4. **`packages/mobile/components/InquiryRow.tsx`:**
   ```tsx
   import { View, Text, TouchableOpacity } from 'react-native';
   import type { InquiryRow as InquiryRowType } from '@packgo/shared';
   import { theme } from '@/_core/theme';
   import { StatusBadge } from './StatusBadge';
   import { router } from 'expo-router';

   export function InquiryRow({ inquiry }: { inquiry: InquiryRowType & { skillRunId?: number | null; hasUnreadMessages?: boolean } }) {
     const onPress = () => router.push(`/inquiry/${inquiry.id}` as any);
     return (
       <TouchableOpacity onPress={onPress} style={{
         backgroundColor: '#FFFFFF',
         padding: 16,
         borderRadius: theme.borderRadius.xl, // 12 — CLAUDE.md §2.1 card
         marginHorizontal: 12, marginVertical: 4,
         borderWidth: 1, borderColor: theme.colors.border,
       }}>
         <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
           <Text style={{ fontWeight: '600', fontSize: 15, color: theme.colors.foreground, flex: 1 }} numberOfLines={1}>
             {inquiry.customerName ?? inquiry.customerEmail}
           </Text>
           <Text style={{ fontSize: 12, color: theme.colors.muted }}>
             {new Date(inquiry.createdAt).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })}
           </Text>
         </View>
         <Text style={{ color: theme.colors.muted, fontSize: 13, marginBottom: 8 }} numberOfLines={2}>
           {inquiry.subject ?? inquiry.message?.slice(0, 100)}
         </Text>
         <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
           {inquiry.skillRunId && <StatusBadge label="Draft ready" variant="success" />}
           {inquiry.hasUnreadMessages && <StatusBadge label="New" variant="info" />}
           {inquiry.classification && <StatusBadge label={inquiry.classification} variant="default" />}
         </View>
       </TouchableOpacity>
     );
   }
   ```

   **CLAUDE.md §2.1 compliance:** `borderRadius: theme.borderRadius.xl` = 12 = `rounded-xl` web equivalent for cards.

5. **`packages/mobile/components/SwipeableInquiryRow.tsx`** — wrap with `react-native-gesture-handler` `Swipeable`:
   ```tsx
   import { Swipeable } from 'react-native-gesture-handler';
   import { Animated, Text, TouchableOpacity, View } from 'react-native';
   import { theme } from '@/_core/theme';
   import { InquiryRow } from './InquiryRow';
   import { trpc } from '@/_core/trpc';
   import type { ComponentProps } from 'react';

   export function SwipeableInquiryRow(props: ComponentProps<typeof InquiryRow>) {
     const archiveMutation = trpc.inquiries.archive.useMutation();
     const utils = trpc.useUtils();
     const renderRightActions = (_progress: Animated.AnimatedInterpolation<number>) => (
       <TouchableOpacity
         onPress={async () => {
           await archiveMutation.mutateAsync({ inquiryId: props.inquiry.id });
           utils.inquiries.listForAdmin.invalidate();
         }}
         style={{
           backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center',
           width: 80, marginVertical: 4, marginRight: 12,
           borderRadius: theme.borderRadius.xl,
         }}>
         <Text style={{ color: '#FFF', fontWeight: '600' }}>Archive</Text>
       </TouchableOpacity>
     );
     return <Swipeable renderRightActions={renderRightActions}><InquiryRow {...props} /></Swipeable>;
   }
   ```

   **Note:** `trpc.inquiries.archive` must exist server-side. If it doesn't, this module **also adds** that mutation (1-line addition to `server/routers/inquiries.ts`).

6. **`packages/mobile/components/InquiryFilters.tsx`** — horizontal scroll of filter pills:
   ```tsx
   import { ScrollView, TouchableOpacity, Text } from 'react-native';
   import { theme } from '@/_core/theme';

   export type InquiryFilter = 'all' | 'unread' | 'has-draft' | 'escalated';
   export function InquiryFilters({ active, onChange }: { active: InquiryFilter; onChange: (f: InquiryFilter) => void }) {
     const opts: InquiryFilter[] = ['all', 'unread', 'has-draft', 'escalated'];
     return (
       <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 12 }}>
         {opts.map((f) => (
           <TouchableOpacity key={f} onPress={() => onChange(f)} style={{
             paddingHorizontal: 14, paddingVertical: 6,
             borderRadius: theme.borderRadius.lg, // 8 — buttons per CLAUDE.md §2.1
             backgroundColor: active === f ? theme.colors.primary : theme.colors.card,
           }}>
             <Text style={{ color: active === f ? '#fff' : theme.colors.foreground, fontWeight: '500', fontSize: 13 }}>
               {f.replace('-', ' ')}
             </Text>
           </TouchableOpacity>
         ))}
       </ScrollView>
     );
   }
   ```

7. **`packages/mobile/app/(tabs)/inbox.tsx`:**
   ```tsx
   import { FlatList, RefreshControl, View, Text } from 'react-native';
   import { useState } from 'react';
   import { trpc } from '@/_core/trpc';
   import { useAuth } from '@/_core/auth';
   import { router } from 'expo-router';
   import { InquiryFilters, type InquiryFilter } from '@/components/InquiryFilters';
   import { SwipeableInquiryRow } from '@/components/SwipeableInquiryRow';
   import { theme } from '@/_core/theme';

   export default function InboxScreen() {
     const { token } = useAuth();
     if (!token) { router.replace('/login'); return null; }

     const [filter, setFilter] = useState<InquiryFilter>('all');
     const { data, refetch, isRefetching, isLoading } = trpc.inquiries.listForAdmin.useQuery({ filter });

     return (
       <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
         <InquiryFilters active={filter} onChange={setFilter} />
         <FlatList
           data={data ?? []}
           keyExtractor={(item) => String(item.id)}
           renderItem={({ item }) => <SwipeableInquiryRow inquiry={item} />}
           refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
           ListEmptyComponent={
             <View style={{ padding: 32, alignItems: 'center' }}>
               <Text style={{ color: theme.colors.muted }}>
                 {isLoading ? 'Loading…' : 'No inquiries.'}
               </Text>
             </View>
           }
           contentContainerStyle={{ paddingBottom: 32 }}
         />
       </View>
     );
   }
   ```

8. **Server-side: add `archive` mutation** if it doesn't already exist:
   In `server/routers/inquiries.ts`:
   ```ts
   archive: adminProcedure
     .input(z.object({ inquiryId: z.number() }))
     .mutation(async ({ input, ctx }) => {
       await db.update(inquiries).set({ archivedAt: new Date() }).where(eq(inquiries.id, input.inquiryId));
       // auditLog (Module 4.21 enforces this; if Module 4.21 not yet merged, add inline)
       return { ok: true };
     }),
   ```
   Verify `archivedAt` column exists in schema; if not, add migration 0082 (1-line ALTER) and update schema.ts.

9. **Add `filter` input to `listForAdmin` if not present:**
   ```ts
   listForAdmin: adminProcedure
     .input(z.object({
       filter: z.enum(['all', 'unread', 'has-draft', 'escalated']).default('all'),
     }))
     .query(async ({ input }) => {
       const whereClauses = [isNull(inquiries.archivedAt)];
       if (input.filter === 'unread') whereClauses.push(eq(inquiries.hasUnreadMessages, true));
       if (input.filter === 'has-draft') whereClauses.push(isNotNull(inquiries.skillRunId));
       if (input.filter === 'escalated') whereClauses.push(eq(inquiries.escalated, true));
       return db.select().from(inquiries).where(and(...whereClauses)).orderBy(desc(inquiries.createdAt));
     }),
   ```

10. **i18n keys (4 keys in `packages/mobile/i18n/zh-TW.ts` — NEW file; mobile has its own minimal dictionary):**
    - `inbox.title`: 「收件夾」 / "Inbox"
    - `inbox.empty`: 「沒有新詢問」 / "No inquiries"
    - `inbox.loading`: 「載入中…」 / "Loading…"
    - `inbox.filter.all` / `unread` / `hasDraft` / `escalated`

    **DECISION:** mobile i18n dict — separate file? Or share with web? **Recommendation:** separate minimal dict in `packages/mobile/i18n/` because mobile has different copy density. Module 4.17 (i18n restructure) may revisit consolidation.

11. **Visual smoke (Jeff-side after dev build):**
    - Run dev build on Jeff's iPhone.
    - Open Inbox tab → list renders with rows matching web's data shape.
    - Pull down to refresh → query re-runs.
    - Swipe a row left → "Archive" button reveals → tap → row disappears from list.
    - Tap a row → navigates to `/inquiry/[id]` (placeholder route until Module 4.11).

## Acceptance Criteria

- [ ] `packages/mobile/app/(tabs)/_layout.tsx` exists with 3-tab navigator.
- [ ] `packages/mobile/app/(tabs)/inbox.tsx` renders inquiry list backed by `trpc.inquiries.listForAdmin`.
- [ ] `InquiryRow`, `SwipeableInquiryRow`, `InquiryFilters`, `StatusBadge` components exist in `packages/mobile/components/`.
- [ ] **CLAUDE.md §2.1 compliance verified:** all cards use `borderRadius: theme.borderRadius.xl` (12), buttons use `borderRadius: theme.borderRadius.lg` (8), badges use `borderRadius: theme.borderRadius.md` (6). **Check by grep:** no raw `borderRadius: 0` or `borderRadius: 9999` (full) outside intentional cases.
- [ ] Pull-to-refresh works.
- [ ] Swipe-to-archive works → row removes from list → audit log row written.
- [ ] Tap navigates to `/inquiry/[id]` route (route definition TBD in Module 4.11; for now expo-router handles missing route gracefully).
- [ ] Mobile i18n dict at `packages/mobile/i18n/zh-TW.ts` + `en.ts` (4-6 keys).
- [ ] `trpc.inquiries.archive` mutation exists and is callable.
- [ ] `trpc.inquiries.listForAdmin` accepts `{ filter }` input.
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] **Test:** `packages/mobile/app/(tabs)/inbox.test.tsx` — 3 cases per CLAUDE.md §九:
  - (a) Renders rows when query returns 3 inquiries.
  - (b) Pull-to-refresh triggers `refetch()`.
  - (c) Archive mutation called on swipe action. Mock `trpc.inquiries`.
- [ ] **Test:** `packages/mobile/components/StatusBadge.test.tsx` — 1 case: renders label + variant color.
- [ ] Manual smoke on dev build (Jeff): list renders, swipe archives.

## Deliverable

- New: `packages/mobile/app/(tabs)/_layout.tsx`, `packages/mobile/app/(tabs)/inbox.tsx`, `packages/mobile/app/(tabs)/inbox.test.tsx`, `packages/mobile/components/InquiryRow.tsx`, `packages/mobile/components/SwipeableInquiryRow.tsx`, `packages/mobile/components/InquiryFilters.tsx`, `packages/mobile/components/StatusBadge.tsx`, `packages/mobile/components/StatusBadge.test.tsx`, `packages/mobile/i18n/zh-TW.ts`, `packages/mobile/i18n/en.ts`
- Modified: `server/routers/inquiries.ts` (add `archive` mutation + `filter` input if absent), possibly `drizzle/schema.ts` (`archivedAt` column if absent) + `drizzle/0082_inquiry_archived_at.sql`

**Commit message:**

```
feat(mobile): Wave 4 module 4.10 — RN Inbox screen (UnifiedInbox parity)

- packages/mobile/app/(tabs)/_layout.tsx — 3-tab navigator (Inbox/Agent/Bookings)
- inbox.tsx — list backed by trpc.inquiries.listForAdmin with filter pills
- SwipeableInquiryRow — left-swipe reveals Archive action
- InquiryRow shows: customer, snippet, date, draft-ready badge (Wave 3),
  classification badge, new badge
- Pull-to-refresh via RefreshControl
- New mutation: trpc.inquiries.archive (admin-only, auditLog-aware)
- listForAdmin accepts filter input (all/unread/has-draft/escalated)
- Migration 0082: inquiries.archivedAt nullable datetime (if absent)
- CLAUDE.md §2.1 borderRadius compliance: xl=12 cards, lg=8 buttons,
  md=6 badges — numeric values match web rounded-* classes
- 4 Vitest cases on inbox screen + StatusBadge

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.10
```

## Rollback

- Revert removes mobile inbox screen + tab layout + helper components. Mobile app falls back to Module 4.8 placeholder.
- Server-side changes (archive mutation, filter input) are additive — if mobile is reverted but server keeps them, that's harmless (the web admin tab can also benefit from these and may consume them after).
- Migration 0082 (if added) is forward-only; harmless to leave applied.

## Manual intervention

- **Jeff (after dev build, ~15 min):** install dev build via TestFlight or Expo dev-client → log in → open Inbox tab → verify rows render → swipe-archive a test inquiry → pull-to-refresh.
- **Jeff (~5 min):** compare against web `OfficeInboxTab.tsx` side-by-side; flag any visual or functional gap to add to a v3 polish task.

## Test plan

**Vitest:** `packages/mobile/app/(tabs)/inbox.test.tsx` — 3 cases (mock `trpc.inquiries.listForAdmin`, `useAuth`, `expo-router`):

1. **Renders 3 rows:** mock query returns 3 inquiries → render → expect 3 `InquiryRow` instances.
2. **Pull-to-refresh:** trigger `RefreshControl.onRefresh` → assert `refetch` mock called.
3. **Swipe archive:** trigger swipe right-action → assert `trpc.inquiries.archive.mutate` called with inquiry ID.

**Vitest:** `packages/mobile/components/StatusBadge.test.tsx` — 1 case: render with `label="Draft"` `variant="success"` → text "Draft" visible + green background.

**Regression anchor:** root `pnpm test` count unchanged + 4 new cases.

**Manual smoke (Jeff-side):**
- Dev build → Inbox tab → all interactions work (filter, swipe, tap, pull).
- Compare 1 inquiry side-by-side with web → same data shown.

## Decisions needed (Jeff)

1. **Mobile i18n dict separation** — separate file in `packages/mobile/i18n/` vs share with web's `client/src/i18n/`. Recommend separate (different copy density on mobile).
2. **Empty-state UX** — current is plain text "No inquiries". Jeff may want an illustration. Recommend defer to v3.
3. **Filter pill copy** — currently English-source (`all`, `unread`, `has-draft`, `escalated`). Localize to zh-TW via i18n: 「全部」「未讀」「有草稿」「已升級」. Recommend localize. Lock before commit.
4. **Detail-screen route name** — `/inquiry/[id]` vs `/inbox/[id]`. Recommend `/inquiry/[id]` so it can be reused outside the tab navigator (e.g., deep link from push). Lock for Module 4.11.
5. **Swipe direction** — right→left exposes archive (current). Some users expect left→right for archive. Recommend keep current (matches iOS Mail convention).
