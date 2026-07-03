# Design — Phase1b 存量案件批次進場 + Phase1c iMessage 桌機同步

> Stage2 設計文件(照 docs/standards/workflow.md)。對應 roadmap-100.md Phase1 剩下兩項。

## 踩點研究結果(先講清楚現實,再談設計)

- `customerProfiles`(drizzle/schema.ts:2693-2786):email/phone/wechatId/name 全部 nullable,email/phone 有 index 但非 unique,無「至少一個聯絡方式非空」的 DB constraint。
- 既有 `create_customer` 工具(server/agents/autonomous/opsTools.ts:1667-1714)的規則:**email 或 phone 至少一個非空才准建卡**,沒有就回 error;查重用 email 精確比對 OR normalized phone 比對,命中就回既有卡不重複建。這是本次批次匯入的識別規則基準,不放寬也不收緊,直接沿用/重用同一段邏輯(不要複製貼上出第二份,若原邏輯是 inline 沒抽函式,這次順手抽成 `server/db/customerProfile.ts` 的共用函式,create_customer 跟批次匯入都改叫它)。
- **資料現實(掃描 15 個案件資料.md 的結論)**:多數案件檔裡沒有客人本人 email/phone/wechatId 的實際值,只有姓名 + 渠道描述(如「微信」)。抓到的疑似聯絡方式常是供應商聯絡人(如 `hsinyisu@liontravel.com` 是雄獅業務、`ar.ec@uvbookings.com` 是 UV 訂位信箱)或 Jeff 自己的電話。這代表:**多數案子無法自動建卡**,不是程式錯誤,是資料本來就沒有這個欄位。批次匯入工具的職責是誠實反映這個現實(dry-run 預覽清楚列出哪些卡因為沒有識別資訊被擋下),不是發明假身分硬塞。這些案子之後 Jeff 若補上真實聯絡方式,可用既有 `merge_into_customer` 手動合併(customerMerge.ts 的 mergeCustomerProfiles 已支援)。
- `customOrders`(drizzle/schema.ts:2375-2462):`category` 是 varchar 非 enum(可自由擴充值不用改 schema),`notes` 是 text——足夠存匯入溯源標記,不需要 migration。
- 既有 `verifyInternalAuth()`(server/_core/index.ts:1117-1190)已有 bearer token + `crypto.timingSafeEqual` + IP allowlist + rate limit 的完整 pattern,目前綁定 `INTERNAL_TEST_TOKEN` 這個環境變數(給 CI/test-generation 用)。這次兩個新端點語意不同(Jeff 桌機腳本,非 CI),**不要重用同一個 token 值**,但要重用同一套驗證邏輯——可以把 `verifyInternalAuth` 擴充成接受一個 `tokenEnvVar` 選項,或另開一個小 helper 共用 timingSafeEqual 比對邏輯,兩者皆可,由實作階段判斷哪個對現有程式碼侵入性較小。新環境變數建議命名 `LOCAL_SCRIPT_TOKEN`,兩個新端點(1b 匯入 + 1c ingest)共用同一個 token(同一台桌機、同一個信任邊界,沒必要分兩組密鑰)。
- `customerInteractions.channel` enum(drizzle/schema.ts:2856)沒有 `"imessage"` 值,只有 `"sms"`。iMessage 統一存成 `channel:"sms"`,不做 migration 加新值(chat.db 本來就混存 SMS 與 iMessage,渠道細分非必要)。

## Phase1b:案件批次進場

### 端點

`POST /api/admin/import-case-file`(Express route,仿 ask-ops-stream 風格,不走 tRPC——呼叫端是本機腳本沒有瀏覽器 cookie session)
- Header:`Authorization: Bearer <LOCAL_SCRIPT_TOKEN>`
- Body:`{ mode: "dry_run" | "confirm", folderName: string, markdown: string }`(本機腳本讀原始 案件資料.md 文字直接傳,parsing 在 server 端做,因為 LLM API key 在那)
- 回傳:`{ status: "existing" | "creatable" | "blocked_no_identifier", profileId?, plan: {...}, warnings: string[] }`

### 新檔 `server/_core/caseFileImport.ts`

1. `extractCaseFields(markdown, folderName): Promise<CaseExtraction | null>` — invokeLLM + outputSchema(仿 chatLogImport.ts 的 pattern)。抽出:`customerName`、`customerContact: {email, phone} | null`(**只抽「對接人(客戶)」類欄位標註為客戶本人的聯絡方式,明確排除供應商/地接/機票商聯絡資訊**——system prompt 要給反例提醒,例如「供應商信箱/電話不算」,並用真實案件檔片段當測試 fixture 驗證不會誤判)、`destinationSummary`、`sellPriceUSD: number | null`(**絕不抽取或參考任何 supplierCost/成本/後台價/同業價相關數字**,只認「對外售價/客人付」這類標註)、`paymentStatusText`、`keyDates: Array<{label, dateIso}>`、`category`、`warnings`。不確定一律留 null,絕不編造。
2. `resolveCustomerIdentity(contact): Promise<{status, profileId?, matchedBy?}>` — 呼叫共用的識別/查重函式(見上,沿用 create_customer 同款規則:email 或 phone 至少一個才 creatable)。
3. `buildCaseImportPlan(extraction, identity, folderName, todayLA): CaseImportPlan` — 純函式。組出:profile 欄位(若需新建)、一筆 customOrders(`category`、`totalPrice=sellPriceUSD`、`status:"draft"`、`notes: "匯入自案件資料.md(" + folderName + ")," + todayLA`,payment 相關欄位一律不動)、customerInteractions 里程碑列(每個 keyDates 一筆,`createdAt=該日期`,`generatedBy:"human"`,`channel` 用猜到的渠道或預設 `"wechat"`)。
4. `importCaseFile(params, mode): Promise<CaseImportResult>` — dry_run 只回傳 plan 不寫 DB;confirm 才寫,且用 `notes` 裡的 `folderName` 標記查重(同資料夾 confirm 兩次不重複建 customOrders)。

### 本機腳本 `scripts/import-customer-cases.mjs`

- 掃 `/Users/jeff/Desktop/Pack&Go/客人檔案/` 各子資料夾,讀 `案件資料.md`
- 預設 dry_run 全部跑一輪,印出一張總表(資料夾、狀態 existing/creatable/blocked、售價、警告)
- `--confirm=<folderName>` 或 `--confirm-all` 才真的寫入,呼叫時帶 confirm mode
- token 從 `~/.packgo/local-script-token` 讀(不進 repo)

### 驗收

- `blocked_no_identifier` 的案子在 dry-run 清楚列出,不靜默略過。
- 供應商聯絡資訊絕不被誤判成客人身分(測試用 David/林朝安/金宥的真實文字片段當 fixture)。
- confirm 兩次同一案不重複建單。
- 全程不碰 supplierCost/成本/後台價相關文字或欄位。

## Phase1c:iMessage 桌機同步

### 端點

`POST /api/admin/imessage-ingest`(同一套 bearer token,`LOCAL_SCRIPT_TOKEN`)
- Body:`{ messages: [{ externalId, phone, direction: "inbound"|"outbound", text, occurredAtIso }] }`(本機腳本已把 chat.db 的 Apple epoch 轉成 ISO 字串,server 端不處理 Apple 時間格式,只信任本機腳本轉好的 ISO)
- 邏輯:phone normalize 後精確比對 `customerProfiles.phone`(沿用 1b 用的同一套 phone normalize 共用函式)。命中 → insert customerInteractions(`channel:"sms"`,`createdAt=occurredAtIso`,`externalId` 防重複)+ 若有現成的 touchLastInbound 函式且是 inbound 訊息就呼叫。沒命中 → **不建卡、不存入 DB**,只在回應裡回報「未認領號碼」清單,由本機腳本自己寫進本地暫存檔案供 Jeff 之後查閱(理由見下方決策)。

### 決策(不停下來問,直接選,原因寫清楚):未認領號碼存哪裡

CLAUDE.md 傾向不做不必要的 migration,且「未知號碼」本質是暫存性質的資料(等 Jeff 認出是誰才有意義,認不出來的可能永遠是雜訊)。選擇:**不開新表**,server 端只回報給呼叫端,本機腳本自己把未認領號碼+時間戳(不含內容)寫進本地 `~/.packgo/imessage-unclaimed.json`,Jeff 要看就本機打開,認領後之後再手動處理(例如先用既有「新增客人」流程建卡補上這支電話,之後這支號碼的新訊息就會自動命中)。這條路徑最精簡、不生新表、也不需要一個新的認領 UI。

### 隱私硬要求(Jeff 明講,不可退讓)

只送「電話對得上 customerProfiles.phone」的完整內容(text)給 server;電話對不上的訊息,本機腳本**只送 phone + 時間戳,絕不送 text 內容**給 server(未認領號碼的訊息內容留在 Jeff 自己的 Mac 上,不上網路)。

### 本機同步腳本 `scripts/imessage-sync.mjs`

- launchd 每 5 分鐘,讀 `~/Library/Messages/chat.db`(唯讀開啟,避免鎖住 Messages.app)
- 游標:`~/.packgo/imessage-sync-cursor.json` 記錄上次同步到的 `message.ROWID`,每次只讀新的
- **Apple epoch 轉換是這次最大地雷**(呼應 Phase1a 已死過兩次的日期教訓):`message.date` 在新版 macOS(Big Sur 起)是「2001-01-01 UTC 起算的奈秒數」,舊版是「秒數」。純函式 `appleDateToIso(rawValue): string` 用數值量級判斷(奈秒值遠大於秒值,用一個明確閾值,例如 > 1e12 視為奈秒)並寫邊界測試(至少覆蓋:新版奈秒格式、舊版秒格式、2001-01-01 當天邊界值)。
- 只送「電話對得上」的完整訊息 + 「對不上」的號碼與時間戳(不含內容)。
- 只出站 HTTPS,token 從 `~/.packgo/local-script-token` 讀(跟 1b 共用同一個檔案/token)。

### 給 Jeff 的安裝說明(一頁,實作階段產出)

Full Disk Access(System Settings → Privacy & Security → Full Disk Access,把 Terminal/Node 加進去)、確認 iCloud Messages 同步已開(訊息才會在本機 chat.db 裡)、`launchctl load` 指令、`LOCAL_SCRIPT_TOKEN` 用 `fly secrets set` 產生與設定的指令、本機 token 檔案怎麼放。

### 驗收

- 電話對得上的簡訊 10 分鐘內出現在對應客人時間軸,時間戳是簡訊真實時間(不是同步時間)。
- 電話對不上的訊息,server 端資料庫完全查不到內容,只有本機 json 檔案有時間戳記錄。
- 重跑腳本(游標正常前進)不重複 ingest 同一則訊息。

## 共用基礎設施(兩個 Phase 都要,只做一份)

- token 驗證 helper(擴充 `verifyInternalAuth` 或新增小 helper,timingSafeEqual pattern,新 env var `LOCAL_SCRIPT_TOKEN`)。
- `server/db/customerProfile.ts`(或等價位置)的身分解析/建卡共用函式,create_customer 工具跟兩個新功能都呼叫同一份,不重複造。
- phone normalize 共用函式(1b 的建卡查重 + 1c 的 ingest 比對都要用同一套正規化規則,格式必須完全一致否則兩邊比對不到)。
