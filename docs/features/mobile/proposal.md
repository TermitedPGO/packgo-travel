# Mobile-first Admin — Proposal

**Author**: Jeff + Claude
**Date**: 2026-05-22
**Status**: Draft, awaiting approval

---

## Why now

Jeff is the sole employee at PACK&GO — owner, on-call, customer rep, accountant.
He runs a **travel agency**: he flies to suppliers, escorts groups in airport,
visits hotels in person, meets customers at restaurants. He's frequently
**phone-only**:

> 「很大程度我沒辦法用電腦的情況有很多 只有手機」

The current `/admin/v2` is desktop-first. At 390px (iPhone 14 width):

- 6 finance KPI cards stack 2-col × 3-row → fills 720px just for header
- Sidebar takes 50px of horizontal width even when collapsed
- Top "搜尋 ⌘K" affordance hints at desktop keyboard, no mobile equivalent
- BankLedger drawer (now `sm:max-w-3xl`) overlays full screen with no
  thumb-friendly close
- Tables (banking, bookings) horizontal-scroll on phone

PACK&GO's business runs on edge cases that hit at the worst moments —
customer calls during airport pickup, supplier wants Zelle confirmation
between meetings, a refund decision needs Jeff's call during a tour.
Mobile-first isn't polish, it's **operational survival**.

---

## P0 use cases (Jeff 2026-05-22, original 4 + 2 added)

### 1. 每日快檢 — 5 min mobile glance
- Single page, no scrolling beyond 1.5 viewports
- Above the fold:
  - 本月 賺 / 付 / 淨 / 待 Jeff 確認 — 4 numbers, one line
  - 「需要你決定」counter — agent escalations + uncategorized > $X
- Mid-fold: Last 24h activity feed (Stripe payouts, refunds, urgent Gmail)
- Below: 1-tap actions (AI categorize, mark all read)

### 2. 客人急件 lookup + 回訊  *(promoted — high frequency)*
- Floating search button (one thumb-reach top-right)
- Search: name / phone / booking id / Zelle ref
- Result: booking detail with:
  - Tap-to-call phone
  - 1-tap WeChat / SMS / Gmail reply (pre-filled templates)
  - Trip status, departure date, tour code
- Fastest path: dial-pad direct → search → call within 10s

### 3. 查詢行程 + 分享 (NEW 2026-05-22)
**Why**: Jeff meets potential customers in person (airport, restaurant,
WeChat chat). Needs "我有這個團" → search → show on phone → share via
WeChat / 小紅書 in 10 seconds.

- **Search**: same global search as P0 #2, now indexes tours too
  - Searches: tour title, destination country/city, tour code, tags
  - Results grouped: tours / customers / bookings
  - Sort: featured + active first, then recency
- **Tour detail (mobile-optimized)**: same data as desktop TourDetailPeony
  but vertical hierarchy, tap-to-expand sections
  - Hero image full-width
  - Quick facts (天數 / 城市 / 起價) in horizontal scroll
  - Below-fold: itinerary day-by-day accordion
- **Share** flow (one button, multiple targets):
  - Native iOS share sheet via `navigator.share()` — opens WeChat,
    Messages, AirDrop, Mail, etc. automatically
  - Custom buttons for tools that don't support Web Share API:
    - 🔵 WeChat → QR code + custom message text ready to paste
    - 📕 小紅書 → caption template auto-copied to clipboard,
      `xhsdiscover://` deeplink to open app
    - 📧 Email → mailto with pre-filled subject + body
    - 📋 Copy link
  - Add ?ref=jeff so we track which channel converted via PostHog

### 4. Bank txn 快速分類 — Tinder-style triage
- Card view: 1 transaction full-screen, AI suggestion big
- Swipe RIGHT = confirm AI · LEFT = override (modal)
- Bottom action bar: pause (skip) / 排除個人 (personal)
- Progress: "53 待 review · 12 done"
- 1 minute = 10-20 transactions cleared

### 5. Receipt 拍照上傳
- Persistent FAB "📷 Receipt" on every page
- Tap → device camera (HTML5 `<input capture>`)
- Server: OCR amount + vendor (Claude vision API)
- Match suggestion: "看起來是 5/21 -$38 Intuit, 對嗎?"
- 1-tap accept → R2 upload + attach to bankTransaction
- Fallback: manual transaction picker if no match

---

## Design constraints (from Jeff)

| Constraint | Implication |
|------------|------------|
| iPhone primary | Test at 390×844 (iPhone 14). 320px (iPhone SE) also works. |
| Travel context | Spotty wifi → optimistic UI, offline-tolerant reads |
| One-handed | All P0 actions reachable with thumb (bottom 2/3 of screen) |
| Glance latency | KPI load < 1s (server-side cache existing) |
| Operation simplicity | AI fills 90%, Jeff taps confirm |

---

## Non-goals (this phase)

- Native iOS app — PWA with `display: standalone` covers 95%
- Tour generation on mobile — heavy form, do on desktop
- Admin settings / system tabs — rare, desktop is fine
- Real-time push notifications — Phase 2 (needs APNs cert + cost)
- Offline writes — too complex (sync conflicts); reads only for now

---

## Success metrics

- **TTI on 4G**: < 2s for daily check page
- **Triage rate**: Jeff clears 50 txn in 5 min (vs current 10 min desktop)
- **Receipt-to-attached**: < 30s from camera tap to row updated
- **Customer call response**: < 15s from phone ring to booking pulled up

---

## Phased plan (revised 2026-05-22, +tour search/share)

| Phase | Scope | LOC est | Days |
|-------|-------|---------|------|
| **0** | PWA manifest + service worker + install prompt | ~150 | 0.5 |
| **1** | Mobile shell + bottom nav + responsive KPI hero | ~400 | 1 |
| **2** | Daily check page (P0 #1) | ~300 | 1 |
| **3** | Global search (customers + tours + bookings) + 1-tap reply (P0 #2) | ~700 | 2.5 |
| **4** | Tour mobile detail + share flow (P0 #3) | ~600 | 2 |
| **5** | Bank txn triage swipe UX (P0 #4) | ~500 | 1.5 |
| **6** | Receipt camera + OCR + match (P0 #5) | ~700 | 2.5 |
| **7** | Polish, perf, A/B test on prod | ~200 | 1 |

Total: ~3,550 LOC, ~12 days.

**Re-prioritization rationale**: Bank triage moved from Phase 3 → Phase 5
because customer search + tour share (Phases 3-4) are HIGH-FREQUENCY
sales scenarios. Jeff hits these multiple times per day; bank triage is
weekly. Customer-facing flows ship first to maximize daily value.

Phases 0-2 (PWA + shell + daily check) ship together as a single deploy
since they share routing/layout. After that, each phase ships independent.

---

## Open questions

1. **PWA install nag**: prompt on 3rd /admin visit, or only via menu? Jeff?
2. **Bottom nav items**: 5 max. Proposed: 今日 / 待 Jeff / 銀行 / 客戶 / 更多. Confirm?
3. **Search**: floating button vs always-visible bar at top?
4. **Camera OCR**: Anthropic vision or just amount-only regex? Cost vs accuracy.
5. **Domain split**: `/admin/v2/mobile/*` separate routes, or responsive same `/admin/v2`?

See `design.md` for detailed architecture choices.
