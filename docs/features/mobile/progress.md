# Mobile-first Admin — Progress Tracker

> Read `proposal.md` first for context, `design.md` for architecture.

Each phase is a separate PR. Ship in order — earlier phases unlock later.

---

## Phase 0 — PWA foundation  `(0.5 day, ~150 LOC)`
**Status**: ⏳ Pending Jeff approval to start

- [ ] `public/manifest.json` — update theme_color, short_name, icons
- [ ] `public/icons/192.png` + `512.png` — PACK&GO logo, maskable
- [ ] `public/service-worker.js` — cache shell, network-first tRPC
- [ ] `client/src/main.tsx` — register service worker
- [ ] `<InstallPromptToast>` — dismissable, 3rd-visit trigger via localStorage
- [ ] Test: Add to Home Screen on iPhone Safari, verify full-screen launch
- [ ] Vitest: `installPromptLogic.test.ts` (3rd-visit gate)

**Ships independently** — improves desktop too (offline page reload).

---

## Phase 1 — Mobile shell  `(1 day, ~400 LOC)`
**Blocks**: Phases 2-5
**Status**: ⏳ Pending

- [ ] `client/src/_core/hooks/useIsMobile.ts` — matchMedia 767px
- [ ] `client/src/components/mobile/MobileShell.tsx`
  - Top header (60px) — title left, 🔔 inbox + 🔍 search right
  - Bottom nav (60px fixed) — 5 items: 今日 / 收件 / 銀行 / 客戶 / 更多
  - Safe-area insets for notch + home indicator
- [ ] `client/src/components/mobile/KpiStrip.tsx`
  - Horizontal scroll-snap, 6 cards × 130w × 88h
  - Consumes `plaid.financeKpi` (existing query, no backend change)
- [ ] `client/src/pages/AdminV2.tsx`
  - Branch on `useIsMobile()`: render `<MobileShell>` vs existing desktop shell
- [ ] Vitest: useIsMobile resize triggers re-render
- [ ] Chrome MCP: 390×844 screenshot — KPI strip + bottom nav visible, no horizontal page scroll

---

## Phase 2 — Daily check page  `(1 day, ~300 LOC)`
**Status**: ⏳ Pending

- [ ] `client/src/components/mobile/DailyCheckPage.tsx`
  - Greeting + date header
  - `<KpiStrip>` from Phase 1
  - `<NeedsYouDecide>` block — agent escalations + uncategorized > $50
  - Activity feed (24h Stripe + Gmail + agent messages)
  - 2 quick action buttons (AI categorize / receipt camera placeholder)
- [ ] Optional: batch query `office.dailyDigest` (combines 3 existing queries)
- [ ] Tap-targets ≥ 44px verified
- [ ] Vitest: `<DailyCheckPage>` renders with mock data, escalations sorted by amount
- [ ] Chrome MCP: < 1.5 viewports of scroll on iPhone 14

---

## Phase 3 — Global search (customers + tours + bookings) + reply  `(2.5 day, ~700 LOC)`
**Status**: ⏳ Pending — PROMOTED from Phase 4 (sales-frequency reordering)

- [ ] `server/routers/searchRouter.ts` — new unified search procedure
  - Searches: customers (name + phone fuzzy) + tours (title + dest + code) + bookings (id + ref)
  - Returns: `{ tours: [...], customers: [...], bookings: [...] }`
  - Limit 8 per group, total round-trip < 200ms
- [ ] `client/src/components/mobile/GlobalSearchSheet.tsx`
  - Floating search FAB top-right (one thumb-reach)
  - Fullscreen modal, autofocus input
  - Grouped results: 🗺️ 行程 / 👥 客戶 / 📋 訂單
  - Recent contacts (last 7 days) when input empty
  - Live results as Jeff types (debounce 300ms)
- [ ] `client/src/lib/replyTemplates.ts` — 5 message templates per lang
- [ ] `<CustomerDetailMobile>` — booking summary + 3 action buttons
- [ ] Tap-to-call: `<a href="tel:...">`
- [ ] WeChat deeplink: `weixin://...` with QR fallback
- [ ] Vitest: template rendering, search query shape
- [ ] Chrome MCP: search "wang", verify customer + tour + booking results

---

## Phase 4 — Tour mobile detail + share  `(2 day, ~600 LOC)`
**Status**: ⏳ Pending — NEW 2026-05-22 (Jeff: "還可以查詢行程 以及 share")

- [ ] `client/src/pages/TourDetailPeony/index.tsx`
  - Audit existing responsive — most sections work, optimize hero + quick facts
  - Mobile: hero 60vh max (was full-screen), CTAs sticky bottom
- [ ] `client/src/pages/TourDetailPeony/ShareDialog.tsx`
  - Native Web Share API path: `if (navigator.share)` opens iOS share sheet
    with title + url + text — covers WeChat, Messages, AirDrop, Mail
  - Fallback to existing custom buttons (WeChat QR / 小紅書 caption / mailto)
  - Add `?ref=jeff` to shared URL for PostHog attribution
- [ ] `xhsdiscover://` deeplink for 小紅書 — tries to open native app,
    falls back to web upload page if not installed
- [ ] Vitest: navigator.share branching, ref param added
- [ ] Chrome MCP: open ShareDialog at 390×844, verify all 4 channels render

---

## Phase 5 — Bank txn triage  `(1.5 day, ~500 LOC)`
**Status**: ⏳ Pending — DEMOTED from Phase 3

- [ ] `pnpm add react-swipeable` (~3kb)
- [ ] `client/src/components/mobile/BankTriagePage.tsx`
  - Fetch uncategorized list once on mount
  - Full-screen card per txn: date, amount, merchant, AI category + reasoning
  - Category quick-pill row (8 PACK&GO categories + "其他")
  - Swipe right → confirm, left → exclude
  - Bottom action: 確認下一筆 / pause
- [ ] URL state: `?triageIdx=N` for resume on accidental close
- [ ] Vitest: simulate swipe events, verify `transactionUpdate` called with right args
- [ ] Chrome MCP: simulate 3 swipes, verify progress counter

---

## Phase 6 — Receipt camera + OCR  `(2.5 day, ~700 LOC)`
**Status**: ⏳ Pending

- [ ] `server/services/receiptOcrService.ts` — Claude Haiku 4.5 vision call
  - Input: image URL + prompt "Extract total, date, vendor"
  - Output: { amount, date, vendor, confidence }
  - Cache by image hash (no re-OCR on retries)
- [ ] `server/routers/receiptsRouter.ts`
  - `POST /api/receipts/upload` (multer) → R2 → OCR → match
  - Daily rate-limit: 50/day per admin
- [ ] `client/src/components/mobile/ReceiptCameraFAB.tsx`
  - Bottom-right FAB, persistent
  - `<input capture="environment">`
- [ ] `<ReceiptMatchPrompt>` modal — show OCR result + top-3 txn matches
- [ ] Match algorithm: amount ±$0.50, date ±3 days, prefer same-vendor
- [ ] Auto-attach via `trpc.plaid.transactionUpdate({ receiptUrl })`
- [ ] Vitest: matching algorithm — given OCR + bank rows, top match correct
- [ ] Chrome MCP: limited (no camera) — test fallback file picker

---

## Phase 7 — Polish + perf  `(1 day, ~200 LOC)`
**Status**: ⏳ Pending

- [ ] Sentry Web Vitals: assert FCP < 1s, TTI < 2s on real prod traffic
- [ ] PostHog event: track each P0 use case start + complete
- [ ] Loading skeletons for slow-network states
- [ ] Pull-to-refresh on daily check page
- [ ] Settle keyboard shortcuts on desktop (mobile work shouldn't regress)
- [ ] Jeff dogfood: 1 week real use, gather friction list
- [ ] One-week retro: which phase 1-5 needs revision?

---

## Out of scope (track for v2 of mobile)

- Native push notifications (APNs + Firebase setup, ~3 day)
- Offline writes / sync (CRDT or last-write-wins, ~5 day)
- Voice memo → transcribe → reply (Whisper API, ~2 day)
- AR / map view of customer locations (~3 day, dubious value)
- Tour generation on mobile (intentionally desktop-only per design.md)
