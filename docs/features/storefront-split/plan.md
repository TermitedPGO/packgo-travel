# 同庫分艙拆分藍圖：客人 storefront 獨立部署

> 規劃偵察產物（唯讀偵察，不動碼）。作者：Fable 派工的偵察員，2026-07-10。
> 拍板前提（Jeff）：程式庫不拆。客人網站（packgoplay.com 公開面）獨立部署成第二個 Fly app，只給唯讀 DB 權限；後台（/ops + 全部 API + workers）留現 app。
> 本檔只做藍圖與決策樹，不含任何 code 變更。實作要另開 proposal/design/tasks/progress 四件套。

---

## 0. 一句話結論

同庫分艙可行，但「客人站唯讀 DB」不能一步到位：客人下訂、註冊、詢價、留言、訂閱這些公開頁動作本身就是寫 DB（其中 `bookings.create` 與 `aiQuotes.generate` 還會 enqueue BullMQ job）。務實路線是分階段：先讓客人站用「同一份 image + STOREFRONT_MODE 環境旗標」獨立部署活起來（不起 workers、不起 cron），DB 先維持可寫；再收緊成唯讀，把寫入動作代理回 ops app。強行 day-1 唯讀等於要先把寫入代理層做完，風險集中。

---

## 1. 現況解剖：單一進程掛了什麼

進入點 `server/_core/index.ts`（2481 行，`startServer()` 一次掛完）。實際 boot 起來的東西，依掛載順序：

### 1.1 中介層與安全
- `compression()`、`correlationIdMiddleware`、`pinoHttp`（access log，`/healthz` 靜音）
- 正規網域 308 轉址：`www.packgoplay.com` / `packgo-travel.fly.dev` → `https://packgoplay.com`（例外放行 `/healthz`、`/api/*`、`/sitemap.xml`、`/robots.txt`）— index.ts:115
- CORS 白名單（`server/_core/corsOrigins.ts`，靜態清單無萬用字元）
- 安全標頭 + CSP（允許 Stripe / GTM / Google OAuth / S3 / 地圖 tile）
- `/healthz`（淺，Fly 探針）、`/health`（深，探 DB+Redis+Stripe+LLM，UptimeRobot）

### 1.2 外部回呼（raw body，掛在 express.json 之前）
- `POST /api/stripe/webhook` → `server/_core/stripeWebhook.ts`
- `POST /api/plaid/webhook` → `server/_core/plaidWebhook.ts`
- `POST /api/gmail/push` → `server/_core/gmailPushWebhook.ts`（Cloud Pub/Sub）

### 1.3 認證與上傳
- `initializeGoogleAuth(app)`：客人登入 OAuth（start `GET /api/auth/google`，callback `GET /api/auth/google/callback`）
- `initializeGmailOAuth(app)`：後台 email pipeline OAuth（start `GET /api/admin/connect-gmail`，callback `GET /api/gmail/oauth/callback`）— 純後台
- `/api/upload-chat-image`（admin only）
- `/api/agent/ask-ops-stream`（admin OpsAgent SSE，Opus）— 純後台
- upload routers：`avatarUploadRouter`、`tourImageUploadRouter`、`generalImageUploadRouter`、`pdfUploadRouter`（都掛 `/api`）

### 1.4 內部 / script-token 端點（全部後台，Bearer token）
`/api/internal/test-generate`、`/bulk-import-lion`、`/test-status/:jobId`（INTERNAL_TEST_TOKEN）；`/api/admin/import-case-file`、`deploy-smoke`、`import-case-documents`、`harvest-case-lessons`、`backfill-bank-transaction-links`、`backfill-stripe-payout-declassify`、`cleanup-sandbox-residue`、`trust-transfer-detect`、`catalog-rebuild`、`import-case-conversations`、`backfill-interaction-orders`、`backfill-guest-classification`、`guest-noise-hygiene-report`、`imessage-check-known-phones`、`imessage-ingest`（LOCAL_SCRIPT_TOKEN）。這些都不該出現在客人站。

### 1.5 SSE / 動態內容
- `progressRouter`、`aiChatStreamRouter`（掛 `/api`，SSE）
- `/sitemap.xml`（公開，讀全部 tour）
- `/api/aiQuotes/:id/view`（公開，看報價 HTML）、`/api/invoices/:id/view`（需登入）

### 1.6 tRPC 與前端
- `/api/trpc` 掛「整個」`appRouter`（`server/routers.ts` composition shell）
- `prerenderMiddleware`（bot UA 才動）：`server/_core/prerender.ts` 用共享 headless Chromium `page.goto('http://127.0.0.1:PORT' + path)` 自渲染 SPA，讀寫 Redis 快取 24h。這就是 CORS 要放行 loopback origin 的原因。prerender 完全自足（自己 serve SPA、自己 Chromium 渲染），Redis 快取壞了只是不快取，不會 500。
- production 走 `serveStatic(app)`（`server/_core/vite.ts`）：serve `dist/public`，catch-all SPA fallback（跳過 `/api/*`），已知路由回 200、未知回 404（`server/_core/knownRoutes.ts`）
- `setupExpressErrorHandler(app)`（Sentry，最後）

### 1.7 背景工（cron + workers）— 客人站要全部關掉
- 檔頭 `import "../worker"`（index.ts:42，靜態 top-level）：一 import 就 `new Worker(...)` 起 `tour-generation`、`tour-translation` 兩個 consumer，並 re-export/init 起 `tour-monitor`、`quote-followup`、`abandonment-recovery` 共五個 consumer，且連帶執行 `server/queue.ts`（~24 個 Queue producer 於 module load 建構）。
- `startServer()` 尾段（index.ts ~2087–2404）另外 `await import` 起約 20 個 worker + 對應 `scheduleXxx()`（塞 repeatable job 進 Redis）：tripReminder、retrospective、customerSummary、customerBackfill、draftEval、followupScan、duplicateProfileScan、weeklyCorrectnessAudit、weeklyCanary、caseLearning、gmailPoll、gmailPush、bookingFollowup、plaidSync、trustRecognition、scalingGuardrail、supplierDetailEnrichment、priorityRewriteCron、packpointMaintenance、posterProcessing、supplierSync，還有 zombie-cleanup / dailyTourMonitor setInterval。
- 目前沒有任何 env 旗標擋這些，每次 boot 全跑。

### 1.8 客人面「真正需要的最小集」（從公開頁 tRPC 呼叫反查）

前端是「單一 SPA」（`client/src/App.tsx`），公開頁與後台頁同一個 bundle，後台頁（/ops、/workspace、/admin）是 `lazy(() => import())` 分包。SPA 用 `httpBatchLink({ url: "/api/trpc", credentials: "include" })` 打「同源」（`client/src/main.tsx:88`）。

公開頁實際呼叫到的 tRPC procedure（去重，來源 client 非 admin 檔）：

- auth：`me`(q)、`login`、`register`、`logout`、`requestPasswordReset`、`resetPassword`、`updateProfile`、`uploadAvatar`、`deleteAvatar`
- tours（read）：`list`、`search`、`searchCards`、`getFilterOptions`、`getById`、`getSimilar`、`getRouteMap`、`getSupplierDetail`
- departures：`list`、`listByTour`、`getNextBatch`
- bookings：`create`、`saveParticipants`、`getById`、`createCheckoutSession`、`cancel`、`list`
- reviews：`listVerified`、`createPublic`、`myReviews`、`create`
- favorites：`getIds`、`toggle`、`list`、`remove`
- inquiries：`create`、`createEmergency`
- visa：`calculatePricing`、`submitApplication`、`getApplicationStatus`
- membership：`getStatus`、`createCheckoutSession`、`createPortalSession`
- packpoint：`getStatus`、`getHistory`、`getReferralStatus`、`claimReferral`
- vouchers：`catalog`、`myVouchers`、`redeem`
- newsletter：`subscribe`
- affiliate：`trackClick`、`getPriceComparison`
- aiQuotes：`generate`
- ai：`getQuota`、`recordFeedback`（`ai.chat` 元件未掛載，實質死碼，先不算）
- photos：`myPhotos`、`upload`、`delete`
- translation：`getTourTranslations`、`getBatchTourTranslations`、`translate`、`translateBatch`
- exchangeRate：`getRates`（全域 LocaleContext，每頁都載）
- homepage：`getDestinations`（首頁格子；同檔的 update/create/delete 是 admin）
- browsingHistory：`record`（登入客人）

注意（重要陷阱，見 §2.3）：客人「客製行程」只打 `inquiries.create` + `aiQuotes.generate`，公開面「沒有」`customerOrders.create`（`db.createCustomOrder` 只被 `adminCustomerOrders.ts` 呼叫）。另有三處「後台編輯模式」寄生在公開檔裡（`EditableDestinations.tsx` 的 homepage.update*、`EditableImage.tsx` 的 imageLibrary.add、`TourDetailPeony/useTourEditMode.ts` 的 tours.update/generatePdf），這些是 adminProcedure，本來就會被擋，但要留意它們在公開頁檔案裡。

---

## 2. 拆法建議：env 模式旗標 vs 獨立 entry

### 2.1 推薦：同一份 image + `STOREFRONT_MODE` 環境旗標

同一個 Dockerfile、同一份 build（`vite build` 產 `dist/public` + esbuild 產 `dist/index.js`），兩個 Fly app 跑同一 image，靠環境變數決定角色。理由：一人公司，維持單一 build 與單一部署管線最省心；獨立 entry 檔會分岔 build，長期兩份 code 漂移。

storefront app（`STOREFRONT_MODE=1`）要做到：
- 不起 workers、不起 cron（§1.7 全部關）
- serve 靜態 SPA + bot-prerender
- 掛客人需要的 tRPC 面（見 §2.2 的兩條路）
- 不掛後台專屬 Express 端點（ask-ops-stream、/api/internal/*、/api/admin/*、connect-gmail、gmail webhook/push）

ops app（旗標不設）：維持現狀，掛全部。

### 2.2 陷阱一：routers 無法「只掛公開的」

這是本案最反直覺的一點。`appRouter` 的組法讓「file 級」或「key 級」挑選都行不通：
- 13 個 router 檔在「同一檔」裡混了 public + admin（例：`inquiries.ts` 2 public / 3 protected / 4 admin；`homepage.ts` 3 public / 6 admin；`translation.ts` 6 public / 4 admin；`visa.ts`、`affiliate.ts`、`reviews.ts`、`packpoint.ts`、`vouchers.ts`、`departures.ts`、`newsletter.ts`、`aiQuotes.ts`、`toursRouteMap.ts`、`systemRouter.ts` 同理）。
- 組合 key 更糟：`tours` key 把純公開的 `toursRead.ts`（11 public）跟 `toursRouteMap.ts`（1/1）跟 `toursAdmin.ts`（0 public / 1 protected / 26 admin）併在同一 key；`bookings` key 併 `bookings.ts` 與 `bookingsPayment.ts`（都是 protected + admin）。
- 30 個 router 是「純 admin」（commandCenter、plaid、suppliers、accounting、agent 及其 11 個子檔、customerOrders、marketing、competitor 等），這些安全排除。

結論：想要「storefront 只掛公開 procedure」不能靠選檔，要嘛（i）storefront 直接掛「整個 appRouter」靠 adminProcedure 自我保護（admin 呼叫沒 admin cookie 就 FORBIDDEN），要嘛（iii）把 13 個混檔 + tours/bookings 組法重構成乾淨的 public/admin 兩半。

三條路對比：

| 路線 | 做法 | 好處 | 代價 / 風險 |
|------|------|------|-------------|
| (i) 掛整個 appRouter，靠 adminProcedure 自保 | storefront 也 import appRouter，admin proc 自己擋 | 零 router 重構，最快活起來 | 客人站 code 面 / 攻擊面 = 全部（含 plaid/accounting/agent 的 import）；寫入 proc 打唯讀 DB 會炸（見 §3）|
| (ii) 反向代理 /api 到 ops | storefront 只 serve 靜態 + prerender，`/api/*` 全 proxy 給 ops | 零重構，API 單一真相源；storefront 甚至可不連 DB | 客人每次讀都還是打 ops，沒達到「讀流量卸到唯讀 DB」的目的 |
| (iii) 重構 routers 成 public/admin 兩半 | 拆 13 混檔、重組 tours/bookings key，storefront 掛 curated 公開 appRouter | 最乾淨，真正達成唯讀讀取 | 動 ~13 檔 + composition，工程量大、迴歸風險高 |

推薦：Phase 1 走 (i) 讓客人站最快獨立活起來（DB 先可寫），Phase 3 再朝「(i) + 寫入代理到 ops」收斂（見 §3 推薦）。(iii) 純重構列為可選長期優化，不擋交付。

### 2.3 陷阱二：worker / queue 的初始化位置

- `import "../worker"`（index.ts:42）是「靜態 top-level import」，一 import 就起 consumer。要 storefront 不起 worker，必須把它改成「動態 import 包在 `if (!STOREFRONT_MODE)` 內」。這是唯一需要動的既有掛載點。
- `startServer()` 尾段那 ~20 個 worker + cron 已經是「動態 `await import`」，整段用 `if (!STOREFRONT_MODE)` 包起來即可，不必逐一改。
- Queue producer（`new Queue`）在 `server/queue.ts` 是 module load 就建構，但 ioredis 是 `lazyConnect: true`（`server/redis.ts:50`），建構「不開 socket」，第一次 `.add()` 才連。所以「只建 producer 不 `.add`」不會連 Redis。
- 但公開端點每支都會 `checkRateLimit`（`server/rateLimit.ts` 用「一般」redis client，非 BullMQ）。所以 storefront「完全不碰 Redis」不可能，除非把 rate-limit 也搬走。storefront 仍需一條一般 Redis 連線（rate-limit + prerender 快取）。這條 Redis 可以跟 ops 共用同一台，也可各自一台。

### 2.4 陷阱三：SPA 是同一 bundle，含後台路由

`knownRoutes.ts` 白名單含 `/admin`、`/ops`、`/workspace`。若 storefront serve 同一份 SPA build，直接開 `packgoplay.com/ops` 會回 200 並載入 AdminShell（然後 admin tRPC 呼叫失敗或被擋）。處理：storefront 端把 `/ops`、`/admin`、`/workspace` 這幾段做 host 級轉址到 ops 域名（或 Phase 4 再從 storefront build 剝掉 admin 分包）。後台頁已 lazy 分包，主 bundle 不含 admin JS，只是靜態檔會一起被 serve。

### 2.5 獨立 entry 檔（替代方案，不推薦）

另開 `server/_core/storefront-entry.ts` 只掛客人面。好處是啟動圖乾淨、不 import 後台 code。壞處是要維護第二份掛載清單、build script 分岔、跟 index.ts 長期漂移。對一人公司維護成本不划算。用 env 旗標在「同一 entry」內分叉，比兩個 entry 好維護。

---

## 3. 資料庫唯讀身分（本案最大難點）

### 3.1 事實：客人下訂就是寫

DB 連線是單一 `getDb()`（`server/db.ts:81`）從 `process.env.DATABASE_URL` 建 mysql2 pool。換唯讀身分只要換這條 secret 指到 TiDB 唯讀帳號即可，技術上乾淨。難點不在連線，在「公開頁動作本身在寫」。

公開 / 客人寫入路徑（router.procedure → db 寫 → 表 → 是否 enqueue）：

| 流程 | procedure（可見性） | 寫入 | 表 | enqueue BullMQ？ |
|------|--------------------|------|----|------------------|
| 下訂 | `bookings.create`（protected） | createBooking + tryReserveDepartureSlots | bookings、tourDepartures | 是：bookingFollowup + abandonmentRecovery + seatExpiry（三個 job）|
| 存旅客 | `bookings.saveParticipants`（protected）| replaceBookingParticipants（護照加密） | bookingParticipants | 否 |
| 取消 | `bookings.cancel`（protected） | updateBooking + releaseDepartureSlots | bookings、tourDepartures | 否 |
| checkout | `bookings.createCheckoutSession`（protected）| 只讀 + Stripe session | 無（payment 由 webhook 寫）| 否 |
| 註冊 | `auth.register`（public） | createUserWithPassword | users | 否 |
| 登入 | `auth.login`（public） | lockUserAccount / 重置嘗試 | users（失敗鎖定 / 成功重置）| 否 |
| 密碼重置 | `auth.requestPasswordReset` / `resetPassword`（public）| 寫 token / 改密碼 | users | 否 |
| 詢價 / 聯絡 / 客製 | `inquiries.create`（public） | createInquiry + ensureCustomerProfile + recordWebsiteInteraction | inquiries、customerProfiles、customerInteractions | 否 |
| 緊急詢價 | `inquiries.createEmergency`（public）| 同上 + notifyOwner SMTP | inquiries、customerProfiles、customerInteractions | 否 |
| AI 報價 | `aiQuotes.generate`（public） | createAiQuote + updateAiQuote | aiQuotes | 是：quote-followup |
| 評論 | `reviews.create` / `createPublic`（protected）| insert tourReviews | tourReviews | 否 |
| 收藏 | `favorites.toggle` / `remove`（protected）| add/removeFavorite | favorites | 否 |
| 電子報 | `newsletter.subscribe`（public） | createNewsletterSubscriber | newsletterSubscribers | 否 |
| 瀏覽紀錄 | `browsingHistory.record`（protected）| recordBrowsingHistory | browsing-history | 否 |
| 會員 checkout | `membership.createCheckoutSession`（protected）| update users.stripeCustomerId | users | 否 |
| 簽證送件 | `visa.submitApplication`（public）| 寫 visaApplications（護照加密）| visaApplications | 待查（同 aiQuotes 模式可能有跟進）|
| affiliate 點擊 | `affiliate.trackClick`（public）| 寫點擊 | affiliate 表 | 否 |
| 翻譯 | `translation.translate/translateBatch`（public）| 寫翻譯快取 | 翻譯表 | 否 |
| Stripe webhook | `POST /api/stripe/webhook`（server）| payments/bookings/accounting/users/... | 多表 | 是：cancelAbandonmentRecovery |

瀏覽計數：確認「沒有」per-view 寫入（`toursRead.ts` / `db/tour.ts` 無 viewCount/increment）。唯一 per-view 寫入是登入客人的 `browsingHistory.record`。這點對唯讀有利。

裁決結論（Agent C 驗證）：純瀏覽面（tours read、homepage.getContent/getDestinations、reviews.listVerified、membership.getStatus、favorites/browsingHistory 的「讀」、exchangeRate、translation 的「讀」）可以唯讀 + 無 worker 跑。但只要 storefront 承接「客人動作」，就不可能唯讀。最硬的兩個 blocker 是 `bookings.create` 與 `aiQuotes.generate`（要可寫 DB「且」要 Redis queue producer），加上 Stripe webhook（寫多表 + queue）。

### 3.2 三個方案

- (a) 寫入全代理到 ops（推薦）。storefront 本身零 DB 寫。實作：因為 SPA 打「同源」`/api/trpc`，storefront 的 Express 對 `/api/trpc` 做分流 — 讀 procedure 本地用唯讀 DB 服務，寫 / auth procedure 反向代理到 ops（走 Fly 私網 / 內部 URL，轉發 cookie）。因為瀏覽器只看到 packgoplay.com 單一 origin，cookie 維持 host-only 就能用（不必搞跨子網域）。ops 端用 `verifyInternalAuth`（LOCAL_SCRIPT_TOKEN 那套已存在的 service-token 範式）+ 轉發的 JWT cookie 驗證客人身分（JWT 是自簽，ops 有 JWT_SECRET，跨 host 也能驗）。
  - 代價：httpBatchLink 會把「多支 procedure 併一個 HTTP 請求」，同一批可能混讀 + 寫，server 端 path 分流無法可靠拆批。解法：把 client 改成不批次（`httpLink` 取代 `httpBatchLink`，或設 `maxURLLength` 逼每支一請求），storefront 就能逐請求依 procedure 名分流。代價是請求數變多（可接受）。
  - 風險：多一層 proxy 的延遲與錯誤面；要維護「哪些 procedure 是寫」的 allowlist。
- (b) storefront 拿「限表」寫權限（只准 bookings / inquiries / customerProfiles / customerInteractions / users / newsletterSubscribers / tourReviews / aiQuotes / visaApplications 等白名單表）。最省基礎設施（不必寫代理層），但隔離最弱、違背「唯讀」精神，且 bookings.create / aiQuotes.generate 仍需 storefront 端有 queue producer + Redis。
- (c) 交易類動作 redirect 到 ops 域名。因 SPA 同源，實作彆扭（要前端判斷哪些動作跳走），客人體驗跳域，不推薦。

推薦：目標態 (a)。但 (a) 需要先把寫入代理層做完才敢開唯讀，所以分階段（見 §6）：先可寫、活起來，再收緊唯讀 + 上代理。

---

## 4. 網域與流量

### 4.1 域名拓樸（[裁決門 A]）
建議：`packgoplay.com` 指到 storefront app；後台移到 `ops.packgoplay.com`。理由：客人域名要在獨立 app 上（Jeff 拍板）。目前只有一個 app（`packgo-travel`，sjc，1 台機，版本 809）。

### 4.2 BASE_URL 被過度共用（先拆才安全）
`server/_core/env.ts`：`ENV.baseUrl = process.env.BASE_URL ?? "https://packgoplay.com"`。這一個 `BASE_URL` 同時驅動：CORS 白名單 append、Google 登入 callback、Gmail OAuth callback、bookings/membership 的 Stripe 回跳。不能為了一個目的重指而不動到其他三個。拆分前要先把它拆成獨立 env：
- 客人回跳用 `PUBLIC_BASE_URL`（= storefront host）
- OAuth callback 用既有 `GOOGLE_CALLBACK_URL` + 新增 Gmail callback env（都指 ops host）
- 簽證另有 `SITE_URL`（`server/routers/visa.ts`，fallback fly.dev）也要指到 storefront host，跟其他回跳一致

### 4.3 外部回呼清單（實際改在各後台按，這裡只列）

必須「留在 ops / backend」的回呼（server-to-server 或後台專屬）：

| 回呼 | 路徑 | 現在指哪 | 拆後 | 在哪改 |
|------|------|---------|------|--------|
| Stripe webhook | `/api/stripe/webhook` | Stripe dashboard 註冊的 URL | 指 ops host | Stripe 後台 |
| Plaid webhook | `/api/plaid/webhook` | env `PLAID_WEBHOOK_URL` | 指 ops host | Plaid 後台 + 改 env |
| Gmail push | `/api/gmail/push` | Cloud Pub/Sub push endpoint | 指 ops host | GCP Pub/Sub |
| Google 登入 callback | `/api/auth/google/callback` | `BASE_URL`/`GOOGLE_CALLBACK_URL` | 見 §4.5 決定放哪 | Google Console + env |
| Gmail OAuth callback | `/api/gmail/oauth/callback` | `BASE_URL` | 指 ops host | Google Console + env |
| Plaid Link 完成跳轉 | `${origin}/admin?plaid=done` | 跟 `PLAID_WEBHOOK_URL` 同 origin | 指 ops host（後台頁）| 改 env |

必須「落在 storefront」的回跳（都是客人頁）：
- `bookings`：`success_url=${baseUrl}/payment/success`、`cancel_url=${baseUrl}/booking/:id`（`bookingsPayment.ts`，用 ENV.baseUrl）
- `membership`：`${baseUrl}/membership`、billing portal `return_url`（用 ENV.baseUrl）
- `visa`：`${siteUrl}/china-visa/success`、`/china-visa`（用 SITE_URL，fallback fly.dev，口徑不一致，要一起校準）

### 4.4 CORS
`corsOrigins.ts` 是靜態白名單。若採 §3 的「同源反向代理」設計，瀏覽器只打 packgoplay.com，CORS 幾乎不受影響。若改採跨子網域（SPA 直接打 ops.packgoplay.com），要把 storefront origin 加進 `buildAllowedOrigins`，且 loopback prerender origin 仍要保留。新 app 的 `*.fly.dev` 過渡域名也要暫時加白名單，否則 fly.dev 上驗證階段 tRPC 會被 CORS 擋。

### 4.5 Session / cookie 跨域（[裁決門 B]）
cookie 名 `app_session_id`（`shared/const.ts`），`server/_core/cookies.ts`：httpOnly、path=/、sameSite=lax、secure（HTTPS 時）、「domain 未設 = host-only」。含意：
- 若走「同源反向代理」（推薦）：瀏覽器只認 packgoplay.com，cookie host-only 沒問題，登入 / session 全在同一 origin，最單純。ops 只在私網收 storefront 轉發的請求（帶 cookie），ops 用 JWT_SECRET 自驗。
- 若走「跨子網域」（SPA 直打 ops）：packgoplay.com 設的 cookie「不會」送到 ops.packgoplay.com。必須改成 `domain=.packgoplay.com`，且跨站 XHR 要 cookie 得 `sameSite=none; secure`。多個活動零件，容易出錯。
- 另注意：Google 登入 callback 會在「serve callback 的那個 host」設 cookie 並 `redirect('/')`。這個 host 必須是客人被認證的那個 host。決定 callback 放 storefront 還是 ops，取決於採同源代理還是跨子網域。

---

## 5. 部署紀律拆家

### 5.1 pnpm ship 兩 app 分開走
`pnpm ship` = `scripts/safe-deploy.mjs`，七道閘 + 6.5 SQL 排練 + `.deploy-approve`：
1. 分支 main
2. working tree 乾淨
3. 不落後 origin/main
4. 列本次 migration（可見性）
5. `tsc --noEmit` 0 錯
6. `vitest run`（`SKIP_DEPLOY_TESTS=1` 可略）
6.5 SQL 排練閘（`flyctl ssh` 進 prod TiDB EXPLAIN 唯讀 SQL）
7. `.deploy-approve` timingSafeEqual 比對 `DEPLOY_TOKEN`，用完即焚

`safe-deploy.mjs` 現在硬編碼 `APP=packgo-travel`、`HEALTH_URL=https://packgoplay.com/health`、`SMOKE_URL=https://packgoplay.com/api/admin/deploy-smoke`。拆後要參數化 APP + 對應 host：
- ops app（backend）ship：跑 migration（release_command）、跑全套七閘 + SQL 排練 + 後台煙霧臂，HEALTH/SMOKE 指 ops host
- storefront app ship：低頻。「不跑 migration」（唯讀無 schema 變更，`release_command` 留空）。SQL 排練閘可略（唯讀）。煙霧只跑客人面臂。

### 5.2 migration 只在 ops 跑
`fly.toml` 的 `release_command = "node scripts/migrate.mjs"`（用 `DATABASE_URL` + drizzle migrator）。storefront app 的 fly.toml「不設 release_command」，唯讀帳號也不該有 DDL 權限。schema 變更一律只在 ops app ship 時跑。

### 5.3 煙霧八臂分家
`server/_core/deploySmoke.ts` 目前 8 臂：`customerList`、`guestList`、`customerUnreadCount`、`todayList`、`watchdogForCustomer`、`commandCenter.approvalTasks`、`commandCenter.escalations`（7 臂後台）+ `activeToursCount`（1 臂客人面，`db.searchTours({}).total` 查 active tour；目前因 2026-06-17 tours-wipe 尚未復原，回 0 會紅旗）。分家：
- ops 煙霧 = 現 7 後台臂（維持）
- storefront 煙霧 = 新增客人面臂：打自己的公開讀 procedure（tours.search / getById、exchangeRate.getRates、departures.list）確認公開讀鏈活著。`activeToursCount` 這種耦合客人目錄的臂歸 storefront。
smoke 端點 `/api/admin/deploy-smoke` 是 LOCAL_SCRIPT_TOKEN Bearer。storefront 若不掛 /api/admin/*，要嘛 storefront 提供獨立的公開讀 smoke，要嘛 safe-deploy 對 storefront 只做 `/health` + 幾個公開 GET 探測。

---

## 6. 分階段實施計畫

每階段可獨立驗收、可回退。工程量為粗估（一人 + AI 執行）。

### Phase 0：加 STOREFRONT_MODE 閘（不改行為）
- 內容：把 `import "../worker"`（index.ts:42）改動態、包 `if (!STOREFRONT_MODE)`；`startServer()` cron/worker 整段包同一旗標；後台專屬 Express 端點（ask-ops-stream、/api/internal/*、/api/admin/*、connect-gmail、gmail push/webhook）也包旗標（storefront 不掛）。旗標預設 off，ops 行為零變化。
- 驗收：`tsc` 0 錯 + 相關測試綠；ops app 照常 ship，行為不變（旗標未設）。加一個 storefront-mode boot 的單元測試（boot 起來不 new 任何 Worker、不掛 admin 端點）。
- 回退：旗標拿掉即回原狀。工程量：中（1 個 feature 批次）。

### Phase 1：storefront app 獨立部署活起來（DB 先可寫）
- 內容：`fly apps create packgo-storefront`（同 region sjc）。同一 image。secrets：`STOREFRONT_MODE=1`、`DATABASE_URL`（先用「同一條可寫」，過渡）、`JWT_SECRET`（同 ops，才能共用 session/JWT）、`REDIS`（rate-limit + prerender 快取，可共用 ops 那台）、Stripe/Google 等公開頁需要的 key、`PUBLIC_BASE_URL`。tRPC 走 §2.2 路線 (i)：掛整個 appRouter（admin 自保）。不起 workers/cron。部署到 `packgo-storefront.fly.dev`，把它加進 CORS 白名單。
- 驗收：在 fly.dev host 上跑通客人全鏈（瀏覽、tours 詳情、登入註冊、下訂 checkout、詢價、電子報、prerender bot UA 回真 HTML）。確認 storefront 進程「沒有」任何 BullMQ Worker（log 無 worker consume）。客人正式域名「還在 ops」，不動 DNS。
- 回退：刪 app，不影響 ops。工程量：低到中（多在設定與驗證）。

### Phase 2：DNS 切換 + 回呼校準
- 內容：先把 `BASE_URL` 拆成 `PUBLIC_BASE_URL` / OAuth callback env / `SITE_URL` 校準（Phase 0 或此階段做）。`packgoplay.com` → storefront；`ops.packgoplay.com` → ops。Jeff 在 Stripe/Plaid/Google Console/Pub/Sub 逐一把回呼指到 ops host（§4.3 清單）。safe-deploy 的 HEALTH_URL/SMOKE_URL 參數化。
- 驗收：客人在 packgoplay.com 走完下訂 + Stripe 回跳 `/payment/success`；Stripe/Plaid/Gmail webhook 落 ops；Jeff 在 ops.packgoplay.com 登入後台正常；Google 登入客人正常。
- 回退：DNS 指回 ops（單一切換點，回退快）。工程量：低（多為設定 + 外部後台操作，Jeff 手動）。

### Phase 3：收緊唯讀 + 寫入代理（達成 Jeff 目標態）
- 內容：storefront `DATABASE_URL` 換「唯讀帳號」。實作 §3(a)：client 改不批次；storefront `/api/trpc` 分流，讀本地唯讀 DB、寫 / auth 反向代理到 ops 私網（`verifyInternalAuth` 範式 + 轉發 cookie）。bookings.create / aiQuotes.generate 的 enqueue 由 ops 端執行（因為寫已代理到 ops）。
- 驗收：storefront DB 帳號無寫權限下，客人下訂 / 註冊 / 詢價 / 訂閱仍成功（因走代理）；讀流量確認打在唯讀帳號；跑一輪紅路演練（唯讀帳號直接寫要被 DB 拒）。
- 回退：`DATABASE_URL` 換回可寫 + 關代理旗標，回到 Phase 2 態。工程量：高（寫入代理層是真 code，要 proposal/design/tasks/progress 四件套 + Vitest）。

### Phase 4（可選）：瘦身與觀測
- 從 storefront build 剝掉 admin 分包 / `/ops` 路由；storefront host 對 `/ops`、`/admin`、`/workspace` 做轉址到 ops.packgoplay.com；補 storefront 專屬煙霧臂與 canary；preview origin 白名單。工程量：中，非阻塞。

---

## 7. 風險清單與開放問題

### 7.1 需 Jeff 裁決（[裁決門]）
- [裁決門 A] 域名拓樸：`packgoplay.com`=storefront + `ops.packgoplay.com`=ops，確認？（本藍圖預設如此）
- [裁決門 B] 寫入處理與 session 模型：走「同源反向代理」（推薦，cookie 單純、瀏覽器只見一個 origin）還是「跨子網域 SPA 直打 ops」（要 `domain=.packgoplay.com` + sameSite=none）？兩者決定 OAuth callback 放哪、CORS 怎麼配。
- [裁決門 C] 唯讀時程：接受「Phase 1 先可寫、Phase 3 才唯讀」的分階段，還是堅持 day-1 唯讀（那要先把 Phase 3 寫入代理做完才敢上線，交付變慢、風險集中）？
- [裁決門 D] Redis：storefront 的一般 Redis（rate-limit + prerender 快取）跟 ops 共用同一台，還是各自一台？共用省成本、故障域相連；分開更隔離。
- [裁決門 E] tRPC 不批次的取捨：為了 server 端寫入分流，把 `httpBatchLink` 換 `httpLink`（請求數增加）可接受嗎？或改採 client `splitLink` 依 op.type（mutation→ops）路由（但要處理跨域 cookie）。

### 7.2 技術風險
- tours-wipe 未復原：目前 active tour = 0，`activeToursCount` 煙霧臂會紅、客人目錄是空的。拆分驗收前要先確認目錄資料狀態，否則 storefront「活著但沒貨」。
- secrets 重複面：兩 app 都要 `JWT_SECRET`（必須同值，否則 session 不通）、Stripe public key、Google client 等。secrets 由 Jeff 在 Fly 設，本藍圖不碰。`.env.example` 只列少數（Sentry/PostHog），真值全在 `fly secrets`。
- prerender 依賴 Chromium：storefront 也要 puppeteer + 系統 Chromium。現 Dockerfile runtime stage 已裝 chromium + noto-cjk 字型，同 image 直接有，無額外工。
- 反向代理錯誤面：Phase 3 代理層是新 code，要有測試與紅路演練，別讓「寫入靜默失敗」。沿用既有 `verifyInternalAuth` + `reportFunnelError` 漏斗。
- 混檔 admin proc 洩漏面：Phase 1 走「掛整個 appRouter」時，admin procedure 雖自保（FORBIDDEN），但 code 仍在客人站。可接受，但列為 Phase 4 瘦身目標。
- PII / repo 公開紅線：本 repo 曾因公開暴露客人 PII（2026-07-02 教訓）。新 app 的 fly config / 任何新文件不得含客人可識別資訊；沿用 private repo 規則。
- safe-deploy 目前單 app 假設：APP/HEALTH_URL/SMOKE_URL 硬編碼 packgoplay.com，兩 app 前必參數化，否則 storefront ship 後的健康探測打到錯的 app 給假綠。

### 7.3 明確不是問題的（已查證）
- 瀏覽無 per-view 寫入（除登入客人 browsingHistory），純瀏覽面天生唯讀友善。
- 客人「客製行程」不打 `customerOrders.create`（那是 admin），公開寫入面比想像小。
- Queue producer 建構不開 socket（lazyConnect），單純掛 producer 不 `.add` 不會連 Redis。
- 單一 build image 兩 app 共用，Dockerfile 不必分岔。

---

## 附錄：關鍵檔案索引（絕對路徑）
- 進入點 / 全部掛載：`/Users/jeff/Desktop/網站/server/_core/index.ts`
- worker 靜態 import（要改動態）：`server/_core/index.ts:42` → `server/worker.ts`
- cron/worker 尾段：`server/_core/index.ts` ~2087–2404
- tRPC 組合殼：`server/routers.ts`；procedure builders：`server/_core/trpc.ts`
- 混檔 router（public+admin 同檔）：`server/routers/{inquiries,homepage,translation,visa,affiliate,reviews,packpoint,vouchers,departures,newsletter,aiQuotes,toursRouteMap}.ts`、`server/_core/systemRouter.ts`
- 純公開 router：`server/routers/{toursRead,exchangeRate,ai}.ts`
- DB 連線：`server/db.ts:81`（getDb，單一 DATABASE_URL pool）
- 下訂寫入 + enqueue：`server/routers/bookings.ts`（create ~:70, enqueue ~:360/:423）、`server/db/booking.ts`
- 詢價寫入：`server/routers/inquiries.ts` + `server/_core/websiteIntake.ts`
- CORS：`server/_core/corsOrigins.ts`；baseUrl：`server/_core/env.ts:51`
- cookie：`shared/const.ts`（`app_session_id`）+ `server/_core/cookies.ts`
- Google 登入：`server/googleAuth.ts`；Gmail OAuth：`server/gmailOAuth.ts` + `server/_core/gmail.ts`
- webhook：`server/_core/{stripeWebhook,plaidWebhook,gmailPushWebhook}.ts`
- Stripe 回跳：`server/routers/bookingsPayment.ts`、`membership.ts`、`visa.ts`
- 靜態 serve / SPA fallback：`server/_core/vite.ts`；路由白名單：`server/_core/knownRoutes.ts`
- bot-prerender：`server/_core/prerenderMiddleware.ts` + `prerender.ts` + `puppeteerPool.ts`
- Redis 連線（lazyConnect）：`server/redis.ts`；rate-limit：`server/rateLimit.ts`
- 部署閘：`scripts/safe-deploy.mjs`；migration：`scripts/migrate.mjs`；煙霧：`server/_core/deploySmoke.ts`
- 前端 tRPC client（同源 + 批次）：`client/src/main.tsx:88`；路由表：`client/src/App.tsx`
- Fly 設定：`/Users/jeff/Desktop/網站/fly.toml`；image：`/Users/jeff/Desktop/網站/Dockerfile`
