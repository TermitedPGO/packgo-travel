# Round 80.17 — AI Travel Advisor Dialog UI/UX Fix

**Date:** 2026-05-02
**Files:**
- `client/src/components/AITravelAdvisorDialog.tsx` (~625 lines, the live dialog)
- `client/src/i18n/zh-TW.ts` / `client/src/i18n/en.ts` (new keys)

**Scope:** Visual / copy only. The tRPC `ai.recordFeedback` mutation, the SSE
streaming `fetch('/api/ai/chat/stream')`, the `sessionId` lifecycle, the
guided-flow region/party-size state machine, and the skill-trigger / thumbs
feedback functionality are untouched.

---

## Background

Jeff's reaction to the existing dialog: 「UI/UX 不是專業級的」 ("not at a
professional level"). The dialog was hitting several B&W + Gold baseline
violations established across Round 80.x and rendering with a "toy" feel
inappropriate for a boutique travel agency selling to wealthy families:

1. `bg-yellow-400` pulse dot in the header thinking state — bright kid-emoji
   color in a premium dialog.
2. `text-yellow-500` Sparkles icon in the skill-trigger chip — same problem.
3. `bg-red-100 / text-red-600 / border-red-300` thumbs-down active state —
   emergency-warning colors that don't belong on a feedback control.
4. Multiple `bg-gradient-to-br from-gray-100 to-white` avatars and a
   `bg-gradient-to-b from-gray-50 to-white` message-area background — the
   gradients read as decorative rather than premium.
5. Penguin avatar in the header was 56×56 with a heavy white border and shadow,
   plus an `animate-bounce` mid-stream — very toy-like.
6. Header had two close buttons (Minimize2 + X) doing the same thing.
7. Loading bubble showed three dots **plus** the redundant text "正在思考...".
8. Welcome screen showed four generic buttons (找行程推薦 / 查日期 / 預算 /
   其他) — better suited to a touch-tone IVR than a premium chat surface.
9. Suggested-reply chips were thin gray pills with a hover ChevronRight
   animation that felt button-y rather than chip-y.
10. Streamdown markdown rendered with default `prose` colors — bullet markers,
    headings, and links had no brand alignment.

---

## What changed

### Header

- Penguin shrunk from 56×56 to 40×40, no border, no shadow, simple
  `bg-white/10` round container. `animate-bounce` while streaming removed.
- Online-status indicator (the green-ish dot in the bottom-right of the avatar)
  removed — was redundant with the textual "在線 · 隨時為您服務".
- Title swapped from `font-bold text-lg tracking-wide` to
  `font-serif text-base font-semibold tracking-wide` to match the rest of the
  PACK&GO serif-headline baseline.
- `bg-yellow-400` pulse dot in the thinking state replaced with `bg-[#c9a563]`
  (matches the idle dot — both are gold now, only `animate-pulse` differs).
- Removed the duplicate Minimize2 button. One X is enough.
- Added a hairline gold accent line across the bottom edge of the header
  (`bg-gradient-to-r from-transparent via-[#c9a563]/50 to-transparent`),
  echoing the pattern in `Header.tsx:154` and `Footer.tsx`.
- Background stays solid `bg-foreground` (no gradient).

### Message area

- Background changed from `bg-gradient-to-b from-gray-50 to-white` to a flat
  `bg-[#FAF8F2]` brand cream.
- Assistant avatar shrunk from 36×36 to 32×32, gradient + border + shadow
  replaced with flat `bg-foreground/5`.
- Assistant bubble: `bg-white border border-foreground/10 text-foreground` with
  `rounded-xl shadow-sm`. Removed the asymmetric `rounded-bl-md` corner stub
  (was visually inconsistent — message looked half-broken on small viewports).
- User bubble: `bg-foreground text-white rounded-xl`. Removed the
  `rounded-br-md` stub. User avatar 32×32, `bg-foreground` (was already correct
  but dropped the unnecessary shadow).
- Streamdown content now wears the full prose-mod chain:
  `prose prose-sm text-foreground prose-p:text-foreground
  prose-headings:text-foreground prose-headings:font-serif
  prose-strong:text-foreground prose-li:text-foreground
  prose-li:marker:text-foreground/60 prose-a:text-foreground
  prose-a:underline hover:prose-a:text-[#c9a563] prose-code:text-foreground
  prose-code:bg-foreground/5 prose-code:px-1 prose-code:py-0.5
  prose-code:rounded prose-code:font-normal`.
  Headings render in serif, bullets are foreground/60, links go gold on hover,
  inline code gets a subtle gray box.

### Skill triggers + thumbs feedback

- Skill-trigger chip: `bg-foreground/5 border-foreground/10 text-foreground/55
  px-2 py-0.5 rounded-md`. Sparkles icon: `text-[#c9a563]` (was `text-yellow-500`).
- Thumbs-up active: `text-[#c9a563]` only — no background, no border, no
  surrounding box. Hover-only treatment.
- Thumbs-down active: `text-foreground` (black). No more red/red-50/red-300.
- "有幫助嗎？" inline label removed — the icons alone are enough; the label
  cluttered the row.
- Buttons shrunk from `h-7 w-7` to `h-6 w-6` and de-prioritized to the right
  edge of the meta row.

### Suggested replies (follow-up chips)

- Were `border border-gray-300 text-gray-600 hover:border-black` with a
  `ChevronRight` reveal-on-hover.
- Now `bg-foreground/5 text-foreground/80 border border-foreground/10
  hover:bg-[#c9a563]/15 hover:text-[#8a6f3a] hover:border-[#c9a563]/40
  rounded-full px-3 py-1.5 text-xs`. Pure chip — no chevron, no scale animation.
- Hover state matches `Header.tsx` mega-menu chip pattern.

### Welcome / opening state

- Generic `[找行程推薦 / 查日期 / 預算 / 其他]` 2×2 grid replaced with
  4 destination chips (per the spec): `日本 10 天行程`, `歐洲蜜月旅行`,
  `夏威夷家庭旅遊`, `美西自駕行程`. These are concrete trip prompts that send
  straight to the LLM — no IVR-style guided flow from the welcome screen.
- New hint line above the chips: 「告訴我您的目的地、天數、預算或興趣」.
- Chips: white background, `border-foreground/10`, gold hover. Centered, wraps
  naturally on narrow viewports.
- Removed the now-unused `MapPin / Globe / FileText / Plane / ChevronRight`
  lucide imports.

> Note: the guided region+party-size flow (`guidedFlowStep` state machine) is
> preserved untouched. It just isn't reachable from the welcome screen anymore;
> it can still trigger if a context-aware suggestion happens to match the
> 「找行程推薦」 / region / party labels mid-conversation.

### Loading indicator

- Three bouncing dots only. The redundant "正在思考..." label removed (the
  thinking-pulse in the header already conveys streaming state).
- Dots: `w-1.5 h-1.5 bg-foreground/40 rounded-full` (was `w-2 h-2 bg-gray-400`).
- Penguin in the loading row: 32×32, no `animate-pulse` (avatar stays calm,
  the dots do the work).

### Input area

- Border-top: `border-foreground/10` (was `border-gray-200`).
- Input: `border-foreground/15` resting, `focus-visible:ring-foreground/20`,
  `focus-visible:border-foreground/40`. White background (was `bg-gray-50`).
- Send button: `h-11 w-11 bg-foreground hover:bg-foreground/90 rounded-lg
  shadow-sm`. Removed `hover:scale-105` and `shadow-lg` — calmer, more premium.
- Disclaimer text shrunk from `text-xs` to `text-[10px]` and lightened to
  `text-foreground/40 tracking-wide` so it reads as a footnote, not a warning.

### Penguin decision

- **Kept** but de-emphasized. The penguin is part of the PACK&GO advisor brand
  voice and removing it entirely would feel sterile. Sizes are now 40px in the
  header and 32px in message rows (down from 56 and 36). All gradient
  backgrounds, decorative borders, and bounce animations around the penguin are
  removed. The result reads as warm without reading as toy.

---

## i18n keys added

### `aiAdvisor.welcomeHint`
- zh-TW: `告訴我您的目的地、天數、預算或興趣`
- en: `Tell me your destination, dates, budget, or interests`

### `aiAdvisor.quickStartJapan`
- zh-TW: `日本 10 天行程`
- en: `Japan 10-day trip`

### `aiAdvisor.quickStartEuropeHoneymoon`
- zh-TW: `歐洲蜜月旅行`
- en: `Europe honeymoon`

### `aiAdvisor.quickStartHawaiiFamily`
- zh-TW: `夏威夷家庭旅遊`
- en: `Hawaii family vacation`

### `aiAdvisor.quickStartUSWestRoadTrip`
- zh-TW: `美西自駕行程`
- en: `US West road trip`

The existing `findTours / checkDates / budgetPlanning / otherQuestions` keys
are kept (still referenced by the guided-flow handler in
`handleSuggestionClick`).

---

## Verification

- `grep -nE "text-purple|bg-purple|text-blue-[3-9]|bg-blue-[3-9]|text-pink|text-indigo|text-yellow-3" client/src/components/AITravelAdvisorDialog.tsx`
  → 0 matches.
- `grep -nE "bg-yellow-4|text-yellow-5|bg-red|text-red|border-red"` on the
  same file → 0 matches.
- The only remaining `bg-gradient-*` is the gold accent hairline under the
  header, which is brand-correct and copies the same pattern from `Header.tsx`.
- TypeScript `pnpm check` — passes 0 errors.
- The orphan demo file `AIAdvisor.tsx` (134 lines, never imported) was left
  untouched. It's not in the production bundle.

---

## Out of scope

- LLM streaming logic, abort/timeout handling, sessionId, tRPC feedback
  mutation — untouched.
- Skill-trigger detection / display logic — untouched.
- Guided region+party-size state machine — preserved, just not surfaced from
  the welcome screen anymore.
- `AIAdvisor.tsx` demo file — orphan, left as-is. Removal can be a separate
  housekeeping pass.
