# 客戶頁衝 100 分 — 進度總覽

> 對應 `roadmap-100.md` 的九塊工作(Phase1-6 + 收尾)。監工看這份,不看實作細節;文件自稱完成不算數,以下每項都附驗證證據。

## Phase 1a:截圖/匯出檔進場升級(讀懂寫時間軸)— 已完成,待 ship

**做了什麼**:拖一張聊天截圖或匯出的聊天記錄 txt 進客戶頁聊天框,AI 現在會讀懂裡面的對話,判斷是不是跟目前這位客人的真實對話,把每則訊息用「對話裡的真實時間」(不是拖檔當下的歸檔時間)寫進 `customerInteractions` 時間軸 —— 不再只是存成一份文件。

**新增/修改檔案**:
- `server/_core/chatLogImport.ts`(新增)— 四個 export:`resolveEventDate`(日期年份推算純函式)、`classifyAndExtractChatLog`(LLM 讀懂對話+判斷對象是否相符)、`buildChatLogInteractionRows`(純函式組出要寫入的列)、`importChatLogForCustomer`(唯一碰 DB 的協調函式,含去重)。
- `server/_core/chatLogImport.test.ts`(新增,46 tests)。
- `server/_core/index.ts` — 接進 `/api/agent/ask-ops-stream` handler,`customerDocuments` 既有歸檔區塊之後,重用同一個 `persistProfileId`。
- `docs/features/customer-cockpit/roadmap-100.md` — Phase1a 打勾 + Jeff 2026-07-02 補的 Phase6 四項自我測試(月度scorecard/每週E2E canary含新增客人鏈/每週正確性稽核)。

**核心設計決策**:
- 日期年份推算 100% code 算(`resolveEventDate`),LLM 只負責讀出畫面上的日期原文——這個 repo 已經因為「歸檔時間冒充事件時間」死過兩次(commit 0fd04cf/5b021ca/d97dc33),這次刻意把數學和閱讀切開。
- 認人邏輯:只有畫面明確指名另一個具體的人時才判 mismatch 問 Jeff;沒看到名字或名字對得上一律放行,不製造假警訊(寧漏勿誤)。
- 去重鍵含時間戳(content+createdAt),同一句話不同時間說不會被誤殺;同一張截圖重複拖不會灌雙倍。

**驗證過程**:Workflow 四階段(實作 → 六路對抗式審查 → 修復 → 獨立驗收)。
- 六路審查抓到:認錯人風險 P1(客人卡沒填姓名時核對形同虛設)、prompt injection P1(轉述結果沒包隔離語句)、併發/去重 2 個真缺陷(批次寫入中途失敗吞掉已成功列、同內容不同時間誤判重複)、測試覆蓋缺口(核心 LLM 函式零測試)——全數 CONFIRMED 的 P1/P2 都已修復。
- 2 項留為已知限制,已記錄不阻擋上線:①同一張截圖幾乎同時拖兩次的競態(TOCTOU)需要資料庫唯一鍵,要走 migration 需要 Jeff 點頭,目前 Jeff 是唯一操作者、依序拖檔,實際觸發機率低;②LLM 呼叫在 SSE 串流開始前同步跑,截圖較長時聊天框會多等一下,真正修好要重構成 fire-and-forget,牽動 `[CHAT_IMPORT_RESULT]` 要在同一輪注入的架構,列為效能優化 backlog,非正確性缺陷。
- 額外自行修正(六路審查之後,獨立驗收之前):`no_messages` 且 `droppedCount>0`(讀到真對話但每則訊息日期都解析失敗)原本被歸類跟「不是聊天記錄」一樣靜默不提示,違反 `requirements.md` §六.4「不支援要提示,不准靜默」,已加一句明確提示 Jeff 截圖可能沒有可辨識的時間戳。

**最終驗證**(2026-07-02):`tsc --noEmit` 0 錯;`vitest run server/_core/chatLogImport.test.ts` 46/46 通過;完整套件 `vitest run` 277 files / 3887+ tests 全綠,無既有測試被波及。

**尚未做**:真實截圖端對端驗證(這批只有 unit test + mock,沒有真的拖一張截圖進 prod 聊天框跑過)。**Jeff ship 後**,建議挑 1 張真實微信截圖(或用 0909 測試客人)實測一輪,確認:①真的寫進時間軸且時間正確;②真相條有更新;③截圖裡沒對話內容時能正確判斷 not_a_chat_log。

**已知限制**(不阻擋上線,供之後決策):TOCTOU 併發競態(需 migration)、串流延遲(需架構重構)、非美式 DD/MM 日期格式會照美式慣例解讀(刻意取捨,PACK&GO 客群主要中英美式雙語)。

**狀態**:已上線 v781,prod 驗收由 Jeff 手拖截圖另行驗收(不在本檔重複記錄)。

---

## Phase 1b:存量案件批次進場(commit 9bda950)— 已完成,待 ship

**做了什麼**:admin-only 匯入端點 `/api/admin/import-case-file`(dry-run 預覽、confirm 才寫入)+ 本機腳本 `scripts/import-customer-cases.mjs`,讀桌面 `/Users/jeff/Desktop/Pack&Go/客人檔案/` 15 個案件資料夾的 `案件資料.md`,LLM 抽取客人身分/售價/關鍵日期,純 code 決定建卡/重用/擋下。

**新增/修改檔案**:
- `server/_core/caseFileImport.ts`(新增)— `extractCaseFields`(LLM 抽取)、`resolveOrIdentifyCustomer`(re-export)、`buildCaseImportPlan`(純函式)、`importCaseFile`(協調函式)。
- `server/db/customerProfile.ts`(新增)— 身分解析共用函式(`resolveOrIdentifyCustomer`、`normalizePhoneForMatch`),供 caseFileImport 與未來其他呼叫端共用。
- `server/_core/caseFileImport.test.ts`(新增,35 tests)。
- `server/_core/index.ts` — 新端點,擴充 `verifyInternalAuth` 加 `tokenEnvVar` 選項(新環境變數 `LOCAL_SCRIPT_TOKEN`,不與既有 `INTERNAL_TEST_TOKEN` 混用)。
- `scripts/import-customer-cases.mjs`(新增)— dry-run 全部 15 案彙整成表格,`--confirm=<folder>` 或 `--confirm-all` 才真的寫入。
- `docs/features/customer-cockpit/design-phase1bc.md`(新增,Stage2 設計文件)。

**關鍵發現(改變設計方向)**:掃描 15 個案件檔,發現多數案件檔裡沒有客人本人 email/phone/wechatId 實際值,只有姓名+渠道描述(如「微信」)。抓到的疑似聯絡方式常是供應商聯絡人(雄獅業務、UV 訂位信箱)或 Jeff 自己的電話。沿用既有 `create_customer` 工具規則:email 或 phone 至少一個才建卡,兩者皆無就 `blocked_no_identifier`,dry-run 清楚列出不靜默略過,不用資料夾名稱瞎猜身分硬塞。

**驗證過程**:Workflow 四階段。六路審查抓到並修復:
- **P0**:David 案件檔「對接人(客戶)」欄位寫著「David(微信);Jeff +1 (510) 634-2307」,Jeff 自己的電話混在客戶欄裡,舊 prompt 沒有排除業主本人聯絡資訊的規則,可能誤判成客人電話,導致不同案子都被誤判成同一人合併成一團亂帳。已修:prompt 加 Jeff 本人聯絡資訊反例(電話+email 字面值)+ 真實案件檔文字 fixture 測試鎖住。
- 已註冊會員 email 擋檔規則缺失:`resolveOrIdentifyCustomer` 原本沒有 `create_customer` 既有的「email 命中會員帳號就拒絕建訪客卡」規則,已補 `blocked_registered_member` 短路。
- `customOrders.notes` 查重用 LIKE 未跳脫萬用字元(`%`/`_`),folder 名稱含這些字元會造成誤判,已修(`escapeLikePattern` + ESCAPE 子句)。
- 同案多個「對外售價」候選(單項 vs 全案總價)口徑不一致,已定規則:優先填全案總售價,退而求其次才填單項並加 warning。

**已知限制**(不阻擋上線):同資料夾併發 confirm 的競態(TOCTOU)需要 DB transaction/唯一索引才能根治,需 migration,Jeff 手動逐一操作觸發面低,先不處理;`create_customer`(opsTools.ts)跟這次抽出的共用邏輯是兩份程式碼(刻意選擇,風險見 caseFileImport.ts 註解),日後其中一邊改規則要記得同步另一邊。

**最終驗證**:`tsc --noEmit` 0 錯;`vitest run` 278 files / 3922+ tests 全綠。

**尚未做**:單案 dry-run 給 Jeff 過目(Jeff 裁示要先看 1 案預覽 OK 才批次)——這一步需要 endpoint 上線後才能真的呼叫,本機無 DB 測不到真實效果。**Jeff ship 後**,下一步是用這個腳本對某 1 案跑 dry-run,把預覽貼給 Jeff 看,OK 才 `--confirm-all` 批次剩下 14 案。

**狀態**:code 完成、tsc+測試綠、已 commit,等 Jeff 跑 `pnpm ship` 上線。

---

## Phase 1c:iMessage 桌機同步(commit 63c14f2)— 已完成,待 ship

**做了什麼**:本機腳本 `scripts/imessage-sync.mjs`(設計給 launchd 每 5 分鐘跑)增量讀 `~/Library/Messages/chat.db`,電話對得上系統客人的訊息內容才送到 server 寫進時間軸;電話對不上的只送電話號碼+時間戳,絕不送內容(Jeff 明講的硬隱私要求)。

**新增/修改檔案**:
- `server/_core/appleEpoch.ts`(新增,15 tests)— macOS Messages 的 Apple epoch 時間格式轉換(2001-01-01 起算,新版奈秒/舊版秒),純函式 + 邊界測試(奈秒/秒交叉驗證、跨年邊界、2015/2035 合理年份窗邊界、起點值、超界值皆 throw)。
- `server/_core/imessageIngest.ts`(新增,13 tests)— `checkKnownPhones`(本機先問哪些電話是已知客人,只回子集合不回其他個資)、`ingestImessageBatch`(電話比對+跟 `followMergePointer`+`touchLastInbound`+externalId 去重)。
- `server/_core/index.ts` — 新端點 `/api/admin/imessage-check-known-phones` + `/api/admin/imessage-ingest`,沿用 Phase1b 的 `verifyInternalAuth` + `LOCAL_SCRIPT_TOKEN` pattern。
- `scripts/imessage-sync.mjs`(新增)— 游標記錄上次同步位置,只出站 HTTPS。
- `docs/features/customer-cockpit/imessage-sync-setup.md`(新增)— Full Disk Access、iCloud Messages 確認、launchd plist、token 設定說明。

**隱私機制**:本機腳本每次同步先呼叫 `imessage-check-known-phones` 只送電話號碼(不送內容)換回已知客人清單,組送往 `imessage-ingest` 的 payload 時,電話不在已知清單裡的訊息一律 `text: null`——這個判斷發生在組出陣列、丟進 `JSON.stringify`/`fetch` 之前,不是送出後才過濾。Server 端對查無 profile 的訊息也不落地寫入(defense-in-depth)。五路審查其中一路專門攻擊這個邊界,逐行追蹤資料流沒有找到「內容曾經組進送出 request body」的路徑。

**驗證過程**:Workflow 四階段。五路對抗式審查(隱私邊界/Apple epoch 數學/合併指標與去重/認證/紅線)**沒有發現任何 P0/P1**。修復 2 個 P2:未認領號碼「最後出現時間」統計因子集合判斷錯誤而失真(不涉及內容外洩,已修)、`checkKnownPhones` 與 `ingestImessageBatch` 內部電話查詢邏輯重複已抽共用函式。

**已知限制**(不阻擋上線):`imessage-sync.mjs` 手動複製了一份 `appleEpochToIso` 邏輯(而非 import,因為本機腳本是 plain Node.js 沒有走 TS 編譯),兩份邏輯目前逐字一致,已加雙向「DUAL-MAINTENANCE WARNING」註解提醒,但沒有測試鎖住 drift,真正解法要加 build step 消除雙份維護,超出本次範圍;`chat.db` 的實際欄位(`message`/`handle` 表結構)是依公開知識寫的假設,這台環境沒有真實檔案可驗證,腳本頭部與安裝說明都已列出假設,Jeff 首次跑前建議用 `sqlite3 ~/Library/Messages/chat.db ".schema message"` 核對;`normalizePhoneForMatch` 不處理國碼前綴(`+1` vs 無前綴)差異,方向安全(漏抓不洩漏)但功能面可能讓合法客人的簡訊被誤判未知。

**最終驗證**:`tsc --noEmit` 0 錯;`vitest run` 280 files / 3950+ tests 全綠。

**尚未做**:真機驗證(需要 Jeff 桌機的真實 chat.db、Full Disk Access、fly secrets 設定 `LOCAL_SCRIPT_TOKEN`)。**Jeff ship 後**,照 `imessage-sync-setup.md` 走一遍安裝流程,先手動跑一次腳本(不掛 launchd)確認 chat.db 欄位假設正確、電話比對抓得到既有客人,再上 launchd 排程。

**狀態**:code 完成、tsc+測試綠、已 commit,等 Jeff 跑 `pnpm ship` 上線。

---

## Phase 2:每個數字有出處(commit ce43265/d889fae/d8654cf)— 已完成,待 ship

三項任務全做,看門狗(`server/services/customOrderWatchdog.ts`)從兩種 finding(margin/promise)擴充成四種(margin/promise/invoiceMismatch/paymentMatch),同一套純函式風格延續:輸入已查好的資料、輸出 finding 或 null、資料不足就沉默不猜,零 LLM。

**2a 訂單金額對 invoice 看門狗**(commit ce43265):訂單掛的發票/確認單文件總額跟系統 `totalPrice` 對不上時跳黃卡,兩數字並排。`extractInvoiceTotal` 用錨點詞(total/合計/amount due 等)找金額,只認 USD,0 個或多個不同候選就沉默。重現 scorecard 真實案例($6,635 vs $6,621.40 正確跳黃卡)。審查抓到 2 個 P1 已修:雙幣別文字(「Grand Total: NT$172,600 (approx US$5,393)」)裡合法 USD 金額被連坐跳過誤漏抓;「total number of travelers: 4」這種計數語境的「total」被誤判成金額(誤報方向,比漏報更危險)。全形數字留為已知限制(方向安全)。

**2b supplierCost 搬運收緊**(commit d889fae):`create_custom_order`/`update_custom_order` 原本已有 `supplierCost` 參數但零驗證,LLM 可填任何數字直接寫進 DB。收緊成:填 `supplierCost` 必須帶 `sourceDocId`(指向已上傳的供應商文件),server 驗該金額真的出現在文件文字裡才收,對不上或沒帶 `sourceDocId` 一律拒絕該欄位(其餘欄位正常寫入,不整單失敗)。跨客戶守門(文件必須屬於同一客人)+ PII 文件排除(passport/visa/insurance/medical 不可當佐證)。審查四角度全部核實邏輯正確,唯一修正是 schema 註解措辭過度宣稱(「只能透過這兩個工具寫入」需明確排除 Jeff 本人在 admin 後台的既有手動輸入路徑)。

**2c Plaid 收款建議**(commit d8654cf):近 30 天 Plaid 銀行流水入帳金額吻合某張未收款訂單時跳黃卡建議,Jeff 一鍵確認才算數,AI 絕不自動標記付款。核心地雷是 `bankTransactions.amount` 正負號(正=支出、負=入帳),審查獨立驗算過方向守門跟「AI 絕不碰錢」邊界都沒有破口。抓到並修復 2 個真缺陷:同額候選分組沒區分 deposit/balance/total 導致巧合同額的無關訂單被誤湊成一組候選;bankTransactions 查詢沒排序導致同日期多筆交易命中同一單時「取最新」的判斷結果不穩定(已加 orderBy)。

**最終驗證**:三批合計 tsc 0 錯,`customOrderWatchdog.test.ts` 從 21 個測試累積到 97 個,完整套件從 3887 累積到 4025 測試全綠,i18n 兩語言檔全程對稱。

**已知限制**(不阻擋上線):2a 對全形數字/貨幣符號不辨識(漏判方向安全);2b 的 admin 後台表單手動輸入 `supplierCost` 不受這層驗證約束(Jeff 本人核對,非本次收緊範圍);2c 未落地任何比對狀態,每次都是即時查詢(公司量級下無效能疑慮)。

**尚未做**:三項都只有 unit test + mock,沒有真實文件/真實 Plaid 資料在 prod 跑過。**Jeff ship 後**,建議挑一張真實 invoice PDF 掛在某訂單上驗 2a、挑一筆真實入帳驗 2c。

**狀態**:code 完成、tsc+測試綠、已 commit,等 Jeff 跑 `pnpm ship` 上線。

---

## Phase 3:草稿誠實度收尾(commit b7a32aa / 2c350e8)— 已完成,待 ship

**3a 承諾追蹤**:寄信成功後(`escalationBox.ts` 的 `sendEscalationReply`,唯一寄信路徑)fire-and-forget 抽出信文裡對客人的時間承諾,日期年份推算 100% 複用既有 `resolveEventDate`(`chatLogImport.ts`),LLM 只回原文字串。新表 `customerPromises`(migration 0110)存承諾,看門狗新增第五種 finding kind `commitment`:到期未兌現/未撤銷才跳黃卡,抽不出日期的承諾照存但永不叫。新工具 `mark_promise` 讓 Jeff 在聊天裡口頭兌現/撤銷,跨客戶守門沿用既有工具的釘住客人模式,AI 絕不自動標記。

migration 特別決策:0104-0109 的先例都是欄位新增用 INFORMATION_SCHEMA+PREPARE 包裝,但這次是新表,改用原生 `CREATE TABLE IF NOT EXISTS`(TiDB 支援,不需要 PREPARE)——這個 repo 有真實 P0 事故案例(migration 0070 的 PREPARE 包裝在 TiDB 上靜默 no-op),同一個冪等精神套用在正確的 DDL 語法上,不盲目照抄舊例。

四路對抗式審查:migration 安全性、日期數學/查重零缺陷;抓到並修復一個真 race condition(P1)——原本用「查最新一筆 interaction」代替 insert 回傳 id 當 sourceInteractionId,同客人短時間並發寫入可能配錯來源信,已改讓 `recordOutboundEmailInteraction` 直接回傳 insertId 從根拔除。

**3b 月度草稿評分**:把 6/25 那次一次性 eval 正式入庫成每月自動跑的機制。近 30 天有真實往來的客人取最多 10 位,重生草稿走既有 `runInquiryAgent`(純函式零副作用,不落地不寄),3 個獨立評審 LLM 各自打分,聚合規則「任一評審標記三宗罪就算命中」。分數寫進 `eval-history.md` 每月追加一節,劣化(比上月掉 1 分以上)寫一張 office inbox 卡標 high priority。cron 照抄既有 weekly-retrospective/daily-summary 的 repeatable job 寫法,排每月 1 號 03:00 UTC。三路對抗式審查零 CONFIRMED 缺陷——特別驗證過整條呼叫鏈沒有任何路徑呼叫寄信函式或把重生草稿寫進客人看得到的地方。

**最終驗證**:3a tsc 0 錯 + 全套 4063 測試綠;3b tsc 0 錯 + 全套 4080 測試綠。

**已知限制**:3a 未處理「同一 profileId 短時間內連續寄兩封信」的並發窗口(機率極低,未加鎖);3b 首次跑無上月資料時劣化偵測正確不觸發。

**狀態**:code 完成、tsc+測試綠、已 commit,等 Jeff 跑 `pnpm ship` 上線。

---

## Phase 4:今日清單(commit 4029fe2)— 已完成,待 ship

**做了什麼**:中欄沒選客人時的空狀態改成今日清單:到期跟進、報價將過期(11/13/14 天門檻)、承諾未兌現(直接複用 Phase3a 既有邏輯不重寫)、出發倒數(精確 T-30/T-7 視窗)、尾款到期(0-30 天範圍)。全部零 LLM 純規則計算,任何欄位缺值就跳過該項不猜。點擊每項複用既有 `onSelect`/`setSelected` 選客機制,不發明新路由。清單空時維持原空狀態文案加一句提示。

**驗證過程**:三路對抗式審查抓到並修復兩個真缺陷:①日期換算用 UTC 曆日切片而不是既有的 LA 時區換算,`todayLA()` 本身是對的但訂單的 `quoteSentAt`/`depositPaidAt`/`balancePaidAt` 三個時間戳沒有跟著用 LA 換算,太平洋時間傍晚到午夜這段窗口(對應 UTC 隔天凌晨)會讓天數算多一天,已改用既有 LA 時區換算寫法對齊;②報價將過期規則原本只排除 draft/cancelled,客人已經回覆進入 arranged/deposit_paid 等後續狀態的單只要 `quoteSentAt` 沒清空就會永久誤報,已改成只認 draft/quoted 這兩個報價確實還在等回覆的狀態。

**最終驗證**:tsc 0 錯,`todayList.test.ts` 34 個測試(含 11/13/14 天、精確 30/7 天、0-30 天三組邊界)+ 全套 4115 測試綠,邊界案例經獨立手算驗證。

**已知限制**:承諾未兌現查詢無分頁上限(一人公司資料量下無疑慮);查詢失敗與「今天真的沒待辦」在 UI 上呈現相同(靜默降級,跟既有看門狗面板同一慣例)。

**狀態**:code 完成、tsc+測試綠、已 commit,等 Jeff 跑 `pnpm ship` 上線。

---

## 任務0:承諾日期解析三層修復(P1 prod 事故,commit 8323d65)— 已完成,待 ship

**做了什麼**:prod `customerPromises` id 1、2 的 `dueDate` 全 `null`(監工實測抓到),根因是 LLM 抽出的 `rawDateText` 帶「7/8之前」「今天(星期五)」這種修飾詞/附註,`resolveEventDate` 認不得整條判 `null`,看門狗承諾追蹤功能核心落空。三層修復:
1. `promiseExtraction.ts` 的 `EXTRACT_SYSTEM` prompt 教 LLM 只回日期本體,拿掉之前/以前/左右/前後/大概/最晚/預計等修飾詞與「(星期X)」附註。
2. 新增 `stripDateModifierSuffix`(純函式,`buildPromiseRows` 呼叫 `resolveEventDate` 前先剝)——**迴圈剝**(不是單次 pass),防「7/8(星期三)之前」這種括號+修飾詞疊加組合漏網;涵蓋簡繁修飾詞、開頭概數詞(大概/最晚/預計)、尾端語氣詞(吧/囉)。
3. `resolveEventDate`(`chatLogImport.ts`)新增純 code 相對日推算:今天/明天/後天、星期X(=下一個該星期,含今天)、下週X(=一定跨過本週)。

**額外發現並修的深層 bug**:`resolveEventDate` 原本只有「past bias」(chatLogImport 的回溯語意:日期換算成今年若落在未來就當作去年),但承諾到期日是**未來導向**——沿用 past bias 會把「7/8」(今天 7/3 之後 5 天)誤判成去年同期,整整錯一年。新增 `opts.bias`("past" 預設 / "future"),`promiseExtraction.ts` 改用 future bias。既有 2 參數呼叫(chatLogImport 自己)行為完全不變。

**對抗審查(六路)抓到並修復**:
- P1:兩個 bias 分支的「換算年份」fast path 都沒有驗證換算後的年份是否合法——閏年 2/29 換算到非閏年會吐出不存在的日期(如 2029-02-29)寫進 DB。已修:兩分支都補上驗證,不合法就回 `null`。
- P1:`stripDateModifierSuffix` 單次 pass 剝不掉疊加修飾詞(括號+尾綴組合)。已修:改迴圈剝到收斂。
- P2:mark_promise 工具描述過時(還提「read_customer_conversation 讀到的承諾清單」,已改指向新工具)。
- P2/P3:多項測試覆蓋缺口(空字串 after 剝除、weekday regex 亂碼容錯)已補測試。

**驗證**:`tsc --noEmit` 0 錯;`chatLogImport.test.ts` 68 test、`promiseExtraction.test.ts` 33 test 全綠;完整套件 285 files / 4192 tests 全綠。

**已知限制**:跨年邊界的「近期過去」判斷(例:今天 1/2、承諾寫 12/30)目前一律往未來滾一年(~11 個月後),這是「promise 不可能已經過期」規則下唯一合理選擇,但比較極端;真正嚴謹解法要改成「取離今天最近的候選日期」而非單純二元前後判斷,牽動共用函式,列為 backlog、非本次阻擋項。自然語言修飾詞覆蓋仍非窮舉(例如「禮拜五(7/10)之前」這種嵌套會漏),已擴大覆蓋但非 100%。

**尚未做**:真實 prod 資料回填(舊 2 列 dueDate 仍是 null,不回填,是測試資料;下一則真實承諾寄出後應該正確解出到期日,建議 ship 後用 0909 測試一輪)。

**狀態**:已 commit,待 `pnpm ship`。

---

## 任務0b:list_customer_promises 唯讀工具(commit 323d92e)— 已完成,待 ship

**做了什麼**:補缺口——mark_promise 需要 `promiseId` 但 LLM 之前完全沒有管道查到,只能用猜的編號(違反工具描述自己講的規矩)。新增唯讀工具 `list_customer_promises`,列出「目前釘住的這位客人」未兌現/未撤銷的承諾(id + 原文 + 到期日 + 來源信日期)。`executeReadTool`/`runTool` 加第三個 `profileId` 參數(呼叫端傳入釘住的客人,不是 LLM input 的一部分)——跨客戶守門沿用 `mark_promise` 同款模式。`opsAgentStream.ts` 的 staticSystem 教學段落同步:Jeff 說「兌現了」→ 先 list 再 mark_promise。

**對抗審查抓到並修復**:mark_promise 描述過時已同步更新(見上);測試補強兩項——① 原本只驗證 schema 沒有 `profileId` 欄位(靜態），加一條驗證**執行期**真的用釘住的 profileId、忽略 input 裡假冒的編號；② 補 `get_customer_documents` 的雙來源 profileId 回歸測試（避免未來把「LLM 指定」跟「呼叫端釘住」兩種來源搞混）。

**驗證**:`opsTools.test.ts` 138 test 全綠(新增 8 個)。

**狀態**:已 commit,待 `pnpm ship`。

---

## 任務5:學習閉環 caseLearnings(commit 177448d)— 已完成,待 ship

**做了什麼**:案子完結(completed/cancelled)時 fire-and-forget 蒸餾一條「這一類案子」可複用教訓(供應商雷/路線經驗/定價經驗),存新表 `caseLearnings`(migration 0111,沿用 0110 的 `CREATE TABLE IF NOT EXISTS` 原生 DDL 決策,新表不套 ALTER TABLE 的 PREPARE 包裝)。

三層職責分離(照抄 `promiseExtraction.ts` pattern):`extractCaseLesson`(LLM best-effort)→ `buildCaseLearningRow`(純函式)→ `distillCaseLearning`(唯一碰 DB 的協調函式,查重短路——一張單只蒸餾一次)。**PII 紀律**:lesson 文字不寫客人真實姓名,一律用「某 12 月北海道家庭案」式指代(prompt 規則,internal admin-only)。

**Hook 點**:`adminCustomerOrders.ts` 的 `updateStatus`(轉 completed/cancelled)與 `cancel` 兩個既有狀態轉換點,fire-and-forget 不擋主流程(照抄 `escalationBox.ts` 的 fire-and-forget 寫法)。**晚間批次補漏**:新 cron `case-learning-backlog-tick`(04:00 UTC daily,`server/queue.ts` + `server/caseLearningWorker.ts`,照抄 `duplicateProfileScanWorker.ts` 的 Queue+Worker+schedule 三件套),掃近 7 天完結單,查重補漏。

**注入**:`buildCustomerChatContext` / `buildGuestChatContext`(`customerChatContext.ts`,即 ops chat 的「目前釘住客人」context block,不是客人自己的網站聊天)在客人有進行中訂單(非 draft、非終態)時,查同 caseType(+目的地有值一併比對)的教訓取最新 3 條,獨立 cap(800 字)不搶主 block 額度,照 `formatMemoryBlock` 慣例包成不可執行的參考資料標「【同類案過往教訓(內部參考)】」。**誠實邊界**:教訓庫空 / 沒有進行中訂單 / 蒸餾失敗 → 一個字都不注入,絕不硬湊。

**驗證**:`caseLearning.test.ts` 30 個新測試全綠;完整套件 tsc 0 錯 + 4192 測試全綠。

**已知限制**:
- caseType/destination 用字面完全比對(exact string equality),無同義詞/模糊比對——不同措辭的同目的地(如「北海道」vs「Hokkaido」)不會互相匹配。
- 真實效果目前系統裡完結案太少驗不出來,要等 14 案存量匯入 + 一段時間累積後由監工驗。
- 晚間批次補漏的 `runCaseLearningBacklogScan` 沒有對批次本身的失敗發 office inbox 卡(靜默 log,跟其他背景 scan 一致慣例)。

**狀態**:已 commit,待 `pnpm ship`。

---

## 任務7:網站渠道進場(commit f50a0ae)— 已完成,待 ship

**做了什麼**:監工稽核發現的 Phase1 遺漏——網站詢問表單、站內留言、訂票事件完全沒有跟 customerProfiles/customerInteractions 串起來,這些客人在 /ops/customers 完全不存在(沒有真相條、沒有紅點、沒有時間軸),即使已經真實聯絡過我們。

新模組 `server/_core/websiteIntake.ts`:
- `ensureCustomerProfileForWebsiteContact` — 確保聯絡人有卡。已登入用戶走既有 `ensureProfileId`;訪客走既有 `resolveOrIdentifyCustomer` 查重(existing/creatable/blocked_registered_member/blocked_no_identifier 四態全處理,email 撞到已註冊會員一律掛回會員自己的卡,絕不建平行訪客卡)。
- `recordWebsiteInteraction` — 寫一筆 `channel=web_form` 的互動,inbound 方向順手 `touchLastInbound`。
- `formatBookingInteractionContent` — 純函式組訂票事件時間軸文字(團名/出發日/人數/已付金額,確定性事實不是 LLM 生成)。

三個掛鉤點,全部 fire-and-forget:`inquiries.ts` 的 `create`/`createEmergency`(表單送出)、`addMessage` 客人分支(站內留言;admin 回覆分支不用動,既有 `sendAdminInquiryReply` 的 `recordOutboundEmailInteraction` 在客人有卡之後會自動開始運作,免費撿到)、`stripeWebhook.ts` 的 `handleCheckoutSessionCompleted`(訂票付款成功)。

**任務7a 的一個裁示已跟 Jeff 確認**:任務描述原本假設「approvalTasks lane=cs 網站詢問 AI 草稿按 email 對卡,建卡後自動串起」,實際查程式碼發現目前完全沒有自動觸發(草稿只在指揮中心手動點才生成)。跟 Jeff 確認後裁定:只做建卡+互動+紅點,不擴大範圍去接自動草稿觸發。

**對抗審查(五路)抓到並修復**:
- P2:`resolveOrIdentifyCustomer` 查重比對沒有 lowercase email,跟 `websiteIntake.ts` 建卡時的正規化不一致,只是恰好被 DB 預設 collation 蓋住沒爆出來——已修 + 補測試。
- P2:`stripeWebhook.ts` 新區塊原本直接 await,會在 Stripe webhook 回應路徑疊加 5-6 個序列 DB 往返拖慢每筆付款的 200 回應——改成 fire-and-forget(這段純粹是駕駛艙錦上添花,不是付款流程需要的東西)。
- P1:`stripeWebhook.ts` 新邏輯原本零測試覆蓋——補進既有 `stripeWebhook.bookings.test.ts`(mock websiteIntake,驗 happy path 有叫、tx 回滾時沒叫)。

**已知限制(P1,已 spawn_task 開獨立任務,非本次範圍)**:`resolveOrIdentifyCustomer` 的「先查後插」是 TOCTOU race,`customerProfiles.email` 沒有 DB 唯一索引,這是既有架構缺口(`caseFileImport.ts`/`opsTools.ts` 的 `create_customer` 早就有這個洞,本來只有低並發真人操作路徑會踩到)。這次任務7新增三個公開網路可觸發的 fire-and-forget 呼叫點(inquiries 表單/站內留言/訂票),把觸發機率拉高了。根治需要加唯一索引 + 清理既有重複資料 + 多處 insert 改查重插入,是牽動多個既有呼叫點的中大型變更,獨立評估風險比較安全,已用 spawn_task 開一張獨立任務卡等 Jeff 決定要不要單獨排。

**其他已知限制**:創立客人卡片時仍是「先 SELECT 後 INSERT」兩步驟(同上一條根因);站內留言/訂票內容目前只給 Jeff 內部看(customerInteractions 從不對客人可見),沒有額外 PII 疑慮。

**驗證**:`tsc --noEmit` 0 錯;新增 34 個測試(websiteIntake 20 + inquiries 6 + stripeWebhook 2 + customerProfile casing 2 + 既有測試強化);完整套件 4220 測試綠。

**尚未做**:真實 prod 驗證(需要 Jeff ship 後,用測試身分在 prod 網站送一筆測試詢問,驗卡即時出現+紅點亮+草稿掛在卡上;訂票驗證建議用測試訂單走一次 Stripe checkout)。

**狀態**:已 commit,待 `pnpm ship`。

---

## 任務7 對抗審查修復:customerProfiles race condition — 已完成,待 ship

**起因**:任務7(網站渠道進場)對抗審查抓到既有架構級 race:`resolveOrIdentifyCustomer` 是「先 SELECT 查重、呼叫端再視情況 INSERT」的兩步驟模式,`customerProfiles.email` 只有一般索引不是 UNIQUE,兩個近乎同時的請求對同一個新 email 會都看到「查無此人」然後都各自 INSERT,建出重複客人卡(Emerald Young 那個 bug class)。原本低並發、真人手動的呼叫點(opsTools/caseFileImport)風險小,但任務7新增的 `inquiries.ts`(create/createEmergency/addMessage)+ `stripeWebhook.ts` 訂票事件都是網路對外、真的可能並發觸發的路徑,把觸發機率拉高。

**原定修法(已否決)**:`customerProfiles.email` 加 DB UNIQUE 索引 + 一次性清查合併存量重複。**監工裁決否決**:0109 合併設計刻意保留來源卡(被併走)的 email 欄位不清空,讓歸檔入口(收信/寄信/附件/詢問)之後還能靠 email 找到那張卡再跟 `mergedIntoProfileId` 指標走到最終卡——同一個 email 對到多張卡是這個架構內合法、預期的狀態(不是資料損壞),UNIQUE 索引不只會讓 migration 在既有存量上直接失敗,之後**每一次**正常的人工合併(Jeff 手動併卡)都會因為來源卡保留 email 而立刻違反這個約束。DB 層的根治(虛擬欄位 `canonicalEmail`,只在「活躍、未被併走」時有值 + 對那個虛擬欄位加 UNIQUE)技術上可行但需要先癒合存量、且是全新設計,另立獨立任務,不夾帶進這次修復。

**實際修法(兩層)**:
1. **應用層(次要,defense-in-depth)**:`server/db/customerProfile.ts` 新增 `insertCustomerProfileSafely(db, values, conflictColumn)`——insert 失敗時 catch 重複鍵錯誤(ER_DUP_ENTRY/1062),依 `conflictColumn`("email" 或 "userId")re-select 拿贏家那筆的 id(跟 0109 mergedIntoProfileId 指標走到最終卡),不 bare insert。已套用到全部 13 個目前存在的 `insert(customerProfiles)` 呼叫點(`websiteIntake.ts`、`caseFileImport.ts`、`customerAiSummary.ts` 的 `ensureProfileId`、`opsTools.ts` 的 `create_customer`、`adminCustomers.ts` 三處、`agent/_shared.ts`、`agent/demo.ts`、`agent/profiles.ts` 的 `upsertByIdentifier`(bespoke retry,查重條件橫跨 6 個 identifier 不是單一欄位)、`gmailPipeline.ts`、`customerUnread.ts`、`db/customOrder.ts`)。**注意**:對 `conflictColumn:"email"` 這個分支目前是死碼——因為沒有 UNIQUE(email) 就不會真的丟 ER_DUP_ENTRY——只有 `conflictColumn:"userId"` 是真的在防線上(uq_cp_user 是既有真實約束,migration 0064)。
2. **真正的 race 防線**:`server/db/customerProfile.ts` 新增 `withCustomerIntakeLock(email, fn)`——Redis per-email 鎖(key `intake-lock:<email>`,`SET NX EX 30`,亂數 lockVal + Lua compare-and-delete 安全釋放),照抄既有兩個成例:`server/_core/auditLog.ts` 的 `withAuditLogTip`(acquire→fn→finally 釋放的骨架)+ `server/agents/autonomous/gmailPipeline.ts` 的 `processWithMessageLock`(Redis 掛時 fail-open,絕不讓客人流程因為 Redis 故障卡住)。跟兩者不同的地方:鎖被佔用時(不是 Redis 錯誤,是真的有人在跑)不能像 gmailPipeline 一樣直接跳過(呼叫端必須拿到一個真的 profileId),也不能像 auditLog 一樣直接不受保護硬闖——而是短暫等待(400ms,讓對方的 select+insert 跑完)後讓 `fn()` 自帶的 `resolveOrIdentifyCustomer` 重新查一次再決定。只套用在 `websiteIntake.ts` 的 `ensureCustomerProfileForWebsiteContact`(監工明確指定的範圍)——這一個函式是 `inquiries.ts` 三處 + `stripeWebhook.ts` 全部任務7新公開路徑唯一共用的進場點,修這裡就覆蓋了那次 review 真正擔心的觸發面;其餘 12 處(opsTools/caseFileImport/adminCustomers/agent 系列/gmailPipeline/customerUnread/customOrder)沿用一貫的低並發假設(真人手動 or agent 依序執行 or 已被 uq_cp_user 保護),沒有加鎖。

**驗證**:`server/db/customerProfile.test.ts`(19 tests,含 `withCustomerIntakeLock` 的 acquire/release、鎖被佔用等待後仍執行、Redis 掛掉 fail-open、fn 拋錯仍正確釋放鎖、release 本身失敗不影響回傳值五種情境)、`websiteIntake.test.ts`(22 tests,含新增「guest 路徑真的被 lock 包住、logged-in 路徑不碰鎖」兩條)、`opsTools.test.ts`(139 tests)、`caseFileImport.test.ts`(38 tests)、`customerAiSummary.test.ts`(24 tests)、`customerUnread.test.ts`(12 tests)、`server/routers/agent/_shared.test.ts`(3 tests,新檔)、`server/routers/agent/profiles.test.ts`(4 tests,新檔)全綠;`tsc --noEmit` 0 錯;完整套件 289 files / 4245 tests 全綠。

**已知限制 / 未做**:
- `adminCustomers.ts` 三處(`markNotCustomer`/followUpDate 設定/`createManualCustomer`)、`agent/demo.ts`、`gmailPipeline.ts` 的新 sender 建卡邏輯目前**沒有專屬單元測試**(這幾個檔案本身就沒有既有 router/pipeline 級測試骨架,要蓋滿需要 mock 6+ 個 collaborator,跟這次修復的體積不成比例,列為獨立 follow-up,見 task list)。
- DB 層根治(`canonicalEmail` 虛擬欄位 + UNIQUE)另立獨立任務,需先設計「怎麼癒合存量重複」再動工,這次不夾帶。
- 監工裁決最後一段提到「7a 其餘要求不變:查卡不分 status/userId → resolveCanonicalForFiling、摘要含本文、#2730002 併回」——分工已確認(監工回覆):
  - **查卡不分 status/userId**:監工確認 f4385aa 已做到(`resolveOrIdentifyCustomer` 的 SELECT 沒有 `status`/`userId` 過濾,靠 `followMergePointer` 走到 canonical),本 session 補一條明確的回歸測試鎖住這個不變量(`server/_core/caseFileImport.test.ts` 的「2026-07-03 監工確認 — the dedup query does NOT filter out a merged-away (status=blocked) row」)。
  - **摘要含本文**:`server/routers/inquiries.ts` 的 `create` procedure → `ingestWebsiteInquiryContact` → `recordWebsiteInteraction` 呼叫處,`contentSummary` 原本只放 `input.subject`(prod 實例:時間軸只顯示「客製旅遊」看不出客人問了什麼),改成 `${subject}:${message 前120字}`,`content` 維持表單全文不變(`createEmergency` 共用同一個 helper,一併修好)。
  - **#2730002 併回 + 監工重測**:歸監工,ship 後執行,這次不動。

**驗證(本輪追加)**:`caseFileImport.test.ts`(39 tests,+1)、`inquiries.test.ts`(16 tests,+1,更新 1)全綠;`tsc --noEmit` 0 錯;完整套件 289 files / 4247 tests 全綠。

**狀態**:已 commit(7f0f1d6),待 `pnpm ship`。

---

## 兩個平行 session 分工收尾 + merge(2026-07-03,commit 28e62c6/d715280)

**背景**:任務7對抗審查抓到的 customerProfiles race condition(見上方兩節)由監工同時派給兩個平行 session 處理——另一個 session 在側分支 `claude/musing-pike-fa2a7f` 完成 Redis 鎖修復(f4385aa)+ 分工收尾(7f0f1d6),本 session 同時也在 main 上收尾任務7。監工發現另一個 session 的修復停在側分支沒併回 main,指示本 session 完成三件事:merge 回 main、補完監工交辦的殘留項、驗證後給 ship 指令。

**做了什麼**:
1. `git merge --no-ff claude/musing-pike-fa2a7f`(28e62c6)——只有 `progress.md` 有文字衝突(兩節都是有效的歷史記錄,合併時前後接續保留,不是邏輯衝突),程式碼檔案全部乾淨自動合併。
2. 補漏:另一個 session 的「摘要含本文」只修了 `create` procedure,`addMessage` 客人站內留言分支同一個問題沒補——已補上(commit d715280),測試同步更新。
3. 順手修一個只有在完整套件(289 檔)系統負載下才會浮現的測試 flake:`stripeWebhook.bookings.test.ts` 原本用固定 `setTimeout(0)` 等 fire-and-forget IIFE 結算,單獨跑穩、大套件跑會偶發漏等——改用 `vi.waitFor` 輪詢正向斷言,負向斷言(結構性保證,不是競態)維持固定等待。

**教訓(供之後參考)**:兩個平行 session 同時在同一個 repo 工作,若沒有明確切成不同分支/worktree 或明確分工邊界,容易互相踩(本次是同一個檔案兩邊都改、同一個 progress.md 段落兩邊都寫)。監工派工時最好明確講清楚「這個修復哪個 session 負責 commit + merge」,避免兩邊都做完後才發現要花額外工夫合併。

**驗證**:`tsc --noEmit` 0 錯;完整套件連跑兩次穩定 289 files / 4248 tests 全綠,無 flake。`git log main` 已含全部 10 個本批 commit(8323d65 起到 d715280)。

**狀態**:已 commit,待 `pnpm ship`。

---

## Phase 6、收尾 — 已完成(2026-07-03,監工派工單 dispatch-phase6.md,commit 6662c2e/cc073d0/aef0960/1bc4296)

裁示已收(2026-07-02,詳見 `roadmap-100.md`)+ 監工 2026-07-03 正式簽發派工單(`docs/features/customer-cockpit/dispatch-phase6.md`),四塊(A清舊帳/B專案歸屬/C收斂/D自我體檢)依序 A→B→C→D 完成,每塊獨立 workflow 四階段(實作→對抗審查→修復→驗收),已逐批 merge 回 main。完整交付清單、逐塊對抗審查結果、偏離申報、已知限制、待 Jeff 手動清單見完工報告:`docs/features/customer-cockpit/t6-report-20260703-phase6.md`。

**摘要**:
- **A(6662c2e)**:自家信跳過LLM分類、列表最後往來口徑、nav badge視窗對齊(對抗審查抓到1個真缺陷已修)、escalationBox回信後摘要刷新、釘住客人時create_customer工具歸位、測試帳號排除helper、update_customer_note append回歸測試確認。
- **B(cc073d0)**:收信自動歸屬customOrderId(共用純函式,不確定=NULL規則)、聊天手動掛單新工具、chip scope(選專案預設只看該單)、存量回填端點。對抗審查抓到2個真缺陷已修(同thread衝突歸屬非決定性、聊天工具缺終態訂單守門)。
- **C(aef0960)**:workspace客人UI退役(刪19個檔案),唯一入口`/ops/customers`。三個已知陷阱(EscalationReplyDialog/AutoSendPolicyCard/CustomerChat同名異檔)全部正確保留,零orphan reference,對抗審查零真缺陷。
- **D(1bc4296)**:每週正確性稽核cron(週一12:00UTC,零LLM)+ 每週0909表單版canary(週一13:00UTC,真實HTTP路徑)。對抗審查聚焦自動化安全(零寄信/零LLM路徑逐路徑追蹤),抓到1個真缺陷已修(gatherCustomerFacts內部錯誤被靜默吞掉,原本的錯誤處理形同虛設)。**D3(月度scorecard桌機腳本)依派工單允許順延,待下一批**。

**驗證**:四塊合計 tsc 0 錯 + 全套 vitest 293 files / 4335 tests 綠(含過程中修好一次跟本批程式碼無關的 node_modules 環境問題)。i18n 100% parity。零硬紅線違反。

**待 Jeff 手動**:`pnpm ship`、D1/D2 首跑觀察 office inbox、B4 存量回填先 dry_run 再 confirm、D3 待另開一批。完整清單見 T6 報告第 6 節。
