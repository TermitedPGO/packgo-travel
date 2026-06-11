# Mobile-first Admin — Design

> **SUPERSEDED (2026-06-10)** → `docs/features/admin-pwa/`。本檔留存不刪:SW cache 策略的設計理由(tRPC 為何不快取等)只記在這裡。

**Status**: Draft, follows `proposal.md`

---

## Architecture decision: responsive, not separate

**Decision**: keep ONE route tree (`/admin/v2/*`). Components decide layout
at runtime via Tailwind responsive classes + `useIsMobile()` hook.

**Why not separate `/admin/m`**:
- Duplicates routing + tRPC queries (sync drift between desktop/mobile)
- Doubles maintenance — every new feature needs 2 implementations
- Jeff context-switches device often (desk → phone → desk in same hour); URL
  consistency matters
- Existing `/admin/v2` is already half-responsive; finishing the job costs
  less than building parallel

**Why not pure responsive**:
- Some interactions FUNDAMENTALLY differ (Tinder swipe vs row click)
- A "Mobile View" container at the page level lets us swap UX for those

**Hybrid pattern**:
```tsx
const isMobile = useIsMobile(); // resize-aware, breakpoint at 768px
return isMobile ? <BankLedgerMobile /> : <BankLedgerDesktop />;
```
Both share the same data layer (`trpc.plaid.transactionsList`); only
presentation diverges. Estimated 4 pages need this split:
1. FinanceLanding (KPI grid)
2. BankLedgerV2 (table vs swipe-card)
3. BookingsTabV2 (table vs list)
4. InquiriesTabV2 (table vs list)

---

## Layout primitives

### `useIsMobile()` hook
```ts
// client/src/_core/hooks/useIsMobile.ts
export function useIsMobile(): boolean {
  const [m, setM] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const h = (e: MediaQueryListEvent) => setM(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return m;
}
```

### `<MobileShell>` component
- Replaces `<AdminV2Shell>` when `isMobile === true`
- Hides desktop sidebar entirely
- Top bar: title + 🔔 inbox count + 🔍 search icon
- Bottom nav (fixed): 5 items, 60px tall, safe-area-inset-bottom
- Main content: `pt-12 pb-16 px-4` (12 top for header, 16 bottom for nav)

### `<KpiStrip>` (mobile-tuned KPI)
- Replaces 6 `<KpiCard>` grid on mobile
- Single horizontal scroll snapping row at 88px tall
- Each card: 130px wide × 88px = readable but compact
- 賺 / 付 / 淨 / 待 Jeff / 訂金(trust) / YTD — 6 cards, swipe horizontally

---

## P0 #1 — Daily check page

Route: `/admin/v2` (today-tab is the default for office domain when mobile)

Layout (top-to-bottom):
```
┌─────────────────────────────────────┐
│ 👋 早 Jeff · 5/22 · 🔔 3            │ ← header
├─────────────────────────────────────┤
│ KpiStrip (賺/付/淨/待 Jeff/訂金/YTD) │ ← 88px
├─────────────────────────────────────┤
│ 需要你決定 · 3 件                    │ ← banner if >0
│  • RefundAgent 規則外退費  →        │
│  • OpsAgent 客人找 5 天 9月  →      │
│  • Bank: McDonald's $8.41 ?  →      │
├─────────────────────────────────────┤
│ 今日數字                             │
│  Stripe payout +$1,000 · 09:23     │
│  Zelle out -$210 (Ann) · 11:05     │
│  Gmail #3 紛擾 (新詢問)             │
├─────────────────────────────────────┤
│ [📷 拍收據]  [🤖 AI 分類 53 筆]     │ ← quick actions
└─────────────────────────────────────┘
        [今日][收件][銀行][客戶][更多]  ← bottom nav
```

Data: combines existing `plaid.financeKpi` + `agent.listMessages` +
`gmail.urgentList` (if exists; else stub) into 1 batched query.

---

## P0 #2 — Bank txn triage (swipe)

Route: `/admin/v2` → office → 「待 Jeff 確認」 banner tap → triage screen

Layout (full-screen, no scroll within card):
```
┌─────────────────────────────────────┐
│   < 6/53                       ✕    │ ← progress + exit
├─────────────────────────────────────┤
│                                     │
│   May 19  ·  -$8.41                 │ ← amount big
│                                     │
│   McDonald's                        │
│   General Merchandise               │
│                                     │
│   ╭─────────────────────────╮      │
│   │  AI: other_review · 25% │      │
│   │  「快餐, 無法直接確認商務 │      │
│   │   用途。Jeff 確認」     │      │
│   ╰─────────────────────────╯      │
│                                     │
│   對方: McDonald's                  │
│   分類:                             │
│   [出差餐] [客戶招待] [個人]        │ ← quick category pills
│                                     │
├─────────────────────────────────────┤
│ ◀ 個人(排除)         確認 + 下一筆 ▶│ ← bottom action bar
└─────────────────────────────────────┘
```

Gestures (use `react-swipeable` — 3kb, no animation lib needed):
- Swipe right → confirm AI suggestion + advance
- Swipe left → mark personal/exclude + advance
- Tap pill → override category + advance
- Tap card → expand to full BankTxDrawerForm (desktop drawer reused)

Progress persists via URL: `?triageIdx=6` so accidental close resumes.

---

## P0 #3 — Customer lookup + 1-tap reply

Floating search button, top-right header. Tap opens fullscreen search.

```
┌─────────────────────────────────────┐
│ ✕  搜尋客戶...                       │ ← autofocus input
├─────────────────────────────────────┤
│ 🔥 最近聯絡                         │
│   王太太 · +1 415-...  (5/20)       │
│   林先生 · CHUNFU HSIEH (5/19)      │
│   Ann · +1 510-... (5/18)           │
├─────────────────────────────────────┤
│ 搜尋結果: "wang"                    │
│   Wang 王太太 — 大阪 7 日           │
│     ─ 5/21 訂金 $1,000 paid         │
│     ─ Tour starts 6/12              │
│     [📞 撥打] [💬 WeChat] [✉️ Email]│
└─────────────────────────────────────┘
```

Search backend: `trpc.crm.searchCustomers` (already exists; needs phone-fuzzy
match added).

Reply templates: per-customer language preference (zh/en) determines which
template fires. Templates live in `client/src/lib/replyTemplates.ts`:
- 「我看到您 X 月 X 日的詢問,讓我幫您查...」
- 「您的 [tour] 出發日是 X, 還有 X 天」
- 「款項已收到, 詳細行程稍後寄...」

Tap [💬 WeChat] → opens WeChat with `weixin://dl/business/?ticket=` (or
qrcode fallback for first-time contacts).

---

## P0 #4 — Receipt camera

Persistent FAB bottom-right above bottom nav. Cross-app: visible on every
mobile screen.

Flow:
1. Tap FAB → `<input type="file" accept="image/*" capture="environment">`
2. Native camera opens
3. After capture → upload to `/api/receipts/upload` (new endpoint)
4. Server pipeline:
   - Save to R2 `receipts-inbox/<userId>-<ts>.jpg`
   - Send image to Claude vision (Haiku 4.5) with prompt:
     "Extract: total_amount (USD), date, vendor_name. Return JSON."
   - Cost: ~$0.003 per receipt
   - Query bankTransactions for matches: amount within ±$0.50,
     date within ±3 days
   - Return: { uploadUrl, ocr: {...}, suggestions: [{txnId, score}, ...] }
5. Client UX:
   ```
   ┌──────────────────────┐
   │ 收據已上傳            │
   │                      │
   │ AI 看到:             │
   │  Burger King $12.34  │
   │  5/22                │
   │                      │
   │ 比對到:              │
   │  ✅ 5/22 Burger King │
   │     -$12.34          │
   │                      │
   │ [確認附上]  [手動選擇]│
   └──────────────────────┘
   ```
6. Confirm → `trpc.plaid.transactionUpdate({ receiptUrl })`

If no match found: list last 30 days of transactions sorted by amount
proximity. Jeff picks manually.

---

## PWA setup

`public/manifest.json`:
```json
{
  "name": "PACK&GO Admin",
  "short_name": "PACK&GO",
  "start_url": "/admin/v2",
  "display": "standalone",
  "theme_color": "#0D9488",
  "background_color": "#FFFFFF",
  "icons": [...]  // 192, 512 maskable
}
```

`service-worker.js`:
- Cache shell (HTML + CSS + JS) for offline page-load
- Network-first for tRPC (no offline writes Phase 1)
- Stale-while-revalidate for images

Install prompt: after 3rd /admin/v2 visit, show `<InstallPrompt>` toast.
Dismissable. Survives session via `localStorage`.

---

## Performance budget

| Metric | Target | Tool |
|--------|--------|------|
| FCP | < 1s on 4G | Sentry Web Vitals |
| TTI | < 2s on 4G | PostHog timing event |
| KPI query | < 500ms p95 | tRPC server log |
| Bundle (mobile shell) | < 50kb gz | vite-bundle-visualizer |

---

## Files to touch

```
client/src/
  _core/hooks/useIsMobile.ts                ← new
  components/mobile/                        ← new dir
    MobileShell.tsx                         ← header + bottom nav
    KpiStrip.tsx                            ← horizontal-scroll KPI
    DailyCheckPage.tsx                      ← P0 #1
    BankTriagePage.tsx                      ← P0 #2
    CustomerSearchSheet.tsx                 ← P0 #3
    ReceiptCameraFAB.tsx                    ← P0 #4
    InstallPromptToast.tsx                  ← PWA
  pages/AdminV2.tsx                         ← route into MobileShell when isMobile
public/
  manifest.json                             ← exists, update
  service-worker.js                         ← new
  icons/192.png + 512.png                   ← new (need design)
server/
  routers/
    receiptsRouter.ts                       ← new — upload + OCR + match
    crmRouter.ts                            ← extend with phone-fuzzy search
  services/
    receiptOcrService.ts                    ← new — Claude vision wrapper
```

---

## Risks

| Risk | Mitigation |
|------|------------|
| iOS Safari PWA quirks | Test on real iPhone before each phase ship |
| OCR cost runaway | Daily cap: 50 receipts/day per env (~$0.15/day) |
| Camera permission denied | Fallback to file picker |
| Swipe gesture conflicts with browser back | `touch-action: none` on triage cards |
| BankLedger desktop regression | Keep BankLedgerV2 unchanged; mobile is parallel component |
| Bottom nav covers content | `padding-bottom: env(safe-area-inset-bottom)` + 60px |

---

## Test plan (per phase)

Vitest:
- `useIsMobile.test.tsx` — resize triggers re-render
- `KpiStrip.test.tsx` — renders 6 cards, scrolls horizontally
- `BankTriagePage.test.tsx` — swipe events fire correct mutation
- `receiptOcrService.test.ts` — mocked Claude response → match score

Chrome MCP at 390×844:
- Each phase: navigate, screenshot, verify no horizontal scroll
- Triage: simulate swipe via JS touch events, verify next card
- Customer search: type "wang", verify result list

Real device (Jeff):
- Each phase ship: Jeff TestFlight-style runs through 4 P0 flows
  on iPhone, reports friction
