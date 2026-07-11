# 全案殭屍掃描：建了但沒在用的東西（2026-07-11）

> 唯讀體檢。方法：import-token grep + git log + 讀關鍵接線檔（worker.ts、_core/index.ts、routers.ts、App.tsx、featureFlags.ts、schema.ts）。
> 機器剛從負載卡死恢復，全程沒跑 tsc / vitest / pnpm，只用輕操作。
> 偵測法是啟發式（掃 basename 當 import 路徑 token），對動態字串 import 與 registry-by-name 載入有盲點；下表每一條都已用全樹 grep 直接複核（0 引用或只剩註解/自引用），信心標在風險欄。
> 「最後動過時間」欄：per-file `git log` 在這台恢復中的機器上慢到逾時，改用檔案 mtime 當代理，會略新於真正的實質改動。兩個 worker 有拿到真 commit 日期。

---

## 摘要（先看這段）

- 兩個 worker 純殭屍：`marketingWorker.ts`、`competitorMonitorWorker.ts` 全 repo 無人排程、無人 import。
- 六個 server 模組零引用：上述兩 worker + `imagePromptAgent`、`imageGenerationAgent`、`hotelImageService`、`skills/refundReceiptTemplate`。合計 1,314 行。
- 後台三代並存是最大宗殭屍：舊 `components/admin/`（28-tab 時代，107 檔 36,110 行）已全數不掛載，只剩 `customers/` 子樹（8,249 行）被 `/ops` 沿用；44 個頂層孤兒檔共 17,756 行，連帶其子元件子樹更多。
- `/ops` 六域頁面有四個是 15 行 placeholder（Tours / Marketing / Settings，加上被 FinanceCockpit 取代而閒置的 AdminFinance 頁），所以舊 tab 是那些功能目前唯一的實作，刪之前要 Jeff 裁。
- 一張孤兒資料表 `posterGenLogs`（v0，已被 `posterIterations` v1 取代，程式碼只剩一句註解提到它）。
- 兩個 flag 讓一整個子系統目前永不觸發但屬刻意停放：trust-deferral與 storefront-split（`STOREFRONT_MODE` 未啟）。這是「留著有理由」但要付維護稅。【指揮校正:PLAID_TRUST_DEFERRAL_ENABLED 在 prod 是 Fly secret=true(ON),信託子系統在 prod 活躍且 v808 起認列加回生效(見 finance-dept/v808-walkthrough-20260710.md);掃描以 code 預設值誤判,此組非殭屍,僅 STRIPE 側停放等 CPA。】

---

## 第一節：可安全刪（高信心死碼，無潛在參考價值）

| 項目 | 證據 | 最後動過 | 建議處置 | 風險 |
|------|------|----------|----------|------|
| `server/marketingWorker.ts` | 全 server 無 import/排程；`_core/index.ts` 沒它、`worker.ts` 沒它。它 export 的 `sendNewsletter`/`generateSocialCopy` 另有活路徑（`routers/marketing.ts` 動態 import 同名 service）。檔案自身無 self-schedule（無 repeat/cron/Queue()）。 | 2026-07-08（commit eb6761b，只是 errorFunnel 全域掃到，非針對性改） | 刪。自動化電子報/社群 cadence 早已停，此檔是殘骸。 | 低。刪前確認 Jeff 沒打算恢復排程電子報。 |
| `server/competitorMonitorWorker.ts` | 全 server 無 import/排程（competitor 功能的 tRPC `competitorRouter` 仍掛載，但這支自動爬蟲 worker 沒被任何地方啟動）。 | 2026-07-08（commit 762fa2e，fail-open 全域掃到） | 刪 worker。注意：competitor 功能不是全死，只是自動監控 cron 不跑（見第二節競品叢集）。 | 低。刪 worker 不影響 router；但 competitor 表會因此永遠不更新。 |
| `server/agents/imagePromptAgent.ts` | 全樹零 import。唯一出現處是 `reportGenerator.ts` 的一個 boolean 欄位名 `data.phase2.imagePromptAgent`（同名巧合，非 import）。 | 2026-04-08 | 刪。行程圖生成已改走 Unsplash fallback（見 `_pipeline/fanout.ts` 註解）。 | 低。 |
| `server/agents/imageGenerationAgent.ts` | 全樹零 import。只剩 `reportGenerator.ts` 欄位名 + `fanout.ts` 一句註解「imageGenerationAgent already falls back to Unsplash」。 | 2026-04-22 | 刪。同上，已被 Unsplash 取代。 | 低。 |
| `server/services/hotelImageService.ts` | 生產碼零 import；export `searchHotelImage`/`supplementHotelImages` 無人呼叫（只有一個測試檔提到 hotel image 字樣，疑似巧合）。 | 2026-04-08 | 刪。飯店圖現由 `itineraryImageService`/`imageIntelligenceService` 一路處理。 | 低-中。刪前 grep 確認沒有動態字串 import。 |
| `server/services/skills/refundReceiptTemplate.ts` | 全樹零引用（連註解都沒有）。姊妹檔 `depositTemplate`/`quoteTemplate` 由 `toolsRouter.ts` 使用，唯獨這支沒人用。 | 2026-06-18 | 刪。退款收據走 `packgo-deposit-receipt` skill（三態文件含付款收據）。 | 低。 |
| `client/src/components/admin/AiOffice.tsx` + `AiTeamRoster.tsx` | 零 import。`AiHubTab.tsx:11` 白紙黑字：「AiOffice.tsx + AiTeamRoster.tsx remain on disk but no longer mount」。程式碼自己承認的死碼。 | 2026-04-25 | 刪。 | 低。 |
| `client/src/components/AIChatBox.tsx` | 零 import（只剩 `ChatsTab.tsx` 一句註解提到）。 | 2026-06-27 | 刪。 | 低。 |
| `client/src/components/Map.tsx`、`DashboardLayout.tsx`、`DepartureAutocomplete.tsx` | 三個頂層元件皆零 import。 | 2026-04-25 | 刪。 | 低。 |
| `client/src/pages/preview/AIAdvisorMockup.tsx` + `ToursTabMockup.tsx` | `/preview/*` 兩條 route 掛在 App.tsx 但無任何選單/連結指向（只能手打 URL）。是開發期 mockup 殘留。 | 2026-05-01 | 刪 2 檔 + App.tsx 對應 2 條 route + 2 個 lazy import（第 68、215-216 行附近）。 | 低。 |

小計（本節可刪）：server 六檔 1,314 行 + 上列 client 檔數千行。

---

## 第二節：要 Jeff 裁（死著，但可能有潛在價值或牽動業務決策）

### 2A. 後台舊 tab 大叢集（三代並存的核心問題）

| 項目 | 證據 | 最後動過 | 建議處置 | 風險 |
|------|------|----------|----------|------|
| `components/admin/` 舊 tab 群（26+ 頂層孤兒：ToursTab、SuppliersTab、BookingsTab、AiQuotesTab、MarketingTab、MarketingContentTab、WechatAssistTab、CompetitorMonitorTab、AnalyticsTab、UnifiedInbox、ReviewsTab、AiHubTab、SkillsTab、LlmCostTab、ChatsTab、AffiliateTab、AutonomousAgentsTab、CalibrationReviewTab、PackpointTab、VisaManagementTab、VouchersTab、OfficeInboxTab、PostersTab、AuditLogTab、agents/MarketingAgentDemo、tools/QuoteToolTab、landings/* 三檔…） | 全數零 import、不掛載。`/admin` 與 `/admin/v2` 都 redirect 到 `/workspace`；`/workspace`（129 行）只 import `AgentChatPage` + `WorkspaceSidebar`，跳進 `/ops/*`。這些 tab 沒有任何 routed 元件 import。26 個頂層 tab 就 13,291 行；44 個頂層 client 孤兒共 17,756 行；且每個死 tab 還拖著自己的子元件子樹（如 ToursTab → tours/ToursTabHeader/Row/Card/Dialog…）一起死，實際更多。 | 多為 2026-05 | 要 Jeff 裁：整批刪，還是留作 `/ops` 重建的參考實作。關鍵：`/ops/tours`、`/ops/marketing`、`/ops/settings` 目前是 15 行 placeholder，這些舊 tab 是那些功能「目前唯一的實作」。若打算把功能搬進 /ops，先搬再刪；若打算 /ops 全新重寫，可直接刪。 | 中。誤刪會失去唯一實作。建議：Jeff 先確認 /ops 重建策略，再一次性清理。 |
| `client/src/components/admin-v2/CommandCenter/CommandCenterTab.tsx` | 零 import（只剩 `ApprovalInbox.tsx` 一句註解提到 parent）。但 server 端 `commandCenterRouter` 是活的（`registerMarketingExecutors()` 在 boot 時註冊、`produceMarketingDraftTask` 被 `commandCenter.ts` 動態 import）。所以後端指揮中心活著，前端 CommandCenterTab 沒掛。 | 2026-05-31 | 要 Jeff 裁：approval-inbox 的 UI 是搬去別處了，還是 CommandCenter 前端被放棄？後端活著代表這功能還在，UI 不見了。 | 中。牽涉 approval 流程是否還有人審。 |

### 2B. 競品監控半死叢集（dimension 2 + 3）

| 項目 | 證據 | 建議處置 | 風險 |
|------|------|----------|------|
| competitor 功能整組 | `competitorRouter` 有掛載（可查詢）；但 `competitorMonitorWorker` 沒排程（自動爬蟲不跑），client `CompetitorMonitorTab` 零 import（UI 不掛）。資料表 `competitorTours`/`competitorDepartures`（9 refs）/`competitorPriceHistory`（8 refs）/`competitorAlerts` 因 worker 不跑會逐漸過期。 | 要 Jeff 裁：要嘛重新排程 worker + 掛回 UI 讓功能復活，要嘛整組退役（worker + service + 4 張表 + router + tab）。目前是「有骨架、沒心跳」的中間態。 | 中。表有歷史資料，退役要決定保不保。 |

### 2C. 孤兒資料表

| 項目 | 證據 | 建議處置 | 風險 |
|------|------|----------|------|
| `posterGenLogs` 表 | schema 有定義，但 server+shared 全樹只出現 1 次，且是 `routers/posterGen.ts:261` 的一句註解「combines v0 posterGenLogs + v1 posterIterations」。已被 v1 `posterIterations` 取代，程式碼不再讀寫這個 drizzle binding。 | 要 Jeff 裁：確認無 raw SQL 存取後，開 migration drop 表（或保留歷史資料只移除 schema binding）。 | 中。drop 表要先確認資料保留政策。 |
| `learningAnalytics` 表 | server+shared 只出現 1 次（`learningAnalyticsService.ts` 的 import）。疑似 write-mostly 或近乎不讀。 | 要 Jeff 裁：查證是否還有真正讀取。標「不確定」。 | 低-中，不確定。 |

### 2D. Trust-deferral 子系統（gated 永不觸發，屬業務決策）

| 項目 | 證據 | 建議處置 | 風險 |
|------|------|----------|------|
| trust-deferral 整組（`trustDeferralService`、`trustRecognitionWorker`、`trustInvariantWatchdog`、`trustTransferDetection`、`trustOutstandingSplit`、`trustDeferredIncome` 表、多支 *.test.ts） | `featureFlags.ts` 的 `PLAID_TRUST_DEFERRAL_ENABLED` 與 `STRIPE_TRUST_DEFERRAL_ENABLED` 都預設 off。`trustRecognitionWorker` 有排程（`_core/index.ts`），但兩 flag 皆 off 時開頭就 skip 全部工作。整個子系統在現行 prod 設定下永不觸發，等 CPA/法律對 CST §17550 表態。 | 要 Jeff 裁（其實偏「留著有理由」）：確認 trust-deferral 還在 roadmap 上。若確定不上，這是可觀的可回收面積（含一整套跑 CI 的測試）。 | 這是財務紅線相關子系統，不可貿然刪；只標「已知停放、確認去留」。 |

---

## 第三節：留著有理由（刻意停放，不是意外死碼）

| 項目 | 為何留 | 備註 |
|------|--------|------|
| `TOUR_INSTANT_CHECKOUT_ENABLED` flag + 其擋下的即時結帳路徑 | 2026-07-10 Jeff 裁決的臨時停止線，fail-closed 擋 tour 即時請款。`featureFlags.ts:133-149` 有完整註解含退場計畫（checkout-verify 批上線後改條件擋、旗標退役）。 | 現行 prod 走「擋」分支，即時結帳碼暫時不可達，但這是刻意。退場條件明確。 |
| `STOREFRONT_MODE` flag + storefront-split 腳手架 | `featureFlags.ts:151-175`：Phase 0 只加閘門、不部署任何東西。是未上線功能的鋪路，有 `docs/features/storefront-split/plan.md`。 | 目前未啟，gated 行為（no-worker storefront role）永不生效，屬 scaffolding。 |
| trust-deferral 的 5 個調參旋鈕（offset / confidence / amount window / date window / early recognition window days） | master flag off 時全數 inert，但屬 deferral 子系統的一部分，且 `featureFlags.ts` 集中管理正是為了防拼字錯誤關掉安全閘。 | 跟 2D 一起去留。註解還誠實揭露修過一個 falsy-zero bug。 |
| `client/src/pages/AdminFinance.tsx` | App.tsx:28 白紙黑字：「F3 財務駕駛艙(2026-07-09)取代舊 AdminFinance placeholder。舊檔保留不刪。」`/ops/finance` route 實際用 `admin-v2/FinanceCockpit`，此頁不被 route。 | Jeff 已裁決保留。功能上死（不 routed），但屬已決定的保留。 |
| `trustRecognitionWorker` 等「flag off 就 no-op」的已排程 worker | 有排程但條件守門，設計如此。 | 不是 never-fire 的意外，是刻意的 kill-switch 行為。 |

---

## 其他觀察（非殭屍但值得記一筆）

- `agents-testing/`（repo 根目錄）：`git ls-files` 顯示 0 檔被追蹤，是本機未納管的實驗/暫存目錄（DEPLOYMENT-GUIDE.md、PROJECT-PLAN.md、staged/、customized/…）。不算 codebase 殭屍，是桌面本機雜物，可自行清。
- `server/lionTravelApiService.test.ts`（根目錄）搭配 `server/services/lionTravelApiService.ts`（實作）：不是雙實作，只是實作搬到 services/ 後測試檔留在根目錄。無害，順手可移位。
- 重複實作總體：後台三代（`components/admin/` 28-tab 世代、`components/admin-v2/`、`/ops/*` stub 世代）是主要的「同一件事多套並存」。不是 util 重複，是整層 UI 的世代疊加，根因在 /ops 遷移只做了一半。

---

## 結尾：殭屍佔比與維護稅

基準（非測試碼）：server 147,980 行 + client 121,370 行 ≈ 269,350 行。

- 高信心可刪（頂層）：client 44 檔 17,756 行 + server 6 檔 1,314 行 ≈ 19,070 行，約佔 7%。
- 含連帶死子樹（舊 admin 目錄 36,110 行中，只有 customers 子樹 8,249 行 + AgentChatPage 確認活著，其餘大半是死 tab 的子樹）：實際死碼估計拉到 24,000 至 27,000 行，約佔 9 至 10%。
- 另有可比擬的一塊「刻意停放」碼（trust-deferral 子系統 + storefront-split 腳手架 + 停止線），數千行、且 trust-deferral 帶著一整套每次 CI 都跑的測試，是持有成本但不該刪。

維護稅具體長相：
- 每個死 tab 仍要通過 tsc、仍被大規模重構掃到。實證：兩個純殭屍 worker 的「最後動過」都是 2026-07-08 的全域 observability 硬化 sweep，代表死碼實打實吃掉了 sweep 的改動與 review 力氣。
- grep/搜尋噪音：一次 `ToursTab` 全樹搜出 50 筆，絕大多數是死碼與其同名子檔，拉高每次定位成本。
- 認知稅最貴：三代後台並存（哪個 admin 才是真的？），加上 `/ops` 四個域是 15 行 placeholder 而舊 tab 才是唯一實作，讓「這功能到底在哪」變成每次都要重新考古。

不誇大的結論：這個 codebase 約 7% 是可以今天就安全刪的死碼，含連帶子樹逼近 10%；真正的痛點不是零散孤兒檔，而是「後台遷移做一半」造成的整層 UI 疊加。最高槓桿的動作是請 Jeff 拍板 /ops 重建策略（搬舊 tab 還是全新重寫），一次性清掉 admin 舊世代，其餘零散孤兒檔可隨手刪。
