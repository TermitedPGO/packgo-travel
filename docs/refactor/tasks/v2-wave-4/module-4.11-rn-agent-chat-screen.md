# v2 · Wave 4 · Module 4.11 — RN Agent Chat screen (typed reply + streaming AI)

> ⏸️ **DEFERRED to v3** — Apple Developer Program $99/yr + Google Play $25 not committed. Task content preserved for v3 re-activation; no execution in v2.

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L2 — Admin RN Expo, §Module 4.11)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** DEFERRED-V3 (Jeff decision 2026-05-19 — focus v2 on web + PWA; revisit RN admin app in v3 after mobile traffic + customer demand data lands)
**Est. effort:** 12 h AI + 30 min Jeff review (streaming UX validation)
**Deploy window:** any time — mobile-only

## Goal

Build the Agent Chat tab (`packages/mobile/app/(tabs)/agent-chat.tsx`) plus the inquiry-detail / chat thread screen (`packages/mobile/app/inquiry/[id].tsx`) so Jeff can read the AI agent's classification + draft, type a reply, and stream a follow-up answer from the agent. Feature parity with web's `agentChat` flow (Wave 2 Module 2.4 split this from `agentRouter.ts` into `server/routers/agent/chat.ts`).

Streaming uses the same tRPC subscription / EventSource bridge as web. Markdown renders via `react-native-markdown-display`. Message bubbles follow CLAUDE.md §2.1 (chat bubbles → `borderRadius: 12` ≈ `rounded-xl`).

## Pre-requisites

- **Module 4.9 (OAuth) resolved.**
- **Module 4.10 (Inbox)** merged — provides the navigation source (tap inbox row → `/inquiry/[id]`).
- Wave 2 Module 2.4 (`agentRouter.ts` split) merged — `server/routers/agent/chat.ts` is canonical.
- Wave 3 Module 3.3 merged — `inquiry.skillRunId` references a skill draft we display in the thread.

## Inputs (read these before executing)

- `client/src/components/admin/agents/AgentChatPanel.tsx` (post-Phase-5B sub-view) + `ChatBubble` — web reference.
- `server/routers/agent/chat.ts` (post-Wave-2 split) — current procedures: `streamReply`, `sendMessage`, `listMessages`.
- `packages/mobile/_core/trpc.ts` (Module 4.8).
- `packages/mobile/_core/theme.ts`.
- `react-native-markdown-display` library docs (or `marked` + custom renderer).
- iOS Keyboard handling: `KeyboardAvoidingView` from `react-native`.
- Streaming pattern on RN: tRPC v11 supports React Native subscriptions via `httpSubscriptionLink` (Wave 1 may have set up; verify).

## Scope (what this module owns)

- ✅ `packages/mobile/app/(tabs)/agent-chat.tsx` — entry list of chat threads (cross-inquiry; rare standalone agent prompts).
- ✅ `packages/mobile/app/inquiry/[id].tsx` — inquiry detail screen with chat thread + skill-draft preview + reply input.
- ✅ `packages/mobile/components/ChatBubble.tsx` — bubble primitive (left=agent/customer, right=Jeff).
- ✅ `packages/mobile/components/StreamingChat.tsx` — typed-reply input + send + streaming response display.
- ✅ `packages/mobile/components/Markdown.tsx` — wraps `react-native-markdown-display` with brand-styled defaults.
- ✅ Vitest covering the chat screens.
- ❌ NOT in scope: skill-draft EDITING (read-only preview here; admin web stays canonical for skill template tweaks), bookings detail (Module 4.12), push subscription (Module 4.13).

## Procedure

1. **Read inputs** — especially `AgentChatPanel.tsx` for the canonical bubble layout, message ordering, streaming UX pattern.

2. **Install RN-specific deps:**
   ```bash
   cd packages/mobile
   pnpm add react-native-markdown-display react-native-keyboard-aware-scroll-view
   ```

3. **`packages/mobile/components/Markdown.tsx`:**
   ```tsx
   import Markdown from 'react-native-markdown-display';
   import { theme } from '@/_core/theme';

   const baseStyles = {
     body: { color: theme.colors.foreground, fontSize: 14, lineHeight: 22 },
     paragraph: { marginVertical: 4 },
     code_inline: { backgroundColor: theme.colors.card, paddingHorizontal: 4, borderRadius: 4 },
     fence: { backgroundColor: theme.colors.card, padding: 8, borderRadius: theme.borderRadius.lg },
     bullet_list: { marginVertical: 4 },
   };

   export function MarkdownView({ children }: { children: string }) {
     return <Markdown style={baseStyles}>{children}</Markdown>;
   }
   ```

4. **`packages/mobile/components/ChatBubble.tsx`:**
   ```tsx
   import { View } from 'react-native';
   import { theme } from '@/_core/theme';
   import { MarkdownView } from './Markdown';

   export function ChatBubble({ role, content }: { role: 'user' | 'agent' | 'customer'; content: string }) {
     const isMe = role === 'user'; // Jeff
     return (
       <View style={{
         alignSelf: isMe ? 'flex-end' : 'flex-start',
         maxWidth: '85%',
         backgroundColor: isMe ? theme.colors.primary : theme.colors.card,
         padding: 12,
         marginVertical: 4, marginHorizontal: 12,
         borderRadius: theme.borderRadius.xl, // 12 — CLAUDE.md §2.1 chat bubble
       }}>
         {isMe ? (
           // White text on teal bg
           <MarkdownView>{content}</MarkdownView>
         ) : (
           <MarkdownView>{content}</MarkdownView>
         )}
       </View>
     );
   }
   ```

   **CLAUDE.md §2.1 compliance verified:** `borderRadius: theme.borderRadius.xl` = 12 = `rounded-xl` per chat-bubble spec.

5. **`packages/mobile/components/StreamingChat.tsx`** — input + streaming:
   ```tsx
   import { useState } from 'react';
   import { View, TextInput, TouchableOpacity, Text, KeyboardAvoidingView, Platform } from 'react-native';
   import { trpc } from '@/_core/trpc';
   import { theme } from '@/_core/theme';

   export function StreamingChat({ inquiryId }: { inquiryId: number }) {
     const [draft, setDraft] = useState('');
     const [streamingMessage, setStreamingMessage] = useState<string | null>(null);
     const sendMutation = trpc.agentChat.sendMessage.useMutation();
     const utils = trpc.useUtils();

     // tRPC streaming subscription — depends on how Wave 1/2 wired it
     // Simplest path: call sendMessage which returns the full reply (non-streaming
     // first; streaming as v3 polish if RN-side EventSource is fragile)
     const onSend = async () => {
       if (!draft.trim()) return;
       const text = draft;
       setDraft('');
       setStreamingMessage('…');
       const result = await sendMutation.mutateAsync({ inquiryId, message: text });
       setStreamingMessage(null);
       utils.agentChat.listMessages.invalidate({ inquiryId });
       return result;
     };

     return (
       <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
         {streamingMessage && (
           <View style={{ padding: 12 }}>
             <Text style={{ color: theme.colors.muted, fontStyle: 'italic' }}>{streamingMessage}</Text>
           </View>
         )}
         <View style={{ flexDirection: 'row', padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
           <TextInput
             value={draft}
             onChangeText={setDraft}
             placeholder="Type a message..."
             multiline
             style={{
               flex: 1, backgroundColor: theme.colors.card,
               padding: 10, borderRadius: theme.borderRadius.lg, // 8 — CLAUDE.md §2.1 input
               minHeight: 40, maxHeight: 120,
             }}
           />
           <TouchableOpacity onPress={onSend} disabled={!draft.trim() || sendMutation.isPending}
             style={{
               backgroundColor: theme.colors.primary,
               paddingHorizontal: 16, justifyContent: 'center',
               borderRadius: theme.borderRadius.lg, // 8 — CLAUDE.md §2.1 button
               opacity: draft.trim() ? 1 : 0.5,
             }}>
             <Text style={{ color: '#fff', fontWeight: '600' }}>Send</Text>
           </TouchableOpacity>
         </View>
       </KeyboardAvoidingView>
     );
   }
   ```

   **Streaming caveat:** Module 4.11 ships **non-streaming** request/response. Streaming via tRPC subscriptions on RN requires `httpSubscriptionLink` config; if Wave 1/2 has not set this up, defer streaming to a follow-up task — non-streaming is functionally complete.

6. **`packages/mobile/app/inquiry/[id].tsx`:**
   ```tsx
   import { useLocalSearchParams, Stack, router } from 'expo-router';
   import { ScrollView, View, Text } from 'react-native';
   import { trpc } from '@/_core/trpc';
   import { ChatBubble } from '@/components/ChatBubble';
   import { StreamingChat } from '@/components/StreamingChat';
   import { theme } from '@/_core/theme';
   import { StatusBadge } from '@/components/StatusBadge';

   export default function InquiryDetailScreen() {
     const { id } = useLocalSearchParams<{ id: string }>();
     const inquiryId = Number(id);
     const { data: inquiry } = trpc.inquiries.getById.useQuery({ id: inquiryId });
     const { data: messages } = trpc.agentChat.listMessages.useQuery({ inquiryId });

     if (!inquiry) return <View />;

     return (
       <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
         <Stack.Screen options={{ title: inquiry.customerName ?? inquiry.customerEmail ?? 'Inquiry' }} />
         <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
           <View style={{ padding: 16, backgroundColor: theme.colors.card, marginHorizontal: 12, marginTop: 12, borderRadius: theme.borderRadius.xl }}>
             <Text style={{ fontWeight: '600', marginBottom: 4 }}>{inquiry.subject}</Text>
             <Text style={{ color: theme.colors.muted }}>{inquiry.message}</Text>
             <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
               {inquiry.classification && <StatusBadge label={inquiry.classification} variant="default" />}
               {inquiry.skillRunId && <StatusBadge label="Draft attached" variant="success" />}
             </View>
           </View>
           {(messages ?? []).map((msg) => (
             <ChatBubble key={msg.id} role={msg.role as any} content={msg.content} />
           ))}
         </ScrollView>
         <StreamingChat inquiryId={inquiryId} />
       </View>
     );
   }
   ```

7. **`packages/mobile/app/(tabs)/agent-chat.tsx`** — list-of-threads view (standalone agent prompts cross-cutting inquiries):
   ```tsx
   import { FlatList, View, Text } from 'react-native';
   import { trpc } from '@/_core/trpc';
   import { useAuth } from '@/_core/auth';
   import { router } from 'expo-router';
   import { theme } from '@/_core/theme';

   export default function AgentChatScreen() {
     const { token } = useAuth();
     if (!token) { router.replace('/login'); return null; }
     const { data } = trpc.agentChat.listThreads.useQuery();
     return (
       <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: 12 }}>
         <Text style={{ fontSize: 14, color: theme.colors.muted, marginBottom: 12 }}>
           Standalone chats with the AI ops assistant. Inquiries from customers are in the Inbox tab.
         </Text>
         <FlatList
           data={data ?? []}
           keyExtractor={(item) => String(item.id)}
           renderItem={({ item }) => (
             <View style={{ padding: 16, marginVertical: 4, backgroundColor: '#fff',
                            borderRadius: theme.borderRadius.xl, borderWidth: 1, borderColor: theme.colors.border }}>
               <Text style={{ fontWeight: '600' }}>{item.title ?? 'Untitled chat'}</Text>
               <Text style={{ color: theme.colors.muted, marginTop: 4 }} numberOfLines={1}>{item.preview}</Text>
             </View>
           )}
         />
       </View>
     );
   }
   ```

8. **Verify server routes exist:**
   - `trpc.inquiries.getById` (likely exists from web admin) — confirm.
   - `trpc.agentChat.listMessages({ inquiryId })` — Wave 2 Module 2.4 split made it.
   - `trpc.agentChat.sendMessage({ inquiryId, message })` — confirm; if absent, the mobile module is **BLOCKED** and the supervisor adds it server-side.
   - `trpc.agentChat.listThreads()` — confirm; if absent, this module either skips the agent-chat tab or adds the procedure.

9. **Smoke test on dev build (Jeff-side):**
   - Open Inbox tab → tap a row → inquiry detail loads → message history + skill-draft badge visible → type a reply → Send → message echoes in the thread.
   - Open Agent Chat tab → list of standalone threads renders.

## Acceptance Criteria

- [ ] `packages/mobile/app/inquiry/[id].tsx` renders inquiry header + message history + reply input.
- [ ] `packages/mobile/app/(tabs)/agent-chat.tsx` renders the threads list.
- [ ] `ChatBubble`, `StreamingChat`, `Markdown` components live in `packages/mobile/components/`.
- [ ] **CLAUDE.md §2.1 compliance:** chat bubbles `borderRadius.xl` (12), input `borderRadius.lg` (8), send button `borderRadius.lg` (8), inquiry-header card `borderRadius.xl` (12).
- [ ] Reply mutation works → message appears in thread after send.
- [ ] Markdown rendered correctly (test with a fixture message containing bold + bullet list).
- [ ] iOS keyboard does not cover the input (KeyboardAvoidingView verified).
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] **Test:** `packages/mobile/app/inquiry/[id].test.tsx` — 2 cases: (a) renders inquiry + 2 messages, (b) sending a message calls `agentChat.sendMessage` mutation.
- [ ] **Test:** `packages/mobile/components/ChatBubble.test.tsx` — 2 cases: (a) `role: user` aligns right with teal bg, (b) `role: agent` aligns left with card bg.
- [ ] Manual smoke: send a message on dev build → message appears server-side (web inbox shows it too).

## Deliverable

- New: `packages/mobile/app/(tabs)/agent-chat.tsx`, `packages/mobile/app/inquiry/[id].tsx`, `packages/mobile/components/ChatBubble.tsx`, `packages/mobile/components/StreamingChat.tsx`, `packages/mobile/components/Markdown.tsx`, plus 2 test files
- Possibly modified: `server/routers/agent/chat.ts` (if `listThreads` or `sendMessage` shape needs tweaking)

**Commit message:**

```
feat(mobile): Wave 4 module 4.11 — RN Agent Chat + inquiry detail

- /inquiry/[id] screen: inquiry header + message thread + reply input
- (tabs)/agent-chat screen: list of standalone AI agent chats
- ChatBubble (left=agent/customer, right=Jeff teal bubble)
- StreamingChat: KeyboardAvoidingView + multi-line input + send mutation
- react-native-markdown-display renders agent + customer message
- Non-streaming first-pass; streaming via tRPC subscriptions deferred to v3
  if EventSource setup on RN is fragile
- CLAUDE.md §2.1 borderRadius xl=12 bubbles, lg=8 input/button — verified
- 4 Vitest cases on screen + ChatBubble

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.11
```

## Rollback

- Single revert removes mobile chat screens + components.
- Server-side changes (if any) are additive — safe to leave.
- No DB / migration touched.

## Manual intervention

- **Jeff (~15 min):** dev build → open Inbox tab → tap an inquiry → chat thread renders → type "test reply" → Send → message appears on web admin inbox at same inquiry → audit confirms reply persisted.
- **Jeff (~5 min):** test Markdown rendering with a long agent response containing code blocks + bullets.

## Test plan

**Vitest:** `packages/mobile/app/inquiry/[id].test.tsx` — 2 cases (mock `trpc.inquiries.getById`, `trpc.agentChat.listMessages`, `trpc.agentChat.sendMessage`, `expo-router`):

1. **Render thread:** mock 2 messages + 1 inquiry → render → expect 2 `ChatBubble` instances + inquiry subject text.
2. **Send reply:** render → fill TextInput "hello" → press Send → assert `sendMessage.mutate({inquiryId, message: 'hello'})` called.

**Vitest:** `packages/mobile/components/ChatBubble.test.tsx` — 2 cases.

**Regression anchor:** root `pnpm test` count unchanged + 4 new cases.

**Manual smoke:** real device, full round-trip with web inbox observing.

## Decisions needed (Jeff)

1. **Streaming vs non-streaming first ship** — recommend non-streaming for Wave 4; streaming via RN tRPC subscription if `httpSubscriptionLink` is wired in Wave 1/2. Lock at Procedure step 5.
2. **Markdown depth** — current renders bold/lists/code. Tables (used in some skill output) need extra config or fallback to plain text. Recommend table-to-text fallback; full table rendering is v3.
3. **Reply auto-send to inquiry's email** — when Jeff types a reply in the chat thread, should it ALSO email the customer? Or stay internal? **Critical decision.** Recommend: internal-only on mobile; web admin has explicit "send email" button. Lock.
4. **`agentChat.listThreads` shape** — if Wave 2 didn't define it explicitly, supervisor adds; recommend `{id, title, preview, createdAt}` minimal shape.
