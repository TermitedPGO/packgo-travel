# PACK&GO 財務域現況地圖

> 唯讀偵察報告。日期 2026-07-08。方法:10 個平行 Explore subagent 分區塊 grep+讀碼(customer_payment_channels / bank_accounts_trust_operating / trust_recognition_flow / payment_match_watchdog / customorders_invoices_schema / two_ledger_dedup / supplier_cost_payments / admin_finance_ui / worker_cron_infra / stripe_webhook_detail),共讀了 352 次工具呼叫、111 萬 token。全程唯讀,沒有連 prod DB,本地無 DATABASE_URL。
> 用途:finance 區塊工程的起點文件,先看清楚現在有什麼、錢和資料實際怎麼流,之後才規劃要做什麼。

## 分類標記說明

每筆結論後面標記三選一:

- **[F]** = 已查證的事實(verified_fact):親眼讀到程式碼實作,附精確 file:line
- **[I]** = 推論(inference):從命名、間接證據、多段程式碼串接得出,合理但非單一行明講
- **[V]** = 待 prod 查證(needs_prod_verification):程式碼看得到機制存在,但實際資料/環境變數值需要在 Fly/prod 查

---

## 一、錢的真實流(Money Flow)

### 1.1 客人付款通道總覽

| 通道 | 真實整合程度 | 觸發點 | 寫入表 |
|------|------------|--------|--------|
| Stripe(信用卡) | 唯一有完整 API+webhook+DB 寫入的通道 [F] | Checkout Session | payments / bookings / visaApplications / accountingEntries / users(訂閱) |
| Square(訂製單催款) | 純接口佔位,無真實 Payment Links API 整合 [F] | Jeff 手貼收款連結 + 手動記帳 | customOrders(depositPaidAt/balancePaidAt 等) |
| Zelle / 電匯 / 支票 | 客人直接匯進 Jeff 的 BofA 帳戶,網站完全不觸發 [F] | Plaid 同步 | bankTransactions(事後 AI 分類) |
| 現金 | 客服聊天機器人話術提及,但零程式路徑 [F][I] | 無 | 無(全靠 Jeff 事後手動走 accountingEntries) |
| PayPal / Venmo / Cash App | 從未整合過,只在 enum 選項殘影或 email 網域雜訊過濾清單出現 [F] | 無 | 無 |

**Stripe 詳細**:
- 團費:`trpc.bookings.createCheckoutSession`,`payment_method_types: ["card"]`,只收信用卡。[F] `server/routers/bookingsPayment.ts:184-201`
- 簽證代辦費:同樣走 Stripe Checkout,card only。[F] `server/routers/visa.ts:117,131`
- 會員訂閱(Plus/Concierge):Stripe Checkout `mode=subscription`,10 天試用(AB 390 合規)。[F] `server/routers/membership.ts:171-189`
- Webhook 掛載點:`app.post("/api/stripe/webhook", ...)`。[F] `server/_core/index.ts:242`
- `payments.paymentMethod` 是 enum('stripe','paypal','bank_transfer','cash','other'),但全 repo 唯一呼叫 `db.createPayment()` 的地方永遠寫死 'stripe' — 其餘三個 enum 值從未被實際寫入過。[F] `drizzle/schema.ts:799-825`,呼叫點 `server/_core/stripeWebhook.ts:258`

**Square 詳細**:
- `ManualPaymentProvider.createPaymentLink` 永遠回 null,註解寫明「日後接真 Square 時新增 SquarePaymentProvider」,`SQUARE_ACCESS_TOKEN`/`SQUARE_LOCATION_ID` 從未在任何檔案被讀取(全 repo grep 零命中)。[F] `server/_core/paymentProvider.ts:1-48`
- 催款流程(`customerOrders.sendCollection`):取 `getPaymentProvider().createPaymentLink()`(必為 null)→ 退回用 Jeff 手貼的連結 → 若都沒有直接擋下不准送信;客人在 Square 自家頁面刷卡,本站完全不知道結果。[F] `server/routers/adminCustomerOrders.ts:1055-1143`
- 記已收款是 100% 人工:Jeff 點「記已收」按鈕(`recordPayment`),寫 `customOrders.depositPaidAt/depositPaidAmount` 或 `balancePaidAt/balancePaidAmount`;**不建立 `payments` 資料列、不建立 `accountingEntries`**(schema 註解明講「本批不寫 accountingEntries」)。[F] `server/routers/adminCustomerOrders.ts:1146-1185`;`drizzle/schema.ts:2379-2464`
- 前端表單(`CustomOrderDetail.tsx`)沒有付款方式選單,`method` 無 UI 輸入口,未傳則伺服器端硬編碼預設回退 `'square'`。[F] `client/src/components/admin/customers/CustomOrderDetail.tsx:301-330`;[I] `server/routers/adminCustomerOrders.ts:1170`

**Zelle / 電匯 / 支票詳細**:
- 客人直接匯進 Jeff 的美國銀行帳戶(BofA),透過 Plaid 同步落地在 `bankTransactions`,事後由 AccountingAgent(LLM)分類是否為「客戶收入」。[F] `drizzle/schema.ts:3105-3159`(`paymentMeta` 欄位註解明講「Zelle / Bill Pay note that Jeff typed in BofA」)
- AccountingAgent 知識庫把 Stripe 撥款、客戶 ACH/Wire、Zelle、信用卡刷團費都列為 customer 收入類別,未知對方一律標 `other_review` 交人工判斷,不用猜。[F] `server/agents/autonomous/accountingKnowledge.ts:57-104,242-360`
- Admin 可手動把一筆銀行交易關聯到某筆 booking(`relatedBookingId`),純粹是記帳標籤,**不會**反過來更新 `bookings.paymentStatus`,也不會建立 `payments` 資料列。[F] `server/routers/plaidRouter.ts:965-1057`

### 1.2 Stripe Webhook 完整處理路徑

處理 8 種 event type,其餘落 default 只 log。[F] `server/_core/stripeWebhook.ts:73-145`

| Event | 動作 | 寫入 |
|-------|------|------|
| `checkout.session.completed`(訂單) | 單一 tx 原子寫入 | payments + bookings(paymentStatus/bookingStatus) + accountingEntries(income) |
| `checkout.session.completed`(簽證) | 單一 tx 原子寫入 | visaApplications + visaStatusHistory + accountingEntries(income) |
| `checkout.session.completed`(訂閱) | 單一 tx | users(tier/tierExpiresAt) + membershipTrials |
| `payment_intent.succeeded/failed` | 單一欄位更新 | payments.paymentStatus |
| `charge.refunded/refund.updated` | 只處理全額退款,原子條件式 UPDATE | payments + bookings(cancelled) + Packpoint 扣回 + RefundAgent triage(絕不自動送出) |
| `charge.dispute.*` | 僅通知,不寫帳 | 無 |
| `customer.subscription.*` | tier 狀態機 | users(tier reset) |

- 三個寫入(payments/bookings/accountingEntries)包在同一 `db.transaction`,原子性。[F] `server/_core/stripeWebhook.ts:257-296`
- Idempotency:`stripeWebhookEvents.eventId` UNIQUE 約束擋重放;`claimStripeEvent`/`markStripeEventSucceeded`/`markStripeEventFailed` 三段式狀態機。[F] `server/_core/stripeWebhookIdempotency.ts:54-108`;`drizzle/schema.ts:841-854`
- **⚠️ 邊界情境 [I]**:若處理中途 process 被殺(Fly 機器重啟),`stripeWebhookEvents` 會永久卡在 `status='processing'`。`claimStripeEvent` 對 UNIQUE 碰撞回傳的判斷不分辨 processing/succeeded/failed,三者都視為「已處理過」直接跳過重跑 —— Stripe 之後重試同一 `event.id` 永遠被當 idempotent skip,該筆付款可能永遠不會真的完成寫入。沒有找到任何自動清理/逾時重置機制。`server/_core/stripeWebhookIdempotency.ts:21-23,69-80`
- 整條 webhook 路徑**從未寫入 `invoices` 或 `bankTransactions` 表**。[F] `server/_core/stripeWebhook.ts:1-1521`(全文 grep 零命中)
- `customOrders` 表在這條 webhook 路徑中沒有任何直接寫入 —— 訂製單收款走完全不同的路(見 1.1 Square 段)。[F][待查] `server/_core/stripeWebhook.ts` 全文

### 1.3 Trust(#5442)/ Operating(#2174)帳戶標記機制

- **唯一的 Trust/Operating 判斷依據是 `linkedBankAccounts.isTrustAccount`(int, 0/1),人工透過 admin mutation `plaid.markTrustAccount` 手動勾選** —— 不是帳號後四碼、不是機構名稱自動比對。[F] `drizzle/schema.ts:3087`;`server/routers/plaidRouter.ts:313-337`
- `#5442`/`#2174` 這兩組數字**只出現在註解、文件、i18n 顯示字串、LLM prompt context**,程式邏輯裡完全沒有把這兩個具體帳號數字寫死當比對條件。[F] 全庫 grep 結果,見 `server/agents/autonomous/financeAdvisor.ts:26,33,95`
- `accountingEntries.account` 有獨立的 `enum('trust','operating')` 欄位,但這是給 email 收據入帳流程人工手動選的,**跟 Plaid 側 `isTrustAccount` 是兩套完全平行、互不同步的機制**,schema 註解自己承認這點。[F] `drizzle/schema.ts:2104-2110,2229-2230`
- `syncAllActiveLinkedAccounts()` 只依 `isActive=1` 篩選同步帳戶,**完全不看 `isTrustAccount`** —— Trust 和 Operating 用同一套同步邏輯,寫進同一張 `bankTransactions` 表,沒有分流。[F] `server/services/plaidSyncService.ts:294-351`
- Plaid 同步排程:`plaidDailySyncQueue`(BullMQ,queue name `plaid-daily-sync`),cron `"0 5 * * *"`(05:00 UTC),消費者 `plaidSyncWorker`,concurrency=1。[F] `server/queue.ts:1240-1292`;`server/plaidSyncWorker.ts:1-141`

### 1.4 Trust 遞延認列機制(CST §17550)

這是 CLAUDE.md 紅線 #3 對應的實際實作,叫 **Phase 4 trust deferral**:

1. **入場**:AccountingAgent 把某筆 Plaid 交易分類成 `income_booking`,且該帳戶 `isTrustAccount=1` → `processTrustInflow()` 在 `trustDeferredIncome` 表新增遞延收入紀錄。[F] `server/services/trustDeferralService.ts:255-320`
2. **配對**:`findBookingMatch()` 用金額差距+日期加成+Stripe PaymentIntent ID 出現算信心分數,門檻 `PLAID_TRUST_AUTOMATCH_MIN_CONFIDENCE`(預設 80)以上才自動配對訂單,低於門檻交 Jeff 手動 link。[F] `server/services/trustDeferralService.ts:159-239`
3. **認列時點**:`expectedRecognitionDate` = 出發日 + `PLAID_TRUST_RECOGNITION_OFFSET_DAYS`(預設 0,即出發當天);但若訂金前置期短(`daysToDeparture <= PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS`,預設 30 天)則改用收款當天,避免跨年度歸屬問題。[F] `server/services/trustDeferralService.ts:343-366`
4. **排程掃描**:`trustRecognitionQueue`(BullMQ),cron `"0 6 * * *"`(06:00 UTC,刻意排在 Plaid sync 之後 1 小時),消費者 `trustRecognitionWorker`,concurrency=1。掃描 `recognizedAt IS NULL AND reversedAt IS NULL AND expectedRecognitionDate<=today AND bookingId IS NOT NULL`,標記 `recognizedAt`。[F] `server/queue.ts:1321-1352`;`server/services/trustDeferralService.ts:459-497`
5. **認列動作本身只是一個 UPDATE**(`recognizedAt=NOW()`),不產生任何新的 accountingEntries/journal 記錄。真正對財報的效果是下游 `bankPLService` 讀取時,把 `recognizedAt IS NULL` 的金額從 net income 倒扣(deferred),一旦認列就不再倒扣。[F][I] `server/services/trustDeferralService.ts:488-494`;`server/services/bankPLService.ts:171-193,300-342`
6. **銀行實際轉帳不自動執行**:認列後只是 `notifyOwner()` 提醒 Jeff「今天該手動把 $X 從信託帳戶轉到 operating 帳戶」。系統只負責記帳認列與提醒,轉帳仍是人工。[F] `server/trustRecognitionWorker.ts:62-76`
7. **總開關**:`PLAID_TRUST_DEFERRAL_ENABLED`(環境變數,`server/_core/featureFlags.ts:20-31`)。**關閉時整套機制形同虛設** —— worker 仍會被排程觸發但直接回傳全 0 空結果,Trust 帳戶入帳照舊立即記為收入(舊行為)。**目前 prod 上這個 flag 實際值未知,本次唯讀無法確認,需要 `fly secrets list` 或問 Jeff。[V]**

**⚠️ 重大發現(整份報告最關鍵的一條)[F]**:
**Stripe webhook 收到的錢完全繞過整套 Trust 遞延認列機制。** `checkout.session.completed` 寫入 `accountingEntries` 時,`entryType` 一律是 `'income'`(不管 deposit/balance/full),而且**從未設定 `account`(trust/operating)欄位、也從未寫入 `trustDeferredIncome` 表**。也就是說:客人用信用卡刷團費訂金,系統當下就直接記為已認列的收入,不會等到出發日。這套遞延機制目前只對「Plaid 偵測到打進 Trust 銀行帳戶的存款」生效,對 Stripe 收單完全沒有涵蓋。[F] `server/_core/stripeWebhook.ts:282-296,1060-1073`;`server/services/trustDeferralService.ts:1-47,66-68`

這是否構成 CST §17550 合規缺口,取決於 Stripe 收單資金的法律定性(是否落入 trust account 監管範圍)—— 這是業務/法規判斷,不是程式碼能回答的問題,**已列入裁示問題清單**。[V]

### 1.5 供應商成本與付款(Lion 雄獅 / UV 縱橫海鷗 / eChinaTours)

- `customOrders.supplierCost`(migration 0099)與 `bookings.supplierCost`(migration 0086)是**兩張表各自獨立維護的成本欄位**,Jeff 核對供應商 invoice 後手動輸入,規定絕不可上客人文件。沒有共用的成本表。[F] `drizzle/schema.ts:2364-2430`(customOrders);`drizzle/schema.ts:749-753`(bookings)
- LLM 自動化路徑寫 `customOrders.supplierCost` 前必須過 `gateSupplierCost` 驗證閘門:純比對聲稱金額是否真的出現在已上傳供應商文件文字裡,對不上或缺 `sourceDocId` 一律拒絕。Admin 後台人工路徑不經此驗證,責任在 Jeff 本人核對。[F] `server/_core/supplierCostVerification.ts:43-136`
- `supplierDepartures.agentPrice`(Lion 同業價,只用於跟團套裝的內部毛利稽核)與訂製單的 `supplierCost` 是**兩條獨立機制**,UV 側則寫 null(公開頁不揭露同業價)。[F] `server/services/supplierSync/lion.ts:113,268`;`server/services/supplierSync/uv.ts:110`
- **系統裡完全沒有「應付供應商帳款」的概念**:全 repo 沒有任何 `supplierPaid`/`supplierPaymentStatus`/`paidToSupplier`/`supplierInvoice` 欄位或獨立 payable 表(全庫 grep 零命中)。`bookings.supplierStatus` 狀態機(not_placed/placed/vendor_confirmed/vendor_rejected/waitlisted)只追蹤有沒有跟供應商下單確認,不含任何付款狀態。[F] `drizzle/schema.ts:740-753`
- **實際「付錢給供應商」這個動作,系統完全不記錄、也不主動發起**:Plaid 整合純唯讀(只拉銀行交易紀錄),全 repo 沒有任何 `createTransfer`/`paySupplier`/wire/ACH 發起 API 呼叫。付款完全在系統外由 Jeff 本人操作銀行/信用卡完成。[F] `server/services/accountingAgentService.ts:94,195`
- 唯一的「痕跡」是事後記帳:錢已經流出去之後,AI 記帳 agent 用 `KNOWN_OUTFLOW_VENDORS` 名單(如 Lion Travel、UnitedStars International)把符合的出帳交易標成 `category='cogs_tour'`,純粹是報稅分類,**`bankTransactions` 沒有任何欄位反查是哪張訂單的供應商成本**。[F] `server/agents/autonomous/accountingKnowledge.ts:72-146,305-364`
- `financeAlertProducer.ts` 有一個 `checkSupplierPaymentMismatch()` 警示型別,聲稱要抓供應商付款差異,但下游 `reconciliationService.ts` 的 discrepancy type 沒有任何一種真的標記成 supplier 專屬類型 —— **名義上存在但實質未實作到位的半成品告警**。[I] `server/agents/autonomous/financeAlertProducer.ts:249-296`
- `customOrderWatchdog.ts` 的 Plaid 收款比對明確只看「客人付錢給我們」的方向(`amount<0`),**反向(我們付錢給供應商)完全沒有對應的比對/提醒機制**。[F] `server/services/customOrderWatchdog.ts:475-497`

**結論:供應商成本與付款這一段,系統只做到「事後記帳分類」,「應付追蹤」與「付款發起」兩段完全是系統外的人工操作,沒有任何 repo 內的表格記錄。**

### 1.6 兩本帳(bankTransactions vs accountingEntries)防雙計機制

- `bankTransactions`(Plaid 同步)是**損益權威來源**,`accountingEntries`(手動)是輔助帳 —— 這是程式碼註解明文宣告的設計,非推論:「this is the source of truth Jeff will file taxes against once Plaid is the system of record」。[F] `server/services/bankPLService.ts:1-7`
- 產品面也已把 accountingEntries 降為輔助:`admin-v2/FinanceReports.tsx` 把「損益表」(ProfitLossV2,用 bankTransactions)設為預設分頁,「帳務」重新標示為「報稅匯出」(AccountingTab,用 accountingEntries)。[F] `client/src/components/admin-v2/FinanceReports.tsx:1-36,78-82`
- 防雙計的**唯一決定點**是 `pendingExpenses.confirm` 的 `handledMode` 二選一:`'ledger'` = 真的寫一筆 `accountingEntries`;`'receipt_only'` = 只封存,因為這筆錢預期會透過 Plaid 自動進 `bankTransactions`,這裡也記一筆就會雙計。[F] `server/routers/accounting.ts:217-303`;欄位語意見 `drizzle/schema.ts:2223-2228`
- `confirm→ledger` 路徑是原子事務,失敗不會半寫入。[F] `server/db/accounting.ts:200-232`
- **`accountingEntries` 與 `bankTransactions` 之間沒有任何 FK、沒有任何 unique/CHECK constraint、沒有任何 background job 做金額+日期+商家的自動比對去重、`confirm` procedure 本身也不會在寫入前查詢 `bankTransactions` 做防呆檢查。** [F] 全文讀過 `server/routers/accounting.ts:221-303`
- **[I] 綜合推論**:兩本帳互不雙計目前完全靠「bankTransactions 走 Plaid 自動同步、accountingEntries 走人工手動輸入這唯一入口」的職責分離做到,不是靠資料庫層或程式邏輯層的主動偵測/阻擋。如果 Jeff 誤判(選了 `ledger` 但這筆錢後來也被 Plaid 抓進 `bankTransactions`),**系統不會偵測到,雙計風險完全落在人工判斷上**。
- `yearEndExportService.ts`/`taxCsvService.ts`/`auditExportService.ts` 這三個年度報稅/稽核匯出服務是否有排除規則防止兩表資料被合併相加,本次未逐行讀取確認。**[V]**

---

## 二、系統資料流(System Data Flow)

### 2.1 核心資料表一覽

| 表 | 角色 | 誰寫 | 誰讀 |
|----|------|------|------|
| `payments` | Stripe 訂單/簽證付款記錄 | 只有 `stripeWebhook.ts` | 各種報表 |
| `bookings` | 團體團訂單 | stripeWebhook、admin | customerFacts、報表 |
| `visaApplications` | 簽證代辦 | stripeWebhook、admin | 客戶頁 |
| `customOrders` | 訂製單 | admin(create/update/recordPayment/sendCollection) | watchdog、客戶文件產生、customerFacts |
| `invoices` | 客戶發票 | 三條建立路徑(客人自助 forBooking / admin 手動 create / customOrders sendCollection 觸發) | InvoicesTab |
| `accountingEntries` | 手動記帳分錄(輔助帳) | stripeWebhook(income)、`accounting.create`、`pendingExpenses.confirm(ledger)` | AccountingTab、報稅匯出 |
| `bankTransactions` | Plaid 同步交易(損益權威帳) | 只有 `plaidSyncService.ts` | bankPLService、watchdog、AccountingTab、ReconciliationTab |
| `linkedBankAccounts` | 已連結銀行帳戶,含 `isTrustAccount` flag | admin(`markTrustAccount`)、plaidSyncService(cursor 更新) | 幾乎所有財務查詢 |
| `trustDeferredIncome` | Trust 遞延認列佇列 | `processTrustInflow`(建立)、`trustRecognitionWorker`(標記 recognizedAt) | TrustComplianceV2、bankPLService |
| `pendingExpenses` | Gmail 收據自動擷取佇列 | `gmailPipeline.ts`(AI 只到這裡為止,絕不入帳) | AccountingTab 待確認分頁 |
| `stripeWebhookEvents` | Stripe webhook 冪等表 | stripeWebhookIdempotency | 無 UI,純內部防重放 |

### 2.2 Worker / Cron 排程總表

底層機制**全部是 BullMQ(Redis-backed) repeatable job**,沒有 node-cron,也沒有 Fly.io scheduled machine;所有 worker 跑在**單一 Fly process**(`fly.toml` 只有 `processes=["app"]`,`auto_stop_machines=off`,因為背景 worker 要常駐)。[F] `server/queue.ts:1`;`fly.toml:18-31`

真正的財務 queue 定義在 `server/queue.ts`(單數,~1539 行的單一巨檔,官方註解自稱「~24-queue monolith」),不在 `server/queues/`(複數目錄,那裡 6 個 queue 全跟財務無關:廢單挽回/Packpoint 維護/海報處理/優先權重寫/報價跟進/供應商同步)。[F] `server/_core/observabilityCounters.ts:124-125`

| Queue | Cron(UTC) | 職責 |
|-------|-----------|------|
| `plaidDailySyncQueue` | 05:00 | 同步全部 active 銀行帳戶交易進 bankTransactions,完成後觸發 AI 自動分類 |
| `trustRecognitionQueue` | 06:00(刻意晚 Plaid 一小時) | 掃描 trustDeferredIncome,標記到期認列,notifyOwner 提醒轉帳 |
| `scalingGuardrailQueue` | 07:00 | 歸檔舊交易 + LLM 月度預算門檻檢查(成本控管,非會計認列) |
| `supplierDetailEnrichmentQueue` | 03:00 | 供應商商品目錄同步(非會計流程,不算財務 worker) |

- `trustRecognitionQueue` 另有 admin-only 手動重跑入口 `plaidRouter.trustRecognizeNow`,但它**繞過 BullMQ**,直接同步呼叫 service function;`server/queue.ts` 裡另外定義的 `triggerManualTrustRecognition()`(走 queue 版)全 repo 搜尋不到任何呼叫端 —— **疑似死碼**。[F][I] `server/routers/plaidRouter.ts:1988-2008`;`server/queue.ts:1354-1360`
- 觀測:`/health` 端點完全沒有針對這些 queue 的健康檢查(只查 DB/Redis/Stripe/LLM)。真正的 queue 觀測是另一支獨立模組 `observabilityCounters.ts`(2026-07 新增),每週一 12:00 UTC 隨 `weeklyCorrectnessAuditWorker` 彙整各 queue 的 failed 數。**這份清單是手動維護的陣列,未來新增財務 queue 若忘記加進去,該 queue 失敗不會出現在週報 —— 潛在維護盲點。** [F][I] `server/_core/observabilityCounters.ts:124-183`
- 錯誤可見性有三層,互補不重疊:①`wireWorkerFunnel`(掛 27 個 worker,即時系統性錯誤卡片)②worker 自己的 `completed`/`failed` 監聽(業務語意通知,如信託認列金額)③`observabilityCounters`(每週趨勢彙總)。[F] `server/_core/errorFunnel.ts:247-277`;`server/trustRecognitionWorker.ts:98-112`

### 2.3 Admin UI 現況(含死碼標記)

**真正 live 的路徑**:`/workspace` → `WorkspaceCompany.tsx` 報表分頁 → `admin-v2/FinanceReports.tsx`。2026-05-29「七合三」簡化後,5 張報表用小切換:

| 報表 | 元件 | 資料源 | 可操作性 |
|------|------|--------|---------|
| 損益表(預設) | `ProfitLossV2` | Plaid `bankTransactions` | 唯讀 |
| 對帳 | `ReconciliationTab` | `reconciliation.runReport` | 唯讀,無記帳按鈕 |
| 發票 | `InvoicesTab` | `invoices.list/updateStatus` | 可改狀態,不能新建(新建在 AccountingTab) |
| 客人訂金 | `TrustComplianceV2`(原「信託合規」) | `plaid.trustReconciliation`/`trustDeferredList` | 對帳+稽核匯出 |
| 報稅匯出 | `AccountingTab`(原「帳務 Schedule C」) | `accountingEntries` | **唯一能手動建立 accountingEntries 的地方**,含 5 子分頁(總覽/待確認支出/分錄/發票/週期性支出) |

- `AccountingTab` 的「待確認支出」分頁就是 Gmail 收據 → `pendingExpenses.confirm`(ledger/receipt_only)的人工介面,對應 1.6 節防雙計機制。[F] `client/src/components/admin/AccountingTab.tsx:301-411,720-805`
- 客戶詳情頁的「記已收」(`CustomOrderDetail.tsx` → `recordPayment`)與看門狗黃卡(`DetailTabs.tsx` 的 `paymentMatch` finding)是**訂製單層級**的收款操作,不屬於 FinanceReports 家族,是另一條獨立路徑。[F] `client/src/components/admin/customers/CustomOrderDetail.tsx:301-330`;`client/src/components/admin/customers/DetailTabs.tsx:73-229`

**⚠️ 死碼(無任何存活 import 路徑)[F]**:
- `FinanceTab.tsx`(對帳/發票/帳務/銀行帳戶 4 分頁的舊統一父元件)—— 全 repo 沒有任何檔案 import 它
- `FinanceLanding.tsx`(QuickBooks 風格儀表板,628 行)—— `UnifiedInbox.tsx` 有呼叫 `onNavigate('finance-landing')`,但沒有任何 registry 接住這個字串 id
- `BankAccountsTab.tsx`(658 行)—— 只被死碼 `FinanceTab.tsx` import

`AdminFinance.tsx`(`/ops/finance` 路由)目前是純占位頁,對應 `App.tsx` 註解「Live admin = /workspace; new build = /ops/*」,代表這是還在蓋的新版殼子。[F] `client/src/pages/AdminFinance.tsx:1-15`

**財務邏輯分散在 5 個 router 檔案**,沒有單一總稱的 `finance.ts`:`accounting.ts`(10 主要 procedure + pendingExpenses 5 個子 procedure)、`invoices.ts`、`reconciliation.ts`(只有 1 個 procedure)、`recurringExpenses.ts`,以及**實質上的財務引擎但檔名不叫 finance 的 `plaidRouter.ts`**(2000+ 行,含損益、信託對帳、認列、批次分類等核心邏輯)。[F][I] `server/routers/plaidRouter.ts:122-2023`

`accounting.ts` 裡的 `dashboard`/`profitAndLoss`/`monthlyTrend`/`taxSummary` 4 個 procedure,目前前端主要頁面都已改用 `trpc.plaid.profitLossReport`/`profitLossTrend`,**這 4 個舊 procedure 可能已無實際呼叫者**(本次僅查了 `client/src/components/admin/` 直接呼叫,未做全庫排除)。[I][V] `client/src/components/admin/AccountingTab.tsx:188-217,502`

### 2.4 三種斷點分類

**🟢 全自動(無人工介入)**
- Plaid 每日同步 → `bankTransactions`(05:00 UTC)
- Stripe webhook → `payments`/`bookings`/`accountingEntries` 原子寫入
- AccountingAgent 對新同步交易自動分類(customer/vendor/other_review)
- Trust 遞延認列排程掃描 → 標記 `recognizedAt`(06:00 UTC,**前提是 feature flag 開啟,且僅對 Plaid 偵測到的 Trust 帳戶存款有效,不含 Stripe**)

**🟡 半自動(AI 建議 + 人工確認,AI 絕不自動落地)**
- `customOrderWatchdog` 的 `paymentMatch` 黃卡建議(只讀 `bankTransactions`,產生建議,不寫任何欄位、不呼叫 `recordPayment`)
- Gmail 收據 → `pendingExpenses` 佇列 → Jeff 在 AccountingTab 確認/拒絕(handledMode 決定 ledger 或 receipt_only)
- `jeffOverrideCategory`(AI 分類被人工覆蓋)

**🔴 純人工(系統完全沒有記錄或只能記錄結果,不記錄過程)**
- Square 催款連結手貼 + 客人在 Square 頁面刷卡(本站不知道結果)+ Jeff 事後手動記已收
- 供應商成本核對(比對 invoice)+ 供應商付款(轉帳/刷卡)—— 全部系統外
- Trust 帳戶認列後的**實際銀行轉帳**(信託 → Operating)—— 系統只提醒,不執行
- 兩本帳防雙計判斷(`pendingExpenses.confirm` 選 ledger 還是 receipt_only)—— 無自動交叉驗證
- `customOrders`/`invoices` 兩套狀態機互不同步(`invoices.status='paid'` 不會反映 `customOrders.depositPaidAt`,反之亦然)

**⚫ 沒接起來(架構性斷點,不是流程慢,是真的沒有連線)**
- **Stripe 收的錢完全繞過 Trust 遞延認列機制**(全份報告最關鍵發現,見 1.4 節)
- `accountingEntries` 與 `bankTransactions` 之間沒有任何 FK、沒有交叉比對、沒有雙計偵測
- 供應商付款方向完全沒有比對/提醒機制(`customOrderWatchdog` 只查客人收款方向)
- 3 個死碼財務 UI 元件(`FinanceTab`/`FinanceLanding`/`BankAccountsTab`)
- `triggerManualTrustRecognition()`(queue 版手動觸發)無任何呼叫端

---

## 三、待證清單彙總(needs_prod_verification)

以下需要 Jeff 或在 Fly/prod 環境確認,本次唯讀 repo 探勘無法回答:

1. `PLAID_TRUST_DEFERRAL_ENABLED` 及其相關環境變數(`PLAID_TRUST_RECOGNITION_OFFSET_DAYS`/`PLAID_TRUST_AUTOMATCH_MIN_CONFIDENCE`/`PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS`)在 prod 的實際值 —— `fly secrets list` 才能看
2. `linkedBankAccounts` 表實際有幾筆 row、哪一筆 `isTrustAccount=1` 對應到 #5442、哪一筆對應到 #2174
3. `customOrders`/`payments`/`bankTransactions` 三表實際資料分佈(哪些付款方式真的被用過、金額多少)
4. `yearEndExportService.ts`/`taxCsvService.ts`/`auditExportService.ts` 合併兩本帳資料時是否有排除規則防止雙計(本次未逐行讀取)
5. `stripeWebhookEvents.status` 卡在 `'processing'` 的情境在 prod 是否真的發生過
6. `financeAlertProducer.ts` 的 `checkSupplierPaymentMismatch` 是否曾在 prod 實際觸發過任何警示,或是從未命中的死碼

若要跑,建議的唯讀 prod 探針(SELECT/count 類,原樣列出供 Jeff 在 Fly 上執行):

```sql
-- 1. linkedBankAccounts 現況
SELECT id, institutionName, mask, isTrustAccount, isActive FROM linkedBankAccounts;

-- 2. customOrders 付款方式分佈
SELECT paymentMethod, COUNT(*) FROM customOrders
  WHERE depositPaidAt IS NOT NULL OR balancePaidAt IS NOT NULL
  GROUP BY paymentMethod;

-- 3. payments.paymentMethod 歷史 distinct 值(排除純 'stripe' 假設)
SELECT paymentMethod, COUNT(*) FROM payments GROUP BY paymentMethod;

-- 4. trustDeferredIncome 目前積壓與認列狀況
SELECT
  SUM(CASE WHEN recognizedAt IS NULL THEN 1 ELSE 0 END) AS pending,
  SUM(CASE WHEN recognizedAt IS NOT NULL THEN 1 ELSE 0 END) AS recognized,
  SUM(CASE WHEN bookingId IS NULL THEN 1 ELSE 0 END) AS unmatched
FROM trustDeferredIncome;

-- 5. stripeWebhookEvents 有沒有卡死的 processing
SELECT COUNT(*) FROM stripeWebhookEvents WHERE status='processing' AND processedAt IS NULL;
```

```bash
# prod 環境變數(在 Fly 機器或有 flyctl 權限的地方跑)
fly secrets list --app packgo-travel | grep -i "PLAID_TRUST"
```

---

## 四、本次任務範圍外、但值得下一輪關注

- `reconciliationService.ts`/`tourReconciler.ts`/`ReconciliationTab.tsx` 的完整邏輯本次只用 grep 判斷用途,未深入讀取確認是否與 paymentMatch 看門狗有交集
- `CustomOrderSheet` 元件點開後是否會把 `paymentMatch` 建議的金額/日期預帶入 `recordPayment` 表單,還是完全空白 —— 未讀取確認
- `AccountingTab` 的舊 `accounting.dashboard`/`profitAndLoss`/`monthlyTrend`/`taxSummary` 4 個 procedure 除了本次查到的前端元件外,是否還有其他呼叫者(ops chat AI 工具、cron job)—— 未做全庫排除
