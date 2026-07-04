# 完工報告:Phase 6 收官批(A清舊帳 / B專案歸屬 / C收斂 / D自我體檢)

## 1. 交付清單

| commit | 內容 | 檔案數 |
|---|---|---|
| `6662c2e` | 6A 清舊帳小修(A1-A7 七項) | 19(3 新增) |
| `cc073d0` | 6B 專案歸屬(B1-B4 四項) | 21(4 新增) |
| `aef0960` | 6A 收斂 — workspace 客人 UI 退役 | 23(19 刪除,2 改,2 i18n) |
| `1bc4296` | 6D 自我體檢(D1+D2;D3 順延) | 9(6 新增) |

全部四個 commit 已在 `claude/musing-pike-fa2a7f` 分支上線性排列,已 `git push origin claude/musing-pike-fa2a7f:main` 逐批 merge 回 main(每批都先驗證乾淨才 push)。`git log origin/main` 目前 HEAD = `1bc4296`,含全部本批 commit。

## 2. 自測證據(逐條可稽核)

**tsc**:`NODE_OPTIONS="--max-old-space-size=6144" npx tsc --noEmit` — 每個 commit 前都跑過,0 錯。最終狀態(main HEAD `1bc4296`)獨立重跑一次:0 錯。

**vitest**:每個 commit 前都跑過全套 `npx vitest run`,最終狀態:**293 files 全過 / 11 skipped(304 總數),4335 tests 全過 / 91 skipped**(304 檔數含 Block A/B/C/D 各自新增測試檔)。過程中發現一次環境問題(見「已知限制」),已排除。

**對抗審查**(每塊獨立 workflow,三路平行:regression/red-line/adversarial,common 硬紅線六條全程覆蓋):

| 塊 | 真缺陷數 | 分類 | 修法一句話 |
|---|---|---|---|
| A(7項) | 1(A3) | 執行者失誤(dispatch 講「對齊視窗」,實作只對齊 ORDER BY+LIMIT,漏對齊 WHERE population) | 移除 customerUnreadCount guest 子查詢多餘的 `lastInboundAt IS NOT NULL` 過濾,讓兩查詢在同一個母體上排名 |
| B(4項) | 2(B1、B2) | B1=不可預知(同 thread 衝突歸屬是資料狀態邊界案例,語意層面沒明顯提示);B2=prompt 可防(派工單只寫「照抄跨客戶守門」,沒明講要比照 UI 既有的終態守門) | B1:sibling 查詢加 `ORDER BY asc(id)` 讓最早的贏,消除非決定性;B2:補終態(cancelled/completed)守門 |
| C(UI退役) | 0 | — | 三個已知陷阱全部正確處理,零 orphan reference,一路 CONFIRMED-CORRECT |
| D(D1+D2) | 1(D1) | 不可預知(`gatherCustomerFacts` 內部把錯誤靜默吞成 `EMPTY_FACTS` 不會真的 throw,這是既有函式的內部行為,不是這次新寫的邏輯,審查追蹤到很深才發現原本的 try/catch 形同虛設) | D1 新增 `isEmptyFacts()` 判斷,「疑似出錯」跟「一般 mismatch」分兩種訊號呈現,不再混淆誤報 |

四塊合計:4 個真缺陷,全部修復;0 個硬紅線違反(六條逐塊逐路徑核對,含 B2/B3 的跨客戶隔離、D1/D2 的零 LLM/零寄信路徑)；0 個 scope creep(超出派工單範圍的改動皆有揭露理由,如 A6 的 OWN_EMAILS 反向 import、B2 的終態守門補強、C 的 WorkspaceSidebar.tsx 連帶修改)。

**行為驗證**(逐項):

- A1-A7:七項全部驗收條件過(見 progress.md 對應段落逐條列)。
- B1-B4:四項全部驗收條件過,包含派工單指名的驗收案例(Emerald 4 張進行中單、0909)。
- C:唯一入口 `/ops/customers` 確認生效(`AdminShell.tsx` 早已指向,本次補刪舊 UI);三個陷阱(EscalationReplyDialog / AutoSendPolicyCard / CustomerChat 同名異檔)逐一驗證存活正確。
- D1:零差異不發卡、材料性差異彙總單卡、零 LLM、測試帳號排除 —— 全過。
- D2:三項檢查(interaction 落卡/業主零新卡/lastInboundAt 更新)邏輯全過測試;真實 60 秒 HTTP 往返只能 prod 驗(見「待 Jeff 手動」)。

## 3. 偏離申報

- **B2**:選擇新建工具 `attach_interaction_to_order`,不是擴充 `update_custom_order`(派工單本來就把這個選擇交給執行者判斷,理由:兩個動詞混在一個工具裡對 LLM 誤用風險更高)。
- **B2**:額外補上派工單沒明講的終態訂單守門(cancelled/completed),比既有 UI 路徑(只擋 cancelled)更嚴格——對抗審查認為這是正確的補強,不是擴大範圍。
- **B4**:認證用 `LOCAL_SCRIPT_TOKEN` bearer token(照抄 import-case-file 慣例),但派工單字面說「admin-only」——不確定 Jeff 是否預期能從登入中的 admin UI 直接觸發,已在報告中揭露,未自行決定,等 Jeff 裁示。
- **C**:額外修改了 `WorkspaceSidebar.tsx`(不在派工單列出的候選清單裡)——這是 STEP 1 移除 `customer`/`guest` view type 的必然連帶後果(不修會讓側欄每個客人列變成無效點擊),對抗審查確認是必要修改不是擴大範圍。
- **D**:`testAccounts.ts` 新增兩個具名 export(`TEST_ACCOUNT_0909_EMAIL`/`TEST_ACCOUNT_0909_PROFILE_ID`)——A6 原本就私有持有這兩個字面值,派工單本身也講 A6 是為了給 D 用,不是新範圍。
- **D3(月度 scorecard 桌機腳本)**:整塊順延,派工單明文允許(「D3 可整塊順延下批,在 T6 明說即可」)。時間分配優先給 D1/D2(每週自動稽核跟 canary 是更即時的防線),D3 是月度、低頻、桌機安裝類工作,適合另開一批專心做(照 imessage-sync.mjs 的模式)。

## 4. 已知限制(誠實列,含原因)

- **A**:`adminCustomers.ts` 三處(markNotCustomer/followUpDate/createManualCustomer)、`agent/demo.ts`、`gmailPipeline.ts` 的新 sender 建卡邏輯沒有專屬單元測試——這幾個檔案本身就沒有既有測試骨架,蓋滿要 mock 6+ 個 collaborator,跟修復體積不成比例,已列獨立 follow-up(task list #6)。
- **B**:B2 沒有「查詢客人訂單清單」的讀工具——LLM 目前只能用「剛才自己建/改單的回傳」拿到 orderId,Jeff 冷不防說「掛到那張報價單」目前會失敗(工具會回錯誤要求先確認,不會亂猜)。等 B3 的 `activeProjectId` 前端串接普及後,選中 chip 時工具或許能自動拿到,暫不需要新工具。
- **B**:B2 補的終態守門(擋 cancelled/completed)比既有 UI 路徑(`assignConversation`,只擋 cancelled)更嚴格,兩條路徑目前不完全一致——沒有回頭修 UI 路徑,因為那是既有行為,不在這次範圍內。
- **C**:「查看客人」跳轉(escalation/task 卡片點擊)現在落在無篩選的 `/ops/customers` 列表,不是那位客人的頁面——`AdminCustomers.tsx` 目前沒有 URL 參數式的客人選取機制,要做深連結需要新功能,不在 STEP 1 字面範圍內,已誠實列為已知限制(不是隱藏起來)。
- **C**:`admin.customersCrm` 還有約 14 個零程式碼引用的孤兒 i18n key——確認是 Block C 之前就存在的殘留(不是這次造成的),沒有動,避免跟這批的刪除範圍混在一起。
- **D**:D1 沒有像 `followupScan.ts` 那樣的重發抑制窗口(`DEDUP_DAYS`)——同一位客人持續對不上會每週都發一次卡。低風險(純內部,不影響客人),派工單本身只要求卡片「形狀」比照,沒要求抑制機制,暫不補。
- **D**:D1 的「材料性差異」判斷是文字層級的字串比對(比對 `deriveActions`/`deriveDelivered` 產出的敘述字串),不是結構化逐欄位比對——這跟 `customerFacts.ts` 現有架構一致(那兩個欄位本來就是設計成敘述字串),不是偷工,但要知道它比對的是文字不是欄位。
- **D**:D3(月度 scorecard 桌機腳本)整塊未做,順延下一批,詳見「偏離申報」。
- **環境插曲(非本批程式碼問題)**:merge Block B 回 main 時,pre-push hook 的全套測試發現兩個檔案(`viteJsxLocGate.test.ts`、`imageIntelligenceService.test.ts`)因為 `node_modules` 內 babel gensync / pdf-lib tslib 的模組載入損壞而失敗,經確認是環境性、跟這批任何程式碼改動都無關(用 `git stash` 對照乾淨 base commit 也一樣壞)。做了一次 `rm -rf node_modules && pnpm install` 乾淨重裝後解決,之後全程綠燈。這不是這批功能的缺陷,但值得記錄:如果未來又遇到類似「明明沒改東西卻突然兩個檔案壞掉」,先試乾淨重裝。

## 5. 給指揮的審查建議(自曝弱點,至少 3 條)

1. **B2 的終態守門選擇(補得比 UI 嚴)是否要回頭讓 UI 路徑一致**——目前兩條路徑(chat 工具 vs 既有 UI `assignConversation`)對「completed」訂單的擋法不一樣,我判斷「新的比舊的嚴格」是安全方向,但如果 Jeff 覺得應該讓兩邊完全一致,需要回頭改 `adminCustomerOrders.ts`(不在本次範圍)。
2. **D1 的「文字差異」判斷灵敏度沒有真實資料驗證過**——`diffCustomerSummary` 靠比對 `deriveActions`/`deriveDelivered` 產出的敘述字串是否相等,理論上正確,但從沒有跑過真實 prod 資料看過會不會有意外的假陽性(例如日期格式、金額四捨五入差一點點導致字串不相等但語意其實一樣)。**只能 prod 驗**——第一次真跑的結果建議監工過目一次卡片內容再決定要不要調整比對粒度。
3. **D2 canary 的真實 HTTP 往返行為**——測試只驗證了邏輯正確(mock fetch)跟 wire format 正確(比照 `full-pipeline-test.mjs` 已驗證過的格式),沒有真的對一台跑起來的 server 打過。**只能 prod 驗**,第一次上線後的首跑必須有人看過office inbox(零卡=正常,有卡=看內容)。
4. （次要)B4 存量回填端點認證選擇(bearer token vs admin session)在「偏離申報」已提過,若 Jeff 預期能從網頁後台直接觸發而非只能桌機腳本跑,需要另外補一層。

## 6. 待 Jeff 手動

1. **`pnpm ship`**——部署到 prod(指令區塊見下方)。
2. **D2 canary 首跑觀察**——上線後下一個週一 13:00 UTC(或手動觸發一次)後,檢查 office inbox:零卡=健康,有卡=看內容判斷是哪一項檢查沒過。順便去 `/ops/customers` 找 #2760017 這張卡,確認真的多了一筆帶「[canary] 週檢」字樣的互動。
3. **D1 首跑觀察**——同上邏輯,下一個週一 12:00 UTC 後檢查 office inbox,零卡=健康;若有卡,建議先看看是不是真的資料有問題,而不是急著把卡片內容當噪音關掉。
4. **B4 存量回填**——建議先對 1-2 位客人(例如 Emerald)跑 dry_run 模式看統計,確認合理再 confirm 全量跑,照 import-case-file 那套「先看預覽再拍板」的節奏。
5. **B2 的冷啟動限制**——實際用看看「掛到那張單」這種指令在沒有前情提要時是不是常常卡住,決定要不要開一張後續任務補「查詢客人訂單清單」讀工具。
6. **C 的深連結限制**——點「查看客人」現在會落在客人列表而不是那位客人的頁面,實測看看這個體感是否可接受,不行的話開後續任務補 URL 參數式選取。
7. **D3(月度 scorecard 桌機腳本)**——順延,需要另開一批(照 `imessage-sync.mjs`/`imessage-sync-setup.md` 的模式,`docs/agent/30-templates.md` 的 T2 模板可以直接填)。
