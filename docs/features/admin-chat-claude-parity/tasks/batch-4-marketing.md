# 批4 — 行銷(campaign · newsletter · poster 分發 · AI 海報生成 · 6 平台一稿出)

> Stage 3 task 文件。設計依據:後台_07_行銷 + 後台_08_一稿出6平台 + redesign-39.md §4.5。
> Jeff 拍板(2026-06-11):全做含 AI 海報生成；現有 admin PostersTab/PosterGenPanel 是骨架沒在用,可重寫。

## 實況調查(2026-06-11)

### 現有後端(5 routers, 8 tables — 齊全)
- `marketing.ts`(198 行):campaign CRUD + generateCopy + generatePoster + sendNewsletter + materials + subscriberStats + emailLogs
- `posters.ts`(238 行):poster 上傳/列表/取得(含 7 platform copies)/updateCopy/regenerateImage/archive/approve
- `posterGen.ts`(299 行):AI generation + cost tracking + iterations + per-platform variants
- `newsletter.ts`(124 行):subscribe/unsubscribe(rate-limited) + admin list/export
- `marketingContent.ts`(45 行):material CRUD
- 8 tables:posterAssets · posterPlatformCopies · newsletterSubscribers · marketingCampaigns · marketingMaterials · emailSendLogs · posterGenLogs · marketingAssets · posterIterations

### 現有前端(骨架,沒在用)
- `admin/MarketingTab.tsx`(740 行) — 主 dashboard,骨架
- `admin/PostersTab.tsx`(774 行) — poster list/edit/approval,骨架
- `admin/PosterGenPanel.tsx`(457 行) — AI gen panel,骨架
- `admin/MarketingContentTab.tsx`(248 行) — content drafts,骨架
- `admin-v2/NewsletterTabV2.tsx`(300 行) — 目前 workspace placeholder

### WorkspaceCompany 現狀
- marketing sub-tab 目前直接載 `<NewsletterTabV2 />`
- 需替換成新的 `MarketingHub` 元件(card grammar + 多 sub-view)

### 設計鐵律(design.md §2)
- 碰發布 = 🔒 locked confirmation(no auto-send, no batch）
- 海報價格不烙進圖片,用 text-overlay template（可改價不重生圖）
- 每次生成顯示 per-image cost + cumulative cost
- Generate ≠ publish:AI 輸出 → 採用/下載/複製文案+圖;Jeff 手動發
- posterIterations 追蹤版本樹(revert 不重新付費)

## Milestones

### m1 — Marketing Shell + Campaign Cards(零新 schema）✅
- [x] 新元件 `workspace/MarketingHub.tsx`(~380 行):3 sub-view tabs — Campaigns / Posters / Newsletter
- [x] 替換 WorkspaceCompany 的 marketing tab:NewsletterTabV2 → MarketingHub
- [x] Campaign 列表:ws-ui WorkspaceCard 渲染 listCampaigns 結果
  - 卡片:name · type badge · status StateChip · created date · 按 state 排序
  - Status flow:draft → scheduled → sending → sent → cancelled
- [x] Campaign 新增 dialog:name + type select
- [x] Campaign 編輯 dialog:reuse create dialog with pre-fill(getCampaign query)
- [x] Campaign 刪除:只有 draft 可刪,非 draft toast 攔截
- [x] i18n(27 keys zh-TW + en) · tsc 0 errors
- [ ] Vitest(待補)

### m2 — Newsletter Management Cards ✅
- [x] Newsletter sub-view in MarketingHub (replaced NewsletterPlaceholder with NewsletterView)
- [x] Subscriber 統計卡:active · total (subscriberStats query, 2-column grid)
- [x] Email campaign 列表:listCampaigns filtered to email_newsletter → WorkspaceCard per-campaign
  - 卡片:name · status StateChip · created date · draft/scheduled 顯示 Send 按鈕
- [x] Campaign email dispatch:選 campaign → subject + HTML content → 🔒 gated confirm → sendNewsletter mutation
  - 黑底鎖條:Lock icon + checkbox「確認寄出 N 封?此操作不可撤銷」
- [x] i18n (14 new keys zh-TW + en) · tsc 0 errors
- [ ] Vitest(待補)

### m3 — Poster Distribution Cards ✅
- [x] Poster sub-view: lazy-loaded `PosterDistribution.tsx` (split from MarketingHub, ~400 lines)
- [x] Poster 卡片:thumbnail · title · vendor badge · audience badge · status StateChip
  - Status flow:uploaded → processing → ready → approved → distributed → archived → failed
  - 2-column grid, sorted by action-needed priority
- [x] Click → PosterDetailSheet (shadcn Sheet, xl:max-w-3xl):
  - Header:poster image + title + vendor/audience badges + AI 分析摘要
  - 7-platform copies: per-row card with platform badge, status, copyText, hashtags
  - Per-platform inline edit: textarea + hashtags input → posters.updateCopy mutation
  - Approve all:🔒 black lock bar gated confirm → posters.approve mutation
- [x] Poster 上傳 dialog:image URL + title + vendor/audience dropdowns → posters.create
- [x] Archive:🔒 black lock bar gated confirm → posters.archive
- [x] i18n (46 new keys zh-TW + en) · tsc 0 errors
- [ ] Vitest(待補)

### m4 — AI Poster Generation(posterGen router + cost gate）✅
- [x] 新元件 `workspace/PosterGenerator.tsx` (~300 lines), lazy-loaded as 4th tab in MarketingHub
- [x] Style preset selector (清新/大字報/雜誌/實景) + prompt textarea + quality/size selectors
- [x] Cost dashboard: 4-card grid showing today/month spend + count (getCostStatus query)
- [x] 🔒 Cost gate dialog: estimated cost + today spend + checkbox confirm before each generation
- [x] Variant grid: successful iterations displayed as cards with thumbnail + cost badge + Use/Regenerate
- [x] Version history panel: toggle all iterations with prompt preview, status, cost, Use link
- [x] `onSelectForDistribution` callback prop for M5 integration
- [x] Generating spinner state while mutation pending
- [x] i18n (33 new keys zh-TW + en) · tsc 0 errors
- [ ] Vitest(待補)

### m5 — 6-Platform Generation Workflow(§4.5 核心）✅
- [x] 新元件 `workspace/SixPlatformComposer.tsx` (~260 lines): 1 poster → 7 platform cards
- [x] 7 platform cards (matching DB enum), each with:
  - Platform badge + aspect ratio indicator (1.91:1, 1:1, 3:4, 2.35:1, 16:9)
  - Image preview cropped to platform aspect ratio
  - Copy text + hashtags (editable inline)
  - Status badge (draft/approved/posted/skipped)
- [x] Per-platform inline editing: textarea + hashtags → posters.updateCopy mutation
- [x] 動作列: Edit / Copy to clipboard / Download image blob
- [x] Generate ≠ publish 鎖: Lock banner "此頁僅準備素材，不會自動發布"
- [x] 🔒 Approve All gated confirm (same pattern as M3)
- [x] Wired into PosterDetailSheet via "Distribute" button (Share2 icon)
- [x] i18n (9 new keys zh-TW + en) · tsc 0 errors
- [ ] Price validation (deferred: needs tour price lookup integration)
- [ ] Vitest(待補)

## DoD Checklist
- [ ] tsc --noEmit 0 errors
- [ ] Vitest all green(maintain 1600+ baseline)
- [ ] i18n audit:all new keys in zh-TW + en
- [ ] 所有碰發布 mutation 有 🔒 gated confirm
- [ ] Cost transparency:每次 AI 生成顯示費用
- [ ] Mobile responsive(360/390/430px)
- [ ] Jeff visual approval
