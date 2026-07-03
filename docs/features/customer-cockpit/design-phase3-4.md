# Design — Phase3(3a 承諾追蹤 / 3b 月度草稿評分)+ Phase4(今日清單)

> Stage2 設計文件。對應 roadmap-100.md Phase3 全部 + Phase4。

## 踩點研究結果

- **寄信成功掛鉤點**:`server/_core/escalationBox.ts` 的 `sendEscalationReply`(約 486-493 行簽名,679-693 行寄信成功後區塊)是**唯一**的寄信路徑——這個檔案自己的鐵律是「nothing here sends without Jeff's explicit click」,沒有 auto-send 分流。寄信成功後已經呼叫 `recordOutboundEmailInteraction` 寫進 `customerInteractions`(直接沿用它剛建好的 interaction row 當 `sourceInteractionId`)。3a 的承諾抽取就掛在這個既有呼叫之後,同一個 best-effort try/catch 風格(失敗不影響已經成功寄出的信)。
- **customerInteractions** 核心欄位:`id`(PK,當 sourceInteractionId 用)、`customerProfileId`(notNull)、`customOrderId`(nullable 軟參考,0104 加,NULL=未分類)、`direction`、`content`、`createdAt`。
- **opsTools.ts 跨客戶守門既有模式**:工具 input schema **不帶** `customerProfileId` 參數,守門邏輯在 executor 層用「目前釘住客人」的 context 注入(例如 `update_customer_note` 的寫法)。`mark_promise` 要照抄同一模式:input 只帶 `{promiseId, action}`,executor 驗證這筆 promise 的 `customerProfileId` 等於目前釘住客人的 profileId,不等於就拒絕。
- **invokeLLM outputSchema 模式**:照抄 `chatLogImport.ts` 的 `classifyAndExtractChatLog`——LLM 只回原文字串(承諾句 + 日期原文),日期數學 100% 交給 `resolveEventDate`(`server/_core/chatLogImport.ts:83`,已 export,3a 直接 import 這個既有函式,不准再寫一份日期解析)。
- **queue.ts 既有 cron 範本**:`scheduleWeeklyRetrospective`(約 595-615 行,pattern `"0 1 * * 1"`)+ `scheduleDailyCustomerSummaries`(約 812-828 行,pattern `"0 2 * * *"`)。3b 的月度 cron 照抄同一套 BullMQ repeatable job 寫法,pattern 改 `"0 3 1 * *"`(每月 1 號 03:00 UTC)。
- **Opus 地雷**(`opsAgentStream.ts` 約 199-203 行):`invokeLLM` 的 `InvokeParams` 型別本來就沒有暴露 `temperature` 參數(所以不會誤傳),但既有 empty-content 過濾邏輯(`if (!turn.content || !turn.content.trim()) continue;`)要照抄——3b 組評審 prompt 的對話歷史時,任何空 content 的輪次都要先濾掉,否則 Opus 會整個 400。
- **runInquiryAgent**(`server/agents/autonomous/inquiryAgent.ts:557`):純函式、零副作用(不寫 DB、不寄信),輸入 `{rawMessage, channel, customerProfile?, recentInteractions?, policyRules?, threadHistory?}`。3b 直接呼叫這個既有函式重生草稿,不建立新的草稿生成邏輯。
- **agentMessages**:`messageType` enum 已有 `observation`(Step4 跟進草稿在用)、`digest`(3b 月度報告卡用這個,語意上是「摘要簡報」不是「待審草稿」)、`priority` enum(low/normal/high/critical,劣化時用 `high`)。
- **Phase4 UI**:中欄空狀態在 `client/src/pages/AdminCustomers.tsx`(約 95-97、115-117 行),i18n key `admin.customers.selectCustomer`。選客機制:`CustomerList.tsx` 的 `onClick={() => onSelect({id, kind})}` → `AdminCustomers.tsx` 的 `setSelected(ref)`。今日清單每一項點擊要呼叫同一個 `onSelect`/`setSelected`,不新建路由。
- **`customerProfiles.followUpDate`** 跟 **`customOrders.departureDate`** 都是 `date(..., {mode:"string"})`,round-trip 成 `"YYYY-MM-DD"`,可直接字串比較不用擔心 tz drift(既有註解已講明這是刻意設計)。

## 3a:承諾追蹤

### migration 0110(新表,細節見下方「migration 風格」小節)

`customerPromises`:
- `id` PK autoincrement
- `customerProfileId` int notNull(跨客戶守門用)
- `customOrderId` int nullable(軟參考,跟 customerInteractions 同慣例)
- `sourceInteractionId` int notNull(FK 概念上指向 customerInteractions.id,查重用)
- `promiseText` text notNull(承諾句原文,一字不改)
- `rawDateText` varchar(100) nullable(LLM 抽出的日期原文,例如「週五」「7/10」,保留供除錯/未來顯示用,不是必要欄位但成本極低)
- `dueDate` date mode:string nullable(`resolveEventDate` 算出來的到期日;抽不出來就 null,永不參與看門狗判斷)
- `extractedAt` timestamp defaultNow notNull
- `fulfilledAt` timestamp nullable
- `dismissedAt` timestamp nullable
- `createdAt` timestamp defaultNow notNull
- index:`(customerProfileId, dueDate)`(看門狗查詢用)、`(sourceInteractionId)`(查重用)

### 新檔 `server/_core/promiseExtraction.ts`

- `extractPromisesFromEmail(body: string, todayLA: string): Promise<Array<{promiseText, rawDateText: string|null}> | null` —— invokeLLM + outputSchema,system prompt 明講:只抽「對客人的具體時間承諾」(例如「週五可取件」「明天發報價」),不是所有句子;每個承諾只回 `promiseText`(原文)+ `rawDateText`(畫面上寫的日期原文,不做任何年份/日期推算);抓不到承諾就回空陣列;整段 try/catch 永不 throw,失敗回 null。
- `buildPromiseRows(extracted, todayLA, opts:{customerProfileId, customOrderId, sourceInteractionId}): InsertCustomerPromise[]` —— 純函式。對每個抽出的承諾,呼叫既有 `resolveEventDate(rawDateText, todayLA)`(import 自 chatLogImport.ts,不重寫),算出 `dueDate`(解不出來就 null,一樣存這筆 promise 只是 dueDate 為 null)。
- `recordPromisesForInteraction(params): Promise<{recorded: number}>` —— 協調函式:先查 `sourceInteractionId` 是否已經處理過(customerPromises 是否已有任何列帶這個 sourceInteractionId)——有就直接回 `{recorded: 0}` 不重抽(這是「夜掃/輪詢絕不重抽」的查重防線,即使目前只有同步掛鉤這一條路徑,也要先把這道防線建起來,防未來任何補跑/重試路徑重複燒 LLM);沒有才呼叫 `extractPromisesFromEmail` + `buildPromiseRows` + 批次 insert。整段 try/catch,失敗只 log 不 throw(這是 best-effort 附屬功能,不能讓失敗影響已經成功寄出的信)。

### 接線(`escalationBox.ts`)

寄信成功、`recordOutboundEmailInteraction` 呼叫完拿到新 interaction 之後(需要這個函式回傳新建 row 的 id,若目前不回傳要看現有函式簽名能不能取得,若拿不到 id 就改用「查最新一筆這個 profileId 的 outbound interaction」這種次選方案,實作時自己判斷哪個更可靠),fire-and-forget(不 await 阻塞寄信回應,或 await 但包在同一層 try/catch,兩者皆可,參考這個檔案既有的 best-effort 呼叫是怎麼處理的)呼叫 `recordPromisesForInteraction`。

### 看門狗新 finding kind(`customOrderWatchdog.ts`)

這個 finding **是客人層級,不是訂單層級**(承諾不一定掛在某張訂製單上)——`WatchdogFinding` 聯集要能接受一個不含 `orderId/orderNumber/title` 的變體,前端渲染要照 `kind` 分流處理,不要硬塞假的 orderId。

- `CustomerPromiseFinding = {kind:"commitment", promiseId, customerProfileId, customOrderId: number|null, promiseText, dueDate: string, sourceInteractionId, level:"yellow", daysOverdue: number}`
- `evaluateCommitment(promise: {id, customerProfileId, customOrderId, promiseText, dueDate, fulfilledAt, dismissedAt}, todayLA): CustomerPromiseFinding | null` —— 純函式。`fulfilledAt`/`dismissedAt` 任一有值 → null。`dueDate` 為 null → null(抽不出日期永不叫)。`dueDate` 未到今天(LA 曆日)→ null。過期才回 finding,`daysOverdue` 用既有 `laDayDiff` 風格計算。
- `findCommitmentIssues(promises, todayLA): CustomerPromiseFinding[]` —— 仿既有 find*Issues 排序風格(最久過期排最前)。

### Router 接線

`watchdogForCustomer` 加查 `customerPromises where customerProfileId = profileId and fulfilledAt is null and dismissedAt is null and dueDate is not null`,餵給 `findCommitmentIssues`,併入回傳陣列。同樣包 try/catch,失敗回空陣列不拖垮既有四種 finding。

### 兌現/撤銷:新工具 `mark_promise`(opsTools.ts)

- input:`{promiseId: number, action: "fulfilled" | "dismissed"}`。
- 照抄既有跨客戶守門模式:查這筆 promise 的 `customerProfileId`,跟目前釘住客人的 profileId 不符就拒絕(回結構化錯誤,不寫入)。
- 對應 action 寫 `fulfilledAt`/`dismissedAt` = now()。
- 黃卡文案提示 Jeff「可以在聊天裡說『這個承諾已經兌現了』」,inquiry/ops 聊天的 system prompt 或工具描述裡要講清楚這個工具存在,讓 LLM 知道 Jeff 這樣講話時要呼叫它。

## 3b:月度草稿評分

### 新檔 `server/_core/draftEval.ts`

- `selectEvalSampleCustomers(): Promise<Array<{profileId, ...}>>` —— 近 30 天有真實往來(customerInteractions 有紀錄)的客人,取最多 10 位(排序規則自訂,例如最近互動優先或隨機取樣,寫清楚選擇理由)。
- `runDraftEvalForCustomer(profileId): Promise<JudgeRawResult[]>` —— 用既有資料組出 `runInquiryAgent` 需要的輸入(`rawMessage`/`threadHistory`/`customerProfile`/`recentInteractions`,從這位客人真實的 customerInteractions 取),呼叫 `runInquiryAgent` 重生一份草稿(零副作用,不落地不寄)。對重生的草稿,跑 3 個獨立評審 LLM 呼叫(各自用同一套評分 rubric prompt,獨立呼叫,不共用一次呼叫的多輪對話),每個評審回傳結構化分數(維度分 + 是否吹牛/是否重複承諾/是否認錯人三個布林旗標)。組評審 prompt 的對話歷史時,任何空 content 輪次要先濾掉(照抄 opsAgentStream.ts 既有的 empty-content guard)。
- `aggregateDraftEvalScores(judgeResults: JudgeRawResult[]): AggregatedScore` —— **純函式,這是驗收要求的核心可測函式**:把多個評審的維度分取平均(四捨五入到小數點後 1 位)、三宗罪用「至少一個評審標記就算命中」聚合(寧可過度標記不要漏抓,這類品質問題本質上跟看門狗「寧漏勿誤」方向相反——吹牛/重複承諾/認錯人這三宗罪是已經出過真事故的類別,抓漏比抓多後果嚴重)。
- `runMonthlyDraftEval(): Promise<MonthlyEvalReport>` —— 協調函式:跑樣本 → 每位客人的 `AggregatedScore` → 全月綜合分(樣本平均)→ 讀 `eval-history.md` 抓上個月的綜合分(見下方 parse 函式)→ 算劣化(掉 1 分以上 → 卡標 high)→ 寫 `eval-history.md` 新一節 → 寫一張 `agentMessages` 卡(`messageType:"digest"`,degrade 時 `priority:"high"` 否則 `"normal"`)。
- `parseLastMonthScore(mdContent: string): number | null` —— 純函式,`eval-history.md` 每節用固定格式的一行(例如 `**綜合分:X.X/10**`),這個函式抓最新一節的這個數字。找不到就 null(代表首次跑,不做劣化比較)。

### `eval-history.md` 格式(每次追加一節,新檔第一次跑時建立)

```
## YYYY-MM-DD 月度評分

**綜合分:X.X/10**

三宗罪計數:吹牛 N / 重複承諾 N / 認錯人 N(共 M 個樣本)

最差樣本:<客人代稱或 profileId> — <一句話摘要哪裡出問題>

[劣化偵測:比上月 (Y.Y) 掉 Z 分,已標 high]  ← 只在真的劣化時才印這行
```

### cron 註冊(`queue.ts`)

`draftEvalQueue` + `scheduleMonthlyDraftEval()`,pattern `"0 3 1 * *"`,jobId 例如 `"monthly-draft-eval-scheduled"`,新 worker 檔 `draftEvalWorker.ts`(照抄 `retrospectiveWorker.ts`/`customerSummaryWorker.ts` 的檔案結構)處理 job,呼叫 `runMonthlyDraftEval()`。

### 絕無寄信路徑(驗收要求要有測試斷言)

`runDraftEvalForCustomer` 跟 `runMonthlyDraftEval` 全程只呼叫 `runInquiryAgent`(純函式)+ `invokeLLM`(評審),不呼叫任何寄信函式(`sendEscalationReply`/`sendAdminInquiryReply` 等)——測試要 mock 這些函式並斷言零呼叫。

## Phase4:今日清單

### 新檔 `server/services/todayList.ts`(純函式為主,零 LLM)

五條規則,每條一個純函式,輸入是呼叫端已經查好、篩過非空欄位的資料:

1. `evaluateFollowUpDue(profile: {id, name, followUpDate}, todayLA): TodayListItem | null` —— `followUpDate` 有值且 `<= todayLA`(字串比較,YYYY-MM-DD 格式天然可字串排序比較)。
2. `evaluateQuoteExpiring(order: {..., quoteSentAt, lastInboundAt}, todayLA): TodayListItem | null` —— 有 `quoteSentAt` 且客人最後一次 inbound 早於 `quoteSentAt`(= 客人還沒回覆這次報價)。距今天數 `days = todayLA - quoteSentAt 的 LA 曆日`:`11 <= days < 14` → 「還剩 N 天」;`days >= 14` → 「已過效期」;`days < 11` → null(還早)。
3. `evaluateCommitmentOverdue`:直接複用 3a 的 `findCommitmentIssues` 結果轉成 TodayListItem 形狀,不重寫查詢邏輯。
4. `evaluateDepartureCountdown(order: {..., departureDate}, todayLA): TodayListItem | null` —— `departureDate - todayLA` 剛好等於 30 或 7(T-30/T-7 精確視窗,不是範圍,一天只提醒一次,參考既有 `tripReminder.ts` 的 30/14/7/3 天視窗寫法但只取 30 跟 7 這兩個)。
5. `evaluateBalanceDue(order: {..., totalPrice, depositPaidAt, balancePaidAt, departureDate}, todayLA): TodayListItem | null` —— `totalPrice` 有值、`depositPaidAt` 有值、`balancePaidAt` 為空、且 `departureDate - todayLA <= 30`(30 天內)。

`TodayListItem = {category: "followUp"|"quoteExpiring"|"commitment"|"departure"|"balanceDue", customerProfileId, customerName, oneLiner, sortKey}`。任何一條規則因為欄位缺值就回 null,不強行判斷(寧漏勿誤,跟看門狗同一個原則)。

### Router:新 endpoint `todayList`(admin-only,公司層級,不是單客人查詢)

放 `adminCustomerOrders.ts`(既有看門狗查詢的鄰居)或視實作判斷開新檔案。查詢範圍是**全公司**所有客人/訂單(不像 `watchdogForCustomer` 是單客人),對一人公司資料量沒有效能疑慮。回傳 `TodayListItem[]`,按 `category` 分組或攤平都可以,前端自己決定怎麼排版,但每項都要帶 `customerProfileId`(前端跳轉用)。

### UI:`AdminCustomers.tsx` 中欄空狀態

沒選客人時,原本的「選擇一位客戶查看詳情」文案改成:清單非空時顯示今日待辦卡片列表(每項:客人名 + 一句話 + 點擊呼叫既有 `onSelect`/`setSelected` 跳過去);清單空時維持原文案 + 加一句「今天沒有待辦」。極簡黑白、圓角、密度節奏照 `docs/standards/design.md`。i18n 兩語言檔都要補對應 key。

## Migration 風格決策(0110,偏離字面指示,原因見下)

任務指示「遷移風格照 0104-0109 的 INFORMATION_SCHEMA 冪等 guard」,但 0104-0109 全部是**欄位新增**(ALTER TABLE ADD COLUMN),沒有一個是**新表**。`docs/MIGRATION_PATTERNS.md` 記載的 2026-05-13 P0 事故(migration 0070)正是「用 PREPARE/EXECUTE 包 CREATE TABLE 在 TiDB 上靜默 no-op,release_command 顯示成功但表其實沒建出來」——文件明講 Rule 1:CREATE TABLE 一律用 `CREATE TABLE IF NOT EXISTS`(TiDB 原生支援,不需要 PREPARE 包裝),PREPARE/EXECUTE 只在「文件本身就沒有」的情境才勉強考慮。

這次 0110 是新表,不是欄位,所以：**表創建用 `CREATE TABLE IF NOT EXISTS`(不包 PREPARE)**,索引創建如果需要條件判斷可以用 INFORMATION_SCHEMA 查詢(不影響 DDL 本身是否執行),down migration 用 `DROP TABLE IF EXISTS`(同樣原生冪等,不需要 PREPARE)。這不是「不照抄 0104-0109」,是同一個「冪等、可重跑」的精神套用在正確的 DDL 語法上——0104-0109 面對的是欄位增刪(TiDB 沒有 `ADD COLUMN IF NOT EXISTS` 的等效簡單寫法讓他們選擇用 INFORMATION_SCHEMA guard,這點其實 MIGRATION_PATTERNS.md 也提到 TiDB 有 `ADD COLUMN IF NOT EXISTS` 但 0104-0109 沒用,這是既有 code 的既定選擇不在本次討論範圍),面對的是完全不同的 DDL 類型,不該盲目套用可能重蹈事故的 PREPARE 包裝。實作時務必用 `--> statement-breakpoint` 分隔多個 DDL 陳述句(Rule 2)。

## 順序與檔案衝突規避

3a → 3b → 4 依序做,不平行:①4 直接依賴 3a 的 `findCommitmentIssues`,3a 沒做完 4 無法開工;②3a 跟 4 都會碰 `customOrderWatchdog.ts`(3a 加 kind、4 只是讀取結果不動這個檔案,但保守起見還是排序做);③3b 是完全獨立的檔案集合(`draftEval.ts`/`queue.ts`/`eval-history.md`),理論上可以跟 3a 平行,但為了 git 歷史清楚跟審查專注,一樣排在 3a 之後、4 之前。
