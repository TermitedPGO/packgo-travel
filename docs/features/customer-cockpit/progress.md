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

## Phase 2-6、收尾

尚未開始。裁示已收(2026-07-02):14 案存量進場 Jeff 先手拖 1-2 案驗流程(Phase1b 工具已就緒待 ship 後試跑)、Plaid 收款建議做、今日清單放中欄空狀態、報價出手前案子要在系統裡的規矩已立。Phase6 自我體檢範圍已擴充(月度 scorecard 桌機腳本 + 每週 0909 E2E canary 含新增客人鏈 + 每週正確性稽核回饋迴圈),詳見 `roadmap-100.md`。
